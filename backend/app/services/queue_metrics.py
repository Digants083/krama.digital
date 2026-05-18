import json
import math
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import text


CLINIC_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
ACTIVE_STATUSES = ("booked", "pending", "serving")
DEFAULT_MIN_CONSULTATION_MINUTES = 8
DEFAULT_MAX_CONSULTATION_MINUTES = 12
DEFAULT_HISTORY_LIMIT = 12
ROLLING_AVERAGE_SAMPLE_MIN = 2
ROLLING_AVERAGE_SAMPLE_MAX = 5
QUEUE_COMPRESSION_MIN = 0.82


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


def _live_queue_sort_key(item, serving_token_number=None):
    token_number = _token_number(item["token"])
    if serving_token_number is None:
        token_bucket = 0
    else:
        token_bucket = 0 if token_number >= serving_token_number else 1
    return (
        _status_rank(item["status"]),
        token_bucket,
        token_number,
        _to_int(item["queue_position"], 10 ** 9),
        _sort_datetime(item["created_at"]),
        _to_int(item["id"], 10 ** 9),
        0 if item["source"] == "online" else 1,
    )


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


def _round_minutes(value):
    return round(float(value), 1)


def _empty_metrics(current_token_text, total_in_queue=0):
    now = datetime.now(CLINIC_TIMEZONE)
    return {
        "found": False,
        "patients_ahead": 0,
        "estimated_wait_minutes": 0,
        "latest_estimated_wait_minutes": 0,
        "earliest_eta": now.isoformat(),
        "predicted_eta": now.isoformat(),
        "latest_eta": now.isoformat(),
        "rolling_average_minutes": _round_minutes((DEFAULT_MIN_CONSULTATION_MINUTES + DEFAULT_MAX_CONSULTATION_MINUTES) / 2),
        "weighted_average_minutes": _round_minutes((DEFAULT_MIN_CONSULTATION_MINUTES + DEFAULT_MAX_CONSULTATION_MINUTES) / 2),
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


class QueuePredictionEngine:
    """
    Centralized adaptive ETA engine.

    Uses real completed consultation durations as the learning signal and keeps
    frontend clients from owning any queue timing math.
    """

    def __init__(self, db):
        self.db = db

    async def predict(self, clinic_id, date, slot_id, queue_items, current_index):
        min_minutes, max_minutes = await _clinic_consultation_range(self.db, clinic_id)
        timing_state = await _session_timing_state(self.db, clinic_id, date, slot_id)
        history_metrics = await self._duration_history_metrics(clinic_id, date, slot_id, min_minutes, max_minutes)
        rolling_average = history_metrics["rolling_average_minutes"]
        weighted_average = history_metrics["weighted_average_minutes"]
        predicted_minutes = self._hybrid_prediction_minutes(
            rolling_average,
            weighted_average,
            min_minutes,
            max_minutes,
        )

        wait = self._queue_wait_minutes(queue_items, current_index, min_minutes, predicted_minutes, max_minutes)
        base_time = timing_state["base_time"]
        earliest_eta = base_time + timedelta(minutes=wait["earliest"])
        predicted_eta = base_time + timedelta(minutes=wait["predicted"])
        latest_eta = base_time + timedelta(minutes=wait["latest"])
        now = datetime.now(CLINIC_TIMEZONE)
        window_text = f"{_format_clock(earliest_eta)} - {_format_clock(latest_eta)}"

        return {
            "estimated_wait_minutes": max(0, math.ceil((predicted_eta - now).total_seconds() / 60)),
            "latest_estimated_wait_minutes": max(0, math.ceil((latest_eta - now).total_seconds() / 60)),
            "earliest_eta": earliest_eta.isoformat(),
            "predicted_eta": predicted_eta.isoformat(),
            "latest_eta": latest_eta.isoformat(),
            "rolling_average_minutes": _round_minutes(rolling_average),
            "weighted_average_minutes": _round_minutes(weighted_average),
            "consultation_window": window_text,
            "estimated_window_text": window_text,
            "consultation_min_minutes": min_minutes,
            "consultation_max_minutes": max_minutes,
            **{key: value for key, value in timing_state.items() if key != "base_time"},
        }

    async def _duration_history_metrics(self, clinic_id, date, slot_id, min_minutes, max_minutes):
        rows = await self._duration_history(clinic_id, date, slot_id)
        durations = [seconds / 60 for seconds in rows if seconds and seconds > 0]
        durations = self._remove_outliers(durations)

        fallback = (min_minutes + max_minutes) / 2
        if not durations:
            return {
                "rolling_average_minutes": fallback,
                "weighted_average_minutes": fallback,
            }
        if len(durations) == 1:
            blended = (durations[0] * 0.6) + (fallback * 0.4)
            return {
                "rolling_average_minutes": blended,
                "weighted_average_minutes": blended,
            }

        sample = durations[:ROLLING_AVERAGE_SAMPLE_MAX]
        return {
            "rolling_average_minutes": sum(sample) / len(sample),
            "weighted_average_minutes": self._weighted_average(sample),
        }

    async def _duration_history(self, clinic_id, date, slot_id):
        params = {
            "clinic_id": clinic_id,
            "date": date,
            "limit": DEFAULT_HISTORY_LIMIT,
        }
        slot_clause = ""
        if slot_id is not None:
            slot_clause = " AND slot_id = :slot_id"
            params["slot_id"] = slot_id

        result = await self.db.execute(
            text(
                f"""
                SELECT duration_seconds
                FROM (
                    SELECT
                        id,
                        COALESCE(completed_at, finished_at, served_at) AS completed_sort_at,
                        COALESCE(
                            NULLIF(consultation_duration_minutes, 0) * 60,
                            NULLIF(service_duration_seconds, 0),
                            EXTRACT(EPOCH FROM (COALESCE(completed_at, finished_at) - COALESCE(serving_started_at, served_at)))
                        ) AS duration_seconds
                    FROM completed_appointments
                    WHERE clinic_id = :clinic_id
                      AND date = :date
                      {slot_clause}
                      AND (served IS TRUE OR outcome = 'served' OR status IN ('completed', 'served'))
                ) history
                WHERE duration_seconds IS NOT NULL
                  AND duration_seconds > 0
                ORDER BY completed_sort_at DESC NULLS LAST, id DESC
                LIMIT :limit
                """
            ),
            params,
        )
        return [row.get("duration_seconds") for row in result.mappings().all()]

    def _remove_outliers(self, durations):
        sane = [duration for duration in durations if 2 <= duration <= 60]
        if len(sane) < ROLLING_AVERAGE_SAMPLE_MIN + 1:
            return sane

        sorted_values = sorted(sane)
        median = sorted_values[len(sorted_values) // 2]
        if median <= 0:
            return sane

        filtered = [
            duration
            for duration in sane
            if duration >= median * 0.35 and duration <= median * 2.5
        ]
        return filtered or sane[:ROLLING_AVERAGE_SAMPLE_MAX]

    def _weighted_average(self, durations):
        sample = durations[:ROLLING_AVERAGE_SAMPLE_MAX]
        weights = list(range(len(sample), 0, -1))
        return sum(duration * weight for duration, weight in zip(sample, weights)) / sum(weights)

    def _hybrid_prediction_minutes(self, rolling_average, weighted_average, min_minutes, max_minutes):
        bounded_weighted = min(max(weighted_average, min_minutes), max_minutes)
        bounded_rolling = min(max(rolling_average, min_minutes), max_minutes)
        configured_midpoint = (min_minutes + max_minutes) / 2
        return (bounded_weighted * 0.65) + (bounded_rolling * 0.2) + (configured_midpoint * 0.15)

    def _queue_wait_minutes(self, queue_items, current_index, min_minutes, predicted_minutes, max_minutes):
        totals = {"earliest": 0.0, "predicted": 0.0, "latest": 0.0}
        if current_index is None or current_index <= 0:
            return totals

        for index, item in enumerate(queue_items[:current_index]):
            elapsed = self._elapsed_serving_minutes(item)
            if item.get("status") == "serving":
                totals["earliest"] += max(0, min_minutes - elapsed)
                totals["predicted"] += max(1, predicted_minutes - elapsed)
                totals["latest"] += max(0, max_minutes - elapsed)
            else:
                compression = max(QUEUE_COMPRESSION_MIN, 1 - min(index, 6) * 0.03)
                totals["earliest"] += min_minutes * compression
                totals["predicted"] += predicted_minutes * compression
                totals["latest"] += max_minutes * max(compression, 0.9)

        return totals

    def _elapsed_serving_minutes(self, item):
        started_at = _parse_dt(item.get("serving_started_at"))
        if not started_at:
            return 0.0
        return max(0.0, (datetime.now(CLINIC_TIMEZONE) - started_at).total_seconds() / 60)


ETAEngine = QueuePredictionEngine


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


async def _fetch_queue_rows(db, table_name, clinic_id, date, source, slot_id):
    params = {"clinic_id": clinic_id, "date": date}
    slot_clause = ""
    if slot_id is not None:
        slot_clause = " AND slot_id = :slot_id"
        params["slot_id"] = slot_id

    sql = f"""
        SELECT id, appointment_token, status, created_at, queue_position, slot_id, serving_started_at
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
            "serving_started_at": row.get("serving_started_at"),
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

    serving_token_number = next(
        (_token_number(item["token"]) for item in queue_items if item["status"] == "serving"),
        None,
    )
    queue_items.sort(key=lambda item: _live_queue_sort_key(item, serving_token_number))

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

    window = await QueuePredictionEngine(db).predict(clinic_id, date, slot_id, queue_items, your_index)

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
