-- detect_stale_snapshots.sql — find frozen daily (grain='today') KPI snapshots whose adoption_labour
-- denominator is now wrong, so you know which dates to feed recompute_daily_snapshots.js.
--
-- Background: ews.kpi_snapshot grain='today' rows are written once (when the day is "today") and never
-- recomputed. detail_json->'kpis'[key=adoption_labour]->'detail'->'breakdown' is an array of the
-- scheduled operators that formed the denominator, each: {operator_key, business_date, shift, status,
-- attendance, standard_hours, ...}. These read-only queries flag rows that a fresh calc would change.

-- ============================================================================================
-- (A) INACTIVE OPERATOR — snapshots for business_date >= inactive_from that still count a resigned
--     operator in the denominator (status='SCHEDULED'). After setting usernfc.inactive_from, recompute
--     [inactive_from, today) so these drop out.
--     Params: :serial (snssb), :inactive_from (YYYY-MM-DD).  Run once per resigned operator, or use
--     the set-wide variant below.
-- ============================================================================================
-- Single operator:
SELECT (e->>'business_date')::date AS business_date, s.adoption_pct AS stored_pct, s.calculated_at
FROM ews.kpi_snapshot s
CROSS JOIN LATERAL (
  SELECT k->'detail'->'breakdown' AS bd
  FROM jsonb_array_elements(s.detail_json->'kpis') k WHERE k->>'key'='adoption_labour'
) kk
CROSS JOIN LATERAL jsonb_array_elements(kk.bd) e
WHERE s.scope_type='system' AND s.grain='today'
  AND e->>'operator_key' = :'serial'
  AND e->>'status' = 'SCHEDULED'
  AND (e->>'business_date')::date >= :'inactive_from'::date
GROUP BY 1,2,3
ORDER BY 1;

-- Set-wide (every operator that has an inactive_from, joined to the snapshots that still count them):
SELECT (e->>'business_date')::date AS business_date, count(DISTINCT e->>'operator_key') AS stale_ops,
       min(s.adoption_pct) AS stored_pct
FROM ews.kpi_snapshot s
CROSS JOIN LATERAL (
  SELECT k->'detail'->'breakdown' AS bd
  FROM jsonb_array_elements(s.detail_json->'kpis') k WHERE k->>'key'='adoption_labour'
) kk
CROSS JOIN LATERAL jsonb_array_elements(kk.bd) e
JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb),'') = e->>'operator_key'
WHERE s.scope_type='system' AND s.grain='today'
  AND u.inactive_from IS NOT NULL
  AND e->>'status' = 'SCHEDULED'
  AND (e->>'business_date')::date >= u.inactive_from
GROUP BY 1
ORDER BY 1;

-- ============================================================================================
-- (B) STALE WORKDAY (e.g. Saturday flipped to OFF) — snapshots counting operators SCHEDULED for a
--     shift/weekday the CURRENT roster_workday_rule no longer runs.
--
--     CAVEAT — roster_workday_rule is a TIMELESS boolean (PK day_of_week, no effective date). Applying
--     the current rule to the past OVER-FLAGS: a Saturday that was legitimately a working (half) day
--     BEFORE the cutoff will be flagged too. DO NOT recompute those — you would erase real history.
--     The :cutoff guard restricts to dates on/after the policy change (e.g. Saturday-OFF from 14 Jul).
--     Confirm the cutoff against the roster decision log before recomputing.
--     Params: :cutoff (YYYY-MM-DD) — first date the new workday rule applies.
-- ============================================================================================
SELECT (e->>'business_date')::date AS business_date,
       EXTRACT(dow FROM (e->>'business_date')::date)::int AS dow,
       s.adoption_pct AS stored_pct,
       count(*) AS stale_scheduled_ops,
       round(sum((e->>'standard_hours')::numeric),1) AS stale_std_hours
FROM ews.kpi_snapshot s
CROSS JOIN LATERAL (
  SELECT k->'detail'->'breakdown' AS bd
  FROM jsonb_array_elements(s.detail_json->'kpis') k WHERE k->>'key'='adoption_labour'
) kk
CROSS JOIN LATERAL jsonb_array_elements(kk.bd) e
JOIN ews.roster_workday_rule wr ON wr.day_of_week = EXTRACT(dow FROM (e->>'business_date')::date)::int
WHERE s.scope_type='system' AND s.grain='today'
  AND e->>'status'='SCHEDULED'
  AND (e->>'business_date')::date >= :'cutoff'::date        -- honor the policy cutoff; do NOT flag pre-cutoff working Saturdays
  AND ((e->>'shift'='DAY' AND NOT wr.runs_day) OR (e->>'shift'='NIGHT' AND NOT wr.runs_night))
GROUP BY 1,2,3
ORDER BY 1;

-- Recompute prerequisite for (B): shift_roster for these dates must ALREADY be corrected (SCHEDULED->OFF),
-- because the recompute re-reads roster_effective. Detection alone does not fix the roster.
