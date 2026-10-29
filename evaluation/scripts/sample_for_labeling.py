"""Draw a stratified sample of detected changes for blind human labelling.

Writes:
- evaluation/labels/changes_to_label.csv   — what the reviewer sees (no model predictions)
- evaluation/predictions/predictions_snapshot.csv — the analyzer output, kept apart from the sheet and
  git-ignored so reviewers never see it (regenerate any time with --snapshot-only)

The sample mixes meaningful changes across risk levels with some changes the detector marked as noise, so
both the detector and the analyzer can be evaluated. Re-running does not overwrite an existing label file.

Usage:  python -m evaluation.scripts.sample_for_labeling [--n 40] [--seed 7] [--force]
        python -m evaluation.scripts.sample_for_labeling --snapshot-only [--analyzer llm] [--out FILE]
            Re-snapshot predictions for the SAME change ids already in changes_to_label.csv (labels untouched),
            e.g. after running the LLM analyzer, so both analyzers are scored on one labelled sample.
"""
from __future__ import annotations

import argparse
import csv
import random

from pipeline.common import ROOT, connect
from pipeline.taxonomy import CATEGORIES

LABELS = ROOT / "evaluation" / "labels"
PREDICTIONS = ROOT / "evaluation" / "predictions"


PRED_COLUMNS = ["change_id", "is_meaningful", "category", "risk_score", "ai_training_mentioned", "analyzer", "model"]


def prediction_row(conn, cid: int, analyzer: str | None) -> list:
    """Current analysis by default; with `analyzer`, that analyzer's newest analysis (blank if none)."""
    c = conn.execute("SELECT id, is_meaningful FROM policy_changes WHERE id=?", (cid,)).fetchone()
    if analyzer:
        a = conn.execute("""SELECT category, risk_score, ai_training_mentioned, analyzer, model FROM change_analysis
                            WHERE change_id=? AND analyzer=? ORDER BY id DESC LIMIT 1""", (cid, analyzer)).fetchone()
    else:
        a = conn.execute("""SELECT category, risk_score, ai_training_mentioned, analyzer, model FROM change_analysis
                            WHERE change_id=? AND is_current=1""", (cid,)).fetchone()
    return [c[0], c[1], *(a if a else [None] * 5)]


def snapshot_only(analyzer: str | None, out_name: str | None) -> None:
    sheet = LABELS / "changes_to_label.csv"
    if not sheet.exists():
        print(f"{sheet} does not exist; create the sample first.")
        return
    ids = [int(r["change_id"]) for r in csv.DictReader(sheet.open(encoding="utf-8"))]
    PREDICTIONS.mkdir(parents=True, exist_ok=True)
    out = PREDICTIONS / (out_name or (f"predictions_{analyzer}.csv" if analyzer else "predictions_snapshot.csv"))
    conn = connect()
    rows = [prediction_row(conn, cid, analyzer) for cid in ids]
    with out.open("w", newline="", encoding="utf-8") as g:
        p = csv.writer(g)
        p.writerow(PRED_COLUMNS)
        p.writerows(rows)
    missing = sum(1 for r in rows if r[1] == 1 and r[5] is None)
    print(f"Wrote predictions for {len(rows)} sampled changes to {out}"
          + (f" ({missing} meaningful changes have no {analyzer or 'current'} analysis yet)." if missing else "."))


def main(n: int, seed: int, force: bool) -> None:
    out = LABELS / "changes_to_label.csv"
    if out.exists() and not force:
        print(f"{out} already exists; use --force to resample (this discards unsaved labels).")
        return
    conn = connect()
    rng = random.Random(seed)
    by_risk: dict[int, list] = {}
    for r in conn.execute("""SELECT c.id, ca.risk_score FROM policy_changes c
                             JOIN change_analysis ca ON ca.change_id=c.id AND ca.is_current=1 WHERE c.is_meaningful=1"""):
        by_risk.setdefault(r[1], []).append(r[0])
    noise = [r[0] for r in conn.execute("SELECT id FROM policy_changes WHERE is_meaningful=0 AND noise_reason "
                                        "IN ('trivial_edit','probable_partial_capture','date_only')")]
    n_noise = max(4, n // 8)
    per_level = (n - n_noise) // 5
    ids: list[int] = []
    for level in range(1, 6):
        pool = by_risk.get(level, [])
        ids += rng.sample(pool, min(per_level, len(pool)))
    remaining = [i for lvl in by_risk.values() for i in lvl if i not in ids]
    ids += rng.sample(remaining, min(n - n_noise - len(ids), len(remaining)))
    ids += rng.sample(noise, min(n_noise, len(noise)))
    rng.shuffle(ids)

    LABELS.mkdir(parents=True, exist_ok=True)
    PREDICTIONS.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f, \
         (PREDICTIONS / "predictions_snapshot.csv").open("w", newline="", encoding="utf-8") as g:
        w = csv.writer(f)
        w.writerow(["change_id", "app", "document_type", "change_date", "added_text", "removed_text",
                    "label_is_meaningful(0/1)", f"label_category({'|'.join(CATEGORIES)})", "label_risk_score(1-5)",
                    "label_ai_training_explicit(0/1)", "label_evidence", "reviewer"])
        p = csv.writer(g)
        p.writerow(PRED_COLUMNS)
        for cid in ids:
            r = conn.execute("""SELECT c.id, a.name, d.document_type, c.change_date, c.added_text, c.removed_text
                                FROM policy_changes c JOIN documents d ON d.id=c.document_id JOIN apps a ON a.id=d.app_id
                                WHERE c.id=?""", (cid,)).fetchone()
            w.writerow([r[0], r[1], r[2], r[3], r[4][:6000], r[5][:6000], "", "", "", "", "", ""])
            p.writerow(prediction_row(conn, cid, None))
    print(f"Wrote {len(ids)} changes to {out}. Fill in the label_* columns and your name, then run "
          "python -m evaluation.scripts.compute_metrics")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--snapshot-only", action="store_true", help="refresh predictions for the existing sample only")
    ap.add_argument("--analyzer", choices=["heuristic", "llm"], default=None)
    ap.add_argument("--out", default=None, help="file name inside evaluation/predictions/")
    a = ap.parse_args()
    if a.snapshot_only:
        snapshot_only(a.analyzer, a.out)
    else:
        main(a.n, a.seed, a.force)
