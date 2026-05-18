from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, JSON, ARRAY, LargeBinary
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()

class Clinic(Base):
    __tablename__ = "clinics"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(String, unique=True, index=True, nullable=False)
    clinic_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    category = Column(String, nullable=True)
    categories = Column(JSON, default=list)
    street_address = Column(String, nullable=True)
    road = Column(String, nullable=True)
    layout = Column(String, nullable=True)
    section = Column(String, nullable=True)
    city = Column(String, nullable=True)
    pincode = Column(String, nullable=True)
    address = Column(String, nullable=True)
    latitude = Column(String, nullable=True)
    longitude = Column(String, nullable=True)
    admin_pinned_latitude = Column(String, nullable=True)
    admin_pinned_longitude = Column(String, nullable=True)
    image_urls = Column(JSON, default=list)
    doctor_name = Column(String, nullable=True)
    specialization = Column(String, nullable=True)
    experience = Column(String, nullable=True)
    qualifications = Column(String, nullable=True)
    available = Column(Boolean, default=True)
    start = Column(Integer, nullable=True)
    end = Column(Integer, nullable=True)
    booking_cutoff_minutes = Column(Integer, default=15)
    consultation_min_minutes = Column(Integer, default=8)
    consultation_max_minutes = Column(Integer, default=12)
    is_active = Column(Boolean, default=False)
    manual_stop_date = Column(String, nullable=True)
    has_pinned_location = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ClinicImage(Base):
    __tablename__ = "clinic_images"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(String, unique=True, nullable=False, index=True)  # One row per clinic
    images = Column(JSON, default=list)  # Array of {image_data: "base64...", image_type: "image/jpeg"}
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    blood_group = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    appointment_token = Column(String, nullable=False)
    clinic_id = Column(String, nullable=False)
    patient_id = Column(String, nullable=False)
    patient_name = Column(String, nullable=False)
    patient_email = Column(String, nullable=False)
    patient_phone = Column(String, nullable=False)
    doctor_name = Column(String, nullable=True)
    date = Column(String, nullable=False)
    time = Column(String, nullable=False)
    status = Column(String, default="booked")
    doctor_delay = Column(String, nullable=True)
    notification_stage = Column(String, default="pending")
    last_email_sent_at = Column(DateTime(timezone=True), nullable=True)  # Track when email was actually sent
    serving_started_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    source = Column(String, default="online")
    slot_id = Column(Integer, nullable=True)
    session_id = Column(Integer, nullable=True)
    push_count = Column(Integer, default=0)  # Number of times patient has been pushed to next slot
    queue_position = Column(Integer, nullable=True)  # Position in queue for ordering

class CompletedAppointment(Base):
    """Model for storing completed/served patient history"""
    __tablename__ = "completed_appointments"

    id = Column(Integer, primary_key=True, index=True)
    appointment_token = Column(String, nullable=False)
    clinic_id = Column(String, nullable=False)
    patient_id = Column(String, nullable=False)
    patient_name = Column(String, nullable=False)
    patient_email = Column(String, nullable=False)
    patient_phone = Column(String, nullable=False)
    doctor_name = Column(String, nullable=True)
    doctor_id = Column(String, nullable=True)
    date = Column(String, nullable=False)
    time = Column(String, nullable=False)
    slot_id = Column(Integer, nullable=True)
    session_id = Column(Integer, nullable=True)
    serving_started_at = Column(DateTime(timezone=True), nullable=True)
    served_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default="served")  # served, completed, skipped
    wait_time_minutes = Column(Integer, nullable=True)  # how long they waited
    service_duration_seconds = Column(Integer, nullable=True)
    consultation_duration_minutes = Column(Integer, nullable=True)
    outcome = Column(String, default="served")  # served or not_served
    diagnosis = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    served = Column(Boolean, default=True)  # True if served normally or after push, False if not served
    push_count = Column(Integer, default=0)  # Number of times patient was pushed to next slot

