"""Local retrieval-augmented SOAP field guidance.

This module retrieves documentation rules, not medical knowledge. The transcript
remains the only source of clinical facts. Retrieved documents explain where an
explicitly spoken fact belongs and what must not be inferred.
"""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
import re
from typing import Any, Optional


KNOWLEDGE_PATH = Path(__file__).resolve().parents[1] / "clinical_knowledge" / "soap_rules.json"
CORE_RULE_IDS = {
    "core.transcript_only",
    "core.speaker_routing",
    "core.blank_fields",
    "core.negation",
    "core.provenance",
    "core.correction",
    "core.history_vs_plan",
    "core.no_diagnosis_inference",
}

# The accepted knowledge file keeps its historical rule identifiers.  Map only
# the routed field path at runtime so it matches the canonical SOAP contract;
# this avoids changing the validated RAG documents or their retrieval behavior.
CANONICAL_FIELD_ALIASES = {
    "subjective.chief_concerns": "subjective.chief_complaints",
    "plan.medications": "plan.prescriptions",
    "plan.investigations_ordered": "plan.tests_ordered",
    "plan.referral": "plan.referrals",
}


def _canonical_field(field: Any) -> Any:
    return CANONICAL_FIELD_ALIASES.get(field, field)


def _canonical_candidate_fields(field: Any) -> list[Any]:
    # The historical `plan.advice` rule contains both general treatment and
    # diet/lifestyle instructions. Expose both current destinations and let
    # the schema-guided extractor choose from the utterance meaning.
    if field == "plan.advice":
        return ["plan.treatment_advice", "plan.diet_lifestyle_advice"]
    return [_canonical_field(field)]
QUESTION_RE = re.compile(r"\?\s*$|^(?:do|does|did|are|is|was|were|have|has|can|could|would|will)\b", re.IGNORECASE)
CONSULTATION_QUESTION_RE = re.compile(
    r"(?:^|\.\s+)(?:any\s+\w+(?:\s+\w+){0,4}?|"
    r"\w+\s+h(?:ai|o)\s+kya|\w+\s+id[iy]a|\w+\s+ideya|\w+\s+aaya|"
    r"kya\s+\w+|what\s+about|how\s+(?:about|much|many|long))\b",
    re.IGNORECASE,
)
MAX_SHORT_ANSWER_LOOKBACK = 10
SHORT_RESPONSE_RE = re.compile(
    r"^(?:yes|no|none|never|sometimes|maybe|not\s+sure|i\s+do|i\s+don'?t|i\s+have|i\s+haven'?t"
    r"|illa|\u0c87\u0cb2\u0ccd\u0cb2|haudu|\u0cb9\u0ccc\u0ca6\u0cc1|haan|ha|nahi|nahi\s+hai|"
    r"\u0c87\u0ca6\u0cc6)(?:\b|$)",
    re.IGNORECASE,
)
TOKEN_RE = re.compile(r"[a-z0-9]+")
NEGATION_RE = re.compile(
    r"\b(?:no|not|denies?|denied|without|never|illa|\u0c87\u0cb2\u0ccd\u0cb2|nahi)\b",
    re.IGNORECASE,
)
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "for", "from",
    "have", "i", "if", "in", "is", "it", "my", "of", "on", "or", "the", "this",
    "to", "was", "were", "with", "you", "your",
}
COMPLETENESS_FIELDS = {
    "subjective.chief_concerns",
    "subjective.current_medications",
    "subjective.allergies",
    "objective.vitals",
    "plan.medications",
    "plan.investigations_ordered",
    "plan.follow_up",
    "plan.warning_signs",
}

CANONICAL_LABEL_MAP: dict[str, str] = {
    "patient": "patient", "pt": "patient",
    "caregiver": "caregiver", "carer": "caregiver", "attendant": "caregiver", "family": "caregiver",
    "doctor": "doctor", "dr": "doctor", "clinician": "doctor", "physician": "doctor", "provider": "doctor",
}

