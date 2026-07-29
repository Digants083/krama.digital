"""Programmatic patient summary builder derived from structured SOAP.

This module transforms a final structured SOAP record into a brief,
patient-friendly summary. It NEVER independently reinterprets the
raw transcript and NEVER introduces new clinical facts.

The SOAP record is the sole clinical source of truth for summary generation.
"""

from __future__ import annotations

from typing import Any, Optional


PATIENT_SECTION_ORDER = [
    "visit_summary",
    "medicines",
    "tests",
    "procedures",
    "diet_and_care",
    "monitoring",
    "referrals",
    "other_instructions",
    "when_to_seek_help",
    "follow_up",
]


def build_patient_summary(soap: dict[str, Any]) -> dict[str, Any]:
    """Build a patient summary from a structured SOAP record.

    Returns a dict with only the sections that have relevant data.
    Empty sections are omitted.
    """
    summary: dict[str, Any] = {}

    visit = _build_visit_summary(soap)
    if visit is not None:
        summary["visit_summary"] = visit

    medicines = _build_medicines(soap)
    if medicines:
        summary["medicines"] = medicines

    tests = _build_tests(soap)
    if tests:
        summary["tests"] = tests

    procedures = _build_plan_list(soap, "procedures")
    if procedures:
        summary["procedures"] = procedures

    diet = _build_diet_and_care(soap)
    if diet:
        summary["diet_and_care"] = diet

    monitoring = _build_monitoring(soap)
    if monitoring:
        summary["monitoring"] = monitoring

    referrals = _build_plan_list(soap, "referrals")
    if referrals:
        summary["referrals"] = referrals

    other_instructions = _build_plan_list(soap, "other_instructions")
    if other_instructions:
        summary["other_instructions"] = other_instructions

    warnings = _build_warning_signs(soap)
    if warnings:
        summary["when_to_seek_help"] = warnings

    follow_up = _build_follow_up(soap)
    if follow_up is not None:
        summary["follow_up"] = follow_up

    return summary


def _build_visit_summary(soap: dict[str, Any]) -> Optional[str]:
    """Build a brief visit summary from the Assessment section.

    Supports both old format (confirmed_diagnoses, provisional_diagnoses,
    clinical_impression as string lists) and new format (diagnoses array
    of objects with name/status, clinical_impression as string).

    Priority order:
      1. confirmed diagnoses
      2. provisional diagnoses
      3. clinical impression

    Differential diagnoses are excluded — they are clinician-facing and
    not appropriate for patient-directed summaries by default.

    Deduplicates near-identical entries. If Assessment is empty,
    return None — do not invent a diagnosis.
    """
    assessment = soap.get("assessment") or {}
    seen_lower: set[str] = set()
    ordered: list[str] = []

    diagnoses = assessment.get("diagnoses")
    if isinstance(diagnoses, list):
        status_priority = {"confirmed": 0, "provisional": 1}
        entries = []
        for d in diagnoses:
            if not isinstance(d, dict):
                continue
            name = _clean_str(d.get("name"))
            status = d.get("status")
            if name and status not in ("differential",):
                entries.append((status_priority.get(status, 99), name))
        entries.sort(key=lambda x: x[0])
        selected_priority = entries[0][0] if entries else None
        for priority, name in entries:
            if priority != selected_priority:
                continue
            lower = name.lower().rstrip(".")
            if lower not in seen_lower:
                seen_lower.add(lower)
                ordered.append(name)
        ci = assessment.get("clinical_impression")
        if not ordered and isinstance(ci, str):
            ci_text = _clean_str(ci)
            if ci_text and ci_text.lower().rstrip(".") not in seen_lower:
                ordered.append(ci_text)
    else:
        for key in ("confirmed_diagnosis", "confirmed_diagnoses", "provisional_diagnosis", "provisional_diagnoses"):
            items = assessment.get(key)
            if not isinstance(items, list):
                continue
            for item in items:
                text = _clean_str(item)
                if not text:
                    continue
                lower = text.lower().rstrip(".")
                if lower not in seen_lower:
                    seen_lower.add(lower)
                    ordered.append(text)
            if ordered:
                break
        raw_ci = assessment.get("clinical_impression")
        if isinstance(raw_ci, list):
            ci_text = _clean_str(raw_ci[0]) if raw_ci else None
        else:
            ci_text = _clean_str(raw_ci)
        if not ordered and ci_text and ci_text.lower().rstrip(".") not in seen_lower:
            ordered.append(ci_text)

    if not ordered:
        return None

    return "; ".join(ordered)


