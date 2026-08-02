import difflib
import re
from typing import Any, Optional

from .medical_vocabulary import MEDICAL_VOCABULARY


def fuzzy_match(word: str, candidates: list[str], threshold: float = 0.6) -> list[tuple[str, float]]:
    """Find best fuzzy matches for a word against a list of candidates."""
    word = word.strip().lower()
    if not word:
        return []
    matches = []
    for candidate in candidates:
        ratio = difflib.SequenceMatcher(None, word, candidate.lower()).ratio()
        if ratio >= threshold:
            matches.append((candidate, round(ratio, 2)))
    matches.sort(key=lambda x: x[1], reverse=True)
    return matches


def find_medication_corrections(segment_text: str) -> list[dict]:
    """
    Find possible medication name errors in a segment.
    Returns list of {original, suggested, entity_type, confidence, needs_review}
    """
    corrections = []
    words = re.findall(r"\b([A-Za-z]{3,})\b", segment_text)
    all_med_names = MEDICAL_VOCABULARY["medications"]["brands"] + MEDICAL_VOCABULARY["medications"]["generics"]
    all_med_lower = {m.lower() for m in all_med_names}

    known_words = {
        "the", "and", "for", "with", "this", "that", "have", "has", "had",
        "was", "were", "will", "would", "can", "could", "should", "may",
        "might", "must", "shall", "not", "but", "are", "all", "any",
        "each", "every", "some", "many", "much", "more", "most",
        "very", "also", "just", "only", "than", "then", "when", "what",
        "where", "which", "who", "how", "here", "there", "does", "done",
        "take", "takes", "took", "taken", "get", "gets", "got", "tell",
        "told", "ask", "asks", "asked", "give", "gives", "gave", "given",
        "use", "uses", "used", "need", "needs", "needed", "try", "tries",
        "tried", "said", "say", "says", "see", "saw", "seen", "feel",
        "feels", "felt", "put", "puts", "make", "makes", "made",
        "come", "came", "go", "goes", "went", "gone", "know", "knows",
        "knew", "think", "thinks", "thought", "want", "wants", "wanted",
        "tell", "tells", "told", "from", "into", "over", "under",
        "before", "after", "above", "below", "between", "through",
        "during", "without", "within", "along", "around", "about",
        "across", "against", "among", "behind", "beneath", "beside",
        "since", "until", "upon", "via", "while", "because", "though",
        "although", "unless", "except", "whether", "whatever",
        "but", "despite", "your", "you", "i", "he", "she", "it", "we",
        "they", "me", "him", "her", "us", "them", "my", "his", "its",
        "our", "their", "mine", "yours", "hers", "ours", "theirs",
        "doctor", "patient", "sir", "madam", "maam", "hello", "hi",
        "hey", "okay", "ok", "please", "thank", "thanks", "welcome",
        "yes", "no", "yeah", "nah", "right", "fine", "good", "well",
        "better", "worst", "worst", "best", "bad", "little", "some",
        "today", "tomorrow", "yesterday", "now", "then", "still",
        "already", "yet", "ago", "soon", "early", "late", "again",
        "often", "seldom", "always", "never", "sometimes", "usually",
        "five", "six", "seven", "eight", "nine", "ten", "eleven",
        "twelve", "hundred", "thousand", "once", "twice", "thrice",
        "time", "timing", "daily", "weekly", "monthly", "yearly",
        "before", "after", "during", "day", "night", "morning",
        "evening", "afternoon", "lunch", "dinner", "breakfast", "meal",
        "food", "water", "empty", "full", "same", "different", "other",
        "another", "first", "second", "third", "last", "next", "previous",
        "normal", "abnormal", "high", "low", "mild", "moderate", "severe",
        "acute", "chronic", "sudden", "gradual", "constant", "intermittent",
        "general", "local", "regular", "irregular", "proper", "improper",
        "tablet", "tablets", "capsule", "capsules", "syrup", "injection",
        "ointment", "cream", "drops", "spray", "powder", "sachet",
        "inhaler", "nebulizer", "bottle", "strip", "packet", "box",
    }

    phrase_lookup = MEDICAL_VOCABULARY.get("confusables", {})

    # Check multi-word phrases first
    segment_lower = segment_text.lower()
    for wrong_phrase, suggestions in phrase_lookup.items():
        if wrong_phrase.lower() in segment_lower:
            corrections.append({
                "original": wrong_phrase,
                "suggested": suggestions[0] if suggestions else None,
                "all_suggestions": suggestions,
                "entity_type": "medication" if _is_medication_suggestion(suggestions) else "phrase",
                "confidence": _estimate_confusable_confidence(wrong_phrase, segment_text),
                "needs_review": True,
                "matched_by": "confusable",
            })

    for word in words:
        word_lower = word.lower()
        if word_lower in known_words or len(word_lower) <= 2:
            continue
        if word_lower in all_med_lower:
            continue

        matches = fuzzy_match(word, all_med_names, threshold=0.55)
        if matches:
            best_match, best_score = matches[0]
            corrections.append({
                "original": word,
                "suggested": best_match,
                "all_suggestions": [m[0] for m in matches[:3]],
                "entity_type": "medication",
                "confidence": round(best_score, 2),
                "needs_review": best_score < 0.8,
                "matched_by": "fuzzy",
            })

    return corrections


