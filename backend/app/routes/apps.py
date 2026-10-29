"""Application directory and detail endpoints."""
from __future__ import annotations

import math
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, Query

from ..core.errors import AppError
from ..db.database import get_db, one, rows
from ..security.deps import CurrentUser, current_user
from ..services.analytics import ai_status_by_app, app_directory, parse_analysis
from ..services.monitoring import app_status

router = APIRouter(prefix="/api/apps", tags=["apps"])

RISK_BUCKETS = {"low": (1, 2), "medium": (3, 3), "high": (4, 5)}


@router.get("")
def list_apps(user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db),
              q: str | None = Query(None, max_length=80), category: str | None = Query(None, max_length=60),
              risk: Literal["low", "medium", "high"] | None = None,
              ai: Literal["explicit_training", "any", "none"] | None = None,
              following: bool | None = None,
              sort: Literal["name", "risk", "changes", "latest"] = "name",
              page: int = Query(1, ge=1), page_size: int = Query(24, ge=1, le=100)):
    items = app_directory(conn, user.id)
    if q:
        ql = q.lower()
        items = [a for a in items if ql in a["name"].lower() or ql in (a["category"] or "").lower()]
    if category:
        items = [a for a in items if a["category"] == category]
    if risk:
        lo, hi = RISK_BUCKETS[risk]
        items = [a for a in items if a["latest_risk_score"] is not None and lo <= a["latest_risk_score"] <= hi]
    if ai == "explicit_training":
        items = [a for a in items if a["ai_status"]["status"] == "explicit_training"]
    elif ai == "any":
        items = [a for a in items if a["ai_status"]["status"] != "none"]
    elif ai == "none":
        items = [a for a in items if a["ai_status"]["status"] == "none"]
    if following is not None:
        items = [a for a in items if a["following"] == following]
    key = {"name": lambda a: a["name"].lower(),
           "risk": lambda a: (-(a["avg_risk_score"] or 0), a["name"].lower()),
           "changes": lambda a: (-a["meaningful_changes"], a["name"].lower()),
           "latest": lambda a: (a["latest_policy_date"] or "",)}[sort]
    items.sort(key=key, reverse=(sort == "latest"))
    total = len(items)
    start = (page - 1) * page_size
    categories = sorted({r["category"] for r in rows(conn, "SELECT DISTINCT category FROM apps")})
    return {"items": items[start:start + page_size], "total": total, "page": page, "page_size": page_size,
            "pages": max(1, math.ceil(total / page_size)), "categories": categories}


def _app(conn: sqlite3.Connection, slug: str) -> dict:
    app = one(conn, "SELECT * FROM apps WHERE slug = ?", (slug,))
    if not app:
        raise AppError(404, "not_found", "We don't track an app with that name.")
    return app


