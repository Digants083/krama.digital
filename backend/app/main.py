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
from app.routers import auth, queue_endpoints, password_reset, admin
from app.services.email_service import send_queue_alert
import json

# Setup logging for scheduled tasks
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def scheduled_pre_slot_notifications():
    """
    Background task that runs every 60 seconds to check for pre-slot notifications.
    Automatically sends email to first patients 10 minutes before their slot starts.
    """
    await asyncio.sleep(5)  # Wait for server to fully start
    
    while True:
        try:
            async with AsyncSessionLocal() as db:
                now = datetime.now()
                today = now.strftime("%Y-%m-%d")
                current_time_decimal = now.hour + now.minute / 60.0
                
                # Window: 10 minutes before slot start (with 30-second buffer)
                pre_slot_window_start = 10.5  # ~10.5 minutes before
                pre_slot_window_end = 9.5     # ~9.5 minutes before
                
                # Get all clinics with appointments today
                clinic_result = await db.execute(
                    select(Appointment.clinic_id).where(
                        Appointment.date == today
                    ).distinct()
                )
                clinic_ids = [r[0] for r in clinic_result.all()]
                
                notifications_sent = 0
                
                for clinic_id in clinic_ids:
                    # Get clinic info
                    clinic_result = await db.execute(
                        select(Clinic).where(Clinic.clinic_id == clinic_id)
                    )
                    clinic = clinic_result.scalar_one_or_none()
                    if not clinic:
                        continue
                        
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
                    
                    # Find first patient in queue for this clinic
                    apt_result = await db.execute(
                        select(Appointment).where(
                            Appointment.clinic_id == clinic_id,
                            Appointment.date == today,
                            Appointment.status.in_(["booked", "pending"])
                        ).order_by(Appointment.id)
                    )
                    appointments = apt_result.scalars().all()
                    
                    if not appointments:
                        continue
                        
                    first_patient = appointments[0]
                    
                    # Skip if already notified at later stages
                    if first_patient.notification_stage in ["pre_slot_start", "immediate", "serving", "reach_auto"]:
                        continue
                        
                    # Get slot start time for first patient
                    slot_id = first_patient.slot_id
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
                    
                    # Check if we're in the 10-minute window before slot starts
                    if pre_slot_window_end <= minutes_before_slot <= pre_slot_window_start:
                        patient_email = (first_patient.patient_email or "").strip()
                        if patient_email:
                            email_sent = send_queue_alert(
                                patient_email,
                                first_patient.patient_name,
                                clinic.clinic_name,
                                "pre_slot_start",
                            )
                            if email_sent:
                                first_patient.notification_stage = "pre_slot_start"
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
        
        # Wait for 60 seconds before next check
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
            "ALTER TABLE qr_appointments "
            "ADD COLUMN IF NOT EXISTS slot_id INTEGER"
        )
        
        await safe_exec("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS category VARCHAR")
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
        
        await safe_exec("ALTER TABLE pending_clinic_registrations ADD COLUMN IF NOT EXISTS category VARCHAR")
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
    
    # Start background scheduled task
    task = asyncio.create_task(scheduled_pre_slot_notifications())
    logger.info("Started scheduled pre-slot notification task")
    
    yield
    
    # Cleanup on shutdown
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        logger.info("Scheduled task cancelled")

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

@app.get("/")
async def root():
    return {"message": "Clinic Authentication API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
