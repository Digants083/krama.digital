from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Optional
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.db import get_db
from app.database.models import Appointment, Clinic, ClinicTimeSlot, CompletedAppointment, Patient, QRAppointment
from app.services.email_service import send_delay_alert
from app.services.queue_metrics import get_live_queue_metrics
from app.services.delay_jobs import parse_dt
from app.services.realtime import publish_queue_event
router = APIRouter(prefix="/auth", tags=["queue"])
CLINIC_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
SERVE_UNLOCK_LEAD_MINUTES = 5
logger = logging.getLogger(__name__)


def _clinic_now() -> datetime:
    return datetime.now(CLINIC_TIMEZONE)


def _clinic_today_str() -> str:
    return _clinic_now().strftime("%Y-%m-%d")


def _delay_minutes(delay: Optional[str]) -> int:
    if not delay:
        return 0
    lowered = str(delay).strip().lower()
    digits = "".join(ch for ch in lowered if ch.isdigit())
    if not digits:
        return 0
    amount = int(digits)
    return amount * 60 if "hour" in lowered else amount


def _sort_datetime(value):
    if value is None:
        return datetime.min.replace(tzinfo=CLINIC_TIMEZONE)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=CLINIC_TIMEZONE)
        except ValueError:
            return datetime.min.replace(tzinfo=CLINIC_TIMEZONE)
    if value.tzinfo is None:
        return value.replace(tzinfo=CLINIC_TIMEZONE)
    return value


def _load_slots(raw_slots):
    slots = raw_slots
    if isinstance(slots, str):
        slots = json.loads(slots)
    return list(slots or [])


def _load_slot_delays(raw_delays, slots: list) -> list[int]:
    delays = _load_slots(raw_delays)
    normalized = []
    for index, slot in enumerate(slots):
        raw_delay = delays[index] if index < len(delays) else slot.get("delay_minutes", 0)
        normalized.append(_delay_minutes(raw_delay))
    return normalized


def _delay_label(minutes: int) -> Optional[str]:
    if minutes <= 0:
        return None
    if minutes == 60:
        return "1 hour"
    if minutes > 60 and minutes % 60 == 0:
        return f"{minutes // 60} hours"
    return f"{minutes} min"


def _slot_time_label(value: float) -> str:
    total_minutes = int(round(value * 60)) % (24 * 60)
    hour24 = total_minutes // 60
    minute = total_minutes % 60
    hour12 = hour24 % 12 or 12
    suffix = "PM" if hour24 >= 12 else "AM"
    return f"{hour12}:{minute:02d} {suffix}"


def _timeline_now_for_slots(slots: list, slot_status: list, current_decimal: float) -> float:
    for index, slot in enumerate(slots or []):
        if not _is_slot_available(slot, slot_status, index):
            continue
        time_range = slot.get("time_range", [0, 0])
        if len(time_range) > 1 and float(time_range[1]) > 24 and current_decimal < float(time_range[1]) - 24:
            return current_decimal + 24
    return current_decimal


async def _clear_stale_slot_delays(record: ClinicTimeSlot, db: AsyncSession) -> tuple[list, list[int]]:
    slots = _load_slots(record.slots)
    slot_status = _load_slot_status(record.slot)
    slot_delays = _load_slot_delays(getattr(record, "slot_delays", []), slots)
    now = _clinic_now()
    today = _clinic_today_str()
    current_decimal = _timeline_now_for_slots(slots, slot_status, now.hour + now.minute / 60.0)

    last_change = getattr(record, "last_slot_change_date", None)
    if last_change and last_change.tzinfo is None:
        last_change = last_change.replace(tzinfo=timezone.utc)
    last_change_date = last_change.astimezone(CLINIC_TIMEZONE).date().isoformat() if last_change else None
    should_clear_all = bool(last_change_date and last_change_date < today and any(slot_delays))
    changed = False

    now_utc = datetime.now(timezone.utc)
    for index, delay_minutes in enumerate(slot_delays):
        if index >= len(slots):
            continue
        time_range = slots[index].get("time_range", [0, 0])
        slot_end = float(time_range[1] if len(time_range) > 1 else 0)
        delay_ends_at = parse_dt(slots[index].get("delay_ends_at"))
        if delay_minutes > 0 and (should_clear_all or (delay_ends_at and delay_ends_at <= now_utc) or (not delay_ends_at and current_decimal >= slot_end)):
            slot_delays[index] = 0
            slots[index]["delay_minutes"] = 0
            for key in ("delay_started_at", "delay_ends_at", "delay_original_start_time", "delay_updated_start_time"):
                slots[index].pop(key, None)
            if slots[index].get("status_override") == "delayed":
                slots[index].pop("status_override", None)
            changed = True
        else:
            slots[index]["delay_minutes"] = delay_minutes
            if delay_minutes > 0:
                time_range = slots[index].get("time_range", [current_decimal])
                slot_start = float(time_range[0] if len(time_range) > 0 else current_decimal)
                if not delay_ends_at:
                    slots[index]["delay_started_at"] = now_utc.isoformat()
                    slots[index]["delay_ends_at"] = (now_utc + timedelta(minutes=delay_minutes)).isoformat()
                    changed = True
                if not slots[index].get("delay_original_start_time"):
                    slots[index]["delay_original_start_time"] = _slot_time_label(slot_start)
                    changed = True
                if not slots[index].get("delay_updated_start_time"):
                    slots[index]["delay_updated_start_time"] = _slot_time_label(slot_start + delay_minutes / 60.0)
                    changed = True

    if changed:
        record.slots = slots
        record.slot_delays = slot_delays
        record.last_slot_change_date = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(record)

    return slots, slot_delays


async def _slot_delay_label(db: AsyncSession, clinic_id: str, slot_id: Optional[int]) -> Optional[str]:
    if not slot_id:
        return None
    slot_result = await db.execute(select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id))
    slot_record = slot_result.scalar_one_or_none()
    if not slot_record:
        return None
    slots, slot_delays = await _clear_stale_slot_delays(slot_record, db)
    slot_index = int(slot_id) - 1
    if slot_index < 0 or slot_index >= len(slots):
        return None
    minutes = slot_delays[slot_index] if slot_index < len(slot_delays) else 0
    return _delay_label(minutes)


def _load_slot_status(raw_slot_status):
    slot_status = raw_slot_status
    if isinstance(slot_status, str):
        slot_status = json.loads(slot_status) if slot_status else []
    return list(slot_status or [])


def _is_slot_available(slot: dict, slot_status: list, index: int) -> bool:
    if not slot.get("is_open"):
        return False
    if index < len(slot_status) and slot_status[index] == "close":
        return False
    return True


def _slot_booking_cutoff_passed(slot: dict, now: datetime) -> bool:
    time_range = slot.get("time_range", [0, 0])
    if not isinstance(time_range, list) or len(time_range) < 2:
        return False

    end_time = float(time_range[1])
    current_time = now.hour + now.minute / 60.0
    return current_time >= end_time - 0.25


async def _sync_slot_live_status(clinic_id: str, db: AsyncSession, is_active: bool):
    result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return

    slots = _load_slots(record.slots)
    slot_status = _load_slot_status(record.slot)
    while len(slot_status) < len(slots):
        slot_status.append("close")

    now = _clinic_now()
    current_time_decimal = now.hour + now.minute / 60.0

    for index, slot in enumerate(slots):
        if not isinstance(slot, dict):
            continue

        time_range = slot.get("time_range", [0, 0])
        if len(time_range) < 2:
            continue

        # Start opens slots that are still bookable today. Stop closes all slots.
        should_open = is_active and current_time_decimal < (time_range[1] - (15 / 60.0))
        slot["is_open"] = should_open
        slot_status[index] = "open" if should_open else "close"

    record.slots = slots
    record.slot = slot_status
    record.last_slot_change_date = datetime.now(timezone.utc)




def _can_toggle_slot(last_toggle_date: Optional[datetime], slot_toggle_counts: list, slot_index: int):
    """
    Check if clinic can toggle a specific slot open/close based on daily limit (2 times per slot).

    Args:
        last_toggle_date: The date when last toggle operation occurred
        slot_toggle_counts: Array of toggle counts per slot [0, 0, 0] for 3 slots
        slot_index: Index of the slot being toggled

    Returns:
        (can_toggle, message): Tuple indicating if toggle is allowed and why
    """
    now = datetime.now(timezone.utc)
    today = now.date()

    # Ensure slot_toggle_counts is a list
    if not isinstance(slot_toggle_counts, list):
        slot_toggle_counts = [0, 0, 0]

    # Ensure the array is long enough for the requested slot
    while len(slot_toggle_counts) <= slot_index:
        slot_toggle_counts.append(0)

    # Get the toggle count for this specific slot
    slot_count = slot_toggle_counts[slot_index] if slot_index < len(slot_toggle_counts) else 0

    # Reset counter if it's a new day
    if last_toggle_date is None:
        return True, f"No previous toggles today for slot {slot_index + 1} - can toggle (0/2 used)"

    # Ensure last_toggle_date has timezone info
    if last_toggle_date.tzinfo is None:
        last_toggle_date = last_toggle_date.replace(tzinfo=timezone.utc)

    last_date = last_toggle_date.date()

    # If last toggle was on a different day, reset counter
    if last_date < today:
        return True, f"New day - counter reset for slot {slot_index + 1} (0/2 used)"

    # Same day - check if limit reached for this specific slot
    if slot_count >= 2:
        return False, f"Daily toggle limit reached for slot {slot_index + 1} (2/2). Try again tomorrow."

    return True, f"Can toggle slot {slot_index + 1} ({slot_count}/2 used today)"

async def get_clinic_current_slot(clinic_id: str, db: AsyncSession):
    """
    Returns the index of the currently active time slot for a clinic.
    Returns None if no slot is currently active.
    """
    result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None

    slots = _load_slots(record.slots)

    now = _clinic_now()
    current_time_decimal = now.hour + now.minute / 60.0
    for idx, slot in enumerate(slots):
        if not slot.get("is_open"):
            continue

        start, end = slot.get("time_range", [0, 0])
        if start <= current_time_decimal < end:
            return idx

    return None

async def get_first_open_slot_start(clinic_id: str, db: AsyncSession):
    """
    Returns the earliest configured slot start of the day.
    Start is intentionally based on configured time, even if that slot is closed.
    """
    result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None

    slots = _load_slots(record.slots)
    if not slots:
        return None

    starts = []
    for slot in slots:
        if not isinstance(slot, dict):
            continue
        time_range = slot.get("time_range")
        if isinstance(time_range, list) and len(time_range) >= 2 and isinstance(time_range[0], (int, float)):
            starts.append(time_range[0])

    return min(starts) if starts else None