class DoctorSession(Base):
    """Canonical doctor session metadata. Existing slot_id queues map to session_id."""
    __tablename__ = "doctor_sessions"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(String, nullable=False, index=True)
    doctor_id = Column(String, nullable=True)
    session_name = Column(String, nullable=False)
    start_time = Column(String, nullable=False)
    end_time = Column(String, nullable=False)
    status = Column(String, default="available")
    delay_minutes = Column(Integer, default=0)
    delay_started_at = Column(DateTime(timezone=True), nullable=True)
    delay_ends_at = Column(DateTime(timezone=True), nullable=True)
    delay_original_start_time = Column(String, nullable=True)
    delay_updated_start_time = Column(String, nullable=True)
    delay_version = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    slot_id = Column(Integer, nullable=True)
    session_date = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class NotificationJob(Base):
    """Durable notification/reminder jobs that survive server restarts."""
    __tablename__ = "notification_jobs"

    id = Column(Integer, primary_key=True, index=True)
    job_type = Column(String, nullable=False, index=True)
    clinic_id = Column(String, nullable=False, index=True)
    session_id = Column(Integer, nullable=True, index=True)
    recipient_email = Column(String, nullable=True, index=True)
    patient_name = Column(String, nullable=True)
    token_number = Column(String, nullable=True)
    scheduled_for = Column(DateTime(timezone=True), nullable=False, index=True)
    status = Column(String, default="pending", index=True)
    dedupe_key = Column(String, unique=True, nullable=False, index=True)
    payload = Column(JSON, default=dict)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class ClinicTimeSlot(Base):
    """Model for storing clinic operating time slots - one row per clinic with all slots as JSON array"""
    __tablename__ = "clinic_time_slots"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(String, unique=True, nullable=False, index=True)
    slots = Column(JSON, default=list)  # Array of {slot_name, time_range, is_open}
    slot = Column(ARRAY(String), default=list)  # Array of "open"/"close" for each slot
    slot_delays = Column(JSON, default=list)  # Array of delay minutes per slot, e.g. [0, 15, 0]
    last_slot_change_date = Column(DateTime(timezone=True), nullable=True)  # Track when slots were last modified
    daily_toggle_counts = Column(JSON, default=list)  # Array of toggle counts per slot [0, 0, 0] for 3 slots
    last_toggle_date = Column(DateTime(timezone=True), nullable=True)  # Track date of last toggle operation
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class OTPVerification(Base):
    """Model for storing OTP verification codes and pending user data"""
    __tablename__ = "otp_verifications"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    otp_code = Column(String(64), nullable=False)  # SHA256 hash = 64 chars
    is_verified = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime, nullable=False)
    attempt_count = Column(Integer, default=0)

    # Store pending user data (will be moved to Patient table after verification)
    user_name = Column(String(255), nullable=False)
    user_password = Column(String(255), nullable=False)  # Bcrypt hash = ~60 chars
    user_phone = Column(String(50), nullable=False)
    user_blood_group = Column(String(20), nullable=True)

class Review(Base):
    """Model for storing patient reviews for clinics"""
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(String, nullable=False, index=True)
    patient_id = Column(String, nullable=False, index=True)
    patient_name = Column(String, nullable=False)
    rating = Column(Integer, nullable=False)  # 1-5 stars
    review_text = Column(String, nullable=True)
    likes = Column(Integer, default=0)
    dislikes = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ReviewReaction(Base):
    """Track which patients liked/disliked which reviews"""
    __tablename__ = "review_reactions"

    id = Column(Integer, primary_key=True, index=True)
    review_id = Column(Integer, nullable=False, index=True)
    patient_id = Column(String, nullable=False, index=True)
    reaction_type = Column(String, nullable=False)  # 'like' or 'dislike'
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class QRAppointment(Base):
    """Model for QR walk-in appointments - separate from online bookings"""
    __tablename__ = "qr_appointments"

    id = Column(Integer, primary_key=True, index=True)
    appointment_token = Column(String, nullable=False)
    clinic_id = Column(String, nullable=False)
    patient_name = Column(String, nullable=False)
    patient_phone = Column(String, nullable=False)
    doctor_name = Column(String, nullable=True)
    date = Column(String, nullable=False)
    status = Column(String, default="booked")
    doctor_delay = Column(String, nullable=True)
    serving_started_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    slot_id = Column(Integer, nullable=True)
    session_id = Column(Integer, nullable=True)
    queue_position = Column(Integer, nullable=True)  # Position in queue for ordering

