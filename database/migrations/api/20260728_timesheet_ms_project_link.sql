-- Manufacturing bay-reservation link on public.timesheet_transaction.
--
-- Manufacturing check-in (variant VITE_APP_VARIANT=manufacturing) originates from a bay
-- reservation in ms_project_bay_schedule surfaced through Select Job. These NULLABLE columns
-- persist which reservation/task the operator checked in under, so a timesheet row can be
-- traced back to its planning source and the reservation can be flipped RESERVED -> CONFIRMED.
--
-- Salvaging check-in never sends these fields -> they stay NULL there (no behavior change).
-- Every column is nullable and additive; existing rows and salvaging callers are unaffected.
--
-- Column source (from sessionStorage 'selectedactivity', set by manufacturing SelectJobPage):
--   ms_area_code        <- manufacturing_area_code   (device-area code of the reservation, e.g. AREA-18)
--   ms_bay_codes        <- manufacturing_bay_codes (schedule bays) || [manufacturing_bay_code]
--   ms_task_id          <- task_id      (ms_project_task.task_id; NULL for order-level reservations)
--   ms_project_id       <- project_id   (ms_project.project_id resolved for the reservation/task)
--   ms_bay_schedule_id  <- schedule_id  (ms_project_bay_schedule.schedule_id — the reservation)
--
-- Types match the linked keys: ms_project_task PK columns are uuid, ms_project_bay_schedule
-- PK (schedule_id) is uuid. NO foreign key on ms_bay_schedule_id on purpose — bay reservations
-- are cancellable/deletable, and a resigned reservation must not orphan or block a timesheet row.
--
-- Design ref: docs/MSPROJECT_COLLAB_HARDENING_PLAN.md Fase 5/6 (R1-a + R2). Runner
-- (database/migrate.js) is UP-ONLY and wraps its own transaction — no BEGIN/COMMIT written here.
-- Rollback is a COMMENTED block below. Idempotent: safe to re-run.

ALTER TABLE public.timesheet_transaction
  ADD COLUMN IF NOT EXISTS ms_area_code       text,
  ADD COLUMN IF NOT EXISTS ms_bay_codes       text[],
  ADD COLUMN IF NOT EXISTS ms_task_id         uuid,
  ADD COLUMN IF NOT EXISTS ms_project_id      uuid,
  ADD COLUMN IF NOT EXISTS ms_bay_schedule_id uuid;

COMMENT ON COLUMN public.timesheet_transaction.ms_area_code IS
  'Manufacturing device-area code of the bay reservation this check-in came from (e.g. AREA-18). '
  'From selectedactivity.manufacturing_area_code. NULL for salvaging / non-reservation check-ins.';

COMMENT ON COLUMN public.timesheet_transaction.ms_bay_codes IS
  'Bay codes of the reservation the operator checked in under. From '
  'selectedactivity.manufacturing_bay_codes (schedule bays), falling back to [manufacturing_bay_code].';

COMMENT ON COLUMN public.timesheet_transaction.ms_task_id IS
  'Linked ms_project_task.task_id when the Select Job row resolved to a specific task; '
  'NULL for order-level reservations. Type matches ms_project_task PK (uuid).';

COMMENT ON COLUMN public.timesheet_transaction.ms_project_id IS
  'Linked ms_project.project_id for the reservation/task. Type matches ms_project_task PK (uuid).';

COMMENT ON COLUMN public.timesheet_transaction.ms_bay_schedule_id IS
  'Source ms_project_bay_schedule.schedule_id (the reservation that produced this job). '
  'No FK — reservations are cancellable. Used to flip RESERVED -> CONFIRMED on check-in.';

-- Partial index: only reservation-backed manufacturing rows carry a schedule id; salvaging and
-- legacy rows are NULL. The only lookup is by ms_bay_schedule_id (status flip / trace), so index
-- just the NON-NULL population to keep it tiny.
CREATE INDEX IF NOT EXISTS ix_ts_ms_bay_schedule
  ON public.timesheet_transaction (ms_bay_schedule_id)
  WHERE ms_bay_schedule_id IS NOT NULL;

-- ============================================================================================
-- ROLLBACK (MANUAL — runner is up-only; DO NOT save this block as a live .sql in migrations/api/).
--
--   DROP INDEX IF EXISTS public.ix_ts_ms_bay_schedule;
--   ALTER TABLE public.timesheet_transaction
--     DROP COLUMN IF EXISTS ms_area_code,
--     DROP COLUMN IF EXISTS ms_bay_codes,
--     DROP COLUMN IF EXISTS ms_task_id,
--     DROP COLUMN IF EXISTS ms_project_id,
--     DROP COLUMN IF EXISTS ms_bay_schedule_id;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260728_timesheet_ms_project_link.sql';
-- ============================================================================================