CORRECTION_RE = re.compile(
    r"^(?:actually|correction|sorry|i\s+mean|let\s+me\s+correct|"
    r"wait[.,]\s+(?:no|actually|i\s+mean|correction)|no[.,]\s*i\s+mean)",
    re.IGNORECASE,
)

VITAL_KEYWORDS: list[str] = [
    r"\btemperature\b", r"\bbp\b", r"\bblood\s+pressure\b", r"\bpulse\b",
    r"\bheart\s+rate\b", r"\bspo2\b", r"\bo2\b", r"\boxygen\b",
    r"\bweight\b", r"\bheight\b", r"\bbmi\b", r"\bglucose\b",
    r"\bsugar\b", r"\bresp(?:iratory)?\s*rate\b", r"\bsaturation\b",
]
CLINICAL_UNIT_RE = re.compile(
    r"\b\d+\s*(?:\xb0\s*[fc]?|deg(?:ree)?s?\s*[fc]?\b|f\b|c\b|mmhg|bpm|kg|cm|percent|%)",
    re.IGNORECASE,
)
BP_MEASUREMENT_RE = re.compile(r"\b\d{2,3}\s*/\s*\d{2,3}\b")


def _tokens(value: Any) -> set[str]:
    return {
        token for token in TOKEN_RE.findall(str(value or "").lower())
        if len(token) > 1 and token not in STOPWORDS
    }


def _normalize_speaker_key(raw: str) -> str:
    """Normalize a speaker label for map key lookup.

    Strips whitespace, collapses to lowercase, removes non-alphanumeric
    characters so that 'Speaker A', 'speaker a', 'SPEAKER A' all map to
    the same canonical form. Numeric-only labels (0, 1, 00, 01) are
    preserved as-is for matching.
    """
    cleaned = str(raw or "").strip().lower()
    alpha = re.sub(r"[^a-z0-9]", "", cleaned)
    if alpha.isdigit():
        return alpha
    return re.sub(r"\s+", " ", cleaned)


def _canonical_speaker(label: str, speaker_map: Optional[dict[str, str]] = None) -> str:
    """Map a speaker label to a canonical role.

    Resolution priority:
      1. session-level speaker_map (explicit user-provided mapping);
         map keys are normalized for case/spacing/punctuation tolerance
      2. well-known label patterns (doctor, patient, caregiver, etc.)
      3. unknown (diarization labels such as Speaker A / SPEAKER_00 cannot
         be assigned a clinical role without a mapping)
    """
    normalized_label = str(label or "").strip()

    if speaker_map:
        norm_key = _normalize_speaker_key(normalized_label)
        for map_key, map_value in speaker_map.items():
            if _normalize_speaker_key(map_key) == norm_key:
                return _canonical_speaker(map_value)

    clean = re.sub(r"[^a-z]", "", normalized_label.lower())
    if clean in CANONICAL_LABEL_MAP:
        return CANONICAL_LABEL_MAP[clean]

    return "unknown"


def _is_clinic_measurement(text: str) -> bool:
    """Check if text contains a credible clinic measurement.

    A measurement must include both a vital-sign keyword (temperature, BP,
    pulse, etc.) AND a numeric value with a measurement unit or a BP-style
    reading (e.g. 130/80).  This avoids classifying medication strengths or
    follow-up intervals as clinical measurements.
    """
    has_vital = any(re.search(p, text, re.IGNORECASE) for p in VITAL_KEYWORDS)
    if not has_vital:
        return False
    return bool(CLINICAL_UNIT_RE.search(text) or BP_MEASUREMENT_RE.search(text))


def _detect_source_type(speaker: str, is_question: bool, text: str) -> str:
    """Determine the source type for an evidence statement.

    Returns one of: patient_report, caregiver_report, doctor_statement,
    clinic_measurement, unknown.

    Clinic measurement requires a vital-sign keyword AND a numeric value
    with unit — medication strengths, follow-up durations, and bare numbers
    are never classified as clinic_measurement.
    """
    if speaker == "patient":
        return "patient_report"
    if speaker == "caregiver":
        return "caregiver_report"
    if speaker == "doctor":
        if is_question:
            return "unknown"
        if _is_clinic_measurement(text):
            return "clinic_measurement"
        return "doctor_statement"
    return "unknown"


