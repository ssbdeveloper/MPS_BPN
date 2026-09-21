"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const controller = fs.readFileSync(path.join(__dirname, "ewsRosterController.js"), "utf8");
const generator = fs.readFileSync(path.join(__dirname, "../services/rosterGenerator.js"), "utf8");

test("monthly heatmap aggregates timesheet per operator and business date", () => {
  assert.match(controller, /GROUP BY 1, 2/);
  // The month query now draws its cells from a union of roster rows and activity-only
  // overtime days, so the logged join hangs off the key set (k) rather than the roster (r).
  // What matters is that hours are still matched per operator AND business date.
  assert.match(controller, /lg\.op = k\.serialnumber AND lg\.business_date = k\.business_date/);
});

test("overtime is classified from the confirmation number, never inferred", () => {
  // Overtime must come from confirmationnumber alone. Inferring it from hours above target,
  // an OFF roster, or a workcenter suffix would silently invent overtime.
  assert.match(controller, /confirmationnumber/);
  assert.match(controller, /LIKE '%OV%'/);
  assert.ok((controller.match(/AS overtime_hours/g) || []).length >= 2,
    "daily and monthly roster payloads must both expose overtime_hours");
  assert.ok((controller.match(/AS overtime_pending_count/g) || []).length >= 2,
    "daily and monthly roster payloads must both expose overtime_pending_count");
});

test("a day with no roster row is reported as such, not as OFF", () => {
  // Saturday/Sunday have no roster row at all; the payload flags them so the UI can show
  // the overtime without inventing a schedule or an OFF status.
  assert.match(controller, /has_roster/);
  assert.match(controller, /r\.serialnumber IS NULL THEN NULL/);
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
