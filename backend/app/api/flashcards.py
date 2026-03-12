from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import json
import logging
import time

from app.core.auth import require_user
from app.services.learning_db import learning_db
from app.services.llm_service import llm_service


router = APIRouter(prefix="/flashcards", tags=["flashcards"])
logger = logging.getLogger("app.flashcards")


class LlmConfig(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None


class FromAnswerRequest(BaseModel):
    answer: str
    query: Optional[str] = None
    count: int = 3
    tags: Optional[List[str]] = None
    source_doc: Optional[str] = None
    source_chunk_id: Optional[str] = None
    llm: Optional[LlmConfig] = None


class ReviewRequest(BaseModel):
    grade: int


def _parse_tags(tags_json: Optional[str]) -> List[str]:
    if not tags_json:
        return []
    try:
        v = json.loads(tags_json)
        if isinstance(v, list):
            return [str(x) for x in v if str(x).strip()]
    except Exception:
        return []
    return []

def _parse_format(format_json: Optional[str]) -> Optional[Dict[str, Any]]:
    if not format_json:
        return None
    try:
        v = json.loads(format_json)
        return v if isinstance(v, dict) else None
    except Exception:
        return None


@router.post("/from_answer")
async def create_from_answer(req: FromAnswerRequest, username: str = Depends(require_user)):
    answer = (req.answer or "").strip()
    if not answer:
        raise HTTPException(status_code=400, detail="answer is required")
    count = max(1, min(int(req.count or 3), 10))
    llm_cfg: Optional[Dict[str, Any]] = req.llm.dict() if req.llm is not None else None

    cards = llm_service.generate_flashcards_from_answer(
        answer=answer,
        query=(req.query or "").strip() or None,
        limit=count,
        llm_cfg=llm_cfg,
    )
    if not cards:
        raise HTTPException(status_code=500, detail="failed to generate flashcards")

    base_tags = req.tags if isinstance(req.tags, list) else None
    for c in cards:
        if base_tags and not c.get("tags"):
            c["tags"] = base_tags
        if req.source_doc and not c.get("source_doc"):
            c["source_doc"] = req.source_doc
        if req.source_chunk_id and not c.get("source_chunk_id"):
            c["source_chunk_id"] = req.source_chunk_id

    created_ids = learning_db.create_flashcards(username, cards)
    if not created_ids:
        raise HTTPException(status_code=500, detail="no valid cards created")

    try:
        learning_db.insert_event(username, "flashcard_created", payload={"count": len(created_ids)})
    except Exception:
        logger.exception("flashcard_created_event_failed")

    stored_cards = []
    for idx, cid in enumerate(created_ids):
        c = cards[idx] if idx < len(cards) else {}
        stored_cards.append(
            {
                "id": cid,
                "front": c.get("front"),
                "back": c.get("back"),
                "tags": c.get("tags") if isinstance(c.get("tags"), list) else [],
                "format": c.get("format") if isinstance(c.get("format"), dict) else None,
                "source_doc": c.get("source_doc"),
                "source_chunk_id": c.get("source_chunk_id"),
            }
        )
    return {"created_ids": created_ids, "cards": stored_cards}


@router.get("/due")
async def get_due(limit: int = 50, username: str = Depends(require_user)):
    cards = learning_db.list_due_flashcards(username, limit=max(1, min(int(limit), 200)))
    return {
        "cards": [
            {
                "id": c.id,
                "front": c.front,
                "back": c.back,
                "tags": _parse_tags(c.tags_json),
                "format": _parse_format(c.format_json),
                "source_doc": c.source_doc,
                "source_chunk_id": c.source_chunk_id,
                "created_ts_ms": c.created_ts_ms,
                "due_ts_ms": c.due_ts_ms,
                "interval_days": c.interval_days,
                "ease_factor": c.ease_factor,
                "reps": c.reps,
                "lapses": c.lapses,
                "last_review_ts_ms": c.last_review_ts_ms,
            }
            for c in cards
        ]
    }


@router.post("/{card_id}/review")
async def review(card_id: int, req: ReviewRequest, username: str = Depends(require_user)):
    updated = learning_db.apply_review(username, card_id=int(card_id), grade=int(req.grade))
    if not updated:
        raise HTTPException(status_code=404, detail="card not found")
    try:
        learning_db.insert_event(username, "flashcard_review", payload={"card_id": int(card_id), "grade": int(req.grade)})
    except Exception:
        logger.exception("flashcard_review_event_failed")
    return {
        "card": {
            "id": updated.id,
            "front": updated.front,
            "back": updated.back,
            "tags": _parse_tags(updated.tags_json),
            "format": _parse_format(updated.format_json),
            "source_doc": updated.source_doc,
            "source_chunk_id": updated.source_chunk_id,
            "created_ts_ms": updated.created_ts_ms,
            "due_ts_ms": updated.due_ts_ms,
            "interval_days": updated.interval_days,
            "ease_factor": updated.ease_factor,
            "reps": updated.reps,
            "lapses": updated.lapses,
            "last_review_ts_ms": updated.last_review_ts_ms,
        }
    }


@router.get("/search")
async def search(q: str, limit: int = 50, username: str = Depends(require_user)):
    cards = learning_db.search_flashcards(username, q=q, limit=max(1, min(int(limit), 200)))
    return {
        "cards": [
            {
                "id": c.id,
                "front": c.front,
                "back": c.back,
                "tags": _parse_tags(c.tags_json),
                "format": _parse_format(c.format_json),
                "source_doc": c.source_doc,
                "source_chunk_id": c.source_chunk_id,
                "created_ts_ms": c.created_ts_ms,
                "due_ts_ms": c.due_ts_ms,
                "interval_days": c.interval_days,
                "ease_factor": c.ease_factor,
                "reps": c.reps,
                "lapses": c.lapses,
                "last_review_ts_ms": c.last_review_ts_ms,
            }
            for c in cards
        ]
    }


@router.get("/list")
async def list_cards(limit: int = 100, offset: int = 0, username: str = Depends(require_user)):
    cards = learning_db.list_flashcards(username, limit=limit, offset=offset)
    return {
        "cards": [
            {
                "id": c.id,
                "front": c.front,
                "back": c.back,
                "tags": _parse_tags(c.tags_json),
                "format": _parse_format(c.format_json),
                "source_doc": c.source_doc,
                "source_chunk_id": c.source_chunk_id,
                "created_ts_ms": c.created_ts_ms,
                "due_ts_ms": c.due_ts_ms,
                "interval_days": c.interval_days,
                "ease_factor": c.ease_factor,
                "reps": c.reps,
                "lapses": c.lapses,
                "last_review_ts_ms": c.last_review_ts_ms,
            }
            for c in cards
        ]
    }


@router.delete("/{card_id}")
async def delete_card(card_id: int, username: str = Depends(require_user)):
    ok = learning_db.delete_flashcard(username, int(card_id))
    if not ok:
        raise HTTPException(status_code=404, detail="card not found")
    try:
        learning_db.insert_event(username, "flashcard_deleted", payload={"card_id": int(card_id)})
    except Exception:
        logger.exception("flashcard_deleted_event_failed")
    return {"ok": True}


@router.post("/cleanup_test")
async def cleanup_test_cards(username: str = Depends(require_user)):
    deleted = learning_db.cleanup_test_cards(username)
    return {"deleted": deleted}

