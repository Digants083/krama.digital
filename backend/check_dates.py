"""
Debug script to check appointments table dates
"""
import asyncio
from datetime import datetime
from sqlalchemy import select, func
from app.database.db import AsyncSessionLocal
from app.database.models import Appointment

async def check_dates():
    async with AsyncSessionLocal() as db:
        # Get distinct dates
        result = await db.execute(
            select(Appointment.date).distinct()
        )
        dates = result.scalars().all()
        print("Dates in appointments table:")
        for d in dates:
            print(f"  - {d}")
        
        # Get today's date
        today = datetime.now().strftime("%Y-%m-%d")
        print(f"\nToday's date: {today}")
        
        # Get yesterday
        from datetime import timedelta
        yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        print(f"Yesterday's date: {yesterday}")
        
        # Get all appointments with their dates and status
        result = await db.execute(
            select(Appointment).limit(10)
        )
        print("\nFirst 10 appointments:")
        for apt in result.scalars().all():
            print(f"  - {apt.patient_name}: date={apt.date}, status={apt.status}")

if __name__ == "__main__":
    asyncio.run(check_dates())
