-- EWS kpi_snapshot: stop unbounded growth (one row per business day, not per run).
--
-- Problem: saveSnapshot's UNIQUE key included window_end (= now()), which differs on every
-- run, so ON CONFLICT never matched and every ~60s run INSERTed a new row. grain='today'
-- had ~1150 rows/day (8k+ total in a week). shift_id is already uniformly 0 (not null).
--
-- Fix: re-key to (window_start, grain, scope_type, scope_key, shift_id) so runs on the same
-- day UPDATE the same row. saveSnapshot is updated in lockstep to ON CONFLICT on this key
-- and to refresh window_end. Deploy this migration together with that code change.
--
-- Note: rolling grains (e.g. 15m) have a moving window_start, so they still get one row per
-- distinct window; that is correct — each is a genuinely different time window. Only 'today'
-- (and 'date') have a stable window_start and thus collapse to one row per day.

BEGIN;

-- Block concurrent writers (the ~60s snapshot job) for the brief dedup + re-key window,
-- so a mid-migration INSERT cannot re-create a duplicate before the new UNIQUE is added.
LOCK TABLE ews.kpi_snapshot IN ACCESS EXCLUSIVE MODE;

-- 1) Deduplicate: keep the freshest row per date-key (latest window_end, then calculated_at).
DELETE FROM ews.kpi_snapshot k
USING (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY window_start, grain, scope_type, scope_key, shift_id
      ORDER BY window_end DESC, calculated_at DESC, id DESC
    ) AS rn
  FROM ews.kpi_snapshot
) d
WHERE k.id = d.id
  AND d.rn > 1;

-- 2) Swap the unique key: drop the window_end-based one, add the date-based one.
ALTER TABLE ews.kpi_snapshot
  DROP CONSTRAINT kpi_snapshot_window_start_window_end_grain_scope_type_scope_key;

ALTER TABLE ews.kpi_snapshot
  ADD CONSTRAINT kpi_snapshot_date_key
  UNIQUE (window_start, grain, scope_type, scope_key, shift_id);

-- 3) Make the shift_id default explicit (already 0 everywhere) so future upserts key cleanly.
ALTER TABLE ews.kpi_snapshot
  ALTER COLUMN shift_id SET DEFAULT 0;

COMMIT;
