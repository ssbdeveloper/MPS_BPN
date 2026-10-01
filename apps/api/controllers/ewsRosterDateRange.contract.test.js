"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiDir = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(apiDir, rel), "utf8");

const routes = read("routes/ews.js");
const manifest = read("rbac/manifest.js");
const controller = read("controllers/ewsRosterController.js");
const sowController = read("controllers/sowScheduleController.js");
const migration = fs.readFileSync(
  path.join(__dirname, "../../../database/migrations/api/20261001_ews_shift_date_override_guard.sql"),
  "utf8"
);
const rollback = fs.readFileSync(
  path.join(__dirname, "../../../database/migrations/api/20261001_ews_shift_date_override_guard_rollback.sql"),
  "utf8"
);

test("date-range shift routes are properly mounted in routes/ews.js", () => {
  assert.match(routes, /router\.post\("\/roster\/shift\/date-range\/preview", roster\.previewShiftDateRange\)/);
  assert.match(routes, /router\.put\("\/roster\/shift\/date-range", roster\.putShiftDateRange\)/);
  assert.match(routes, /router\.post\("\/roster\/shift\/override\/:id\/preview", roster\.previewDeleteShiftOverride\)/);
  assert.match(routes, /router\.delete\("\/roster\/shift\/override\/:id", roster\.deleteShiftOverride\)/);
  assert.match(routes, /router\.post\("\/roster\/shift\/date-range\/delete-preview", roster\.previewDeleteShiftDateRange\)/);
  assert.match(routes, /router\.delete\("\/roster\/shift\/date-range", roster\.deleteShiftDateRange\)/);
});

test("date-range routes are registered in RBAC manifest under roster_operator W", () => {
  assert.match(manifest, /m:\s*'POST',\s*p:\s*'\/ews\/roster\/shift\/date-range\/preview',\s*f:\s*'roster_operator',\s*a:\s*W/);
  assert.match(manifest, /m:\s*'PUT',\s*p:\s*'\/ews\/roster\/shift\/date-range',\s*f:\s*'roster_operator',\s*a:\s*W/);
  assert.match(manifest, /m:\s*'POST',\s*p:\s*'\/ews\/roster\/shift\/override\/:id\/preview',\s*f:\s*'roster_operator',\s*a:\s*W/);
  assert.match(manifest, /m:\s*'DELETE',\s*p:\s*'\/ews\/roster\/shift\/override\/:id',\s*f:\s*'roster_operator',\s*a:\s*W/);
  assert.match(manifest, /m:\s*'POST',\s*p:\s*'\/ews\/roster\/shift\/date-range\/delete-preview',\s*f:\s*'roster_operator',\s*a:\s*W/);
  assert.match(manifest, /m:\s*'DELETE',\s*p:\s*'\/ews\/roster\/shift\/date-range',\s*f:\s*'roster_operator',\s*a:\s*W/);
});

test("getConfig preserves existing semantics and exposes additive fields", () => {
  // Existing fields preserved
  assert.match(controller, /shifts:\s*shifts\.rows/);
  assert.match(controller, /shift_overrides:\s*overrides\.rows/);

  // New additive fields
  assert.match(controller, /default_shifts:\s*defaultShifts\.rows/);
  assert.match(controller, /today_shift_source:\s*todayShiftSource/);
  assert.match(controller, /upcoming_shift_overrides:\s*upcomingOverrides/);
  assert.match(controller, /plant_today:\s*plantToday/);
});

test("sowScheduleController sendError maps P0409 SQLSTATE to 409 HTTP code", () => {
  assert.match(sowController, /err\.code === "P0409" \? 409 : 500/);
  assert.match(sowController, /code: err\.code === "P0409" \? "SOW_SHIFT_NOT_RESOLVED" : undefined/);
});

test("integrity migration defines audit table and anti-race triggers", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ews\.shift_definition_audit/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.ews_sow_blocking_refs/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.sow_assert_resolved_shift/);
  assert.match(migration, /CREATE TRIGGER trg_sow_assert_resolved_shift/);
  assert.match(migration, /CREATE TRIGGER trg_shift_definition_assert_sow_guard/);
});

test("rollback migration cleans up triggers and functions cleanly", () => {
  assert.match(rollback, /DROP TRIGGER IF EXISTS trg_shift_definition_assert_sow_guard/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.shift_definition_assert_sow_guard/);
  assert.match(rollback, /DROP TRIGGER IF EXISTS trg_sow_assert_resolved_shift ON public\.sow_schedule/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.sow_assert_resolved_shift/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.ews_sow_blocking_refs/);
});
