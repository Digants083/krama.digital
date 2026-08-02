import json
import os
import tempfile
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.security import ClinicPrincipal, require_clinic_principal

router = APIRouter(prefix="/ai", tags=["ai-transcription"])

MAX_AUDIO_BYTES = 25 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/opus",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/flac",
}
EXTENSIONS_BY_CONTENT_TYPE = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/flac": ".flac",
}


def _run_sarvam_batch(api_key: str, audio_bytes: bytes, suffix: str):
    try:
        from sarvamai import SarvamAI
    except ImportError as exc:
        raise RuntimeError("Sarvam SDK is not installed on the backend.") from exc

    with tempfile.TemporaryDirectory(prefix="karma-sarvam-") as temp_dir:
        temp_path = Path(temp_dir)
        audio_path = temp_path / f"consultation{suffix}"
        output_path = temp_path / "output"
        audio_path.write_bytes(audio_bytes)
        output_path.mkdir()

        client = SarvamAI(api_subscription_key=api_key)
        job = client.speech_to_text_job.create_job(
            model="saaras:v3",
            mode="translate",
            language_code="unknown",
            with_diarization=True,
        )
        job.upload_files(file_paths=[str(audio_path)])
        job.start()
        final_status = job.wait_until_complete(poll_interval=3, timeout=600)
        if final_status.job_state.lower() != "completed":
            raise RuntimeError(final_status.error_message or "Sarvam could not process this recording.")

        file_results = job.get_file_results()
        if not file_results.get("successful"):
            failures = file_results.get("failed") or []
            detail = failures[0].get("error_message") if failures else None
            raise RuntimeError(detail or "Sarvam could not process this recording.")

        # Sarvam's status and download services can be briefly out of sync after
        # completion. Retry only the download step; never create another paid job.
        for attempt in range(10):
            try:
                job.download_outputs(output_dir=str(output_path))
                break
            except Exception as exc:
                is_state_delay = "not in COMPLETED state" in str(exc) or "Current state: Pending" in str(exc)
                if not is_state_delay or attempt == 9:
                    raise
                time.sleep(3)
                job.wait_until_complete(poll_interval=3, timeout=120)
        result_files = list(output_path.rglob("*.json"))
        if not result_files:
            raise RuntimeError("Sarvam completed the job without a transcript file.")
        return json.loads(result_files[0].read_text(encoding="utf-8"))


@router.post("/transcribe-consultation")
async def transcribe_consultation(
    audio: UploadFile = File(...),
    principal: ClinicPrincipal = Depends(require_clinic_principal),
):
    api_key = os.getenv("SARVAM_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Voice processing is temporarily unavailable.")

    content_type = (audio.content_type or "").split(";")[0].lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported recording format. Please record again in Chrome or Edge.")

    audio_bytes = await audio.read(MAX_AUDIO_BYTES + 1)
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="The recording is empty.")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="The recording is too large. Keep test recordings under 25 MB.")

    try:
        payload = await run_in_threadpool(
            _run_sarvam_batch,
            api_key,
            audio_bytes,
            EXTENSIONS_BY_CONTENT_TYPE[content_type],
        )
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Voice processing is taking too long. Please try a shorter recording.") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="The recording could not be processed. Please try again.") from exc

    entries = (payload.get("diarized_transcript") or {}).get("entries") or []
    speaker_names = {}

    def speaker_label(speaker_id):
        key = str(speaker_id if speaker_id is not None else "unknown")
        if key not in speaker_names:
            index = len(speaker_names)
            label = ""
            while True:
                index, remainder = divmod(index, 26)
                label = chr(65 + remainder) + label
                if index == 0:
                    break
                index -= 1
            speaker_names[key] = f"Speaker {label}"
        return speaker_names[key]

    segments = [
        {
            "speaker": speaker_label(entry.get("speaker_id")),
            "start": entry.get("start_time_seconds", 0),
            "end": entry.get("end_time_seconds", 0),
            "text": entry.get("transcript", ""),
        }
        for entry in entries
    ]

    if not segments and payload.get("transcript"):
        segments = [{"speaker": "Speaker A", "start": 0, "end": 0, "text": payload["transcript"]}]

    return {
        "language_code": payload.get("language_code"),
        "segments": segments,
    }
