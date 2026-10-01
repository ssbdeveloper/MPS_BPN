"use strict";

/**
 * Cross-layer parity of the workcenter identity contract.
 *
 * The same inputs are normalized by:
 *   - SQL:    btrim(COALESCE($1, ''), <WORKCENTER_STRIP_SQL from the API controller>)
 *   - SQL:    the expression of the LIVE unique index idx_timesheet_active_productive_op_wc
 *   - JS:     normalizeWorkcenterCode (API controller)
 *   - Python: normalize_workcenter_code (ETL run_timesheet_etl.py)
 * and every result must be identical, code point for code point.
 *
 * Read-only against the lab DB (SELECT only). Usage:
 *   node database/tests/timesheet/test_workcenter_normalization_parity.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");

const REPO_ROOT = path.resolve(__dirname, "../../..");
process.env.DB_HOST = "localhost";
process.env.DB_NAME = process.env.PARITY_DB_NAME || "mps_timesheet_ckp_test";
assert.ok(["mps_timesheet_ckp_test", "mps_timesheet_bpn_test", "mps2_test_migrate_manifest"].includes(process.env.DB_NAME));

const {
  normalizeWorkcenterCode,
  WORKCENTER_STRIP_SQL,
} = require(path.join(REPO_ROOT, "apps/api/controllers/timesheet_transactionController.js"));

const CASES = [
  null,
  "",
  "   ",
  "MILL-01",
  "mill-01",
  "  MILL-01  ",
  "\tMILL-01\n",
  "\r\nMILL-01\r\n",
  "\u000bMILL-01\u000b",
  "\u000cMILL-01\u000c",
  "\u00a0MILL-01\u00a0",
  "\ufeffMILL-01\ufeff",
  " \t\r\n\u000b\u000c\u00a0\ufeff MILL 01 \ufeff\u00a0\u000c\u000b\n\r\t ",
  "MILL 01",
  "MILL\u00a001",
  "vMILLv",
  "fMILL-01f",
  "\u2003MILL-01\u2003", // EM SPACE: deliberately NOT in the contract
  "\u200bMILL-01", // ZERO WIDTH SPACE: deliberately NOT in the contract
  "\u0085MILL-01", // NEL: deliberately NOT in the contract
  " \u000b\u000c\u00a0\ufeff ",
];

const codepoints = (s) => (s === null ? null : [...s].map((c) => c.codePointAt(0)));

function pythonResults() {
  const script = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(path.join(REPO_ROOT, "jobs/sap_staging"))})`,
    "from run_timesheet_etl import normalize_workcenter_code, WORKCENTER_STRIP_CHARS",
    "cases = json.loads(sys.stdin.read())",
    "print(json.dumps({'chars': [ord(c) for c in WORKCENTER_STRIP_CHARS],",
    "  'out': [normalize_workcenter_code(c) for c in cases]}))",
  ].join("\n");
  const out = execFileSync("python", ["-c", script], {
    input: JSON.stringify(CASES),
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  return JSON.parse(out);
}

test("SQL literal, live unique index, JS and Python normalize workcenter identically", async () => {
  const py = pythonResults();
  const expectedSet = [0x20, 0x09, 0x0d, 0x0a, 0x0b, 0x0c, 0xa0, 0xfeff];
  assert.deepEqual([...py.chars].sort((a, b) => a - b), [...expectedSet].sort((a, b) => a - b));

  const client = new Client({ host: "localhost", port: 5432, user: "postgres", database: process.env.DB_NAME });
  await client.connect();
  try {
    const set = await client.query(
      `SELECT array(SELECT ascii(substr(s, i, 1)) FROM generate_series(1, length(s)) i) AS cps
       FROM (SELECT ${WORKCENTER_STRIP_SQL}::text AS s) x`
    );
    assert.deepEqual(set.rows[0].cps, expectedSet, "SQL strip literal must hold exactly the contract set");

    // Expression of the live index, column 5, re-evaluated against each input.
    const idx = await client.query(
      `SELECT pg_get_indexdef(c.oid, 5, true) AS expr, i.indisunique, i.indisvalid, i.indisready
       FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'idx_timesheet_active_productive_op_wc'`
    );
    assert.equal(idx.rows.length, 1, "live index must exist");
    assert.equal(idx.rows[0].indisunique && idx.rows[0].indisvalid && idx.rows[0].indisready, true);
    const indexExpr = idx.rows[0].expr.replace(/\bworkcentercode\b/, "$1::text");

    for (let k = 0; k < CASES.length; k += 1) {
      const input = CASES[k];
      const r = await client.query(
        `SELECT btrim(COALESCE($1::text, ''), ${WORKCENTER_STRIP_SQL}) AS lit, ${indexExpr} AS idx`,
        [input]
      );
      const js = normalizeWorkcenterCode(input);
      const label = `case ${k} ${JSON.stringify(codepoints(input))}`;
      assert.deepEqual(codepoints(r.rows[0].lit), codepoints(js), `${label}: SQL literal vs JS`);
      assert.deepEqual(codepoints(r.rows[0].idx), codepoints(js), `${label}: live index vs JS`);
      assert.deepEqual(codepoints(py.out[k]), codepoints(js), `${label}: Python vs JS`);
    }
  } finally {
    await client.end();
  }

  // Spot-check the semantics, not only the agreement.
  assert.equal(normalizeWorkcenterCode(null), "");
  assert.equal(normalizeWorkcenterCode("vMILLv"), "vMILLv");
  assert.equal(normalizeWorkcenterCode("mill-01"), "mill-01");
  assert.equal(normalizeWorkcenterCode(" \u000b\u00a0MILL 01\ufeff\u000c "), "MILL 01");
  assert.equal(normalizeWorkcenterCode("\u2003MILL-01"), "\u2003MILL-01");
});
