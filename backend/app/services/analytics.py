"""Read-side queries for the dashboard, directory, app detail and AI-training tracker.

KPI definitions (also in docs/architecture.md):
- apps_tracked:        rows in `apps`.
- policy_versions:     stored versions (all sources, including flagged captures).
- meaningful_changes:  policy_changes.is_meaningful = 1 in the date range (by change_date).
- high_risk_changes:   meaningful changes whose current analysis has risk_score >= 4.
- avg_risk_score:      mean current risk_score over meaningful analysed changes in range.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict

from pipeline.taxonomy import AI_KINDS, CATEGORIES, RISK_LEVELS, RISK_RUBRIC

from ..db.database import one, rows, scalar

AI_KIND_ORDER = ["explicit_training", "ai_provider_sharing", "automated_processing", "general_ai"]


def _range_sql(col: str, date_from: str | None, date_to: str | None) -> tuple[str, list]:
    sql, params = "", []
    if date_from:
        sql += f" AND {col} >= ?"; params.append(date_from)
    if date_to:
        sql += f" AND {col} <= ?"; params.append(date_to)
    return sql, params


def coverage(conn: sqlite3.Connection) -> dict:
    cov = one(conn, "SELECT MIN(version_date) AS first, MAX(version_date) AS last, COUNT(*) AS versions FROM policy_versions")
    runs = rows(conn, """SELECT step, status, finished_at, stats FROM pipeline_runs p
                         WHERE id = (SELECT MAX(id) FROM pipeline_runs WHERE step = p.step AND status IN ('success','partial'))""")
    fetched = scalar(conn, "SELECT MAX(retrieved_at) FROM policy_versions WHERE source='fetched'")
    analyzers = {r["analyzer"]: r["n"] for r in rows(
        conn, "SELECT analyzer, COUNT(*) AS n FROM change_analysis WHERE is_current=1 GROUP BY analyzer")}
    return {"first_version_date": cov["first"], "last_version_date": cov["last"], "versions": cov["versions"],
            "last_fetch_at": fetched, "analyzers": analyzers,
            "pipeline": {r["step"]: {"status": r["status"], "finished_at": r["finished_at"]} for r in runs}}


def kpis(conn: sqlite3.Connection, date_from: str | None = None, date_to: str | None = None) -> dict:
    rng, p = _range_sql("change_date", date_from, date_to)
    vr, vp = _range_sql("version_date", date_from, date_to)
    k = one(conn, f"""SELECT COUNT(*) AS meaningful_changes, SUM(risk_score >= 4) AS high_risk_changes,
                             ROUND(AVG(risk_score), 2) AS avg_risk_score, SUM(ai_training_mentioned) AS ai_training_changes
                      FROM v_changes WHERE is_meaningful = 1 {rng}""", p)
    return {
        "apps_tracked": scalar(conn, "SELECT COUNT(*) FROM apps"),
        "policy_versions": scalar(conn, f"SELECT COUNT(*) FROM policy_versions WHERE 1=1 {vr}", vp),
        "raw_changes": scalar(conn, f"SELECT COUNT(*) FROM policy_changes WHERE 1=1 {rng}", p),
        "meaningful_changes": k["meaningful_changes"] or 0,
        "high_risk_changes": k["high_risk_changes"] or 0,
        "avg_risk_score": k["avg_risk_score"],
        "ai_training_changes": k["ai_training_changes"] or 0,
    }


def dashboard(conn: sqlite3.Connection, date_from: str | None, date_to: str | None) -> dict:
    rng, p = _range_sql("change_date", date_from, date_to)
    timeline = rows(conn, f"""
        SELECT substr(change_date,1,4) || '-Q' || ((CAST(substr(change_date,6,2) AS INTEGER)+2)/3) AS period,
               COUNT(*) AS changes, SUM(risk_score >= 4) AS high_risk,
               SUM(risk_score = 3) AS medium_risk, SUM(risk_score <= 2) AS low_risk
        FROM v_changes WHERE is_meaningful = 1 {rng} GROUP BY period ORDER BY period""", p)
    risk_dist = {r["risk_score"]: r["n"] for r in rows(conn, f"""
        SELECT risk_score, COUNT(*) AS n FROM v_changes WHERE is_meaningful=1 AND risk_score IS NOT NULL {rng}
        GROUP BY risk_score""", p)}
    categories = rows(conn, f"""
        SELECT category, COUNT(*) AS changes, ROUND(AVG(risk_score),2) AS avg_risk FROM v_changes
        WHERE is_meaningful=1 AND category IS NOT NULL {rng} GROUP BY category ORDER BY changes DESC""", p)
    rankings = rows(conn, f"""
        SELECT app_name, app_slug, app_category, COUNT(*) AS changes, ROUND(AVG(risk_score),2) AS avg_risk,
               SUM(risk_score >= 4) AS high_risk, MAX(risk_score) AS max_risk
        FROM v_changes WHERE is_meaningful=1 AND risk_score IS NOT NULL {rng}
        GROUP BY app_id ORDER BY high_risk DESC, avg_risk DESC LIMIT 12""", p)
    heat = rows(conn, f"""SELECT app_name, app_slug, category, COUNT(*) AS changes FROM v_changes
                          WHERE is_meaningful=1 AND category IS NOT NULL {rng} GROUP BY app_id, category""", p)
    vr, vp = _range_sql("version_date", date_from, date_to)
    ai_timeline = rows(conn, f"""
        SELECT substr(version_date,1,4) || '-Q' || ((CAST(substr(version_date,6,2) AS INTEGER)+2)/3) AS period,
               COUNT(DISTINCT CASE WHEN kind='explicit_training' THEN app_id END) AS explicit_training,
               COUNT(DISTINCT CASE WHEN kind='ai_provider_sharing' THEN app_id END) AS ai_provider_sharing,
               COUNT(DISTINCT CASE WHEN kind IN ('general_ai','automated_processing') THEN app_id END) AS any_ai
        FROM v_ai_clause_versions WHERE 1=1 {vr} GROUP BY period ORDER BY period""", vp)
    qr, qp = _range_sql("quarter", _quarter(date_from), _quarter(date_to))
    length = rows(conn, f"""
        SELECT quarter AS period,
               CAST(AVG(CASE WHEN document_type='Privacy Policy' THEN word_count END) AS INTEGER) AS privacy_policy,
               CAST(AVG(CASE WHEN document_type='Terms of Service' THEN word_count END) AS INTEGER) AS terms_of_service,
               COUNT(DISTINCT document_id) AS documents
        FROM v_policy_length WHERE 1=1 {qr} GROUP BY quarter ORDER BY quarter""", qp)
    return {
        "kpis": kpis(conn, date_from, date_to),
        "timeline": timeline,
        "risk_distribution": [{"risk_score": s, "risk_level": RISK_LEVELS[s], "changes": risk_dist.get(s, 0)} for s in range(1, 6)],
        "categories": [{**c, "label": CATEGORIES.get(c["category"], c["category"])} for c in categories],
        "rankings": rankings,
        "heatmap": {"apps": sorted({h["app_name"] for h in heat}), "categories": list(CATEGORIES),
                    "category_labels": CATEGORIES, "cells": heat},
        "ai_timeline": ai_timeline,
        "policy_length": length,
        "coverage": coverage(conn),
    }


def _quarter(d: str | None) -> str | None:
    if not d:
        return None
    return f"{d[:4]}-Q{(int(d[5:7]) + 2) // 3}"


def app_directory(conn: sqlite3.Connection, user_id: int | None) -> list[dict]:
    """All apps with directory metrics. Filtering/sorting/pagination is done by the route."""
    base = rows(conn, """
        SELECT a.id, a.slug, a.name, a.category, a.website, a.description, a.note,
               (SELECT MAX(version_date) FROM policy_versions v JOIN documents d ON d.id=v.document_id
                 WHERE d.app_id=a.id AND v.quality_flag='ok') AS latest_policy_date,
               (SELECT COUNT(*) FROM policy_versions v JOIN documents d ON d.id=v.document_id WHERE d.app_id=a.id) AS versions,
               (SELECT COUNT(*) FROM policy_changes c JOIN documents d ON d.id=c.document_id
                 WHERE d.app_id=a.id AND c.is_meaningful=1) AS meaningful_changes,
               (SELECT ca.risk_score FROM policy_changes c JOIN documents d ON d.id=c.document_id
                 JOIN change_analysis ca ON ca.change_id=c.id AND ca.is_current=1
                 WHERE d.app_id=a.id AND c.is_meaningful=1 ORDER BY c.change_date DESC, c.id DESC LIMIT 1) AS latest_risk_score,
               (SELECT ROUND(AVG(ca.risk_score),2) FROM policy_changes c JOIN documents d ON d.id=c.document_id
                 JOIN change_analysis ca ON ca.change_id=c.id AND ca.is_current=1
                 WHERE d.app_id=a.id AND c.is_meaningful=1) AS avg_risk_score
        FROM apps a ORDER BY a.name""")
    status = ai_status_by_app(conn)
    followed = {r["app_id"] for r in rows(conn, "SELECT app_id FROM follows WHERE user_id=?", (user_id,))} if user_id else set()
    for b in base:
        b["ai_status"] = status.get(b["id"], {"status": "none", "label": "No AI language detected"})
        b["following"] = b["id"] in followed
    return base


def ai_status_by_app(conn: sqlite3.Connection) -> dict[int, dict]:
    """Classify each app by the AI language in its *latest* clean versions, and whether it appeared earlier."""
    latest = rows(conn, """SELECT lv.app_id, ac.kind, COUNT(*) AS n FROM v_latest_version lv
                           JOIN ai_clauses ac ON ac.version_id = lv.id GROUP BY lv.app_id, ac.kind""")
    ever = rows(conn, "SELECT app_id, kind, MIN(version_date) AS first_seen FROM v_ai_clause_versions GROUP BY app_id, kind")
    cur: dict[int, set] = defaultdict(set)
    for r in latest:
        cur[r["app_id"]].add(r["kind"])
    past: dict[int, set] = defaultdict(set)
    for r in ever:
        past[r["app_id"]].add(r["kind"])
    out = {}
    for app_id in set(cur) | set(past):
        kinds = cur[app_id]
        if "explicit_training" in kinds:
            s = ("explicit_training", "Explicit training language")
        elif "explicit_training" in past[app_id]:
            s = ("training_removed", "Training language no longer in latest version")
        elif "ai_provider_sharing" in kinds:
            s = ("ai_provider_sharing", "Mentions sharing with AI providers")
        elif kinds & {"general_ai", "automated_processing"}:
            s = ("general_ai", "AI or automated processing mentioned")
        else:
            s = ("none", "No AI language detected")
        out[app_id] = {"status": s[0], "label": s[1], "current_kinds": sorted(kinds), "ever_kinds": sorted(past[app_id])}
    return out


def ai_tracker(conn: sqlite3.Connection, app_slug: str | None = None, date_from: str | None = None,
               date_to: str | None = None) -> dict:
    """Per-app AI clause history built from sentence-level evidence in every clean version."""
    rng, p = _range_sql("v.version_date", date_from, date_to)
    app_filter = ""
    if app_slug:
        app_filter = " AND a.slug = ?"
        p.append(app_slug)
    clause_rows = rows(conn, f"""
        SELECT a.id AS app_id, a.name AS app_name, a.slug AS app_slug, d.id AS document_id, d.document_type,
               v.id AS version_id, v.version_date, ac.kind, ac.evidence, ac.clause_hash
        FROM ai_clauses ac JOIN policy_versions v ON v.id = ac.version_id
        JOIN documents d ON d.id = v.document_id JOIN apps a ON a.id = d.app_id
        WHERE ac.kind IN ('explicit_training','ai_provider_sharing') {rng} {app_filter}
        ORDER BY v.version_datetime, v.seq""", p)
    p2 = list(p)
    counts = rows(conn, f"""
        SELECT a.slug AS app_slug, ac.kind, MIN(v.version_date) AS first_seen, COUNT(DISTINCT v.id) AS versions
        FROM ai_clauses ac JOIN policy_versions v ON v.id = ac.version_id
        JOIN documents d ON d.id = v.document_id JOIN apps a ON a.id = d.app_id
        WHERE 1=1 {rng} {app_filter} GROUP BY a.id, ac.kind""", p2)
    doc_cov = {r["document_id"]: r for r in rows(conn, """
        SELECT d.id AS document_id, MIN(v.version_date) AS coverage_start, MAX(v.version_date) AS coverage_end,
               COUNT(*) AS versions FROM documents d JOIN policy_versions v ON v.document_id=d.id
        WHERE v.quality_flag='ok' GROUP BY d.id""")}
    latest_ids = {r["document_id"]: r["id"] for r in rows(conn, "SELECT document_id, id FROM v_latest_version")}
    status = ai_status_by_app(conn)

    apps: dict[str, dict] = {}
    for r in counts:
        a = apps.setdefault(r["app_slug"], {"kinds": {}})
        a["kinds"][r["kind"]] = {"first_seen": r["first_seen"], "versions": r["versions"]}

    # Per document: walk versions, track when the set of clause sentences changes.
    by_doc: dict[int, dict[int, list]] = defaultdict(lambda: defaultdict(list))
    meta: dict[int, dict] = {}
    for r in clause_rows:
        by_doc[r["document_id"]][r["version_id"]].append(r)
        meta[r["document_id"]] = {k: r[k] for k in ("app_id", "app_name", "app_slug", "document_type")}
    for doc_id, versions in by_doc.items():
        m = meta[doc_id]
        a = apps.setdefault(m["app_slug"], {"kinds": {}})
        a.update(app_name=m["app_name"], app_slug=m["app_slug"], status=status.get(m["app_id"]))
        events, prev = [], {}
        for vid, items in versions.items():
            cur = {i["clause_hash"]: i for i in items}
            added = [cur[h] for h in cur if h not in prev]
            removed = [prev[h] for h in prev if h not in cur]
            if added or removed:
                events.append({"version_id": vid, "version_date": items[0]["version_date"],
                               "added": [{"kind": i["kind"], "evidence": i["evidence"]} for i in added][:6],
                               "removed": [{"kind": i["kind"], "evidence": i["evidence"]} for i in removed][:6]})
            prev = cur
        latest_vid = latest_ids.get(doc_id)
        current = [{"kind": i["kind"], "evidence": i["evidence"]} for i in versions.get(latest_vid, [])]
        cov = doc_cov.get(doc_id, {})
        first = {}
        for k in ("explicit_training", "ai_provider_sharing"):
            dates = [items[0]["version_date"] for items in versions.values() if any(i["kind"] == k for i in items)]
            if dates:
                first[k] = {"date": min(dates), "at_coverage_start": min(dates) == cov.get("coverage_start")}
        a.setdefault("documents", []).append({
            "document_id": doc_id, "document_type": m["document_type"], "latest_version_id": latest_vid,
            "first_observed": first, "current_clauses": current[:8], "events": events[-25:],
            "coverage_start": cov.get("coverage_start"), "coverage_end": cov.get("coverage_end"),
            "versions_in_archive": cov.get("versions")})

    names = {r["slug"]: (r["name"], r["id"]) for r in rows(conn, "SELECT slug, name, id FROM apps")}
    out = []
    for slug, a in apps.items():
        a.setdefault("app_slug", slug)
        a.setdefault("app_name", names[slug][0])
        a.setdefault("status", status.get(names[slug][1]))
        a.setdefault("documents", [])
        out.append(a)
    order = {"explicit_training": 0, "training_removed": 1, "ai_provider_sharing": 2, "general_ai": 3, "none": 4}
    out.sort(key=lambda x: (order.get((x.get("status") or {}).get("status", "none"), 9), x["app_name"]))
    summary = defaultdict(int)
    for a in out:
        summary[(a.get("status") or {}).get("status", "none")] += 1
    return {"apps": out, "summary": dict(summary), "kinds": AI_KINDS,
            "caveat": ("'First observed' is the earliest archived version containing the language. Archive coverage "
                       "starts at different dates per app, so the practice may have begun earlier. Detection is "
                       "sentence-level pattern matching; mentioning AI is not evidence that user data trains models.")}


def taxonomy_info() -> dict:
    return {"categories": CATEGORIES, "risk_levels": RISK_LEVELS, "risk_rubric": RISK_RUBRIC, "ai_kinds": AI_KINDS}


def parse_analysis(a: dict | None) -> dict | None:
    if not a:
        return None
    a = dict(a)
    a["secondary_categories"] = json.loads(a.get("secondary_categories") or "[]")
    a["ai_training_mentioned"] = bool(a.get("ai_training_mentioned"))
    a["category_label"] = CATEGORIES.get(a.get("category"), a.get("category"))
    return a
