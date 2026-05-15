from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.db import get_db
from app.database.models import Appointment, Clinic, ClinicTimeSlot, CompletedAppointment, DoctorSession, Patient, QRAppointment
from app.services.email_service import send_delay_alert, send_patient_delay_email

router = APIRouter(prefix="/sessions", tags=["sessions"])
CLINIC_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
ACTIVE_STATUSES = ["booked", "pending", "serving", "skipped"]


def _clinic_now() -> datetime:
    return datetime.now(CLINIC_TIMEZONE)


def _today() -> str:
    return _clinic_now().strftime("%Y-%m-%d")


def _load_json_list(value):
    if isinstance(value, str):
        return json.loads(value) if value else []
    return list(value or [])


def _slot_time_label(value: float) -> str:
    total_minutes = int(round(value * 60)) % (24 * 60)
    hour24 = total_minutes // 60
    minute = total_minutes % 60
    hour12 = hour24 % 12 or 12
    suffix = "PM" if hour24 >= 12 else "AM"
    return f"{hour12}:{minute:02d} {suffix}"


def _time_range_label(time_range: list) -> str:
    if not isinstance(time_range, list) or len(time_range) < 2:
        return ""
    return f"{_slot_time_label(float(time_range[0]))} - {_slot_time_label(float(time_range[1]))}"


def _slot_is_open(slot: dict, slot_state: Optional[str]) -> bool:
    return bool(slot.get("is_open")) and slot_state != "close"


def _is_overnight_tail_active(slot: dict, slot_state: Optional[str], current_decimal: float) -> bool:
    if not _slot_is_open(slot, slot_state):
        return False
    time_range = slot.get("time_range", [0, 0])
    if not isinstance(time_range, list) or len(time_range) < 2:
        return False
    end = float(time_range[1])
    return end > 24 and current_decimal < (end - 24)


def _timeline_now_for_sessions(slots: list, slot_states: list, current_decimal: float) -> float:
    for index, slot in enumerate(slots or []):
        slot_state = slot_states[index] if index < len(slot_states) else None
        if _is_overnight_tail_active(slot, slot_state, current_decimal):
            return current_decimal + 24
    return current_decimal


def _compute_session_status(slot: dict, slot_state: Optional[str], current_decimal: float) -> str:
    override = str(slot.get("status_override") or "").lower()
    delay_minutes = int(slot.get("delay_minutes") or 0)
    is_open = _slot_is_open(slot, slot_state)

    if override == "closed" or not is_open:
        return "Closed"
    if override in {"ongoing", "started", "active"}:
        return "Ongoing"
    if override in {"delayed", "paused"} or delay_minutes > 0:
        return "Delayed"

    time_range = slot.get("time_range", [0, 0])
    start = float(time_range[0] if len(time_range) > 0 else 0)
    end = float(time_range[1] if len(time_range) > 1 else start)

    if current_decimal < start:
        return "Available"
    if start <= current_decimal < end:
        return "Ongoing"
    return "Expired"


def _normalize_delay_label(minutes: int) -> str:
    return f"{minutes} min" if minutes != 60 else "1 hour"


def _parse_delay_minutes(raw) -> int:
    if isinstance(raw, int):
        return max(raw, 0)
    text = str(raw or "").strip().lower()
    digits = "".join(ch for ch in text if ch.isdigit())
    if not digits:
        return 0
    value = int(digits)
    return value * 60 if "hour" in text else value


