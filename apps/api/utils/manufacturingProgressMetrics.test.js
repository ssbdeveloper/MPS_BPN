"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateMetrics,
  rollupMetrics,
  compareByConcern,
} = require("./manufacturingProgressMetrics");

test("calculates red operation metrics and EAC", () => {
  assert.deepEqual(calculateMetrics({ plan_hours: 100, actual_hours: 40, progress_pct: 30 }), {
    plan_hours: 100,
    actual_hours: 40,
    progress_pct: 30,
    target_progress_pct: 40,
    consume_hours_pct: 40,
    health_gap_pct_point: 10,
    health: "red",
    health_note: null,
    eac_hours: 133.33,
    eac_variance_hours: 33.33,
  });
});

test("uses exact health boundaries", () => {
  assert.equal(calculateMetrics({ plan_hours: 100, actual_hours: 52, progress_pct: 50 }).health, "yellow");
  assert.equal(calculateMetrics({ plan_hours: 100, actual_hours: 53, progress_pct: 50 }).health, "red");
  assert.equal(calculateMetrics({ plan_hours: 100, actual_hours: 50, progress_pct: 50 }).health, "green");
});

test("caps target but preserves overrun consume and gap", () => {
  const result = calculateMetrics({ plan_hours: 100, actual_hours: 120, progress_pct: 100 });
  assert.equal(result.consume_hours_pct, 120);
  assert.equal(result.target_progress_pct, 100);
  assert.equal(result.health_gap_pct_point, 20);
  assert.equal(result.eac_hours, 120);
});

test("marks actual work with zero or missing progress red without EAC", () => {
  for (const progress_pct of [0, null]) {
    const result = calculateMetrics({ plan_hours: 100, actual_hours: 1, progress_pct });
    assert.equal(result.health, "red");
    assert.equal(result.health_note, "Progress belum di-update");
    assert.equal(result.eac_hours, null);
  }
});

test("returns unknown plan-dependent metrics for a missing or zero plan", () => {
  for (const plan_hours of [0, null]) {
    const result = calculateMetrics({ plan_hours, actual_hours: 5, progress_pct: 20 });
    assert.equal(result.health, "unknown");
    for (const key of ["consume_hours_pct", "target_progress_pct", "health_gap_pct_point", "eac_hours", "eac_variance_hours"])
      assert.equal(result[key], null);
  }
});

test("rolls up plan-weighted progress and worst child health", () => {
  const result = rollupMetrics([
    calculateMetrics({ plan_hours: 20, actual_hours: 10, progress_pct: 100 }),
    calculateMetrics({ plan_hours: 80, actual_hours: 40, progress_pct: null }),
  ]);
  assert.equal(result.plan_hours, 100);
  assert.equal(result.actual_hours, 50);
  assert.equal(result.progress_pct, 20);
  assert.equal(result.health, "red");
  assert.equal(result.health_basis, "WORST_CHILD");
  assert.equal(result.missing_progress_count, 1);
});

test("rollup counts zero progress with actual hours as not updated", () => {
  const result = rollupMetrics([
    calculateMetrics({ plan_hours: 20, actual_hours: 2, progress_pct: 0 }),
    calculateMetrics({ plan_hours: 80, actual_hours: 0, progress_pct: 0 }),
  ]);
  assert.equal(result.missing_progress_count, 1);
});

test("sorts red first, then largest gap, then name", () => {
  const rows = [
    { health: "green", health_gap_pct_point: 0, name: "A" },
    { health: "red", health_gap_pct_point: 3, name: "B" },
    { health: "red", health_gap_pct_point: 9, name: "C" },
  ].sort(compareByConcern);
  assert.deepEqual(rows.map((row) => row.name), ["C", "B", "A"]);
});

test("TECO override can be represented as 100 percent progress", () => {
  assert.equal(calculateMetrics({ plan_hours: 100, actual_hours: 80, progress_pct: 100 }).progress_pct, 100);
});
