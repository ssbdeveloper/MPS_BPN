/**
 * patch_adoption_labour_snapshot.js — SURGICAL fix for a frozen daily snapshot's adoption_labour.
 *
 * WHY NOT recompute_daily_snapshots.js: rewriting the WHOLE snapshot row is UNSAFE for past dates.
 * A basis:'date' recompute cannot faithfully reproduce every KPI —
 *   - adoption_machine -> null  (calculateAdoptionForMainSnapshot reads cached rows WHERE grain=$1;
 *                                there is no grain='date' cache, so a real value is replaced by null)
 *   - uptime_tablet    -> null  (placeholderCalculation)
 *   - accuracy_* / ole  drift   (underlying timesheet/machine data keeps being backfilled for past dates)
 * Measured on 2026-07-18: a full rewrite would have turned adoption_machine 99.8 -> null and moved
 * accuracy_labour 98.2->99.6, accuracy_machine 99.7->99.9, ole 72.1->72.7. Net: one fix, four regressions.
 *
 * THIS script changes exactly ONE thing: the adoption_labour element inside detail_json->'kpis'.
 * Everything else is left byte-identical — the other 7 KPI elements, the legacy columns
 * (adoption_pct/accuracy_pct/oee_pct/ole_pct/uptime_pct), overall_score/overall_status, and
 * calculated_at are NOT in the UPDATE at all.
 *
 * overall_score/overall_status are deliberately NOT recomputed: historical overall has no reader
 * (getTrend does not ship it; the frontend renders overall only from today's summary), and
 * recomputing it here would duplicate the scoring formula outside its own function.
 *
 * The replacement element is taken from the REAL calculator (calculateSystemSummary basis:'date',
 * read-only) — no formula is reimplemented here. Its stale detail.breakdown (the operators that formed
 * the old denominator) and its now-meaningless `comparison` go away with it; leaving them would keep
 * detect_stale_snapshots.sql flagging the row forever and show phantom scheduled operators on drill-through.
 *
 * USAGE
 *   node apps/api/scripts/patch_adoption_labour_snapshot.js --date 2026-07-18 --dry-run
 *   node apps/api/scripts/patch_adoption_labour_snapshot.js --date 2026-07-18
 *   (optional) --backup <file>   default: <tmpdir>/kpi_snapshot_<id>_<date>.json
 *
 * PREREQUISITE: the underlying roster must already be corrected for that date, otherwise the recompute
 * just reproduces the old number. Only PAST dates are accepted.
 */
require("../config/loadEnv");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Pool, types } = require("pg");
const { resolveTimezone } = require("../config/timezone");

types.setTypeParser(1082, (s) => s);
types.setTypeParser(1114, (s) => s);
types.setTypeParser(1184, (s) => s);

const TZ = resolveTimezone();
const KEY = "adoption_labour";

function parseArgs(argv) {
  const a = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") a.dryRun = true;
    else if (argv[i] === "--date") a.date = argv[++i];
    else if (argv[i] === "--backup") a.backup = argv[++i];
    else throw new Error(`Unknown arg: ${argv[i]}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.date || ""))) throw new Error("--date YYYY-MM-DD is required");
  return a;
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 2,
  application_name: "mps2-patch-adoption-labour",
  options: `-c timezone=${TZ}`,
});
global.pool = pool;
const calc = require("../services/ewsCalculator");

const brief = (el) => (!el ? "—" : `value=${JSON.stringify(el.value)} status=${JSON.stringify(el.status)} `
  + `helper=${JSON.stringify(el.helper)} breakdown=${Array.isArray(el.detail?.breakdown) ? el.detail.breakdown.length : "—"}`);

async function main() {
  const args = parseArgs(process.argv);

  const { rows: t } = await pool.query(`SELECT (now() AT TIME ZONE $1)::date::text AS today`, [TZ]);
  if (args.date >= t[0].today) throw new Error(`Refusing: ${args.date} is today/future (owned by the live job).`);

  const { rows } = await pool.query(
    `SELECT id, detail_json, adoption_pct, accuracy_pct, oee_pct, ole_pct, uptime_pct,
            overall_score, overall_status, calculated_at
       FROM ews.kpi_snapshot
      WHERE scope_type='system' AND grain='today'
        AND (window_start AT TIME ZONE $1)::date = $2::date
      ORDER BY calculated_at DESC LIMIT 1`, [TZ, args.date]);
  if (!rows.length) throw new Error(`No grain='today' system snapshot for ${args.date}`);
  const row = rows[0];
  const before = row.detail_json;
  if (!Array.isArray(before?.kpis)) throw new Error("detail_json.kpis is not an array");

  const backupPath = args.backup || path.join(os.tmpdir(), `kpi_snapshot_${row.id}_${args.date}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ id: row.id, date: args.date, saved_at_utc: new Date().toISOString(), detail_json: before }, null, 2));
  console.log(`[patch] row id=${row.id}  backup -> ${backupPath}`);

  const idx = before.kpis.findIndex((k) => k.key === KEY);
  if (idx < 0) throw new Error(`${KEY} not present in stored snapshot`);

  // Recompute via the real calculator (read-only: no persistDaily -> writes nothing). Only the
  // adoption_labour element is taken; every other recomputed KPI is discarded on purpose.
  const fresh = await calc.calculateSystemSummary({ basis: "date", date: args.date });
  const replacement = fresh.kpis.find((k) => k.key === KEY);
  if (!replacement) throw new Error(`${KEY} missing from recomputed payload — aborting`);

  const after = { ...before, kpis: before.kpis.map((k, i) => (i === idx ? replacement : k)) };

  console.log(`\n${"KPI".padEnd(20)} element byte-identical?`);
  console.log("-".repeat(46));
  let changed = 0;
  for (let i = 0; i < before.kpis.length; i++) {
    const same = JSON.stringify(before.kpis[i]) === JSON.stringify(after.kpis[i]);
    if (!same) changed++;
    console.log(`${String(before.kpis[i].key).padEnd(20)} ${same ? "identical" : "CHANGED"}`);
  }
  console.log(`\n${KEY} before: ${brief(before.kpis[idx])}`);
  console.log(`${KEY} after : ${brief(replacement)}`);
  console.log(`\nelements changed: ${changed} (expected exactly 1)`);
  console.log(`untouched columns: adoption_pct=${row.adoption_pct} accuracy_pct=${row.accuracy_pct} oee_pct=${row.oee_pct} `
    + `ole_pct=${row.ole_pct} uptime_pct=${row.uptime_pct} overall_score=${row.overall_score} overall_status=${row.overall_status} calculated_at=${row.calculated_at}`);

  if (changed !== 1) throw new Error(`ABORT: ${changed} elements would change, expected exactly 1`);
  if (args.dryRun) { console.log("\n[patch] DRY-RUN — nothing written."); return; }

  // UPDATE detail_json ONLY. No other column appears in the SET list.
  const res = await pool.query(`UPDATE ews.kpi_snapshot SET detail_json = $2::jsonb WHERE id = $1`, [row.id, JSON.stringify(after)]);
  console.log(`\n[patch] written (rows=${res.rowCount}).`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => { console.error("[patch] FAILED:", e.message); await pool.end().catch(() => {}); process.exit(1); });
