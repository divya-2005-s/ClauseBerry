"""Copy the database without any user data, for sharing pipeline state outside the backend host.

Removes users, sessions, tokens, follows, alerts, preferences, chats, email logs and upgrade interest,
then VACUUMs so deleted pages are not left in the file.

Usage:  python scripts/export_public_state.py <source.db> <dest.db>
"""
from __future__ import annotations

import shutil
import sqlite3
import sys

USER_TABLES = ["chat_messages", "chat_sessions", "alerts", "follows", "notification_preferences", "email_tokens",
               "sessions", "email_outbox", "upgrade_interest", "evaluation_labels", "users"]


def main(src: str, dest: str) -> None:
    con = sqlite3.connect(src)
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.close()
    shutil.copyfile(src, dest)
    con = sqlite3.connect(dest)
    for t in USER_TABLES:
        con.execute(f"DELETE FROM {t}")
    con.commit()
    con.execute("VACUUM")
    remaining = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in USER_TABLES}
    con.close()
    assert not any(remaining.values()), remaining
    print(f"Wrote {dest} with all user tables empty.")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
