"""LLM analyzer output handling, using a fake client (no network)."""
import json

import pytest

from pipeline import analyze_llm

ADDED = "We may use your posts and photos to train our artificial intelligence models.\nWe updated our contact address."


class FakeClient:
    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.calls = 0
        self.models = self

    def generate_content(self, model, contents, config):
        self.calls += 1
        p = self.payloads.pop(0)
        if isinstance(p, Exception):
            raise p
        return type("R", (), {"text": p})()


def good(**over):
    base = {"summary": "Adds permission to train AI models on user posts.", "category": "ai_training",
            "secondary_categories": ["data_collection", "nonsense"], "risk_score": 5, "ai_training_mentioned": True,
            "ai_training_evidence": "We may use your posts and photos to train our artificial intelligence models.",
            "change_direction": "expanded_permission", "reasoning": "New sentence explicitly permits model training.",
            "confidence": 0.9}
    return json.dumps({**base, **over})


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(analyze_llm.time, "sleep", lambda s: None)


def test_valid_output_is_accepted_and_unknown_categories_dropped():
    r = analyze_llm.llm_analyze(FakeClient([good()]), "m", "Acme", "Privacy Policy", ADDED, "")
    assert r.risk_score == 5 and r.ai_training_mentioned and r.secondary_categories == ["data_collection"]


def test_fabricated_evidence_is_removed():
    r = analyze_llm.llm_analyze(FakeClient([good(ai_training_evidence="We sell all your data to model labs.")]),
                                "m", "Acme", "Privacy Policy", ADDED, "")
    assert r.ai_training_mentioned is False and r.ai_training_evidence is None
    assert "evidence not found verbatim" in r.reasoning


def test_invalid_json_and_transient_errors_are_retried():
    client = FakeClient(["not json", RuntimeError("503"), good(risk_score=9), good()])
    r = analyze_llm.llm_analyze(client, "m", "Acme", "Privacy Policy", ADDED, "", retries=4)
    assert client.calls == 4 and r.risk_score == 5


def test_gives_up_after_retries():
    with pytest.raises(RuntimeError):
        analyze_llm.llm_analyze(FakeClient(["{}"] * 3), "m", "Acme", "Privacy Policy", ADDED, "", retries=3)


class ExplodingClient:
    """Fails the test if any LLM request is made."""
    models = property(lambda self: (_ for _ in ()).throw(AssertionError("LLM was called")))


def _current(db, cid):
    return db.execute("SELECT analyzer, risk_score FROM change_analysis WHERE change_id=? AND is_current=1", (cid,)).fetchone()


def test_budget_failure_success_and_cache(monkeypatch, db):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    cid = db.execute("SELECT id FROM policy_changes WHERE is_meaningful=1").fetchone()[0]
    before = tuple(_current(db, cid))
    assert before[0] == "heuristic"
    try:
        # 1. Key set but no explicit budget: no LLM call at all.
        monkeypatch.setattr(analyze_llm, "_gemini_client", lambda: ExplodingClient())
        analyze_llm.main()
        assert tuple(_current(db, cid)) == before

        # 2. Failing provider: run is 'partial', the existing analysis stays current and untouched.
        monkeypatch.setattr(analyze_llm, "_gemini_client", lambda: FakeClient([RuntimeError("503")] * 4))
        analyze_llm.main(limit=1)
        assert tuple(_current(db, cid)) == before
        assert db.execute("SELECT status FROM pipeline_runs WHERE step='analyze' ORDER BY id DESC").fetchone()[0] == "partial"
        assert db.execute("SELECT COUNT(*) FROM change_analysis WHERE change_id=? AND analyzer='llm'", (cid,)).fetchone()[0] == 0

        # 3. Success: the LLM analysis becomes current, with provenance.
        monkeypatch.setattr(analyze_llm, "_gemini_client", lambda: FakeClient([good()]))
        analyze_llm.main(limit=1)
        row = db.execute("SELECT analyzer, model, prompt_version FROM change_analysis WHERE change_id=? AND is_current=1",
                         (cid,)).fetchone()
        assert row[0] == "llm" and row[2] == analyze_llm.PROMPT_VERSION

        # 4. Re-run: cached, no request made (the exploding client would fail the test).
        monkeypatch.setattr(analyze_llm, "_gemini_client", lambda: ExplodingClient())
        analyze_llm.main(limit=5)
        stats = db.execute("SELECT stats FROM pipeline_runs WHERE step='analyze' ORDER BY id DESC").fetchone()[0]
        assert json.loads(stats)["llm_cached"] == 1 and json.loads(stats)["llm_new"] == 0
    finally:
        db.execute("DELETE FROM change_analysis WHERE analyzer='llm'")
        analyze_llm._refresh_current(db, cid)
        db.commit()
    assert tuple(_current(db, cid)) == before


def test_blank_model_setting_means_default(monkeypatch):
    from backend.app.core.config import Settings
    from pipeline.common import DEFAULT_GEMINI_MODEL, gemini_model
    monkeypatch.setenv("GEMINI_MODEL", "")
    assert gemini_model() == DEFAULT_GEMINI_MODEL
    s = Settings(gemini_model="", gemini_api_key="  ")
    assert s.gemini_model == DEFAULT_GEMINI_MODEL and s.llm_configured is False
