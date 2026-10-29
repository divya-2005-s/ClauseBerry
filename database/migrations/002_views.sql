-- Analytics views. KPI semantics are documented in docs/architecture.md.
-- Every view counts at the grain stated in its comment so joins cannot double count.

-- One row per change, joined to its current analysis (if any). Grain: policy_changes.id
CREATE VIEW v_changes AS
SELECT c.id              AS change_id,
       c.document_id,
       d.app_id,
       a.name            AS app_name,
       a.slug            AS app_slug,
       a.category        AS app_category,
       d.document_type,
       c.previous_date,
       c.change_date,
       c.words_before, c.words_after, c.words_added, c.words_removed,
       c.lines_added, c.lines_removed,
       c.is_meaningful, c.noise_reason,
       ca.summary, ca.category, ca.risk_score, ca.risk_level,
       ca.ai_training_mentioned, ca.change_direction, ca.analyzer, ca.model
FROM policy_changes c
JOIN documents d ON d.id = c.document_id
JOIN apps a      ON a.id = d.app_id
LEFT JOIN change_analysis ca ON ca.change_id = c.id AND ca.is_current = 1;

-- Latest version per document. Grain: documents.id
CREATE VIEW v_latest_version AS
SELECT * FROM (
    SELECT v.*, d.app_id, d.document_type,
           ROW_NUMBER() OVER (PARTITION BY v.document_id
                              ORDER BY v.version_datetime DESC, v.seq DESC, v.id DESC) AS rn
    FROM policy_versions v JOIN documents d ON d.id = v.document_id
    WHERE v.quality_flag = 'ok'
) WHERE rn = 1;

-- Risk per application and year (meaningful, analysed changes only). Grain: (app, year)
CREATE VIEW v_app_risk_by_year AS
SELECT app_id, app_name, substr(change_date, 1, 4) AS year,
       COUNT(*)                  AS changes,
       ROUND(AVG(risk_score), 2) AS avg_risk,
       MAX(risk_score)           AS max_risk,
       SUM(risk_score >= 4)      AS high_risk_changes
FROM v_changes
WHERE is_meaningful = 1 AND risk_score IS NOT NULL
GROUP BY app_id, app_name, year;

-- Meaningful changes per quarter. Grain: quarter
CREATE VIEW v_changes_per_quarter AS
SELECT substr(change_date, 1, 4) || '-Q' || ((CAST(substr(change_date, 6, 2) AS INTEGER) + 2) / 3) AS quarter,
       COUNT(*)                         AS changes,
       SUM(risk_score >= 4)             AS high_risk_changes,
       SUM(document_type = 'Privacy Policy')   AS privacy_policy_changes,
       SUM(document_type = 'Terms of Service') AS terms_changes
FROM v_changes
WHERE is_meaningful = 1
GROUP BY quarter;

-- Category trends. Grain: (quarter, category)
CREATE VIEW v_category_trends AS
SELECT substr(change_date, 1, 4) || '-Q' || ((CAST(substr(change_date, 6, 2) AS INTEGER) + 2) / 3) AS quarter,
       category, COUNT(*) AS changes, ROUND(AVG(risk_score), 2) AS avg_risk
FROM v_changes
WHERE is_meaningful = 1 AND category IS NOT NULL
GROUP BY quarter, category;

-- AI-related language per version. Grain: (version, kind)
CREATE VIEW v_ai_clause_versions AS
SELECT v.id AS version_id, v.document_id, d.app_id, d.document_type, v.version_date,
       ac.kind, COUNT(*) AS clauses
FROM ai_clauses ac
JOIN policy_versions v ON v.id = ac.version_id
JOIN documents d       ON d.id = v.document_id
GROUP BY v.id, ac.kind;

-- AI-related language over time: apps with each kind of clause in any version captured in the quarter.
-- Grain: (quarter, kind)
CREATE VIEW v_ai_language_by_quarter AS
SELECT substr(version_date, 1, 4) || '-Q' || ((CAST(substr(version_date, 6, 2) AS INTEGER) + 2) / 3) AS quarter,
       kind, COUNT(DISTINCT app_id) AS apps
FROM v_ai_clause_versions
GROUP BY quarter, kind;

-- Application risk ranking over all meaningful analysed changes. Grain: app
CREATE VIEW v_app_risk_ranking AS
SELECT a.id AS app_id, a.name AS app_name, a.slug AS app_slug, a.category,
       COUNT(vc.change_id)                          AS meaningful_changes,
       ROUND(AVG(vc.risk_score), 2)                 AS avg_risk,
       COALESCE(MAX(vc.risk_score), 0)              AS max_risk,
       COALESCE(SUM(vc.risk_score >= 4), 0)         AS high_risk_changes,
       RANK() OVER (ORDER BY COALESCE(SUM(vc.risk_score >= 4), 0) DESC,
                             AVG(vc.risk_score) DESC) AS risk_rank
FROM apps a
LEFT JOIN v_changes vc ON vc.app_id = a.id AND vc.is_meaningful = 1 AND vc.risk_score IS NOT NULL
GROUP BY a.id;

-- Policy length growth: last captured word count per document per quarter. Grain: (document, quarter)
CREATE VIEW v_policy_length AS
SELECT document_id, app_id, document_type, quarter, word_count FROM (
    SELECT v.document_id, d.app_id, d.document_type,
           substr(v.version_date, 1, 4) || '-Q' || ((CAST(substr(v.version_date, 6, 2) AS INTEGER) + 2) / 3) AS quarter,
           v.word_count,
           ROW_NUMBER() OVER (PARTITION BY v.document_id,
                                  substr(v.version_date, 1, 4), (CAST(substr(v.version_date, 6, 2) AS INTEGER) + 2) / 3
                              ORDER BY v.version_datetime DESC, v.seq DESC) AS rn
    FROM policy_versions v JOIN documents d ON d.id = v.document_id
    WHERE v.quality_flag = 'ok'
) WHERE rn = 1;
