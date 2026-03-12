from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Form, Depends
from typing import List, Optional
import os
import shutil
import time
import logging
import re
from pydantic import BaseModel
from app.core.auth import require_user
from app.services.document_service import get_document_service
from app.services.vector_service import get_vector_service
from app.services.kg_service import get_kg_service
from app.services.learning_db import learning_db
from app.services.llm_service import llm_service
from app.services.config_service import get_config_service

router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger("app.documents")

UPLOAD_ROOT = "uploads"
if not os.path.exists(UPLOAD_ROOT):
    os.makedirs(UPLOAD_ROOT)

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

def _user_upload_dir(username: str) -> str:
    ns = _safe_namespace(username)
    p = os.path.join(UPLOAD_ROOT, ns)
    os.makedirs(p, exist_ok=True)
    return p

def _simple_summary_chunks(text: str, max_len: int = 900, max_chunks: int = 12) -> List[str]:
    t = (text or "").strip()
    if not t:
        return []
    chunks: List[str] = []
    step = max(200, int(max_len))
    for i in range(0, len(t), step):
        chunks.append(t[i : i + step])
        if len(chunks) >= int(max_chunks):
            break
    return [c for c in chunks if c and c.strip()]

def _strip_think_tags(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return ""
    t = re.sub(r"<think>[\s\S]*?</think>", "", t, flags=re.IGNORECASE).strip()
    t = re.sub(r"<analysis>[\s\S]*?</analysis>", "", t, flags=re.IGNORECASE).strip()
    return t

def _detect_section_title(chunk: str) -> Optional[str]:
    t = (chunk or "").strip()
    if not t:
        return None
    lines = [ln.strip() for ln in t.splitlines()[:25] if ln.strip()]
    if not lines:
        return None
    for ln in lines[:8]:
        m = re.match(r"^(#{1,6})\s+(.+)$", ln)
        if m:
            title = (m.group(2) or "").strip()
            return title[:80] if title else None
    for ln in lines[:6]:
        if re.match(r"^第[一二三四五六七八九十0-9]+[章节篇部卷]\b", ln):
            return ln[:80]
        if len(ln) <= 24 and (ln.endswith("：") or ln.endswith(":")):
            return ln[:-1].strip()[:80] or None
    return None

async def _process_and_index_document(
    username: str,
    file_path: str,
    safe_name: str,
    file_ext: str,
    password: Optional[str],
    parser: Optional[str],
    background_tasks: Optional[BackgroundTasks],
    mineru_token: Optional[str] = None,
) -> int:
    start = time.perf_counter()

    try:
        size_bytes = os.path.getsize(file_path)
    except Exception:
        size_bytes = -1
    try:
        learning_db.upsert_document(username, safe_name, int(time.time() * 1000), int(size_bytes))
        learning_db.set_document_pipeline_stage(username, safe_name, "parse", "pending", error=None)
        learning_db.set_document_pipeline_stage(username, safe_name, "index", "pending", error=None)
        learning_db.set_document_pipeline_stage(username, safe_name, "kg", "pending", error=None)
        learning_db.set_document_summary(username, safe_name, None, None, status="pending", error=None)
    except Exception:
        logger.exception("document_meta_upsert_failed filename=%s", safe_name)

    try:
        text = await get_document_service().parse_document(file_path, file_ext, password=password, parser=parser, mineru_token=mineru_token)
    except ValueError as e:
        code = (str(e) or "").strip()
        if code in {"pdf_password_required", "pdf_password_incorrect"}:
            try:
                learning_db.set_document_pipeline_stage(username, safe_name, "parse", "failed", error=code)
                learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="parse_failed")
                learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="parse_failed")
                learning_db.set_document_summary(username, safe_name, None, None, status="failed", error=code)
            except Exception:
                pass
            raise HTTPException(status_code=400, detail=code)
        logger.exception("document_parse_failed filename=%s", safe_name)
        try:
            learning_db.set_document_pipeline_stage(username, safe_name, "parse", "failed", error="parse_failed")
            learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="parse_failed")
            learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="parse_failed")
            learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="parse_failed")
        except Exception:
            pass
        raise HTTPException(status_code=400, detail="Document could not be parsed")
    except Exception:
        logger.exception("document_parse_failed filename=%s", safe_name)
        try:
            learning_db.set_document_pipeline_stage(username, safe_name, "parse", "failed", error="parse_failed")
            learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="parse_failed")
            learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="parse_failed")
            learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="parse_failed")
        except Exception:
            pass
        raise HTTPException(status_code=400, detail="Document could not be parsed")

    if not text.strip():
        try:
            learning_db.set_document_pipeline_stage(username, safe_name, "parse", "failed", error="empty")
            learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="parse_failed")
            learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="parse_failed")
            learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="empty")
        except Exception:
            pass
        raise HTTPException(status_code=400, detail="Document is empty or could not be parsed")
    try:
        learning_db.set_document_pipeline_stage(username, safe_name, "parse", "ready", error=None)
    except Exception:
        pass

    try:
        chunks = get_document_service().split_text(text)
    except Exception:
        logger.exception("document_split_failed filename=%s", safe_name)
        try:
            learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="split_failed")
            learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="split_failed")
            learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="split_failed")
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Could not split document into meaningful chunks")

    if not chunks:
        try:
            learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="empty_chunks")
            learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="empty_chunks")
            learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="empty_chunks")
        except Exception:
            pass
        raise HTTPException(status_code=400, detail="Could not split document into meaningful chunks")

    metadatas = [
        {"source": safe_name, "chunk_index": i, "chunk_id": f"{safe_name}:{i}", "chunk_len": len(chunks[i])}
        for i in range(len(chunks))
    ]
    try:
        get_vector_service(username).add_documents(chunks, metadatas)
    except Exception:
        logger.exception("vector_add_failed filename=%s chunks=%s", safe_name, len(chunks))
        try:
            learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="index_failed")
            learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="index_failed")
            learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="index_failed")
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Failed to index document")
    try:
        learning_db.set_document_pipeline_stage(username, safe_name, "index", "ready", error=None)
    except Exception:
        pass

    if background_tasks is not None:
        background_tasks.add_task(_extract_kg, chunks, safe_name, username=username)
        background_tasks.add_task(_generate_summary, chunks[:12], safe_name, username=username)
    else:
        import asyncio
        asyncio.create_task(asyncio.to_thread(_extract_kg, chunks, safe_name, username=username))
        asyncio.create_task(asyncio.to_thread(_generate_summary, chunks[:12], safe_name, username=username))

    duration_ms = int((time.perf_counter() - start) * 1000)
    logger.info("document_processed filename=%s chunks=%s duration_ms=%s", safe_name, len(chunks), duration_ms)
    return int(len(chunks))

