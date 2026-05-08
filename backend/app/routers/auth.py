import json

import random

import string

import re

import os

import uuid

from datetime import datetime, timedelta, timezone

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form

from pydantic import BaseModel, EmailStr

from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select, delete

from app.database.db import get_db

from app.database.models import (

    Clinic, Patient, OTPVerification, Appointment, CompletedAppointment,

    Review, ReviewReaction, ClinicImage, QRAppointment, PendingClinicRegistration,

    RejectedClinic, ClinicTimeSlot

)

from app.services.email_service import send_clinic_registration_received_email

from app.services.geocoding_service import get_coordinates_from_address, get_coordinates_from_structured_address

CLINIC_TIMEZONE = timezone(timedelta(hours=5, minutes=30))

def _clinic_today_str() -> str:
    return datetime.now(CLINIC_TIMEZONE).strftime("%Y-%m-%d")


def _sort_datetime(value):
    if value is None:
        return datetime.min.replace(tzinfo=CLINIC_TIMEZONE)
    if value.tzinfo is None:
        return value.replace(tzinfo=CLINIC_TIMEZONE)
    return value

from app.schemas import (

    ClinicSignup, ClinicLogin, PatientSignup, PatientLogin,

    ChangePasswordRequest, ChangePhoneRequest, DeleteAccountRequest, DeleteClinicRequest,

    AuthResponse, SendOTPRequest, VerifyOTPRequest, OTPResponse, OTPVerifyResponse,

    PatientProfileOTPRequest, ClinicProfileOTPRequest

)

from app.security import hash_password, verify_password

from app.services.otp_service import OTPService

from fastapi.responses import JSONResponse

from app.services.email_service import send_otp as send_otp_email





def validate_password_strength(password: str) -> tuple[bool, str]:

    """

    Validate password strength.

    Returns (is_valid, error_message).

    Requirements: 8+ chars, 1 uppercase, 1 lowercase, 1 special, 1 number.

    """

    if len(password) < 8:

        return False, "Password must be at least 8 characters long"

    if not re.search(r"[A-Z]", password):

        return False, "Password must contain at least 1 uppercase letter (A-Z)"

    if not re.search(r"[a-z]", password):

        return False, "Password must contain at least 1 lowercase letter (a-z)"

    if not re.search(r"[0-9]", password):

        return False, "Password must contain at least 1 number (0-9)"

    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?]", password):

        return False, "Password must contain at least 1 special character (!@#$%^&*...)"

    return True, ""



def generate_clinic_id():

    """Generate unique clinic ID like FA23W3"""

    # Generate 2 random letters

    letters = ''.join(random.choices(string.ascii_uppercase, k=2))

    # Generate 2 random digits

    digits = ''.join(random.choices(string.digits, k=2))

    # Generate 3 random letters

    more_letters = ''.join(random.choices(string.ascii_uppercase, k=3))

    

    return f"{letters}{digits}{more_letters}"



def generate_patient_id():

    """

    Generate unique patient ID like PA-7X9K2M4

    Format: PA-XXYYYY where X is letter and Y is alphanumeric

    """

    # Generate 2 random letters

    letters = ''.join(random.choices(string.ascii_uppercase, k=2))

    # Generate 4 random alphanumeric characters (mix of letters and digits)

    alphanumeric = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))

    

    return f"PA-{letters}{alphanumeric}"





async def _send_profile_otp(db: AsyncSession, email: str) -> None:

    existing_result = await db.execute(select(OTPVerification).where(OTPVerification.email == email))

    existing_otp = existing_result.scalar_one_or_none()



    if existing_otp and not existing_otp.is_verified:

        time_since_creation = datetime.utcnow() - existing_otp.created_at.replace(tzinfo=None) if existing_otp.created_at.tzinfo else datetime.utcnow() - existing_otp.created_at

        if time_since_creation.total_seconds() < OTPService.RESEND_COOLDOWN_MINUTES * 60:

            raise HTTPException(

                status_code=status.HTTP_429_TOO_MANY_REQUESTS,

                detail="Please wait before requesting a new OTP"

            )



    if existing_otp:

        await db.delete(existing_otp)

        await db.commit()



    otp_code = OTPService.generate_otp()

    otp_record = OTPVerification(

        email=email,

        otp_code=OTPService.hash_otp(otp_code),

        expires_at=datetime.utcnow().replace(microsecond=0) + timedelta(minutes=OTPService.OTP_EXPIRY_MINUTES),

        user_name="",

        user_password="",

        user_phone=""

    )

    db.add(otp_record)

    await db.commit()



    if not send_otp_email(email, otp_code):

        await db.delete(otp_record)

        await db.commit()

        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail="Failed to send OTP email. Please try again."

        )





async def _verify_profile_otp_or_raise(db: AsyncSession, email: str, otp_code: str) -> None:

    is_valid, message = await OTPService.verify_otp_only(db, email.strip().lower(), otp_code.strip())

    if not is_valid:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail=message

        )

    await OTPService.delete_otp(db, email.strip().lower())



router = APIRouter(prefix="/auth", tags=["authentication"])





def _normalize_clinic_categories(

    category: Optional[str],

    categories: Optional[list[str]],

) -> tuple[str, list[str]]:

    if categories:

        clean_categories = [c.strip() for c in categories if c and c.strip()]

        if clean_categories:

            return ", ".join(clean_categories), clean_categories

    normalized = (category or "").strip()

    if normalized:

        return normalized, [normalized]

    return "", []



@router.post("/clinic/signup", response_model=AuthResponse)

async def clinic_signup(clinic_data: ClinicSignup, db: AsyncSession = Depends(get_db)):

    import traceback

    try:

        # Check if email exists in approved clinics

        result = await db.execute(select(Clinic).where(Clinic.email == clinic_data.email))

        existing_clinic = result.scalar_one_or_none()



        if existing_clinic:

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="You already have an account. Please login instead."

            )



        result = await db.execute(select(RejectedClinic).where(RejectedClinic.email == clinic_data.email))

        rejected_clinic = result.scalar_one_or_none()



        if rejected_clinic:

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="Your clinic registration has been rejected. Please contact support before registering again."

            )



        # Check if email exists in pending registrations

        result = await db.execute(

            select(PendingClinicRegistration)

            .where(PendingClinicRegistration.email == clinic_data.email)

            .where(PendingClinicRegistration.status == "pending")

        )

        existing_pending = result.scalar_one_or_none()



        if existing_pending:

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="A registration request with this email is already pending approval"

            )



        # Validate password strength (same as patient signup)

        valid, error_msg = validate_password_strength(clinic_data.password)

        if not valid:

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail=error_msg

            )



        hashed_password = hash_password(clinic_data.password)



        # Generate unique clinic ID

        clinic_id = generate_clinic_id()



        normalized_category, normalized_categories = _normalize_clinic_categories(clinic_data.category, clinic_data.categories)

        if not normalized_categories:

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="Please select at least one clinic category"

            )



        # Create pending registration with all address components and doctor details

        new_pending_registration = PendingClinicRegistration(

            clinic_id=clinic_id,

            clinic_name=clinic_data.clinic_name,

            email=clinic_data.email,

            password=hashed_password,

            phone=clinic_data.phone,

            category=normalized_category,

            categories=normalized_categories,

            street_address=clinic_data.street_address or clinic_data.address.split(",")[0] if "," in clinic_data.address else clinic_data.address,

            road=clinic_data.road or "",

            layout=clinic_data.layout,

            section=clinic_data.section,

            city=clinic_data.city or "",

            pincode=clinic_data.pincode or "",

            address=clinic_data.address,

            latitude=clinic_data.latitude,

            longitude=clinic_data.longitude,

            # Doctor details

            doctor_name=clinic_data.doctor_name if clinic_data.doctor_name else "",

            specialization=clinic_data.specialization,

            experience=clinic_data.experience,

            qualifications=clinic_data.qualifications,

            status="pending"

        )



        db.add(new_pending_registration)

        await db.commit()

        await db.refresh(new_pending_registration)



        # Send registration received email

        email_sent = send_clinic_registration_received_email(

            clinic_data.email,

            clinic_data.clinic_name

        )



        return AuthResponse(

            message="Registration received. Your application is under review. You will receive a response within 24 hours.",

            clinic_id=clinic_id,

            user_type="pending_clinic"

        )

    except Exception as e:

        await db.rollback()

        error_msg = f"Error during signup: {str(e)}"

        print(error_msg)

        print(traceback.format_exc())

        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail=error_msg

        )





# ============ Clinic Signup with OTP Verification ============



class ClinicSignupOTPRequest(BaseModel):

    email: EmailStr

    clinic_name: str

    password: str

    phone: str

    category: Optional[str] = None

    categories: Optional[list[str]] = None

    address: str

    street_address: Optional[str] = None

    road: Optional[str] = None

    layout: Optional[str] = None

    section: Optional[str] = None

    city: Optional[str] = None

    pincode: Optional[str] = None

    doctor_name: Optional[str] = None

    specialization: Optional[str] = None

    experience: Optional[str] = None

    qualifications: Optional[str] = None

    latitude: Optional[str] = None

    longitude: Optional[str] = None





class ClinicVerifySignupRequest(BaseModel):

    email: EmailStr

    otp: str

    clinic_name: str

    password: str

    phone: str

    category: Optional[str] = None

    categories: Optional[list[str]] = None

    address: str

    street_address: Optional[str] = None

    road: Optional[str] = None

    layout: Optional[str] = None

    section: Optional[str] = None

    city: Optional[str] = None

    pincode: Optional[str] = None

    doctor_name: Optional[str] = None

    specialization: Optional[str] = None

    experience: Optional[str] = None

    qualifications: Optional[str] = None

    latitude: Optional[str] = None

    longitude: Optional[str] = None





@router.post("/clinic/send-signup-otp", response_model=OTPResponse)