def _is_negated(text: str) -> bool:
    """Return True when the text contains an explicit negation signal."""
    return bool(NEGATION_RE.search(str(text or "")))


def _detect_medication_action(text: str, speaker: str) -> Optional[str]:
    """Detect medication action from a doctor statement.

    Returns one of: START, CONTINUE, CHANGE, STOP, PRN, or None.
    """
    if speaker != "doctor":
        return None
    text_lower = str(text or "").lower()
    if re.search(r"\b(?:as needed|prn|if needed|when needed|only if|if necessary)\b", text_lower):
        return "PRN"
    if re.search(r"\b(?:stop|discontinue|don'?t take|no longer take)\b", text_lower):
        return "STOP"
    if re.search(r"\b(?:change|switch|replace|shift)\b", text_lower):
        return "CHANGE"
    if re.search(r"\b(?:continue|keep taking|stay on)\b", text_lower):
        return "CONTINUE"
    if re.search(r"\b(?:start|prescribe|begin|take)\b", text_lower):
        return "START"
    return None


def _detect_corrections(ledger: list[dict[str, Any]]) -> dict[str, str]:
    """Detect explicit corrections/clarifications in the ledger.

    Scans for correction signal words at the start of a statement and links
    it back to the most recent same-speaker statement. Returns a dict mapping
    superseded evidence_id -> correcting evidence_id.
    """
    corrections: dict[str, str] = {}
    for i, stmt in enumerate(ledger):
        text = str(stmt.get("text") or "")
        if CORRECTION_RE.search(text):
            speaker = stmt.get("speaker")
            for j in range(i - 1, -1, -1):
                prev = ledger[j]
                if prev.get("speaker") == speaker and prev["id"] not in corrections:
                    corrections[prev["id"]] = stmt["id"]
                    break
    return corrections


def _provenance_value(value: str, evidence_ids: list[str], source: str) -> dict[str, Any]:
    """Wrap a field value with provenance metadata.

    This is a lightweight helper for optional provenance tracking; callers
    are not required to use it.
    """
    return {
        "value": value,
        "evidence_ids": evidence_ids,
        "source": source,
    }


@lru_cache(maxsize=1)
def load_soap_knowledge() -> dict[str, Any]:
    with KNOWLEDGE_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload.get("documents"), list):
        raise RuntimeError("SOAP knowledge base is missing its documents list")
    return payload


def _find_short_answer_context(
    ledger: list[dict[str, Any]],
    speaker: str,
    text: str,
) -> Optional[str]:
    """Find the most relevant context for a short patient/caregiver response.

    Prefers the most recent doctor question within a bounded lookback window.
    Falls back to the immediately preceding statement when no question is found.
    Never returns context for non-short-responses.
    """
    if (
        speaker not in {"patient", "caregiver"}
        or not SHORT_RESPONSE_RE.search(text)
        or len(str(text or "").split()) > 4
    ):
        return None
    if not ledger:
        return None
    bound = max(0, len(ledger) - MAX_SHORT_ANSWER_LOOKBACK)
    for i in range(len(ledger) - 1, bound - 1, -1):
        prev = ledger[i]
        if prev.get("is_question") and prev.get("speaker") == "doctor":
            return prev["text"]
    return ledger[-1].get("text") if ledger else None