async def _get_slot_record(clinic_id: str, db: AsyncSession) -> ClinicTimeSlot:
    result = await db.execute(select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No sessions configured for this clinic")
    return record


async def _get_slots_and_states(clinic_id: str, db: AsyncSession):
    record = await _get_slot_record(clinic_id, db)
    slots = _load_json_list(record.slots)
    slot_states = _load_json_list(record.slot)
    while len(slot_states) < len(slots):
        slot_states.append("close")
    return record, slots, slot_states


async def _active_counts(clinic_id: str, slot_id: int, db: AsyncSession):
    today = _today()
    online_result = await db.execute(
        select(Appointment).where(
            Appointment.clinic_id == clinic_id,
            Appointment.date == today,
            Appointment.slot_id == slot_id,
            Appointment.status.in_(ACTIVE_STATUSES),
        )
    )
    online = online_result.scalars().all()

    walkin_result = await db.execute(
        select(QRAppointment).where(
            QRAppointment.clinic_id == clinic_id,
            QRAppointment.date == today,
            QRAppointment.slot_id == slot_id,
            QRAppointment.status.in_(ACTIVE_STATUSES),
        )
    )
    walkins = walkin_result.scalars().all()

    completed_result = await db.execute(
        select(CompletedAppointment).where(
            CompletedAppointment.clinic_id == clinic_id,
            CompletedAppointment.date == today,
            CompletedAppointment.slot_id == slot_id,
        )
    )
    completed = completed_result.scalars().all()

    active = online + walkins
    waiting = [apt for apt in active if getattr(apt, "status", "booked") != "serving"]
    serving = next((apt for apt in active if getattr(apt, "status", "") == "serving"), None)
    active_delay = next((getattr(apt, "doctor_delay", None) for apt in active if getattr(apt, "doctor_delay", None)), None)

    return {
        "queue_count": len(active),
        "waiting_count": len(waiting),
        "completed_count": len(completed),
        "current_token": getattr(serving, "appointment_token", None) if serving else None,
        "active_delay": active_delay,
    }


async def _session_payload(clinic_id: str, slot_id: int, slot: dict, slot_state: Optional[str], db: AsyncSession, current_decimal: Optional[float] = None):
    now = _clinic_now()
    status_text = _compute_session_status(slot, slot_state, current_decimal if current_decimal is not None else now.hour + now.minute / 60.0)
    counts = await _active_counts(clinic_id, slot_id, db)
    delay_minutes = int(slot.get("delay_minutes") or _parse_delay_minutes(counts["active_delay"]))
    if delay_minutes and status_text not in {"Closed", "Expired"}:
        status_text = "Delayed"

    time_range = slot.get("time_range", [])
    return {
        "id": slot_id,
        "session_id": slot_id,
        "slot_id": slot_id,
        "session_name": slot.get("session_name") or slot.get("slot_name") or f"Session {slot_id}",
        "start_time": time_range[0] if len(time_range) > 0 else None,
        "end_time": time_range[1] if len(time_range) > 1 else None,
        "time_range": time_range,
        "time_label": _time_range_label(time_range),
        "status": status_text,
        "status_key": status_text.lower(),
        "delay_minutes": delay_minutes,
        "is_active": status_text in {"Ongoing", "Delayed"},
        "is_open": _slot_is_open(slot, slot_state),
        **counts,
    }


async def _update_session_slot(clinic_id: str, session_id: int, db: AsyncSession, updates: dict, slot_state: Optional[str] = None):
    record, slots, slot_states = await _get_slots_and_states(clinic_id, db)
    index = session_id - 1
    if index < 0 or index >= len(slots):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    slots[index].update(updates)
    if slot_state is not None:
        slot_states[index] = slot_state

    record.slots = slots
    record.slot = slot_states
    record.last_slot_change_date = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(record)
    return record, slots, slot_states


@router.get("/today/{clinic_id}")
async def get_today_sessions(clinic_id: str, db: AsyncSession = Depends(get_db)):
    try:
        _record, slots, slot_states = await _get_slots_and_states(clinic_id, db)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            return {"clinic_id": clinic_id, "date": _today(), "sessions": [], "active_session_id": None}
        raise

    now = _clinic_now()
    timeline_now = _timeline_now_for_sessions(slots, slot_states, now.hour + now.minute / 60.0)
    sessions = []
    active_session_id = None
    for index, slot in enumerate(slots):
        session = await _session_payload(clinic_id, index + 1, slot, slot_states[index], db, timeline_now)
        sessions.append(session)
        if active_session_id is None and session["status"] in {"Ongoing", "Delayed"}:
            active_session_id = session["session_id"]

    if active_session_id is None:
        next_available = next((s for s in sessions if s["status"] == "Available"), None)
        active_session_id = next_available["session_id"] if next_available else (sessions[0]["session_id"] if sessions else None)

    return {"clinic_id": clinic_id, "date": _today(), "sessions": sessions, "active_session_id": active_session_id}


@router.get("/{session_id}/queue")
async def get_session_queue(
    session_id: int,
    clinic_id: str = Query(..., description="Clinic ID"),
    db: AsyncSession = Depends(get_db),
):
    today = _today()
    online_result = await db.execute(
        select(Appointment).where(
            Appointment.clinic_id == clinic_id,
            Appointment.date == today,
            Appointment.slot_id == session_id,
        ).order_by(Appointment.queue_position, Appointment.id)
    )
    walkin_result = await db.execute(
        select(QRAppointment).where(
            QRAppointment.clinic_id == clinic_id,
            QRAppointment.date == today,
            QRAppointment.slot_id == session_id,
        ).order_by(QRAppointment.queue_position, QRAppointment.id)
    )

    queue = []
    for source, appointments in (("online", online_result.scalars().all()), ("walkin", walkin_result.scalars().all())):
        for apt in appointments:
            blood_group = "N/A"
            if source == "online" and getattr(apt, "patient_id", None):
                patient_result = await db.execute(select(Patient).where(Patient.patient_id == apt.patient_id))
                patient = patient_result.scalar_one_or_none()
                blood_group = getattr(patient, "blood_group", None) or "N/A" if patient else "N/A"
            queue.append({
                "id": apt.id,
                "token": apt.appointment_token,
                "patient_id": getattr(apt, "patient_id", f"qr-{apt.id}"),
                "patient_name": apt.patient_name,
                "patient_phone": apt.patient_phone,
                "patient_email": getattr(apt, "patient_email", ""),
                "blood_group": blood_group,
                "status": apt.status,
                "source": source,
                "queue_position": apt.queue_position,
                "doctor_delay": getattr(apt, "doctor_delay", None),
                "session_id": session_id,
                "slot_id": session_id,
            })

    queue.sort(key=lambda item: (item.get("queue_position") or 10**9, item.get("id") or 0, 0 if item["source"] == "online" else 1))
    return {"clinic_id": clinic_id, "session_id": session_id, "date": today, "queue": queue, "total": len(queue)}


class SessionCreateRequest(BaseModel):
    clinic_id: str
    doctor_id: Optional[str] = None
    session_name: str
    time_range: list[float]
    is_active: bool = True


@router.post("/create")
async def create_session(payload: SessionCreateRequest, db: AsyncSession = Depends(get_db)):
    if len(payload.time_range) < 2 or payload.time_range[1] <= payload.time_range[0]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="time_range must contain start and end times")

    result = await db.execute(select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == payload.clinic_id))
    record = result.scalar_one_or_none()
    slots = _load_json_list(record.slots) if record else []
    slot_states = _load_json_list(record.slot) if record else []
    if len(slots) >= 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum 3 sessions allowed")

    new_slot = {
        "slot_name": payload.session_name,
        "session_name": payload.session_name,
        "time_range": payload.time_range,
        "is_open": payload.is_active,
        "delay_minutes": 0,
    }
    slots.append(new_slot)
    slot_states.append("open" if payload.is_active else "close")
    slot_id = len(slots)

    if not record:
        record = ClinicTimeSlot(clinic_id=payload.clinic_id, slots=slots, slot=slot_states, last_slot_change_date=datetime.now(timezone.utc))
        db.add(record)
    else:
        record.slots = slots
        record.slot = slot_states
        record.last_slot_change_date = datetime.now(timezone.utc)

    db.add(DoctorSession(
        clinic_id=payload.clinic_id,
        doctor_id=payload.doctor_id,
        session_name=payload.session_name,
        start_time=str(payload.time_range[0]),
        end_time=str(payload.time_range[1]),
        status="available",
        delay_minutes=0,
        is_active=payload.is_active,
        slot_id=slot_id,
        session_date=_today(),
    ))
    await db.commit()

    return {"message": "Session created", "clinic_id": payload.clinic_id, "session_id": slot_id, "slot_id": slot_id}


