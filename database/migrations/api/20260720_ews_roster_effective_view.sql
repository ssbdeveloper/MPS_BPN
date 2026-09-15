-- EWS roster override — Phase 1, Step 2: VIEW ews.roster_effective (shift-lock layer ONLY).
--
-- The read-time "effective roster": shift_roster (immutable) with the active shift-lock applied.
-- shift_roster is NEVER written by overrides. This step ONLY creates the VIEW — the 2 reader
-- switches (getRoster / adoption / dispatcher), the endpoint that populates operator_shift_lock,
-- the UI, and validation wiring are SEPARATE later steps. Phase 2 adds a std-override layer;
-- Phase 3 UNIONs extra-workday rows. Design ref: docs/planning/ews-roster-feature.md §11.2.
--
-- Precedence (Phase 1):
--   eff_shift = COALESCE(lock.locked_shift, scheduled_shift)
--   eff_std   = COALESCE(operator_shift[locked_shift].standard_hours, scheduled_standard_hours)
--               -- when a lock is active, std is RECOMPUTED from the locked shift, NOT the frozen
--               -- scheduled_standard_hours. (Phase 2 prepends std_override as the top COALESCE arg.)
--
-- No row multiplication: the lock join yields <= 1 active lock per (operator, business_date) because
-- ews.operator_shift_lock has the anti-overlap EXCLUDE (operator_shift_lock_no_overlap); operator_shift
-- PK is shift_code. Verified: VIEW rows == shift_roster rows, 0 duplicates.
--
-- Read-path index: the lock join uses the containment form
--   daterange(lk.effective_from, lk.lock_end, '[)') @> r.business_date
-- which rides the EXCLUDE constraint's GiST index (no separate index needed).
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE VIEW ews.roster_effective AS
SELECT
  r.serialnumber,
  r.business_date,
  r.status,
  r.source,
  r.updated_by,
  COALESCE(lk.locked_shift, r.scheduled_shift)               AS eff_shift,
  COALESCE(os_lk.standard_hours, r.scheduled_standard_hours) AS eff_std,
  (lk.id IS NOT NULL)                                        AS shift_locked
FROM ews.shift_roster r
LEFT JOIN ews.operator_shift_lock lk
       ON lk.serialnumber = r.serialnumber
      AND lk.cancelled_at IS NULL
      AND daterange(lk.effective_from, lk.lock_end, '[)') @> r.business_date
LEFT JOIN ews.operator_shift os_lk
       ON os_lk.shift_code = lk.locked_shift;

-- ============================================================================================
-- ROLLBACK (MANUAL — runner is up-only; do NOT save as a live .sql in migrations/api/):
--   DROP VIEW IF EXISTS ews.roster_effective;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260720_ews_roster_effective_view.sql';
-- ============================================================================================
