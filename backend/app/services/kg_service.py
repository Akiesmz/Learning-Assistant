import spacy
import networkx as nx
from networkx.algorithms import community
import os
import json
import re
from typing import List, Dict, Any, Optional
import threading
from pathlib import Path

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

_STOP_TERMS = {
    "的",
    "了",
    "在",
    "是",
    "和",
    "与",
    "及",
    "或",
    "等",
    "对",
    "中",
    "上",
    "下",
    "按",
    "为",
    "于",
}

_HAS_WORD_RE = re.compile(r"[A-Za-z0-9\u4e00-\u9fff]")
_ALL_PUNCT_RE = re.compile(r"^[\W_]+$", re.UNICODE)
_TRIM_EDGE_RE = re.compile(r"^[\s\W_]+|[\s\W_]+$", re.UNICODE)


def _normalize_term(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return ""
    t = re.sub(r"\s+", " ", t)
    t = _TRIM_EDGE_RE.sub("", t).strip()
    return t


def _is_meaningful_term(text: str) -> bool:
    t = _normalize_term(text)
    if not t or len(t) < 2:
        return False
    if t in _STOP_TERMS:
        return False
    if _ALL_PUNCT_RE.match(t):
        return False
    if t.isdigit():
        return False
    if not _HAS_WORD_RE.search(t):
        return False
    word_chars = sum(1 for ch in t if ("A" <= ch <= "Z") or ("a" <= ch <= "z") or ("0" <= ch <= "9") or ("\u4e00" <= ch <= "\u9fff"))
    if word_chars / max(1, len(t)) < 0.6:
        return False
    return True

_shared_nlp_lock = threading.Lock()
_shared_nlp = None

class KGService:
    def __init__(self, username: str):
        global _shared_nlp
        with _shared_nlp_lock:
            if _shared_nlp is None:
                try:
                    _shared_nlp = spacy.load("zh_core_web_sm")
                except Exception:
                    import subprocess
                    subprocess.run(["python", "-m", "spacy", "download", "zh_core_web_sm"])
                    _shared_nlp = spacy.load("zh_core_web_sm")
        self.nlp = _shared_nlp
            
        self.graph = nx.Graph()
        backend_dir = Path(__file__).resolve().parents[2]
        ns = _safe_namespace(username)
        user_dir = backend_dir / "user_data" / ns
        user_dir.mkdir(parents=True, exist_ok=True)
        self.kg_path = str(user_dir / "knowledge_graph.json")
        
        # Load existing graph if it exists
        if os.path.exists(self.kg_path):
            self._load_graph()

    def extract_entities_and_relations(self, text: str, source: str, chunk_index: Optional[int] = None, section_title: Optional[str] = None):
        """Extract entities and build relationships from text."""
        doc = self.nlp(text)
        
        entities = []
        seen_texts = set()

        # 1. Standard Named Entities
        for ent in doc.ents:
            if ent.label_ in ["PERSON", "ORG", "GPE", "LOC", "PRODUCT", "EVENT", "WORK_OF_ART"]:
                clean_text = _normalize_term(ent.text)
                if not _is_meaningful_term(clean_text):
                    continue
                if clean_text not in seen_texts:
                    entities.append((clean_text, ent.label_))
                    seen_texts.add(clean_text)

        # 2. Key Concepts (Nouns/Propn) - Optimization: Capture important non-entity terms
        # Limit to top 20 concepts per chunk to avoid graph explosion
        concepts = []
        for token in doc:
            if token.pos_ in ["NOUN", "PROPN"] and not token.ent_type_:
                raw = _normalize_term(token.text)
                if token.is_stop:
                    continue
                if not _is_meaningful_term(raw):
                    continue
                concepts.append(raw)
        
        # Simple frequency filter for concepts in this chunk
        from collections import Counter
        concept_counts = Counter(concepts)
        for concept, count in concept_counts.most_common(10):
            if concept not in seen_texts:
                entities.append((concept, "CONCEPT"))
                seen_texts.add(concept)
        
        # 3. LLM-based Extraction (Optional)
        # Enable via env var: KG_LLM_ENHANCE=true
        if os.environ.get("KG_LLM_ENHANCE") == "true":
            try:
                self._extract_with_llm(text, source)
            except Exception as e:
                # Log error but don't fail the whole process
                print(f"LLM KG Extraction failed: {e}")

        # Build relationships based on co-occurrence in the same chunk
        for i in range(len(entities)):
            ent1, label1 = entities[i]

            # Add/Update node
            if not self.graph.has_node(ent1):
                self.graph.add_node(ent1, label=label1, sources=[source])
            else:
                sources = self.graph.nodes[ent1].get('sources', [])
                if source not in sources:
                    sources.append(source)
                    self.graph.nodes[ent1]['sources'] = sources

            if chunk_index is not None:
                ci = int(chunk_index)
                cbs = self.graph.nodes[ent1].get("chunks_by_source")
                if not isinstance(cbs, dict):
                    cbs = {}
                lst = cbs.get(source)
                if not isinstance(lst, list):
                    lst = []
                if ci not in lst:
                    lst.append(ci)
                cbs[source] = lst
                self.graph.nodes[ent1]["chunks_by_source"] = cbs
            
            for j in range(i + 1, len(entities)):
                ent2, label2 = entities[j]
                if ent1 != ent2:
                    # Add edge with source as attribute
                    if self.graph.has_edge(ent1, ent2):
                        self.graph[ent1][ent2]['weight'] += 1
                        edge_sources = self.graph[ent1][ent2].get('sources', [])
                        if source not in edge_sources:
                            edge_sources.append(source)
                            self.graph[ent1][ent2]['sources'] = edge_sources
                    else:
                        self.graph.add_edge(ent1, ent2, weight=1, sources=[source])

        if chunk_index is not None and section_title:
            try:
                ci = int(chunk_index)
                meta = self.graph.graph.get("doc_meta")
                if not isinstance(meta, dict):
                    meta = {}
                d = meta.get(source)
                if not isinstance(d, dict):
                    d = {}
                s = d.get("sections_by_chunk")
                if not isinstance(s, dict):
                    s = {}
                s[str(ci)] = str(section_title)[:120]
                d["sections_by_chunk"] = s
                meta[source] = d
                self.graph.graph["doc_meta"] = meta
            except Exception:
                pass
        
        # Detect communities and update node attributes
        self._detect_communities()
        self._save_graph()

    def _resolve_entity(self, name: str) -> str:
        """Resolve entity name to existing node if similar."""
        name = _normalize_term(name)
        if self.graph.has_node(name):
            return name
        
        # Simple rule-based resolution
        # 1. Case-insensitive match (already done by _normalize_term somewhat)
        # 2. Check for singular/plural forms (very basic)
        if name.endswith("s") and self.graph.has_node(name[:-1]):
            return name[:-1]
        
        # 3. Check for common prefixes/suffixes
        # TODO: Implement more advanced fuzzy matching if needed
        return name

    def _detect_communities(self):
        """Detect communities using Louvain or Label Propagation."""
        try:
            # Only run on connected components to be safe
            # Use greedy_modularity_communities for reasonable speed/quality
            communities = community.greedy_modularity_communities(self.graph)
            
            for i, comm in enumerate(communities):
                for node in comm:
                    if self.graph.has_node(node):
                        self.graph.nodes[node]["community"] = i
        except Exception as e:
            # Fallback or ignore
            pass

    def _extract_with_llm(self, text: str, source: str):
        """Use LLM to extract semantic relationships."""
        from app.services.llm_service import llm_service
        
        prompt = f"""
        Analyze the following text and extract key entities and their relationships.
        Return ONLY a JSON array of objects. Each object must have:
        - "head": The subject entity (string)
        - "type": The type of the subject entity (e.g. PERSON, ORG, CONCEPT, EVENT, TECH)
        - "tail": The object entity (string)
        - "relation": The relationship between them (string, e.g. "works_at", "caused_by", "part_of", "uses")
        - "description": A brief description of the relationship or context (optional, string)
        
        Text:
        {text[:1200]}
        
        JSON:
        """
        
        try:
            # Call LLM (assuming a simple synchronous call wrapper or direct usage)
            # We use a simplified call here. In production, use structured output if available.
            messages = [{"role": "user", "content": prompt}]
            # Note: llm_service.client is OpenAI compatible
            response = llm_service.client.chat.completions.create(
                model=llm_service.model,
                messages=messages,
                temperature=0.1,
                max_tokens=512
            )
            content = response.choices[0].message.content.strip()
            
            # Parse JSON
            import json
            import re
            
            # Try to find JSON array in markdown code blocks
            match = re.search(r'\[.*\]', content, re.DOTALL)
            if match:
                content = match.group(0)
            
            triples = json.loads(content)
            
            for item in triples:
                head = item.get("head")
                tail = item.get("tail")
                relation = item.get("relation")
                head_type = item.get("type", "CONCEPT")
                description = item.get("description", "")
                
                head = _normalize_term(str(head or ""))
                tail = _normalize_term(str(tail or ""))
                relation = _normalize_term(str(relation or ""))
                if head and tail and relation and _is_meaningful_term(head) and _is_meaningful_term(tail):
                    # Add nodes
                    if not self.graph.has_node(head):
                        self.graph.add_node(head, label=head_type, sources=[source])
                    if not self.graph.has_node(tail):
                        self.graph.add_node(tail, label="CONCEPT", sources=[source])
                    
                    # Add edge with relation label
                    if self.graph.has_edge(head, tail):
                        self.graph[head][tail]['weight'] += 2 # Stronger weight for LLM relations
                        # Store relation label if not present
                        rels = self.graph[head][tail].get('relations', [])
                        if relation not in rels:
                            rels.append(relation)
                            self.graph[head][tail]['relations'] = rels
                        
                        # Merge descriptions
                        old_desc = self.graph[head][tail].get('description', '')
                        if description and len(description) > len(old_desc):
                             self.graph[head][tail]['description'] = description[:200]
                    else:
                        self.graph.add_edge(head, tail, weight=2, sources=[source], relations=[relation], description=description[:200])
                        
        except Exception:
            pass # Fail silently for LLM extraction

    def delete_by_source(self, source_name: str):
        """Remove entities and relations associated with a source."""
        meta = self.graph.graph.get("doc_meta")
        if isinstance(meta, dict) and source_name in meta:
            try:
                meta.pop(source_name, None)
                self.graph.graph["doc_meta"] = meta
            except Exception:
                pass

        # 1. Collect edges to remove or update
        edges_to_remove = []
        for u, v, data in self.graph.edges(data=True):
            sources = data.get('sources', [])
            if source_name in sources:
                if len(sources) <= 1:
                    edges_to_remove.append((u, v))
                else:
                    sources.remove(source_name)
                    self.graph[u][v]['sources'] = sources
                    self.graph[u][v]['weight'] = max(1, self.graph[u][v]['weight'] - 1)

        # 2. Remove edges
        self.graph.remove_edges_from(edges_to_remove)

        # 3. Clean up nodes
        nodes_to_remove = []
        for node, data in self.graph.nodes(data=True):
            sources = data.get('sources', [])
            if source_name in sources:
                sources.remove(source_name)
                if not sources: # No more sources for this node
                    nodes_to_remove.append(node)
                else:
                    self.graph.nodes[node]['sources'] = sources

            cbs = data.get("chunks_by_source")
            if isinstance(cbs, dict) and source_name in cbs:
                try:
                    cbs.pop(source_name, None)
                    if cbs:
                        self.graph.nodes[node]["chunks_by_source"] = cbs
                    else:
                        try:
                            self.graph.nodes[node].pop("chunks_by_source", None)
                        except Exception:
                            pass
                except Exception:
                    pass
            
            # Also remove isolated nodes with no edges
            if self.graph.degree(node) == 0 and node not in nodes_to_remove:
                nodes_to_remove.append(node)

        self.graph.remove_nodes_from(nodes_to_remove)
        self._save_graph()
        return True

    def get_graph_data(self, view: str = "flat") -> Dict[str, Any]:
        """Return graph data in a format suitable for visualization (nodes and links)."""
        v = (view or "").strip().lower() or "flat"
        if v == "structured":
            import hashlib

            nodes_by_id: Dict[str, Dict[str, Any]] = {}
            degree_map: Dict[str, int] = {}
            links: List[Dict[str, Any]] = []
            seen_links: set = set()

            meta = self.graph.graph.get("doc_meta")
            doc_meta = meta if isinstance(meta, dict) else {}

            section_nodes_by_src_title: Dict[str, Dict[str, str]] = {}

            def _ensure_node(nid: str, payload: Dict[str, Any]):
                if nid not in nodes_by_id:
                    nodes_by_id[nid] = payload

            def _add_link(sid: str, tid: str, weight: int, sources: List[str]):
                k = (sid, tid, tuple(sources or []))
                if k in seen_links:
                    return
                seen_links.add(k)
                links.append({"source": sid, "target": tid, "weight": weight, "sources": sources})
                degree_map[sid] = degree_map.get(sid, 0) + 1
                degree_map[tid] = degree_map.get(tid, 0) + 1

            for ent, ndata in self.graph.nodes(data=True):
                ent_name = _normalize_term(str(ent or ""))
                if not _is_meaningful_term(ent_name):
                    continue
                cbs = ndata.get("chunks_by_source")
                if not isinstance(cbs, dict):
                    continue
                for src, chunks in cbs.items():
                    s = (src or "").strip()
                    if not s or not isinstance(chunks, list):
                        continue

                    doc_id = f"doc::{s}"
                    _ensure_node(doc_id, {"id": doc_id, "name": s, "label": "DOC", "sources": [s]})

                    sec_map = {}
                    try:
                        sec_map = (doc_meta.get(s) or {}).get("sections_by_chunk") or {}
                        if not isinstance(sec_map, dict):
                            sec_map = {}
                    except Exception:
                        sec_map = {}

                    for raw_ci in chunks:
                        try:
                            ci = int(raw_ci)
                        except Exception:
                            continue
                        sec_title = (sec_map.get(str(ci)) or "").strip()
                        sec_title = sec_title or "未归类"
                        m = section_nodes_by_src_title.get(s)
                        if m is None:
                            m = {}
                            section_nodes_by_src_title[s] = m
                        sid = m.get(sec_title)
                        if not sid:
                            h = hashlib.sha1(sec_title.encode("utf-8")).hexdigest()[:10]
                            sid = f"{s}::section::{h}"
                            m[sec_title] = sid
                            _ensure_node(sid, {"id": sid, "name": sec_title, "label": "SECTION", "sources": [s]})
                            _add_link(doc_id, sid, 1, [s])

                        ent_id = f"{s}::ent::{ent_name}"
                        _ensure_node(
                            ent_id,
                            {
                                "id": ent_id,
                                "name": ent_name,
                                "label": ndata.get("label", "Unknown"),
                                "sources": [s],
                            },
                        )
                        _add_link(sid, ent_id, 1, [s])

            if not nodes_by_id:
                for ent, ndata in self.graph.nodes(data=True):
                    ent_name = _normalize_term(str(ent or ""))
                    if not _is_meaningful_term(ent_name):
                        continue
                    srcs = ndata.get("sources", []) or []
                    if not isinstance(srcs, list):
                        continue
                    for src in srcs:
                        s = (src or "").strip()
                        if not s:
                            continue
                        doc_id = f"doc::{s}"
                        _ensure_node(doc_id, {"id": doc_id, "name": s, "label": "DOC", "sources": [s]})
                        ent_id = f"{s}::ent::{ent_name}"
                        _ensure_node(
                            ent_id,
                            {
                                "id": ent_id,
                                "name": ent_name,
                                "label": ndata.get("label", "Unknown"),
                                "sources": [s],
                            },
                        )
                        _add_link(doc_id, ent_id, 1, [s])

            nodes: List[Dict[str, Any]] = []
            for nid, n in nodes_by_id.items():
                deg = int(degree_map.get(nid, 0))
                n["degree"] = deg
                n["val"] = deg + 1
                nodes.append(n)

            return {"nodes": nodes, "links": links}

        nodes_by_id: Dict[str, Dict[str, Any]] = {}
        degree_map: Dict[str, int] = {}
        links: List[Dict[str, Any]] = []

        for u, v, edata in self.graph.edges(data=True):
            edge_sources = edata.get("sources", []) or []
            weight = int(edata.get("weight", 1) or 1)
            for src in edge_sources:
                s = (src or "").strip()
                if not s:
                    continue
                su = f"{s}::{u}"
                sv = f"{s}::{v}"
                links.append(
                    {
                        "source": su,
                        "target": sv,
                        "weight": weight,
                        "sources": [s],
                    }
                )

                degree_map[su] = degree_map.get(su, 0) + 1
                degree_map[sv] = degree_map.get(sv, 0) + 1

                if su not in nodes_by_id:
                    ndata = self.graph.nodes.get(u, {}) or {}
                    nodes_by_id[su] = {
                        "id": su,
                        "name": u,
                        "label": ndata.get("label", "Unknown"),
                        "sources": [s],
                    }
                if sv not in nodes_by_id:
                    ndata = self.graph.nodes.get(v, {}) or {}
                    nodes_by_id[sv] = {
                        "id": sv,
                        "name": v,
                        "label": ndata.get("label", "Unknown"),
                        "sources": [s],
                    }

        nodes: List[Dict[str, Any]] = []
        for nid, n in nodes_by_id.items():
            deg = int(degree_map.get(nid, 0))
            n["degree"] = deg
            n["val"] = deg + 1
            nodes.append(n)

        return {"nodes": nodes, "links": links}

    def _save_graph(self):
        data = nx.node_link_data(self.graph)
        with open(self.kg_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _load_graph(self):
        try:
            with open(self.kg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.graph = nx.node_link_graph(data)
        except Exception as e:
            print(f"Error loading graph: {e}")
            self.graph = nx.Graph()

_kg_services: Dict[str, KGService] = {}
_kg_service_lock = threading.Lock()


def get_kg_service(username: str) -> KGService:
    ns = _safe_namespace(username)
    with _kg_service_lock:
        svc = _kg_services.get(ns)
        if svc is None:
            svc = KGService(username=ns)
            _kg_services[ns] = svc
        return svc
