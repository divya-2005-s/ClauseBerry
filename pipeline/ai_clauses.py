"""Extract AI-related clauses (sentence-level evidence) from every clean policy version (incremental).

Kinds (most specific wins per sentence): explicit_training, ai_provider_sharing, automated_processing,
general_ai. See pipeline.taxonomy.classify_ai_sentence.

Usage:  python -m pipeline.ai_clauses [--rebuild]
"""
from __future__ import annotations

import argparse

from .common import connect, get_logger, migrate, pipeline_run
from .taxonomy import detect_ai_clauses
from .textnorm import NORMALIZER_VERSION

log = get_logger("ai_clauses")
CLAUSE_DETECTOR_VERSION = f"ai-clauses-v1+{NORMALIZER_VERSION}"


def main(rebuild: bool = False) -> None:
    conn = connect()
    migrate(conn)
    conn.execute("CREATE TABLE IF NOT EXISTS ai_clause_scans (version_id INTEGER PRIMARY KEY "
                 "REFERENCES policy_versions(id) ON DELETE CASCADE, detector_version TEXT NOT NULL)")
    with pipeline_run(conn, "ai_clauses") as stats:
        if rebuild:
            conn.execute("DELETE FROM ai_clauses")
            conn.execute("DELETE FROM ai_clause_scans")
        todo = conn.execute(
            """SELECT v.id FROM policy_versions v LEFT JOIN ai_clause_scans s ON s.version_id = v.id
               WHERE v.quality_flag='ok' AND (s.version_id IS NULL OR s.detector_version != ?)""",
            (CLAUSE_DETECTOR_VERSION,)).fetchall()
        stats.update(versions_scanned=0, clauses=0)
        cache: dict[str, list] = {}
        for (vid,) in todo:
            text, nh = conn.execute("SELECT text, normalized_hash FROM policy_versions WHERE id=?", (vid,)).fetchone()
            found = cache.get(nh)
            if found is None:
                found = cache[nh] = detect_ai_clauses(text)
            conn.execute("DELETE FROM ai_clauses WHERE version_id=?", (vid,))
            conn.executemany("INSERT OR IGNORE INTO ai_clauses(version_id, kind, evidence, clause_hash) VALUES (?,?,?,?)",
                             [(vid, k, e, h) for k, e, h in found])
            conn.execute("INSERT OR REPLACE INTO ai_clause_scans(version_id, detector_version) VALUES (?,?)",
                         (vid, CLAUSE_DETECTOR_VERSION))
            stats["versions_scanned"] += 1
            stats["clauses"] += len(found)
            if stats["versions_scanned"] % 200 == 0:
                conn.commit()
                log.info("…%d versions scanned", stats["versions_scanned"])
        conn.commit()
        stats["by_kind"] = {r[0]: r[1] for r in conn.execute("SELECT kind, COUNT(*) FROM ai_clauses GROUP BY kind")}
    log.info("AI clause extraction complete: %s", stats)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true")
    main(ap.parse_args().rebuild)