async def _apply_delay_to_session(clinic_id: str, session_id: int, minutes: int, db: AsyncSession):
    label = _normalize_delay_label(minutes) if minutes > 0 else None
    updates = {"delay_minutes": minutes, "status_override": "delayed" if minutes > 0 else None}
    await _update_session_slot(clinic_id, session_id, db, updates, "open")

    today = _today()
    result = await db.execute(
        select(Appointment).where(
            Appointment.clinic_id == clinic_id,
            Appointment.date == today,
            Appointment.slot_id == session_id,
            Appointment.status.in_(ACTIVE_STATUSES),
        ).order_by(Appointment.queue_position, Appointment.id)
    )
    appointments = result.scalars().all()
    for apt in appointments:
        apt.doctor_delay = label
    await db.commit()
    return appointments, label


@router.post("/{session_id}/delay")
async def delay_session(session_id: int, request: dict, db: AsyncSession = Depends(get_db)):
    clinic_id = request.get("clinic_id")
    if not clinic_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="clinic_id is required")
    minutes = _parse_delay_minutes(request.get("delay_minutes", request.get("delay")))
    if minutes <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="delay_minutes must be greater than 0")
    appointments, label = await _apply_delay_to_session(clinic_id, session_id, minutes, db)

    clinic_result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))
    clinic = clinic_result.scalar_one_or_none()
    _record, slots, _slot_states = await _get_slots_and_states(clinic_id, db)
    session_name = slots[session_id - 1].get("session_name") or slots[session_id - 1].get("slot_name") if 0 <= session_id - 1 < len(slots) else f"Session {session_id}"

    queue_summary = []
    patient_notified_count = 0
    clinic_name = clinic.clinic_name if clinic else clinic_id

    for index, apt in enumerate(appointments, start=1):
        blood_group = "N/A"
        if getattr(apt, "patient_id", None):
            patient_result = await db.execute(select(Patient).where(Patient.patient_id == apt.patient_id))
            patient = patient_result.scalar_one_or_none()
            blood_group = (getattr(patient, "blood_group", None) or "N/A") if patient else "N/A"

        queue_summary.append({
            "patient_name": apt.patient_name or "Patient",
            "token": apt.appointment_token or "TBD",
            "blood_group": blood_group,
            "queue_position": apt.queue_position or index,
            "status": apt.status or "waiting",
        })

        patient_email = (getattr(apt, "patient_email", "") or "").strip()
        if not patient_email:
            continue
        if send_patient_delay_email(
            patient_email,
            apt.patient_name,
            clinic_name,
            label or f"{minutes} min",
            session_name,
            apt.appointment_token,
        ):
            patient_notified_count += 1

    clinic_email = (getattr(clinic, "email", None) or "").strip() if clinic else ""
    clinic_email_sent = False
    if clinic_email:
        clinic_email_sent = send_delay_alert(
            to_email=clinic_email,
            delay=label or f"{minutes} min",
            appointments=queue_summary,
            clinic_name=clinic_name,
            doctor_name=getattr(clinic, "doctor_name", None),
        )

    return {
        "success": True,
        "message": "Delay announced successfully" if clinic_email_sent else "Delay saved; clinic email was not sent",
        "clinic_id": clinic_id,
        "session_id": session_id,
        "slot_id": session_id,
        "delay_minutes": minutes,
        "delay": label,
        "updated_count": len(appointments),
        "clinic_email": clinic_email,
        "email_sent": clinic_email_sent,
        "clinic_notified_count": 1 if clinic_email_sent else 0,
        "patient_notified_count": patient_notified_count,
        "notified_count": (1 if clinic_email_sent else 0) + patient_notified_count,
        "queue": queue_summary,
    }