def _is_medication_suggestion(suggestions: list[str]) -> bool:
    all_med = set(
        m.lower()
        for m in (MEDICAL_VOCABULARY["medications"]["brands"] + MEDICAL_VOCABULARY["medications"]["generics"])
    )
    return any(s.lower() in all_med for s in suggestions)


def _estimate_confusable_confidence(wrong_phrase: str, context: str) -> float:
    """Estimate confidence based on how similar the wrong phrase is to the correct one."""
    return 0.6


def find_critical_entities(segment_text: str) -> list[dict]:
    """
    Detect critical medical entities in a segment.
    Returns list of {text, entity_type, confidence, needs_review}
    """
    critical = []
    text_lower = segment_text.lower()

    # Medication names
    all_med_names = MEDICAL_VOCABULARY["medications"]["brands"] + MEDICAL_VOCABULARY["medications"]["generics"]
    for med in all_med_names:
        if med.lower() in text_lower:
            critical.append({
                "text": med,
                "entity_type": "medication",
                "confidence": 1.0,
                "needs_review": False,
            })

    # Strength patterns
    for pattern in MEDICAL_VOCABULARY["strength_patterns"]:
        matches = re.findall(pattern, segment_text, re.IGNORECASE)
        for m in matches:
            critical.append({
                "text": m.strip(),
                "entity_type": "strength",
                "confidence": 0.9,
                "needs_review": False,
            })

    # Dosage patterns
    for pattern in MEDICAL_VOCABULARY["dosage_patterns"]:
        matches = re.findall(pattern, segment_text, re.IGNORECASE)
        for m in matches:
            critical.append({
                "text": m.strip(),
                "entity_type": "dosage",
                "confidence": 0.85,
                "needs_review": False,
            })

    # Frequency patterns
    for pattern in MEDICAL_VOCABULARY["frequency_patterns"]:
        matches = re.findall(pattern, segment_text, re.IGNORECASE)
        for m in matches:
            critical.append({
                "text": m.strip(),
                "entity_type": "frequency",
                "confidence": 0.9,
                "needs_review": False,
            })

    # Duration patterns
    for pattern in MEDICAL_VOCABULARY["duration_patterns"]:
        matches = re.findall(pattern, segment_text, re.IGNORECASE)
        for m in matches:
            critical.append({
                "text": m.strip(),
                "entity_type": "duration",
                "confidence": 0.85,
                "needs_review": False,
            })

    # Symptoms
    for symptom in MEDICAL_VOCABULARY["symptoms"]:
        if symptom.lower() in text_lower:
            critical.append({
                "text": symptom,
                "entity_type": "symptom",
                "confidence": 1.0,
                "needs_review": False,
            })

    # Vitals
    for vital in MEDICAL_VOCABULARY["vitals"]:
        if vital.lower() in text_lower:
            critical.append({
                "text": vital,
                "entity_type": "vital",
                "confidence": 1.0,
                "needs_review": False,
            })

    # Allergies
    allergy_pattern = re.compile(
        r"(?:allergic\s+(?:to|reaction)|allergy\s+(?:to|from|with)|"
        r"allergies?\s*(?:include|are|:)|(?:has|have|had)\s+allergy\s+(?:to|from))"
        r"\s*:?\s*([A-Za-z\s,]+)",
        re.IGNORECASE,
    )
    for match in allergy_pattern.finditer(segment_text):
        allergy_text = match.group(1).strip()
        if allergy_text:
            critical.append({
                "text": allergy_text,
                "entity_type": "allergy",
                "confidence": 0.75,
                "needs_review": True,
            })

    # Negation detection
    negation_patterns = [
        r"(?:no|not|don'?t|doesn'?t|didn'?t|haven'?t|hasn'?t|won'?t|isn'?t|aren'?t)"
        r"\s+(?:have|has|feel|get|notice|see|experience|develop)",
        r"(?:no|not)\s+(?:headache|pain|cough|fever|cold|symptom|allergy|problem|issue)",
        r"without\s+(?:any|the)?\s*(?:headache|pain|cough|fever|cold|symptom|allergy|problem|issue)",
        r"no\s+(?:history|prior|previous)\s+(?:of|episode)",
        r"doesn'?t\s+(?:work|help|improve|relieve)",
        r"(?:never|nothing|nobody|none|neither)",
    ]
    for pattern in negation_patterns:
        if re.search(pattern, segment_text, re.IGNORECASE):
            critical.append({
                "text": "negation_detected",
                "entity_type": "negation",
                "confidence": 0.7,
                "needs_review": False,
            })
            break

    return deduplicate_entities(critical)


