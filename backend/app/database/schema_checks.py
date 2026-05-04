import logging
from typing import Dict, List, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger(__name__)


REQUIRED_TABLE_COLUMNS: Dict[str, Dict[str, str]] = {
    "appointments": {
        "notification_stage": "VARCHAR DEFAULT 'pending'",
        "slot_id": "INTEGER",
        "push_count": "INTEGER DEFAULT 0",
        "queue_position": "INTEGER",
    },
    "qr_appointments": {
        "slot_id": "INTEGER",
        "queue_position": "INTEGER",
    },
    "completed_appointments": {
        "slot_id": "INTEGER",
        "finished_at": "TIMESTAMP",
        "status": "VARCHAR DEFAULT 'served'",
        "wait_time_minutes": "INTEGER",
        "outcome": "VARCHAR DEFAULT 'served'",
        "served": "BOOLEAN DEFAULT TRUE",
        "push_count": "INTEGER DEFAULT 0",
    },
    "clinic_time_slots": {
        "slots": "JSON DEFAULT '[]'",
        "slot": "VARCHAR[] DEFAULT '{}'",
        "last_slot_change_date": "TIMESTAMP",
        "daily_toggle_counts": "JSON DEFAULT '[]'",
        "last_toggle_date": "TIMESTAMP",
    },
}


EXPECTED_RELATED_TABLES = [
    "clinics",
    "appointments",
    "qr_appointments",
    "completed_appointments",
    "clinic_time_slots",
]


async def table_exists(conn: AsyncConnection, table_name: str) -> bool:
    result = await conn.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = :table_name
            )
            """
        ),
        {"table_name": table_name},
    )
    return bool(result.scalar())


async def get_existing_columns(conn: AsyncConnection, table_name: str) -> List[str]:
    result = await conn.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = :table_name
            """
        ),
        {"table_name": table_name},
    )
    return [row[0] for row in result.fetchall()]


async def get_foreign_keys(conn: AsyncConnection, table_name: str) -> List[Tuple[str, str, str]]:
    result = await conn.execute(
        text(
            """
            SELECT
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = :table_name
            """
        ),
        {"table_name": table_name},
    )
    return [(row[0], row[1], row[2]) for row in result.fetchall()]


async def ensure_required_schema(conn: AsyncConnection) -> None:
    for table_name in EXPECTED_RELATED_TABLES:
        if not await table_exists(conn, table_name):
            raise RuntimeError(f"Required database table is missing: {table_name}")

    for table_name, required_columns in REQUIRED_TABLE_COLUMNS.items():
        existing_columns = set(await get_existing_columns(conn, table_name))

        for column_name, column_type in required_columns.items():
            if column_name in existing_columns:
                continue

            logger.warning("Adding missing database column: %s.%s", table_name, column_name)
            await conn.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column_name} {column_type}")
            )

    await _normalize_column_defaults(conn)
    await _log_relationship_status(conn)


async def _normalize_column_defaults(conn: AsyncConnection) -> None:
    await conn.execute(text("UPDATE clinic_time_slots SET slots = '[]' WHERE slots IS NULL"))
    await conn.execute(text("UPDATE clinic_time_slots SET slot = '{}' WHERE slot IS NULL"))
    await conn.execute(
        text("UPDATE clinic_time_slots SET daily_toggle_counts = '[]' WHERE daily_toggle_counts IS NULL")
    )


async def _log_relationship_status(conn: AsyncConnection) -> None:
    clinic_slot_fks = await get_foreign_keys(conn, "clinic_time_slots")
    appointment_fks = await get_foreign_keys(conn, "appointments")

    if not clinic_slot_fks:
        logger.info(
            "clinic_time_slots has no database-level foreign key. "
            "Application links clinic_time_slots.clinic_id to clinics.clinic_id."
        )

    if not appointment_fks:
        logger.info(
            "appointments has no database-level foreign keys. "
            "Application links appointments.clinic_id to clinics.clinic_id."
        )
