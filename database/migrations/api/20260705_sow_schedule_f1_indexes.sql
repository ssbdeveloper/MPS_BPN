-- F1 (SOW Scheduling perf) — A6: add the two indexes F0 found missing.
-- Most hot-path indexes already exist (idx_sow_schedule_sow, idx_sow_schedule_machine_shift,
-- idx_sow_schedule_window, idx_sow_overtime_sow, idx_sow_overtime_status). These two cover
-- the board's date-only load (loadBoard filters sow_schedule by schedule_date) and the batch
-- pocket lookups (getBatchUsedHours / DropZone grouping join on sc.batch_id).
-- Non-destructive: CREATE INDEX IF NOT EXISTS. Reversible via the DROP block below.

CREATE INDEX IF NOT EXISTS idx_sow_schedule_date
  ON public.sow_schedule (schedule_date);

CREATE INDEX IF NOT EXISTS idx_sow_schedule_batch_id
  ON public.sow_schedule (batch_id)
  WHERE batch_id IS NOT NULL;

-- Rollback:
-- DROP INDEX IF EXISTS public.idx_sow_schedule_date;
-- DROP INDEX IF EXISTS public.idx_sow_schedule_batch_id;
