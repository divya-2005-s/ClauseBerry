"""Change detail, diff/comparison and version text endpoints."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Query

from pipeline.textnorm import inline_diff

from ..core.errors import AppError
from ..db.database import get_db, one, rows
from ..security.deps import CurrentUser, current_user
from ..services.analytics import parse_analysis

router = APIRouter(prefix="/api", tags=["changes"])


def _collapse(blocks: list[dict], context_lines: int = 2) -> list[dict]:
    """Trim long unchanged blocks to a few lines of context around edits."""
    out = []
    for i, b in enumerate(blocks):
        if b["type"] != "equal":
            out.append(b)
            continue
        lines = b["new"].split("\n")
        if len(lines) <= context_lines * 2 + 1:
            out.append(b)
            continue
        head = lines[:context_lines] if i > 0 else []
        tail = lines[-context_lines:] if i < len(blocks) - 1 else []
        if head:
            out.append({"type": "equal", "old": "\n".join(head), "new": "\n".join(head)})
        out.append({"type": "skip", "lines": len(lines) - len(head) - len(tail)})
        if tail:
            out.append({"type": "equal", "old": "\n".join(tail), "new": "\n".join(tail)})
    return out


def _version_meta(conn, vid: int) -> dict:
    v = one(conn, """SELECT v.id, v.version_date, v.version_datetime, v.word_count, v.source, v.source_ref,
                            v.retrieved_at, v.quality_flag, d.document_type, d.id AS document_id, a.name AS app_name,
                            a.slug AS app_slug FROM policy_versions v JOIN documents d ON d.id=v.document_id
                     JOIN apps a ON a.id=d.app_id WHERE v.id=?""", (vid,))
    if not v:
        raise AppError(404, "not_found", "Policy version not found.")
    return v


@router.get("/changes/{change_id}")
def change_detail(change_id: int, _: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    c = one(conn, """SELECT c.*, d.document_type, a.name AS app_name, a.slug AS app_slug FROM policy_changes c
                     JOIN documents d ON d.id=c.document_id JOIN apps a ON a.id=d.app_id WHERE c.id=?""", (change_id,))
    if not c:
        raise AppError(404, "not_found", "Change not found.")
    analyses = [parse_analysis(a) for a in rows(
        conn, "SELECT * FROM change_analysis WHERE change_id=? ORDER BY is_current DESC, id DESC", (change_id,))]
    current = next((a for a in analyses if a["is_current"]), None)
    ids = [r[0] for r in conn.execute("SELECT id FROM policy_changes WHERE document_id=? AND is_meaningful=1 "
                                      "ORDER BY change_date, id", (c["document_id"],))]
    idx = ids.index(change_id) if change_id in ids else -1
    return {"change": c, "analysis": current, "analyses": analyses,
            "from_version": _version_meta(conn, c["from_version_id"]),
            "to_version": _version_meta(conn, c["to_version_id"]),
            "previous_change_id": ids[idx - 1] if idx > 0 else None,
            "next_change_id": ids[idx + 1] if 0 <= idx < len(ids) - 1 else None}


@router.get("/changes/{change_id}/diff")
def change_diff(change_id: int, full: bool = False, _: CurrentUser = Depends(current_user),
                conn: sqlite3.Connection = Depends(get_db)):
    c = one(conn, "SELECT from_version_id, to_version_id FROM policy_changes WHERE id=?", (change_id,))
    if not c:
        raise AppError(404, "not_found", "Change not found.")
    return compare(c["from_version_id"], c["to_version_id"], full, _, conn)


@router.get("/compare")
def compare(from_version: int = Query(..., ge=1), to_version: int = Query(..., ge=1), full: bool = False,
            _: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    a, b = _version_meta(conn, from_version), _version_meta(conn, to_version)
    if a["document_id"] != b["document_id"]:
        raise AppError(400, "different_documents", "Both versions must belong to the same policy document.")
    old = conn.execute("SELECT text FROM policy_versions WHERE id=?", (from_version,)).fetchone()[0]
    new = conn.execute("SELECT text FROM policy_versions WHERE id=?", (to_version,)).fetchone()[0]
    blocks = inline_diff(old, new)
    stats = {"added": sum(1 for x in blocks if x["type"] == "added"),
             "removed": sum(1 for x in blocks if x["type"] == "removed"),
             "modified": sum(1 for x in blocks if x["type"] == "modified")}
    return {"from_version": a, "to_version": b, "stats": stats, "blocks": blocks if full else _collapse(blocks)}


@router.get("/versions/{version_id}")
def version_detail(version_id: int, _: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    meta = _version_meta(conn, version_id)
    meta["text"] = conn.execute("SELECT text FROM policy_versions WHERE id=?", (version_id,)).fetchone()[0]
    meta["ai_clauses"] = rows(conn, "SELECT kind, evidence FROM ai_clauses WHERE version_id=? ORDER BY id", (version_id,))
    return meta
