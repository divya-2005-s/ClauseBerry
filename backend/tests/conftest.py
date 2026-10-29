"""Test fixtures: an isolated SQLite database seeded with synthetic policy versions.

The real pipeline steps (change detection, analysis, AI-clause extraction) run against the seed, so the
API is tested end to end without touching data/clauseberry.db.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="clauseberry-test-"))
os.environ["CLAUSEBERRY_DB_PATH"] = str(_TMP / "test.db")
os.environ["CLAUSEBERRY_CHROMA_PATH"] = str(_TMP / "chroma-missing")
os.environ["APP_ENV"] = "test"
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("RESEND_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from pipeline import ai_clauses, analyze_llm, clean_changes  # noqa: E402
from pipeline.common import connect, migrate  # noqa: E402
from pipeline.textnorm import normalize, sha256  # noqa: E402

BASE = """Privacy Policy
==============

**Last updated: January 1, 2024**

## Information we collect
We collect information you provide when you create an account, such as your name and email address.
We collect device information and approximate location to keep the service secure.

## How we share information
We share information with service providers who process it on our behalf.

## Your rights
You can access, correct and delete your personal information in Settings.
"""

V2 = BASE.replace("**Last updated: January 1, 2024**", "**Last updated: March 1, 2024**").replace(
    "We share information with service providers who process it on our behalf.",
    "We share information with service providers who process it on our behalf.\n"
    "We may also share your personal information with advertising partners and third parties to measure ads and "
    "personalize the content you see across other websites and apps.\n"
    "We may use your posts, photos and other content to develop and train our artificial intelligence models.",
)
V3_FORMAT_ONLY = V2.replace("Settings.", "[Settings](https://example.com/settings).")


def _seed() -> None:
    conn = connect()
    migrate(conn)
    conn.execute("INSERT INTO apps(slug, name, category) VALUES ('acme','Acme','Social network'), ('beta','Beta','Messaging')")
    for app_id in (1, 2):
        conn.execute("INSERT INTO documents(app_id, document_type, slug) VALUES (?, 'Privacy Policy', 'privacy-policy')", (app_id,))
        conn.execute("INSERT INTO documents(app_id, document_type, slug) VALUES (?, 'Terms of Service', 'terms-of-service')", (app_id,))
    versions = [(1, "2024-01-01", BASE), (1, "2024-03-01", V2), (1, "2024-04-01", V3_FORMAT_ONLY),
                (3, "2024-01-01", BASE), (3, "2024-02-01", BASE.replace("Settings", "the Privacy Center"))]
    for doc_id, date, text in versions:
        conn.execute(
            """INSERT INTO policy_versions(document_id, version_date, version_datetime, word_count, text, content_hash,
                   normalized_hash, source, source_ref) VALUES (?,?,?,?,?,?,?, 'dataset', 'fixture')""",
            (doc_id, date, f"{date}T00:00:00+00:00", len(text.split()), text, sha256(text), sha256(normalize(text))))
    conn.commit()
    conn.close()
    clean_changes.main()
    analyze_llm.main(heuristic_only=True)
    ai_clauses.main()


_seed()


@pytest.fixture(scope="session")
def app():
    from backend.app.main import app as fastapi_app
    return fastapi_app


@pytest.fixture()
def client(app):
    from backend.app.core.ratelimit import limiter
    limiter.reset()
    with TestClient(app) as c:
        yield c


_counter = iter(range(10_000))


def signup(client: TestClient, name: str = "Test User") -> dict:
    email = f"user{next(_counter)}@example.com"
    r = client.post("/api/auth/signup", json={"name": name, "email": email, "password": "Purple-Orchard-91", "accept_terms": True})
    assert r.status_code == 201, r.text
    body = r.json()
    client.headers["X-CSRF-Token"] = body["csrf_token"]
    return {**body, "email": email, "password": "Purple-Orchard-91"}


@pytest.fixture()
def user_client(client):
    signup(client)
    return client


@pytest.fixture()
def db():
    conn = connect()
    yield conn
    conn.close()
