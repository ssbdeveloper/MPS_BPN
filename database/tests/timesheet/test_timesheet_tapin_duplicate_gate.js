"use strict";

/**
 * test_timesheet_tapin_duplicate_gate.js
 *
 * Menguji gate tap-in pada POST /timesheet (exports.create di timesheet_transactionController.js):
 * 1. Tap-in pertama sukses (HTTP 200).
 * 2. Tap-in kedua untuk kunci yang sama (plant, serialnumber, normalized order_no, operation_no)
 *    menghasilkan HTTP 409 dengan code DUPLICATE_ACTIVE_OPERATION.
 * 3. Tidak ada side effect pada meal break ('0000'): meal break tetap terbuka saat tap-in duplicate ditolak.
 * 4. Kunci berbeda (order berbeda) bisa check-in bersamaan (multitasking valid).
 * 5. Kunci berbeda (operasi berbeda pada order yang sama) bisa check-in bersamaan.
 * 6. Setelah record pertama checkout, tap-in untuk kunci yang sama boleh lagi.
 * 7. Concurrency race: dua request tap-in serentak untuk kunci yang sama menghasilkan tepat satu 200 dan satu 409.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");

process.env.DB_HOST = "localhost";
process.env.DB_PORT = "5432";
process.env.DB_NAME = "mps_timesheet_ckp_test";
process.env.DB_USER = "postgres";
process.env.PLANT_SSB = "5100";
process.env.TIMEZONE = "Asia/Jakarta";

// Fail-closed loopback guard
assert(["localhost", "127.0.0.1", "::1"].includes(process.env.DB_HOST));
assert(["mps_timesheet_bpn_test", "mps_timesheet_ckp_test"].includes(process.env.DB_NAME));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
});

global.pool = pool;

const {
  create,
  checkoutid,
} = require(path.join(REPO_ROOT, "apps/api/controllers/timesheet_transactionController"));

function mockRes() {
  const res = {
    statusCode: 200,
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
  return res;
}

function mockReq({ body = {} }) {
  return {
    body,
    params: {},
    header() {
      return null;
    },
  };
}

async function safeDeleteTimesheets(client, filterSql, params) {
  await client.query("SELECT set_config('mps.correction_actor', 'test-tapin-gate', false)");
  await client.query("SELECT set_config('mps.correction_reason', 'cleanup test data', false)");
  await client.query(`DELETE FROM public.timesheet_transaction WHERE ${filterSql}`, params);
}

test("Tap-in Duplicate Gate: 6 scenarios + concurrency race test", async (t) => {
  const client = await pool.connect();
  const TEST_SN = "TEST_OP_TAPIN_GATE_01";
  const createdTs = [];

  try {
    // Set correction context on session
    await client.query("SELECT set_config('mps.correction_actor', 'test-tapin-gate', false)");
    await client.query("SELECT set_config('mps.correction_reason', 'setup test data', false)");

    // Cleanup any existing test data for this operator
    await safeDeleteTimesheets(client, "serialnumber = $1", [TEST_SN]);
    await client.query("DELETE FROM public.usernfc WHERE snssb = $1", [TEST_SN]);
    await client.query(
      "INSERT INTO public.usernfc (snssb, full_name) VALUES ($1, $2)",
      [TEST_SN, "Test Operator Tapin Gate"]
    );

    // Scenario 1: First productive tap-in succeeds
    await t.test("1. First productive tap-in succeeds (200 OK)", async () => {
      const req = mockReq({
        body: {
          serialnumber: TEST_SN,
          full_name: "Test Operator Tapin Gate",
          order_no: "000100099991",
          operation_no: 40,
          operation_text: "Milling",
          workcentercode: "MILL-01",
          workcenterdescription: "Milling Station",
          planhours: 2.5,
          activitytype: "", // productive
        },
      });
      const res = mockRes();
      await create(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(res.body?.tsnumber);
      assert.equal(res.body.serialnumber, TEST_SN);
      createdTs.push(res.body.tsnumber);
    });

    // Scenario 2: Second tap-in for same active key returns 409 DUPLICATE_ACTIVE_OPERATION
    await t.test("2. Second tap-in for same active key returns 409 DUPLICATE_ACTIVE_OPERATION", async () => {
      const req = mockReq({
        body: {
          serialnumber: TEST_SN,
          full_name: "Test Operator Tapin Gate",
          order_no: "100099991", // leading zero stripped normalization
          operation_no: "0040",   // numeric normalization
          operation_text: "Milling Repeated",
          workcentercode: "MILL-01",
          planhours: 2.5,
          activitytype: null, // productive
        },
      });
      const res = mockRes();
      await create(req, res);

      assert.equal(res.statusCode, 409);
      assert.equal(res.body?.code, "DUPLICATE_ACTIVE_OPERATION");
    });

    // Scenario 2b: Anomaly where date_checkout is populated but longdate_checkout IS NULL
    await t.test("2b. Anomaly: date_checkout populated but longdate_checkout IS NULL is still active (returns 409)", async () => {
      const ANOMALY_SN = "TEST_OP_ANOMALY_04";
      await safeDeleteTimesheets(client, "serialnumber = $1", [ANOMALY_SN]);
      await client.query("DELETE FROM public.usernfc WHERE snssb = $1", [ANOMALY_SN]);
      await client.query(
        "INSERT INTO public.usernfc (snssb, full_name) VALUES ($1, $2)",
        [ANOMALY_SN, "Anomaly Operator"]
      );

      // Insert anomaly record with date_checkout populated but longdate_checkout NULL
      const insAnom = await client.query(
        `INSERT INTO public.timesheet_transaction 
           (plant, serialnumber, full_name, order_no, operation_no, activitytype, 
            longdate_checkin, date_checkin, hour_checkin, date_checkout, longdate_checkout)
         VALUES ($1, $2, $3, '100099994', 30, '', NOW(), to_char(NOW(), 'DD/MM/YYYY'), to_char(NOW(), 'HH24:MI'), '25/09/2026', NULL)
         RETURNING tsnumber`,
        [process.env.PLANT_SSB, ANOMALY_SN, "Anomaly Operator"]
      );
      createdTs.push(insAnom.rows[0].tsnumber);

      // Attempt tap-in for the same order/operation
      const req = mockReq({
        body: {
          serialnumber: ANOMALY_SN,
          full_name: "Anomaly Operator",
          order_no: "000100099994",
          operation_no: "30",
          activitytype: "",
        },
      });
      const res = mockRes();
      await create(req, res);

      assert.equal(res.statusCode, 409, "Must return 409 because longdate_checkout is still NULL");
      assert.equal(res.body?.code, "DUPLICATE_ACTIVE_OPERATION");
    });

    // Scenario 3: No side-effect on open meal break when duplicate tap-in is rejected
    await t.test("3. Open meal break (0000) is NOT closed when duplicate tap-in returns 409", async () => {
      // Create open meal break for another test operator
      const MEAL_SN = "TEST_OP_MEAL_02";
      await safeDeleteTimesheets(client, "serialnumber = $1", [MEAL_SN]);
      const insMeal = await client.query(
        `INSERT INTO public.timesheet_transaction 
           (plant, serialnumber, full_name, activitytype, longdate_checkin, date_checkin, hour_checkin)
         VALUES ($1, $2, $3, '0000', NOW(), to_char(NOW(), 'DD/MM/YYYY'), to_char(NOW(), 'HH24:MI'))
         RETURNING tsnumber`,
        [process.env.PLANT_SSB, MEAL_SN, "Meal Test Operator"]
      );
      const mealTs = insMeal.rows[0].tsnumber;
      createdTs.push(mealTs);

      // Create first productive checkin for MEAL_SN
      const req1 = mockReq({
        body: {
          serialnumber: MEAL_SN,
          full_name: "Meal Test Operator",
          order_no: "100099992",
          operation_no: 10,
          activitytype: "",
        },
      });
      const res1 = mockRes();
      await create(req1, res1);
      assert.equal(res1.statusCode, 200);
      createdTs.push(res1.body.tsnumber);

      // Verify the first productive checkin closed the initial meal break
      const checkMeal1 = await client.query(
        "SELECT date_checkout, longdate_checkout FROM public.timesheet_transaction WHERE tsnumber = $1",
        [mealTs]
      );
      assert.ok(checkMeal1.rows[0].longdate_checkout != null, "Initial meal break should be closed by first productive checkin");

      // Open a second meal break for MEAL_SN
      const insMeal2 = await client.query(
        `INSERT INTO public.timesheet_transaction 
           (plant, serialnumber, full_name, activitytype, longdate_checkin, date_checkin, hour_checkin)
         VALUES ($1, $2, $3, '0000', NOW(), to_char(NOW(), 'DD/MM/YYYY'), to_char(NOW(), 'HH24:MI'))
         RETURNING tsnumber`,
        [process.env.PLANT_SSB, MEAL_SN, "Meal Test Operator"]
      );
      const mealTs2 = insMeal2.rows[0].tsnumber;
      createdTs.push(mealTs2);

      // Now attempt duplicate tap-in for MEAL_SN (same order 100099992, op 10)
      const reqDup = mockReq({
        body: {
          serialnumber: MEAL_SN,
          full_name: "Meal Test Operator",
          order_no: "100099992",
          operation_no: 10,
          activitytype: "",
        },
      });
      const resDup = mockRes();
      await create(reqDup, resDup);
      assert.equal(resDup.statusCode, 409);
      assert.equal(resDup.body?.code, "DUPLICATE_ACTIVE_OPERATION");

      // Verify mealTs2 remains OPEN (date_checkout IS NULL, longdate_checkout IS NULL)
      const checkMeal2 = await client.query(
        "SELECT date_checkout, longdate_checkout FROM public.timesheet_transaction WHERE tsnumber = $1",
        [mealTs2]
      );
      assert.equal(checkMeal2.rows[0].longdate_checkout, null, "Meal break must remain open when tap-in is rejected");
    });

    // Scenario 4: Different order for same operator succeeds concurrently
    await t.test("4. Concurrent check-in for different order_no succeeds", async () => {
      const req = mockReq({
        body: {
          serialnumber: TEST_SN,
          full_name: "Test Operator Tapin Gate",
          order_no: "100099993", // Different order
          operation_no: 40,
          activitytype: "",
        },
      });
      const res = mockRes();
      await create(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(res.body?.tsnumber);
      createdTs.push(res.body.tsnumber);
    });

    // Scenario 5: Different operation on same order succeeds concurrently
    await t.test("5. Concurrent check-in for different operation_no on same order succeeds", async () => {
      const req = mockReq({
        body: {
          serialnumber: TEST_SN,
          full_name: "Test Operator Tapin Gate",
          order_no: "000100099991", // Same order as #1
          operation_no: 50,           // Different operation
          activitytype: "",
        },
      });
      const res = mockRes();
      await create(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(res.body?.tsnumber);
      createdTs.push(res.body.tsnumber);
    });

    // Scenario 6: Re-checking in after checkout succeeds
    await t.test("6. Tap-in succeeds after previous record for same key is checked out", async () => {
      const firstTs = createdTs[0]; // order 100099991, op 40
      // Checkout firstTs
      const coReq = mockReq({ body: { tsnumber: firstTs } });
      const coRes = mockRes();
      await checkoutid(coReq, coRes);
      assert.equal(coRes.statusCode, 200);

      // Now tap-in for order 100099991, op 40 again
      const req = mockReq({
        body: {
          serialnumber: TEST_SN,
          full_name: "Test Operator Tapin Gate",
          order_no: "100099991",
          operation_no: 40,
          activitytype: "",
        },
      });
      const res = mockRes();
      await create(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(res.body?.tsnumber);
      createdTs.push(res.body.tsnumber);
    });

    // Scenario 7: Concurrency race test (simultaneous requests)
    await t.test("7. Concurrency race: exactly one succeeds and one 409", async () => {
      const RACE_SN = "TEST_OP_RACE_03";
      await safeDeleteTimesheets(client, "serialnumber = $1", [RACE_SN]);

      const reqA = mockReq({
        body: {
          serialnumber: RACE_SN,
          full_name: "Race Test Operator",
          order_no: "100099999",
          operation_no: 100,
          activitytype: "",
        },
      });
      const reqB = mockReq({
        body: {
          serialnumber: RACE_SN,
          full_name: "Race Test Operator",
          order_no: "000100099999",
          operation_no: "100",
          activitytype: "",
        },
      });

      const resA = mockRes();
      const resB = mockRes();

      await Promise.all([create(reqA, resA), create(reqB, resB)]);

      const codes = [resA.statusCode, resB.statusCode].sort();
      assert.deepEqual(codes, [200, 409], "Expected exactly one 200 and one 409 from concurrent tap-in race");
      if (resA.body?.tsnumber) createdTs.push(resA.body.tsnumber);
      if (resB.body?.tsnumber) createdTs.push(resB.body.tsnumber);
    });

  } finally {
    // Cleanup created test records with audit correction context
    if (createdTs.length > 0) {
      await safeDeleteTimesheets(client, "tsnumber = ANY($1::int[])", [createdTs]);
    }
    await client.query("DELETE FROM public.usernfc WHERE snssb IN ('TEST_OP_TAPIN_GATE_01', 'TEST_OP_MEAL_02', 'TEST_OP_RACE_03')");
    client.release();
  }
});
