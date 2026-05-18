import logging
from typing import Dict, List, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger(__name__)


REQUIRED_TABLE_COLUMNS: Dict[str, Dict[str, str]] = {
    "appointments": {
        "notification_stage": "VARCHAR DEFAULT 'pending'",
        "last_email_sent_at": "TIMESTAMP",
        "patient_email": "VARCHAR DEFAULT ''",
        "doctor_name": "VARCHAR",
        "source": "VARCHAR DEFAULT 'online'",
        "slot_id": "INTEGER",
        "push_count": "INTEGER DEFAULT 0",
        "queue_position": "INTEGER",
        "serving_started_at": "TIMESTAMP",
    },
    "qr_appointments": {
        "doctor_name": "VARCHAR",
        "slot_id": "INTEGER",
        "queue_position": "INTEGER",
        "serving_started_at": "TIMESTAMP",
    },
    "completed_appointments": {
        "doctor_id": "VARCHAR",
        "slot_id": "INTEGER",
        "serving_started_at": "TIMESTAMP",
        "finished_at": "TIMESTAMP",
        "completed_at": "TIMESTAMP",
        "status": "VARCHAR DEFAULT 'served'",
        "wait_time_minutes": "INTEGER",
        "service_duration_seconds": "INTEGER",
        "consultation_duration_minutes": "INTEGER",
        "outcome": "VARCHAR DEFAULT 'served'",
        "served": "BOOLEAN DEFAULT TRUE",
        "push_count": "INTEGER DEFAULT 0",
    },
    "clinic_time_slots": {
        "slots": "JSON DEFAULT '[]'",
        "slot": "VARCHAR[] DEFAULT '{}'",
        "slot_delays": "JSON DEFAULT '[]'",
        "last_slot_change_date": "TIMESTAMP",
        "daily_toggle_counts": "JSON DEFAULT '[]'",
        "last_toggle_date": "TIMESTAMP",
        "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "updated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    "doctor_sessions": {
        "clinic_id": "VARCHAR",
        "doctor_id": "VARCHAR",
        "session_name": "VARCHAR DEFAULT ''",
        "start_time": "VARCHAR DEFAULT ''",
        "end_time": "VARCHAR DEFAULT ''",
        "status": "VARCHAR DEFAULT 'available'",
        "delay_minutes": "INTEGER DEFAULT 0",
        "delay_started_at": "TIMESTAMP",
        "delay_ends_at": "TIMESTAMP",
        "delay_original_start_time": "VARCHAR",
        "delay_updated_start_time": "VARCHAR",
        "delay_version": "INTEGER DEFAULT 0",
        "is_active": "BOOLEAN DEFAULT TRUE",
        "slot_id": "INTEGER",
        "session_date": "VARCHAR",
        "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "updated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    },
    "clinics": {
        "category": "VARCHAR",
        "categories": "JSON",
        "street_address": "VARCHAR",
        "road": "VARCHAR",
        "layout": "VARCHAR",
        "section": "VARCHAR",
        "city": "VARCHAR",
        "pincode": "VARCHAR",
        "latitude": "VARCHAR",
        "longitude": "VARCHAR",
        "admin_pinned_latitude": "VARCHAR",
        "admin_pinned_longitude": "VARCHAR",
        "specialization": "VARCHAR",
        "experience": "VARCHAR",
        "qualifications": "VARCHAR",
        "has_pinned_location": "BOOLEAN DEFAULT FALSE",
        "booking_cutoff_minutes": "INTEGER DEFAULT 15",
        "consultation_min_minutes": "INTEGER DEFAULT 8",
        "consultation_max_minutes": "INTEGER DEFAULT 12",
        "is_active": "BOOLEAN DEFAULT FALSE",
        "manual_stop_date": "VARCHAR",
    },
    "reports": {
        "report_pdf": "VARCHAR",
        "report_pdf_filename": "VARCHAR",
        "report_pdf_content_type": "VARCHAR",
        "report_pdf_data": "BYTEA",
        "report_type": "VARCHAR",
    },
    "completed_reports": {
        "report_pdf": "VARCHAR",
        "report_pdf_filename": "VARCHAR",
        "report_pdf_content_type": "VARCHAR",
        "report_pdf_data": "BYTEA",
        "report_type": "VARCHAR",
    },
}


EXPECTED_RELATED_TABLES = [
    "clinics",
    "appointments",
    "qr_appointments",
    "completed_appointments",
    "doctor_sessions",
    "clinic_time_slots",
    "reports",
    "completed_reports",
]


REQUIRED_INDEXES: Dict[str, str] = {
    "idx_appointments_queue_eta": (
        "CREATE INDEX IF NOT EXISTS idx_appointments_queue_eta "
        "ON appointments(clinic_id, date, slot_id, status, queue_position)"
    ),
    "idx_appointments_serving_started_at": (
        "CREATE INDEX IF NOT EXISTS idx_appointments_serving_started_at "
        "ON appointments(serving_started_at)"
    ),
    "idx_appointments_session_id": (
        "CREATE INDEX IF NOT EXISTS idx_appointments_session_id "
        "ON appointments(session_id)"
    ),
    "idx_qr_appointments_queue_eta": (
        "CREATE INDEX IF NOT EXISTS idx_qr_appointments_queue_eta "
        "ON qr_appointments(clinic_id, date, slot_id, status, queue_position)"
    ),
    "idx_qr_appointments_serving_started_at": (
        "CREATE INDEX IF NOT EXISTS idx_qr_appointments_serving_started_at "
        "ON qr_appointments(serving_started_at)"
    ),
    "idx_qr_appointments_session_id": (
        "CREATE INDEX IF NOT EXISTS idx_qr_appointments_session_id "
        "ON qr_appointments(session_id)"
    ),
    "idx_completed_appointments_eta_history": (
        "CREATE INDEX IF NOT EXISTS idx_completed_appointments_eta_history "
        "ON completed_appointments(clinic_id, date, slot_id, completed_at DESC)"
    ),
    "idx_completed_appointments_serving_started_at": (
        "CREATE INDEX IF NOT EXISTS idx_completed_appointments_serving_started_at "
        "ON completed_appointments(serving_started_at)"
    ),
    "idx_completed_appointments_status": (
        "CREATE INDEX IF NOT EXISTS idx_completed_appointments_status "
        "ON completed_appointments(status)"
    ),
    "idx_completed_appointments_session_id": (
        "CREATE INDEX IF NOT EXISTS idx_completed_appointments_session_id "
        "ON completed_appointments(session_id)"
    ),
    "idx_completed_appointments_doctor_id": (
        "CREATE INDEX IF NOT EXISTS idx_completed_appointments_doctor_id "
        "ON completed_appointments(doctor_id)"
    ),
    "idx_doctor_sessions_doctor_id": (
        "CREATE INDEX IF NOT EXISTS idx_doctor_sessions_doctor_id "
        "ON doctor_sessions(doctor_id)"
    ),
    "idx_doctor_sessions_eta": (
        "CREATE INDEX IF NOT EXISTS idx_doctor_sessions_eta "
        "ON doctor_sessions(clinic_id, slot_id, session_date, status)"
    ),
}


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
    added_columns: List[str] = []

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
            added_columns.append(f"{table_name}.{column_name}")

    await _normalize_column_defaults(conn)
    await _ensure_required_indexes(conn)
    await _log_relationship_status(conn)

    if added_columns:
        logger.warning("Database schema repair added columns: %s", ", ".join(added_columns))
    else:
        logger.info("Database schema check passed; no missing columns found.")


async def get_schema_report(conn: AsyncConnection) -> Dict[str, object]:
    report: Dict[str, object] = {"tables": {}, "missing": {}}

    for table_name in EXPECTED_RELATED_TABLES:
        exists = await table_exists(conn, table_name)
        table_report = {"exists": exists, "columns": []}
        if exists:
            table_report["columns"] = await get_existing_columns(conn, table_name)
        report["tables"][table_name] = table_report

    for table_name, required_columns in REQUIRED_TABLE_COLUMNS.items():
        if not await table_exists(conn, table_name):
            report["missing"][table_name] = ["<table missing>"]
            continue

        existing_columns = set(await get_existing_columns(conn, table_name))
        missing_columns = sorted(set(required_columns) - existing_columns)
        if missing_columns:
            report["missing"][table_name] = missing_columns

    return report


async def _normalize_column_defaults(conn: AsyncConnection) -> None:
    await conn.execute(text("UPDATE clinic_time_slots SET slots = '[]' WHERE slots IS NULL"))
    await conn.execute(text("UPDATE clinic_time_slots SET slot = '{}' WHERE slot IS NULL"))
    await conn.execute(text("UPDATE clinic_time_slots SET slot_delays = '[]' WHERE slot_delays IS NULL"))
    await conn.execute(
        text("UPDATE clinic_time_slots SET daily_toggle_counts = '[]' WHERE daily_toggle_counts IS NULL")
    )
    await conn.execute(text("UPDATE completed_appointments SET completed_at = finished_at WHERE completed_at IS NULL AND finished_at IS NOT NULL"))
    await conn.execute(text("UPDATE completed_appointments SET serving_started_at = served_at WHERE serving_started_at IS NULL AND served_at IS NOT NULL"))
    await conn.execute(
        text(
            """
            UPDATE completed_appointments
            SET consultation_duration_minutes = GREATEST(1, CEIL(service_duration_seconds / 60.0)::INTEGER)
            WHERE consultation_duration_minutes IS NULL
              AND service_duration_seconds IS NOT NULL
              AND service_duration_seconds > 0
            """
        )
    )


async def _ensure_required_indexes(conn: AsyncConnection) -> None:
    for index_sql in REQUIRED_INDEXES.values():
        await conn.execute(text(index_sql))


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