async def clinic_send_signup_otp(

    request: ClinicSignupOTPRequest,

    db: AsyncSession = Depends(get_db)

):

    """

    Send OTP for clinic registration verification.

    """

    import logging

    logger = logging.getLogger(__name__)

    

    email = request.email.strip().lower()

    logger.info(f"Clinic signup OTP request for email: {email}")

    

    # Check if email exists in approved clinics

    result = await db.execute(select(Clinic).where(Clinic.email == email))

    if result.scalar_one_or_none():

        logger.warning(f"Email already registered as approved clinic: {email}")

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="You already have an account. Please login instead."

        )



    result = await db.execute(select(RejectedClinic).where(RejectedClinic.email == email))

    if result.scalar_one_or_none():

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Your clinic registration has been rejected. Please contact support before registering again."

        )

    

    # Check if email exists in pending registrations

    result = await db.execute(

        select(PendingClinicRegistration)

        .where(PendingClinicRegistration.email == email)

        .where(PendingClinicRegistration.status == "pending")

    )

    if result.scalar_one_or_none():

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="A registration request with this email is already pending approval"

        )

    

    # Validate password strength

    valid, error_msg = validate_password_strength(request.password)

    if not valid:

        logger.warning(f"Password validation failed for {email}: {error_msg}")

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail=error_msg

        )



    normalized_category, normalized_categories = _normalize_clinic_categories(request.category, request.categories)

    if not normalized_categories:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Please select at least one clinic category"

        )



    # Replace any stale pending OTP before creating a fresh one for clinic signup.

    otp_result = await db.execute(

        select(OTPVerification).where(OTPVerification.email == email)

    )

    existing_otp = otp_result.scalar_one_or_none()



    if existing_otp and not existing_otp.is_verified:

        await db.delete(existing_otp)

        await db.commit()



    hashed_password = hash_password(request.password)



    otp_code, success = await OTPService.create_otp_with_user_data(

        db,

        email,

        name=request.clinic_name,

        password=hashed_password,

        phone=request.phone

    )



    if not success:

        logger.error(f"OTP creation rate limited for {email}")

        raise HTTPException(

            status_code=status.HTTP_429_TOO_MANY_REQUESTS,

            detail="Please wait before requesting a new OTP"

        )



    from app.services.email_service import send_otp as send_otp_email



    logger.info(f"Sending OTP to {email}")

    email_sent = send_otp_email(email, otp_code)



    if not email_sent:

        await OTPService.delete_otp(db, email)

        logger.error(f"Failed to send OTP email to {email}")

        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail="Failed to send OTP email"

        )



    return {

        "success": True,

        "message": "OTP sent to your email. Please verify to complete registration.",

        "email": email,

        "expires_in": 300

    }





@router.post("/clinic/verify-signup", response_model=AuthResponse)

async def clinic_verify_signup(

    request: ClinicVerifySignupRequest,

    db: AsyncSession = Depends(get_db)

):

    """

    Verify OTP and complete clinic registration.

    """

    import traceback

    email = request.email.strip().lower()

    

    # Verify OTP (without creating patient account)

    is_valid, message = await OTPService.verify_otp_only(db, email, request.otp)

    

    if not is_valid:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail=message

        )



    normalized_category, normalized_categories = _normalize_clinic_categories(request.category, request.categories)

    if not normalized_categories:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Please select at least one clinic category"

        )

    

    try:

        # Check again if email exists (might have been registered during OTP wait)

        result = await db.execute(select(Clinic).where(Clinic.email == email))

        if result.scalar_one_or_none():

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="You already have an account. Please login instead."

            )



        result = await db.execute(select(RejectedClinic).where(RejectedClinic.email == email))

        if result.scalar_one_or_none():

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="Your clinic registration has been rejected. Please contact support before registering again."

            )

        

        result = await db.execute(

            select(PendingClinicRegistration)

            .where(PendingClinicRegistration.email == email)

            .where(PendingClinicRegistration.status == "pending")

        )

        if result.scalar_one_or_none():

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="A registration request with this email is already pending approval"

            )

        

        # Hash password

        hashed_password = hash_password(request.password)

        

        # Generate unique clinic ID

        clinic_id = generate_clinic_id()



        # Create pending registration

        new_pending_registration = PendingClinicRegistration(

            clinic_id=clinic_id,

            clinic_name=request.clinic_name,

            email=email,

            password=hashed_password,

            phone=request.phone,

            category=normalized_category,

            categories=normalized_categories,

            street_address=request.street_address or request.address.split(",")[0] if "," in request.address else request.address,

            road=request.road or "",

            layout=request.layout,

            section=request.section,

            city=request.city or "",

            pincode=request.pincode or "",

            address=request.address,

            latitude=request.latitude,

            longitude=request.longitude,

            doctor_name=request.doctor_name or "",

            specialization=request.specialization,

            experience=request.experience,

            qualifications=request.qualifications,

            status="pending"

        )

        

        db.add(new_pending_registration)

        await db.commit()

        await db.refresh(new_pending_registration)

        

        # Delete OTP after successful registration

        await OTPService.delete_otp(db, email)

        

        # Send registration received email

        send_clinic_registration_received_email(

            email,

            request.clinic_name

        )

        

        return AuthResponse(

            message="Registration received. Your application is under review. You will receive a response within 24 hours.",

            clinic_id=clinic_id,

            user_type="pending_clinic"

        )

    except Exception as e:

        await db.rollback()

        error_msg = f"Error during signup: {str(e)}"

        print(error_msg)

        print(traceback.format_exc())

        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail=error_msg

        )



@router.post("/clinic/login", response_model=AuthResponse)

async def clinic_login(login_data: ClinicLogin, db: AsyncSession = Depends(get_db)):

    # First check if there's an approved clinic with this email

    result = await db.execute(select(Clinic).where(Clinic.email == login_data.email))

    clinic = result.scalar_one_or_none()

    

    if clinic:

        # A clinic needs to pin their location if they haven't done it yet

        # OR if for some reason the coordinates are missing.

        first_login = not clinic.has_pinned_location or not clinic.latitude or not clinic.longitude



        if not verify_password(login_data.password, clinic.password):

            raise HTTPException(

                status_code=status.HTTP_401_UNAUTHORIZED,

                detail="Invalid email or password"

            )

        return AuthResponse(

            message="Login successful",

            user_type="clinic",

            clinic_id=clinic.clinic_id,

            first_login=first_login,

            address=clinic.address # Provide address for the frontend to center the map

        )

    

    # Check if there's a pending registration with this email

    result = await db.execute(

        select(PendingClinicRegistration)

        .where(PendingClinicRegistration.email == login_data.email)

        .where(PendingClinicRegistration.status == "pending")

    )

    pending_reg = result.scalar_one_or_none()

    

    if pending_reg:

        # Verify password to confirm it's the right user

        if verify_password(login_data.password, pending_reg.password):

            raise HTTPException(

                status_code=status.HTTP_403_FORBIDDEN,

                detail="Your registration is still pending approval. Please wait for the admin to review your application. You will receive an email once approved."

            )

    

    # Check if there was a rejected registration

    result = await db.execute(

        select(PendingClinicRegistration)

        .where(PendingClinicRegistration.email == login_data.email)

        .where(PendingClinicRegistration.status == "rejected")

    )

    rejected_reg = result.scalar_one_or_none()

    

    if rejected_reg:

        if verify_password(login_data.password, rejected_reg.password):

            raise HTTPException(

                status_code=status.HTTP_403_FORBIDDEN,

                detail="Your registration request has been rejected. Please contact support for more information."

            )

    

    raise HTTPException(

        status_code=status.HTTP_401_UNAUTHORIZED,

        detail="Invalid email or password"

    )



@router.post("/patient/signup", response_model=AuthResponse)

async def patient_signup(patient_data: PatientSignup, db: AsyncSession = Depends(get_db)):

    result = await db.execute(select(Patient).where(Patient.email == patient_data.email))

    existing_patient = result.scalar_one_or_none()

    

    if existing_patient:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Email already registered"

        )

    

    valid, error_msg = validate_password_strength(patient_data.password)

    if not valid:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail=error_msg

        )

    

    # Generate unique patient ID

    patient_id = generate_patient_id()

    

    # Ensure patient_id is unique

    while True:

        check_result = await db.execute(select(Patient).where(Patient.patient_id == patient_id))

        if not check_result.scalar_one_or_none():

            break

        patient_id = generate_patient_id()

    

    hashed_password = hash_password(patient_data.password)

    

    new_patient = Patient(

        patient_id=patient_id,

        name=patient_data.name,

        email=patient_data.email,

        password=hashed_password,

        phone=patient_data.phone

    )

    

    db.add(new_patient)

    await db.commit()

    await db.refresh(new_patient)

    

    return AuthResponse(

        message="Signup successful",

        patient_data={

            "patient_id": patient_id,

            "name": patient_data.name,

            "email": patient_data.email

        }

    )



@router.post("/patient/login", response_model=AuthResponse)

async def patient_login(login_data: PatientLogin, db: AsyncSession = Depends(get_db)):

    result = await db.execute(select(Patient).where(Patient.email == login_data.email))

    patient = result.scalar_one_or_none()

    

    if not patient or not verify_password(login_data.password, patient.password):

        raise HTTPException(

            status_code=status.HTTP_401_UNAUTHORIZED,

            detail="Invalid email or password"

        )

    

    return AuthResponse(

        message="Login successful",

        user_type="patient",

        patient_data={

            "patient_id": patient.patient_id,

            "name": patient.name,

            "email": patient.email

        }

    )



# Get Patient Data Endpoint

@router.get("/patient/data")

async def get_patient_data(

    email: str = Query(..., description="Patient email"),

    db: AsyncSession = Depends(get_db)

):

    result = await db.execute(select(Patient).where(Patient.email == email))

    patient = result.scalar_one_or_none()

    

    if not patient:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Patient not found"

        )

    

    # Return patient data (excluding password)

    return {

        "patient_id": patient.patient_id,

        "id": patient.id,

        "name": patient.name,

        "email": patient.email,

        "phone": patient.phone,

        "created_at": patient.created_at

    }



# Get Clinic Data Endpoint

@router.get("/clinic/data")

async def get_clinic_data(

    clinic_id: str = Query(..., description="Clinic ID"),

    db: AsyncSession = Depends(get_db)

):

    result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))

    clinic = result.scalar_one_or_none()

    

    if not clinic:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic not found"

        )

    

    # Return clinic data (excluding password)

    return {

        "clinic_id": clinic.clinic_id,

        "clinic_name": clinic.clinic_name,

        "email": clinic.email,

        "phone": clinic.phone,

        "category": clinic.category or "",

        "categories": clinic.categories or ([] if not clinic.category else [clinic.category]),

        "address": clinic.address,

        "street_address": clinic.street_address,

        "road": clinic.road,

        "layout": clinic.layout,

        "section": clinic.section,

        "city": clinic.city,

        "pincode": clinic.pincode,

        "latitude": clinic.latitude,

        "longitude": clinic.longitude,

        "image_urls": clinic.image_urls or [],

        "doctor_name": clinic.doctor_name,

        "available": clinic.available,

        "created_at": clinic.created_at,

        "full_formatted_address": ", ".join(filter(None, [

            clinic.street_address,

            clinic.road,

            clinic.layout,

            clinic.section,

            clinic.city,

            clinic.pincode

        ])) or clinic.address or ""

    }



