"""
Admin router for managing clinic registrations.
Provides endpoints for viewing, approving, and rejecting pending clinic registrations.
"""
import random
import string
import secrets
import base64
import hashlib
import hmac
import json
import time
import bcrypt
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status, Query, Body, Header
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func, or_

from app.config import admin_data_password_hash, admin_usernames, auth_token_secret
from app.database.db import get_db
from app.database.models import (
    PendingClinicRegistration, Clinic, Admin, ClinicImage, Doctor, Patient,
    CompletedAppointment, ClinicalEncounter, EhrAuditEvent,
)
from app.services.email_service import (
    send_clinic_approval_email,
    send_clinic_rejection_email,
    send_admin_otp_email
)

router = APIRouter(prefix="/admin", tags=["admin"])
ADMIN_SESSION_HOURS = 24
ADMIN_DATA_SESSION_MINUTES = 15


def valid_admin_usernames() -> set[str]:
    return admin_usernames() or {"admin1", "admin2"}


def generate_clinic_id():
    """Generate unique clinic ID like FA23W3"""
    letters = ''.join(random.choices(string.ascii_uppercase, k=2))
    digits = ''.join(random.choices(string.digits, k=2))
    more_letters = ''.join(random.choices(string.ascii_uppercase, k=3))
    return f"{letters}{digits}{more_letters}"


def generate_doctor_id(clinic_id: str):
    return f"{clinic_id}-D{secrets.token_hex(4).upper()}"


def normalize_pending_doctors(pending_reg: PendingClinicRegistration) -> list[dict]:
    doctors = []
    for raw in pending_reg.doctors or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or raw.get("doctor_name") or "").strip()
        if not name:
            continue
        doctors.append({
            "name": name,
            "specialization": str(raw.get("specialization") or "").strip(),
            "experience": str(raw.get("experience") or "").strip(),
            "qualifications": str(raw.get("qualifications") or "").strip(),
        })
    if not doctors and pending_reg.doctor_name:
        doctors.append({
            "name": pending_reg.doctor_name,
            "specialization": pending_reg.specialization or "",
            "experience": pending_reg.experience or "",
            "qualifications": pending_reg.qualifications or "",
        })
    return doctors


def generate_otp():
    """Generate 6-digit OTP"""
    return ''.join(random.choices(string.digits, k=6))


# ============ Admin Authentication Endpoints ============

class SendOtpRequest(BaseModel):
    username: str


class VerifyOtpRequest(BaseModel):
    username: str
    otp_code: str
    confirmation_otp_code: str


class RegistrationLocationRequest(BaseModel):
    latitude: str
    longitude: str


class AdminDataUnlockRequest(BaseModel):
    password: str


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_admin_session(admin_id: str, username: str) -> tuple[str, datetime]:
    now = int(time.time())
    expires_epoch = now + ADMIN_SESSION_HOURS * 60 * 60
    payload = {
        "sub": str(admin_id),
        "username": username,
        "type": "admin",
        "iat": now,
        "exp": expires_epoch,
        "nonce": secrets.token_urlsafe(12),
    }
    payload_part = _b64url_encode(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(auth_token_secret().encode("utf-8"), payload_part.encode("ascii"), hashlib.sha256).digest()
    token = f"{payload_part}.{_b64url_encode(signature)}"
    return token, datetime.fromtimestamp(expires_epoch, timezone.utc)


def invalidate_admin_session(token: str) -> None:
    # Admin tokens are stateless. The browser discards the token on logout and
    # the short, signed expiry is always enforced by require_admin_session.
    return None


def get_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin authentication required"
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin authorization header"
        )
    return token


