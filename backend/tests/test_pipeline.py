"""Pipeline logic: normalisation, change detection, noise verdicts, AI-clause classification, risk scoring."""
from pipeline.build_rag import chunk_paragraphs, sections
from pipeline.clean_changes import verdict
from pipeline.taxonomy import classify_ai_sentence, heuristic_analyze
from pipeline.textnorm import diff_texts, inline_diff, normalize_lines


def test_normalize_strips_markup_links_images_and_tables():
    text = "Title\n=====\n**Bold** [link text](https://x.y/z \"t\") ![img](a.png)\n| A | B |\n|---|---|\n| 1 | 2 |\nline<br>two_"
    assert normalize_lines(text) == ["Title", "Bold link text", "A · B", "1 · 2", "line", "two"]


def test_formatting_only_edits_produce_empty_diff():
    a = "We collect [your data](https://a.example) for **security**."
    b = "We collect [your data](https://b.example) for *security*."
    d = diff_texts(a, b)
    assert d.added_lines == [] and d.removed_lines == []


def test_word_level_counts():
    d = diff_texts("We share data with partners.", "We share data with advertising partners and brokers.")
    assert d.words_added == 3 and d.words_removed == 0


def test_inline_diff_marks_modifications():
    blocks = inline_diff("Keep data for 30 days.", "Keep data for 90 days.")
    mod = [b for b in blocks if b["type"] == "modified"][0]
    assert {"op": "insert", "text": "90"} in mod["words"]


def test_verdicts():
    seen = {"h-old"}
    assert verdict(diff_texts("a b", "a b"), "h1", set(), None) == "formatting_only"
    assert verdict(diff_texts("x one two three four five six seven", "y one two three four five six seven nine ten"), "h-old", seen, None) == "reverted_or_variant"
    assert verdict(diff_texts("Last updated: January 1, 2024", "Last updated: March 3, 2024"), "h2", set(), None) == "date_only"
    assert verdict(diff_texts("We collect data.", "We collect your data."), "h3", set(), None) == "trivial_edit"
    big = " ".join(f"word{i}" for i in range(800))
    assert verdict(diff_texts(f"Intro.\n{big}", "Intro."), "h4", set(), None) == "probable_partial_capture"


def test_ai_sentence_classification_distinguishes_training_from_mentions():
    assert classify_ai_sentence("We may use your content to train our artificial intelligence models.") == "explicit_training"
    assert classify_ai_sentence("We use your data to develop and improve generative AI features.") == "explicit_training"
    assert classify_ai_sentence("Try our new AI assistant to write captions.") == "general_ai"
    assert classify_ai_sentence("Our employees receive privacy training every year.") is None
    assert classify_ai_sentence("We use automated decision-making to detect spam.") == "automated_processing"
    assert classify_ai_sentence("We share prompts with third-party AI providers to process your request.") == "ai_provider_sharing"


def test_heuristic_scores_ai_training_expansion_high():
    added = ("We may share your personal information with advertising partners and third parties.\n"
             "We may use your posts to develop and train our artificial intelligence models.")
    a = heuristic_analyze("Privacy Policy", added, "", 30, 0)
    assert a.risk_score >= 4 and a.ai_training_mentioned and a.ai_training_evidence
    assert a.confidence is None  # the rule-based analyzer never invents a confidence


def test_heuristic_scores_editorial_low():
    a = heuristic_analyze("Terms of Service", "Last updated: March 1, 2024", "Last updated: January 1, 2024", 3, 3)
    assert a.risk_score == 1 and a.change_direction == "editorial" and not a.ai_training_mentioned


def test_section_aware_chunking():
    md = "# Data we collect\nWe collect your email.\n\n# Sharing\n" + ("We share with partners. " * 200)
    secs = sections(md)
    assert [s[0] for s in secs] == ["Data we collect", "Sharing"]
    chunks = chunk_paragraphs(secs[1][1], size=100, overlap=20)
    assert len(chunks) >= 7 and all(len(c.split()) <= 100 for c in chunks)


def test_seeded_change_detection(db):
    rows = db.execute("SELECT is_meaningful, noise_reason FROM policy_changes ORDER BY id").fetchall()
    assert [(r[0], r[1]) for r in rows] == [(1, None), (0, "formatting_only"), (0, "trivial_edit")]


def test_analysis_is_cached_and_idempotent(db):
    from pipeline import analyze_llm, clean_changes
    before = db.execute("SELECT COUNT(*) FROM change_analysis").fetchone()[0]
    clean_changes.main()
    analyze_llm.main(heuristic_only=True)
    assert db.execute("SELECT COUNT(*) FROM change_analysis").fetchone()[0] == before
    assert db.execute("SELECT COUNT(*) FROM policy_changes").fetchone()[0] == 3


def test_duplicate_version_rows_are_ignored(db):
    row = db.execute("SELECT document_id, version_date, version_datetime, word_count, text, content_hash, normalized_hash "
                     "FROM policy_versions WHERE id=1").fetchone()
    cur = db.execute("""INSERT OR IGNORE INTO policy_versions(document_id, version_date, version_datetime, word_count, text,
                        content_hash, normalized_hash, source) VALUES (?,?,?,?,?,?,?, 'dataset')""", tuple(row))
    assert cur.rowcount == 0
