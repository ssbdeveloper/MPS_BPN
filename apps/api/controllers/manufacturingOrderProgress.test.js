"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createManufacturingOrderProgressController } = require("./manufacturingOrderProgressController");

function response() {
  return {
    code: 200,
    headers: {},
    status(code) { this.code = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

const rows = [
  { project_id: "p1", project_name: "Alpha", task_id: "t1", task_name: "FAB", unit_key: "u1", unit_name: "Unit 01", mapping_count: 1, idsow: 1, order_no: "00100", operation_no: 120, operation_text: "Cut", workcenter: "WC1", part_number: "PART-1", plan_hours: 20, actual_hours: 10, progress_pct: 20, is_teco: false, is_visible: true, latest_issue: "old", latest_image_path: null },
  { project_id: "p1", project_name: "Alpha", task_id: "t2", task_name: "Paint", unit_key: "u1", unit_name: "Unit 01", mapping_count: 1, idsow: 2, order_no: "100", operation_no: 130, operation_text: "Paint", workcenter: "WC2", plan_hours: 80, actual_hours: 0, progress_pct: null, is_teco: false, is_visible: false, latest_issue: null, latest_image_path: null },
  { project_id: "p2", project_name: "Beta", task_id: "t3", task_name: "FAB SIDE WALL", unit_key: "u2", unit_name: "Unit 02", mapping_count: 2, idsow: 3, order_no: "1000122723", operation_no: 460, operation_text: "Weld", workcenter: "WC3", plan_hours: 10, actual_hours: 5, progress_pct: 10, is_teco: false, is_visible: true, latest_issue: "newest", latest_image_path: "/new.jpg" },
];

function makePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("/* manufacturing-operations */")) return { rows };
      if (sql.includes("/* manufacturing-subtasks */")) return { rows: [
        { id: 8, operation_id: 3, title: "Fit", sort_order: 1, standard_hours: 2, progress: 30, status: "IN_PROGRESS", latest_issue: "sub issue", latest_image_path: "/sub.jpg", latest_update_at: "2026-09-14T08:00:00Z" },
      ] };
      throw new Error("unexpected query");
    },
  };
}

test("builds project tree with overall KPI, visible date children, no-unit and one mapping conflict", async () => {
  const pool = makePool();
  const handler = createManufacturingOrderProgressController({ pool, cacheTtlMs: 60_000 });
  const res = response();
  await handler({ query: { date_from: "2026-09-01", date_to: "2026-09-30", limit: "20" } }, res);

  assert.equal(res.code, 200);
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.data[0].project_id, "p2", "red/largest gap project sorts first");
  const alpha = res.body.data.find((project) => project.project_id === "p1");
  assert.equal(alpha.plan_hours, 100, "overall KPI includes operation outside date window");
  assert.equal(alpha.progress_pct, 4, "overall KPI weights missing progress as zero");
  assert.equal(alpha.units.flatMap((unit) => unit.operations).length, 1, "date hides non-overlap child");
  assert.equal(alpha.units[0].plan_hours, 100, "visible Unit overall includes hidden operations belonging to that Unit");
  const conflict = res.body.data.find((project) => project.project_id === "p2").units[0];
  assert.equal(conflict.unit_key, "mapping-conflict");
  assert.equal(conflict.unit_name, "Mapping Conflict");
  assert.equal(conflict.operations.length, 1);
  assert.equal(conflict.operations[0].subtasks[0].actual_hours, undefined);
  assert.equal(conflict.operations[0].subtasks[0].latest_update_at, "2026-09-14T08:00:00Z");
  const partOperation = res.body.data.flatMap((project) => project.units).flatMap((unit) => unit.operations).find((operation) => operation.idsow === 1);
  assert.equal(partOperation.part_number, "PART-1");
  assert.equal(res.body.meta.actual_source, "LOCAL_TIMESHEET_TEMPORARY");
  assert.equal(res.body.meta.actual_is_posted, false);
  assert.match(res.body.meta.actual_note, /not yet posted to SAP/i);

  const sql = pool.calls[0].sql;
  assert.match(sql, /WITH RECURSIVE/i);
  assert.match(sql, /timesheet_transaction/i);
  assert.match(sql, /state_flag\s*<>\s*5/i);
  assert.match(sql, /duration\s*>\s*0/i);
  assert.match(sql, /ltrim\([^)]*order_no[^)]*,\s*'0'/i);
  assert.match(sql, /DISTINCT ON/i, "latest evidence is bulk loaded");
  assert.equal(pool.calls.length, 2, "operations and subtasks use bulk queries, not N+1");
});

