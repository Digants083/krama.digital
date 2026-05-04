from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, and_, func
from app.database.db import get_db
from app.database.models import Appointment, CompletedAppointment, QRAppointment, ClinicTimeSlot, Clinic
from app.services.email_service import send_queue_alert
import json

router = APIRouter(prefix="/auth", tags=["queue"])


def _load_slots(raw_slots):
    slots = raw_slots
    if isinstance(slots, str):
        slots = json.loads(slots)
    return list(slots or [])


def _can_modify_slots(last_change_date: Optional[datetime], current_slot_count: int) -> tuple[bool, str]:
    """
    Check if clinic can modify their slots based on 7-day cooldown rule.
    Cooldown only applies when clinic has 3 slots (maximum allowed).

    Args:
        last_change_date: The date when slots were last modified
        current_slot_count: Current number of slots the clinic has

    Returns:
        (can_modify, message): Tuple indicating if modification is allowed and why
    """
    # No cooldown restriction if clinic has less than 3 slots
    if current_slot_count < 3:
        return True, f"Can modify slots (currently have {current_slot_count}/3 slots)"

    if last_change_date is None:
        return True, "No previous slot changes - first modification allowed"

    # Ensure last_change_date has timezone info
    if last_change_date.tzinfo is None:
        last_change_date = last_change_date.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    days_since_change = (now - last_change_date).days

    if days_since_change < 7:
        return False, f"Slot changes are limited to once per week. You can modify slots again in {7 - days_since_change} day(s)."

    return True, "Slot modification allowed - 7-day cooldown period has passed"


def _can_toggle_slot(last_toggle_date: Optional[datetime], slot_toggle_counts: list, slot_index: int) -> tuple[bool, str]:
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

    now = datetime.now()
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
    Returns the start hour of the first open slot of the day.
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

    first_slot = slots[0] if isinstance(slots, list) else None
    if not isinstance(first_slot, dict):
        return None

    time_range = first_slot.get("time_range")
    if not isinstance(time_range, list) or len(time_range) < 2:
        return None

    return time_range[0]

