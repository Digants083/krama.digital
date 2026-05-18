import json
import math
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import text


CLINIC_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
ACTIVE_STATUSES = ("booked", "pending", "serving")
DEFAULT_MIN_CONSULTATION_MINUTES = 8
DEFAULT_MAX_CONSULTATION_MINUTES = 12


def _sort_datetime(value):
    if value is None:
        return datetime.min.replace(tzinfo=CLINIC_TIMEZONE)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=CLINIC_TIMEZONE)
        except ValueError:
            return datetime.min.replace(tzinfo=CLINIC_TIMEZONE)
    if value.tzinfo is None:
        return value.replace(tzinfo=CLINIC_TIMEZONE)
    return value


def _token_number(token):
    digits = "".join(ch for ch in str(token or "") if ch.isdigit())
    return int(digits) if digits else 10 ** 9


def _to_int(value, default=0):
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _status_rank(status):
    return 0 if status == "serving" else 1


def _load_json_list(value):
    if isinstance(value, str):
        return json.loads(value) if value else []
    return list(value or [])


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=CLINIC_TIMEZONE)
    return parsed.astimezone(CLINIC_TIMEZONE)


def _delay_minutes(value):
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return max(0, int(value))
    lowered = str(value).strip().lower()
    match = re.search(r"\d+", lowered)
    if not match:
        return 0
    amount = int(match.group(0))
    return amount * 60 if "hour" in lowered else amount


