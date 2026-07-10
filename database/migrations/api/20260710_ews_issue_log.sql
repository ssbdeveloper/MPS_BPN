-- 20260710_ews_issue_log.sql
-- Central EWS issue log: one table that records issues from ALL KPI calculations,
-- tagged by `category` (the EWS KPI). A detail page filters by its category,
-- e.g. the OEE page reads category='oee'. Generated backend-side (autonomously by
-- the snapshot job) so issues are recorded even when nobody opens the UI.
--
-- Dedup: issue_key = "<category>:<business_date>:<scope_type>:<entity_id>" — one row
-- per (category, business day, entity). Re-generation UPDATEs the same row (while it
-- is still open) instead of piling duplicates.
--
-- Target DB: app Postgres (ews schema).

BEGIN;

CREATE SCHEMA IF NOT EXISTS ews;

CREATE TABLE IF NOT EXISTS ews.issue_log (
  id            bigserial PRIMARY KEY,
  issue_key     text NOT NULL UNIQUE,
  category      text NOT NULL,                 -- EWS KPI: accuracy_machine, accuracy_labour, oee, ole, adoption, uptime_hmi
  business_date date NOT NULL,
  scope_type    text,                          -- machine | operator | error_type | system
  entity_id     text,                          -- machineno / operator_id / ...
  entity_name   text,
  severity      text NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical')),
  title         text,
  description   text,
  metric_value  numeric,                       -- the offending number (e.g. % missing)
  detail        jsonb,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ews_issue_log_category_status
  ON ews.issue_log (category, status, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_ews_issue_log_created
  ON ews.issue_log (created_at DESC);

COMMENT ON TABLE ews.issue_log IS
  'Central EWS issue log across all KPI categories. Generated backend-side; dedup by issue_key per (category, business_date, entity).';

COMMIT;
