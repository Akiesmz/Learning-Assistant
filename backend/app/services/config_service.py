import os
import json
import logging
import threading
from pathlib import Path
from typing import Optional, Dict, Any
from cryptography.fernet import Fernet

logger = logging.getLogger("app.config_service")

class ConfigService:
    def __init__(self):
        # 密钥文件存放在 backend/secret.key
        self._key_file = Path(__file__).resolve().parents[2] / "secret.key"
        self._cipher_suite = None
        self._lock = threading.Lock()
        self._ensure_cipher()

    def _ensure_cipher(self):
        with self._lock:
            if self._cipher_suite:
                return
            
            # 尝试加载密钥，如果不存在则生成
            key = None
            if self._key_file.exists():
                try:
                    with open(self._key_file, "rb") as f:
                        key = f.read()
                except Exception:
                    pass
            
            if not key:
                key = Fernet.generate_key()
                try:
                    with open(self._key_file, "wb") as f:
                        f.write(key)
                except Exception:
                    pass # 如果无法写入，至少当前进程可用
            
            try:
                self._cipher_suite = Fernet(key)
            except Exception:
                # 如果密钥损坏，重新生成
                key = Fernet.generate_key()
                self._cipher_suite = Fernet(key)

    def _get_user_config_path(self, username: str) -> Path:
        # 安全处理用户名
        safe_username = "".join([c for c in username if c.isalnum() or c in "-_"])
        if not safe_username:
            safe_username = "unknown"
        
        base_dir = Path(__file__).resolve().parents[2] / "user_data" / safe_username
        base_dir.mkdir(parents=True, exist_ok=True)
        return base_dir / "config.json"

    def get_config(self, username: str, key: str) -> Optional[str]:
        """获取解密后的配置值"""
        try:
            path = self._get_user_config_path(username)
            if not path.exists():
                return None
            
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            encrypted_val = data.get(key)
            if not encrypted_val:
                return None
            
            decrypted_val = self._cipher_suite.decrypt(encrypted_val.encode("utf-8")).decode("utf-8")
            return decrypted_val
        except Exception:
            logger.warning(f"Failed to get config {key} for user {username}")
            return None

    def set_config(self, username: str, key: str, value: str) -> bool:
        """加密并保存配置值"""
        try:
            path = self._get_user_config_path(username)
            data = {}
            if path.exists():
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                except Exception:
                    data = {}
            
            if value:
                encrypted_val = self._cipher_suite.encrypt(value.encode("utf-8")).decode("utf-8")
                data[key] = encrypted_val
            else:
                # 如果值为空，则删除
                data.pop(key, None)
            
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            
            return True
        except Exception:
            logger.exception(f"Failed to set config {key} for user {username}")
            return False

_config_service = None
_config_service_lock = threading.Lock()

def get_config_service() -> ConfigService:
    global _config_service
    if _config_service:
        return _config_service
    with _config_service_lock:
        if _config_service is None:
            _config_service = ConfigService()
        return _config_service
