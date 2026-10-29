"""Dashboard, AI-training tracker, coverage metadata, public landing stats and CSV export."""
from __future__ import annotations

import csv
import io
import sqlite3

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from ..core.config import get_settings
from ..db.database import get_db, one, rows, scalar
from ..security.deps import CurrentUser, current_user
from ..services import rag
from ..services.analytics import ai_tracker, coverage, dashboard, kpis, parse_analysis, taxonomy_info

router = APIRouter(prefix="/api", tags=["insights"])
DATE = r"^\d{4}-\d{2}-\d{2}$"


@router.get("/dashboard")
def get_dashboard(_: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db),
                  date_from: str | None = Query(None, pattern=DATE), date_to: str | None = Query(None, pattern=DATE)):
    return dashboard(conn, date_from, date_to)


@router.get("/ai-training")
def get_ai_training(_: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db),
                    app: str | None = Query(None, max_length=60),
                    date_from: str | None = Query(None, pattern=DATE), date_to: str | None = Query(None, pattern=DATE)):
    return ai_tracker(conn, app, date_from, date_to)


@router.get("/meta")
def meta(_: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    s = get_settings()
    return {"coverage": coverage(conn), "taxonomy": taxonomy_info(),
            "services": {"llm": {"configured": s.llm_configured, "model": s.gemini_model if s.llm_configured else None},
                         "email": {"configured": s.email_configured},
                         "rag": rag.status()},
            "plan_limits": {"free_follow_limit": s.free_plan_follow_limit}}


@router.get("/public/stats")
def public_stats(conn: sqlite3.Connection = Depends(get_db)):
    """Aggregate, non-personal numbers for the landing page, computed from the database."""
    k = kpis(conn)
    cov = coverage(conn)
    ai_apps = scalar(conn, """SELECT COUNT(DISTINCT lv.app_id) FROM v_latest_version lv JOIN ai_clauses ac
                              ON ac.version_id = lv.id WHERE ac.kind='explicit_training'""")
    sample = one(conn, """SELECT vc.change_id, vc.app_name, vc.document_type, vc.change_date, vc.summary, vc.risk_score,
                                 vc.risk_level, vc.category, vc.analyzer, ca.ai_training_evidence, ca.reasoning
                          FROM v_changes vc JOIN change_analysis ca ON ca.change_id=vc.change_id AND ca.is_current=1
                          WHERE vc.is_meaningful=1 AND vc.ai_training_mentioned=1
                          ORDER BY vc.change_date DESC LIMIT 1""")
    apps = [r["name"] for r in rows(conn, "SELECT name FROM apps ORDER BY name")]
    by_year = rows(conn, """SELECT substr(change_date,1,4) AS year, COUNT(*) AS changes, SUM(risk_score >= 4) AS high_risk,
                                   SUM(ai_training_mentioned) AS ai_training
                            FROM v_changes WHERE is_meaningful=1 GROUP BY year ORDER BY year""")
    risk = rows(conn, """SELECT risk_score, COUNT(*) AS changes FROM v_changes WHERE is_meaningful=1
                         AND risk_score IS NOT NULL GROUP BY risk_score ORDER BY risk_score""")
    return {"apps_tracked": k["apps_tracked"], "policy_versions": k["policy_versions"],
            "raw_changes": k["raw_changes"], "meaningful_changes": k["meaningful_changes"],
            "high_risk_changes": k["high_risk_changes"], "apps_with_training_language": ai_apps,
            "coverage_start": cov["first_version_date"], "coverage_end": cov["last_version_date"], "apps": apps,
            "by_year": by_year, "risk_distribution": risk, "sample_change": parse_analysis(sample)}


@router.get("/exports/changes.csv")
def export_changes(_: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db),
                   app: str | None = Query(None, max_length=60),
                   date_from: str | None = Query(None, pattern=DATE), date_to: str | None = Query(None, pattern=DATE),
                   min_risk: int | None = Query(None, ge=1, le=5)):
    where, params = ["vc.is_meaningful = 1"], []
    if app:
        where.append("vc.app_slug = ?"); params.append(app)
    if date_from:
        where.append("vc.change_date >= ?"); params.append(date_from)
    if date_to:
        where.append("vc.change_date <= ?"); params.append(date_to)
    if min_risk:
        where.append("vc.risk_score >= ?"); params.append(min_risk)
    data = rows(conn, f"""SELECT vc.change_id, vc.app_name, vc.document_type, vc.previous_date, vc.change_date,
                                 vc.words_added, vc.words_removed, vc.category, vc.risk_score, vc.risk_level,
                                 vc.ai_training_mentioned, vc.change_direction, vc.summary, vc.analyzer, vc.model
                          FROM v_changes vc WHERE {' AND '.join(where)} ORDER BY vc.change_date DESC""", params)
    buf = io.StringIO()
    buf.write("# ClauseBerry export. Summaries and scores are automated estimates, not legal advice. "
              "Source data: Open Terms Archive contributors / Platform Governance Archive (ODbL).\n")
    cols = list(data[0].keys()) if data else ["change_id"]
    w = csv.DictWriter(buf, fieldnames=cols)
    w.writeheader()
    for r in data:
        # Neutralise spreadsheet formula injection.
        w.writerow({k: (f"'{v}" if isinstance(v, str) and v[:1] in "=+-@" else v) for k, v in r.items()})
    name = f"clauseberry-changes{'-' + app if app else ''}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})
