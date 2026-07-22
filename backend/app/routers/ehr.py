import json
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

from app.config import ehr_generation_timeout_seconds, ehr_model_name, ollama_base_url
from app.database.db import get_db
from app.database.models import (
    Appointment,
    Clinic,
    ClinicalEncounter,
    Doctor,
    EhrAuditEvent,
    Patient,
)


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


class UpdateEhrDraftRequest(BaseModel):
    ehr_data: dict[str, Any]
    patient_summary: dict[str, Any]
    actor_id: Optional[str] = None


class ApproveEhrRequest(BaseModel):
    approved_by: str


SOAP_SCHEMA_VERSION = "1.0"

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
                    "required": ["chief_complaints", "history_of_present_illness", "symptoms", "associated_symptoms", "relevant_negatives", "medical_conditions", "previous_surgeries", "allergies", "current_medicines", "family_history", "social_history"],
                    "properties": {
                        "chief_complaints": {"type": "array", "items": {"type": "string"}},
                        "history_of_present_illness": {"type": ["string", "null"]},
                        "symptoms": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "duration", "severity", "progression", "source"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "duration": {"type": ["string", "null"]},
                                    "severity": {"type": ["string", "null"]},
                                    "progression": {"type": ["string", "null"]},
                                    "source": {"type": "string", "enum": ["patient_reported", "observed_by_doctor"]}
                                }
                            }
                        },
                        "associated_symptoms": {"type": "array", "items": {"type": "string"}},
                        "relevant_negatives": {"type": "array", "items": {"type": "string"}},
                        "medical_conditions": {"type": "array", "items": {"type": "string"}},
                        "previous_surgeries": {"type": "array", "items": {"type": "string"}},
                        "allergies": {"type": "array", "items": {"type": "string"}},
                        "current_medicines": {"type": "array", "items": {"type": "string"}},
                        "family_history": {"type": "array", "items": {"type": "string"}},
                        "social_history": {"type": "array", "items": {"type": "string"}}
                    }
                },
                "objective": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["vitals", "examination_findings", "available_test_results"],
                    "properties": {
                        "vitals": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["temperature", "blood_pressure", "pulse", "respiratory_rate", "spo2", "height", "weight", "bmi"],
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
                        "examination_findings": {"type": "array", "items": {"type": "string"}},
                        "available_test_results": {"type": "array", "items": {"type": "string"}}
                    }
                },
                "assessment": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["clinical_impression", "provisional_diagnoses", "confirmed_diagnoses", "differential_diagnoses", "diagnosis_status"],
                    "properties": {
                        "clinical_impression": {"type": "array", "items": {"type": "string"}},
                        "provisional_diagnoses": {"type": "array", "items": {"type": "string"}},
                        "confirmed_diagnoses": {"type": "array", "items": {"type": "string"}},
                        "differential_diagnoses": {"type": "array", "items": {"type": "string"}},
                        "diagnosis_status": {"type": "string", "enum": ["not_stated", "provisional", "confirmed"]}
                    }
                },
                "plan": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["prescriptions", "tests_ordered", "procedures", "treatment_advice", "diet_and_hydration_advice", "referrals", "follow_up", "warning_signs", "other_instructions"],
                    "properties": {
                        "prescriptions": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["medicine_name", "strength", "dose", "schedule", "meal_timing", "specific_timing", "frequency", "duration", "as_needed", "indication", "additional_instructions", "needs_doctor_review"],
                                "properties": {
                                    "medicine_name": {"type": "string"},
                                    "strength": {"type": ["string", "null"]},
                                    "dose": {"type": ["string", "null"]},
                                    "schedule": {
                                        "type": "object",
                                        "additionalProperties": False,
                                        "required": ["morning", "afternoon", "night"],
                                        "properties": {
                                            "morning": {"type": ["string", "null"]},
                                            "afternoon": {"type": ["string", "null"]},
                                            "night": {"type": ["string", "null"]}
                                        }
                                    },
                                    "meal_timing": {"type": ["string", "null"]},
                                    "specific_timing": {"type": ["string", "null"]},
                                    "frequency": {"type": ["string", "null"]},
                                    "duration": {"type": ["string", "null"]},
                                    "as_needed": {"type": ["boolean", "null"]},
                                    "indication": {"type": ["string", "null"]},
                                    "additional_instructions": {"type": ["string", "null"]},
                                    "needs_doctor_review": {"type": "boolean"}
                                }
                            }
                        },
                        "tests_ordered": {"type": "array", "items": {"type": "string"}},
                        "procedures": {"type": "array", "items": {"type": "string"}},
                        "treatment_advice": {"type": "array", "items": {"type": "string"}},
                        "diet_and_hydration_advice": {"type": "array", "items": {"type": "string"}},
                        "referrals": {"type": "array", "items": {"type": "string"}},
                        "follow_up": {"type": ["string", "null"]},
                        "warning_signs": {"type": "array", "items": {"type": "string"}},
                        "other_instructions": {"type": "array", "items": {"type": "string"}}
                    }
                },
                "additional_clinical_information": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": True,
                        "required": ["information"],
                        "properties": {
                            "information": {"type": "string"},
                            "suggested_category": {"type": ["string", "null"]},
                            "source": {"type": ["string", "null"]},
                            "needs_doctor_review": {"type": "boolean"}
                        }
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


