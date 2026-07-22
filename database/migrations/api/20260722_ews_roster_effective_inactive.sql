-- Roster inactive-operator layer — Step 2: VIEW ews.roster_effective + usernfc.inactive_from filter.
--
-- Centralizes the inactive-operator exclusion in the ONE read-time view that already applies the
-- shift-lock override, so all three consumers drop the operator uniformly and date-aware:
--   - adoption denominator  (services/ewsCalculator.js  calculateAdoptionLabourFromRoster)
--   - getRoster daily view  (controllers/ewsRosterController.getRoster)
--   - dispatcher EXISTS      (services/ewsCalculator.js)
--
-- Rule (freeze-safe): a row survives the view iff
--   u.inactive_from IS NULL OR r.business_date < u.inactive_from
-- inactive_from = first day the operator is no longer counted. Dates BEFORE it are untouched, so
-- historical adoption stays exactly as it was; dates ON/AFTER it drop out of the denominator and
-- the daily view. shift_roster itself is NEVER modified — frozen future rows for a now-resigned
-- operator simply stop appearing in the view (physical rows remain).
--
-- LEFT JOIN (not INNER) + IS NULL: operators with NO usernfc row (unmatched serialnumber) are kept
-- — same fallback principle as the name joins. No row multiplication: usernfc.snssb is UNIQUE
-- (verified 231/231 distinct, 0 dup groups), so the join yields <= 1 usernfc row per serialnumber.
-- Join key uses NULLIF(BTRIM(snssb),'') to match the existing roster-path convention
-- (ewsCalculator / getRoster) and tolerate whitespace.
--
-- Plan check (EXPLAIN ANALYZE, rolled-back probe with the column present, max business_date, 91 rows):
--   before  2.98 ms  -> after 4.16 ms. shift_roster still driven by idx_ews_shift_roster_date
--   (date Index Scan preserved, NOT a seq scan). Added cost is one Seq Scan on the 231-row usernfc
--   in a hash join (~0.14 ms). The partial index ix_usernfc_inactive_from is (correctly) unused for
--   this "IS NULL OR" predicate on a tiny table; it exists for value-probe queries if usernfc grows.
--
-- Requires migration 20260722_usernfc_inactive_from.sql applied first (column must exist).
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
       ON os_lk.shift_code = lk.locked_shift
LEFT JOIN public.usernfc u
       ON NULLIF(BTRIM(u.snssb), '') = r.serialnumber
WHERE u.inactive_from IS NULL OR r.business_date < u.inactive_from;

-- ============================================================================================
-- ROLLBACK (MANUAL — runner is up-only; do NOT save as a live .sql in migrations/api/).
-- Restores the Step-2-of-shift-lock view (no usernfc join):
--
--   CREATE OR REPLACE VIEW ews.roster_effective AS
--   SELECT r.serialnumber, r.business_date, r.status, r.source, r.updated_by,
--          COALESCE(lk.locked_shift, r.scheduled_shift)               AS eff_shift,
--          COALESCE(os_lk.standard_hours, r.scheduled_standard_hours) AS eff_std,
--          (lk.id IS NOT NULL)                                        AS shift_locked
--   FROM ews.shift_roster r
--   LEFT JOIN ews.operator_shift_lock lk
--          ON lk.serialnumber = r.serialnumber AND lk.cancelled_at IS NULL
--         AND daterange(lk.effective_from, lk.lock_end, '[)') @> r.business_date
--   LEFT JOIN ews.operator_shift os_lk ON os_lk.shift_code = lk.locked_shift;
--
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260722_ews_roster_effective_inactive.sql';
-- ============================================================================================
