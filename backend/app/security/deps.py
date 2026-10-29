"""FastAPI dependencies for authentication, CSRF protection and rate limiting."""
from __future__ import annotations

import hmac
import sqlite3
from dataclasses import dataclass

from fastapi import Depends, Request

from ..core.config import get_settings
from ..core.errors import AppError
from ..core.ratelimit import limiter
from ..db.database import get_db
from .sessions import load_session

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@dataclass
class CurrentUser:
    id: int
    email: str
    name: str
    plan: str
    theme: str
    email_verified: bool
    created_at: str
    session_id: int
    csrf_token: str


def client_ip(request: Request) -> str:
    """Client address for per-IP rate limits.

    X-Forwarded-For is ignored unless TRUSTED_PROXY_HOPS > 0. With N trusted proxies in front of the API, the
    client is the N-th entry from the right: entries further left were supplied by the client and can be forged.
    """
    peer = request.client.host if request.client else "unknown"
    hops = get_settings().trusted_proxy_hops
    if hops <= 0:
        return peer
    chain = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    return chain[-hops] if len(chain) >= hops else (chain[0] if chain else peer)


def optional_user(request: Request, conn: sqlite3.Connection = Depends(get_db)) -> CurrentUser | None:
    row = load_session(conn, request.cookies.get(get_settings().session_cookie_name))
    if not row:
        return None
    user = CurrentUser(id=row["id"], email=row["email"], name=row["name"], plan=row["plan"], theme=row["theme"],
                       email_verified=row["email_verified_at"] is not None, created_at=row["created_at"],
                       session_id=row["session_id"], csrf_token=row["csrf_token"])
    if request.method in UNSAFE_METHODS:
        sent = request.headers.get("x-csrf-token", "")
        if not hmac.compare_digest(sent, user.csrf_token):
            raise AppError(403, "csrf_failed", "Your session security token is missing or invalid. Refresh and try again.")
    return user


def current_user(user: CurrentUser | None = Depends(optional_user)) -> CurrentUser:
    if user is None:
        raise AppError(401, "unauthorized", "Please sign in to continue.")
    return user


def auth_rate_limit(request: Request) -> None:
    limiter.check(f"auth:{client_ip(request)}", get_settings().rate_limit_auth_per_minute, 60)


def ask_rate_limit(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    limiter.check(f"ask:{user.id}", get_settings().rate_limit_ask_per_10min, 600)
    return user