@router.post("/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    password: Optional[str] = Form(None),
    parser: Optional[str] = Form(None),
    username: str = Depends(require_user),
):
    original_name = file.filename or ""
    safe_name = os.path.basename(original_name)
    file_ext = safe_name.split(".")[-1].lower() if "." in safe_name else ""
    if file_ext not in ["pdf", "docx", "txt", "md"]:
        raise HTTPException(status_code=400, detail="Unsupported file format")
    
    file_path = os.path.join(_user_upload_dir(username), safe_name)
    
    # Handle duplicate: Delete old data if file exists
    if os.path.exists(file_path):
        logger.info("document_replace filename=%s", safe_name)
        get_vector_service(username).delete_by_source(safe_name)
        get_kg_service(username).delete_by_source(safe_name)
        os.remove(file_path)

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    finally:
        try:
            file.file.close()
        except Exception:
            pass

    try:
        mineru_token = get_config_service().get_config(username, "mineru_token")
        chunk_count = await _process_and_index_document(
            username=username,
            file_path=file_path,
            safe_name=safe_name,
            file_ext=file_ext,
            password=password,
            parser=parser,
            background_tasks=background_tasks,
            mineru_token=mineru_token,
        )
    except HTTPException:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise
    except Exception:
        logger.exception("document_process_failed filename=%s", safe_name)
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail="Internal processing error")

    return {"filename": safe_name, "chunk_count": int(chunk_count), "message": "Document uploaded and processed successfully"}

