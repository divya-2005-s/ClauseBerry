# Deployment guide

**Status: not deployed.** Everything below has been verified locally in Docker (2026-10-24) unless marked
otherwise. Creating hosting resources is a manual, billable step that has not been taken.

## What needs durable storage

| Artifact | Size today | Notes |
|---|---|---|
| `clauseberry.db` (SQLite, WAL) | ~215 MB | Policy data + user accounts. Must survive restarts. |
| `chroma/` (vector index) | ~80 MB | Rebuildable (`python -m pipeline.build_rag --rebuild`; tens of minutes on CPU). |
| Hugging Face model cache (`hf/`) | ~90 MB model | Downloaded on first start if absent. |

All three live on one persistent volume mounted at **`/data`** in a **single, always-on** backend instance
(SQLite and the in-memory rate limiter assume one long-lived process). Ephemeral or sleeping free tiers lose
the data.

## Verified locally (Docker, 2026-10-24)

| Check | Result |
|---|---|
| Image build (`Dockerfile`, CPU-only torch) | builds; 2.55 GB; no dataset, database or secrets inside |
| Runs as non-root | uid/gid 10001 |
| Health check | `healthy` within ~20 s |
| Migrations on start | all 4 applied, on a seeded and on an empty volume |
| Empty volume | starts healthy; `/api/ready` reports `degraded`, 0 versions, index not built (honest) |
| Sanitised seed | 0 users, sessions, emails or chats; 2,264 versions; 5,492 chunks; `/api/ready` → `ready` |
| Production cookies | `HttpOnly; Secure; SameSite=lax` |
| Ask ClauseBerry | answer with 8 citations (extractive mode, no LLM key) |
| Restart persistence | account and chat history survive `docker restart` |
| Spoofed `X-Forwarded-For` | ignored; per-IP auth limit returned 429 at the 10th attempt in the minute |
| Scheduled run in container | `run_pipeline --skip-load --skip-fetch --no-email`: all steps succeed incrementally, no lock left |
| Memory | ~564 MiB while answering a question → **1 GB RAM minimum** |
| Production path end to end | Next.js production build (`BACKEND_URL` → Docker API, production mode, Secure cookies, sanitised seed on a native volume): **13/13 browser tests passed** |
| Latency (warm) | sign-in ~0.35–0.45 s (Argon2), `/api/public/stats` ~0.3–0.4 s |
| Cold start | model warm-up ~34 s; requests in that window took up to ~6 s |

Lessons from local testing:

* **Use a native volume.** With a Windows folder bind-mounted into Docker Desktop as `/data`, SQLite queries
  took 80–110 s (vs 0.17 s on a Docker named volume). Production volumes (Fly, etc.) are native disks.
* **Seed from a fresh sanitised export only.** A data directory that a container used — especially one that
  was force-stopped — carries `clauseberry.db-wal`/`-shm` files; seeding from it caused a 30 s lock stall and a
  2-minute warm-up. `export_public_state.py` checkpoints the source and writes a single clean file.

Not verified: a real host, HTTPS termination, the Vercel ↔ backend path in production, live policy fetching
from a server, Gemini, and Resend.

## Topology

```
Browser ──HTTPS──► Vercel (Next.js)  BACKEND_URL=https://<api-host>
                      │  /api/* rewrite (server-side; cookies stay first-party)
                      ▼
                 API host: 1 always-on machine, 1 GB RAM
                   • Docker image from ./Dockerfile
                   • volume mounted at /data
                   • daily: python -m pipeline.run_pipeline --skip-load   (inside this machine)
```

## Steps (Fly.io example)

Any host with a persistent volume and ≥ 1 GB RAM works; Fly.io is used as the concrete example.

1. **Prepare the seed** locally — never upload a development database as-is (it holds test accounts,
   sessions and email logs):
   ```powershell
   cd D:\Projects\TOS
   python scripts\verify_dataset.py
   python scripts\export_public_state.py data\clauseberry.db data\processed\clauseberry-public.db
   ```
2. **Create the app and volume** (billable — needs your approval and a Fly account):
   ```powershell
   Copy-Item deploy\fly.toml.example fly.toml      # then set app name and region
   fly launch --no-deploy --copy-config
   fly volumes create clauseberry_data --size 3 --region iad
   fly secrets set FRONTEND_URL=https://<your-frontend> CORS_ORIGINS=https://<your-frontend>
   fly deploy
   ```
3. **Upload the seed** to the volume (machine running), then restart:
   ```powershell
   tar -czf data\processed\chroma.tar.gz -C data chroma
   fly ssh sftp shell
   #   sftp> put data\processed\clauseberry-public.db /data/clauseberry.db
   #   sftp> put data\processed\chroma.tar.gz /data/chroma.tar.gz
   fly ssh console -C "tar -xzf /data/chroma.tar.gz -C /data"
   fly machine restart
   ```
   (Check `fly ssh sftp --help` for your flyctl version.)
   Without the Chroma copy the API runs but Ask reports the index as missing until
   `fly ssh console -C "python -m pipeline.build_rag"` completes.
