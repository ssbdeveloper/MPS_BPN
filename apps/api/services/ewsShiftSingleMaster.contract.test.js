"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiDir = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(apiDir, rel), "utf8");

const calculator = read("services/ewsCalculator.js");
const generator = read("services/rosterGenerator.js");
const controller = read("controllers/ewsRosterController.js");
const routes = read("routes/ews.js");
const manifest = read("rbac/manifest.js");
const migration = fs.readFileSync(
  path.join(__dirname, "../../../database/migrations/api/20260916b_shift_definition_single_master.sql"),
  "utf8",
);

test("adoption calculator reads shift times from the single master", () => {
  assert.match(calculator, /public\.resolve_shift_definition\(/);
  assert.doesNotMatch(calculator, /JOIN ews\.operator_shift/);
});

test("roster generator takes standard hours from the single master", () => {
  assert.match(generator, /JOIN public\.resolve_shift_definition\(od\.bd\) sd ON sd\.roster_shift_code = od\.shift_code/);
  assert.doesNotMatch(generator, /JOIN ews\.operator_shift/);
});

test("roster endpoints no longer read the legacy operator_shift master", () => {
  // operator_shift_lock (temporary lock) tetap boleh; yang dilarang master lama ews.operator_shift.
  assert.doesNotMatch(controller, /JOIN ews\.operator_shift\s+os\b/);
  assert.doesNotMatch(controller, /FROM ews\.operator_shift\b/);
  assert.match(controller, /FROM public\.resolve_shift_definition\(/);
});

test("migration adds roster mapping, net hours and one date resolver", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS roster_shift_code text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS standard_hours numeric/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.resolve_shift_definition\(p_date date\)/);
  assert.match(migration, /WHEN sd\.is_default = false AND sd\.effective_date = p_date THEN 0/);
  assert.match(migration, /LEFT JOIN public\.resolve_shift_definition\(r\.business_date\) sd/);
  assert.match(migration, /sd\.roster_shift_code = eff\.code/);
});

test("standard hours can be edited from EWS roster config", () => {
  assert.match(routes, /router\.put\("\/roster\/shift", roster\.updateShiftMaster\)/);
  assert.match(routes, /router\.get\("\/roster\/shift\/impact", roster\.getShiftImpact\)/);
  assert.match(routes, /router\.put\("\/roster\/shift\/resync-future", roster\.resyncFutureShifts\)/);
  assert.match(manifest, /p: '\/ews\/roster\/shift',\s+f: 'roster_operator'/);
  assert.match(manifest, /p: '\/ews\/roster\/shift\/resync-future',\s+f: 'roster_operator'/);
  // Update hanya menyentuh baris default; override tanggal punya baris sendiri.
  assert.match(controller, /WHERE roster_shift_code = \$1 AND is_default = true/);
  // Resync forward-only dan hanya baris bersih.
  assert.match(controller, /r\.source = 'auto' AND r\.status = 'SCHEDULED'/);
  assert.match(controller, /r\.shift_override IS NULL AND r\.standard_hours_override IS NULL/);
});

test("config exposes shift span, net hours and dated overrides", () => {
  assert.match(controller, /span_minutes/);
  assert.match(controller, /standard_minutes/);
  assert.match(controller, /shift_overrides: overrides\.rows/);
});
