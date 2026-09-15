-- Per-operation headcount (people_required) on public.sow.
--
-- Manufacturing scheduling needs to plan how many people a SOW operation requires. This is a
-- per-operation PLANNING attribute (like planhours), so it lives on public.sow — one row per
-- operation, identity (order_no, operation_no) — NOT on the bay reservation
-- (ms_project_bay_schedule): a reservation is a place/date, headcount belongs to the operation.
--
-- The manufacturing scheduler edits this in-flow and writes it back via
--   PATCH /ms-project/sow-orders/:order_no/operations/people
-- (service msProjectService.updateOperationPeople).
--
-- Column is NULLABLE and additive: existing SOW rows and salvaging callers are unaffected
-- (people_required stays NULL where nobody sets it). smallint is ample for a per-operation crew.
--
-- The column is brand-new / all-NULL, so the positive-value CHECK validates immediately —
-- no NOT VALID / VALIDATE CONSTRAINT dance needed. Runner (database/migrate.js) is UP-ONLY and
-- wraps its own transaction — no BEGIN/COMMIT written here. Idempotent: safe to re-run
-- (ADD COLUMN uses IF NOT EXISTS; the constraint add is guarded by a catalog check).

ALTER TABLE public.sow
  ADD COLUMN IF NOT EXISTS people_required smallint;

-- ADD CONSTRAINT has no IF NOT EXISTS for CHECK constraints; guard it so a re-run is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sow_people_required_positive'
      AND conrelid = 'public.sow'::regclass
  ) THEN
    ALTER TABLE public.sow
      ADD CONSTRAINT sow_people_required_positive
      CHECK (people_required IS NULL OR people_required > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.sow.people_required IS
  'Planned headcount (crew size) for this SOW operation. Per-operation planning attribute set by '
  'the manufacturing scheduler (PATCH /ms-project/sow-orders/:order_no/operations/people). '
  'NULL = not planned. Lives on sow, NOT on the bay reservation.';

-- ============================================================================================
-- ROLLBACK (MANUAL — runner is up-only; DO NOT save this block as a live .sql in migrations/api/).
--
--   ALTER TABLE public.sow DROP CONSTRAINT IF EXISTS sow_people_required_positive;
--   ALTER TABLE public.sow DROP COLUMN IF EXISTS people_required;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260730_sow_people_required.sql';
-- ============================================================================================