def _extract_kg(chunks: List[str], filename: str, username: str):
    try:
        try:
            learning_db.set_document_pipeline_stage(username, filename, "kg", "pending", error=None)
        except Exception:
            pass
        kg = get_kg_service(username)
        last_section: Optional[str] = None
        for i, chunk in enumerate(chunks):
            sec = _detect_section_title(chunk) or last_section
            if sec:
                last_section = sec
            kg.extract_entities_and_relations(chunk, filename, chunk_index=int(i), section_title=sec)
        try:
            learning_db.set_document_pipeline_stage(username, filename, "kg", "ready", error=None)
        except Exception:
            pass
    except Exception:
        logger.exception("kg_extract_failed filename=%s", filename)
        try:
            learning_db.set_document_pipeline_stage(username, filename, "kg", "failed", error="kg_failed")
        except Exception:
            pass

def _generate_summary(chunks: List[str], filename: str, username: str):
    try:
        summary = llm_service.generate_document_summary(filename, chunks)
        if summary:
            learning_db.set_document_summary(username, filename, summary, int(time.time() * 1000), status="ready", error=None)
        else:
            fallback = "\n".join([c.strip() for c in (chunks or []) if c and c.strip()][:6]).strip()
            if fallback:
                learning_db.set_document_summary(username, filename, fallback, int(time.time() * 1000), status="ready", error="fallback_summary")
            else:
                learning_db.set_document_summary(username, filename, None, None, status="failed", error="empty_summary")
    except Exception:
        logger.exception("summary_generate_failed filename=%s", filename)
        try:
            fallback = "\n".join([c.strip() for c in (chunks or []) if c and c.strip()][:6]).strip()
            if fallback:
                learning_db.set_document_summary(username, filename, fallback, int(time.time() * 1000), status="ready", error="fallback_summary")
            else:
                learning_db.set_document_summary(username, filename, None, None, status="failed", error="exception")
        except Exception:
            logger.exception("summary_status_update_failed filename=%s", filename)

@router.get("/")
async def list_documents(username: str = Depends(require_user)):
    upload_dir = _user_upload_dir(username)
    try:
        files = [f for f in os.listdir(upload_dir) if os.path.isfile(os.path.join(upload_dir, f))]
    except Exception:
        files = []

    meta_map = {}
    try:
        meta_map = learning_db.get_documents_by_filenames(username, files)
    except Exception:
        logger.exception("documents_meta_list_failed")
        meta_map = {}

    items = []
    for f in files:
        file_path = os.path.join(upload_dir, f)
        try:
            st = os.stat(file_path)
            size_bytes = int(st.st_size)
            uploaded_ts_ms = int(st.st_mtime * 1000)
        except Exception:
            size_bytes = -1
            uploaded_ts_ms = 0

        row = meta_map.get(f)
        if row is not None:
            uploaded_ts_ms = int(row.uploaded_ts_ms) if row.uploaded_ts_ms else uploaded_ts_ms
            size_bytes = int(row.size_bytes) if row.size_bytes is not None else size_bytes
            summary_status = row.summary_status or None
            parse_status = row.parse_status or None
            parse_error = row.parse_error or None
            index_status = row.index_status or None
            index_error = row.index_error or None
            kg_status = row.kg_status or None
            kg_error = row.kg_error or None
        else:
            summary_status = None
            parse_status = None
            parse_error = None
            index_status = None
            index_error = None
            kg_status = None
            kg_error = None
            try:
                learning_db.upsert_document(username, f, uploaded_ts_ms, size_bytes)
            except Exception:
                pass

        items.append(
            {
                "filename": f,
                "uploaded_ts_ms": int(uploaded_ts_ms),
                "size_bytes": int(size_bytes),
                "summary_status": summary_status,
                "parse_status": parse_status,
                "parse_error": parse_error,
                "index_status": index_status,
                "index_error": index_error,
                "kg_status": kg_status,
                "kg_error": kg_error,
            }
        )

    items.sort(key=lambda x: int(x.get("uploaded_ts_ms") or 0), reverse=True)
    return {"documents": items}

