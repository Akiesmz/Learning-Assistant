from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.core.auth import require_user
from app.services.config_service import get_config_service

router = APIRouter(prefix="/config", tags=["config"])

class MinerUConfigRequest(BaseModel):
    token: Optional[str] = None

class MinerUConfigResponse(BaseModel):
    token_masked: Optional[str] = None
    has_token: bool

@router.get("/mineru", response_model=MinerUConfigResponse)
def get_mineru_config(username: str = Depends(require_user)):
    svc = get_config_service()
    token = svc.get_config(username, "mineru_token")
    
    if not token:
        return MinerUConfigResponse(token_masked=None, has_token=False)
    
    masked = token[:4] + "****" + token[-4:] if len(token) > 8 else "****"
    return MinerUConfigResponse(token_masked=masked, has_token=True)

@router.post("/mineru")
def set_mineru_config(body: MinerUConfigRequest, username: str = Depends(require_user)):
    svc = get_config_service()
    # 如果 token 为空，则删除配置
    if not body.token:
        svc.set_config(username, "mineru_token", "")
    else:
        svc.set_config(username, "mineru_token", body.token.strip())
    return {"ok": True}