def _build_medicines(soap: dict[str, Any]) -> list[dict[str, Any]]:
    """Build patient-friendly medicine list from Plan prescriptions or medications.

    Supports both old format (plan.prescriptions array) and new format
    (plan.medications array). New format keys: name, strength, dose, route,
    frequency, timing, duration, instructions.
    """
    plan = soap.get("plan") or {}

    medications = plan.get("medications")
    if isinstance(medications, list):
        result = []
        for med in medications:
            if not isinstance(med, dict):
                continue
            name = _clean_str(med.get("name"))
            if not name:
                continue
            entry = {"medicine_name": name}
            strength = _clean_str(med.get("strength"))
            if strength:
                entry["strength"] = strength
            dosage_form = _clean_str(med.get("dosage_form"))
            if dosage_form:
                entry["dosage_form"] = dosage_form
            dose = _clean_str(med.get("dose"))
            if dose:
                entry["dose"] = dose
            route = _clean_str(med.get("route"))
            if route:
                entry["route"] = route
            frequency = _clean_str(med.get("frequency"))
            if frequency:
                entry["frequency"] = frequency
            timing = _clean_str(med.get("timing"))
            if timing:
                entry["specific_timing"] = timing
            duration = _clean_str(med.get("duration"))
            if duration:
                entry["duration"] = duration
            result.append(entry)
        return result

    prescriptions = plan.get("prescriptions")
    if not isinstance(prescriptions, list):
        return []

    result = []
    for rx in prescriptions:
        if not isinstance(rx, dict):
            continue
        name = _clean_str(rx.get("medicine_name"))
        if not name:
            continue
        entry = {"medicine_name": name}
        strength = _clean_str(rx.get("strength"))
        if strength:
            entry["strength"] = strength
        dosage_form = _clean_str(rx.get("dosage_form"))
        if dosage_form:
            entry["dosage_form"] = dosage_form
        dose = _clean_str(rx.get("dose"))
        if dose:
            entry["dose"] = dose
        route = _clean_str(rx.get("route"))
        if route:
            entry["route"] = route
        frequency = _clean_str(rx.get("frequency"))
        if frequency:
            entry["frequency"] = frequency
        specific_timing = _clean_str(rx.get("specific_timing"))
        if specific_timing:
            entry["specific_timing"] = specific_timing
        meal_timing = _clean_str(rx.get("meal_timing"))
        if meal_timing:
            entry["meal_timing"] = meal_timing
        schedule = rx.get("schedule")
        if isinstance(schedule, dict):
            clean_schedule = {period: text for period in ("morning", "afternoon", "night") if (text := _clean_str(schedule.get(period)))}
            if clean_schedule:
                entry["schedule"] = clean_schedule
        duration = _clean_str(rx.get("duration"))
        if duration:
            entry["duration"] = duration
        as_needed = rx.get("as_needed")
        if as_needed is True:
            entry["prn_condition"] = _clean_str(rx.get("indication")) or "as needed"
        prn_condition = _clean_str(rx.get("prn_condition"))
        if prn_condition:
            entry["prn_condition"] = prn_condition
        action = _clean_str(rx.get("action"))
        if action:
            entry["action"] = action
        indication = _clean_str(rx.get("indication"))
        if indication:
            entry["indication"] = indication
        result.append(entry)

    return result


def _build_tests(soap: dict[str, Any]) -> list[str]:
    """Build list of tests ordered by the doctor.

    Supports new format (plan.investigations_ordered) first,
    falls back to old format (plan.tests_ordered).
    """
    plan = soap.get("plan") or {}
    tests = plan.get("investigations_ordered")
    if isinstance(tests, list):
        return [str(t) for t in tests if t]
    tests = plan.get("tests_ordered")
    if isinstance(tests, list):
        return [str(t) for t in tests if t]
    return []


def _build_plan_list(soap: dict[str, Any], field: str) -> list[str]:
    """Copy an explicitly documented patient-facing Plan list without rewriting it."""
    plan = soap.get("plan") or {}
    raw = plan.get(field)
    if not isinstance(raw, list):
        return []
    result: list[str] = []
    for item in raw:
        text = _clean_str(item)
        if text and text not in result:
            result.append(text)
    return result


def _build_diet_and_care(soap: dict[str, Any]) -> list[str]:
    """Combine patient-friendly diet and care advice from Plan.

    Supports new format (plan.advice single array) first,
    falls back to old format (plan.treatment_advice + plan.diet_and_hydration_advice).
    """
    plan = soap.get("plan") or {}

    advice = plan.get("advice")
    if isinstance(advice, list):
        items = []
        for item in advice:
            text = _clean_str(item)
            if text and text not in items:
                items.append(text)
        return items

    items = []
    for key in ("treatment_advice", "diet_lifestyle_advice", "diet_and_hydration_advice"):
        raw = plan.get(key)
        if isinstance(raw, list):
            for item in raw:
                text = _clean_str(item)
                if text and text not in items:
                    items.append(text)

    return items


