"""
Script to clean up old appointments from the appointments table.
Run this script to remove old pending appointments and mark them as not_served.
"""
import asyncio
from app.services.appointment_maintenance import cleanup_old_appointments, clinic_today_str

async def cleanup_yesterday_appointments():
    """Clean up old appointments (not from today) - mark as not served"""
    print(f"Today's date: {clinic_today_str()}")
    print("Cleaning up all appointments NOT from today...\n")
    cleaned_count = await cleanup_old_appointments()
    if cleaned_count == 0:
        print("No old appointments found to clean up.")
        return
    print(f"\nDone! Cleaned up {cleaned_count} old appointments.")
    print("All appointments have been marked as 'not_served' in completed_appointments table.")

if __name__ == "__main__":
    asyncio.run(cleanup_yesterday_appointments())