@router.get("/{slug}")
def app_detail(slug: str, user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    app = _app(conn, slug)
    docs = rows(conn, """
        SELECT d.id, d.document_type, d.slug, d.source_url,
               (SELECT COUNT(*) FROM policy_versions v WHERE v.document_id=d.id) AS versions,
               (SELECT COUNT(*) FROM policy_versions v WHERE v.document_id=d.id AND v.quality_flag!='ok') AS flagged_versions,
               (SELECT MIN(version_date) FROM policy_versions v WHERE v.document_id=d.id) AS coverage_start,
               (SELECT COUNT(*) FROM policy_changes c WHERE c.document_id=d.id AND c.is_meaningful=1) AS meaningful_changes,
               (SELECT COUNT(*) FROM policy_changes c WHERE c.document_id=d.id) AS raw_changes
        FROM documents d WHERE d.app_id = ? ORDER BY d.document_type""", (app["id"],))
    latest = {r["document_id"]: r for r in rows(conn, """SELECT id, document_id, version_date, word_count, source
                                                          FROM v_latest_version WHERE app_id = ?""", (app["id"],))}
    for d in docs:
        d["latest_version"] = latest.get(d["id"])
    latest_change = one(conn, """
        SELECT ca.*, c.id AS change_id, c.change_date, d.document_type FROM policy_changes c JOIN documents d ON d.id=c.document_id
        JOIN change_analysis ca ON ca.change_id=c.id AND ca.is_current=1
        WHERE d.app_id=? AND c.is_meaningful=1 ORDER BY c.change_date DESC, c.id DESC LIMIT 1""", (app["id"],))
    cat_dist = rows(conn, """SELECT category, COUNT(*) AS changes, ROUND(AVG(risk_score),2) AS avg_risk FROM v_changes
                             WHERE app_id=? AND is_meaningful=1 AND category IS NOT NULL GROUP BY category
                             ORDER BY changes DESC""", (app["id"],))
    risk_dist = rows(conn, """SELECT risk_score, COUNT(*) AS changes FROM v_changes WHERE app_id=? AND is_meaningful=1
                              AND risk_score IS NOT NULL GROUP BY risk_score""", (app["id"],))
    timeline = rows(conn, """SELECT change_date, document_type, risk_score, category, change_id FROM v_changes
                             WHERE app_id=? AND is_meaningful=1 ORDER BY change_date""", (app["id"],))
    length = rows(conn, """SELECT v.version_date, d.document_type, v.word_count FROM policy_versions v
                           JOIN documents d ON d.id=v.document_id WHERE d.app_id=? AND v.quality_flag='ok'
                           ORDER BY v.version_datetime""", (app["id"],))
    following = one(conn, "SELECT 1 FROM follows WHERE user_id=? AND app_id=?", (user.id, app["id"])) is not None
    stats = one(conn, """SELECT COUNT(*) AS meaningful_changes, ROUND(AVG(risk_score),2) AS avg_risk,
                                SUM(risk_score>=4) AS high_risk, SUM(ai_training_mentioned) AS ai_training_changes
                         FROM v_changes WHERE app_id=? AND is_meaningful=1""", (app["id"],))
    return {"app": app, "documents": docs, "latest_change": parse_analysis(latest_change), "stats": stats,
            "category_distribution": cat_dist, "risk_distribution": risk_dist, "timeline": timeline,
            "length_history": length, "ai_status": ai_status_by_app(conn).get(app["id"], {"status": "none"}),
            "following": following, "monitoring": app_status(conn, slug)}


@router.get("/{slug}/changes")
def app_changes(slug: str, _: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db),
                document_type: Literal["Privacy Policy", "Terms of Service"] | None = None,
                date_from: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
                date_to: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
                q: str | None = Query(None, max_length=100), min_risk: int | None = Query(None, ge=1, le=5),
                include_noise: bool = False, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    app = _app(conn, slug)
    where, params = ["d.app_id = ?"], [app["id"]]
    if not include_noise:
        where.append("c.is_meaningful = 1")
    if document_type:
        where.append("d.document_type = ?"); params.append(document_type)
    if date_from:
        where.append("c.change_date >= ?"); params.append(date_from)
    if date_to:
        where.append("c.change_date <= ?"); params.append(date_to)
    if min_risk:
        where.append("ca.risk_score >= ?"); params.append(min_risk)
    if q:
        where.append("(c.added_text LIKE ? OR c.removed_text LIKE ? OR ca.summary LIKE ?)")
        params += [f"%{q}%"] * 3
    w = " AND ".join(where)
    base = f"""FROM policy_changes c JOIN documents d ON d.id=c.document_id
               LEFT JOIN change_analysis ca ON ca.change_id=c.id AND ca.is_current=1 WHERE {w}"""
    total = conn.execute(f"SELECT COUNT(*) {base}", params).fetchone()[0]
    items = rows(conn, f"""SELECT c.id, c.change_date, c.previous_date, d.document_type, c.words_added, c.words_removed,
                                  c.words_before, c.words_after, c.is_meaningful, c.noise_reason, c.from_version_id,
                                  c.to_version_id, ca.summary, ca.category, ca.risk_score, ca.risk_level,
                                  ca.ai_training_mentioned, ca.change_direction, ca.analyzer, ca.model
                           {base} ORDER BY c.change_date DESC, c.id DESC LIMIT ? OFFSET ?""",
                 params + [page_size, (page - 1) * page_size])
    return {"items": [parse_analysis(i) for i in items], "total": total, "page": page, "page_size": page_size,
            "pages": max(1, math.ceil(total / page_size))}


@router.get("/{slug}/versions")
def app_versions(slug: str, _: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db),
                 document_type: Literal["Privacy Policy", "Terms of Service"] | None = None):
    app = _app(conn, slug)
    sql = """SELECT v.id, v.version_date, v.version_datetime, v.word_count, v.source, v.quality_flag, d.document_type,
                    (SELECT COUNT(*) FROM ai_clauses ac WHERE ac.version_id=v.id AND ac.kind='explicit_training') AS training_clauses
             FROM policy_versions v JOIN documents d ON d.id=v.document_id WHERE d.app_id=?"""
    params: list = [app["id"]]
    if document_type:
        sql += " AND d.document_type=?"; params.append(document_type)
    return {"items": rows(conn, sql + " ORDER BY v.version_datetime DESC, v.seq DESC", params)}
