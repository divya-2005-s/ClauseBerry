"""Email delivery (mocked Resend) and the notification digest: preferences, recipients, de-duplication."""
import logging

import httpx
import pytest

from backend.app.core.config import Settings
from backend.app.services import email as email_service
from pipeline import notify


class Resp:
    def __init__(self, status, payload=None, text=""):
        self.status_code, self._payload, self.text = status, payload, text

    def json(self):
        if self._payload is None:
            raise ValueError("no JSON")
        return self._payload


@pytest.fixture()
def provider(monkeypatch):
    """Configure a (fake) Resend key and capture every request instead of sending it."""
    sent = []
    responses = []
    monkeypatch.setattr(email_service, "get_settings",
                        lambda: Settings(resend_api_key="re_test_not_real", email_from="CB <alerts@example.com>"))

    def fake_post(url, **kw):
        sent.append({"url": url, **kw})
        r = responses.pop(0) if responses else Resp(200, {"id": "msg_1"})
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(email_service.httpx, "post", fake_post)
    return sent, responses


def _last_outbox(db):
    return db.execute("SELECT status, provider_id, error FROM email_outbox ORDER BY id DESC LIMIT 1").fetchone()


def test_no_provider_is_logged_never_sent(db, monkeypatch, caplog):
    monkeypatch.setattr(email_service, "get_settings", lambda: Settings(app_env="production", resend_api_key=None))
    with caplog.at_level(logging.INFO):
        status = email_service.send_email(db, "a@example.com", "Reset", "secret-token-123")
    assert status == "logged" and _last_outbox(db)[0] == "logged"
    assert "secret-token-123" not in caplog.text  # bodies (tokens) are never logged outside development


def test_dev_mode_prints_body_for_local_links(db, monkeypatch, caplog):
    monkeypatch.setattr(email_service, "get_settings", lambda: Settings(app_env="development", resend_api_key=None))
    with caplog.at_level(logging.INFO):
        assert email_service.send_email(db, "a@example.com", "Verify", "http://localhost/verify?token=abc") == "logged"
    assert "token=abc" in caplog.text


def test_provider_success_records_message_id(db, provider):
    sent, _ = provider
    assert email_service.send_email(db, "b@example.com", "Hi", "body") == "sent"
    assert _last_outbox(db)[:2] == ("sent", "msg_1")
    req = sent[-1]
    assert req["url"] == "https://api.resend.com/emails" and req["json"]["to"] == ["b@example.com"]
    assert req["headers"]["Authorization"] == "Bearer re_test_not_real"


@pytest.mark.parametrize("response", [
    Resp(422, {"message": "domain not verified"}, "domain not verified"),
    Resp(200, {}),                       # 2xx without an id is not a confirmed send
    Resp(200, None, "<html>"),           # 2xx with a non-JSON body
    httpx.ConnectTimeout("timeout"),
])
def test_provider_failures_are_never_reported_as_sent(db, provider, response):
    _, responses = provider
    responses.append(response)
    assert email_service.send_email(db, "c@example.com", "Hi", "body") == "failed"
    status, provider_id, error = _last_outbox(db)
    assert status == "failed" and provider_id is None and error


def _user(db, email, verified=True, email_enabled=1, min_risk=1):
    cur = db.execute("INSERT INTO users(email, name, password_hash, email_verified_at) VALUES (?,?,?,?)",
                     (email, "N", "x", "2024-01-01T00:00:00Z" if verified else None))
    uid = cur.lastrowid
    db.execute("INSERT INTO notification_preferences(user_id, email_enabled, min_risk_score, frequency) VALUES (?,?,?, 'instant')",
               (uid, email_enabled, min_risk))
    # Followed before the change was detected, so the pipeline creates an alert.
    db.execute("INSERT INTO follows(user_id, app_id, created_at) VALUES (?, 1, '2000-01-01T00:00:00Z')", (uid,))
    db.commit()
    return uid


def test_digest_recipients_preferences_and_dedup(db, provider):
    sent, responses = provider
    cid = db.execute("SELECT id FROM policy_changes WHERE is_meaningful=1").fetchone()[0]
    original_risk = db.execute("SELECT risk_score FROM change_analysis WHERE change_id=? AND is_current=1", (cid,)).fetchone()[0]
    db.execute("UPDATE change_analysis SET risk_score=3 WHERE change_id=? AND is_current=1", (cid,))  # below the 5 threshold
    ok = _user(db, "digest-ok@example.com")
    unverified = _user(db, "digest-unverified@example.com", verified=False)
    opted_out = _user(db, "digest-optout@example.com", email_enabled=0)
    too_high = _user(db, "digest-highonly@example.com", min_risk=5)
    try:
        notify.main(send_email=True)
        recipients = [r["json"]["to"][0] for r in sent]
        assert recipients == ["digest-ok@example.com"]  # only the verified, opted-in, matching user
        assert db.execute("SELECT COUNT(*) FROM alerts WHERE user_id=? AND emailed_at IS NOT NULL", (ok,)).fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM alerts WHERE user_id IN (?,?,?)", (unverified, opted_out, too_high)).fetchone()[0] == 3

        notify.main(send_email=True)  # second run: alert already emailed, no duplicate
        assert len(sent) == 1

        # A failed delivery leaves the alert pending so the next run retries it.
        db.execute("UPDATE alerts SET emailed_at=NULL WHERE user_id=?", (ok,))
        db.commit()
        responses.append(Resp(500, None, "error"))
        notify.main(send_email=True)
        assert db.execute("SELECT COUNT(*) FROM alerts WHERE user_id=? AND emailed_at IS NULL", (ok,)).fetchone()[0] == 1
    finally:
        db.execute("DELETE FROM users WHERE email LIKE 'digest-%'")
        db.execute("UPDATE change_analysis SET risk_score=? WHERE change_id=? AND is_current=1", (original_risk, cid))
        db.commit()
