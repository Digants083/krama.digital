from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from app.database.db import get_db
from app.database.models import Clinic, OTPVerification, Patient
from app.security import hash_password
from app.services.otp_service import OTPService
from app.routers.auth import validate_password_strength
import secrets

router = APIRouter(prefix="/auth", tags=["password-reset"])

VALID_RESET_ROLES = {"patient": Patient, "clinic": Clinic}


def utc_now_for(dt):
    if dt is not None and dt.tzinfo is not None:
        return datetime.now(timezone.utc)
    return datetime.utcnow()


def get_reset_model(role: str):
    model = VALID_RESET_ROLES.get(role)
    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Password reset role not found"
        )
    return model


def reset_marker_for(role: str) -> str:
    return f"password_reset:{role}"


async def forgot_password_for_role(role: str, request: dict, db: AsyncSession):
    model = get_reset_model(role)
    role_label = "clinic" if role == "clinic" else "patient"
    email = (request.get("email") or "").strip().lower()

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is required"
        )

    result = await db.execute(select(model).where(model.email == email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No {role_label} found with this email"
        )

    otp_service = OTPService()
    success, message = await otp_service.create_otp_for_password_reset(email, db)

    if success:
        result = await db.execute(select(OTPVerification).where(OTPVerification.email == email))
        otp_record = result.scalar_one_or_none()
        if otp_record:
            otp_record.user_name = reset_marker_for(role)
            await db.commit()
        return {"message": "OTP sent to your email for password reset"}

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=message
    )


async def verify_reset_otp_for_role(role: str, request: dict, db: AsyncSession):
    get_reset_model(role)
    email = (request.get("email") or "").strip().lower()
    otp = request.get("otp")

    if not all([email, otp]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and OTP are required"
        )

    otp_service = OTPService()
    result = await db.execute(select(OTPVerification).where(OTPVerification.email == email))
    otp_record = result.scalar_one_or_none()
    if not otp_record or otp_record.user_name != reset_marker_for(role):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please request a new OTP from the correct login page"
        )

    success, message = await otp_service.verify_password_reset_otp(email, otp, db)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

    reset_token = secrets.token_urlsafe(32)
    result = await db.execute(select(OTPVerification).where(OTPVerification.email == email))
    otp_record = result.scalar_one_or_none()
    if not otp_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset session expired. Please request a new OTP."
        )

    otp_record.otp_code = otp_service.hash_otp(reset_token)
    otp_record.is_verified = True
    otp_record.attempt_count = 0
    await db.commit()

    return {
        "message": "OTP verified successfully",
        "reset_token": reset_token,
        "expires_in": 900
    }


async def reset_password_for_role(role: str, request: dict, db: AsyncSession):
    model = get_reset_model(role)
    role_label = "clinic" if role == "clinic" else "patient"
    email = (request.get("email") or "").strip().lower()
    new_password = request.get("new_password")
    reset_token = request.get("reset_token")

    if not all([email, new_password, reset_token]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email, reset token, and new password are required"
        )

    valid, error_msg = validate_password_strength(new_password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )

    otp_service = OTPService()
    result = await db.execute(select(OTPVerification).where(OTPVerification.email == email))
    reset_record = result.scalar_one_or_none()

    if (
        not reset_record
        or not reset_record.is_verified
        or reset_record.user_name != reset_marker_for(role)
        or not otp_service.verify_otp_hash(reset_record.otp_code, reset_token)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please verify the OTP before resetting your password"
        )

    if utc_now_for(reset_record.expires_at) > reset_record.expires_at:
        await db.delete(reset_record)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset session expired. Please request a new OTP."
        )
    
    result = await db.execute(select(model).where(model.email == email))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{role_label.title()} not found"
        )
    
    user.password = hash_password(new_password)
    await db.delete(reset_record)
    await db.commit()
    
    return {"message": "Password reset successfully"}


@router.post("/patient/forgot-password")
async def patient_forgot_password(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Send OTP to patient email for password reset.
    """
    return await forgot_password_for_role("patient", request, db)

@router.post("/patient/verify-reset-otp")
async def verify_reset_otp(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Verify OTP for password reset and return a token for setting new password.
    """
    return await verify_reset_otp_for_role("patient", request, db)

@router.post("/patient/reset-password")
async def reset_patient_password(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Reset patient password after OTP verification.
    """
    return await reset_password_for_role("patient", request, db)


@router.post("/clinic/forgot-password")
async def clinic_forgot_password(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Send OTP to clinic email for password reset.
    """
    return await forgot_password_for_role("clinic", request, db)


@router.post("/clinic/verify-reset-otp")
async def verify_clinic_reset_otp(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Verify clinic OTP for password reset and return a reset token.
    """
    return await verify_reset_otp_for_role("clinic", request, db)


@router.post("/clinic/reset-password")
async def reset_clinic_password(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Reset clinic password after OTP verification.
    """
    return await reset_password_for_role("clinic", request, db)
