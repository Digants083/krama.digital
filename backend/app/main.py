from contextlib import asynccontextmanager
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, select
from sqlalchemy.exc import DBAPIError
from app.compat import install_starlette_router_compat
from app.config import (
    admin_seeds,
    background_jobs_enabled,
    cors_allowed_origins,
    scheduler_active_poll_seconds,
    scheduler_idle_poll_seconds,
)
from app.database.db import engine, AsyncSessionLocal
from app.database.models import Base, Clinic, ClinicTimeSlot
from app.database.schema_checks import ensure_required_schema

install_starlette_router_compat()

from app.routers import ai_transcription, auth, queue_endpoints, password_reset, admin, feedback, patient_reports, patient_history, patient_health, sessions, billing, patient_reminders, ehr
from app.services.appointment_maintenance import cleanup_old_appointments
from app.services.delay_jobs import scheduled_delay_jobs
from app.services.gpu_instance import monitor_gpu_idle_shutdown
from app.services import realtime
import json

# Setup logging for scheduled tasks
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
CLINIC_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
SCHEDULER_ACTIVE_POLL_SECONDS = scheduler_active_poll_seconds()
SCHEDULER_IDLE_POLL_SECONDS = scheduler_idle_poll_seconds()


def _load_slots(raw_slots):
    slots = raw_slots
    if isinstance(slots, str):
        slots = json.loads(slots)
    return list(slots or [])


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


def _last_available_slot_end(slots: list, slot_status: list):
    last_end = None
    for index, slot in enumerate(slots):
        if not isinstance(slot, dict) or not _is_slot_available(slot, slot_status, index):
            continue
        time_range = slot.get("time_range", [0, 0])
        if len(time_range) < 2:
            continue
        end_time = time_range[1]
        if last_end is None or end_time > last_end:
            last_end = end_time
    return last_end


def _close_slots(slots: list, slot_status: list):
    while len(slot_status) < len(slots):
        slot_status.append("close")

    for index, slot in enumerate(slots):
        if isinstance(slot, dict):
            slot["is_open"] = False
        slot_status[index] = "close"


async def scheduled_auto_stop_clinics():
    """
    Background task that turns live clinics offline 15 minutes before
    their last available slot ends, even when no dashboard tab is open.
    """
    await asyncio.sleep(10)

    while True:
        sleep_seconds = SCHEDULER_IDLE_POLL_SECONDS
        try:
            async with AsyncSessionLocal() as db:
                now = datetime.now(CLINIC_TIMEZONE)
                current_time_decimal = now.hour + now.minute / 60.0

                clinic_result = await db.execute(
                    select(Clinic).where(Clinic.is_active == True)
                )
                active_clinics = clinic_result.scalars().all()
                sleep_seconds = (
                    SCHEDULER_ACTIVE_POLL_SECONDS if active_clinics else SCHEDULER_IDLE_POLL_SECONDS
                )

                stopped_count = 0
                for clinic in active_clinics:
                    slot_result = await db.execute(
                        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic.clinic_id)
                    )
                    slot_record = slot_result.scalar_one_or_none()
                    if not slot_record:
                        continue

                    slots = _load_slots(slot_record.slots)
                    slot_status = _load_slot_status(slot_record.slot)
                    last_end = _last_available_slot_end(slots, slot_status)
                    should_stop = last_end is None
                    if last_end is not None:
                        auto_offline_time = last_end - (15 / 60.0)
                        should_stop = current_time_decimal >= auto_offline_time

                    if should_stop:
                        clinic.is_active = False
                        _close_slots(slots, slot_status)
                        slot_record.slots = slots
                        slot_record.slot = slot_status
                        slot_record.last_slot_change_date = datetime.now(timezone.utc)
                        stopped_count += 1

                if stopped_count:
                    await db.commit()
                    logger.info("Scheduled task: Auto-stopped %s clinic(s)", stopped_count)

        except Exception as e:
            logger.error(f"Error in scheduled auto-stop clinics task: {e}", exc_info=True)

        await asyncio.sleep(sleep_seconds)


