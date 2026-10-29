"""ClauseBerry API.

Run from the project root:  uvicorn backend.app.main:app --reload --port 8000
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .core.errors import install_error_handlers
from .db.database import get_db, init_db, scalar
from .routes import account, apps, auth, changes, chat, insights, monitoring as monitoring_routes
from .services import monitoring, rag

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("clauseberry")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    s = get_settings()
    if s.app_env != "test":
        # Load the embedding model and vector index in the background so the first question is fast.
        threading.Thread(target=rag.warm_up, daemon=True).start()
        monitoring.start_scheduler()
    log.info("ClauseBerry API starting (env=%s, llm=%s, email=%s)", s.app_env,
             "gemini" if s.llm_configured else "not configured", "resend" if s.email_configured else "dev outbox")
    try:
        yield
    finally:
        monitoring.stop_scheduler()


app = FastAPI(title="ClauseBerry API", version="1.0.0", lifespan=lifespan,
              description="AI privacy intelligence: policy changes, risk analysis, AI-training tracking and cited Q&A.")
install_error_handlers(app)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origin_list, allow_credentials=True,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                   allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID"])


@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    request.state.request_id = rid[:64]
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api/") and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"
    log.info("%s %s -> %s (%.0f ms) rid=%s", request.method, request.url.path, response.status_code,
             (time.perf_counter() - start) * 1000, request.state.request_id)
    return response


for r in (auth.router, apps.router, changes.router, insights.router, chat.router, account.router,
          monitoring_routes.router):
    app.include_router(r)


@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok"}


@app.get("/api/ready", tags=["health"])
def ready(conn=Depends(get_db)):
    versions = scalar(conn, "SELECT COUNT(*) FROM policy_versions")
    s = get_settings()
    return {"status": "ready" if versions else "degraded", "database": {"policy_versions": versions},
            "rag": rag.status(), "llm_configured": s.llm_configured, "email_configured": s.email_configured}
