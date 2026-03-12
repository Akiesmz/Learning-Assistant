from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, Optional
import logging
import time

from app.core.auth import require_user
from app.services.learning_db import learning_db


router = APIRouter(prefix="/events", tags=["events"])
logger = logging.getLogger("app.events")


class TrackEventRequest(BaseModel):
    event: str
    payload: Optional[Dict[str, Any]] = None
    ts_ms: Optional[int] = None


@router.post("/track")
async def track_event(req: TrackEventRequest, username: str = Depends(require_user)):
    event = (req.event or "").strip()
    if not event:
        raise HTTPException(status_code=400, detail="event is required")
    ts = req.ts_ms if isinstance(req.ts_ms, int) else int(time.time() * 1000)
    payload = req.payload if isinstance(req.payload, dict) else None
    logger.info("event_track event=%s ts_ms=%s payload=%s", event, ts, payload)
    try:
        learning_db.insert_event(username=username, event=event, payload=payload, ts_ms=ts)
    except Exception:
        logger.exception("event_store_failed event=%s", event)
    return {"ok": True}
