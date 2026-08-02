import io
import math
import os
import tempfile
import subprocess
from pathlib import Path
from typing import Optional

import numpy as np

SAMPLE_RATE = 16000
TARGET_CHANNELS = 1
CHUNK_DURATION_SECONDS = 300
CHUNK_OVERLAP_SECONDS = 15
SILENCE_THRESHOLD_DB = -35
SILENCE_MIN_MS = 300


def _ffmpeg_binary() -> str:
    candidates = ["ffmpeg", "ffmpeg.exe", r"C:\ffmpeg\bin\ffmpeg.exe"]
    for candidate in candidates:
        try:
            subprocess.run([candidate, "-version"], capture_output=True, check=True)
            return candidate
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
    return "ffmpeg"


def preprocess_audio(audio_bytes: bytes, input_suffix: str = ".webm") -> Optional[bytes]:
    """
    Preprocess audio for transcription:
    1. Convert to mono 16 kHz WAV
    2. Normalize volume without clipping
    3. Reduce steady background noise
    4. Return cleaned WAV bytes
    """
    ffmpeg = _ffmpeg_binary()
    with tempfile.TemporaryDirectory(prefix="karma-audio-") as tmp:
        input_path = Path(tmp) / f"input{input_suffix}"
        cleaned_path = Path(tmp) / "cleaned.wav"
        input_path.write_bytes(audio_bytes)

        try:
            step1_path = Path(tmp) / "step1.wav"
            subprocess.run(
                [
                    ffmpeg, "-y", "-i", str(input_path),
                    "-ac", str(TARGET_CHANNELS),
                    "-ar", str(SAMPLE_RATE),
                    "-sample_fmt", "s16",
                    "-af", "volume=1.0",
                    str(step1_path),
                ],
                capture_output=True, check=True, timeout=120,
            )

            step2_path = Path(tmp) / "step2.wav"
            subprocess.run(
                [
                    ffmpeg, "-y", "-i", str(step1_path),
                    "-af", "speechnorm=e=7:r=0.0001:l=1",
                    "-sample_fmt", "s16",
                    "-ar", str(SAMPLE_RATE),
                    str(step2_path),
                ],
                capture_output=True, check=False, timeout=120,
            )
            if not step2_path.exists():
                step2_path = step1_path

            step3_path = Path(tmp) / "step3.wav"
            subprocess.run(
                [
                    ffmpeg, "-y", "-i", str(step2_path),
                    "-af",
                    "highpass=f=80,lowpass=f=7600,"
                    "afftdn=nf=-25:d=5:nt=w:tn=1",
                    "-sample_fmt", "s16",
                    "-ar", str(SAMPLE_RATE),
                    str(step3_path),
                ],
                capture_output=True, check=False, timeout=120,
            )
            if not step3_path.exists():
                step3_path = step2_path

            subprocess.run(
                [
                    ffmpeg, "-y", "-i", str(step3_path),
                    "-af",
                    f"silenceremove=start_periods=1:start_duration=0.5:start_threshold=-{abs(SILENCE_THRESHOLD_DB)}dB:"
                    f"stop_periods=1:stop_duration=1:stop_threshold=-{abs(SILENCE_THRESHOLD_DB)}dB,"
                    "areverse,silenceremove=start_periods=1:start_duration=0.3:start_threshold=-35dB,areverse",
                    "-sample_fmt", "s16",
                    "-ar", str(SAMPLE_RATE),
                    str(cleaned_path),
                ],
                capture_output=True, check=False, timeout=120,
            )

            if not cleaned_path.exists():
                cleaned_path = step3_path if step3_path.exists() else step2_path if step2_path.exists() else step1_path

            return cleaned_path.read_bytes()

        except subprocess.TimeoutExpired:
            return None
        except subprocess.CalledProcessError:
            if cleaned_path.exists():
                return cleaned_path.read_bytes()
            if step2_path.exists():
                return step2_path.read_bytes()
            return None


