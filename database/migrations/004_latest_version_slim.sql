-- v_latest_version previously selected v.* (including full policy text), making every query that used it
-- scan ~170 MB. Redefine it with metadata columns only; join policy_versions when text is needed.
DROP VIEW IF EXISTS v_latest_version;
CREATE VIEW v_latest_version AS
SELECT id, document_id, app_id, document_type, version_date, version_datetime, word_count, content_hash, source, seq
FROM (
    SELECT v.id, v.document_id, d.app_id, d.document_type, v.version_date, v.version_datetime, v.word_count,
           v.content_hash, v.source, v.seq,
           ROW_NUMBER() OVER (PARTITION BY v.document_id
                              ORDER BY v.version_datetime DESC, v.seq DESC, v.id DESC) AS rn
    FROM policy_versions v JOIN documents d ON d.id = v.document_id
    WHERE v.quality_flag = 'ok'
) WHERE rn = 1;

-- Covering indexes so date/length aggregates never touch the large text column.
CREATE INDEX IF NOT EXISTS ix_versions_date ON policy_versions(version_date);
CREATE INDEX IF NOT EXISTS ix_versions_doc_quality ON policy_versions(document_id, quality_flag, version_datetime, seq, version_date, word_count, content_hash, source);
