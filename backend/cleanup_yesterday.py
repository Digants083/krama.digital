"""
Script to clean up old appointments from the appointments table.
Run this script to remove old pending appointments and mark them as not_served.
"""
import asyncio
from datetime import datetime, timedelta
from sqlalchemy import select, and_
from app.database.db import AsyncSessionLocal, engine
from app.database.models import Base, Appointment, CompletedAppointment

async def cleanup_yesterday_appointments():
    """Clean up old appointments (not from today) - mark as not served"""
    
    async with AsyncSessionLocal() as db:
        today = datetime.now().strftime("%Y-%m-%d")
        print(f"Today's date: {today}")
        print(f"Cleaning up all appointments NOT from today...\n")
        
        # Get appointments that are NOT from today and not completed
        result = await db.execute(
            select(Appointment).where(
                and_(
                    Appointment.date != today,
                    Appointment.status.notin_(["completed", "not_served"])
                )
            )
        )
        
        appointments = result.scalars().all()
        
        if not appointments:
            print("No old appointments found to clean up.")
            return
        
        print(f"Found {len(appointments)} old appointments to clean up.\n")
        
        deleted_count = 0
        for apt in appointments:
            print(f"  - {apt.patient_name} (date: {apt.date}, token: {apt.appointment_token}, status: {apt.status})")
            
            # Create completed appointment with not_served status
            completed = CompletedAppointment(
                appointment_token=apt.appointment_token,
                clinic_id=apt.clinic_id,
                patient_id=f"online-{apt.id}",
                patient_name=apt.patient_name,
                patient_phone=apt.patient_phone,
                patient_email=getattr(apt, 'patient_email', ""),
                doctor_name=getattr(apt, 'doctor_name', ""),
                date=apt.date,
                time=getattr(apt, 'time', ""),
                slot_id=getattr(apt, 'slot_id', None),
                status="completed",
                outcome="not_served",
                served=False,
                wait_time_minutes=0,
                served_at=datetime.now()
            )
            db.add(completed)
            await db.delete(apt)
            deleted_count += 1
        
        await db.commit()
        print(f"\nDone! Cleaned up {deleted_count} old appointments.")
        print("All appointments have been marked as 'not_served' in completed_appointments table.")

if __name__ == "__main__":
    asyncio.run(cleanup_yesterday_appointments())
