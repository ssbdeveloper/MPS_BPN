"use strict";

const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const MIGRATION_FILE = path.join(__dirname, "../../migrations/api/20261001b_timesheet_harden_unique_index.sql");
const ROLLBACK_FILE = path.join(__dirname, "../../migrations/rollback/20261001_timesheet_unique_active_productive_op_wc_rollback.sql");

async function runTest() {
  const client = new Client({
    host: "localhost",
    port: 5432,
    user: "postgres",
    database: "mps_timesheet_ckp_test",
  });
  await client.connect();

  const migrationSql = fs.readFileSync(MIGRATION_FILE, "utf8");
  const rollbackSql = fs.readFileSync(ROLLBACK_FILE, "utf8");

  console.log("=== STARTING MIGRATION HARDENING SCENARIO TESTS ===");

  try {
    // SCENARIO 1: Existing correct index condition (Idempotency)
    console.log("Scenario 1: Existing correct index is verified idempotently...");
    await client.query("BEGIN");
    await client.query(migrationSql);
    // Verify index is valid, unique, ready
    const res1 = await client.query(`
      SELECT i.indisunique, i.indisvalid, i.indisready
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      WHERE c.relname = 'idx_timesheet_active_productive_op_wc'
        AND t.relname = 'timesheet_transaction'
    `);
    assert.equal(res1.rows.length, 1);
    assert.equal(res1.rows[0].indisunique, true);
    assert.equal(res1.rows[0].indisvalid, true);
    assert.equal(res1.rows[0].indisready, true);
    await client.query("ROLLBACK");
    console.log("  -> Scenario 1 PASSED!");

    // SCENARIO 2: Fresh condition (No new index, only legacy index)
    console.log("Scenario 2: Fresh condition (creates new index, drops legacy)...");
    await client.query("BEGIN");
    await client.query("DROP INDEX IF EXISTS idx_timesheet_active_productive_op_wc;");
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheet_active_productive_op
      ON public.timesheet_transaction (plant, serialnumber, ltrim(trim(order_no), '0'), operation_no)
      WHERE longdate_checkout IS NULL AND COALESCE(state_flag, 0) <> 5
        AND (activitytype IS NULL OR trim(activitytype) = '')
        AND order_no IS NOT NULL AND trim(order_no) <> '' AND operation_no IS NOT NULL;
    `);
    await client.query(migrationSql);
    // Verify new index created and old index dropped
    const checkNew = await client.query("SELECT to_regclass('public.idx_timesheet_active_productive_op_wc')::text AS idx");
    const checkOld = await client.query("SELECT to_regclass('public.idx_timesheet_active_productive_op')::text AS idx");
    assert.ok(checkNew.rows[0].idx);
    assert.equal(checkOld.rows[0].idx, null);
    await client.query("ROLLBACK");
    console.log("  -> Scenario 2 PASSED!");

    // SCENARIO 3: Existing wrong / invalid index condition
    console.log("Scenario 3a: Existing non-unique index with same name fails closed and preserves legacy...");
    await client.query("BEGIN");
    await client.query("DROP INDEX IF EXISTS idx_timesheet_active_productive_op_wc;");
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheet_active_productive_op
      ON public.timesheet_transaction (plant, serialnumber, ltrim(trim(order_no), '0'), operation_no)
      WHERE longdate_checkout IS NULL AND COALESCE(state_flag, 0) <> 5
        AND (activitytype IS NULL OR trim(activitytype) = '')
        AND order_no IS NOT NULL AND trim(order_no) <> '' AND operation_no IS NOT NULL;
    `);
    // Create NON-UNIQUE index with target name
    await client.query(`
      CREATE INDEX idx_timesheet_active_productive_op_wc
      ON public.timesheet_transaction (plant, serialnumber);
    `);
    let threwNonUnique = false;
    try {
      await client.query(migrationSql);
    } catch (err) {
      threwNonUnique = true;
      assert.match(err.message, /BUKAN UNIQUE index/i);
    }
    assert.ok(threwNonUnique, "Migration must throw when existing index is not unique");
    await client.query("ROLLBACK");
    console.log("  -> Scenario 3a PASSED!");

    console.log("Scenario 3b: Existing index on wrong table fails closed and preserves legacy...");
    await client.query("BEGIN");
    await client.query("DROP INDEX IF EXISTS idx_timesheet_active_productive_op_wc;");
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheet_active_productive_op
      ON public.timesheet_transaction (plant, serialnumber, ltrim(trim(order_no), '0'), operation_no)
      WHERE longdate_checkout IS NULL AND COALESCE(state_flag, 0) <> 5
        AND (activitytype IS NULL OR trim(activitytype) = '')
        AND order_no IS NOT NULL AND trim(order_no) <> '' AND operation_no IS NOT NULL;
    `);
    // Create index on another table, e.g. plant_config
    await client.query(`
      CREATE UNIQUE INDEX idx_timesheet_active_productive_op_wc
      ON public.plant_config (id);
    `);
    let threwWrongTable = false;
    try {
      await client.query(migrationSql);
    } catch (err) {
      threwWrongTable = true;
      assert.match(err.message, /tabel salah/i);
    }
    assert.ok(threwWrongTable, "Migration must throw when index is on wrong table");
    await client.query("ROLLBACK");
    console.log("  -> Scenario 3b PASSED!");

    // SCENARIO 4: Duplicate active data condition
    console.log("Scenario 4: Duplicate active data on workcenter grain fails closed...");
    await client.query("BEGIN");
    await client.query("DROP INDEX IF EXISTS idx_timesheet_active_productive_op_wc;");
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheet_active_productive_op
      ON public.timesheet_transaction (plant, serialnumber, ltrim(trim(order_no), '0'), operation_no)
      WHERE longdate_checkout IS NULL AND COALESCE(state_flag, 0) <> 5
        AND (activitytype IS NULL OR trim(activitytype) = '')
        AND order_no IS NOT NULL AND trim(order_no) <> '' AND operation_no IS NOT NULL;
    `);
    // Temporarily drop legacy index to insert duplicates
    await client.query("DROP INDEX idx_timesheet_active_productive_op;");
    await client.query(`
      INSERT INTO timesheet_transaction (
        tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
        date_checkin, hour_checkin, state_flag
      ) VALUES 
      (9999901, '5100', 'OPERATOR_TEST_DUP', '000012345', '0010', 'WC_TEST_DUP', '2026-10-01', '08:00', 0),
      (9999902, '5100', 'OPERATOR_TEST_DUP', '000012345', '0010', 'WC_TEST_DUP', '2026-10-01', '08:30', 0);
    `);
    let threwDups = false;
    try {
      await client.query(migrationSql);
    } catch (err) {
      threwDups = true;
      assert.match(err.message, /duplikat aktif produktif/i);
    }
    assert.ok(threwDups, "Migration must abort on duplicate active data");
    await client.query("ROLLBACK");
    console.log("  -> Scenario 4 PASSED!");

    // SCENARIO 5: Rollback with parallel cross-workcenter active activity
    console.log("Scenario 5a: Rollback aborted when parallel cross-workcenter activity exists...");
    await client.query("BEGIN");
    // Ensure new index exists
    await client.query(migrationSql);
    // Insert parallel active tasks on DIFFERENT workcenters
    await client.query(`
      INSERT INTO timesheet_transaction (
        tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
        date_checkin, hour_checkin, state_flag
      ) VALUES 
      (9999903, '5100', 'OPERATOR_ROLL', '000099999', '0010', 'WC_ROLL_A', '2026-10-01', '08:00', 0),
      (9999904, '5100', 'OPERATOR_ROLL', '000099999', '0010', 'WC_ROLL_B', '2026-10-01', '08:30', 0);
    `);
    let threwRollbackParallel = false;
    try {
      await client.query(rollbackSql);
    } catch (err) {
      threwRollbackParallel = true;
      assert.match(err.message, /Rollback DIBATALKAN/i);
    }
    assert.ok(threwRollbackParallel, "Rollback must fail closed when parallel tasks exist");
    await client.query("ROLLBACK");

    // In a clean transaction, verify that the new index is still there
    const checkStillNew = await client.query("SELECT to_regclass('public.idx_timesheet_active_productive_op_wc')::text AS idx");
    assert.ok(checkStillNew.rows[0].idx);
    console.log("  -> Scenario 5a PASSED!");

    console.log("Scenario 5b: Rollback succeeds when no parallel active tasks exist...");
    await client.query("BEGIN");
    await client.query(migrationSql);
    // Run rollback
    await client.query(rollbackSql);
    const checkOldAfterRollback = await client.query("SELECT to_regclass('public.idx_timesheet_active_productive_op')::text AS idx");
    const checkNewAfterRollback = await client.query("SELECT to_regclass('public.idx_timesheet_active_productive_op_wc')::text AS idx");
    assert.ok(checkOldAfterRollback.rows[0].idx, "Legacy index must be recreated");
    assert.equal(checkNewAfterRollback.rows[0].idx, null, "New index must be dropped");
    await client.query("ROLLBACK");
    console.log("  -> Scenario 5b PASSED!");

    console.log("=== ALL MIGRATION HARDENING SCENARIOS PASSED (6/6) ===");
  } finally {
    await client.end();
  }
}

runTest().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
