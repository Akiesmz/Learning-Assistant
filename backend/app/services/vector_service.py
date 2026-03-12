import os
import faiss
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
import logging
import time
import json
import threading
from langchain_community.vectorstores import FAISS
from langchain_chroma import Chroma
from langchain_core.embeddings import Embeddings
from FlagEmbedding import FlagReranker
import shutil

class NomicEmbedTextV2MoeEmbeddings(Embeddings):
    def __init__(self, model_path: str, device: str = "auto", max_length: int = 2048, normalize: bool = True):
        import torch
        from transformers import AutoModel, AutoTokenizer

        self.model_path = model_path
        self.max_length = max_length
        self.normalize = normalize
        resolved_device = device
        if (device or "").lower() == "auto":
            resolved_device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = torch.device(resolved_device)
        self.tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True, local_files_only=True)
        self.model = AutoModel.from_pretrained(model_path, trust_remote_code=True, local_files_only=True)
        self.model.to(self.device)
        self.model.eval()

    def _embed_batch(self, texts: List[str]) -> List[List[float]]:
        import torch

        encoded = self.tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=self.max_length,
            return_tensors="pt",
        )
        encoded = {k: v.to(self.device) for k, v in encoded.items()}
        with torch.no_grad():
            out = self.model(**encoded)
            last_hidden = out.last_hidden_state
            mask = encoded["attention_mask"].unsqueeze(-1).type_as(last_hidden)
            summed = (last_hidden * mask).sum(dim=1)
            denom = mask.sum(dim=1).clamp(min=1e-9)
            embeddings = summed / denom
            if self.normalize:
                embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
        return embeddings.cpu().tolist()

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        batch_size = 16
        outputs: List[List[float]] = []
        for i in range(0, len(texts), batch_size):
            outputs.extend(self._embed_batch(texts[i : i + batch_size]))
        return outputs

    def embed_query(self, text: str) -> List[float]:
        return self._embed_batch([text])[0]

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

_shared_lock = threading.Lock()
_shared_embeddings: Optional[NomicEmbedTextV2MoeEmbeddings] = None
_shared_reranker: Optional[FlagReranker] = None
_shared_embedding_model_path: Optional[str] = None

def _get_shared_models() -> Tuple[NomicEmbedTextV2MoeEmbeddings, FlagReranker, str]:
    global _shared_embeddings, _shared_reranker, _shared_embedding_model_path
    with _shared_lock:
        logger = logging.getLogger("app.vector_service")
        app_dir = os.path.dirname(os.path.dirname(__file__))
        embed_model_path = os.path.join(app_dir, "models", "nomic-embed-text-v2-moe")
        if _shared_embeddings is None:
            embed_device = (os.environ.get("EMBEDDINGS_DEVICE") or "auto").strip() or "auto"
            _shared_embeddings = NomicEmbedTextV2MoeEmbeddings(model_path=embed_model_path, device=embed_device, normalize=True)
            try:
                import torch
                cuda_ok = bool(torch.cuda.is_available())
                device = str(getattr(_shared_embeddings, "device", "") or "")
                name = ""
                if cuda_ok:
                    try:
                        name = torch.cuda.get_device_name(0) or ""
                    except Exception:
                        name = ""
                logger.info("embeddings_ready device=%s cuda=%s gpu=%s", device, int(cuda_ok), name or "n/a")
            except Exception:
                logger.info("embeddings_ready device=%s", str(getattr(_shared_embeddings, "device", "") or ""))
        if _shared_reranker is None:
            reranker_model_path = os.path.join(app_dir, "models", "bge-reranker-v2-m3")
            reranker_use_fp16 = False
            try:
                import torch
                reranker_use_fp16 = torch.cuda.is_available()
            except Exception:
                reranker_use_fp16 = False
            _shared_reranker = FlagReranker(reranker_model_path, use_fp16=reranker_use_fp16)
            logger.info("reranker_ready use_fp16=%s", int(bool(reranker_use_fp16)))
        _shared_embedding_model_path = embed_model_path
        return _shared_embeddings, _shared_reranker, embed_model_path