def flag_clinically_inconsistent(text: str) -> list[dict]:
    """
    Flag text that appears clinically inconsistent.
    e.g. "health care center" in a symptom list, "after water" in medication instructions.
    """
    flags = []
    text_lower = text.lower()

    unlikely_symptom_phrases = [
        "health care center", "healthcare center", "healthcare centre",
        "hospital center", "medical center", "care center",
        "welcome to", "good morning how can i", "how may i help",
    ]
    for phrase in unlikely_symptom_phrases:
        if phrase in text_lower:
            flags.append({
                "text": phrase,
                "reason": "non_clinical_phrase_in_medical_context",
                "confidence": 0.6,
                "needs_review": True,
            })

    # Check for numbers in weird context
    number_words = re.findall(r"\b(?:thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b", text_lower)
    if len(number_words) > 3:
        flags.append({
            "text": " ".join(number_words),
            "reason": "multiple_number_words_likely_transcription_error",
            "confidence": 0.55,
            "needs_review": True,
        })

    return flags


def check_speaker_consistency(segments: list[dict]) -> list[dict]:
    """
    Detect likely speaker assignment errors.
    Uses conversation flow heuristics.
    Returns list of {segment_index, current_speaker, suggested_speaker, reason, confidence}
    """
    suggestions = []
    doctor_patterns = [
        r"(?:how\s+(?:are|have|long|many|much|often|frequently))",
        r"(?:tell\s+me|explain|describe|show\s+me)",
        r"(?:what\s+(?:brings|is|are|was|were|has|have|can))",
        r"(?:do\s+you|did\s+you|have\s+you|are\s+you|will\s+you)",
        r"(?:any\s+(?:pain|fever|cough|cold|symptom|allergy|problem|issue|medicine|medication))",
        r"(?:since\s+when|for\s+how\s+long|when\s+did\s+it\s+start)",
        r"(?:take\s+(?:this|that|these|the)\s+(?:medicine|medication|tablet|pill|drug))",
        r"(?:i\s+(?:will|shall|would|can)\s+(?:prescribe|give|start|advise|recommend|suggest))",
        r"(?:let\s+me|i'?ll\s+(?:check|see|examine|look|prescribe|give|start))",
        r"(?:you\s+(?:need|should|must|have\s+to|can|will)\s+(?:take|use|apply|eat|drink|avoid|stop))",
        r"(?:come\s+(?:back|again|for|to)|follow\s+up|visit\s+again)",
        r"(?:okay|alright|fine|good|right|so|now)\s*[,.]?\s*(?:let|i|we|you|tell)",
        r"(?:please\s+(?:take|use|apply|eat|drink|avoid|stop|come|visit|follow))",
    ]
    patient_patterns = [
        r"(?:i\s+(?:have|had|am|was|feel|felt|get|got|suffer|experienced|noticed|developed))",
        r"(?:my\s+(?:head|body|leg|arm|knee|back|stomach|chest|throat|ear|eye|nose))",
        r"(?:it\s+(?:started|began|hurts|pain|aches|burns|itches|swells))",
        r"(?:since\s+(?:last|yesterday|today|morning|evening|night|week|month))",
        r"(?:i\s+(?:also|too|even)?\s*(?:feel|have|had|am))",
        r"(?:yes|no|yeah|nah|haan|nahi|howdu|illa)\s*[,.]?\s*(?:doctor|sir|madam|maam)?",
        r"(?:for\s+(?:\d+|a\s+few|a\s+couple|some|many)\s+(?:day|week|month|year|hour))",
        r"(?:it\s+(?:is|was|has\s+been)\s+(?:painful|sore|swollen|red|itchy|burning))",
        r"(?:nothing|nobody|no\s+one)\s+(?:helps|works|improves)",
        r"(?:i\s+(?:can'?t|cannot|couldn'?t|won'?t|don'?t))",
        r"(?:please\s+(?:help|do\s+something|give\s+me|tell\s+me))",
        r"(?:thank|thanks|thanks\s+a\s+lot|thank\s+you)",
    ]

    for i, seg in enumerate(segments):
        text = seg.get("text", "")
        speaker = seg.get("speaker", "")
        text_lower = text.lower().strip()

        if not text_lower or len(text_lower) < 5:
            continue

        doctor_score = 0
        patient_score = 0

        for pat in doctor_patterns:
            if re.search(pat, text_lower):
                doctor_score += 1

        for pat in patient_patterns:
            if re.search(pat, text_lower):
                patient_score += 1

        is_doctor = "doctor" in speaker.lower()
        is_patient = "patient" in speaker.lower() or "speaker" not in speaker.lower()

        if not is_doctor and not is_patient:
            is_patient = True

        if doctor_score > patient_score + 1 and is_patient:
            suggestions.append({
                "segment_index": i,
                "current_speaker": speaker,
                "suggested_speaker": "Doctor",
                "reason": f"speaker is answering with clinical questioning patterns (doctor_score={doctor_score}, patient_score={patient_score})",
                "confidence": round(min(0.5 + (doctor_score - patient_score) * 0.1, 0.85), 2),
            })
        elif patient_score > doctor_score + 1 and is_doctor:
            suggestions.append({
                "segment_index": i,
                "current_speaker": speaker,
                "suggested_speaker": "Patient",
                "reason": f"speaker is answering with symptom reporting patterns (patient_score={patient_score}, doctor_score={doctor_score})",
                "confidence": round(min(0.5 + (patient_score - doctor_score) * 0.1, 0.85), 2),
            })

    return suggestions


def deduplicate_entities(entities: list[dict]) -> list[dict]:
    """Remove duplicate entity detections."""
    seen = set()
    unique = []
    for e in entities:
        key = (e.get("entity_type", ""), e.get("text", "").lower())
        if key not in seen:
            seen.add(key)
            unique.append(e)
    return unique


def needs_second_pass(segment_text: str, corrections: list[dict], flags: list[dict]) -> bool:
    """Determine if a segment needs second-pass transcription."""
    if not segment_text or not segment_text.strip():
        return False

    text_lower = segment_text.lower()

    # Check for low confidence corrections
    if any(c.get("confidence", 1) < 0.7 for c in corrections):
        return True

    # Check for clinical inconsistency flags
    if any(f.get("needs_review") for f in flags):
        return True

    # Check for medication-like words
    med_words = re.findall(r"\b[A-Z][a-z]{2,}\s*\d+\b", segment_text)
    if len(med_words) >= 2:
        return True

    # Check for very short segments that might be noise
    if len(text_lower.split()) <= 2:
        return True

    # Check for unexpected language switch
    from .audio_preprocessor import detect_language_from_text
    lang = detect_language_from_text(segment_text)
    if lang == "unknown":
        return True

    return False
