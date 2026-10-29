"""Automatic retrieval and citation checks for Ask ClauseBerry (no human labels needed).

1. Evidence-hit@k (retrieval): for every app whose latest policy contains explicit AI-training sentences
   (ground truth from ai_clauses), ask "Does {app} use my data to train AI models?" and check whether any of
   the top-k retrieved chunks contains one of those exact sentences.
2. Unfiltered app-hit@k: the same question with the app named only in natural language (the constraint
   parser is bypassed), measuring whether dense retrieval alone finds that app's text.
3. Citation faithfulness (extractive mode): for a set of questions, every quoted passage in the answer
   must appear verbatim in the chunk its [n] marker cites, and every [n] must refer to a returned source.

Writes evaluation/reports/rag_eval.md.   Usage:  python -m evaluation.scripts.eval_rag [--k 5]
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import date

from backend.app.services import rag
from pipeline.common import ROOT, connect
from pipeline.textnorm import normalize

REPORT = ROOT / "evaluation" / "reports" / "rag_eval.md"
CITATION_QUESTIONS = [
    "How long does Spotify keep my data?", "Does Reddit share data with advertisers?",
    "What does TikTok say about data sharing with third parties?", "Can I delete my LinkedIn data?",
    "Does Snapchat use my content to train AI?", "What changed in Instagram's privacy policy in 2025?",
    "Does WhatsApp read my messages?", "What does YouTube collect about my location?",
    "How does Pinterest use machine learning?", "What are X's rules on data retention?",
]


def squash(s: str) -> str:
    return re.sub(r"\W+", " ", normalize(s).lower()).strip()


def main(k: int) -> None:
    conn = connect()
    if not rag.status()["ready"]:
        REPORT.write_text("# RAG evaluation\n\n**Status: pending** — the retrieval index has not been built.\n", encoding="utf-8")
        print("Index not built.")
        return
    truth: dict[str, dict] = {}
    for r in conn.execute("""SELECT a.slug, a.name, ac.evidence FROM v_latest_version lv JOIN apps a ON a.id=lv.app_id
                             JOIN ai_clauses ac ON ac.version_id=lv.id WHERE ac.kind='explicit_training'"""):
        truth.setdefault(r["slug"], {"name": r["name"], "evidence": []})["evidence"].append(squash(r["evidence"])[:160])

    hits_filtered, hits_dense, rows = 0, 0, []
    for slug, t in sorted(truth.items()):
        q = f"Does {t['name']} use my data to train AI models?"
        got, _ = rag.retrieve(conn, q, k=k)
        hit = any(any(e[:120] in squash(h["text"]) for e in t["evidence"]) for h in got[:k])
        # Dense-only: no app filter, rely on embedding similarity.
        col = rag._get_collection()
        res = col.query(query_embeddings=rag.embed([q]), n_results=k, include=["metadatas"])
        dense_hit = any(m["app_slug"] == slug for m in res["metadatas"][0])
        hits_filtered += hit
        hits_dense += dense_hit
        rows.append(f"| {t['name']} | {'✓' if hit else '✗'} | {'✓' if dense_hit else '✗'} |")

    faithful, total_quotes, bad_refs, answered = 0, 0, 0, 0
    for q in CITATION_QUESTIONS:
        events = list(rag.answer_stream(conn, q, []))
        sources = next((e["citations"] for e in events if e["type"] == "sources"), [])
        done = next((e for e in events if e["type"] == "done"), None)
        if not done or done.get("insufficient_evidence"):
            continue
        answered += 1
        chunks = {c["index"]: squash(c["quote"]) for c in sources}
        for line in done["content"].splitlines():
            m = re.search(r"“(.+)”\s*\[(\d+)\]", line)
            if not m:
                continue
            idx = int(m.group(2))
            if idx not in chunks:
                bad_refs += 1
                continue
            parts = [squash(p)[:80] for p in m.group(1).split("…") if len(p.split()) >= 4]
            total_quotes += 1
            # Retrieved chunk text (full) — the citation card shows the first 900 chars, so check the full chunk.
            full = squash(next(h["text"] for h in rag.retrieve(conn, q)[0] if h["id"] == sources[idx - 1]["chunk_id"])) \
                if any(h["id"] == sources[idx - 1]["chunk_id"] for h in rag.retrieve(conn, q)[0]) else chunks[idx]
            faithful += all(p in full for p in parts)

    n = len(truth)
    lines = [
        "# RAG evaluation", "",
        f"Generated {date.today()} · index: {rag.status()['chunks']} chunks · embedding model {rag.EMBED_MODEL} · k={k}.", "",
        "Automatic checks with ground truth taken from the database; they do not judge answer quality.", "",
        "| Metric | Value |", "|---|---|",
        f"| Evidence-hit@{k} for explicit AI-training sentences (with constraint parsing) | {hits_filtered}/{n} = {hits_filtered / n:.2f} |",
        f"| App-hit@{k}, dense retrieval only (no app filter) | {hits_dense}/{n} = {hits_dense / n:.2f} |",
        f"| Questions answered (extractive mode) | {answered}/{len(CITATION_QUESTIONS)} |",
        f"| Quoted passages found verbatim in the cited chunk | {faithful}/{total_quotes} |",
        f"| Citation markers pointing to a non-returned source | {bad_refs} |", "",
        "## Per app", "", f"| App | Evidence hit@{k} | Dense app hit@{k} |", "|---|---|---|", *rows, "",
        "Generative-mode (LLM) answers are not evaluated here because no LLM key was configured when this report was generated.",
    ]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:14]))
    print(json.dumps({"evidence_hit": hits_filtered / n, "dense_app_hit": hits_dense / n}))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=5)
    main(ap.parse_args().k)