class VectorService:
    def __init__(self, username: str):
        self.logger = logging.getLogger("app.vector_service")
        app_dir = os.path.dirname(os.path.dirname(__file__))
        base_dir = os.path.abspath(os.path.join(app_dir, ".."))

        ns = _safe_namespace(username)
        user_dir = os.path.join(base_dir, "user_data", ns)
        os.makedirs(user_dir, exist_ok=True)

        embeddings, reranker, embed_model_path = _get_shared_models()
        self.embeddings = embeddings
        self.reranker = reranker
        self.embedding_model_path = embed_model_path
        self.faiss_path = os.path.join(user_dir, "faiss_index")
        self.chroma_path = os.path.join(user_dir, "chroma_db")
        self.signature_path = os.path.join(user_dir, ".vector_index_signature.json")
        self.vector_db = None

        self._ensure_index_compatible()

        self.chroma_db = None
        try:
            self.chroma_db = Chroma(
                persist_directory=self.chroma_path,
                embedding_function=self.embeddings,
            )
        except Exception:
            self.logger.exception("chroma_init_failed_resetting")
            try:
                if os.path.isdir(self.chroma_path):
                    shutil.rmtree(self.chroma_path, ignore_errors=True)
            except Exception:
                self.logger.exception("chroma_reset_failed")
            self.chroma_db = Chroma(
                persist_directory=self.chroma_path,
                embedding_function=self.embeddings,
            )
        
        self._refresh_faiss()
        self._save_signature()

    def _dependency_signature(self) -> Dict[str, Any]:
        chroma_version = None
        langchain_chroma_version = None
        try:
            import chromadb  # type: ignore
            chroma_version = getattr(chromadb, "__version__", None)
        except Exception:
            chroma_version = None
        try:
            import langchain_chroma  # type: ignore
            langchain_chroma_version = getattr(langchain_chroma, "__version__", None)
        except Exception:
            langchain_chroma_version = None
        return {
            "chromadb": chroma_version,
            "langchain_chroma": langchain_chroma_version,
        }

    def _compute_embedding_dim(self) -> Optional[int]:
        try:
            v = self.embeddings.embed_query("dimension probe")
            return int(len(v)) if v is not None else None
        except Exception:
            return None

    def _current_signature(self) -> Dict[str, Any]:
        return {
            "embedding_impl": self.embeddings.__class__.__name__,
            "model_path": self.embedding_model_path,
            "dim": self._compute_embedding_dim(),
            "normalize": True,
            "deps": self._dependency_signature(),
        }

    def count_chunks(self) -> int:
        if self.chroma_db is None:
            return 0
        try:
            coll = getattr(self.chroma_db, "_collection", None)
            if coll is not None and hasattr(coll, "count"):
                return int(coll.count())
        except Exception:
            pass
        try:
            all_docs = self.chroma_db.get()
            ids = all_docs.get("ids") if isinstance(all_docs, dict) else None
            if isinstance(ids, list):
                return int(len(ids))
            docs = all_docs.get("documents") if isinstance(all_docs, dict) else None
            if isinstance(docs, list):
                return int(len(docs))
        except Exception:
            pass
        return 0

    def _load_signature(self) -> Optional[Dict[str, Any]]:
        try:
            if not os.path.exists(self.signature_path):
                return None
            with open(self.signature_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def _save_signature(self) -> None:
        sig = self._current_signature()
        try:
            with open(self.signature_path, "w", encoding="utf-8") as f:
                json.dump(sig, f, ensure_ascii=False)
        except Exception:
            self.logger.exception("signature_write_failed")

    def _ensure_index_compatible(self) -> None:
        saved = self._load_signature()
        current = self._current_signature()
        if not saved:
            try:
                if os.path.isdir(self.chroma_path):
                    shutil.rmtree(self.chroma_path, ignore_errors=True)
                if os.path.isdir(self.faiss_path):
                    shutil.rmtree(self.faiss_path, ignore_errors=True)
            except Exception:
                self.logger.exception("index_reset_failed")
            return
        if saved == current:
            return
        try:
            if os.path.isdir(self.chroma_path):
                shutil.rmtree(self.chroma_path, ignore_errors=True)
            if os.path.isdir(self.faiss_path):
                shutil.rmtree(self.faiss_path, ignore_errors=True)
        except Exception:
            self.logger.exception("index_reset_failed")

    def _refresh_faiss(self):
        """Rebuild or load FAISS index from ChromaDB for fast retrieval."""
        start = time.perf_counter()
        loaded = False
        if os.path.exists(self.faiss_path):
            try:
                self.vector_db = FAISS.load_local(
                    self.faiss_path,
                    self.embeddings,
                    allow_dangerous_deserialization=True,
                )
                loaded = True
                duration_ms = int((time.perf_counter() - start) * 1000)
                self.logger.info("faiss_loaded_from_disk duration_ms=%s", duration_ms)
            except Exception:
                self.logger.warning("faiss_load_failed_rebuilding")

        if loaded:
            return

        try:
            all_docs = self.chroma_db.get()
            if all_docs and all_docs["documents"]:
                self.vector_db = FAISS.from_texts(
                    all_docs["documents"],
                    self.embeddings,
                    metadatas=all_docs["metadatas"],
                )
                self.vector_db.save_local(self.faiss_path)
                duration_ms = int((time.perf_counter() - start) * 1000)
                self.logger.info("faiss_refreshed docs=%s duration_ms=%s", len(all_docs["documents"]), duration_ms)
            else:
                self.vector_db = None
                duration_ms = int((time.perf_counter() - start) * 1000)
                self.logger.info("faiss_empty duration_ms=%s", duration_ms)
        except Exception:
            self.logger.exception("faiss_refresh_failed")
            self.vector_db = None

    def add_documents(self, texts: List[str], metadatas: List[Dict[str, Any]]):
        """Add documents to both ChromaDB and FAISS (Incremental update)."""
        start = time.perf_counter()
        # Add to ChromaDB (Persistent)
        self.chroma_db.add_texts(texts, metadatas=metadatas)
        
        # Incrementally update FAISS (Memory/Fast Search)
        if self.vector_db is None:
            self._refresh_faiss()
        else:
            try:
                self.vector_db.add_texts(texts, metadatas=metadatas)
                # Periodically save to disk or just keep in memory until restart/refresh
                # For safety, we can save local if needed, but let's keep it fast
                # self.vector_db.save_local(self.faiss_path) 
            except Exception:
                self.logger.warning("faiss_incremental_add_failed_rebuilding")
                self._refresh_faiss()

        duration_ms = int((time.perf_counter() - start) * 1000)
        self.logger.info("documents_added chunks=%s duration_ms=%s", len(texts), duration_ms)

    def delete_by_source(self, source_name: str):
        """Delete all chunks belonging to a specific source."""
        # 1. Delete from ChromaDB
        start = time.perf_counter()
        try:
            # ChromaDB doesn't have a direct delete by metadata filter in some versions
            # We get IDs first
            results = self.chroma_db.get(where={"source": source_name})
            if results['ids']:
                self.chroma_db.delete(ids=results['ids'])
                
            # 2. Rebuild FAISS
            self._refresh_faiss()
            duration_ms = int((time.perf_counter() - start) * 1000)
            self.logger.info("documents_deleted source=%s ids=%s duration_ms=%s", source_name, len(results.get("ids") or []), duration_ms)
            return True
        except Exception as e:
            self.logger.exception("documents_delete_failed source=%s", source_name)
            return False

    def search(self, query: str, top_k: int = 20, final_n: int = 3) -> List[Dict[str, Any]]:
        """Two-stage retrieval: FAISS recall + BGE rerank."""
        start = time.perf_counter()
        if self.vector_db is None:
            # Try refreshing once more if it was empty
            self._refresh_faiss()
            if self.vector_db is None:
                return []

        # Stage 1: Recall (FAISS)
        t0 = time.perf_counter()
        query_vec: Optional[List[float]] = None
        try:
            query_vec = self.embeddings.embed_query(query)
        except Exception:
            query_vec = None
        embed_ms = int((time.perf_counter() - t0) * 1000)

        t1 = time.perf_counter()
        docs_with_scores: List[Any] = []
        if query_vec is not None:
            try:
                if hasattr(self.vector_db, "similarity_search_by_vector_with_score"):
                    docs_with_scores = self.vector_db.similarity_search_by_vector_with_score(query_vec, k=top_k)
                elif hasattr(self.vector_db, "similarity_search_by_vector"):
                    docs = self.vector_db.similarity_search_by_vector(query_vec, k=top_k)
                    docs_with_scores = [(d, 0.0) for d in docs]
                else:
                    docs_with_scores = self.vector_db.similarity_search_with_score(query, k=top_k)
            except Exception:
                docs_with_scores = self.vector_db.similarity_search_with_score(query, k=top_k)
        else:
            docs_with_scores = self.vector_db.similarity_search_with_score(query, k=top_k)
        recall_ms = int((time.perf_counter() - t1) * 1000)
        
        if not docs_with_scores:
            return []
        
        rerank_enabled = (os.environ.get("RERANK_ENABLE") or "1").strip() != "0"
        rerank_top_k_s = (os.environ.get("RERANK_TOP_K") or "").strip()
        try:
            rerank_top_k = int(rerank_top_k_s) if rerank_top_k_s else min(8, int(top_k))
        except Exception:
            rerank_top_k = min(8, int(top_k))
        rerank_top_k = max(1, min(int(top_k), int(rerank_top_k)))

        rerank_ms = 0
        rerank_used = 0
        scores: Optional[Any] = None

        # Stage 2: Rerank (BGE)
        if rerank_enabled:
            t2 = time.perf_counter()
            subset = docs_with_scores[:rerank_top_k]
            passages = [doc.page_content for doc, score in subset]
            rerank_pairs = [[query, passage] for passage in passages]
            scores = self.reranker.compute_score(rerank_pairs)
            rerank_ms = int((time.perf_counter() - t2) * 1000)
            rerank_used = len(subset)
        
        # Combine and sort
        results = []
        for i, (doc, score) in enumerate(docs_with_scores):
            rerank_score = 0.0
            if rerank_enabled and scores is not None and i < rerank_used:
                try:
                    rerank_score = float(scores[i] if isinstance(scores, list) else scores)
                except Exception:
                    rerank_score = 0.0
            results.append(
                {
                    "content": doc.page_content,
                    "metadata": doc.metadata,
                    "recall_score": float(score),
                    "rerank_score": rerank_score,
                }
            )
        
        # Sort by rerank score descending (higher is better for reranker)
        if rerank_enabled:
            results.sort(key=lambda x: x["rerank_score"], reverse=True)
        
        output = results[:final_n]
        duration_ms = int((time.perf_counter() - start) * 1000)
        self.logger.info(
            "search_done recall=%s returned=%s embed_ms=%s recall_ms=%s rerank_ms=%s rerank_used=%s duration_ms=%s",
            len(docs_with_scores),
            len(output),
            embed_ms,
            recall_ms,
            rerank_ms,
            rerank_used,
            duration_ms,
        )
        return output

_vector_services: Dict[str, VectorService] = {}
_vector_service_lock = threading.Lock()


def get_vector_service(username: str) -> VectorService:
    ns = _safe_namespace(username)
    with _vector_service_lock:
        svc = _vector_services.get(ns)
        if svc is None:
            svc = VectorService(username=ns)
            _vector_services[ns] = svc
        return svc
