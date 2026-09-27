"use strict";

/**
 * Guard koreksi admin timesheet (review P1 #7-#11).
 *
 * Kenapa modul terpisah: aturan ini dipakai tiga endpoint (updateTimesheetadmin,
 * partialUpdate, remove). Menyalinnya bertiga kali sudah pernah membuat mereka
 * menyimpang — folder migrations pun sempat menjalankan file test karena aturan
 * "apa yang boleh ada di sini" tidak pernah ditulis di satu tempat.
 *
 * Pembagian tanggung jawab dengan DB:
 *   - DB = kebenaran terakhir (trigger freeze menolak apa pun yang lolos).
 *   - Modul ini = pesan bisnis yang enak dibaca + memastikan audit tertulis
 *     dalam transaksi yang sama. Tanpa lapisan ini, pelanggaran freeze muncul
 *     sebagai 500 "syntax-ish" ke user, bukan 409 yang bisa ditindaklanjuti.
 */

class CorrectionError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "CorrectionError";
    this.status = status;
    this.code = code || null;
  }
}

/**
 * Kolom yang MENENTUKAN UPAH. Empat kolom turunan ikut di sini bukan karena
 * aplikasi menulisnya, tapi supaya percobaan menulisnya tetap terdeteksi
 * sebagai perubahan payroll (trigger DB yang menurunkannya dari longdate_*).
 */
const PAYROLL_FIELDS = Object.freeze([
  "serialnumber",
  "plant",
  "order_no",
  "operation_no",
  "workcentercode",
  "activitytype",
  "confirmationnumber",
  "state_flag",
  "longdate_checkin",
  "longdate_checkout",
  "date_checkin",
  "hour_checkin",
  "date_checkout",
  "hour_checkout",
  "duration",
]);

/**
 * #8: empat kolom turunan SENGAJA tidak ada di sini. Sebelumnya ada, sehingga
 * admin bisa menulis hour_checkout tanpa menyentuh longdate_checkout — jam
 * tampilan bergerak, jam yang dikirim ke SAP tidak. Itu persis mode
 * salah-diam yang dihapus oleh migration kontrak waktu turunan.
 */
const PARTIAL_UPDATE_ALLOWED_FIELDS = Object.freeze([
  "note",
  "state_flag",
  "std_foreman_hours",
  "planhours",
  "workcentercode",
  "workcenterdescription",
]);

const isPayrollField = (field) => PAYROLL_FIELDS.includes(field);

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

/**
 * #7 + #10. Urutan pemeriksaan disengaja: freeze diperiksa SEBELUM reason,
 * supaya record terkunci menjawab 409 "sudah staging" dan bukan 400 "reason
 * wajib" — menyuruh user melengkapi alasan untuk perubahan yang tidak akan
 * pernah diterima adalah jalan buntu.
 */
function assertCorrectionAllowed({
  changedFields = [],
  actor,
  reason,
  frozen = false,
  isDelete = false,
}) {
  const touchesPayroll = isDelete || changedFields.some(isPayrollField);

  if (!touchesPayroll) return;

  if (frozen) {
    throw new CorrectionError(
      409,
      isDelete
        ? "Record sudah masuk staging SAP dan terkunci permanen: tidak bisa dihapus. Pakai jalur koreksi SAP."
        : "Record sudah masuk staging SAP dan terkunci permanen: jam tidak bisa diubah. Pakai jalur koreksi SAP.",
      "TIMESHEET_FROZEN"
    );
  }

  if (isBlank(actor)) {
    throw new CorrectionError(
      400,
      "Koreksi jam wajib menyertakan identitas user (header x-user-name / x-user-id).",
      "ACTOR_REQUIRED"
    );
  }

  if (isBlank(reason)) {
    throw new CorrectionError(
      400,
      "Koreksi jam wajib menyertakan reason.",
      "REASON_REQUIRED"
    );
  }
}

/**
 * #11. Timezone saja tidak cukup: kedua plant bisa berbagi timezone, sehingga
 * record plant lain akan lolos dan dihitung dengan konfigurasi yang salah.
 * Fail-closed saat plant record kosong — tidak menebak.
 */
function assertPlantMatches({ rowPlant, configPlant }) {
  if (isBlank(rowPlant)) {
    throw new CorrectionError(
      409,
      "Record tidak punya plant: tidak bisa divalidasi terhadap plant_config.",
      "PLANT_MISSING"
    );
  }
  if (isBlank(configPlant)) {
    throw new CorrectionError(
      409,
      "plant_config tidak punya plant_code: konfigurasi instance belum benar.",
      "PLANT_CONFIG_MISSING"
    );
  }
  if (String(rowPlant).trim() !== String(configPlant).trim()) {
    throw new CorrectionError(
      409,
      `Record milik plant ${rowPlant}, instance ini plant ${configPlant}.`,
      "PLANT_MISMATCH"
    );
  }
}

/**
 * #7. Hanya field yang BERUBAH yang masuk ledger. Menyimpan seluruh row
 * membuat ledger sulit dibaca dan menyembunyikan koreksi nyata di antara
 * puluhan kolom yang tidak bergerak.
 *
 * Mengembalikan null saat tidak ada perubahan nyata: no-op tidak layak
 * dicatat sebagai koreksi.
 */
function buildAuditEntry({ tsnumber, plant, actor, reason, channel, before, after }) {
  const beforeRow = {};
  const afterRow = {};

  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    const b = before ? before[k] : undefined;
    const a = after ? after[k] : undefined;
    const bs = b instanceof Date ? b.toISOString() : b;
    const as = a instanceof Date ? a.toISOString() : a;
    if (String(bs ?? "") !== String(as ?? "")) {
      beforeRow[k] = bs ?? null;
      afterRow[k] = as ?? null;
    }
  }

  if (Object.keys(afterRow).length === 0) return null;

  return {
    tsnumber,
    plant: plant ?? null,
    actor: actor ?? null,
    reason: reason ?? null,
    channel: channel ?? null,
    before_row: beforeRow,
    after_row: afterRow,
  };
}

/**
 * #10. Trigger freeze memakai RAISE EXCEPTION dengan SQLSTATE check_violation
 * (23514) / integrity_constraint_violation (klas 23). Tanpa pemetaan ini user
 * menerima 500 dan mengira sistemnya rusak, padahal aturan bisnis bekerja.
 */
function mapDbErrorToHttp(err) {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  const isFreeze =
    code.startsWith("23") && /terkunci|staging|frozen|append-only|tidak bisa dihapus/i.test(msg);

  if (isFreeze) {
    return { status: 409, body: { error: msg, code: "TIMESHEET_FROZEN" } };
  }
  return { status: 500, body: { error: msg } };
}

/** Helper actor seragam untuk endpoint timesheet (hanya sumber tepercaya). */
const actorFromRequest = (req) => {
  if (!req) return null;
  const headerName = typeof req.header === "function" ? req.header("x-user-name") : req.headers?.["x-user-name"];
  const headerId = typeof req.header === "function" ? req.header("x-user-id") : req.headers?.["x-user-id"];
  const user = req.user?.username || req.user?.name || req.user?.id || null;
  const raw = headerName || headerId || user || null;
  return raw ? String(raw).trim() || null : null;
};

module.exports = {
  CorrectionError,
  PAYROLL_FIELDS,
  PARTIAL_UPDATE_ALLOWED_FIELDS,
  isPayrollField,
  assertCorrectionAllowed,
  assertPlantMatches,
  buildAuditEntry,
  mapDbErrorToHttp,
  actorFromRequest,
};
