"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("./rosterGenerator");

test("schedule plan protects historical and manually evidenced rows", () => {
  assert.match(service.ROSTER_PLAN_SQL, /e\.serialnumber IS NULL AND d\.business_date >= t\.today THEN 'add'/);
  assert.match(service.ROSTER_PLAN_SQL, /business_date >= t\.today/);
  assert.match(service.ROSTER_PLAN_SQL, /source = 'auto'/);
  assert.match(service.ROSTER_PLAN_SQL, /status = 'SCHEDULED'/);
  assert.match(service.ROSTER_PLAN_SQL, /half_day, false/);
  assert.match(service.ROSTER_PLAN_SQL, /shift_override IS NULL/);
  assert.match(service.ROSTER_PLAN_SQL, /standard_hours_override IS NULL/);
});

test("preview exposes exact add update remove and protected counts", () => {
  assert.match(service.PREVIEW_SQL, /rows_added/);
  assert.match(service.PREVIEW_SQL, /rows_updated/);
  assert.match(service.PREVIEW_SQL, /rows_removed/);
  assert.match(service.PREVIEW_SQL, /rows_protected/);
});

test("apply recalculates server-side and mutates in one statement", () => {
  assert.match(service.APPLY_SQL, /deleted AS/);
  assert.match(service.APPLY_SQL, /updated AS/);
  assert.match(service.APPLY_SQL, /inserted AS/);
  assert.match(service.APPLY_SQL, /ON CONFLICT \(serialnumber, business_date\) DO NOTHING/);
});
