import json
import os
import sqlite3
import threading
import time
import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


def _default_db_path() -> str:
    base_dir = Path(__file__).resolve().parents[2]
    return str(base_dir / "learning.db")


def _utc_ms() -> int:
    return int(time.time() * 1000)


@dataclass(frozen=True)
class EventRow:
    id: int
    event: str
    ts_ms: int
    payload_json: Optional[str]

@dataclass(frozen=True)
class FlashcardRow:
    id: int
    front: str
    back: str
    tags_json: Optional[str]
    format_json: Optional[str]
    source_doc: Optional[str]
    source_chunk_id: Optional[str]
    created_ts_ms: int
    due_ts_ms: int
    interval_days: int
    ease_factor: float
    reps: int
    lapses: int
    last_review_ts_ms: Optional[int]

@dataclass(frozen=True)
class DocumentRow:
    filename: str
    uploaded_ts_ms: int
    size_bytes: int
    summary_text: Optional[str]
    summary_ts_ms: Optional[int]
    summary_status: Optional[str]
    summary_error: Optional[str]
    parse_status: Optional[str] = None
    parse_error: Optional[str] = None
    index_status: Optional[str] = None
    index_error: Optional[str] = None
    kg_status: Optional[str] = None
    kg_error: Optional[str] = None
    pipeline_updated_ts_ms: Optional[int] = None


