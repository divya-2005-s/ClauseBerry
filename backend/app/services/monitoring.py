"""Scheduled and on-demand policy monitoring built on the existing ingestion pipeline."""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

from pipeline import ai_clauses, analyze_llm, build_rag, clean_changes, fetch_policies, notify

from ..core.config import get_settings
from ..core.errors import AppError
from ..db.database import connect, one, rows

log = logging.getLogger("clauseberry.monitoring")
_scheduler_thread: threading.Thread | None = None
_scheduler_stop = threading.Event()
_scan_lock = threading.Lock()
_MAX_RUN_AGE = timedelta(hours=6)
_MAX_QUEUED_AGE = timedelta(minutes=10)
_MANUAL_SCAN_COOLDOWN = timedelta(hours=1)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_stamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def enqueue_scan(trigger: str = "manual", app_slug: str | None = None) -> dict:
    """Create one durable scan job; an active job prevents duplicate pipeline execution."""
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        now = _now()
        conn.execute(
            """UPDATE monitoring_runs SET status='failed', finished_at=?, error='Monitoring run exceeded 6 hours'
               WHERE status='running' AND started_at < ?""",
            (_stamp(now), _stamp(now - _MAX_RUN_AGE)),
        )
        conn.execute(
            """UPDATE monitoring_runs SET status='failed', finished_at=?, error='Monitoring job was not started'
               WHERE status='queued' AND started_at < ?""",
            (_stamp(now), _stamp(now - _MAX_QUEUED_AGE)),
        )
        active = one(conn, "SELECT id FROM monitoring_runs WHERE status IN ('queued','running') LIMIT 1")
        if active:
            raise AppError(409, "scan_in_progress", "A policy monitoring run is already in progress.")
        if trigger == "manual":
            recent = one(conn, """SELECT id FROM monitoring_runs
                                  WHERE trigger='manual' AND app_slug IS ?
                                    AND started_at >= ? ORDER BY id DESC LIMIT 1""",
                         (app_slug, _stamp(now - _MANUAL_SCAN_COOLDOWN)))
            if recent:
                raise AppError(429, "scan_cooldown", "This monitoring target was checked recently. Try again later.")
        started = _stamp(now)
        cur = conn.execute(
            "INSERT INTO monitoring_runs(app_slug, trigger, status, started_at) VALUES (?,?, 'queued', ?)",
            (app_slug, trigger, started),
        )
        conn.commit()
        return {"id": cur.lastrowid, "app_slug": app_slug, "trigger": trigger, "status": "queued",
                "started_at": started}
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def _fetch_summary(conn: sqlite3.Connection, started_at: str, app_slug: str | None) -> dict:
    where = ["f.attempted_at >= ?"]
    params: list = [started_at]
    if app_slug:
        where.append("a.slug = ?")
        params.append(app_slug)
    matches = " AND ".join(where)
    result = one(conn, f"""SELECT COUNT(*) AS attempts,
                                  SUM(f.status IN ('unchanged','new_version')) AS checked,
                                  SUM(f.status='new_version') AS changed,
                                  SUM(f.status='failed') AS failed
                           FROM fetch_log f JOIN documents d ON d.id=f.document_id
                           JOIN apps a ON a.id=d.app_id WHERE {matches}""", tuple(params))
    return {key: result[key] or 0 for key in ("attempts", "checked", "changed", "failed")}


def execute_scan(run_id: int, app_slug: str | None, force: bool = False) -> None:
    """Run fetch, deterministic analysis, indexing and notifications for a queued job."""
    with _scan_lock:
        conn = connect()
        try:
            run = one(conn, "SELECT * FROM monitoring_runs WHERE id=?", (run_id,))
            if not run or run["status"] != "queued":
                return
            conn.execute("UPDATE monitoring_runs SET status='running', worker_pid=? WHERE id=?",
                         (os.getpid(), run_id))
            conn.commit()
            started_at = run["started_at"]
        finally:
            conn.close()

        try:
            fetch_policies.main(force=force, only=[app_slug] if app_slug else None)
            clean_changes.main()
            analyze_llm.main(heuristic_only=True)
            ai_clauses.main()
            build_rag.main()
            notify.main()
            conn = connect()
            try:
                summary = _fetch_summary(conn, started_at, app_slug)
                status = "partial" if summary["failed"] else "success"
                conn.execute(
                    "UPDATE monitoring_runs SET status=?, finished_at=?, summary=? WHERE id=?",
                    (status, _stamp(_now()), json.dumps(summary), run_id),
                )
                conn.commit()
            finally:
                conn.close()
            log.info("Monitoring run %s completed (status=%s, changed=%s, failed=%s)",
                     run_id, status, summary["changed"], summary["failed"])
        except Exception as exc:
            log.exception("Monitoring run %s failed", run_id)
            conn = connect()
            try:
                conn.execute(
                    "UPDATE monitoring_runs SET status='failed', finished_at=?, error=? WHERE id=?",
                    (_stamp(_now()), type(exc).__name__, run_id),
                )
                conn.commit()
            finally:
                conn.close()


