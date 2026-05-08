from datetime import datetime, timedelta, timezone

from sqlalchemy import text


CLINIC_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
ACTIVE_STATUSES = ("booked", "pending", "serving")


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
        return {
            "found": False,
            "patients_ahead": 0,
            "estimated_wait_minutes": 0,
            "your_position": 0,
            "total_in_queue": len(queue_items),
            "position_label": "0/0",
            "now_serving_token": current_token_text,
        }

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

    return {
        "found": True,
        "patients_ahead": patients_ahead,
        "estimated_wait_minutes": patients_ahead * 15,
        "your_position": your_position,
        "total_in_queue": total_in_queue,
        "position_label": f"{your_position}/{total_in_queue}",
        "now_serving_token": now_serving_token,
    }
