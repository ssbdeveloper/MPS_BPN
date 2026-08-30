"use strict";
// Smoke test SQL records rekonsiliasi (MCH + TIMESHEET) langsung ke BPN (read-only).
process.chdir("D:/website/MPS2/apps/api");
const db = require("../db");
global.pool = db.pool;

const { loadMaxRecordConfig, buildRecordsSql } = require("../controllers/dashboardController");

(async () => {
  const cfg = await loadMaxRecordConfig();
  console.log("fallback:", JSON.stringify(cfg.fallback));
  console.log("mch entries:", Object.keys(cfg.mch).length, "| ts entries:", Object.keys(cfg.timesheet).length);

  const from = "2026-08-12";
  const to = "2026-08-18";
  const out = {};

  for (const source of ["mch", "timesheet", "all"]) {
    const sql = `SELECT source, count(*)::int AS n,
                   round(sum(recognized)/3600.0, 1) AS recog_hrs,
                   sum((capcut > 0)::int)::int AS with_capcut,
                   sum((breakcut > 0)::int)::int AS with_breakcut,
                   sum((source = 'MCH_HOURS' AND can_exclude)::int)::int AS excl_ok_mch
                 FROM (${buildRecordsSql(cfg, { source })}) x
                 WHERE sort_day BETWEEN $1::date AND $2::date
                 GROUP BY source ORDER BY source`;
    const { rows } = await pool.query(sql, [from, to]);
    console.log(`\n=== source=${source} ===`);
    for (const r of rows) console.log(`  ${r.source}: n=${r.n} recog=${r.recog_hrs}h capcut_rows=${r.with_capcut} break_rows=${r.with_breakcut} excl_ok=${r.excl_ok_mch}`);
    out[source] = rows;
  }

  // TIMESHEET: recognized (hitung ulang di SQL) vs total_seconds yang benar-benar di-stage.
  const { rows: tsCheck } = await pool.query(
    `SELECT count(*) FILTER (WHERE x.recognized <> st.total_seconds)::int AS mism,
            count(*)::int AS n
     FROM (${buildRecordsSql(cfg, { source: "timesheet" })}) x
     JOIN public.sap_timesheet_staging st ON st.id = x.staging_id
     WHERE x.sort_day BETWEEN $1::date AND $2::date`,
    [from, to]
  );
  console.log(`\nTIMESHEET recognized vs staged total_seconds: ${tsCheck[0].mism}/${tsCheck[0].n} mismatch`);

  await pool.end();
  process.exitCode = tsCheck[0].mism === 0 ? 0 : 1;
})().catch(async (err) => {
  console.error("FAIL:", err.message);
  try { await pool.end(); } catch {}
  process.exitCode = 1;
});
