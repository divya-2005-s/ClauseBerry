"""Compare human labels with ClauseBerry's analysis and write evaluation/reports/analysis_eval.md.

Only rows with a reviewer name and at least one label are used. Nothing is reported when no labels exist.
Labels are also stored in the evaluation_labels table for provenance.

Metrics:
- change detection: precision / recall of is_meaningful
- category: accuracy and macro-F1 (meaningful changes only)
- AI-training explicit detection: precision, recall, F1
- risk score: exact agreement, within-1 agreement, quadratic-weighted Cohen's kappa
These measure agreement with the reviewer(s), not ground truth.

Usage:  python -m evaluation.scripts.compute_metrics [--predictions predictions_llm.csv]
"""
from __future__ import annotations

import argparse
import csv
from collections import Counter
from datetime import date
from pathlib import Path

from pipeline.common import ROOT, connect
from pipeline.taxonomy import CATEGORIES

LABELS = ROOT / "evaluation" / "labels"            # what reviewers see (committed)
PREDICTIONS = ROOT / "evaluation" / "predictions"  # analyzer output (git-ignored; regenerate with --snapshot-only)
REPORT = ROOT / "evaluation" / "reports" / "analysis_eval.md"


def prf(pairs: list[tuple[bool, bool]]) -> tuple[float, float, float, int]:
    tp = sum(1 for h, p in pairs if h and p)
    fp = sum(1 for h, p in pairs if not h and p)
    fn = sum(1 for h, p in pairs if h and not p)
    prec = tp / (tp + fp) if tp + fp else float("nan")
    rec = tp / (tp + fn) if tp + fn else float("nan")
    f1 = 2 * prec * rec / (prec + rec) if prec == prec and rec == rec and prec + rec else float("nan")
    return prec, rec, f1, len(pairs)


def macro_f1(pairs: list[tuple[str, str]]) -> float:
    labels = {h for h, _ in pairs} | {p for _, p in pairs}
    scores = []
    for lab in labels:
        _, _, f1, _ = prf([(h == lab, p == lab) for h, p in pairs])
        scores.append(0.0 if f1 != f1 else f1)
    return sum(scores) / len(scores) if scores else float("nan")


def quadratic_kappa(pairs: list[tuple[int, int]], k: int = 5) -> float:
    if not pairs:
        return float("nan")
    n = len(pairs)
    obs = [[0] * k for _ in range(k)]
    for a, b in pairs:
        obs[a - 1][b - 1] += 1
    ha, hb = Counter(a for a, _ in pairs), Counter(b for _, b in pairs)
    num = den = 0.0
    for i in range(k):
        for j in range(k):
            w = ((i - j) ** 2) / ((k - 1) ** 2)
            num += w * obs[i][j]
            den += w * ha[i + 1] * hb[j + 1] / n
    return 1 - num / den if den else float("nan")


def _check(value: str, allowed: set[str]) -> str | None:
    """Return the stripped value if valid, '' if blank, None if invalid."""
    v = value.strip()
    if not v:
        return ""
    return v if v in allowed else None