# List All Clinics Endpoint

@router.get("/clinics/list")

async def list_clinics(db: AsyncSession = Depends(get_db)):

    """

    List all clinics for patient to browse.

    Only shows clinics that are active for patient discovery.

    """

    result = await db.execute(

        select(Clinic).where(Clinic.is_active == True)

    )

    clinics = result.scalars().all()



    clinics_updated = False

    

    clinic_list = []

    for clinic in clinics:

        if not clinic.latitude or not clinic.longitude:

            latitude, longitude = get_coordinates_from_structured_address(

                clinic.street_address or "",

                clinic.road or "",

                clinic.layout,

                clinic.section,

                clinic.city or "",

                clinic.pincode or ""

            )

            if latitude and longitude:

                clinic.latitude = latitude

                clinic.longitude = longitude

                clinics_updated = True



        # Support single or comma-separated multi categories.

        specializations = [

            part.strip().lower()

            for part in (clinic.categories or ([clinic.category] if clinic.category else []))

            if part and part.strip()

        ] or ["general"]

        

        # Build doctors array from actual doctor_name

        doctors = []

        if clinic.doctor_name:

            doctors.append({

                "name": clinic.doctor_name,

                "specialization": clinic.specialization or "",

                "experience": clinic.experience or ""

            })

        

        clinic_list.append({

            "id": clinic.id,

            "clinic_id": clinic.clinic_id,

            "clinic_name": clinic.clinic_name,

            "email": clinic.email,

            "phone": clinic.phone,

            "address": clinic.address,

            "street_address": clinic.street_address,

            "road": clinic.road,

            "layout": clinic.layout,

            "section": clinic.section,

            "city": clinic.city or "",

            "pincode": clinic.pincode,

            "category": clinic.category or "",

            "categories": clinic.categories or ([] if not clinic.category else [clinic.category]),

            "doctor_name": clinic.doctor_name or "",

            "specialization": clinic.specialization or "",

            "experience": clinic.experience or "",

            "qualifications": clinic.qualifications or "",

            "latitude": clinic.latitude,

            "longitude": clinic.longitude,

            "specializations": specializations,

            "doctors": doctors if doctors else [{"name": "Available Doctor"}],

            "is_active": clinic.is_active or False,

            "available": clinic.available or False

        })



    if clinics_updated:

        await db.commit()

    

    return {"clinics": clinic_list}



# Clinic Profile Management Endpoints

@router.post("/clinic/send-profile-otp", response_model=OTPResponse)

async def clinic_send_profile_otp(

    request: ClinicProfileOTPRequest,

    db: AsyncSession = Depends(get_db)

):

    result = await db.execute(select(Clinic).where(Clinic.clinic_id == request.clinic_id))

    clinic = result.scalar_one_or_none()



    if not clinic:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic not found"

        )



    await _send_profile_otp(db, clinic.email.strip().lower())

    return OTPResponse(

        message=f"OTP sent to {clinic.email}",

        success=True,

        expires_in=OTPService.OTP_EXPIRY_MINUTES * 60

    )



@router.put("/clinic/change-phone")

async def clinic_change_phone(

    request: ChangePhoneRequest,

    db: AsyncSession = Depends(get_db)

):

    if not request.clinic_id:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="clinic_id is required"

        )



    result = await db.execute(select(Clinic).where(Clinic.clinic_id == request.clinic_id))

    clinic = result.scalar_one_or_none()

    

    if not clinic:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic not found"

        )

    

    await _verify_profile_otp_or_raise(db, clinic.email, request.otp_code)



    clinic.phone = request.new_phone

    await db.commit()

    

    return {"message": "Phone number updated successfully"}



@router.put("/clinic/change-password")

async def clinic_change_password(

    request: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db)
):
    try:
        if not request.clinic_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="clinic_id is required"
            )

        result = await db.execute(select(Clinic).where(Clinic.clinic_id == request.clinic_id))

        clinic = result.scalar_one_or_none()
        
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Clinic not found"
            )
        
        # Verify current password (skip for forgot password flow)
        is_forgot_flow = request.current_password == "FORGOT_PASSWORD_PLACEHOLDER"
        
        if not is_forgot_flow and not verify_password(request.current_password, clinic.password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Current password is incorrect"
            )

        valid, error_msg = validate_password_strength(request.new_password)

        if not valid:

            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )

        await _verify_profile_otp_or_raise(db, clinic.email, request.otp_code)

        clinic.password = hash_password(request.new_password)

        await db.commit()
        
        return {"message": "Password changed successfully"}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error: {str(e)}"
        )


@router.post("/clinic/verify-current-password")

async def clinic_verify_current_password(

    request: dict,

    db: AsyncSession = Depends(get_db)

):

    clinic_id = request.get("clinic_id")

    password = request.get("password")



    if not clinic_id or not password:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="clinic_id and password are required"

        )



    result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))

    clinic = result.scalar_one_or_none()



    if not clinic:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic not found"

        )



    if not verify_password(password, clinic.password):

        raise HTTPException(

            status_code=status.HTTP_401_UNAUTHORIZED,

            detail="Current password is incorrect"

        )



    return {"message": "Password verified successfully"}


@router.put("/clinic/change-password-direct")

async def clinic_change_password_direct(

    request: dict,

    db: AsyncSession = Depends(get_db)

):

    clinic_id = request.get("clinic_id")

    current_password = request.get("current_password")

    new_password = request.get("new_password")



    if not clinic_id or not current_password or not new_password:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="All fields are required"

        )



    result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))

    clinic = result.scalar_one_or_none()



    if not clinic:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic not found"

        )



    if not verify_password(current_password, clinic.password):

        raise HTTPException(

            status_code=status.HTTP_401_UNAUTHORIZED,

            detail="Current password is incorrect"

        )



    valid, error_msg = validate_password_strength(new_password)

    if not valid:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail=error_msg

        )



    clinic.password = hash_password(new_password)

    await db.commit()



    return {"message": "Password changed successfully"}


@router.put("/clinic/update-profile")

async def update_clinic_profile(

    request: dict,

    db: AsyncSession = Depends(get_db)

):

    """Update clinic address and images"""

    clinic_id = request.get("clinic_id")

    address = request.get("address")

    image_urls = request.get("image_urls")

    street_address = request.get("street_address")

    road = request.get("road")

    layout = request.get("layout")

    section = request.get("section")

    city = request.get("city")

    pincode = request.get("pincode")

    latitude = request.get("latitude")

    longitude = request.get("longitude")

    

    if not clinic_id:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="clinic_id is required"

        )

    

    result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))

    clinic = result.scalar_one_or_none()

    

    if not clinic:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic not found"

        )

    

    # Update address if provided

    if address is not None:

        clinic.address = address



    if street_address is not None:

        clinic.street_address = street_address

    if road is not None:

        clinic.road = road

    if layout is not None:

        clinic.layout = layout

    if section is not None:

        clinic.section = section

    if city is not None:

        clinic.city = city

    if pincode is not None:

        clinic.pincode = pincode

    if latitude is not None:

        clinic.latitude = latitude

    if longitude is not None:

        clinic.longitude = longitude

    

    # Update image URLs if provided (max 5 images)

    if image_urls is not None:

        # Ensure only 5 images max

        clinic.image_urls = image_urls[:5] if len(image_urls) > 5 else image_urls



    address_changed = any(

        value is not None

        for value in [address, street_address, road, layout, section, city, pincode]

    )



    if address_changed:

        otp_code = request.get("otp_code")

        if not otp_code:

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="otp_code is required to update address"

            )

        await _verify_profile_otp_or_raise(db, clinic.email, otp_code)



    # Build full formatted address from structured fields

    full_parts = []

    if clinic.street_address:

        full_parts.append(clinic.street_address)

    if clinic.road:

        full_parts.append(clinic.road)

    if clinic.layout:

        full_parts.append(clinic.layout)

    if clinic.section:

        full_parts.append(clinic.section)

    if clinic.city:

        full_parts.append(clinic.city)

    if clinic.pincode:

        full_parts.append(clinic.pincode)

    

    full_formatted_address = ", ".join(full_parts) if full_parts else clinic.address

    clinic.address = full_formatted_address

    

    if address_changed:

        clinic.latitude = None

        clinic.longitude = None

        clinic.has_pinned_location = False

    

    await db.commit()

    

    return {

        "message": "Profile updated successfully",

        "address": clinic.address,

        "full_formatted_address": full_formatted_address,

        "street_address": clinic.street_address,

        "road": clinic.road,

        "layout": clinic.layout,

        "section": clinic.section,

        "city": clinic.city,

        "pincode": clinic.pincode,

        "image_urls": clinic.image_urls or [],

        "latitude": clinic.latitude,

        "longitude": clinic.longitude

    }



@router.put("/clinic/update-location")

async def update_clinic_location(

    request: dict,

    db: AsyncSession = Depends(get_db)

):

    """Update clinic location with pinned coordinates (no geocoding)"""

    clinic_id = request.get("clinic_id")

    latitude = request.get("latitude")

    longitude = request.get("longitude")

    address = request.get("address")

    

    if not clinic_id:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="clinic_id is required"

        )

    

    if not latitude or not longitude:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="latitude and longitude are required"

        )

    

    result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))

    clinic = result.scalar_one_or_none()

    

    if not clinic:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic not found"

        )

    

    clinic.latitude = latitude

    clinic.longitude = longitude

    clinic.has_pinned_location = True

    

    if address:

        clinic.address = address

    

    await db.commit()

    

    return {

        "message": "Location updated successfully",

        "latitude": clinic.latitude,

        "longitude": clinic.longitude,

        "has_pinned_location": clinic.has_pinned_location

    }



@router.post("/clinic/upload-image")

