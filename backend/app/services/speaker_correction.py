import re
from typing import Any


def get_speaker_label(speaker_id: str, existing_labels: dict[str, str]) -> str:
    """Get or create a speaker label."""
    key = str(speaker_id) if speaker_id else "unknown"
    if key not in existing_labels:
        index = len(existing_labels)
        label = ""
        while True:
            index, remainder = divmod(index, 26)
            label = chr(65 + remainder) + label
            if index == 0:
                break
            index -= 1
        existing_labels[key] = f"Speaker {label}"
    return existing_labels[key]


def apply_speaker_corrections(
    segments: list[dict],
    corrections: list[dict],
) -> list[dict]:
    """
    Apply user-confirmed speaker corrections to segments.
    Each correction: {segment_index, current_speaker, suggested_speaker, confirmed: bool}
    """
    corrected = list(segments)
    for corr in corrections:
        idx = corr.get("segment_index")
        if idx is not None and 0 <= idx < len(corrected) and corr.get("confirmed"):
            corrected[idx]["speaker"] = corr.get("suggested_speaker", corrected[idx].get("speaker"))
    return corrected


def standardize_speaker_labels(segments: list[dict]) -> list[dict]:
    """
    Standardize speaker labels to "Doctor", "Patient", or "Speaker X".
    """
    labeled = []
    speaker_map = {}

    for seg in segments:
        speaker = seg.get("speaker", "Speaker").strip()
        speaker_lower = speaker.lower()

        if speaker_lower in ("doctor", "dr.", "dr", "doctor a", "doctor b"):
            speaker_map[speaker] = "Doctor"
        elif speaker_lower in ("patient", "patient a", "patient b", "patient c"):
            speaker_map[speaker] = "Patient"
        else:
            speaker_map[speaker] = speaker

        seg["speaker"] = speaker_map[speaker]
        labeled.append(seg)

    return labeled


def combine_consecutive_segments(segments: list[dict]) -> list[dict]:
    """
    Merge adjacent segments from the same speaker.
    """
    if not segments:
        return []

    combined = [dict(segments[0])]
    for seg in segments[1:]:
        if seg.get("speaker") == combined[-1].get("speaker"):
            gap = seg.get("start", 0) - combined[-1].get("end", 0)
            if gap < 3.0:
                combined[-1]["end"] = max(combined[-1].get("end", 0), seg.get("end", 0))
                existing_text = combined[-1].get("text", "")
                new_text = seg.get("text", "")
                if existing_text and new_text:
                    if not existing_text.rstrip().endswith((".", "?", "!")):
                        combined[-1]["text"] = existing_text.rstrip() + ". " + new_text
                    else:
                        combined[-1]["text"] = existing_text + " " + new_text
            else:
                combined.append(dict(seg))
        else:
            combined.append(dict(seg))
    return combined