def _normalize_symptoms(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = _clean_text(item.get("name"))
        if not name:
            continue
        symptom = {
            "name": name,
            "duration": _clean_text(item.get("duration")),
            "severity": _clean_text(item.get("severity")),
            "progression": _clean_text(item.get("progression")),
            "source": _clean_text(item.get("source")) or "patient_reported",
        }
        exists = any(s["name"] == symptom["name"] for s in result)
        if not exists:
            result.append(symptom)
    return result


def _normalize_prescriptions(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = _clean_text(item.get("medicine_name"))
        if not name:
            continue
        schedule = item.get("schedule") if isinstance(item.get("schedule"), dict) else {}
        raw_as_needed = item.get("as_needed")
        if isinstance(raw_as_needed, bool):
            as_needed = raw_as_needed
        elif isinstance(raw_as_needed, str):
            normalized_as_needed = raw_as_needed.strip().lower()
            if normalized_as_needed in ("true", "yes", "y", "1"):
                as_needed = True
            elif normalized_as_needed in ("false", "no", "n", "0"):
                as_needed = False
            else:
                as_needed = None
        else:
            as_needed = None
        prescription = {
            "medicine_name": name,
            "strength": _clean_text(item.get("strength")),
            "dose": _clean_text(item.get("dose")),
            "schedule": {
                "morning": _clean_text(schedule.get("morning")),
                "afternoon": _clean_text(schedule.get("afternoon")),
                "night": _clean_text(schedule.get("night")),
            },
            "meal_timing": _clean_text(item.get("meal_timing")),
            "specific_timing": _clean_text(item.get("specific_timing")),
            "frequency": _clean_text(item.get("frequency")),
            "duration": _clean_text(item.get("duration")),
            "as_needed": as_needed,
            "indication": _clean_text(item.get("indication")),
            "additional_instructions": _clean_text(item.get("additional_instructions")),
            "needs_doctor_review": bool(item.get("needs_doctor_review", False)),
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
    return ehr_data.get("schema_version") == SOAP_SCHEMA_VERSION


def _empty_soap_ehr() -> dict[str, Any]:
    return {
        "schema_version": SOAP_SCHEMA_VERSION,
        "visit_details": {
            "patient_name": "",
            "phone_number": "",
            "patient_id": "",
            "clinic_name": "",
            "visit_datetime": "",
        },
        "subjective": {
            "chief_complaints": [],
            "history_of_present_illness": None,
            "symptoms": [],
            "associated_symptoms": [],
            "relevant_negatives": [],
            "medical_conditions": [],
            "previous_surgeries": [],
            "allergies": [],
            "current_medicines": [],
            "family_history": [],
            "social_history": [],
        },
        "objective": {
            "vitals": {
                "temperature": {"value": None, "unit": None, "source": None},
                "blood_pressure": {"systolic": None, "diastolic": None, "unit": "mmHg", "source": None},
                "pulse": {"value": None, "unit": "bpm", "source": None},
                "respiratory_rate": {"value": None, "unit": "breaths/min", "source": None},
                "spo2": {"value": None, "unit": "%", "source": None},
                "height": {"value": None, "unit": None, "source": None},
                "weight": {"value": None, "unit": None, "source": None},
                "bmi": {"value": None, "source": None},
            },
            "examination_findings": [],
            "available_test_results": [],
        },
        "assessment": {
            "clinical_impression": [],
            "provisional_diagnoses": [],
            "confirmed_diagnoses": [],
            "differential_diagnoses": [],
            "diagnosis_status": "not_stated",
        },
        "plan": {
            "prescriptions": [],
            "tests_ordered": [],
            "procedures": [],
            "treatment_advice": [],
            "diet_and_hydration_advice": [],
            "referrals": [],
            "follow_up": None,
            "warning_signs": [],
            "other_instructions": [],
        },
        "additional_clinical_information": [],
        "private_doctor_notes": "",
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
    obj = source.get("objective") or {}
    ass = source.get("assessment") or {}
    plan = source.get("plan") or {}
    extra = source.get("additional_clinical_information") or []

    ehr["subjective"] = {
        "chief_complaints": _clean_list(sub.get("chief_complaints")),
        "history_of_present_illness": _clean_text(sub.get("history_of_present_illness")),
        "symptoms": _normalize_symptoms(sub.get("symptoms")),
        "associated_symptoms": _clean_list(sub.get("associated_symptoms")),
        "relevant_negatives": _clean_list(sub.get("relevant_negatives")),
        "medical_conditions": _clean_list(sub.get("medical_conditions")),
        "previous_surgeries": _clean_list(sub.get("previous_surgeries")),
        "allergies": _clean_list(sub.get("allergies")),
        "current_medicines": _clean_list(sub.get("current_medicines")),
        "family_history": _clean_list(sub.get("family_history")),
        "social_history": _clean_list(sub.get("social_history")),
    }

    obj_vitals = obj.get("vitals") or {}
    vitals = ehr["objective"]["vitals"]
    vitals["temperature"] = _normalize_vital(obj_vitals.get("temperature"))
    bp = obj_vitals.get("blood_pressure") or {}
    if isinstance(bp, dict):
        vitals["blood_pressure"] = {
            "systolic": _clean_optional_vital(bp.get("systolic")),
            "diastolic": _clean_optional_vital(bp.get("diastolic")),
            "unit": _clean_text(bp.get("unit")) or "mmHg",
            "source": _clean_text(bp.get("source")),
        }
    vitals["pulse"] = _normalize_vital(obj_vitals.get("pulse"), "bpm")
    vitals["respiratory_rate"] = _normalize_vital(obj_vitals.get("respiratory_rate"), "breaths/min")
    vitals["spo2"] = _normalize_vital(obj_vitals.get("spo2"), "%")
    vitals["height"] = _normalize_vital(obj_vitals.get("height"))
    vitals["weight"] = _normalize_vital(obj_vitals.get("weight"))
    vitals["bmi"] = _normalize_bmi(obj_vitals.get("bmi"))

    bmi_calc = _calculate_bmi_from_vitals(vitals)
    if bmi_calc is not None and vitals["bmi"]["value"] is None:
        vitals["bmi"]["value"] = bmi_calc
        vitals["bmi"]["source"] = "calculated"

    ehr["objective"]["examination_findings"] = _clean_list(obj.get("examination_findings"))
    ehr["objective"]["available_test_results"] = _clean_list(obj.get("available_test_results"))

    prov_dx = _clean_list(ass.get("provisional_diagnoses"))
    conf_dx = _clean_list(ass.get("confirmed_diagnoses"))
    diff_dx = _clean_list(ass.get("differential_diagnoses"))
    has_any = bool(conf_dx or prov_dx or diff_dx)
    raw_status = ass.get("diagnosis_status", "not_stated")
    if conf_dx:
        diagnosis_status = "confirmed"
    elif has_any:
        diagnosis_status = "provisional"
    else:
        diagnosis_status = "not_stated"

    ehr["assessment"] = {
        "clinical_impression": _clean_list(ass.get("clinical_impression")),
        "provisional_diagnoses": prov_dx,
        "confirmed_diagnoses": conf_dx,
        "differential_diagnoses": diff_dx,
        "diagnosis_status": diagnosis_status,
    }

    ehr["plan"] = {
        "prescriptions": _normalize_prescriptions(plan.get("prescriptions")),
        "tests_ordered": _clean_list(plan.get("tests_ordered")),
        "procedures": _clean_list(plan.get("procedures")),
        "treatment_advice": _clean_list(plan.get("treatment_advice")),
        "diet_and_hydration_advice": _clean_list(plan.get("diet_and_hydration_advice")),
        "referrals": _clean_list(plan.get("referrals")),
        "follow_up": _clean_text(plan.get("follow_up")),
        "warning_signs": _clean_list(plan.get("warning_signs")),
        "other_instructions": _clean_list(plan.get("other_instructions")),
    }

    ehr["additional_clinical_information"] = _normalize_additional_info(extra)

    return ehr


def _normalize_ehr(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    if source.get("schema_version") == SOAP_SCHEMA_VERSION:
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
        return _empty_patient_summary()
    new_keys = {"reason_for_visit", "what_the_doctor_assessed", "medicines", "tests",
                "diet_and_hydration_advice", "doctor_instructions", "follow_up", "when_to_seek_help"}
    if new_keys.intersection(value.keys()):
        return {
            "reason_for_visit": _clean_text(value.get("reason_for_visit")),
            "what_the_doctor_assessed": _clean_text(value.get("what_the_doctor_assessed")),
            "medicines": _clean_list(value.get("medicines", [])),
            "tests": _clean_list(value.get("tests", [])),
            "diet_and_hydration_advice": _clean_list(value.get("diet_and_hydration_advice", [])),
            "doctor_instructions": _clean_list(value.get("doctor_instructions", [])),
            "follow_up": _clean_text(value.get("follow_up")),
            "when_to_seek_help": _clean_list(value.get("when_to_seek_help", [])),
        }
    return {
        "reason_for_visit": _clean_text(value.get("visit_overview")),
        "what_the_doctor_assessed": None,
        "medicines": _clean_list(value.get("medicines", [])),
        "tests": _clean_list(value.get("tests", [])),
        "diet_and_hydration_advice": _clean_list(value.get("diet_advice", [])),
        "doctor_instructions": _clean_list(value.get("doctor_suggestions", []) or value.get("instructions", [])),
        "follow_up": _clean_text(value.get("follow_up")),
        "when_to_seek_help": _clean_list(value.get("warning_signs", [])),
    }


def _empty_patient_summary() -> dict[str, Any]:
    return {
        "reason_for_visit": None,
        "what_the_doctor_assessed": None,
        "medicines": [],
        "tests": [],
        "diet_and_hydration_advice": [],
        "doctor_instructions": [],
        "follow_up": None,
        "when_to_seek_help": [],
    }


def _generate_patient_summary_from_soap(ehr_data: dict[str, Any]) -> dict[str, Any]:
    sub = ehr_data.get("subjective", {}) or {}
    ass = ehr_data.get("assessment", {}) or {}
    plan = ehr_data.get("plan", {}) or {}

    chief_complaints = sub.get("chief_complaints", [])
    if isinstance(chief_complaints, list) and chief_complaints:
        reason = "; ".join(str(c) for c in chief_complaints)
    else:
        reason = None

    all_diagnoses = []
    for dx_list_key in ("confirmed_diagnoses", "provisional_diagnoses", "clinical_impression"):
        items = ass.get(dx_list_key, [])
        if isinstance(items, list):
            all_diagnoses.extend(items)
    what_assessed = "; ".join(all_diagnoses) if all_diagnoses else None

    medicines = []
    for rx in plan.get("prescriptions", []):
        if isinstance(rx, dict) and rx.get("medicine_name"):
            rx_clean = {
                "medicine_name": rx["medicine_name"],
                "strength": rx.get("strength"),
                "dose": rx.get("dose"),
                "schedule": rx.get("schedule"),
                "meal_timing": rx.get("meal_timing"),
                "specific_timing": rx.get("specific_timing"),
                "frequency": rx.get("frequency"),
                "duration": rx.get("duration"),
                "as_needed": rx.get("as_needed", False),
                "indication": rx.get("indication"),
                "additional_instructions": rx.get("additional_instructions"),
                "needs_doctor_review": bool(rx.get("needs_doctor_review", False)),
            }
            medicines.append(rx_clean)
        elif isinstance(rx, str) and rx.strip():
            medicines.append(rx.strip())

    tests = _clean_list(plan.get("tests_ordered", []))
    diet = _clean_list(plan.get("diet_and_hydration_advice", []))

    doctor_instructions = []
    for key in ("treatment_advice", "other_instructions"):
        items = plan.get(key, [])
        if isinstance(items, list):
            doctor_instructions.extend(_clean_list(items))
    deduped = list(dict.fromkeys(doctor_instructions))

    follow_up = _clean_text(plan.get("follow_up"))
    warning = _clean_list(plan.get("warning_signs", []))

    return {
        "reason_for_visit": reason,
        "what_the_doctor_assessed": what_assessed,
        "medicines": medicines,
        "tests": tests,
        "diet_and_hydration_advice": diet,
        "doctor_instructions": deduped,
        "follow_up": follow_up,
        "when_to_seek_help": warning,
    }


_NEGATION_RE = re.compile(r"\b(?:no|not|denies?|denied|without|never\s+had)\b", re.IGNORECASE)
_AS_NEEDED_RE = re.compile(r"\b(?:as\s+needed|if\s+needed|when\s+required|p\.?r\.?n\.?)\b", re.IGNORECASE)
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


def _evidence_text(value: Any) -> str:
    text = str(value or "").lower().replace("–", "-").replace("—", "-")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _is_transcript_grounded(value: Any, transcript: str) -> bool:
    evidence = _evidence_text(value)
    return bool(evidence) and evidence in _evidence_text(transcript)


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
        strength_suffix = re.match(
            r"\s+(\d+(?:\.\d+)?(?:\s*(?:mg|mcg|g|ml))?)\b",
            transcript[match.end():match.end() + 32],
            flags=re.IGNORECASE,
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


def _validate_prescriptions_against_transcript(value: Any, transcript: str) -> list[dict[str, Any]]:
    prescriptions = _normalize_prescriptions(value)
    validated: list[dict[str, Any]] = []
    for item in prescriptions:
        spoken_name, uncertain_annotation = _resolve_spoken_medicine_name(item.get("medicine_name"), transcript)
        if not spoken_name:
            continue

        context = _medicine_context(spoken_name, transcript)
        item["medicine_name"] = spoken_name
        for field in (
            "strength", "dose", "meal_timing", "specific_timing", "frequency",
            "duration", "indication", "additional_instructions",
        ):
            if item.get(field) is not None and not _is_transcript_grounded(item[field], context):
                item[field] = None

        schedule = item.get("schedule") if isinstance(item.get("schedule"), dict) else {}
        item["schedule"] = {
            period: schedule.get(period) if _is_transcript_grounded(schedule.get(period), context) else None
            for period in ("morning", "afternoon", "night")
        }

        if item.get("as_needed") is True and _AS_NEEDED_RE.search(context):
            item["as_needed"] = True
        elif item.get("as_needed") is False and re.search(r"\bnot\s+(?:as\s+needed|p\.?r\.?n\.?)\b", context, re.IGNORECASE):
            item["as_needed"] = False
        else:
            item["as_needed"] = None

        item["needs_doctor_review"] = (
            bool(item.get("needs_doctor_review"))
            or uncertain_annotation
            or bool(_MEDICINE_UNCERTAINTY_RE.search(context))
        )
        if not any(existing["medicine_name"].lower() == spoken_name.lower() for existing in validated):
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


def _validate_and_fix_soap_coverage(ehr: dict[str, Any], transcript: str) -> dict[str, Any]:
    source = ehr if isinstance(ehr, dict) else {}
    sub = source.get("subjective") or {}
    obj = source.get("objective") or {}
    ass = source.get("assessment") or {}
    plan = source.get("plan") or {}
    extra = source.get("additional_clinical_information") or []

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

    for field in ("chief_complaints", "associated_symptoms", "medical_conditions"):
        items = sub.get(field)
        if isinstance(items, list):
            sub[field] = [item for item in items if not contradicts_negative(item)]
    symptoms = sub.get("symptoms")
    if isinstance(symptoms, list):
        sub["symptoms"] = [
            item for item in symptoms
            if not (isinstance(item, dict) and contradicts_negative(item.get("name")))
        ]
    for field in ("clinical_impression", "provisional_diagnoses", "confirmed_diagnoses", "differential_diagnoses"):
        items = ass.get(field)
        if isinstance(items, list):
            ass[field] = [item for item in items if not contradicts_negative(item)]

    # 2. Every prescription value must be directly supported by the transcript.
    plan["prescriptions"] = _validate_prescriptions_against_transcript(plan.get("prescriptions"), transcript)

    # 3. Follow-up must be transcript-grounded and live only in the dedicated field.
    if plan.get("follow_up"):
        spoken_follow_up = _spoken_transcript_span(plan.get("follow_up"), transcript)
        plan["follow_up"] = spoken_follow_up if spoken_follow_up and fp.search(spoken_follow_up) else None
    if not plan.get("follow_up"):
        for field in ("treatment_advice", "other_instructions"):
            items = plan.get(field)
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, str) and fp.search(item) and _is_transcript_grounded(item, transcript):
                        plan["follow_up"] = item.strip()
                        plan[field] = [x for x in items if x != item]
                        break
            if plan.get("follow_up"):
                break
    if not plan.get("follow_up"):
        for clause in _transcript_clauses(transcript):
            if fp.search(clause):
                plan["follow_up"] = clause
                break

    # 4. Warning signs contain only exact transcript-grounded conditions.
    existing_ws = []
    for item in plan.get("warning_signs") or []:
        condition = _warning_condition(item, transcript)
        if condition and condition.lower() not in {value.lower() for value in existing_ws}:
            existing_ws.append(condition)
    ws_lower = {value.lower() for value in existing_ws}

    for field in ("treatment_advice", "other_instructions", "diet_and_hydration_advice"):
        items = plan.get(field)
        if isinstance(items, list):
            moved = []
            for item in items:
                condition = _warning_condition(item, transcript) if isinstance(item, str) and ws_pat.search(item) else None
                if condition and condition.lower() not in ws_lower:
                    existing_ws.append(condition)
                    ws_lower.add(condition.lower())
                    moved.append(item)
            if moved:
                plan[field] = [x for x in items if x not in moved]

    plan["warning_signs"] = existing_ws

    # 3. Diagnoses consistency — enforce correct status
    if not ass.get("clinical_impression"):
        ass["clinical_impression"] = []
    if not ass.get("provisional_diagnoses"):
        ass["provisional_diagnoses"] = []
    if not ass.get("confirmed_diagnoses"):
        ass["confirmed_diagnoses"] = []
    if not ass.get("differential_diagnoses"):
        ass["differential_diagnoses"] = []

    has_confirmed = bool(ass["confirmed_diagnoses"])
    has_provisional = bool(ass["provisional_diagnoses"])
    has_differential = bool(ass["differential_diagnoses"])
    has_any_diagnosis = has_confirmed or has_provisional or has_differential

    if has_confirmed:
        ass["diagnosis_status"] = "confirmed"
    elif has_any_diagnosis:
        ass["diagnosis_status"] = "provisional"
    elif not has_any_diagnosis:
        ass["diagnosis_status"] = "not_stated"

    # 4. HPI from symptoms if missing
    if not sub.get("history_of_present_illness"):
        symptoms = sub.get("symptoms") or []
        if isinstance(symptoms, list):
            parts = []
            for sym in symptoms:
                if isinstance(sym, dict) and sym.get("name"):
                    name = sym["name"]
                    details = []
                    if sym.get("duration"):
                        details.append(f"for {sym['duration']}")
                    if sym.get("severity"):
                        details.append(sym["severity"])
                    if sym.get("progression"):
                        details.append(f"({sym['progression']})")
                    if details:
                        parts.append(f"{name} {' '.join(details)}")
                    else:
                        parts.append(name)
            if parts:
                sub["history_of_present_illness"] = "Patient presents with " + ", ".join(parts) + "."

    # 5. Scan additional_clinical_information for items that belong in dedicated fields
    if isinstance(extra, list):
        kept = []
        for item in extra:
            if not isinstance(item, dict):
                kept.append(item)
                continue
            info = item.get("information", "")
            if not info:
                kept.append(item)
                continue
            if not plan.get("follow_up") and fp.search(info) and _is_transcript_grounded(info, transcript):
                plan["follow_up"] = info.strip()
                continue
            condition = _warning_condition(info, transcript) if ws_pat.search(info) else None
            if condition and condition.lower() not in ws_lower:
                existing_ws.append(condition)
                ws_lower.add(condition.lower())
                plan["warning_signs"] = existing_ws
                continue
            kept.append(item)
        source["additional_clinical_information"] = kept

    return source


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


def _build_soap_prompt(transcript: str) -> str:
    return (
        "You are a clinical data extraction system. Extract EVERY clinically relevant fact from the ENTIRE consultation "
        "transcript below and organize it into SOAP (Subjective, Objective, Assessment, Plan) JSON.\n\n"
        "CRITICAL: You MUST read and process EVERY segment from the first utterance to the last. "
        "Do NOT stop after finding the chief complaint. Do NOT ignore later doctor instructions or patient answers. "
        "Pay special attention to code-switched Kannada, Hindi, and English sections — they contain clinical facts too.\n\n"
        "FOLLOW THIS THREE-PASS PROCESS INTERNALLY:\n\n"
        "PASS 1 — READ THE ENTIRE TRANSCRIPT:\n"
        "Read every line from start to finish. Preserve speaker labels and segment order. "
        "Note every piece of clinical information mentioned by either speaker at any point in the conversation.\n\n"
        "PASS 2 — EXTRACT EVERY CLINICAL FACT:\n"
        "Collect all explicitly mentioned facts into these categories. Do not skip any category that has data:\n"
        "- Symptoms and duration\n"
        "- Relevant negatives (explicitly denied conditions — preserve negation word)\n"
        "- Medical-history negatives (denied past conditions)\n"
        "- Allergies\n"
        "- Patient-reported vitals\n"
        "- Clinical impression\n"
        "- Provisional or confirmed diagnosis\n"
        "- Medicine names, strength, dose, frequency, timing, duration, PRN conditions\n"
        "- Treatment and diet advice\n"
        "- Follow-up instructions\n"
        "- Warning signs\n"
        "- Emergency actions\n\n"
        "PASS 3 — COVERAGE CHECK:\n"
        "Before finalizing, compare the complete transcript against your extracted JSON. "
        "Verify that EVERY doctor-spoken medication, advice, follow-up instruction, warning sign, "
        "and diagnosis statement, and EVERY patient-spoken symptom, negative finding, medical-history "
        "detail, allergy statement, and vital value has been placed in the correct SOAP field. "
        "If explicitly mentioned information is missing from the JSON, add it before returning.\n\n"
        "FIELD MAPPING (follow exactly):\n\n"
        "subjective.chief_complaints: array of strings — main reasons for visit\n"
        "subjective.history_of_present_illness: string or null — factual summary from mentioned symptoms, duration, severity, progression, relevant negatives\n"
        "subjective.symptoms: array of objects {name, duration, severity, progression, source: \"patient_reported\"|\"observed_by_doctor\"}\n"
        "subjective.associated_symptoms: array of strings\n"
        "subjective.relevant_negatives: array of strings — preserve negation in every entry: \"No breathing difficulty\", \"No throat pain\", \"No asthma\", \"No diabetes\", \"No hypertension\", \"No known allergies\". Never output only \"Breathing difficulty\" without negation.\n"
        "subjective.medical_conditions: array of strings — pre-existing conditions\n"
        "subjective.previous_surgeries: array of strings\n"
        "subjective.allergies: array of strings\n"
        "subjective.current_medicines: array of strings — medicines patient is currently taking\n"
        "subjective.family_history: array of strings\n"
        "subjective.social_history: array of strings\n"
        "objective.vitals: object — if patient reports temperature: {\"temperature\": {\"value\": 98, \"unit\": \"°F\", \"source\": \"patient_reported\"}}. Also blood_pressure, pulse, respiratory_rate, spo2, height, weight, bmi.\n"
        "objective.examination_findings: array of strings\n"
        "objective.available_test_results: array of strings\n"
        "assessment.clinical_impression: array of strings — doctor's thoughts. Populate when doctor uses uncertain wording: \"likely\", \"sounds like\", \"appears to be\", \"probably\", \"lag raha hai\", \"kanisuttide\".\n"
        "assessment.provisional_diagnoses: array of strings — use when doctor uses uncertain wording (\"likely\", \"sounds like\", \"probably\", \"could be\", etc.)\n"
        "assessment.confirmed_diagnoses: array of strings — only when doctor clearly confirms (\"this is\", \"diagnosed with\", \"confirmed\", \"definitely\")\n"
        "assessment.differential_diagnoses: array of strings — when multiple possibilities listed\n"
        "assessment.diagnosis_status: \"not_stated\"|\"provisional\"|\"confirmed\" — must match arrays above\n"
        "plan.prescriptions: array of objects — one per medicine. Fields: medicine_name (exact transcript text), strength, dose, schedule {morning, afternoon, night}, meal_timing, specific_timing, frequency, duration, as_needed (true only if \"as needed\"/\"if needed\"/\"PRN\" explicitly said), indication, additional_instructions, needs_doctor_review (true if uncertain). Example: {\"medicine_name\": \"Dolo 650\", \"strength\": \"650 mg\", \"dose\": null, \"schedule\": {\"morning\": null, \"afternoon\": null, \"night\": null}, \"meal_timing\": null, \"specific_timing\": null, \"frequency\": \"Every 8 hours\", \"duration\": \"Maximum 3 days\", \"as_needed\": true, \"indication\": \"If fever persists\", \"additional_instructions\": null, \"needs_doctor_review\": false}. Never guess missing fields — set them to null. Never rename, normalize, or truncate medicine name.\n"
        "plan.tests_ordered: array of strings\n"
        "plan.procedures: array of strings\n"
        "plan.treatment_advice: array of strings — store each instruction separately: \"Rest\", \"Warm fluids\", \"Stay hydrated\", \"Light food\", \"Warm water\"\n"
        "plan.diet_and_hydration_advice: array of strings\n"
        "plan.referrals: array of strings\n"
        "plan.follow_up: string or null — preserve the complete return/follow-up/recheck instruction as spoken, for example \"Come to the clinic in 2-3 days if symptoms are not improving\". Do NOT leave null when that instruction exists in the transcript.\n"
        "plan.warning_signs: array of strings — one exact warning condition per item, for example [\"Fever reaches 105°F\", \"Drowsiness\", \"Breathlessness\", \"Vomiting\"]. Do not replace the doctor's conditions with inferred wording, and do not mix follow-up instructions into this list.\n"
        "plan.other_instructions: array of strings\n"
        "additional_clinical_information: array of objects {information, suggested_category, source, needs_doctor_review} — for facts without a dedicated field\n\n"
        "STRICT RULES:\n"
        "1. Use ONLY information explicitly present in the complete transcript.\n"
        "2. Never invent clinical facts — no made-up symptoms, diagnoses, medicines, dosages, tests, vitals, advice, follow-up, or warnings.\n"
        "3. Never ignore later transcript sections — process every segment from first to last.\n"
        "4. Never drop Hindi-heavy, Kannada-heavy, or code-mixed segments.\n"
        "5. Preserve negation verbatim — never output a denied condition without \"No\"/\"Not\"/\"Denies\"/\"Without\"/\"Never had\".\n"
        "6. Preserve medicine names exactly as transcribed — never normalize or truncate.\n"
        "7. For uncertain medicine names: preserve transcript spelling, set needs_doctor_review=true.\n"
        "8. Keep missing fields null or empty arrays. Never guess dose, strength, frequency, duration, or timing.\n"
        "9. For uncertain transcript annotations ([uncertain: ...]): use the 'heard' text, not the 'possible' suggestion.\n"
        "10. For flagged phrases ([flagged: ...]): do not extract facts from them unless supported by surrounding context.\n"
        "11. Never convert symptoms into diagnoses. 'Fever' stays a symptom unless doctor explicitly diagnoses.\n"
        "12. Return valid JSON only — no Markdown, no explanations. Only the object with key 'ehr'.\n\n"
        "TRANSCRIPT:\n" + transcript
    )


async def _generate_with_ollama(transcript: str) -> tuple[dict[str, Any], str]:
    model = ehr_model_name()
    prompt = _build_soap_prompt(transcript)
    request_body = {
        "model": model,
        "stream": False,
        "think": "low",
        "keep_alive": "10m",
        "format": SOAP_EHR_JSON_SCHEMA,
        "messages": [
            {"role": "system", "content": "You extract structured SOAP clinical facts without adding medical advice. Never diagnose."},
            {"role": "user", "content": prompt},
        ],
        "options": {"temperature": 0},
    }
    timeout = aiohttp.ClientTimeout(total=ehr_generation_timeout_seconds())
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(f"{ollama_base_url()}/api/chat", json=request_body) as response:
                body = await response.text()
                if response.status >= 400:
                    raise RuntimeError(f"Ollama returned {response.status}: {body[:300]}")
    except aiohttp.ClientError as exc:
        raise RuntimeError("Ollama is not reachable. Start Ollama and install gpt-oss:20b.") from exc
    except TimeoutError as exc:
        raise RuntimeError("Local EHR generation timed out. Try a shorter transcript or increase the timeout.") from exc

    try:
        response_payload = json.loads(body)
        content = response_payload.get("message", {}).get("content", "")
        generated = json.loads(content) if isinstance(content, str) else content
    except (json.JSONDecodeError, TypeError, AttributeError) as exc:
        raise RuntimeError("The local model returned invalid structured EHR data.") from exc

    ehr_data = generated.get("ehr", {})
    soap_ehr = _normalize_soap_ehr(ehr_data)
    soap_ehr = _validate_and_fix_soap_coverage(soap_ehr, transcript)
    return soap_ehr, model


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
    if payload.doctor_id:
        doctor_result = await db.execute(
            select(Doctor).where(Doctor.doctor_id == payload.doctor_id, Doctor.clinic_id == payload.clinic_id)
        )
        if not doctor_result.scalar_one_or_none():
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

    segments = _segments_payload(payload.transcript_segments)
    transcript = _transcript_text(segments)
    if len(transcript) < 20:
        raise HTTPException(status_code=400, detail="The transcript is too short to create an EHR draft")

    try:
        soap_ehr, model = await _generate_with_ollama(transcript)
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

    soap_ehr["visit_details"] = {
        "patient_name": payload.patient_name or patient.name,
        "phone_number": payload.patient_phone or patient.phone or "",
        "patient_id": patient.patient_id,
        "clinic_name": clinic.clinic_name,
        "visit_datetime": visit_datetime,
    }

    soap_ehr["approval"] = {
        "status": "draft",
        "approved_by_doctor_id": None,
        "approved_at": None,
        "version": 1,
    }

    ehr_data = soap_ehr
    patient_summary = _generate_patient_summary_from_soap(soap_ehr)

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
    if ehr_data.get("schema_version") == SOAP_SCHEMA_VERSION:
        ehr_data = _normalize_soap_ehr(ehr_data)
        ehr_data["visit_details"] = payload.ehr_data.get("visit_details", encounter.ehr_data.get("visit_details", _empty_soap_ehr()["visit_details"]))
        ehr_data["private_doctor_notes"] = _clean_text(payload.ehr_data.get("private_doctor_notes")) or ""
        approval = encounter.ehr_data.get("approval", {}) if isinstance(encounter.ehr_data, dict) else {}
        ehr_data["approval"] = {
            "status": "draft",
            "approved_by_doctor_id": None,
            "approved_at": None,
            "version": approval.get("version", 1),
        }
        encounter.ehr_data = ehr_data
    else:
        encounter.ehr_data = _normalize_legacy_ehr(ehr_data)

    encounter.patient_summary = _normalize_patient_summary(payload.patient_summary)
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
    if isinstance(ehr_data, dict) and ehr_data.get("schema_version") == SOAP_SCHEMA_VERSION:
        version = ehr_data.get("approval", {}).get("version", 1)
        new_version = version + 1 if encounter.status == "approved" else version
        ehr_data["approval"] = {
            "status": "approved",
            "approved_by_doctor_id": approver,
            "approved_at": now.isoformat(),
            "version": new_version,
        }
        ehr_data["private_doctor_notes"] = _clean_text(ehr_data.get("private_doctor_notes")) or ""
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
        payload["doctor"] = {
            "doctor_id": item.doctor_id,
            "name": doctor.name if doctor else (appointment.doctor_name if appointment else clinic.doctor_name),
            "specialization": doctor.specialization if doctor else clinic.specialization,
            "qualifications": doctor.qualifications if doctor else clinic.qualifications,
        }
        payload["visit"] = {
            "appointment_id": item.appointment_id,
            "appointment_token": appointment.appointment_token if appointment else None,
            "date": appointment.date if appointment else None,
            "time": appointment.time if appointment else None,
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
