"""
Debug script to check appointments table dates
"""
import asyncio
from app.services.appointment_maintenance import check_appointment_dates

async def check_dates():
    summary = await check_appointment_dates(log_details=False)
    print("Dates in appointments table:")
    for date_value in summary["dates"]:
        print(f"  - {date_value}")
    print(f"\nToday's date: {summary['today']}")
    print(f"Yesterday's date: {summary['yesterday']}")
    print(f"\nSampled appointments: {summary['sample_count']}")

if __name__ == "__main__":
    asyncio.run(check_dates())
