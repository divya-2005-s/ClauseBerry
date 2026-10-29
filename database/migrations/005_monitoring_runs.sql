-- Locally scheduled and user-triggered policy monitoring runs.
CREATE TABLE monitoring_runs (
    id          INTEGER PRIMARY KEY,
    app_slug    TEXT,
    trigger     TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduler')),
    status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'partial', 'failed')),
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    worker_pid  INTEGER,
    summary     TEXT NOT NULL DEFAULT '{}',
    error       TEXT
);
CREATE INDEX ix_monitoring_runs_started ON monitoring_runs(started_at DESC);
CREATE INDEX ix_monitoring_runs_status ON monitoring_runs(status, started_at);