async def require_admin_session(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    token = get_bearer_token(authorization)
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Admin session is invalid or expired. Please login again.",
    )
    try:
        payload_part, supplied_signature = token.split(".", 1)
        expected_signature = hmac.new(
            auth_token_secret().encode("utf-8"),
            payload_part.encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(_b64url_decode(supplied_signature), expected_signature):
            raise unauthorized
        payload = json.loads(_b64url_decode(payload_part))
        admin_id = str(payload.get("sub") or "")
        username = str(payload.get("username") or "")
        issued_at = int(payload.get("iat") or 0)
        expires_epoch = int(payload.get("exp") or 0)
    except HTTPException:
        raise
    except (ValueError, TypeError, json.JSONDecodeError):
        raise unauthorized

    now = int(time.time())
    if payload.get("type") != "admin" or not admin_id or not username or issued_at > now + 60 or expires_epoch <= now:
        raise unauthorized

    result = await db.execute(select(Admin).where(Admin.id == int(admin_id), Admin.username == username))
    if result.scalar_one_or_none() is None:
        raise unauthorized

    expires_at = datetime.fromtimestamp(expires_epoch, timezone.utc)
    return {
        "token": token,
        "admin_id": admin_id,
        "username": username,
        "expires_at": expires_at,
    }


def create_admin_data_token(admin_session: dict) -> tuple[str, datetime]:
    now = int(time.time())
    expires_epoch = now + ADMIN_DATA_SESSION_MINUTES * 60
    payload = {
        "sub": str(admin_session["admin_id"]),
        "type": "admin_data",
        "iat": now,
        "exp": expires_epoch,
        "nonce": secrets.token_urlsafe(12),
    }
    payload_part = _b64url_encode(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(
        auth_token_secret().encode("utf-8"),
        f"admin-data:{payload_part}".encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{payload_part}.{_b64url_encode(signature)}", datetime.fromtimestamp(expires_epoch, timezone.utc)


async def require_admin_data_session(
    x_admin_data_token: Optional[str] = Header(None, alias="X-Admin-Data-Token"),
    admin_session: dict = Depends(require_admin_session),
) -> dict:
    forbidden = HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Unlock the admin data area again",
    )
    if not x_admin_data_token:
        raise forbidden
    try:
        payload_part, supplied_signature = x_admin_data_token.split(".", 1)
        expected_signature = hmac.new(
            auth_token_secret().encode("utf-8"),
            f"admin-data:{payload_part}".encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(_b64url_decode(supplied_signature), expected_signature):
            raise forbidden
        payload = json.loads(_b64url_decode(payload_part))
        now = int(time.time())
        if (
            payload.get("type") != "admin_data"
            or str(payload.get("sub") or "") != str(admin_session["admin_id"])
            or int(payload.get("iat") or 0) > now + 60
            or int(payload.get("exp") or 0) <= now
        ):
            raise forbidden
    except HTTPException:
        raise
    except (ValueError, TypeError, json.JSONDecodeError):
        raise forbidden
    return admin_session


def _iso(value) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _flatten_learning_json(value, prefix: str = "") -> dict[str, object]:
    flattened: dict[str, object] = {}
    if isinstance(value, dict):
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            if path == "approval" or path.startswith("approval."):
                continue
            flattened.update(_flatten_learning_json(item, path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            path = f"{prefix}[{index}]"
            flattened.update(_flatten_learning_json(item, path))
        if not value and prefix:
            flattened[prefix] = []
    elif prefix:
        flattened[prefix] = value
    return flattened


def _build_learning_changes(generated: dict, approved: dict, limit: int = 250) -> list[dict]:
    generated_fields = _flatten_learning_json(generated)
    approved_fields = _flatten_learning_json(approved)
    changes = []
    for path in sorted(set(generated_fields) | set(approved_fields)):
        before = generated_fields.get(path)
        after = approved_fields.get(path)
        if before != after:
            changes.append({"field": path, "generated": before, "approved": after})
            if len(changes) >= limit:
                break
    return changes


@router.post("/data/unlock")
async def unlock_admin_data(
    request: AdminDataUnlockRequest,
    admin_session: dict = Depends(require_admin_session),
):
    try:
        password_matches = bcrypt.checkpw(
            request.password.encode("utf-8")[:72],
            admin_data_password_hash().encode("utf-8"),
        )
    except (ValueError, TypeError):
        password_matches = False
    if not password_matches:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Incorrect data-access password")
    token, expires_at = create_admin_data_token(admin_session)
    return {"data_token": token, "expires_at": expires_at.isoformat()}


@router.get("/data/clinics")
async def get_admin_clinic_data(
    search: str = Query("", max_length=120),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: dict = Depends(require_admin_data_session),
    db: AsyncSession = Depends(get_db),
):
    filters = []
    term = search.strip()
    if term:
        pattern = f"%{term}%"
        filters.append(or_(Clinic.clinic_name.ilike(pattern), Clinic.clinic_id.ilike(pattern), Clinic.city.ilike(pattern), Clinic.phone.ilike(pattern)))
    total = await db.scalar(select(func.count()).select_from(Clinic).where(*filters))
    result = await db.execute(select(Clinic).where(*filters).order_by(Clinic.created_at.desc()).offset(offset).limit(limit))
    clinics = list(result.scalars().all())
    clinic_ids = [clinic.clinic_id for clinic in clinics]
    doctors_by_clinic: dict[str, list[dict]] = {clinic_id: [] for clinic_id in clinic_ids}
    if clinic_ids:
        doctor_result = await db.execute(select(Doctor).where(Doctor.clinic_id.in_(clinic_ids)).order_by(Doctor.name))
        for doctor in doctor_result.scalars().all():
            doctors_by_clinic.setdefault(doctor.clinic_id, []).append({
                "doctor_id": doctor.doctor_id,
                "name": doctor.name,
                "specialization": doctor.specialization,
                "experience": doctor.experience,
                "qualifications": doctor.qualifications,
                "available": doctor.available,
            })
    return {
        "total": total or 0,
        "items": [{
            "clinic_id": clinic.clinic_id,
            "clinic_name": clinic.clinic_name,
            "email": clinic.email,
            "phone": clinic.phone,
            "category": clinic.category,
            "categories": clinic.categories or [],
            "address": clinic.address,
            "city": clinic.city,
            "pincode": clinic.pincode,
            "latitude": clinic.latitude,
            "longitude": clinic.longitude,
            "available": clinic.available,
            "is_active": clinic.is_active,
            "created_at": _iso(clinic.created_at),
            "doctors": doctors_by_clinic.get(clinic.clinic_id, []),
        } for clinic in clinics],
    }


@router.get("/data/patients")
async def get_admin_patient_data(
    search: str = Query("", max_length=120),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: dict = Depends(require_admin_data_session),
    db: AsyncSession = Depends(get_db),
):
    filters = []
    term = search.strip()
    if term:
        pattern = f"%{term}%"
        filters.append(or_(Patient.name.ilike(pattern), Patient.patient_id.ilike(pattern), Patient.email.ilike(pattern), Patient.phone.ilike(pattern)))
    total = await db.scalar(select(func.count()).select_from(Patient).where(*filters))
    result = await db.execute(select(Patient).where(*filters).order_by(Patient.created_at.desc()).offset(offset).limit(limit))
    patients = list(result.scalars().all())
    patient_ids = [patient.patient_id for patient in patients]
    visit_counts: dict[str, int] = {}
    ehr_counts: dict[str, int] = {}
    if patient_ids:
        visit_result = await db.execute(
            select(CompletedAppointment.patient_id, func.count(CompletedAppointment.id))
            .where(CompletedAppointment.patient_id.in_(patient_ids))
            .group_by(CompletedAppointment.patient_id)
        )
        visit_counts = {patient_id: count for patient_id, count in visit_result.all()}
        ehr_result = await db.execute(
            select(ClinicalEncounter.patient_id, func.count(ClinicalEncounter.id))
            .where(ClinicalEncounter.patient_id.in_(patient_ids), ClinicalEncounter.status == "approved")
            .group_by(ClinicalEncounter.patient_id)
        )
        ehr_counts = {patient_id: count for patient_id, count in ehr_result.all()}
    return {
        "total": total or 0,
        "items": [{
            "patient_id": patient.patient_id,
            "name": patient.name,
            "email": patient.email,
            "phone": patient.phone,
            "blood_group": patient.blood_group,
            "visit_count": visit_counts.get(patient.patient_id, 0),
            "approved_emr_count": ehr_counts.get(patient.patient_id, 0),
            "created_at": _iso(patient.created_at),
        } for patient in patients],
    }


@router.get("/data/visits")
async def get_admin_visit_data(
    clinic_id: Optional[str] = Query(None, max_length=80),
    search: str = Query("", max_length=120),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: dict = Depends(require_admin_data_session),
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if clinic_id:
        filters.append(CompletedAppointment.clinic_id == clinic_id.strip())
    term = search.strip()
    if term:
        pattern = f"%{term}%"
        filters.append(or_(
            CompletedAppointment.patient_name.ilike(pattern),
            CompletedAppointment.patient_id.ilike(pattern),
            CompletedAppointment.patient_phone.ilike(pattern),
            Clinic.clinic_name.ilike(pattern),
            CompletedAppointment.clinic_id.ilike(pattern),
        ))
    base = CompletedAppointment.__table__.outerjoin(Clinic, CompletedAppointment.clinic_id == Clinic.clinic_id)
    total = await db.scalar(select(func.count()).select_from(base).where(*filters))
    result = await db.execute(
        select(CompletedAppointment, Clinic.clinic_name)
        .select_from(base)
        .where(*filters)
        .order_by(CompletedAppointment.served_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = result.all()
    appointment_ids = [visit.id for visit, _clinic_name in rows]
    encounters_by_appointment = {}
    if appointment_ids:
        encounter_result = await db.execute(
            select(ClinicalEncounter)
            .where(ClinicalEncounter.appointment_id.in_(appointment_ids))
            .order_by(ClinicalEncounter.created_at.desc())
        )
        for encounter in encounter_result.scalars().all():
            encounters_by_appointment.setdefault(encounter.appointment_id, encounter)
    return {
        "total": total or 0,
        "items": [{
            "appointment_id": visit.id,
            "appointment_token": visit.appointment_token,
            "clinic_id": visit.clinic_id,
            "clinic_name": clinic_name or visit.clinic_id,
            "patient_id": visit.patient_id,
            "patient_name": visit.patient_name,
            "patient_email": visit.patient_email,
            "patient_phone": visit.patient_phone,
            "doctor_name": visit.doctor_name,
            "date": visit.date,
            "time": visit.time,
            "status": visit.status,
            "outcome": visit.outcome,
            "wait_time_minutes": visit.wait_time_minutes,
            "consultation_duration_minutes": visit.consultation_duration_minutes,
            "served_at": _iso(visit.served_at),
            "encounter_id": getattr(encounters_by_appointment.get(visit.id), "encounter_id", None),
            "emr_status": getattr(encounters_by_appointment.get(visit.id), "status", None),
        } for visit, clinic_name in rows],
    }


@router.get("/emr-records")
async def get_admin_emr_learning_data(
    search: str = Query("", max_length=120),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    _: dict = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db),
):
    filters = [ClinicalEncounter.status == "approved"]
    term = search.strip()
    if term:
        pattern = f"%{term}%"
        filters.append(or_(
            ClinicalEncounter.encounter_id.ilike(pattern),
            ClinicalEncounter.patient_name.ilike(pattern),
            ClinicalEncounter.patient_id.ilike(pattern),
            ClinicalEncounter.clinic_id.ilike(pattern),
            Clinic.clinic_name.ilike(pattern),
        ))
    base = ClinicalEncounter.__table__.outerjoin(Clinic, ClinicalEncounter.clinic_id == Clinic.clinic_id)
    total = await db.scalar(select(func.count()).select_from(base).where(*filters))
    result = await db.execute(
        select(ClinicalEncounter, Clinic.clinic_name)
        .select_from(base)
        .where(*filters)
        .order_by(ClinicalEncounter.approved_at.desc().nullslast(), ClinicalEncounter.id.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = result.all()
    encounter_ids = [encounter.encounter_id for encounter, _clinic_name in rows]
    events_by_encounter: dict[str, list[EhrAuditEvent]] = {encounter_id: [] for encounter_id in encounter_ids}
    if encounter_ids:
        event_result = await db.execute(
            select(EhrAuditEvent)
            .where(EhrAuditEvent.encounter_id.in_(encounter_ids))
            .order_by(EhrAuditEvent.created_at.asc(), EhrAuditEvent.id.asc())
        )
        for event in event_result.scalars().all():
            events_by_encounter.setdefault(event.encounter_id, []).append(event)

    items = []
    for encounter, clinic_name in rows:
        events = events_by_encounter.get(encounter.encounter_id, [])
        generated_event = next((event for event in events if event.action == "draft_generated"), None)
        approved_event = next((event for event in reversed(events) if event.action == "approved"), None)
        generated_snapshot = generated_event.snapshot if generated_event and isinstance(generated_event.snapshot, dict) else {}
        approved_snapshot = approved_event.snapshot if approved_event and isinstance(approved_event.snapshot, dict) else {}
        generated_emr = generated_snapshot.get("ehr_data") if isinstance(generated_snapshot.get("ehr_data"), dict) else {}
        approved_emr = approved_snapshot.get("ehr_data") if isinstance(approved_snapshot.get("ehr_data"), dict) else (encounter.ehr_data or {})
        approved_summary = approved_snapshot.get("patient_summary") if isinstance(approved_snapshot.get("patient_summary"), dict) else (encounter.patient_summary or {})
        changes = _build_learning_changes(generated_emr, approved_emr)
        items.append({
            "encounter_id": encounter.encounter_id,
            "clinic_id": encounter.clinic_id,
            "clinic_name": clinic_name or encounter.clinic_id,
            "patient_id": encounter.patient_id,
            "patient_name": encounter.patient_name,
            "doctor_id": encounter.doctor_id,
            "model_name": encounter.model_name,
            "transcript": encounter.transcript_text,
            "generated_emr": generated_emr,
            "approved_emr": approved_emr,
            "approved_patient_summary": approved_summary,
            "changes": changes,
            "changed_field_count": len(changes),
            "doctor_edit_events": sum(1 for event in events if event.action == "draft_edited"),
            "generated_at": _iso(getattr(generated_event, "created_at", None)),
            "approved_at": _iso(encounter.approved_at),
            "approved_by": encounter.approved_by,
            "has_original_draft": bool(generated_event),
        })
    return {"total": total or 0, "items": items}


@router.post("/send-otp")
async def send_admin_otp(
    request: SendOtpRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Send OTP to the admin email and confirmation email configured in environment variables.
    """
    username = request.username

    # Check if username is valid
    if username not in valid_admin_usernames():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid username. Use one of: {', '.join(sorted(valid_admin_usernames()))}"
        )

    # Get admin from database
    result = await db.execute(
        select(Admin).where(Admin.username == username)
    )
    admin = result.scalar_one_or_none()

    if not admin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Admin account not found"
        )

    # When both configured destinations are the same inbox, one code is less
    # ambiguous and can be entered in both existing OTP fields. Distinct
    # inboxes continue to receive two independent codes.
    otp_code = generate_otp()
    same_inbox = admin.email.strip().casefold() == admin.confirmation_email.strip().casefold()
    confirmation_otp_code = otp_code if same_inbox else generate_otp()

    # Set expiration time (10 minutes)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    # Update admin with OTP codes
    admin.otp_code = otp_code
    admin.confirmation_otp_code = confirmation_otp_code
    admin.otp_expires_at = expires_at
    admin.confirmation_otp_expires_at = expires_at

    await db.commit()

    primary_email_sent = False
    confirmation_email_sent = False

    # Send OTP to admin's email
    try:
        primary_email_sent = send_admin_otp_email(admin.email, otp_code, username)
    except Exception as e:
        print(f"Failed to send OTP to {admin.email}: {str(e)}")

    # Do not send an indistinguishable duplicate email to the same inbox.
    if same_inbox:
        confirmation_email_sent = primary_email_sent
    else:
        try:
            confirmation_email_sent = send_admin_otp_email(admin.confirmation_email, confirmation_otp_code, f"{username} (confirmation)")
        except Exception as e:
            print(f"Failed to send confirmation OTP to {admin.confirmation_email}: {str(e)}")

    if not primary_email_sent or not confirmation_email_sent:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to send one or more OTP emails. Please check SMTP settings and try again."
        )

    return {
        "success": True,
        "message": "OTP codes sent successfully",
        "expires_in": 600,  # 10 minutes in seconds
        "expires_at": expires_at.isoformat()
    }


@router.post("/verify-otp")
async def verify_admin_otp(
    request: VerifyOtpRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Verify both OTP codes and create admin session.
    """
    username = request.username
    otp_code = request.otp_code
    confirmation_otp_code = request.confirmation_otp_code

    # Get admin from database
    result = await db.execute(
        select(Admin).where(Admin.username == username)
    )
    admin = result.scalar_one_or_none()

    if not admin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Admin account not found"
        )

    # Check if OTP codes exist
    if not admin.otp_code or not admin.confirmation_otp_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No OTP codes found. Please request new OTP codes."
        )

    # Check if OTP codes have expired
    if not admin.otp_expires_at or not admin.confirmation_otp_expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP expiration time not set."
        )

    now = datetime.now(timezone.utc)

    # Handle timezone-aware vs timezone-naive comparison
    otp_expires = admin.otp_expires_at
    confirmation_expires = admin.confirmation_otp_expires_at

    # If stored datetimes are timezone-naive, treat them as UTC
    if otp_expires.tzinfo is None:
        otp_expires = otp_expires.replace(tzinfo=timezone.utc)
    if confirmation_expires.tzinfo is None:
        confirmation_expires = confirmation_expires.replace(tzinfo=timezone.utc)

    if now > otp_expires or now > confirmation_expires:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP codes have expired. Please request new OTP codes."
        )

    # Verify OTP codes
    if otp_code != admin.otp_code:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid OTP code"
        )

    if confirmation_otp_code != admin.confirmation_otp_code:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid confirmation OTP code"
        )

    # Clear OTP codes after successful verification
    admin.otp_code = None
    admin.confirmation_otp_code = None
    admin.otp_expires_at = None
    admin.confirmation_otp_expires_at = None

    await db.commit()

    # Create admin session
    access_token, expires_at = create_admin_session(str(admin.id), username)

    return {
        "success": True,
        "message": "Login successful",
        "admin_id": str(admin.id),
        "username": username,
        "access_token": access_token,
        "expires_in": ADMIN_SESSION_HOURS * 60 * 60,
        "expires_at": expires_at.isoformat(),
    }


@router.get("/session")
async def get_admin_session(session: dict = Depends(require_admin_session)):
    return {
        "authenticated": True,
        "admin_id": session["admin_id"],
        "username": session["username"],
        "expires_at": session["expires_at"].isoformat() if isinstance(session["expires_at"], datetime) else None,
    }


@router.post("/logout")
async def admin_logout(session: dict = Depends(require_admin_session)):
    invalidate_admin_session(session["token"])
    return {"success": True, "message": "Logged out successfully"}


# ============ Pending Registration Management ============

@router.get("/pending-registrations")
async def get_pending_registrations(
    status: Optional[str] = Query(None, description="Filter by status: pending, approved, rejected"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(require_admin_session)
):
    """
    Get all pending clinic registrations with optional filtering.
    """
    query = select(PendingClinicRegistration)
    
    if status:
        query = query.where(PendingClinicRegistration.status == status)
    else:
        # Default to showing pending only
        query = query.where(PendingClinicRegistration.status == "pending")
    
    query = query.order_by(PendingClinicRegistration.created_at.desc())
    
    # Get total count
    count_result = await db.execute(
        select(func.count()).select_from(PendingClinicRegistration)
        .where(PendingClinicRegistration.status == (status or "pending"))
    )
    total = count_result.scalar()
    
    # Get paginated results
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)
    
    result = await db.execute(query)
    registrations = result.scalars().all()
    
    return {
        "registrations": [
            {
                "id": reg.id,
                "clinic_id": reg.clinic_id,
                "clinic_name": reg.clinic_name,
                "email": reg.email,
                "phone": reg.phone,
                "category": reg.category,
                "categories": reg.categories or ([] if not reg.category else [reg.category]),
                # Address fields
                "street_address": reg.street_address,
                "road": reg.road,
                "layout": reg.layout,
                "section": reg.section,
                "city": reg.city,
                "pincode": reg.pincode,
                "address": reg.address,
                "latitude": reg.latitude,
                "longitude": reg.longitude,
                # Doctor details
                "doctor_name": reg.doctor_name,
                "specialization": reg.specialization,
                "experience": reg.experience,
                "qualifications": reg.qualifications,
                "image_urls": reg.image_urls,
                "status": reg.status,
                "created_at": reg.created_at.isoformat() if reg.created_at else None,
                "updated_at": reg.updated_at.isoformat() if reg.updated_at else None,
            }
            for reg in registrations
        ],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


@router.get("/pending-registrations/{registration_id}")
async def get_pending_registration_details(
    registration_id: int,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(require_admin_session)
):
    """
    Get detailed information about a specific pending registration.
    """
    result = await db.execute(
        select(PendingClinicRegistration)
        .where(PendingClinicRegistration.id == registration_id)
    )
    reg = result.scalar_one_or_none()
    
    if not reg:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registration not found"
        )
    
    return {
        "id": reg.id,
        "clinic_id": reg.clinic_id,
        "clinic_name": reg.clinic_name,
        "email": reg.email,
        "phone": reg.phone,
        "category": reg.category,
        "categories": reg.categories or ([] if not reg.category else [reg.category]),
        # Address fields
        "street_address": reg.street_address,
        "road": reg.road,
        "layout": reg.layout,
        "section": reg.section,
        "city": reg.city,
        "pincode": reg.pincode,
        "address": reg.address,
        "latitude": reg.latitude,
        "longitude": reg.longitude,
        # Doctor details
        "doctor_name": reg.doctor_name,
        "specialization": reg.specialization,
        "experience": reg.experience,
        "qualifications": reg.qualifications,
        "image_urls": reg.image_urls,
        "status": reg.status,
        "created_at": reg.created_at.isoformat() if reg.created_at else None,
        "updated_at": reg.updated_at.isoformat() if reg.updated_at else None,
    }


@router.put("/pending-registrations/{registration_id}/location")
async def update_pending_registration_location(
    registration_id: int,
    request: RegistrationLocationRequest,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(require_admin_session)
):
    """
    Store the admin-pinned coordinate for a pending clinic registration.
    The clinic will confirm or correct this pin on first login after approval.
    """
    result = await db.execute(
        select(PendingClinicRegistration)
        .where(PendingClinicRegistration.id == registration_id)
    )
    reg = result.scalar_one_or_none()

    if not reg:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registration not found"
        )

    if reg.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Registration is already {reg.status}"
        )

    reg.latitude = request.latitude
    reg.longitude = request.longitude
    await db.commit()
    await db.refresh(reg)

    return {
        "message": "Location pinned successfully",
        "id": reg.id,
        "latitude": reg.latitude,
        "longitude": reg.longitude,
    }


@router.post("/pending-registrations/{registration_id}/approve")
async def approve_registration(
    registration_id: int,
    admin_id: str,
    notes: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(require_admin_session)
):
    """
    Approve a pending clinic registration.
    Moves the clinic from pending table to approved clinics table.
    """
    try:
        if admin_id != session["admin_id"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin identity mismatch"
            )

        # Get the pending registration
        result = await db.execute(
            select(PendingClinicRegistration)
            .where(PendingClinicRegistration.id == registration_id)
        )
        pending_reg = result.scalar_one_or_none()
 
        if not pending_reg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Registration not found"
            )
 
        if pending_reg.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Registration is already {pending_reg.status}"
            )
 
        # Check if email already exists in clinics
        result = await db.execute(select(Clinic).where(Clinic.email == pending_reg.email))
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A clinic with this email already exists"
            )

        latitude = pending_reg.latitude
        longitude = pending_reg.longitude

        if not latitude or not longitude:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Please pin the clinic location on the map before approval"
            )
 
        # Create approved clinic with all address fields, category and doctor details
        new_clinic = Clinic(
            clinic_id=pending_reg.clinic_id,
            clinic_name=pending_reg.clinic_name,
            email=pending_reg.email,
            password=pending_reg.password,
            phone=pending_reg.phone,
            category=pending_reg.category,
            categories=pending_reg.categories or ([] if not pending_reg.category else [pending_reg.category]),
            street_address=pending_reg.street_address,
            road=pending_reg.road,
            layout=pending_reg.layout,
            section=pending_reg.section,
            city=pending_reg.city,
            pincode=pending_reg.pincode,
            address=pending_reg.address,
            latitude=None,
            longitude=None,
            admin_pinned_latitude=latitude,
            admin_pinned_longitude=longitude,
            image_urls=pending_reg.image_urls,
            doctor_name=pending_reg.doctor_name,
            specialization=pending_reg.specialization,
            experience=pending_reg.experience,
            qualifications=pending_reg.qualifications,
            available=True,
            is_active=False,
            has_pinned_location=False,
        )

        approved_clinic_id = pending_reg.clinic_id
        approved_email = pending_reg.email
        approved_clinic_name = pending_reg.clinic_name
 
        db.add(new_clinic)

        approved_doctors = normalize_pending_doctors(pending_reg)
        for doctor_data in approved_doctors:
            db.add(Doctor(
                doctor_id=generate_doctor_id(pending_reg.clinic_id),
                clinic_id=pending_reg.clinic_id,
                name=doctor_data["name"],
                specialization=doctor_data.get("specialization") or "",
                experience=doctor_data.get("experience") or "",
                qualifications=doctor_data.get("qualifications") or "",
                available=True,
            ))

        # Remove from pending table after approval
        await db.delete(pending_reg)

        await db.commit()
        await db.refresh(new_clinic)
 
        # Send approval email (best-effort)
        try:
            email_sent = send_clinic_approval_email(
                approved_email,
                approved_clinic_name,
                approved_clinic_id
            )
        except Exception as e:
            print(f"Approval email failed: {str(e)}")
            email_sent = False
 
        return {
            "message": "Clinic registration approved successfully",
            "clinic_id": approved_clinic_id,
            "email_sent": email_sent,
            "clinic": {
                "clinic_id": new_clinic.clinic_id,
                "clinic_name": new_clinic.clinic_name,
                "email": new_clinic.email,
                "phone": new_clinic.phone,
                "address": new_clinic.address,
                "latitude": new_clinic.latitude,
                "longitude": new_clinic.longitude,
                "admin_pinned_latitude": new_clinic.admin_pinned_latitude,
                "admin_pinned_longitude": new_clinic.admin_pinned_longitude,
                "category": new_clinic.category,
                "categories": new_clinic.categories or ([] if not new_clinic.category else [new_clinic.category]),
                "city": new_clinic.city,
                "doctor_name": new_clinic.doctor_name,
                "specialization": new_clinic.specialization,
                "doctors": approved_doctors,
            },
        }
    except HTTPException:
        # Let FastAPI handle HTTP errors as-is
        raise
    except Exception as e:
        await db.rollback()
        import traceback
        error_msg = f"Error during approval: {str(e)}"
        print(error_msg)
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_msg
        )


