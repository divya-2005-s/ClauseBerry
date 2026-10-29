"""Authentication, sessions, CSRF and account security."""
from .conftest import signup


def test_signup_sets_httponly_session_and_logs_email(client, db):
    body = signup(client)
    cookies = client.cookies
    assert "cb_session" in cookies and "cb_csrf" in cookies
    assert body["email_delivery"] == "logged"  # no provider configured -> never reported as sent
    stored = db.execute("SELECT password_hash FROM users WHERE email=?", (body["email"],)).fetchone()[0]
    assert stored.startswith("$argon2id$") and "Purple" not in stored
    assert db.execute("SELECT status FROM email_outbox ORDER BY id DESC LIMIT 1").fetchone()[0] == "logged"


def test_session_cookie_flags(client):
    r = client.post("/api/auth/signup", json={"name": "Flags", "email": "flags@example.com", "password": "Purple-Orchard-91", "accept_terms": True})
    session_header = [h for h in r.headers.get_list("set-cookie") if h.startswith("cb_session=")][0].lower()
    assert "httponly" in session_header and "samesite=lax" in session_header


def test_signup_validation(client):
    r = client.post("/api/auth/signup", json={"name": "A", "email": "not-an-email", "password": "x", "accept_terms": True})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = client.post("/api/auth/signup", json={"name": "A", "email": "weak@example.com", "password": "short1", "accept_terms": True})
    assert r.status_code == 422 and r.json()["error"]["code"] == "weak_password"
    r = client.post("/api/auth/signup", json={"name": "A", "email": "terms@example.com", "password": "Purple-Orchard-91", "accept_terms": False})
    assert r.status_code == 422


def test_duplicate_email_rejected(client):
    body = signup(client)
    client.cookies.clear()
    r = client.post("/api/auth/signup", json={"name": "B", "email": body["email"].upper(), "password": "Purple-Orchard-91", "accept_terms": True})
    assert r.status_code == 409


def test_login_logout_and_bad_credentials(client):
    body = signup(client)
    client.post("/api/auth/logout")
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": body["email"], "password": "wrong-password-1"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password-1"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": body["email"], "password": body["password"]})
    assert r.status_code == 200
    assert client.get("/api/auth/me").json()["user"]["email"] == body["email"]


def test_protected_endpoints_require_auth(client):
    for path in ["/api/dashboard", "/api/apps", "/api/apps/acme", "/api/ai-training", "/api/alerts", "/api/chat/sessions",
                 "/api/me/follows", "/api/exports/changes.csv"]:
        assert client.get(path).status_code == 401, path


def test_csrf_required_for_state_changes(user_client):
    token = user_client.headers.pop("X-CSRF-Token")
    assert user_client.put("/api/me/follows/acme").status_code == 403
    assert user_client.put("/api/me/follows/acme", headers={"X-CSRF-Token": "forged"}).status_code == 403
    assert user_client.put("/api/me/follows/acme", headers={"X-CSRF-Token": token}).status_code == 201


def test_email_verification_flow(client, db):
    signup(client)
    body = db.execute("SELECT body_text FROM email_outbox WHERE subject LIKE 'Confirm%' ORDER BY id DESC LIMIT 1").fetchone()[0]
    token = body.split("token=")[1].split()[0]
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    assert client.get("/api/auth/me").json()["user"]["email_verified"] is True
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 400  # single use