async def get_last_open_slot_end(clinic_id: str, db: AsyncSession):
    """
    Returns the end hour of the last available slot of the day.
    A slot is available when it is configured open and not toggled closed.
    """
    result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None

    slots = _load_slots(record.slots)
    slot_status = _load_slot_status(record.slot)
    last_end = None
    for idx, slot in enumerate(slots):
        if _is_slot_available(slot, slot_status, idx):
            end_time = slot.get("time_range", [0, 0])[1]
            if last_end is None or end_time > last_end:
                last_end = end_time
    return last_end

async def get_last_configured_slot_end(clinic_id: str, db: AsyncSession):
    """
    Returns the latest configured slot end, regardless of current open/close state.
    Used to enforce the live window before Start opens today's slots.
    """
    result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None

    slots = _load_slots(record.slots)
    ends = []
    for slot in slots:
        if not isinstance(slot, dict):
            continue
        time_range = slot.get("time_range")
        if isinstance(time_range, list) and len(time_range) >= 2 and isinstance(time_range[1], (int, float)):
            ends.append(time_range[1])

    return max(ends) if ends else None

async def all_slots_expired(clinic_id: str, db: AsyncSession) -> bool:
    """
    Returns True if all open slots have expired (current time is past all slot end times).
    """
    result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return True  # No slots configured, consider as expired

    slots = _load_slots(record.slots)
    slot_status = _load_slot_status(record.slot)

    now = _clinic_now()
    current_time_decimal = now.hour + now.minute / 60.0
    for idx, slot in enumerate(slots):
        if _is_slot_available(slot, slot_status, idx):
            end_time = slot.get("time_range", [0, 0])[1]
            if current_time_decimal < end_time:
                return False

    return True

def _token_number(token: Optional[str]) -> int:
    if not token:
        return 0
    digits = "".join(ch for ch in token if ch.isdigit())
    return int(digits) if digits else 0


