"""Evaluation maths and the label → report flow (synthetic labels in a temp folder; real sheet untouched)."""
import csv

import pytest

from evaluation.scripts import compute_metrics as cm

HEADER = ["change_id", "app", "document_type", "change_date", "added_text", "removed_text",
          "label_is_meaningful(0/1)", "label_category(x)", "label_risk_score(1-5)",
          "label_ai_training_explicit(0/1)", "label_evidence", "reviewer"]
PRED_HEADER = ["change_id", "is_meaningful", "category", "risk_score", "ai_training_mentioned", "analyzer", "model"]


def test_prf_and_macro_f1():
    p, r, f1, n = cm.prf([(True, True), (True, False), (False, True), (False, False)])
    assert (p, r, f1, n) == (0.5, 0.5, 0.5, 4)
    assert cm.macro_f1([("a", "a"), ("b", "b")]) == 1.0


def test_quadratic_kappa():
    assert cm.quadratic_kappa([(1, 1), (3, 3), (5, 5), (2, 2)]) == 1.0
    assert cm.quadratic_kappa([(1, 5), (5, 1), (1, 5), (5, 1)]) < 0
    assert cm.quadratic_kappa([]) != cm.quadratic_kappa([])  # NaN when no pairs


@pytest.fixture()
def dirs(tmp_path, monkeypatch):
    labels, preds = tmp_path / "labels", tmp_path / "predictions"
    labels.mkdir()
    preds.mkdir()
    monkeypatch.setattr(cm, "LABELS", labels)
    monkeypatch.setattr(cm, "PREDICTIONS", preds)
    monkeypatch.setattr(cm, "REPORT", tmp_path / "analysis_eval.md")
    return tmp_path, labels, preds


def write(path, header, rows):
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def test_pending_report_without_labels(dirs):
    tmp, labels, _ = dirs
    write(labels / "changes_to_label.csv", HEADER, [[1, "A", "Privacy Policy", "2024-01-01", "", "", "", "", "", "", "", ""]])
    assert cm.main() == 0
    assert "pending" in (tmp / "analysis_eval.md").read_text(encoding="utf-8")


def test_metrics_from_labels(dirs, db):
    tmp, labels, preds = dirs
    cid = db.execute("SELECT id FROM policy_changes WHERE is_meaningful=1").fetchone()[0]
    write(labels / "changes_to_label.csv", HEADER, [
        [cid, "Acme", "Privacy Policy", "2024-03-01", "", "", "1", "ai_training", "5", "1", "train", "Reviewer A"],
        [999, "Acme", "Privacy Policy", "2024-03-01", "", "", "", "", "", "", "", ""],  # unlabelled: ignored
    ])
    write(preds / "predictions_snapshot.csv", PRED_HEADER, [[cid, 1, "ai_training", 4, 1, "heuristic", "rules-v1"]])
    assert cm.main() == 0
    text = (tmp / "analysis_eval.md").read_text(encoding="utf-8")
    assert "1 labelled changes (of 2 in the sheet) by 1 reviewer" in text
    assert "| Risk exact agreement | 0.00 | 1 |" in text and "| Risk within ±1 | 1.00 | 1 |" in text
    assert db.execute("SELECT reviewer FROM evaluation_labels WHERE change_id=?", (cid,)).fetchone()[0] == "Reviewer A"


def test_predictions_argument_selects_that_file(dirs, db):
    """Regression: --predictions must score the named file, not the default snapshot."""
    tmp, labels, preds = dirs
    cid = db.execute("SELECT id FROM policy_changes WHERE is_meaningful=1").fetchone()[0]
    write(labels / "changes_to_label.csv", HEADER,
          [[cid, "Acme", "Privacy Policy", "2024-03-01", "", "", "1", "ai_training", "5", "1", "", "R"]])
    write(preds / "predictions_snapshot.csv", PRED_HEADER, [[cid, 1, "other", 1, 0, "heuristic", "rules-v1"]])
    write(preds / "predictions_llm.csv", PRED_HEADER, [[cid, 1, "ai_training", 5, 1, "llm", "gemini-x"]])
    assert cm.main("predictions_llm.csv") == 0
    text = (tmp / "analysis_eval_predictions_llm.md").read_text(encoding="utf-8")
    assert "llm (gemini-x)" in text and "| Risk exact agreement | 1.00 | 1 |" in text and "| Category accuracy | 1.00 | 1 |" in text


def test_missing_predictions_and_invalid_labels(dirs, db):
    tmp, labels, preds = dirs
    cid = db.execute("SELECT id FROM policy_changes WHERE is_meaningful=1").fetchone()[0]
    write(labels / "changes_to_label.csv", HEADER,
          [[cid, "Acme", "Privacy Policy", "2024-03-01", "", "", "1", "made_up", "9", "yes", "", "R"]])
    assert cm.main() == 1  # no predictions file: fail loudly, write nothing misleading
    write(preds / "predictions_snapshot.csv", PRED_HEADER, [[cid, 1, "ai_training", 4, 1, "heuristic", "rules-v1"]])
    assert cm.main() == 0
    text = (tmp / "analysis_eval.md").read_text(encoding="utf-8")
    assert "3 invalid label value(s) were excluded" in text
    assert "| Risk exact agreement | n/a | 0 |" in text and "| Category accuracy | n/a | 0 |" in text
