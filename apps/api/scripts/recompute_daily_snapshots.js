/**
 * recompute_daily_snapshots.js
 *
 * ⛔ UNSAFE FOR PAST DATES — DO NOT RUN. Kept for reference only; it aborts at startup.
 *    Use scripts/patch_adoption_labour_snapshot.js instead (surgical, one KPI element).
 *
 *    Defect (measured on 2026-07-18, 2026-07-22): a whole-row rewrite CANNOT faithfully reproduce
 *    every KPI for a historical date, so it trades one fix for several regressions —
 *      - adoption_machine -> null : calculateAdoptionForMainSnapshot(bounds, options.grain) ->
 *        getCachedAdoptionCalculation reads kpi_snapshot WHERE grain=$1; basis:'date' yields
 *        grain='date', for which no cached row exists. Real 99.8 would be overwritten with null.
 *      - uptime_tablet -> null    : placeholderCalculation, never computed on this path.
 *      - accuracy_* / ole drift   : underlying timesheet/machine data for past dates keeps being
 *        backfilled, so a fresh calc legitimately differs from the frozen row (98.2->99.6,
 *        99.7->99.9, 72.1->72.7) — a change the caller did not ask for and cannot review per-KPI.
 *    Making this safe requires either per-KPI merge (which is what the surgical script does) or
 *    fixing the calculator so a 'date' basis reproduces every KPI. Neither is done.
 *
 * ORIGINAL INTENT (unchanged below) — rewrite stale historical daily (grain='today') KPI snapshots.
 *
 * WHY THIS EXISTS
 *   The snapshot job (jobs/ewsSnapshotJob.js) only ever computes "today" + rolling windows. Once a
 *   day passes, its grain='today' row in ews.kpi_snapshot is FROZEN and never recomputed. So any
 *   change that affects a PAST day's adoption denominator leaves the stored snapshot stale:
 *     - an operator marked usernfc.inactive_from = D  -> snapshots for business_date >= D still
 *       count them as ABSENT in the denominator (too low a %).
 *     - shift_roster corrected after the fact (e.g. Saturday SCHEDULED -> OFF from a cutoff) ->
 *       snapshots still count the removed rows.
 *   calculateSystemSummary({basis:'date'}) is read-only by design and writes nothing, so there was
 *   no way to fix a past daily row. This script uses the persistDaily path (added to the calculator)
 *   to recompute a date and UPSERT it as the same grain='today' row (ON CONFLICT window_start,grain).
 *
 * IT ONLY RE-READS — the numbers come from the SAME live calculation the dashboard uses (roster_effective
 * etc.), so it reflects whatever the current data says. PREREQUISITES must already be applied:
 *   - inactive-operator case: usernfc.inactive_from populated + the roster_effective view migration live.
 *   - stale-roster case:      shift_roster already corrected for the target dates.
 * Run detect_stale_snapshots.sql first to see which dates are affected.
 *
 * SCOPE GUARD: only PAST dates (< today, WITA) are touched. Today is owned by the live job; rewriting
 * it here would race. Weekends/dates with no roster simply recompute to whatever the calc returns.
 *
 * USAGE
 *   node apps/api/scripts/recompute_daily_snapshots.js --from 2026-07-15 --to 2026-07-21
 *   node apps/api/scripts/recompute_daily_snapshots.js --dates 2026-07-18,2026-07-19
 *   node apps/api/scripts/recompute_daily_snapshots.js --from 2026-07-15 --to 2026-07-21 --dry-run
 *
 *   --dry-run recomputes read-only and prints stored-vs-recomputed adoption WITHOUT writing.
 *   Always dry-run first and eyeball the deltas before the real run.
 */
require("../config/loadEnv");
const { Pool, types } = require("pg");
const { resolveTimezone } = require("../config/timezone");

types.setTypeParser(1082, (str) => str);
types.setTypeParser(1114, (str) => str);
types.setTypeParser(1184, (str) => str);

const TZ = resolveTimezone();

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--from") args.from = argv[++i];
    else if (a === "--to") args.to = argv[++i];
    else if (a === "--dates") args.dates = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function assertIso(d) {
  if (!ISO.test(String(d || ""))) throw new Error(`Bad date (want YYYY-MM-DD): ${d}`);
}
function eachDate(from, to) {
  assertIso(from); assertIso(to);
  const out = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (cur > end) throw new Error(`--from ${from} is after --to ${to}`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 2,
  application_name: "mps2-recompute-daily-snapshots",
  options: `-c timezone=${TZ}`, // window_start must land on midnight WITA, matching the frozen daily row
});
global.pool = pool;

const ewsCalculator = require("../services/ewsCalculator");

async function storedAdoption(date) {
  const { rows } = await pool.query(
    `SELECT adoption_pct,
            (SELECT k->>'value' FROM jsonb_array_elements(detail_json->'kpis') k
              WHERE k->>'key'='adoption_labour') AS labour_pct
       FROM ews.kpi_snapshot
      WHERE scope_type='system' AND grain='today'
        AND (window_start AT TIME ZONE $2)::date = $1::date
      ORDER BY calculated_at DESC LIMIT 1`,
    [date, TZ],
  );
  return rows[0] || null;
}

async function main() {
  // Hard stop: see the ⛔ block at the top of this file. A whole-row rewrite corrupts KPIs that a
  // basis:'date' recompute cannot reproduce. Escape hatch exists only so the defect can be re-measured.
  if (!process.argv.includes("--i-know-this-is-unsafe")) {
    throw new Error(
      "UNSAFE — refusing to run. A whole-row recompute nulls adoption_machine/uptime_tablet and drifts "
      + "accuracy_*/ole for past dates. Use scripts/patch_adoption_labour_snapshot.js instead. "
      + "(Override for diagnostics only: --i-know-this-is-unsafe)",
    );
  }
  const args = parseArgs(process.argv.filter((a) => a !== "--i-know-this-is-unsafe"));
  let dates;
  if (args.dates) dates = args.dates.split(",").map((s) => s.trim()).filter(Boolean);
  else if (args.from && args.to) dates = eachDate(args.from, args.to);
  else throw new Error("Provide --from/--to or --dates");
  dates.forEach(assertIso);

  const { rows: t } = await pool.query(`SELECT (now() AT TIME ZONE $1)::date::text AS today`, [TZ]);
  const today = t[0].today;
  const past = dates.filter((d) => d < today);
  const skipped = dates.filter((d) => d >= today);
  if (skipped.length) console.warn(`[recompute] skipping today/future (owned by live job): ${skipped.join(", ")}`);

  console.log(`[recompute] ${args.dryRun ? "DRY-RUN" : "WRITE"} · TZ=${TZ} · ${past.length} date(s)`);
  for (const date of past) {
    const before = await storedAdoption(date);
    const payload = await ewsCalculator.calculateSystemSummary({ basis: "date", date, persistDaily: !args.dryRun });
    const labour = payload.kpis.find((k) => k.key === "adoption_labour");
    const after = labour ? labour.value : null;
    console.log(
      `[recompute] ${date} labour_adoption: stored=${before?.labour_pct ?? "—"} -> recomputed=${after ?? "—"}` +
      (args.dryRun ? "  (dry-run, not written)" : "  (written)"),
    );
  }
  console.log(`[recompute] done (${args.dryRun ? "no writes" : "written"}).`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("[recompute] failed:", err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
