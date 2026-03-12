from fastapi import APIRouter, Depends
from typing import Any, Dict, List, Literal, Optional
import datetime as dt
import json
import os
from pathlib import Path
import time

from app.core.auth import require_user
from app.services.learning_db import learning_db
from app.services.vector_service import get_vector_service


router = APIRouter(prefix="/stats", tags=["stats"])


def _now_ms() -> int:
    return int(time.time() * 1000)


def _day_start_ms_local(d: dt.date) -> int:
    start = dt.datetime(d.year, d.month, d.day)
    return int(start.timestamp() * 1000)


def _date_local_from_ms(ts_ms: int) -> dt.date:
    return dt.datetime.fromtimestamp(ts_ms / 1000).date()


def _safe_json_loads(s: Optional[str]) -> Optional[Dict[str, Any]]:
    if not s:
        return None
    try:
        v = json.loads(s)
        return v if isinstance(v, dict) else None
    except Exception:
        return None


def _safe_namespace(name: str) -> str:
    s = (name or "").strip().lower()
    if not s:
        return "unknown"
    out = []
    for ch in s:
        if ("a" <= ch <= "z") or ("0" <= ch <= "9") or ch in ("-", "_"):
            out.append(ch)
        else:
            out.append("_")
    return ("".join(out)[:64] or "unknown")


def _uploads_dir(username: str) -> str:
    return str(Path("uploads") / _safe_namespace(username))


def _sum_focus_minutes(username: str, since_ms: int, until_ms: int) -> int:
    total = 0
    for row in learning_db.iter_events(username, "focus_end", since_ms=since_ms, until_ms=until_ms):
        payload = _safe_json_loads(row.payload_json)
        if not payload:
            continue
        minutes = payload.get("minutes")
        try:
            m = int(minutes)
        except Exception:
            continue
        if m > 0:
            total += m
    return int(total)


@router.get("/overview")
async def get_overview(days: int = 7, username: str = Depends(require_user)):
    now = dt.datetime.now()
    today = now.date()
    tomorrow = today + dt.timedelta(days=1)
    day0 = today - dt.timedelta(days=max(int(days), 1) - 1)
    since_ms = _day_start_ms_local(day0)
    until_ms = _now_ms()

    uploads_dir = _uploads_dir(username)
    try:
        documents_count = len([f for f in os.listdir(uploads_dir) if os.path.isfile(os.path.join(uploads_dir, f))])
    except Exception:
        documents_count = 0

    chunks_count = get_vector_service(username).count_chunks()

    questions_total = learning_db.count_events(username, "question")
    questions_last_7_days = learning_db.count_events(username, "question", since_ms=since_ms, until_ms=until_ms)

    focus_minutes_today = _sum_focus_minutes(username, _day_start_ms_local(today), until_ms)
    focus_minutes_7d = _sum_focus_minutes(username, since_ms, until_ms)

    flash_stats = learning_db.get_flashcard_counts(
        username,
        now_ms=until_ms,
        today_start_ms=_day_start_ms_local(today),
        tomorrow_start_ms=_day_start_ms_local(tomorrow),
        since_ms=since_ms,
    )
    quiz_stats = learning_db.get_quiz_7d_stats(username, since_ms=since_ms, now_ms=until_ms)

    overview: Dict[str, Any] = {
        "window_days": int(days),
        "documents_count": int(documents_count),
        "chunks_count": int(chunks_count),
        "questions_total": int(questions_total),
        "questions_last_7_days": int(questions_last_7_days),
        "focus_minutes_today": int(focus_minutes_today),
        "focus_minutes_7d": int(focus_minutes_7d),
        "flashcards_total": int(flash_stats.get("flashcards_total") or 0),
        "flashcards_due_today": int(flash_stats.get("flashcards_due_today") or 0),
        "reviews_7d": int(flash_stats.get("reviews_7d") or 0),
        "accuracy_7d": int(flash_stats.get("accuracy_7d") or 0),
        "quizzes_7d": int(quiz_stats.get("quizzes_7d") or 0),
        "avg_score_7d": int(quiz_stats.get("avg_score_7d") or 0),
    }
    return overview


@router.get("/timeseries")
async def get_timeseries(
    metric: Literal["focus", "questions", "reviews", "quizzes"],
    days: int = 7,
    username: str = Depends(require_user),
):
    n = max(int(days), 1)
    now = dt.datetime.now()
    today = now.date()
    start_day = today - dt.timedelta(days=n - 1)
    since_ms = _day_start_ms_local(start_day)
    until_ms = _now_ms()

    buckets: Dict[str, float] = {}
    day_list: List[str] = []
    for i in range(n):
        d = start_day + dt.timedelta(days=i)
        key = d.isoformat()
        day_list.append(key)
        buckets[key] = 0.0

    if metric == "questions":
        for row in learning_db.iter_events(username, "question", since_ms=since_ms, until_ms=until_ms):
            key = _date_local_from_ms(row.ts_ms).isoformat()
            if key in buckets:
                buckets[key] += 1.0
    elif metric == "focus":
        for row in learning_db.iter_events(username, "focus_end", since_ms=since_ms, until_ms=until_ms):
            key = _date_local_from_ms(row.ts_ms).isoformat()
            if key not in buckets:
                continue
            payload = _safe_json_loads(row.payload_json)
            if not payload:
                continue
            minutes = payload.get("minutes")
            try:
                m = float(minutes)
            except Exception:
                continue
            if m > 0:
                buckets[key] += m
    elif metric == "reviews":
        for row in learning_db.iter_events(username, "flashcard_review", since_ms=since_ms, until_ms=until_ms):
            key = _date_local_from_ms(row.ts_ms).isoformat()
            if key in buckets:
                buckets[key] += 1.0
    else:
        for row in learning_db.iter_events(username, "quiz_submit", since_ms=since_ms, until_ms=until_ms):
            key = _date_local_from_ms(row.ts_ms).isoformat()
            if key in buckets:
                buckets[key] += 1.0

    points = [{"date": d, "value": buckets[d]} for d in day_list]
    return {"metric": metric, "days": n, "points": points}

