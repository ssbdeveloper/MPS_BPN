"use strict";

/**
 * Scenario tests for 20261001c_timesheet_wc_index_exact_contract.sql.
 * Every scenario runs inside BEGIN ... ROLLBACK on a LOCAL lab DB, so nothing persists.
 *
 *   node database/tests/timesheet/test_migration_exact_contract_scenarios.js
 *   HARDEN_DB_NAME=mps_timesheet_bpn_test node database/tests/timesheet/test_migration_exact_contract_scenarios.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const DB_NAME = process.env.HARDEN_DB_NAME || "mps_timesheet_ckp_test";
assert.ok(
  ["mps_timesheet_ckp_test", "mps_timesheet_bpn_test", "mps2_test_migrate_manifest"].includes(DB_NAME),
  `refusing non-lab database ${DB_NAME}`
);

const MIG = path.join(__dirname, "../../migrations/api");
const SQL_A = fs.readFileSync(path.join(MIG, "20261001_timesheet_unique_active_productive_op_wc.sql"), "utf8");
const SQL_B = fs.readFileSync(path.join(MIG, "20261001b_timesheet_harden_unique_index.sql"), "utf8");
const SQL_C = fs.readFileSync(path.join(MIG, "20261001c_timesheet_wc_index_exact_contract.sql"), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(__dirname, "../../migrations/rollback/20261001_timesheet_unique_active_productive_op_wc_rollback.sql"),
  "utf8"
);

const NEW = "idx_timesheet_active_productive_op_wc";
const LEGACY = "idx_timesheet_active_productive_op";
const PRED = `WHERE longdate_checkout IS NULL AND COALESCE(state_flag, 0) <> 5
  AND (activitytype IS NULL OR trim(activitytype) = '')
  AND order_no IS NOT NULL AND trim(order_no) <> '' AND operation_no IS NOT NULL`;
const LEGACY_DDL = `CREATE UNIQUE INDEX ${LEGACY} ON public.timesheet_transaction
  (plant, serialnumber, ltrim(trim(order_no), '0'), operation_no) ${PRED}`;
const wcDdl = (strip, name = NEW) => `CREATE UNIQUE INDEX ${name} ON public.timesheet_transaction
  (plant, serialnumber, ltrim(trim(order_no), '0'), operation_no, btrim(COALESCE(workcentercode, ''), ${strip})) ${PRED}`;
const EXACT = String.raw`E' \t\r\n\x0B\f\u00A0\uFEFF'`;

let client;
let plantCode = "5100";

async function state() {
  const r = await client.query(
    `SELECT c.relname, i.indisvalid, i.indisready, i.indisunique,
            pg_get_indexdef(c.oid, 5, true) AS wc_expr
     FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname LIKE 'idx_timesheet_active_productive_op%'
     ORDER BY 1`
  );
  return Object.fromEntries(r.rows.map((x) => [x.relname, x]));
}

// Strip characters of the live new index, as code points, evaluated by Postgres itself.
async function liveStripSet() {
  const r = await client.query(
    `SELECT pg_get_indexdef(to_regclass('public.${NEW}'), 5, true) AS e`
  );
  const lit = r.rows[0].e.match(/, ('(?:[^']|'')*'::text)\)$/)[1];
  const cps = await client.query(
    `SELECT array(SELECT ascii(substr(s, i, 1)) FROM generate_series(1, length(s)) i) AS cps FROM (SELECT ${lit} AS s) x`
  );
  return cps.rows[0].cps;
}

const EXACT_SET = [32, 9, 13, 10, 11, 12, 160, 65279];

async function inTx(fn) {
  await client.query("BEGIN");
  try {
    await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

async function resetToLegacyOnly() {
  await client.query(`DROP INDEX IF EXISTS public.${NEW}`);
  await client.query(`DROP INDEX IF EXISTS public.${LEGACY}`);
  await client.query(LEGACY_DDL);
}

async function expectAbort(sql, re) {
  await client.query("SAVEPOINT s");
  await assert.rejects(() => client.query(sql), re);
  await client.query("ROLLBACK TO SAVEPOINT s");
}

test.before(async () => {
  client = new Client({ host: "localhost", port: 5432, user: "postgres", database: DB_NAME });
  await client.connect();
  const r = await client.query("SELECT current_database() AS d, inet_server_addr()::text AS a");
  assert.equal(r.rows[0].d, DB_NAME);
  const p = await client.query("SELECT plant_code FROM public.plant_config WHERE id = 1");
  if (p.rows[0]?.plant_code) plantCode = p.rows[0].plant_code;
});

test.after(async () => {
  await client.end();
});

test("fresh: legacy only -> 20261001c creates exact-contract index, then drops legacy", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(SQL_C);
    const s = await state();
    assert.deepEqual(Object.keys(s), [NEW]);
    assert.equal(s[NEW].indisunique && s[NEW].indisvalid && s[NEW].indisready, true);
    assert.deepEqual(await liveStripSet(), EXACT_SET);
  });
});

test("full chain 20261001 -> 20261001b -> 20261001c from legacy-only yields the exact contract", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(SQL_A);
    await client.query(SQL_B);
    // Defect being corrected: after 20261001b the index strips the letter 'v', not U+000B.
    assert.ok((await liveStripSet()).includes("v".codePointAt(0)));
    assert.ok(!(await liveStripSet()).includes(11));
    await client.query(SQL_C);
    assert.deepEqual(await liveStripSet(), EXACT_SET);
    assert.deepEqual(Object.keys(await state()), [NEW]);
  });
});

test("definition written by 20261001 (letter v, no NBSP/BOM) is rebuilt to the exact contract", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(wcDdl(String.raw`E' \t\r\n\v\f'`));
    await client.query(SQL_C);
    assert.deepEqual(await liveStripSet(), EXACT_SET);
    assert.deepEqual(Object.keys(await state()), [NEW]);
  });
});

test("idempotent: exact index kept as-is (same OID), second run is a no-op", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(SQL_C);
    const before = await client.query(`SELECT to_regclass('public.${NEW}')::oid AS o`);
    await client.query(SQL_C);
    const after = await client.query(`SELECT to_regclass('public.${NEW}')::oid AS o`);
    assert.equal(after.rows[0].o, before.rows[0].o);
  });
});

test("enforcement: exact index treats U+000B/NBSP/BOM edges as the same WC but 'vWC' as different", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(SQL_C);
    const ins = (ts, wc) =>
      client.query(
        `INSERT INTO public.timesheet_transaction
           (tsnumber, plant, serialnumber, order_no, operation_no, workcentercode, date_checkin, hour_checkin, state_flag)
         VALUES ($1, $2, 'PARITY-OP', '000077001', '0010', $3, '2026-10-01', '08:00', 0)`,
        [ts, plantCode, wc]
      );
    await ins(9988001, "MILL");
    await client.query("SAVEPOINT s");
    await assert.rejects(() => ins(9988002, "\u000bMILL\u00a0\ufeff"), (e) => e.code === "23505" && e.constraint === NEW);
    await client.query("ROLLBACK TO SAVEPOINT s");
    await ins(9988003, "vMILLv"); // a real, different workcenter code: must be accepted
  });
});

test("fails closed: unknown definition under target name keeps legacy index", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(wcDdl("' '")); // strips only space: not a known definition
    await expectAbort(SQL_C, /definisi tidak dikenal/);
    const s = await state();
    assert.ok(s[LEGACY] && s[NEW]);
  });
});

test("fails closed: non-unique index with expected expressions keeps legacy index", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(wcDdl(EXACT).replace("CREATE UNIQUE INDEX", "CREATE INDEX"));
    await expectAbort(SQL_C, /definisi tidak dikenal/);
    assert.ok((await state())[LEGACY]);
  });
});

test("fails closed: different predicate keeps legacy index", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(wcDdl(EXACT).replace("COALESCE(state_flag, 0) <> 5", "COALESCE(state_flag, 0) <> 9"));
    await expectAbort(SQL_C, /definisi tidak dikenal/);
    assert.ok((await state())[LEGACY]);
  });
});

test("fails closed: target name is an index on another table", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(`CREATE UNIQUE INDEX ${NEW} ON public.plant_config (id)`);
    await expectAbort(SQL_C, /bukan index pada public.timesheet_transaction/);
    assert.ok((await state())[LEGACY]);
  });
});

test("fails closed: invalid index (indisvalid=false) keeps legacy index", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(wcDdl(EXACT));
    // Simulates a failed CREATE INDEX CONCURRENTLY leftover; only inside this rolled-back tx.
    await client.query(`UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass('public.${NEW}')`);
    await expectAbort(SQL_C, /INVALID\/NOT READY/);
    assert.ok((await state())[LEGACY]);
  });
});

test("fails closed: active duplicate on the WC grain aborts before any DDL", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(`DROP INDEX public.${LEGACY}`);
    await client.query(
      `INSERT INTO public.timesheet_transaction
         (tsnumber, plant, serialnumber, order_no, operation_no, workcentercode, date_checkin, hour_checkin, state_flag)
       VALUES (9988011, $1, 'DUP-OP', '000077002', '0010', 'MILL', '2026-10-01', '08:00', 0),
              (9988012, $1, 'DUP-OP', '77002', '0010', E'\\x0BMILL\\u00A0', '2026-10-01', '08:30', 0)`,
      [plantCode]
    );
    await expectAbort(SQL_C, /duplikat aktif produktif/);
    assert.equal((await state())[NEW], undefined);
  });
});

test("rollback script restores legacy index and removes 20261001/b/c ledger rows", async () => {
  await inTx(async () => {
    await resetToLegacyOnly();
    await client.query(SQL_C);
    await client.query(
      `INSERT INTO public.schema_migrations(filename) VALUES
         ('20261001_timesheet_unique_active_productive_op_wc.sql'),
         ('20261001b_timesheet_harden_unique_index.sql'),
         ('20261001c_timesheet_wc_index_exact_contract.sql')
       ON CONFLICT DO NOTHING`
    );
    await client.query(ROLLBACK);
    assert.deepEqual(Object.keys(await state()), [LEGACY]);
    const led = await client.query(
      `SELECT count(*)::int n FROM public.schema_migrations WHERE filename LIKE '20261001%timesheet%'`
    );
    assert.equal(led.rows[0].n, 0);
  });
});
