from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import Appointment, ClinicTimeSlot, DoctorSession, QRAppointment

CLINIC_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
ACTIVE_STATUSES = ["booked", "pending", "serving", "skipped"]


def clinic_now() -> datetime:
    return datetime.now(CLINIC_TIMEZONE)


def today() -> str:
    return clinic_now().strftime("%Y-%m-%d")


def parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def load_json_list(value: Any) -> list:
    if isinstance(value, str):
        return json.loads(value) if value else []
    return list(value or [])


def delay_payload_from_slot(slot: dict) -> dict:
    ends_at = parse_dt(slot.get("delay_ends_at"))
    minutes = int(slot.get("delay_minutes") or 0)
    is_active = minutes > 0
    is_countdown_active = bool(minutes > 0 and ends_at and ends_at > datetime.now(timezone.utc))
    return {
        "delay_minutes": minutes if is_active else 0,
        "delay_started_at": slot.get("delay_started_at") if is_active else None,
        "delay_ends_at": slot.get("delay_ends_at") if is_active else None,
        "delay_original_start_time": slot.get("delay_original_start_time") if is_active else None,
        "delay_updated_start_time": slot.get("delay_updated_start_time") if is_active else None,
        "delay_version": int(slot.get("delay_version") or 0),
        "is_delay_active": is_active,
        "is_delay_countdown_active": is_countdown_active,
    }


async def clear_session_delay(db: AsyncSession, clinic_id: str, session_id: int, *, cancel_jobs: bool = True) -> bool:
    slot_result = await db.execute(select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id))
    slot_record = slot_result.scalar_one_or_none()
    changed = False
    if slot_record:
        slots = load_json_list(slot_record.slots)
        slot_delays = load_json_list(getattr(slot_record, "slot_delays", []))
        slot_index = session_id - 1
        if 0 <= slot_index < len(slots):
            slot = slots[slot_index]
            if int(slot.get("delay_minutes") or 0) > 0 or slot.get("status_override") == "delayed":
                slot["delay_minutes"] = 0
                for key in (
                    "delay_started_at",
                    "delay_ends_at",
                    "delay_original_start_time",
                    "delay_updated_start_time",
                ):
                    slot.pop(key, None)
                if slot.get("status_override") == "delayed":
                    slot.pop("status_override", None)
                while len(slot_delays) <= slot_index:
                    slot_delays.append(0)
                slot_delays[slot_index] = 0
                slot_record.slots = slots
                slot_record.slot_delays = slot_delays
                slot_record.last_slot_change_date = datetime.now(timezone.utc)
                changed = True

    session_result = await db.execute(
        select(DoctorSession).where(
            DoctorSession.clinic_id == clinic_id,
            DoctorSession.slot_id == session_id,
            DoctorSession.session_date == today(),
        )
    )
    doctor_session = session_result.scalar_one_or_none()
    if doctor_session and (doctor_session.delay_minutes or doctor_session.status == "delayed"):
        doctor_session.delay_minutes = 0
        doctor_session.delay_started_at = None
        doctor_session.delay_ends_at = None
        doctor_session.delay_original_start_time = None
        doctor_session.delay_updated_start_time = None
        doctor_session.status = "ongoing" if doctor_session.is_active else "available"
        changed = True

    for model in (Appointment, QRAppointment):
        result = await db.execute(
            select(model).where(
                model.clinic_id == clinic_id,
                model.date == today(),
                model.slot_id == session_id,
                model.status.in_(ACTIVE_STATUSES),
            )
        )
        for apt in result.scalars().all():
            if getattr(apt, "doctor_delay", None):
                apt.doctor_delay = None
                changed = True

    return changed


async def scheduled_delay_jobs() -> None:
    while True:
        await asyncio.sleep(3600)
