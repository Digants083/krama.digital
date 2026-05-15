"""
Admin router for managing clinic registrations.
Provides endpoints for viewing, approving, and rejecting pending clinic registrations.
"""
import random
import string
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Union

from fastapi import APIRouter, Depends, HTTPException, status, Query, Body, Header
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func

from app.database.db import get_db
from app.database.models import (
    PendingClinicRegistration, Clinic, Admin, ClinicImage
)
from app.services.email_service import (
    send_clinic_approval_email,
    send_clinic_rejection_email,
    send_admin_otp_email
)

router = APIRouter(prefix="/admin", tags=["admin"])
ADMIN_SESSION_HOURS = 24
admin_sessions: dict[str, dict[str, Union[str, datetime]]] = {}


def generate_clinic_id():
    """Generate unique clinic ID like FA23W3"""
    letters = ''.join(random.choices(string.ascii_uppercase, k=2))
    digits = ''.join(random.choices(string.digits, k=2))
    more_letters = ''.join(random.choices(string.ascii_uppercase, k=3))
    return f"{letters}{digits}{more_letters}"


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


def create_admin_session(admin_id: str, username: str) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=ADMIN_SESSION_HOURS)
    admin_sessions[token] = {
        "admin_id": admin_id,
        "username": username,
        "expires_at": expires_at,
    }
    return token, expires_at


def invalidate_admin_session(token: str) -> None:
    admin_sessions.pop(token, None)


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


async def require_admin_session(authorization: Optional[str] = Header(None)) -> dict:
    token = get_bearer_token(authorization)
    session = admin_sessions.get(token)

    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin session not found. Please login again."
        )

    expires_at = session["expires_at"]
    if not isinstance(expires_at, datetime) or datetime.now(timezone.utc) > expires_at:
        invalidate_admin_session(token)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin session expired. Please login again."
        )

    return {
        "token": token,
        "admin_id": session["admin_id"],
        "username": session["username"],
        "expires_at": expires_at,
    }


@router.post("/send-otp")
async def send_admin_otp(
    request: SendOtpRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Send OTP to admin's email and confirmation email.
    For admin1: sends to reddit098609@gmail.com and reddit098609@gmail.com
    For admin2: sends to yashavanthb28@gmail.com and digitalkrama@gmail.com
    """
    username = request.username

    # Check if username is valid
    if username not in ["admin1", "admin2"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid username. Use admin1 or admin2"
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

    # Generate two different OTPs
    otp_code = generate_otp()
    confirmation_otp_code = generate_otp()

    # Set expiration time (10 minutes)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    # Update admin with OTP codes
    admin.otp_code = otp_code
    admin.confirmation_otp_code = confirmation_otp_code
    admin.otp_expires_at = expires_at
    admin.confirmation_otp_expires_at = expires_at

    await db.commit()

    # Send OTP to admin's email
    try:
        send_admin_otp_email(admin.email, otp_code, username)
    except Exception as e:
        print(f"Failed to send OTP to {admin.email}: {str(e)}")

    # Send confirmation OTP to confirmation email
    try:
        send_admin_otp_email(admin.confirmation_email, confirmation_otp_code, f"{username} (confirmation)")
    except Exception as e:
        print(f"Failed to send confirmation OTP to {admin.confirmation_email}: {str(e)}")

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
            latitude=latitude,
            longitude=longitude,
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
                "category": new_clinic.category,
                "categories": new_clinic.categories or ([] if not new_clinic.category else [new_clinic.category]),
                "city": new_clinic.city,
                "doctor_name": new_clinic.doctor_name,
                "specialization": new_clinic.specialization,
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
