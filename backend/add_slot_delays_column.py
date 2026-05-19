"""
Add the visible per-slot delay column to clinic_time_slots.

Run from the backend directory:
    python add_slot_delays_column.py
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
            text("ALTER TABLE clinic_time_slots ADD COLUMN IF NOT EXISTS slot_delays JSON DEFAULT '[]'")
        )
        await conn.execute(
            text("UPDATE clinic_time_slots SET slot_delays = '[]' WHERE slot_delays IS NULL")
        )

    logger.info("clinic_time_slots.slot_delays is ready.")


if __name__ == "__main__":
    asyncio.run(main())
