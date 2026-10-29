# Evaluation

Two kinds of evaluation exist. Only results that were actually measured are reported here.

## 1. Retrieval and citations (automatic, measured)

`python -m evaluation.scripts.eval_rag` → `evaluation/reports/rag_eval.md`

Ground truth comes from the database: for every app whose latest policy contains explicit AI-training
sentences, the question “Does {app} use my data to train AI models?” should retrieve one of those sentences.

Measured on 2026-10-21, re-run 2026-10-24 and 2026-10-25 (index of 5,492 chunks, `all-MiniLM-L6-v2`, k = 5, extractive answer mode):

| Metric | Result |
|---|---|
| Evidence-hit@5 for explicit AI-training sentences (with constraint parsing) | 11 / 14 = **0.79** |
| App-hit@5, dense retrieval only (no app filter) | **11–12 / 14 = 0.79–0.86** across runs (Twitter is borderline: without a filter its question can retrieve near-identical text from X) |
| Questions answered (extractive mode) | 10 / 10 |
| Quoted passages found verbatim in the cited chunk | **33 / 33** |
| Citation markers pointing to a non-returned source | **0** |

Limits: these checks test retrieval and citation faithfulness, not answer quality. Generative (Gemini)
answers were **not** evaluated because no API key was configured.

## 2. Change analysis (human labels — pending)

**Status: pending.** The labelling sheet exists; no labels have been entered (checked 2026-10-24), so no
accuracy, F1 or agreement figures exist.

### The sample

`evaluation/labels/changes_to_label.csv` holds **40 changes**: **7 per rule-based risk level (35)** plus **5
changes the detector classified as noise** (trivial edits, partial captures, date-only), drawn with a fixed seed.
It contains the change id, app, document, date and the added/removed text (truncated to 6,000 characters).

The analyzer's predictions are **not** in that folder. They are written to `evaluation/predictions/`, which is
git-ignored and can be regenerated at any time, so a reviewer working from the repository never sees them:

```powershell
python -m evaluation.scripts.sample_for_labeling --snapshot-only                 # rule-based / current
python -m evaluation.scripts.sample_for_labeling --snapshot-only --analyzer llm  # after running Gemini
```

### How to label (per row, without looking at ClauseBerry's analysis)

| Column | Allowed values | Meaning |
|---|---|---|
| `label_is_meaningful` | `0` / `1` | Would a privacy-conscious reader care? `0` for formatting, navigation, dates or broken captures. |
| `label_category` | one of `data_collection`, `data_sharing`, `data_retention`, `ai_training`, `advertising_tracking`, `user_rights`, `security`, `international_transfers`, `legal_obligations`, `other` | Main topic (only if meaningful). |
| `label_risk_score` | `1`–`5` | Using the rubric in `docs/architecture.md#risk-rubric` (only if meaningful). |
| `label_ai_training_explicit` | `0` / `1` | `1` only if the added text explicitly allows training/developing AI or ML models. |
| `label_evidence` | free text | The sentence that justifies your labels. |
| `reviewer` | your name | Rows without a reviewer are ignored. |

Tips: open the change in the app at `/apps/<app>/changes/<change_id>` only for the full diff, and keep the
analysis panel out of view; label in a spreadsheet and save as UTF-8 CSV with the same header.

### Scoring

```powershell
python -m evaluation.scripts.compute_metrics                                      # vs rule-based predictions
python -m evaluation.scripts.compute_metrics --predictions predictions_llm.csv    # vs Gemini (same sample)
```

Reports are written to `evaluation/reports/analysis_eval.md` (and `analysis_eval_predictions_llm.md`):
change-detection precision/recall, category accuracy and macro-F1, explicit AI-training precision/recall/F1,
and risk exact / within-±1 agreement plus quadratic-weighted Cohen's κ. Invalid values are listed and excluded,
never guessed; missing predictions stop the run with an error. Labels are also stored in `evaluation_labels`.

Limits: one reviewer's labels measure agreement with that reviewer, not ground truth; with ≤ 40 items the
uncertainty is wide (single-category figures may rest on a handful of examples). The sample was stratified by
rule-based risk, so it over-represents high-risk changes relative to the full set.

## 3. Automated tests

| Suite | Command | Result (2026-10-24) |
|---|---|---|
| Backend (pytest) | `python -m pytest` | see README "Tests" for the latest count |
| Frontend end-to-end (Playwright, real API + data) | `npx playwright test` | see README |
| Frontend type check / lint / build | `npm run typecheck`, `npm run lint`, `npm run build` | see README |
