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


def infer_consultation_speaker_roles(segments: list[dict]) -> list[dict]:
    """Map diarized Speaker A/B labels to Doctor/Patient when evidence is strong.

    Sarvam supplies stable diarization identities but not clinical roles. This
    scores all turns for each identity, then assigns roles at the conversation
    level. Existing explicit Doctor/Patient labels are always preserved. When a
    role cannot be assigned safely the original label is retained.
    """
    standardized = standardize_speaker_labels([dict(segment) for segment in segments])
    unknown_labels = []
    grouped: dict[str, list[str]] = {}
    for segment in standardized:
        label = str(segment.get("speaker") or "Speaker").strip()
        if label in {"Doctor", "Patient"}:
            continue
        if label not in grouped:
            unknown_labels.append(label)
            grouped[label] = []
        grouped[label].append(str(segment.get("text") or ""))

    if len(unknown_labels) < 2:
        return standardized

    # Diarization can create a short third identity for overlap, crosstalk, or
    # a brief attendant interjection. Use the two substantial conversation
    # identities for Doctor/Patient role assignment and leave minor identities
    # untouched unless they were already explicitly labelled.
    primary_labels = sorted(
        unknown_labels,
        key=lambda label: (
            sum(len(text.split()) for text in grouped[label]),
            len(grouped[label]),
        ),
        reverse=True,
    )[:2]

    doctor_patterns = [
        r"\b(?:how long|since when|do you|did you|have you|are you|any allergies?)\b",
        r"\b(?:i(?:'ll| will) prescribe|i advise|i recommend|take this|take one|start taking)\b",
        r"\b(?:come back|follow up|return in|seek urgent|go to (?:the )?hospital)\b",
        r"\b(?:let me examine|on examination|your diagnosis|this (?:is|looks like)|likely)\b",
        r"\b(?:drink|eat|avoid|rest|monitor|check)\b.*\b(?:water|fluids|food|sugar|temperature|bp)\b",
    ]
    patient_patterns = [
        r"\b(?:i have|i had|i am having|i feel|i felt|my |it started|i noticed)\b",
        r"\b(?:for (?:one|two|three|four|five|six|seven|\d+) (?:day|days|week|weeks|month|months))\b",
        r"\b(?:yes|no|yeah|haan|nahi|howdu|illa)(?:\b|\s+doctor\b)",
        r"\b(?:i take|i am taking|i don't take|i do not take|allergic to)\b",
        r"\b(?:hurts|pain|cough|feverish|dizzy|vomiting|breathing difficulty)\b",
    ]

    scores: dict[str, tuple[int, int]] = {}
    for label, turns in grouped.items():
        joined = " ".join(turns).lower()
        doctor_score = sum(len(re.findall(pattern, joined, re.IGNORECASE)) for pattern in doctor_patterns)
        patient_score = sum(len(re.findall(pattern, joined, re.IGNORECASE)) for pattern in patient_patterns)
        scores[label] = (doctor_score, patient_score)

    ranked_doctor = sorted(
        primary_labels,
        key=lambda label: (scores[label][0] - scores[label][1], scores[label][0]),
        reverse=True,
    )
    doctor_label = ranked_doctor[0]
    patient_label = ranked_doctor[1]
    doctor_delta = scores[doctor_label][0] - scores[doctor_label][1]
    patient_delta = scores[patient_label][1] - scores[patient_label][0]
    if scores[doctor_label][0] < 1 or (doctor_delta < 1 and patient_delta < 1):
        return standardized

    mapping = {doctor_label: "Doctor", patient_label: "Patient"}
    for segment in standardized:
        label = str(segment.get("speaker") or "")
        if label in mapping:
            segment["original_speaker"] = label
            segment["speaker"] = mapping[label]
    return standardized


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
