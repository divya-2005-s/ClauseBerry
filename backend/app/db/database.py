"""SQLite access: one connection per request, plus small query helpers."""
from __future__ import annotations

import sqlite3
from typing import Any, Iterator

from pipeline.common import connect, migrate


def init_db() -> None:
    conn = connect()
    try:
        migrate(conn)
    finally:
        conn.close()


def get_db() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def rows(conn: sqlite3.Connection, sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def one(conn: sqlite3.Connection, sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
    r = conn.execute(sql, params).fetchone()
    return dict(r) if r else None


def scalar(conn: sqlite3.Connection, sql: str, params: tuple | dict = ()) -> Any:
    r = conn.execute(sql, params).fetchone()
    return r[0] if r else None
