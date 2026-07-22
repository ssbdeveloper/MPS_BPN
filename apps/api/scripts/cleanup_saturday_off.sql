-- cleanup_saturday_off.sql — flip stale Saturday roster rows to OFF (policy: Saturday OFF from 2026-07-14).
--
-- REVIEW-AND-RUN-YOURSELF against prod. Do NOT let the assistant run this.
--
-- Context (verified read-only 2026-07-22): the "Saturday OFF from 14 Jul" policy was set in
-- roster_workday_rule (dow=6 runs_day=false, runs_night=false), but the shift_roster rows generated
-- BEFORE that flip were never cleaned. Current state of Saturdays >= 2026-07-14:
--     2026-07-18  SCHEDULED  source=auto  46 rows
--     2026-07-25  SCHEDULED  source=auto  45 rows
-- No 'manual' rows, no existing OFF rows. Expected total flipped: 91.
--
-- Pre-cutoff Saturdays (e.g. 2026-07-11) are DELIBERATELY excluded: they were legitimate working
-- (half) days before the policy, so business_date >= '2026-07-14' must stay in the predicate. Do NOT
-- widen it — roster_workday_rule is a timeless boolean and would otherwise erase real history.
--
-- Guard: source IS DISTINCT FROM 'manual' — never overwrite a foreman's manual status edit. status is
-- flipped SCHEDULED -> OFF (OFF lands in the adoption 'excused' bucket, out of the denominator; the row
-- is kept for audit, not deleted). The generator's ON CONFLICT DO NOTHING + the now-OFF workday rule
-- mean these rows will not be regenerated.
--
-- This corrects shift_roster ONLY. The frozen kpi_snapshot rows for 07-18/07-25 stay stale until you
-- run the recompute AFTERWARD (see the ordering block at the bottom).

-- ── Step A — PREVIEW (read-only): exactly what will change. Expect 07-18=46, 07-25=45. ──────────────
SELECT business_date::text AS bd, status, source, count(*) AS rows_to_flip
FROM ews.shift_roster
WHERE EXTRACT(dow FROM business_date)::int = 6
  AND business_date >= '2026-07-14'
  AND status = 'SCHEDULED'
  AND source IS DISTINCT FROM 'manual'
GROUP BY business_date, status, source
ORDER BY business_date;

-- ── Step B — APPLY inside a transaction so you can verify before COMMIT. ─────────────────────────────
BEGIN;

UPDATE ews.shift_roster
SET status     = 'OFF',
    source     = 'manual',                  -- shift_roster_source_check allows only 'auto'|'manual';
    updated_by = 'ews-roster-cleanup',      -- provenance is traced via updated_by, not source
    updated_at = now()
WHERE EXTRACT(dow FROM business_date)::int = 6
  AND business_date >= '2026-07-14'
  AND status = 'SCHEDULED'
  AND source IS DISTINCT FROM 'manual';
-- Expect: UPDATE 91

-- Verify inside the transaction: every targeted Saturday should now be OFF, zero SCHEDULED left.
SELECT business_date::text AS bd, status, count(*) AS n
FROM ews.shift_roster
WHERE EXTRACT(dow FROM business_date)::int = 6
  AND business_date >= '2026-07-14'
GROUP BY business_date, status
ORDER BY business_date, status;
-- Expect only status=OFF rows for 07-18 (46) and 07-25 (45).

-- If the counts look right:
--   COMMIT;
-- If anything is off:
--   ROLLBACK;
COMMIT;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- FULL PENDING ORDER (why each precedes the next). Run top to bottom.
--
--  1. migrate: 20260722_usernfc_inactive_from.sql      (adds usernfc.inactive_from)
--        WHY FIRST: the view in step 2 references this column; setting inactive_from (step 4) needs it.
--  2. migrate: 20260722_ews_roster_effective_inactive.sql (view LEFT JOINs usernfc, filters inactive)
--        WHY: needs the column from step 1. NOTE: the running app reads `FROM ews.roster_effective`,
--        so this takes effect on live adoption/getRoster the moment it is applied — no redeploy needed
--        for the VIEW. (The generator/getConfig/UI/calculator JS changes DO need a deploy to take
--        effect; the recompute script picks up the calculator change because you run it from this repo.)
--  3. THIS FILE — cleanup Saturday roster (shift_roster SCHEDULED -> OFF, 07-18/07-25).
--        WHY BEFORE RECOMPUTE: recompute re-reads roster_effective <- shift_roster. If the roster is
--        still SCHEDULED, recompute reproduces the same stale number. Independent of steps 1-2, but
--        it MUST precede step 6. Safe to run here.
--  4. set usernfc.inactive_from for actually-resigned operators (manual SQL; the setter UI is deferred).
--        WHY AFTER 1-2: needs the column and the live view so the exclusion actually takes effect.
--        WHY BEFORE 6: recompute of dates >= inactive_from must read the resignation to drop them.
--  5. run apps/api/scripts/detect_stale_snapshots.sql
--        WHY HERE: with roster corrected (3) and resignations set (4), the detectors now list exactly
--        the frozen snapshots that diverge from corrected state — the date range to recompute.
--  6. recompute — DRY RUN first, then write:
--        node apps/api/scripts/recompute_daily_snapshots.js --from <first> --to <yesterday> --dry-run
--        node apps/api/scripts/recompute_daily_snapshots.js --from <first> --to <yesterday>
--        WHY LAST: it only re-reads the live calculation, so every data correction (3,4) and the view
--        (2) must already be in place. It skips today (owned by the live snapshot job).
--        For the Saturday fix specifically: recompute 07-18 and 07-25 (07-25 only once it is < today).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