def build_evidence_ledger(
    transcript: str,
    speaker_map: Optional[dict[str, str]] = None,
) -> list[dict[str, Any]]:
    """Turn the transcript into stable, numbered, exact evidence statements.

    Each entry contains:
      id, speaker, speaker_label, exact_text, context, is_question,
      sequence_index, negated, source_type, medication_action,
      candidate_fields (populated later).

    When a speaker_map dict is provided, diarization labels (e.g. "Speaker A")
    are resolved to canonical roles via that mapping.

    Short affirmative/negative responses in English, Kannada, Hindi and
    code-mixed forms are associated with the most recent relevant doctor
    question when available, falling back to the immediately preceding
    statement.
    """
    ledger: list[dict[str, Any]] = []
    for line in str(transcript or "").splitlines():
        line = line.strip()
        if not line:
            continue
        match = re.match(r"^\s*([^:]{1,40})\s*:\s*(.+)$", line)
        label = match.group(1).strip() if match else "Unknown"
        spoken = match.group(2).strip() if match else line
        speaker = _canonical_speaker(label, speaker_map)
        parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", spoken) if part.strip()]
        for seq_idx, part in enumerate(parts):
            is_question = bool(QUESTION_RE.search(part)) or bool(CONSULTATION_QUESTION_RE.search(part))
            context = _find_short_answer_context(ledger, speaker, part)
            statement: dict[str, Any] = {
                "id": f"E{len(ledger) + 1:03d}",
                "speaker": speaker,
                "speaker_label": label,
                "text": part,
                "context": context,
                "is_question": is_question,
                "sequence_index": seq_idx,
                "negated": _is_negated(part),
                "source_type": _detect_source_type(speaker, is_question, part),
            }
            med_action = _detect_medication_action(part, speaker)
            if med_action:
                statement["medication_action"] = med_action
            ledger.append(statement)

    correction_map = _detect_corrections(ledger)
    for stmt in ledger:
        if stmt["id"] in correction_map:
            stmt["superseded_by"] = correction_map[stmt["id"]]

    return ledger


def _rule_score(rule: dict[str, Any], statement: dict[str, Any]) -> float:
    if rule.get("id") in CORE_RULE_IDS:
        return 100.0
    speaker = statement.get("speaker")
    if speaker == "unknown" or speaker not in set(rule.get("speaker") or []):
        return 0.0
    if statement.get("is_question"):
        return 0.0

    search_text = f"{statement.get('context') or ''} {statement.get('text') or ''}".lower()
    statement_tokens = _tokens(search_text)
    score = 0.0
    for keyword in rule.get("keywords") or []:
        keyword_text = str(keyword).lower().strip()
        if keyword_text and re.search(rf"\b{re.escape(keyword_text)}\b", search_text):
            score += 4.0 if " " in keyword_text else 2.5
    rule_tokens = _tokens(" ".join([
        str(rule.get("purpose") or ""),
        " ".join(rule.get("include") or []),
        " ".join(rule.get("keywords") or []),
    ]))
    score += min(3.0, len(statement_tokens & rule_tokens) * 0.5)
    if NEGATION_RE.search(str(statement.get("text") or "")):
        if rule.get("field") == "subjective.history_of_present_illness":
            score += 5.0
        elif rule.get("field") == "subjective.chief_concerns":
            score = max(0.0, score - 4.0)
    return score