class LearningDb:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = (db_path or os.environ.get("LEARNING_DB_PATH") or _default_db_path()).strip()
        self._init_lock = threading.Lock()
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def init(self) -> None:
        if self._initialized:
            return
        with self._init_lock:
            if self._initialized:
                return
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
            with self._connect() as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS schema_meta (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        event TEXT NOT NULL,
                        ts_ms INTEGER NOT NULL,
                        payload_json TEXT
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_events_event_ts ON events(event, ts_ms)")
                cols = conn.execute("PRAGMA table_info(events)").fetchall()
                col_names = {str(c["name"]) for c in cols if c and c["name"] is not None}
                if "username" not in col_names:
                    conn.execute("ALTER TABLE events ADD COLUMN username TEXT")
                    conn.execute("UPDATE events SET username = COALESCE(username, 'admin') WHERE username IS NULL OR username = ''")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_events_user_event_ts ON events(username, event, ts_ms)")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS flashcards (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        front TEXT NOT NULL,
                        back TEXT NOT NULL,
                        tags_json TEXT,
                        source_doc TEXT,
                        source_chunk_id TEXT,
                        created_ts_ms INTEGER NOT NULL,
                        due_ts_ms INTEGER NOT NULL,
                        interval_days INTEGER NOT NULL,
                        ease_factor REAL NOT NULL,
                        reps INTEGER NOT NULL,
                        lapses INTEGER NOT NULL,
                        last_review_ts_ms INTEGER
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_flashcards_due ON flashcards(due_ts_ms)")
                cols = conn.execute("PRAGMA table_info(flashcards)").fetchall()
                col_names = {str(c["name"]) for c in cols if c and c["name"] is not None}
                if "format_json" not in col_names:
                    conn.execute("ALTER TABLE flashcards ADD COLUMN format_json TEXT")
                if "username" not in col_names:
                    conn.execute("ALTER TABLE flashcards ADD COLUMN username TEXT")
                    conn.execute("UPDATE flashcards SET username = COALESCE(username, 'admin') WHERE username IS NULL OR username = ''")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_flashcards_user_due ON flashcards(username, due_ts_ms)")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS reviews (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        card_id INTEGER NOT NULL,
                        ts_ms INTEGER NOT NULL,
                        grade INTEGER NOT NULL,
                        FOREIGN KEY(card_id) REFERENCES flashcards(id) ON DELETE CASCADE
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_reviews_card_ts ON reviews(card_id, ts_ms)")
                cols = conn.execute("PRAGMA table_info(reviews)").fetchall()
                col_names = {str(c["name"]) for c in cols if c and c["name"] is not None}
                if "username" not in col_names:
                    conn.execute("ALTER TABLE reviews ADD COLUMN username TEXT")
                    conn.execute("UPDATE reviews SET username = COALESCE(username, 'admin') WHERE username IS NULL OR username = ''")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_reviews_user_ts ON reviews(username, ts_ms)")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS quizzes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        created_ts_ms INTEGER NOT NULL,
                        config_json TEXT,
                        quiz_json TEXT NOT NULL
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_quizzes_created ON quizzes(created_ts_ms)")
                cols = conn.execute("PRAGMA table_info(quizzes)").fetchall()
                col_names = {str(c["name"]) for c in cols if c and c["name"] is not None}
                if "username" not in col_names:
                    conn.execute("ALTER TABLE quizzes ADD COLUMN username TEXT")
                    conn.execute("UPDATE quizzes SET username = COALESCE(username, 'admin') WHERE username IS NULL OR username = ''")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_quizzes_user_created ON quizzes(username, created_ts_ms)")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS quiz_attempts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        quiz_id INTEGER NOT NULL,
                        ts_ms INTEGER NOT NULL,
                        answers_json TEXT NOT NULL,
                        score REAL NOT NULL,
                        total REAL NOT NULL,
                        FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_quiz_attempts_ts ON quiz_attempts(ts_ms)")
                cols = conn.execute("PRAGMA table_info(quiz_attempts)").fetchall()
                col_names = {str(c["name"]) for c in cols if c and c["name"] is not None}
                if "username" not in col_names:
                    conn.execute("ALTER TABLE quiz_attempts ADD COLUMN username TEXT")
                    conn.execute("UPDATE quiz_attempts SET username = COALESCE(username, 'admin') WHERE username IS NULL OR username = ''")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_ts ON quiz_attempts(username, ts_ms)")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS documents (
                        filename TEXT PRIMARY KEY,
                        uploaded_ts_ms INTEGER NOT NULL,
                        size_bytes INTEGER NOT NULL,
                        summary_text TEXT,
                        summary_ts_ms INTEGER,
                        summary_status TEXT,
                        summary_error TEXT
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS documents_v2 (
                        username TEXT NOT NULL,
                        filename TEXT NOT NULL,
                        uploaded_ts_ms INTEGER NOT NULL,
                        size_bytes INTEGER NOT NULL,
                        summary_text TEXT,
                        summary_ts_ms INTEGER,
                        summary_status TEXT,
                        summary_error TEXT,
                        PRIMARY KEY(username, filename)
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_v2_user_uploaded ON documents_v2(username, uploaded_ts_ms)")
                cols = conn.execute("PRAGMA table_info(documents_v2)").fetchall()
                col_names = {str(c["name"]) for c in cols if c and c["name"] is not None}
                for col, typ in [
                    ("parse_status", "TEXT"),
                    ("parse_error", "TEXT"),
                    ("index_status", "TEXT"),
                    ("index_error", "TEXT"),
                    ("kg_status", "TEXT"),
                    ("kg_error", "TEXT"),
                    ("pipeline_updated_ts_ms", "INTEGER"),
                ]:
                    if col not in col_names:
                        conn.execute(f"ALTER TABLE documents_v2 ADD COLUMN {col} {typ}")
                try:
                    row = conn.execute("SELECT COUNT(1) AS c FROM documents_v2").fetchone()
                    c = int(row["c"] if row and row["c"] is not None else 0)
                except Exception:
                    c = 0
                if c == 0:
                    try:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO documents_v2(
                                username, filename, uploaded_ts_ms, size_bytes,
                                summary_text, summary_ts_ms, summary_status, summary_error
                            )
                            SELECT
                                'admin' AS username, filename, uploaded_ts_ms, size_bytes,
                                summary_text, summary_ts_ms, summary_status, summary_error
                            FROM documents
                            """
                        )
                    except Exception:
                        pass
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        username TEXT PRIMARY KEY,
                        password_salt_b64 TEXT NOT NULL,
                        password_hash_b64 TEXT NOT NULL,
                        updated_ts_ms INTEGER NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS auth_tokens (
                        token TEXT PRIMARY KEY,
                        username TEXT NOT NULL,
                        created_ts_ms INTEGER NOT NULL,
                        expires_ts_ms INTEGER NOT NULL,
                        FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(username)")
            self._initialized = True

    def count_users(self) -> int:
        self.init()
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(1) AS c FROM users").fetchone()
            return int(row["c"] if row and row["c"] is not None else 0)

    def get_user_password_record(self, username: str) -> Optional[Dict[str, Any]]:
        self.init()
        u = (username or "").strip()
        if not u:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT username, password_salt_b64, password_hash_b64, updated_ts_ms
                FROM users
                WHERE username = ?
                """,
                (u,),
            ).fetchone()
        if not row:
            return None
        return {
            "username": str(row["username"]),
            "password_salt_b64": str(row["password_salt_b64"]),
            "password_hash_b64": str(row["password_hash_b64"]),
            "updated_ts_ms": int(row["updated_ts_ms"]),
        }

    def upsert_user_password_record(self, username: str, password_salt_b64: str, password_hash_b64: str, updated_ts_ms: Optional[int] = None) -> None:
        self.init()
        u = (username or "").strip()
        if not u:
            raise ValueError("username is required")
        salt = (password_salt_b64 or "").strip()
        ph = (password_hash_b64 or "").strip()
        if not salt or not ph:
            raise ValueError("password_salt_b64 and password_hash_b64 are required")
        ts = int(updated_ts_ms) if isinstance(updated_ts_ms, int) else _utc_ms()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO users(username, password_salt_b64, password_hash_b64, updated_ts_ms)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(username) DO UPDATE SET
                    password_salt_b64=excluded.password_salt_b64,
                    password_hash_b64=excluded.password_hash_b64,
                    updated_ts_ms=excluded.updated_ts_ms
                """,
                (u, salt, ph, int(ts)),
            )

    def create_auth_token(self, token: str, username: str, expires_ts_ms: int, created_ts_ms: Optional[int] = None) -> None:
        self.init()
        t = (token or "").strip()
        u = (username or "").strip()
        if not t or not u:
            raise ValueError("token and username are required")
        created = int(created_ts_ms) if isinstance(created_ts_ms, int) else _utc_ms()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO auth_tokens(token, username, created_ts_ms, expires_ts_ms)
                VALUES(?, ?, ?, ?)
                """,
                (t, u, int(created), int(expires_ts_ms)),
            )

    def get_auth_token_record(self, token: str) -> Optional[Dict[str, Any]]:
        self.init()
        t = (token or "").strip()
        if not t:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT token, username, created_ts_ms, expires_ts_ms
                FROM auth_tokens
                WHERE token = ?
                """,
                (t,),
            ).fetchone()
        if not row:
            return None
        return {
            "token": str(row["token"]),
            "username": str(row["username"]),
            "created_ts_ms": int(row["created_ts_ms"]),
            "expires_ts_ms": int(row["expires_ts_ms"]),
        }

    def delete_auth_token(self, token: str) -> None:
        self.init()
        t = (token or "").strip()
        if not t:
            return
        with self._connect() as conn:
            conn.execute("DELETE FROM auth_tokens WHERE token = ?", (t,))

    def delete_auth_tokens_for_user(self, username: str) -> None:
        self.init()
        u = (username or "").strip()
        if not u:
            return
        with self._connect() as conn:
            conn.execute("DELETE FROM auth_tokens WHERE username = ?", (u,))

    def upsert_document(self, username: str, filename: str, uploaded_ts_ms: int, size_bytes: int) -> None:
        self.init()
        u = (username or "").strip()
        fn = (filename or "").strip()
        if not u:
            raise ValueError("username is required")
        if not fn:
            raise ValueError("filename is required")
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO documents_v2(username, filename, uploaded_ts_ms, size_bytes, summary_status, summary_error)
                VALUES(?, ?, ?, ?, COALESCE((SELECT summary_status FROM documents_v2 WHERE username=? AND filename=?), NULL), COALESCE((SELECT summary_error FROM documents_v2 WHERE username=? AND filename=?), NULL))
                ON CONFLICT(username, filename) DO UPDATE SET
                    uploaded_ts_ms=excluded.uploaded_ts_ms,
                    size_bytes=excluded.size_bytes
                """,
                (u, fn, int(uploaded_ts_ms), int(size_bytes), u, fn, u, fn),
            )

    def set_document_summary(
        self,
        username: str,
        filename: str,
        summary_text: Optional[str],
        summary_ts_ms: Optional[int],
        status: str,
        error: Optional[str] = None,
    ) -> None:
        self.init()
        u = (username or "").strip()
        fn = (filename or "").strip()
        st = (status or "").strip() or "ready"
        if not u:
            raise ValueError("username is required")
        if not fn:
            raise ValueError("filename is required")
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE documents_v2
                SET summary_text=?, summary_ts_ms=?, summary_status=?, summary_error=?
                WHERE username=? AND filename=?
                """,
                (
                    summary_text,
                    int(summary_ts_ms) if isinstance(summary_ts_ms, int) else None,
                    st,
                    (error or "").strip() or None,
                    u,
                    fn,
                ),
            )

    def set_document_pipeline_stage(
        self,
        username: str,
        filename: str,
        stage: str,
        status: str,
        error: Optional[str] = None,
        updated_ts_ms: Optional[int] = None,
    ) -> None:
        self.init()
        u = (username or "").strip()
        fn = (filename or "").strip()
        stg = (stage or "").strip().lower()
        st = (status or "").strip() or "ready"
        if not u:
            raise ValueError("username is required")
        if not fn:
            raise ValueError("filename is required")
        col_map = {
            "parse": ("parse_status", "parse_error"),
            "index": ("index_status", "index_error"),
            "kg": ("kg_status", "kg_error"),
        }
        cols = col_map.get(stg)
        if not cols:
            raise ValueError("invalid stage")
        status_col, error_col = cols
        ts = updated_ts_ms if isinstance(updated_ts_ms, int) else _utc_ms()
        with self._connect() as conn:
            conn.execute(
                f"""
                UPDATE documents_v2
                SET {status_col}=?, {error_col}=?, pipeline_updated_ts_ms=?
                WHERE username=? AND filename=?
                """,
                (st, (error or "").strip() or None, int(ts), u, fn),
            )

    def delete_document(self, username: str, filename: str) -> None:
        self.init()
        u = (username or "").strip()
        fn = (filename or "").strip()
        if not u or not fn:
            return
        with self._connect() as conn:
            conn.execute("DELETE FROM documents_v2 WHERE username=? AND filename=?", (u, fn))

    def get_documents_by_filenames(self, username: str, filenames: List[str]) -> Dict[str, DocumentRow]:
        self.init()
        u = (username or "").strip()
        fns = [str(x).strip() for x in (filenames or []) if str(x).strip()]
        if not u or not fns:
            return {}
        placeholders = ",".join(["?"] * len(fns))
        sql = f"""
            SELECT filename, uploaded_ts_ms, size_bytes,
                   summary_text, summary_ts_ms, summary_status, summary_error,
                   parse_status, parse_error, index_status, index_error, kg_status, kg_error, pipeline_updated_ts_ms
            FROM documents_v2
            WHERE username = ? AND filename IN ({placeholders})
        """
        out: Dict[str, DocumentRow] = {}
        with self._connect() as conn:
            rows = conn.execute(sql, [u] + fns).fetchall()
        for r in rows:
            row = DocumentRow(
                filename=str(r["filename"]),
                uploaded_ts_ms=int(r["uploaded_ts_ms"]),
                size_bytes=int(r["size_bytes"]),
                summary_text=str(r["summary_text"]) if r["summary_text"] is not None else None,
                summary_ts_ms=int(r["summary_ts_ms"]) if r["summary_ts_ms"] is not None else None,
                summary_status=str(r["summary_status"]) if r["summary_status"] is not None else None,
                summary_error=str(r["summary_error"]) if r["summary_error"] is not None else None,
                parse_status=str(r["parse_status"]) if r["parse_status"] is not None else None,
                parse_error=str(r["parse_error"]) if r["parse_error"] is not None else None,
                index_status=str(r["index_status"]) if r["index_status"] is not None else None,
                index_error=str(r["index_error"]) if r["index_error"] is not None else None,
                kg_status=str(r["kg_status"]) if r["kg_status"] is not None else None,
                kg_error=str(r["kg_error"]) if r["kg_error"] is not None else None,
                pipeline_updated_ts_ms=int(r["pipeline_updated_ts_ms"]) if r["pipeline_updated_ts_ms"] is not None else None,
            )
            out[row.filename] = row
        return out

    def insert_event(self, username: str, event: str, payload: Optional[Dict[str, Any]] = None, ts_ms: Optional[int] = None) -> int:
        self.init()
        u = (username or "").strip()
        e = (event or "").strip()
        if not u:
            raise ValueError("username is required")
        if not e:
            raise ValueError("event is required")
        ts = ts_ms if isinstance(ts_ms, int) else _utc_ms()
        payload_json = None
        if isinstance(payload, dict):
            payload_json = json.dumps(payload, ensure_ascii=False)
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO events(username, event, ts_ms, payload_json) VALUES(?, ?, ?, ?)",
                (u, e, ts, payload_json),
            )
            return int(cur.lastrowid)

    def count_events(self, username: str, event: str, since_ms: Optional[int] = None, until_ms: Optional[int] = None) -> int:
        self.init()
        u = (username or "").strip()
        params: List[Any] = [u, event]
        where = ["username = ?", "event = ?"]
        if isinstance(since_ms, int):
            where.append("ts_ms >= ?")
            params.append(since_ms)
        if isinstance(until_ms, int):
            where.append("ts_ms < ?")
            params.append(until_ms)
        sql = f"SELECT COUNT(1) AS c FROM events WHERE {' AND '.join(where)}"
        with self._connect() as conn:
            row = conn.execute(sql, params).fetchone()
            return int(row["c"] if row and row["c"] is not None else 0)

    def iter_events(
        self,
        username: str,
        event: str,
        since_ms: Optional[int] = None,
        until_ms: Optional[int] = None,
        limit: int = 100000,
    ) -> Iterable[EventRow]:
        self.init()
        u = (username or "").strip()
        params: List[Any] = [u, event]
        where = ["username = ?", "event = ?"]
        if isinstance(since_ms, int):
            where.append("ts_ms >= ?")
            params.append(since_ms)
        if isinstance(until_ms, int):
            where.append("ts_ms < ?")
            params.append(until_ms)
        params.append(int(limit))
        sql = f"""
            SELECT id, event, ts_ms, payload_json
            FROM events
            WHERE {' AND '.join(where)}
            ORDER BY ts_ms ASC
            LIMIT ?
        """
        with self._connect() as conn:
            cur = conn.execute(sql, params)
            for r in cur.fetchall():
                yield EventRow(
                    id=int(r["id"]),
                    event=str(r["event"]),
                    ts_ms=int(r["ts_ms"]),
                    payload_json=str(r["payload_json"]) if r["payload_json"] is not None else None,
                )

    def create_flashcards(
        self,
        username: str,
        cards: List[Dict[str, Any]],
        ts_ms: Optional[int] = None,
    ) -> List[int]:
        self.init()
        u = (username or "").strip()
        if not u:
            raise ValueError("username is required")
        created_ts = ts_ms if isinstance(ts_ms, int) else _utc_ms()
        inserted: List[int] = []
        with self._connect() as conn:
            for c in cards:
                front = (c.get("front") or "").strip()
                back = (c.get("back") or "").strip()
                if not front or not back:
                    continue
                tags = c.get("tags")
                tags_json = json.dumps(tags, ensure_ascii=False) if isinstance(tags, list) else None
                fmt = c.get("format")
                format_json = json.dumps(fmt, ensure_ascii=False) if isinstance(fmt, dict) else None
                source_doc = (c.get("source_doc") or "").strip() or None
                source_chunk_id = (c.get("source_chunk_id") or "").strip() or None
                due_ts = int(created_ts)
                cur = conn.execute(
                    """
                    INSERT INTO flashcards(
                        username, front, back, tags_json, format_json, source_doc, source_chunk_id,
                        created_ts_ms, due_ts_ms, interval_days, ease_factor, reps, lapses, last_review_ts_ms
                    )
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        u,
                        front,
                        back,
                        tags_json,
                        format_json,
                        source_doc,
                        source_chunk_id,
                        int(created_ts),
                        int(due_ts),
                        0,
                        2.5,
                        0,
                        0,
                        None,
                    ),
                )
                inserted.append(int(cur.lastrowid))
        return inserted

    def list_due_flashcards(self, username: str, now_ms: Optional[int] = None, limit: int = 50) -> List[FlashcardRow]:
        self.init()
        u = (username or "").strip()
        if not u:
            return []
        nowv = now_ms if isinstance(now_ms, int) else _utc_ms()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    id, front, back, tags_json, format_json, source_doc, source_chunk_id,
                    created_ts_ms, due_ts_ms, interval_days, ease_factor, reps, lapses, last_review_ts_ms
                FROM flashcards
                WHERE username = ? AND due_ts_ms <= ?
                ORDER BY due_ts_ms ASC
                LIMIT ?
                """,
                (u, int(nowv), int(limit)),
            ).fetchall()
        out: List[FlashcardRow] = []
        for r in rows:
            out.append(
                FlashcardRow(
                    id=int(r["id"]),
                    front=str(r["front"]),
                    back=str(r["back"]),
                    tags_json=str(r["tags_json"]) if r["tags_json"] is not None else None,
                    format_json=str(r["format_json"]) if r["format_json"] is not None else None,
                    source_doc=str(r["source_doc"]) if r["source_doc"] is not None else None,
                    source_chunk_id=str(r["source_chunk_id"]) if r["source_chunk_id"] is not None else None,
                    created_ts_ms=int(r["created_ts_ms"]),
                    due_ts_ms=int(r["due_ts_ms"]),
                    interval_days=int(r["interval_days"]),
                    ease_factor=float(r["ease_factor"]),
                    reps=int(r["reps"]),
                    lapses=int(r["lapses"]),
                    last_review_ts_ms=int(r["last_review_ts_ms"]) if r["last_review_ts_ms"] is not None else None,
                )
            )
        return out

    def search_flashcards(self, username: str, q: str, limit: int = 50) -> List[FlashcardRow]:
        self.init()
        u = (username or "").strip()
        term = (q or "").strip()
        if not u or not term:
            return []
        like = f"%{term}%"
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    id, front, back, tags_json, format_json, source_doc, source_chunk_id,
                    created_ts_ms, due_ts_ms, interval_days, ease_factor, reps, lapses, last_review_ts_ms
                FROM flashcards
                WHERE username = ? AND (front LIKE ? OR back LIKE ?)
                ORDER BY created_ts_ms DESC
                LIMIT ?
                """,
                (u, like, like, int(limit)),
            ).fetchall()
        out: List[FlashcardRow] = []
        for r in rows:
            out.append(
                FlashcardRow(
                    id=int(r["id"]),
                    front=str(r["front"]),
                    back=str(r["back"]),
                    tags_json=str(r["tags_json"]) if r["tags_json"] is not None else None,
                    format_json=str(r["format_json"]) if r["format_json"] is not None else None,
                    source_doc=str(r["source_doc"]) if r["source_doc"] is not None else None,
                    source_chunk_id=str(r["source_chunk_id"]) if r["source_chunk_id"] is not None else None,
                    created_ts_ms=int(r["created_ts_ms"]),
                    due_ts_ms=int(r["due_ts_ms"]),
                    interval_days=int(r["interval_days"]),
                    ease_factor=float(r["ease_factor"]),
                    reps=int(r["reps"]),
                    lapses=int(r["lapses"]),
                    last_review_ts_ms=int(r["last_review_ts_ms"]) if r["last_review_ts_ms"] is not None else None,
                )
            )
        return out

    def get_flashcard_counts(self, username: str, now_ms: int, today_start_ms: int, tomorrow_start_ms: int, since_ms: int) -> Dict[str, Any]:
        self.init()
        with self._connect() as conn:
            total = conn.execute("SELECT COUNT(1) AS c FROM flashcards WHERE username = ?", (username,)).fetchone()
            due_today = conn.execute(
                "SELECT COUNT(1) AS c FROM flashcards WHERE username = ? AND due_ts_ms <= ? AND due_ts_ms < ?",
                (username, int(now_ms), int(tomorrow_start_ms)),
            ).fetchone()
            reviews_total = conn.execute(
                "SELECT COUNT(1) AS c FROM reviews WHERE username = ? AND ts_ms >= ? AND ts_ms < ?",
                (username, int(since_ms), int(now_ms)),
            ).fetchone()
            ok = conn.execute(
                "SELECT COUNT(1) AS c FROM reviews WHERE username = ? AND ts_ms >= ? AND ts_ms < ? AND grade >= 3",
                (username, int(since_ms), int(now_ms)),
            ).fetchone()
        reviews_c = int(reviews_total["c"] if reviews_total and reviews_total["c"] is not None else 0)
        ok_c = int(ok["c"] if ok and ok["c"] is not None else 0)
        acc = int(round((ok_c / reviews_c) * 100)) if reviews_c > 0 else 0
        return {
            "flashcards_total": int(total["c"] if total and total["c"] is not None else 0),
            "flashcards_due_today": int(due_today["c"] if due_today and due_today["c"] is not None else 0),
            "reviews_7d": reviews_c,
            "accuracy_7d": acc,
        }

    def apply_review(self, username: str, card_id: int, grade: int, ts_ms: Optional[int] = None) -> Optional[FlashcardRow]:
        self.init()
        u = (username or "").strip()
        if not u:
            return None
        now = ts_ms if isinstance(ts_ms, int) else _utc_ms()
        g = int(grade)
        if g < 0 or g > 5:
            raise ValueError("grade must be 0-5")
        with self._connect() as conn:
            card = conn.execute(
                """
                SELECT
                    id, front, back, tags_json, format_json, source_doc, source_chunk_id,
                    created_ts_ms, due_ts_ms, interval_days, ease_factor, reps, lapses, last_review_ts_ms
                FROM flashcards
                WHERE username = ? AND id = ?
                """,
                (u, int(card_id)),
            ).fetchone()
            if not card:
                return None

            interval_days = int(card["interval_days"])
            ease_factor = float(card["ease_factor"])
            reps = int(card["reps"])
            lapses = int(card["lapses"])

            if g < 3:
                reps = 0
                lapses += 1
                interval_days = 1
                ease_factor = max(1.3, ease_factor - 0.2)
            else:
                reps += 1
                if reps == 1:
                    interval_days = 1
                elif reps == 2:
                    interval_days = 6
                else:
                    interval_days = max(1, int(round(interval_days * ease_factor)))
                ease_factor = ease_factor + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02))
                ease_factor = min(2.8, max(1.3, ease_factor))

            due_ts_ms = int(now + interval_days * 86400 * 1000)

            conn.execute(
                "INSERT INTO reviews(username, card_id, ts_ms, grade) VALUES(?, ?, ?, ?)",
                (u, int(card_id), int(now), int(g)),
            )
            conn.execute(
                """
                UPDATE flashcards
                SET due_ts_ms = ?, interval_days = ?, ease_factor = ?, reps = ?, lapses = ?, last_review_ts_ms = ?
                WHERE username = ? AND id = ?
                """,
                (int(due_ts_ms), int(interval_days), float(ease_factor), int(reps), int(lapses), int(now), u, int(card_id)),
            )

            updated = conn.execute(
                """
                SELECT
                    id, front, back, tags_json, format_json, source_doc, source_chunk_id,
                    created_ts_ms, due_ts_ms, interval_days, ease_factor, reps, lapses, last_review_ts_ms
                FROM flashcards
                WHERE username = ? AND id = ?
                """,
                (u, int(card_id)),
            ).fetchone()

        return FlashcardRow(
            id=int(updated["id"]),
            front=str(updated["front"]),
            back=str(updated["back"]),
            tags_json=str(updated["tags_json"]) if updated["tags_json"] is not None else None,
            format_json=str(updated["format_json"]) if updated["format_json"] is not None else None,
            source_doc=str(updated["source_doc"]) if updated["source_doc"] is not None else None,
            source_chunk_id=str(updated["source_chunk_id"]) if updated["source_chunk_id"] is not None else None,
            created_ts_ms=int(updated["created_ts_ms"]),
            due_ts_ms=int(updated["due_ts_ms"]),
            interval_days=int(updated["interval_days"]),
            ease_factor=float(updated["ease_factor"]),
            reps=int(updated["reps"]),
            lapses=int(updated["lapses"]),
            last_review_ts_ms=int(updated["last_review_ts_ms"]) if updated["last_review_ts_ms"] is not None else None,
        )

    def list_flashcards(self, username: str, limit: int = 100, offset: int = 0) -> List[FlashcardRow]:
        self.init()
        u = (username or "").strip()
        if not u:
            return []
        lim = max(1, min(int(limit), 500))
        off = max(0, int(offset))
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    id, front, back, tags_json, format_json, source_doc, source_chunk_id,
                    created_ts_ms, due_ts_ms, interval_days, ease_factor, reps, lapses, last_review_ts_ms
                FROM flashcards
                WHERE username = ?
                ORDER BY created_ts_ms DESC
                LIMIT ? OFFSET ?
                """,
                (u, int(lim), int(off)),
            ).fetchall()
        out: List[FlashcardRow] = []
        for r in rows:
            out.append(
                FlashcardRow(
                    id=int(r["id"]),
                    front=str(r["front"]),
                    back=str(r["back"]),
                    tags_json=str(r["tags_json"]) if r["tags_json"] is not None else None,
                    format_json=str(r["format_json"]) if r["format_json"] is not None else None,
                    source_doc=str(r["source_doc"]) if r["source_doc"] is not None else None,
                    source_chunk_id=str(r["source_chunk_id"]) if r["source_chunk_id"] is not None else None,
                    created_ts_ms=int(r["created_ts_ms"]),
                    due_ts_ms=int(r["due_ts_ms"]),
                    interval_days=int(r["interval_days"]),
                    ease_factor=float(r["ease_factor"]),
                    reps=int(r["reps"]),
                    lapses=int(r["lapses"]),
                    last_review_ts_ms=int(r["last_review_ts_ms"]) if r["last_review_ts_ms"] is not None else None,
                )
            )
        return out

    def delete_flashcard(self, username: str, card_id: int) -> bool:
        self.init()
        u = (username or "").strip()
        if not u:
            return False
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM flashcards WHERE username = ? AND id = ?", (u, int(card_id)))
            return int(cur.rowcount or 0) > 0

    def cleanup_test_cards(self, username: str) -> int:
        self.init()
        u = (username or "").strip()
        if not u:
            return 0
        with self._connect() as conn:
            cur = conn.execute(
                """
                DELETE FROM flashcards
                WHERE username = ? AND ((front = 'Q1' AND back = 'A1') OR (front = 'Q2' AND back = 'A2'))
                """
                ,
                (u,),
            )
            return int(cur.rowcount or 0)

    def create_quiz(self, username: str, quiz: Dict[str, Any], config: Optional[Dict[str, Any]] = None, ts_ms: Optional[int] = None) -> int:
        self.init()
        u = (username or "").strip()
        if not u:
            raise ValueError("username is required")
        created_ts = ts_ms if isinstance(ts_ms, int) else _utc_ms()
        quiz_json = json.dumps(quiz, ensure_ascii=False)
        config_json = json.dumps(config, ensure_ascii=False) if isinstance(config, dict) else None
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO quizzes(username, created_ts_ms, config_json, quiz_json) VALUES(?, ?, ?, ?)",
                (u, int(created_ts), config_json, quiz_json),
            )
            return int(cur.lastrowid)

    def get_quiz(self, username: str, quiz_id: int) -> Optional[Dict[str, Any]]:
        self.init()
        u = (username or "").strip()
        if not u:
            return None
        with self._connect() as conn:
            row = conn.execute("SELECT quiz_json FROM quizzes WHERE username = ? AND id = ?", (u, int(quiz_id))).fetchone()
        if not row:
            return None
        try:
            v = json.loads(row["quiz_json"])
            return v if isinstance(v, dict) else None
        except Exception:
            return None

    def create_quiz_attempt(
        self,
        username: str,
        quiz_id: int,
        answers: Dict[str, Any],
        score: float,
        total: float,
        ts_ms: Optional[int] = None,
    ) -> int:
        self.init()
        u = (username or "").strip()
        if not u:
            raise ValueError("username is required")
        now = ts_ms if isinstance(ts_ms, int) else _utc_ms()
        answers_json = json.dumps(answers, ensure_ascii=False)
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO quiz_attempts(username, quiz_id, ts_ms, answers_json, score, total) VALUES(?, ?, ?, ?, ?, ?)",
                (u, int(quiz_id), int(now), answers_json, float(score), float(total)),
            )
            return int(cur.lastrowid)

    def list_quiz_history(self, username: str, limit: int = 20) -> List[Dict[str, Any]]:
        self.init()
        u = (username or "").strip()
        if not u:
            return []
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT a.id AS attempt_id, a.quiz_id AS quiz_id, a.ts_ms AS ts_ms, a.score AS score, a.total AS total
                FROM quiz_attempts a
                WHERE a.username = ?
                ORDER BY a.ts_ms DESC
                LIMIT ?
                """,
                (u, int(limit)),
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for r in rows:
            out.append(
                {
                    "attempt_id": int(r["attempt_id"]),
                    "quiz_id": int(r["quiz_id"]),
                    "ts_ms": int(r["ts_ms"]),
                    "score": float(r["score"]),
                    "total": float(r["total"]),
                }
            )
        return out

    def get_quiz_7d_stats(self, username: str, since_ms: int, now_ms: int) -> Dict[str, Any]:
        self.init()
        u = (username or "").strip()
        with self._connect() as conn:
            c = conn.execute(
                "SELECT COUNT(1) AS c FROM quiz_attempts WHERE username = ? AND ts_ms >= ? AND ts_ms < ?",
                (u, int(since_ms), int(now_ms)),
            ).fetchone()
            avg = conn.execute(
                "SELECT AVG(CASE WHEN total > 0 THEN (score * 1.0 / total) ELSE NULL END) AS a FROM quiz_attempts WHERE username = ? AND ts_ms >= ? AND ts_ms < ?",
                (u, int(since_ms), int(now_ms)),
            ).fetchone()
        count = int(c["c"] if c and c["c"] is not None else 0)
        avg_ratio = float(avg["a"]) if avg and avg["a"] is not None else 0.0
        return {"quizzes_7d": count, "avg_score_7d": int(round(avg_ratio * 100))}


learning_db = LearningDb()

