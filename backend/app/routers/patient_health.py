from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.db import get_db
from app.database.models import Appointment, Clinic, ClinicalEncounter, CompletedAppointment, Patient, PatientHealthDocument


router = APIRouter(prefix="/patient-health", tags=["patient-health"])
MAX_DOCUMENT_SIZE = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}


async def _require_patient(db: AsyncSession, patient_id: str) -> Patient:
    result = await db.execute(select(Patient).where(Patient.patient_id == patient_id))
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


@router.post("/documents")
async def upload_health_document(
    patient_id: str = Query(...),
    document_type: str = Query("medical_report"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    await _require_patient(db, patient_id)
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Upload a PDF, JPG, or PNG file")
    content = await file.read(MAX_DOCUMENT_SIZE + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The selected file is empty")
    if len(content) > MAX_DOCUMENT_SIZE:
        raise HTTPException(status_code=400, detail="The file must be 10 MB or smaller")

    document = PatientHealthDocument(
        patient_id=patient_id,
        source="patient_upload",
        document_type=document_type[:80],
        filename=Path(file.filename or "medical-report").name[:255],
        content_type=file.content_type,
        file_data=content,
        processing_status="uploaded",
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)
    return {
        "id": document.id,
        "filename": document.filename,
        "document_type": document.document_type,
        "source": document.source,
        "processing_status": document.processing_status,
        "created_at": document.created_at,
    }


@router.get("/documents")
async def list_health_documents(patient_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    await _require_patient(db, patient_id)
    result = await db.execute(
        select(PatientHealthDocument)
        .where(PatientHealthDocument.patient_id == patient_id)
        .order_by(PatientHealthDocument.created_at.desc(), PatientHealthDocument.id.desc())
    )
    return {
        "documents": [
            {
                "id": item.id,
                "filename": item.filename,
                "document_type": item.document_type,
                "source": item.source,
                "processing_status": item.processing_status,
                "created_at": item.created_at,
            }
            for item in result.scalars().all()
        ]
    }


@router.get("/documents/{document_id}/file")
async def view_health_document(
    document_id: int, patient_id: str = Query(...), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(PatientHealthDocument).where(
            PatientHealthDocument.id == document_id,
            PatientHealthDocument.patient_id == patient_id,
        )
    )
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return Response(
        content=bytes(document.file_data),
        media_type=document.content_type,
        headers={"Content-Disposition": f'inline; filename="{document.filename}"'},
    )


def _clean_text(value: Any) -> str | None:
    if not value or not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped if stripped else None


def _clean_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if item and str(item).strip()]


def _clean_medicines(value: Any) -> list[Any]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if isinstance(item, dict) and item.get("medicine_name"):
            result.append({
                "medicine_name": str(item["medicine_name"]).strip(),
                "strength": str(item["strength"]).strip() if item.get("strength") else None,
                "dose": str(item["dose"]).strip() if item.get("dose") else None,
                "schedule": {
                    "morning": str(item["schedule"]["morning"]).strip() if isinstance(item.get("schedule"), dict) and item["schedule"].get("morning") else None,
                    "afternoon": str(item["schedule"]["afternoon"]).strip() if isinstance(item.get("schedule"), dict) and item["schedule"].get("afternoon") else None,
                    "night": str(item["schedule"]["night"]).strip() if isinstance(item.get("schedule"), dict) and item["schedule"].get("night") else None,
                } if isinstance(item.get("schedule"), dict) else None,
                "meal_timing": str(item["meal_timing"]).strip() if item.get("meal_timing") else None,
                "specific_timing": str(item["specific_timing"]).strip() if item.get("specific_timing") else None,
                "frequency": str(item["frequency"]).strip() if item.get("frequency") else None,
                "duration": str(item["duration"]).strip() if item.get("duration") else None,
                "as_needed": bool(item.get("as_needed", False)),
                "indication": str(item["indication"]).strip() if item.get("indication") else None,
                "additional_instructions": str(item["additional_instructions"]).strip() if item.get("additional_instructions") else None,
            })
        elif isinstance(item, str) and item.strip():
            result.append(item.strip())
    return result


def _normalize_summary(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {
            "reason_for_visit": None, "what_the_doctor_assessed": None,
            "medicines": [], "tests": [], "diet_and_hydration_advice": [],
            "doctor_instructions": [], "follow_up": None, "when_to_seek_help": [],
        }
    new_keys = {"reason_for_visit", "what_the_doctor_assessed", "medicines", "tests",
                "diet_and_hydration_advice", "doctor_instructions", "follow_up", "when_to_seek_help"}
    if new_keys.intersection(raw.keys()):
        return {
            "reason_for_visit": _clean_text(raw.get("reason_for_visit")),
            "what_the_doctor_assessed": _clean_text(raw.get("what_the_doctor_assessed")),
            "medicines": _clean_medicines(raw.get("medicines", [])),
            "tests": _clean_list(raw.get("tests", [])),
            "diet_and_hydration_advice": _clean_list(raw.get("diet_and_hydration_advice", [])),
            "doctor_instructions": _clean_list(raw.get("doctor_instructions", [])),
            "follow_up": _clean_text(raw.get("follow_up")),
            "when_to_seek_help": _clean_list(raw.get("when_to_seek_help", [])),
        }
    return {
        "reason_for_visit": _clean_text(raw.get("visit_overview")),
        "what_the_doctor_assessed": None,
        "medicines": _clean_medicines(raw.get("medicines", [])),
        "tests": _clean_list(raw.get("tests", [])),
        "diet_and_hydration_advice": _clean_list(raw.get("diet_advice", [])),
        "doctor_instructions": _clean_list(raw.get("doctor_suggestions", []) or raw.get("instructions", [])),
        "follow_up": _clean_text(raw.get("follow_up")),
        "when_to_seek_help": _clean_list(raw.get("warning_signs", [])),
    }


@router.get("/summary")
async def get_patient_summary(patient_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    await _require_patient(db, patient_id)

    visits_result = await db.execute(
        select(CompletedAppointment)
        .where(
            CompletedAppointment.patient_id == patient_id,
            CompletedAppointment.status.notin_(["cancelled", "skipped", "not_served", "auto_finished"]),
        )
        .order_by(CompletedAppointment.date.desc(), CompletedAppointment.served_at.desc(), CompletedAppointment.id.desc())
    )
    visits = visits_result.scalars().all()

    ehr_result = await db.execute(
        select(ClinicalEncounter)
        .where(ClinicalEncounter.patient_id == patient_id, ClinicalEncounter.status == "approved")
        .order_by(ClinicalEncounter.approved_at.desc(), ClinicalEncounter.id.desc())
    )
    approved_ehrs = ehr_result.scalars().all()

    all_clinic_ids = {v.clinic_id for v in visits} | {e.clinic_id for e in approved_ehrs}
    clinic_names = {}
    if all_clinic_ids:
        clinic_result = await db.execute(select(Clinic).where(Clinic.clinic_id.in_(all_clinic_ids)))
        clinic_names = {c.clinic_id: c.clinic_name for c in clinic_result.scalars().all()}

    # Build encounter lookup by appointment_token
    enc_appointment_ids = [e.appointment_id for e in approved_ehrs if e.appointment_id is not None]
    apt_by_id = {}
    if enc_appointment_ids:
        apt_result = await db.execute(select(Appointment).where(Appointment.id.in_(enc_appointment_ids)))
        apt_by_id = {a.id: a for a in apt_result.scalars().all()}

    enc_by_token = {}
    enc_by_fallback = {}
    for enc in approved_ehrs:
        apt = apt_by_id.get(enc.appointment_id) if enc.appointment_id else None
        if apt:
            enc_by_token[apt.appointment_token] = enc
            enc_by_fallback[f"{enc.clinic_id}|{apt.date}|{apt.time}"] = enc

    unified = []
    linked_encounter_ids = set()

    for visit in visits:
        enc = enc_by_token.get(visit.appointment_token)
        if not enc:
            enc = enc_by_fallback.get(f"{visit.clinic_id}|{visit.date}|{visit.time}")

        raw_summary = enc.patient_summary or {} if enc else {}
        summary = _normalize_summary(raw_summary) if enc else {}
        has_summary = bool(enc and any(
            v for v in summary.values() if v
        ))

        if enc:
            linked_encounter_ids.add(enc.encounter_id)

        apt = apt_by_id.get(enc.appointment_id) if enc and enc.appointment_id else None

        unified.append({
            "id": visit.id,
            "encounter_id": enc.encounter_id if enc else None,
            "clinic_name": clinic_names.get(visit.clinic_id, "Clinic"),
            "doctor_name": visit.doctor_name,
            "date": visit.date,
            "time": visit.time,
            "visit_type": apt.source if apt else "in-clinic",
            "summary_status": "available" if has_summary else ("being_prepared" if enc else "not_available"),
            "summary": summary if has_summary else None,
            "approved_at": enc.approved_at.isoformat() if enc and enc.approved_at else None,
        })

    # Include approved encounters not linked to any completed appointment
    for enc in approved_ehrs:
        if enc.encounter_id in linked_encounter_ids:
            continue
        apt = apt_by_id.get(enc.appointment_id) if enc.appointment_id else None
        raw_summary = enc.patient_summary or {}
        summary = _normalize_summary(raw_summary)
        has_summary = any(v for v in summary.values() if v)
        unified.append({
            "id": None,
            "encounter_id": enc.encounter_id,
            "clinic_name": clinic_names.get(enc.clinic_id, "Clinic"),
            "doctor_name": apt.doctor_name if apt else "Doctor",
            "date": apt.date if apt else (enc.approved_at.strftime("%Y-%m-%d") if enc.approved_at else ""),
            "time": apt.time if apt else "",
            "visit_type": apt.source if apt else "in-clinic",
            "summary_status": "available" if has_summary else "being_prepared",
            "summary": summary if has_summary else None,
            "approved_at": enc.approved_at.isoformat() if enc.approved_at else None,
        })

    total_visits = len(unified)
    clinics_visited = len({v["clinic_name"] for v in unified})
    approved_count = len([v for v in unified if v["encounter_id"] is not None])

    return {
        "overview": {
            "total_visits": total_visits,
            "clinics_visited": clinics_visited,
            "approved_ehr_count": approved_count,
        },
        "visits": unified,
    }
