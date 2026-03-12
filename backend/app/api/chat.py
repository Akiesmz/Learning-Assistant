from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
from app.core.auth import require_user
from app.services.vector_service import get_vector_service
from app.services.llm_service import llm_service
from app.services.learning_db import learning_db
import json
import logging
import time
import re

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger("app.chat")

class ChatMessage(BaseModel):
    role: str
    content: str

class LlmConfig(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None

class ChatRequest(BaseModel):
    query: str
    history: List[ChatMessage] = []
    no_think: bool = False
    mode: str = "qa"
    llm: Optional[LlmConfig] = None

@router.post("/query")
async def chat_query(request: ChatRequest, username: str = Depends(require_user)):
    mode = (request.mode or "").strip().lower()
    if mode not in {"qa", "summary", "code"}:
        raise HTTPException(status_code=400, detail="Invalid mode. Allowed: qa | summary | code")
    llm_cfg: Optional[Dict[str, Any]] = None
    if request.llm is not None:
        llm_cfg = request.llm.dict()
        base_url = (llm_cfg.get("base_url") or "").strip()
        if base_url and not re.match(r"^https?://", base_url):
            raise HTTPException(status_code=400, detail="Invalid llm.base_url: must start with http:// or https://")
        llm_cfg["base_url"] = base_url or None
        llm_cfg["api_key"] = (llm_cfg.get("api_key") or "")
        llm_cfg["model"] = (llm_cfg.get("model") or "").strip() or None
    start = time.perf_counter()
    try:
        learning_db.insert_event(
            username=username,
            event="question",
            payload={"mode": mode, "query_len": len(request.query or ""), "history_len": len(request.history or [])},
        )
    except Exception:
        logger.exception("question_event_store_failed")
    try:
        top_k_s = (os.environ.get("VECTOR_TOP_K") or "10").strip() or "10"
        final_n_s = (os.environ.get("VECTOR_FINAL_N") or "5").strip() or "5"
        try:
            top_k = max(1, int(top_k_s))
        except Exception:
            top_k = 10
        try:
            final_n = max(1, int(final_n_s))
        except Exception:
            final_n = 5
        context_chunks = get_vector_service(username).search(request.query, top_k=top_k, final_n=final_n)
    except Exception:
        logger.exception("vector_search_failed")
        context_chunks = []

    llm_history = [{"role": m.role, "content": m.content} for m in request.history]
    
    async def stream_response():
        def _snippet(text: str, limit: int = 700) -> str:
            t = (text or "").strip()
            if len(t) <= limit:
                return t
            return t[:limit] + "…"

        in_think = False
        pending = ""

        def _filter_think_stream(delta: str) -> str:
            nonlocal in_think, pending
            if not delta:
                return ""

            pending += delta
            output_parts: List[str] = []

            open_tag = "<think>"
            close_tag = "</think>"
            open_tag2 = "<analysis>"
            close_tag2 = "</analysis>"

            while True:
                if not in_think:
                    idx_candidates = [pending.find(open_tag), pending.find(open_tag2)]
                    idx_candidates = [i for i in idx_candidates if i != -1]
                    idx = min(idx_candidates) if idx_candidates else -1
                    if idx == -1:
                        keep = max(len(open_tag), len(open_tag2)) - 1
                        if len(pending) > keep:
                            output_parts.append(pending[:-keep])
                            pending = pending[-keep:]
                        break
                    if idx > 0:
                        output_parts.append(pending[:idx])
                    if pending.startswith(open_tag, idx):
                        pending = pending[idx + len(open_tag):]
                    else:
                        pending = pending[idx + len(open_tag2):]
                    in_think = True
                else:
                    idx_candidates = [pending.find(close_tag), pending.find(close_tag2)]
                    idx_candidates = [i for i in idx_candidates if i != -1]
                    idx = min(idx_candidates) if idx_candidates else -1
                    if idx == -1:
                        keep = max(len(close_tag), len(close_tag2)) - 1
                        if len(pending) > keep:
                            pending = pending[-keep:]
                        break
                    if pending.startswith(close_tag, idx):
                        pending = pending[idx + len(close_tag):]
                    else:
                        pending = pending[idx + len(close_tag2):]
                    in_think = False

            return "".join(output_parts)

        def _flush_visible_pending() -> str:
            nonlocal in_think, pending
            if not request.no_think:
                return ""
            if in_think:
                pending = ""
                return ""
            if not pending:
                return ""
            open_tag = "<think>"
            open_tag2 = "<analysis>"
            for t in (open_tag, open_tag2):
                if pending.startswith(t[: len(pending)]):
                    pending = ""
                    return ""
            out = pending
            pending = ""
            return out

        context_info = {
            "type": "context",
            "chunks": [
                {
                    "id": i + 1,
                    "source": (c.get("metadata", {}) or {}).get("source", "Unknown"),
                    "chunk_id": (c.get("metadata", {}) or {}).get("chunk_id"),
                    "chunk_len": (c.get("metadata", {}) or {}).get("chunk_len"),
                    "chunk_index": (c.get("metadata", {}) or {}).get("chunk_index"),
                    "recall_score": c.get("recall_score"),
                    "rerank_score": c.get("rerank_score"),
                    "content": _snippet(c.get("content", "")),
                    "full_content": c.get("content", ""),  # 添加完整内容
                }
                for i, c in enumerate(context_chunks)
            ],
        }
        yield f"data: {json.dumps(context_info)}\n\n"

        if not context_chunks:
            yield f"data: {json.dumps({'type': 'error', 'message': '请上传相应文档作为知识库，以便我能够回答您的问题。'})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'used_chunk_ids': [], 'citations': [], 'no_cards': True, 'no_references': True})}\n\n"
            return
        
        # 检查检索结果是否与问题相关
        has_relevant_chunks = False
        for chunk in context_chunks:
            # 检查rerank_score是否存在且大于阈值（例如0.3）
            if chunk.get('rerank_score', 0) > 0.3:
                has_relevant_chunks = True
                break
        
        if not has_relevant_chunks:
            yield f"data: {json.dumps({'type': 'error', 'message': '由于知识有限，我无法回答这个问题。请尝试上传相关文档或调整问题表述。'})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'used_chunk_ids': [], 'citations': [], 'no_cards': True, 'no_references': True})}\n\n"
            return

        response = None
        err_detail = None
        try:
            response = llm_service.generate_response(
                request.query,
                context_chunks,
                llm_history,
                request.no_think,
                mode,
                llm_cfg,
            )
        except ValueError as e:
            logger.warning("llm_generate_invalid_config detail=%s", str(e))
            err_detail = str(e) or None
        except Exception:
            logger.exception("llm_generate_failed")
            err_detail = "LLM 调用失败，请检查 base_url / api_key / model 或服务是否可用。"

        if not response:
            msg = err_detail or "LLM call failed"
            yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
            return

        full_answer = ""
        try:
            for chunk in response:
                delta = None
                try:
                    delta = chunk.choices[0].delta.content
                except Exception:
                    delta = None
                if delta:
                    visible = delta
                    if request.no_think:
                        visible = _filter_think_stream(delta)
                    if visible:
                        full_answer += visible
                        yield f"data: {json.dumps({'type': 'content', 'delta': visible})}\n\n"
        except Exception:
            logger.exception("llm_stream_failed")
            yield f"data: {json.dumps({'type': 'error', 'message': 'LLM stream failed'})}\n\n"
        finally:
            tail = _flush_visible_pending()
            if tail:
                full_answer += tail
                yield f"data: {json.dumps({'type': 'content', 'delta': tail})}\n\n"
            used_ids = sorted({int(m) for m in re.findall(r"\[(\d+)\]", full_answer) if m.isdigit()})
            citations = []
            if used_ids:
                for cid in used_ids:
                    idx = cid - 1
                    if idx < 0 or idx >= len(context_chunks):
                        continue
                    c = context_chunks[idx] or {}
                    meta = c.get("metadata", {}) or {}
                    citations.append(
                        {
                            "id": cid,
                            "source": meta.get("source", "Unknown"),
                            "chunk_id": meta.get("chunk_id"),
                            "chunk_len": meta.get("chunk_len"),
                            "chunk_index": meta.get("chunk_index"),
                            "content": _snippet(c.get("content", "")),
                            "full_content": c.get("content", ""),  # 添加完整内容
                            "recall_score": c.get("recall_score"),
                            "rerank_score": c.get("rerank_score"),
                        }
                    )
            yield f"data: {json.dumps({'type': 'done', 'used_chunk_ids': used_ids, 'citations': citations})}\n\n"
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.info("chat_done chunks=%s used=%s duration_ms=%s", len(context_chunks), len(used_ids), duration_ms)

            try:
                rq_timeout_s = (os.environ.get("RELATED_QUESTIONS_TIMEOUT_SEC") or "30").strip() or "30"
                try:
                    rq_timeout = float(rq_timeout_s)
                except Exception:
                    rq_timeout = 30.0
                related_questions = llm_service.generate_related_questions(
                    request.query,
                    context_chunks,
                    mode,
                    limit=3,
                    timeout=rq_timeout,
                    llm_cfg=llm_cfg,
                )
                if related_questions:
                    yield f"data: {json.dumps({'type': 'related_questions', 'related_questions': related_questions})}\n\n"
            except Exception:
                logger.exception("related_questions_build_failed")

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream_response(), media_type="text/event-stream", headers=headers)
