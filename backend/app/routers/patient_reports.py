"""
Patient Reports router for diagnostic and scanning centers.
Provides endpoints for managing patient reports and sending PDF reports via email.
"""
import os
import shutil
import re
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.database.db import get_db
from app.database.models import Report, CompletedReport, Clinic
from pydantic import BaseModel

router = APIRouter(prefix="/clinic/reports", tags=["patient_reports"])

# Directory for storing PDF reports
REPORTS_DIR = "patient_reports"
os.makedirs(REPORTS_DIR, exist_ok=True)


def _safe_pdf_filename(filename: str) -> str:
    name = os.path.basename(filename or "report.pdf")
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    return name or "report.pdf"


class ReportProcessRequest(BaseModel):
    report_id: int
    action: str  # "send", "collected", "no_report"
    pdf_path: Optional[str] = None
    notes: Optional[str] = None


@router.get("/pending")
async def get_pending_reports(
    clinic_id: str = Query(..., description="Clinic ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all pending reports for a clinic (patients who need reports).
    Only shows online patients (not QR/walk-in).
    """
    try:
        # Get pending reports for this clinic
        result = await db.execute(
            select(Report).where(
                and_(
                    Report.clinic_id == clinic_id,
                    Report.status == "pending"
                )
            ).order_by(Report.created_at.desc())
        )

        reports = result.scalars().all()

        return {
            "reports": [
                {
                    "report_id": r.id,
                    "patient_id": r.patient_id,
                    "patient_name": r.patient_name,
                    "patient_email": r.patient_email,
                    "patient_phone": r.patient_phone,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "report_pdf": r.report_pdf,
                    "report_type": r.report_type
                }
                for r in reports
            ],
            "total": len(reports)
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch pending reports: {str(e)}"
        )


@router.get("/completed")
async def get_completed_reports(
    clinic_id: str = Query(..., description="Clinic ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all completed reports for a clinic (patients whose reports are processed).
    """
    try:
        result = await db.execute(
            select(CompletedReport).where(
                CompletedReport.clinic_id == clinic_id
            ).order_by(CompletedReport.completed_at.desc())
        )

        reports = result.scalars().all()

        return {
            "reports": [
                {
                    "report_id": r.id,
                    "patient_id": r.patient_id,
                    "patient_name": r.patient_name,
                    "patient_email": r.patient_email,
                    "patient_phone": r.patient_phone,
                    "status": r.status,  # true = report provided, false = no report
                    "report_pdf": r.report_pdf,
                    "report_type": r.report_type,
                    "completed_at": r.completed_at.isoformat() if r.completed_at else None
                }
                for r in reports
            ],
            "total": len(reports)
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch completed reports: {str(e)}"
        )


@router.post("/upload-pdf")
async def upload_report_pdf(
    clinic_id: str = Query(..., description="Clinic ID"),
    patient_id: str = Query(..., description="Patient ID"),
    report_id: int = Query(..., description="Report ID"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload a PDF report for a patient and save to database.
    """
    try:
        # Validate file type
        if not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only PDF files are allowed"
            )

        # Get the report from database
        result = await db.execute(
            select(Report).where(
                and_(
                    Report.id == report_id,
                    Report.clinic_id == clinic_id,
                    Report.patient_id == patient_id,
                    Report.status == "pending"
                )
            )
        )
        report = result.scalar_one_or_none()
        
        if not report:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Report not found"
            )

        # Create clinic-specific directory
        clinic_dir = os.path.join(REPORTS_DIR, clinic_id)
        os.makedirs(clinic_dir, exist_ok=True)

        # Generate unique filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{patient_id}_{timestamp}_{_safe_pdf_filename(file.filename)}"
        file_path = os.path.join(clinic_dir, filename)

        # Save file
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Return the relative path for storage
        relative_path = os.path.join(clinic_id, filename).replace("\\", "/")
        
        # Update the report with PDF path in database
        report.report_pdf = relative_path
        await db.commit()

        return {
            "message": "PDF uploaded successfully",
            "file_path": relative_path,
            "filename": filename
        }

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload PDF: {str(e)}"
        )


@router.post("/process")
async def process_report(
    request: ReportProcessRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Process a report - move from pending to completed.
    Actions: "send" (email), "collected" (physical), "no_report" (not needed)
    """
    try:
        # Validate action
        valid_actions = ["send", "collected", "no_report"]
        if request.action not in valid_actions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid action. Must be one of: {', '.join(valid_actions)}"
            )

        # Get pending report
        result = await db.execute(
            select(Report).where(Report.id == request.report_id)
        )
        report = result.scalar_one_or_none()

        if not report:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Report not found"
            )

        # Determine status and report_type
        if request.action == "send":
            report_provided = True  # Report provided (via email)
            report_type = "sent"
            pdf_path = request.pdf_path or report.report_pdf

            if not pdf_path:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Please upload a PDF report before sending email"
                )

            # Send email with PDF attachment before moving the report to completed.
            import logging
            logger = logging.getLogger(__name__)
            logger.info(f"Processing send action for report {request.report_id}, pdf_path: {pdf_path}")
            
            from app.services.email_service import send_patient_report_email

            # Get clinic details
            clinic_result = await db.execute(
                select(Clinic).where(Clinic.clinic_id == report.clinic_id)
            )
            clinic = clinic_result.scalar_one_or_none()

            if not clinic:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Clinic not found"
                )

            pdf_path_normalized = os.path.normpath(pdf_path.replace("/", os.sep))
            if os.path.isabs(pdf_path_normalized) or pdf_path_normalized.startswith(f"..{os.sep}") or pdf_path_normalized == "..":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid PDF path"
                )

            full_pdf_path = os.path.join(REPORTS_DIR, pdf_path_normalized)
            logger.info(f"Full PDF path: {full_pdf_path}, exists: {os.path.exists(full_pdf_path)}")

            if not os.path.exists(full_pdf_path):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Uploaded PDF file was not found. Please upload it again."
                )

            logger.info(f"Sending email to {report.patient_email} with PDF")
            email_sent = send_patient_report_email(
                patient_email=report.patient_email,
                patient_name=report.patient_name,
                clinic_name=clinic.clinic_name,
                pdf_path=full_pdf_path,
                notes=request.notes
            )
            logger.info(f"Email sent result: {email_sent}")
            if not email_sent:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to send report email. Please check SMTP settings and try again."
                )
        elif request.action == "collected":
            report_provided = True  # Report provided (physical)
            report_type = "collected"
            pdf_path = None
        else:  # no_report
            report_provided = False  # No report provided
            report_type = "no_report"
            pdf_path = None

        # Create completed report
        completed_report = CompletedReport(
            clinic_id=report.clinic_id,
            patient_id=report.patient_id,
            patient_name=report.patient_name,
            patient_email=report.patient_email,
            patient_phone=report.patient_phone,
            status=report_provided,
            report_pdf=pdf_path,
            report_type=report_type,
            completed_at=datetime.now(timezone.utc)
        )

        db.add(completed_report)

        # Delete from pending reports
        await db.delete(report)
        await db.commit()

        return {
            "message": f"Report processed successfully ({request.action})",
            "report_id": completed_report.id,
            "status": report_provided,
            "report_type": report_type
        }

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process report: {str(e)}"
        )