async def upload_clinic_image(

    clinic_id: str = Form(...),

    file: UploadFile = File(...),

    db: AsyncSession = Depends(get_db)

):

    """Upload clinic image and store binary data in database"""

    

    # Validate clinic exists

    result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))

    clinic = result.scalar_one_or_none()

    

    if not clinic:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic not found"

        )

    

    # Check current image count

    current_images = clinic.image_urls or []

    if len(current_images) >= 5:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Maximum 5 images allowed. Please delete an image first."

        )

    

    # Validate file type - accept any image type

    if not file.content_type or not file.content_type.startswith("image/"):

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Invalid file type. Please upload an image file."

        )

    

    # Validate file size (max 5MB)

    MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB

    contents = await file.read()

    if len(contents) > MAX_FILE_SIZE:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="File size exceeds 5MB limit. Please upload a smaller image."

        )

    

    # Convert to base64

    import base64

    image_data_b64 = base64.b64encode(contents).decode('utf-8')

    

    # Find or create ClinicImage record for this clinic

    result = await db.execute(select(ClinicImage).where(ClinicImage.clinic_id == clinic_id))

    clinic_image_record = result.scalar_one_or_none()

    

    if not clinic_image_record:

        # Create new record with first image

        clinic_image_record = ClinicImage(

            clinic_id=clinic_id,

            images=[{

                "image_data": image_data_b64,

                "image_type": file.content_type,

                "uploaded_at": datetime.now().isoformat()

            }]

        )

        db.add(clinic_image_record)

        await db.flush()

    else:

        # Fill empty slots first (null values)

        current_images = list(clinic_image_record.images) if clinic_image_record.images else []

        

        # Count non-null images

        non_null_count = sum(1 for img in current_images if img is not None)

        

        if non_null_count >= 5:

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="Maximum 5 images allowed. Please delete an image first."

            )

        

        # Find first empty slot (null)

        empty_slot_index = None

        for i, img in enumerate(current_images):

            if img is None:

                empty_slot_index = i

                break

        

        if empty_slot_index is not None:

            # Fill the empty slot

            current_images[empty_slot_index] = {

                "image_data": image_data_b64,

                "image_type": file.content_type,

                "uploaded_at": datetime.now().isoformat()

            }

        else:

            # No empty slots, append new image

            current_images.append({

                "image_data": image_data_b64,

                "image_type": file.content_type,

                "uploaded_at": datetime.now().isoformat()

            })

        

        clinic_image_record.images = current_images

        await db.flush()

    

    # Sync clinic.image_urls - keep nulls for deleted images

    all_images = list(clinic_image_record.images) if clinic_image_record.images else []

    new_urls = []

    for i, img in enumerate(all_images):

        if img is not None:

            new_urls.append(f"/auth/clinic/image/{clinic_id}/{i}")

        else:

            new_urls.append(None)

    clinic.image_urls = new_urls

    

    await db.commit()

    

    # Return the filled slot index

    filled_index = None

    for i, img in enumerate(all_images):

        if img is not None and (empty_slot_index is None or i == empty_slot_index):

            if empty_slot_index is not None:

                filled_index = i

                break

            elif i == len(all_images) - 1:

                filled_index = i

                break

    

    return {

        "message": "Image uploaded successfully",

        "image_url": f"/auth/clinic/image/{clinic_id}/{filled_index}" if filled_index is not None else "",

        "filled_index": filled_index,

        "total_images": sum(1 for img in all_images if img is not None),

        "image_urls": new_urls

    }



@router.get("/clinic/image/{clinic_id}/{image_index}")

async def get_clinic_image(

    clinic_id: str,

    image_index: int,

    db: AsyncSession = Depends(get_db)

):

    """Serve clinic image from JSON array in database"""

    import base64

    

    result = await db.execute(select(ClinicImage).where(ClinicImage.clinic_id == clinic_id))

    clinic_image_record = result.scalar_one_or_none()

    

    if not clinic_image_record or not clinic_image_record.images:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic images not found"

        )

    

    images = clinic_image_record.images

    if image_index < 0 or image_index >= len(images):

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Image index out of range"

        )

    

    image_data = images[image_index]

    image_bytes = base64.b64decode(image_data["image_data"])

    

    from fastapi.responses import Response

    return Response(

        content=image_bytes,

        media_type=image_data["image_type"]

    )



@router.delete("/clinic/image/{clinic_id}/{image_index}")

async def delete_clinic_image(

    clinic_id: str,

    image_index: int,

    db: AsyncSession = Depends(get_db)

):

    """Delete a clinic image by index - renumbers remaining images"""

    # Get clinic image record

    result = await db.execute(select(ClinicImage).where(ClinicImage.clinic_id == clinic_id))

    clinic_image_record = result.scalar_one_or_none()

    

    if not clinic_image_record or not clinic_image_record.images:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic images not found"

        )

    

    images = clinic_image_record.images or []

    if image_index < 0 or image_index >= len(images):

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Image index out of range"

        )

    

    # Remove the image at index and renumber remaining

    remaining_images = [img for i, img in enumerate(images) if i != image_index]

    clinic_image_record.images = remaining_images

    

    # Update clinic.image_urls with renumbered URLs

    clinic_result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))

    clinic = clinic_result.scalar_one_or_none()

    if clinic:

        new_urls = [f"/auth/clinic/image/{clinic_id}/{i}" for i in range(len(remaining_images))]

        clinic.image_urls = new_urls

    

    await db.commit()

    

    return {

        "message": "Image deleted successfully", 

        "deleted_index": image_index,

        "total_images": len(remaining_images),

        "image_urls": new_urls if clinic else []

    }



@router.delete("/clinic/delete")

async def clinic_delete_account(

    request: DeleteClinicRequest,

    db: AsyncSession = Depends(get_db)

):

    result = await db.execute(select(Clinic).where(Clinic.clinic_id == request.clinic_id))

    clinic = result.scalar_one_or_none()

    

    if not clinic:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic not found"

        )

    

    # Verify password

    if not verify_password(request.password, clinic.password):

        raise HTTPException(

            status_code=status.HTTP_401_UNAUTHORIZED,

            detail="Password is incorrect"

        )

    

    # Verify confirmation

    if request.confirmation != "DELETE":

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Confirmation must be 'DELETE'"

        )



    await _verify_profile_otp_or_raise(db, clinic.email, request.otp_code)



    await db.delete(clinic)

    await db.commit()

    

    return {"message": "Account deleted successfully"}



# Patient Profile Management Endpoints

@router.post("/patient/send-profile-otp", response_model=OTPResponse)

async def patient_send_profile_otp(

    request: PatientProfileOTPRequest,

    db: AsyncSession = Depends(get_db)

):

    email = request.patient_email.strip().lower()

    result = await db.execute(select(Patient).where(Patient.email == email))

    patient = result.scalar_one_or_none()



    if not patient:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Patient not found"

        )



    await _send_profile_otp(db, email)

    return OTPResponse(

        message=f"OTP sent to {email}",

        success=True,

        expires_in=OTPService.OTP_EXPIRY_MINUTES * 60

    )



@router.put("/patient/change-password")

async def patient_change_password(

    request: ChangePasswordRequest,

    db: AsyncSession = Depends(get_db)

):

    result = await db.execute(select(Patient).where(Patient.email == request.patient_email))

    patient = result.scalar_one_or_none()

    

    if not patient:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Patient not found"

        )

    

    # Verify current password (skip for forgot password flow)
    is_forgot_flow = request.current_password == "FORGOT_PASSWORD_PLACEHOLDER"
    
    if not is_forgot_flow and not verify_password(request.current_password, patient.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect"
        )



    valid, error_msg = validate_password_strength(request.new_password)

    if not valid:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail=error_msg

        )



    await _verify_profile_otp_or_raise(db, patient.email, request.otp_code)



    patient.password = hash_password(request.new_password)

    await db.commit()

    

    return {"message": "Password changed successfully"}


@router.post("/patient/verify-current-password")

async def patient_verify_current_password(

    request: dict,

    db: AsyncSession = Depends(get_db)

):

    patient_email = request.get("patient_email")

    password = request.get("current_password") or request.get("password")



    if not patient_email or not password:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="patient_email and current_password are required"

        )



    result = await db.execute(select(Patient).where(Patient.email == patient_email))

    patient = result.scalar_one_or_none()



    if not patient:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Patient not found"

        )



    if not verify_password(password, patient.password):

        raise HTTPException(

            status_code=status.HTTP_401_UNAUTHORIZED,

            detail="Current password is incorrect"

        )



    return {"message": "Password verified successfully"}


@router.put("/patient/change-password-direct")

async def patient_change_password_direct(

    request: dict,

    db: AsyncSession = Depends(get_db)

):

    patient_email = request.get("patient_email")

    current_password = request.get("current_password")

    new_password = request.get("new_password")



    if not patient_email or not current_password or not new_password:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="All fields are required"

        )



    result = await db.execute(select(Patient).where(Patient.email == patient_email))

    patient = result.scalar_one_or_none()



    if not patient:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Patient not found"

        )



    if not verify_password(current_password, patient.password):

        raise HTTPException(

            status_code=status.HTTP_401_UNAUTHORIZED,

            detail="Current password is incorrect"

        )



    valid, error_msg = validate_password_strength(new_password)

    if not valid:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail=error_msg

        )



    patient.password = hash_password(new_password)

    await db.commit()



    return {"message": "Password changed successfully"}



@router.put("/patient/change-phone")

async def patient_change_phone(

    request: ChangePhoneRequest,

    db: AsyncSession = Depends(get_db)

):

    result = await db.execute(select(Patient).where(Patient.email == request.patient_email))

    patient = result.scalar_one_or_none()

    

    if not patient:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Patient not found"

        )

    

    await _verify_profile_otp_or_raise(db, patient.email, request.otp_code)



    patient.phone = request.new_phone

    await db.commit()

    

    return {"message": "Phone number updated successfully"}



@router.delete("/patient/delete-account")

async def patient_delete_account(

    request: DeleteAccountRequest,

    db: AsyncSession = Depends(get_db)

):

    result = await db.execute(select(Patient).where(Patient.email == request.patient_email))

    patient = result.scalar_one_or_none()

    

    if not patient:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Patient not found"

        )

    

    # Verify password

    if not verify_password(request.password, patient.password):

        raise HTTPException(

            status_code=status.HTTP_401_UNAUTHORIZED,

            detail="Password is incorrect"

        )

    

    # Verify confirmation

    if request.confirmation != "DELETE":

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Confirmation must be 'DELETE'"

        )



    await _verify_profile_otp_or_raise(db, patient.email, request.otp_code)



    await db.delete(patient)

    await db.commit()

    

    return {"message": "Account deleted successfully"}



@router.post("/clinic/pin-location")

