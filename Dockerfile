# ClauseBerry API image. All state lives on a volume mounted at /data (SQLite DB, Chroma index,
# Hugging Face model cache); nothing generated is baked into the image.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_ENV=production \
    HF_HOME=/data/hf \
    CLAUSEBERRY_DB_PATH=/data/clauseberry.db \
    CLAUSEBERRY_CHROMA_PATH=/data/chroma \
    PORT=8080

WORKDIR /app

# CPU-only torch first, otherwise sentence-transformers pulls the multi-GB CUDA build.
# Optional build secret `extra_ca`: an extra root CA trusted for this step only (e.g. a local TLS-inspecting
# proxy). It is never written to an image layer; hosted builders don't need it.
#   docker build --secret id=extra_ca,src=path/to/ca.pem -t clauseberry-api .
COPY backend/requirements.txt backend/requirements.txt
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/extra_ca > /tmp/ca.pem && export PIP_CERT=/tmp/ca.pem; \
    fi \
 && pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r backend/requirements.txt \
 && rm -f /tmp/ca.pem

COPY pipeline pipeline
COPY backend/__init__.py backend/__init__.py
COPY backend/app backend/app
COPY database database
COPY scripts scripts

RUN useradd --create-home --uid 10001 app && mkdir -p /data && chown app /data
USER app
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health', timeout=4)"

CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT}"]