@router.post("/pending-registrations/{registration_id}/reject")
async def reject_registration(
    registration_id: int,
    admin_id: str,
    reason: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(require_admin_session)
):
    """
    Reject a pending clinic registration.
    """
    try:
        if admin_id != session["admin_id"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin identity mismatch"
            )

        # Get the pending registration
        result = await db.execute(
            select(PendingClinicRegistration)
            .where(PendingClinicRegistration.id == registration_id)
        )
        pending_reg = result.scalar_one_or_none()
 
        if not pending_reg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Registration not found"
            )
 
        if pending_reg.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Registration is already {pending_reg.status}"
            )
 
        from app.database.models import RejectedClinic
 
        rejected_clinic = RejectedClinic(
            clinic_id=pending_reg.clinic_id,
            clinic_name=pending_reg.clinic_name,
            email=pending_reg.email,
            password=pending_reg.password,
            phone=pending_reg.phone,
            category=pending_reg.category,
            categories=pending_reg.categories or ([] if not pending_reg.category else [pending_reg.category]),
            street_address=pending_reg.street_address,
            road=pending_reg.road,
            layout=pending_reg.layout,
            section=pending_reg.section,
            city=pending_reg.city,
            pincode=pending_reg.pincode,
            address=pending_reg.address,
            latitude=pending_reg.latitude,
            longitude=pending_reg.longitude,
            doctor_name=pending_reg.doctor_name,
            specialization=pending_reg.specialization,
            experience=pending_reg.experience,
            qualifications=pending_reg.qualifications,
            doctors=pending_reg.doctors or [],
            image_urls=pending_reg.image_urls,
            rejection_reason=reason,
        )

        rejected_clinic_id = pending_reg.clinic_id
        rejected_email = pending_reg.email
        rejected_clinic_name = pending_reg.clinic_name
 
        db.add(rejected_clinic)

        # Remove from pending table after rejection
        await db.delete(pending_reg)

        await db.commit()
 
        # Send rejection email (best-effort)
        try:
            email_sent = send_clinic_rejection_email(
                rejected_email,
                rejected_clinic_name,
                reason
            )
        except Exception as e:
            print(f"Rejection email failed: {str(e)}")
            email_sent = False
 
        return {
            "message": "Clinic registration rejected",
            "clinic_id": rejected_clinic_id,
            "email_sent": email_sent,
            "reason": reason,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        import traceback
        error_msg = f"Error during rejection: {str(e)}"
        print(error_msg)
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_msg
        )


