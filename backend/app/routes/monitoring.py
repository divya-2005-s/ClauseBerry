"""Authenticated policy-monitoring status and scan controls."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, BackgroundTasks, Depends

from ..core.errors import AppError
from ..core.ratelimit import limiter
from ..db.database import get_db
from ..security.deps import CurrentUser, current_user
from ..services import monitoring

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


@router.get("")
def monitoring_status(_: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return monitoring.get_status(conn)


@router.get("/apps/{slug}")
def app_monitoring_status(slug: str, _: CurrentUser = Depends(current_user),
                          conn: sqlite3.Connection = Depends(get_db)):
    return monitoring.app_status(conn, slug)


@router.get("/runs/{run_id}")
def monitoring_run(run_id: int, _: CurrentUser = Depends(current_user),
                   conn: sqlite3.Connection = Depends(get_db)):
    run = conn.execute(
        """SELECT id, app_slug, trigger, status, started_at, finished_at, summary
           FROM monitoring_runs WHERE id=?""",
        (run_id,),
    ).fetchone()
    if not run:
        raise AppError(404, "not_found", "Monitoring run not found.")
    from json import loads

    return {**dict(run), "summary": loads(run["summary"])}


def _queue(background_tasks: BackgroundTasks, user: CurrentUser, app_slug: str | None,
           conn: sqlite3.Connection) -> dict:
    limiter.check(f"monitor:{user.id}", 1, 60)
    if app_slug:
        monitoring.app_status(conn, app_slug)
    run = monitoring.enqueue_scan(trigger="manual", app_slug=app_slug)
    background_tasks.add_task(monitoring.execute_scan, run["id"], app_slug, True)
    return run


@router.post("/check", status_code=202)
def check_all(background_tasks: BackgroundTasks, user: CurrentUser = Depends(current_user),
              conn: sqlite3.Connection = Depends(get_db)):
    return _queue(background_tasks, user, None, conn)


@router.post("/apps/{slug}/check", status_code=202)
def check_app(slug: str, background_tasks: BackgroundTasks, user: CurrentUser = Depends(current_user),
              conn: sqlite3.Connection = Depends(get_db)):
    return _queue(background_tasks, user, slug, conn)
