"""Load the ToS Radar dataset into SQLite (idempotent).

- Applies migrations.
- Upserts apps and documents from pipeline.catalog + the dataset's `service` values.
- Inserts policy versions (dedupe key: document, timestamp, sha256(text)); exact duplicate rows are skipped.
- Flags probable capture failures (very short or collapsed texts).
- Copies policy_changes.csv verbatim into source_changes for provenance.

Usage:  python -m pipeline.load_db
"""
from __future__ import annotations

import re
import statistics

import pandas as pd

from .catalog import CATALOG, DEFAULT_META, slugify
from .common import DATASET_DIR, connect, get_logger, migrate, pipeline_run
from .textnorm import NORMALIZER_VERSION, normalize, sha256

log = get_logger("load_db")
REQUIRED_VERSION_COLS = {"service", "document_type", "version_date", "version_datetime", "word_count", "text"}
REQUIRED_CHANGE_COLS = {"service", "document_type", "previous_date", "change_date", "added_text", "removed_text"}
DOC_TYPES = {"Privacy Policy", "Terms of Service"}


def ensure_apps(conn, services: list[str]) -> dict[str, int]:
    for name in sorted(set(services)):
        meta = {**DEFAULT_META, **CATALOG.get(name, {})}
        conn.execute(
            """INSERT INTO apps(slug, name, category, website, description, note) VALUES (?,?,?,?,?,?)
               ON CONFLICT(name) DO UPDATE SET category=excluded.category, website=excluded.website,
                   description=excluded.description, note=excluded.note""",
            (slugify(name), name, meta["category"], meta["website"], meta["description"], meta.get("note")))
        app_id = conn.execute("SELECT id FROM apps WHERE name=?", (name,)).fetchone()[0]
        for dt in DOC_TYPES:
            conn.execute(
                """INSERT INTO documents(app_id, document_type, slug, source_url) VALUES (?,?,?,?)
                   ON CONFLICT(app_id, document_type) DO UPDATE SET source_url=COALESCE(excluded.source_url, documents.source_url)""",
                (app_id, dt, slugify(dt), meta["urls"].get(dt)))
    return {(r["name"], r["document_type"]): r["id"] for r in conn.execute(
        "SELECT a.name, d.document_type, d.id FROM documents d JOIN apps a ON a.id=d.app_id")}


def refresh_normalized_hashes(conn) -> int:
    """Recompute normalized_hash for every version when the normaliser version changes."""
    row = conn.execute("SELECT value FROM pipeline_state WHERE key='normalizer_version'").fetchone()
    if row and row[0] == NORMALIZER_VERSION:
        return 0
    n = 0
    for vid, text in conn.execute("SELECT id, text FROM policy_versions").fetchall():
        conn.execute("UPDATE policy_versions SET normalized_hash=? WHERE id=?", (sha256(normalize(text)), vid))
        n += 1
    conn.execute("INSERT OR REPLACE INTO pipeline_state(key, value) VALUES ('normalizer_version', ?)", (NORMALIZER_VERSION,))
    return n


_ERROR_PAGE = re.compile(r"(this page isn.t available|we.re all mixed up|refresh this page|page not found|"
                         r"something went wrong|access denied|enable javascript)", re.I)


def flag_capture_errors(conn) -> int:
    """Flag probable capture failures rather than treating them as policy rewrites.

    A version is flagged when it is an error page, has < 150 words, or its length is < 25% or > 300%
    of the median of the previous five clean versions *and* the anomaly lasts at most two versions
    (a sustained new length is accepted as a genuine rewrite).
    """
    flagged = 0
    for (doc_id,) in conn.execute("SELECT DISTINCT document_id FROM policy_versions").fetchall():
        rows = conn.execute("SELECT id, word_count, substr(text, 1, 400) AS head FROM policy_versions "
                            "WHERE document_id=? ORDER BY version_datetime, seq, id", (doc_id,)).fetchall()
        ok_history: list[int] = []
        flags = []
        for i, v in enumerate(rows):
            wc = v["word_count"]
            bad = wc < 150 or bool(_ERROR_PAGE.search(v["head"] or ""))
            if not bad and ok_history:
                ref = statistics.median(ok_history[-5:])
                if not (0.25 * ref <= wc <= 3 * ref):
                    # How long does the anomaly persist?
                    following = [r["word_count"] for r in rows[i + 1:i + 4] if r["word_count"] >= 150]
                    persists = sum(1 for w in following if not (0.25 * ref <= w <= 3 * ref))
                    # With no later versions there is no evidence either way: keep it.
                    bad = bool(following) and persists < min(2, len(following))
            flags.append(bad)
            if not bad:
                ok_history.append(wc)
        for v, bad in zip(rows, flags):
            conn.execute("UPDATE policy_versions SET quality_flag=? WHERE id=?",
                         ("suspected_capture_error" if bad else "ok", v["id"]))
            flagged += bad
    return flagged


