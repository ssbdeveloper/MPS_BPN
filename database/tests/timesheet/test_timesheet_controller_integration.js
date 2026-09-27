"use strict";

/**
 * test_timesheet_controller_integration.js
 *
 * Menguji jalur aplikasi nyata (bukan SQL simulasi manual):
 * 1. updateTimesheetadmin (controller nyata):
 *    - Recalculation durasi saat checkout diubah.
 *    - Checkout menjadi NULL membuat duration NULL (bukan mempertahankan nilai lama).
 *    - Invalid interval (checkout < checkin) ditolak HTTP 400.
 *    - Actor dan reason wajib saat kolom payroll berubah (HTTP 400).
 *    - Penulisan otomatis ledger timesheet_correction_audit dalam transaksi yang sama
 *      untuk perubahan serialnumber, order_no, operation_no, longdate_checkin, longdate_checkout.
 * 2. timesheetConfirmationService (service nyata):
 *    - Menutup dua concurrent open jobs milik satu operator via checkoutBySerial.
 *    - Menghitung durasi, mengisi kolom derived date/hour, dan memastikan tidak ada record tertinggal open.
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

// Fail-closed guard localhost
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
  updateTimesheetadmin,
  bulkValidation,
  partialUpdate,
} = require(path.join(REPO_ROOT, "apps/api/controllers/timesheet_transactionController"));
const { createTimesheetConfirmationService } = require(path.join(REPO_ROOT, "apps/api/services/timesheetConfirmationService"));

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

function mockReq({ id, tsnumber, body = {}, actor = null }) {
  const paramVal = tsnumber != null ? String(tsnumber) : (id != null ? String(id) : undefined);
  return {
    params: { id: paramVal, tsnumber: paramVal },
    body,
    header(name) {
      const n = String(name || "").toLowerCase();
      if (n === "x-user-name" || n === "x-user-id") {
        return actor || null;
      }
      return null;
    },
  };
}

test("Controller Integration: Duration recalculation, NULL duration, validation, dan automatic audit ledger", async (t) => {
  const client = await pool.connect();
  let testTsNumber = null;
  const TEST_SN = "LOCAL_TEST_ADMIN_01"; // isolation prefix — never matches production data

  try {
    // Verifikasi loopback
    const addrRes = await client.query("SELECT inet_server_addr() AS addr");
    const addr = addrRes.rows[0]?.addr;
    if (addr && !["127.0.0.1", "::1"].includes(String(addr).trim())) {
      throw new Error(`Test ditolak: koneksi bukan loopback (${addr})`);
    }

    // Ensure isolated test operator exists in usernfc
    await client.query("DELETE FROM public.usernfc WHERE snssb = $1", [TEST_SN]);
    await client.query(`
      INSERT INTO public.usernfc (snssb, full_name)
      VALUES ($1, 'Local Test Admin Operator')
    `, [TEST_SN]);


    // Buat record sumber timesheet_transaction dengan operator test terisolasi
    const insRes = await client.query(
      `INSERT INTO public.timesheet_transaction (
         plant, serialnumber, activitytype, order_no, operation_no,
         longdate_checkin, longdate_checkout, duration
       ) VALUES (
         '5100', $1, 'M1', 'ORD_ORIG', 10,
         '2026-09-10T08:00:00+07:00'::timestamptz,
         '2026-09-10T09:00:00+07:00'::timestamptz,
         1.00
       ) RETURNING tsnumber`,
      [TEST_SN]
    );
    testTsNumber = insRes.rows[0].tsnumber;

    // --------------------------------------------------------------------------
    // Test 4A: Perubahan checkout menghitung ulang duration
    // --------------------------------------------------------------------------
    const res4A = mockRes();
    const req4A = mockReq({
      id: testTsNumber,
      actor: "supervisor_01",
      body: {
        serialnumber: TEST_SN,
        longdate_checkout: "2026-09-10T10:30:00+07:00", // 2.5 jam
        reason: "Perpanjangan pekerjaan hingga 10:30",
      },
    });
    await updateTimesheetadmin(req4A, res4A);
    assert.equal(res4A.statusCode, 200, `updateTimesheetadmin failed: ${JSON.stringify(res4A.body)}`);
    assert.equal(Number(res4A.body.duration), 2.50, `Expected duration 2.50, got ${res4A.body.duration}`);
    assert.equal(res4A.body.hour_checkout, "10:30");

    // --------------------------------------------------------------------------
    // Test 4B: Checkout menjadi NULL membuat duration NULL (bukan mempertahankan nilai lama)
    // --------------------------------------------------------------------------
    const res4B = mockRes();
    const req4B = mockReq({
      id: testTsNumber,
      actor: "supervisor_01",
      body: {
        serialnumber: TEST_SN,
        longdate_checkout: null,
        reason: "Buka kembali job: checkout dibatalkan",
      },
    });
    await updateTimesheetadmin(req4B, res4B);
    assert.equal(res4B.statusCode, 200, `updateTimesheetadmin NULL checkout failed: ${JSON.stringify(res4B.body)}`);
    assert.equal(res4B.body.longdate_checkout, null);
    assert.equal(res4B.body.duration, null, "Duration harus NULL saat checkout NULL, bukan nilai lama");
    assert.equal(res4B.body.date_checkout, null);
    assert.equal(res4B.body.hour_checkout, null);

    // --------------------------------------------------------------------------
    // Test 4C: Invalid interval (checkout < checkin) ditolak HTTP 400
    // --------------------------------------------------------------------------
    const res4C = mockRes();
    const req4C = mockReq({
      id: testTsNumber,
      actor: "supervisor_01",
      body: {
        serialnumber: TEST_SN,
        longdate_checkout: "2026-09-10T07:00:00+07:00", // Lebih awal dari checkin 08:00
        reason: "Percobaan interval terbalik",
      },
    });
    await updateTimesheetadmin(req4C, res4C);
    assert.equal(res4C.statusCode, 400, "Invalid interval wajib ditolak HTTP 400");
    assert.match(String(res4C.body?.error || ""), /Checkout tidak boleh lebih awal/i);

    // --------------------------------------------------------------------------
    // Test 4D: Actor dan reason wajib saat kolom payroll berubah
    // --------------------------------------------------------------------------
    const res4D1 = mockRes();
    const req4D1 = mockReq({
      id: testTsNumber,
      actor: null, // Tanpa actor
      body: {
        serialnumber: TEST_SN,
        order_no: "ORD_MODIFIED",
        reason: "Ganti order",
      },
    });
    await updateTimesheetadmin(req4D1, res4D1);
    assert.equal(res4D1.statusCode, 400, "Tanpa actor wajib ditolak HTTP 400");
    assert.equal(res4D1.body?.code, "ACTOR_REQUIRED");

    const res4D2 = mockRes();
    const req4D2 = mockReq({
      id: testTsNumber,
      actor: "supervisor_01",
      body: {
        serialnumber: TEST_SN,
        order_no: "ORD_MODIFIED",
        reason: "", // Reason kosong
      },
    });
    await updateTimesheetadmin(req4D2, res4D2);
    assert.equal(res4D2.statusCode, 400, "Tanpa reason wajib ditolak HTTP 400");
    assert.equal(res4D2.body?.code, "REASON_REQUIRED");

    // --------------------------------------------------------------------------
    // Test 5: Automatic audit ledger generation dengan before/after count assertion
    // (serialnumber, order_no, operation_no, longdate_checkin, longdate_checkout)
    // --------------------------------------------------------------------------

    // Get audit count BEFORE call — must increase by exactly 1 per controller call
    const auditBefore = await client.query(
      `SELECT count(*) AS cnt FROM public.timesheet_correction_audit
       WHERE tsnumber = $1 AND channel = 'updateadmin'`,
      [testTsNumber]
    );
    const countBefore = Number(auditBefore.rows[0].cnt);

    const res5 = mockRes();
    const req5 = mockReq({
      id: testTsNumber,
      actor: "lead_auditor",
      body: {
        serialnumber: TEST_SN,
        order_no: "ORD_AUDITED_99",
        operation_no: 25,
        longdate_checkin: "2026-09-10T08:15:00+07:00",
        longdate_checkout: "2026-09-10T11:45:00+07:00",
        reason: "Koreksi menyeluruh data payroll audit",
      },
    });
    await updateTimesheetadmin(req5, res5);
    assert.equal(res5.statusCode, 200, `Update comprehensive failed: ${JSON.stringify(res5.body)}`);

    // Verifikasi audit count bertambah TEPAT satu per satu pemanggilan controller
    const auditAfter = await client.query(
      `SELECT count(*) AS cnt FROM public.timesheet_correction_audit
       WHERE tsnumber = $1 AND channel = 'updateadmin'`,
      [testTsNumber]
    );
    const countAfter = Number(auditAfter.rows[0].cnt);
    assert.equal(countAfter, countBefore + 1,
      `Audit count harus bertambah tepat 1: sebelum=${countBefore} sesudah=${countAfter}`);

    // Verifikasi record otomatis di timesheet_correction_audit
    const auditRes = await client.query(
      `SELECT * FROM public.timesheet_correction_audit
       WHERE tsnumber = $1 AND channel = 'updateadmin'
       ORDER BY id DESC LIMIT 1`,
      [testTsNumber]
    );
    assert.equal(auditRes.rows.length, 1, "Ledger audit wajib terbuat otomatis dalam transaksi yang sama");
    const auditRow = auditRes.rows[0];
    assert.equal(auditRow.actor, "lead_auditor");
    assert.equal(auditRow.reason, "Koreksi menyeluruh data payroll audit");

    const afterObj = auditRow.after_row;
    assert.equal(afterObj.order_no, "ORD_AUDITED_99");
    assert.equal(String(afterObj.operation_no), "25");
    assert.ok(afterObj.longdate_checkin);
    assert.ok(afterObj.longdate_checkout);

    // Verifikasi rollback tidak meninggalkan orphan audit (test dengan request yang invalid)
    const auditCountBeforeInvalid = countAfter;
    const resRollback = mockRes();
    const reqRollback = mockReq({
      id: testTsNumber,
      actor: "bad_actor",
      body: {
        serialnumber: TEST_SN,
        longdate_checkout: "2026-09-10T07:00:00+07:00", // invalid < checkin
        reason: "Sengaja invalid untuk test rollback",
      },
    });
    await updateTimesheetadmin(reqRollback, resRollback);
    assert.equal(resRollback.statusCode, 400, "Invalid request harus ditolak 400");
    const auditCountAfterInvalid = await client.query(
      `SELECT count(*) AS cnt FROM public.timesheet_correction_audit
       WHERE tsnumber = $1 AND channel = 'updateadmin'`,
      [testTsNumber]
    );
    assert.equal(Number(auditCountAfterInvalid.rows[0].cnt), auditCountBeforeInvalid,
      "Rollback/rejection tidak boleh meninggalkan orphan audit");

  } finally {
    if (testTsNumber) {
      await client.query("SET mps.correction_actor = 'cleanup_actor'");
      await client.query("SET mps.correction_reason = 'cleanup_test'");
      await client.query("DELETE FROM public.timesheet_transaction WHERE tsnumber = $1", [testTsNumber]);
    }
    // Cleanup isolated test usernfc only (by LOCAL_TEST_ prefix)
    await client.query("DELETE FROM public.usernfc WHERE snssb LIKE 'LOCAL_TEST_%'");
    client.release();
  }
});


test("Service Integration: Multiple concurrent checkout via timesheetConfirmationService", async (t) => {
  const client = await pool.connect();
  const testIds = [];
  const TEST_CHECKOUT_SN = "LOCAL_TEST_CHECKOUT_01"; // isolation prefix

  try {
    // Ensure isolated test operator exists in usernfc
    await client.query("DELETE FROM public.usernfc WHERE snssb = $1", [TEST_CHECKOUT_SN]);
    await client.query(`
      INSERT INTO public.usernfc (snssb, full_name)
      VALUES ($1, 'Local Test Checkout Operator')
    `, [TEST_CHECKOUT_SN]);


    // Verify no pre-existing open records for this test operator (clean slate)
    await client.query("SET mps.correction_actor = 'cleanup_actor'");
    await client.query("SET mps.correction_reason = 'test_setup_cleanup'");
    await client.query(
      "DELETE FROM public.timesheet_transaction WHERE serialnumber = $1",
      [TEST_CHECKOUT_SN]
    );

    // Ensure ews.roster_effective exists and has test roster for isolated operator matching current day
    await client.query("CREATE SCHEMA IF NOT EXISTS ews");
    await client.query(`
      CREATE TABLE IF NOT EXISTS ews.roster_effective (
        serialnumber text,
        business_date date,
        status text,
        eff_shift text,
        start_time time,
        end_time time,
        crosses_midnight boolean
      )
    `);

    await client.query("DELETE FROM ews.roster_effective WHERE serialnumber = $1", [TEST_CHECKOUT_SN]);
    await client.query(`
      INSERT INTO ews.roster_effective (serialnumber, business_date, status, eff_shift, start_time, end_time, crosses_midnight)
      VALUES
        ($1, (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date, 'WORKING', 'SHIFT_1', '00:00:00'::time, '23:59:59'::time, false)
    `, [TEST_CHECKOUT_SN]);

    // Ensure isolated test orders exist in ph3_order with numeric confirmation numbers
    await client.query("DELETE FROM public.ph3_order WHERE order_no IN ('100091', '100092')");
    await client.query(`
      INSERT INTO public.ph3_order (order_no, operation_no, confirmation_number, plant_code)
      VALUES
        ('100091', '10', '200091', '5100'),
        ('100092', '20', '200092', '5100')
    `);

    // Insert 2 concurrent open productive jobs (activitytype NULL, checkout NULL)
    const ins1 = await client.query(
      `INSERT INTO public.timesheet_transaction (
         plant, serialnumber, activitytype, order_no, operation_no, longdate_checkin
       ) VALUES (
         '5100', $1, NULL, '100091', 10, clock_timestamp() - interval '2 hours'
       ) RETURNING tsnumber`,
      [TEST_CHECKOUT_SN]
    );
    testIds.push(ins1.rows[0].tsnumber);

    const ins2 = await client.query(
      `INSERT INTO public.timesheet_transaction (
         plant, serialnumber, activitytype, order_no, operation_no, longdate_checkin
       ) VALUES (
         '5100', $1, NULL, '100092', 20, clock_timestamp() - interval '2 hours'
       ) RETURNING tsnumber`,
      [TEST_CHECKOUT_SN]
    );
    testIds.push(ins2.rows[0].tsnumber);



    // Confirm no other operators' open records exist for this snssb (impossible since it's unique)
    const openBefore = await client.query(
      `SELECT count(*) FROM public.timesheet_transaction
       WHERE serialnumber = $1 AND longdate_checkout IS NULL`,
      [TEST_CHECKOUT_SN]
    );
    assert.equal(Number(openBefore.rows[0].count), 2,
      "Setup: exactly 2 open records for test operator before checkout");

    // Inisialisasi service konfirmasi nyata (actual application path)
    const confirmationService = createTimesheetConfirmationService({
      pool,
      timezone: "Asia/Jakarta",
      plant: "5100",
    });

    // Panggil service checkoutBySerial — ACTUAL service path, not manual SQL
    const closedRows = await confirmationService.checkoutBySerial(TEST_CHECKOUT_SN);
    // Exactly the 2 test records must be closed
    assert.equal(closedRows.length, 2,
      `Expected exactly 2 closed rows for isolated operator, got ${closedRows.length}`);

    // Verifikasi di DB bahwa kedua row telah tertutup sempurna
    const verifyRes = await client.query(
      `SELECT tsnumber, longdate_checkout, date_checkout, hour_checkout, duration, confirmationnumber
       FROM public.timesheet_transaction
       WHERE tsnumber = ANY($1::int[])
       ORDER BY tsnumber`,
      [testIds]
    );

    assert.equal(verifyRes.rows.length, 2, "Both test records must be verifiable by tsnumber");
    for (const row of verifyRes.rows) {
      assert.ok(row.longdate_checkout != null,
        `tsnumber ${row.tsnumber} longdate_checkout tidak boleh NULL`);
      assert.ok(row.date_checkout != null,
        `tsnumber ${row.tsnumber} date_checkout tidak boleh NULL`);
      assert.ok(row.hour_checkout != null,
        `tsnumber ${row.tsnumber} hour_checkout tidak boleh NULL`);
      assert.ok(Number(row.duration) > 0,
        `tsnumber ${row.tsnumber} duration harus terhitung (>0)`);
      // confirmationnumber must be non-NULL and valid format after service checkout
      assert.ok(row.confirmationnumber != null,
        `tsnumber ${row.tsnumber} confirmationnumber tidak boleh NULL setelah checkout`);
    }

    // ------------------------------------------------------------------
    // Bukti confirmation & split family (handoff §7: klaim ini belum diuji).
    // Sebelumnya test hanya memastikan confirmationnumber != NULL, sehingga
    // format dan pemecahan RG/OV/RW tidak pernah dibuktikan.
    // ------------------------------------------------------------------
    const familyRes = await client.query(
      `SELECT tsnumber, confirmationnumber, longdate_checkin, longdate_checkout, duration
         FROM public.timesheet_transaction
        WHERE serialnumber = $1
        ORDER BY longdate_checkin, tsnumber`,
      [TEST_CHECKOUT_SN]
    );

    const CONF_RE = /^[0-9]+(RG|OV|RW)$/;
    for (const row of familyRes.rows) {
      assert.match(String(row.confirmationnumber), CONF_RE,
        `confirmationnumber '${row.confirmationnumber}' harus berformat <angka>(RG|OV|RW)`);
    }

    // Setiap confirmation base (angka tanpa suffix) berasal dari ph3_order test.
    const bases = new Set(
      familyRes.rows.map(r => String(r.confirmationnumber).replace(/(RG|OV|RW)$/, ""))
    );
    for (const b of bases) {
      assert.ok(["200091", "200092"].includes(b),
        `confirmation base '${b}' harus berasal dari ph3_order test (200091/200092)`);
    }

    // Split family harus utuh: tiap base menutup interval kontinu tanpa gap,
    // dan total durasi family sama dengan rentang checkin..checkout-nya.
    for (const b of bases) {
      const fam = familyRes.rows
        .filter(r => String(r.confirmationnumber).startsWith(b))
        .sort((x, y) => new Date(x.longdate_checkin) - new Date(y.longdate_checkin));
      assert.ok(fam.length >= 1, `family ${b} harus punya minimal satu segment`);

      for (let i = 1; i < fam.length; i++) {
        assert.equal(
          new Date(fam[i].longdate_checkin).getTime(),
          new Date(fam[i - 1].longdate_checkout).getTime(),
          `family ${b} tidak boleh punya gap/overlap antar segment`
        );
      }

      const spanSec =
        (new Date(fam[fam.length - 1].longdate_checkout).getTime()
          - new Date(fam[0].longdate_checkin).getTime()) / 1000;
      const sumSec = fam.reduce((acc, r) =>
        acc + (new Date(r.longdate_checkout).getTime()
             - new Date(r.longdate_checkin).getTime()) / 1000, 0);
      assert.equal(sumSec, spanSec,
        `family ${b}: jumlah durasi segment harus sama dengan rentang total`);

      const sumDur = fam.reduce((acc, r) => acc + Number(r.duration || 0), 0);
      assert.equal(Number(sumDur.toFixed(2)), Number((spanSec / 3600).toFixed(2)),
        `family ${b}: SUM(duration) harus konsisten dengan rentang jam`);
    }

    // Tidak ada baris snapshot operator lain yang ikut berubah.
    const foreignTouched = await client.query(
      `SELECT count(*)::int AS n
         FROM public.timesheet_transaction
        WHERE serialnumber <> $1
          AND confirmationnumber IN (
            SELECT confirmationnumber FROM public.timesheet_transaction
             WHERE serialnumber = $1 AND confirmationnumber IS NOT NULL
          )`,
      [TEST_CHECKOUT_SN]
    );
    assert.equal(foreignTouched.rows[0].n, 0,
      "confirmationnumber test tidak boleh muncul pada record operator lain");

    // Pastikan tidak ada record tertinggal open untuk operator test ini
    const openCheck = await client.query(
      `SELECT count(*) FROM public.timesheet_transaction
       WHERE serialnumber = $1 AND longdate_checkout IS NULL`,
      [TEST_CHECKOUT_SN]
    );
    assert.equal(Number(openCheck.rows[0].count), 0,
      "Tidak boleh ada record tertinggal open untuk operator test");

    // Pastikan tidak ada record operator lain yang ikut ditutup
    const closedRowsIds = new Set(closedRows.map(r => String(r.tsnumber || r.id)));
    const testIdsSet = new Set(testIds.map(String));
    for (const rid of closedRowsIds) {
      assert.ok(testIdsSet.has(rid),
        `closedRows contains unexpected non-test record: tsnumber=${rid}`);
    }

  } finally {
    if (testIds.length > 0) {
      await client.query("SET mps.correction_actor = 'cleanup_actor'");
      await client.query("SET mps.correction_reason = 'cleanup_test'");
      await client.query("DELETE FROM public.timesheet_transaction WHERE tsnumber = ANY($1::int[])", [testIds]);
    }
    // Cleanup isolated test usernfc by prefix
    await client.query("DELETE FROM public.usernfc WHERE snssb LIKE 'LOCAL_TEST_%'");
    // Cleanup isolated test ph3_order
    await client.query("DELETE FROM public.ph3_order WHERE order_no IN ('100091', '100092', 'ORD_CONC_1', 'ORD_CONC_2')");
    // Cleanup isolated test ews roster
    await client.query("DELETE FROM ews.roster_effective WHERE serialnumber LIKE 'LOCAL_TEST_%'");
    client.release();
  }
});

test("Controller Integration: bulkValidation flow (pre-publish invalidation, session context audit, batch containing frozen record rejection)", async (t) => {
  const client = await pool.connect();
  const TEST_VAL_SN = "LOCAL_TEST_VAL_01";
  const testIds = [];
  const testRunId = "a0000000-0000-0000-0000-000000000001";

  try {
    // Setup isolated test operator
    await client.query("DELETE FROM public.usernfc WHERE snssb = $1", [TEST_VAL_SN]);
    await client.query(`
      INSERT INTO public.usernfc (snssb, full_name)
      VALUES ($1, 'Local Test Validation Operator')
    `, [TEST_VAL_SN]);

    // Setup ETL run
    await client.query(`
      INSERT INTO public.timesheet_etl_run (
        run_id, plant, from_ts, to_ts, plant_timezone, allocation_version, status, created_by
      ) VALUES
      ($1::uuid, '5100', '2026-09-20 00:00:00+07', '2026-09-21 00:00:00+07', 'Asia/Jakarta', 'ALLOC-V1', 'SAP_READY', 'test_runner')
      ON CONFLICT (run_id) DO NOTHING
    `, [testRunId]);

    // 1. Buat 2 record pre-publish validasi
    const insRes = await client.query(`
      INSERT INTO public.timesheet_transaction (
        plant, serialnumber, order_no, operation_no, workcentercode,
        longdate_checkin, longdate_checkout, duration,
        state_flag, validation_date, note
      ) VALUES
      ('5100', $1, '100091', '0010', 'FAB-01',
       '2026-09-20 08:00:00+07', '2026-09-20 12:00:00+07', 4.0,
       '1', NULL, 'Pre-publish row 1'),
      ('5100', $1, '100091', '0020', 'FAB-01',
       '2026-09-20 13:00:00+07', '2026-09-20 17:00:00+07', 4.0,
       '1', NULL, 'Pre-publish row 2')
      RETURNING tsnumber
    `, [TEST_VAL_SN]);

    const [ts1, ts2] = insRes.rows.map(r => r.tsnumber);
    testIds.push(ts1, ts2);

    // Simulasikan artefak pre-publish ETL pipeline
    const inputRes1 = await client.query(`
      INSERT INTO public.timesheet_etl_input (
        run_id, plant, source_tsnumber, source_hash, allocation_version,
        serialnumber, longdate_checkin, longdate_checkout, raw_seconds, local_date_checkin,
        raw_snapshot, status
      ) VALUES
      ($1::uuid, '5100', $2, 'hash-val-1', 'ALLOC-V1', $4, '2026-09-20 08:00:00+07', '2026-09-20 12:00:00+07', 14400, '2026-09-20', '{}'::jsonb, 'SAP_READY'),
      ($1::uuid, '5100', $3, 'hash-val-2', 'ALLOC-V1', $4, '2026-09-20 13:00:00+07', '2026-09-20 17:00:00+07', 14400, '2026-09-20', '{}'::jsonb, 'SAP_READY')
      RETURNING input_id, source_tsnumber
    `, [testRunId, ts1, ts2, TEST_VAL_SN]);

    const inputMap = {};
    for (const row of inputRes1.rows) {
      inputMap[row.source_tsnumber] = row.input_id;
    }

    await client.query(`
      INSERT INTO public.timesheet_sap_ready (
        run_id, input_id, plant, source_tsnumber, source_version, allocation_version, ready_rule_version,
        local_date, segment_sequence, source_key, payload,
        raw_seconds, cleaned_seconds, allocated_seconds, sap_effective_seconds, status
      ) VALUES
      ($1::uuid, $2::uuid, '5100', $4::int, 'v1', 'ALLOC-V1', 'READY-V1', '2026-09-20', 1, $6, '{"ZTIMESHEETID": "T1"}'::jsonb, 14400, 14400, 14400, 14400, 'SAP_READY'),
      ($1::uuid, $3::uuid, '5100', $5::int, 'v1', 'ALLOC-V1', 'READY-V1', '2026-09-20', 1, $7, '{"ZTIMESHEETID": "T2"}'::jsonb, 14400, 14400, 14400, 14400, 'SAP_READY')
      ON CONFLICT (source_key) DO UPDATE SET status = 'SAP_READY'
    `, [testRunId, inputMap[ts1], inputMap[ts2], ts1, ts2, `TIMESHEET:5100:${ts1}:v1`, `TIMESHEET:5100:${ts2}:v1`]);

    // 1a. bulkValidation tanpa actor header harus ditolak HTTP 400 ACTOR_REQUIRED
    const reqNoActor = mockReq({
      body: {
        tsnumbers: [ts1, ts2],
        reason: "supervisor_daily_approval",
      },
      actor: null,
    });
    const resNoActor = mockRes();
    await bulkValidation(reqNoActor, resNoActor);
    assert.equal(resNoActor.statusCode, 400, "bulkValidation tanpa actor header harus ditolak 400");
    assert.equal(resNoActor.body.code, "ACTOR_REQUIRED");
    assert.match(resNoActor.body.error, /identitas user tepercaya/i);

    // 1b. bulkValidation dengan actor HANYA di body (untrusted) tetap harus ditolak HTTP 400 ACTOR_REQUIRED
    const reqBodyActor = {
      params: {},
      body: {
        tsnumbers: [ts1, ts2],
        actor: "spoofed_supervisor_in_body",
        reason: "supervisor_daily_approval",
      },
      header: () => null,
    };
    const resBodyActor = mockRes();
    await bulkValidation(reqBodyActor, resBodyActor);
    assert.equal(resBodyActor.statusCode, 400, "Actor di request body tidak boleh dipercaya (harus 400)");
    assert.equal(resBodyActor.body.code, "ACTOR_REQUIRED");

    // 1c. Jalankan bulkValidation melalui API Controller dengan header x-user-name tepercaya
    const req1 = mockReq({
      body: {
        tsnumbers: [ts1, ts2],
        reason: "supervisor_daily_approval",
      },
      actor: "supervisor_anto",
    });
    const res1 = mockRes();

    await bulkValidation(req1, res1);

    assert.equal(res1.statusCode, 200, "bulkValidation dengan header tepercaya harus mengembalikan 200");
    assert.equal(res1.body.updated_count, 2, "2 row harus berhasil divalidasi");

    // Verifikasi perubahan di DB
    const checkDb = await client.query(
      `SELECT tsnumber, state_flag, validation_date FROM public.timesheet_transaction WHERE tsnumber = ANY($1::int[])`,
      [[ts1, ts2]]
    );
    for (const r of checkDb.rows) {
      assert.equal(String(r.state_flag), "2", "state_flag harus menjadi 2");
      assert.ok(r.validation_date != null, "validation_date harus terisi");
    }

    // Verifikasi audit log atomik tunggal memuat actor tepercaya yang benar (bukan fallback generic 'supervisor')
    const auditRes = await client.query(
      `SELECT tsnumber, actor, reason, channel FROM public.timesheet_correction_audit WHERE tsnumber = ANY($1::int[]) ORDER BY id`,
      [[ts1, ts2]]
    );
    assert.equal(auditRes.rows.length, 2, "Harus ada tepat 2 entri audit (1 per row)");
    for (const a of auditRes.rows) {
      assert.equal(a.actor, "supervisor_anto", "Actor audit harus persis dari header tepercaya");
      assert.equal(a.reason, "supervisor_daily_approval");
      assert.equal(a.channel, "bulk_validation");
    }

    // Verifikasi invalidasi artefak pipeline pre-publish
    const inputRes = await client.query(
      `SELECT source_tsnumber, status, invalidated_reason FROM public.timesheet_etl_input WHERE source_tsnumber = ANY($1::int[])`,
      [[ts1, ts2]]
    );
    for (const inp of inputRes.rows) {
      assert.equal(inp.status, "INVALIDATED", "timesheet_etl_input harus berstatus INVALIDATED");
      assert.match(inp.invalidated_reason, /supervisor_daily_approval/i);
    }

    const readyRes = await client.query(
      `SELECT source_tsnumber, status FROM public.timesheet_sap_ready WHERE source_tsnumber = ANY($1::int[])`,
      [[ts1, ts2]]
    );
    for (const rdy of readyRes.rows) {
      assert.equal(rdy.status, "INVALIDATED", "timesheet_sap_ready harus berstatus INVALIDATED");
    }

    // 2. Batch yang memuat record FROZEN harus ditolak 409 secara atomik (seluruh batch gagal)
    const insFrozen = await client.query(`
      INSERT INTO public.timesheet_transaction (
        plant, serialnumber, order_no, operation_no, workcentercode,
        longdate_checkin, longdate_checkout, duration,
        state_flag, validation_date, note
      ) VALUES
      ('5100', $1, '100091', '0030', 'FAB-01',
       '2026-09-20 18:00:00+07', '2026-09-20 20:00:00+07', 2.0,
       '1', NULL, 'Normal candidate'),
      ('5100', $1, '100091', '0040', 'FAB-01',
       '2026-09-20 20:00:00+07', '2026-09-20 22:00:00+07', 2.0,
       '1', NULL, 'Frozen staged row')
      RETURNING tsnumber
    `, [TEST_VAL_SN]);

    const [tsNormal, tsFrozen] = insFrozen.rows.map(r => r.tsnumber);
    testIds.push(tsNormal, tsFrozen);

    // Bekukan tsFrozen di timesheet_staging_freeze
    await client.query(`
      INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, note)
      VALUES ($1, '5100', 'STAGED', 'test freeze in batch')
      ON CONFLICT (tsnumber) DO NOTHING
    `, [tsFrozen]);

    // Panggil bulkValidation dengan batch berisi tsNormal dan tsFrozen
    const reqBatchFrozen = mockReq({
      body: {
        tsnumbers: [tsNormal, tsFrozen],
        reason: "batch_approval_with_frozen",
      },
      actor: "supervisor_anto",
    });
    const resBatchFrozen = mockRes();

    await bulkValidation(reqBatchFrozen, resBatchFrozen);

    assert.equal(resBatchFrozen.statusCode, 409, "Batch memuat record frozen harus ditolak HTTP 409");
    assert.equal(resBatchFrozen.body.code, "TIMESHEET_FROZEN");

    // Verifikasi atomisitas: tsNormal TIDAK berubah karena transaksi rollback penuh
    const checkUnmodified = await client.query(
      `SELECT tsnumber, state_flag, validation_date FROM public.timesheet_transaction WHERE tsnumber = $1`,
      [tsNormal]
    );
    assert.equal(String(checkUnmodified.rows[0].state_flag), "1", "tsNormal harus tetap state_flag=1 setelah batch rollback");
    assert.equal(checkUnmodified.rows[0].validation_date, null, "tsNormal validation_date harus tetap NULL");

  } finally {
    await client.query("SET mps.correction_actor = 'cleanup_actor'");
    await client.query("SET mps.correction_reason = 'cleanup_test'");
    if (testIds.length > 0) {
      await client.query("DELETE FROM public.timesheet_staging_freeze WHERE tsnumber = ANY($1::int[])", [testIds]);
      await client.query("DELETE FROM public.timesheet_sap_ready WHERE source_tsnumber = ANY($1::int[])", [testIds]);
      await client.query("DELETE FROM public.timesheet_etl_input WHERE source_tsnumber = ANY($1::int[])", [testIds]);
      await client.query("DELETE FROM public.timesheet_transaction WHERE tsnumber = ANY($1::int[])", [testIds]);
    }
    await client.query("DELETE FROM public.timesheet_transaction WHERE serialnumber = $1", [TEST_VAL_SN]);
    await client.query("DELETE FROM public.timesheet_etl_run WHERE run_id = $1::uuid", [testRunId]);
    await client.query("DELETE FROM public.usernfc WHERE snssb = $1", [TEST_VAL_SN]);
    client.release();
  }
});

test("Controller Integration: partialUpdate flow (state_flag reject, workcentercode change, frozen protection, and non-payroll allowed)", async (t) => {
  const client = await pool.connect();
  const TEST_PARTIAL_SN = "LOCAL_TEST_PART_01";
  const testIds = [];
  const testRunId = "a0000000-0000-0000-0000-000000000002";

  try {
    await client.query("DELETE FROM public.usernfc WHERE snssb = $1", [TEST_PARTIAL_SN]);
    await client.query(`
      INSERT INTO public.usernfc (snssb, full_name)
      VALUES ($1, 'Local Test Partial Operator')
    `, [TEST_PARTIAL_SN]);

    await client.query(`
      INSERT INTO public.timesheet_etl_run (
        run_id, plant, from_ts, to_ts, plant_timezone, allocation_version, status, created_by
      ) VALUES
      ($1::uuid, '5100', '2026-09-20 00:00:00+07', '2026-09-21 00:00:00+07', 'Asia/Jakarta', 'ALLOC-V1', 'SAP_READY', 'test_runner')
      ON CONFLICT (run_id) DO NOTHING
    `, [testRunId]);

    // 1. Jalur reject (state_flag = '3') pada pre-publish record
    const insRej = await client.query(`
      INSERT INTO public.timesheet_transaction (
        plant, serialnumber, order_no, operation_no, workcentercode,
        longdate_checkin, longdate_checkout, duration,
        state_flag, validation_date, note
      ) VALUES
      ('5100', $1, '100091', '0010', 'FAB-01',
       '2026-09-20 08:00:00+07', '2026-09-20 12:00:00+07', 4.0,
       '2', now(), 'Pre-publish row to reject')
      RETURNING tsnumber
    `, [TEST_PARTIAL_SN]);

    const tsRej = insRej.rows[0].tsnumber;
    testIds.push(tsRej);

    const inpRes = await client.query(`
      INSERT INTO public.timesheet_etl_input (
        run_id, plant, source_tsnumber, source_hash, allocation_version,
        serialnumber, longdate_checkin, longdate_checkout, raw_seconds, local_date_checkin,
        raw_snapshot, status
      ) VALUES
      ($1::uuid, '5100', $2, 'hash-part-1', 'ALLOC-V1', $3, '2026-09-20 08:00:00+07', '2026-09-20 12:00:00+07', 14400, '2026-09-20', '{}'::jsonb, 'SAP_READY')
      RETURNING input_id
    `, [testRunId, tsRej, TEST_PARTIAL_SN]);

    const inputId = inpRes.rows[0].input_id;

    await client.query(`
      INSERT INTO public.timesheet_sap_ready (
        run_id, input_id, plant, source_tsnumber, source_version, allocation_version, ready_rule_version,
        local_date, segment_sequence, source_key, payload,
        raw_seconds, cleaned_seconds, allocated_seconds, sap_effective_seconds, status
      ) VALUES
      ($1::uuid, $2::uuid, '5100', $3::int, 'v1', 'ALLOC-V1', 'READY-V1', '2026-09-20', 1, $4, '{"ZTIMESHEETID": "TP1"}'::jsonb, 14400, 14400, 14400, 14400, 'SAP_READY')
      ON CONFLICT (source_key) DO UPDATE SET status = 'SAP_READY'
    `, [testRunId, inputId, tsRej, `TIMESHEET:5100:${tsRej}:v1`]);

    // 1a. partialUpdate payroll/state_flag tanpa actor header harus ditolak 400 ACTOR_REQUIRED
    const reqRejNoActor = {
      params: { id: String(tsRej), tsnumber: String(tsRej) },
      body: {
        state_flag: "3",
        actor: "untrusted_body_actor",
        reason: "Rejecting without valid header",
      },
      header: () => null,
    };
    const resRejNoActor = mockRes();
    await partialUpdate(reqRejNoActor, resRejNoActor);
    assert.equal(resRejNoActor.statusCode, 400, "partialUpdate tanpa header actor harus ditolak 400");
    assert.equal(resRejNoActor.body.code, "ACTOR_REQUIRED");

    // 1b. Jalankan partialUpdate reject dengan header tepercaya
    const reqRej = mockReq({
      tsnumber: tsRej,
      body: {
        state_flag: "3",
        reason: "Rejecting: wrong operation booked",
      },
      actor: "supervisor_budi",
    });
    const resRej = mockRes();

    await partialUpdate(reqRej, resRej);

    assert.equal(resRej.statusCode, 200, "partialUpdate reject harus 200");
    assert.equal(String(resRej.body.data.state_flag), "3");

    // Verifikasi DB & audit
    const checkRej = await client.query(`SELECT state_flag FROM public.timesheet_transaction WHERE tsnumber = $1`, [tsRej]);
    assert.equal(String(checkRej.rows[0].state_flag), "3");

    const auditRej = await client.query(
      `SELECT actor, reason, channel FROM public.timesheet_correction_audit WHERE tsnumber = $1 ORDER BY id DESC LIMIT 1`,
      [tsRej]
    );
    assert.equal(auditRej.rows[0].actor, "supervisor_budi");
    assert.equal(auditRej.rows[0].reason, "Rejecting: wrong operation booked");
    assert.equal(auditRej.rows[0].channel, "partial_update");

    // Verifikasi pipeline terinvalidasi
    const inpRej = await client.query(`SELECT status FROM public.timesheet_etl_input WHERE source_tsnumber = $1`, [tsRej]);
    assert.equal(inpRej.rows[0].status, "INVALIDATED");

    const rdyRej = await client.query(`SELECT status FROM public.timesheet_sap_ready WHERE source_tsnumber = $1`, [tsRej]);
    assert.equal(rdyRej.rows[0].status, "INVALIDATED");

    // 2. Perubahan workcentercode pada pre-publish record
    const reqWc = mockReq({
      tsnumber: tsRej,
      body: {
        workcentercode: "FAB-02",
        reason: "Moving workcenter from FAB-01 to FAB-02",
      },
      actor: "admin_charlie",
    });
    const resWc = mockRes();

    await partialUpdate(reqWc, resWc);

    assert.equal(resWc.statusCode, 200, "partialUpdate workcentercode harus 200");
    assert.equal(resWc.body.data.workcentercode, "FAB-02");

    // 3. Reject / update payroll pada FROZEN record ditolak 409
    const insFroz = await client.query(`
      INSERT INTO public.timesheet_transaction (
        plant, serialnumber, order_no, operation_no, workcentercode,
        longdate_checkin, longdate_checkout, duration,
        state_flag, validation_date, note
      ) VALUES
      ('5100', $1, '100091', '0020', 'FAB-01',
       '2026-09-20 13:00:00+07', '2026-09-20 17:00:00+07', 4.0,
       '2', now(), 'Frozen record')
      RETURNING tsnumber
    `, [TEST_PARTIAL_SN]);

    const tsFroz = insFroz.rows[0].tsnumber;
    testIds.push(tsFroz);

    await client.query(`
      INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, note)
      VALUES ($1, '5100', 'POSTED', 'test freeze for partial update')
      ON CONFLICT (tsnumber) DO NOTHING
    `, [tsFroz]);

    const reqFrozRej = mockReq({
      tsnumber: tsFroz,
      body: {
        state_flag: "3",
        reason: "Attempt reject on posted record",
      },
      actor: "supervisor_budi",
    });
    const resFrozRej = mockRes();

    await partialUpdate(reqFrozRej, resFrozRej);

    assert.equal(resFrozRej.statusCode, 409, "partialUpdate state_flag pada frozen harus 409");
    assert.equal(resFrozRej.body.code, "TIMESHEET_FROZEN");

    // 4. Update non-payroll (note) pada frozen record tetap diizinkan
    const reqFrozNote = mockReq({
      tsnumber: tsFroz,
      body: {
        note: "Updated informational note on posted record",
      },
    });
    const resFrozNote = mockRes();

    await partialUpdate(reqFrozNote, resFrozNote);

    assert.equal(resFrozNote.statusCode, 200, "partialUpdate note pada frozen harus 200");
    assert.equal(resFrozNote.body.data.note, "Updated informational note on posted record");

  } finally {
    await client.query("SET mps.correction_actor = 'cleanup_actor'");
    await client.query("SET mps.correction_reason = 'cleanup_test'");
    if (testIds.length > 0) {
      await client.query("DELETE FROM public.timesheet_staging_freeze WHERE tsnumber = ANY($1::int[])", [testIds]);
      await client.query("DELETE FROM public.timesheet_sap_ready WHERE source_tsnumber = ANY($1::int[])", [testIds]);
      await client.query("DELETE FROM public.timesheet_etl_input WHERE source_tsnumber = ANY($1::int[])", [testIds]);
      await client.query("DELETE FROM public.timesheet_transaction WHERE tsnumber = ANY($1::int[])", [testIds]);
    }
    await client.query("DELETE FROM public.timesheet_transaction WHERE serialnumber = $1", [TEST_PARTIAL_SN]);
    await client.query("DELETE FROM public.timesheet_etl_run WHERE run_id = $1::uuid", [testRunId]);
    await client.query("DELETE FROM public.usernfc WHERE snssb = $1", [TEST_PARTIAL_SN]);
    client.release();
  }
});

test.after(async () => {
  await pool.end();
});

