-- F3a — v_sow_order_progress: "where is this order now" (frontier + debt model).
--
-- Read-only, derived, honours I3 (never writes plan/schedule tables). Built ON TOP of
-- vw_sow_operation_actual and uses EFFECTIVE status (manual override wins), collapsed
-- per (order, op) across dates+machines. One summary row per production_order.
--
-- Canonical op order = operation_no (planned_queue_no is only 0.1% populated and is a
-- per-machine queue position, not the order's routing sequence — see F3a investigation).
--
-- Model (approved):
--   frontier_op          = LOWEST undone op (belum/nyangkut) — the earliest outstanding
--                          routing step. `dilewati` is skipped here (it is debt, shown
--                          separately) so a skipped early op never hides.
--   highest_done_op      = how far the order has raced ahead.
--   debt_ops             = `dilewati` ops not yet paid (no `sudah` on any date).
--   blocked_ops          = `nyangkut` ops.
--   behind_frontier_ops  = undone ops with operation_no < highest_done_op — out-of-order
--                          execution / implicit skips (the order jumped past them).
--   is_deviating / color : red = debt or nyangkut; amber = behind_frontier only; green = clean.
--   Cross-day debt payoff: an op is `sudah` if effective='sudah' on ANY date (ever_sudah
--   wins), so a skipped op automatically clears once it is later done.

BEGIN;

CREATE OR REPLACE VIEW public.v_sow_order_progress AS
WITH op AS (
  -- collapse per (order, op) across dates + machines, using effective status
  SELECT
    production_order,
    operation_no,
    bool_or(effective_status = 'sudah')    AS ever_sudah,     -- done any day => debt paid
    bool_or(effective_status = 'nyangkut') AS any_nyangkut,
    bool_or(effective_status = 'dilewati') AS any_dilewati,
    (array_agg(machine_code ORDER BY machine_code))[1] AS a_machine,
    max(schedule_date) AS last_date
  FROM public.vw_sow_operation_actual
  GROUP BY production_order, operation_no
),
op2 AS (
  SELECT
    production_order, operation_no, a_machine, last_date,
    CASE
      WHEN ever_sudah   THEN 'sudah'      -- ever done wins (clears skip/block)
      WHEN any_nyangkut THEN 'nyangkut'
      WHEN any_dilewati THEN 'dilewati'
      ELSE 'belum'
    END AS eff_status
  FROM op
),
agg AS (
  SELECT
    production_order,
    count(*)                                                            AS total_ops,
    count(*) FILTER (WHERE eff_status = 'sudah')                        AS done_ops,
    max(operation_no) FILTER (WHERE eff_status = 'sudah')               AS highest_done_op,
    -- frontier skips `dilewati` (it is debt) => lowest belum/nyangkut op
    min(operation_no) FILTER (WHERE eff_status IN ('belum','nyangkut')) AS frontier_op
  FROM op2
  GROUP BY production_order
)
SELECT
  a.production_order,
  a.total_ops,
  a.done_ops,
  a.total_ops - a.done_ops AS undone_ops,
  a.highest_done_op,
  a.frontier_op,
  fo.eff_status  AS frontier_status,
  fo.a_machine   AS frontier_machine,
  COALESCE((SELECT array_agg(operation_no ORDER BY operation_no) FROM op2 o
            WHERE o.production_order = a.production_order AND o.eff_status = 'dilewati'), '{}') AS debt_ops,
  (SELECT count(*) FROM op2 o WHERE o.production_order = a.production_order AND o.eff_status = 'dilewati') AS debt_count,
  COALESCE((SELECT array_agg(operation_no ORDER BY operation_no) FROM op2 o
            WHERE o.production_order = a.production_order AND o.eff_status = 'nyangkut'), '{}') AS blocked_ops,
  (SELECT count(*) FROM op2 o WHERE o.production_order = a.production_order AND o.eff_status = 'nyangkut') AS blocked_count,
  COALESCE((SELECT array_agg(operation_no ORDER BY operation_no) FROM op2 o
            WHERE o.production_order = a.production_order
              AND o.eff_status IN ('belum','nyangkut','dilewati')
              AND a.highest_done_op IS NOT NULL
              AND o.operation_no < a.highest_done_op), '{}') AS behind_frontier_ops,
  EXISTS (
    SELECT 1 FROM op2 o
    WHERE o.production_order = a.production_order
      AND ( o.eff_status IN ('dilewati','nyangkut')
            OR (o.eff_status = 'belum' AND a.highest_done_op IS NOT NULL AND o.operation_no < a.highest_done_op) )
  ) AS is_deviating,
  CASE
    WHEN EXISTS (SELECT 1 FROM op2 o WHERE o.production_order = a.production_order
                 AND o.eff_status IN ('nyangkut','dilewati')) THEN 'red'
    WHEN EXISTS (SELECT 1 FROM op2 o WHERE o.production_order = a.production_order
                 AND o.eff_status = 'belum'
                 AND a.highest_done_op IS NOT NULL AND o.operation_no < a.highest_done_op) THEN 'amber'
    ELSE 'green'
  END AS status_color,
  (SELECT max(last_date) FROM op2 o WHERE o.production_order = a.production_order) AS last_activity_date
FROM agg a
LEFT JOIN op2 fo
  ON fo.production_order = a.production_order
 AND fo.operation_no    = a.frontier_op;

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK:
-- BEGIN;
-- DROP VIEW IF EXISTS public.v_sow_order_progress;
-- COMMIT;
-- ---------------------------------------------------------------------------
