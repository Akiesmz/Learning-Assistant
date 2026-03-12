import os
import site
import sys
import logging
import time
import threading
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("app")

def _assert_expected_environment():
    if os.environ.get("PYTHONNOUSERSITE") != "1":
        raise RuntimeError(
            "当前启动未禁用用户级 site-packages，容易导致依赖从 AppData/Roaming 导入并引发版本冲突。\n"
            "请使用以下命令启动（PowerShell）:\n"
            "$env:PYTHONNOUSERSITE=1; python -m uvicorn app.main:app --reload --port 8000\n"
        )

    usersite = ""
    try:
        usersite = site.getusersitepackages()
    except Exception:
        usersite = ""

    usersite_norm = usersite.lower().replace("/", "\\")
    roaming_hint = "\\appdata\\roaming\\python\\python"

    sys_path_norm = [p.lower().replace("/", "\\") for p in sys.path if isinstance(p, str)]
    if usersite_norm and any(p.startswith(usersite_norm) for p in sys_path_norm):
        raise RuntimeError(
            "检测到用户级 site-packages 已进入 sys.path，容易导致依赖冲突。\n"
            f"Python: {sys.executable}\n"
            f"User site: {usersite}\n"
            "请使用以下命令启动（PowerShell）:\n"
            "$env:PYTHONNOUSERSITE=1; python -m uvicorn app.main:app --reload --port 8000\n"
        )

    offenders = []
    for mod_name in ("uvicorn", "chromadb", "langchain_chroma"):
        try:
            mod = __import__(mod_name)
            origin = getattr(mod, "__file__", "") or ""
            origin_norm = origin.lower().replace("/", "\\")
            if (usersite_norm and origin_norm.startswith(usersite_norm)) or (roaming_hint in origin_norm):
                offenders.append((mod_name, origin))
        except Exception:
            continue

    if offenders:
        details = "\n".join([f"- {name}: {path}" for name, path in offenders])
        raise RuntimeError(
            "检测到后端依赖从用户级 Python 目录导入，容易导致版本冲突。\n"
            f"Python: {sys.executable}\n"
            f"User site: {usersite}\n"
            "导入来源:\n"
            f"{details}\n\n"
            "请使用以下命令启动（PowerShell）:\n"
            "$env:PYTHONNOUSERSITE=1; python -m uvicorn app.main:app --reload --port 8000\n"
        )

if os.environ.get("SKIP_ENV_CHECK") != "1":
    _assert_expected_environment()
 
from app.api import auth, documents, chat, events, stats, flashcards, quiz, config

app = FastAPI(title="AI Learning Assistant API")

app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(events.router)
app.include_router(stats.router)
app.include_router(flashcards.router)
app.include_router(quiz.router)
app.include_router(config.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def _startup_warmup():
    if os.environ.get("WARMUP_ON_STARTUP", "1") != "1":
        return

    def _run():
        start = time.perf_counter()
        try:
            from app.services.vector_service import get_vector_service

            get_vector_service((os.environ.get("ADMIN_USERNAME") or "admin").strip() or "admin")
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.info("warmup_vector_service_done duration_ms=%s", duration_ms)
        except Exception:
            logger.exception("warmup_vector_service_failed")

    threading.Thread(target=_run, daemon=True).start()

@app.on_event("startup")
async def _startup_auto_ingest():
    if os.environ.get("AUTO_INGEST_ON_STARTUP", "1") != "1":
        return
    import asyncio
    asyncio.create_task(documents.auto_ingest_all_users())

@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid4())
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = int((time.perf_counter() - start) * 1000)
        logger.exception(
            "request_failed request_id=%s method=%s path=%s duration_ms=%s",
            request_id,
            request.method,
            request.url.path,
            duration_ms,
        )
        raise

    duration_ms = int((time.perf_counter() - start) * 1000)
    logger.info(
        "request_done request_id=%s method=%s path=%s status=%s duration_ms=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    response.headers["X-Request-ID"] = request_id
    return response

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    request_id = request.headers.get("x-request-id") or "unknown"
    logger.exception(
        "unhandled_exception request_id=%s method=%s path=%s",
        request_id,
        request.method,
        request.url.path,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "request_id": request_id},
    )

@app.get("/")
async def root():
    return {"message": "AI Learning Assistant API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
