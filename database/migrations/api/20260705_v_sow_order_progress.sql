-- F3a/F3b-1.6 — v_sow_order_progress: "where is this order now" (frontier + debt).
--
-- Read-only, derived, honours I3 (never writes plan/schedule tables). One summary row
-- per production_order.
--
-- DONE decision (F3b-1.6, master plan §C):
--   * "sudah" per op = sow.status = 'FINISH' (NOT timesheet hours).
--   * Order with EXISTS a TECO op (ph3_order.order_description='TECO') = done => excluded.
--   * Op-set = FULL sow routing (all ops per order), NOT the timesheet-activity base view.
--     (The activity base is only a subset of the routing; using it made the frontier skip
--      routing ops without timesheet activity — e.g. order 1000123166 gave frontier 300
--      instead of the true 30.) vw_sow_operation_actual is used only by the ladder/base
--      lookups for hours/deviation, never as the frontier op-set.
--
-- Model:
--   frontier_op         = LOWEST op with eff_status in (belum, nyangkut) — earliest
--                         outstanding routing step; `dilewati` is skipped into debt.
--   eff_status          = FINISH -> 'sudah' (wins, so a skipped op auto-clears when it
--                         later becomes FINISH); else manual nyangkut/dilewati; else belum.
--   highest_done_op     = max op that is FINISH.
--   debt_ops            = dilewati ops. blocked_ops = nyangkut ops.
--   behind_frontier_ops = non-sudah ops with operation_no < highest_done_op (out-of-order).
--   status_color        = red (debt/nyangkut) / amber (behind belum) / green (clean).
--   frontier_machine    = sow.workcenter -> machineid (routing machine; also the mark
--                         target for a ghost op with no activity row).
--
-- Canonical op order = operation_no. Perf ~0.5s (no whole-base scan). Does NOT touch
-- vw_sow_plan_vs_actual_hours.

BEGIN;

CREATE OR REPLACE VIEW public.v_sow_order_progress AS
WITH teco AS (
  SELECT DISTINCT order_no FROM public.ph3_order WHERE order_description = 'TECO'
),
wc_map AS (   -- workcenter code -> physical machineid (for the frontier/mark machine)
  SELECT DISTINCT ON (code) code, machineid FROM (
    SELECT machineid::text AS code, machineid FROM public.workcenter
    UNION ALL SELECT workcenternew, machineid FROM public.workcenter WHERE COALESCE(workcenternew,'')<>''
    UNION ALL SELECT workcenterold, machineid FROM public.workcenter WHERE COALESCE(workcenterold,'')<>''
    UNION ALL SELECT workcenterot,  machineid FROM public.workcenter WHERE COALESCE(workcenterot,'')<>''
  ) x ORDER BY code, machineid
),
ov AS (   -- manual overlay collapsed to (order, op)
  SELECT production_order, operation_no,
    bool_or(manual_flag='nyangkut') AS any_nyangkut,
    bool_or(manual_flag='dilewati') AS any_dilewati
  FROM public.sow_operation_status GROUP BY production_order, operation_no
),
op2 AS (
  SELECT s.order_no AS production_order, s.operation_no,
    CASE WHEN s.status='FINISH' THEN 'sudah'   -- FINISH wins => clears skip/block
         WHEN ov.any_nyangkut   THEN 'nyangkut'
         WHEN ov.any_dilewati   THEN 'dilewati'
         ELSE 'belum' END AS eff_status,
    wm.machineid::text AS a_machine,
    max(s.operation_no) FILTER (WHERE s.status='FINISH') OVER (PARTITION BY s.order_no) AS highest_done_op
  FROM public.sow s
  LEFT JOIN teco t   ON t.order_no = s.order_no
  LEFT JOIN ov       ON ov.production_order = s.order_no AND ov.operation_no = s.operation_no
  LEFT JOIN wc_map wm ON wm.code = s.workcenter
  WHERE t.order_no IS NULL          -- TECO order => done => excluded
    AND s.order_no IS NOT NULL
),
agg AS (
  SELECT production_order,
    max(highest_done_op) AS highest_done_op,
    count(*) AS total_ops,
    count(*) FILTER (WHERE eff_status='sudah') AS done_ops,
    min(operation_no) FILTER (WHERE eff_status IN ('belum','nyangkut')) AS frontier_op,
    array_agg(operation_no ORDER BY operation_no) FILTER (WHERE eff_status='dilewati') AS debt_ops_raw,
    count(*) FILTER (WHERE eff_status='dilewati') AS debt_count,
    array_agg(operation_no ORDER BY operation_no) FILTER (WHERE eff_status='nyangkut') AS blocked_ops_raw,
    count(*) FILTER (WHERE eff_status='nyangkut') AS blocked_count,
    array_agg(operation_no ORDER BY operation_no) FILTER (WHERE eff_status IN ('belum','nyangkut','dilewati') AND highest_done_op IS NOT NULL AND operation_no < highest_done_op) AS behind_raw,
    count(*) FILTER (WHERE eff_status IN ('dilewati','nyangkut')) AS n_manual_dev,
    count(*) FILTER (WHERE eff_status='belum' AND highest_done_op IS NOT NULL AND operation_no < highest_done_op) AS n_behind_belum
  FROM op2 GROUP BY production_order
)
SELECT a.production_order, a.total_ops, a.done_ops, a.total_ops - a.done_ops AS undone_ops,
  a.highest_done_op, a.frontier_op, fo.eff_status AS frontier_status, fo.a_machine AS frontier_machine,
  COALESCE(a.debt_ops_raw,'{}')    AS debt_ops, a.debt_count,
  COALESCE(a.blocked_ops_raw,'{}') AS blocked_ops, a.blocked_count,
  COALESCE(a.behind_raw,'{}')      AS behind_frontier_ops,
  (a.n_manual_dev > 0 OR a.n_behind_belum > 0) AS is_deviating,
  CASE WHEN a.n_manual_dev > 0 THEN 'red' WHEN a.n_behind_belum > 0 THEN 'amber' ELSE 'green' END AS status_color,
  NULL::date AS last_activity_date   -- unused by FE; the date-picker fallback reads
                                     -- max(schedule_date) from the base view, not this column
FROM agg a
LEFT JOIN op2 fo ON fo.production_order = a.production_order AND fo.operation_no = a.frontier_op;

COMMIT;

-- ROLLBACK: restore the prior (timesheet-based) definition from git history.
