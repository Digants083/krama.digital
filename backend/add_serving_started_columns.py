"""
Add DB columns that persist when a patient actually starts being served.

Run from the backend directory:
    python add_serving_started_columns.py
"""
import asyncio
import logging

from sqlalchemy import text

from app.database.db import engine


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    async with engine.begin() as conn:
        await conn.execute(
            text("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMP")
        )
        await conn.execute(
            text("ALTER TABLE qr_appointments ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMP")
        )
        await conn.execute(
            text("ALTER TABLE completed_appointments ADD COLUMN IF NOT EXISTS service_duration_seconds INTEGER")
        )

    logger.info("serving start and duration columns are ready.")


if __name__ == "__main__":
    asyncio.run(main())
