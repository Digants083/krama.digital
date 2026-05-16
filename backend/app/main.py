from contextlib import asynccontextmanager
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, select
from sqlalchemy.exc import DBAPIError
from app.compat import install_starlette_router_compat
from app.database.db import engine, AsyncSessionLocal
from app.database.models import Base, Appointment, Clinic, ClinicTimeSlot
from app.database.schema_checks import ensure_required_schema

install_starlette_router_compat()

from app.routers import auth, queue_endpoints, password_reset, admin, feedback, patient_reports, patient_history, sessions
from app.services.appointment_maintenance import check_appointment_dates, cleanup_old_appointments
import json

# Setup logging for scheduled tasks
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
CLINIC_TIMEZONE = timezone(timedelta(hours=5, minutes=30))


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
        try:
            async with AsyncSessionLocal() as db:
                now = datetime.now(CLINIC_TIMEZONE)
                current_time_decimal = now.hour + now.minute / 60.0

                clinic_result = await db.execute(
                    select(Clinic).where(Clinic.is_active == True)
                )
                active_clinics = clinic_result.scalars().all()

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

        await asyncio.sleep(60)


async def scheduled_auto_finish_unserved():
    """
    Background task that runs every 60 seconds to auto-finish unserved patients.
    Moves patients to completed_appointments with outcome='not_served'
    when their slot end time has passed and they were neither served nor skipped.
    """
    await asyncio.sleep(10)  # Wait for server to fully start.

    while True:
        try:
            async with AsyncSessionLocal() as db:
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

                auto_finished = 0

                for clinic_id in clinic_ids:
                    # Get time slots for this clinic
                    slot_result = await db.execute(
                        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
                    )
                    slot_record = slot_result.scalar_one_or_none()
                    if not slot_record:
                        continue

                    slots = slot_record.slots
                    if isinstance(slots, str):
                        slots = json.loads(slots)

                    # Get all appointments still active (booked, pending, serving)
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

                        # Check if slot end time has passed
                        if current_time_decimal >= slot_end:
                            from datetime import timezone
                            from app.database.models import CompletedAppointment

                            served_at = appointment.created_at
                            if served_at.tzinfo is None:
                                served_at = served_at.replace(tzinfo=timezone.utc)
                            finished_at = datetime.now(timezone.utc)
                            wait_time = int((finished_at - served_at).total_seconds() / 60)

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
                                served=False,  # Not served - auto-finished
                                push_count=getattr(appointment, 'push_count', 0)  # Keep their push count
                            )
                            db.add(completed)
                            await db.delete(appointment)
                            await db.commit()

                            # Auto-add to reports table for every clinic.
                            try:
                                from app.routers.patient_reports import auto_add_patient_to_reports
                                result = await auto_add_patient_to_reports(
                                    patient_id=getattr(appointment, 'patient_id', f"auto-{appointment.id}"),
                                    clinic_id=clinic_id,
                                    patient_name=appointment.patient_name,
                                    patient_email=getattr(appointment, 'patient_email', ""),
                                    patient_phone=appointment.patient_phone,
                                    db=db
                                )
                                logger.info(f"Auto-add to reports result for auto-finished patient: {result}")
                            except Exception as e:
                                logger.error(f"Failed to auto-add auto-finished patient to reports: {e}", exc_info=True)

                            auto_finished += 1
                            logger.info(
                                "Auto-finished unserved patient %s (token %s) for clinic %s",
                                appointment.patient_name,
                                appointment.appointment_token,
                                clinic_id
                            )

                if auto_finished > 0:
                    logger.info(f"Scheduled task: Auto-finished {auto_finished} unserved patients")

        except Exception as e:
            logger.error(f"Error in scheduled auto-finish task: {e}")

        # Wait for 60 seconds before next check
        await asyncio.sleep(60)


async def scheduled_midnight_cleanup():
    """
    Background task that runs at midnight (12 AM) to:
    1. Clean up old appointments from previous days - mark as not_served
    2. Delete old completed records (keep only today and future)
    """
    await asyncio.sleep(10)

    while True:
        try:
            now = datetime.now()

            # Check if it's midnight (between 00:00 and 00:01)
            if now.hour == 0 and now.minute == 0:
                print(f"[Midnight Cleanup] Running cleanup for {now.strftime('%Y-%m-%d')}...")
                cleaned_count = await cleanup_old_appointments(delete_completed_before_yesterday=True)
                print(f"[Midnight Cleanup] Cleaned up {cleaned_count} old appointments")
                print("[Midnight Cleanup] Done!")

            # Check every minute
            await asyncio.sleep(60)

        except Exception as e:
            logger.error(f"Error in scheduled midnight cleanup: {e}")
            await asyncio.sleep(60)


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
        await safe_exec("ALTER TABLE completed_appointments ADD COLUMN IF NOT EXISTS session_id INTEGER")
        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP"
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

        # Recreate admin table with double OTP structure
        await safe_exec("DROP TABLE IF EXISTS admins CASCADE")
        await safe_exec("""
            CREATE TABLE admins (
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

        # Check if admins already exist
        admin_check = await conn.execute(text("SELECT COUNT(*) FROM admins"))
        admin_count = admin_check.scalar()

        if admin_count == 0:
            # Insert admin accounts using raw SQL
            await conn.execute(
                text("""
                    INSERT INTO admins (username, email, confirmation_email)
                    VALUES
                    ('admin1', 'diganths083@gmail.com', 'digitalkrama@gmail.com'),
                    ('admin2', 'yashavanthb28@gmail.com', 'digitalkrama@gmail.com')
                """)
            )
            logger.info("Created admin accounts: admin1 and admin2")

        await ensure_required_schema(conn)

    # Start background scheduled tasks
    midnight_cleanup_task = asyncio.create_task(scheduled_midnight_cleanup())
    auto_stop_task = asyncio.create_task(scheduled_auto_stop_clinics())
    logger.info("Started scheduled background tasks (midnight cleanup + auto-stop)")

    # Run appointment maintenance on startup/restart
    try:
        await check_appointment_dates()
        await cleanup_old_appointments()
    except Exception as e:
        print(f"Startup cleanup error (non-fatal): {e}")

    yield

    # Cleanup on shutdown
    midnight_cleanup_task.cancel()
    auto_stop_task.cancel()
    try:
        await midnight_cleanup_task
    except asyncio.CancelledError:
        pass
    try:
        await auto_stop_task
    except asyncio.CancelledError:
        pass
    logger.info("Scheduled tasks cancelled")

app = FastAPI(title="Clinic Authentication API", version="1.0.0", lifespan=lifespan)

# CORS middleware - allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
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
app.include_router(sessions.router, prefix="/api")

@app.get("/")
async def root():
    return {"message": "Clinic Authentication API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