async def pin_clinic_location(

    request: dict,

    db: AsyncSession = Depends(get_db)

):

    """

    Update clinic's exact location and mark as pinned.

    Expects clinic_id, latitude, and longitude.

    """

    clinic_id = request.get("clinic_id")

    lat = request.get("latitude")

    lon = request.get("longitude")



    if not all([clinic_id, lat, lon]):

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="clinic_id, latitude, and longitude are required"

        )



    result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))

    clinic = result.scalar_one_or_none()



    if not clinic:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Clinic not found"

        )



    clinic.latitude = str(lat)

    clinic.longitude = str(lon)

    clinic.has_pinned_location = True



    await db.commit()



    return {

        "message": "Location pinned successfully",

        "latitude": clinic.latitude,

        "longitude": clinic.longitude

    }



# ============= OTP VERIFICATION ENDPOINTS =============



@router.post("/register/send-otp", response_model=OTPResponse)

async def register_send_otp(

    request: PatientSignup,  # Reuse PatientSignup schema for user data

    db: AsyncSession = Depends(get_db)

):

    """

    Store user data and send OTP for registration.

    This is the first step in the OTP registration flow.

    """

    email = request.email.strip().lower()

    

    # Check if patient already exists (already verified)

    result = await db.execute(select(Patient).where(Patient.email == email))

    existing_patient = result.scalar_one_or_none()

    

    if existing_patient:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Email already registered"

        )

    

    valid, error_msg = validate_password_strength(request.password)

    if not valid:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail=error_msg

        )

    

    # Check if there's already a pending OTP

    from app.database.models import OTPVerification

    otp_result = await db.execute(

        select(OTPVerification).where(OTPVerification.email == email)

    )

    existing_otp = otp_result.scalar_one_or_none()

    

    if existing_otp and not existing_otp.is_verified:

        # Delete existing pending record

        await db.delete(existing_otp)

        await db.commit()

    

    # Hash password

    hashed_password = hash_password(request.password)

    

    # Create OTP with user data

    otp_code, success = await OTPService.create_otp_with_user_data(

        db, email,

        name=request.name,

        password=hashed_password,

        phone=request.phone

    )

    

    if not success:

        raise HTTPException(

            status_code=status.HTTP_429_TOO_MANY_REQUESTS,

            detail="Please wait before requesting a new OTP"

        )

    

    # Send OTP via email

    from app.services.email_service import send_otp as send_otp_email

    email_sent = send_otp_email(email, otp_code)

    

    if not email_sent:

        # Delete OTP record if email failed

        otp_result = await db.execute(

            select(OTPVerification).where(OTPVerification.email == email)

        )

        otp_record = otp_result.scalar_one_or_none()

        if otp_record:

            await db.delete(otp_record)

            await db.commit()

        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail="Failed to send OTP email"

        )

    

    return {

        "message": f"OTP sent to {email}",

        "success": True,

        "expires_in": 300  # 5 minutes in seconds

    }



@router.post("/send-otp", response_model=OTPResponse)

async def send_otp(request: SendOTPRequest, db: AsyncSession = Depends(get_db)):

    """

    Send OTP to email for verification (resend case).

    """

    email = request.email.strip().lower()

    

    # Check if patient already exists (already verified)

    result = await db.execute(select(Patient).where(Patient.email == email))

    existing_patient = result.scalar_one_or_none()

    

    if existing_patient:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Email already registered and verified"

        )

    

    # Send OTP

    success, message = await OTPService.send_otp(db, email)

    

    if not success:

        raise HTTPException(

            status_code=status.HTTP_429_TOO_MANY_REQUESTS,

            detail=message

        )

    

    return {

        "message": message,

        "success": True,

        "expires_in": 300  # 5 minutes in seconds

    }



@router.post("/verify-otp", response_model=OTPVerifyResponse)

async def verify_otp(request: VerifyOTPRequest, db: AsyncSession = Depends(get_db)):

    """

    Verify OTP code and create patient account.

    """

    email = request.email.strip().lower()

    otp_code = request.otp_code.strip()

    

    # Verify OTP

    success, message = await OTPService.verify_otp(db, email, otp_code)

    

    if not success:

        return OTPVerifyResponse(

            message=message,

            success=False,

            verified=False

        )

    

    # OTP verified - delete the OTP record

    await OTPService.delete_otp(db, email)

    

    return OTPVerifyResponse(

        message="OTP verified successfully",

        success=True,

        verified=True

    )



@router.post("/resend-otp", response_model=OTPResponse)

async def resend_otp(request: SendOTPRequest, db: AsyncSession = Depends(get_db)):

    """

    Resend OTP to email.

    """

    email = request.email.strip().lower()

    

    # Resend OTP

    success, message = await OTPService.resend_otp(db, email)

    

    if not success:

        raise HTTPException(

            status_code=status.HTTP_429_TOO_MANY_REQUESTS,

            detail=message

        )

    

    return {

        "message": message,

        "success": True,

        "expires_in": 300  # 5 minutes in seconds

    }



@router.get("/otp/status")

async def get_otp_status(email: str = Query(..., description="Email to check"), db: AsyncSession = Depends(get_db)):

    """

    Check if email has been verified.

    """

    from app.services.otp_service import OTPService

    is_verified = await OTPService.is_email_verified(db, email)

    

    return {

        "email": email,

        "is_verified": is_verified

    }



# ============= APPOINTMENT ENDPOINTS =============



@router.post("/appointments/create")

async def create_appointment(

    request: dict,

    db: AsyncSession = Depends(get_db)

):

    """

    Create a new appointment with auto-incrementing token number.

    Stop booking X minutes before clinic end time.

    """

    try:

        from datetime import datetime, timedelta

        

        clinic_id = request.get("clinic_id")

        patient_id = request.get("patient_id")

        patient_name = request.get("patient_name")

        patient_email = request.get("patient_email")

        patient_phone = request.get("patient_phone", "")

        doctor_name = request.get("doctor_name", "")

        date = request.get("date")

        time = request.get("time")

        slot_id = request.get("slot_id")

        

        if not all([clinic_id, patient_id, patient_name, patient_email, date, time]):

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="Missing required fields"

            )

        

        result = await db.execute(

            select(Clinic).where(Clinic.clinic_id == clinic_id)

        )

        clinic = result.scalar_one_or_none()

        

        if not clinic:

            raise HTTPException(

                status_code=status.HTTP_404_NOT_FOUND,

                detail="Clinic not found"

            )

        

        if clinic.end is not None:

            now = datetime.now(CLINIC_TIMEZONE)

            cutoff_minutes = clinic.booking_cutoff_minutes or 15

            end_hour = clinic.end

            end_time_today = now.replace(hour=end_hour, minute=0, second=0, microsecond=0)

            cutoff_time = end_time_today - timedelta(minutes=cutoff_minutes)

            if now >= cutoff_time:

                raise HTTPException(

                    status_code=status.HTTP_400_BAD_REQUEST,

                    detail=f"Booking closed — doctor will not be available before end time. Last booking at {cutoff_time.strftime('%H:%M')}."

                )

        

        result = await db.execute(

            select(Appointment).where(

                Appointment.clinic_id == clinic_id,

                Appointment.patient_email == patient_email,

                Appointment.date == date

            )

        )

        existing_appointment = result.scalar_one_or_none()

        

        if existing_appointment:

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="You already have an appointment booked for this clinic on this date"

            )



        result = await db.execute(

            select(Appointment).where(

                Appointment.clinic_id == clinic_id,

                Appointment.date == date,

                Appointment.status.in_(["booked", "serving"])

            )

        )

        active_online = len(result.scalars().all())



        result = await db.execute(

            select(QRAppointment).where(

                QRAppointment.clinic_id == clinic_id,

                QRAppointment.date == date,

                QRAppointment.status.in_(["booked", "serving"])

            )

        )

        active_walkin = len(result.scalars().all())



        is_first_active_patient = (active_online + active_walkin) == 0

        

        max_token = -1

        

        result = await db.execute(

            select(Appointment).where(

                Appointment.clinic_id == clinic_id,

                Appointment.date == date,

                Appointment.slot_id == slot_id

            )

        )

        for apt in result.scalars().all():

            if apt.appointment_token:

                try:

                    token_num = int(apt.appointment_token.replace("T-", ""))

                    if token_num > max_token:

                        max_token = token_num

                except Exception:

                    pass

        

        result = await db.execute(

            select(QRAppointment).where(

                QRAppointment.clinic_id == clinic_id,

                QRAppointment.date == date,

                QRAppointment.slot_id == slot_id

            )

        )

        for apt in result.scalars().all():

            if apt.appointment_token:

                try:

                    token_num = int(apt.appointment_token.replace("T-", ""))

                    if token_num > max_token:

                        max_token = token_num

                except Exception:

                    pass



        result = await db.execute(

            select(CompletedAppointment).where(

                CompletedAppointment.clinic_id == clinic_id,

                CompletedAppointment.date == date,

                CompletedAppointment.slot_id == slot_id,

            )

        )

        for apt in result.scalars().all():

            if apt.appointment_token:

                try:

                    token_num = int(apt.appointment_token.replace("T-", ""))

                    if token_num > max_token:

                        max_token = token_num

                except Exception:

                    pass



        next_token_number = max_token + 1

        appointment_token = f"T-{next_token_number}"



        # Calculate queue position

        queue_position = active_online + active_walkin + 1



        new_appointment = Appointment(

            appointment_token=appointment_token,

            clinic_id=clinic_id,

            patient_id=patient_id,

            patient_name=patient_name,

            patient_email=patient_email,

            patient_phone=patient_phone or "Not provided",

            doctor_name=doctor_name,

            date=date,

            time=time,

            status="booked",

            slot_id=slot_id,

            queue_position=queue_position

        )

        

        db.add(new_appointment)

        await db.commit()

        await db.refresh(new_appointment)



        # Smart Reach-Turn Logic: Send immediate email if booking during active slot with 0-1 people ahead

        try:

            from datetime import datetime, timezone

            from app.database.models import ClinicTimeSlot

            from app.services.email_service import send_queue_alert



            now = datetime.now()

            current_time_decimal = now.hour + now.minute / 60.0



            # Get clinic time slots

            slot_result = await db.execute(

                select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)

            )

            slot_record = slot_result.scalar_one_or_none()



            if slot_record and slot_id is not None:

                slots = slot_record.slots

                if isinstance(slots, str):

                    import json

                    slots = json.loads(slots)

                slots = list(slots or [])



                # Find the slot being booked

                slot_index = int(slot_id) - 1

                if 0 <= slot_index < len(slots):

                    slot = slots[slot_index]

                    time_range = slot.get("time_range", [0, 0])

                    start_time = time_range[0]

                    end_time = time_range[1]



                    # Check if booking is during active slot time

                    if start_time <= current_time_decimal < end_time and slot.get("is_open"):

                        # Count people ahead in same slot

                        result = await db.execute(

                            select(Appointment).where(

                                Appointment.clinic_id == clinic_id,

                                Appointment.date == date,

                                Appointment.slot_id == slot_id,

                                Appointment.status.in_(["booked", "serving"]),

                                Appointment.id < new_appointment.id

                            ).order_by(Appointment.id)

                        )

                        people_ahead = len(result.scalars().all())



                        # If 0-1 people ahead, send immediate reach-turn email

                        if people_ahead <= 1:

                            clinic_result = await db.execute(

                                select(Clinic).where(Clinic.clinic_id == clinic_id)

                            )

                            clinic = clinic_result.scalar_one_or_none()



                            email_sent = send_queue_alert(

                                patient_email,

                                patient_name,

                                clinic.clinic_name if clinic else clinic_id,

                                "reach_turn",

                                token_number=appointment_token,

                                doctor_name=doctor_name or (clinic.doctor_name if clinic else ""),

                                clinic_location=clinic.address if clinic else "",

                                latitude=clinic.latitude if clinic else None,

                                longitude=clinic.longitude if clinic else None,

                            )



                            if email_sent:

                                # Set notification stage to prevent duplicate emails

                                new_appointment.notification_stage = "reach_turn"

                                await db.commit()

                                await db.refresh(new_appointment)

        except Exception as email_error:

            # Don't fail the booking if email fails

            print(f"Smart reach-turn email failed: {email_error}")



        return {

            "message": "Appointment booked successfully",

            "appointment_id": new_appointment.id,

            "token": appointment_token,

            "slot_id": slot_id,

            "patient_name": patient_name,

            "patient_phone": patient_phone,

            "patient_email": patient_email,

            "clinic_id": clinic_id,

            "date": date,

            "time": time

        }

    except HTTPException:

        raise

    except Exception as e:

        raise HTTPException(status_code=500, detail=f"Failed to create appointment: {str(e)}")



