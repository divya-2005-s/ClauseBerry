"""Build / update the ChromaDB retrieval index (incremental).

Indexed documents:
- kind=policy: the latest clean version of every policy document, split into section-aware chunks.
- kind=change: each meaningful change (its current analysis summary + added/removed text).

Chunk ids are stable (`v{version_id}-{n}`, `c{change_id}-{n}`), and a manifest of indexed source ids
is kept in the collection metadata, so unchanged sources are never re-embedded. When a document gets
a new latest version, the old version's chunks are deleted.

Usage:  python -m pipeline.build_rag [--rebuild]
"""
from __future__ import annotations

import argparse
import os
import re
from functools import lru_cache

from .common import chroma_path, connect, get_logger, migrate, pipeline_run
from .textnorm import clean_line, sha256

log = get_logger("build_rag")

COLLECTION = "policy_chunks"
CHUNK_WORDS = int(os.environ.get("RAG_CHUNK_WORDS", 220))
CHUNK_OVERLAP = int(os.environ.get("RAG_CHUNK_OVERLAP", 40))
EMBED_MODEL = os.environ.get("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
CHUNKER_VERSION = f"chunk-v1-{CHUNK_WORDS}-{CHUNK_OVERLAP}-{EMBED_MODEL}"

_MD_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.+)$")
_RULE = re.compile(r"^\s*(=+|-+)\s*$")


@lru_cache(maxsize=1)
def get_embedder():
    import logging

    from sentence_transformers import SentenceTransformer

    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:  # avoid network round-trips once the model is cached
        return SentenceTransformer(EMBED_MODEL, device="cpu", local_files_only=True)
    except Exception:
        return SentenceTransformer(EMBED_MODEL, device="cpu")


def embed(texts: list[str]) -> list[list[float]]:
    return get_embedder().encode(texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False).tolist()


def get_collection(client=None):
    import chromadb
    client = client or chromadb.PersistentClient(path=str(chroma_path()))
    return client.get_or_create_collection(COLLECTION, metadata={"hnsw:space": "cosine"})


def sections(markdown: str) -> list[tuple[str, list[str]]]:
    """Split markdown into (heading, paragraphs) using '#' headings and setext (===/---) underlines."""
    raw = markdown.splitlines()
    out: list[tuple[str, list[str]]] = []
    heading, paras = "Introduction", []
    for i, line in enumerate(raw):
        nxt = raw[i + 1] if i + 1 < len(raw) else ""
        m = _MD_HEADING.match(line)
        is_setext = bool(line.strip()) and _RULE.match(nxt) and len(line.strip()) < 140
        if m or is_setext:
            if paras:
                out.append((heading, paras))
            heading, paras = clean_line(m.group(1) if m else line)[:140] or heading, []
            continue
        if _RULE.match(line):
            continue
        c = clean_line(line)
        if len(c) > 1:
            paras.append(c)
    if paras:
        out.append((heading, paras))
    return out