def app_status(conn: sqlite3.Connection, app_slug: str, interval_hours: int | None = None) -> dict:
    interval = interval_hours or get_settings().policy_check_interval_hours
    app = one(conn, "SELECT id, slug, name FROM apps WHERE slug=?", (app_slug,))
    if not app:
        raise AppError(404, "not_found", "We don't track an app with that name.")
    docs = rows(conn, """SELECT d.id, d.document_type, d.source_url,
                                (SELECT f.status FROM fetch_log f WHERE f.document_id=d.id
                                 ORDER BY f.attempted_at DESC, f.id DESC LIMIT 1) AS latest_status,
                                (SELECT f.attempted_at FROM fetch_log f WHERE f.document_id=d.id
                                 ORDER BY f.attempted_at DESC, f.id DESC LIMIT 1) AS last_checked_at,
                                (SELECT f.status FROM fetch_log f WHERE f.document_id=d.id
                                 AND f.status IN ('new_version','unchanged')
                                 ORDER BY f.attempted_at DESC, f.id DESC LIMIT 1) AS last_success_status,
                                (SELECT f.attempted_at FROM fetch_log f WHERE f.document_id=d.id
                                 AND f.status IN ('new_version','unchanged')
                                 ORDER BY f.attempted_at DESC, f.id DESC LIMIT 1) AS last_successful_check_at,
                                (SELECT f.http_status FROM fetch_log f WHERE f.document_id=d.id
                                 ORDER BY f.attempted_at DESC, f.id DESC LIMIT 1) AS http_status
                         FROM documents d WHERE d.app_id=? ORDER BY d.document_type""", (app["id"],))
    for doc in docs:
        latest_status = doc["latest_status"]
        if latest_status == "skipped":
            latest_status = doc["last_success_status"]
        if latest_status == "new_version":
            doc["status"] = "changed"
        elif latest_status == "failed":
            doc["status"] = "failed"
        elif latest_status == "unchanged":
            doc["status"] = "healthy"
        else:
            doc["status"] = "not_checked"
        last_checked = _parse_stamp(doc["last_checked_at"])
        doc["next_check_at"] = _stamp(last_checked + timedelta(hours=interval)) if last_checked else None
        doc.pop("latest_status")
        doc.pop("last_success_status")

    states = {d["status"] for d in docs if d["source_url"]}
    if "failed" in states:
        status = "failed"
    elif "changed" in states:
        status = "changed"
    elif "healthy" in states:
        status = "healthy"
    else:
        status = "not_checked"
    last_checked_values = [d["last_checked_at"] for d in docs if d["last_checked_at"]]
    successful_values = [d["last_successful_check_at"] for d in docs if d["last_successful_check_at"]]
    next_values = [d["next_check_at"] for d in docs if d["next_check_at"]]
    return {
        "app_slug": app["slug"],
        "app_name": app["name"],
        "status": status,
        "last_checked_at": max(last_checked_values, default=None),
        "last_successful_check_at": max(successful_values, default=None),
        "next_check_at": min(next_values, default=None),
        "documents": docs,
    }