test("status and search only filter visible children, never overall project KPI", () => {
  const { OPERATIONS_SQL } = require("./manufacturingOrderProgressController");
  assert.doesNotMatch(OPERATIONS_SQL, /WHERE m\.mapping_rank = 1[\s\S]*AND \(\$2 = 'all'/);
  assert.match(OPERATIONS_SQL, /AS is_visible/i);
  assert.match(OPERATIONS_SQL, /\$2 = 'active'/i);
  assert.match(OPERATIONS_SQL, /\$1 = ''/i);
});

test("places operations without a Unit ancestor in No Unit", async () => {
  const pool = makePool();
  pool.query = async (sql, params) => {
    pool.calls.push({ sql, params });
    if (sql.includes("/* manufacturing-operations */")) return { rows: rows.map((row) => row.task_id === "t2" ? { ...row, unit_key: null, unit_name: null, is_visible: true } : { ...row, is_visible: true }) };
    if (sql.includes("/* manufacturing-subtasks */")) return { rows: [] };
    throw new Error("unexpected query");
  };
  const handler = createManufacturingOrderProgressController({ pool, cacheTtlMs: 0 });
  const res = response();
  await handler({ query: {} }, res);
  const alpha = res.body.data.find((project) => project.project_id === "p1");
  assert.equal(alpha.units.some((unit) => unit.unit_key === "no-unit" && unit.unit_name === "No Unit"), true);
});

test("marks duplicate operation mapping as an administrative red conflict", async () => {
  const pool = makePool();
  pool.query = async (sql, params) => {
    pool.calls.push({ sql, params });
    if (sql.includes("/* manufacturing-operations */")) return { rows: [{ ...rows[2], actual_hours: 0, progress_pct: 100 }] };
    return { rows: [] };
  };
  const handler = createManufacturingOrderProgressController({ pool, cacheTtlMs: 0 });
  const res = response();
  await handler({ query: {} }, res);
  const operation = res.body.data[0].units[0].operations[0];
  assert.equal(operation.health, "red");
  assert.equal(operation.health_note, "Mapping Conflict");
});

test("defaults to active non-TECO, supports completed and forces TECO progress to 100", async () => {
  const pool = makePool();
  pool.query = async (sql, params) => {
    pool.calls.push({ sql, params });
    if (sql.includes("/* manufacturing-operations */")) return { rows: [{ ...rows[0], is_teco: true, progress_pct: 3 }] };
    return { rows: [] };
  };
  const handler = createManufacturingOrderProgressController({ pool, cacheTtlMs: 0 });
  const activeRes = response();
  await handler({ query: {} }, activeRes);
  assert.match(pool.calls[0].sql, /\$2 = 'active' AND NOT m\.is_teco/i);
  assert.equal(activeRes.body.data[0].progress_pct, 100);

  const completedRes = response();
  await handler({ query: { status: "completed" } }, completedRes);
  assert.equal(pool.calls[2].params.includes("completed"), true);
});

test("routes the manufacturing endpoint to its dedicated controller", () => {
  const routes = require("../routes/dashboard");
  const layer = routes.stack.find((entry) => entry.route?.path === "/manufacturing-order-progress");
  assert.ok(layer);
  assert.equal(layer.route.methods.get, true);
});

test("validates query boundaries before touching the database", async () => {
  const pool = makePool();
  const handler = createManufacturingOrderProgressController({ pool });
  const res = response();
  await handler({ query: { page: "0", date_from: "bad", health: "purple" } }, res);
  assert.equal(res.code, 400);
  assert.equal(pool.calls.length, 0);
});

test("caches normalized requests and refresh bypasses cache", async () => {
  const pool = makePool();
  const handler = createManufacturingOrderProgressController({ pool, cacheTtlMs: 60_000 });
  await handler({ query: {} }, response());
  const hit = response();
  await handler({ query: {} }, hit);
  assert.equal(hit.headers["X-Cache"], "HIT");
  assert.equal(pool.calls.length, 2);
  const refreshed = response();
  await handler({ query: { refresh: "1" } }, refreshed);
  assert.equal(refreshed.headers["X-Cache"], "MISS");
  assert.equal(pool.calls.length, 4);
});
