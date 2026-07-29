import asyncio
import json
import logging
import math
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import (
    ehr_context_window_tokens,
    ehr_generation_timeout_seconds,
    ehr_initial_output_tokens,
    ehr_max_output_tokens,
    ehr_model_name,
    ollama_base_url,
)
from app.database.db import get_db
from app.database.models import (
    Appointment,
    Clinic,
    ClinicalEncounter,
    Doctor,
    EhrAuditEvent,
    Patient,
)
from app.services.patient_summary import build_patient_summary as _build_patient_summary
from app.services.speaker_correction import infer_consultation_speaker_roles
from app.services.soap_rag import (
    build_completeness_review_flags,
    build_section_rag_bundle,
    render_section_soap_rag_context,
    retrieve_soap_context,
)


logger = logging.getLogger("krama.ehr")


router = APIRouter(prefix="/ehr", tags=["ehr"])


class TranscriptSegment(BaseModel):
    speaker: str = "Speaker"
    start: float = 0
    end: float = 0
    text: str
    original_transcript: Optional[str] = None
    detected_language: Optional[str] = None
    normalized_transcript: Optional[str] = None
    confidence: Optional[float] = None
    corrections: list[dict] = Field(default_factory=list)
    critical_entities: list[dict] = Field(default_factory=list)
    flags: list[dict] = Field(default_factory=list)
    second_pass_transcript: Optional[str] = None
    second_pass_original: Optional[str] = None
    review_status: Optional[str] = None


class GenerateEhrDraftRequest(BaseModel):
    clinic_id: str
    patient_id: str
    patient_name: str
    patient_phone: Optional[str] = None
    patient_email: Optional[str] = None
    doctor_id: Optional[str] = None
    appointment_id: Optional[int] = None
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
    speaker_map: Optional[dict[str, str]] = None


class UpdateEhrDraftRequest(BaseModel):
    ehr_data: dict[str, Any]
    patient_summary: dict[str, Any]
    actor_id: Optional[str] = None


class ApproveEhrRequest(BaseModel):
    approved_by: str


SOAP_SCHEMA_VERSION = "1.2"
SOAP_SCHEMA_VERSIONS = {"1.0", "1.1", "1.2"}

SOAP_EHR_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["ehr"],
    "properties": {
        "ehr": {
            "type": "object",
            "additionalProperties": False,
            "required": ["subjective", "objective", "assessment", "plan"],
            "properties": {
                "subjective": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["chief_complaints", "history_of_present_illness", "relevant_negatives", "medical_conditions", "allergies", "current_medications", "family_history", "social_history"],
                    "properties": {
                        "chief_complaints": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["complaint", "severity", "course", "duration"],
                                "properties": {
                                    "complaint": {"type": "string"},
                                    "severity": {"type": ["string", "null"]},
                                    "course": {"type": ["string", "null"]},
                                    "duration": {"type": ["string", "null"]}
                                }
                            }
                        },
                        "history_of_present_illness": {"type": ["string", "null"]},
                        "relevant_negatives": {"type": "array", "items": {"type": "string"}},
                        "medical_conditions": {"type": "array", "items": {"type": "string"}},
                        "allergies": {"type": "array", "items": {"type": "string"}},
                        "family_history": {"type": "array", "items": {"type": "string"}},
                        "social_history": {"type": "array", "items": {"type": "string"}},
                        "current_medications": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "strength", "dose", "frequency", "timing", "duration", "source"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "strength": {"type": ["string", "null"]},
                                    "dose": {"type": ["string", "null"]},
                                    "frequency": {"type": ["string", "null"]},
                                    "timing": {"type": ["string", "null"]},
                                    "duration": {"type": ["string", "null"]},
                                    "source": {"type": "string", "enum": ["patient_reported", "prescribed"]}
                                }
                            }
                        }
                    }
                },
                "objective": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["vitals", "physical_examination", "investigations"],
                    "properties": {
                        "vitals": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["temperature", "blood_pressure", "pulse", "respiratory_rate", "spo2", "weight", "height", "bmi"],
                            "properties": {
                                "temperature": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": ["value", "unit", "source"],
                                    "properties": {
                                        "value": {"type": ["number", "null"]},
                                        "unit": {"type": ["string", "null"]},
                                        "source": {"type": ["string", "null"]}
                                    }
                                },
                                "blood_pressure": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": ["systolic", "diastolic", "unit", "source"],
                                    "properties": {
                                        "systolic": {"type": ["number", "null"]},
                                        "diastolic": {"type": ["number", "null"]},
                                        "unit": {"type": "string"},
                                        "source": {"type": ["string", "null"]}
                                    }
                                },
                                "pulse": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": ["value", "unit", "source"],
                                    "properties": {
                                        "value": {"type": ["number", "null"]},
                                        "unit": {"type": "string"},
                                        "source": {"type": ["string", "null"]}
                                    }
                                },
                                "respiratory_rate": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": ["value", "unit", "source"],
                                    "properties": {
                                        "value": {"type": ["number", "null"]},
                                        "unit": {"type": "string"},
                                        "source": {"type": ["string", "null"]}
                                    }
                                },
                                "spo2": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": ["value", "unit", "source"],
                                    "properties": {
                                        "value": {"type": ["number", "null"]},
                                        "unit": {"type": "string"},
                                        "source": {"type": ["string", "null"]}
                                    }
                                },
                                "weight": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": ["value", "unit", "source"],
                                    "properties": {
                                        "value": {"type": ["number", "null"]},
                                        "unit": {"type": ["string", "null"]},
                                        "source": {"type": ["string", "null"]}
                                    }
                                },
                                "height": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": ["value", "unit", "source"],
                                    "properties": {
                                        "value": {"type": ["number", "null"]},
                                        "unit": {"type": ["string", "null"]},
                                        "source": {"type": ["string", "null"]}
                                    }
                                },
                                "bmi": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": ["value", "source"],
                                    "properties": {
                                        "value": {"type": ["number", "null"]},
                                        "source": {"type": ["string", "null"]}
                                    }
                                }
                            }
                        },
                        "physical_examination": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["general", "respiratory", "cardiovascular", "ent", "abdomen", "neurological", "other"],
                            "properties": {
                                "general": {"type": ["string", "null"]},
                                "respiratory": {"type": ["string", "null"]},
                                "cardiovascular": {"type": ["string", "null"]},
                                "ent": {"type": ["string", "null"]},
                                "abdomen": {"type": ["string", "null"]},
                                "neurological": {"type": ["string", "null"]},
                                "other": {"type": "array", "items": {"type": "string"}}
                            }
                        },
                        "investigations": {"type": "array", "items": {"type": "string"}}
                    }
                },
                "assessment": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["clinical_impression", "provisional_diagnosis", "confirmed_diagnosis", "differential_diagnoses", "problems_being_managed"],
                    "properties": {
                        "clinical_impression": {"type": ["string", "null"]},
                        "provisional_diagnosis": {"type": "array", "items": {"type": "string"}},
                        "confirmed_diagnosis": {"type": "array", "items": {"type": "string"}},
                        "differential_diagnoses": {"type": "array", "items": {"type": "string"}},
                        "problems_being_managed": {"type": "array", "items": {"type": "string"}}
                    }
                },
                "plan": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["prescriptions", "tests_ordered", "procedures", "treatment_advice", "diet_lifestyle_advice", "monitoring", "referrals", "follow_up", "warning_signs", "other_instructions"],
                    "properties": {
                        "prescriptions": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["medicine_name", "strength", "dosage_form", "dose", "route", "frequency", "schedule", "specific_timing", "meal_timing", "duration", "prn_condition", "indication", "instructions", "action"],
                                "properties": {
                                    "medicine_name": {"type": "string"},
                                    "strength": {"type": ["string", "null"]},
                                    "dosage_form": {"type": ["string", "null"]},
                                    "dose": {"type": ["string", "null"]},
                                    "route": {"type": ["string", "null"]},
                                    "frequency": {"type": ["string", "null"]},
                                    "schedule": {
                                        "type": "object",
                                        "additionalProperties": False,
                                        "properties": {
                                            "morning": {"type": ["string", "null"]},
                                            "afternoon": {"type": ["string", "null"]},
                                            "night": {"type": ["string", "null"]}
                                        }
                                    },
                                    "specific_timing": {"type": ["string", "null"]},
                                    "meal_timing": {"type": ["string", "null"]},
                                    "duration": {"type": ["string", "null"]},
                                    "prn_condition": {"type": ["string", "null"]},
                                    "indication": {"type": ["string", "null"]},
                                    "instructions": {"type": ["string", "null"]},
                                    "action": {"type": ["string", "null"], "enum": ["START", "CONTINUE", "CHANGE", "STOP", "PRN", None]}
                                }
                            }
                        },
                        "tests_ordered": {"type": "array", "items": {"type": "string"}},
                        "procedures": {"type": "array", "items": {"type": "string"}},
                        "treatment_advice": {"type": "array", "items": {"type": "string"}},
                        "diet_lifestyle_advice": {"type": "array", "items": {"type": "string"}},
                        "monitoring": {"type": "array", "items": {"type": "string"}},
                        "referrals": {"type": "array", "items": {"type": "string"}},
                        "follow_up": {"type": ["string", "null"]},
                        "warning_signs": {"type": "array", "items": {"type": "string"}},
                        "other_instructions": {"type": "array", "items": {"type": "string"}}
                    }
                }
            }
        }
    }
}


def _clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if text.lower() in {"null", "none", "unknown", "not provided", "not mentioned", "n/a"}:
        return None
    return text or None


def _clean_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    cleaned = []
    for item in value:
        text = _clean_text(item)
        if text and text not in cleaned:
            cleaned.append(text)
    return cleaned


def _clean_optional_vital(value: Any, default: Any = None) -> Any:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return value
    text = str(value).strip().lower()
    if text in {"null", "none", "unknown", "n/a", ""}:
        return default
    try:
        return float(value) if "." in str(value) else int(value)
    except (ValueError, TypeError):
        return default


def _normalize_vital(vital: Any, default_unit: Optional[str] = None) -> dict[str, Any]:
    if not vital or not isinstance(vital, dict):
        return {"value": None, "unit": default_unit, "source": None}
    return {
        "value": _clean_optional_vital(vital.get("value")),
        "unit": _clean_text(vital.get("unit")) or default_unit,
        "source": _clean_text(vital.get("source")),
    }


def _normalize_chief_complaints(value: Any, legacy_symptoms: Any = None) -> list[dict[str, Any]]:
    values = value if isinstance(value, list) else []
    if isinstance(legacy_symptoms, list):
        values = [*values, *legacy_symptoms]
    result = []
    for item in values:
        if isinstance(item, dict):
            complaint = _clean_text(item.get("complaint") or item.get("name") or item.get("symptom"))
            if not complaint:
                continue
            severity = _clean_text(item.get("severity"))
            course = _clean_text(item.get("course")) or _clean_text(item.get("frequency")) or _clean_text(item.get("character")) or _clean_text(item.get("progression"))
            if severity:
                severity_key = severity.casefold()
                severity = {
                    "slight": "mild", "slightly": "mild", "minor": "mild",
                    "serious": "severe", "very bad": "severe",
                }.get(severity_key, severity_key if severity_key in {"mild", "moderate", "severe"} else severity)
            if course:
                course_key = course.casefold()
                course = {
                    "fluctuating": "intermittent", "comes and goes": "intermittent",
                    "on and off": "intermittent", "constant": "continuous",
                    "persistent": "continuous", "getting worse": "worsening",
                    "getting better": "improving",
                }.get(course_key, course_key if course_key in {"continuous", "intermittent", "recurrent", "worsening", "improving", "stable"} else course)
            entry = {
                "complaint": complaint,
                "severity": severity,
                "course": course,
                "duration": _clean_text(item.get("duration")),
            }
        elif isinstance(item, str):
            text = _clean_text(item)
            if not text:
                continue
            entry = {"complaint": text, "severity": None, "course": None, "duration": None}
        else:
            continue
        existing = next((item for item in result if item["complaint"].casefold() == entry["complaint"].casefold()), None)
        if existing:
            for field in ("severity", "course", "duration"):
                if not existing.get(field) and entry.get(field):
                    existing[field] = entry[field]
        else:
            result.append(entry)
    return result


