from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import logging
import re

from app.core.auth import require_user
from app.services.learning_db import learning_db
from app.services.llm_service import llm_service
from app.services.vector_service import get_vector_service


router = APIRouter(prefix="/quiz", tags=["quiz"])
logger = logging.getLogger("app.quiz")


class LlmConfig(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None


class GenerateQuizRequest(BaseModel):
    topic: Optional[str] = None
    count: int = 6
    source_doc: Optional[str] = None
    llm: Optional[LlmConfig] = None


class SubmitQuizRequest(BaseModel):
    answers: Dict[str, Any]


def _normalize_text(s: str) -> str:
    t = (s or "").strip().lower()
    t = re.sub(r"\s+", "", t)
    return t


def _build_quiz_context(username: str, topic: Optional[str], source_doc: Optional[str]) -> List[Dict[str, Any]]:
    vs = get_vector_service(username)
    if vs.chroma_db is None:
        return []
    if source_doc:
        try:
            got = vs.chroma_db.get(where={"source": source_doc})
            docs = (got or {}).get("documents") or []
            metas = (got or {}).get("metadatas") or []
            out = []
            for i in range(min(len(docs), 8)):
                out.append({"content": docs[i], "metadata": metas[i] if i < len(metas) else {"source": source_doc}})
            if out:
                return out
        except Exception:
            logger.exception("quiz_context_doc_failed source_doc=%s", source_doc)
    if topic:
        try:
            chunks = vs.search(topic, top_k=20, final_n=8)
            if chunks:
                return chunks
        except Exception:
            logger.exception("quiz_context_search_failed")
    try:
        got = vs.chroma_db.get()
        docs = (got or {}).get("documents") or []
        metas = (got or {}).get("metadatas") or []
        out = []
        for i in range(min(len(docs), 8)):
            out.append({"content": docs[i], "metadata": metas[i] if i < len(metas) else {}})
        return out
    except Exception:
        return []


@router.post("/generate")
async def generate_quiz(req: GenerateQuizRequest, username: str = Depends(require_user)):
    count = max(3, min(int(req.count or 6), 12))
    llm_cfg: Optional[Dict[str, Any]] = req.llm.dict() if req.llm is not None else None
    context_chunks = _build_quiz_context(username, req.topic, req.source_doc)
    if not context_chunks:
        raise HTTPException(status_code=400, detail="no document context available")

    quiz = llm_service.generate_quiz_from_context(
        topic=(req.topic or "").strip() or None,
        context_chunks=context_chunks,
        limit=count,
        llm_cfg=llm_cfg,
    )
    if not quiz:
        raise HTTPException(status_code=500, detail="failed to generate quiz")

    quiz_id = learning_db.create_quiz(username, quiz=quiz, config={"topic": req.topic, "count": count, "source_doc": req.source_doc})
    return {"quiz_id": quiz_id, "quiz": quiz}


@router.post("/{quiz_id}/submit")
async def submit_quiz(quiz_id: int, req: SubmitQuizRequest, username: str = Depends(require_user)):
    quiz = learning_db.get_quiz(username, int(quiz_id))
    if not quiz:
        raise HTTPException(status_code=404, detail="quiz not found")
    questions = quiz.get("questions")
    if not isinstance(questions, list):
        raise HTTPException(status_code=500, detail="invalid quiz format")

    score = 0.0
    total = float(len(questions))
    details = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        qid = str(q.get("id") or "")
        qtype = str(q.get("type") or "mcq")
        correct = False
        correct_answer = q.get("answer")
        user_answer = req.answers.get(qid)

        if qtype == "mcq":
            try:
                correct_idx = int(correct_answer)
                user_idx = int(user_answer)
                correct = user_idx == correct_idx
            except Exception:
                correct = False
        else:
            a = _normalize_text(str(correct_answer or ""))
            u = _normalize_text(str(user_answer or ""))
            correct = bool(a and u and (a == u))

        if correct:
            score += 1.0
        details.append(
            {
                "id": qid,
                "type": qtype,
                "correct": correct,
                "correct_answer": correct_answer,
                "explanation": q.get("explanation") or "",
            }
        )

    attempt_id = learning_db.create_quiz_attempt(username, quiz_id=int(quiz_id), answers=req.answers, score=score, total=total)
    try:
        learning_db.insert_event(username, "quiz_submit", payload={"quiz_id": int(quiz_id), "attempt_id": attempt_id, "score": score, "total": total})
    except Exception:
        logger.exception("quiz_submit_event_failed")

    return {"attempt_id": attempt_id, "score": score, "total": total, "accuracy": (score / total if total else 0), "details": details}


@router.get("/history")
async def history(limit: int = 20, username: str = Depends(require_user)):
    items = learning_db.list_quiz_history(username, limit=max(1, min(int(limit), 100)))
    enriched = []
    for it in items:
        q = learning_db.get_quiz(username, int(it["quiz_id"]))
        enriched.append(
            {
                **it,
                "title": (q or {}).get("title") if isinstance(q, dict) else None,
                "topic": (q or {}).get("topic") if isinstance(q, dict) else None,
            }
        )
    return {"history": enriched}
