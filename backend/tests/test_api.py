"""Data endpoints, user isolation, plan limits, exports and RAG behaviour."""
from backend.app.services import rag

from .conftest import signup


def test_health_and_ready(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    r = client.get("/api/ready").json()
    assert r["database"]["policy_versions"] == 5 and r["rag"]["ready"] is False


def test_dashboard_kpis_match_database(user_client):
    d = user_client.get("/api/dashboard").json()
    k = d["kpis"]
    assert k == {**k, "apps_tracked": 2, "policy_versions": 5, "raw_changes": 3, "meaningful_changes": 1}
    assert k["high_risk_changes"] == 1 and k["ai_training_changes"] == 1
    assert sum(r["changes"] for r in d["risk_distribution"]) == 1
    # Date filters apply to KPIs.
    assert user_client.get("/api/dashboard?date_from=2025-01-01").json()["kpis"]["meaningful_changes"] == 0
    assert user_client.get("/api/dashboard?date_from=bad").status_code == 422


def test_app_directory_filters_and_detail(user_client):
    d = user_client.get("/api/apps").json()
    assert d["total"] == 2
    acme = next(a for a in d["items"] if a["slug"] == "acme")
    assert acme["meaningful_changes"] == 1 and acme["ai_status"]["status"] == "explicit_training"
    assert user_client.get("/api/apps?q=bet").json()["total"] == 1
    assert user_client.get("/api/apps?ai=explicit_training").json()["items"][0]["slug"] == "acme"
    assert user_client.get("/api/apps?risk=low").json()["total"] == 0
    assert user_client.get("/api/apps/nope").status_code == 404
    detail = user_client.get("/api/apps/acme").json()
    assert detail["latest_change"]["change_id"] and detail["stats"]["meaningful_changes"] == 1


def test_change_detail_diff_and_compare(user_client):
    changes = user_client.get("/api/apps/acme/changes").json()
    assert changes["total"] == 1
    cid = changes["items"][0]["id"]
    d = user_client.get(f"/api/changes/{cid}").json()
    assert d["analysis"]["analyzer"] == "heuristic" and d["analysis"]["ai_training_evidence"]
    diff = user_client.get(f"/api/changes/{cid}/diff").json()
    assert diff["stats"]["added"] + diff["stats"]["modified"] >= 1
    assert user_client.get("/api/apps/acme/changes?include_noise=true").json()["total"] == 2
    assert user_client.get("/api/compare?from_version=1&to_version=4").status_code == 400  # different documents
    assert user_client.get("/api/versions/2").json()["ai_clauses"]


def test_ai_tracker(user_client):
    t = user_client.get("/api/ai-training").json()
    acme = next(a for a in t["apps"] if a["app_slug"] == "acme")
    doc = acme["documents"][0]
    assert doc["first_observed"]["explicit_training"]["date"] == "2024-03-01"
    assert doc["first_observed"]["explicit_training"]["at_coverage_start"] is False
    assert "train" in doc["current_clauses"][0]["evidence"]


def test_follow_limit_and_alert_backfill(client, db):
    signup(client)
    for slug in ("acme", "beta"):
        assert client.put(f"/api/me/follows/{slug}").status_code == 201
    db.execute("INSERT INTO apps(slug, name, category) VALUES ('c3','C3','Other'), ('c4','C4','Other')")
    db.commit()
    assert client.put("/api/me/follows/c3").status_code == 201
    r = client.put("/api/me/follows/c4")
    assert r.status_code == 403 and r.json()["error"]["code"] == "plan_limit"
    assert client.delete("/api/me/follows/c3").status_code == 204


def test_alerts_are_isolated_per_user(client, db):
    signup(client, "Alice")
    client.put("/api/me/follows/acme")
    cid = db.execute("SELECT id FROM policy_changes WHERE is_meaningful=1").fetchone()[0]
    uid = db.execute("SELECT id FROM users ORDER BY id DESC LIMIT 1").fetchone()[0]
    db.execute("INSERT OR IGNORE INTO alerts(user_id, change_id, origin) VALUES (?,?, 'pipeline')", (uid, cid))
    db.commit()
    alice_alerts = client.get("/api/alerts").json()
    assert alice_alerts["total"] == 1
    alert_id = alice_alerts["items"][0]["id"]
    # Bob cannot see or modify Alice's alert.
    client.cookies.clear()
    signup(client, "Bob")
    assert client.get("/api/alerts").json()["total"] == 0
    assert client.post(f"/api/alerts/{alert_id}/read", json={"read": True}).status_code == 404


def test_chat_sessions_are_isolated(client):
    signup(client, "Carol")
    sid = client.post("/api/chat/sessions", json={}).json()["id"]
    client.cookies.clear()
    signup(client, "Dave")
    assert client.get(f"/api/chat/sessions/{sid}").status_code == 404
    assert client.delete(f"/api/chat/sessions/{sid}").status_code == 404
    assert client.post(f"/api/chat/sessions/{sid}/messages", json={"question": "hi there"}).status_code == 404


def test_chat_reports_missing_index_honestly(user_client):
    sid = user_client.post("/api/chat/sessions", json={}).json()["id"]
    r = user_client.post(f"/api/chat/sessions/{sid}/messages", json={"question": "Does Acme train AI on my posts?"})
    assert r.status_code == 200 and '"type": "error"' in r.text and "index" in r.text
    msgs = user_client.get(f"/api/chat/sessions/{sid}").json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"] and msgs[1]["meta"]["error"] is True


def test_notification_preferences_persist(user_client):
    p = user_client.get("/api/me/notification-preferences").json()
    assert p["email_configured"] is False
    r = user_client.put("/api/me/notification-preferences",
                        json={"email_enabled": False, "min_risk_score": 4, "frequency": "weekly", "ai_training_only": True})
    assert r.status_code == 200
    p = user_client.get("/api/me/notification-preferences").json()
    assert (p["email_enabled"], p["min_risk_score"], p["frequency"], p["ai_training_only"]) == (False, 4, "weekly", True)
    assert user_client.put("/api/me/notification-preferences",
                           json={"email_enabled": True, "min_risk_score": 9, "frequency": "weekly", "ai_training_only": True}).status_code == 422


def test_upgrade_interest_never_changes_plan(user_client):
    r = user_client.post("/api/me/upgrade-interest", json={"plan": "pro"}).json()
    assert r["billing_available"] is False
    assert user_client.get("/api/auth/me").json()["user"]["plan"] == "free"


def test_csv_export_is_injection_safe(user_client):
    r = user_client.get("/api/exports/changes.csv?app=acme")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "Open Terms Archive" in r.text.splitlines()[0]
    assert "\n=" not in r.text and ",=" not in r.text


def test_public_stats_requires_no_auth(client, db):
    s = client.get("/api/public/stats").json()
    assert s["apps_tracked"] == db.execute("SELECT COUNT(*) FROM apps").fetchone()[0]
    assert s["sample_change"]["app_name"] == "Acme" and s["meaningful_changes"] == 1


def test_errors_do_not_leak_internals(user_client):
    r = user_client.get("/api/changes/999999")
    assert r.status_code == 404 and set(r.json()["error"]) >= {"code", "message", "request_id"}
    assert "Traceback" not in r.text


def test_rag_constraint_parsing(db):
    c = rag.parse_constraints(db, "What changed in Acme's terms of service in 2024?")
    assert c.app_slugs == ["acme"] and c.document_type == "Terms of Service" and c.years == [2024] and c.wants_changes
    assert rag.parse_constraints(db, "Tell me about X data sharing").app_slugs == []  # no X app in the fixture


def test_rag_drops_fabricated_citations():
    assert rag._valid_citations("Claim [1] and [7].", 2) == "Claim [1] and ."
