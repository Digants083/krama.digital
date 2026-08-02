from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.db import get_db
from app.database.models import ClinicalEncounter, CompletedAppointment
from app.security import ClinicPrincipal, require_clinic_principal, require_matching_clinic

router = APIRouter(prefix="/patient", tags=["patient-history"])


def _clean_identifier(value: Optional[str]) -> str:
    return (value or "").strip()


def _encounter_visit_parts(encounter: ClinicalEncounter) -> tuple[str, str]:
    ehr_data = encounter.ehr_data if isinstance(encounter.ehr_data, dict) else {}
    visit_details = ehr_data.get("visit_details") if isinstance(ehr_data.get("visit_details"), dict) else {}
    visit_datetime = str(visit_details.get("visit_datetime") or "")
    if len(visit_datetime) >= 10:
        return visit_datetime[:10], visit_datetime[11:16] if len(visit_datetime) >= 16 else ""
    created_at = encounter.created_at
    if created_at:
        return created_at.date().isoformat(), created_at.strftime("%H:%M")
    return "", ""


@router.get("/history/{clinic_id}/{patient_id}")
async def get_patient_history(
    clinic_id: str,
    patient_id: str,
    phone: Optional[str] = Query(default=None),
    email: Optional[str] = Query(default=None),
    principal: ClinicPrincipal = Depends(require_clinic_principal),
    db: AsyncSession = Depends(get_db),
):
    """
    Return completed visit history for a patient at one clinic.
    Counts only served/completed appointments for the same clinic and patient.
    """
    clinic_id = _clean_identifier(clinic_id)
    clinic_id = require_matching_clinic(principal, clinic_id)
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

    encounter_filters = [
        ClinicalEncounter.clinic_id == clinic_id,
        ClinicalEncounter.status == "approved",
    ]
    encounter_matches = []
    if patient_id and patient_id != "lookup":
        encounter_matches.append(ClinicalEncounter.patient_id == patient_id)
    if phone:
        encounter_matches.append(ClinicalEncounter.patient_phone == phone)
    if email:
        encounter_matches.append(ClinicalEncounter.patient_email.ilike(email))
    if encounter_matches:
        encounter_filters.append(or_(*encounter_matches))

    encounter_result = await db.execute(
        select(ClinicalEncounter)
        .where(and_(*encounter_filters))
        .order_by(
            ClinicalEncounter.approved_at.desc().nullslast(),
            ClinicalEncounter.created_at.desc(),
            ClinicalEncounter.id.desc(),
        )
    )
    all_approved_encounters = encounter_result.scalars().all()

    encounters = []
    seen_sessions = set()
    for encounter in all_approved_encounters:
        visit_date, visit_time = _encounter_visit_parts(encounter)
        session_key = (
            ("appointment", encounter.appointment_id)
            if encounter.appointment_id is not None
            else ("visit", encounter.patient_id, visit_date, visit_time)
        )
        if session_key in seen_sessions:
            continue
        seen_sessions.add(session_key)
        encounters.append(encounter)

    encounters_by_visit: dict[tuple[str, str], list[ClinicalEncounter]] = {}
    encounters_by_date: dict[str, list[ClinicalEncounter]] = {}
    for encounter in encounters:
        visit_date, visit_time = _encounter_visit_parts(encounter)
        encounters_by_visit.setdefault((visit_date, visit_time), []).append(encounter)
        encounters_by_date.setdefault(visit_date, []).append(encounter)

    previous_visits = []
    linked_encounter_ids: set[str] = set()
    for visit in visits:
        normalized_time = str(visit.time or "")[:5]
        matching = encounters_by_visit.get((str(visit.date or ""), normalized_time), [])
        encounter = next(
            (item for item in matching if item.encounter_id not in linked_encounter_ids),
            None,
        )
        if encounter is None:
            same_date = [
                item for item in encounters_by_date.get(str(visit.date or ""), [])
                if item.encounter_id not in linked_encounter_ids
            ]
            if len(same_date) == 1:
                encounter = same_date[0]
        if encounter:
            linked_encounter_ids.add(encounter.encounter_id)
        previous_visits.append({
            "id": visit.id,
            "date": visit.date,
            "time": normalized_time,
            "appointment_token": visit.appointment_token,
            "encounter_id": encounter.encounter_id if encounter else None,
        })

    # Include every final approved EHR even when its appointment-history row
    # was removed or never created. Draft/discarded experiments never count as
    # additional visits.
    for encounter in encounters:
        if encounter.encounter_id in linked_encounter_ids:
            continue
        visit_date, visit_time = _encounter_visit_parts(encounter)
        previous_visits.append({
            "id": None,
            "date": visit_date,
            "time": visit_time,
            "appointment_token": None,
            "encounter_id": encounter.encounter_id,
        })

    previous_visits.sort(
        key=lambda item: (str(item.get("date") or ""), str(item.get("time") or "")),
        reverse=True,
    )

    last_visit = previous_visits[0]["date"] if previous_visits else None

    return {
        "is_returning": len(previous_visits) > 0,
        "visit_count": len(previous_visits),
        "last_visit": last_visit,
        "previous_visits": previous_visits,
    }
