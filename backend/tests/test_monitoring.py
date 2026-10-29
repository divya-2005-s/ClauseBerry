"""Local policy monitoring status, job queuing and pipeline orchestration."""
from __future__ import annotations

import json

import pytest

from backend.app.core.config import Settings
from backend.app.core.errors import AppError
from backend.app.services import monitoring
from pipeline import ai_clauses, analyze_llm, build_rag, clean_changes, fetch_policies, notify

from .conftest import signup


@pytest.mark.parametrize("interval", [1, 24, 720])
def test_policy_check_interval_accepts_supported_values(interval):
    settings = Settings(_env_file=None, policy_check_interval_hours=interval)
    assert settings.policy_check_interval_hours == interval


@pytest.mark.parametrize("interval", [0, 721])
def test_policy_check_interval_rejects_out_of_range_values(interval):
    with pytest.raises(ValueError, match="between 1 and 720"):
        Settings(_env_file=None, policy_check_interval_hours=interval)


def test_monitoring_status_requires_auth(client):
    assert client.get("/api/monitoring").status_code == 401


def test_monitoring_status_reports_fixture_apps(user_client, db):
    response = user_client.get("/api/monitoring")
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is False  # test environment never starts a scheduler
    assert body["interval_hours"] == 24
    assert body["totals"]["apps"] == db.execute("SELECT COUNT(*) FROM apps").fetchone()[0]
    assert body["totals"]["apps"] == len(body["apps"])
    assert set(body["totals"]) == {"apps", "healthy", "changed", "failed", "not_checked"}
    assert sum(body["totals"][state] for state in ("healthy", "changed", "failed", "not_checked")) == len(body["apps"])
    assert {app["app_slug"] for app in body["apps"]} >= {"acme", "beta"}


def test_manual_scan_is_authenticated_and_queued(client, monkeypatch):
    signup(client)
    queued = []

    def finish_without_fetching(*args):
        queued.append(args)
        from pipeline.common import connect

        conn = connect()
        try:
            conn.execute("UPDATE monitoring_runs SET status='success', finished_at=started_at WHERE id=?", (args[0],))
            conn.commit()
        finally:
            conn.close()

    monkeypatch.setattr(monitoring, "execute_scan", finish_without_fetching)
    response = client.post("/api/monitoring/apps/acme/check")
    assert response.status_code == 202
    run = response.json()
    assert run["status"] == "queued" and run["app_slug"] == "acme"
    assert queued == [(run["id"], "acme", True)]


def test_manual_scan_rejects_unknown_app(client):
    signup(client)
    response = client.post("/api/monitoring/apps/missing/check")
    assert response.status_code == 404


def test_overlapping_scans_are_rejected():
    first = monitoring.enqueue_scan(trigger="scheduler")
    assert first["status"] == "queued"
    with pytest.raises(AppError) as exc:
        monitoring.enqueue_scan(trigger="scheduler")
    assert exc.value.status_code == 409
    from pipeline.common import connect

    conn = connect()
    try:
        conn.execute("UPDATE monitoring_runs SET status='failed', finished_at=started_at WHERE id=?", (first["id"],))
        conn.commit()
    finally:
        conn.close()


def test_manual_scan_cooldown_is_persisted():
    first = monitoring.enqueue_scan(trigger="manual", app_slug="beta")
    from pipeline.common import connect

    conn = connect()
    try:
        conn.execute("UPDATE monitoring_runs SET status='success', finished_at=started_at WHERE id=?", (first["id"],))
        conn.commit()
    finally:
        conn.close()
    with pytest.raises(AppError) as exc:
        monitoring.enqueue_scan(trigger="manual", app_slug="beta")
    assert exc.value.status_code == 429


def test_orphaned_workers_are_marked_failed(monkeypatch):
    run = monitoring.enqueue_scan(trigger="scheduler")
    from pipeline.common import connect

    conn = connect()
    try:
        conn.execute("UPDATE monitoring_runs SET status='running', worker_pid=99999999 WHERE id=?", (run["id"],))
        conn.commit()
    finally:
        conn.close()

    original_kill = monitoring.os.kill

    def kill(pid, signal):
        if pid == 99999999:
            raise ProcessLookupError
        original_kill(pid, signal)

    monkeypatch.setattr(monitoring.os, "kill", kill)
    monitoring.recover_orphaned_runs()
    conn = connect()
    try:
        row = conn.execute("SELECT status,error FROM monitoring_runs WHERE id=?", (run["id"],)).fetchone()
        assert row["status"] == "failed"
        assert row["error"] == "Monitoring worker stopped"
    finally:
        conn.close()


def test_app_monitoring_status_uses_latest_fetch_logs(db):
    doc_id = db.execute("SELECT id FROM documents WHERE app_id=1 ORDER BY id LIMIT 1").fetchone()[0]
    db.execute("UPDATE documents SET source_url=? WHERE id=?", ("https://example.com/policy", doc_id))
    db.execute(
        "INSERT INTO fetch_log(document_id,url,attempted_at,status,http_status) VALUES (?,?,?,'failed',503)",
        (doc_id, "https://example.com/policy", "2020-01-01T00:00:00Z"),
    )
    db.commit()
    result = monitoring.app_status(db, "acme")
    assert result["status"] == "failed"
    assert result["last_checked_at"] == "2020-01-01T00:00:00Z"
    assert next(doc for doc in result["documents"] if doc["id"] == doc_id)["http_status"] == 503


def test_scan_runs_existing_incremental_pipeline_without_gemini(monkeypatch):
    run = monitoring.enqueue_scan(trigger="scheduler", app_slug="acme")
    calls = []
    monkeypatch.setattr(fetch_policies, "main", lambda **kwargs: calls.append(("fetch", kwargs)))
    monkeypatch.setattr(clean_changes, "main", lambda: calls.append(("diff", {})))
    monkeypatch.setattr(analyze_llm, "main", lambda **kwargs: calls.append(("analysis", kwargs)))
    monkeypatch.setattr(ai_clauses, "main", lambda: calls.append(("ai_clauses", {})))
    monkeypatch.setattr(build_rag, "main", lambda: calls.append(("index", {})))
    monkeypatch.setattr(notify, "main", lambda: calls.append(("notify", {})))

    monitoring.execute_scan(run["id"], "acme", True)

    assert calls == [
        ("fetch", {"force": True, "only": ["acme"]}),
        ("diff", {}),
        ("analysis", {"heuristic_only": True}),
        ("ai_clauses", {}),
        ("index", {}),
        ("notify", {}),
    ]
    from pipeline.common import connect

    conn = connect()
    try:
        row = conn.execute("SELECT status,summary FROM monitoring_runs WHERE id=?", (run["id"],)).fetchone()
        assert row["status"] == "success"
        assert json.loads(row["summary"]) == {"attempts": 0, "checked": 0, "changed": 0, "failed": 0}
    finally:
        conn.close()


def test_scan_failure_is_recorded_without_leaking_error_details(monkeypatch):
    run = monitoring.enqueue_scan(trigger="scheduler")

    def fail(**_kwargs):
        raise RuntimeError("test failure")

    monkeypatch.setattr(fetch_policies, "main", fail)
    monitoring.execute_scan(run["id"], None, False)

    from pipeline.common import connect

    conn = connect()
    try:
        row = conn.execute("SELECT status,error FROM monitoring_runs WHERE id=?", (run["id"],)).fetchone()
        assert row["status"] == "failed"
        assert row["error"] == "RuntimeError"
    finally:
        conn.close()


def test_scheduler_is_disabled_in_test_environment():
    monitoring.start_scheduler()
    assert monitoring._scheduler_thread is None
