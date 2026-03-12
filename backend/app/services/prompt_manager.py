import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, Optional


@dataclass(frozen=True)
class PromptTemplate:
    system: str
    user: str


class PromptManager:
    def __init__(self, prompt_dir: Optional[str] = None):
        base = Path(prompt_dir) if prompt_dir else Path(__file__).resolve().parents[1] / "prompts"
        self.prompt_dir = base
        self._cache: Dict[Path, Dict[str, Any]] = {}

    def _template_path(self, mode: str) -> Path:
        safe = (mode or "").strip().lower()
        return self.prompt_dir / f"{safe}.prompt.json"

    def load(self, mode: str) -> PromptTemplate:
        path = self._template_path(mode)
        if not path.exists():
            raise FileNotFoundError(f"prompt template not found: {path}")

        mtime = path.stat().st_mtime
        cached = self._cache.get(path)
        if cached and cached.get("mtime") == mtime:
            return cached["template"]

        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        system = str(data.get("system") or "")
        user = str(data.get("user") or "")
        if not system.strip() or not user.strip():
            raise ValueError(f"invalid prompt template: {path}")

        tpl = PromptTemplate(system=system, user=user)
        self._cache[path] = {"mtime": mtime, "template": tpl}
        return tpl

    def render(self, mode: str, variables: Dict[str, Any]) -> PromptTemplate:
        tpl = self.load(mode)
        try:
            system = tpl.system.format(**variables)
            user = tpl.user.format(**variables)
        except Exception as e:
            raise ValueError(f"prompt render failed for mode={mode}: {e}") from e
        return PromptTemplate(system=system, user=user)


def env_prompt_dir() -> Optional[str]:
    val = os.environ.get("PROMPT_DIR")
    return val.strip() if val and val.strip() else None

