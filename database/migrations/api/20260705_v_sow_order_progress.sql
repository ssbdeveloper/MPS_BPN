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
--
-- PERF (F3b-1.5, lapis 1): rewritten aggregate-only — debt/blocked/behind/is_deviating/
-- status_color are computed with FILTER aggregates + a window for highest_done_op, instead
-- of per-row correlated subqueries. Same column interface; verified identical to the prior
-- definition for all real orders. Execution dropped from ~66s to ~5s (the residual ~5s is
-- the base view vw_sow_operation_actual itself — addressed separately). Also excludes the
-- NULL-production_order phantom (timesheet rows with null order_no): it is not a real order,
-- the endpoint never returns it (NULL IN (...) is false), and the old definition only kept
-- it via a "= NULL" bug in a correlated subquery (last_activity_date came out NULL).

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
  WHERE production_order IS NOT NULL
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
    END AS eff_status,
    -- highest done op for the order, carried on every row via a window (avoids a
    -- correlated subquery in the aggregate below)
    max(operation_no) FILTER (WHERE ever_sudah) OVER (PARTITION BY production_order) AS highest_done_op
  FROM op
),
agg AS (
  SELECT
    production_order,
    max(highest_done_op)                                               AS highest_done_op,
    count(*)                                                           AS total_ops,
    count(*) FILTER (WHERE eff_status = 'sudah')                       AS done_ops,
    -- frontier skips `dilewati` (it is debt) => lowest belum/nyangkut op
    min(operation_no) FILTER (WHERE eff_status IN ('belum','nyangkut')) AS frontier_op,
    array_agg(operation_no ORDER BY operation_no) FILTER (WHERE eff_status = 'dilewati') AS debt_ops_raw,
    count(*) FILTER (WHERE eff_status = 'dilewati')                    AS debt_count,
    array_agg(operation_no ORDER BY operation_no) FILTER (WHERE eff_status = 'nyangkut') AS blocked_ops_raw,
    count(*) FILTER (WHERE eff_status = 'nyangkut')                    AS blocked_count,
    array_agg(operation_no ORDER BY operation_no) FILTER (
      WHERE eff_status IN ('belum','nyangkut','dilewati')
        AND highest_done_op IS NOT NULL AND operation_no < highest_done_op
    )                                                                  AS behind_raw,
    count(*) FILTER (WHERE eff_status IN ('dilewati','nyangkut'))      AS n_manual_dev,
    count(*) FILTER (
      WHERE eff_status = 'belum'
        AND highest_done_op IS NOT NULL AND operation_no < highest_done_op
    )                                                                  AS n_behind_belum,
    max(last_date)                                                     AS last_activity_date
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
  COALESCE(a.debt_ops_raw, '{}')    AS debt_ops,
  a.debt_count,
  COALESCE(a.blocked_ops_raw, '{}') AS blocked_ops,
  a.blocked_count,
  COALESCE(a.behind_raw, '{}')      AS behind_frontier_ops,
  (a.n_manual_dev > 0 OR a.n_behind_belum > 0) AS is_deviating,
  CASE
    WHEN a.n_manual_dev  > 0 THEN 'red'
    WHEN a.n_behind_belum > 0 THEN 'amber'
    ELSE 'green'
  END AS status_color,
  a.last_activity_date
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