class PendingClinicRegistration(Base):
    """Model for storing pending clinic registrations awaiting admin approval"""
    __tablename__ = "pending_clinic_registrations"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(String, unique=True, index=True, nullable=False)
    clinic_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    category = Column(String, nullable=True)
    categories = Column(JSON, default=list)
    street_address = Column(String, nullable=True)
    road = Column(String, nullable=True)
    layout = Column(String, nullable=True)
    section = Column(String, nullable=True)
    city = Column(String, nullable=True)
    pincode = Column(String, nullable=True)
    address = Column(String, nullable=True)
    latitude = Column(String, nullable=True)
    longitude = Column(String, nullable=True)
    doctor_name = Column(String, nullable=True)
    specialization = Column(String, nullable=True)
    experience = Column(String, nullable=True)
    qualifications = Column(String, nullable=True)
    image_urls = Column(JSON, default=list)
    status = Column(String, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Admin(Base):
    """Model for admin users with double OTP authentication"""
    __tablename__ = "admins"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, nullable=False)  # Admin's personal email for OTP
    confirmation_email = Column(String, nullable=False)  # Confirmation email for double OTP
    otp_code = Column(String, nullable=True)  # Current OTP for admin
    confirmation_otp_code = Column(String, nullable=True)  # Current confirmation OTP
    otp_expires_at = Column(DateTime(timezone=True), nullable=True)  # OTP expiration time
    confirmation_otp_expires_at = Column(DateTime(timezone=True), nullable=True)  # Confirmation OTP expiration time

class RejectedClinic(Base):
    """Model for storing rejected clinic registrations"""
    __tablename__ = "rejected_clinics"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(String, unique=True, index=True, nullable=True)
    clinic_name = Column(String, nullable=True)
    email = Column(String, nullable=True)
    password = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    category = Column(String, nullable=True)
    categories = Column(JSON, default=list)
    street_address = Column(String, nullable=True)
    road = Column(String, nullable=True)
    layout = Column(String, nullable=True)
    section = Column(String, nullable=True)
    city = Column(String, nullable=True)
    pincode = Column(String, nullable=True)
    address = Column(String, nullable=True)
    latitude = Column(String, nullable=True)
    longitude = Column(String, nullable=True)
    doctor_name = Column(String, nullable=True)
    specialization = Column(String, nullable=True)
    experience = Column(String, nullable=True)
    qualifications = Column(String, nullable=True)
    image_urls = Column(JSON, default=list)
    rejection_reason = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    rejected_at = Column(DateTime(timezone=True), server_default=func.now())

class Feedback(Base):
    """Model for storing user feedback submissions"""
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    message = Column(String, nullable=False)
    status = Column(String, default="pending")  # pending, approved, rejected
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_by = Column(String, nullable=True)  # admin_id who reviewed

class PatientReport(Base):
    """Model for storing patient reports for clinics"""
    __tablename__ = "patient_reports"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(String, nullable=False, index=True)
    patient_name = Column(String, nullable=False)
    patient_email = Column(String, nullable=False)
    patient_phone = Column(String, nullable=False)
    report_status = Column(String, default="no_report")  # sent, no_report, received
    report_pdf = Column(String, nullable=True)  # Path to PDF file
    report_date = Column(DateTime(timezone=True), server_default=func.now())
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Report(Base):
    """Model for pending reports - patients who need reports"""
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(String, nullable=False, index=True)
    patient_id = Column(String, nullable=False, index=True)
    patient_name = Column(String, nullable=False)
    patient_email = Column(String, nullable=False)
    patient_phone = Column(String, nullable=False)
    status = Column(String, default="pending")  # pending
    report_pdf = Column(String, nullable=True)  # DB reference or legacy path to PDF file
    report_pdf_filename = Column(String, nullable=True)
    report_pdf_content_type = Column(String, nullable=True)
    report_pdf_data = Column(LargeBinary, nullable=True)
    report_type = Column(String, nullable=True)  # sent, collected, no_report
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CompletedReport(Base):
    """Model for completed reports - patients whose reports are processed"""
    __tablename__ = "completed_reports"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(String, nullable=False, index=True)
    patient_id = Column(String, nullable=False, index=True)
    patient_name = Column(String, nullable=False)
    patient_email = Column(String, nullable=False)
    patient_phone = Column(String, nullable=False)
    status = Column(Boolean, default=False)  # true = report provided, false = no report
    report_pdf = Column(String, nullable=True)  # DB reference or legacy path to PDF file
    report_pdf_filename = Column(String, nullable=True)
    report_pdf_content_type = Column(String, nullable=True)
    report_pdf_data = Column(LargeBinary, nullable=True)
    report_type = Column(String, nullable=True)  # sent, collected, no_report
    completed_at = Column(DateTime(timezone=True), server_default=func.now())
