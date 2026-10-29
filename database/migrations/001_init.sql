-- ClauseBerry schema v1.
-- Source data (apps, documents, policy_versions, source_changes) is kept separate from
-- derived data (policy_changes, ai_clauses) and generated analysis (change_analysis).

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- catalogue
CREATE TABLE apps (
    id            INTEGER PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL UNIQUE,          -- exactly as in the dataset `service` column
    category      TEXT NOT NULL,
    website       TEXT,
    description   TEXT,
    note          TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE documents (
    id             INTEGER PRIMARY KEY,
    app_id         INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    document_type  TEXT NOT NULL CHECK (document_type IN ('Privacy Policy','Terms of Service')),
    slug           TEXT NOT NULL,
    source_url     TEXT,                          -- used by pipeline.fetch_policies
    UNIQUE (app_id, document_type)
);

-- One row per captured version. `source` distinguishes the historical dataset from new fetches.
CREATE TABLE policy_versions (
    id                INTEGER PRIMARY KEY,
    document_id       INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_date      TEXT NOT NULL,              -- YYYY-MM-DD
    version_datetime  TEXT NOT NULL,              -- ISO-8601 UTC
    word_count        INTEGER NOT NULL,
    text              TEXT NOT NULL,
    content_hash      TEXT NOT NULL,              -- sha256 of raw text
    normalized_hash   TEXT NOT NULL,              -- sha256 of noise-normalised text
    source            TEXT NOT NULL CHECK (source IN ('dataset','fetched')),
    source_ref        TEXT,                       -- e.g. policy_versions.csv#row=123 or the fetched URL
    retrieved_at      TEXT,
    quality_flag      TEXT NOT NULL DEFAULT 'ok' CHECK (quality_flag IN ('ok','suspected_capture_error')),
    seq               INTEGER NOT NULL DEFAULT 0, -- order within (document, datetime) for same-instant variants
    UNIQUE (document_id, version_datetime, content_hash)
);
CREATE INDEX ix_versions_doc_time ON policy_versions(document_id, version_datetime, seq);

-- Precomputed changes shipped with the dataset, kept verbatim for provenance / cross-checks.
CREATE TABLE source_changes (
    id                INTEGER PRIMARY KEY,
    document_id       INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    source_row        INTEGER NOT NULL UNIQUE,
    previous_date     TEXT NOT NULL,
    change_date       TEXT NOT NULL,
    words_before      INTEGER, words_after INTEGER, word_count_change INTEGER,
    lines_added       INTEGER, lines_removed INTEGER,
    added_text        TEXT, removed_text TEXT
);

-- ---------------------------------------------------------------- derived
CREATE TABLE policy_changes (
    id               INTEGER PRIMARY KEY,
    document_id      INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    from_version_id  INTEGER NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
    to_version_id    INTEGER NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
    previous_date    TEXT NOT NULL,
    change_date      TEXT NOT NULL,
    words_before     INTEGER NOT NULL,
    words_after      INTEGER NOT NULL,
    words_added      INTEGER NOT NULL,
    words_removed    INTEGER NOT NULL,
    lines_added      INTEGER NOT NULL,
    lines_removed    INTEGER NOT NULL,
    added_text       TEXT NOT NULL DEFAULT '',
    removed_text     TEXT NOT NULL DEFAULT '',
    is_meaningful    INTEGER NOT NULL CHECK (is_meaningful IN (0,1)),
    noise_reason     TEXT,                        -- why a change was judged not meaningful
    change_hash      TEXT NOT NULL,               -- sha256(added || removed) of normalised diff
    detector_version TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (from_version_id, to_version_id)
);
CREATE INDEX ix_changes_doc_date ON policy_changes(document_id, change_date);
CREATE INDEX ix_changes_meaningful ON policy_changes(is_meaningful, change_date);

-- Generated analysis. Several analyzers may coexist; exactly one row per change is `is_current`.
CREATE TABLE change_analysis (
    id                     INTEGER PRIMARY KEY,
    change_id              INTEGER NOT NULL REFERENCES policy_changes(id) ON DELETE CASCADE,
    analyzer               TEXT NOT NULL CHECK (analyzer IN ('heuristic','llm')),
    model                  TEXT NOT NULL,          -- e.g. rules-v1, gemini-2.5-flash
    prompt_version         TEXT NOT NULL,
    input_hash             TEXT NOT NULL,          -- cache key: hash of analysed content + prompt version
    summary                TEXT NOT NULL,
    category               TEXT NOT NULL,
    secondary_categories   TEXT NOT NULL DEFAULT '[]',
    risk_score             INTEGER NOT NULL CHECK (risk_score BETWEEN 1 AND 5),
    risk_level             TEXT NOT NULL CHECK (risk_level IN ('minimal','low','medium','high','critical')),
    ai_training_mentioned  INTEGER NOT NULL CHECK (ai_training_mentioned IN (0,1)),
    ai_training_evidence   TEXT,
    change_direction       TEXT NOT NULL,
    reasoning              TEXT NOT NULL,
    confidence             REAL,                   -- NULL when the analyzer cannot report one
    is_current             INTEGER NOT NULL DEFAULT 1,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (change_id, analyzer, input_hash)
);
CREATE INDEX ix_analysis_current ON change_analysis(change_id, is_current);

-- AI-related clauses observed in each version (sentence-level evidence).
CREATE TABLE ai_clauses (
    id          INTEGER PRIMARY KEY,
    version_id  INTEGER NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('explicit_training','ai_provider_sharing','automated_processing','general_ai')),
    evidence    TEXT NOT NULL,
    clause_hash TEXT NOT NULL,
    UNIQUE (version_id, clause_hash)
);
CREATE INDEX ix_ai_clauses_version ON ai_clauses(version_id, kind);

