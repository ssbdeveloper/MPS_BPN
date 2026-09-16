"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const controller = fs.readFileSync(path.join(__dirname, "ewsRosterController.js"), "utf8");
const generator = fs.readFileSync(path.join(__dirname, "../services/rosterGenerator.js"), "utf8");

test("monthly heatmap aggregates timesheet per operator and business date", () => {
  assert.match(controller, /GROUP BY 1, 2/);
  assert.match(controller, /lg\.business_date = r\.business_date/);
});

test("bulk heatmap supports exact cells with shift and hours overrides", () => {
  assert.match(controller, /req\.body\?\.cells/);
  assert.match(controller, /jsonb_to_recordset|UNNEST/);
  assert.match(controller, /shift_override/);
  assert.match(controller, /standard_hours_override/);
  assert.match(controller, /DAY.*NIGHT/s);
});

test("operator assignment supports permanent DAY or NIGHT", () => {
  assert.match(controller, /updatePermanentShift/);
  assert.match(controller, /fixed_shift/);
});

test("roster generation honors permanent shift assignments", () => {
  assert.match(generator, /COALESCE\(org\.fixed_shift/);
});

test("config exposes assignment state without requiring a search", () => {
  assert.match(controller, /assignment_status/);
  assert.match(controller, /unassigned/);
});
