"""Detect changes between consecutive clean versions of each document (incremental, idempotent).

For every document, versions flagged as capture errors are skipped and each remaining version is
compared with the previous clean one. Each pair is stored in policy_changes with a noise verdict:

- formatting_only:    normalised texts are identical (links, images, markup, whitespace only)
- reverted_or_variant: the new text equals an earlier version (A/B or regional variants flip-flopping)
- date_only:          only "last updated"/effective-date lines changed
- trivial_edit:       fewer than MIN_WORDS words changed
- probable_partial_capture: >= 500 words disappear with almost nothing added (collapsed sections,
                      partially loaded pages)
- restored_after_partial_capture: the text that disappeared in a partial capture comes back
- source_format_boundary: first fetched version after archived ones. ClauseBerry's HTML converter formats
                      text differently from the archive's, so this diff mixes formatting with real edits; it
                      is kept for inspection but excluded from analytics. Later fetched->fetched diffs are clean.
Anything else is `is_meaningful = 1`.

A missing historical version is never interpreted as a clause being new: changes are only computed
between versions that actually exist in the archive.

Usage:  python -m pipeline.clean_changes [--rebuild]
"""
from __future__ import annotations

import argparse

from .common import connect, get_logger, migrate, pipeline_run
from .taxonomy import _DATE_ONLY
from .textnorm import DETECTOR_VERSION, DiffResult, diff_texts, sha256, word_count

log = get_logger("clean_changes")
MIN_WORDS = 8


def verdict(diff, to_hash: str, seen_hashes: set[str], prev_reason: str | None) -> str | None:
    if not diff.added_lines and not diff.removed_lines:
        return "formatting_only"
    if to_hash in seen_hashes:
        return "reverted_or_variant"
    lines = diff.added_lines + diff.removed_lines
    if all(_DATE_ONLY.match(l) for l in lines):
        return "date_only"
    if diff.words_added + diff.words_removed < MIN_WORDS:
        return "trivial_edit"
    if diff.words_removed >= 500 and diff.words_added <= 0.05 * diff.words_removed:
        return "probable_partial_capture"
    if (prev_reason == "probable_partial_capture" and diff.words_added >= 500
            and diff.words_removed <= 0.05 * diff.words_added):
        return "restored_after_partial_capture"
    return None


def main(rebuild: bool = False) -> None:
    conn = connect()
    migrate(conn)
    with pipeline_run(conn, "clean_changes") as stats:
        stats.update(pairs=0, inserted=0, updated=0, meaningful=0, skipped_existing=0)
        docs = conn.execute("SELECT id FROM documents ORDER BY id").fetchall()
        for (doc_id,) in docs:
            versions = conn.execute(
                """SELECT id, version_date, word_count, normalized_hash, source FROM policy_versions
                   WHERE document_id=? AND quality_flag='ok' ORDER BY version_datetime, seq, id""", (doc_id,)).fetchall()
            existing = {(r["from_version_id"], r["to_version_id"]): r["detector_version"] for r in conn.execute(
                "SELECT from_version_id, to_version_id, detector_version FROM policy_changes WHERE document_id=?", (doc_id,))}
            seen: set[str] = set()
            prev_reason: str | None = None
            for prev, cur in zip(versions, versions[1:]):
                seen.add(prev["normalized_hash"])
                stats["pairs"] += 1
                key = (prev["id"], cur["id"])
                if key in existing and existing[key] == DETECTOR_VERSION and not rebuild:
                    stats["skipped_existing"] += 1
                    prev_reason = conn.execute("SELECT noise_reason FROM policy_changes WHERE from_version_id=? "
                                               "AND to_version_id=?", key).fetchone()[0]
                    continue
                old_text = conn.execute("SELECT text FROM policy_versions WHERE id=?", (prev["id"],)).fetchone()[0]
                new_text = conn.execute("SELECT text FROM policy_versions WHERE id=?", (cur["id"],)).fetchone()[0]
                if prev["normalized_hash"] == cur["normalized_hash"]:
                    diff = DiffResult([], [], 0, 0)
                else:
                    diff = diff_texts(old_text, new_text)
                reason = verdict(diff, cur["normalized_hash"], seen - {prev["normalized_hash"]}, prev_reason)
                if reason is None and prev["source"] == "dataset" and cur["source"] == "fetched":
                    reason = "source_format_boundary"
                prev_reason = reason
                params = (doc_id, prev["id"], cur["id"], prev["version_date"], cur["version_date"],
                          word_count(old_text), word_count(new_text), diff.words_added, diff.words_removed,
                          len(diff.added_lines), len(diff.removed_lines), diff.added_text, diff.removed_text,
                          int(reason is None), reason, sha256(diff.added_text + "\x00" + diff.removed_text),
                          DETECTOR_VERSION)
                conn.execute(
                    """INSERT INTO policy_changes(document_id, from_version_id, to_version_id, previous_date, change_date,
                           words_before, words_after, words_added, words_removed, lines_added, lines_removed,
                           added_text, removed_text, is_meaningful, noise_reason, change_hash, detector_version)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(from_version_id, to_version_id) DO UPDATE SET
                           words_added=excluded.words_added, words_removed=excluded.words_removed,
                           lines_added=excluded.lines_added, lines_removed=excluded.lines_removed,
                           added_text=excluded.added_text, removed_text=excluded.removed_text,
                           is_meaningful=excluded.is_meaningful, noise_reason=excluded.noise_reason,
                           change_hash=excluded.change_hash, detector_version=excluded.detector_version""", params)
                stats["updated" if key in existing else "inserted"] += 1
                stats["meaningful"] += reason is None
            conn.commit()
        stats["total_changes"] = conn.execute("SELECT COUNT(*) FROM policy_changes").fetchone()[0]
        stats["total_meaningful"] = conn.execute("SELECT COUNT(*) FROM policy_changes WHERE is_meaningful=1").fetchone()[0]
        stats["noise_breakdown"] = {r[0]: r[1] for r in conn.execute(
            "SELECT noise_reason, COUNT(*) FROM policy_changes WHERE is_meaningful=0 GROUP BY noise_reason")}
    log.info("Change detection complete: %s", stats)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true", help="recompute every pair even if already stored")
    main(ap.parse_args().rebuild)
