from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.db import get_db
from app.database.models import Clinic, ClinicalEncounter, CompletedAppointment, Patient, PatientHealthDocument


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


@router.get("/summary")
async def get_patient_summary(patient_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    await _require_patient(db, patient_id)
    result = await db.execute(
        select(CompletedAppointment)
        .where(
            CompletedAppointment.patient_id == patient_id,
            CompletedAppointment.status.notin_(["cancelled", "skipped", "not_served", "auto_finished"]),
        )
        .order_by(
            CompletedAppointment.date.desc(),
            CompletedAppointment.served_at.desc(),
            CompletedAppointment.id.desc(),
        )
    )
    visits = result.scalars().all()
    ehr_result = await db.execute(
        select(ClinicalEncounter)
        .where(ClinicalEncounter.patient_id == patient_id, ClinicalEncounter.status == "approved")
        .order_by(ClinicalEncounter.approved_at.desc(), ClinicalEncounter.id.desc())
    )
    approved_ehrs = ehr_result.scalars().all()
    clinic_ids = list({visit.clinic_id for visit in visits} | {record.clinic_id for record in approved_ehrs})
    clinic_names = {}
    if clinic_ids:
        clinic_result = await db.execute(select(Clinic).where(Clinic.clinic_id.in_(clinic_ids)))
        clinic_names = {clinic.clinic_id: clinic.clinic_name for clinic in clinic_result.scalars().all()}

    visit_items = []
    for visit in visits:
        details = [value.strip() for value in [visit.diagnosis, visit.notes] if value and value.strip()]
        visit_items.append({
            "id": visit.id,
            "clinic_id": visit.clinic_id,
            "clinic_name": clinic_names.get(visit.clinic_id, "Clinic"),
            "doctor_name": visit.doctor_name,
            "date": visit.date,
            "time": visit.time,
            "diagnosis": visit.diagnosis,
            "notes": visit.notes,
            "summary": " ".join(details) if details else None,
            "summary_status": "available" if details else "pending_clinical_record",
        })

    total = len(visit_items)
    clinics = len(clinic_ids)
    ehr_items = [
        {
            "encounter_id": record.encounter_id,
            "clinic_id": record.clinic_id,
            "clinic_name": clinic_names.get(record.clinic_id, "Clinic"),
            "doctor_id": record.doctor_id,
            "approved_at": record.approved_at,
            "summary": record.patient_summary or {},
        }
        for record in approved_ehrs
    ]
    return {
        "overview": {
            "total_visits": total,
            "clinics_visited": clinics,
            "approved_ehr_count": len(ehr_items),
            "summary": (
                f"You have {total} completed clinic visit{'s' if total != 1 else ''} and "
                f"{len(ehr_items)} doctor-approved health summar{'ies' if len(ehr_items) != 1 else 'y'}."
                if total or ehr_items else "Your completed clinic visits will appear here."
            ),
        },
        "visits": visit_items,
        "ehr_summaries": ehr_items,
    }
