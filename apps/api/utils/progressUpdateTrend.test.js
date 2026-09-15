"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { buildUpdateTrend } = require("./progressUpdateTrend");

// Owner's worked example: 11 Sep 70h @ 40% -> EAC 175; 14 Sep 90h @ 40% -> EAC 225.
const ownerExample = {
  prev_update_at: "2026-09-11T02:00:00Z", prev_progress_pct: 40, prev_actual_hours: 70, prev_eac_hours: 175,
  last_update_at: "2026-09-14T02:00:00Z", last_progress_pct: 40, last_actual_hours: 90, last_eac_hours: 225,
};

describe("buildUpdateTrend", () => {
  it("flags hours growing while progress stands still, and the EAC jump it causes", () => {
    const trend = buildUpdateTrend(ownerExample);
    assert.equal(trend.actual_hours_delta, 20);
    assert.equal(trend.progress_delta_pct_point, 0);
    assert.equal(trend.eac_delta_hours, 50);
    assert.equal(trend.eac_delta_pct, 28.57);
    assert.equal(trend.progress_stalled, true);
    assert.equal(trend.eac_jumped, true);
    assert.deepEqual(trend.flags, ["PROGRESS_STALLED", "EAC_JUMP"]);
  });

  it("keeps quiet when progress moves with the hours", () => {
    const trend = buildUpdateTrend({ ...ownerExample, last_progress_pct: 60, last_eac_hours: 150 });
    assert.equal(trend.progress_stalled, false);
    assert.equal(trend.eac_jumped, false);
    assert.deepEqual(trend.flags, []);
  });

  it("uses a 10% threshold for the EAC jump", () => {
    const below = buildUpdateTrend({ ...ownerExample, last_progress_pct: 41, last_eac_hours: 192 });
    assert.equal(below.eac_delta_pct, 9.71);
    assert.equal(below.eac_jumped, false);

    const at = buildUpdateTrend({ ...ownerExample, last_progress_pct: 41, last_eac_hours: 192.5 });
    assert.equal(at.eac_delta_pct, 10);
    assert.equal(at.eac_jumped, true);
  });

  it("produces no trend when there is no previous update", () => {
    const trend = buildUpdateTrend({ last_update_at: "2026-09-14T02:00:00Z", last_progress_pct: 40, last_actual_hours: 90, last_eac_hours: 225 });
    assert.equal(trend.progress_stalled, false);
    assert.equal(trend.actual_hours_delta, null);
    assert.deepEqual(trend.flags, []);
  });

  it("produces no trend when the older row predates the hours snapshot", () => {
    const trend = buildUpdateTrend({ ...ownerExample, prev_actual_hours: null, prev_eac_hours: null });
    assert.equal(trend.progress_stalled, false);
    assert.equal(trend.eac_delta_pct, null);
    assert.deepEqual(trend.flags, []);
  });

  it("does not flag a stall when hours did not move", () => {
    const trend = buildUpdateTrend({ ...ownerExample, last_actual_hours: 70, last_eac_hours: 175 });
    assert.equal(trend.actual_hours_delta, 0);
    assert.equal(trend.progress_stalled, false);
  });
});