@router.post("/clinic/set-active")
async def set_clinic_active(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Set clinic as active (clicked Start) or inactive.
    Includes pre-activation window check (45 mins before first slot).
    Prevents activation if all slots have expired.
    """
    clinic_id = request.get("clinic_id")
    is_active = request.get("is_active", True)
    manual_stop = request.get("manual_stop", False)

    if not clinic_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="clinic_id is required"
        )

    result = await db.execute(
        select(Clinic).where(Clinic.clinic_id == clinic_id)
    )
    clinic = result.scalar_one_or_none()

    if not clinic:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clinic not found"
        )

    if is_active:
        today = _clinic_today_str()
        # Check pre-activation window
        first_slot_start = await get_first_open_slot_start(clinic_id, db)
        if first_slot_start is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No open time slots configured for today."
            )

        now = _clinic_now()
        current_time_decimal = now.hour + now.minute / 60.0
        activation_threshold = first_slot_start - (45 / 60.0)

        if current_time_decimal < activation_threshold:
            # Calculate wait time
            wait_minutes = int((activation_threshold - current_time_decimal) * 60)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Clinic can only be activated {wait_minutes} minutes from now (Slot starts at {int(first_slot_start)}:00)."
            )

        # Manual Online Restriction: Cannot go online if today's live window has ended.
        last_slot_end = await get_last_configured_slot_end(clinic_id, db)
        if last_slot_end is not None and current_time_decimal >= (last_slot_end - (15 / 60.0)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No time slots available for today. Live window has ended."
            )

    clinic.is_active = is_active
    if is_active:
        clinic.manual_stop_date = None
    await _sync_slot_live_status(clinic_id, db, is_active)

    # Clean up yesterday's appointments - mark as not served and remove from queue
    if is_active:
        yesterday = (_clinic_now() - timedelta(days=1)).strftime("%Y-%m-%d")

        # Get yesterday's appointments that are not completed
        yesterday_appointments = await db.execute(
            select(Appointment).where(
                Appointment.clinic_id == clinic_id,
                Appointment.date == yesterday,
                Appointment.status.notin_(["completed", "not_served"])
            )
        )

        for apt in yesterday_appointments.scalars().all():
            # Move to completed_appointments with not_served status
            completed = CompletedAppointment(
                appointment_token=apt.appointment_token,
                clinic_id=apt.clinic_id,
                patient_id=getattr(apt, 'patient_id', f"online-{apt.id}"),
                patient_name=apt.patient_name,
                patient_phone=apt.patient_phone,
                patient_email=getattr(apt, 'patient_email', ""),
                status="not_served",
                wait_time_minutes=0,
                date=apt.date,
                time=getattr(apt, 'time', ""),
                slot_id=getattr(apt, 'slot_id', None),
                doctor_name=getattr(apt, 'doctor_name', None),
                created_at=apt.created_at,
                served_at=datetime.now()
            )
            db.add(completed)
            # Delete from appointments
            await db.delete(apt)

        # Same for QR appointments
        yesterday_qr = await db.execute(
            select(QRAppointment).where(
                QRAppointment.clinic_id == clinic_id,
                QRAppointment.date == yesterday,
                QRAppointment.status.notin_(["completed", "not_served"])
            )
        )

        for apt in yesterday_qr.scalars().all():
            completed = CompletedAppointment(
                appointment_token=apt.appointment_token,
                clinic_id=apt.clinic_id,
                patient_id=getattr(apt, 'patient_id', f"qr-{apt.id}"),
                patient_name=apt.patient_name,
                patient_phone=apt.patient_phone,
                patient_email=getattr(apt, 'patient_email', ""),
                status="not_served",
                wait_time_minutes=0,
                date=apt.date,
                time=getattr(apt, 'time', ""),
                slot_id=getattr(apt, 'slot_id', None),
                created_at=apt.created_at,
                served_at=datetime.now()
            )
            db.add(completed)
            await db.delete(apt)

        await db.commit()

    await db.commit()

    return {
        "message": f"Clinic {'activated' if is_active else 'deactivated'}",
        "is_active": is_active,
        "manual_stop_date": clinic.manual_stop_date
    }

@router.get("/clinic/active-status")
async def get_clinic_active_status(
    clinic_id: str = Query(..., description="Clinic ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get clinic active status.
    Automatically deactivates clinic if 15 minutes before last open slot ends.
    NEVER automatically activates - only manual activation allowed.
    """
    result = await db.execute(
        select(Clinic).where(Clinic.clinic_id == clinic_id)
    )
    clinic = result.scalar_one_or_none()

    if not clinic:
        return {"is_active": False}

    # Only check if we should go offline - never auto online
    if clinic.is_active:
        # Check 15 minutes before last open slot ends
        last_slot_end = await get_last_open_slot_end(clinic_id, db)
        if last_slot_end is None:
            clinic.is_active = False
            await _sync_slot_live_status(clinic_id, db, False)
            await db.commit()
        else:
            now = _clinic_now()
            current_time_decimal = now.hour + now.minute / 60.0
            auto_offline_time = last_slot_end - (15 / 60.0)
            if current_time_decimal >= auto_offline_time:
                clinic.is_active = False
                await _sync_slot_live_status(clinic_id, db, False)
                await db.commit()

    today = _clinic_today_str()
    return {
        "is_active": clinic.is_active,
        "manual_stop_locked": False,
        "manual_stop_date": clinic.manual_stop_date,
    }

@router.post("/clinic/serve-patient")
async def serve_patient(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Mark patient as being served and move from appointments to serving state.
    This is called when clicking 'Next' button.
    Includes a check to block serving before the slot start time.
    """
    clinic_id = request.get("clinic_id")
    appointment_id = request.get("appointment_id")
    source = request.get("source", "online")

    if not all([clinic_id, appointment_id]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing clinic_id or appointment_id"
        )

    if source == "walkin":
        result = await db.execute(
            select(QRAppointment).where(
                QRAppointment.id == appointment_id,
                QRAppointment.clinic_id == clinic_id
            )
        )
        appointment = result.scalar_one_or_none()
    else:
        result = await db.execute(
            select(Appointment).where(
                Appointment.id == appointment_id,
                Appointment.clinic_id == clinic_id
            )
        )
        appointment = result.scalar_one_or_none()

    if not appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found"
        )

    # Blocking Check: allow queue controls shortly before slot start.
    slot_id = appointment.slot_id
    if slot_id is not None:
        # slot_id is stored as human-friendly 1-based value (1,2,3)
        slot_index = int(slot_id) - 1
        if slot_index < 0:
            slot_index = 0
        result = await db.execute(
            select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
        )
        record = result.scalar_one_or_none()
        if record:
            slots, slot_delays = await _clear_stale_slot_delays(record, db)
            if slot_index < len(slots):
                delay_minutes = slot_delays[slot_index] if slot_index < len(slot_delays) else 0
                slot_start = slots[slot_index].get("time_range", [0, 0])[0]
                effective_slot_start = slot_start + (delay_minutes / 60.0)
                now = _clinic_now()
                current_time_decimal = now.hour + now.minute / 60.0
                unlock_time = effective_slot_start - (SERVE_UNLOCK_LEAD_MINUTES / 60.0)
                if current_time_decimal < unlock_time:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"Serving can start {SERVE_UNLOCK_LEAD_MINUTES} minutes before the delayed slot start time."
                    )

    # Update status to serving and persist the real service start time.
    serving_started_at = datetime.now(timezone.utc)
    appointment.status = "serving"
    appointment.serving_started_at = serving_started_at
    if hasattr(appointment, "notification_stage"):
        appointment.notification_stage = "serving"
    await db.commit()
    await publish_queue_event(clinic_id, "queue_updated", {"slot_id": getattr(appointment, "slot_id", None)})

    return {
        "message": "Patient is now being served",
        "appointment": {
            "id": appointment.id,
            "token": appointment.appointment_token,
            "patient_name": appointment.patient_name,
            "patient_email": getattr(appointment, "patient_email", ""),
            "patient_phone": appointment.patient_phone,
            "status": "serving",
            "serving_started_at": serving_started_at
        }
    }


@router.post("/clinic/finish-patient")
async def finish_patient(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Mark patient as served/finished and move to completed_appointments table.
    Handles both online appointments and QR walk-ins.
    This is called when clicking 'Completed' button.
    """
    import logging
    from datetime import timezone

    logger = logging.getLogger(__name__)

    clinic_id = request.get("clinic_id")
    appointment_id = request.get("appointment_id")
    source = request.get("source", "online")  # "online" or "walkin"

    logger.info(f"finish_patient called: clinic_id={clinic_id}, appointment_id={appointment_id}, source={source}")

    if not all([clinic_id, appointment_id]):
        logger.error(f"Missing required fields: clinic_id={clinic_id}, appointment_id={appointment_id}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing clinic_id or appointment_id"
        )

    appointment = None

    if source == "walkin":
        # Get from QR appointments table
        result = await db.execute(
            select(QRAppointment).where(
                QRAppointment.id == appointment_id,
                QRAppointment.clinic_id == clinic_id
            )
        )
        appointment = result.scalar_one_or_none()
    else:
        # Get from online appointments table
        result = await db.execute(
            select(Appointment).where(
                Appointment.id == appointment_id,
                Appointment.clinic_id == clinic_id
            )
        )
        appointment = result.scalar_one_or_none()

    if not appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found"
        )

    # Calculate service duration from the actual Next click, not booking time.
    from datetime import timezone
    served_at = getattr(appointment, "serving_started_at", None) or datetime.now(timezone.utc)
    if served_at.tzinfo is None:
        served_at = served_at.replace(tzinfo=timezone.utc)
    finished_at = datetime.now(timezone.utc)
    service_duration_seconds = max(0, int((finished_at - served_at).total_seconds()))
    wait_time = int(service_duration_seconds / 60)

    # Get push_count from appointment
    push_count = getattr(appointment, 'push_count', 0)

    # Move to completed_appointments
    completed = CompletedAppointment(
        appointment_token=appointment.appointment_token,
        clinic_id=appointment.clinic_id,
        patient_id=getattr(appointment, 'patient_id', f"qr-{appointment.id}"),
        patient_name=appointment.patient_name,
        patient_email=getattr(appointment, 'patient_email', ""),
        patient_phone=appointment.patient_phone,
        doctor_name=getattr(appointment, 'doctor_name', None),
        date=appointment.date,
        time=getattr(appointment, 'time', "walk-in"),
        slot_id=getattr(appointment, 'slot_id', None),
        served_at=served_at,
        finished_at=finished_at,
        status="completed",
        wait_time_minutes=wait_time,
        service_duration_seconds=service_duration_seconds,
        outcome="served",
        served=True,  # Patient was served (normally or after push)
        push_count=push_count  # Track how many times they were pushed
    )
    db.add(completed)

    # Delete from the appropriate table
    await db.delete(appointment)
    await db.commit()
    await publish_queue_event(clinic_id, "queue_updated", {"slot_id": getattr(completed, "slot_id", None)})

    # Auto-add to reports table for all served patients (online patients only)
    if source == "online":
        try:
            from app.routers.patient_reports import auto_add_patient_to_reports

            patient_id = getattr(appointment, 'patient_id', f"online-{appointment.id}")
            logger.info(f"Adding to reports: patient_id={patient_id}, patient_name={appointment.patient_name}")

            result = await auto_add_patient_to_reports(
                patient_id=patient_id,
                clinic_id=clinic_id,
                patient_name=appointment.patient_name,
                patient_email=appointment.patient_email,
                patient_phone=appointment.patient_phone,
                db=db
            )
            logger.info(f"Auto-add to reports result: {result}")
        except Exception as e:
            logger.error(f"Failed to auto-add patient to reports: {e}", exc_info=True)

    return {
        "message": "Patient marked as served and moved to history",
        "completed": {
            "token": completed.appointment_token,
            "patient_name": completed.patient_name,
            "served_at": completed.served_at,
            "finished_at": completed.finished_at,
            "wait_time_minutes": completed.wait_time_minutes,
            "service_duration_seconds": completed.service_duration_seconds
        }
    }


@router.post("/clinic/skip-patient")
async def skip_patient(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Skip a patient - move them one position back in queue.
    Order: A,B,C,D,E -> Skip A -> B,A,C,D,E
    Uses queue_position to maintain order without deleting data.
    """
    clinic_id = request.get("clinic_id")
    appointment_id = request.get("appointment_id")
    source = request.get("source", "online")
    today = _clinic_today_str()

    if not all([clinic_id, appointment_id]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing clinic_id or appointment_id"
        )

    model = QRAppointment if source == "walkin" else Appointment

    result = await db.execute(
        select(model).where(
            model.id == appointment_id,
            model.clinic_id == clinic_id,
            model.date == today
        )
    )
    skipped_appointment = result.scalar_one_or_none()

    if not skipped_appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found"
        )

    slot_id = getattr(skipped_appointment, "slot_id", None)
    if slot_id is not None:
        slot_index = int(slot_id) - 1
        if slot_index < 0:
            slot_index = 0
        slot_result = await db.execute(
            select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
        )
        slot_record = slot_result.scalar_one_or_none()
        if slot_record:
            slots, slot_delays = await _clear_stale_slot_delays(slot_record, db)
            if slot_index < len(slots):
                delay_minutes = slot_delays[slot_index] if slot_index < len(slot_delays) else 0
                slot_start = slots[slot_index].get("time_range", [0, 0])[0]
                effective_slot_start = slot_start + (delay_minutes / 60.0)
                now = _clinic_now()
                current_time_decimal = now.hour + now.minute / 60.0
                unlock_time = effective_slot_start - (SERVE_UNLOCK_LEAD_MINUTES / 60.0)
                if current_time_decimal < unlock_time:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"Skipping can start {SERVE_UNLOCK_LEAD_MINUTES} minutes before the delayed slot start time."
                    )

    online_filters = [
        Appointment.clinic_id == clinic_id,
        Appointment.date == today,
        Appointment.status != "serving",
    ]
    walkin_filters = [
        QRAppointment.clinic_id == clinic_id,
        QRAppointment.date == today,
        QRAppointment.status != "serving",
    ]

    if slot_id is not None:
        online_filters.append(Appointment.slot_id == slot_id)
        walkin_filters.append(QRAppointment.slot_id == slot_id)

    online_result = await db.execute(select(Appointment).where(and_(*online_filters)))
    walkin_result = await db.execute(select(QRAppointment).where(and_(*walkin_filters)))

    queue_items = [
        {"model": "online", "appointment": apt}
        for apt in online_result.scalars().all()
    ] + [
        {"model": "walkin", "appointment": apt}
        for apt in walkin_result.scalars().all()
    ]

    queue_items.sort(
        key=lambda item: (
            item["appointment"].queue_position
            if item["appointment"].queue_position is not None
            else 10**9,
            item["appointment"].created_at or datetime.min,
            0 if item["model"] == "online" else 1,
            item["appointment"].id,
        )
    )

    if len(queue_items) <= 1:
        return {
            "message": "Only one patient in queue, cannot skip",
            "skipped_patient": {
                "id": skipped_appointment.id,
                "token": skipped_appointment.appointment_token,
                "patient_name": skipped_appointment.patient_name,
                "position": 1
            }
        }

    for idx, item in enumerate(queue_items, start=1):
        item["appointment"].queue_position = idx

    skipped_index = next(
        (
            idx
            for idx, item in enumerate(queue_items)
            if item["model"] == source and item["appointment"].id == appointment_id
        ),
        None,
    )

    if skipped_index is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found in current slot queue"
        )

    if skipped_index >= len(queue_items) - 1:
        return {
            "message": "Patient already at end of queue",
            "skipped_patient": {
                "id": skipped_appointment.id,
                "token": skipped_appointment.appointment_token,
                "patient_name": skipped_appointment.patient_name,
                "position": skipped_index + 1
            }
        }

    current_position = skipped_index + 1
    next_position = current_position + 1
    next_patient = queue_items[skipped_index + 1]["appointment"]

    skipped_appointment.queue_position = next_position
    next_patient.queue_position = current_position
    skipped_appointment.status = "skipped"

    await db.commit()
    await db.refresh(skipped_appointment)
    await publish_queue_event(clinic_id, "queue_updated", {"slot_id": slot_id})

    return {
        "message": "Patient skipped and moved one position back",
        "skipped_patient": {
            "id": skipped_appointment.id,
            "token": skipped_appointment.appointment_token,
            "patient_name": skipped_appointment.patient_name,
            "previous_position": current_position,
            "new_position": next_position
        }
    }


@router.post("/clinic/push-patient-to-next-slot")
async def push_patient_to_next_slot(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Push an unserved patient from their current slot to the end of the next available slot's queue.
    Sends email notification to the patient.
    If already in the last slot, auto-finishes with outcome='not_served' instead.
    For walkin/QR patients, always auto-finish with 'not_served' (no slot pushing).
    """
    import logging
    from datetime import timezone

    logger = logging.getLogger(__name__)

    clinic_id = request.get("clinic_id")
    appointment_id = request.get("appointment_id")
    source = request.get("source", "online")  # "online" or "walkin"

    if not all([clinic_id, appointment_id]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing clinic_id or appointment_id"
        )

    # Get the appointment from the correct table based on source
    if source == "walkin":
        result = await db.execute(
            select(QRAppointment).where(
                QRAppointment.id == appointment_id,
                QRAppointment.clinic_id == clinic_id
            )
        )
        appointment = result.scalar_one_or_none()
    else:
        result = await db.execute(
            select(Appointment).where(
                Appointment.id == appointment_id,
                Appointment.clinic_id == clinic_id
            )
        )
        appointment = result.scalar_one_or_none()

    if not appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found"
        )

    # For walkin/QR patients, always auto-finish with not_served
    if source == "walkin":
        served_at = appointment.created_at
        if served_at.tzinfo is None:
            served_at = served_at.replace(tzinfo=timezone.utc)
        finished_at = datetime.now(timezone.utc)
        wait_time = int((finished_at - served_at).total_seconds() / 60)

        # Get current push_count and increment it
        current_push_count = getattr(appointment, 'push_count', 0)

        completed = CompletedAppointment(
            appointment_token=appointment.appointment_token,
            clinic_id=appointment.clinic_id,
            patient_id=f"qr-{appointment.id}",  # QR appointments don't have patient_id
            patient_name=appointment.patient_name,
            patient_email="",  # QR appointments don't have email
            patient_phone=appointment.patient_phone,
            doctor_name=appointment.doctor_name,
            date=appointment.date,
            time="walk-in",
            slot_id=appointment.slot_id,
            served_at=served_at,
            finished_at=finished_at,
            status="auto_finished",
            wait_time_minutes=wait_time,
            outcome="not_served",
            served=False,  # Not served - walkin patient was pushed
            push_count=current_push_count + 1  # Increment push count
        )
        db.add(completed)
        await db.delete(appointment)
        await db.commit()
        await publish_queue_event(clinic_id, "queue_updated", {"slot_id": getattr(appointment, "slot_id", None)})

        return {
            "message": "Walk-in patient marked as not served",
            "action": "auto_finished",
            "outcome": "not_served"
        }

    # Get clinic time slots
    slot_result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    slot_record = slot_result.scalar_one_or_none()

    if not slot_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No time slots configured for this clinic"
        )

    slots = _load_slots(slot_record.slots)
    current_slot_id = appointment.slot_id

    if current_slot_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Appointment has no slot assigned"
        )

    current_slot_index = int(current_slot_id) - 1

    if current_slot_index < 0 or current_slot_index >= len(slots):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid slot assigned to appointment"
        )

    # Check if this is the last slot
    if current_slot_index >= len(slots) - 1:
        # This is the last slot - auto-finish with not_served
        served_at = appointment.created_at
        if served_at.tzinfo is None:
            served_at = served_at.replace(tzinfo=timezone.utc)
        finished_at = datetime.now(timezone.utc)
        wait_time = int((finished_at - served_at).total_seconds() / 60)

        # Get current push_count and increment it
        current_push_count = getattr(appointment, 'push_count', 0)

        completed = CompletedAppointment(
            appointment_token=appointment.appointment_token,
            clinic_id=appointment.clinic_id,
            patient_id=getattr(appointment, 'patient_id', f"pushed-{appointment.id}"),
            patient_name=appointment.patient_name,
            patient_email=getattr(appointment, 'patient_email', ""),
            patient_phone=appointment.patient_phone,
            doctor_name=getattr(appointment, 'doctor_name', None),
            date=appointment.date,
            time=getattr(appointment, 'time', "pushed-not-served"),
            slot_id=appointment.slot_id,
            served_at=served_at,
            finished_at=finished_at,
            status="auto_finished",
            wait_time_minutes=wait_time,
            outcome="not_served",
            served=False,  # Not served - was in last slot and got pushed
            push_count=current_push_count + 1  # Increment push count
        )
        db.add(completed)
        await db.delete(appointment)
        await db.commit()
        await publish_queue_event(clinic_id, "queue_updated", {"slot_id": getattr(completed, "slot_id", None)})

        # Send not-served email for last slot
        patient_email_last_slot = getattr(appointment, 'patient_email', '').strip()
        if patient_email_last_slot:
            from app.services.email_service import send_not_served_email
            clinic_result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))
            clinic = clinic_result.scalar_one_or_none()
            clinic_name = clinic.clinic_name if clinic else clinic_id
            slot_name_info = slots[current_slot_index].get('slot_name', f'Slot {current_slot_index + 1}') if current_slot_index < len(slots) else None
            send_not_served_email(patient_email_last_slot, appointment.patient_name, clinic_name, slot_name_info)

        return {
            "message": "Patient was in last slot - auto-finished with not_served outcome",
            "action": "auto_finished",
            "outcome": "not_served"
        }

    # Find the next open slot
    next_slot_index = None
    for i in range(current_slot_index + 1, len(slots)):
        slot = slots[i]
        if not slot.get("is_open"):
            continue
        time_range = slot.get("time_range", [0, 0])
        current_time = datetime.now().hour + datetime.now().minute / 60.0
        if len(time_range) >= 2 and current_time < time_range[1]:
            next_slot_index = i
            break

    if next_slot_index is None:
        # No more open slots or all remaining slots have expired - auto-finish
        served_at = appointment.created_at
        if served_at.tzinfo is None:
            served_at = served_at.replace(tzinfo=timezone.utc)
        finished_at = datetime.now(timezone.utc)
        wait_time = int((finished_at - served_at).total_seconds() / 60)

        # Get current push_count and increment it
        current_push_count = getattr(appointment, 'push_count', 0)

        completed = CompletedAppointment(
            appointment_token=appointment.appointment_token,
            clinic_id=appointment.clinic_id,
            patient_id=getattr(appointment, 'patient_id', f"pushed-{appointment.id}"),
            patient_name=appointment.patient_name,
            patient_email=getattr(appointment, 'patient_email', ""),
            patient_phone=appointment.patient_phone,
            doctor_name=getattr(appointment, 'doctor_name', None),
            date=appointment.date,
            time=getattr(appointment, 'time', "pushed-not-served"),
            slot_id=appointment.slot_id,
            served_at=served_at,
            finished_at=finished_at,
            status="auto_finished",
            wait_time_minutes=wait_time,
            outcome="not_served",
            served=False,  # Not served - no more slots available
            push_count=current_push_count + 1  # Increment push count
        )
        db.add(completed)
        await db.delete(appointment)
        await db.commit()
        await publish_queue_event(clinic_id, "queue_updated", {"slot_id": getattr(completed, "slot_id", None)})

        # Send not-served email if patient has email
        patient_email_for_not_served = getattr(appointment, 'patient_email', '').strip()
        if patient_email_for_not_served:
            from app.services.email_service import send_not_served_email
            clinic_result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))
            clinic = clinic_result.scalar_one_or_none()
            clinic_name = clinic.clinic_name if clinic else clinic_id
            slot_name_info = slots[current_slot_index].get('slot_name', f'Slot {current_slot_id}') if current_slot_index < len(slots) else None
            send_not_served_email(patient_email_for_not_served, appointment.patient_name, clinic_name, slot_name_info)

        return {
            "message": "No more open slots - auto-finished with not_served outcome",
            "action": "auto_finished",
            "outcome": "not_served"
        }

    # Get the next slot number (1-based)
    next_slot_id = next_slot_index + 1

    # Find the highest token number in the next slot
    today = datetime.now().strftime("%Y-%m-%d")

    max_token = -1

    # Check online appointments in next slot
    result = await db.execute(
        select(Appointment).where(
            Appointment.clinic_id == clinic_id,
            Appointment.date == today,
            Appointment.slot_id == next_slot_id
        )
    )
    for apt in result.scalars().all():
        if apt.appointment_token:
            try:
                token_num = int(apt.appointment_token.replace("T-", ""))
                if token_num > max_token:
                    max_token = token_num
            except:
                pass

    # Check QR appointments in next slot
    result = await db.execute(
        select(QRAppointment).where(
            QRAppointment.clinic_id == clinic_id,
            QRAppointment.date == today,
            QRAppointment.slot_id == next_slot_id
        )
    )
    for apt in result.scalars().all():
        if apt.appointment_token:
            try:
                token_num = int(apt.appointment_token.replace("T-", ""))
                if token_num > max_token:
                    max_token = token_num
            except:
                pass

    # Check completed appointments in next slot (for token continuity)
    result = await db.execute(
        select(CompletedAppointment).where(
            CompletedAppointment.clinic_id == clinic_id,
            CompletedAppointment.date == today,
            CompletedAppointment.slot_id == next_slot_id,
        )
    )
    for apt in result.scalars().all():
        if apt.appointment_token:
            try:
                token_num = int(apt.appointment_token.replace("T-", ""))
                if token_num > max_token:
                    max_token = token_num
            except:
                pass

    # New token is highest + 1 (goes to end of queue)
    next_token_number = max_token + 1
    new_token_label = f"T-{next_token_number}"

    # Update the appointment with new slot and token
    old_slot_name = slots[current_slot_index].get("slot_name", f"Slot {current_slot_id}")
    new_slot_name = slots[next_slot_index].get("slot_name", f"Slot {next_slot_id}")
    new_time_range = slots[next_slot_index].get("time_range", [])
    new_time_str = f"{int(new_time_range[0])}:00 - {int(new_time_range[1])}:00" if len(new_time_range) >= 2 else f"Slot {next_slot_id}"
    new_slot_delay = await _slot_delay_label(db, clinic_id, next_slot_id)

    appointment.slot_id = next_slot_id
    appointment.appointment_token = new_token_label
    appointment.status = "booked"
    appointment.notification_stage = "pending"
    appointment.doctor_delay = new_slot_delay

    # Increment push_count
    current_push_count = getattr(appointment, 'push_count', 0)
    appointment.push_count = current_push_count + 1

    # Send email notification with new token number
    patient_email = getattr(appointment, 'patient_email', '').strip()
    if patient_email:
        from app.services.email_service import send_slot_push_email
        clinic_result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))
        clinic = clinic_result.scalar_one_or_none()
        clinic_name = clinic.clinic_name if clinic else clinic_id

        email_sent = send_slot_push_email(
            patient_email,
            appointment.patient_name,
            clinic_name,
            old_slot_name,
            new_slot_name,
            new_token_label  # Pass the new token number
        )
        if not email_sent:
            logger.warning(f"Failed to send push email to {patient_email}")

    await db.commit()
    await publish_queue_event(clinic_id, "queue_updated", {"old_slot_id": current_slot_id, "new_slot_id": next_slot_id})

    return {
        "message": f"Patient pushed to {new_slot_name}",
        "action": "pushed",
        "old_slot_id": current_slot_id,
        "new_slot_id": next_slot_id,
        "new_token": new_token_label,
        "new_position": "end of queue for next slot",
        "email_sent": patient_email is not None
    }

