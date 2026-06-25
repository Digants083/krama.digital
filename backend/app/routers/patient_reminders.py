from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.db import get_db
from app.database.models import PatientRevisitReminder

router = APIRouter(prefix="/patient-reminders", tags=["patient-reminders"])


class RevisitReminderPayload(BaseModel):
    clinic_id: str
    patient_id: Optional[str] = None
    patient_name: str
    patient_phone: Optional[str] = None
    patient_email: Optional[str] = None
    appointment_id: Optional[int] = None
    token: Optional[str] = None
    reminder_days: Optional[int] = None
    revisit_date: str


def _model_data(model: BaseModel) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _row_to_reminder(row: PatientRevisitReminder) -> Dict[str, Any]:
    return {
        "id": row.id,
        "clinic_id": row.clinic_id,
        "patient_id": row.patient_id,
        "patient_name": row.patient_name,
        "patient_phone": row.patient_phone,
        "patient_email": row.patient_email,
        "appointment_id": row.appointment_id,
        "token": row.token,
        "reminder_days": row.reminder_days,
        "revisit_date": row.revisit_date,
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/latest")
async def get_latest_revisit_reminder(
    clinic_id: str = Query(...),
    patient_id: Optional[str] = Query(None),
    phone: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    if not patient_id and not phone:
        return None

    identity_filters = []
    if patient_id:
        identity_filters.append(PatientRevisitReminder.patient_id == patient_id)
    if phone:
        identity_filters.append(PatientRevisitReminder.patient_phone == phone)

    result = await db.execute(
        select(PatientRevisitReminder)
        .where(
            PatientRevisitReminder.clinic_id == clinic_id,
            PatientRevisitReminder.status == "active",
            or_(*identity_filters),
        )
        .order_by(desc(PatientRevisitReminder.created_at))
        .limit(1)
    )
    row = result.scalar_one_or_none()
    return _row_to_reminder(row) if row else None


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_revisit_reminder(payload: RevisitReminderPayload, db: AsyncSession = Depends(get_db)):
    patient_name = payload.patient_name.strip()
    if not patient_name:
        raise HTTPException(status_code=400, detail="Patient name is required")
    if not payload.revisit_date:
        raise HTTPException(status_code=400, detail="Revisit date is required")

    data = _model_data(payload)
    data["patient_name"] = patient_name
    data["status"] = "active"
    row = PatientRevisitReminder(**data)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_to_reminder(row)
