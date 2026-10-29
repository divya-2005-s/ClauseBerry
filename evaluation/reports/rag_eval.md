# RAG evaluation

Generated 2026-10-25 · index: 5492 chunks · embedding model sentence-transformers/all-MiniLM-L6-v2 · k=5.

Automatic checks with ground truth taken from the database; they do not judge answer quality.

| Metric | Value |
|---|---|
| Evidence-hit@5 for explicit AI-training sentences (with constraint parsing) | 11/14 = 0.79 |
| App-hit@5, dense retrieval only (no app filter) | 11/14 = 0.79 |
| Questions answered (extractive mode) | 10/10 |
| Quoted passages found verbatim in the cited chunk | 33/33 |
| Citation markers pointing to a non-returned source | 0 |

## Per app

| App | Evidence hit@5 | Dense app hit@5 |
|---|---|---|
| Facebook | ✗ | ✓ |
| LinkedIn | ✓ | ✓ |
| Moltbook | ✗ | ✓ |
| Pinterest | ✓ | ✓ |
| Quora | ✓ | ✓ |
| Reddit | ✓ | ✗ |
| Snapchat | ✓ | ✓ |
| Spotify | ✓ | ✓ |
| TikTok | ✓ | ✓ |
| Twitch | ✓ | ✓ |
| Twitter | ✓ | ✗ |
| Upscrolled | ✗ | ✗ |
| X | ✓ | ✓ |
| YouTube | ✓ | ✓ |

Generative-mode (LLM) answers are not evaluated here because no LLM key was configured when this report was generated.