@router.get("/{filename}/summary")
async def get_document_summary(filename: str, background_tasks: BackgroundTasks, username: str = Depends(require_user)):
    safe_name = os.path.basename(filename)
    file_path = os.path.join(_user_upload_dir(username), safe_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document not found")

    meta_map = {}
    try:
        meta_map = learning_db.get_documents_by_filenames(username, [safe_name])
    except Exception:
        meta_map = {}
    row = meta_map.get(safe_name)

    if row and row.summary_status == "ready" and row.summary_text:
        return {
            "filename": safe_name,
            "status": "ready",
            "summary": _strip_think_tags(row.summary_text),
            "summary_ts_ms": row.summary_ts_ms,
        }

    if row and row.summary_status == "pending":
        return {"filename": safe_name, "status": "pending", "summary": None, "summary_ts_ms": None}

    try:
        size_bytes = os.path.getsize(file_path)
    except Exception:
        size_bytes = -1
    try:
        uploaded_ts_ms = int(os.stat(file_path).st_mtime * 1000)
    except Exception:
        uploaded_ts_ms = 0
    try:
        learning_db.upsert_document(username, safe_name, int(uploaded_ts_ms), int(size_bytes))
        learning_db.set_document_summary(username, safe_name, None, None, status="pending", error=None)
    except Exception:
        logger.exception("document_summary_pending_failed filename=%s", safe_name)

    file_ext = safe_name.split(".")[-1].lower() if "." in safe_name else ""
    try:
        text = await get_document_service().parse_document(file_path, file_ext)
        chunks = _simple_summary_chunks(text)
        background_tasks.add_task(_generate_summary, chunks[:12], safe_name, username=username)
    except Exception:
        logger.exception("document_summary_prepare_failed filename=%s", safe_name)
        try:
            learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="prepare_failed")
        except Exception:
            pass
        return {"filename": safe_name, "status": "failed", "summary": None, "summary_ts_ms": None}

    return {"filename": safe_name, "status": "pending", "summary": None, "summary_ts_ms": None}

class RetryDocumentRequest(BaseModel):
    stage: str = "all"
    password: Optional[str] = None
    parser: Optional[str] = None

