from openai import OpenAI
from typing import List, Dict, Any, Optional
import os
import requests
import logging
import time
import json
import re
from app.services.prompt_manager import PromptManager, env_prompt_dir

class LLMService:
    def __init__(self):
        # Default to LM Studio local API
        self.api_key = "lm-studio"
        self.base_url = "http://localhost:1234/v1"
        self.client = OpenAI(base_url=self.base_url, api_key=self.api_key)
        self.model = self._detect_model()
        self.logger = logging.getLogger("app.llm_service")
        self.prompts = PromptManager(env_prompt_dir())

    def _detect_model(self, base_url: Optional[str] = None, api_key: Optional[str] = None) -> str:
        """Attempt to detect the currently loaded model in LM Studio."""
        bu = base_url or self.base_url
        try:
            headers = {}
            key = api_key if api_key is not None else self.api_key
            if key:
                headers["Authorization"] = f"Bearer {key}"
            response = requests.get(f"{bu}/models", headers=headers or None, timeout=2)
            if response.status_code == 200:
                models = response.json().get('data', [])
                if models:
                    return models[0].get('id')
        except Exception:
            pass
        return "local-model" # Fallback

    def _resolve_runtime_llm(self, llm_cfg: Optional[Dict[str, Any]] = None):
        if not llm_cfg:
            if self.model == "local-model":
                self.model = self._detect_model()
            return self.client, self.base_url, self.model

        base_url = (llm_cfg.get("base_url") or "").strip() or self.base_url
        api_key = llm_cfg.get("api_key")
        if api_key is None:
            api_key = self.api_key
        model = (llm_cfg.get("model") or "").strip() or None

        client = OpenAI(base_url=base_url, api_key=api_key)
        if model:
            return client, base_url, model

        detected = self._detect_model(base_url=base_url, api_key=api_key)
        if detected and detected != "local-model":
            return client, base_url, detected

        if re.match(r"^https?://(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)(:\\d+)?(/|$)", base_url):
            return client, base_url, "local-model"

        raise ValueError("Missing llm.model (and auto-detect via /models failed)")

    def build_messages(
        self,
        query: str,
        context_chunks: List[Dict[str, Any]],
        history: List[Dict[str, str]] = [],
        no_think: bool = False,
        mode: str = "qa",
    ) -> List[Dict[str, str]]:
        context_str = ""
        for i, chunk in enumerate(context_chunks):
            source = chunk.get("metadata", {}).get("source", "Unknown")
            content = (chunk.get("content") or "")[:1000]
            context_str += f"--- 文档片段 [{i+1}] (来源: {source}) ---\n{content}\n\n"

        no_think_prompt = (
            "指令：直接给出简洁的最终答案，无需展示推理过程。/no_think"
            if no_think
            else "指令：在给出最终答案之前，请先在内部进行逻辑分析，确保回答的严谨性。"
        )

        rendered = self.prompts.render(
            mode,
            {
                "query": query,
                "context": context_str,
                "no_think_prompt": no_think_prompt,
            },
        )

        messages: List[Dict[str, str]] = [{"role": "system", "content": rendered.system}]
        for msg in history[-10:]:
            if msg.get("role") in ("user", "assistant") and isinstance(msg.get("content"), str):
                messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": rendered.user})
        return messages

    def generate_response(
        self,
        query: str,
        context_chunks: List[Dict[str, Any]],
        history: List[Dict[str, str]] = [],
        no_think: bool = False,
        mode: str = "qa",
        llm_cfg: Optional[Dict[str, Any]] = None,
    ):
        """Generate response with citations."""
        messages = self.build_messages(query, context_chunks, history, no_think, mode)

        client, base_url, model = self._resolve_runtime_llm(llm_cfg)
        try:
            start = time.perf_counter()
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.7,
                stream=True
            )
            duration_ms = int((time.perf_counter() - start) * 1000)
            self.logger.info("llm_stream_started model=%s base_url=%s duration_ms=%s", model, base_url, duration_ms)
            return response
        except Exception:
            self.logger.exception("llm_call_failed")
            return None

    def generate_related_questions(
        self,
        query: str,
        context_chunks: List[Dict[str, Any]],
        mode: str = "qa",
        limit: int = 3,
        timeout: int = 120,
        llm_cfg: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        safe_limit = max(1, min(int(limit), 3))
        context_lines: List[str] = []
        current_len = 0
        max_context_chars = 3000  # Approx 1000-1500 tokens

        for i, chunk in enumerate(context_chunks):
            source = chunk.get("metadata", {}).get("source", "Unknown")
            content = (chunk.get("content") or "").strip().replace("\n", " ")
            content = re.sub(r"\s+", " ", content)[:300]
            line = f"[{i+1}] {source}: {content}"
            if current_len + len(line) > max_context_chars:
                break
            context_lines.append(line)
            current_len += len(line)
        
        context_brief = "\n".join(context_lines)

        system_prompt = (
            "你是一个智能学习助手的推荐问题生成器。"
            "请根据用户问题与检索到的文档片段，生成后续可能想问的相关问题。"
            "要求：\n"
            f"- 输出必须是严格的 JSON 数组（array），元素是字符串\n"
            f"- 数量不超过 {safe_limit} 条\n"
            "- 每条长度不超过 120 字符\n"
            "- 不要包含 Markdown、不要包含序号、不要包含解释\n"
        )
        user_prompt = (
            f"mode={mode}\n"
            f"用户问题：{query}\n\n"
            f"检索片段（摘要）：\n{context_brief}\n"
        )

        try:
            client, _, model = self._resolve_runtime_llm(llm_cfg)
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.6,
                stream=False,
                max_tokens=220,
                timeout=timeout,
            )
            text = (resp.choices[0].message.content or "").strip()
        except Exception:
            self.logger.exception("related_questions_failed")
            return []

        items: List[str] = []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                items = [str(x) for x in parsed]
        except Exception:
            m = re.search(r"\[[\s\S]*\]", text)
            if m:
                try:
                    parsed = json.loads(m.group(0))
                    if isinstance(parsed, list):
                        items = [str(x) for x in parsed]
                except Exception:
                    items = []

        cleaned: List[str] = []
        seen = set()
        for q in items:
            q2 = re.sub(r"[\x00-\x1F\x7F]", " ", q)
            q2 = re.sub(r"\s+", " ", q2).strip()
            if not q2:
                continue
            if len(q2) > 120:
                q2 = q2[:120].rstrip()
            if q2 in seen:
                continue
            seen.add(q2)
            cleaned.append(q2)
            if len(cleaned) >= safe_limit:
                break
        return cleaned

    def generate_document_summary(
        self,
        filename: str,
        chunks: List[str],
        llm_cfg: Optional[Dict[str, Any]] = None,
        timeout: int = 90,
    ) -> Optional[str]:
        fn = (filename or "").strip()
        if not chunks:
            return None

        lines: List[str] = []
        current_len = 0
        max_chars = 6000 # ~2000-3000 tokens

        for i, c in enumerate(chunks):
            t = (c or "").strip()
            if not t:
                continue
            t = re.sub(r"\s+", " ", t)
            if len(t) > 1000:
                t = t[:1000].rstrip() + "…"
            
            line = f"[{len(lines)+1}] {t}"
            if current_len + len(line) > max_chars:
                break
            lines.append(line)
            current_len += len(line)
            
        context = "\n".join(lines)
        if not context.strip():
            return None

        rendered = self.prompts.render(
            "summary",
            {
                "query": f"请为文档《{fn or '未命名文档'}》生成中文摘要，要求信息密度高、结构清晰，避免空泛。",
                "context": context,
                "no_think_prompt": "指令：直接给出简洁的最终答案，无需展示推理过程。/no_think",
            },
        )

        try:
            client, _, model = self._resolve_runtime_llm(llm_cfg)
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": rendered.system},
                    {"role": "user", "content": rendered.user},
                ],
                temperature=0.2,
                stream=False,
                max_tokens=700,
                timeout=timeout,
            )
            text = (resp.choices[0].message.content or "").strip()
            if text:
                text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
                text = re.sub(r"<analysis>[\s\S]*?</analysis>", "", text, flags=re.IGNORECASE).strip()
            return text or None
        except Exception:
            self.logger.exception("document_summary_failed filename=%s", fn)
            return None

    def generate_flashcards_from_answer(
        self,
        answer: str,
        query: Optional[str] = None,
        limit: int = 3,
        llm_cfg: Optional[Dict[str, Any]] = None,
        timeout: int = 60,
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 10))
        a = (answer or "").strip()
        if not a:
            return []
        q = (query or "").strip()

        def _validate_format(fmt: Any, front: str, back: str) -> Optional[Dict[str, Any]]:
            if not isinstance(fmt, dict):
                return None
            t = str(fmt.get("type") or "").strip().lower()
            if t == "mcq":
                opts = fmt.get("options")
                try:
                    ans = int(fmt.get("answer"))
                except Exception:
                    return None
                if not isinstance(opts, list) or len(opts) != 4:
                    return None
                options = [str(x).strip() for x in opts]
                if any(not o for o in options):
                    return None
                if ans < 0 or ans > 3:
                    return None
                prompt = str(fmt.get("prompt") or front).strip()
                if not prompt:
                    prompt = front
                return {"type": "mcq", "prompt": prompt[:240], "options": [o[:120] for o in options], "answer": ans}
            if t == "cloze":
                text = str(fmt.get("text") or "").strip()
                ans = str(fmt.get("answer") or "").strip()
                if not text or not ans:
                    return None
                if "____" not in text and "{{blank}}" not in text:
                    return None
                if len(ans) > 120:
                    ans = ans[:120].rstrip()
                return {"type": "cloze", "text": text[:360], "answer": ans}
            return None

        def _default_cloze(front: str, back: str) -> Dict[str, Any]:
            b = (back or "").strip()
            if len(b) > 80:
                b = b[:80].rstrip()
            return {"type": "cloze", "text": f"{front}：____", "answer": b or "（略）"}

        system_prompt = (
            "你是一个学习助手，负责把学习材料提炼为抽认卡（flashcards）。\n"
            "指令：直接输出最终结果，不要输出推理过程或思考过程，不要包含 <think>/<analysis> 标签。/no_think\n"
            "输出要求：\n"
            "- 输出必须是严格的 JSON 数组（array），每个元素是对象：\n"
            "  {\"front\": string, \"back\": string, \"tags\": string[], \"format\": object}\n"
            f"- 数量不超过 {safe_limit} 张\n"
            "- front 是问题或提示，尽量短（<=80字）；back 是答案要点（<=200字）\n"
            "- format 用于做题判分，必须二选一：\n"
            "  1) 选择题：{\"type\":\"mcq\",\"prompt\":string,\"options\":[4个字符串],\"answer\":0-3}\n"
            "  2) 完形填空：{\"type\":\"cloze\",\"text\":string(必须包含____或{{blank}}),\"answer\":string}\n"
            "- 不要使用 Markdown，不要包含多余字段，不要包含序号\n"
            "- 如果材料包含定义/步骤/对比/公式/注意事项，优先转成可记忆的卡片\n"
            "- 要求：每张卡必须同时提供 back（对照答案）和 format（用于出题）\n"
        )
        user_prompt = f"用户问题（可选）：{q}\n\n学习材料（回答）：\n{a}\n\n/no_think"

        try:
            client, _, model = self._resolve_runtime_llm(llm_cfg)
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
                stream=False,
                max_tokens=800,
                timeout=timeout,
            )
            text = (resp.choices[0].message.content or "").strip()
        except Exception:
            self.logger.exception("flashcards_generate_failed")
            return []

        parsed_items: List[Dict[str, Any]] = []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                parsed_items = [x for x in parsed if isinstance(x, dict)]
        except Exception:
            m = re.search(r"```json\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
            if m:
                try:
                    parsed = json.loads(m.group(1))
                    if isinstance(parsed, list):
                        parsed_items = [x for x in parsed if isinstance(x, dict)]
                except Exception:
                    parsed_items = []
            m = re.search(r"\[[\s\S]*\]", text)
            if m:
                try:
                    parsed = json.loads(m.group(0))
                    if isinstance(parsed, list):
                        parsed_items = [x for x in parsed if isinstance(x, dict)]
                except Exception:
                    parsed_items = []

        cleaned: List[Dict[str, Any]] = []
        for it in parsed_items:
            front = (it.get("front") or "").strip()
            back = (it.get("back") or "").strip()
            tags = it.get("tags")
            fmt = it.get("format")
            if not front or not back:
                continue
            if len(front) > 200:
                front = front[:200].rstrip()
            if len(back) > 600:
                back = back[:600].rstrip()
            tag_list: List[str] = []
            if isinstance(tags, list):
                for t in tags[:8]:
                    s = str(t).strip()
                    if s:
                        tag_list.append(s[:40])
            fmt2 = _validate_format(fmt, front, back) or _default_cloze(front, back)
            cleaned.append({"front": front, "back": back, "tags": tag_list, "format": fmt2})
            if len(cleaned) >= safe_limit:
                break
        return cleaned

    def generate_quiz_from_context(
        self,
        context_chunks: List[Dict[str, Any]],
        topic: Optional[str] = None,
        limit: int = 6,
        llm_cfg: Optional[Dict[str, Any]] = None,
        timeout: int = 90,
    ) -> Optional[Dict[str, Any]]:
        safe_limit = max(3, min(int(limit), 12))
        context_lines: List[str] = []
        for i, chunk in enumerate(context_chunks[:8]):
            source = chunk.get("metadata", {}).get("source", "Unknown")
            content = (chunk.get("content") or "").strip().replace("\n", " ")
            content = re.sub(r"\s+", " ", content)[:600]
            context_lines.append(f"[{i+1}] {source}: {content}")
        context_brief = "\n".join(context_lines)
        t = (topic or "").strip()

        system_prompt = (
            "你是一个学习测验生成器。请基于给定材料生成一套小测。\n"
            "输出必须是严格 JSON 对象，格式：\n"
            "{\n"
            "  \"title\": string,\n"
            "  \"topic\": string,\n"
            "  \"questions\": [\n"
            "    {\n"
            "      \"id\": string,\n"
            "      \"type\": \"mcq\" | \"short\",\n"
            "      \"prompt\": string,\n"
            "      \"options\": string[] ,\n"
            "      \"answer\": number | string,\n"
            "      \"explanation\": string\n"
            "    }\n"
            "  ]\n"
            "}\n"
            "规则：\n"
            f"- questions 数量为 {safe_limit}\n"
            "- 至少 70% 为 mcq（每题 options 必须为 4 个选项），answer 为正确选项的 0-3 索引\n"
            "- short 题的 answer 为简短文本，explanation 给出依据\n"
            "- prompt/option/explanation 不要用 Markdown，不要加序号\n"
        )
        user_prompt = (
            f"topic={t or '（未指定）'}\n"
            f"材料（摘要）：\n{context_brief}\n"
        )

        try:
            client, _, model = self._resolve_runtime_llm(llm_cfg)
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.5,
                stream=False,
                max_tokens=1500,
                timeout=timeout,
            )
            text = (resp.choices[0].message.content or "").strip()
        except Exception:
            self.logger.exception("quiz_generate_failed")
            return None

        obj: Optional[Dict[str, Any]] = None
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                obj = parsed
        except Exception:
            m = re.search(r"\{[\s\S]*\}", text)
            if m:
                try:
                    parsed = json.loads(m.group(0))
                    if isinstance(parsed, dict):
                        obj = parsed
                except Exception:
                    obj = None

        if not obj:
            return None

        questions = obj.get("questions")
        if not isinstance(questions, list):
            return None

        cleaned_qs: List[Dict[str, Any]] = []
        for i, q in enumerate(questions):
            if not isinstance(q, dict):
                continue
            qid = str(q.get("id") or f"q{i+1}")
            qtype = str(q.get("type") or "mcq")
            prompt = str(q.get("prompt") or "").strip()
            if not prompt:
                continue
            explanation = str(q.get("explanation") or "").strip()
            if qtype == "mcq":
                opts = q.get("options")
                if not isinstance(opts, list) or len(opts) != 4:
                    continue
                options = [str(x).strip() for x in opts]
                try:
                    ans = int(q.get("answer"))
                except Exception:
                    continue
                if ans < 0 or ans > 3:
                    continue
                cleaned_qs.append(
                    {
                        "id": qid,
                        "type": "mcq",
                        "prompt": prompt[:400],
                        "options": [o[:180] for o in options],
                        "answer": ans,
                        "explanation": explanation[:600],
                    }
                )
            else:
                ans = str(q.get("answer") or "").strip()
                if not ans:
                    continue
                cleaned_qs.append(
                    {
                        "id": qid,
                        "type": "short",
                        "prompt": prompt[:400],
                        "answer": ans[:240],
                        "explanation": explanation[:600],
                    }
                )
            if len(cleaned_qs) >= safe_limit:
                break

        if len(cleaned_qs) < 3:
            return None

        out = {
            "title": str(obj.get("title") or (f"{t} 小测" if t else "学习小测")).strip()[:80],
            "topic": str(obj.get("topic") or (t if t else "")).strip()[:80],
            "questions": cleaned_qs,
        }
        return out

llm_service = LLMService()
