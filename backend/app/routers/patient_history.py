from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.db import get_db
from app.database.models import CompletedAppointment

router = APIRouter(prefix="/patient", tags=["patient-history"])


@router.get("/history/{clinic_id}/{patient_id}")
async def get_patient_history(
    clinic_id: str,
    patient_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Return completed visit history for a patient at one clinic.
    Counts only served/completed appointments for the same clinic and patient.
    """
    if not clinic_id.strip() or not patient_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="clinic_id and patient_id are required",
        )

    completed_filters = and_(
        CompletedAppointment.clinic_id == clinic_id,
        CompletedAppointment.patient_id == patient_id,
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

    previous_notes = []
    for visit in visits:
        diagnosis = getattr(visit, "diagnosis", None)
        notes = getattr(visit, "notes", None)
        if diagnosis or notes:
            previous_notes.append({
                "date": visit.date,
                "diagnosis": diagnosis or "",
                "notes": notes or "",
            })

    last_visit = visits[0].date if visits else None

    return {
        "is_returning": len(visits) > 0,
        "visit_count": len(visits),
        "last_visit": last_visit,
        "previous_notes": previous_notes,
    }
