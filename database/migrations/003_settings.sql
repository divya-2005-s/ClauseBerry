-- Key/value store for pipeline bookkeeping (e.g. which text-normaliser version produced stored hashes).
CREATE TABLE IF NOT EXISTS pipeline_state (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