def split_audio(audio_bytes: bytes, suffix: str = ".wav") -> list[dict]:
    """
    Split long audio into overlapping chunks.
    Returns list of {start_time, end_time, bytes} preserving original timestamps.
    """
    duration = _get_duration_seconds(audio_bytes, suffix)
    if duration is None or duration <= CHUNK_DURATION_SECONDS:
        return [{"start_time": 0.0, "end_time": duration or 0.0, "bytes": audio_bytes}]

    chunks = []
    ffmpeg = _ffmpeg_binary()
    with tempfile.TemporaryDirectory(prefix="karma-chunk-") as tmp:
        input_path = Path(tmp) / f"input{suffix}"
        input_path.write_bytes(audio_bytes)

        start = 0.0
        chunk_index = 0
        while start < duration:
            end = min(start + CHUNK_DURATION_SECONDS, duration)
            chunk_path = Path(tmp) / f"chunk_{chunk_index}{suffix}"
            subprocess.run(
                [
                    ffmpeg, "-y", "-i", str(input_path),
                    "-ss", str(start),
                    "-to", str(end),
                    "-c", "copy" if suffix in (".wav",) else None,
                    "-sample_fmt", "s16",
                    "-ar", str(SAMPLE_RATE),
                    str(chunk_path) if suffix != ".wav" else str(chunk_path),
                ].get("copy"),
                capture_output=True, check=False, timeout=120,
            ).get("copy")
            subprocess.run(
                [
                    ffmpeg, "-y", "-i", str(input_path),
                    "-ss", str(start),
                    "-to", str(end),
                    "-sample_fmt", "s16",
                    "-ar", str(SAMPLE_RATE),
                    str(chunk_path),
                ],
                capture_output=True, check=False, timeout=120,
            )
            if chunk_path.exists():
                chunks.append({
                    "start_time": start,
                    "end_time": end,
                    "bytes": chunk_path.read_bytes(),
                })
            start = end - CHUNK_OVERLAP_SECONDS
            start = max(start, 0.0)
            chunk_index += 1

    return chunks


def merge_transcripts(chunks_transcripts: list[dict], overlap_seconds: float = CHUNK_OVERLAP_SECONDS) -> list[dict]:
    """
    Merge overlapping chunk transcripts, deduplicating overlapping segments.
    Each chunk transcript has {segments, chunk_start, chunk_end}.
    """
    if not chunks_transcripts:
        return []

    if len(chunks_transcripts) == 1:
        return chunks_transcripts[0].get("segments", [])

    all_segments = []
    for chunk in chunks_transcripts:
        chunk_start = chunk.get("chunk_start", 0)
        for seg in chunk.get("segments", []):
            global_start = (seg.get("start", 0) or 0) + chunk_start
            global_end = (seg.get("end", 0) or 0) + chunk_start
            all_segments.append({
                **seg,
                "start": global_start,
                "end": global_end,
                "_source_chunk": chunk.get("chunk_index", 0),
            })

    if not all_segments:
        return []

    all_segments.sort(key=lambda s: (s["start"], s["end"]))

    merged = [all_segments[0]]
    for seg in all_segments[1:]:
        prev = merged[-1]
        gap = seg["start"] - prev["end"]
        if gap <= overlap_seconds * 0.8:
            if seg["end"] > prev["end"]:
                if seg["_source_chunk"] > prev["_source_chunk"]:
                    merged[-1]["end"] = seg["end"]
                    merged[-1]["text"] = seg["text"]
        else:
            merged.append(seg)

    for seg in merged:
        seg.pop("_source_chunk", None)

    return merged


def _get_duration_seconds(audio_bytes: bytes, suffix: str = ".wav") -> Optional[float]:
    ffmpeg = _ffmpeg_binary()
    with tempfile.TemporaryDirectory(prefix="karma-dur-") as tmp:
        path = Path(tmp) / f"audio{suffix}"
        path.write_bytes(audio_bytes)
        try:
            result = subprocess.run(
                [ffmpeg, "-i", str(path), "-f", "null", "-"],
                capture_output=True, check=False, timeout=30,
            )
            stderr = result.stderr.decode("utf-8", errors="replace")
            for line in stderr.split("\n"):
                if "Duration" in line:
                    parts = line.strip().split(",")[0].split("Duration:")[-1].strip()
                    h, m, s = parts.split(":")
                    return int(h) * 3600 + int(m) * 60 + float(s)
            return None
        except Exception:
            return None


def detect_language_from_text(text: str) -> str:
    """
    Simple heuristic language detection for code-mixed medical text.
    Returns ISO language code.
    """
    if not text or not text.strip():
        return "unknown"

    kn_chars = 0
    hi_chars = 0
    en_chars = 0
    total = 0

    for ch in text.strip():
        code = ord(ch)
        if 0x0C80 <= code <= 0x0CFF:
            kn_chars += 1
        elif 0x0900 <= code <= 0x097F:
            hi_chars += 1
        elif 0x0041 <= code <= 0x005A or 0x0061 <= code <= 0x007A:
            en_chars += 1
        total += 1

    if total == 0:
        return "unknown"

    kn_ratio = kn_chars / total
    hi_ratio = hi_chars / total
    en_ratio = en_chars / total

    if kn_ratio > 0.3:
        return "kn-IN"
    if hi_ratio > 0.3:
        return "hi-IN"
    if en_ratio > 0.5:
        if kn_chars > 0 or hi_chars > 0:
            return "code-mixed"
        return "en-IN"

    if kn_chars > hi_chars and kn_chars > en_chars:
        return "kn-IN"
    if hi_chars > en_chars:
        return "hi-IN"

    return "en-IN"
