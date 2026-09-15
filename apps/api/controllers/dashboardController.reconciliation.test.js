"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRecordsSql, buildRecordsPageSql } = require("./dashboardController");

const cfg = {};

for (const [name, build] of [
  ["export", buildRecordsSql],
  ["paginated", buildRecordsPageSql],
]) {
  test(`${name} reconciliation prefers source employee names`, () => {
    const sql = build(cfg);
    assert.match(sql, /COALESCE\(NULLIF\(BTRIM\(m\.full_name\), ''\), NULLIF\(BTRIM\(u\.full_name\), ''\), ''\) AS name/);
    assert.match(sql, /COALESCE\(NULLIF\(BTRIM\(t\.full_name\), ''\), NULLIF\(BTRIM\(u\.full_name\), ''\), ''\) AS name/);
  });

  test(`${name} reconciliation searches source employee names`, () => {
    const sql = build(cfg, { search: true });
    assert.match(sql, /m\.full_name ILIKE \$3/);
    assert.match(sql, /t\.full_name ILIKE \$3/);
  });

  test(`${name} reconciliation normalizes timesheet endpoints to whole seconds`, () => {
    const sql = build(cfg);
    assert.match(sql, /date_trunc\('second', t\.longdate_checkout\) - date_trunc\('second', t\.longdate_checkin\)/);
    assert.match(sql, /date_trunc\('second', t\.longdate_checkin AT TIME ZONE/);
  });
}