@router.get("/appointments/clinic/{clinic_id}")

async def get_clinic_appointments(

    clinic_id: str,

    db: AsyncSession = Depends(get_db)

):

    """

    Get all appointments for a specific clinic.

    """

    result = await db.execute(

        select(Appointment).where(Appointment.clinic_id == clinic_id).order_by(Appointment.id)

    )

    appointments = result.scalars().all()

    

    appointment_list = []

    for apt in appointments:

        appointment_list.append({

            "id": apt.id,

            "token": apt.appointment_token,

            "patient_id": apt.patient_id,

            "patient_name": apt.patient_name,

            "patient_email": apt.patient_email,

            "patient_phone": apt.patient_phone,

            "doctor_name": apt.doctor_name,

            "date": apt.date,

            "time": apt.time,

            "status": apt.status,

            "created_at": apt.created_at

        })

    

    return {

        "appointments": appointment_list,

        "total": len(appointment_list),

        "active_slot_id": active_slot_id,

        "viewing_slot_id": viewing_slot_id,

    }



@router.get("/appointments/patient/{patient_id}")

async def get_patient_appointments(

    patient_id: str,

    db: AsyncSession = Depends(get_db)

):

    """

    Get all appointments for a specific patient.

    """

    result = await db.execute(

        select(Appointment).where(Appointment.patient_id == patient_id).order_by(Appointment.id)

    )

    appointments = result.scalars().all()

    

    appointment_list = []

    for apt in appointments:

        appointment_list.append({

            "id": apt.id,

            "token": apt.appointment_token,

            "clinic_id": apt.clinic_id,

            "doctor_name": apt.doctor_name,

            "date": apt.date,

            "time": apt.time,

            "status": apt.status

        })

    

    return {"appointments": appointment_list, "total": len(appointment_list)}



@router.get("/patient/appointments")

async def get_patient_appointments_by_email(

    email: str = Query(..., description="Patient email"),

    db: AsyncSession = Depends(get_db)

):

    """

    Get all appointments for a specific patient by email.

    """

    try:

        from app.database.models import Clinic

        

        result = await db.execute(

            select(Appointment).where(Appointment.patient_email == email).order_by(Appointment.id)

        )

        appointments = result.scalars().all()

        

        appointment_list = []

        for apt in appointments:

            clinic_name = apt.clinic_id

            clinic_result = await db.execute(

                select(Clinic).where(Clinic.clinic_id == apt.clinic_id)

            )

            clinic = clinic_result.scalar_one_or_none()

            if clinic:

                clinic_name = clinic.clinic_name

                full_address_parts = [
                    clinic.street_address,
                    clinic.road,
                    clinic.layout,
                    clinic.section,
                    clinic.city,
                    clinic.pincode
                ]
                full_formatted_address = ", ".join(filter(None, full_address_parts)) or clinic.address or ""

            else:
                full_formatted_address = ""

            appointment_list.append({

                "id": apt.id,

                "appointment_token": apt.appointment_token,

                "clinic_id": apt.clinic_id,

                "clinic_name": clinic_name,

                "address": full_formatted_address,

                "patient_id": apt.patient_id,

                "patient_name": apt.patient_name,

                "patient_email": apt.patient_email,

                "patient_phone": apt.patient_phone,

                "doctor_name": apt.doctor_name,

                "date": apt.date,

                "time": apt.time,

                "status": apt.status,

                "created_at": apt.created_at

            })

        

        return {"appointments": appointment_list, "total": len(appointment_list)}

    except Exception as e:

        raise HTTPException(status_code=500, detail=f"Failed to fetch appointments: {str(e)}")



@router.get("/clinic/appointments")

async def get_clinic_appointments(

    clinic_id: str = Query(..., description="Clinic ID"),

    db: AsyncSession = Depends(get_db)

):

    """

    Get today's appointments for a specific clinic with patient details.

    Only fetches appointments for today's date.

    """

    from datetime import datetime

    today = datetime.now(CLINIC_TIMEZONE).strftime("%Y-%m-%d")

    

    result = await db.execute(

        select(Appointment).where(

            Appointment.clinic_id == clinic_id,

            Appointment.date == today

        ).order_by(Appointment.id)

    )

    appointments = result.scalars().all()

    

    appointment_list = []

    for apt in appointments:

        appointment_list.append({

            "id": apt.id,

            "token": apt.appointment_token,

            "patient_id": apt.patient_id,

            "patient_name": apt.patient_name,

            "patient_email": apt.patient_email,

            "patient_phone": apt.patient_phone,

            "doctor_name": apt.doctor_name,

            "date": apt.date,

            "time": apt.time,

            "status": apt.status,

            "created_at": apt.created_at

        })

    

    return {"appointments": appointment_list, "total": len(appointment_list)}



@router.get("/appointments/today")

async def get_today_appointments(

    clinic_id: str = Query(..., description="Clinic ID"),

    slot_id: Optional[int] = Query(None, description="Optional slot ID to view"),

    db: AsyncSession = Depends(get_db)

):

    """

    Get today's appointments for a specific clinic from both:

    - appointments table (online bookings)

    - qr_appointments table (QR walk-in bookings)

    Returns combined list ordered by creation time.

    """

    import json



    def _parse_slot_record(slot_record: Optional[ClinicTimeSlot]):

        if not slot_record:

            return None, [], []



        slots = slot_record.slots

        if isinstance(slots, str):

            slots = json.loads(slots)

        slots = list(slots or [])



        slot_array = slot_record.slot or []

        if isinstance(slot_array, str):

            slot_array = json.loads(slot_array) if slot_array else []

        slot_array = list(slot_array or [])



        return slot_record, slots, slot_array



    def _current_slot_index(slots: list, slot_array: list, current_time_decimal: float) -> Optional[int]:

        for idx, slot in enumerate(slots or []):

            if not slot.get("is_open"):

                continue



            start, end = slot.get("time_range", [0, 0])

            if start <= current_time_decimal < end:

                return idx

        return None



    def _next_open_slot_index(slots: list, slot_array: list, current_time_decimal: float) -> Optional[int]:

        candidates: list[tuple[float, int]] = []

        for idx, slot in enumerate(slots or []):

            if not slot.get("is_open"):

                continue



            start, _end = slot.get("time_range", [0, 0])

            if start > current_time_decimal:

                candidates.append((start, idx))



        if not candidates:

            return None

        candidates.sort(key=lambda item: item[0])

        return candidates[0][1]



    today = datetime.now(CLINIC_TIMEZONE).strftime("%Y-%m-%d")



    slot_result = await db.execute(

        select(ClinicTimeSlot).where(ClinicTimeSlot.clinic_id == clinic_id)

    )

    slot_record = slot_result.scalar_one_or_none()

    _record, slots, slot_array = _parse_slot_record(slot_record)



    now = datetime.now(CLINIC_TIMEZONE)

    current_time_decimal = now.hour + now.minute / 60.0



    active_slot_index = _current_slot_index(slots, slot_array, current_time_decimal)

    active_slot_id = (active_slot_index + 1) if active_slot_index is not None else None

    viewing_slot_id = active_slot_id



    # If between slots (no active slot), show the next open slot list (so clinic can see who's booked next)

    if viewing_slot_id is None:

        next_index = _next_open_slot_index(slots, slot_array, current_time_decimal)

        viewing_slot_id = (next_index + 1) if next_index is not None else None



    if slot_id is not None:

        slot_index = slot_id - 1

        if slot_index < 0 or slot_index >= len(slots):

            raise HTTPException(

                status_code=status.HTTP_400_BAD_REQUEST,

                detail="Invalid slot_id"

            )

        viewing_slot_id = slot_id



    if viewing_slot_id is None:

        return {"appointments": [], "total": 0, "active_slot_id": None, "viewing_slot_id": None}



    # Fetch online appointments only for the viewing slot

    result = await db.execute(

        select(Appointment).where(

            Appointment.clinic_id == clinic_id,

            Appointment.date == today,

            Appointment.slot_id == viewing_slot_id

        ).order_by(Appointment.queue_position)

    )

    online_appointments = result.scalars().all()



    # Fetch QR walk-in appointments only for the viewing slot

    result = await db.execute(

        select(QRAppointment).where(

            QRAppointment.clinic_id == clinic_id,

            QRAppointment.date == today,

            QRAppointment.slot_id == viewing_slot_id

        ).order_by(QRAppointment.queue_position)

    )

    qr_appointments = result.scalars().all()



    # Combine both lists

    appointment_list = []



    # Add online appointments

    for apt in online_appointments:

        appointment_list.append({

            "id": apt.id,

            "token": apt.appointment_token,

            "clinic_id": apt.clinic_id,

            "slot_id": getattr(apt, "slot_id", None),

            "patient_id": apt.patient_id,

            "patient_name": apt.patient_name,

            "patient_email": apt.patient_email,

            "patient_phone": apt.patient_phone,

            "doctor_name": apt.doctor_name,

            "date": apt.date,

            "time": apt.time,

            "status": apt.status,

            "created_at": apt.created_at,

            "queue_position": apt.queue_position,

            "source": apt.source or "online"

        })



    # Add QR walk-in appointments

    for apt in qr_appointments:

        appointment_list.append({

            "id": apt.id,

            "token": apt.appointment_token,

            "clinic_id": apt.clinic_id,

            "slot_id": getattr(apt, "slot_id", None),

            "patient_id": f"qr-{apt.id}",  # QR appointments don't have patient_id

            "patient_name": apt.patient_name,

            "patient_email": "",  # QR appointments don't have email

            "patient_phone": apt.patient_phone,

            "doctor_name": apt.doctor_name,

            "date": apt.date,

            "time": "walk-in",

            "status": apt.status,

            "created_at": apt.created_at,

            "queue_position": apt.queue_position,

            "source": "walkin"

        })



    # Sort by queue_position (not created_at) to respect skip/reorder operations

    appointment_list.sort(key=lambda x: x.get("queue_position") or float('inf'))



    return {

        "appointments": appointment_list,

        "total": len(appointment_list),

        "active_slot_id": active_slot_id,

        "viewing_slot_id": viewing_slot_id

    }