4. **Frontend on Vercel**: root directory `frontend`; set `BACKEND_URL=https://<app>.fly.dev` **before the
   first build** — Next.js bakes rewrite targets into the build, so changing it requires a redeploy.
5. **Optional services** (each needs your approval):
   * Gemini: `python scripts\check_gemini.py --list-only` locally first, then `fly secrets set GEMINI_API_KEY=… GEMINI_MODEL=…`.
   * Resend: verify a sending domain, then `fly secrets set RESEND_API_KEY=… EMAIL_FROM="ClauseBerry <alerts@your-domain>"`.
6. **Client IP / proxies**: keep `TRUSTED_PROXY_HOPS=0` (see below; the Next.js proxy does not set a trustworthy
   `X-Forwarded-For`).
7. **Daily pipeline**: set repository variable `FLY_APP` and secret `FLY_API_TOKEN` (app-scoped deploy token)
   to enable `.github/workflows/server-pipeline.yml`. Optional variable `LLM_DAILY_LIMIT` (default 0).
8. **Smoke test** (production):
   ```powershell
   curl https://<app>.fly.dev/api/ready         # expect status "ready", rag.ready true
   ```
   Then sign up through the frontend, follow an app, ask a question, and confirm the session cookie is
   `Secure; HttpOnly` in the browser dev tools.

## Client IP and rate limiting

Per-address limits use the socket peer address; `X-Forwarded-For` is ignored unless `TRUSTED_PROXY_HOPS=N`
(the N-th entry from the right would then be used).

**Keep `TRUSTED_PROXY_HOPS=0` in the standard topology.** The browser reaches the API only through the Next.js
`/api` rewrite, and Next.js's rewrite proxy does not append the visitor's address: it passes on any
`X-Forwarded-For` the client sent (checked in Next.js 16.4 source, `proxy-request.js` / `base-server.js`). Trusting
it would let clients pick their own address. Consequently every request arrives from the Next.js server's address,
and the per-address limits behave as site-wide ceilings. The protection therefore rests on:

| Limit | Default | Purpose |
|---|---|---|
| Sign-in per account | 20 / 15 min | password guessing against one account |
| Reset / verification email per address | 5 / hour | mail-bombing (same answer whether or not the account exists) |
| Auth requests per client address | 30 / min | flood ceiling (site-wide behind the proxy) |
| Ask ClauseBerry per user | 20 / 10 min | AI cost |

Raise `RATE_LIMIT_AUTH_PER_MINUTE` for busier sites. Tests: `backend/tests/test_auth.py`.

## Scheduled ingestion

* **Production** (`server-pipeline.yml`): runs `run_pipeline --skip-load` inside the API machine so it uses the
  production DB, Chroma index and users; sends alerts if Resend is configured. `--skip-load` is needed because
  the image does not contain the static dataset (it is already in the seeded DB).
* **Public-data CI** (`daily-pipeline.yml`): runs from the repository with the dataset (Git LFS, cached),
  verifies dataset checksums, email disabled, uploads a **sanitised** state artifact (user tables emptied).
* Gemini calls are capped everywhere: `LLM_DAILY_LIMIT` (default 0) in workflows, `--limit N` / `--all` locally.

## Environment variables (production)

| Variable | Required | Notes |
|---|---|---|
| `APP_ENV=production` | yes (set in image) | secure cookies; email bodies never logged |
| `FRONTEND_URL`, `CORS_ORIGINS` | yes | your frontend origin |
| `CLAUSEBERRY_DB_PATH`, `CLAUSEBERRY_CHROMA_PATH`, `HF_HOME` | preset in image | point at `/data` |
| `TRUSTED_PROXY_HOPS` | no (default 0) | see above |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | optional | blank model = default; check availability first |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | without them, emails are logged as not sent |
| `BACKEND_URL` (Vercel) | yes | build-time |

## Cost estimate (checked 2026-10-24; verify before buying)

| Item | Monthly | Source |
|---|---|---|
| Fly.io shared-cpu-1x, 1 GB RAM, always on | ~$6.70 (iad/ewr; other regions cost more) | [docs.fly.io/about/pricing](https://docs.fly.io/about/pricing) |
| Fly volume, 3 GB | ~$0.45 ($0.15/GB-month, billed even when stopped) | same |
| Vercel Hobby / Pro | $0 (non-commercial use only) / $20 per member | Vercel plans |
| Gemini | depends on model and usage; not measured | start with `--limit 5` |
| Resend | free tier for low volume | Resend pricing |

Fly has no free allowance for new organisations. Render's free web services cannot use persistent disks and
spin down after 15 minutes idle ([render.com/docs/free](https://render.com/docs/free)), so they are unsuitable.

## Migration path

* SQLite → Postgres for more than one backend instance; rate limiting then moves to Redis.
* Embedded Chroma → Chroma server / pgvector; `services/rag.py` isolates the client.