def _normalize_current_medications(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if isinstance(item, dict):
            name = _clean_text(item.get("name"))
            if not name:
                continue
            med = {
                "name": name,
                "strength": _clean_text(item.get("strength")),
                "dose": _clean_text(item.get("dose")),
                "frequency": _clean_text(item.get("frequency")),
                "timing": _clean_text(item.get("timing")),
                "duration": _clean_text(item.get("duration")),
                "source": _clean_text(item.get("source")) or "patient_reported",
            }
        elif isinstance(item, str):
            text = _clean_text(item)
            if not text:
                continue
            med = {
                "name": text,
                "strength": None,
                "dose": None,
                "frequency": None,
                "timing": None,
                "duration": None,
                "source": "patient_reported",
            }
        else:
            continue
        if med["name"] not in [m["name"] for m in result]:
            result.append(med)
    return result


def _normalize_diagnoses(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = _clean_text(item.get("name"))
        if not name:
            continue
        status = item.get("status", "provisional")
        if status not in ("confirmed", "provisional", "differential"):
            status = "provisional"
        diag = {
            "name": name,
            "status": status,
            "code": _clean_text(item.get("code")),
            "source": _clean_text(item.get("source")) or "clinician_documented",
        }
        if diag["name"] not in [d["name"] for d in result]:
            result.append(diag)
    return result


def _normalize_medications(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = _clean_text(item.get("name"))
        if not name:
            continue
        med = {
            "name": name,
            "strength": _clean_text(item.get("strength")),
            "dose": _clean_text(item.get("dose")),
            "route": _clean_text(item.get("route")),
            "frequency": _clean_text(item.get("frequency")),
            "timing": _clean_text(item.get("timing")),
            "duration": _clean_text(item.get("duration")),
            "instructions": _clean_text(item.get("instructions")),
        }
        if med["name"] not in [m["name"] for m in result]:
            result.append(med)
    return result


def _normalize_follow_up(value: Any) -> dict[str, Any]:
    if not value or not isinstance(value, dict):
        return {"required": False, "timeframe": None, "instructions": None}
    return {
        "required": bool(value.get("required", False)),
        "timeframe": _clean_text(value.get("timeframe")),
        "instructions": _clean_text(value.get("instructions")),
    }


def _normalize_referral(value: Any) -> dict[str, Any]:
    if not value or not isinstance(value, dict):
        return {"required": False, "specialty": None, "reason": None}
    return {
        "required": bool(value.get("required", False)),
        "specialty": _clean_text(value.get("specialty")),
        "reason": _clean_text(value.get("reason")),
    }


def _normalize_physical_examination(value: Any) -> dict[str, Any]:
    empty = {"general": None, "respiratory": None, "cardiovascular": None, "ent": None, "abdomen": None, "neurological": None, "other": []}
    if not value or not isinstance(value, dict):
        return empty
    result = {}
    for field in ("general", "respiratory", "cardiovascular", "ent", "abdomen", "neurological"):
        result[field] = _clean_text(value.get(field))
    other = value.get("other")
    if isinstance(other, list):
        result["other"] = _clean_list(other)
    else:
        result["other"] = []
    return result


def _migrate_old_assessment_to_new(ass: dict[str, Any]) -> dict[str, Any]:
    new_ass = {
        "clinical_impression": None,
        "provisional_diagnosis": [],
        "confirmed_diagnosis": [],
        "differential_diagnoses": [],
        "problems_being_managed": [],
    }

    diagnoses = ass.get("diagnoses")
    if isinstance(diagnoses, list):
        confirmed = []
        provisional = []
        differential = []
        for d in diagnoses:
            if isinstance(d, dict):
                name = _clean_text(d.get("name"))
                if name:
                    status = d.get("status")
                    if status == "confirmed":
                        confirmed.append(name)
                    elif status == "differential":
                        differential.append(name)
                    else:
                        provisional.append(name)
        new_ass["confirmed_diagnosis"] = confirmed
        new_ass["provisional_diagnosis"] = provisional
        new_ass["differential_diagnoses"] = differential

    if not new_ass["confirmed_diagnosis"]:
        new_ass["confirmed_diagnosis"] = _clean_list(ass.get("confirmed_diagnoses"))
    if not new_ass["provisional_diagnosis"]:
        new_ass["provisional_diagnosis"] = _clean_list(ass.get("provisional_diagnoses"))
    if not new_ass["differential_diagnoses"]:
        new_ass["differential_diagnoses"] = _clean_list(ass.get("differential_diagnoses"))

    pbm = ass.get("problems_being_managed")
    if pbm:
        new_ass["problems_being_managed"] = _clean_list(pbm)

    ci = ass.get("clinical_impression")
    if isinstance(ci, list) and ci:
        new_ass["clinical_impression"] = _clean_text(ci[0]) if isinstance(ci[0], str) else None
    elif isinstance(ci, str):
        new_ass["clinical_impression"] = _clean_text(ci)

    return new_ass


def _migrate_old_plan_to_new(plan: dict[str, Any]) -> dict[str, Any]:
    new_prescriptions = []
    meds = plan.get("medications")
    if isinstance(meds, list):
        for med in meds:
            if not isinstance(med, dict):
                continue
            name = _clean_text(med.get("name"))
            if not name:
                continue
            new_prescriptions.append({
                "medicine_name": name,
                "strength": _clean_text(med.get("strength")),
                "dosage_form": None,
                "dose": _clean_text(med.get("dose")),
                "route": _clean_text(med.get("route")),
                "frequency": _clean_text(med.get("frequency")),
                "schedule": {"morning": None, "afternoon": None, "night": None},
                "specific_timing": _clean_text(med.get("timing")),
                "meal_timing": None,
                "duration": _clean_text(med.get("duration")),
                "prn_condition": None,
                "indication": None,
                "instructions": _clean_text(med.get("instructions")),
                "action": "START",
            })
    if not new_prescriptions:
        new_prescriptions = _normalize_prescriptions(plan.get("prescriptions"))

    old_fu = plan.get("follow_up")
    if isinstance(old_fu, dict):
        fu_text = _clean_text(old_fu.get("timeframe")) or _clean_text(old_fu.get("instructions"))
    elif isinstance(old_fu, str):
        fu_text = _clean_text(old_fu)
    else:
        fu_text = None

    old_refs = _clean_list(plan.get("referrals")) or _clean_list(plan.get("referral"))
    if not old_refs:
        old_ref = plan.get("referral")
        if isinstance(old_ref, dict):
            specialty = _clean_text(old_ref.get("specialty"))
            if specialty:
                old_refs = [specialty]

    old_advice = _clean_list(plan.get("advice"))
    old_treatment = _clean_list(plan.get("treatment_advice"))
    combined_advice = old_treatment or old_advice

    new_plan = {
        "prescriptions": new_prescriptions,
        "tests_ordered": _clean_list(plan.get("tests_ordered")) or _clean_list(plan.get("investigations_ordered")),
        "procedures": _clean_list(plan.get("procedures")),
        "treatment_advice": combined_advice,
        "diet_lifestyle_advice": _clean_list(plan.get("diet_lifestyle_advice")),
        "monitoring": _clean_list(plan.get("monitoring")),
        "referrals": old_refs,
        "follow_up": fu_text,
        "warning_signs": _clean_list(plan.get("warning_signs")),
        "other_instructions": _clean_list(plan.get("other_instructions")),
    }
    return new_plan


def _migrate_old_soap_to_new(source: dict[str, Any]) -> dict[str, Any]:
    sub = source.get("subjective") or {}
    obj = source.get("objective") or {}
    ass = source.get("assessment") or {}
    plan = source.get("plan") or {}

    new_sub = {
        "chief_complaints": _normalize_chief_complaints(sub.get("chief_complaints"), sub.get("symptoms")),
        "history_of_present_illness": _clean_text(sub.get("history_of_present_illness")),
        "relevant_negatives": _clean_list(sub.get("relevant_negatives")),
        "medical_conditions": _clean_list(sub.get("medical_conditions")),
        "allergies": _clean_list(sub.get("allergies")),
        "family_history": _clean_list(sub.get("family_history")),
        "social_history": _clean_list(sub.get("social_history")),
        "current_medications": _normalize_current_medications(sub.get("current_medicines")),
    }

    old_exam = _clean_list(obj.get("examination_findings"))
    new_obj = {
        "vitals": _normalize_vitals_dict(obj.get("vitals")),
        "physical_examination": {
            "general": None,
            "respiratory": None,
            "cardiovascular": None,
            "ent": None,
            "abdomen": None,
            "neurological": None,
            "other": old_exam,
        },
        "investigations": _clean_list(obj.get("available_test_results")),
    }

    new_ass = _migrate_old_assessment_to_new(ass)
    new_plan = _migrate_old_plan_to_new(plan)

    result = {
        "schema_version": source.get("schema_version", "1.0"),
        "visit_details": source.get("visit_details", _empty_soap_ehr()["visit_details"]),
        "subjective": new_sub,
        "objective": new_obj,
        "assessment": new_ass,
        "plan": new_plan,
        "private_doctor_notes": _clean_text(source.get("private_doctor_notes")) or "",
        "review_metadata": source.get("review_metadata", {"completeness_flags": source.get("completeness_flags", [])}),
        "approval": source.get("approval", _empty_soap_ehr()["approval"]),
    }
    return result


def _normalize_vitals_dict(vitals: Any) -> dict[str, Any]:
    empty_vitals = {
        "temperature": {"value": None, "unit": None, "source": None},
        "blood_pressure": {"systolic": None, "diastolic": None, "unit": "mmHg", "source": None},
        "pulse": {"value": None, "unit": "bpm", "source": None},
        "respiratory_rate": {"value": None, "unit": "breaths/min", "source": None},
        "spo2": {"value": None, "unit": "%", "source": None},
        "weight": {"value": None, "unit": None, "source": None},
        "height": {"value": None, "unit": None, "source": None},
        "bmi": {"value": None, "source": None},
    }
    if not vitals or not isinstance(vitals, dict):
        return empty_vitals
    result = {}
    for key in ("temperature", "blood_pressure", "pulse", "respiratory_rate", "spo2", "height", "weight"):
        result[key] = _normalize_vital(vitals.get(key))
    bp = vitals.get("blood_pressure") or {}
    if isinstance(bp, dict):
        result["blood_pressure"] = {
            "systolic": _clean_optional_vital(bp.get("systolic")),
            "diastolic": _clean_optional_vital(bp.get("diastolic")),
            "unit": _clean_text(bp.get("unit")) or "mmHg",
            "source": _clean_text(bp.get("source")),
        }
    result["bmi"] = _normalize_bmi(vitals.get("bmi"))
    bmi_calc = _calculate_bmi_from_vitals(result)
    if bmi_calc is not None and result["bmi"]["value"] is None:
        result["bmi"]["value"] = bmi_calc
        result["bmi"]["source"] = "calculated"
    return result


def _normalize_prescriptions(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = _clean_text(item.get("medicine_name") or item.get("name"))
        if not name:
            continue
        schedule = item.get("schedule") if isinstance(item.get("schedule"), dict) else {}
        raw_action = item.get("action")
        if raw_action in ("START", "CONTINUE", "CHANGE", "STOP", "PRN"):
            action = raw_action
        else:
            raw_as_needed = item.get("as_needed")
            if isinstance(raw_as_needed, bool):
                action = "PRN" if raw_as_needed else "START"
            else:
                action = None
        prn_condition = _clean_text(item.get("prn_condition"))
        instructions = _clean_text(item.get("instructions")) or _clean_text(item.get("additional_instructions"))
        prescription = {
            "medicine_name": name,
            "strength": _clean_text(item.get("strength")),
            "dosage_form": _clean_text(item.get("dosage_form")),
            "dose": _clean_text(item.get("dose")),
            "route": _clean_text(item.get("route")),
            "frequency": _clean_text(item.get("frequency")),
            "schedule": {
                "morning": _clean_text(schedule.get("morning")),
                "afternoon": _clean_text(schedule.get("afternoon")),
                "night": _clean_text(schedule.get("night")),
            },
            "specific_timing": _clean_text(item.get("specific_timing")),
            "meal_timing": _clean_text(item.get("meal_timing")),
            "duration": _clean_text(item.get("duration")),
            "prn_condition": prn_condition,
            "indication": _clean_text(item.get("indication")),
            "instructions": instructions,
            "action": action,
        }
        exists = any(p["medicine_name"] == prescription["medicine_name"] for p in result)
        if not exists:
            result.append(prescription)
    return result


def _normalize_additional_info(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        info = _clean_text(item.get("information"))
        if not info:
            continue
        result.append({
            "information": info,
            "suggested_category": _clean_text(item.get("suggested_category")),
            "source": _clean_text(item.get("source")),
        })
    return result


def _normalize_bmi(bmi: Any) -> dict[str, Any]:
    if not bmi or not isinstance(bmi, dict):
        return {"value": None, "source": None}
    return {
        "value": _clean_optional_vital(bmi.get("value")),
        "source": _clean_text(bmi.get("source")),
    }


def _calculate_bmi_from_vitals(vitals: dict[str, Any]) -> Optional[float]:
    height = vitals.get("height", {})
    weight = vitals.get("weight", {})
    h_value = height.get("value") if isinstance(height, dict) else None
    w_value = weight.get("value") if isinstance(weight, dict) else None
    h_unit = height.get("unit") if isinstance(height, dict) else None
    w_unit = weight.get("unit") if isinstance(weight, dict) else None
    if h_value is None or w_value is None:
        return None
    try:
        h_m = float(h_value) / 100 if h_unit and "cm" in str(h_unit).lower() else float(h_value) / 100
        w_kg = float(w_value) if w_unit and "kg" in str(w_unit).lower() else float(w_value)
        if h_m <= 0 or w_kg <= 0:
            return None
        bmi = w_kg / (h_m * h_m)
        return round(bmi, 1)
    except (ValueError, TypeError, ZeroDivisionError):
        return None


def _is_soap_ehr(ehr_data: dict[str, Any]) -> bool:
    return ehr_data.get("schema_version") in SOAP_SCHEMA_VERSIONS


def _empty_soap_ehr() -> dict[str, Any]:
    return {
        "schema_version": SOAP_SCHEMA_VERSION,
        "visit_details": {
            "patient_name": "",
            "phone_number": "",
            "patient_id": "",
            "clinic_name": "",
            "clinic_address": "",
            "clinic_phone": "",
            "doctor_name": "",
            "visit_datetime": "",
        },
        "subjective": {
            "chief_complaints": [],
            "history_of_present_illness": None,
            "relevant_negatives": [],
            "medical_conditions": [],
            "allergies": [],
            "family_history": [],
            "social_history": [],
            "current_medications": [],
        },
        "objective": {
            "vitals": {
                "temperature": {"value": None, "unit": None, "source": None},
                "blood_pressure": {"systolic": None, "diastolic": None, "unit": "mmHg", "source": None},
                "pulse": {"value": None, "unit": "bpm", "source": None},
                "respiratory_rate": {"value": None, "unit": "breaths/min", "source": None},
                "spo2": {"value": None, "unit": "%", "source": None},
                "weight": {"value": None, "unit": None, "source": None},
                "height": {"value": None, "unit": None, "source": None},
                "bmi": {"value": None, "source": None},
            },
            "physical_examination": {
                "general": None,
                "respiratory": None,
                "cardiovascular": None,
                "ent": None,
                "abdomen": None,
                "neurological": None,
                "other": [],
            },
            "investigations": [],
        },
        "assessment": {
            "clinical_impression": None,
            "provisional_diagnosis": [],
            "confirmed_diagnosis": [],
            "differential_diagnoses": [],
            "problems_being_managed": [],
        },
        "plan": {
            "prescriptions": [],
            "tests_ordered": [],
            "procedures": [],
            "treatment_advice": [],
            "diet_lifestyle_advice": [],
            "monitoring": [],
            "referrals": [],
            "follow_up": None,
            "warning_signs": [],
            "other_instructions": [],
        },
        "private_doctor_notes": "",
        "review_metadata": {
            "completeness_flags": [],
        },
        "approval": {
            "status": "draft",
            "approved_by_doctor_id": None,
            "approved_at": None,
            "version": 1,
        },
    }


def _normalize_soap_ehr(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    ehr = _empty_soap_ehr()

    sub = source.get("subjective") or {}

    # Detect old format: chief_complaints is a list of strings
    complaints = sub.get("chief_complaints", [])
    is_old = bool(complaints) and isinstance(complaints, list) and len(complaints) > 0 and isinstance(complaints[0], str)

    if is_old:
        source = _migrate_old_soap_to_new(source)
        sub = source.get("subjective") or {}

    obj = source.get("objective") or {}
    ass = source.get("assessment") or {}
    plan = source.get("plan") or {}

    # Migrate old assessment format (diagnoses array) if present
    if "diagnoses" in ass and not ass.get("provisional_diagnosis"):
        ass = _migrate_old_assessment_to_new(ass)
    # Migrate old plan format (medications etc.) if present
    if "medications" in plan and not plan.get("prescriptions"):
        plan = _migrate_old_plan_to_new(plan)

    ehr["subjective"] = {
        "chief_complaints": _normalize_chief_complaints(sub.get("chief_complaints"), sub.get("symptoms")),
        "history_of_present_illness": _clean_text(sub.get("history_of_present_illness")),
        "relevant_negatives": _clean_list(sub.get("relevant_negatives")),
        "medical_conditions": _clean_list(sub.get("medical_conditions")),
        "allergies": _clean_list(sub.get("allergies")),
        "family_history": _clean_list(sub.get("family_history")),
        "social_history": _clean_list(sub.get("social_history")),
        "current_medications": _normalize_current_medications(sub.get("current_medications")),
    }

    ehr["objective"]["vitals"] = _normalize_vitals_dict(obj.get("vitals"))
    ehr["objective"]["physical_examination"] = _normalize_physical_examination(obj.get("physical_examination"))
    ehr["objective"]["investigations"] = _clean_list(obj.get("investigations"))

    # New assessment format
    ci = ass.get("clinical_impression")
    if isinstance(ci, list) and ci:
        ehr["assessment"]["clinical_impression"] = _clean_text(ci[0])
    elif isinstance(ci, str):
        ehr["assessment"]["clinical_impression"] = _clean_text(ci)
    else:
        ehr["assessment"]["clinical_impression"] = None
    ehr["assessment"]["provisional_diagnosis"] = _clean_list(ass.get("provisional_diagnosis") or ass.get("provisional_diagnoses"))
    ehr["assessment"]["confirmed_diagnosis"] = _clean_list(ass.get("confirmed_diagnosis") or ass.get("confirmed_diagnoses"))
    ehr["assessment"]["differential_diagnoses"] = _clean_list(ass.get("differential_diagnoses"))
    ehr["assessment"]["problems_being_managed"] = _clean_list(ass.get("problems_being_managed"))

    # New plan format
    ehr["plan"]["prescriptions"] = _normalize_prescriptions(plan.get("prescriptions"))
    ehr["plan"]["tests_ordered"] = _clean_list(plan.get("tests_ordered"))
    ehr["plan"]["procedures"] = _clean_list(plan.get("procedures"))
    ehr["plan"]["treatment_advice"] = _clean_list(plan.get("treatment_advice"))
    ehr["plan"]["diet_lifestyle_advice"] = _clean_list(plan.get("diet_lifestyle_advice") or plan.get("diet_and_hydration_advice"))
    ehr["plan"]["monitoring"] = _clean_list(plan.get("monitoring") or plan.get("monitoring_instructions"))
    ehr["plan"]["referrals"] = _clean_list(plan.get("referrals"))
    ehr["plan"]["follow_up"] = _clean_text(plan.get("follow_up"))
    ehr["plan"]["warning_signs"] = _clean_list(plan.get("warning_signs"))
    ehr["plan"]["other_instructions"] = _clean_list(plan.get("other_instructions"))

    # Backward compat: read completeness_flags from old top-level or new review_metadata
    old_flags = source.get("completeness_flags")
    new_flags = (source.get("review_metadata") or {}).get("completeness_flags")
    ehr["review_metadata"]["completeness_flags"] = old_flags or new_flags or []

    return ehr


def _normalize_ehr(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    if source.get("schema_version") in SOAP_SCHEMA_VERSIONS:
        soap_ehr = _normalize_soap_ehr(source)
        soap_ehr["visit_details"] = source.get("visit_details", _empty_soap_ehr()["visit_details"])
        soap_ehr["private_doctor_notes"] = _clean_text(source.get("private_doctor_notes")) or ""
        approval = source.get("approval") or {}
        soap_ehr["approval"] = {
            "status": approval.get("status", "draft"),
            "approved_by_doctor_id": _clean_text(approval.get("approved_by_doctor_id")),
            "approved_at": approval.get("approved_at"),
            "version": approval.get("version", 1),
        }
        return soap_ehr
    legacy = _normalize_legacy_ehr(source)
    return legacy


def _normalize_legacy_ehr(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    return {
        "chief_complaint": _clean_text(source.get("chief_complaint")),
        "symptoms": _clean_list(source.get("symptoms")),
        "symptom_duration": _clean_text(source.get("symptom_duration")),
        "medical_history": _clean_list(source.get("medical_history")),
        "existing_conditions": _clean_list(source.get("existing_conditions")),
        "allergies": _clean_list(source.get("allergies")),
        "current_medications": _clean_list(source.get("current_medications")),
        "vitals": dict(
            (str(k).strip(), str(v).strip())
            for k, v in (source.get("vitals", {}).items() if isinstance(source.get("vitals"), dict) else [])
            if _clean_text(v)
        ),
        "examination_findings": _clean_list(source.get("examination_findings")),
        "diagnoses": _clean_list(source.get("diagnoses")),
        "investigations": _clean_list(source.get("investigations")),
        "prescriptions": _clean_list(source.get("prescriptions")),
        "treatment_plan": _clean_text(source.get("treatment_plan")),
        "follow_up": _clean_text(source.get("follow_up")),
        "warning_signs": _clean_list(source.get("warning_signs")),
        "private_doctor_notes": _clean_text(source.get("private_doctor_notes")),
    }


def _normalize_patient_summary(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    # Current approved summaries are already derived from SOAP.  Older records
    # are migrated once on read so the frontend has one stable shape.
    result: dict[str, Any] = {}
    visit = _clean_text(value.get("visit_summary") or value.get("what_the_doctor_assessed") or value.get("visit_overview"))
    if visit:
        result["visit_summary"] = visit
    medicines = value.get("medicines")
    if isinstance(medicines, list):
        clean_medicines: list[Any] = []
        for item in medicines:
            if isinstance(item, str) and _clean_text(item):
                clean_medicines.append(item.strip())
            elif isinstance(item, dict):
                name = _clean_text(item.get("medicine_name") or item.get("medicine") or item.get("name"))
                if name:
                    clean_medicines.append({**item, "medicine_name": name})
        if clean_medicines:
            result["medicines"] = clean_medicines
    for target, aliases in {
        "tests": ("tests",),
        "procedures": ("procedures",),
        "diet_and_care": ("diet_and_care", "diet_and_hydration_advice", "diet_advice", "doctor_instructions", "doctor_suggestions", "instructions"),
        "monitoring": ("monitoring",),
        "referrals": ("referrals",),
        "other_instructions": ("other_instructions",),
    }.items():
        merged: list[str] = []
        for alias in aliases:
            for item in _clean_list(value.get(alias, [])):
                if item not in merged:
                    merged.append(item)
        if merged:
            result[target] = merged
    warnings = value.get("when_to_seek_help") or value.get("warning_signs")
    if isinstance(warnings, list) and warnings:
        result["when_to_seek_help"] = warnings
    follow_up = _clean_text(value.get("follow_up"))
    if follow_up:
        result["follow_up"] = follow_up
    return result


def _empty_patient_summary() -> dict[str, Any]:
    return {}


def _generate_patient_summary_from_soap(ehr_data: dict[str, Any]) -> dict[str, Any]:
    return _build_patient_summary(_normalize_soap_ehr(ehr_data))


_NEGATION_RE = re.compile(r"\b(?:no|not|denies?|denied|without|never\s+had)\b", re.IGNORECASE)
_AS_NEEDED_RE = re.compile(
    r"\b(?:as\s+needed|if\s+needed|when\s+required|p\.?r\.?n\.?|"
    r"if\s+\w+\s+(?:persists|continues|worsens|develops|recurs|returns|doesn'?t\s+improve|not\s+improving))\b",
    re.IGNORECASE,
)
_MEDICINE_UNCERTAINTY_RE = re.compile(
    r"\b(?:unclear|uncertain|not\s+sure|did(?:\s+not|n't)\s+catch|something\s+like|maybe\s+called|sounds\s+like)\b",
    re.IGNORECASE,
)
_WARNING_CONTEXT_RE = re.compile(
    r"\b(?:if|seek\s+(?:help|care|attention)|urgent|emergency|go\s+to|call|warning\s+sign|"
    r"should\s+you|in\s+case\s+of|when\s+to\s+seek)\b",
    re.IGNORECASE,
)
_UNCERTAIN_ANNOTATION_RE = re.compile(r"\[uncertain:\s*(.*?)\]", re.IGNORECASE | re.DOTALL)
_SPOKEN_DOSE_RE = re.compile(
    r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|\d+(?:\.\d+)?)\s+"
    r"(?:tablet(?:s)?|tab(?:s)?|capsule(?:s)?|cap(?:s)?|teaspoon(?:s)?|drop(?:s)?|puff(?:s)?|ml)\b",
    re.IGNORECASE,
)
_DIET_LIFESTYLE_RE = re.compile(
    r"\b(?:diet|food|meal|eat|drink|fruits?|juices?|soups?|fluid|water|hydration|oily|spicy|smok(?:e|ing)|"
    r"alcohol|exercise|walk|sleep|weight)\b|"
    r"\b(?:reduce|avoid|limit)\s+(?:your\s+)?(?:sugar|salt)\b",
    re.IGNORECASE,
)


def _evidence_text(value: Any) -> str:
    text = str(value or "").lower().replace("–", "-").replace("—", "-")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _is_transcript_grounded(value: Any, transcript: str) -> bool:
    evidence = _evidence_text(value)
    return bool(evidence) and evidence in _evidence_text(transcript)


def _doctor_texts(evidence_ledger: list[dict[str, Any]]) -> str:
    """Extract a concatenated string of all doctor non-question statements.

    Used for per-item evidence validation — only doctor statements (not
    patient reports, not questions) are considered as clinical authority.

    Superseded entries (those referenced by a later correction) are excluded
    so that corrected instructions cannot independently support stale output.
    """
    superseded_ids: set[str] = set()
    for entry in evidence_ledger or []:
        sup = entry.get("superseded_by")
        if sup:
            superseded_ids.add(entry["id"])

    parts: list[str] = []
    seen: set[str] = set()
    for entry in evidence_ledger or []:
        if entry.get("speaker") != "doctor":
            continue
        if entry.get("is_question"):
            continue
        if entry.get("id") in superseded_ids:
            continue
        text = (entry.get("text") or "").strip()
        if not text:
            continue
        lower = text.lower()
        if lower not in seen:
            seen.add(lower)
            parts.append(text)
    return "\n".join(parts)


def _is_supported_by_doctor_evidence(
    value: Any,
    evidence_ledger: Optional[list[dict[str, Any]]],
    transcript: str = "",
    warning_only: bool = False,
) -> bool:
    """Check if a Plan/Assessment item is supported by a doctor statement.

    When evidence_ledger is provided, requires the normalized value text
    to appear in at least one doctor non-question statement.

    When evidence_ledger is NOT available (None), falls back to the raw
    transcript text-grounding check for backward compatibility.

    For warning signs (warning_only=True), additionally requires the
    surrounding sentence to contain warning-sign context keywords.
    """
    text = _clean_text(value)
    if not text:
        return False
    ev = _evidence_text(text)
    if not ev:
        return False

    if evidence_ledger is not None:
        doctor_text = _doctor_texts(evidence_ledger)
        if not doctor_text:
            return False
        if ev not in _evidence_text(doctor_text):
            return False
        search_in = doctor_text
    else:
        # Backward compat: fall back to raw transcript text-grounding
        if not transcript:
            return False
        if ev not in _evidence_text(transcript):
            return False
        search_in = transcript

    if warning_only:
        words = re.findall(r"[A-Za-z0-9]+", text)
        if not words:
            return False
        pattern = r"\b" + r"\W+".join(re.escape(word) for word in words) + r"\b"
        for match in re.finditer(pattern, search_in, flags=re.IGNORECASE):
            start = max(
                search_in.rfind(".", 0, match.start()),
                search_in.rfind("!", 0, match.start()),
                search_in.rfind("?", 0, match.start()),
                search_in.rfind("\n", 0, match.start()),
            ) + 1
            ends = [
                p for p in (
                    search_in.find(".", match.end()),
                    search_in.find("!", match.end()),
                    search_in.find("?", match.end()),
                    search_in.find("\n", match.end()),
                ) if p >= 0
            ]
            end = min(ends) + 1 if ends else len(search_in)
            ctx = search_in[start:end]
            if _WARNING_CONTEXT_RE.search(ctx):
                return True
        return False

    return True


def _spoken_transcript_span(value: Any, transcript: str) -> Optional[str]:
    words = re.findall(r"[A-Za-z0-9]+", str(value or ""))
    if not words:
        return None
    pattern = r"\b" + r"\W+".join(re.escape(word) for word in words) + r"\b"
    match = re.search(pattern, transcript, flags=re.IGNORECASE)
    if not match:
        return None
    end = match.end()
    while end < len(transcript) and transcript[end] in ".!?":
        end += 1
    return transcript[match.start():end]


def _negative_core(value: str) -> str:
    core = re.sub(
        r"^\s*(?:(?:the\s+)?patient\s+)?(?:(?:does|do|did|is|was|has|have)\s+)?"
        r"(?:no|not|denies?|denied|without|never\s+had)\s+(?:have|having|experienced?|experiencing)?\s*",
        "",
        value,
        count=1,
        flags=re.IGNORECASE,
    ).strip(" ,:;-.")
    if core == value.strip(" ,:;-."):
        core = _NEGATION_RE.sub("", value, count=1).strip(" ,:;-.")
    return re.sub(r"^(?:any|a|an)\s+", "", core, flags=re.IGNORECASE).strip()


def _ground_relevant_negative(value: Any, transcript: str) -> Optional[str]:
    text = _clean_text(value)
    if not text:
        return None
    core = _negative_core(text)
    if not core:
        return None

    words = re.findall(r"[A-Za-z0-9]+", core)
    if not words:
        return None
    core_pattern = r"\b" + r"\W+".join(re.escape(word) for word in words) + r"\b"
    for core_match in re.finditer(core_pattern, transcript, flags=re.IGNORECASE):
        prefix_start = max(
            transcript.rfind(".", max(0, core_match.start() - 180), core_match.start()),
            transcript.rfind("!", max(0, core_match.start() - 180), core_match.start()),
            transcript.rfind("?", max(0, core_match.start() - 180), core_match.start()),
            transcript.rfind("\n", max(0, core_match.start() - 180), core_match.start()),
        ) + 1
        negations = list(_NEGATION_RE.finditer(transcript, prefix_start, core_match.start()))
        if not negations:
            continue
        negation = negations[-1]
        span_start = negation.start()
        if negation.group(0).lower() == "not":
            auxiliary = re.search(
                r"\b(?:does|do|did|is|was|has|have)\s+$",
                transcript[prefix_start:negation.start()],
                flags=re.IGNORECASE,
            )
            if auxiliary:
                span_start = prefix_start + auxiliary.start()
        span = transcript[span_start:core_match.end()].strip()
        if re.search(r"[,;]|\b(?:and|or)\b", transcript[negation.end():core_match.start()], re.IGNORECASE):
            span = f"{negation.group(0)} {core_match.group(0)}"
        return f"{span[:1].upper()}{span[1:]}"
    return None


def _is_numeric_medicine_name(value: str) -> bool:
    stripped = re.sub(r"\b(?:mg|mcg|g|ml|tablet|tablets|capsule|capsules)\b", "", value, flags=re.IGNORECASE)
    return not bool(re.search(r"[A-Za-z]", stripped))


def _spoken_medicine_name(value: Any, transcript: str) -> Optional[str]:
    name = _clean_text(value)
    if not name or _is_numeric_medicine_name(name):
        return None

    words = re.findall(r"[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*", name)
    if not words:
        return None
    pattern = r"\b" + r"\W+".join(re.escape(word) for word in words) + r"\b"
    match = re.search(pattern, transcript, flags=re.IGNORECASE)
    if not match:
        return None

    spoken_name = transcript[match.start():match.end()].strip()
    if not re.search(r"\d", spoken_name):
        # Keep an explicitly spoken brand strength (Dolo 650, Metformin
        # 500 mg) with the medicine name. A liquid quantity such as 5 ml is a
        # dose, not part of a syrup name.
        allows_bare_strength = not re.search(
            r"\b(?:syrup|solution|suspension|drops?|injection)\s*$",
            spoken_name,
            re.IGNORECASE,
        )
        strength_pattern = (
            r"\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g))\b"
            if not allows_bare_strength
            else r"\s+(\d+(?:\.\d+)?(?:\s*(?:mg|mcg|g))?)\b"
        )
        strength_suffix = re.match(
            strength_pattern, transcript[match.end():match.end() + 32], flags=re.IGNORECASE
        )
        if strength_suffix:
            spoken_name += strength_suffix.group(0)
    return spoken_name.strip()


def _resolve_spoken_medicine_name(value: Any, transcript: str) -> tuple[Optional[str], bool]:
    name = _clean_text(value)
    if not name:
        return None, False

    transcript_without_annotations = _UNCERTAIN_ANNOTATION_RE.sub(" ", transcript)
    spoken = _spoken_medicine_name(name, transcript_without_annotations)
    if spoken:
        return spoken, False

    name_evidence = _evidence_text(name)
    for annotation in _UNCERTAIN_ANNOTATION_RE.finditer(transcript):
        annotation_text = annotation.group(1)
        if name_evidence not in _evidence_text(annotation_text):
            continue
        heard = re.search(r"\bheard\s+['\"]([^'\"]+)['\"]", annotation_text, re.IGNORECASE)
        if not heard:
            return None, True
        heard_text = heard.group(1).strip()
        resolved = _spoken_medicine_name(heard_text, heard_text)
        return resolved, True
    return None, False


def _medicine_context(name: str, transcript: str) -> str:
    position = transcript.lower().find(name.lower())
    if position < 0:
        first_word = name.split()[0] if name.split() else ""
        position = transcript.lower().find(first_word.lower()) if first_word else -1
    if position < 0:
        return ""
    return transcript[max(0, position - 120):min(len(transcript), position + len(name) + 160)]


_COMPLAINT_SEVERITY_PATTERNS = (
    (re.compile(r"\b(?:slight|slightly|minor|mild)\b", re.IGNORECASE), "mild"),
    (re.compile(r"\bmoderate(?:ly)?\b", re.IGNORECASE), "moderate"),
    (re.compile(r"\b(?:severe|severely|serious|very\s+bad|intense)\b", re.IGNORECASE), "severe"),
)
_COMPLAINT_COURSE_PATTERNS = (
    (re.compile(r"\b(?:comes?\s+and\s+goes?|on\s+and\s+off|fluctuat\w*|intermittent)\b", re.IGNORECASE), "intermittent"),
    (re.compile(r"\b(?:constant|continuous|continuously|persistent)\b", re.IGNORECASE), "continuous"),
    (re.compile(r"\b(?:recurrent|recurring|keeps?\s+coming\s+back)\b", re.IGNORECASE), "recurrent"),
    (re.compile(r"\b(?:worsen\w*|getting\s+worse|became\s+worse|increas\w*)\b", re.IGNORECASE), "worsening"),
    (re.compile(r"\b(?:improv\w*|getting\s+better|became\s+better|decreas\w*)\b", re.IGNORECASE), "improving"),
    (re.compile(r"\b(?:stable|unchanged|stayed\s+the\s+same)\b", re.IGNORECASE), "stable"),
)


def _concise_complaint_name(value: Any) -> Optional[str]:
    """Remove only explicit detail clauses that belong in adjacent fields."""
    text = (_clean_text(value) or "").strip(" ,.;")
    text = re.sub(
        r"^(?:i\s+(?:have|am\s+having|feel)|my|the\s+patient\s+(?:has|reports?))\s+",
        "",
        text,
        flags=re.IGNORECASE,
    )
    detail_start = re.search(
        r"\s+(?:is|was|has\s+been)\s+(?=(?:slight|mild|moderate|severe|serious|very\s+bad|"
        r"intense|constant|continuous|persistent|intermittent|recurrent|stable|unchanged|"
        r"getting\s+(?:worse|better)|worsen\w*|improv\w*|increas\w*|decreas\w*))",
        text,
        re.IGNORECASE,
    )
    if detail_start:
        text = text[:detail_start.start()]
    text = re.sub(
        r"\s+for\s+(?:about\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\s+"
        r"(?:hours?|days?|weeks?|months?|years?)\s*$",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return _clean_text(text)


def _validate_chief_complaint_details(
    value: Any,
    evidence_ledger: Optional[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Recover explicit severity/course and remove unsupported model values."""
    complaints = [dict(item) for item in (value or []) if isinstance(item, dict)]
    if not evidence_ledger:
        return complaints

    patient_evidence = [
        entry for entry in evidence_ledger
        if entry.get("speaker") in {"patient", "caregiver"}
        and not entry.get("is_question")
        and not entry.get("superseded_by")
    ]
    for complaint in complaints:
        original_name = _clean_text(complaint.get("complaint"))
        name = _concise_complaint_name(original_name)
        if not name:
            continue
        complaint["complaint"] = name[:1].upper() + name[1:]
        name_key = _evidence_text(name)
        matching_text = " ".join(
            _clean_text(entry.get("text")) or ""
            for entry in patient_evidence
            if name_key and name_key in _evidence_text(entry.get("text"))
        ).strip()
        if not matching_text:
            if "severity" in complaint:
                complaint["severity"] = None
            if "course" in complaint:
                complaint["course"] = None
            continue

        explicit_severity = next(
            (canonical for pattern, canonical in _COMPLAINT_SEVERITY_PATTERNS if pattern.search(matching_text)),
            None,
        )
        explicit_course = next(
            (canonical for pattern, canonical in _COMPLAINT_COURSE_PATTERNS if pattern.search(matching_text)),
            None,
        )
        if explicit_severity or "severity" in complaint:
            complaint["severity"] = explicit_severity
        if explicit_course or "course" in complaint:
            complaint["course"] = explicit_course
    return complaints


def _medicine_evidence_context(
    name: str,
    evidence_ledger: Optional[list[dict[str, Any]]],
    allowed_speakers: set[str],
    known_medicine_names: Optional[list[str]] = None,
) -> str:
    """Return exact medicine evidence plus its adjacent continuation clauses."""
    if not evidence_ledger:
        return ""
    name_key = _evidence_text(name)
    entries = list(evidence_ledger)
    matched_contexts: list[str] = []
    for index in range(len(entries) - 1, -1, -1):
        entry = entries[index]
        if entry.get("speaker") not in allowed_speakers or entry.get("is_question") or entry.get("superseded_by"):
            continue
        spoken = _clean_text(entry.get("text"))
        if not spoken or name_key not in _evidence_text(spoken):
            continue

        # Ignore an answer immediately followed by the clinician asking for a
        # repeat when a later patient answer exists. The repeat is the clearer
        # source and avoids retaining an earlier STT rendering as a duplicate.
        if entry.get("speaker") in {"patient", "caregiver"}:
            later_entries = entries[index + 1:]
            first_doctor = next((item for item in later_entries if item.get("speaker") == "doctor"), None)
            if first_doctor and re.search(r"\b(?:repeat|say (?:that|it) again)\b", str(first_doctor.get("text") or ""), re.IGNORECASE):
                if any(item.get("speaker") in {"patient", "caregiver"} for item in later_entries):
                    continue

        match = re.search(re.escape(name), spoken, re.IGNORECASE)
        if not match:
            first_word = name.split()[0] if name.split() else ""
            match = re.search(re.escape(first_word), spoken, re.IGNORECASE) if first_word else None
        if not match:
            continue
        other_names = [
            candidate for candidate in (known_medicine_names or [])
            if _evidence_text(candidate) and _evidence_text(candidate) != name_key
        ]
        prefix_key = _evidence_text(spoken[:match.start()])
        start = match.start() if any(_evidence_text(other_name) in prefix_key for other_name in other_names) else 0
        tail = spoken[match.end():]
        next_action = re.search(
            r"\b(?:and\s+)?(?:i\s+)?(?:am\s+)?(?:taking|take|took|consume)\s+[A-Za-z]",
            tail,
            re.IGNORECASE,
        )
        next_named = re.search(
            r"\band\s+[A-Z][A-Za-z'-]+(?:\s+(?:syrup|tablet|capsule|\d+(?:\.\d+)?))?\b",
            tail,
        )
        candidates = [match for match in (next_action, next_named) if match]
        next_medicine = min(candidates, key=lambda candidate: candidate.start()) if candidates else None
        end = match.end() + (next_medicine.start() if next_medicine else len(tail))
        context_parts = [spoken[start:end].strip(" ,.;")]

        # Doctors commonly state a medicine first, then its dose/timing in the
        # next sentence ("After dinner ... Drink 5 ml of it"). Keep those exact
        # continuation clauses until another medicine or speaker begins.
        for following in entries[index + 1:index + 4]:
            if following.get("speaker") not in allowed_speakers:
                break
            if following.get("is_question") or following.get("superseded_by"):
                continue
            following_text = _clean_text(following.get("text"))
            if not following_text:
                continue
            following_key = _evidence_text(following_text)
            if any(_evidence_text(other_name) in following_key for other_name in other_names):
                break
            if re.search(
                r"\b(?:it|this|that|take|drink|consume|tablet|capsule|syrup|ml|"
                r"breakfast|lunch|noon|dinner|morning|night|after|before|for\s+\w+\s+days?)\b",
                following_text,
                re.IGNORECASE,
            ):
                context_parts.append(following_text.strip(" ,.;"))
        context_text = ". ".join(context_parts)
        if context_text and context_text.casefold() not in {value.casefold() for value in matched_contexts}:
            matched_contexts.append(context_text)
    # The scan runs newest-to-oldest. Restore conversation order so explicit
    # details spread across repeated mentions can be combined without treating
    # repetition as an increased dose.
    return ". ".join(reversed(matched_contexts))


def _validate_prescriptions_against_transcript(
    value: Any,
    transcript: str,
    evidence_ledger: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    prescriptions = _normalize_prescriptions(value)
    known_medicine_names = [
        str(item.get("medicine_name") or "").strip()
        for item in prescriptions
        if str(item.get("medicine_name") or "").strip()
    ]
    validated: list[dict[str, Any]] = []
    for item in prescriptions:
        spoken_name, uncertain_annotation = _resolve_spoken_medicine_name(item.get("medicine_name"), transcript)
        if not spoken_name:
            continue

        # Require doctor evidence — patient medication history cannot create a prescription
        liquid_dose_in_name = re.match(
            r"^(.*\b(?:syrup|solution|suspension|drops?))\s+"
            r"((?:zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\s*ml)\s*$",
            spoken_name,
            re.IGNORECASE,
        )
        if liquid_dose_in_name:
            spoken_name = liquid_dose_in_name.group(1).strip()
            if not item.get("dose"):
                item["dose"] = liquid_dose_in_name.group(2).strip()

        if evidence_ledger is not None and not _is_supported_by_doctor_evidence(spoken_name, evidence_ledger):
            continue

        context = (
            _medicine_evidence_context(spoken_name, evidence_ledger, {"doctor"}, known_medicine_names)
            if evidence_ledger is not None
            else _medicine_context(spoken_name, transcript)
        )
        if not context:
            continue
        item["medicine_name"] = spoken_name
        for field in (
            "strength", "dosage_form", "dose", "route", "meal_timing", "specific_timing",
            "frequency", "duration", "prn_condition", "indication", "instructions",
        ):
            if item.get(field) is not None and not _is_transcript_grounded(item[field], context):
                item[field] = None

        # Preserve the exact spoken dose when the model normalized words to a
        # number (for example, "one tablet" -> "1 tablet") and strict lexical
        # grounding therefore removed it. This copies transcript text only.
        if not item.get("dose"):
            spoken_dose = _SPOKEN_DOSE_RE.search(context)
            if spoken_dose:
                item["dose"] = spoken_dose.group(0).strip()

        meal_reference = re.search(
            r"\b(after|before)?\s*(breakfast|lunch|noon|dinner)\b",
            context,
            re.IGNORECASE,
        )
        meal_relation_reference = re.search(
            r"\b(after|before)\s+(?:food|meals?|breakfast|lunch|noon|dinner)\b",
            context,
            re.IGNORECASE,
        )
        if meal_reference:
            meal_name = meal_reference.group(2).lower()
            display_meal = "Lunch" if meal_name in {"lunch", "noon"} else meal_name.title()
            if not item.get("specific_timing"):
                item["specific_timing"] = display_meal
        if meal_relation_reference:
            # Store the transcript's meal relation in its dedicated field.
            # The UI renders this as AF/BF while the separate timing field
            # remains Breakfast/Lunch/Dinner.
            item["meal_timing"] = (
                "After food" if meal_relation_reference.group(1).lower() == "after" else "Before food"
            )
        if not item.get("duration"):
            spoken_duration = re.search(
                r"\b(?:for\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+"
                r"(?:day|days|week|weeks|month|months)\b",
                context,
                re.IGNORECASE,
            )
            if spoken_duration:
                item["duration"] = spoken_duration.group(0).strip()
        if not item.get("dose") and evidence_ledger is not None:
            name_pattern = r"\W+".join(
                re.escape(word) for word in re.findall(r"[A-Za-z0-9]+", spoken_name)
            )
            doctor_entries = [
                entry for entry in evidence_ledger
                if entry.get("speaker") == "doctor" and not entry.get("is_question") and not entry.get("superseded_by")
            ]
            for evidence_index, evidence in enumerate(doctor_entries):
                spoken = str(evidence.get("text") or "")
                quantity = re.search(
                    rf"\b(?:take|consume)\s+(zero|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|\d+(?:\.\d+)?)\s+{name_pattern}\b",
                    spoken,
                    re.IGNORECASE,
                )
                if not quantity:
                    continue
                recent_doctor_text = " ".join(
                    str(entry.get("text") or "")
                    for entry in doctor_entries[max(0, evidence_index - 4):evidence_index + 1]
                )
                dosage_form = re.search(r"\b(tablet|capsule)s?\b", recent_doctor_text, re.IGNORECASE)
                if dosage_form:
                    form = dosage_form.group(1).lower()
                    item["dose"] = f"{quantity.group(1)} {form}"
                    if not item.get("dosage_form"):
                        item["dosage_form"] = form
                else:
                    item["dose"] = quantity.group(1)
                break

        schedule = item.get("schedule") if isinstance(item.get("schedule"), dict) else {}
        item["schedule"] = {
            period: schedule.get(period) if _is_transcript_grounded(schedule.get(period), context) else None
            for period in ("morning", "afternoon", "night")
        }
        if meal_reference:
            period = {"breakfast": "morning", "lunch": "afternoon", "noon": "afternoon", "dinner": "night"}[meal_reference.group(2).lower()]
            if not item["schedule"].get(period):
                item["schedule"][period] = display_meal

        # Medication action is a doctor decision, so derive it from the
        # matching doctor evidence rather than accepting an LLM guess.
        supported_actions: list[str] = []
        if evidence_ledger is not None:
            name_tokens = set(_evidence_text(spoken_name).split())
            for evidence in evidence_ledger:
                if evidence.get("speaker") != "doctor":
                    continue
                evidence_tokens = set(_evidence_text(evidence.get("text")).split())
                action = evidence.get("medication_action")
                if action in {"START", "CONTINUE", "CHANGE", "STOP", "PRN"} and name_tokens.intersection(evidence_tokens):
                    supported_actions.append(action)
        item["action"] = supported_actions[-1] if supported_actions else None

        item["dosage_form"] = _clean_text(item.get("dosage_form"))
        if not any(existing["medicine_name"].lower() == spoken_name.lower() for existing in validated):
            validated.append(item)
    return validated


def _validate_medications_against_transcript(
    value: Any,
    transcript: str,
    evidence_ledger: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    medications = _normalize_medications(value)
    validated: list[dict[str, Any]] = []
    for item in medications:
        spoken_name, uncertain_annotation = _resolve_spoken_medicine_name(item.get("name"), transcript)
        if not spoken_name:
            continue
        if evidence_ledger is not None and not _is_supported_by_doctor_evidence(spoken_name, evidence_ledger):
            continue
        context = _medicine_context(spoken_name, transcript)
        item["name"] = spoken_name
        for field in ("strength", "dose", "route", "frequency", "timing", "duration", "instructions"):
            if item.get(field) is not None and not _is_transcript_grounded(item[field], context):
                item[field] = None
        if not any(existing["name"].lower() == spoken_name.lower() for existing in validated):
            validated.append(item)
    return validated


def _validate_current_medications_against_transcript(
    value: Any,
    evidence_ledger: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Keep only medicines explicitly reported by a patient or caregiver."""
    medications = _normalize_current_medications(value)
    patient_statements = [
        _clean_text(entry.get("text"))
        for entry in (evidence_ledger or [])
        if entry.get("speaker") in {"patient", "caregiver"}
        and not entry.get("is_question")
        and not entry.get("superseded_by")
        and _clean_text(entry.get("text"))
    ]
    patient_transcript = "\n".join(patient_statements)
    if not patient_transcript:
        return []

    validated: list[dict[str, Any]] = []
    for item in medications:
        spoken_name, _ = _resolve_spoken_medicine_name(item.get("name"), patient_transcript)
        if not spoken_name:
            continue
        context = (
            _medicine_evidence_context(spoken_name, evidence_ledger, {"patient", "caregiver"})
            if evidence_ledger is not None
            else _medicine_context(spoken_name, patient_transcript)
        )
        if not context:
            continue
        item["name"] = spoken_name
        for field in ("strength", "dose", "frequency", "timing", "duration"):
            if item.get(field) is not None and not _is_transcript_grounded(item[field], context):
                item[field] = None
        if item.get("dose") and not re.fullmatch(
            r"(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|\d+(?:\.\d+)?)\s*"
            r"(?:tablet(?:s)?|tab(?:s)?|capsule(?:s)?|cap(?:s)?|teaspoon(?:s)?|drop(?:s)?|puff(?:s)?|ml)",
            str(item["dose"]).strip(),
            re.IGNORECASE,
        ):
            item["dose"] = None
        if not item.get("dose"):
            spoken_dose = _SPOKEN_DOSE_RE.search(context)
            if spoken_dose:
                item["dose"] = spoken_dose.group(0).strip()
        if not item.get("timing"):
            timing_parts = re.findall(
                r"\b(?:after\s+(?:breakfast|lunch|dinner|food)|before\s+(?:breakfast|lunch|dinner|food)|"
                r"breakfast|morning|lunch|noon|afternoon|evening|dinner|night)\b",
                context,
                re.IGNORECASE,
            )
            if timing_parts:
                item["timing"] = " and ".join(dict.fromkeys(part.strip() for part in timing_parts))
        if not item.get("frequency"):
            frequency = re.search(
                r"\b(?:once|twice|thrice|daily|every\s+\d+\s+hours?|"
                r"(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:or\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?times?)\b",
                context,
                re.IGNORECASE,
            )
            if frequency:
                item["frequency"] = frequency.group(0)
        # Current medication history is intentionally presented as a concise
        # name-only list. Today's detailed dosing belongs in Plan prescriptions.
        for field in ("strength", "dose", "frequency", "timing", "duration"):
            item[field] = None
        item["source"] = "patient_reported"
        if not any(existing["name"].lower() == spoken_name.lower() for existing in validated):
            validated.append(item)
    return validated


def _warning_condition(value: Any, transcript: str) -> Optional[str]:
    text = _clean_text(value)
    words = re.findall(r"[A-Za-z0-9]+", text or "")
    if not words:
        return None
    pattern = r"\b" + r"\W+".join(re.escape(word) for word in words) + r"\b"
    for match in re.finditer(pattern, transcript, flags=re.IGNORECASE):
        start = max(
            transcript.rfind(".", 0, match.start()),
            transcript.rfind("!", 0, match.start()),
            transcript.rfind("?", 0, match.start()),
            transcript.rfind("\n", 0, match.start()),
        ) + 1
        ends = [position for position in (
            transcript.find(".", match.end()), transcript.find("!", match.end()),
            transcript.find("?", match.end()), transcript.find("\n", match.end()),
        ) if position >= 0]
        end = min(ends) + 1 if ends else len(transcript)
        if not _WARNING_CONTEXT_RE.search(transcript[start:end]):
            continue
        spoken = transcript[match.start():match.end()]
        conditional = re.match(r"^\s*if\s+(.+?)(?:,|\bthen\b|\bgo\s+to\b|\bseek\b|\bcall\b|\bvisit\b|$)", spoken, re.IGNORECASE)
        return conditional.group(1).strip() if conditional else spoken
    return None


def _transcript_clauses(transcript: str) -> list[str]:
    clauses: list[str] = []
    for line in transcript.splitlines():
        spoken = re.sub(r"^\s*[^:]{1,40}:\s*", "", line).strip()
        clauses.extend(part.strip() for part in re.split(r"(?<=[.!?])\s+", spoken) if part.strip())
    return clauses


def _validate_and_fix_soap_coverage(
    ehr: dict[str, Any],
    transcript: str,
    evidence_ledger: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    source = ehr if isinstance(ehr, dict) else {}
    sub = source.get("subjective") or {}
    obj = source.get("objective") or {}
    ass = source.get("assessment") or {}
    plan = source.get("plan") or {}

    fp = re.compile(
        r"(follow\s*up|come\s*back|come\s+(?:back\s+)?to\s+(?:the\s+)?clinic|visit\s*again|for\s*review|revisit|recheck|"
        r"return\s+(in|after|to|for)|"
        r"review\s+(in|after)|"
        r"consult\s+(us|me|doctor|again)\s+(in|after)|"
        r"next\s+visit|see\s+you\s+(in|after|next)|"
        r"follow\s*up\s+with)",
        re.IGNORECASE,
    )
    ws_pat = re.compile(
        r"(if\s+(you\s+)?(experience|have|notice|feel|develop|see|get|encounter|"
        r"don'?t\s+(feel|get|notice|see|improve))|"
        r"seek\s+(help|medical|care|attention|treatment|assistance)|"
        r"consult\s+(a\s+)?doctor|"
        r"go\s+to\s+(the\s+)?(hospital|emergency|doctor|casualty|clinic)|"
        r"warning\s+sign|"
        r"emergency|"
        r"when\s+to\s+(seek|worry|call|contact)|"
        r"call\s+(your\s+)?(doctor|physician|us|me)|"
        r"if\s+it\s+(gets|becomes|worsens|persists|continues|doesn'?t\s+improve|"
        r"doesn'?t\s+get\s+better)|"
        r"in\s+case\s+of|"
        r"should\s+(you\s+)?(experience|notice|develop|have))",
        re.IGNORECASE,
    )

    def exact_doctor_statement(value: Any) -> Optional[str]:
        """Return the matching doctor utterance so actions are never truncated."""
        if evidence_ledger is None:
            candidate_tokens = set(_evidence_text(value).split())
            for line in transcript.splitlines() or [transcript]:
                match = re.match(r"^\s*doctor\s*:\s*(.*)$", line, flags=re.IGNORECASE)
                if not match:
                    continue
                for clause in re.split(r"(?<=[.!?])\s+", match.group(1)):
                    clause_tokens = set(_evidence_text(clause).split())
                    if candidate_tokens and len(candidate_tokens & clause_tokens) / len(candidate_tokens) >= 0.5:
                        return _clean_text(clause)
            return _spoken_transcript_span(value, transcript)
        candidate_tokens = set(_evidence_text(value).split())
        best: tuple[float, str] | None = None
        for evidence in evidence_ledger:
            if evidence.get("speaker") != "doctor" or evidence.get("is_question") or evidence.get("superseded_by"):
                continue
            spoken = _clean_text(evidence.get("text"))
            spoken_tokens = set(_evidence_text(spoken).split())
            if not spoken or not candidate_tokens or not spoken_tokens:
                continue
            score = len(candidate_tokens & spoken_tokens) / len(candidate_tokens)
            if score >= 0.5 and (best is None or score > best[0]):
                best = (score, spoken)
        return best[1] if best else None

    # --- Subjective filters (unchanged) ---

    # 1. Negatives must remain negated and must be grounded in a negated transcript span.
    grounded_negatives = []
    for item in sub.get("relevant_negatives") or []:
        grounded = _ground_relevant_negative(item, transcript)
        if grounded and grounded.lower() not in {value.lower() for value in grounded_negatives}:
            grounded_negatives.append(grounded)
    sub["relevant_negatives"] = grounded_negatives

    negative_cores = {_evidence_text(_negative_core(item)) for item in grounded_negatives}

    def contradicts_negative(value: Any) -> bool:
        candidate = _evidence_text(value)
        return bool(candidate) and any(core and (candidate == core or candidate.endswith(f" {core}")) for core in negative_cores)

    # Filter chief_complaints (now objects with "complaint" field)
    cc = sub.get("chief_complaints")
    if isinstance(cc, list):
        sub["chief_complaints"] = [
            item for item in cc
            if isinstance(item, dict) and not contradicts_negative(item.get("complaint"))
        ]
    sub["chief_complaints"] = _validate_chief_complaint_details(
        sub.get("chief_complaints"), evidence_ledger
    )
    # Filter medical_conditions
    mc = sub.get("medical_conditions")
    if isinstance(mc, list):
        sub["medical_conditions"] = [item for item in mc if not contradicts_negative(item)]

    sub["current_medications"] = _validate_current_medications_against_transcript(
        sub.get("current_medications"), evidence_ledger
    )

    # Rebuild Allergies from explicit patient/caregiver allergy evidence. This
    # prevents a schema-valid but incomplete model response from losing an
    # allergy answer, while never treating the doctor's question as a fact.
    allergy_evidence: list[str] = []
    for evidence in evidence_ledger or []:
        if evidence.get("speaker") not in {"patient", "caregiver"}:
            continue
        if evidence.get("is_question") or evidence.get("superseded_by"):
            continue
        if "subjective.allergies" not in set(evidence.get("candidate_fields") or []):
            continue
        spoken = _clean_text(evidence.get("text"))
        context = _clean_text(evidence.get("context")) or ""
        if not spoken:
            continue
        clauses = [
            clause.strip(" ,.;")
            for clause in re.split(r"\s*,?\s*\bbut\b\s*|\s*,?\s*\band\b(?=\s+(?:no|not|denies?))", spoken, flags=re.IGNORECASE)
            if clause.strip(" ,.;")
        ]
        for clause in clauses:
            clause_is_negated = bool(_NEGATION_RE.search(clause))
            if clause_is_negated:
                combined = f"{context} {clause}".lower()
                if re.search(r"\b(?:drug|medicine|medication)s?\b.*\ballerg|\ballerg\w*\b.*\b(?:drug|medicine|medication)s?\b", combined):
                    allergy = "No known drug allergies"
                elif re.search(r"\ballerg", clause, re.IGNORECASE):
                    allergy = clause[:1].upper() + clause[1:]
                elif re.search(r"\ballerg", context, re.IGNORECASE):
                    allergy = "No known allergies"
                else:
                    continue
            elif re.search(r"\b(?:allerg|reaction|rash|swelling|itching)\w*\b", clause, re.IGNORECASE):
                # When another fact precedes an explicit allergy assertion in
                # the same STT sentence ("fever ... and I have dust allergy"),
                # scope extraction to the nearest assertion instead of using
                # the earlier "I have" as the allergen boundary.
                allergy_clause = re.split(
                    r"\band\s+(?=(?:i|the\s+patient|patient)\s+(?:have|has)\b)",
                    clause,
                    flags=re.IGNORECASE,
                )[-1].strip()
                allergic_to = re.search(r"\ballergic\s+to\s+(.+?)(?:[.,;]|$)", allergy_clause, re.IGNORECASE)
                has_allergy = re.search(
                    r"\b(?:i\s+have|patient\s+has|has|have)\s+(?:a\s+|an\s+)?"
                    r"(?:(?:slight|mild|moderate|severe)\s+)?(.+?)\s+allerg(?:y|ies)\b",
                    allergy_clause,
                    re.IGNORECASE,
                )
                if allergic_to:
                    allergy = f"{allergic_to.group(1).strip().title()} allergy"
                elif has_allergy:
                    allergy = f"{has_allergy.group(1).strip().title()} allergy"
                else:
                    allergy = allergy_clause
            else:
                # A bare "yes" does not state the allergen or reaction.
                continue
            if allergy.lower() not in {item.lower() for item in allergy_evidence}:
                allergy_evidence.append(allergy)
    sub["allergies"] = allergy_evidence

    # These optional Subjective histories come only from exact patient or
    # caregiver statements. Doctor questions and unspoken assumptions are
    # deliberately excluded. Split a mixed family/social sentence into its
    # exact clauses so the same text is not duplicated across both fields.
    family_words = re.compile(
        r"\b(?:family history|father|mother|parent|parents|brother|sister|sibling|"
        r"grandfather|grandmother|grandparent|son|daughter|uncle|aunt)\b",
        re.IGNORECASE,
    )
    social_words = re.compile(
        r"\b(?:smok\w*|cigarette\w*|tobacco|alcohol|drink\w*|substance|drug use|occupation|"
        r"work(?:ing|s)?|job|living|live with|exercise|physical activity)\b",
        re.IGNORECASE,
    )

    def exact_optional_history(field: str, matcher: re.Pattern[str]) -> list[str]:
        values: list[str] = []
        other_matcher = social_words if field == "subjective.family_history" else family_words
        for evidence in evidence_ledger or []:
            if evidence.get("speaker") not in {"patient", "caregiver"}:
                continue
            if evidence.get("is_question") or evidence.get("superseded_by"):
                continue
            if field not in set(evidence.get("candidate_fields") or []):
                continue
            spoken = _clean_text(evidence.get("text"))
            if not spoken:
                continue
            pieces = [spoken]
            if matcher.search(spoken) and other_matcher.search(spoken):
                pieces = [
                    part.strip(" ,.;")
                    for part in re.split(r"\s+(?:and|but)\s+", spoken, flags=re.IGNORECASE)
                    if part.strip(" ,.;")
                ]
            for piece in pieces:
                if not matcher.search(piece):
                    continue
                value = piece
                if field == "subjective.social_history" and re.search(r"\bcigarette\w*\b", piece, re.IGNORECASE):
                    details = []
                    quantity = re.search(
                        r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)"
                        r"(?:\s+or\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+))?\s+cigarettes?\b",
                        piece,
                        re.IGNORECASE,
                    )
                    if quantity:
                        details.append(quantity.group(0))
                    for qualifier_pattern in (r"\bnot\s+(?:even\s+)?daily\b", r"\bvery\s+rare\b", r"\brarely\b", r"\boccasionally\b"):
                        qualifier = re.search(qualifier_pattern, piece, re.IGNORECASE)
                        if qualifier:
                            details.append(qualifier.group(0))
                    value = "Cigarette smoking" + (f": {'; '.join(details)}" if details else "")
                if value.lower() not in {item.lower() for item in values}:
                    values.append(value)
        return values

    sub["family_history"] = exact_optional_history("subjective.family_history", family_words)
    sub["social_history"] = exact_optional_history("subjective.social_history", social_words)

    # Physical Examination is for clinician-observed findings, not symptoms,
    # diagnoses, or generated placeholders. Keep a finding only when an exact
    # doctor statement was routed to examination and contains examination or
    # direct-observation wording.
    physical_exam = obj.get("physical_examination") if isinstance(obj.get("physical_examination"), dict) else {}
    exam_cue = re.compile(
        r"\b(?:on\s+examination|examined|examination\s+(?:shows?|reveals?)|auscultat\w*|"
        r"inspect\w*|palpat\w*|percuss\w*|appears?\s+(?:well|unwell|ill|tired|pale)|"
        r"looks?\s+(?:well|unwell|ill|tired|pale)|"
        r"(?:chest|lungs?|throat|tonsils?|abdomen|heart|skin)\s+(?:is|are|sounds?)\s+"
        r"(?:clear|normal|red|swollen|tender|inflamed)|"
        r"breath\s+sounds?|wheez\w*|crackle\w*|tenderness|swelling|redness)\b",
        re.IGNORECASE,
    )
    placeholder_exam = re.compile(
        r"^(?:no\s+(?:findings?|examination)\s*(?:reported|recorded)?|not\s+(?:examined|reported|recorded|discussed)|"
        r"normal|unremarkable|none|unknown)$",
        re.IGNORECASE,
    )

    def supported_exam(value: Any) -> bool:
        text = _clean_text(value)
        if not text or placeholder_exam.fullmatch(text):
            return False
        candidate_tokens = set(_evidence_text(text).split())
        for evidence in evidence_ledger or []:
            if evidence.get("speaker") != "doctor" or evidence.get("is_question") or evidence.get("superseded_by"):
                continue
            if "objective.physical_examination" not in set(evidence.get("candidate_fields") or []):
                continue
            spoken = _clean_text(evidence.get("text")) or ""
            if not exam_cue.search(spoken):
                continue
            evidence_tokens = set(_evidence_text(spoken).split())
            if candidate_tokens and len(candidate_tokens & evidence_tokens) / len(candidate_tokens) >= 0.5:
                return True
        return False

    clean_exam: dict[str, Any] = {}
    for exam_field in ("general", "respiratory", "cardiovascular", "ent", "abdomen", "neurological"):
        finding = physical_exam.get(exam_field)
        clean_exam[exam_field] = _clean_text(finding) if supported_exam(finding) else None
    clean_exam["other"] = [
        finding for finding in (physical_exam.get("other") or [])
        if supported_exam(finding)
    ] if isinstance(physical_exam.get("other"), list) else []
    obj["physical_examination"] = clean_exam

    # --- Assessment filters ---

    # Filter all assessment string arrays by contradiction
    for ax_field in ("provisional_diagnosis", "confirmed_diagnosis", "differential_diagnoses", "problems_being_managed"):
        items = ass.get(ax_field)
        if isinstance(items, list):
            ass[ax_field] = [item for item in items if not contradicts_negative(item)]

    # Filter clinical_impression (now string/null)
    ci = ass.get("clinical_impression")
    if ci and contradicts_negative(ci):
        ass["clinical_impression"] = None

    # 2. Every prescription must be supported by doctor evidence.
    plan["prescriptions"] = _validate_prescriptions_against_transcript(
        plan.get("prescriptions"), transcript, evidence_ledger
    )

    # 3. Follow-up must be supported by doctor evidence.
    fu_text = plan.get("follow_up") or ""
    if fu_text:
        if not _is_supported_by_doctor_evidence(fu_text, evidence_ledger, transcript):
            plan["follow_up"] = None
        else:
            spoken = _spoken_transcript_span(fu_text, transcript)
            if not (spoken and fp.search(spoken)):
                plan["follow_up"] = None
    if not plan.get("follow_up"):
        for field in ("treatment_advice",):
            items = plan.get(field)
            if isinstance(items, list):
                for item in items:
                    if not isinstance(item, str) or not fp.search(item):
                        continue
                    if _is_supported_by_doctor_evidence(item, evidence_ledger, transcript):
                        plan["follow_up"] = item.strip()
                        plan[field] = [x for x in items if x != item]
                        break
            if plan.get("follow_up"):
                break

    # 4. Warning signs must be supported by doctor evidence with warning context.
    existing_ws = []
    for item in plan.get("warning_signs") or []:
        if _is_supported_by_doctor_evidence(item, evidence_ledger, transcript, warning_only=True):
            warning = exact_doctor_statement(item) or _clean_text(item)
            if warning and warning.lower() not in {value.lower() for value in existing_ws}:
                existing_ws.append(warning)
    ws_lower = {value.lower() for value in existing_ws}

    for field in ("treatment_advice",):
        items = plan.get(field)
        if isinstance(items, list):
            moved = []
            for item in items:
                if not isinstance(item, str) or not ws_pat.search(item):
                    continue
                if _is_supported_by_doctor_evidence(item, evidence_ledger, transcript, warning_only=True):
                    warning = exact_doctor_statement(item) or _clean_text(item)
                    if warning and warning.lower() not in ws_lower:
                        existing_ws.append(warning)
                        ws_lower.add(warning.lower())
                        moved.append(item)
            if moved:
                plan[field] = [x for x in items if x not in moved]

    plan["warning_signs"] = existing_ws

    def valid_assessment_text(value: Any) -> bool:
        text = (_clean_text(value) or "").strip()
        if not text:
            return False
        return not bool(
            re.fullmatch(
                r"(?:more\s+(?:of\s+)?(?:an?\s+)?)?(?:emergency|warning\s+signs?|serious|bigger)",
                text,
                re.IGNORECASE,
            )
            or re.fullmatch(
                r"(?:it\s+(?:could|might|may)\s+be\s+)?(?:much|something|anything)\s+(?:more|worse)(?:\s+than)?",
                text,
                re.IGNORECASE,
            )
            or re.fullmatch(
                r"(?:what\s+kind\s+of\s+thing|something\s+like\s+that|like\s+that|that|"
                r"(?:some|any)\s+.+?\s+(?:issues?|problems?|symptoms?))",
                text,
                re.IGNORECASE,
            )
            or bool(re.match(r"^(?:if\b|you\s+should\b|call\b|come\b|return\b)", text, re.IGNORECASE))
        )

    def supported_assessment(value: Any, field: str) -> bool:
        if evidence_ledger is None:
            return _is_supported_by_doctor_evidence(value, evidence_ledger, transcript)
        candidate_tokens = set(_evidence_text(value).split())
        if not candidate_tokens:
            return False
        for evidence in evidence_ledger:
            if evidence.get("speaker") != "doctor" or evidence.get("is_question") or evidence.get("superseded_by"):
                continue
            if field not in set(evidence.get("candidate_fields") or []):
                continue
            evidence_tokens = set(_evidence_text(evidence.get("text")).split())
            if len(candidate_tokens & evidence_tokens) / len(candidate_tokens) >= 0.6:
                return True
        return False

    # Provisional and differential fields are rebuilt below from explicit
    # diagnostic grammar. This prevents warning-sign or conversational filler
    # from surviving merely because the same words occur in a doctor statement.
    if evidence_ledger is not None:
        ass["provisional_diagnosis"] = []
        ass["differential_diagnoses"] = []
        ass["clinical_impression"] = None

    # Confirmed diagnoses and managed problems retain only correctly routed
    # doctor evidence.
    assessment_fields_to_filter = (
        ("confirmed_diagnosis", "problems_being_managed")
        if evidence_ledger is not None
        else ("provisional_diagnosis", "confirmed_diagnosis", "differential_diagnoses", "problems_being_managed")
    )
    for ax_field in assessment_fields_to_filter:
        items = ass.get(ax_field)
        if isinstance(items, list):
            ass[ax_field] = [
                item for item in items
                if valid_assessment_text(item)
                and supported_assessment(item, f"assessment.{ax_field}")
            ]
    if evidence_ledger is None:
        ci = ass.get("clinical_impression")
        if ci and (not valid_assessment_text(ci) or not _is_supported_by_doctor_evidence(ci, None, transcript)):
            ass["clinical_impression"] = None

    # 6. Plan fields require doctor evidence per item
    for field in ("treatment_advice", "diet_lifestyle_advice", "monitoring", "tests_ordered", "procedures", "referrals", "other_instructions"):
        items = plan.get(field)
        if isinstance(items, list):
            plan[field] = [item for item in items if _is_supported_by_doctor_evidence(item, evidence_ledger, transcript)]

    # A liquid medicine dose such as "drink 5 ml of it" is prescription
    # evidence, not hydration or diet advice.
    for field in ("treatment_advice", "diet_lifestyle_advice"):
        items = plan.get(field)
        if isinstance(items, list):
            plan[field] = [
                item for item in items
                if not (
                    isinstance(item, str)
                    and _SPOKEN_DOSE_RE.search(item)
                    and re.search(r"\b(?:it|medicine|medication|syrup|tablet|capsule)\b", item, re.IGNORECASE)
                )
            ]

    # The local model can occasionally return a schema-valid but incomplete
    # Assessment/Plan. Recover only verbatim, non-question doctor statements
    # that the RAG ledger routes to a SOAP destination. This fallback never
    # creates clinical wording or uses patient statements.
    doctor_statements = [
        entry for entry in (evidence_ledger or [])
        if entry.get("speaker") == "doctor"
        and not entry.get("is_question")
        and not entry.get("superseded_by")
        and _clean_text(entry.get("text"))
    ]

    def append_exact(field: str, text: str) -> None:
        items = plan.get(field)
        if not isinstance(items, list):
            items = []
        clean = text.strip()
        clean_key = _evidence_text(clean)
        existing_keys = [_evidence_text(item) for item in items]
        is_duplicate = any(
            clean_key == key or clean_key in key or key in clean_key
            for key in existing_keys if clean_key and key
        )
        if clean and not is_duplicate:
            items.append(clean)
        plan[field] = items

    # Recover explicitly stated diagnostic meaning by grammatical role. The
    # captured values remain exact transcript substrings: no disease list or
    # medical-knowledge expansion is used. A main opinion ("looks like X") is
    # kept separate from alternatives explicitly introduced by "such as",
    # "including", "like", "or", "versus", or "vs".
    main_diagnosis_patterns = (
        re.compile(
            r"\b(?:seems?|looks?|sounds?|feels?)\s+(?:like|to\s+be)\s+(?:a\s+|an\s+)?"
            r"(.+?)(?=\s*,?\s*\b(?:but|however|although)\b|[.;]|$)",
            re.IGNORECASE,
        ),
        re.compile(
            r"\b(?:likely|probably|possibly|suspected?)\s+(?:a\s+|an\s+)?"
            r"(.+?)(?=\s*,?\s*\b(?:but|however|although)\b|[.;]|$)",
            re.IGNORECASE,
        ),
        re.compile(
            r"\b(?:diagnosis|clinical impression)\s+is\s+(?:a\s+|an\s+)?(.+?)(?=[.;]|$)",
            re.IGNORECASE,
        ),
        re.compile(
            r"\b(?:might|may|could)\s+be\s+(?:a\s+|an\s+)?"
            r"(.+?)(?=\s*,?\s*\b(?:but|however|although|like|such\s+as|including)\b|[.;]|$)",
            re.IGNORECASE,
        ),
    )

    def add_assessment_item(field: str, value: str) -> None:
        clean = value.strip(" ,.;")
        if not valid_assessment_text(clean):
            return
        items = ass.get(field)
        if not isinstance(items, list):
            items = []
        if clean.lower() not in {str(item).lower() for item in items}:
            items.append(clean)
        ass[field] = items

    for entry in doctor_statements:
        fields = set(entry.get("candidate_fields") or [])
        spoken = str(entry.get("text")).strip()

        main_diagnosis: Optional[str] = None
        for pattern in main_diagnosis_patterns:
            match = pattern.search(spoken)
            if match:
                candidate = match.group(1).strip(" ,.;")
                candidate = re.sub(r"^(?:it\s+is|it's)\s+", "", candidate, flags=re.IGNORECASE).strip()
                candidate = re.sub(r"\s+(?:right\s+now|at\s+present|currently)$", "", candidate, flags=re.IGNORECASE).strip()
                if valid_assessment_text(candidate) and not re.match(
                    r"^(?:more\s+than|more\s+of|an?\s+emergency|that\b)",
                    candidate,
                    re.IGNORECASE,
                ):
                    main_diagnosis = candidate
                    break

        if main_diagnosis:
            if not ass.get("clinical_impression"):
                ass["clinical_impression"] = main_diagnosis
            if (
                "assessment.provisional_diagnosis" in fields
                or re.search(r"\b(?:likely|probably|possibly|suspect\w*|might|may|could|looks?|sounds?|seems?|feels?|appears?)\b", spoken, re.IGNORECASE)
            ):
                add_assessment_item("provisional_diagnosis", main_diagnosis)

        alternative_texts: list[str] = []
        marker_tails: list[str] = []
        diagnostic_alternative_context = bool(
            "assessment.differential_diagnoses" in fields
            or re.search(r"\b(?:differential|diagnos\w*|likely|probably|possibly|suspect\w*|could|might|may|maybe|possibilit\w*)\b", spoken, re.IGNORECASE)
        )
        if diagnostic_alternative_context:
            for marker in re.finditer(r"\b(?:such\s+as|including|for\s+example|like)\b", spoken, re.IGNORECASE):
                prefix = spoken[max(0, marker.start() - 12):marker.start()]
                if re.search(r"(?:look|sound|seem|feel)s?\s*$", prefix, re.IGNORECASE):
                    continue
                tail = spoken[marker.end():].lstrip()
                marker_tails.append(re.split(r"[.;]", tail, maxsplit=1)[0])
        if marker_tails:
            def useful_alternative_count(tail: str) -> int:
                return sum(
                    1 for part in re.split(r"\s*(?:,|\bor\b|\bversus\b|\bvs\.?\b)\s*", tail, flags=re.IGNORECASE)
                    if valid_assessment_text(re.sub(r"^like\s+", "", part.strip(" ,.;"), flags=re.IGNORECASE))
                )
            # Prefer the shortest tail containing the largest number of useful
            # alternatives. This drops filler around repeated "like" markers.
            alternative_texts.append(sorted(marker_tails, key=lambda tail: (-useful_alternative_count(tail), len(tail)))[0])

        explicit_choice = re.search(
            r"\b(?:either|possibilities?\s+(?:include|are)|differential\s+(?:includes?|is))\s+(.+?)(?=[.;]|$)",
            spoken,
            re.IGNORECASE,
        )
        if explicit_choice:
            alternative_texts.append(explicit_choice.group(1))

        for alternatives in alternative_texts:
            for alternative in re.split(r"\s*(?:,|\bor\b|\bversus\b|\bvs\.?\b)\s*", alternatives, flags=re.IGNORECASE):
                candidate = alternative.strip(" ,.;")
                candidate = re.sub(r"^like\s+", "", candidate, flags=re.IGNORECASE).strip()
                if candidate and valid_assessment_text(candidate):
                    add_assessment_item("differential_diagnoses", candidate)

    test_name = re.compile(r"\b(?:blood\s+test|blood\s*work|CBC|CRP|ESR|urine\s+test|x[- ]?ray|ultrasound|MRI|CT\s+scan|ECG|EKG|culture|rapid\s+antigen\s+test)\b", re.IGNORECASE)
    procedure_words = re.compile(r"\b(?:procedure|dressing|sutur|nebuliz|injection|drainage|biopsy|endoscopy|operation|surgery)\w*\b", re.IGNORECASE)
    treatment_words = re.compile(r"\b(?:recommend|suggest|advise|home remed|rest|gargle|steam|avoid|stop smoking|wear(?:ing)?\s+(?:a\s+)?mask)\b", re.IGNORECASE)
    monitoring_words = re.compile(r"\b(?:monitor|measure|record|track|check)\b", re.IGNORECASE)
    referral_words = re.compile(r"\b(?:refer|referral|specialist|consult\s+(?:a|the)|see\s+(?:a|the)\s+\w+(?:ologist|ician))\b", re.IGNORECASE)
    urgency_action = re.compile(r"\b(?:immediately|urgently|at once)\b.*\b(?:come|return|meet|seek|go|call|visit)\b|\b(?:come|return|meet|seek|go|call|visit)\b.*\b(?:immediately|urgently|at once)\b", re.IGNORECASE)
    followup_extra = re.compile(r"\b(?:tomorrow|next\s+(?:day|week|month)|show\s+(?:me\s+)?(?:the\s+)?report)\b", re.IGNORECASE)
    warning_detail = re.compile(r"\b(?:if|when|have|having|experience|experiencing|feel|feeling|develop|worsen|pain|fever|breath|dizz|tired|vomit|drows|bleed|swelling|rash|stop)\w*\b", re.IGNORECASE)
    warning_action = re.compile(r"\b(?:come|return|meet|seek|go|call|visit|emergency|warning\s+sign)\w*\b", re.IGNORECASE)
    direct_care = re.compile(r"\b(?:home remed|rest|gargle|steam|wear(?:ing)?\s+(?:a\s+)?mask)\b", re.IGNORECASE)
    advice_instruction = re.compile(r"\b(?:recommend|suggest|advise|prefer|should|must|please|avoid|consume|eat|drink|hydrate|cooked|stop)\w*\b", re.IGNORECASE)

    warning_fragments: list[str] = []
    followup_candidates: list[str] = []
    for entry in doctor_statements:
        spoken = str(entry.get("text")).strip()
        fields = set(entry.get("candidate_fields") or [])

        matched_test = test_name.search(spoken)
        if "plan.tests_ordered" in fields and matched_test:
            # Store the exact spoken test name, not the surrounding follow-up
            # wording, so repeated instructions do not create duplicates.
            append_exact("tests_ordered", matched_test.group(0))
        if "plan.procedures" in fields and procedure_words.search(spoken):
            append_exact("procedures", spoken)
        if "plan.referrals" in fields and referral_words.search(spoken):
            append_exact("referrals", spoken)
        if "plan.monitoring" in fields and monitoring_words.search(spoken):
            append_exact("monitoring", spoken)
        if "plan.other_instructions" in fields:
            append_exact("other_instructions", spoken)

        has_warning_phrase = bool(re.search(r"\bwarning\s+sign", spoken, re.IGNORECASE))
        is_warning_detail = bool(has_warning_phrase and warning_detail.search(spoken))
        is_medicine_dose = bool(
            _SPOKEN_DOSE_RE.search(spoken)
            and re.search(r"\b(?:it|medicine|medication|syrup|tablet|capsule)\b", spoken, re.IGNORECASE)
        )
        if is_medicine_dose:
            pass
        elif direct_care.search(spoken):
            append_exact("treatment_advice", spoken)
        elif _DIET_LIFESTYLE_RE.search(spoken) and advice_instruction.search(spoken) and not is_warning_detail:
            append_exact("diet_lifestyle_advice", spoken)
        elif "plan.treatment_advice" in fields and treatment_words.search(spoken) and not is_warning_detail:
            append_exact("treatment_advice", spoken)

        if fp.search(spoken) or followup_extra.search(spoken):
            followup_candidates.append(spoken)
        direct_warning_context = bool(
            warning_detail.search(spoken)
            and warning_action.search(spoken)
            and (ws_pat.search(spoken) or urgency_action.search(spoken) or has_warning_phrase)
        )
        if direct_warning_context or is_warning_detail:
            warning_fragments.append(spoken)

    if not plan.get("follow_up") and followup_candidates:
        timed = [item for item in followup_candidates if followup_extra.search(item)]
        plan["follow_up"] = (timed or followup_candidates)[-1]

    if not plan.get("warning_signs") and warning_fragments:
        # Keep exact warning fragments so neither the conditions nor the
        # doctor's instructed urgent action is lost.
        plan["warning_signs"] = list(dict.fromkeys(warning_fragments))

    # The historical RAG advice rule covers both treatment and diet/lifestyle.
    # Re-route only explicit, grounded advice containing clear diet/lifestyle
    # language; never create or paraphrase an instruction.
    treatment_items = plan.get("treatment_advice") or []
    diet_items = list(plan.get("diet_lifestyle_advice") or [])
    retained_treatment: list[str] = []
    for item in treatment_items:
        is_direct_care = isinstance(item, str) and bool(re.search(r"\b(?:home remed|rest|gargle|steam|wear(?:ing)?\s+(?:a\s+)?mask)\b", item, re.IGNORECASE))
        if isinstance(item, str) and _DIET_LIFESTYLE_RE.search(item) and not is_direct_care:
            if item not in diet_items:
                diet_items.append(item)
        else:
            retained_treatment.append(item)
    plan["treatment_advice"] = retained_treatment
    plan["diet_lifestyle_advice"] = [
        item for item in diet_items
        if isinstance(item, str) and advice_instruction.search(item)
    ]

    # Keep the clearest single copy when model output and exact RAG recovery
    # contain the same advice with different punctuation or capitalization.
    for field in ("treatment_advice", "diet_lifestyle_advice"):
        deduplicated: list[str] = []
        for item in plan.get(field) or []:
            clean = _clean_text(item)
            key = _evidence_text(clean)
            if not clean or not key:
                continue
            duplicate_index = next(
                (
                    index for index, existing in enumerate(deduplicated)
                    if key == _evidence_text(existing)
                    or key in _evidence_text(existing)
                    or _evidence_text(existing) in key
                ),
                None,
            )
            if duplicate_index is None:
                deduplicated.append(clean)
            elif len(clean) > len(deduplicated[duplicate_index]):
                deduplicated[duplicate_index] = clean
        plan[field] = deduplicated

    # 7. HPI from the structured chief complaints if missing
    if not sub.get("history_of_present_illness"):
        complaints = sub.get("chief_complaints") or []
        if isinstance(complaints, list):
            parts = []
            for complaint in complaints:
                if isinstance(complaint, dict) and complaint.get("complaint"):
                    name = complaint["complaint"]
                    details = []
                    if complaint.get("severity"):
                        details.append(complaint["severity"])
                    if complaint.get("course"):
                        details.append(complaint["course"])
                    if complaint.get("duration"):
                        details.append(f"for {complaint['duration']}")
                    if details:
                        parts.append(f"{name} {' '.join(details)}")
                    else:
                        parts.append(name)
            if parts:
                sub["history_of_present_illness"] = "Patient presents with " + ", ".join(parts) + "."

    return source


def _strip_unsupported_clinical_content(ehr: dict[str, Any], evidence_ledger: list[dict[str, Any]]) -> dict[str, Any]:
    """Remove clinical content not supported by doctor evidence.

    Assessment fields (clinical_impression, provisional_diagnosis, etc.) and Plan fields
    (prescriptions, tests, treatment, warning signs, etc.) require doctor
    statements in the consultation. Patient-only consultations cannot
    independently support these sections. Uncertain omissions should
    become review flags, not auto-populated facts.
    """
    if not isinstance(ehr, dict):
        return ehr
    has_doctor = any(
        e.get("speaker") == "doctor" and not e.get("is_question")
        for e in (evidence_ledger or [])
    )
    if not has_doctor:
        ehr["assessment"] = _empty_soap_ehr()["assessment"]
        ehr["plan"]["prescriptions"] = []
        ehr["plan"]["tests_ordered"] = []
        ehr["plan"]["procedures"] = []
        ehr["plan"]["treatment_advice"] = []
        ehr["plan"]["diet_lifestyle_advice"] = []
        ehr["plan"]["monitoring"] = []
        ehr["plan"]["referrals"] = []
        ehr["plan"]["warning_signs"] = []
        ehr["plan"]["other_instructions"] = []
    return ehr


def _segments_payload(segments: list[TranscriptSegment]) -> list[dict[str, Any]]:
    return [segment.model_dump() for segment in segments if segment.text.strip()]


def _transcript_text(segments: list[dict[str, Any]]) -> str:
    lines = []
    for seg in segments:
        speaker = seg.get("speaker", "Speaker")
        text = seg.get("text", "").strip()
        if not text:
            continue
        line = f"{speaker}: {text}"
        corrections = seg.get("corrections", [])
        second_pass = seg.get("second_pass_transcript")
        flags = seg.get("flags", [])
        annotations = []
        if second_pass:
            annotations.append(f"[second_pass: {second_pass}]")
        if corrections:
            for c in corrections:
                annotations.append(f"[uncertain: heard '{c.get('original', '')}', possible '{c.get('suggested', '')}', needs_review=true]")
        if flags:
            for f in flags:
                if f.get("needs_review"):
                    annotations.append(f"[flagged: {f.get('text', '')} - {f.get('reason', 'inconsistent')}]")
        if annotations:
            line += " " + " ".join(annotations)
        lines.append(line)
    return "\n".join(lines)


def _build_doctor_ehr_view(ehr: dict[str, Any]) -> dict[str, Any]:
    """Transform structured SOAP into a clean doctor-facing presentation.

    - removes null/absent vitals
    - includes a sentinel for empty Assessment (never hides the A section)
    - removes empty plan sections
    - preserves SOAP structure and all clinical facts
    - does NOT perform clinical inference
    """
    view: dict[str, Any] = {}
    source = ehr if isinstance(ehr, dict) else {}

    # Subjective — pass through as-is (frontend handles details)
    view["subjective"] = source.get("subjective", {})

    # Objective — strip vitals with no actual measurement
    obj = source.get("objective", {}) or {}
    vitals = obj.get("vitals", {}) or {}
    clean_vitals: dict[str, Any] = {}
    for key in ("temperature", "blood_pressure", "pulse", "respiratory_rate", "spo2", "weight", "height", "bmi"):
        v = vitals.get(key)
        if isinstance(v, dict):
            val = v.get("value")
            if key == "blood_pressure":
                sys_val = v.get("systolic")
                dia_val = v.get("diastolic")
                if sys_val is not None or dia_val is not None:
                    clean_vitals[key] = v
            elif val is not None:
                clean_vitals[key] = v
    view["objective"] = {
        "vitals": clean_vitals,
        "physical_examination": obj.get("physical_examination", {}),
        "investigations": obj.get("investigations", []),
    }

    # Assessment — always present, even when empty
    ass = source.get("assessment", {}) or {}
    ci = ass.get("clinical_impression")
    has_content = bool(ci) or bool(ass.get("provisional_diagnosis")) or bool(ass.get("confirmed_diagnosis")) or bool(ass.get("differential_diagnoses")) or bool(ass.get("problems_being_managed"))
    view["assessment"] = {
        "clinical_impression": ci,
        "provisional_diagnosis": ass.get("provisional_diagnosis") or [],
        "confirmed_diagnosis": ass.get("confirmed_diagnosis") or [],
        "differential_diagnoses": ass.get("differential_diagnoses") or [],
        "problems_being_managed": ass.get("problems_being_managed") or [],
        "_empty": not has_content,
    }

    # Plan — only include sections with actual content
    plan = source.get("plan", {}) or {}
    clean_plan: dict[str, Any] = {}
    for key in (
        "prescriptions", "tests_ordered", "procedures",
        "treatment_advice", "diet_lifestyle_advice", "monitoring",
        "referrals", "follow_up", "warning_signs", "other_instructions",
    ):
        val = plan.get(key)
        if key == "follow_up":
            if _clean_text(val):
                clean_plan[key] = val
        else:
            if isinstance(val, list) and val:
                clean_plan[key] = val

    view["plan"] = clean_plan

    return view


def _encounter_payload(encounter: ClinicalEncounter, include_transcript: bool = True) -> dict[str, Any]:
    raw_ehr = encounter.ehr_data or {}
    raw_summary = encounter.patient_summary or {}
    migrated_ehr = _normalize_ehr(raw_ehr)
    migrated_summary = _normalize_patient_summary(raw_summary)
    payload = {
        "id": encounter.id,
        "encounter_id": encounter.encounter_id,
        "clinic_id": encounter.clinic_id,
        "patient_id": encounter.patient_id,
        "doctor_id": encounter.doctor_id,
        "appointment_id": encounter.appointment_id,
        "patient_name": encounter.patient_name,
        "status": encounter.status,
        "ehr_data": migrated_ehr,
        "patient_summary": migrated_summary,
        "model_name": encounter.model_name,
        "approved_at": encounter.approved_at,
        "approved_by": encounter.approved_by,
        "created_at": encounter.created_at,
        "updated_at": encounter.updated_at,
    }
    if encounter.status == "draft" and _is_soap_ehr(migrated_ehr):
        # Review-only preview derived from the current SOAP draft. It is not
        # stored as the patient-visible summary; approval still creates the
        # final summary from the doctor's saved SOAP record.
        payload["patient_summary_preview"] = _generate_patient_summary_from_soap(migrated_ehr)
    if include_transcript:
        payload["transcript_segments"] = encounter.transcript_segments or []
    return payload


async def _require_clinic(db: AsyncSession, clinic_id: str) -> Clinic:
    result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id.strip()))
    clinic = result.scalar_one_or_none()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    return clinic


async def _require_patient(db: AsyncSession, patient_id: str) -> Patient:
    result = await db.execute(select(Patient).where(Patient.patient_id == patient_id.strip()))
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


async def _require_encounter_for_clinic(db: AsyncSession, encounter_id: str, clinic_id: str) -> ClinicalEncounter:
    result = await db.execute(
        select(ClinicalEncounter).where(
            ClinicalEncounter.encounter_id == encounter_id,
            ClinicalEncounter.clinic_id == clinic_id,
        )
    )
    encounter = result.scalar_one_or_none()
    if not encounter:
        raise HTTPException(status_code=404, detail="EHR encounter not found")
    return encounter


def _build_ehr_prompt(transcript: str, rag_context: str) -> str:
    return (
        "Extract structured SOAP facts from the transcript into JSON with key 'ehr' using the following structure:\n"
        "ehr.subjective:\n"
        "  - chief_complaints: [{\"complaint\": \"...\", \"severity\": \"mild|moderate|severe|null\", \"course\": \"continuous|intermittent|recurrent|worsening|improving|stable|null\", \"duration\": \"...\"}]\n"
        "  - history_of_present_illness: string or null\n"
        "  - relevant_negatives: [\"...\"]\n"
        "  - medical_conditions: [\"...\"]\n"
        "  - allergies: [\"...\"]\n"
        "  - family_history: [\"...\"]\n"
        "  - social_history: [\"...\"]\n"
        "  - current_medications: [{\"name\": \"...\", \"strength\": \"...\", \"dose\": \"...\", \"frequency\": \"...\", \"timing\": \"...\", \"duration\": \"...\", \"source\": \"patient_reported|prescribed\"}]\n"
        "ehr.objective:\n"
        "  - vitals: {temperature, blood_pressure (systolic/diastolic), pulse, respiratory_rate, spo2, weight, height, bmi} each {\"value\": number|null, \"unit\": \"...\", \"source\": \"...\"}\n"
        "  - physical_examination: {\"general\": \"...\", \"respiratory\": \"...\", \"cardiovascular\": \"...\", \"ent\": \"...\", \"abdomen\": \"...\", \"neurological\": \"...\", \"other\": [\"...\"]}\n"
        "  - investigations: [\"...\"]\n"
        "ehr.assessment:\n"
        "  - clinical_impression: string or null\n"
        "  - provisional_diagnosis: [\"...\"]\n"
        "  - confirmed_diagnosis: [\"...\"]\n"
        "  - differential_diagnoses: [\"...\"]\n"
        "  - problems_being_managed: [\"...\"]\n"
        "ehr.plan:\n"
        "  - prescriptions: [{\"medicine_name\": \"...\", \"strength\": \"...\", \"dosage_form\": \"...\", \"dose\": \"...\", \"route\": \"...\", \"frequency\": \"...\", \"schedule\": {\"morning\": \"...\", \"afternoon\": \"...\", \"night\": \"...\"}, \"specific_timing\": \"...\", \"meal_timing\": \"...\", \"duration\": \"...\", \"prn_condition\": \"...\", \"indication\": \"...\", \"instructions\": \"...\", \"action\": \"START|CONTINUE|CHANGE|STOP|PRN\"}]\n"
        "  - tests_ordered: [\"...\"]\n"
        "  - procedures: [\"...\"]\n"
        "  - treatment_advice: [\"...\"]\n"
        "  - diet_lifestyle_advice: [\"...\"]\n"
        "  - monitoring: [\"...\"]\n"
        "  - referrals: [\"...\"]\n"
        "  - follow_up: string or null\n"
        "  - warning_signs: [\"...\"]\n"
        "  - other_instructions: [\"...\"]\n"
        "Rules:\n"
        "- No Markdown, no explanations. Raw JSON only.\n"
        "- Use null for absent fields, empty arrays for list fields.\n"
        "- Be concise. Short phrases, not full sentences, in string values.\n"
        "- Put every current patient-reported symptom or concern in chief_complaints as its own row. Fever, headache, sore throat/throat infection, cough, pain, and similar concerns must not be dropped when explicitly stated.\n"
        "- Do not output a separate symptoms field. chief_complaints is the single source of truth for current symptoms.\n"
        "- For each chief complaint, extract severity, course/pattern, and duration only when supported by the transcript. Map 'slight/slightly/minor' to mild and 'serious/very bad' to severe. Map 'fluctuating/comes and goes/on and off' to intermittent and 'constant/persistent' to continuous. Use null when unstated. Never invent a missing symptom or detail.\n"
        "- Never infer diagnoses, doses, or frequencies not stated by the doctor.\n"
        "- Prescription mapping: medicine_name is the complete spoken medicine name; dose is the spoken quantity such as '1 tablet' or '5 ml'; specific_timing/schedule contains breakfast, lunch, dinner, morning, noon, or night timing; meal_timing contains before-food/after-food wording; duration stays separate.\n"
        "- Do not put meal timing in duration, do not put duration in timing, and do not invent a missing prescription value.\n"
        "- Preserve negation verbatim.\n"
        "- For uncertain [uncertain: ...] annotations use the 'heard' text.\n"
        "- For flagged [flagged: ...] phrases do not extract facts.\n\n"
        "RETRIEVED SOAP KNOWLEDGE:\n" + rag_context + "\n\n"
        "TRANSCRIPT:\n" + transcript
    )


SOAP_SECTION_ORDER = ("subjective", "objective", "assessment", "plan")
SOAP_SECTION_OUTPUT_TOKENS = {
    "subjective": 2048,
    "objective": 1536,
    "assessment": 1280,
    "plan": 2304,
}
SOAP_SECTION_RULES = {
    "subjective": (
        "Use patient/caregiver assertions. Doctor questions are context only and are never facts. "
        "Preserve explicit allergy denials and positive allergens. Current medicines are history, not prescriptions. "
        "For every chief complaint, capture explicitly spoken severity and course/progression in their dedicated fields; "
        "leave either field null when it was not spoken."
    ),
    "objective": (
        "Use measurements, investigations, and clinician-observed examination findings only. "
        "Do not turn patient symptoms or unperformed examination items into findings."
    ),
    "assessment": (
        "Use only clinical opinions or diagnoses explicitly stated by the doctor. Separate the main impression, "
        "provisional/confirmed diagnoses, explicit alternatives, and problems being managed."
    ),
    "plan": (
        "Use only doctor instructions and decisions. Keep prescriptions, tests, procedures, treatment advice, "
        "diet/lifestyle advice, monitoring, referrals, warnings, other instructions, and follow-up separate. "
        "A repeated identical medicine instruction is corroboration, not arithmetic: never add repeated doses. "
        "Merge complementary details for the same complete medicine name; change a value only after an explicit correction. "
        "Put breakfast/lunch/dinner in specific_timing and put explicitly spoken after-food/before-food wording in meal_timing."
    ),
}


def _soap_section_schema(section: str) -> dict[str, Any]:
    section_schema = SOAP_EHR_JSON_SCHEMA["properties"]["ehr"]["properties"][section]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [section],
        "properties": {section: section_schema},
    }


def _soap_sections_schema(sections: tuple[str, ...]) -> dict[str, Any]:
    section_properties = SOAP_EHR_JSON_SCHEMA["properties"]["ehr"]["properties"]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": list(sections),
        "properties": {section: section_properties[section] for section in sections},
    }


def _build_section_prompt(section: str, rag_bundle: dict[str, Any]) -> str:
    section_context = render_section_soap_rag_context(rag_bundle, section)
    empty_shape = _empty_soap_ehr()[section]
    return (
        f"Extract only the {section.upper()} section of a SOAP EHR. Return raw JSON with exactly one top-level key "
        f"named '{section}'.\n"
        "The exact evidence below is the only source of clinical facts. Do not infer, calculate, normalize, rename, "
        "or add clinical information. Ignore evidence that does not belong in this section. Preserve negation and "
        "complete spoken medicine names. Leave undiscussed values null or empty.\n"
        f"SECTION-SPECIFIC RULE: {SOAP_SECTION_RULES[section]}\n"
        f"REQUIRED EMPTY SHAPE: {json.dumps(empty_shape, ensure_ascii=False, separators=(',', ':'))}\n\n"
        + section_context
    )


def _build_section_group_prompt(sections: tuple[str, ...], rag_bundle: dict[str, Any]) -> str:
    blocks: list[str] = []
    for section in sections:
        empty_shape = _empty_soap_ehr()[section]
        blocks.append(
            f"--- {section.upper()} ---\n"
            f"RULE: {SOAP_SECTION_RULES[section]}\n"
            f"REQUIRED SHAPE: {json.dumps(empty_shape, ensure_ascii=False, separators=(',', ':'))}\n"
            + render_section_soap_rag_context(rag_bundle, section)
        )
    names = ", ".join(sections)
    return (
        f"Extract only these SOAP sections: {names}. Return raw JSON with exactly those top-level keys.\n"
        "Each section has its own routed evidence block. That exact evidence is the only source of clinical facts. "
        "Do not infer, calculate, normalize, rename, or add clinical information. Ignore evidence that does not "
        "belong in the current section. Preserve negation and complete spoken medicine names. Leave undiscussed "
        "values null or empty. Never copy a fact merely because it appears in the other section's evidence.\n\n"
        + "\n\n".join(blocks)
    )


async def _generate_with_ollama(transcript: str, rag_bundle: dict[str, Any]) -> tuple[dict[str, Any], str, list[dict[str, Any]]]:
    """Generate SOAP in two concurrently executed, section-routed jobs."""
    model = ehr_model_name()
    configured_context_window = ehr_context_window_tokens()
    configured_initial_output = ehr_initial_output_tokens()
    configured_max_output = ehr_max_output_tokens()
    timeout = aiohttp.ClientTimeout(total=ehr_generation_timeout_seconds())

    async def _generate_group(
        session: aiohttp.ClientSession,
        sections: tuple[str, ...],
    ) -> dict[str, dict[str, Any]]:
        group_name = "+".join(section.upper()[0] for section in sections)
        prompt = _build_section_group_prompt(sections, rag_bundle)
        schema = _soap_sections_schema(sections)
        target_output = sum(SOAP_SECTION_OUTPUT_TOKENS[section] for section in sections)
        initial_output = min(configured_max_output, max(configured_initial_output, min(target_output, 3584)))
        retry_output = min(configured_max_output, max(initial_output * 2, initial_output + 768))
        estimated_required = math.ceil(len(prompt) / 3.5) + retry_output + 512
        context_window = min(
            configured_context_window,
            max(8192, math.ceil(estimated_required / 2048) * 2048),
        )
        initial_output = min(initial_output, context_window // 2)
        retry_output = min(retry_output, context_window // 2)

        async def _request(num_predict: int) -> dict[str, Any]:
            request_body = {
                "model": model,
                "stream": False,
                "keep_alive": "10m",
                "think": "low",
                "format": schema,
                "messages": [{"role": "user", "content": prompt}],
                "options": {
                    "temperature": 0.1,
                    "num_predict": num_predict,
                    "num_ctx": context_window,
                    "think": "low",
                },
            }
            try:
                async with session.post(f"{ollama_base_url()}/api/chat", json=request_body) as response:
                    body = await response.text()
                    if response.status >= 400:
                        raise RuntimeError(f"Ollama returned {response.status}: {body[:300]}")
            except aiohttp.ClientError as exc:
                raise RuntimeError("Ollama is not reachable. Start Ollama and install gpt-oss:20b.") from exc
            except TimeoutError as exc:
                raise RuntimeError(f"Local {group_name} EHR generation timed out.") from exc
            try:
                payload = json.loads(body)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"Ollama returned an invalid response for {group_name} extraction.") from exc
            if payload.get("error"):
                raise RuntimeError(f"Ollama returned an error for {group_name}: {payload['error']}")
            return payload

        evidence_count = sum(
            len(build_section_rag_bundle(rag_bundle, section).get("evidence") or [])
            for section in sections
        )
        last_error: Optional[Exception] = None
        for attempt, num_predict in enumerate((initial_output, retry_output), start=1):
            logger.info(
                "Hybrid EHR %s attempt %d | model=%s num_ctx=%d num_predict=%d evidence=%d prompt_chars=%d",
                group_name, attempt, model, context_window, num_predict, evidence_count, len(prompt),
            )
            response_payload = await _request(num_predict)
            done_reason = response_payload.get("done_reason")
            message = response_payload.get("message") or {}
            content = str(message.get("content") or "").strip().lstrip("\ufeff\u200b\u200c\u200d\u2060").strip()
            if not content or done_reason == "length":
                last_error = RuntimeError(f"The local model truncated the {group_name} sections.")
                continue
            try:
                generated = json.loads(content)
                import jsonschema
                jsonschema.validate(instance=generated, schema=schema)
                logger.info(
                    "Hybrid EHR %s complete | eval_count=%s content_length=%d",
                    group_name, response_payload.get("eval_count"), len(content),
                )
                return {section: generated[section] for section in sections}
            except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
                last_error = exc
            except Exception as exc:
                last_error = exc
        raise RuntimeError(
            f"The local EHR model could not produce valid {group_name} sections after retry: {last_error}"
        )

    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            # Two targeted requests avoid four rounds of model overhead while
            # retaining separate evidence blocks and schemas for every section.
            history_and_findings, opinion_and_plan = await asyncio.gather(
                _generate_group(session, ("subjective", "objective")),
                _generate_group(session, ("assessment", "plan")),
            )
    except asyncio.TimeoutError as exc:
        raise RuntimeError("Local hybrid EHR generation timed out.") from exc

    ehr_data = {**history_and_findings, **opinion_and_plan}
    soap_ehr = _normalize_soap_ehr(ehr_data)
    evidence_ledger = rag_bundle.get("evidence") or []
    soap_ehr = _strip_unsupported_clinical_content(soap_ehr, evidence_ledger)
    soap_ehr = _validate_and_fix_soap_coverage(soap_ehr, transcript, evidence_ledger)
    completeness_flags = build_completeness_review_flags(soap_ehr, rag_bundle)

    logger.info(
        "Hybrid EHR generation complete | model=%s knowledge=%s evidence=%d rules=%d flags=%d",
        model, rag_bundle.get("knowledge_version", "unknown"),
        len(rag_bundle.get("evidence", [])),
        len(rag_bundle.get("rules", [])),
        len(completeness_flags),
    )

    return soap_ehr, model, completeness_flags


def _add_audit_event(db: AsyncSession, encounter: ClinicalEncounter, action: str, actor_id: Optional[str]) -> None:
    db.add(EhrAuditEvent(
        encounter_id=encounter.encounter_id,
        clinic_id=encounter.clinic_id,
        patient_id=encounter.patient_id,
        actor_type="doctor" if actor_id else "system",
        actor_id=actor_id,
        action=action,
        snapshot={"ehr_data": encounter.ehr_data or {}, "patient_summary": encounter.patient_summary or {}, "status": encounter.status},
    ))


@router.get("/status")
async def ehr_model_status():
    model = ehr_model_name()
    timeout = aiohttp.ClientTimeout(total=5)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(f"{ollama_base_url()}/api/tags") as response:
                payload = await response.json()
                installed = {item.get("name", "") for item in payload.get("models", [])}
                available = response.status < 400 and any(name == model or name.startswith(f"{model}:") for name in installed)
    except Exception:
        available = False
    return {"provider": "ollama", "model": model, "available": available}


@router.post("/drafts/generate", status_code=status.HTTP_201_CREATED)
async def generate_ehr_draft(payload: GenerateEhrDraftRequest, db: AsyncSession = Depends(get_db)):
    clinic = await _require_clinic(db, payload.clinic_id)
    patient = await _require_patient(db, payload.patient_id)
    doctor: Optional[Doctor] = None
    if payload.doctor_id:
        doctor_result = await db.execute(
            select(Doctor).where(Doctor.doctor_id == payload.doctor_id, Doctor.clinic_id == payload.clinic_id)
        )
        doctor = doctor_result.scalar_one_or_none()
        if not doctor:
            raise HTTPException(status_code=400, detail="Doctor does not belong to this clinic")
    if payload.appointment_id:
        appointment_result = await db.execute(
            select(Appointment).where(
                Appointment.id == payload.appointment_id,
                Appointment.clinic_id == payload.clinic_id,
                Appointment.patient_id == payload.patient_id,
            )
        )
        if not appointment_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Appointment does not match this clinic and patient")

    # Sarvam diarization identifies voices (Speaker A/B), not clinical roles.
    # Resolve those stable identities before building the transcript and RAG
    # evidence ledger; otherwise doctor-only Assessment and Plan evidence is
    # classified as unknown and removed by the safety validator.
    segments = infer_consultation_speaker_roles(_segments_payload(payload.transcript_segments))
    transcript = _transcript_text(segments)
    if len(transcript) < 20:
        raise HTTPException(status_code=400, detail="The transcript is too short to create an EHR draft")

    try:
        rag_bundle = retrieve_soap_context(transcript, speaker_map=payload.speaker_map)
    except RuntimeError as exc:
        logger.warning("SOAP RAG retrieval failed, proceeding without RAG context: %s", exc)
        rag_bundle = {"knowledge_version": "fallback", "evidence": [], "rules": [], "coverage_expectations": []}

    try:
        soap_ehr, model, completeness_flags = await _generate_with_ollama(transcript, rag_bundle)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    now = datetime.now(timezone.utc)
    visit_datetime = now.isoformat()
    if payload.appointment_id:
        apt_result = await db.execute(select(Appointment).where(Appointment.id == payload.appointment_id))
        apt = apt_result.scalar_one_or_none()
        if apt and apt.date and apt.time:
            try:
                visit_datetime = f"{apt.date}T{apt.time}:00+05:30"
            except Exception:
                pass

    clinic_address = clinic.address or ", ".join(
        value for value in [clinic.street_address, clinic.road, clinic.layout, clinic.section, clinic.city, clinic.pincode]
        if value
    )
    soap_ehr["visit_details"] = {
        "patient_name": payload.patient_name or patient.name,
        "phone_number": payload.patient_phone or patient.phone or "",
        "patient_id": patient.patient_id,
        "clinic_name": clinic.clinic_name,
        "clinic_address": clinic_address or "",
        "clinic_phone": clinic.phone or "",
        "doctor_name": doctor.name if doctor else (clinic.doctor_name or ""),
        "visit_datetime": visit_datetime,
    }

    soap_ehr["approval"] = {
        "status": "draft",
        "approved_by_doctor_id": None,
        "approved_at": None,
        "version": 1,
    }

    soap_ehr["review_metadata"] = {"completeness_flags": completeness_flags}
    # Backward compat: also store at top level for older consumers
    soap_ehr["completeness_flags"] = completeness_flags

    ehr_data = soap_ehr
    # Patient instructions are final-output data.  They are generated only
    # after a doctor approves the latest structured SOAP draft.
    patient_summary = _empty_patient_summary()

    encounter = ClinicalEncounter(
        encounter_id=f"EHR-{uuid.uuid4().hex.upper()[:16]}",
        clinic_id=payload.clinic_id.strip(),
        patient_id=patient.patient_id,
        doctor_id=payload.doctor_id,
        appointment_id=payload.appointment_id,
        patient_name=patient.name,
        patient_phone=patient.phone,
        patient_email=patient.email,
        transcript_text=transcript,
        transcript_segments=segments,
        ehr_data=ehr_data,
        patient_summary=patient_summary,
        status="draft",
        model_name=model,
    )
    db.add(encounter)
    await db.flush()
    _add_audit_event(db, encounter, "draft_generated", payload.doctor_id)
    await db.commit()
    await db.refresh(encounter)
    return _encounter_payload(encounter)


@router.put("/encounters/{encounter_id}")
async def update_ehr_draft(
    encounter_id: str,
    payload: UpdateEhrDraftRequest,
    clinic_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    await _require_clinic(db, clinic_id)
    encounter = await _require_encounter_for_clinic(db, encounter_id, clinic_id)
    if encounter.status != "draft":
        raise HTTPException(status_code=409, detail="Approved EHR records cannot be edited")

    ehr_data = payload.ehr_data or {}
    if ehr_data.get("schema_version") in SOAP_SCHEMA_VERSIONS:
        ehr_data = _normalize_soap_ehr(ehr_data)
        ehr_data["visit_details"] = payload.ehr_data.get("visit_details", encounter.ehr_data.get("visit_details", _empty_soap_ehr()["visit_details"]))
        ehr_data["private_doctor_notes"] = _clean_text(payload.ehr_data.get("private_doctor_notes") or encounter.ehr_data.get("private_doctor_notes")) or ""
        approval = payload.ehr_data.get("approval") or encounter.ehr_data.get("approval") or {}
        ehr_data["approval"] = {
            "status": "draft",
            "approved_by_doctor_id": None,
            "approved_at": None,
            "version": approval.get("version", 1),
        }
        encounter.ehr_data = ehr_data
    else:
        encounter.ehr_data = _normalize_legacy_ehr(ehr_data)

    # Never persist a separately edited/stale summary during draft review.
    # Approval deterministically rebuilds it from the latest saved SOAP.
    encounter.patient_summary = _empty_patient_summary()
    encounter.updated_at = datetime.now(timezone.utc)
    _add_audit_event(db, encounter, "draft_edited", payload.actor_id)
    await db.commit()
    await db.refresh(encounter)
    return _encounter_payload(encounter)


@router.post("/encounters/{encounter_id}/approve")
async def approve_ehr(
    encounter_id: str,
    payload: ApproveEhrRequest,
    clinic_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    await _require_clinic(db, clinic_id)
    encounter = await _require_encounter_for_clinic(db, encounter_id, clinic_id)
    if encounter.status == "approved":
        return _encounter_payload(encounter)
    if encounter.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft can be approved")
    approver = payload.approved_by.strip()
    doctor_result = await db.execute(
        select(Doctor).where(Doctor.doctor_id == approver, Doctor.clinic_id == clinic_id)
    )
    if not doctor_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Approving doctor does not belong to this clinic")

    now = datetime.now(timezone.utc)

    ehr_data = encounter.ehr_data or {}
    if isinstance(ehr_data, dict) and ehr_data.get("schema_version") in SOAP_SCHEMA_VERSIONS:
        raw_ehr_data = ehr_data
        ehr_data = _normalize_soap_ehr(raw_ehr_data)
        ehr_data["visit_details"] = raw_ehr_data.get("visit_details", _empty_soap_ehr()["visit_details"])
        version = (raw_ehr_data.get("approval") or {}).get("version", 1)
        new_version = version + 1 if encounter.status == "approved" else version
        ehr_data["approval"] = {
            "status": "approved",
            "approved_by_doctor_id": approver,
            "approved_at": now.isoformat(),
            "version": new_version,
        }
        ehr_data["private_doctor_notes"] = _clean_text(raw_ehr_data.get("private_doctor_notes")) or ""
        encounter.ehr_data = ehr_data

        encounter.patient_summary = _generate_patient_summary_from_soap(ehr_data)

    encounter.status = "approved"
    encounter.approved_by = approver
    encounter.approved_at = now
    encounter.updated_at = now
    _add_audit_event(db, encounter, "approved", approver)
    await db.commit()
    await db.refresh(encounter)
    return _encounter_payload(encounter)


@router.get("/clinic/{clinic_id}/patient/{patient_id}")
async def get_clinic_patient_ehr(clinic_id: str, patient_id: str, db: AsyncSession = Depends(get_db)):
    clinic = await _require_clinic(db, clinic_id)
    patient = await _require_patient(db, patient_id)
    result = await db.execute(
        select(ClinicalEncounter)
        .where(ClinicalEncounter.clinic_id == clinic_id, ClinicalEncounter.patient_id == patient_id)
        .order_by(ClinicalEncounter.created_at.desc(), ClinicalEncounter.id.desc())
    )
    encounters = result.scalars().all()

    doctor_ids = {item.doctor_id for item in encounters if item.doctor_id}
    doctors_by_id: dict[str, Doctor] = {}
    if doctor_ids:
        doctor_result = await db.execute(
            select(Doctor).where(Doctor.clinic_id == clinic_id, Doctor.doctor_id.in_(doctor_ids))
        )
        doctors_by_id = {doctor.doctor_id: doctor for doctor in doctor_result.scalars().all()}

    appointment_ids = {item.appointment_id for item in encounters if item.appointment_id is not None}
    appointments_by_id: dict[int, Appointment] = {}
    if appointment_ids:
        appointment_result = await db.execute(
            select(Appointment).where(
                Appointment.clinic_id == clinic_id,
                Appointment.id.in_(appointment_ids),
            )
        )
        appointments_by_id = {appointment.id: appointment for appointment in appointment_result.scalars().all()}

    encounter_payloads = []
    for item in encounters:
        payload = _encounter_payload(item, include_transcript=False)
        doctor = doctors_by_id.get(item.doctor_id or "")
        appointment = appointments_by_id.get(item.appointment_id or -1)
        # Completed appointments are removed from the live appointments table.
        # Keep historical EHRs matchable by falling back to the visit timestamp
        # stored inside the encounter when the draft was generated.
        stored_visit = {}
        if isinstance(payload.get("ehr_data"), dict):
            candidate = payload["ehr_data"].get("visit_details")
            if isinstance(candidate, dict):
                stored_visit = candidate
        stored_datetime = str(stored_visit.get("visit_datetime") or "")
        stored_date = None
        stored_time = None
        if stored_datetime:
            try:
                stored_date, raw_time = stored_datetime.split("T", 1)
                stored_time = raw_time[:5]
            except ValueError:
                pass
        payload["doctor"] = {
            "doctor_id": item.doctor_id,
            "name": doctor.name if doctor else (appointment.doctor_name if appointment else clinic.doctor_name),
            "specialization": doctor.specialization if doctor else clinic.specialization,
            "qualifications": doctor.qualifications if doctor else clinic.qualifications,
        }
        payload["visit"] = {
            "appointment_id": item.appointment_id,
            "appointment_token": appointment.appointment_token if appointment else None,
            "date": appointment.date if appointment else stored_date,
            "time": appointment.time if appointment else stored_time,
        }
        encounter_payloads.append(payload)

    clinic_address = clinic.address or ", ".join(
        value for value in [clinic.street_address, clinic.road, clinic.layout, clinic.section, clinic.city, clinic.pincode] if value
    )
    return {
        "clinic": {
            "clinic_id": clinic.clinic_id,
            "name": clinic.clinic_name,
            "phone": clinic.phone,
            "email": clinic.email,
            "address": clinic_address or None,
        },
        "patient": {
            "patient_id": patient.patient_id,
            "name": patient.name,
            "phone": patient.phone,
            "email": patient.email,
            "blood_group": patient.blood_group,
        },
        "encounters": encounter_payloads,
    }


@router.get("/clinic/{clinic_id}/patient/{patient_id}/encounters/{encounter_id}/pdf")
async def download_clinic_patient_ehr_pdf(
    clinic_id: str,
    patient_id: str,
    encounter_id: str,
    db: AsyncSession = Depends(get_db),
):
    clinic = await _require_clinic(db, clinic_id)
    patient = await _require_patient(db, patient_id)
    encounter = await _require_encounter_for_clinic(db, encounter_id, clinic_id)
    if encounter.patient_id != patient.patient_id:
        raise HTTPException(status_code=404, detail="EHR encounter not found for this patient")

    doctor = None
    if encounter.doctor_id:
        doctor_result = await db.execute(
            select(Doctor).where(
                Doctor.clinic_id == clinic_id,
                Doctor.doctor_id == encounter.doctor_id,
            )
        )
        doctor = doctor_result.scalar_one_or_none()

    appointment = None
    if encounter.appointment_id is not None:
        appointment_result = await db.execute(
            select(Appointment).where(
                Appointment.clinic_id == clinic_id,
                Appointment.id == encounter.appointment_id,
            )
        )
        appointment = appointment_result.scalar_one_or_none()

    clinic_address = clinic.address or ", ".join(
        value for value in [clinic.street_address, clinic.road, clinic.layout, clinic.section, clinic.city, clinic.pincode] if value
    )
    encounter_payload = _encounter_payload(encounter, include_transcript=False)
    doctor_payload = {
        "doctor_id": encounter.doctor_id,
        "name": doctor.name if doctor else (appointment.doctor_name if appointment else clinic.doctor_name),
        "specialization": doctor.specialization if doctor else clinic.specialization,
        "qualifications": doctor.qualifications if doctor else clinic.qualifications,
    }
    visit_payload = {
        "appointment_id": encounter.appointment_id,
        "appointment_token": appointment.appointment_token if appointment else None,
        "date": appointment.date if appointment else None,
        "time": appointment.time if appointment else None,
    }

    try:
        from app.services.ehr_pdf import build_ehr_pdf

        pdf_bytes = build_ehr_pdf(
            encounter=encounter_payload,
            ehr_data=_normalize_ehr(encounter.ehr_data or {}),
            clinic={
                "clinic_id": clinic.clinic_id,
                "name": clinic.clinic_name,
                "phone": clinic.phone,
                "email": clinic.email,
                "address": clinic_address or None,
            },
            patient={
                "patient_id": patient.patient_id,
                "name": patient.name,
                "phone": patient.phone,
                "email": patient.email,
                "blood_group": patient.blood_group,
            },
            doctor=doctor_payload,
            visit=visit_payload,
        )
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="PDF generation is unavailable") from exc
    except Exception as exc:
        logger.exception("Could not generate EHR PDF for encounter %s", encounter_id)
        raise HTTPException(status_code=500, detail="Could not generate the EHR PDF") from exc

    safe_patient_id = re.sub(r"[^A-Za-z0-9_-]+", "-", patient.patient_id).strip("-") or "patient"
    safe_encounter_id = re.sub(r"[^A-Za-z0-9_-]+", "-", encounter.encounter_id).strip("-") or "encounter"
    filename = f"ehr-{safe_patient_id}-{safe_encounter_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class PrintPdfRequest(BaseModel):
    url: str
    include_private_notes: bool = False


@router.post("/print-pdf")
async def generate_print_pdf(request: PrintPdfRequest):
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Playwright is not installed. Run: pip install playwright && playwright install chromium",
        )

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(request.url, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(2000)
            pdf_bytes = await page.pdf(
                format="A4",
                print_background=True,
                prefer_css_page_size=True,
                display_header_footer=False,
                margin={"top": "14mm", "right": "14mm", "bottom": "16mm", "left": "14mm"},
            )
            await browser.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(exc)}") from exc

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="ehr-print.pdf"'},
    )


@router.get("/patient/{patient_id}/summary")
async def get_approved_patient_ehr_summary(patient_id: str, db: AsyncSession = Depends(get_db)):
    patient = await _require_patient(db, patient_id)
    result = await db.execute(
        select(ClinicalEncounter)
        .where(ClinicalEncounter.patient_id == patient_id, ClinicalEncounter.status == "approved")
        .order_by(ClinicalEncounter.approved_at.desc(), ClinicalEncounter.id.desc())
    )
    encounters = result.scalars().all()
    return {
        "patient": {"patient_id": patient.patient_id, "name": patient.name, "blood_group": patient.blood_group},
        "encounters": [_encounter_payload(item, include_transcript=False) for item in encounters],
    }


@router.get("/encounters/{encounter_id}/completeness")
async def get_ehr_completeness_review(
    encounter_id: str,
    clinic_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    await _require_clinic(db, clinic_id)
    encounter = await _require_encounter_for_clinic(db, encounter_id, clinic_id)

    transcript = encounter.transcript_text or ""
    ehr_data = encounter.ehr_data or {}
    if not isinstance(ehr_data, dict):
        return {"completeness_flags": []}

    from app.services.soap_rag import (
        build_completeness_review_flags,
        retrieve_soap_context,
    )

    bundle = retrieve_soap_context(transcript)
    flags = build_completeness_review_flags(ehr_data, bundle, limit=6)

    return {
        "encounter_id": encounter.encounter_id,
        "completeness_flags": flags,
        "note": "These are advisory flags only and do not modify the SOAP record.",
    }