def chunk_paragraphs(paras: list[str], size: int = CHUNK_WORDS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Greedy paragraph packing up to `size` words; long paragraphs are split with word overlap."""
    chunks, cur, cur_n = [], [], 0
    for p in paras:
        words = p.split()
        if len(words) > size:
            if cur:
                chunks.append(" ".join(cur)); cur, cur_n = [], 0
            step = size - overlap
            for i in range(0, len(words), step):
                chunks.append(" ".join(words[i:i + size]))
                if i + size >= len(words):
                    break
            continue
        if cur_n + len(words) > size and cur:
            chunks.append(" ".join(cur))
            tail = " ".join(cur).split()[-overlap:] if overlap else []
            cur, cur_n = ([" ".join(tail)] if tail else []), len(tail)
        cur.append(p)
        cur_n += len(words)
    if cur and cur_n > (overlap if chunks else 0):
        chunks.append(" ".join(cur))
    return chunks


def policy_chunks(version: dict) -> list[tuple[str, str, dict]]:
    out = []
    n = 0
    for heading, paras in sections(version["text"]):
        for body in chunk_paragraphs(paras):
            if len(body.split()) < 8:
                continue
            doc = f"{version['app_name']} — {version['document_type']} — {heading}\n{body}"
            out.append((f"v{version['id']}-{n}", doc, {
                "kind": "policy", "app_name": version["app_name"], "app_slug": version["app_slug"],
                "document_type": version["document_type"], "version_id": version["id"],
                "version_date": version["version_date"], "year": int(version["version_date"][:4]),
                "section": heading, "chunk_index": n, "change_id": -1}))
            n += 1
    return out


def change_chunks(ch: dict) -> list[tuple[str, str, dict]]:
    header = (f"{ch['app_name']} — {ch['document_type']} — change on {ch['change_date']} "
              f"(previous version {ch['previous_date']})\nSummary: {ch['summary'] or 'n/a'}")
    paras = ([f"Added: {l}" for l in ch["added_text"].splitlines() if l.strip()] +
             [f"Removed: {l}" for l in ch["removed_text"].splitlines() if l.strip()])
    out = []
    for n, body in enumerate(chunk_paragraphs(paras)[:12]):  # cap very large rewrites
        out.append((f"c{ch['id']}-{n}", f"{header}\n{body}", {
            "kind": "change", "app_name": ch["app_name"], "app_slug": ch["app_slug"],
            "document_type": ch["document_type"], "version_id": ch["to_version_id"],
            "version_date": ch["change_date"], "year": int(ch["change_date"][:4]),
            "section": "Policy change", "chunk_index": n, "change_id": ch["id"]}))
    return out


def main(rebuild: bool = False) -> None:
    import chromadb

    conn = connect()
    migrate(conn)
    chroma_path().mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(chroma_path()))
    if rebuild:
        try:
            client.delete_collection(COLLECTION)
        except Exception:
            pass
    col = get_collection(client)

    with pipeline_run(conn, "build_rag") as stats:
        sources: dict[str, list[tuple[str, str, dict]]] = {}
        for v in conn.execute(
                """SELECT lv.id, pv.text, lv.version_date, lv.document_type, a.name AS app_name, a.slug AS app_slug
                   FROM v_latest_version lv JOIN apps a ON a.id = lv.app_id
                   JOIN policy_versions pv ON pv.id = lv.id"""):
            sources[f"v{v['id']}"] = policy_chunks(dict(v))
        for ch in conn.execute(
                """SELECT c.id, c.change_date, c.previous_date, c.added_text, c.removed_text, c.to_version_id,
                          d.document_type, a.name AS app_name, a.slug AS app_slug, ca.summary
                   FROM policy_changes c JOIN documents d ON d.id=c.document_id JOIN apps a ON a.id=d.app_id
                   LEFT JOIN change_analysis ca ON ca.change_id=c.id AND ca.is_current=1
                   WHERE c.is_meaningful=1"""):
            sources[f"c{ch['id']}"] = change_chunks(dict(ch))

        # Fingerprint each source so re-runs only touch what changed.
        fingerprints = {sid: sha256(CHUNKER_VERSION + "".join(d for _, d, _ in chunks)) for sid, chunks in sources.items()}
        existing: dict[str, str] = {}
        got = col.get(include=["metadatas"], where={"chunk_index": 0}) if col.count() else {"ids": [], "metadatas": []}
        for cid, meta in zip(got["ids"], got["metadatas"]):
            existing[cid.rsplit("-", 1)[0]] = meta.get("fingerprint", "")

        stale = [sid for sid in existing if sid not in sources or existing[sid] != fingerprints[sid]]
        for sid in stale:
            col.delete(where={"source_id": sid})
        todo = [sid for sid in sources if existing.get(sid) != fingerprints[sid]]
        stats.update(sources=len(sources), unchanged=len(sources) - len(todo), reindexed=len(todo),
                     removed=len([s for s in stale if s not in sources]), chunks_added=0)

        batch_ids, batch_docs, batch_meta = [], [], []

        def flush():
            if batch_ids:
                col.add(ids=batch_ids, documents=batch_docs, metadatas=batch_meta, embeddings=embed(batch_docs))
                stats["chunks_added"] += len(batch_ids)
                batch_ids.clear(); batch_docs.clear(); batch_meta.clear()

        for i, sid in enumerate(todo):
            for cid, doc, meta in sources[sid]:
                batch_ids.append(cid); batch_docs.append(doc)
                batch_meta.append({**meta, "source_id": sid, "fingerprint": fingerprints[sid]})
                if len(batch_ids) >= 128:
                    flush()
            if i and i % 50 == 0:
                log.info("…%d/%d sources", i, len(todo))
        flush()
        stats["collection_size"] = col.count()
        stats["embedding_model"] = EMBED_MODEL
    log.info("RAG index updated: %s", stats)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true")
    main(ap.parse_args().rebuild)
