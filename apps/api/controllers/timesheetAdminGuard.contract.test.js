"use strict";

/**
 * Kontrak koreksi admin timesheet (review P1 #7-#11).
 *
 * Diuji lebih dulu (RED) sebelum timesheetAdminGuard.js ada.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PARTIAL_UPDATE_ALLOWED_FIELDS,
  PAYROLL_FIELDS,
  isPayrollField,
  assertCorrectionAllowed,
  buildAuditEntry,
  mapDbErrorToHttp,
  assertPlantMatches,
  CorrectionError,
} = require("./timesheetAdminGuard");

// assert.throws() mengembalikan undefined di Node, jadi error ditangkap manual
// ketika kita perlu memeriksa .status — bukan sekadar bahwa ia melempar.
function grab(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("diharapkan melempar, tapi tidak");
}


// ---------- #8 kolom turunan keluar dari allowedFields ----------

test("P1#8 partialUpdate tidak boleh menerima kolom waktu turunan", () => {
  for (const f of ["date_checkin", "hour_checkin", "date_checkout", "hour_checkout"]) {
    assert.ok(
      !PARTIAL_UPDATE_ALLOWED_FIELDS.includes(f),
      `${f} masih ada di allowedFields — trigger yang harus menurunkannya`
    );
  }
});

test("P1#8 field non-waktu tetap boleh lewat partialUpdate", () => {
  for (const f of ["note", "state_flag", "std_foreman_hours", "planhours", "workcentercode"]) {
    assert.ok(PARTIAL_UPDATE_ALLOWED_FIELDS.includes(f), `${f} hilang dari allowedFields`);
  }
});

// ---------- #9 updateadmin hanya menulis longdate_* ----------

test("P1#9 longdate_* dikenali sebagai field payroll", () => {
  assert.ok(isPayrollField("longdate_checkin"));
  assert.ok(isPayrollField("longdate_checkout"));
  assert.ok(PAYROLL_FIELDS.includes("longdate_checkin"));
});

test("P1#9 kolom turunan juga payroll (tidak boleh ditulis manual)", () => {
  assert.ok(isPayrollField("date_checkin"));
  assert.ok(isPayrollField("hour_checkout"));
});

test("Work E: master dan identifikasi order adalah field payroll", () => {
  assert.ok(isPayrollField("serialnumber"));
  assert.ok(isPayrollField("order_no"));
  assert.ok(isPayrollField("operation_no"));
  assert.ok(isPayrollField("plant"));
  assert.ok(isPayrollField("workcentercode"));
  assert.ok(isPayrollField("activitytype"));
  assert.ok(isPayrollField("confirmationnumber"));
  assert.ok(isPayrollField("state_flag"));
  assert.ok(isPayrollField("duration"));
});

test("P1#9 note dan workcenterdescription bukan payroll", () => {
  assert.ok(!isPayrollField("note"));
  assert.ok(!isPayrollField("workcenterdescription"));
});

// ---------- #7 reason dan actor wajib ----------

test("P1#7 koreksi payroll tanpa reason ditolak 400", () => {
  const err = grab(() =>assertCorrectionAllowed({
        changedFields: ["longdate_checkout"],
        actor: "admin1",
        reason: "   ",
        frozen: false,
      }));
  assert.ok(err instanceof CorrectionError);
  assert.equal(err.status, 400);
  assert.match(err.message, /reason/i);
});

test("P1#7 koreksi payroll tanpa actor ditolak 400", () => {
  const err = grab(() =>assertCorrectionAllowed({
        changedFields: ["longdate_checkout"],
        actor: null,
        reason: "salah tapping",
        frozen: false,
      }));
  assert.ok(err instanceof CorrectionError);
  assert.equal(err.status, 400);
  assert.match(err.message, /actor|user/i);
});

test("P1#7 perubahan non-payroll tidak mewajibkan reason", () => {
  assert.doesNotThrow(() =>
    assertCorrectionAllowed({
      changedFields: ["note"],
      actor: null,
      reason: null,
      frozen: false,
    })
  );
});

// ---------- #10 blok setelah staging, 409 bukan 500 ----------

test("P1#10 koreksi payroll pada record frozen ditolak 409", () => {
  const err = grab(() =>assertCorrectionAllowed({
        changedFields: ["longdate_checkout"],
        actor: "admin1",
        reason: "salah tapping",
        frozen: true,
      }));
  assert.ok(err instanceof CorrectionError);
  assert.equal(err.status, 409);
  assert.match(err.message, /staging|terkunci|frozen/i);
});

test("P1#10 field non-payroll tetap boleh pada record frozen", () => {
  assert.doesNotThrow(() =>
    assertCorrectionAllowed({
      changedFields: ["note"],
      actor: "admin1",
      reason: null,
      frozen: true,
    })
  );
});

test("P1#10 DELETE record frozen ditolak 409", () => {
  const err = grab(() =>assertCorrectionAllowed({ isDelete: true, actor: "admin1", reason: "x", frozen: true }));
  assert.ok(err instanceof CorrectionError);
  assert.equal(err.status, 409);
});

test("P1#10 DELETE record belum staging tetap boleh", () => {
  assert.doesNotThrow(() =>
    assertCorrectionAllowed({ isDelete: true, actor: "admin1", reason: "x", frozen: false })
  );
});

test("Work E: DELETE record tanpa actor ditolak 400", () => {
  const err = grab(() =>
    assertCorrectionAllowed({ isDelete: true, actor: null, reason: "x", frozen: false })
  );
  assert.ok(err instanceof CorrectionError);
  assert.equal(err.status, 400);
  assert.equal(err.code, "ACTOR_REQUIRED");
});

test("Work E: DELETE record tanpa reason ditolak 400", () => {
  const err = grab(() =>
    assertCorrectionAllowed({ isDelete: true, actor: "admin1", reason: "   ", frozen: false })
  );
  assert.ok(err instanceof CorrectionError);
  assert.equal(err.status, 400);
  assert.equal(err.code, "REASON_REQUIRED");
});

// ---------- #10 error DB freeze dipetakan ke 409, bukan 500 ----------

test("P1#10 pelanggaran guard freeze dari DB menjadi 409", () => {
  const mapped = mapDbErrorToHttp({
    code: "23514",
    message: "timesheet 204 terkunci: sudah masuk staging SAP",
  });
  assert.equal(mapped.status, 409);
  assert.match(mapped.body.error, /terkunci/i);
});

test("P1#10 error DB lain tetap 500", () => {
  const mapped = mapDbErrorToHttp({ code: "42601", message: "syntax error" });
  assert.equal(mapped.status, 500);
});

// ---------- #11 validasi plant, bukan hanya timezone ----------

test("P1#11 plant record berbeda dari plant_config ditolak 409", () => {
  const err = grab(() =>assertPlantMatches({ rowPlant: "5051", configPlant: "5100" }));
  assert.ok(err instanceof CorrectionError);
  assert.equal(err.status, 409);
  assert.match(err.message, /plant/i);
});

test("P1#11 plant cocok diterima", () => {
  assert.doesNotThrow(() => assertPlantMatches({ rowPlant: "5100", configPlant: "5100" }));
});

test("P1#11 plant kosong pada record ditolak (fail-closed)", () => {
  assert.throws(() => assertPlantMatches({ rowPlant: null, configPlant: "5100" }), CorrectionError);
});

// ---------- #7 entri audit before/after ----------

test("P1#7 entri audit memuat before/after hanya untuk field yang berubah", () => {
  const entry = buildAuditEntry({
    tsnumber: 204,
    plant: "5100",
    actor: "admin1",
    reason: "salah tapping",
    channel: "updateadmin",
    before: { longdate_checkout: "2026-09-20T12:00:00Z", note: "a", order_no: "O1" },
    after: { longdate_checkout: "2026-09-20T13:00:00Z", note: "a", order_no: "O1" },
  });

  assert.equal(entry.tsnumber, 204);
  assert.equal(entry.actor, "admin1");
  assert.equal(entry.reason, "salah tapping");
  assert.deepEqual(Object.keys(entry.before_row), ["longdate_checkout"]);
  assert.deepEqual(Object.keys(entry.after_row), ["longdate_checkout"]);
  assert.equal(entry.before_row.longdate_checkout, "2026-09-20T12:00:00Z");
  assert.equal(entry.after_row.longdate_checkout, "2026-09-20T13:00:00Z");
});

test("P1#7 tanpa perubahan nyata, entri audit null (tidak mencatat no-op)", () => {
  const entry = buildAuditEntry({
    tsnumber: 204,
    plant: "5100",
    actor: "admin1",
    reason: "x",
    channel: "updateadmin",
    before: { note: "a" },
    after: { note: "a" },
  });
  assert.equal(entry, null);
});

// ---------- actorFromRequest: Trusted identity resolution ----------

const { actorFromRequest } = require("./timesheetAdminGuard");

test("actorFromRequest: mengekstrak actor dari header x-user-name", () => {
  const req = { header: (k) => (k.toLowerCase() === "x-user-name" ? "spv_john" : null) };
  assert.equal(actorFromRequest(req), "spv_john");
});

test("actorFromRequest: fallback ke header x-user-id jika x-user-name kosong", () => {
  const req = { header: (k) => (k.toLowerCase() === "x-user-id" ? "1042" : null) };
  assert.equal(actorFromRequest(req), "1042");
});

test("actorFromRequest: fallback ke req.user jika headers kosong", () => {
  const req = { header: () => null, user: { username: "foreman_budi" } };
  assert.equal(actorFromRequest(req), "foreman_budi");
});

test("actorFromRequest: mengabaikan actor yang dikirim di body (untrusted)", () => {
  const req = { header: () => null, body: { actor: "malicious_spoof" } };
  assert.equal(actorFromRequest(req), null, "Actor di request body tidak boleh dipercaya");
});

test("actorFromRequest: mengembalikan null jika tidak ada identitas sama sekali", () => {
  const req = { header: () => null };
  assert.equal(actorFromRequest(req), null);
  assert.equal(actorFromRequest(null), null);
});