def _build_monitoring(soap: dict[str, Any]) -> list[str]:
    """Build list of monitoring instructions from Plan.monitoring.

    Trusts the structured SOAP classification directly. The SOAP layer has
    already routed the content to plan.monitoring; no keyword reclassification
    or secondary clinical routing is performed here.

    Allowed:
    - remove empty entries
    - trim whitespace
    - normalize list structure
    - preserve existing instructions

    Not allowed:
    - add monitoring frequency
    - invent thresholds
    - add medical interpretation
    - create new monitoring recommendations
    """
    plan = soap.get("plan") or {}
    raw = plan.get("monitoring")
    if not isinstance(raw, list):
        return []

    items: list[str] = []
    for item in raw:
        text = _clean_str(item)
        if text and text not in items:
            items.append(text)

    return items


def _build_warning_signs(soap: dict[str, Any]) -> list[dict[str, str]]:
    """Build list of warning signs preserving condition, action, and urgency.

    Each entry preserves:
    - condition (what to watch for)
    - action (what to do)
    - urgency (when stated)

    The instructed action must be retained — never reduce to just the condition.
    """
    plan = soap.get("plan") or {}
    raw_warnings = plan.get("warning_signs")
    if not isinstance(raw_warnings, list):
        return []

    result: list[dict[str, str]] = []
    for item in raw_warnings:
        text = _clean_str(item)
        if not text:
            continue

        entry = _parse_warning_sign(text)
        if entry:
            result.append(entry)

    return result


def _parse_warning_sign(text: str) -> dict[str, Any]:
    """Parse a warning sign text into {condition, action, urgency, raw_instruction}.

    When the instruction clearly contains both condition and actionable
    instruction, the parsed components are returned separately.

    If the warning cannot be confidently split, the original source text is
    preserved in raw_instruction.  The system NEVER invents an action such
    as "See a doctor" — the patient summary must remain faithful to the
    doctor's actual documented instruction.
    """
    lower = text.lower()

    urgency: Optional[str] = None
    for marker in ("immediately", "urgent", "emergency", "today", "turant"):
        if marker in lower:
            urgency = "immediate"
            break
    if urgency is None:
        for marker in ("as soon as possible", "at once", "jaldi"):
            if marker in lower:
                urgency = "urgent"
                break

    import re

    if_match = re.search(
        r"^(?:if|should\s+(?:you\s+)?|in\s+case\s+of)\s+(.+?)(?:,\s*|\s+(?:then\s+)?)(go\s+to|seek|call|visit|consult|contact|return|come|approach|report)\s+(.+)",
        text, re.IGNORECASE | re.DOTALL,
    )
    if if_match:
        condition = if_match.group(1).strip().rstrip(",")
        action_verb = if_match.group(2)
        action_rest = if_match.group(3).strip().rstrip(".")
        return {
            "condition": condition[:1].upper() + condition[1:] if condition else condition,
            "action": (action_verb + " " + action_rest)[:1].upper() + (action_verb + " " + action_rest)[1:],
            "urgency": urgency,
            "raw_instruction": text,
        }

    if urgency and any(marker in lower for marker in ("go to", "seek", "call", "visit", "contact")):
        colon_idx = text.find(":")
        if colon_idx > 0 and colon_idx < 60:
            return {
                "condition": text[:colon_idx].strip(),
                "action": _first_upper(text[colon_idx + 1:].strip()),
                "urgency": urgency,
                "raw_instruction": text,
            }

    return {
        "condition": None,
        "action": None,
        "urgency": None,
        "raw_instruction": text,
    }


def _build_follow_up(soap: dict[str, Any]) -> Optional[str]:
    """Extract follow-up instruction from Plan.

    Supports new format (dict with timeframe/instructions) and old format (string).
    """
    plan = soap.get("plan") or {}
    fu = plan.get("follow_up")
    if isinstance(fu, dict):
        instructions = _clean_str(fu.get("instructions"))
        if instructions:
            return instructions
        timeframe = _clean_str(fu.get("timeframe"))
        if timeframe:
            return timeframe
        return None
    return _clean_str(fu)


def _clean_str(value: Any) -> Optional[str]:
    """Clean and validate a string value."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"null", "none", "unknown", "not provided", "not mentioned", "n/a", ""}:
        return None
    return text


def _first_upper(text: str) -> str:
    """Capitalize first character of a string."""
    if not text:
        return text
    return text[0].upper() + text[1:]