def main(predictions: str = "predictions_snapshot.csv") -> int:
    report = REPORT if predictions == "predictions_snapshot.csv" else REPORT.with_name(f"analysis_eval_{Path(predictions).stem}.md")
    path = LABELS / "changes_to_label.csv"
    rows = list(csv.DictReader(path.open(encoding="utf-8"))) if path.exists() else []
    col = {k.split("(")[0]: k for k in (rows[0].keys() if rows else [])}
    labelled = [r for r in rows if r.get("reviewer", "").strip() and any(r[col[c]].strip() for c in col if c.startswith("label_"))]

    report.parent.mkdir(parents=True, exist_ok=True)
    if not labelled:
        report.write_text(
            "# Analysis evaluation\n\n**Status: pending.** No human labels have been recorded yet, so no accuracy, F1 or "
            "agreement figures are reported.\n\nSee docs/evaluation.md for the labelling procedure.\n", encoding="utf-8")
        print(f"No labels yet in {path} - wrote pending report {report.name}.")
        return 0

    pred_path = PREDICTIONS / predictions
    if not pred_path.exists():
        print(f"{pred_path} not found. Create it with: python -m evaluation.scripts.sample_for_labeling --snapshot-only"
              + ("" if predictions == "predictions_snapshot.csv" else " --analyzer llm"))
        return 1
    preds = {r["change_id"]: r for r in csv.DictReader(pred_path.open(encoding="utf-8"))}
    missing = [r["change_id"] for r in labelled if r["change_id"] not in preds]
    if missing:
        print(f"{pred_path.name} has no row for labelled change(s) {', '.join(missing)}; re-run --snapshot-only.")
        return 1

    # Validate label values; invalid fields are excluded and reported, never guessed.
    allowed = {"label_is_meaningful": {"0", "1"}, "label_ai_training_explicit": {"0", "1"},
               "label_risk_score": {"1", "2", "3", "4", "5"}, "label_category": set(CATEGORIES)}
    invalid: list[str] = []
    clean: list[dict] = []
    for r in labelled:
        out = {"change_id": r["change_id"], "reviewer": r["reviewer"].strip(), "label_evidence": r[col["label_evidence"]].strip()}
        for k, ok in allowed.items():
            v = _check(r[col[k]], ok)
            if v is None:
                invalid.append(f"change {r['change_id']}: {k}={r[col[k]].strip()!r}")
                v = ""
            out[k] = v
        clean.append(out)

    conn = connect()
    for r in clean:
        conn.execute("""INSERT INTO evaluation_labels(change_id, reviewer, is_meaningful, category, risk_score,
                            ai_training_explicit, evidence) VALUES (?,?,?,?,?,?,?)
                        ON CONFLICT(change_id, reviewer) DO UPDATE SET is_meaningful=excluded.is_meaningful,
                            category=excluded.category, risk_score=excluded.risk_score,
                            ai_training_explicit=excluded.ai_training_explicit, evidence=excluded.evidence""",
                     (int(r["change_id"]), r["reviewer"], int(r["label_is_meaningful"]) if r["label_is_meaningful"] else None,
                      r["label_category"] or None, int(r["label_risk_score"]) if r["label_risk_score"] else None,
                      int(r["label_ai_training_explicit"]) if r["label_ai_training_explicit"] else None,
                      r["label_evidence"] or None))
    conn.commit()

    det = [(r["label_is_meaningful"] == "1", preds[r["change_id"]]["is_meaningful"] == "1") for r in clean if r["label_is_meaningful"]]
    # Content metrics: changes the reviewer judged meaningful AND the analyzer actually analysed.
    meaningful = [r for r in clean if r["label_is_meaningful"] == "1" and preds[r["change_id"]]["category"]]
    unanalysed = sum(1 for r in clean if r["label_is_meaningful"] == "1" and not preds[r["change_id"]]["category"])
    cat = [(r["label_category"], preds[r["change_id"]]["category"]) for r in meaningful if r["label_category"]]
    ai = [(r["label_ai_training_explicit"] == "1", preds[r["change_id"]]["ai_training_mentioned"] == "1")
          for r in meaningful if r["label_ai_training_explicit"]]
    risk = [(int(r["label_risk_score"]), int(preds[r["change_id"]]["risk_score"])) for r in meaningful if r["label_risk_score"]]
    analyzers = Counter(f"{preds[r['change_id']]['analyzer']} ({preds[r['change_id']]['model']})"
                        for r in clean if preds[r["change_id"]]["analyzer"])

    f = lambda x: "n/a" if x != x else f"{x:.2f}"  # noqa: E731
    dp, dr, df, dn = prf(det)
    ap_, ar, af, an = prf(ai)
    lines = [
        "# Analysis evaluation", "",
        f"Generated {date.today()} from {len(clean)} labelled changes (of {len(rows)} in the sheet) by "
        f"{len({r['reviewer'] for r in clean})} reviewer(s). Predictions: `{predictions}`; "
        f"analyzer(s): {', '.join(analyzers) or 'n/a'}.", "",
        "These numbers measure agreement with the human reviewer(s), not objective ground truth. "
        "Small samples give wide uncertainty; treat single-digit n as indicative only.", "",
        "| Metric | Value | n |", "|---|---|---|",
        f"| Change detection precision (meaningful) | {f(dp)} | {dn} |",
        f"| Change detection recall (meaningful) | {f(dr)} | {dn} |",
        f"| Category accuracy | {f(sum(h == p for h, p in cat) / len(cat) if cat else float('nan'))} | {len(cat)} |",
        f"| Category macro-F1 | {f(macro_f1(cat))} | {len(cat)} |",
        f"| AI-training precision | {f(ap_)} | {an} |",
        f"| AI-training recall | {f(ar)} | {an} |",
        f"| AI-training F1 | {f(af)} | {an} |",
        f"| Risk exact agreement | {f(sum(h == p for h, p in risk) / len(risk) if risk else float('nan'))} | {len(risk)} |",
        f"| Risk within ±1 | {f(sum(abs(h - p) <= 1 for h, p in risk) / len(risk) if risk else float('nan'))} | {len(risk)} |",
        f"| Risk quadratic-weighted κ | {f(quadratic_kappa(risk))} | {len(risk)} |",
    ]
    if unanalysed:
        lines += ["", f"{unanalysed} change(s) labelled meaningful have no prediction from this analyzer "
                      "(not analysed or classified as noise); they count only in change-detection metrics."]
    if invalid:
        lines += ["", f"**{len(invalid)} invalid label value(s) were excluded:**", *[f"- {x}" for x in invalid]]
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--predictions", default="predictions_snapshot.csv", help="file name inside evaluation/predictions/")
    raise SystemExit(main(ap.parse_args().predictions))
