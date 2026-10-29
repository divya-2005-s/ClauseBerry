"""Server-side sessions.

The browser gets a random 256-bit token in an HttpOnly cookie; only its SHA-256 is stored. Each session
has its own CSRF token, mirrored in a readable cookie, which must be echoed in `X-CSRF-Token` for
state-changing requests (double-submit, checked against the server-side value).
"""
from __future__ import annotations

import hashlib
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import Response

from ..core.config import get_settings


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def create_session(conn: sqlite3.Connection, response: Response, user_id: int, remember: bool,
                   user_agent: str | None) -> None:
    s = get_settings()
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    lifetime = timedelta(days=s.session_days_remember) if remember else timedelta(hours=s.session_hours_default)
    conn.execute("INSERT INTO sessions(user_id, token_hash, csrf_token, created_at, expires_at, user_agent) "
                 "VALUES (?,?,?,?,?,?)", (user_id, _hash(token), csrf, _iso(now), _iso(now + lifetime),
                                          (user_agent or "")[:300]))
    # Opportunistic cleanup of expired sessions.
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (_iso(now),))
    conn.commit()
    max_age = int(lifetime.total_seconds()) if remember else None
    response.set_cookie(s.session_cookie_name, token, max_age=max_age, httponly=True, secure=s.secure_cookies,
                        samesite="lax", path="/")
    response.set_cookie(s.csrf_cookie_name, csrf, max_age=max_age, httponly=False, secure=s.secure_cookies,
                        samesite="lax", path="/")


def load_session(conn: sqlite3.Connection, token: str | None) -> sqlite3.Row | None:
    if not token:
        return None
    return conn.execute(
        """SELECT s.id AS session_id, s.csrf_token, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?""", (_hash(token), _iso(datetime.now(timezone.utc)))).fetchone()


def destroy_session(conn: sqlite3.Connection, response: Response, token: str | None) -> None:
    s = get_settings()
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash(token),))
        conn.commit()
    response.delete_cookie(s.session_cookie_name, path="/")
    response.delete_cookie(s.csrf_cookie_name, path="/")


def destroy_all_sessions(conn: sqlite3.Connection, user_id: int, except_session_id: int | None = None) -> None:
    conn.execute("DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?", (user_id, except_session_id))
    conn.commit()


def new_email_token(conn: sqlite3.Connection, user_id: int, purpose: str, hours: int) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute("UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL",
                 (_iso(datetime.now(timezone.utc)), user_id, purpose))
    conn.execute("INSERT INTO email_tokens(user_id, purpose, token_hash, expires_at) VALUES (?,?,?,?)",
                 (user_id, purpose, _hash(token), _iso(datetime.now(timezone.utc) + timedelta(hours=hours))))
    conn.commit()
    return token


def consume_email_token(conn: sqlite3.Connection, token: str, purpose: str) -> int | None:
    now = _iso(datetime.now(timezone.utc))
    row = conn.execute("SELECT id, user_id FROM email_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL "
                       "AND expires_at > ?", (_hash(token), purpose, now)).fetchone()
    if not row:
        return None
    conn.execute("UPDATE email_tokens SET used_at = ? WHERE id = ?", (now, row["id"]))
    return row["user_id"]
