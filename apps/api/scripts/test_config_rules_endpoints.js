"use strict";
// Smoke test endpoint GET /config/rules + /config/activity-catalog (via controller langsung,
// tanpa HTTP server — read-only).
process.chdir("D:/website/MPS2/apps/api");
const db = require("../db");
global.pool = db.pool;

const rulesCtrl = require("../controllers/configRulesController");
const { getConfigRules, getActivityCatalog } = rulesCtrl;

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
const call = async (fn) => {
  const res = mockRes();
  await fn({ headers: {}, query: {} }, res);
  return res;
};

(async () => {
  const rules = await call(getConfigRules);
  const d = rules.body?.data || {};
  console.log("GET /config/rules ->", rules.statusCode);
  console.log("  max_record_minutes keys:", Object.keys(d.max_record_minutes || {}).join(","));
  console.log("  mch entries:", Object.keys(d.max_record_minutes?.mch || {}).length);
  console.log("  timesheet entries:", Object.keys(d.max_record_minutes?.timesheet || {}).length);
  console.log("  va:", d.max_record_minutes?.mch?.["1"], "| ts productive:", d.max_record_minutes?.timesheet?.[""]);

  const cat = await call(getActivityCatalog);
  const c = cat.body?.data || {};
  console.log("GET /config/activity-catalog ->", cat.statusCode);
  console.log("  mch staged:", (c.mch || []).filter((x) => x.staged).length, "/", (c.mch || []).length);
  console.log("  timesheet rows:", (c.timesheet || []).length);
  console.log("  contoh:", JSON.stringify((c.mch || [])[0]));

  await db.pool.end();
  process.exitCode = 0;
})().catch(async (err) => {
  console.error("FAIL:", err.message);
  try { await db.pool.end(); } catch {}
  process.exitCode = 1;
});
