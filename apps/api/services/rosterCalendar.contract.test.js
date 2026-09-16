"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const generator = require("./rosterGenerator");

test("effective calendar gives an exact-date exception precedence over weekday rule", () => {
  assert.match(generator.EFFECTIVE_CALENDAR_SQL, /roster_calendar_exception/);
  assert.match(generator.EFFECTIVE_CALENDAR_SQL, /COALESCE\(ce\.runs_day, wr\.runs_day\)/);
  assert.match(generator.EFFECTIVE_CALENDAR_SQL, /ce\.business_date = d\.bd/);
});

test("generator consumes the shared effective calendar resolver", () => {
  assert.match(generator.GENERATE_SQL, /JOIN effective_calendar ec ON ec\.bd = od\.bd/);
  assert.match(generator.GENERATE_SQL, /ec\.runs_day/);
  assert.match(generator.GENERATE_SQL, /ec\.runs_night/);
});

test("migration creates one exception row per exact business date", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const sql = fs.readFileSync(path.join(__dirname, "../../../database/migrations/api/20260916c_ews_roster_calendar_exception.sql"), "utf8");
  assert.match(sql, /business_date date PRIMARY KEY/);
  assert.match(sql, /char_length\(reason\) <= 120/);
});