async def _retry_document_job(username: str, filename: str, stage: str, password: Optional[str], parser: Optional[str]):
    import asyncio

    safe_name = os.path.basename(filename)
    file_path = os.path.join(_user_upload_dir(username), safe_name)
    if not os.path.exists(file_path):
        try:
            learning_db.set_document_pipeline_stage(username, safe_name, "parse", "failed", error="file_missing")
            learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="file_missing")
            learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="file_missing")
            learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="file_missing")
        except Exception:
            pass
        return

    stg = (stage or "").strip().lower() or "all"
    if stg in {"parse", "index", "all"}:
        try:
            learning_db.set_document_pipeline_stage(username, safe_name, "parse", "pending", error=None)
            learning_db.set_document_pipeline_stage(username, safe_name, "index", "pending", error=None)
            learning_db.set_document_pipeline_stage(username, safe_name, "kg", "pending", error=None)
            learning_db.set_document_summary(username, safe_name, None, None, status="pending", error=None)
        except Exception:
            pass
        file_ext = safe_name.split(".")[-1].lower() if "." in safe_name else ""
        try:
            get_vector_service(username).delete_by_source(safe_name)
        except Exception:
            pass
        try:
            get_kg_service(username).delete_by_source(safe_name)
        except Exception:
            pass
        try:
            mineru_token = get_config_service().get_config(username, "mineru_token")
            text = await get_document_service().parse_document(file_path, file_ext, password=password, parser=parser, mineru_token=mineru_token)
        except ValueError as e:
            code = (str(e) or "").strip()
            try:
                learning_db.set_document_pipeline_stage(username, safe_name, "parse", "failed", error=code or "parse_failed")
                learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="parse_failed")
                learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="parse_failed")
                learning_db.set_document_summary(username, safe_name, None, None, status="failed", error=code or "parse_failed")
            except Exception:
                pass
            return
        except Exception:
            try:
                learning_db.set_document_pipeline_stage(username, safe_name, "parse", "failed", error="parse_failed")
                learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="parse_failed")
                learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="parse_failed")
                learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="parse_failed")
            except Exception:
                pass
            return

        if not (text or "").strip():
            try:
                learning_db.set_document_pipeline_stage(username, safe_name, "parse", "failed", error="empty")
                learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="parse_failed")
                learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="parse_failed")
                learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="empty")
            except Exception:
                pass
            return
        try:
            learning_db.set_document_pipeline_stage(username, safe_name, "parse", "ready", error=None)
        except Exception:
            pass
        try:
            split_chunks = get_document_service().split_text(text)
        except Exception:
            split_chunks = None
        if not isinstance(split_chunks, list) or not split_chunks:
            try:
                learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="split_failed")
                learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="split_failed")
                learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="split_failed")
            except Exception:
                pass
            return
        metadatas = [
            {"source": safe_name, "chunk_index": i, "chunk_id": f"{safe_name}:{i}", "chunk_len": len(split_chunks[i])}
            for i in range(len(split_chunks))
        ]
        try:
            await asyncio.to_thread(get_vector_service(username).add_documents, split_chunks, metadatas)
        except Exception:
            try:
                learning_db.set_document_pipeline_stage(username, safe_name, "index", "failed", error="index_failed")
                learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="index_failed")
                learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="index_failed")
            except Exception:
                pass
            return
        try:
            learning_db.set_document_pipeline_stage(username, safe_name, "index", "ready", error=None)
        except Exception:
            pass
        await asyncio.to_thread(_extract_kg, split_chunks, safe_name, username=username)
        await asyncio.to_thread(_generate_summary, split_chunks[:12], safe_name, username=username)
        return

    if stg == "kg":
        try:
            learning_db.set_document_pipeline_stage(username, safe_name, "kg", "pending", error=None)
        except Exception:
            pass
        file_ext = safe_name.split(".")[-1].lower() if "." in safe_name else ""
        try:
            text = await get_document_service().parse_document(file_path, file_ext, password=password, parser=parser)
        except Exception:
            text = ""
        if not (text or "").strip():
            try:
                learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="parse_failed")
            except Exception:
                pass
            return
        try:
            split_chunks = get_document_service().split_text(text)
        except Exception:
            split_chunks = []
        if not split_chunks:
            try:
                learning_db.set_document_pipeline_stage(username, safe_name, "kg", "failed", error="split_failed")
            except Exception:
                pass
            return
        try:
            get_kg_service(username).delete_by_source(safe_name)
        except Exception:
            pass
        await asyncio.to_thread(_extract_kg, split_chunks, safe_name, username=username)
        return

    if stg == "summary":
        try:
            learning_db.set_document_summary(username, safe_name, None, None, status="pending", error=None)
        except Exception:
            pass
        file_ext = safe_name.split(".")[-1].lower() if "." in safe_name else ""
        try:
            text = await get_document_service().parse_document(file_path, file_ext, password=password, parser=parser)
        except Exception:
            text = ""
        chunks = _simple_summary_chunks(text)
        if not chunks:
            try:
                learning_db.set_document_summary(username, safe_name, None, None, status="failed", error="prepare_failed")
            except Exception:
                pass
            return
        await asyncio.to_thread(_generate_summary, chunks[:12], safe_name, username=username)
        return

