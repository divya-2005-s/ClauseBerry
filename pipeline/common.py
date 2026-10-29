"""Shared paths, database connection, migrations and run bookkeeping for the pipeline and backend."""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

ROOT = Path(__file__).resolve().parents[1]
DATASET_DIR = ROOT / "tos_radar_dataset"
MIGRATIONS_DIR = ROOT / "database" / "migrations"


def _load_dotenv() -> None:
    """Minimal .env loader (no extra dependency). Existing environment variables win."""
    for candidate in (ROOT / ".env", ROOT / "backend" / ".env"):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()

try:  # Use the OS certificate store (works behind corporate / antivirus TLS inspection).
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # pragma: no cover
    pass


def db_path() -> Path:
    return Path(os.environ.get("CLAUSEBERRY_DB_PATH", ROOT / "data" / "clauseberry.db"))


DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


def gemini_model() -> str:
    """Configured Gemini model; an empty GEMINI_MODEL (e.g. an unset CI variable) means the default."""
    return (os.environ.get("GEMINI_MODEL") or "").strip() or DEFAULT_GEMINI_MODEL


def chroma_path() -> Path:
    return Path(os.environ.get("CLAUSEBERRY_CHROMA_PATH", ROOT / "data" / "chroma"))


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_logger(name: str) -> logging.Logger:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return logging.getLogger(name)


def connect(path: Path | None = None) -> sqlite3.Connection:
    path = path or db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def migrate(conn: sqlite3.Connection) -> list[str]:
    """Apply database/migrations/*.sql in order, once each. Returns the newly applied names."""
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
    done = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
    applied = []
    for f in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if f.name in done:
            continue
        conn.executescript("BEGIN;\n" + f.read_text(encoding="utf-8") + "\nCOMMIT;")
        conn.execute("INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)", (f.name, utcnow()))
        conn.commit()
        applied.append(f.name)
    return applied


@contextmanager
def pipeline_run(conn: sqlite3.Connection, step: str) -> Iterator[dict]:
    """Record a pipeline step in pipeline_runs. Yields a mutable stats dict."""
    cur = conn.execute("INSERT INTO pipeline_runs(step, status, started_at) VALUES (?, 'running', ?)", (step, utcnow()))
    run_id = cur.lastrowid
    conn.commit()
    stats: dict = {}
    try:
        yield stats
    except BaseException as exc:
        conn.rollback()
        conn.execute("UPDATE pipeline_runs SET status='failed', finished_at=?, stats=?, error=? WHERE id=?",
                     (utcnow(), json.dumps(stats, default=str), f"{type(exc).__name__}: {exc}"[:2000], run_id))
        conn.commit()
        raise
    status = "partial" if stats.get("failures") else "success"
    conn.execute("UPDATE pipeline_runs SET status=?, finished_at=?, stats=? WHERE id=?",
                 (status, utcnow(), json.dumps(stats, default=str), run_id))
    conn.commit()