@router.delete("/appointments/{appointment_id}")

async def delete_appointment(

    appointment_id: int,

    source: str = Query("online", description="Source type: online or walkin"),

    db: AsyncSession = Depends(get_db)

):

    """

    Delete an appointment by ID.

    Handles both online appointments (appointments table) and QR walk-ins (qr_appointments table).

    """

    if source == "walkin":

        # Try to find and delete from qr_appointments table

        result = await db.execute(

            select(QRAppointment).where(QRAppointment.id == appointment_id)

        )

        appointment = result.scalar_one_or_none()

        if appointment:

            await db.delete(appointment)

            await db.commit()

            return {"message": "QR walk-in appointment deleted successfully"}

    else:

        # Try to find and delete from appointments table

        result = await db.execute(

            select(Appointment).where(Appointment.id == appointment_id)

        )

        appointment = result.scalar_one_or_none()

        if appointment:

            await db.delete(appointment)

            await db.commit()

            return {"message": "Appointment deleted successfully"}



    raise HTTPException(

        status_code=status.HTTP_404_NOT_FOUND,

        detail="Appointment not found"

    )



@router.get("/appointments/queue-position")

async def get_queue_position(

    clinic_id: str = Query(..., description="Clinic ID"),

    appointment_token: str = Query(..., description="Appointment Token"),

    appointment_id: int = Query(..., description="Appointment ID"),

    db: AsyncSession = Depends(get_db)

):

    """

    Get queue position for a specific appointment.

    Returns the live queue position for the appointment's current slot.

    Position is based on the active queue list order, not the token number.

    """

    today = _clinic_today_str()



    current_result = await db.execute(

        select(Appointment).where(

            Appointment.clinic_id == clinic_id,

            Appointment.date == today,

            Appointment.status.in_(["booked", "serving"]),

            Appointment.id == appointment_id,

        )

    )

    current_appointment = current_result.scalar_one_or_none()



    if current_appointment is None:

        current_result = await db.execute(

            select(Appointment).where(

                Appointment.clinic_id == clinic_id,

                Appointment.date == today,

                Appointment.status.in_(["booked", "serving"]),

                Appointment.appointment_token == appointment_token,

            )

        )

        current_appointment = current_result.scalar_one_or_none()



    if current_appointment is None:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Appointment not found in active queue"

        )



    slot_id = current_appointment.slot_id



    appointment_filters = [

        Appointment.clinic_id == clinic_id,

        Appointment.date == today,

        Appointment.status.in_(["booked", "serving"]),

    ]

    qr_filters = [

        QRAppointment.clinic_id == clinic_id,

        QRAppointment.date == today,

        QRAppointment.status.in_(["booked", "serving"]),

    ]



    if slot_id is not None:

        appointment_filters.append(Appointment.slot_id == slot_id)

        qr_filters.append(QRAppointment.slot_id == slot_id)



    result = await db.execute(

        select(Appointment).where(*appointment_filters).order_by(Appointment.created_at, Appointment.id)

    )

    online_appointments = result.scalars().all()



    result = await db.execute(

        select(QRAppointment).where(*qr_filters).order_by(QRAppointment.created_at, QRAppointment.id)

    )

    walkin_appointments = result.scalars().all()



    queue_items = []

    for apt in online_appointments:

        queue_items.append({

            "id": apt.id,

            "token": apt.appointment_token,

            "status": apt.status,

            "source": "online",

            "created_at": apt.created_at,

        })



    for apt in walkin_appointments:

        queue_items.append({

            "id": apt.id,

            "token": apt.appointment_token,

            "status": apt.status,

            "source": "walkin",

            "created_at": apt.created_at,

        })



    queue_items.sort(key=lambda item: (_sort_datetime(item["created_at"]), item["id"]))



    total_in_queue = len(queue_items)

    your_position = 0

    patients_ahead = 0



    for index, item in enumerate(queue_items):

        if item["source"] == "online" and item["id"] == current_appointment.id:

            your_position = index + 1

            patients_ahead = index

            break



    if your_position == 0:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Appointment not found in slot queue"

        )



    serving_item = next((item for item in queue_items if item["status"] == "serving"), None)

    if serving_item:

        now_serving_token = serving_item["token"]

    elif your_position > 1:

        now_serving_token = queue_items[your_position - 2]["token"]

    elif queue_items:

        now_serving_token = queue_items[0]["token"]

    else:

        now_serving_token = appointment_token



    estimated_wait_minutes = patients_ahead * 15



    return {

        "patients_ahead": patients_ahead,

        "estimated_wait_minutes": estimated_wait_minutes,

        "your_position": your_position,

        "total_in_queue": total_in_queue,

        "current_token": your_position,

        "now_serving_token": now_serving_token,

        "status": "in_queue"

    }



# Review Endpoints

@router.get("/reviews/patient")

async def get_patient_reviews(

    patient_id: str = Query(..., description="Patient ID"),

    db: AsyncSession = Depends(get_db)

):

    """Get all reviews written by a patient"""

    result = await db.execute(

        select(Review).where(Review.patient_id == patient_id).order_by(Review.created_at.desc())

    )

    reviews = result.scalars().all()

    

    review_list = []

    for r in reviews:

        review_list.append({

            "id": r.id,

            "clinic_id": r.clinic_id,

            "patient_id": r.patient_id,

            "patient_name": r.patient_name,

            "rating": r.rating,

            "review_text": r.review_text,

            "likes": r.likes,

            "dislikes": r.dislikes,

            "created_at": r.created_at

        })

    

    return {"reviews": review_list, "total": len(review_list)}



@router.get("/reviews/clinic")

async def get_clinic_reviews(

    clinic_id: str = Query(..., description="Clinic ID"),

    db: AsyncSession = Depends(get_db)

):

    """Get all reviews for a clinic"""

    result = await db.execute(

        select(Review).where(Review.clinic_id == clinic_id).order_by(Review.created_at.desc())

    )

    reviews = result.scalars().all()

    

    # Calculate average rating

    total_rating = sum(r.rating for r in reviews)

    avg_rating = round(total_rating / len(reviews), 1) if reviews else 0

    

    review_list = []

    for r in reviews:

        review_list.append({

            "id": r.id,

            "patient_name": r.patient_name,

            "rating": r.rating,

            "review_text": r.review_text,

            "likes": r.likes,

            "dislikes": r.dislikes,

            "created_at": r.created_at

        })

    

    return {

        "reviews": review_list,

        "total": len(review_list),

        "average_rating": avg_rating

    }



@router.post("/reviews/create")

async def create_review(

    request: dict,

    db: AsyncSession = Depends(get_db)

):

    """Create a new review for a clinic"""

    clinic_id = request.get("clinic_id")

    patient_id = request.get("patient_id")

    patient_name = request.get("patient_name")

    rating = request.get("rating")

    review_text = request.get("review_text", "")

    

    if not clinic_id or not patient_id or not rating:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="clinic_id, patient_id, and rating are required"

        )

    

    # Check if review already exists for this patient and clinic

    result = await db.execute(

        select(Review).where(

            Review.clinic_id == clinic_id,

            Review.patient_id == patient_id

        )

    )

    existing_review = result.scalar_one_or_none()

    

    if existing_review:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="You have already reviewed this clinic"

        )

    

    # Create review

    new_review = Review(

        clinic_id=clinic_id,

        patient_id=patient_id,

        patient_name=patient_name,

        rating=rating,

        review_text=review_text,

        likes=0,

        dislikes=0

    )

    

    db.add(new_review)

    await db.commit()

    await db.refresh(new_review)

    

    return {

        "message": "Review created successfully",

        "id": new_review.id,

        "rating": rating,

        "review_text": review_text,

        "likes": 0,

        "dislikes": 0

    }



@router.get("/patient/completed-appointments")

async def get_patient_completed_appointments(

    patient_id: str = Query(..., description="Patient ID"),

    db: AsyncSession = Depends(get_db)

):

    """Get completed appointments for a patient, grouped by clinic (one per clinic)"""

    # Get all completed appointments for this patient

    result = await db.execute(

        select(CompletedAppointment).where(

            CompletedAppointment.patient_id == patient_id

        ).order_by(CompletedAppointment.served_at.desc())

    )

    completed = result.scalars().all()

    

    # Get patient's existing reviews

    result = await db.execute(

        select(Review).where(Review.patient_id == patient_id)

    )

    reviews = result.scalars().all()

    reviewed_clinic_ids = set(r.clinic_id for r in reviews)

    

    # Get clinic names for all visited clinics

    clinic_ids = list(set(apt.clinic_id for apt in completed))

    clinic_names = {}

    if clinic_ids:

        result = await db.execute(

            select(Clinic).where(Clinic.clinic_id.in_(clinic_ids))

        )

        clinics = result.scalars().all()

        for clinic in clinics:

            clinic_names[clinic.clinic_id] = clinic.clinic_name

    

    # Group by clinic_id and get the most recent visit per clinic

    clinic_visits = {}

    for apt in completed:

        if apt.clinic_id not in clinic_visits:

            clinic_visits[apt.clinic_id] = {

                "clinic_id": apt.clinic_id,

                "clinic_name": clinic_names.get(apt.clinic_id, apt.doctor_name or "Clinic"),

                "date": apt.date,

                "time": apt.time,

                "served_at": apt.served_at,

                "has_reviewed": apt.clinic_id in reviewed_clinic_ids

            }

    

    visit_list = list(clinic_visits.values())

    

    return {"visits": visit_list, "total": len(visit_list)}



