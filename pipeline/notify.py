"""Create alerts for followers of changed apps and send email digests (idempotent).

1. For every meaningful change detected after a user started following the app, insert an alert
   (UNIQUE(user_id, change_id) prevents duplicates).
2. For users with email enabled and a verified address, send one digest of un-emailed alerts that match
   their preferences, respecting frequency (instant / daily / weekly). Delivery goes through the same
   email service as the API: Resend when configured, otherwise a local 'logged' outbox entry.
   Alerts are only marked emailed when the provider confirms success.

Usage:  python -m pipeline.notify [--no-email]
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from .common import connect, get_logger, migrate, pipeline_run

log = get_logger("notify")
FREQUENCY = {"instant": timedelta(0), "daily": timedelta(hours=23), "weekly": timedelta(days=6, hours=23)}


def main(send_email: bool = True) -> None:
    conn = connect()
    migrate(conn)
    with pipeline_run(conn, "notify") as stats:
        cur = conn.execute("""INSERT OR IGNORE INTO alerts(user_id, change_id, origin)
                              SELECT f.user_id, c.id, 'pipeline' FROM follows f
                              JOIN documents d ON d.app_id = f.app_id
                              JOIN policy_changes c ON c.document_id = d.id AND c.is_meaningful = 1
                              WHERE c.created_at >= f.created_at""")
        stats["alerts_created"] = cur.rowcount
        conn.commit()
        stats.update(emails_sent=0, emails_logged=0, emails_failed=0)
        if send_email:
            _send_digests(conn, stats)
    log.info("Notify complete: %s", stats)


def _send_digests(conn, stats: dict) -> None:
    from backend.app.core.config import get_settings
    from backend.app.services.email import send_email as deliver

    settings = get_settings()
    users = conn.execute("""SELECT u.id, u.email, u.name, p.min_risk_score, p.frequency, p.ai_training_only
                            FROM users u JOIN notification_preferences p ON p.user_id = u.id
                            WHERE p.email_enabled = 1 AND u.email_verified_at IS NOT NULL""").fetchall()
    now = datetime.now(timezone.utc)
    for u in users:
        last = conn.execute("SELECT MAX(emailed_at) FROM alerts WHERE user_id=?", (u["id"],)).fetchone()[0]
        if last and datetime.fromisoformat(last.replace("Z", "+00:00")) > now - FREQUENCY[u["frequency"]]:
            continue
        items = conn.execute(
            """SELECT al.id, a.name, d.document_type, c.change_date, c.id AS change_id, a.slug, ca.summary, ca.risk_score
               FROM alerts al JOIN policy_changes c ON c.id = al.change_id JOIN documents d ON d.id = c.document_id
               JOIN apps a ON a.id = d.app_id LEFT JOIN change_analysis ca ON ca.change_id = c.id AND ca.is_current = 1
               WHERE al.user_id = ? AND al.emailed_at IS NULL AND al.origin = 'pipeline'
                 AND COALESCE(ca.risk_score, 0) >= ? AND (? = 0 OR ca.ai_training_mentioned = 1)
               ORDER BY c.change_date DESC LIMIT 20""",
            (u["id"], u["min_risk_score"], u["ai_training_only"])).fetchall()
        if not items:
            continue
        lines = [f"Hi {u['name']},", "", f"{len(items)} policy change(s) in apps you follow:", ""]
        for it in items:
            lines += [f"- {it['name']} {it['document_type']} ({it['change_date']}), risk {it['risk_score']}/5",
                      f"  {it['summary'] or ''}",
                      f"  {settings.frontend_url}/apps/{it['slug']}/changes/{it['change_id']}", ""]
        lines += ["Summaries are automated and not legal advice.",
                  f"Change your preferences: {settings.frontend_url}/settings#notifications"]
        status = deliver(conn, u["email"], f"ClauseBerry: {len(items)} policy change(s)", "\n".join(lines), u["id"])
        stats[f"emails_{status}"] += 1
        if status == "sent":
            conn.executemany("UPDATE alerts SET emailed_at=? WHERE id=?",
                             [(now.strftime("%Y-%m-%dT%H:%M:%SZ"), it["id"]) for it in items])
            conn.commit()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-email", action="store_true")
    main(not ap.parse_args().no_email)