def retrieve_soap_context(
    transcript: str,
    rules_per_statement: int = 3,
    speaker_map: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    knowledge = load_soap_knowledge()
    documents = knowledge["documents"]
    ledger = build_evidence_ledger(transcript, speaker_map)
    selected: dict[str, dict[str, Any]] = {
        rule["id"]: rule for rule in documents if rule.get("id") in CORE_RULE_IDS
    }
    expectations: list[dict[str, Any]] = []
    warning_rule = next(
        (rule for rule in documents if rule.get("id") == "plan.warning_signs"),
        None,
    )
    allergy_rule = next(
        (rule for rule in documents if rule.get("id") == "subjective.allergies"),
        None,
    )
    differential_rule = next(
        (rule for rule in documents if rule.get("id") == "assessment.differential_diagnoses"),
        None,
    )

    for statement in ledger:
        if statement.get("superseded_by"):
            statement.setdefault("candidate_fields", [])
            continue
        ranked = sorted(
            ((rule, _rule_score(rule, statement)) for rule in documents if rule.get("id") not in CORE_RULE_IDS),
            key=lambda item: (-item[1], str(item[0].get("id"))),
        )
        matches = [(rule, score) for rule, score in ranked if score >= 2.5][:rules_per_statement]
        candidate_fields = list(dict.fromkeys(
            candidate
            for rule, _ in matches
            for candidate in _canonical_candidate_fields(rule["field"])
        ))

        # Warning instructions are safety-critical and must not disappear just
        # because three other documentation rules scored slightly higher. This
        # only adds the warning destination when the explicit doctor statement
        # itself matches the warning-sign rule; it never creates clinical text.
        warning_score = _rule_score(warning_rule, statement) if warning_rule else 0.0
        if warning_rule and warning_score >= 2.5:
            if "plan.warning_signs" not in candidate_fields:
                candidate_fields.append("plan.warning_signs")
            selected[warning_rule["id"]] = warning_rule

        # Explicit allergy statements and answers to allergy questions must
        # keep their destination even when other Subjective rules score in the
        # top-N. The statement remains the sole source of the clinical fact.
        allergy_score = _rule_score(allergy_rule, statement) if allergy_rule else 0.0
        if allergy_rule and allergy_score >= 2.5:
            if "subjective.allergies" not in candidate_fields:
                candidate_fields.append("subjective.allergies")
            selected[allergy_rule["id"]] = allergy_rule

        # Explicitly introduced diagnostic alternatives must survive the
        # top-N retrieval limit. This is grammatical routing only; condition
        # names still come exclusively from the doctor's exact statement.
        explicit_alternatives = bool(
            statement.get("speaker") == "doctor"
            and not statement.get("is_question")
            and (
                re.search(
                    r"\b(?:differential|versus|vs\.?|rule\s+out)\b",
                    str(statement.get("text") or ""),
                    re.IGNORECASE,
                )
                or (
                    re.search(
                        r"\b(?:diagnos\w*|impression|likely|probably|possibly|suspect\w*|"
                        r"could|might|may|maybe|possibilit\w*)\b",
                        str(statement.get("text") or ""),
                        re.IGNORECASE,
                    )
                    and re.search(
                        r"\b(?:such\s+as|including|for\s+example|like)\b",
                        str(statement.get("text") or ""),
                        re.IGNORECASE,
                    )
                )
            )
        )
        if differential_rule and explicit_alternatives:
            if "assessment.differential_diagnoses" not in candidate_fields:
                candidate_fields.append("assessment.differential_diagnoses")
            selected[differential_rule["id"]] = differential_rule

        statement["candidate_fields"] = candidate_fields
        for rule, _ in matches:
            selected[rule["id"]] = rule
        if matches and matches[0][1] >= 5.0 and matches[0][0].get("field") in COMPLETENESS_FIELDS:
            expectations.append({
                "evidence_id": statement["id"],
                "field": _canonical_candidate_fields(matches[0][0]["field"])[0],
                "score": round(matches[0][1], 2),
            })

    ordered_rules = [rule for rule in documents if rule.get("id") in selected]
    return {
        "knowledge_version": knowledge.get("version", "unknown"),
        "evidence": ledger,
        "rules": ordered_rules,
        "coverage_expectations": expectations,
    }


def _render_evidence_block(item: dict[str, Any]) -> str:
    """Render a single evidence statement with all available metadata."""
    lines = [f"[{item['id']}]"]
    seq = item.get("sequence_index")
    if seq is not None:
        lines.append(f"  sequence={item['sequence_index']}")
    lines.append(f"  speaker={item.get('speaker', 'unknown')}")
    label = item.get("speaker_label")
    if label:
        lines.append(f"  speaker_label={label}")
    src = item.get("source_type")
    if src and src != "unknown":
        lines.append(f"  source={src}")
    neg = item.get("negated")
    if neg is not None:
        lines.append(f"  negated={str(neg).lower()}")
    candidates = item.get("candidate_fields")
    if candidates:
        lines.append(f"  candidates={', '.join(candidates)}")
    med_action = item.get("medication_action")
    if med_action:
        lines.append(f"  medication_action={med_action}")
    superseded_by = item.get("superseded_by")
    if superseded_by:
        lines.append(f"  superseded_by={superseded_by}")
    ctx = item.get("context")
    if ctx:
        lines.append(f"  context={ctx}")
    lines.append(f"  exact_text={item.get('text', '')}")
    return "\n".join(lines)


def render_soap_rag_context(bundle: dict[str, Any]) -> str:
    evidence_lines = [_render_evidence_block(item) for item in bundle.get("evidence") or []]

    rule_blocks = []
    for rule in bundle.get("rules") or []:
        rule_blocks.append(
            "\n".join([
                f"RULE {rule['id']} -> {' or '.join(_canonical_candidate_fields(rule['field']))} ({rule['section']})",
                f"Meaning: {rule['purpose']}",
                f"Allowed speakers: {', '.join(rule.get('speaker') or [])}",
                f"Include: {'; '.join(rule.get('include') or [])}",
                f"Exclude: {'; '.join(rule.get('exclude') or [])}",
                f"Correct example: {'; '.join(rule.get('examples') or [])}",
                f"Incorrect example: {'; '.join(rule.get('counterexamples') or [])}",
            ])
        )

    return (
        f"SOAP KNOWLEDGE VERSION: {bundle.get('knowledge_version', 'unknown')}\n\n"
        "NUMBERED EVIDENCE LEDGER\n"
        + "\n".join(evidence_lines)
        + "\n\nRETRIEVED SOAP RULES\n"
        + "\n\n".join(rule_blocks)
    )


def render_compact_soap_rag_context(bundle: dict[str, Any]) -> str:
    """Render the same retrieved evidence/rules without repeated metadata.

    The full renderer remains available for review/debugging. The extraction
    prompt uses this compact representation because the transcript is already
    included separately; speaker labels, candidate destinations, medication
    actions, correction state, and exact evidence text are still preserved.
    """
    evidence_lines: list[str] = []
    for item in bundle.get("evidence") or []:
        # The full transcript is already present in the prompt. Keep only
        # evidence annotations that add routing/safety information instead of
        # duplicating every conversational filler statement.
        if not (
            item.get("candidate_fields")
            or item.get("negated")
            or item.get("medication_action")
            or item.get("superseded_by")
        ):
            continue
        parts = [f"[{item['id']}]", str(item.get("speaker", "unknown"))]
        candidates = item.get("candidate_fields") or []
        if candidates:
            parts.append("->" + ",".join(candidates))
        if item.get("negated"):
            parts.append("NEGATED")
        if item.get("medication_action"):
            parts.append("ACTION=" + str(item["medication_action"]))
        if item.get("superseded_by"):
            parts.append("SUPERSEDED_BY=" + str(item["superseded_by"]))
        parts.append("TEXT=" + str(item.get("text", "")))
        evidence_lines.append(" | ".join(parts))

    rule_lines: list[str] = []
    for rule in bundle.get("rules") or []:
        destinations = " or ".join(_canonical_candidate_fields(rule["field"]))
        rule_lines.append(
            f"{rule['id']} -> {destinations} | {rule['purpose']}"
        )

    return (
        f"SOAP KNOWLEDGE VERSION: {bundle.get('knowledge_version', 'unknown')}\n"
        "EVIDENCE LEDGER\n" + "\n".join(evidence_lines)
        + "\nRETRIEVED RULES\n" + "\n".join(rule_lines)
    )


SECTION_LABELS = {
    "subjective": "S",
    "objective": "O",
    "assessment": "A",
    "plan": "P",
}


def build_section_rag_bundle(bundle: dict[str, Any], section: str) -> dict[str, Any]:
    """Return a high-recall evidence/rule slice for one SOAP section.

    Candidate-field routing is used whenever available. Patient and caregiver
    assertions are also sent to Subjective, while non-question clinician
    assertions are sent to Assessment and Plan. Those fallbacks prevent a
    missed keyword match from dropping a clinical fact; the downstream
    evidence validator still decides whether a generated value is supported.
    """
    if section not in SECTION_LABELS:
        raise ValueError(f"Unsupported SOAP section: {section}")

    evidence: list[dict[str, Any]] = []
    prefix = f"{section}."
    for item in bundle.get("evidence") or []:
        candidates = [str(value) for value in item.get("candidate_fields") or []]
        routed = any(value.startswith(prefix) for value in candidates)
        speaker = item.get("speaker")
        is_question = bool(item.get("is_question"))
        source_type = item.get("source_type")

        high_recall_fallback = (
            section == "subjective" and speaker in {"patient", "caregiver"} and not is_question
        ) or (
            section in {"assessment", "plan"} and speaker == "doctor" and not is_question
        ) or (
            section == "objective" and source_type == "clinic_measurement"
        )
        if routed or high_recall_fallback:
            evidence.append(item)

    section_label = SECTION_LABELS[section]
    rules = [
        rule for rule in bundle.get("rules") or []
        if rule.get("section") in {"CORE", section_label}
    ]
    evidence_ids = {item.get("id") for item in evidence}
    expectations = [
        item for item in bundle.get("coverage_expectations") or []
        if str(item.get("field") or "").startswith(prefix)
        or item.get("evidence_id") in evidence_ids
    ]
    return {
        "knowledge_version": bundle.get("knowledge_version", "unknown"),
        "evidence": evidence,
        "rules": rules,
        "coverage_expectations": expectations,
    }


def render_section_soap_rag_context(bundle: dict[str, Any], section: str) -> str:
    """Render exact, section-routed evidence without repeating the transcript."""
    section_bundle = build_section_rag_bundle(bundle, section)
    evidence_lines = [_render_evidence_block(item) for item in section_bundle["evidence"]]
    rule_lines: list[str] = []
    for rule in section_bundle["rules"]:
        destinations = " or ".join(_canonical_candidate_fields(rule["field"]))
        rule_lines.append(
            f"{rule['id']} -> {destinations} | {rule['purpose']} | "
            f"Include: {'; '.join(rule.get('include') or [])} | "
            f"Exclude: {'; '.join(rule.get('exclude') or [])}"
        )
    return (
        f"SOAP KNOWLEDGE VERSION: {section_bundle['knowledge_version']}\n"
        f"TARGET SECTION: {section.upper()}\n"
        "EXACT ROUTED EVIDENCE\n" + ("\n".join(evidence_lines) or "(none)")
        + "\nSECTION RULES\n" + ("\n".join(rule_lines) or "(none)")
    )


def _nested_value(source: dict[str, Any], path: str) -> Any:
    current: Any = source
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _flatten_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        return " ".join(_flatten_text(item) for item in value.values())
    if isinstance(value, list):
        return " ".join(_flatten_text(item) for item in value)
    return str(value)


def _evidence_is_represented(evidence: str, field_value: Any) -> bool:
    evidence_tokens = _tokens(evidence)
    field_tokens = _tokens(_flatten_text(field_value))
    if not evidence_tokens or not field_tokens:
        return False
    evidence_numbers = {token for token in evidence_tokens if any(char.isdigit() for char in token)}
    if evidence_numbers and not evidence_numbers.issubset(field_tokens):
        return False
    return len(evidence_tokens & field_tokens) / len(evidence_tokens) >= 0.65


def build_completeness_review_flags(ehr: dict[str, Any], bundle: dict[str, Any], limit: int = 4) -> list[dict[str, Any]]:
    """Return a small set of high-confidence omission flags.

    These are workflow flags only. They never add a clinical fact to the SOAP
    record and are deliberately capped to avoid warning noise.

    Case 14: if the doctor prescribed a medicine but the SOAP accidentally omits
    it, this should flag the potential omission without mutating the SOAP record.
    """
    evidence_by_id = {item["id"]: item for item in bundle.get("evidence") or []}
    missing_by_field: dict[str, list[str]] = {}
    for expectation in bundle.get("coverage_expectations") or []:
        field = expectation.get("field")
        statement = evidence_by_id.get(expectation.get("evidence_id"))
        if not field or not statement:
            continue
        if statement.get("is_question") or statement.get("speaker") == "unknown":
            continue
        if statement.get("superseded_by"):
            continue
        evidence_text = str(statement.get("text") or "").strip()
        if evidence_text and not _evidence_is_represented(evidence_text, _nested_value(ehr, field)):
            missing_by_field.setdefault(field, []).append(f"[{statement['id']}] {evidence_text}")

    flags: list[dict[str, Any]] = []
    for field, evidence_items in missing_by_field.items():
        flags.append({
            "field": field,
            "field_label": field.replace("_", " ").replace(".", " > ").title(),
            "reason": "Potentially omitted explicit transcript information",
            "evidence": " | ".join(evidence_items[:2]),
            "needs_doctor_review": True,
        })
        if len(flags) >= max(1, limit):
            break
    return flags


def parse_warning_sign(text: str) -> dict[str, str]:
    """Parse a warning sign into condition, action, and urgency components.

    Preserves both the condition to watch for and the action to take.
    Falls back gracefully when structure is not recognized.
    """
    lower = text.lower()
    import re as _re

    urgency = "not_specified"
    for marker in ("immediately", "urgent", "emergency", "turant"):
        if marker in lower:
            urgency = "immediate"
            break
    if urgency == "not_specified":
        for marker in ("as soon as possible", "at once", "jaldi"):
            if marker in lower:
                urgency = "urgent"
                break

    if_condition = _re.search(
        r"(?:^|\.\s*)(?:if|should you|in case of|upon)\s+(.+?)(?:,|\s+(?:then\s+)?(?:go\s+to|seek|call|visit|consult|contact|return|come|approach))",
        text, _re.IGNORECASE,
    )
    if if_condition:
        condition = if_condition.group(1).strip()
        action_start = if_condition.end()
        action = text[action_start:].strip().rstrip(". ")
        if action:
            return {
                "condition": condition[:1].upper() + condition[1:] if condition else condition,
                "action": action[:1].upper() + action[1:] if action else action,
                "urgency": urgency,
            }

    colon_idx = text.find(":")
    if 5 < colon_idx < 100:
        return {
            "condition": text[:colon_idx].strip(),
            "action": text[colon_idx + 1:].strip().rstrip(".").strip(),
            "urgency": urgency,
        }

    action_markers = [
        (r"\b(go\s+to\s+(?:the\s+)?(?:hospital|doctor|clinic|emergency))", "Go to hospital"),
        (r"\b(seek\s+(?:medical\s+)?(?:help|care|attention))", "Seek medical care"),
        (r"\b(call\s+(?:the\s+)?(?:doctor|ambulance|\d+))", "Call for help"),
        (r"\b(visit\s+(?:the\s+)?(?:doctor|hospital|clinic))", "Visit doctor"),
    ]
    for pattern, default_action in action_markers:
        m = _re.search(pattern, text, _re.IGNORECASE)
        if m:
            condition_part = _re.split(pattern, text, 1, _re.IGNORECASE)[0].strip()
            condition_part = _re.sub(r"^(?:if\s+|should\s+you\s+|upon\s+)", "", condition_part, flags=_re.IGNORECASE).strip()
            if condition_part:
                return {
                    "condition": condition_part[:1].upper() + condition_part[1:] if condition_part else condition_part,
                    "action": m.group(1)[:1].upper() + m.group(1)[1:],
                    "urgency": urgency,
                }

    return {
        "condition": text,
        "action": "See a doctor",
        "urgency": urgency,
    }