@router.post("/doctor/announce-delay/{clinic_id}/{delay}")
async def announce_delay(
    clinic_id: str,
    delay: str,
    session_id: Optional[int] = Query(None, description="Optional session/slot ID"),
    slot_id: Optional[int] = Query(None, description="Optional legacy slot ID"),
    db: AsyncSession = Depends(get_db)
):
    """Store a doctor delay and email the clinic a queue summary."""
    clean_delay = (delay or "").strip()
    if not clean_delay:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Delay is required")

    try:
        today = _clinic_today_str()

        clinic_result = await db.execute(
            select(Clinic).where(Clinic.clinic_id == clinic_id)
        )
        clinic = clinic_result.scalar_one_or_none()
        if not clinic:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clinic not found")

        target_slot_id = session_id or slot_id
        appointment_filters = [
            Appointment.clinic_id == clinic_id,
            Appointment.date == today,
            Appointment.status.notin_(["completed", "not_served", "auto_finished", "cancelled"]),
        ]
        if target_slot_id is not None:
            appointment_filters.append(Appointment.slot_id == target_slot_id)

        appointment_result = await db.execute(
            select(Appointment).where(and_(*appointment_filters)).order_by(Appointment.queue_position, Appointment.id)
        )
        appointments = appointment_result.scalars().all()

        queue_summary = []
        for index, appointment in enumerate(appointments, start=1):
            appointment.doctor_delay = clean_delay

            blood_group = "N/A"
            if getattr(appointment, "patient_id", None):
                patient_result = await db.execute(
                    select(Patient).where(Patient.patient_id == appointment.patient_id)
                )
                patient = patient_result.scalar_one_or_none()
                blood_group = (getattr(patient, "blood_group", None) or "N/A") if patient else "N/A"

            queue_summary.append({
                "patient_name": appointment.patient_name or "Patient",
                "token": appointment.appointment_token or "TBD",
                "blood_group": blood_group,
                "queue_position": appointment.queue_position or index,
                "status": appointment.status or "waiting",
            })

        walkin_filters = [
            QRAppointment.clinic_id == clinic_id,
            QRAppointment.date == today,
            QRAppointment.status.notin_(["completed", "not_served", "auto_finished", "cancelled"]),
        ]
        if target_slot_id is not None:
            walkin_filters.append(QRAppointment.slot_id == target_slot_id)

        walkin_result = await db.execute(
            select(QRAppointment).where(and_(*walkin_filters)).order_by(QRAppointment.queue_position, QRAppointment.id)
        )
        for walkin in walkin_result.scalars().all():
            walkin.doctor_delay = clean_delay

        if target_slot_id is not None:
            slot_result = await db.execute(
                select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
            )
            slot_record = slot_result.scalar_one_or_none()
            if slot_record:
                slots = _load_slots(slot_record.slots)
                slot_delays = _load_slot_delays(getattr(slot_record, "slot_delays", []), slots)
                slot_index = int(target_slot_id) - 1
                if 0 <= slot_index < len(slots):
                    slot_states = _load_slot_status(slot_record.slot)
                    selected_slot = slots[slot_index]
                    if not _is_slot_available(selected_slot, slot_states, slot_index):
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Delay can only be added to an available slot. This slot is closed."
                        )
                    time_range = selected_slot.get("time_range", [0, 0])
                    slot_end = float(time_range[1] if len(time_range) > 1 else 0)
                    now = _clinic_now()
                    current_time_decimal = now.hour + now.minute / 60.0
                    if slot_end <= 24 and current_time_decimal >= slot_end:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Delay can only be added to an available slot. This slot is expired."
                        )
                    delay_minutes = _delay_minutes(clean_delay)
                    slots[slot_index]["delay_minutes"] = delay_minutes
                    slots[slot_index]["status_override"] = "delayed"
                    while len(slot_delays) <= slot_index:
                        slot_delays.append(0)
                    slot_delays[slot_index] = delay_minutes
                    slot_record.slots = slots
                    slot_record.slot_delays = slot_delays

        await db.commit()

        clinic_email = (getattr(clinic, "email", None) or "").strip()
        email_sent = False
        if clinic_email:
            email_sent = send_delay_alert(
                to_email=clinic_email,
                delay=clean_delay,
                appointments=queue_summary,
                clinic_name=clinic.clinic_name or clinic.clinic_id,
                doctor_name=getattr(clinic, "doctor_name", None),
            )
        else:
            logger.warning("Delay email skipped for clinic %s: missing clinic email", clinic_id)

        return {
            "success": True,
            "message": "Delay announced successfully" if email_sent else "Delay saved; clinic email was not sent",
            "clinic_id": clinic_id,
            "delay": clean_delay,
            "session_id": target_slot_id,
            "slot_id": target_slot_id,
            "updated_count": len(appointments),
            "clinic_email": clinic_email,
            "email_sent": email_sent,
            "clinic_notified_count": 1 if email_sent else 0,
            "notified_count": 1 if email_sent else 0,
            "queue": queue_summary,
        }
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to announce delay for clinic %s: %s", clinic_id, exc)
        return {
            "success": False,
            "message": "Delay announcement failed",
            "clinic_id": clinic_id,
            "delay": clean_delay,
            "updated_count": 0,
            "email_sent": False,
            "clinic_notified_count": 0,
            "notified_count": 0,
            "error": str(exc),
        }

