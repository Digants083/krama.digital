import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Query, status
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


EHR_FIELDS = (
    "chief_complaint",
    "symptoms",
    "symptom_duration",
    "medical_history",
    "existing_conditions",
    "allergies",
    "current_medications",
    "vitals",
    "examination_findings",
    "diagnoses",
    "investigations",
    "prescriptions",
    "treatment_plan",
    "follow_up",
    "warning_signs",
    "private_doctor_notes",
)

LIST_EHR_FIELDS = {
    "symptoms",
    "medical_history",
    "existing_conditions",
    "allergies",
    "current_medications",
    "examination_findings",
    "diagnoses",
    "investigations",
    "prescriptions",
    "warning_signs",
}

SUMMARY_FIELDS = (
    "visit_overview",
    "medicines",
    "tests",
    "diet_advice",
    "doctor_suggestions",
    "instructions",
    "follow_up",
    "warning_signs",
)

LIST_SUMMARY_FIELDS = {
    "medicines",
    "tests",
    "diet_advice",
    "doctor_suggestions",
    "instructions",
    "warning_signs",
}


EHR_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["ehr", "patient_summary"],
    "properties": {
        "ehr": {
            "type": "object",
            "additionalProperties": False,
            "required": list(EHR_FIELDS),
            "properties": {
                "chief_complaint": {"type": ["string", "null"]},
                "symptoms": {"type": "array", "items": {"type": "string"}},
                "symptom_duration": {"type": ["string", "null"]},
                "medical_history": {"type": "array", "items": {"type": "string"}},
                "existing_conditions": {"type": "array", "items": {"type": "string"}},
                "allergies": {"type": "array", "items": {"type": "string"}},
                "current_medications": {"type": "array", "items": {"type": "string"}},
                "vitals": {"type": "object", "additionalProperties": {"type": "string"}},
                "examination_findings": {"type": "array", "items": {"type": "string"}},
                "diagnoses": {"type": "array", "items": {"type": "string"}},
                "investigations": {"type": "array", "items": {"type": "string"}},
                "prescriptions": {"type": "array", "items": {"type": "string"}},
                "treatment_plan": {"type": ["string", "null"]},
                "follow_up": {"type": ["string", "null"]},
                "warning_signs": {"type": "array", "items": {"type": "string"}},
                "private_doctor_notes": {"type": ["string", "null"]},
            },
        },
        "patient_summary": {
            "type": "object",
            "additionalProperties": False,
            "required": list(SUMMARY_FIELDS),
            "properties": {
                "visit_overview": {"type": ["string", "null"]},
                "medicines": {"type": "array", "items": {"type": "string"}},
                "tests": {"type": "array", "items": {"type": "string"}},
                "diet_advice": {"type": "array", "items": {"type": "string"}},
                "doctor_suggestions": {"type": "array", "items": {"type": "string"}},
                "instructions": {"type": "array", "items": {"type": "string"}},
                "follow_up": {"type": ["string", "null"]},
                "warning_signs": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
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


def _normalize_ehr(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    result: dict[str, Any] = {}
    for field in EHR_FIELDS:
        if field in LIST_EHR_FIELDS:
            result[field] = _clean_list(source.get(field))
        elif field == "vitals":
            raw_vitals = source.get(field)
            result[field] = {}
            for key, item in (raw_vitals.items() if isinstance(raw_vitals, dict) else []):
                clean_key = str(key).strip()
                clean_value = _clean_text(item)
                if clean_key and clean_value:
                    result[field][clean_key] = clean_value
        else:
            result[field] = _clean_text(source.get(field))
    return result


def _normalize_patient_summary(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    return {
        field: _clean_list(source.get(field)) if field in LIST_SUMMARY_FIELDS else _clean_text(source.get(field))
        for field in SUMMARY_FIELDS
    }


def _segments_payload(segments: list[TranscriptSegment]) -> list[dict[str, Any]]:
    return [segment.dict() for segment in segments if segment.text.strip()]


def _transcript_text(segments: list[dict[str, Any]]) -> str:
    return "\n".join(f"{segment['speaker']}: {segment['text'].strip()}" for segment in segments)


def _encounter_payload(encounter: ClinicalEncounter, include_transcript: bool = True) -> dict[str, Any]:
    payload = {
        "id": encounter.id,
        "encounter_id": encounter.encounter_id,
        "clinic_id": encounter.clinic_id,
        "patient_id": encounter.patient_id,
        "doctor_id": encounter.doctor_id,
        "appointment_id": encounter.appointment_id,
        "patient_name": encounter.patient_name,
        "status": encounter.status,
        "ehr_data": encounter.ehr_data or {},
        "patient_summary": encounter.patient_summary or {},
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


async def _generate_with_ollama(transcript: str) -> tuple[dict[str, Any], dict[str, Any], str]:
    model = ehr_model_name()
    prompt = (
        "Convert the consultation transcript into a factual EHR draft. Use only facts explicitly stated in "
        "the transcript. Never infer a diagnosis, medicine, dose, allergy, vital, test, or follow-up. Use null "
        "or [] when information is absent. Preserve medicine names, doses, frequency, duration, and warning signs "
        "exactly when stated. Current medications means medicines the patient was already taking before this visit; "
        "put newly prescribed medicines only in prescriptions. Omit unknown vital keys instead of writing the word "
        "null. In the patient summary, separate food, hydration, and diet guidance into diet_advice; put the doctor's "
        "other recommendations into doctor_suggestions. Do not invent diet advice when none was discussed. The "
        "patient summary must be simple, non-technical, and must not contain private "
        "doctor notes. This is an unapproved draft for doctor review.\n\nTRANSCRIPT:\n" + transcript
    )
    request_body = {
        "model": model,
        "stream": False,
        # GPT-OSS emits an empty final message when reasoning is disabled in
        # Ollama. Low reasoning keeps latency down while preserving JSON output.
        "think": "low",
        "keep_alive": "10m",
        "format": EHR_JSON_SCHEMA,
        "messages": [
            {"role": "system", "content": "You extract structured clinical facts without adding medical advice."},
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

    return _normalize_ehr(generated.get("ehr")), _normalize_patient_summary(generated.get("patient_summary")), model


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
    await _require_clinic(db, payload.clinic_id)
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
        ehr_data, patient_summary, model = await _generate_with_ollama(transcript)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

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
    encounter.ehr_data = _normalize_ehr(payload.ehr_data)
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
    encounter.status = "approved"
    encounter.approved_by = approver
    encounter.approved_at = datetime.now(timezone.utc)
    encounter.updated_at = datetime.now(timezone.utc)
    _add_audit_event(db, encounter, "approved", approver)
    await db.commit()
    await db.refresh(encounter)
    return _encounter_payload(encounter)


@router.get("/clinic/{clinic_id}/patient/{patient_id}")
async def get_clinic_patient_ehr(clinic_id: str, patient_id: str, db: AsyncSession = Depends(get_db)):
    await _require_clinic(db, clinic_id)
    patient = await _require_patient(db, patient_id)
    result = await db.execute(
        select(ClinicalEncounter)
        .where(ClinicalEncounter.clinic_id == clinic_id, ClinicalEncounter.patient_id == patient_id)
        .order_by(ClinicalEncounter.created_at.desc(), ClinicalEncounter.id.desc())
    )
    encounters = result.scalars().all()
    return {
        "patient": {"patient_id": patient.patient_id, "name": patient.name, "phone": patient.phone, "blood_group": patient.blood_group},
        "encounters": [_encounter_payload(item, include_transcript=False) for item in encounters],
    }


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
