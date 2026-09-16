"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const controller = require("./ewsRosterController");

test("week context maps the 2026-09-14 week to day B and night A", () => {
  assert.deepEqual(
    controller.resolveWeekContext("2026-09-14", {
      anchor_week_start: "2026-06-28",
      anchor_group_a_shift: "DAY",
      rotation_period_weeks: 1,
      week_start_dow: 0,
    }),
    { week_start: "2026-09-13", day_group: "B", night_group: "A" },
  );
});

test("week context flips groups the following week", () => {
  assert.deepEqual(
    controller.resolveWeekContext("2026-09-21", {
      anchor_week_start: "2026-06-28",
      anchor_group_a_shift: "DAY",
      rotation_period_weeks: 1,
      week_start_dow: 0,
    }),
    { week_start: "2026-09-20", day_group: "A", night_group: "B" },
  );
});

test("exception range expands inclusively and enforces 62 day ceiling", () => {
  assert.deepEqual(controller.expandDateRange("2026-12-25", "2026-12-27"), ["2026-12-25", "2026-12-26", "2026-12-27"]);
  assert.throws(() => controller.expandDateRange("2026-01-01", "2026-03-04"), /62 days/);
});

test("exception state resolves to day/night booleans", () => {
  assert.deepEqual(controller.exceptionState("BOTH"), [true, true]);
  assert.deepEqual(controller.exceptionState("DAY"), [true, false]);
  assert.deepEqual(controller.exceptionState("NIGHT"), [false, true]);
  assert.deepEqual(controller.exceptionState("OFF"), [false, false]);
});

test("weekly pattern accepts booleans only", () => {
  assert.equal(controller.strictBoolean(true, "runs_day"), true);
  assert.equal(controller.strictBoolean(false, "runs_night"), false);
  assert.throws(() => controller.strictBoolean("false", "runs_day"), /must be a boolean/);
  assert.throws(() => controller.strictBoolean(0, "runs_night"), /must be a boolean/);
});
