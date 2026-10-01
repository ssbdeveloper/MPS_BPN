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
  path.join(__dirname, "../../../database/migrations/rollback/20261001_ews_shift_date_override_guard_rollback.sql"),
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

test("HTTP direct request: missing/stale preview_token & unauthenticated mutation rejected (Blockers #2 & #3)", async () => {
  const { putShiftDateRange, deleteShiftOverride } = require("./ewsRosterController");
  const { createTrustedAuthToken } = require("../services/ewsAuthGuard");

  function createMockRes() {
    return {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
  }

  // 1. Request tanpa identitas sama sekali -> ditolak 401
  {
    const req = {
      body: {
        from: "2026-10-15",
        to: "2026-10-16",
        shifts: [{ shift_code: "DAY", start_time: "08:00:00", end_time: "16:00:00", crosses_midnight: false, standard_hours: 8 }],
      },
      headers: {},
    };
    const res = createMockRes();
    await putShiftDateRange(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body?.code, "AUTHENTICATION_REQUIRED");
  }

  // 2. Request delete override tanpa identitas sama sekali -> ditolak 401
  {
    const req = {
      params: { id: "42" },
      body: { reason: "Mau hapus jadwal hari ini" },
      headers: {},
    };
    const res = createMockRes();
    await deleteShiftOverride(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body?.code, "AUTHENTICATION_REQUIRED");
  }

  // 3. User fixture tidak terdaftar di database pengguna -> ditolak 403 ACTOR_UNVERIFIED
  {
    const req = {
      user: { id: "999999" },
      body: {
        from: "2026-10-15",
        to: "2026-10-16",
        shifts: [{ shift_code: "DAY", start_time: "08:00:00", end_time: "16:00:00", crosses_midnight: false, standard_hours: 8 }],
      },
      headers: { "x-user-id": "999999" },
    };
    const res = createMockRes();
    await putShiftDateRange(req, res);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body?.code, "ACTOR_UNVERIFIED");
  }

  // 4. Request perubahan hari ini terautentikasi tetapi TANPA preview_token -> ditolak 400 PREVIEW_REQUIRED (Blocker #3)
  {
    const db = global.pool || require("../db");
    const todayRes = await db.query("SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS today");
    const today = todayRes.rows[0].today;

    const req = {
      user: { id: "1" },
      body: {
        from: today,
        to: today,
        shifts: [{ shift_code: "DAY", start_time: "08:15:00", end_time: "16:15:00", crosses_midnight: false, standard_hours: 8 }],
        confirm_today_impact: true,
        reason: "Perubahan darurat untuk tes blocker",
        // preview_token sengaja dihilangkan!
      },
      headers: { "x-user-id": "1" },
    };
    const res = createMockRes();
    await putShiftDateRange(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body?.code, "PREVIEW_REQUIRED");
  }

  // 5. Request perubahan hari ini dengan preview_token STALE / palsu -> ditolak 409 PREVIEW_STALE (Blocker #3)
  {
    const db = global.pool || require("../db");
    const todayRes = await db.query("SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS today");
    const today = todayRes.rows[0].today;

    const req = {
      user: { id: "1" },
      body: {
        from: today,
        to: today,
        shifts: [{ shift_code: "DAY", start_time: "08:15:00", end_time: "16:15:00", crosses_midnight: false, standard_hours: 8 }],
        confirm_today_impact: true,
        reason: "Perubahan darurat untuk tes blocker",
        preview_token: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
      headers: { "x-user-id": "1" },
    };
    const res = createMockRes();
    await putShiftDateRange(req, res);
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body?.code, "PREVIEW_STALE");
  }
});