@router.get("/statistics")
async def get_report_statistics(
    clinic_id: str = Query(..., description="Clinic ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get report statistics for a clinic.
    """
    try:
        # Get pending reports count
        pending_result = await db.execute(
            select(Report).where(
                and_(
                    Report.clinic_id == clinic_id,
                    Report.status == "pending"
                )
            )
        )
        pending_count = len(pending_result.scalars().all())

        # Get completed reports
        completed_result = await db.execute(
            select(CompletedReport).where(CompletedReport.clinic_id == clinic_id)
        )
        completed_reports = completed_result.scalars().all()

        # Count by status
        provided_count = sum(1 for r in completed_reports if r.status == True)
        no_report_count = sum(1 for r in completed_reports if r.status == False)

        # Count by type
        sent_count = sum(1 for r in completed_reports if r.report_type == "sent")
        collected_count = sum(1 for r in completed_reports if r.report_type == "collected")
        no_report_type_count = sum(1 for r in completed_reports if r.report_type == "no_report")

        return {
            "pending": pending_count,
            "completed": len(completed_reports),
            "provided": provided_count,
            "no_report": no_report_count,
            "sent": sent_count,
            "collected": collected_count,
            "no_report_type": no_report_type_count
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch statistics: {str(e)}"
        )


async def auto_add_patient_to_reports(
    patient_id: str,
    clinic_id: str,
    patient_name: str,
    patient_email: str,
    patient_phone: str,
    db: AsyncSession
):
    """
    Internal function to automatically add patient to reports table.
    Called when patient completes appointment.
    """
    import logging
    logger = logging.getLogger(__name__)

    try:
        logger.info(f"auto_add_patient_to_reports called: clinic_id={clinic_id}, patient_id={patient_id}")

        # Check if report already exists for this patient
        existing_result = await db.execute(
            select(Report).where(
                and_(
                    Report.clinic_id == clinic_id,
                    Report.patient_id == patient_id,
                    Report.status == "pending"
                )
            )
        )
        existing_report = existing_result.scalar_one_or_none()

        if existing_report:
            logger.info(f"Report already exists for patient {patient_id}")
            return {"message": "Report already exists", "added": False}

        # Create new pending report
        new_report = Report(
            clinic_id=clinic_id,
            patient_id=patient_id,
            patient_name=patient_name,
            patient_email=patient_email,
            patient_phone=patient_phone,
            status="pending"
        )

        db.add(new_report)
        await db.commit()
        await db.refresh(new_report)

        logger.info(f"Successfully added patient {patient_id} to reports, report_id: {new_report.id}")

        return {
            "message": "Patient added to reports successfully",
            "added": True,
            "report_id": new_report.id
        }

    except Exception as e:
        logger.error(f"Failed to add patient to reports: {e}", exc_info=True)
        await db.rollback()
        return {
            "message": f"Failed to add patient to reports: {str(e)}",
            "added": False
        }
