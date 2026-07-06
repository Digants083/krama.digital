from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import AsyncIterator, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/realtime", tags=["realtime"])
_subscribers: dict[str, set[asyncio.Queue[dict]]] = defaultdict(set)


async def publish_queue_event(clinic_id: str, event_type: str, payload: Optional[dict] = None) -> None:
    """Fan out a lightweight invalidation event to connected clinic screens."""
    if not clinic_id:
        return
    message = {"type": event_type, "clinic_id": clinic_id, "payload": payload or {}}
    for queue in list(_subscribers.get(clinic_id, set())):
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            pass


async def _event_stream(request: Request, clinic_id: str) -> AsyncIterator[str]:
    queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=20)
    _subscribers[clinic_id].add(queue)
    try:
        yield "event: connected\ndata: {}\n\n"
        while not await request.is_disconnected():
            try:
                message = await asyncio.wait_for(queue.get(), timeout=20)
                yield f"event: queue\ndata: {json.dumps(message)}\n\n"
            except asyncio.TimeoutError:
                yield "event: heartbeat\ndata: {}\n\n"
    finally:
        _subscribers[clinic_id].discard(queue)
        if not _subscribers[clinic_id]:
            _subscribers.pop(clinic_id, None)


@router.get("/queue-events")
async def queue_events(request: Request, clinic_id: str = Query(...)):
    return StreamingResponse(
        _event_stream(request, clinic_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
