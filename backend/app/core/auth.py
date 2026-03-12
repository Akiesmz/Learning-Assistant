import base64
import hashlib
import os
import secrets
import time
from typing import Optional, Tuple

from fastapi import HTTPException, Request

from app.services.learning_db import learning_db


_PBKDF2_ITERATIONS = 200_000
_SALT_BYTES = 16


def _utc_ms() -> int:
    return int(time.time() * 1000)


def _b64e(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _b64d(s: str) -> bytes:
    return base64.b64decode((s or "").encode("ascii"))


def hash_password(password: str, salt: bytes) -> bytes:
    pw = (password or "").encode("utf-8")
    return hashlib.pbkdf2_hmac("sha256", pw, salt, _PBKDF2_ITERATIONS, dklen=32)


def ensure_default_admin_from_env() -> None:
    username = (os.environ.get("ADMIN_USERNAME") or "admin").strip() or "admin"
    password = (os.environ.get("ADMIN_PASSWORD") or "123456").strip()
    if not password:
        return
    reset = (os.environ.get("ADMIN_RESET_PASSWORD") or "").strip() == "1"
    rec = learning_db.get_user_password_record(username)
    if rec is None:
        if learning_db.count_users() == 0 or reset:
            set_user_password(username, password)
        return
    if reset:
        set_user_password(username, password)

def set_user_password(username: str, new_password: str) -> None:
    u = (username or "").strip()
    if not u:
        raise ValueError("username is required")
    salt = secrets.token_bytes(_SALT_BYTES)
    ph = hash_password(new_password, salt)
    learning_db.upsert_user_password_record(u, _b64e(salt), _b64e(ph), updated_ts_ms=_utc_ms())


def verify_user_password(username: str, password: str) -> bool:
    rec = learning_db.get_user_password_record(username)
    if not rec:
        return False
    try:
        salt = _b64d(rec["password_salt_b64"])
        expected = _b64d(rec["password_hash_b64"])
    except Exception:
        return False
    actual = hash_password(password, salt)
    return secrets.compare_digest(actual, expected)


def issue_token(username: str) -> Tuple[str, int]:
    ttl_hours = int((os.environ.get("AUTH_TOKEN_TTL_HOURS") or "168").strip() or "168")
    ttl_ms = max(1, ttl_hours) * 60 * 60 * 1000
    now = _utc_ms()
    token = secrets.token_urlsafe(32)
    learning_db.create_auth_token(token=token, username=username, created_ts_ms=now, expires_ts_ms=now + ttl_ms)
    return token, now + ttl_ms


def _extract_bearer_token(request: Request) -> Optional[str]:
    h = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    if not h:
        return None
    parts = h.split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts[0].strip().lower(), parts[1].strip()
    if scheme != "bearer" or not token:
        return None
    return token


def require_user(request: Request) -> str:
    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="unauthorized")

    rec = learning_db.get_auth_token_record(token)
    if not rec:
        raise HTTPException(status_code=401, detail="unauthorized")

    now = _utc_ms()
    if int(rec["expires_ts_ms"]) <= now:
        try:
            learning_db.delete_auth_token(token)
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="token_expired")

    return str(rec["username"])


def require_token(request: Request) -> str:
    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="unauthorized")
    return token