def test_password_reset_flow_revokes_sessions(client, db):
    body = signup(client)
    r = client.post("/api/auth/forgot-password", json={"email": body["email"]})
    assert r.status_code == 200 and r.json()["email_configured"] is False
    # Unknown emails get the identical answer (no account enumeration).
    assert client.post("/api/auth/forgot-password", json={"email": "ghost@example.com"}).json()["message"] == r.json()["message"]
    text = db.execute("SELECT body_text FROM email_outbox WHERE subject LIKE 'Reset%' ORDER BY id DESC LIMIT 1").fetchone()[0]
    token = text.split("token=")[1].split()[0]
    assert client.post("/api/auth/reset-password", json={"token": token, "password": "New-Berry-Path-42"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 401  # all sessions revoked
    assert client.post("/api/auth/login", json={"email": body["email"], "password": "New-Berry-Path-42"}).status_code == 200


def test_change_password(user_client):
    r = user_client.post("/api/auth/change-password", json={"current_password": "wrong", "new_password": "Another-Grape-55"})
    assert r.status_code == 400
    r = user_client.post("/api/auth/change-password", json={"current_password": "Purple-Orchard-91", "new_password": "Another-Grape-55"})
    assert r.status_code == 200


def test_auth_rate_limit(client):
    from backend.app.core.config import get_settings
    limit = get_settings().rate_limit_auth_per_minute
    # Distinct emails so only the per-address limit applies (not the per-account one).
    codes = [client.post("/api/auth/login", json={"email": f"x{i}@example.com", "password": "nope-nope-1"}).status_code
             for i in range(limit + 1)]
    assert codes[:limit] == [401] * limit and codes[-1] == 429
    assert "Retry-After" in client.post("/api/auth/login", json={"email": "y@example.com", "password": "n"}).headers


def test_account_deletion_cascades(client, db):
    body = signup(client)
    client.put("/api/me/follows/acme")
    uid = db.execute("SELECT id FROM users WHERE email=?", (body["email"],)).fetchone()[0]
    assert client.post("/api/me/delete", json={"password": "wrong"}).status_code == 400
    assert client.post("/api/me/delete", json={"password": body["password"]}).status_code == 204
    for table in ("users", "follows", "sessions", "alerts", "notification_preferences"):
        col = "id" if table == "users" else "user_id"
        assert db.execute(f"SELECT COUNT(*) FROM {table} WHERE {col}=?", (uid,)).fetchone()[0] == 0, table


def test_client_ip_ignores_forwarded_header_by_default(monkeypatch):
    from types import SimpleNamespace

    from backend.app.core.config import Settings
    from backend.app.security import deps

    req = SimpleNamespace(client=SimpleNamespace(host="10.0.0.9"),
                          headers={"x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.1"})
    monkeypatch.setattr(deps, "get_settings", lambda: Settings(trusted_proxy_hops=0))
    assert deps.client_ip(req) == "10.0.0.9"          # spoofable header ignored
    monkeypatch.setattr(deps, "get_settings", lambda: Settings(trusted_proxy_hops=2))
    assert deps.client_ip(req) == "203.0.113.7"       # 2nd from the right; the forged left entry is never used
    monkeypatch.setattr(deps, "get_settings", lambda: Settings(trusted_proxy_hops=1))
    assert deps.client_ip(req) == "10.0.0.1"


def test_spoofed_forwarded_for_cannot_bypass_auth_limit(client):
    from backend.app.core.config import get_settings
    limit = get_settings().rate_limit_auth_per_minute
    codes = [client.post("/api/auth/login", json={"email": f"s{i}@example.com", "password": "nope-nope-1"},
                         headers={"X-Forwarded-For": f"198.51.100.{i}"}).status_code for i in range(limit + 1)]
    assert codes[-1] == 429  # rotating forged X-Forwarded-For values did not create fresh buckets


def test_per_account_login_limit(client):
    from backend.app.core.config import get_settings
    from backend.app.core.ratelimit import limiter

    body = signup(client)
    limit = get_settings().rate_limit_login_per_account_15min
    codes = []
    for _ in range(limit + 1):
        limiter._hits.pop("auth:testclient", None)  # keep the per-IP bucket empty: only the per-account limit applies
        codes.append(client.post("/api/auth/login", json={"email": body["email"], "password": "wrong-pass-1"}).status_code)
    assert codes[:-1] == [401] * limit and codes[-1] == 429


def test_reset_email_limit_per_address(client):
    from backend.app.core.config import get_settings
    from backend.app.core.ratelimit import limiter

    limit = get_settings().rate_limit_email_per_hour
    codes = []
    for _ in range(limit + 1):
        limiter._hits.pop("auth:testclient", None)  # isolate the per-email limit from the per-address one
        codes.append(client.post("/api/auth/forgot-password", json={"email": "victim@example.com"}).status_code)
    assert codes[:limit] == [200] * limit and codes[-1] == 429
    # Another address is unaffected, and an unknown address is limited exactly like a real one.
    assert client.post("/api/auth/forgot-password", json={"email": "someone-else@example.com"}).status_code == 200