@router.post("/{filename}/retry")
async def retry_document(filename: str, req: RetryDocumentRequest, background_tasks: BackgroundTasks, username: str = Depends(require_user)):
    safe_name = os.path.basename(filename)
    file_path = os.path.join(_user_upload_dir(username), safe_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document not found")
    stage = (req.stage or "").strip().lower() or "all"
    if stage not in {"all", "parse", "index", "kg", "summary"}:
        raise HTTPException(status_code=400, detail="Invalid stage. Allowed: all | parse | index | kg | summary")
    meta_map = {}
    try:
        meta_map = learning_db.get_documents_by_filenames(username, [safe_name])
    except Exception:
        meta_map = {}
    row = meta_map.get(safe_name)
    if stage in {"all", "parse", "index"} and row and (row.index_status == "pending" or row.parse_status == "pending"):
        raise HTTPException(status_code=409, detail="already_running")
    if stage == "kg" and row and row.kg_status == "pending":
        raise HTTPException(status_code=409, detail="already_running")
    if stage == "summary" and row and row.summary_status == "pending":
        raise HTTPException(status_code=409, detail="already_running")
    background_tasks.add_task(_retry_document_job, username, safe_name, stage, req.password, req.parser)
    return {"filename": safe_name, "message": "retry_scheduled", "stage": stage}

@router.delete("/{filename}")
async def delete_document(filename: str, username: str = Depends(require_user)):
    safe_name = os.path.basename(filename)
    file_path = os.path.join(_user_upload_dir(username), safe_name)
    if os.path.exists(file_path):
        os.remove(file_path)
        get_vector_service(username).delete_by_source(safe_name)
        get_kg_service(username).delete_by_source(safe_name)
        logger.info("document_deleted filename=%s", safe_name)
        return {"message": f"Document {safe_name} deleted from all storage"}
    raise HTTPException(status_code=404, detail="Document not found")

@router.get("/graph")
async def get_knowledge_graph(view: str = "flat", username: str = Depends(require_user)):
    v = (view or "").strip().lower()
    if v not in {"flat", "structured"}:
        raise HTTPException(status_code=400, detail="Invalid view. Allowed: flat | structured")
    return get_kg_service(username).get_graph_data(view=v)

async def auto_ingest_new_files(username: str):
    import asyncio

    delay_s = (os.environ.get("AUTO_INGEST_DELAY_SEC") or "0.2").strip() or "0.2"
    try:
        await asyncio.sleep(float(delay_s))
    except Exception:
        pass

    limit_s = (os.environ.get("AUTO_INGEST_LIMIT") or "50").strip() or "50"
    try:
        limit = max(0, int(limit_s))
    except Exception:
        limit = 50

    retry_failed = (os.environ.get("AUTO_INGEST_RETRY_FAILED") or "0").strip() == "1"

    upload_dir = _user_upload_dir(username)
    try:
        if not os.path.exists(upload_dir):
            return
        files = [f for f in os.listdir(upload_dir) if os.path.isfile(os.path.join(upload_dir, f))]
    except Exception:
        files = []

    if not files:
        return

    try:
        meta_map = learning_db.get_documents_by_filenames(username, files)
    except Exception:
        logger.exception("auto_ingest_meta_failed")
        meta_map = {}

    processed = 0
    for f in sorted(files):
        if limit and processed >= limit:
            break

        safe_name = os.path.basename(f)
        file_ext = safe_name.split(".")[-1].lower() if "." in safe_name else ""
        if file_ext not in ["pdf", "docx", "txt", "md"]:
            continue

        row = meta_map.get(safe_name)
        needs = False
        if row is None:
            needs = True
        else:
            st = row.summary_status
            if st is None:
                needs = True
            elif retry_failed and st == "failed" and (row.summary_error or "") != "pdf_password_required":
                needs = True

        if not needs:
            continue

        file_path = os.path.join(upload_dir, safe_name)
        if not os.path.exists(file_path):
            continue

        logger.info("auto_ingest_processing filename=%s", safe_name)
        try:
            chunk_count = await _process_and_index_document(
                username=username,
                file_path=file_path,
                safe_name=safe_name,
                file_ext=file_ext,
                password=None,
                parser="auto",
                background_tasks=None,
            )
            logger.info("auto_ingest_done filename=%s chunks=%s", safe_name, chunk_count)
        except HTTPException as e:
            detail = getattr(e, "detail", None)
            if detail in {"pdf_password_required", "pdf_password_incorrect"}:
                try:
                    learning_db.set_document_summary(username, safe_name, None, None, status="failed", error=str(detail))
                except Exception:
                    logger.exception("auto_ingest_password_mark_failed filename=%s", safe_name)
            logger.warning("auto_ingest_http_failed filename=%s status=%s detail=%s", safe_name, e.status_code, str(detail))
        except Exception:
            logger.exception("auto_ingest_failed filename=%s", safe_name)
        processed += 1

async def auto_ingest_all_users():
    try:
        if not os.path.exists(UPLOAD_ROOT):
            return
        legacy_files = [f for f in os.listdir(UPLOAD_ROOT) if os.path.isfile(os.path.join(UPLOAD_ROOT, f))]
        if legacy_files:
            admin_dir = _user_upload_dir("admin")
            for f in legacy_files:
                src = os.path.join(UPLOAD_ROOT, f)
                dst = os.path.join(admin_dir, os.path.basename(f))
                try:
                    if os.path.exists(dst):
                        os.remove(dst)
                    shutil.move(src, dst)
                except Exception:
                    logger.exception("migrate_legacy_upload_failed filename=%s", f)
        entries = [d for d in os.listdir(UPLOAD_ROOT) if os.path.isdir(os.path.join(UPLOAD_ROOT, d))]
    except Exception:
        entries = []
    for d in sorted(entries):
        try:
            await auto_ingest_new_files(d)
        except Exception:
            logger.exception("auto_ingest_user_failed user=%s", d)
