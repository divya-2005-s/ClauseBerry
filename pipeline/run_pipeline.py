"""Run the full incremental pipeline in order. Every step is idempotent and safe to re-run.

  python -m pipeline.run_pipeline                  # daily run (fetch + everything downstream)
  python -m pipeline.run_pipeline --skip-fetch     # rebuild from the dataset only
  python -m pipeline.run_pipeline --skip-rag       # skip embedding work
  python -m pipeline.run_pipeline --skip-load      # routine run on an already-seeded volume (no dataset needed)

A lock file next to the database prevents overlapping runs on the same machine.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

from . import ai_clauses, analyze_llm, build_rag, clean_changes, fetch_policies, load_db, notify
from .common import DATASET_DIR, db_path, get_logger

log = get_logger("run_pipeline")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-load", action="store_true",
                    help="don't re-read tos_radar_dataset/ (it is static; the image does not contain it)")
    ap.add_argument("--skip-fetch", action="store_true")
    ap.add_argument("--skip-rag", action="store_true")
    ap.add_argument("--no-email", action="store_true")
    ap.add_argument("--llm-limit", type=int, default=0,
                    help="maximum new Gemini calls this run (default 0 = rule-based only)")
    args = ap.parse_args()

    if not args.skip_load and not (DATASET_DIR / "policy_versions.csv").exists():
        log.error("Dataset not found at %s. On a seeded server use --skip-load.", DATASET_DIR)
        return 2
    lock = db_path().parent / ".pipeline.lock"   # on the data volume, writable by the service user
    lock.parent.mkdir(parents=True, exist_ok=True)
    if lock.exists() and time.time() - lock.stat().st_mtime < 6 * 3600:
        log.error("Another pipeline run appears to be active (%s). Exiting.", lock)
        return 1
    lock.write_text(str(os.getpid()))
    try:
        if not args.skip_load:
            load_db.main()
        if not args.skip_fetch:
            fetch_policies.main()
        clean_changes.main()
        analyze_llm.main(limit=args.llm_limit)
        ai_clauses.main()
        if not args.skip_rag:
            build_rag.main()
        notify.main(send_email=not args.no_email)
    finally:
        lock.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
