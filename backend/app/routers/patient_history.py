from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.db import get_db
from app.database.models import CompletedAppointment

router = APIRouter(prefix="/patient", tags=["patient-history"])


def _clean_identifier(value: Optional[str]) -> str:
    return (value or "").strip()


@router.get("/history/{clinic_id}/{patient_id}")
async def get_patient_history(
    clinic_id: str,
    patient_id: str,
    phone: Optional[str] = Query(default=None),
    email: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """
    Return completed visit history for a patient at one clinic.
    Counts only served/completed appointments for the same clinic and patient.
    """
    clinic_id = _clean_identifier(clinic_id)
    patient_id = _clean_identifier(patient_id)
    phone = _clean_identifier(phone)
    email = _clean_identifier(email).lower()

    if not clinic_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="clinic_id and at least one patient identifier are required",
        )

    patient_match_filters = []
    if patient_id and patient_id != "lookup":
        patient_match_filters.append(CompletedAppointment.patient_id == patient_id)
    if phone:
        patient_match_filters.append(CompletedAppointment.patient_phone == phone)
    if email:
        patient_match_filters.append(CompletedAppointment.patient_email == email)
    if not patient_match_filters:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one patient identifier is required",
        )

    completed_filters = and_(
        CompletedAppointment.clinic_id == clinic_id,
        or_(*patient_match_filters),
        CompletedAppointment.status.notin_(["cancelled", "skipped", "not_served", "auto_finished"]),
        or_(
            CompletedAppointment.status.in_(["completed", "served"]),
            CompletedAppointment.outcome == "served",
            CompletedAppointment.served.is_(True),
        ),
        or_(CompletedAppointment.outcome.is_(None), CompletedAppointment.outcome != "not_served"),
    )

    result = await db.execute(
        select(CompletedAppointment)
        .where(completed_filters)
        .order_by(
            CompletedAppointment.date.desc(),
            CompletedAppointment.served_at.desc(),
            CompletedAppointment.id.desc(),
        )
    )
    visits = result.scalars().all()

    previous_visits = []
    for visit in visits:
        previous_visits.append({
            "id": visit.id,
            "date": visit.date,
        })

    last_visit = visits[0].date if visits else None

    return {
        "is_returning": len(visits) > 0,
        "visit_count": len(visits),
        "last_visit": last_visit,
        "previous_visits": previous_visits,
    }