@router.post("/{session_id}/pause")
async def pause_session(session_id: int, request: dict, db: AsyncSession = Depends(get_db)):
    clinic_id = request.get("clinic_id")
    if not clinic_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="clinic_id is required")
    await _update_session_slot(clinic_id, session_id, db, {"status_override": "paused"}, "open")
    return {"success": True, "clinic_id": clinic_id, "session_id": session_id, "status": "Delayed"}


@router.post("/{session_id}/resume")
async def resume_session(session_id: int, request: dict, db: AsyncSession = Depends(get_db)):
    clinic_id = request.get("clinic_id")
    if not clinic_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="clinic_id is required")
    await _update_session_slot(clinic_id, session_id, db, {"status_override": "ongoing", "delay_minutes": 0}, "open")
    today = _today()
    result = await db.execute(select(Appointment).where(Appointment.clinic_id == clinic_id, Appointment.date == today, Appointment.slot_id == session_id))
    for apt in result.scalars().all():
        apt.doctor_delay = None
    await db.commit()
    return {"success": True, "clinic_id": clinic_id, "session_id": session_id, "status": "Ongoing"}


@router.post("/{session_id}/start")
async def start_session(session_id: int, request: dict, db: AsyncSession = Depends(get_db)):
    clinic_id = request.get("clinic_id")
    if not clinic_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="clinic_id is required")
    await _update_session_slot(clinic_id, session_id, db, {"is_open": True, "status_override": "ongoing"}, "open")
    return {"success": True, "clinic_id": clinic_id, "session_id": session_id, "status": "Ongoing"}


@router.post("/{session_id}/close")
async def close_session(session_id: int, request: dict, db: AsyncSession = Depends(get_db)):
    clinic_id = request.get("clinic_id")
    if not clinic_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="clinic_id is required")
    await _update_session_slot(clinic_id, session_id, db, {"is_open": False, "status_override": "closed"}, "close")
    return {"success": True, "clinic_id": clinic_id, "session_id": session_id, "status": "Closed"}
