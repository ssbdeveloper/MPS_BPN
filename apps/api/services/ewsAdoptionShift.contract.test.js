"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const api = fs.readFileSync(path.join(__dirname, "ewsCalculator.js"), "utf8");
const ui = fs.readFileSync(
  path.join(__dirname, "../../web/src/pages/EwsDetailPage.jsx"),
  "utf8",
);

test("adoption labour resolves times from the single shift master", () => {
  assert.match(api, /public\.resolve_shift_definition\(/);
  assert.match(api, /JOIN resolved_shift os ON os\.ews_shift = r\.eff_shift/);
  assert.doesNotMatch(
    api.slice(api.indexOf("async function calculateAdoptionLabourFromRoster"), api.indexOf("async function getMachineHoursByOperator")),
    /JOIN ews\.operator_shift os/,
  );
});

test("UI preserves a progressive target of zero hours", () => {
  assert.match(
    ui,
    /return o\.expected_hours == null \? numeric\(o\.standard_hours\) : numeric\(o\.expected_hours\)/,
  );
});
