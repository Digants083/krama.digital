from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.db import AsyncSessionLocal
from app.database.models import Appointment, ClinicTimeSlot, DoctorSession, NotificationJob, QRAppointment
from app.services.email_service import send_delay_reminder_email
from app.services.realtime import publish_queue_event

logger = logging.getLogger(__name__)
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


def iso_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def load_json_list(value: Any) -> list:
    if isinstance(value, str):
        return json.loads(value) if value else []
    return list(value or [])


def delay_payload_from_slot(slot: dict) -> dict:
    ends_at = parse_dt(slot.get("delay_ends_at"))
    minutes = int(slot.get("delay_minutes") or 0)
    is_active = bool(minutes > 0 and ends_at and ends_at > datetime.now(timezone.utc))
    return {
        "delay_minutes": minutes if is_active else 0,
        "delay_started_at": slot.get("delay_started_at") if is_active else None,
        "delay_ends_at": slot.get("delay_ends_at") if is_active else None,
        "delay_original_start_time": slot.get("delay_original_start_time") if is_active else None,
        "delay_updated_start_time": slot.get("delay_updated_start_time") if is_active else None,
        "delay_version": int(slot.get("delay_version") or 0),
        "is_delay_active": is_active,
    }


async def cancel_pending_reminders(db: AsyncSession, clinic_id: str, session_id: int) -> int:
    result = await db.execute(
        select(NotificationJob).where(
            NotificationJob.clinic_id == clinic_id,
            NotificationJob.session_id == session_id,
            NotificationJob.job_type == "delay_reminder",
            NotificationJob.status == "pending",
        )
    )
    jobs = result.scalars().all()
    for job in jobs:
        job.status = "cancelled"
        job.updated_at = datetime.now(timezone.utc)
    return len(jobs)


async def schedule_delay_reminders(
    db: AsyncSession,
    clinic_id: str,
    session_id: int,
    delay_version: int,
    delay_ends_at: datetime,
    recipients: list[dict],
    base_payload: dict,
) -> int:
    await cancel_pending_reminders(db, clinic_id, session_id)
    scheduled_for = delay_ends_at - timedelta(minutes=15)
    now = datetime.now(timezone.utc)
    if scheduled_for < now:
        scheduled_for = now

    scheduled_count = 0
    for recipient in recipients:
        email = (recipient.get("patient_email") or "").strip()
        if not email:
            continue
        dedupe_key = f"delay-reminder:{clinic_id}:{session_id}:{delay_version}:{recipient.get('source')}:{recipient.get('id')}"
        existing = await db.execute(select(NotificationJob).where(NotificationJob.dedupe_key == dedupe_key))
        if existing.scalar_one_or_none():
            continue
        db.add(NotificationJob(
            job_type="delay_reminder",
            clinic_id=clinic_id,
            session_id=session_id,
            recipient_email=email,
            patient_name=recipient.get("patient_name") or "Patient",
            token_number=recipient.get("token") or "TBD",
            scheduled_for=scheduled_for,
            status="pending",
            dedupe_key=dedupe_key,
            payload={**base_payload, **recipient},
        ))
        scheduled_count += 1
    return scheduled_count


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

    if cancel_jobs:
        cancelled = await cancel_pending_reminders(db, clinic_id, session_id)
        changed = changed or cancelled > 0

    return changed


async def process_due_notification_jobs(db: AsyncSession) -> int:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(NotificationJob).where(
            NotificationJob.status == "pending",
            NotificationJob.scheduled_for <= now,
        ).order_by(NotificationJob.scheduled_for).limit(100)
    )
    jobs = result.scalars().all()
    sent = 0
    for job in jobs:
        payload = job.payload or {}
        if job.job_type == "delay_reminder" and job.recipient_email:
            ok = send_delay_reminder_email(
                job.recipient_email,
                job.patient_name or payload.get("patient_name") or "Patient",
                payload.get("clinic_name") or "Clinic",
                payload.get("session_name") or "your session",
                payload.get("updated_time") or payload.get("delay_updated_start_time") or "",
                job.token_number or payload.get("token") or "TBD",
            )
            job.status = "sent" if ok else "failed"
            job.sent_at = now if ok else None
            job.updated_at = now
            sent += 1 if ok else 0
    return sent


async def process_expired_delays(db: AsyncSession) -> int:
    slot_result = await db.execute(select(ClinicTimeSlot))
    records = slot_result.scalars().all()
    cleared = 0
    now = datetime.now(timezone.utc)
    for record in records:
        slots = load_json_list(record.slots)
        for index, slot in enumerate(slots):
            delay_ends_at = parse_dt(slot.get("delay_ends_at"))
            if int(slot.get("delay_minutes") or 0) > 0 and delay_ends_at and delay_ends_at <= now:
                if await clear_session_delay(db, record.clinic_id, index + 1, cancel_jobs=False):
                    cleared += 1
                    await publish_queue_event(record.clinic_id, "delay_ended", {"session_id": index + 1})
    return cleared


async def scheduled_delay_jobs() -> None:
    await asyncio.sleep(5)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                cleared = await process_expired_delays(db)
                sent = await process_due_notification_jobs(db)
                if cleared or sent:
                    await db.commit()
                    logger.info("Delay scheduler processed cleared=%s sent=%s", cleared, sent)
        except Exception as exc:
            logger.error("Delay scheduler failed: %s", exc, exc_info=True)
        await asyncio.sleep(5)