def _time_decimal_to_datetime(date_text, decimal_hour):
    try:
        base_date = datetime.strptime(str(date_text), "%Y-%m-%d").date()
        hour_value = float(decimal_hour)
    except (TypeError, ValueError):
        return None

    day_offset = int(hour_value // 24)
    total_minutes = int(round((hour_value % 24) * 60))
    if total_minutes >= 24 * 60:
        day_offset += 1
        total_minutes -= 24 * 60
    hour = total_minutes // 60
    minute = total_minutes % 60
    return datetime.combine(base_date + timedelta(days=day_offset), datetime.min.time(), tzinfo=CLINIC_TIMEZONE).replace(
        hour=hour,
        minute=minute,
    )


def _format_clock(value):
    local_value = value.astimezone(CLINIC_TIMEZONE) if value.tzinfo else value.replace(tzinfo=CLINIC_TIMEZONE)
    return local_value.strftime("%I:%M %p").lstrip("0")


def _empty_metrics(current_token_text, total_in_queue=0):
    now = datetime.now(CLINIC_TIMEZONE)
    return {
        "found": False,
        "patients_ahead": 0,
        "estimated_wait_minutes": 0,
        "latest_estimated_wait_minutes": 0,
        "earliest_eta": now.isoformat(),
        "latest_eta": now.isoformat(),
        "consultation_window": f"{_format_clock(now)} - {_format_clock(now)}",
        "estimated_window_text": f"{_format_clock(now)} - {_format_clock(now)}",
        "active_delay_minutes": 0,
        "doctor_delay_minutes": 0,
        "queue_adjusted_time": now.isoformat(),
        "your_position": 0,
        "queue_position": 0,
        "total_in_queue": total_in_queue,
        "position_label": "0/0",
        "now_serving_token": current_token_text,
        "session_status": "not_found",
        "consultation_min_minutes": DEFAULT_MIN_CONSULTATION_MINUTES,
        "consultation_max_minutes": DEFAULT_MAX_CONSULTATION_MINUTES,
    }


async def _clinic_consultation_range(db, clinic_id):
    result = await db.execute(
        text(
            """
            SELECT *
            FROM clinics
            WHERE clinic_id = :clinic_id
            LIMIT 1
            """
        ),
        {"clinic_id": clinic_id},
    )
    row = result.mappings().first()
    if not row:
        return DEFAULT_MIN_CONSULTATION_MINUTES, DEFAULT_MAX_CONSULTATION_MINUTES

    min_candidates = (
        "min_consultation_minutes",
        "minimum_consultation_minutes",
        "consultation_min_minutes",
        "min_consultation_time",
    )
    max_candidates = (
        "max_consultation_minutes",
        "maximum_consultation_minutes",
        "consultation_max_minutes",
        "max_consultation_time",
    )
    min_minutes = next((_to_int(row.get(key), 0) for key in min_candidates if row.get(key) is not None), 0)
    max_minutes = next((_to_int(row.get(key), 0) for key in max_candidates if row.get(key) is not None), 0)

    if min_minutes <= 0:
        min_minutes = DEFAULT_MIN_CONSULTATION_MINUTES
    if max_minutes <= 0:
        max_minutes = DEFAULT_MAX_CONSULTATION_MINUTES
    if max_minutes < min_minutes:
        max_minutes = min_minutes
    return min_minutes, max_minutes


async def _session_timing_state(db, clinic_id, date, slot_id):
    now = datetime.now(CLINIC_TIMEZONE)
    base_time = now
    active_delay_minutes = 0
    session_status = "active"

    if slot_id is not None:
        result = await db.execute(
            text(
                """
                SELECT slots, slot_delays
                FROM clinic_time_slots
                WHERE clinic_id = :clinic_id
                LIMIT 1
                """
            ),
            {"clinic_id": clinic_id},
        )
        slot_record = result.mappings().first()
        if slot_record:
            slots = _load_json_list(slot_record.get("slots"))
            slot_delays = _load_json_list(slot_record.get("slot_delays"))
            slot_index = _to_int(slot_id, 0) - 1
            if 0 <= slot_index < len(slots):
                slot = slots[slot_index] or {}
                time_range = slot.get("time_range") or []
                if time_range:
                    session_start = _time_decimal_to_datetime(date, time_range[0])
                    if session_start and session_start > base_time:
                        base_time = session_start

                slot_delay_minutes = _delay_minutes(slot_delays[slot_index] if slot_index < len(slot_delays) else slot.get("delay_minutes"))
                delay_ends_at = _parse_dt(slot.get("delay_ends_at"))
                is_delay_active = slot_delay_minutes > 0 and (not delay_ends_at or delay_ends_at > now)
                if is_delay_active:
                    active_delay_minutes = max(active_delay_minutes, slot_delay_minutes)
                    session_status = "delayed"
                if delay_ends_at and delay_ends_at > base_time:
                    base_time = delay_ends_at
                elif slot.get("status_override"):
                    session_status = str(slot.get("status_override")).lower()

        session_result = await db.execute(
            text(
                """
                SELECT delay_minutes, delay_ends_at, status
                FROM doctor_sessions
                WHERE clinic_id = :clinic_id
                  AND slot_id = :slot_id
                  AND (session_date = :date OR session_date IS NULL)
                ORDER BY session_date DESC NULLS LAST, id DESC
                LIMIT 1
                """
            ),
            {"clinic_id": clinic_id, "slot_id": slot_id, "date": date},
        )
        session_row = session_result.mappings().first()
        if session_row:
            session_delay_minutes = _delay_minutes(session_row.get("delay_minutes"))
            delay_ends_at = _parse_dt(session_row.get("delay_ends_at"))
            is_delay_active = session_delay_minutes > 0 and (not delay_ends_at or delay_ends_at > now)
            if is_delay_active:
                active_delay_minutes = max(active_delay_minutes, session_delay_minutes)
                session_status = "delayed"
            elif session_row.get("status"):
                session_status = str(session_row.get("status")).lower()
            if delay_ends_at and delay_ends_at > base_time:
                base_time = delay_ends_at

    if active_delay_minutes > 0 and base_time <= now:
        base_time = now + timedelta(minutes=active_delay_minutes)

    return {
        "base_time": base_time,
        "active_delay_minutes": active_delay_minutes,
        "doctor_delay_minutes": active_delay_minutes,
        "queue_adjusted_time": base_time.isoformat(),
        "session_status": session_status,
    }


async def _consultation_window(db, clinic_id, date, slot_id, patients_ahead):
    min_minutes, max_minutes = await _clinic_consultation_range(db, clinic_id)
    timing_state = await _session_timing_state(db, clinic_id, date, slot_id)
    base_time = timing_state["base_time"]
    earliest_eta = base_time + timedelta(minutes=patients_ahead * min_minutes)
    latest_eta = base_time + timedelta(minutes=patients_ahead * max_minutes)
    now = datetime.now(CLINIC_TIMEZONE)
    window_text = f"{_format_clock(earliest_eta)} - {_format_clock(latest_eta)}"

    return {
        "estimated_wait_minutes": max(0, math.ceil((earliest_eta - now).total_seconds() / 60)),
        "latest_estimated_wait_minutes": max(0, math.ceil((latest_eta - now).total_seconds() / 60)),
        "earliest_eta": earliest_eta.isoformat(),
        "latest_eta": latest_eta.isoformat(),
        "consultation_window": window_text,
        "estimated_window_text": window_text,
        "consultation_min_minutes": min_minutes,
        "consultation_max_minutes": max_minutes,
        **{key: value for key, value in timing_state.items() if key != "base_time"},
    }


async def _fetch_queue_rows(db, table_name, clinic_id, date, source, slot_id):
    params = {"clinic_id": clinic_id, "date": date}
    slot_clause = ""
    if slot_id is not None:
        slot_clause = " AND slot_id = :slot_id"
        params["slot_id"] = slot_id

    sql = f"""
        SELECT id, appointment_token, status, created_at, queue_position, slot_id
        FROM {table_name}
        WHERE clinic_id = :clinic_id
          AND date = :date
          AND status IN ('booked', 'pending', 'serving')
          {slot_clause}
    """
    result = await db.execute(text(sql), params)

    rows = []
    for row in result.mappings().all():
        rows.append({
            "id": row.get("id"),
            "token": row.get("appointment_token") or "",
            "status": row.get("status") or "booked",
            "source": source,
            "created_at": row.get("created_at"),
            "queue_position": row.get("queue_position"),
            "slot_id": row.get("slot_id"),
        })
    return rows


async def get_live_queue_metrics(db, clinic_id, date, current_source, current_id, current_token=None, slot_id=None):
    """
    Calculate queue metrics from the live combined online + walk-in queue.

    This intentionally uses token order as the stable queue order because saved
    queue_position can become stale after walk-ins, skips, or older data repairs.
    """
    queue_items = []
    queue_items.extend(await _fetch_queue_rows(db, "appointments", clinic_id, date, "online", slot_id))
    queue_items.extend(await _fetch_queue_rows(db, "qr_appointments", clinic_id, date, "walkin", slot_id))

    queue_items.sort(key=lambda item: (
        _status_rank(item["status"]),
        _to_int(item["queue_position"], 10 ** 9),
        _token_number(item["token"]),
        _sort_datetime(item["created_at"]),
        _to_int(item["id"], 10 ** 9),
        0 if item["source"] == "online" else 1,
    ))

    current_id_text = str(current_id) if current_id is not None else ""
    current_token_text = str(current_token or "")
    your_index = None

    for index, item in enumerate(queue_items):
        same_source = item["source"] == current_source
        same_id = current_id_text and str(item["id"]) == current_id_text
        same_token = current_token_text and item["token"] == current_token_text
        if same_source and (same_id or same_token):
            your_index = index
            break

    if your_index is None:
        return _empty_metrics(current_token_text, len(queue_items))

    your_position = your_index + 1
    patients_ahead = your_index
    total_in_queue = len(queue_items)

    serving_item = next((item for item in queue_items if item["status"] == "serving"), None)
    if serving_item:
        now_serving_token = serving_item["token"]
    elif your_position > 1:
        now_serving_token = queue_items[your_position - 2]["token"]
    elif queue_items:
        now_serving_token = queue_items[0]["token"]
    else:
        now_serving_token = current_token_text

    window = await _consultation_window(db, clinic_id, date, slot_id, patients_ahead)

    return {
        "found": True,
        "patients_ahead": patients_ahead,
        "your_position": your_position,
        "queue_position": your_position,
        "total_in_queue": total_in_queue,
        "position_label": f"{your_position}/{total_in_queue}",
        "now_serving_token": now_serving_token,
        **window,
    }
