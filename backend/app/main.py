from contextlib import asynccontextmanager
import asyncio
import logging
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, select
from sqlalchemy.exc import DBAPIError
from app.database.db import engine, AsyncSessionLocal
from app.database.models import Base, Appointment, Clinic, ClinicTimeSlot
from app.routers import auth, queue_endpoints, password_reset, admin, feedback, patient_reports
from app.services.email_service import send_queue_alert
import json

# Setup logging for scheduled tasks
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def scheduled_auto_finish_unserved():
    """
    Background task that runs every 60 seconds to auto-finish unserved patients.
    Moves patients to completed_appointments with outcome='not_served'
    when their slot end time has passed and they were neither served nor skipped.
    """
    await asyncio.sleep(10)  # Wait for server to fully start (after pre-slot task)

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

                            # Auto-add to reports table for diagnostic/scanning centers
                            try:
                                from app.database.models import Clinic
                                clinic_result = await db.execute(
                                    select(Clinic).where(Clinic.clinic_id == clinic_id)
                                )
                                clinic = clinic_result.scalar_one_or_none()

                                if clinic:
                                    categories = clinic.categories or []
                                    valid_categories = ["diagnostic_center", "scanning_center", "diagnostic", "scanning", "lab", "x-ray", "mri", "ct_scan"]
                                    is_diagnostic = any(cat in valid_categories for cat in categories)

                                    if is_diagnostic:
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


async def scheduled_pre_slot_notifications():
    """
    Background task that runs every 60 seconds.
    Sends email to positions 1 & 2 at 15 min before their slot starts.
    """
    await asyncio.sleep(5)

    while True:
        try:
            async with AsyncSessionLocal() as db:
                from app.services.email_service import send_queue_alert

                now = datetime.now()
                today = now.strftime("%Y-%m-%d")
                current_time_decimal = now.hour + now.minute / 60.0

                pre_slot_window_start = 15.5
                pre_slot_window_end = 14.5

                clinic_result = await db.execute(
                    select(Appointment.clinic_id).where(
                        Appointment.date == today
                    ).distinct()
                )
                clinic_ids = [r[0] for r in clinic_result.all()]

                notifications_sent = 0

                for clinic_id in clinic_ids:
                    clinic_result = await db.execute(
                        select(Clinic).where(Clinic.clinic_id == clinic_id)
                    )
                    clinic = clinic_result.scalar_one_or_none()
                    if not clinic:
                        continue

                    slot_result = await db.execute(
                        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)
                    )
                    slot_record = slot_result.scalar_one_or_none()
                    if not slot_record:
                        continue

                    slots = slot_record.slots
                    if isinstance(slots, str):
                        slots = json.loads(slots)

                    apt_result = await db.execute(
                        select(Appointment).where(
                            Appointment.clinic_id == clinic_id,
                            Appointment.date == today,
                            Appointment.status.in_(["booked", "pending"])
                        ).order_by(Appointment.id)
                    )
                    appointments = apt_result.scalars().all()

                    if len(appointments) == 0:
                        continue

                    # Notify positions 1 & 2 (indices 0 and 1)
                    for i, queued_patient in enumerate(appointments[:2]):
                        if queued_patient.notification_stage == "pre_slot_start":
                            continue

                        slot_id = queued_patient.slot_id
                        if slot_id is None:
                            continue

                        slot_index = int(slot_id) - 1
                        if slot_index < 0 or slot_index >= len(slots):
                            continue

                        slot = slots[slot_index]
                        if not slot.get("is_open"):
                            continue

                        slot_start = slot.get("time_range", [0, 0])[0]
                        minutes_before_slot = (slot_start - current_time_decimal) * 60

                        if pre_slot_window_end <= minutes_before_slot <= pre_slot_window_start:
                            patient_email = (queued_patient.patient_email or "").strip()
                            if patient_email:
                                email_sent = send_queue_alert(
                                    patient_email,
                                    queued_patient.patient_name,
                                    clinic.clinic_name,
                                    "pre_slot_start",
                                    token_number=queued_patient.appointment_token,
                                    doctor_name=queued_patient.doctor_name or (clinic.doctor_name if clinic else ""),
                                    clinic_location=clinic.address if clinic else "",
                                    latitude=clinic.latitude if clinic else None,
                                    longitude=clinic.longitude if clinic else None,
                                )
                                if email_sent:
                                    queued_patient.notification_stage = "pre_slot_start"
                                    await db.commit()
                                    notifications_sent += 1
                                    logger.info(
                                        "Pre-slot notification sent to %s for clinic %s",
                                        patient_email, clinic_id
                                    )

                if notifications_sent > 0:
                    logger.info(f"Scheduled task: Sent {notifications_sent} pre-slot notifications")

        except Exception as e:
            logger.error(f"Error in scheduled pre-slot notifications: {e}")

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
            "ADD COLUMN IF NOT EXISTS slot_id INTEGER"
        )
        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS push_count INTEGER DEFAULT 0"
        )
        await safe_exec(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS queue_position INTEGER"
        )

        await safe_exec(
            "ALTER TABLE qr_appointments "
            "ADD COLUMN IF NOT EXISTS slot_id INTEGER"
        )
        await safe_exec(
            "ALTER TABLE qr_appointments "
            "ADD COLUMN IF NOT EXISTS queue_position INTEGER"
        )

        await safe_exec(
            "ALTER TABLE completed_appointments "
            "ADD COLUMN IF NOT EXISTS slot_id INTEGER"
        )
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
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS specialization VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS experience VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS qualifications VARCHAR")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS has_pinned_location BOOLEAN DEFAULT FALSE")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS booking_cutoff_minutes INTEGER DEFAULT 15")
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE")

        await safe_exec("ALTER TABLE clinic_time_slots ADD COLUMN IF NOT EXISTS daily_toggle_counts JSON DEFAULT '[]'")
        await safe_exec("ALTER TABLE clinic_time_slots ADD COLUMN IF NOT EXISTS last_toggle_date TIMESTAMP")

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
                report_type VARCHAR,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

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
                report_type VARCHAR,
                completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

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

        # Insert admin accounts
        from app.database.models import Admin
        from datetime import datetime, timezone

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
    
    # Start background scheduled tasks
    pre_slot_task = asyncio.create_task(scheduled_pre_slot_notifications())
    auto_finish_task = asyncio.create_task(scheduled_auto_finish_unserved())
    logger.info("Started scheduled background tasks (pre-slot + auto-finish)")

    yield

    # Cleanup on shutdown
    pre_slot_task.cancel()
    auto_finish_task.cancel()
    try:
        await pre_slot_task
    except asyncio.CancelledError:
        pass
    try:
        await auto_finish_task
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

app.include_router(auth.router)
app.include_router(queue_endpoints.router)
app.include_router(password_reset.router)
app.include_router(admin.router)
app.include_router(feedback.router)
app.include_router(patient_reports.router)
app.include_router(auth.router, prefix="/api")
app.include_router(queue_endpoints.router, prefix="/api")
app.include_router(password_reset.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(patient_reports.router, prefix="/api")

@app.get("/")
async def root():
    return {"message": "Clinic Authentication API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