@router.get("/clinic/completed-appointments")
async def get_completed_appointments(
    clinic_id: str = Query(..., description="Clinic ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all completed/served appointments for a clinic (history).
    """
    result = await db.execute(
        select(CompletedAppointment).where(
            CompletedAppointment.clinic_id == clinic_id
        ).order_by(CompletedAppointment.served_at.desc())
    )
    completed = result.scalars().all()

    completed_list = []
    for apt in completed:
        completed_list.append({
            "id": apt.id,
            "token": apt.appointment_token,
            "patient_id": apt.patient_id,
            "patient_name": apt.patient_name,
            "patient_email": apt.patient_email,
            "patient_phone": apt.patient_phone,
            "doctor_name": apt.doctor_name,
            "date": apt.date,
            "time": apt.time,
            "served_at": apt.served_at,
            "finished_at": apt.finished_at,
            "wait_time_minutes": apt.wait_time_minutes,
            "service_duration_seconds": getattr(apt, "service_duration_seconds", None),
            "status": apt.status,
            "outcome": apt.outcome
        })

    return {"completed": completed_list, "total": len(completed_list)}


@router.get("/queue/history/stats")
async def get_queue_history_stats(
    clinic_id: str = Query(..., description="Clinic ID"),
    slot_id: int = Query(None, description="Filter by specific slot ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get queue history stats for a clinic - today's only.
    Optionally filter by slot_id to get stats for a specific time slot.
    """
    from datetime import date
    today = date.today().isoformat()

    try:
        # Build base query conditions
        completed_conditions = [
            CompletedAppointment.clinic_id == clinic_id,
            CompletedAppointment.date == today,
        ]

        # Add slot_id filter if provided
        if slot_id is not None:
            completed_conditions.append(CompletedAppointment.slot_id == slot_id)

        # Every row in completed_appointments is a patient who was already served.
        result = await db.execute(
            select(CompletedAppointment).where(and_(*completed_conditions))
        )
        served = result.scalars().all()
        total_served = len(served)

        # Build skipped query conditions
        skipped_online_conditions = [
            Appointment.clinic_id == clinic_id,
            Appointment.date == today,
            Appointment.status == "skipped"
        ]

        skipped_walkin_conditions = [
            QRAppointment.clinic_id == clinic_id,
            QRAppointment.date == today,
            QRAppointment.status == "skipped"
        ]

        # Add slot_id filter if provided
        if slot_id is not None:
            skipped_online_conditions.append(Appointment.slot_id == slot_id)
            skipped_walkin_conditions.append(QRAppointment.slot_id == slot_id)

        # Skipped patients stay in the active tables with status="skipped".
        result = await db.execute(
            select(Appointment).where(and_(*skipped_online_conditions))
        )
        skipped_online = result.scalars().all()

        result = await db.execute(
            select(QRAppointment).where(and_(*skipped_walkin_conditions))
        )
        skipped_walkin = result.scalars().all()

        # Count served vs not_served from completed appointments
        served_count = sum(1 for apt in served if apt.outcome == "served")
        not_served_count = sum(1 for apt in served if apt.outcome == "not_served")

        return {
            "total_patients_served": total_served,
            "total_skipped": len(skipped_online) + len(skipped_walkin),
            "served": served_count,
            "not_served": not_served_count
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch queue history stats: {str(e)}"
        )


@router.get("/queue/patient-dashboard/{patient_email}")
async def get_patient_dashboard(
    patient_email: str,
    clinic_id: str = Query("ALL", description="Clinic ID or ALL"),
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    """
    Get patient's queue position and status.
    """
    try:
        today = _clinic_today_str()

        clinic_lookup = {}
        clinic_result = await db.execute(select(Clinic))
        for clinic in clinic_result.scalars().all():
            clinic_lookup[clinic.clinic_id] = clinic

        slot_id = request.query_params.get("slot_id")
        slot_id_filter = int(slot_id) if slot_id else None

        if clinic_id == "ALL":
            result = await db.execute(
                select(Appointment).where(
                    Appointment.patient_email == patient_email,
                    Appointment.date == today
                )
            )
        else:
            query = select(Appointment).where(
                Appointment.patient_email == patient_email,
                Appointment.clinic_id == clinic_id,
                Appointment.date == today
            )
            if slot_id_filter is not None:
                query = query.where(Appointment.slot_id == slot_id_filter)
            result = await db.execute(query.order_by(Appointment.queue_position))

        appointments = result.scalars().all()

        if not appointments:
            return {"your_token": None, "status": "not_found", "patients_ahead": 0}

        appointments = list(appointments)
        appointments.sort(key=lambda item: item.queue_position if item.queue_position is not None else item.id)
        apt = appointments[0]
        clinic = clinic_lookup.get(apt.clinic_id)

        active_clinic_id = apt.clinic_id

        metrics = await get_live_queue_metrics(
            db,
            active_clinic_id,
            apt.date,
            "online",
            apt.id,
            apt.appointment_token,
            getattr(apt, "slot_id", None),
        )

        return {
            "your_token": {
                "appointment_id": apt.id,
                "token": apt.appointment_token,
                "token_number": int(apt.appointment_token.replace("T-", "")) if apt.appointment_token else 0,
                "patient_name": apt.patient_name,
                "clinic_id": apt.clinic_id,
                "clinic_name": clinic.clinic_name if clinic else apt.clinic_id,
                "address": clinic.address if clinic else "",
                "doctor_name": apt.doctor_name or (clinic.doctor_name if clinic else ""),
                "date": apt.date,
                "time": apt.time,
                "status": apt.status,
                "earliest_eta": metrics["earliest_eta"],
                "latest_eta": metrics["latest_eta"],
                "consultation_window": metrics["consultation_window"],
                "estimated_window_text": metrics["estimated_window_text"],
                "estimated_wait_minutes": metrics["estimated_wait_minutes"],
                "active_delay_minutes": metrics["active_delay_minutes"],
                "doctor_delay_minutes": metrics["doctor_delay_minutes"],
                "queue_adjusted_time": metrics["queue_adjusted_time"],
                "queue_position": metrics["queue_position"],
                "session_status": metrics["session_status"],
            },
            "status": apt.status or "waiting",
            "patients_ahead": metrics["patients_ahead"],
            "earliest_eta": metrics["earliest_eta"],
            "latest_eta": metrics["latest_eta"],
            "consultation_window": metrics["consultation_window"],
            "estimated_window_text": metrics["estimated_window_text"],
            "estimated_wait_minutes": metrics["estimated_wait_minutes"],
            "active_delay_minutes": metrics["active_delay_minutes"],
            "doctor_delay_minutes": metrics["doctor_delay_minutes"],
            "queue_adjusted_time": metrics["queue_adjusted_time"],
            "queue_position": metrics["queue_position"],
            "session_status": metrics["session_status"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch patient dashboard: {str(e)}")

# QR Walk-in: POST /queue/join
# Called by JoinQueue.tsx when a patient scans the clinic QR code.
# Inserts them into the appointments table at the end of today's queue
# and returns their token number + position.
# ─────────────────────────────────────────────────────────────────────────────

from pydantic import BaseModel

class QueueJoinRequest(BaseModel):
    clinic_id: str
    doctor_id: str          # doctor name or id — stored in doctor_name column
    patient_name: str
    phone: str
    source: str = "walkin"  # always "walkin" from the QR page
    booking_id: Optional[str] = None  # unused for walk-ins, kept for compatibility
    slot_id: Optional[int] = None  # time slot ID for per-slot token numbering

@router.post("/queue/join")
async def join_queue(
    payload: QueueJoinRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Walk-in patients join the live queue via QR code scan.
    - Uses per-slot token numbering (tokens reset for each time slot)
    - Assigns next sequential token within the slot (e.g. if slot 1 has T-3, new one is T-4)
    - Inserts a new row in qr_appointments table
    - Returns token_label, token_number, and position in queue
    """
    today = _clinic_today_str()

    clinic_result = await db.execute(
        select(Clinic).where(Clinic.clinic_id == payload.clinic_id)
    )
    clinic = clinic_result.scalar_one_or_none()

    if not clinic:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clinic not found"
        )

    if not clinic.is_active or clinic.available is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Clinic isn't opened yet."
        )

    slot_record_result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == payload.clinic_id)
    )
    slot_record = slot_record_result.scalar_one_or_none()
    slots = _load_slots(slot_record.slots) if slot_record else []
    slot_status = _load_slot_status(slot_record.slot) if slot_record else []
    now = _clinic_now()

    # Determine current slot if not provided
    slot_id = payload.slot_id
    if slot_id is None:
        current_time_decimal = now.hour + now.minute / 60.0
        for idx, slot in enumerate(slots):
            if _is_slot_available(slot, slot_status, idx):
                start, end = slot.get("time_range", [0, 0])
                if start <= current_time_decimal < end and not _slot_booking_cutoff_passed(slot, now):
                    slot_id = idx + 1
                    break

        if slot_id is None:
            for idx, slot in enumerate(slots):
                if _is_slot_available(slot, slot_status, idx) and not _slot_booking_cutoff_passed(slot, now):
                    slot_id = idx + 1
                    break

    if slot_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Clinic isn't opened yet."
        )

    slot_index = int(slot_id) - 1
    if slot_index < 0 or slot_index >= len(slots):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid time slot"
        )

    selected_slot = slots[slot_index]
    if not _is_slot_available(selected_slot, slot_status, slot_index):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Clinic isn't opened yet."
        )

    if _slot_booking_cutoff_passed(selected_slot, now):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This slot has already closed."
        )

    # Get highest token number for this specific slot
    max_token = -1

    # Check online appointments for this slot
    if slot_id is not None:
        result = await db.execute(
            select(Appointment).where(
                Appointment.clinic_id == payload.clinic_id,
                Appointment.date == today,
                Appointment.slot_id == slot_id
            )
        )
        for apt in result.scalars().all():
            if apt.appointment_token:
                try:
                    token_num = int(apt.appointment_token.replace("T-", ""))
                    if token_num > max_token:
                        max_token = token_num
                except:
                    pass

        # Check QR appointments for this slot
        result = await db.execute(
            select(QRAppointment).where(
                QRAppointment.clinic_id == payload.clinic_id,
                QRAppointment.date == today,
                QRAppointment.slot_id == slot_id
            )
        )
        for apt in result.scalars().all():
            if apt.appointment_token:
                try:
                    token_num = int(apt.appointment_token.replace("T-", ""))
                    if token_num > max_token:
                        max_token = token_num
                except:
                    pass

        # Check completed appointments for this slot
        result = await db.execute(
            select(CompletedAppointment).where(
                CompletedAppointment.clinic_id == payload.clinic_id,
                CompletedAppointment.date == today,
                CompletedAppointment.slot_id == slot_id,
            )
        )
        for apt in result.scalars().all():
            if apt.appointment_token:
                try:
                    token_num = int(apt.appointment_token.replace("T-", ""))
                    if token_num > max_token:
                        max_token = token_num
                except:
                    pass

    # Next token is highest + 1
    next_token_number = max_token + 1
    token_label = f"T-{next_token_number}"

    # Count active appointments for this slot for position
    if slot_id is not None:
        result = await db.execute(
            select(Appointment).where(
                Appointment.clinic_id == payload.clinic_id,
                Appointment.date == today,
                Appointment.slot_id == slot_id
            )
        )
        online_count = len(result.scalars().all())

        result = await db.execute(
            select(QRAppointment).where(
                QRAppointment.clinic_id == payload.clinic_id,
                QRAppointment.date == today,
                QRAppointment.slot_id == slot_id
            )
        )
        qr_count = len(result.scalars().all())
    else:
        # Fallback: count all if no slot
        result = await db.execute(
            select(Appointment).where(
                Appointment.clinic_id == payload.clinic_id,
                Appointment.date == today
            )
        )
        online_count = len(result.scalars().all())

        result = await db.execute(
            select(QRAppointment).where(
                QRAppointment.clinic_id == payload.clinic_id,
                QRAppointment.date == today
            )
        )
        qr_count = len(result.scalars().all())

    total_appointments = online_count + qr_count
    slot_delay = await _slot_delay_label(db, payload.clinic_id, slot_id)

    # Create the QR walk-in appointment row in separate table
    walkin = QRAppointment(
        appointment_token=token_label,
        clinic_id=payload.clinic_id,
        patient_name=payload.patient_name,
        patient_phone=payload.phone,
        doctor_name=payload.doctor_id,
        date=today,
        status="booked",
        slot_id=slot_id,
        session_id=slot_id,
        doctor_delay=slot_delay,
        queue_position=total_appointments + 1
    )
    db.add(walkin)
    await db.commit()
    await db.refresh(walkin)

    # Position = total appointments including this patient
    position = total_appointments + 1
    metrics = await get_live_queue_metrics(
        db,
        payload.clinic_id,
        today,
        "walkin",
        walkin.id,
        walkin.appointment_token,
        walkin.slot_id,
    )
    await publish_queue_event(payload.clinic_id, "queue_updated", {"slot_id": slot_id})

    return {
        "token_number": next_token_number,
        "token_label": token_label,
        "position": position,
        "patient_name": payload.patient_name,
        "clinic_id": payload.clinic_id,
        "source": "walkin",
        "slot_id": slot_id,
        "session_id": slot_id,
        "earliest_eta": metrics["earliest_eta"],
        "latest_eta": metrics["latest_eta"],
        "consultation_window": metrics["consultation_window"],
        "estimated_window_text": metrics["estimated_window_text"],
        "estimated_wait_minutes": metrics["estimated_wait_minutes"],
        "active_delay_minutes": metrics["active_delay_minutes"],
        "doctor_delay_minutes": metrics["doctor_delay_minutes"],
        "queue_adjusted_time": metrics["queue_adjusted_time"],
        "queue_position": metrics["queue_position"],
        "session_status": metrics["session_status"],
    }

# ─────────────────────────────────────────────────────────────────────────────
# Lookup appointment by phone number (for Your Details feature)
# Works for both online appointments and walk-in/QR appointments
# ─────────────────────────────────────────────────────────────────────────────

async def _verify_lookup_schema(db):
    await db.execute(text("SELECT 1"))

    required_columns = {
        "appointments": {
            "id",
            "appointment_token",
            "clinic_id",
            "patient_name",
            "patient_phone",
            "date",
            "status",
        },
        "qr_appointments": {
            "id",
            "appointment_token",
            "clinic_id",
            "patient_name",
            "patient_phone",
            "date",
            "status",
        },
    }

    missing = {}
    for table_name, columns in required_columns.items():
        result = await db.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = :table_name
                """
            ),
            {"table_name": table_name},
        )
        existing = {row[0] for row in result.fetchall()}
        table_missing = sorted(columns - existing)
        if not existing:
            missing[table_name] = ["<table missing>"]
        elif table_missing:
            missing[table_name] = table_missing

    if missing:
        logger.error("YourDetails lookup schema check failed: %s", missing)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "message": "Database schema is missing required lookup tables or columns",
                "missing": missing,
            },
        )


@router.get("/queue/lookup-by-phone")
async def lookup_by_phone(phone: str = Query(..., description="Patient phone number"), db: AsyncSession = Depends(get_db)):
    phone_digits = "".join(ch for ch in phone.strip() if ch.isdigit())
    phone_last10 = phone_digits[-10:] if len(phone_digits) >= 10 else phone_digits

    if len(phone_digits) < 10 or len(phone_digits) > 15 or len(phone_last10) != 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enter a valid 10-digit mobile number",
        )

    if phone_last10[0] not in {"6", "7", "8", "9"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enter a valid Indian mobile number",
        )

    try:
        await _verify_lookup_schema(db)
        return await _lookup_by_phone_impl(phone=phone, db=db)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        logger.exception(
            "YourDetails database/query error phone=******%s error_type=%s",
            phone_last10[-4:],
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": "Database query failed while looking up appointment details",
                "error_type": type(exc).__name__,
            },
        ) from exc
    except Exception as exc:
        logger.exception(
            "YourDetails unexpected lookup error phone=******%s error_type=%s",
            phone_last10[-4:],
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "message": "Appointment lookup failed unexpectedly",
                "error_type": type(exc).__name__,
                "error": str(exc),
            },
        ) from exc