@router.post("/reviews/like")

async def like_review(

    review_id: int = Query(..., description="Review ID"),

    patient_id: str = Query(..., description="Patient ID"),

    db: AsyncSession = Depends(get_db)

):

    """Like a review - patient can only like or dislike, not both"""

    # Get the review

    result = await db.execute(

        select(Review).where(Review.id == review_id)

    )

    review = result.scalar_one_or_none()

    

    if not review:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Review not found"

        )

    

    # Check if patient already reacted to this review

    result = await db.execute(

        select(ReviewReaction).where(

            ReviewReaction.review_id == review_id,

            ReviewReaction.patient_id == patient_id

        )

    )

    existing = result.scalar_one_or_none()

    

    if existing:

        if existing.reaction_type == "like":

            # Already liked - remove it (toggle off)

            await db.delete(existing)

            review.likes = max((review.likes or 0) - 1, 0)

            await db.commit()

            return {"message": "Like removed", "likes": review.likes, "dislikes": review.dislikes, "user_reaction": None}

        else:

            # Previously disliked - switch to like

            existing.reaction_type = "like"

            review.dislikes = max((review.dislikes or 0) - 1, 0)

            review.likes = (review.likes or 0) + 1

            await db.commit()

            return {"message": "Switched to like", "likes": review.likes, "dislikes": review.dislikes, "user_reaction": "like"}

    else:

        # New like

        db.add(ReviewReaction(review_id=review_id, patient_id=patient_id, reaction_type="like"))

        review.likes = (review.likes or 0) + 1

        await db.commit()

        return {"message": "Review liked", "likes": review.likes, "dislikes": review.dislikes, "user_reaction": "like"}



@router.post("/reviews/dislike")

async def dislike_review(

    review_id: int = Query(..., description="Review ID"),

    patient_id: str = Query(..., description="Patient ID"),

    db: AsyncSession = Depends(get_db)

):

    """Dislike a review - patient can only like or dislike, not both"""

    # Get the review

    result = await db.execute(

        select(Review).where(Review.id == review_id)

    )

    review = result.scalar_one_or_none()

    

    if not review:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Review not found"

        )

    

    # Check if patient already reacted to this review

    result = await db.execute(

        select(ReviewReaction).where(

            ReviewReaction.review_id == review_id,

            ReviewReaction.patient_id == patient_id

        )

    )

    existing = result.scalar_one_or_none()

    

    if existing:

        if existing.reaction_type == "dislike":

            # Already disliked - remove it (toggle off)

            await db.delete(existing)

            review.dislikes = max((review.dislikes or 0) - 1, 0)

            await db.commit()

            return {"message": "Dislike removed", "likes": review.likes, "dislikes": review.dislikes, "user_reaction": None}

        else:

            # Previously liked - switch to dislike

            existing.reaction_type = "dislike"

            review.likes = max((review.likes or 0) - 1, 0)

            review.dislikes = (review.dislikes or 0) + 1

            await db.commit()

            return {"message": "Switched to dislike", "likes": review.likes, "dislikes": review.dislikes, "user_reaction": "dislike"}

    else:

        # New dislike

        db.add(ReviewReaction(review_id=review_id, patient_id=patient_id, reaction_type="dislike"))

        review.dislikes = (review.dislikes or 0) + 1

        await db.commit()

        return {"message": "Review disliked", "likes": review.likes, "dislikes": review.dislikes, "user_reaction": "dislike"}



@router.get("/reviews/user-reaction")

async def get_user_reactions(

    clinic_id: str = Query(..., description="Clinic ID"),

    patient_id: str = Query(..., description="Patient ID"),

    db: AsyncSession = Depends(get_db)

):

    """Get patient's reactions for all reviews of a clinic"""

    result = await db.execute(

        select(Review).where(Review.clinic_id == clinic_id)

    )

    reviews = result.scalars().all()

    review_ids = [r.id for r in reviews]

    

    if not review_ids:

        return {"reactions": {}}

    

    result = await db.execute(

        select(ReviewReaction).where(

            ReviewReaction.review_id.in_(review_ids),

            ReviewReaction.patient_id == patient_id

        )

    )

    reactions = result.scalars().all()

    

    return {"reactions": {str(r.review_id): r.reaction_type for r in reactions}}



@router.get("/clinic/patients/search")

async def search_clinic_patients(

    clinic_id: str = Query(..., description="Clinic ID"),

    from_date: str = Query(None, description="From date (YYYY-MM-DD)"),

    to_date: str = Query(None, description="To date (YYYY-MM-DD)"),

    patient_id: str = Query(None, description="Patient ID"),

    email: str = Query(None, description="Patient email"),

    phone: str = Query(None, description="Patient phone"),

    db: AsyncSession = Depends(get_db)

):

    """Search patients by date range, patient ID, email, or phone in both appointments and completed_appointments"""

    try:

        # Helper function to build query with filters

        def build_query(model, clinic_id, from_date, to_date, patient_id, email, phone):

            query = select(model).where(model.clinic_id == clinic_id)

            

            if from_date and to_date:

                query = query.where(model.date >= from_date, model.date <= to_date)

            

            if patient_id:

                query = query.where(model.patient_id == patient_id)

            

            if email:

                query = query.where(model.patient_email.ilike(f"%{email}%"))

            

            if phone:

                query = query.where(model.patient_phone.ilike(f"%{phone}%"))

            

            return query.order_by(model.date.desc(), model.time.desc())

        

        # Search appointments table

        appointments_query = build_query(Appointment, clinic_id, from_date, to_date, patient_id, email, phone)

        result = await db.execute(appointments_query)

        appointments = result.scalars().all()

        

        # Search completed_appointments table

        completed_query = build_query(CompletedAppointment, clinic_id, from_date, to_date, patient_id, email, phone)

        result = await db.execute(completed_query)

        completed = result.scalars().all()

        

        # Combine and format results

        patients = []

        

        # Add appointments

        for apt in appointments:

            patients.append({

                "appointment_token": apt.appointment_token,

                "patient_name": apt.patient_name,

                "patient_phone": apt.patient_phone,

                "patient_id": apt.patient_id,

                "patient_email": apt.patient_email,

                "date": apt.date,

                "time": apt.time,

                "status": apt.status,

                "source": "appointment"

            })

        

        # Add completed appointments

        for apt in completed:

            patients.append({

                "appointment_token": apt.appointment_token,

                "patient_name": apt.patient_name,

                "patient_phone": apt.patient_phone,

                "patient_id": apt.patient_id,

                "patient_email": apt.patient_email,

                "date": apt.date,

                "time": apt.time,

                "status": "completed",

                "source": "completed"

            })

        

        # Remove duplicates by patient_id + date + time

        seen = set()

        unique_patients = []

        for p in patients:

            key = (p["patient_id"], p["date"], p["time"])

            if key not in seen:

                seen.add(key)

                unique_patients.append(p)

        

        return {"patients": unique_patients, "total": len(unique_patients)}

    except Exception as e:

        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")



# ============= TOKEN/JOIN QUEUE ENDPOINTS =============



@router.post("/tokens/create")

async def create_token(

    request: dict,

    db: AsyncSession = Depends(get_db)

):

    """

    Create a new token and append to the end of the queue.

    New patients join at the position after the last current patient.

    Token format: T-0, T-1, T-2, etc. (appends to end of queue).

    """

    from datetime import datetime

    

    clinic_id = request.get("clinicId")

    doctor_id = request.get("doctorId")

    category_id = request.get("categoryId")

    patient_name = request.get("patientName")

    source = request.get("source", "ONLINE")  # QR, ONLINE, etc.

    

    # Validate required fields

    if not all([clinic_id, patient_name]):

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="clinicId and patientName are required"

        )

    

    # Get current date

    today = datetime.now().strftime("%Y-%m-%d")

    

    # Get all active appointments for this clinic today (booked, serving status)

    result = await db.execute(

        select(Appointment).where(

            Appointment.clinic_id == clinic_id,

            Appointment.date == today,

            Appointment.status.in_(["booked", "serving"])

        ).order_by(Appointment.id)

    )

    existing_appointments = result.scalars().all()

    

    # Calculate next token number (append to end of queue)

    next_token_number = len(existing_appointments)

    token_label = f"T-{next_token_number}"



    # Calculate queue position

    queue_position = len(existing_appointments) + 1



    # Get clinic info for doctor name

    doctor_name = ""

    if doctor_id:

        # Map doctor_id to name (simplified - you can expand this)

        doctor_names = {

            "1": "Dr. John Smith",

            "2": "Dr. Sarah Johnson",

            "3": "Dr. Michael Brown"

        }

        doctor_name = doctor_names.get(str(doctor_id), "")



    # Create new appointment at the end of queue

    new_appointment = Appointment(

        appointment_token=token_label,

        clinic_id=clinic_id,

        patient_id=f"PENDING-{int(datetime.now().timestamp())}",  # Temporary ID for non-logged-in patients

        patient_name=patient_name,

        patient_email=request.get("patientEmail", ""),

        patient_phone=request.get("patientPhone", ""),

        doctor_name=doctor_name,

        date=today,

        time=datetime.now().strftime("%H:%M"),

        status="booked",

        queue_position=queue_position

    )

    

    db.add(new_appointment)

    await db.commit()

    await db.refresh(new_appointment)

    

    return {

        "message": "Successfully joined the queue",

        "tokenLabel": token_label,

        "tokenNumber": next_token_number,

        "position": next_token_number + 1,  # 1-based position for display

        "patientsAhead": next_token_number,

        "appointmentId": new_appointment.id,

        "clinicId": clinic_id,

        "patientName": patient_name,

        "date": today

    }

    return {"patients": unique_patients, "count": len(unique_patients)}