def get_status(conn: sqlite3.Connection) -> dict:
    settings = get_settings()
    scheduler_enabled = settings.policy_monitoring_enabled and settings.app_env != "test"
    apps = rows(conn, "SELECT slug FROM apps ORDER BY name")
    statuses = [app_status(conn, app["slug"], settings.policy_check_interval_hours) for app in apps]
    by_state = {state: sum(item["status"] == state for item in statuses)
                for state in ("healthy", "changed", "failed", "not_checked")}
    latest_run = one(conn, "SELECT * FROM monitoring_runs ORDER BY id DESC LIMIT 1")
    latest_scheduled = one(conn, """SELECT started_at, status FROM monitoring_runs
                                    WHERE trigger='scheduler' ORDER BY id DESC LIMIT 1""")
    due = _parse_stamp(latest_scheduled["started_at"]) if latest_scheduled else _now()
    if due:
        delay = timedelta(hours=settings.policy_check_interval_hours)
        if latest_scheduled and latest_scheduled["status"] == "failed":
            delay = timedelta(hours=1)
        next_scheduled = _stamp(due + delay)
    else:
        next_scheduled = None
    runs = rows(conn, """SELECT id, app_slug, trigger, status, started_at, finished_at, summary
                         FROM monitoring_runs ORDER BY id DESC LIMIT 20""")
    for run in runs:
        run["summary"] = json.loads(run["summary"])
    if latest_run:
        latest_run["summary"] = json.loads(latest_run["summary"])
        latest_run.pop("error", None)
    return {
        "enabled": scheduler_enabled,
        "interval_hours": settings.policy_check_interval_hours,
        "scheduler_running": bool(_scheduler_thread and _scheduler_thread.is_alive()),
        "next_scheduled_at": next_scheduled if scheduler_enabled else None,
        "last_run": latest_run,
        "totals": {"apps": len(statuses), **by_state},
        "apps": statuses,
        "runs": runs,
    }


def _scheduler_loop() -> None:
    while not _scheduler_stop.is_set():
        settings = get_settings()
        if not settings.policy_monitoring_enabled or settings.app_env == "test":
            return
        conn = connect()
        try:
            last = one(conn, """SELECT started_at, status FROM monitoring_runs
                                WHERE trigger='scheduler' ORDER BY id DESC LIMIT 1""")
        finally:
            conn.close()
        now = _now()
        last_started = _parse_stamp(last["started_at"]) if last else None
        if last_started is None:
            due_at = now
        else:
            delay = timedelta(hours=settings.policy_check_interval_hours)
            if last["status"] == "failed":
                delay = timedelta(hours=1)
            due_at = last_started + delay
        wait_seconds = max(1, (due_at - now).total_seconds())
        if _scheduler_stop.wait(min(wait_seconds, 60)):
            return
        if _now() < due_at:
            continue
        try:
            run = enqueue_scan(trigger="scheduler")
            threading.Thread(target=execute_scan, args=(run["id"], None, False),
                             name=f"clauseberry-monitor-{run['id']}", daemon=True).start()
        except AppError as exc:
            if exc.status_code != 409:
                log.exception("Could not schedule monitoring run")
            _scheduler_stop.wait(60)


def recover_orphaned_runs() -> None:
    """Release jobs left running by a backend process that exited unexpectedly."""
    conn = connect()
    try:
        running = rows(conn, "SELECT id, worker_pid FROM monitoring_runs WHERE status='running'")
        for run in running:
            pid = run["worker_pid"]
            if pid is None:
                continue
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                conn.execute(
                    "UPDATE monitoring_runs SET status='failed', finished_at=?, error='Monitoring worker stopped' "
                    "WHERE id=? AND status='running'",
                    (_stamp(_now()), run["id"]),
                )
            except PermissionError:
                continue
        conn.commit()
    finally:
        conn.close()


def start_scheduler() -> None:
    global _scheduler_thread, _scheduler_stop
    settings = get_settings()
    if not settings.policy_monitoring_enabled or settings.app_env == "test":
        return
    if _scheduler_thread and _scheduler_thread.is_alive():
        return
    recover_orphaned_runs()
    _scheduler_stop = threading.Event()
    _scheduler_thread = threading.Thread(target=_scheduler_loop, name="clauseberry-monitor-scheduler", daemon=True)
    _scheduler_thread.start()
    log.info("Local policy scheduler started (interval_hours=%s)", settings.policy_check_interval_hours)


def stop_scheduler() -> None:
    global _scheduler_thread
    thread = _scheduler_thread
    if not thread:
        return
    _scheduler_stop.set()
    thread.join(timeout=5)
    if thread.is_alive():
        log.warning("Policy scheduler did not stop within 5 seconds")
    else:
        _scheduler_thread = None