async def _lookup_by_phone_impl(phone, db):
    """
    Look up appointment details by phone number.
    Searches both online appointments and QR/walk-in appointments.
    Returns all active appointments for today (supports multiple appointments).
    """
    # Normalize phone number:
    # - Keep only digits
    # - Use last 10 digits as the canonical mobile
    # This makes lookup resilient to stored formats like '+91 98765-43210', '091...', '0091...', etc.
    phone_digits = "".join(ch for ch in phone.strip() if ch.isdigit())
    phone_last10 = phone_digits[-10:] if len(phone_digits) >= 10 else phone_digits
    masked_phone = f"******{phone_last10[-4:]}" if phone_last10 else "empty"
    def normalize_phone(value) -> str:
        return "".join(ch for ch in str(value or "") if ch.isdigit())[-10:]

    today = _clinic_today_str()
    logger.info(
        "YourDetails lookup start phone=%s today=%s raw_digits_len=%s",
        masked_phone,
        today,
        len(phone_digits),
    )

    # Candidate exact matches for common stored formats
    phone_candidates = list(
        dict.fromkeys(
            [
                phone_last10,
                f"+91{phone_last10}",
                f"91{phone_last10}",
                f"0{phone_last10}",
            ]
        )
    )

    # Also allow suffix match (e.g. stored with spaces or country code variants)
    # NOTE: This is intentionally conservative by anchoring to last-10 digits.
    phone_suffix_like = f"%{phone_last10}" if phone_last10 else None

    def make_appointment(row: dict, source: str):
        return SimpleNamespace(
            id=row.get("id"),
            appointment_token=row.get("appointment_token") or "",
            clinic_id=row.get("clinic_id") or "",
            patient_id=row.get("patient_id") or f"{source}-{row.get('id')}",
            patient_name=row.get("patient_name") or "",
            patient_email=row.get("patient_email") or "",
            patient_phone=row.get("patient_phone") or "",
            doctor_name=row.get("doctor_name") or "",
            date=row.get("date") or today,
            time=row.get("time") or "",
            status=row.get("status") or "booked",
            created_at=row.get("created_at"),
            source=row.get("source") or source,
            slot_id=row.get("slot_id"),
            queue_position=row.get("queue_position"),
            doctor_delay=row.get("doctor_delay"),
        )

    online_result = await db.execute(
        text("SELECT * FROM appointments WHERE date = :today"),
        {"today": today},
    )
    appointments = []
    for row in online_result.mappings().all():
        apt = make_appointment(dict(row), "online")
        if normalize_phone(apt.patient_phone) == phone_last10:
            appointments.append({"appointment": apt, "source": "online"})

    logger.info(
        "YourDetails online matches phone=%s count=%s",
        masked_phone,
        len(appointments),
    )

    if not appointments:
        qr_result = await db.execute(
            text("SELECT * FROM qr_appointments WHERE date = :today"),
            {"today": today},
        )
        for row in qr_result.mappings().all():
            apt = make_appointment(dict(row), "walkin")
            if normalize_phone(apt.patient_phone) == phone_last10:
                appointments.append({"appointment": apt, "source": "walkin"})
        logger.info(
            "YourDetails walkin matches phone=%s count=%s",
            masked_phone,
            len(appointments),
        )

    appointments.sort(
        key=lambda item: _sort_datetime(item["appointment"].created_at),
        reverse=True,
    )

    if not appointments:
        logger.info("YourDetails lookup not found phone=%s today=%s", masked_phone, today)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No appointment found for this phone number today"
        )

    # Helper function to get slot name
    async def get_slot_name(clinic_id, slot_id):
        if not slot_id:
            return None
        try:
            slot_id = int(slot_id)
            slot_result = await db.execute(
                select(ClinicTimeSlot.slots).where(ClinicTimeSlot.clinic_id == clinic_id)
            )
            raw_slots = slot_result.scalar_one_or_none()
            if raw_slots is not None:
                slots = _load_slots(raw_slots)
                slot_idx = slot_id - 1
                if 0 <= slot_idx < len(slots):
                    return slots[slot_idx].get("slot_name", f"Slot {slot_id}")
        except Exception:
            logger.exception("YourDetails slot lookup failed clinic_id=%s slot_id=%s", clinic_id, slot_id)
        return None

    async def get_slot_delay(clinic_id, slot_id):
        try:
            return await _slot_delay_label(db, clinic_id, slot_id)
        except Exception:
            logger.exception("YourDetails delay lookup failed clinic_id=%s slot_id=%s", clinic_id, slot_id)
            return None

    async def get_slot_delay_meta(clinic_id, slot_id):
        if not slot_id:
            return {}
        try:
            slot_result = await db.execute(select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id))
            slot_record = slot_result.scalar_one_or_none()
            if not slot_record:
                return {}
            slots, slot_delays = await _clear_stale_slot_delays(slot_record, db)
            slot_idx = int(slot_id) - 1
            if slot_idx < 0 or slot_idx >= len(slots):
                return {}
            minutes = slot_delays[slot_idx] if slot_idx < len(slot_delays) else 0
            slot = slots[slot_idx]
            return {
                "delay_minutes": minutes,
                "delay_started_at": slot.get("delay_started_at") if minutes > 0 else None,
                "delay_ends_at": slot.get("delay_ends_at") if minutes > 0 else None,
                "delay_original_start_time": slot.get("delay_original_start_time") if minutes > 0 else None,
                "delay_updated_start_time": slot.get("delay_updated_start_time") if minutes > 0 else None,
            }
        except Exception:
            logger.exception("YourDetails delay meta lookup failed clinic_id=%s slot_id=%s", clinic_id, slot_id)
            return {}

    # Helper function to get clinic info
    async def get_clinic_info(clinic_id):
        try:
            clinic_result = await db.execute(
                select(
                    Clinic.clinic_name,
                    Clinic.address,
                    Clinic.street_address,
                    Clinic.road,
                    Clinic.layout,
                    Clinic.section,
                    Clinic.city,
                    Clinic.pincode,
                ).where(Clinic.clinic_id == clinic_id)
            )
            clinic = clinic_result.first()
            if not clinic:
                return {"name": clinic_id, "address": None}

            structured_address = ", ".join(
                filter(
                    None,
                    [
                        clinic.street_address,
                        clinic.road,
                        clinic.layout,
                        clinic.section,
                        clinic.city,
                        clinic.pincode,
                    ],
                )
            )
            return {
                "name": clinic.clinic_name or clinic_id,
                "address": structured_address or clinic.address,
            }
        except Exception:
            logger.exception("YourDetails clinic lookup failed clinic_id=%s", clinic_id)
            return {"name": clinic_id, "address": None}

    # Build list of appointments
    appointments_list = []

    # Process all appointments
    for item in appointments:
        apt = item["appointment"]
        source = item["source"]
        clinic_info = await get_clinic_info(apt.clinic_id)
        slot_name = await get_slot_name(apt.clinic_id, apt.slot_id)
        doctor_delay = getattr(apt, "doctor_delay", None) or await get_slot_delay(apt.clinic_id, apt.slot_id)
        delay_meta = await get_slot_delay_meta(apt.clinic_id, apt.slot_id)
        metrics = await get_live_queue_metrics(
            db,
            apt.clinic_id,
            apt.date,
            source,
            apt.id,
            apt.appointment_token,
            apt.slot_id,
        )
        if not metrics["found"]:
            logger.warning(
                "YourDetails queue metrics not found clinic_id=%s source=%s appointment_id=%s token=%s",
                apt.clinic_id,
                source,
                apt.id,
                apt.appointment_token,
            )

        appointments_list.append({
            "token_label": apt.appointment_token,
            "patient_name": apt.patient_name,
            "clinic_name": clinic_info["name"],
            "clinic_address": clinic_info["address"],
            "doctor_name": getattr(apt, "doctor_name", None),
            "date": apt.date,
            "time": getattr(apt, "time", None) or slot_name or "Walk-in",
            "slot_name": slot_name,
            "position": metrics["position_label"],
            "patients_ahead": metrics["patients_ahead"],
            "estimated_wait_minutes": metrics["estimated_wait_minutes"],
            "latest_estimated_wait_minutes": metrics["latest_estimated_wait_minutes"],
            "earliest_eta": metrics["earliest_eta"],
            "latest_eta": metrics["latest_eta"],
            "consultation_window": metrics["consultation_window"],
            "estimated_window_text": metrics["estimated_window_text"],
            "active_delay_minutes": metrics["active_delay_minutes"],
            "doctor_delay_minutes": metrics["doctor_delay_minutes"],
            "queue_adjusted_time": metrics["queue_adjusted_time"],
            "queue_position": metrics["queue_position"],
            "session_status": metrics["session_status"],
            "now_serving_token": metrics["now_serving_token"],
            "doctor_delay": doctor_delay,
            "clinic_id": apt.clinic_id,
            **delay_meta,
            "status": apt.status,
            "source": source
        })

    return {
        "count": len(appointments_list),
        "appointments": appointments_list
    }