# ============ Statistics Endpoints ============

@router.get("/statistics")
async def get_admin_statistics(
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(require_admin_session)
):
    """
    Get statistics for the admin dashboard.
    """
    from app.database.models import RejectedClinic
    
    # Pending count - from pending_clinic_registrations table
    pending_result = await db.execute(
        select(func.count())
        .select_from(PendingClinicRegistration)
        .where(PendingClinicRegistration.status == "pending")
    )
    pending_count = pending_result.scalar()
    
    # Approved count - from clinics table (all approved clinics)
    approved_result = await db.execute(
        select(func.count()).select_from(Clinic)
    )
    approved_count = approved_result.scalar()
    
    # Rejected count - from rejected_clinics table
    rejected_result = await db.execute(
        select(func.count()).select_from(RejectedClinic)
    )
    rejected_count = rejected_result.scalar()
    
    # Active clinics - from clinics table where is_active = true
    active_result = await db.execute(
        select(func.count()).select_from(Clinic).where(Clinic.is_active == True)
    )
    active_clinics = active_result.scalar()
    
    return {
        "pending_registrations": pending_count,
        "approved_registrations": approved_count,
        "rejected_registrations": rejected_count,
        "total_active_clinics": active_clinics,
    }


@router.get("/approved-clinics")
async def get_approved_clinics(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(require_admin_session)
):
    """
    Get all approved clinics from the clinics table.
    """
    # Get total count
    count_result = await db.execute(select(func.count()).select_from(Clinic))
    total = count_result.scalar()
    
    # Get paginated results
    offset = (page - 1) * limit
    result = await db.execute(
        select(Clinic).order_by(Clinic.created_at.desc()).offset(offset).limit(limit)
    )
    clinics = result.scalars().all()
    
    return {
        "clinics": [
            {
                "id": c.id,
                "clinic_id": c.clinic_id,
                "clinic_name": c.clinic_name,
                "email": c.email,
                "phone": c.phone,
                "category": c.category,
                "categories": c.categories or ([] if not c.category else [c.category]),
                "street_address": c.street_address,
                "road": c.road,
                "layout": c.layout,
                "section": c.section,
                "city": c.city,
                "pincode": c.pincode,
                "address": c.address,
                "latitude": c.latitude,
                "longitude": c.longitude,
                "doctor_name": c.doctor_name,
                "specialization": c.specialization,
                "experience": c.experience,
                "qualifications": c.qualifications,
                "image_urls": c.image_urls,
                "available": c.available,
                "is_active": c.is_active,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in clinics
        ],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


@router.get("/rejected-clinics")
async def get_rejected_clinics(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(require_admin_session)
):
    """
    Get all rejected clinics from the rejected_clinics table.
    """
    from app.database.models import RejectedClinic
    
    # Get total count
    count_result = await db.execute(select(func.count()).select_from(RejectedClinic))
    total = count_result.scalar()
    
    # Get paginated results
    offset = (page - 1) * limit
    result = await db.execute(
        select(RejectedClinic).order_by(RejectedClinic.rejected_at.desc()).offset(offset).limit(limit)
    )
    clinics = result.scalars().all()
    
    return {
        "clinics": [
            {
                "id": c.id,
                "clinic_id": c.clinic_id,
                "clinic_name": c.clinic_name,
                "email": c.email,
                "phone": c.phone,
                "category": c.category,
                "categories": c.categories or ([] if not c.category else [c.category]),
                "street_address": c.street_address,
                "road": c.road,
                "layout": c.layout,
                "section": c.section,
                "city": c.city,
                "pincode": c.pincode,
                "address": c.address,
                "latitude": c.latitude,
                "longitude": c.longitude,
                "doctor_name": c.doctor_name,
                "specialization": c.specialization,
                "experience": c.experience,
                "qualifications": c.qualifications,
                "image_urls": c.image_urls,
                "rejection_reason": c.rejection_reason,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "rejected_at": c.rejected_at.isoformat() if c.rejected_at else None,
            }
            for c in clinics
        ],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }
