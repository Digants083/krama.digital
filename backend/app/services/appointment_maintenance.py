import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, select

from app.database.db import AsyncSessionLocal
from app.database.models import Appointment, CompletedAppointment, QRAppointment

logger = logging.getLogger(__name__)

CLINIC_TIMEZONE = timezone(timedelta(hours=5, minutes=30))


def clinic_now() -> datetime:
    return datetime.now(CLINIC_TIMEZONE)


def clinic_today_str() -> str:
    return clinic_now().strftime("%Y-%m-%d")


async def check_appointment_dates(log_details: bool = True) -> dict:
    """Return a quick diagnostic summary for appointment dates."""
    async with AsyncSessionLocal() as db:
        date_result = await db.execute(select(Appointment.date).distinct())
        dates = list(date_result.scalars().all())

        today = clinic_today_str()
        yesterday = (clinic_now() - timedelta(days=1)).strftime("%Y-%m-%d")

        sample_result = await db.execute(select(Appointment).limit(10))
        sample_appointments = list(sample_result.scalars().all())

    summary = {
        "dates": dates,
        "today": today,
        "yesterday": yesterday,
        "sample_count": len(sample_appointments),
    }

    if log_details:
        logger.info("Appointment dates in table: %s", dates)
        logger.info("Clinic today: %s, yesterday: %s", today, yesterday)
        logger.info("Appointment date check sampled %s rows", len(sample_appointments))

    return summary


async def cleanup_old_appointments(delete_completed_before_yesterday: bool = False) -> int:
    """Move appointments from previous days into completed_appointments as not_served."""
    today = clinic_today_str()
    cleaned_count = 0

    async with AsyncSessionLocal() as db:
        online_result = await db.execute(
            select(Appointment).where(
                and_(
                    Appointment.date != today,
                    Appointment.status.notin_(["completed", "not_served"]),
                )
            )
        )
        online_appointments = list(online_result.scalars().all())

        qr_result = await db.execute(
            select(QRAppointment).where(
                and_(
                    QRAppointment.date != today,
                    QRAppointment.status.notin_(["completed", "not_served"]),
                )
            )
        )
        qr_appointments = list(qr_result.scalars().all())

        for apt in online_appointments:
            db.add(
                CompletedAppointment(
                    appointment_token=apt.appointment_token,
                    clinic_id=apt.clinic_id,
                    patient_id=getattr(apt, "patient_id", f"online-{apt.id}"),
                    patient_name=apt.patient_name,
                    patient_phone=apt.patient_phone,
                    patient_email=getattr(apt, "patient_email", ""),
                    doctor_name=getattr(apt, "doctor_name", ""),
                    date=apt.date,
                    time=getattr(apt, "time", ""),
                    slot_id=getattr(apt, "slot_id", None),
                    status="completed",
                    outcome="not_served",
                    served=False,
                    wait_time_minutes=0,
                    served_at=clinic_now(),
                )
            )
            await db.delete(apt)
            cleaned_count += 1

        for apt in qr_appointments:
            db.add(
                CompletedAppointment(
                    appointment_token=apt.appointment_token,
                    clinic_id=apt.clinic_id,
                    patient_id=getattr(apt, "patient_id", f"qr-{apt.id}"),
                    patient_name=apt.patient_name,
                    patient_phone=apt.patient_phone,
                    patient_email=getattr(apt, "patient_email", ""),
                    doctor_name=getattr(apt, "doctor_name", ""),
                    date=apt.date,
                    time=getattr(apt, "time", ""),
                    slot_id=getattr(apt, "slot_id", None),
                    status="completed",
                    outcome="not_served",
                    served=False,
                    wait_time_minutes=0,
                    served_at=clinic_now(),
                )
            )
            await db.delete(apt)
            cleaned_count += 1

        if delete_completed_before_yesterday:
            yesterday = (clinic_now() - timedelta(days=1)).strftime("%Y-%m-%d")
            await db.execute(delete(CompletedAppointment).where(CompletedAppointment.date < yesterday))

        await db.commit()

    logger.info("Cleaned up %s old appointments", cleaned_count)
    return cleaned_count