# ─────────────────────────────────────────────────────────────────────────────
# Clinic Time Slot Management Endpoints
# ─────────────────────────────────────────────────────────────────────────────
# One row per clinic - all slots stored as JSON array

@router.get("/clinic/time-slots")
async def get_time_slots(
    clinic_id: str = Query(..., description="Clinic ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all time slots for a clinic (one row per clinic with slots as JSON array).
    Returns: {clinic_id, slots: [{slot_name, time_range, is_open}, ...], last_slot_change_date}
    """
    result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    record = result.scalar_one_or_none()

    if not record:
        # Return empty slots array if no record exists
        return {"clinic_id": clinic_id, "slots": [], "slot": [], "slot_delays": [], "last_slot_change_date": None}

    slots, slot_delays = await _clear_stale_slot_delays(record, db)

    # Handle slot array
    slot_array = record.slot or []
    if isinstance(slot_array, str):
        slot_array = json.loads(slot_array) if slot_array else []

    return {
        "clinic_id": clinic_id,
        "slots": slots or [],
        "slot": slot_array or [],
        "slot_delays": slot_delays,
        "last_slot_change_date": record.last_slot_change_date.isoformat() if record.last_slot_change_date else None
    }

@router.get("/clinic/slot-queue-counts")
async def get_slot_queue_counts(
    clinic_id: str = Query(..., description="Clinic ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Count active patients in each clinic slot for today.

    Includes online appointments and QR/walk-in appointments. Served,
    completed, cancelled, skipped, and not-served rows are not counted.
    """
    today = _clinic_today_str()
    active_statuses = ["booked", "pending", "serving"]

    slot_result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    slot_record = slot_result.scalar_one_or_none()
    slots = _load_slots(slot_record.slots) if slot_record else []
    slot_counts = {index + 1: 0 for index in range(len(slots))}

    online_result = await db.execute(
        select(Appointment.slot_id, func.count(Appointment.id))
        .where(
            Appointment.clinic_id == clinic_id,
            Appointment.date == today,
            Appointment.slot_id.isnot(None),
            Appointment.status.in_(active_statuses),
        )
        .group_by(Appointment.slot_id)
    )
    for slot_id, count in online_result.all():
        if slot_id is not None:
            slot_counts[int(slot_id)] = slot_counts.get(int(slot_id), 0) + int(count or 0)

    walkin_result = await db.execute(
        select(QRAppointment.slot_id, func.count(QRAppointment.id))
        .where(
            QRAppointment.clinic_id == clinic_id,
            QRAppointment.date == today,
            QRAppointment.slot_id.isnot(None),
            QRAppointment.status.in_(active_statuses),
        )
        .group_by(QRAppointment.slot_id)
    )
    for slot_id, count in walkin_result.all():
        if slot_id is not None:
            slot_counts[int(slot_id)] = slot_counts.get(int(slot_id), 0) + int(count or 0)

    return {
        "clinic_id": clinic_id,
        "date": today,
        "slot_counts": slot_counts,
        "total": sum(slot_counts.values()),
    }

@router.post("/clinic/time-slots")
async def add_time_slot(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Add a new time slot to a clinic.
    Creates clinic record if doesn't exist.
    Request: {clinic_id, slot_name, time_range: [start, end]}
    """
    clinic_id = request.get("clinic_id")
    slot_name = request.get("slot_name")
    time_range = request.get("time_range")  # [start_hour, end_hour] e.g., [8, 11]

    if not all([clinic_id, slot_name, time_range]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required fields: clinic_id, slot_name, time_range"
        )

    # Find or create clinic record
    result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    record = result.scalar_one_or_none()

    new_slot = {
        "slot_name": slot_name,
        "time_range": time_range,
        "is_open": True,
        "delay_minutes": 0
    }

    import json
    if not record:
        # Create new record with this slot
        record = ClinicTimeSlot(
            clinic_id=clinic_id,
            slots=[new_slot],
            slot=["close"],  # Initialize slot array with default "close"
            slot_delays=[0],
            last_slot_change_date=datetime.now(timezone.utc)  # Set initial change date
        )
        db.add(record)
    else:
        # Append to existing slots
        current_slots = record.slots
        if isinstance(current_slots, str):
            current_slots = json.loads(current_slots)
        current_slots = list(current_slots or [])
        if len(current_slots) >= 3:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Maximum 3 time slots allowed"
            )
        current_slots.append(new_slot)
        record.slots = current_slots

        # Also append to slot array
        slot_array = record.slot or []
        if isinstance(slot_array, str):
            slot_array = json.loads(slot_array) if slot_array else []
        slot_array = list(slot_array)
        slot_array.append("close")  # New slot defaults to "close"
        record.slot = slot_array

        slot_delays = _load_slot_delays(getattr(record, "slot_delays", []), current_slots[:-1])
        slot_delays.append(0)
        record.slot_delays = slot_delays

        # Update last_slot_change_date when slots are modified
        record.last_slot_change_date = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(record)

    return {
        "message": "Time slot added successfully",
        "clinic_id": clinic_id,
        "slots": record.slots,
        "slot": record.slot,
        "slot_delays": record.slot_delays,
        "last_slot_change_date": record.last_slot_change_date.isoformat() if record.last_slot_change_date else None
    }

@router.put("/clinic/time-slots/{slot_index}")
async def update_time_slot(
    slot_index: int,
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Update a time slot by index (0-based).
    Enforces daily limit (2 times) for open/close toggle operations.
    Request: {clinic_id, slot_name?, time_range?, is_open?, slot?}
    """
    clinic_id = request.get("clinic_id")
    if not clinic_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="clinic_id is required"
        )

    result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    record = result.scalar_one_or_none()

    if not record or not record.slots or slot_index >= len(record.slots):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Time slot not found"
        )

    # Check if this is a toggle operation (open/close)
    is_toggle_operation = "is_open" in request or "slot" in request

    # For toggle operations, check daily limit per slot
    if is_toggle_operation:
        # Ensure daily_toggle_counts exists and is a list
        if not record.daily_toggle_counts or not isinstance(record.daily_toggle_counts, list):
            record.daily_toggle_counts = [0, 0, 0]

        # Ensure the array is long enough for the requested slot
        while len(record.daily_toggle_counts) <= slot_index:
            record.daily_toggle_counts.append(0)

        # Reset all counters if it's a new day
        now = datetime.now(timezone.utc)
        today = now.date()

        if record.last_toggle_date:
            if record.last_toggle_date.tzinfo is None:
                record.last_toggle_date = record.last_toggle_date.replace(tzinfo=timezone.utc)

            if record.last_toggle_date.date() < today:
                # New day - reset all counters
                record.daily_toggle_counts = [0] * len(record.slots)

        can_toggle, message = _can_toggle_slot(record.last_toggle_date, record.daily_toggle_counts, slot_index)
        if not can_toggle:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=message
            )

        # Increment daily toggle count for this specific slot
        record.daily_toggle_counts[slot_index] = (record.daily_toggle_counts[slot_index] or 0) + 1
        record.last_toggle_date = now

    # Update the slot at the given index
    import json
    slots = record.slots
    if isinstance(slots, str):
        slots = json.loads(slots)
    slots = list(slots)

    if "is_open" in request:
        new_value = request["is_open"]
        if isinstance(new_value, bool):
            slots[slot_index]["is_open"] = new_value
        elif isinstance(new_value, str):
            slots[slot_index]["is_open"] = new_value.lower() == "true"
        else:
            slots[slot_index]["is_open"] = bool(new_value)

    if "delay_minutes" in request:
        delay_minutes = _delay_minutes(request["delay_minutes"])
        slots[slot_index]["delay_minutes"] = delay_minutes
        slot_delays = _load_slot_delays(getattr(record, "slot_delays", []), slots)
        while len(slot_delays) <= slot_index:
            slot_delays.append(0)
        slot_delays[slot_index] = delay_minutes
        record.slot_delays = slot_delays

    # Update slot array at specific index if provided (open or close)
    if "slot" in request:
        # Ensure slot array exists and has correct length
        slot_array = record.slot or []
        if isinstance(slot_array, str):
            import json
            slot_array = json.loads(slot_array) if slot_array else []
        slot_array = list(slot_array)

        # Extend array if needed
        while len(slot_array) <= slot_index:
            slot_array.append("close")

        # Update the specific index
        slot_array[slot_index] = request["slot"]
        record.slot = slot_array

    record.slots = slots

    # Update last_slot_change_date when slots are modified
    record.last_slot_change_date = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(record)

    return {
        "message": "Time slot updated successfully",
        "clinic_id": clinic_id,
        "slots": record.slots,
        "slot": record.slot,
        "slot_delays": record.slot_delays,
        "last_slot_change_date": record.last_slot_change_date.isoformat() if record.last_slot_change_date else None,
        "daily_toggle_counts": record.daily_toggle_counts,
        "last_toggle_date": record.last_toggle_date.isoformat() if record.last_toggle_date else None
    }

