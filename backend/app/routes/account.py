"""Profile, followed apps, alerts, notification preferences and account deletion."""
from __future__ import annotations

import math
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field

from ..core.config import get_settings
from ..core.errors import AppError
from ..db.database import get_db, one, rows, scalar
from ..schemas.auth import DeleteAccountIn, ProfileUpdateIn
from ..security.deps import CurrentUser, current_user
from ..security.passwords import verify_password
from ..security.sessions import destroy_session
from ..services.analytics import parse_analysis
from .auth import user_out

router = APIRouter(prefix="/api", tags=["account"])

BACKFILL_DAYS = 180


@router.patch("/me")
def update_profile(body: ProfileUpdateIn, user: CurrentUser = Depends(current_user),
                   conn: sqlite3.Connection = Depends(get_db)):
    if body.name is not None:
        conn.execute("UPDATE users SET name=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
                     (" ".join(body.name.split()), user.id))
    if body.theme is not None:
        conn.execute("UPDATE users SET theme=? WHERE id=?", (body.theme, user.id))
    conn.commit()
    return user_out(one(conn, "SELECT * FROM users WHERE id=?", (user.id,)))


@router.post("/me/delete", status_code=204)
def delete_account(body: DeleteAccountIn, request: Request, response: Response,
                   user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    row = one(conn, "SELECT password_hash FROM users WHERE id=?", (user.id,))
    if not verify_password(row["password_hash"], body.password):
        raise AppError(400, "invalid_password", "That password is incorrect.")
    destroy_session(conn, response, request.cookies.get(get_settings().session_cookie_name))
    # Cascades remove sessions, follows, alerts, preferences, chats and tokens; outbox rows are detached.
    conn.execute("DELETE FROM users WHERE id=?", (user.id,))
    conn.commit()
    response.status_code = 204
    return response


# ------------------------------------------------------------------ follows
@router.get("/me/follows")
def list_follows(user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    items = rows(conn, """SELECT a.id, a.slug, a.name, a.category, f.created_at AS followed_at,
                                 (SELECT COUNT(*) FROM alerts al JOIN policy_changes c ON c.id=al.change_id
                                    JOIN documents d ON d.id=c.document_id
                                  WHERE al.user_id=f.user_id AND d.app_id=a.id AND al.read_at IS NULL) AS unread_alerts
                          FROM follows f JOIN apps a ON a.id=f.app_id WHERE f.user_id=? ORDER BY a.name""", (user.id,))
    limit = None if user.plan != "free" else get_settings().free_plan_follow_limit
    return {"items": items, "limit": limit, "plan": user.plan}


@router.put("/me/follows/{slug}", status_code=201)
def follow(slug: str, user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    app = one(conn, "SELECT id, name FROM apps WHERE slug=?", (slug,))
    if not app:
        raise AppError(404, "not_found", "App not found.")
    if one(conn, "SELECT 1 FROM follows WHERE user_id=? AND app_id=?", (user.id, app["id"])):
        return {"following": True, "backfilled_alerts": 0}
    limit = get_settings().free_plan_follow_limit
    count = scalar(conn, "SELECT COUNT(*) FROM follows WHERE user_id=?", (user.id,))
    if user.plan == "free" and count >= limit:
        raise AppError(403, "plan_limit", f"The Free plan follows up to {limit} apps. Unfollow one, or see Pro.")
    conn.execute("INSERT INTO follows(user_id, app_id) VALUES (?,?)", (user.id, app["id"]))
    # Seed the alert feed with this app's recent meaningful changes so the user has context.
    cur = conn.execute(f"""INSERT OR IGNORE INTO alerts(user_id, change_id, origin)
                           SELECT ?, c.id, 'backfill' FROM policy_changes c JOIN documents d ON d.id=c.document_id
                           WHERE d.app_id=? AND c.is_meaningful=1 AND c.change_date >= date('now','-{BACKFILL_DAYS} days')""",
                       (user.id, app["id"]))
    conn.commit()
    return {"following": True, "backfilled_alerts": cur.rowcount}


@router.delete("/me/follows/{slug}", status_code=204)
def unfollow(slug: str, user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    app = one(conn, "SELECT id FROM apps WHERE slug=?", (slug,))
    if not app:
        raise AppError(404, "not_found", "App not found.")
    conn.execute("DELETE FROM follows WHERE user_id=? AND app_id=?", (user.id, app["id"]))
    conn.commit()


# ------------------------------------------------------------------ alerts
@router.get("/alerts")
def list_alerts(user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db),
                status: Literal["all", "unread", "read"] = "all", min_risk: int | None = Query(None, ge=1, le=5),
                app: str | None = Query(None, max_length=60),
                page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    where, params = ["al.user_id = ?"], [user.id]
    if status == "unread":
        where.append("al.read_at IS NULL")
    elif status == "read":
        where.append("al.read_at IS NOT NULL")
    if min_risk:
        where.append("ca.risk_score >= ?"); params.append(min_risk)
    if app:
        where.append("a.slug = ?"); params.append(app)
    base = f"""FROM alerts al JOIN policy_changes c ON c.id=al.change_id JOIN documents d ON d.id=c.document_id
               JOIN apps a ON a.id=d.app_id LEFT JOIN change_analysis ca ON ca.change_id=c.id AND ca.is_current=1
               WHERE {' AND '.join(where)}"""
    total = conn.execute(f"SELECT COUNT(*) {base}", params).fetchone()[0]
    items = rows(conn, f"""SELECT al.id, al.origin, al.read_at, al.emailed_at, al.created_at, c.id AS change_id,
                                  c.change_date, c.to_version_id, d.document_type, a.name AS app_name, a.slug AS app_slug,
                                  ca.summary, ca.category, ca.risk_score, ca.risk_level, ca.ai_training_mentioned,
                                  ca.analyzer
                           {base} ORDER BY c.change_date DESC, al.id DESC LIMIT ? OFFSET ?""",
                   params + [page_size, (page - 1) * page_size])
    unread = scalar(conn, "SELECT COUNT(*) FROM alerts WHERE user_id=? AND read_at IS NULL", (user.id,))
    return {"items": [parse_analysis(i) for i in items], "total": total, "unread": unread, "page": page,
            "pages": max(1, math.ceil(total / page_size))}


@router.get("/alerts/unread-count")
def unread_count(user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return {"unread": scalar(conn, "SELECT COUNT(*) FROM alerts WHERE user_id=? AND read_at IS NULL", (user.id,))}


class ReadIn(BaseModel):
    read: bool = True


@router.post("/alerts/{alert_id}/read")
def mark_read(alert_id: int, body: ReadIn, user: CurrentUser = Depends(current_user),
              conn: sqlite3.Connection = Depends(get_db)):
    cur = conn.execute("UPDATE alerts SET read_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') END "
                       "WHERE id=? AND user_id=?", (int(body.read), alert_id, user.id))
    conn.commit()
    if not cur.rowcount:
        raise AppError(404, "not_found", "Alert not found.")
    return {"ok": True}


@router.post("/alerts/read-all")
def mark_all_read(user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    cur = conn.execute("UPDATE alerts SET read_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE user_id=? AND read_at IS NULL",
                       (user.id,))
    conn.commit()
    return {"updated": cur.rowcount}


# ------------------------------------------------------------------ preferences
class PrefsIn(BaseModel):
    email_enabled: bool
    min_risk_score: int = Field(ge=1, le=5)
    frequency: Literal["instant", "daily", "weekly"]
    ai_training_only: bool


@router.get("/me/notification-preferences")
def get_prefs(user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    conn.execute("INSERT OR IGNORE INTO notification_preferences(user_id) VALUES (?)", (user.id,))
    conn.commit()
    p = one(conn, "SELECT * FROM notification_preferences WHERE user_id=?", (user.id,))
    last = one(conn, "SELECT status, created_at FROM email_outbox WHERE user_id=? ORDER BY id DESC LIMIT 1", (user.id,))
    return {**p, "email_enabled": bool(p["email_enabled"]), "ai_training_only": bool(p["ai_training_only"]),
            "email_configured": get_settings().email_configured, "email_verified": user.email_verified,
            "last_email": last}


@router.put("/me/notification-preferences")
def put_prefs(body: PrefsIn, user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    conn.execute("""INSERT INTO notification_preferences(user_id, email_enabled, min_risk_score, frequency, ai_training_only)
                    VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email_enabled=excluded.email_enabled,
                    min_risk_score=excluded.min_risk_score, frequency=excluded.frequency,
                    ai_training_only=excluded.ai_training_only""",
                 (user.id, int(body.email_enabled), body.min_risk_score, body.frequency, int(body.ai_training_only)))
    conn.commit()
    return get_prefs(user, conn)


class UpgradeIn(BaseModel):
    plan: Literal["pro", "team"]


@router.post("/me/upgrade-interest")
def upgrade_interest(body: UpgradeIn, user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    conn.execute("INSERT OR IGNORE INTO upgrade_interest(user_id, plan) VALUES (?,?)", (user.id, body.plan))
    conn.commit()
    return {"recorded": True, "billing_available": False,
            "message": "Billing isn't available yet. We've noted your interest; your plan has not changed."}
