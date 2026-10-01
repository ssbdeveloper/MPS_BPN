"use strict";

/**
 * test_timesheet_tapin_duplicate_gate.js
 *
 * Menguji gate tap-in pada POST /timesheet (exports.create di timesheet_transactionController.js):
 * 1. Tap-in pertama sukses (HTTP 200) pada MILL-01.
 * 2. Tap-in kedua untuk kunci yang sama (plant, serialnumber, normalized order_no, operation_no, workcentercode)
 *    menghasilkan HTTP 409 dengan code DUPLICATE_ACTIVE_OPERATION.
 * 2b. Anomali: date_checkout terisi tapi longdate_checkout IS NULL tetap aktif (409).
 * 3. Tidak ada side effect pada meal break ('0000'): meal break tetap terbuka saat tap-in duplicate ditolak.
 * 4. Kunci sama (order & op sama) tetapi WORKCENTER BERBEDA ("LATHE-02") bisa check-in bersamaan (200 OK).
 * 5. Normalisasi whitespace workcenter (spasi, \t, \r, \n) mencegah bypass duplikat (409).
 * 6. Workcenter mempertahankan casing ("mill-01" vs "MILL-01").
 * 7. Legacy workcenter (NULL dan "") dinormalisasi identik ke "" sehingga saling mencegah duplikat (409).
 * 8. Stop A via checkoutid menutup hanya transaksi A, transaksi B di workcenter lain tetap aktif (longdate_checkout IS NULL).
 * 9. Re-check-in untuk workcenter A setelah di-checkout berhasil lagi (200 OK).
 * 10a. Concurrency race: Dua request serentak untuk workcenter SAMA menghasilkan tepat satu 200 dan satu 409.
 * 10b. Concurrency race: Dua request serentak untuk workcenter BERBEDA menghasilkan [200, 200] keduanya sukses.
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

test("Tap-in Duplicate Gate: workcenter-scoped checkin, checkout, and concurrency race tests", async (t) => {
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
    let tsA = null;
    await t.test("1. First productive tap-in on MILL-01 succeeds (200 OK)", async () => {
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
      tsA = res.body.tsnumber;
      createdTs.push(tsA);
    });

    // Scenario 2: Second tap-in for same active key AND same workcenter returns 409
    await t.test("2. Second tap-in for same active key and same workcenter returns 409 DUPLICATE_ACTIVE_OPERATION", async () => {
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
      assert.match(res.body?.error || "", /pada workcenter MILL-01/);
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
           (plant, serialnumber, full_name, order_no, operation_no, workcentercode, activitytype, 
            longdate_checkin, date_checkin, hour_checkin, date_checkout, longdate_checkout)
         VALUES ($1, $2, $3, '100099994', 30, 'ANOM-01', '', NOW(), to_char(NOW(), 'DD/MM/YYYY'), to_char(NOW(), 'HH24:MI'), '25/09/2026', NULL)
         RETURNING tsnumber`,
        [process.env.PLANT_SSB, ANOMALY_SN, "Anomaly Operator"]
      );
      createdTs.push(insAnom.rows[0].tsnumber);

      // Attempt tap-in for the same order/operation/workcenter
      const req = mockReq({
        body: {
          serialnumber: ANOMALY_SN,
          full_name: "Anomaly Operator",
          order_no: "000100099994",
          operation_no: "30",
          workcentercode: "ANOM-01",
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
          workcentercode: "WC-MEAL-1",
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

      // Now attempt duplicate tap-in for MEAL_SN (same order 100099992, op 10, wc WC-MEAL-1)
      const reqDup = mockReq({
        body: {
          serialnumber: MEAL_SN,
          full_name: "Meal Test Operator",
          order_no: "100099992",
          operation_no: 10,
          workcentercode: "WC-MEAL-1",
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

    // Scenario 4: SAME operator, SAME order, SAME operation, DIFFERENT workcenter succeeds concurrently!
    let tsB = null;
    await t.test("4. Same operator/order/op on DIFFERENT workcenter (LATHE-02) succeeds concurrently (200 OK)", async () => {
      const req = mockReq({
        body: {
          serialnumber: TEST_SN,
          full_name: "Test Operator Tapin Gate",
          order_no: "000100099991", // Same order as #1
          operation_no: 40,           // Same operation as #1
          operation_text: "Lathe Finishing",
          workcentercode: "LATHE-02", // DIFFERENT workcenter!
          workcenterdescription: "Lathe Station 2",
          planhours: 1.5,
          activitytype: "",
        },
      });
      const res = mockRes();
      await create(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(res.body?.tsnumber);
      assert.notEqual(res.body.tsnumber, tsA);
      tsB = res.body.tsnumber;
      createdTs.push(tsB);

      // Verify BOTH tsA and tsB are currently ACTIVE in the database
      const activeRows = await client.query(
        "SELECT tsnumber, workcentercode, longdate_checkout FROM public.timesheet_transaction WHERE tsnumber IN ($1, $2)",
        [tsA, tsB]
      );
      assert.equal(activeRows.rows.length, 2);
      assert.equal(activeRows.rows[0].longdate_checkout, null);
      assert.equal(activeRows.rows[1].longdate_checkout, null);
    });

    // Scenario 5: Whitespace normalization on workcenter prevents duplicate bypass
    await t.test("5. Whitespace variations in workcenter (spaces, tabs, newlines, VT, FF, NBSP, BOM) do not bypass duplicate guard", async () => {
      const req = mockReq({
        body: {
          serialnumber: TEST_SN,
          full_name: "Test Operator Tapin Gate",
          order_no: "100099991",
          operation_no: 40,
          workcentercode: " \t\r\n\v\f\u00a0\ufeff LATHE-02 \ufeff\u00a0\t ", // Whitespace variation of LATHE-02
          activitytype: "",
        },
      });
      const res = mockRes();
      await create(req, res);

      assert.equal(res.statusCode, 409);
      assert.equal(res.body?.code, "DUPLICATE_ACTIVE_OPERATION");
    });

    // Scenario 6: Casing is preserved (LATHE-02 vs lathe-02 are distinct)
    await t.test("6. Casing in workcenter is preserved", async () => {
      const req = mockReq({
        body: {
          serialnumber: TEST_SN,
          full_name: "Test Operator Tapin Gate",
          order_no: "100099991",
          operation_no: 40,
          workcentercode: "lathe-02", // lower case
          activitytype: "",
        },
      });
      const res = mockRes();
      await create(req, res);

      assert.equal(res.statusCode, 200, "Different case workcenter should be allowed as distinct");
      createdTs.push(res.body.tsnumber);
    });

    // Scenario 7: Legacy null and empty string workcenters are normalized identically
    await t.test("7. Legacy NULL and empty string workcenters are normalized identically and conflict", async () => {
      const LEGACY_SN = "TEST_OP_LEGACY_05";
      await safeDeleteTimesheets(client, "serialnumber = $1", [LEGACY_SN]);
      await client.query("DELETE FROM public.usernfc WHERE snssb = $1", [LEGACY_SN]);
      await client.query(
        "INSERT INTO public.usernfc (snssb, full_name) VALUES ($1, $2)",
        [LEGACY_SN, "Legacy Operator"]
      );

      // First checkin with NULL workcenter
      const req1 = mockReq({
        body: {
          serialnumber: LEGACY_SN,
          full_name: "Legacy Operator",
          order_no: "100099995",
          operation_no: 10,
          workcentercode: null,
          activitytype: "",
        },
      });
      const res1 = mockRes();
      await create(req1, res1);
      assert.equal(res1.statusCode, 200);
      createdTs.push(res1.body.tsnumber);

      // Second checkin with empty/whitespace workcenter
      const req2 = mockReq({
        body: {
          serialnumber: LEGACY_SN,
          full_name: "Legacy Operator",
          order_no: "000100099995",
          operation_no: "10",
          workcentercode: "   \t  ",
          activitytype: "",
        },
      });
      const res2 = mockRes();
      await create(req2, res2);
      assert.equal(res2.statusCode, 409, "Empty workcenter must conflict with null workcenter");
      assert.equal(res2.body?.code, "DUPLICATE_ACTIVE_OPERATION");
    });

    // Scenario 8: Stop A via checkoutid closes ONLY tsA; tsB on LATHE-02 remains active
    await t.test("8. Stop A closes ONLY tsA; tsB on other workcenter remains active", async () => {
      const coReq = mockReq({ body: { tsnumber: tsA } });
      const coRes = mockRes();
      await checkoutid(coReq, coRes);
      assert.equal(coRes.statusCode, 200);

      // Verify tsA is closed
      const checkA = await client.query(
        "SELECT longdate_checkout, date_checkout FROM public.timesheet_transaction WHERE tsnumber = $1",
        [tsA]
      );
      assert.ok(checkA.rows[0].longdate_checkout != null, "tsA must be closed");

      // Verify tsB is STILL OPEN
      const checkB = await client.query(
        "SELECT longdate_checkout, date_checkout FROM public.timesheet_transaction WHERE tsnumber = $1",
        [tsB]
      );
      assert.equal(checkB.rows[0].longdate_checkout, null, "tsB must remain open after tsA is stopped");

      // Repeated Stop on tsA returns 404 (already checked out) without corrupting anything
      const repeatReq = mockReq({ body: { tsnumber: tsA } });
      const repeatRes = mockRes();
      await checkoutid(repeatReq, repeatRes);
      assert.equal(repeatRes.statusCode, 404);
    });

    // Scenario 9: Re-checking in on MILL-01 after tsA checkout succeeds
    await t.test("9. Tap-in on MILL-01 succeeds again after tsA was checked out", async () => {
      const req = mockReq({
        body: {
          serialnumber: TEST_SN,
          full_name: "Test Operator Tapin Gate",
          order_no: "100099991",
          operation_no: 40,
          workcentercode: "MILL-01",
          activitytype: "",
        },
      });
      const res = mockRes();
      await create(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(res.body?.tsnumber);
      createdTs.push(res.body.tsnumber);
    });

    // Scenario 10a: Concurrency race for SAME workcenter (exactly one 200, one 409)
    await t.test("10a. Concurrency race: same workcenter produces exactly one 200 and one 409", async () => {
      const RACE_SN = "TEST_OP_RACE_03";
      await safeDeleteTimesheets(client, "serialnumber = $1", [RACE_SN]);

      const reqA = mockReq({
        body: {
          serialnumber: RACE_SN,
          full_name: "Race Test Operator",
          order_no: "100099999",
          operation_no: 100,
          workcentercode: "RACE-WC",
          activitytype: "",
        },
      });
      const reqB = mockReq({
        body: {
          serialnumber: RACE_SN,
          full_name: "Race Test Operator",
          order_no: "000100099999",
          operation_no: "100",
          workcentercode: " \tRACE-WC\n",
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

    // Scenario 10b: Concurrency race for DIFFERENT workcenter (both 200 OK)
    await t.test("10b. Concurrency race: different workcenters BOTH succeed [200, 200]", async () => {
      const RACE_DIFF_SN = "TEST_OP_RACE_DIFF_06";
      await safeDeleteTimesheets(client, "serialnumber = $1", [RACE_DIFF_SN]);

      const reqA = mockReq({
        body: {
          serialnumber: RACE_DIFF_SN,
          full_name: "Race Diff Operator",
          order_no: "100099888",
          operation_no: 200,
          workcentercode: "WC-PARALLEL-1",
          activitytype: "",
        },
      });
      const reqB = mockReq({
        body: {
          serialnumber: RACE_DIFF_SN,
          full_name: "Race Diff Operator",
          order_no: "000100099888",
          operation_no: "200",
          workcentercode: "WC-PARALLEL-2",
          activitytype: "",
        },
      });

      const resA = mockRes();
      const resB = mockRes();

      await Promise.all([create(reqA, resA), create(reqB, resB)]);

      const codes = [resA.statusCode, resB.statusCode].sort();
      assert.deepEqual(codes, [200, 200], "Expected both concurrent tap-ins to succeed on different workcenters");
      if (resA.body?.tsnumber) createdTs.push(resA.body.tsnumber);
      if (resB.body?.tsnumber) createdTs.push(resB.body.tsnumber);
    });

  } finally {
    // Cleanup created test records with audit correction context
    if (createdTs.length > 0) {
      await safeDeleteTimesheets(client, "tsnumber = ANY($1::int[])", [createdTs]);
    }
    await client.query("DELETE FROM public.usernfc WHERE snssb IN ('TEST_OP_TAPIN_GATE_01', 'TEST_OP_MEAL_02', 'TEST_OP_RACE_03', 'TEST_OP_ANOMALY_04', 'TEST_OP_LEGACY_05', 'TEST_OP_RACE_DIFF_06')");
    client.release();
  }
});