-- Human labels for evaluation (never written by the pipeline).
CREATE TABLE evaluation_labels (
    id                     INTEGER PRIMARY KEY,
    change_id              INTEGER NOT NULL REFERENCES policy_changes(id) ON DELETE CASCADE,
    reviewer               TEXT NOT NULL,
    is_meaningful          INTEGER,
    category               TEXT,
    risk_score             INTEGER CHECK (risk_score BETWEEN 1 AND 5),
    ai_training_explicit   INTEGER,
    evidence               TEXT,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (change_id, reviewer)
);

CREATE TABLE pipeline_runs (
    id           INTEGER PRIMARY KEY,
    step         TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('running','success','failed','partial')),
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    stats        TEXT NOT NULL DEFAULT '{}',
    error        TEXT
);
CREATE INDEX ix_runs_step ON pipeline_runs(step, started_at);

CREATE TABLE fetch_log (
    id            INTEGER PRIMARY KEY,
    document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    url           TEXT NOT NULL,
    attempted_at  TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('new_version','unchanged','failed','skipped')),
    http_status   INTEGER,
    detail        TEXT,
    version_id    INTEGER REFERENCES policy_versions(id) ON DELETE SET NULL
);
CREATE INDEX ix_fetch_doc ON fetch_log(document_id, attempted_at);

-- ---------------------------------------------------------------- users
CREATE TABLE users (
    id                 INTEGER PRIMARY KEY,
    email              TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name               TEXT NOT NULL,
    password_hash      TEXT NOT NULL,
    email_verified_at  TEXT,
    plan               TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','team')),
    theme              TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark')),
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Server-side sessions; the cookie carries a random token, only its sha256 is stored.
CREATE TABLE sessions (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    csrf_token   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    user_agent   TEXT
);
CREATE INDEX ix_sessions_user ON sessions(user_id);

CREATE TABLE email_tokens (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TEXT NOT NULL,
    used_at     TEXT
);

CREATE TABLE follows (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id      INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (user_id, app_id)
);

CREATE TABLE alerts (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    change_id   INTEGER NOT NULL REFERENCES policy_changes(id) ON DELETE CASCADE,
    origin      TEXT NOT NULL CHECK (origin IN ('pipeline','backfill')),
    read_at     TEXT,
    emailed_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (user_id, change_id)
);
CREATE INDEX ix_alerts_user ON alerts(user_id, read_at, created_at);

CREATE TABLE notification_preferences (
    user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email_enabled    INTEGER NOT NULL DEFAULT 1,
    min_risk_score   INTEGER NOT NULL DEFAULT 3 CHECK (min_risk_score BETWEEN 1 AND 5),
    frequency        TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('instant','daily','weekly')),
    ai_training_only INTEGER NOT NULL DEFAULT 0
);

-- Every outgoing email. status='logged' means no provider is configured (local dev mode).
CREATE TABLE email_outbox (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    to_email     TEXT NOT NULL,
    subject      TEXT NOT NULL,
    body_text    TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('logged','sent','failed')),
    provider_id  TEXT,
    error        TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE chat_sessions (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX ix_chat_sessions_user ON chat_sessions(user_id, updated_at);

CREATE TABLE chat_messages (
    id          INTEGER PRIMARY KEY,
    session_id  INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content     TEXT NOT NULL,
    citations   TEXT NOT NULL DEFAULT '[]',
    meta        TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX ix_chat_messages_session ON chat_messages(session_id, id);

-- Interest in paid tiers; no payment is ever taken.
CREATE TABLE upgrade_interest (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan        TEXT NOT NULL CHECK (plan IN ('pro','team')),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (user_id, plan)
);
