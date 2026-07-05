-- F2 — SOW Scheduling daily verification layer.
--
-- The manual layer COMPLEMENTS the two existing actual views
-- (vw_sow_plan_vs_actual_hours from timesheet_transaction,
--  vw_sow_planned_queue_vs_actual_queue from buffer_transaction).
-- It only stores what those views cannot know: `dilewati` (skipped) and
-- `nyangkut` (blocked + reason) + a verifier override note.
-- "sudah/belum", machine deviation and sequence deviation stay AUTO-derived.
--
-- Hard invariants honoured:
--   I1  no batch/capacity accounting touched here.
--   I3  plan tables are never written; effective status is derived, and the
--       original view conclusion is kept alongside the override (no COALESCE
--       that discards it) — verifier override wins but view_status is retained.
--
-- Non-destructive (CREATE ... IF NOT EXISTS / OR REPLACE). Reversible via the
-- ROLLBACK block at the bottom.

BEGIN;

-- 5.1 — sparse manual overlay (one row per op only when a verifier marks it).
CREATE TABLE IF NOT EXISTS public.sow_operation_status (
  id                       bigserial PRIMARY KEY,
  production_order         text    NOT NULL,
  operation_no             integer NOT NULL,
  -- Grain is per workcenter: an operation can be split across workcenters and
  -- each split may carry a different status (one sudah, one nyangkut). Matches
  -- vw_sow_plan_vs_actual_hours' workcenter (COALESCE(NULLIF(workcenter,''),machine_code)).
  workcenter               text    NOT NULL,
  manual_flag              text    NOT NULL
    CHECK (manual_flag IN ('dilewati', 'nyangkut')),
  blocked_reason           text,
  blocked_by_machine_code  text,
  blocked_by_order         text,
  override_note            text,
  status_date              date    NOT NULL DEFAULT CURRENT_DATE,
  updated_by               integer,
  updated_by_name          text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  -- reason is mandatory when blocked
  CONSTRAINT sow_operation_status_blocked_reason_chk
    CHECK (manual_flag <> 'nyangkut' OR blocked_reason IS NOT NULL),
  -- one manual status per operation-workcenter per day
  CONSTRAINT sow_operation_status_uq
    UNIQUE (production_order, operation_no, workcenter, status_date)
);

CREATE INDEX IF NOT EXISTS idx_sow_operation_status_order
  ON public.sow_operation_status (production_order);
CREATE INDEX IF NOT EXISTS idx_sow_operation_status_flag
  ON public.sow_operation_status (manual_flag);
CREATE INDEX IF NOT EXISTS idx_sow_operation_status_date
  ON public.sow_operation_status (status_date);

-- 5.2 — append-only verification audit trail.
CREATE TABLE IF NOT EXISTS public.sow_verification_log (
  id                bigserial PRIMARY KEY,
  verification_date date    NOT NULL DEFAULT CURRENT_DATE,
  production_order  text    NOT NULL,
  operation_no      integer NOT NULL,
  workcenter        text    NOT NULL,
  status_before     text
    CHECK (status_before IS NULL OR status_before IN ('belum','sudah','dilewati','nyangkut')),
  status_after      text
    CHECK (status_after IS NULL OR status_after IN ('belum','sudah','dilewati','nyangkut')),
  deviation_flags   jsonb   NOT NULL DEFAULT '[]'::jsonb,
  verified_by       integer,
  verified_by_name  text,
  verified_at       timestamptz NOT NULL DEFAULT now(),
  note              text
);

CREATE INDEX IF NOT EXISTS idx_sow_verification_log_date
  ON public.sow_verification_log (verification_date);
CREATE INDEX IF NOT EXISTS idx_sow_verification_log_order
  ON public.sow_verification_log (production_order);

-- 5.3 — combined view: effective status (manual override wins) + the ORIGINAL
-- view conclusion kept for audit, never overwritten. Grain = one row per
-- planned/actual operation instance per day (from the hours view).
CREATE OR REPLACE VIEW public.vw_sow_operation_actual AS
WITH base AS (
  SELECT
    h.schedule_date,
    h.shift_id,
    h.shift_code,
    h.shift_name,
    h.machine_code,
    h.workcenter,
    h.production_order,
    h.operation_no,
    h.normal_planned_hours,
    h.actual_hours,
    h.variance_hours,
    h.planned_status,
    h.overtime_status,
    q.planned_queue_no,
    q.actual_queue_no,
    q.queue_variance,
    q.comparison_status
  FROM public.vw_sow_plan_vs_actual_hours h
  LEFT JOIN LATERAL (
    SELECT qq.planned_queue_no, qq.actual_queue_no, qq.queue_variance, qq.comparison_status
    FROM public.vw_sow_planned_queue_vs_actual_queue qq
    WHERE qq.schedule_date = h.schedule_date
      AND NOT (qq.machine_code     IS DISTINCT FROM h.machine_code)
      AND NOT (qq.production_order IS DISTINCT FROM h.production_order)
      AND NOT (qq.operation_no     IS DISTINCT FROM h.operation_no)
    ORDER BY qq.actual_queue_datetime NULLS LAST
    LIMIT 1
  ) q ON true
)
SELECT
  b.schedule_date,
  b.shift_id,
  b.shift_code,
  b.shift_name,
  b.machine_code,
  b.workcenter,
  b.production_order,
  b.operation_no,
  b.normal_planned_hours,
  b.actual_hours,
  b.variance_hours,
  b.planned_status,
  b.overtime_status,
  b.planned_queue_no,
  b.actual_queue_no,
  b.queue_variance,
  b.comparison_status,
  -- original auto conclusion from the views (kept for audit, never manual)
  CASE WHEN COALESCE(b.actual_hours, 0) > 0 THEN 'sudah' ELSE 'belum' END AS view_status,
  -- manual overlay (sparse)
  s.id                       AS manual_status_id,
  s.manual_flag,
  s.blocked_reason,
  s.blocked_by_machine_code,
  s.blocked_by_order,
  -- effective status: verifier override wins, else fall back to view conclusion
  -- (explicit precedence, NOT a plain COALESCE that would discard view_status)
  CASE
    WHEN s.manual_flag = 'nyangkut'            THEN 'nyangkut'
    WHEN s.manual_flag = 'dilewati'            THEN 'dilewati'
    WHEN COALESCE(b.actual_hours, 0) > 0       THEN 'sudah'
    ELSE 'belum'
  END AS effective_status,
  (s.id IS NOT NULL)         AS is_overridden,
  s.override_note            AS overridden_note,
  s.updated_by               AS overridden_by,
  s.updated_by_name          AS overridden_by_name,
  s.updated_at               AS overridden_at,
  -- derived deviations (never stored); coalesced so the client always gets a boolean
  COALESCE(b.comparison_status = 'MACHINE_CHANGED', false)           AS machine_deviation,
  COALESCE(b.queue_variance IS NOT NULL AND b.queue_variance <> 0, false) AS sequence_deviation
FROM base b
LEFT JOIN public.sow_operation_status s
  ON s.production_order = b.production_order
 AND s.operation_no     = b.operation_no
 AND s.workcenter       = b.workcenter      -- per-workcenter: override sticks to its own split only
 AND s.status_date       = b.schedule_date;

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually to reverse this migration):
-- BEGIN;
-- DROP VIEW  IF EXISTS public.vw_sow_operation_actual;
-- DROP TABLE IF EXISTS public.sow_verification_log;
-- DROP TABLE IF EXISTS public.sow_operation_status;
-- COMMIT;
-- ---------------------------------------------------------------------------