@router.delete("/clinic/time-slots/{slot_index}")
async def delete_time_slot(
    slot_index: int,
    clinic_id: str = Query(..., description="Clinic ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a time slot by index (0-based).
    """
    result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    record = result.scalar_one_or_none()

    if not record or not record.slots or slot_index >= len(record.slots):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Time slot not found"
        )

    # Remove slot at index
    import json
    slots = record.slots
    if isinstance(slots, str):
        slots = json.loads(slots)
    slots = list(slots)
    slot_delays = _load_slot_delays(getattr(record, "slot_delays", []), slots)
    slots.pop(slot_index)
    if slot_index < len(slot_delays):
        slot_delays.pop(slot_index)
    record.slots = slots
    record.slot_delays = slot_delays

    # Update last_slot_change_date when slots are modified
    record.last_slot_change_date = datetime.now(timezone.utc)

    await db.commit()

    return {
        "message": "Time slot deleted successfully",
        "clinic_id": clinic_id,
        "slots": record.slots,
        "slot_delays": record.slot_delays,
        "last_slot_change_date": record.last_slot_change_date.isoformat() if record.last_slot_change_date else None
    }


# ─────────────────────────────────────────────────────────────────────────────
# Scheduled Notification Tasks
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/clinic/auto-finish-unserved")
async def auto_finish_unserved_patients(
    db: AsyncSession = Depends(get_db)
):
    """
    Automatically move patients to completed_appointments with outcome='not_served'
    if their slot time has passed and they were neither served nor skipped.

    This should be called periodically (e.g., every minute) via cron/job scheduler.
    Only processes patients whose slot end time has passed.
    """
    import logging
    from datetime import datetime, timedelta

    logger = logging.getLogger(__name__)
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    current_time_decimal = now.hour + now.minute / 60.0

    # Get all clinics with appointments today
    clinic_result = await db.execute(
        select(Appointment.clinic_id).where(
            Appointment.date == today,
            Appointment.status.in_(["booked", "pending", "serving"])
        ).distinct()
    )
    clinic_ids = [r[0] for r in clinic_result.all()]

    auto_finished = []

    for clinic_id in clinic_ids:
        # Get time slots for this clinic
        slot_result = await db.execute(
            select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
        )
        slot_record = slot_result.scalar_one_or_none()
        if not slot_record:
            continue

        slots = _load_slots(slot_record.slots)

        # Get all appointments for this clinic that are still active (not served/skipped/finished)
        apt_result = await db.execute(
            select(Appointment).where(
                Appointment.clinic_id == clinic_id,
                Appointment.date == today,
                Appointment.status.in_(["booked", "pending", "serving"])
            ).order_by(Appointment.slot_id)
        )
        appointments = apt_result.scalars().all()

        for appointment in appointments:
            slot_id = appointment.slot_id
            if slot_id is None:
                continue

            slot_index = int(slot_id) - 1
            if slot_index < 0 or slot_index >= len(slots):
                continue

            slot = slots[slot_index]
            if not slot.get("is_open"):
                continue

            slot_end = slot.get("time_range", [0, 0])[1]

            # Check if slot end time has passed (with 1 minute buffer)
            if current_time_decimal >= slot_end:
                # This patient's slot has ended without being served/skipped
                # Move them to completed_appointments with outcome='not_served'
                from datetime import timezone
                served_at = appointment.created_at
                if served_at.tzinfo is None:
                    served_at = served_at.replace(tzinfo=timezone.utc)
                finished_at = datetime.now(timezone.utc)
                wait_time = int((finished_at - served_at).total_seconds() / 60)

                # Get current push_count
                current_push_count = getattr(appointment, 'push_count', 0)

                # Create completed record with not_served outcome
                completed = CompletedAppointment(
                    appointment_token=appointment.appointment_token,
                    clinic_id=appointment.clinic_id,
                    patient_id=getattr(appointment, 'patient_id', f"auto-{appointment.id}"),
                    patient_name=appointment.patient_name,
                    patient_email=getattr(appointment, 'patient_email', ""),
                    patient_phone=appointment.patient_phone,
                    doctor_name=getattr(appointment, 'doctor_name', None),
                    date=appointment.date,
                    time=getattr(appointment, 'time', "auto-finished"),
                    slot_id=appointment.slot_id,
                    served_at=served_at,
                    finished_at=finished_at,
                    status="auto_finished",
                    wait_time_minutes=wait_time,
                    outcome="not_served",
                    served=False,  # Not served - slot ended without them being served
                    push_count=current_push_count  # Keep their push count
                )
                db.add(completed)
                await db.delete(appointment)
                await db.commit()

                auto_finished.append({
                    "clinic_id": clinic_id,
                    "patient_name": appointment.patient_name,
                    "token": appointment.appointment_token,
                    "slot_id": slot_id
                })
                logger.info(
                    "Auto-finished unserved patient %s (token %s) for clinic %s",
                    appointment.patient_name,
                    appointment.appointment_token,
                    clinic_id
                )

    return {
        "auto_finished_count": len(auto_finished),
        "auto_finished_patients": auto_finished

    }




@router.get("/doctor/today-slots/{clinic_id}")
async def get_today_slots(
    clinic_id: str,
    db: AsyncSession = Depends(get_db)
):

    result = await db.execute(
        select(Appointment)
        .where(Appointment.clinic_id == clinic_id)
        .order_by(Appointment.queue_position)
    )

    appointments = result.scalars().all()

    final = []

    for appt in appointments:

        patient_result = await db.execute(
            select(Patient)
            .where(Patient.patient_id == appt.patient_id)
        )

        patient = patient_result.scalar_one_or_none()

        final.append({
            "id": appt.id,
            "token": appt.appointment_token,
            "name": appt.patient_name,
            "email": appt.patient_email,
            "phone": appt.patient_phone,
            "blood_group": patient.blood_group if patient else "N/A",
            "time": appt.time,
            "status": appt.status
        })

    return final