async def scheduled_midnight_cleanup():
    """
    Background task that runs at midnight (12 AM) to:
    1. Clean up old appointments from previous days - mark as not_served
    2. Delete old completed records (keep only today and future)
    """
    await asyncio.sleep(10)

    while True:
        try:
            now = datetime.now(CLINIC_TIMEZONE)
            next_midnight = (now + timedelta(days=1)).replace(
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
            await asyncio.sleep(max(60, (next_midnight - now).total_seconds()))

            run_date = datetime.now(CLINIC_TIMEZONE).strftime("%Y-%m-%d")
            print(f"[Midnight Cleanup] Running cleanup for {run_date}...")
            cleaned_count = await cleanup_old_appointments(delete_completed_before_yesterday=True)
            print(f"[Midnight Cleanup] Cleaned up {cleaned_count} old appointments")
            print("[Midnight Cleanup] Done!")

        except Exception as e:
            logger.error(f"Error in scheduled midnight cleanup: {e}")
            await asyncio.sleep(SCHEDULER_IDLE_POLL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run database migrations
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        async def safe_exec(sql: str):
            try:
                await conn.execute(text(sql))
            except DBAPIError as e:
                print(f"Startup migration skipped: {sql} -> {str(e)}")

        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS notification_stage VARCHAR DEFAULT 'pending'"
        )

        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS last_email_sent_at TIMESTAMP"
        )
        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS patient_email VARCHAR DEFAULT ''"
        )
        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS doctor_name VARCHAR"
        )
        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'online'"
        )
        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS slot_id INTEGER"
        )
        await safe_exec("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS session_id INTEGER")
        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS push_count INTEGER DEFAULT 0"
        )
        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS queue_position INTEGER"
        )
        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS doctor_delay VARCHAR"
        )
        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMP"
        )

        await safe_exec(
            "ALTER TABLE qr_appointments "
            "ADD COLUMN IF NOT EXISTS doctor_name VARCHAR"
        )
        await safe_exec(
            "ALTER TABLE qr_appointments "
            "ADD COLUMN IF NOT EXISTS slot_id INTEGER"
        )
        await safe_exec("ALTER TABLE qr_appointments ADD COLUMN IF NOT EXISTS session_id INTEGER")
        await safe_exec(
            "ALTER TABLE qr_appointments "
            "ADD COLUMN IF NOT EXISTS queue_position INTEGER"
        )
        await safe_exec(
            "ALTER TABLE qr_appointments "
            "ADD COLUMN IF NOT EXISTS doctor_delay VARCHAR"
        )
        await safe_exec(
            "ALTER TABLE qr_appointments "
            "ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMP"
        )

        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS slot_id INTEGER"
        )
        await safe_exec("ALTER TABLE completed_appointments ADD COLUMN IF NOT EXISTS doctor_id VARCHAR")
        await safe_exec("ALTER TABLE completed_appointments ADD COLUMN IF NOT EXISTS session_id INTEGER")
        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMP"
        )
        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP"
        )
        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP"
        )
        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'served'"
        )
        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS wait_time_minutes INTEGER"
        )
        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS service_duration_seconds INTEGER"
        )
        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS consultation_duration_minutes INTEGER"
        )
        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS outcome VARCHAR DEFAULT 'served'"
        )
        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS served BOOLEAN DEFAULT TRUE"
        )
        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS push_count INTEGER DEFAULT 0"
        )
        await safe_exec("ALTER TABLE completed_appointments ADD COLUMN IF NOT EXISTS diagnosis VARCHAR")
        await safe_exec("ALTER TABLE completed_appointments ADD COLUMN IF NOT EXISTS notes VARCHAR")
        await safe_exec("UPDATE completed_appointments SET completed_at = finished_at WHERE completed_at IS NULL AND finished_at IS NOT NULL")
        await safe_exec("UPDATE completed_appointments SET serving_started_at = served_at WHERE serving_started_at IS NULL AND served_at IS NOT NULL")
        await safe_exec(
            """
            UPDATE completed_appointments
            SET consultation_duration_minutes = GREATEST(1, CEIL(service_duration_seconds / 60.0)::INTEGER)
            WHERE consultation_duration_minutes IS NULL
              AND service_duration_seconds IS NOT NULL
              AND service_duration_seconds > 0
            """
        )

        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS category VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS categories JSON")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS street_address VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS road VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS layout VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS section VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS city VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS pincode VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS latitude VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS longitude VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS admin_pinned_latitude VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS admin_pinned_longitude VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS specialization VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS experience VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS qualifications VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS has_pinned_location BOOLEAN DEFAULT FALSE")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS booking_cutoff_minutes INTEGER DEFAULT 15")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS consultation_min_minutes INTEGER DEFAULT 8")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS consultation_max_minutes INTEGER DEFAULT 12")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS manual_stop_date VARCHAR")
        await safe_exec("""
            UPDATE clinics
            SET admin_pinned_latitude = latitude,
                admin_pinned_longitude = longitude,
                latitude = NULL,
                longitude = NULL
            WHERE COALESCE(has_pinned_location, FALSE) = FALSE
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
              AND admin_pinned_latitude IS NULL
              AND admin_pinned_longitude IS NULL
        """)
        await safe_exec("ALTER TABLE patients ADD COLUMN IF NOT EXISTS blood_group VARCHAR")
        await safe_exec("ALTER TABLE otp_verifications ADD COLUMN IF NOT EXISTS user_blood_group VARCHAR")

        await safe_exec("""
            CREATE TABLE IF NOT EXISTS doctors (
                id SERIAL PRIMARY KEY,
                doctor_id VARCHAR UNIQUE NOT NULL,
                clinic_id VARCHAR NOT NULL,
                name VARCHAR NOT NULL,
                specialization VARCHAR,
                experience VARCHAR,
                qualifications VARCHAR,
                available BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_doctors_clinic_id ON doctors(clinic_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_doctors_doctor_id ON doctors(doctor_id)")
        await safe_exec("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS doctor_id VARCHAR")
        await safe_exec("ALTER TABLE qr_appointments ADD COLUMN IF NOT EXISTS doctor_id VARCHAR")

        await safe_exec("""
            CREATE TABLE IF NOT EXISTS doctor_sessions (
                id SERIAL PRIMARY KEY,
                clinic_id VARCHAR NOT NULL,
                doctor_id VARCHAR,
                session_name VARCHAR NOT NULL,
                start_time VARCHAR NOT NULL,
                end_time VARCHAR NOT NULL,
                status VARCHAR DEFAULT 'available',
                delay_minutes INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                slot_id INTEGER,
                session_date VARCHAR,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_doctor_sessions_clinic_id ON doctor_sessions(clinic_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_doctor_sessions_slot_id ON doctor_sessions(slot_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_doctor_sessions_doctor_id ON doctor_sessions(doctor_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_doctor_sessions_eta ON doctor_sessions(clinic_id, slot_id, session_date, status)")
        await safe_exec("ALTER TABLE doctor_sessions ADD COLUMN IF NOT EXISTS delay_started_at TIMESTAMP")
        await safe_exec("ALTER TABLE doctor_sessions ADD COLUMN IF NOT EXISTS delay_ends_at TIMESTAMP")
        await safe_exec("ALTER TABLE doctor_sessions ADD COLUMN IF NOT EXISTS delay_original_start_time VARCHAR")
        await safe_exec("ALTER TABLE doctor_sessions ADD COLUMN IF NOT EXISTS delay_updated_start_time VARCHAR")
        await safe_exec("ALTER TABLE doctor_sessions ADD COLUMN IF NOT EXISTS delay_version INTEGER DEFAULT 0")

        await safe_exec("CREATE INDEX IF NOT EXISTS idx_appointments_queue_eta ON appointments(clinic_id, date, slot_id, status, queue_position)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_appointments_serving_started_at ON appointments(serving_started_at)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_appointments_session_id ON appointments(session_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_qr_appointments_queue_eta ON qr_appointments(clinic_id, date, slot_id, status, queue_position)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_qr_appointments_serving_started_at ON qr_appointments(serving_started_at)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_qr_appointments_session_id ON qr_appointments(session_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_completed_appointments_eta_history ON completed_appointments(clinic_id, date, slot_id, completed_at DESC)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_completed_appointments_serving_started_at ON completed_appointments(serving_started_at)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_completed_appointments_status ON completed_appointments(status)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_completed_appointments_session_id ON completed_appointments(session_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_completed_appointments_doctor_id ON completed_appointments(doctor_id)")


        await safe_exec("ALTER TABLE clinic_time_slots ADD COLUMN IF NOT EXISTS daily_toggle_counts JSON DEFAULT '[]'")
        await safe_exec("ALTER TABLE clinic_time_slots ADD COLUMN IF NOT EXISTS slots JSON DEFAULT '[]'")
        await safe_exec("ALTER TABLE clinic_time_slots ADD COLUMN IF NOT EXISTS slot VARCHAR[] DEFAULT '{}'")
        await safe_exec("ALTER TABLE clinic_time_slots ADD COLUMN IF NOT EXISTS slot_delays JSON DEFAULT '[]'")
        await safe_exec("ALTER TABLE clinic_time_slots ADD COLUMN IF NOT EXISTS last_slot_change_date TIMESTAMP")
        await safe_exec("ALTER TABLE clinic_time_slots ADD COLUMN IF NOT EXISTS last_toggle_date TIMESTAMP")
        await safe_exec("ALTER TABLE clinic_time_slots ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        await safe_exec("ALTER TABLE clinic_time_slots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS category VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS categories JSON")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS street_address VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS road VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS layout VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS section VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS city VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS pincode VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS latitude VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS longitude VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS specialization VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS experience VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS qualifications VARCHAR")
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS doctors JSON DEFAULT '[]'")

        await safe_exec("ALTER TABLE pending_clinic_registrations DROP COLUMN IF EXISTS admin_notes")
        await safe_exec("ALTER TABLE pending_clinic_registrations DROP COLUMN IF EXISTS approved_at")
        await safe_exec("ALTER TABLE pending_clinic_registrations DROP COLUMN IF EXISTS approved_by")

        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS category VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS categories JSON")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS street_address VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS road VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS layout VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS section VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS city VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS pincode VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS latitude VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS longitude VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS specialization VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS experience VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS qualifications VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS doctors JSON DEFAULT '[]'")
        await safe_exec("ALTER TABLE rejected_clinics ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR")
        await safe_exec("ALTER TABLE rejected_clinics DROP COLUMN IF EXISTS rejected_by")

        # Create reports and completed_reports tables
        await safe_exec("""
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                clinic_id VARCHAR NOT NULL,
                patient_id VARCHAR NOT NULL,
                patient_name VARCHAR NOT NULL,
                patient_email VARCHAR NOT NULL,
                patient_phone VARCHAR NOT NULL,
                status VARCHAR DEFAULT 'pending',
                report_pdf VARCHAR,
                report_pdf_filename VARCHAR,
                report_pdf_content_type VARCHAR,
                report_pdf_data BYTEA,
                report_type VARCHAR,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        await safe_exec("ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_pdf VARCHAR")
        await safe_exec("ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_pdf_filename VARCHAR")
        await safe_exec("ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_pdf_content_type VARCHAR")
        await safe_exec("ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_pdf_data BYTEA")
        await safe_exec("ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_type VARCHAR")

        await safe_exec("""
            CREATE TABLE IF NOT EXISTS completed_reports (
                id SERIAL PRIMARY KEY,
                clinic_id VARCHAR NOT NULL,
                patient_id VARCHAR NOT NULL,
                patient_name VARCHAR NOT NULL,
                patient_email VARCHAR NOT NULL,
                patient_phone VARCHAR NOT NULL,
                status BOOLEAN DEFAULT FALSE,
                report_pdf VARCHAR,
                report_pdf_filename VARCHAR,
                report_pdf_content_type VARCHAR,
                report_pdf_data BYTEA,
                report_type VARCHAR,
                completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        await safe_exec("ALTER TABLE completed_reports ADD COLUMN IF NOT EXISTS report_pdf VARCHAR")
        await safe_exec("ALTER TABLE completed_reports ADD COLUMN IF NOT EXISTS report_pdf_filename VARCHAR")
        await safe_exec("ALTER TABLE completed_reports ADD COLUMN IF NOT EXISTS report_pdf_content_type VARCHAR")
        await safe_exec("ALTER TABLE completed_reports ADD COLUMN IF NOT EXISTS report_pdf_data BYTEA")
        await safe_exec("ALTER TABLE completed_reports ADD COLUMN IF NOT EXISTS report_type VARCHAR")

        # Create indexes for reports tables
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_reports_clinic_id ON reports(clinic_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_reports_patient_id ON reports(patient_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_completed_reports_clinic_id ON completed_reports(clinic_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_completed_reports_patient_id ON completed_reports(patient_id)")

        await safe_exec("""
            CREATE TABLE IF NOT EXISTS billing (
                id SERIAL PRIMARY KEY,
                clinic_id VARCHAR NOT NULL,
                record_type VARCHAR DEFAULT 'bill',
                bill_id VARCHAR UNIQUE,
                appointment_id INTEGER,
                patient_name VARCHAR,
                patient_phone VARCHAR,
                token VARCHAR,
                bill_source VARCHAR DEFAULT 'manual',
                items JSON DEFAULT '[]',
                total_amount INTEGER DEFAULT 0,
                payment_mode VARCHAR,
                payment_status VARCHAR DEFAULT 'paid',
                template JSON DEFAULT '{}',
                services JSON DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_billing_clinic_record ON billing(clinic_id, record_type)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_billing_bill_id ON billing(bill_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_billing_appointment_id ON billing(appointment_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_billing_created_at ON billing(created_at DESC)")

        await safe_exec("""
            CREATE TABLE IF NOT EXISTS patient_revisit_reminders (
                id SERIAL PRIMARY KEY,
                clinic_id VARCHAR NOT NULL,
                patient_id VARCHAR,
                patient_name VARCHAR NOT NULL,
                patient_phone VARCHAR,
                patient_email VARCHAR,
                appointment_id INTEGER,
                token VARCHAR,
                reminder_days INTEGER,
                revisit_date VARCHAR NOT NULL,
                status VARCHAR DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_revisit_reminders_clinic_patient ON patient_revisit_reminders(clinic_id, patient_id)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_revisit_reminders_clinic_phone ON patient_revisit_reminders(clinic_id, patient_phone)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_revisit_reminders_revisit_date ON patient_revisit_reminders(revisit_date)")
        await safe_exec("CREATE INDEX IF NOT EXISTS idx_revisit_reminders_status ON patient_revisit_reminders(status)")

        # Keep admin accounts and in-flight OTPs across reloads/restarts. Older
        # code recreated this table on every startup, invalidating otherwise
        # correct OTPs and admin sessions.
        await safe_exec("""
            CREATE TABLE IF NOT EXISTS admins (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) NOT NULL,
                confirmation_email VARCHAR(255) NOT NULL,
                otp_code VARCHAR(10),
                confirmation_otp_code VARCHAR(10),
                otp_expires_at TIMESTAMP,
                confirmation_otp_expires_at TIMESTAMP
            )
        """)
        await safe_exec("ALTER TABLE admins ADD COLUMN IF NOT EXISTS confirmation_email VARCHAR(255)")
        await safe_exec("ALTER TABLE admins ADD COLUMN IF NOT EXISTS otp_code VARCHAR(10)")
        await safe_exec("ALTER TABLE admins ADD COLUMN IF NOT EXISTS confirmation_otp_code VARCHAR(10)")
        await safe_exec("ALTER TABLE admins ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP")
        await safe_exec("ALTER TABLE admins ADD COLUMN IF NOT EXISTS confirmation_otp_expires_at TIMESTAMP")

        # Insert missing admins and keep their configured inboxes synchronized
        # without deleting OTP state or changing account IDs.
        for admin in admin_seeds():
            if not admin.email or not admin.confirmation_email:
                logger.warning("Skipping %s seed: admin email env vars are not fully configured", admin.username)
                continue
            await conn.execute(
                text(
                    "INSERT INTO admins (username, email, confirmation_email) "
                    "VALUES (:username, :email, :confirmation_email) "
                    "ON CONFLICT (username) DO UPDATE SET "
                    "email = EXCLUDED.email, confirmation_email = EXCLUDED.confirmation_email"
                ),
                {
                    "username": admin.username,
                    "email": admin.email,
                    "confirmation_email": admin.confirmation_email,
                },
            )
        logger.info("Admin accounts synchronized: %s", ", ".join(admin.username for admin in admin_seeds()))

        await ensure_required_schema(conn)

    # Start background scheduled tasks
    # EHR generation is a core request worker, not optional maintenance.
    background_tasks = [
        asyncio.create_task(ehr.run_ehr_generation_queue()),
        asyncio.create_task(monitor_gpu_idle_shutdown()),
    ]
    if background_jobs_enabled():
        background_tasks.extend([
            asyncio.create_task(scheduled_midnight_cleanup()),
            asyncio.create_task(scheduled_auto_stop_clinics()),
            asyncio.create_task(scheduled_delay_jobs()),
        ])
        logger.info("Started scheduled background tasks (midnight cleanup + auto-stop + delay jobs + EHR generation queue)")
    else:
        logger.warning("Background maintenance tasks are disabled; the EHR generation queue remains active")

    # Run appointment maintenance on startup/restart
    try:
        await cleanup_old_appointments()
    except Exception as e:
        print(f"Startup cleanup error (non-fatal): {e}")

    yield

    # Cleanup on shutdown
    for task in background_tasks:
        task.cancel()
    for task in background_tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass
    if background_tasks:
        logger.info("Scheduled tasks cancelled")

app = FastAPI(title="Krama API", version="1.0.0", lifespan=lifespan)

# Only configured Krama frontends may call the API from a browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allowed_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(queue_endpoints.router, prefix="/api")
app.include_router(password_reset.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(patient_reports.router, prefix="/api")
app.include_router(patient_history.router, prefix="/api")
app.include_router(patient_health.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(billing.router, prefix="/api")
app.include_router(patient_reminders.router, prefix="/api")
app.include_router(realtime.router, prefix="/api")
app.include_router(ai_transcription.router, prefix="/api")
app.include_router(ehr.router, prefix="/api")

@app.get("/")
async def root():
    return {"message": "Krama API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
