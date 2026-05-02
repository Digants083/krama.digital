from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.database.db import get_db
from app.database.models import Feedback
from pydantic import BaseModel

router = APIRouter(prefix="/feedback", tags=["feedback"])


class FeedbackSubmission(BaseModel):
    name: str
    email: str
    phone: str
    message: str


class FeedbackReview(BaseModel):
    feedback_id: int
    status: str  # approved or rejected
    admin_id: str


@router.post("/submit")
async def submit_feedback(
    feedback: FeedbackSubmission,
    db: AsyncSession = Depends(get_db)
):
    """
    Submit a new feedback entry.
    """
    try:
        # Validate email format
        if "@" not in feedback.email or "." not in feedback.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid email format"
            )

        # Validate phone number (basic validation)
        if len(feedback.phone) < 10:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Phone number must be at least 10 digits"
            )

        # Validate message length
        if len(feedback.message) < 10:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Message must be at least 10 characters long"
            )

        if len(feedback.message) > 1000:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Message must be less than 1000 characters"
            )

        # Create new feedback entry
        new_feedback = Feedback(
            name=feedback.name,
            email=feedback.email,
            phone=feedback.phone,
            message=feedback.message,
            status="pending"
        )

        db.add(new_feedback)
        await db.commit()
        await db.refresh(new_feedback)

        return {
            "message": "Feedback submitted successfully",
            "feedback_id": new_feedback.id,
            "status": "pending"
        }

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to submit feedback: {str(e)}"
        )


@router.get("/pending")
async def get_pending_feedback(
    db: AsyncSession = Depends(get_db)
):
    """
    Get all pending feedback awaiting approval.
    """
    try:
        result = await db.execute(
            select(Feedback).where(Feedback.status == "pending").order_by(Feedback.created_at.desc())
        )
        pending_feedback = result.scalars().all()

        feedback_list = []
        for feedback in pending_feedback:
            feedback_list.append({
                "id": feedback.id,
                "name": feedback.name,
                "email": feedback.email,
                "phone": feedback.phone,
                "message": feedback.message,
                "status": feedback.status,
                "created_at": feedback.created_at.isoformat() if feedback.created_at else None
            })

        return {
            "pending_feedback": feedback_list,
            "total": len(feedback_list)
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch pending feedback: {str(e)}"
        )


@router.get("/approved")
async def get_approved_feedback(
    db: AsyncSession = Depends(get_db)
):
    """
    Get all approved feedback.
    """
    try:
        result = await db.execute(
            select(Feedback).where(Feedback.status == "approved").order_by(Feedback.reviewed_at.desc())
        )
        approved_feedback = result.scalars().all()

        feedback_list = []
        for feedback in approved_feedback:
            feedback_list.append({
                "id": feedback.id,
                "name": feedback.name,
                "email": feedback.email,
                "phone": feedback.phone,
                "message": feedback.message,
                "status": feedback.status,
                "created_at": feedback.created_at.isoformat() if feedback.created_at else None,
                "reviewed_at": feedback.reviewed_at.isoformat() if feedback.reviewed_at else None,
                "reviewed_by": feedback.reviewed_by
            })

        return {
            "approved_feedback": feedback_list,
            "total": len(feedback_list)
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch approved feedback: {str(e)}"
        )


@router.get("/all")
async def get_all_feedback(
    status_filter: str = Query(None, description="Filter by status: pending, approved, rejected"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all feedback with optional status filter.
    """
    try:
        query = select(Feedback)

        if status_filter and status_filter in ["pending", "approved", "rejected"]:
            query = query.where(Feedback.status == status_filter)

        query = query.order_by(Feedback.created_at.desc())

        result = await db.execute(query)
        all_feedback = result.scalars().all()

        feedback_list = []
        for feedback in all_feedback:
            feedback_list.append({
                "id": feedback.id,
                "name": feedback.name,
                "email": feedback.email,
                "phone": feedback.phone,
                "message": feedback.message,
                "status": feedback.status,
                "created_at": feedback.created_at.isoformat() if feedback.created_at else None,
                "reviewed_at": feedback.reviewed_at.isoformat() if feedback.reviewed_at else None,
                "reviewed_by": feedback.reviewed_by
            })

        return {
            "feedback": feedback_list,
            "total": len(feedback_list)
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch feedback: {str(e)}"
        )


@router.post("/review")
async def review_feedback(
    review: FeedbackReview,
    db: AsyncSession = Depends(get_db)
):
    """
    Approve or reject feedback.
    """
    try:
        if review.status not in ["approved", "rejected"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Status must be either 'approved' or 'rejected'"
            )

        result = await db.execute(
            select(Feedback).where(Feedback.id == review.feedback_id)
        )
        feedback = result.scalar_one_or_none()

        if not feedback:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Feedback not found"
            )

        # Update feedback status
        feedback.status = review.status
        feedback.reviewed_at = datetime.now(timezone.utc)
        feedback.reviewed_by = review.admin_id

        await db.commit()
        await db.refresh(feedback)

        return {
            "message": f"Feedback {review.status} successfully",
            "feedback_id": feedback.id,
            "status": feedback.status
        }

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to review feedback: {str(e)}"
        )


@router.delete("/{feedback_id}")
async def delete_feedback(
    feedback_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a feedback entry.
    """
    try:
        result = await db.execute(
            select(Feedback).where(Feedback.id == feedback_id)
        )
        feedback = result.scalar_one_or_none()

        if not feedback:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Feedback not found"
            )

        await db.delete(feedback)
        await db.commit()

        return {
            "message": "Feedback deleted successfully",
            "feedback_id": feedback_id
        }

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete feedback: {str(e)}"
        )


@router.get("/stats")
async def get_feedback_stats(
    db: AsyncSession = Depends(get_db)
):
    """
    Get feedback statistics.
    """
    try:
        # Count pending feedback
        pending_result = await db.execute(
            select(Feedback).where(Feedback.status == "pending")
        )
        pending_count = len(pending_result.scalars().all())

        # Count approved feedback
        approved_result = await db.execute(
            select(Feedback).where(Feedback.status == "approved")
        )
        approved_count = len(approved_result.scalars().all())

        # Count rejected feedback
        rejected_result = await db.execute(
            select(Feedback).where(Feedback.status == "rejected")
        )
        rejected_count = len(rejected_result.scalars().all())

        return {
            "pending": pending_count,
            "approved": approved_count,
            "rejected": rejected_count,
            "total": pending_count + approved_count + rejected_count
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch feedback stats: {str(e)}"
        )