"""Outgoing email via Resend, or a logged local outbox when no provider is configured.

An email is only reported as sent when Resend returns 2xx with a message id.
"""
from __future__ import annotations

import logging
import sqlite3

import httpx

from ..core.config import get_settings

log = logging.getLogger("clauseberry.email")


def send_email(conn: sqlite3.Connection, to: str, subject: str, body: str, user_id: int | None = None) -> str:
    """Returns the outbox status: 'sent', 'failed' or 'logged' (no provider configured)."""
    s = get_settings()
    status, provider_id, error = "logged", None, None
    if s.resend_api_key:
        try:
            r = httpx.post("https://api.resend.com/emails", timeout=15,
                           headers={"Authorization": f"Bearer {s.resend_api_key}"},
                           json={"from": s.email_from, "to": [to], "subject": subject, "text": body})
            message_id = r.json().get("id") if r.status_code < 300 else None
            if message_id:
                status, provider_id = "sent", message_id
            else:
                status, error = "failed", f"HTTP {r.status_code}: {r.text[:300]}"
        except (httpx.HTTPError, ValueError) as exc:  # ValueError: 2xx without a JSON body
            status, error = "failed", f"{type(exc).__name__}: {str(exc)[:300]}"
    elif s.is_dev:
        # Local development only: print the message so verification/reset links can be used without a provider.
        log.info("[email not sent: provider not configured] to=%s subject=%s\n%s", to, subject, body)
    else:
        # Never log bodies outside development: they can contain password-reset and verification tokens.
        log.warning("Email not sent (no provider configured): to=%s subject=%s", to, subject)
    conn.execute("INSERT INTO email_outbox(user_id, to_email, subject, body_text, status, provider_id, error) "
                 "VALUES (?,?,?,?,?,?,?)", (user_id, to, subject, body, status, provider_id, error))
    conn.commit()
    if status == "failed":
        log.warning("Email to %s failed: %s", to, error)
    return status
