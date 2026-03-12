import os
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import ensure_default_admin_from_env, issue_token, require_token, require_user, set_user_password, verify_user_password
from app.services.learning_db import learning_db


router = APIRouter(prefix="/auth", tags=["auth"])

_USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_RESERVED_USERNAMES = {"admin"}

def _validate_username(raw: str) -> str:
    u = (raw or "").strip()
    if not u:
        raise HTTPException(status_code=400, detail="username_required")
    if not _USERNAME_RE.match(u):
        raise HTTPException(status_code=400, detail="invalid_username")
    if u.lower() in _RESERVED_USERNAMES:
        raise HTTPException(status_code=400, detail="reserved_username")
    return u


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=1, max_length=512)


class LoginResponse(BaseModel):
    username: str
    token: str


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., min_length=1, max_length=512)
    new_password: str = Field(..., min_length=6, max_length=512)


class MeResponse(BaseModel):
    username: str


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=6, max_length=512)

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=6, max_length=512)


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    ensure_default_admin_from_env()

    u = (body.username or "").strip()
    p = body.password or ""
    if not verify_user_password(u, p):
        raise HTTPException(status_code=401, detail="invalid_credentials")

    token, _ = issue_token(u)
    return LoginResponse(username=u, token=token)


@router.get("/me", response_model=MeResponse)
def me(username: str = Depends(require_user)):
    return MeResponse(username=username)


@router.post("/admin/create-user")
def create_user(body: CreateUserRequest, username: str = Depends(require_user)):
    if username != "admin":
        raise HTTPException(status_code=403, detail="forbidden")
    u = _validate_username(body.username)
    set_user_password(u, body.password)
    try:
        learning_db.delete_auth_tokens_for_user(u)
    except Exception:
        pass
    return {"ok": True, "username": u}

@router.post("/register", response_model=LoginResponse)
def register(body: RegisterRequest):
    allow = (os.environ.get("ALLOW_SELF_REGISTER") or "1").strip() or "1"
    if allow != "1":
        raise HTTPException(status_code=403, detail="self_register_disabled")
    ensure_default_admin_from_env()
    u = _validate_username(body.username)
    if learning_db.get_user_password_record(u) is not None:
        raise HTTPException(status_code=409, detail="username_exists")
    set_user_password(u, body.password)
    token, _ = issue_token(u)
    return LoginResponse(username=u, token=token)


@router.post("/change-password", response_model=LoginResponse)
def change_password(body: ChangePasswordRequest, username: str = Depends(require_user), token: str = Depends(require_token)):
    if not verify_user_password(username, body.old_password):
        raise HTTPException(status_code=400, detail="old_password_incorrect")
    set_user_password(username, body.new_password)

    try:
        learning_db.delete_auth_tokens_for_user(username)
    except Exception:
        pass

    new_token, _ = issue_token(username)
    return LoginResponse(username=username, token=new_token)


@router.post("/logout")
def logout(username: str = Depends(require_user), token: str = Depends(require_token)):
    try:
        learning_db.delete_auth_token(token)
    except Exception:
        pass
    return {"ok": True}

