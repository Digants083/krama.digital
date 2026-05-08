"""
One-time/manual live database schema repair.

Run from backend directory:
    python ensure_live_schema.py

The same schema repair also runs automatically when FastAPI starts.
"""
import asyncio
import logging

from app.database.db import engine
from app.database.models import Base
from app.database.schema_checks import ensure_required_schema, get_schema_report


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        before = await get_schema_report(conn)
        logger.info("Schema report before repair: %s", before.get("missing"))

        await ensure_required_schema(conn)

        after = await get_schema_report(conn)
        logger.info("Schema report after repair: %s", after.get("missing"))

        if after.get("missing"):
            raise RuntimeError(f"Schema repair incomplete: {after['missing']}")

        logger.info("Live schema is ready.")


if __name__ == "__main__":
    asyncio.run(main())
