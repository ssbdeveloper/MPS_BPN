-- Operator active/inactive marker on public.usernfc — resign without delete.
--
-- Operators cannot be deleted from usernfc: timesheet_transaction.serialnumber references
-- usernfc.snssb (FK, NOT VALID) and machine/SAP history resolves names from here. So a resigned
-- operator is marked, not removed. inactive_from is a DATE (not a boolean) so historical
-- calculations stay correct on their own timeline (freeze principle):
--
--   counted on business_date  <=>  inactive_from IS NULL OR business_date < inactive_from
--
-- inactive_from = the FIRST day the operator is NO LONGER counted (= resignation effective date).
-- Example: resign effective 2026-07-15 -> inactive_from = '2026-07-15'; adoption for 07-01..07-14
-- still counts them (bd < 15), 07-15 onward does not. A boolean is_active would retroactively drop
-- them from EVERY past date once flipped -> corrupts frozen history; rejected (see design ref).
--
-- This column is consumed date-aware at READ time by:
--   - VIEW ews.roster_effective   (adoption denominator + getRoster + preview)   -- separate step
--   - services/rosterGenerator.js (op_date filter: no NEW rows >= inactive_from)  -- separate step
--   - controllers/ewsRosterController.getConfig (dropdown filter + group badge)   -- separate step
-- Name/attribute resolution (SAP employee_category, ETL full_name, tools, timesheet history)
-- must NEVER filter on this column — resigned operators keep their names in old records.
--
-- Design ref: audit 2026-07-21 (roster inactive-operator). Runner (database/migrate.js) is UP-ONLY
-- and wraps its own transaction — no BEGIN/COMMIT written here. Rollback is a COMMENTED block below.
-- Idempotent: safe to re-run.

ALTER TABLE public.usernfc
  ADD COLUMN IF NOT EXISTS inactive_from date;

COMMENT ON COLUMN public.usernfc.inactive_from IS
  'First day the operator is NO LONGER counted (resignation effective date). NULL = active. '
  'Historical rule: counted when inactive_from IS NULL OR business_date < inactive_from. '
  'Read-side only — name/attribute resolution (SAP, ETL, history) must not filter on this.';

-- Partial index: the inactive population is small; every read predicate is
-- "inactive_from IS NULL OR business_date < inactive_from", so only NON-NULL rows are ever
-- probed by value. Indexing just those keeps it tiny and lets the planner range-scan them.
CREATE INDEX IF NOT EXISTS ix_usernfc_inactive_from
  ON public.usernfc (inactive_from)
  WHERE inactive_from IS NOT NULL;

-- ============================================================================================
-- ROLLBACK (MANUAL — runner is up-only; DO NOT save this block as a live .sql in migrations/api/).
--
--   DROP INDEX IF EXISTS public.ix_usernfc_inactive_from;
--   ALTER TABLE public.usernfc DROP COLUMN IF EXISTS inactive_from;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260722_usernfc_inactive_from.sql';
-- ============================================================================================