def main() -> None:
    conn = connect()
    applied = migrate(conn)
    if applied:
        log.info("Applied migrations: %s", ", ".join(applied))

    with pipeline_run(conn, "load_db") as stats:
        versions = pd.read_csv(DATASET_DIR / "policy_versions.csv", keep_default_na=False)
        changes = pd.read_csv(DATASET_DIR / "policy_changes.csv", keep_default_na=False)
        latest = pd.read_csv(DATASET_DIR / "latest_policies.csv", keep_default_na=False)
        for name, df, req in [("policy_versions", versions, REQUIRED_VERSION_COLS),
                              ("policy_changes", changes, REQUIRED_CHANGE_COLS)]:
            missing = req - set(df.columns)
            if missing:
                raise ValueError(f"{name}.csv is missing columns: {sorted(missing)}")

        docs = ensure_apps(conn, list(versions.service.unique()) + list(changes.service.unique()))
        inserted = skipped_dupe = invalid = 0
        seq_counter: dict[tuple[int, str], int] = {}
        for idx, r in enumerate(versions.itertuples(index=False)):
            if r.document_type not in DOC_TYPES or not str(r.text).strip() or len(str(r.version_date)) != 10:
                invalid += 1
                log.warning("Skipping invalid version row %d (%s / %s)", idx, r.service, r.document_type)
                continue
            doc_id = docs[(r.service, r.document_type)]
            key = (doc_id, r.version_datetime)
            seq = seq_counter.get(key, 0)
            text = str(r.text)
            cur = conn.execute(
                """INSERT OR IGNORE INTO policy_versions(document_id, version_date, version_datetime, word_count, text,
                       content_hash, normalized_hash, source, source_ref, seq)
                   VALUES (?,?,?,?,?,?,?, 'dataset', ?, ?)""",
                (doc_id, r.version_date, r.version_datetime, int(r.word_count), text, sha256(text),
                 sha256(normalize(text)), f"policy_versions.csv#row={idx}", seq))
            if cur.rowcount:
                inserted += 1
                seq_counter[key] = seq + 1
            else:
                skipped_dupe += 1
        stats.update(versions_rows=len(versions), versions_inserted=inserted,
                     versions_skipped_duplicate=skipped_dupe, versions_invalid=invalid)

        sc = 0
        for idx, r in enumerate(changes.itertuples(index=False)):
            cur = conn.execute(
                """INSERT OR IGNORE INTO source_changes(document_id, source_row, previous_date, change_date, words_before,
                       words_after, word_count_change, lines_added, lines_removed, added_text, removed_text)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (docs[(r.service, r.document_type)], idx, r.previous_date, r.change_date, int(r.words_before),
                 int(r.words_after), int(r.word_count_change), int(r.lines_added), int(r.lines_removed),
                 r.added_text or None, r.removed_text or None))
            sc += cur.rowcount
        stats["source_changes_inserted"] = sc
        stats["normalized_hashes_refreshed"] = refresh_normalized_hashes(conn)
        stats["capture_errors_flagged"] = flag_capture_errors(conn)

        # Cross-check latest_policies.csv against the latest stored version per document.
        mismatches = 0
        for r in latest.itertuples(index=False):
            row = conn.execute(
                "SELECT content_hash FROM v_latest_version WHERE document_id=?", (docs[(r.service, r.document_type)],)).fetchone()
            if not row or row["content_hash"] != sha256(str(r.text)):
                mismatches += 1
                log.info("latest_policies.csv differs from latest clean version for %s / %s", r.service, r.document_type)
        stats["latest_policies_mismatches"] = mismatches
        conn.commit()

    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ("apps", "documents", "policy_versions", "source_changes")}
    log.info("Load complete: %s | %s", stats, counts)


if __name__ == "__main__":
    main()