async def get_last_open_slot_end(clinic_id: str, db: AsyncSession):
    """
    Returns the end hour of the last open slot of the day.
    Only considers slots where is_open is True.
    """
    result = await db.execute(
        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None

    slots = _load_slots(record.slots)
    last_end = None
    for slot in slots:
        if slot.get("is_open"):
            end_time = slot.get("time_range", [0, 0])[1]
            if last_end is None or end_time > last_end:
                last_end = end_time
    return last_end

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

    now = datetime.now()
    current_time_decimal = now.hour + now.minute / 60.0
    for slot in slots:
        if slot.get("is_open"):
            end_time = slot.get("time_range", [0, 0])[1]
            if current_time_decimal < end_time:
                return False

    return True

def _token_number(token: Optional[str]) -> int:
    if not token:
        return 0
    digits = "".join(ch for ch in token if ch.isdigit())
    return int(digits) if digits else 0


async def _send_queue_notifications(clinic_id: str, db: AsyncSession) -> None:
    """Notify patients when they are close to being served.
    
    Queue-time logic:
    - When a patient is currently serving, notify the next 2 online patients
      to reach clinic immediately.
    - This keeps the "third in line" behavior moving automatically whenever
      queue advances.
    """
    from datetime import datetime
    import logging

    logger = logging.getLogger(__name__)
    today = datetime.now().strftime("%Y-%m-%d")

    clinic_result = await db.execute(
        select(Clinic).where(Clinic.clinic_id == clinic_id)
    )
    clinic = clinic_result.scalar_one_or_none()
    clinic_name = clinic.clinic_name if clinic else clinic_id

    online_result = await db.execute(
        select(Appointment).where(
            Appointment.clinic_id == clinic_id,
            Appointment.date == today
        )
    )
    walkin_result = await db.execute(
        select(QRAppointment).where(
            QRAppointment.clinic_id == clinic_id,
            QRAppointment.date == today
        )
    )

    combined_queue = []
    for item in online_result.scalars().all():
        combined_queue.append({
            "kind": "online",
            "item": item,
            "token": item.appointment_token,
            "created_at": item.created_at or datetime.min,
            "status": item.status or "booked",
        })
    for item in walkin_result.scalars().all():
        combined_queue.append({
            "kind": "walkin",
            "item": item,
            "token": item.appointment_token,
            "created_at": item.created_at or datetime.min,
            "status": item.status or "booked",
        })

    combined_queue.sort(
        key=lambda entry: (
            0 if entry["status"] == "serving" else 1,
            _token_number(entry["token"]),
            entry["created_at"],
        )
    )

    serving_index = next(
        (index for index, entry in enumerate(combined_queue) if entry["status"] == "serving"),
        None,
    )
    if serving_index is None:
        return

    for target_index in [serving_index + 2]:
        if target_index >= len(combined_queue):
            continue

        entry = combined_queue[target_index]
        if entry["kind"] != "online":
            continue

        appointment = entry["item"]
        patient_email = (appointment.patient_email or "").strip()
        if not patient_email:
            continue

        if appointment.notification_stage == "reach_turn":
            continue

        email_sent = send_queue_alert(
            patient_email,
            appointment.patient_name,
            clinic_name,
            "reach_turn",
            token_number=appointment.appointment_token,
            doctor_name=appointment.doctor_name or (clinic.doctor_name if clinic else ""),
            clinic_location=clinic.address if clinic else "",
            latitude=clinic.latitude if clinic else None,
            longitude=clinic.longitude if clinic else None,
        )
        if email_sent:
            appointment.notification_stage = "reach_turn"
            logger.info(
                "Reach-clinic alert sent to %s for clinic %s",
                patient_email,
                clinic_id,
            )
        else:
            logger.warning(
                "Reach-clinic alert email could not be sent to %s for clinic %s",
                patient_email,
                clinic_id,
            )

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
        # Check if all slots have expired
        if await all_slots_expired(clinic_id, db):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="All time slots have expired for today. Cannot activate clinic."
            )

        # Check pre-activation window
        first_slot_start = await get_first_open_slot_start(clinic_id, db)
        if first_slot_start is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No open time slots configured for today."
            )

        now = datetime.now()
        current_time_decimal = now.hour + now.minute / 60.0
        activation_threshold = first_slot_start - (45 / 60.0)

        if current_time_decimal < activation_threshold:
            # Calculate wait time
            wait_minutes = int((activation_threshold - current_time_decimal) * 60)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Clinic can only be activated {wait_minutes} minutes from now (Slot starts at {int(first_slot_start)}:00)."
            )

        # Manual Online Restriction: Cannot go online if all slots have passed
        last_slot_end = await get_last_open_slot_end(clinic_id, db)
        if last_slot_end is not None and current_time_decimal >= (last_slot_end - (15 / 60.0)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No time slots available for today. Live window has ended."
            )

        slot_result = await db.execute(
            select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
        )
        slot_record = slot_result.scalar_one_or_none()

        # Option 1: if clinic activates late, automatically close any slots that are already
        # 30 minutes past their start time (today only)
        if slot_record and slot_record.slots:
            slots = _load_slots(slot_record.slots)

            slot_array = slot_record.slot or []
            if isinstance(slot_array, str):
                slot_array = json.loads(slot_array) if slot_array else []
            slot_array = list(slot_array)

            changed = False
            for idx, slot in enumerate(slots):
                if not isinstance(slot, dict):
                    continue

                if not slot.get("is_open"):
                    continue

                time_range = slot.get("time_range", [])
                if not isinstance(time_range, list) or len(time_range) < 2:
                    continue

                start_time = time_range[0]
                if not isinstance(start_time, (int, float)):
                    continue

                if current_time_decimal >= (start_time + 0.5):
                    slot["is_open"] = False
                    while len(slot_array) <= idx:
                        slot_array.append("close")
                    slot_array[idx] = "close"
                    changed = True

            if changed:
                slot_record.slots = slots
                slot_record.slot = slot_array
                await db.commit()

            has_activatable_slot = False
            for slot in slots:
                if not isinstance(slot, dict) or not slot.get("is_open"):
                    continue

                time_range = slot.get("time_range", [])
                if not isinstance(time_range, list) or len(time_range) < 2:
                    continue

                start_time = time_range[0]
                end_time = time_range[1]
                if not isinstance(start_time, (int, float)) or not isinstance(end_time, (int, float)):
                    continue

                if current_time_decimal < end_time and current_time_decimal < (start_time + 0.5):
                    has_activatable_slot = True
                    break

            if not has_activatable_slot:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No time slots available for today. The remaining slot is more than 30 minutes past its start time."
                )

    clinic.is_active = is_active
    await db.commit()

    return {
        "message": f"Clinic {'activated' if is_active else 'deactivated'}",
        "is_active": is_active
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
        if last_slot_end is not None:
            now = datetime.now()
            current_time_decimal = now.hour + now.minute / 60.0
            auto_offline_time = last_slot_end - (15 / 60.0)
            if current_time_decimal >= auto_offline_time:
                clinic.is_active = False
                await db.commit()

    return {"is_active": clinic.is_active}

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

    # Blocking Check: Ensure current time is >= slot start time
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
            slots = _load_slots(record.slots)
            if slot_index < len(slots):
                slot_start = slots[slot_index].get("time_range", [0, 0])[0]
                now = datetime.now()
                current_time_decimal = now.hour + now.minute / 60.0
                if current_time_decimal < slot_start:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"Serving cannot start until the official slot start time ({int(slot_start)}:00)."
                    )

    # Update status to serving
    appointment.status = "serving"
    if hasattr(appointment, "notification_stage"):
        appointment.notification_stage = "serving"
    await _send_queue_notifications(clinic_id, db)
    await db.commit()

    return {
        "message": "Patient is now being served",
        "appointment": {
            "id": appointment.id,
            "token": appointment.appointment_token,
            "patient_name": appointment.patient_name,
            "patient_email": getattr(appointment, "patient_email", ""),
            "patient_phone": appointment.patient_phone,
            "status": "serving"
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
    
    # Calculate wait time in minutes
    from datetime import timezone
    served_at = appointment.created_at
    if served_at.tzinfo is None:
        served_at = served_at.replace(tzinfo=timezone.utc)
    finished_at = datetime.now(timezone.utc)
    wait_time = int((finished_at - served_at).total_seconds() / 60)

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
        outcome="served",
        served=True,  # Patient was served (normally or after push)
        push_count=push_count  # Track how many times they were pushed
    )
    db.add(completed)
    
    # Delete from the appropriate table
    await db.delete(appointment)
    await db.commit()

    # Queue order changed; notify next patients if needed.
    await _send_queue_notifications(clinic_id, db)
    await db.commit()

    # Auto-add to reports table for diagnostic/scanning centers (online patients only)
    if source == "online":
        try:
            from app.database.models import Clinic
            clinic_result = await db.execute(
                select(Clinic).where(Clinic.clinic_id == clinic_id)
            )
            clinic = clinic_result.scalar_one_or_none()

            if clinic:
                # Check if clinic is diagnostic or scanning center
                categories = clinic.categories or []
                valid_categories = ["diagnostic_center", "scanning_center", "diagnostic", "scanning", "lab", "x-ray", "mri", "ct_scan"]
                is_diagnostic = any(cat in valid_categories for cat in categories)

                logger.info(f"Report check: clinic_id={clinic_id}, categories={categories}, is_diagnostic={is_diagnostic}, source={source}")

                if is_diagnostic:
                    # Add patient to reports table
                    from app.routers.patient_reports import auto_add_patient_to_reports

                    patient_id = getattr(appointment, 'patient_id', f"online-{appointment.id}")
                    logger.info(f"Adding to reports: patient_id={patient_id}, patient_name={appointment.patient_name}")

                    result = await auto_add_patient_to_reports(
                        patient_id=patient_id,
                        clinic_id=clinic_id,
                        patient_name=appointment.patient_name,
                        patient_email=getattr(appointment, 'patient_email', ""),
                        patient_phone=appointment.patient_phone,
                        db=db
                    )
                    logger.info(f"Auto-add to reports result: {result}")
                    if not result.get("added"):
                        logger.warning(f"Patient not added to reports: {result.get('message')}")
                else:
                    logger.info(f"Skipping reports - clinic is not diagnostic/scanning center")
            else:
                logger.warning(f"Clinic not found for reports: {clinic_id}")
        except Exception as e:
            logger.error(f"Failed to auto-add patient to reports: {e}", exc_info=True)

    return {
        "message": "Patient marked as served and moved to history",
        "completed": {
            "token": completed.appointment_token,
            "patient_name": completed.patient_name,
            "served_at": completed.served_at,
            "finished_at": completed.finished_at,
            "wait_time_minutes": completed.wait_time_minutes
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

    if not all([clinic_id, appointment_id]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing clinic_id or appointment_id"
        )

    model = QRAppointment if source == "walkin" else Appointment

    # Get the appointment to skip
    result = await db.execute(
        select(model).where(
            model.id == appointment_id,
            model.clinic_id == clinic_id
        )
    )
    skipped_appointment = result.scalar_one_or_none()

    if not skipped_appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found"
        )

    # Get all appointments for this clinic ordered by queue_position
    result = await db.execute(
        select(model).where(
            model.clinic_id == clinic_id
        ).order_by(model.queue_position)
    )
    all_appointments = result.scalars().all()

    if len(all_appointments) <= 1:
        # Only one patient, nothing to skip
        return {
            "message": "Only one patient in queue, cannot skip",
            "skipped_patient": {
                "id": skipped_appointment.id,
                "token": skipped_appointment.appointment_token,
                "patient_name": skipped_appointment.patient_name,
                "position": 1
            }
        }

    # Initialize queue positions if not set
    for idx, apt in enumerate(all_appointments):
        if apt.queue_position is None:
            apt.queue_position = idx + 1

    # Find the current position of the appointment to skip
    current_position = skipped_appointment.queue_position

    # If already at the end, nothing to skip
    if current_position >= len(all_appointments):
        return {
            "message": "Patient already at end of queue",
            "skipped_patient": {
                "id": skipped_appointment.id,
                "token": skipped_appointment.appointment_token,
                "patient_name": skipped_appointment.patient_name,
                "position": current_position
            }
        }

    # Move the skipped patient one position back
    # Swap positions with the next patient
    next_position = current_position + 1

    # Find the patient at the next position
    next_patient = None
    for apt in all_appointments:
        if apt.queue_position == next_position:
            next_patient = apt
            break

    if next_patient:
        # Swap positions
        skipped_appointment.queue_position = next_position
        next_patient.queue_position = current_position

        # Update status to skipped
        skipped_appointment.status = "skipped"

        await db.commit()
        await db.refresh(skipped_appointment)

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
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to find next patient in queue"
        )


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

        return {
            "message": "Patient was in last slot - auto-finished with not_served outcome",
            "action": "auto_finished",
            "outcome": "not_served"
        }

    # Find the next open slot
    next_slot_index = None
    for i in range(current_slot_index + 1, len(slots)):
        if slots[i].get("is_open"):
            next_slot_index = i
            break

    if next_slot_index is None:
        # No more open slots - auto-finish
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

    appointment.slot_id = next_slot_id
    appointment.appointment_token = new_token_label
    appointment.status = "booked"
    appointment.notification_stage = "pending"

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

    return {
        "message": f"Patient pushed to {new_slot_name}",
        "action": "pushed",
        "old_slot_id": current_slot_id,
        "new_slot_id": next_slot_id,
        "new_token": new_token_label,
        "new_position": "end of queue for next slot",
        "email_sent": patient_email is not None
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
        from datetime import datetime
        today = datetime.now().strftime("%Y-%m-%d")
        
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

        appointment_result = await db.execute(
            select(Appointment).where(
                Appointment.clinic_id == active_clinic_id,
                Appointment.date == today
            )
        )
        qr_result = await db.execute(
            select(QRAppointment).where(
                QRAppointment.clinic_id == active_clinic_id,
                QRAppointment.date == today
            )
        )

        combined_queue = []
        for item in appointment_result.scalars().all():
            combined_queue.append({"token": item.appointment_token, "created_at": item.created_at})
        for item in qr_result.scalars().all():
            combined_queue.append({"token": item.appointment_token, "created_at": item.created_at})

        combined_queue.sort(key=lambda item: (_token_number(item["token"]), item["created_at"] or datetime.min))
        patients_ahead = sum(
            1 for item in combined_queue if _token_number(item["token"]) < _token_number(apt.appointment_token)
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
                "status": apt.status
            },
            "status": apt.status or "waiting",
            "patients_ahead": patients_ahead
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
    from datetime import date

    today = date.today().isoformat()  # e.g. "2024-01-15"

    # Determine current slot if not provided
    slot_id = payload.slot_id
    if slot_id is None:
        # Get current time slot
        result = await db.execute(
            select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == payload.clinic_id)
        )
        record = result.scalar_one_or_none()
        if record:
            slots = _load_slots(record.slots)
            current_time_decimal = datetime.now().hour + datetime.now().minute / 60.0
            for idx, slot in enumerate(slots):
                if slot.get("is_open"):
                    start, end = slot.get("time_range", [0, 0])
                    if start <= current_time_decimal < end:
                        slot_id = idx + 1
                        break

            if slot_id is None:
                for idx, slot in enumerate(slots):
                    if slot.get("is_open"):
                        slot_id = idx + 1
                        break

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
        queue_position=total_appointments + 1
    )
    db.add(walkin)
    await db.commit()
    await db.refresh(walkin)

    # Position = total appointments including this patient
    position = total_appointments + 1

    return {
        "token_number": next_token_number,
        "token_label": token_label,
        "position": position,
        "patient_name": payload.patient_name,
        "clinic_id": payload.clinic_id,
        "source": "walkin",
        "slot_id": slot_id
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
        return {"clinic_id": clinic_id, "slots": [], "slot": [], "last_slot_change_date": None}

    import json
    slots = record.slots
    if isinstance(slots, str):
        slots = json.loads(slots)

    # Handle slot array
    slot_array = record.slot or []
    if isinstance(slot_array, str):
        slot_array = json.loads(slot_array) if slot_array else []

    # Calculate when they can next modify slots
    can_modify_next = None
    if record.last_slot_change_date:
        if record.last_slot_change_date.tzinfo is None:
            record.last_slot_change_date = record.last_slot_change_date.replace(tzinfo=timezone.utc)
        next_modify_date = record.last_slot_change_date + timedelta(days=7)
        can_modify_next = next_modify_date.isoformat()

    return {
        "clinic_id": clinic_id,
        "slots": slots or [],
        "slot": slot_array or [],
        "last_slot_change_date": record.last_slot_change_date.isoformat() if record.last_slot_change_date else None,
        "can_modify_next": can_modify_next
    }

@router.post("/clinic/time-slots")
async def add_time_slot(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Add a new time slot to a clinic.
    Creates clinic record if doesn't exist.
    Enforces 7-day cooldown on slot modifications (only when 3 slots exist).
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

    # Get current slot count for cooldown check
    current_slot_count = 0
    if record and record.slots:
        slots = _load_slots(record.slots)
        current_slot_count = len(slots)

    # Check cooldown rule if record exists and has 3 slots
    if record and current_slot_count >= 3:
        can_modify, message = _can_modify_slots(record.last_slot_change_date, current_slot_count)
        if not can_modify:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=message
            )

    new_slot = {
        "slot_name": slot_name,
        "time_range": time_range,
        "is_open": True
    }

    import json
    if not record:
        # Create new record with this slot
        record = ClinicTimeSlot(
            clinic_id=clinic_id,
            slots=[new_slot],
            slot=["close"],  # Initialize slot array with default "close"
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

        # Update last_slot_change_date only if we have 3 slots now
        if len(current_slots) >= 3:
            record.last_slot_change_date = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(record)

    return {
        "message": "Time slot added successfully",
        "clinic_id": clinic_id,
        "slots": record.slots,
        "slot": record.slot,
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
    Enforces 7-day cooldown on structural modifications (only when 3 slots exist).
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

    # Get current slot count for cooldown check
    current_slot_count = len(record.slots)

    # Check if this is a toggle operation (open/close) or structural change
    is_toggle_operation = "is_open" in request or "slot" in request
    is_structural_change = "slot_name" in request or "time_range" in request

    # For structural changes, check cooldown rule (only when 3 slots exist)
    if is_structural_change and current_slot_count >= 3:
        can_modify, message = _can_modify_slots(record.last_slot_change_date, current_slot_count)
        if not can_modify:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=message
            )

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

    # Update last_slot_change_date only for structural changes when we have 3 slots
    if is_structural_change and current_slot_count >= 3:
        record.last_slot_change_date = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(record)

    return {
        "message": "Time slot updated successfully",
        "clinic_id": clinic_id,
        "slots": record.slots,
        "slot": record.slot,
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
    Enforces 7-day cooldown on slot modifications.
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

    # Get current slot count for cooldown check
    current_slot_count = len(record.slots)

    # Check cooldown rule before allowing deletion (only when 3 slots exist)
    if current_slot_count >= 3:
        can_modify, message = _can_modify_slots(record.last_slot_change_date, current_slot_count)
        if not can_modify:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=message
            )

    # Remove slot at index
    import json
    slots = record.slots
    if isinstance(slots, str):
        slots = json.loads(slots)
    slots = list(slots)
    slots.pop(slot_index)
    record.slots = slots

    # Update last_slot_change_date only if we still have 3 slots after deletion
    if len(slots) >= 3:
        record.last_slot_change_date = datetime.now(timezone.utc)

    await db.commit()

    return {
        "message": "Time slot deleted successfully",
        "clinic_id": clinic_id,
        "slots": record.slots,
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


@router.get("/clinic/slot-queue-counts")
async def get_slot_queue_counts(
    clinic_id: str = Query(..., description="Clinic ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get patient counts per time slot for today.
    Returns how many patients are currently waiting in each slot.
    """
    from datetime import datetime

    today = datetime.now().strftime("%Y-%m-%d")

    # Get all appointments for today, grouped by slot_id
    result = await db.execute(
        select(
            Appointment.slot_id,
            func.count(Appointment.id).label('count')
        ).where(
            Appointment.clinic_id == clinic_id,
            Appointment.date == today,
            Appointment.status.in_(["booked", "pending", "serving"])
        ).group_by(Appointment.slot_id)
    )

    slot_counts = {}
    for row in result.all():
        if row.slot_id is not None:
            slot_counts[row.slot_id] = row.count

    return {
        "date": today,
        "clinic_id": clinic_id,
        "slot_counts": slot_counts
    }
