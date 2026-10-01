"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  isValidIsoDate,
  parseTimeToMinutes,
  normalizeTime,
  daysDifferenceInclusive,
  validateDateRangePayload,
  validateReason,
  buildIntervalMinutes,
  checkIntervalsForOverlap,
  computePreviewToken,
  ShiftOverrideError,
} = require("./ewsShiftOverrideService");

describe("ewsShiftOverrideService — Pure Units", () => {
  describe("isValidIsoDate", () => {
    it("menerima format ISO valid dan tanggal nyata", () => {
      assert.equal(isValidIsoDate("2026-10-01"), true);
      assert.equal(isValidIsoDate("2024-02-29"), true); // kabisat
    });

    it("menolak tanggal tidak nyata atau format salah", () => {
      assert.equal(isValidIsoDate("2026-02-29"), false); // bukan kabisat
      assert.equal(isValidIsoDate("2026-02-30"), false);
      assert.equal(isValidIsoDate("2026-13-01"), false);
      assert.equal(isValidIsoDate("2026/10/01"), false);
      assert.equal(isValidIsoDate("invalid"), false);
    });
  });

  describe("Time parsing & normalizing", () => {
    it("normalisasi jam format HH:MM ke HH:MM:00", () => {
      assert.equal(normalizeTime("07:25"), "07:25:00");
      assert.equal(normalizeTime("16:30"), "16:30:00");
      assert.equal(normalizeTime("00:00"), "00:00:00");
    });

    it("menolak jam invalid", () => {
      assert.equal(normalizeTime("24:00"), null);
      assert.equal(normalizeTime("7:00"), null);
      assert.equal(normalizeTime("23:60"), null);
      assert.equal(normalizeTime("99:99"), null);
    });

    it("menghitung menit dalam hari", () => {
      assert.equal(parseTimeToMinutes("00:00:00"), 0);
      assert.equal(parseTimeToMinutes("07:25:00"), 445);
      assert.equal(parseTimeToMinutes("23:59:00"), 1439);
    });
  });

  describe("Rentang hari", () => {
    it("menghitung selisih inklusif", () => {
      assert.equal(daysDifferenceInclusive("2026-10-01", "2026-10-01"), 1);
      assert.equal(daysDifferenceInclusive("2026-10-01", "2026-10-03"), 3);
      assert.equal(daysDifferenceInclusive("2026-10-01", "2026-11-01"), 32);
    });
  });

  describe("validateDateRangePayload", () => {
    const validBase = {
      from: "2026-10-01",
      to: "2026-10-03",
      shifts: [
        {
          shift_code: "DAY",
          start_time: "07:00",
          end_time: "15:00",
          crosses_midnight: false,
          standard_hours: 7.5,
        },
      ],
    };

    it("menerima payload yang valid", () => {
      const res = validateDateRangePayload(validBase);
      assert.equal(res.from, "2026-10-01");
      assert.equal(res.to, "2026-10-03");
      assert.equal(res.shifts.length, 1);
      assert.equal(res.shifts[0].start_time, "07:00:00");
      assert.equal(res.shifts[0].end_time, "15:00:00");
      assert.equal(res.shifts[0].span_minutes, 480);
      assert.equal(res.shifts[0].standard_hours, 7.5);
    });

    it("menerima rentang 62 hari", () => {
      const payload = {
        ...validBase,
        from: "2026-10-01",
        to: "2026-12-01", // 62 hari inklusif (31 hari Okt + 30 hari Nov + 1 Des = 62)
      };
      assert.doesNotThrow(() => validateDateRangePayload(payload));
    });

    it("menolak rentang 63 hari dengan RANGE_TOO_LONG", () => {
      const payload = {
        ...validBase,
        from: "2026-10-01",
        to: "2026-12-02", // 63 hari
      };
      assert.throws(
        () => validateDateRangePayload(payload),
        (err) => err instanceof ShiftOverrideError && err.code === "RANGE_TOO_LONG"
      );
    });

    it("menolak to < from dengan RANGE_INVALID", () => {
      const payload = {
        ...validBase,
        from: "2026-10-05",
        to: "2026-10-02",
      };
      assert.throws(
        () => validateDateRangePayload(payload),
        (err) => err instanceof ShiftOverrideError && err.code === "RANGE_INVALID"
      );
    });

    it("menolak crosses_midnight non-boolean ketat", () => {
      const payload = {
        ...validBase,
        shifts: [{ ...validBase.shifts[0], crosses_midnight: "false" }],
      };
      assert.throws(
        () => validateDateRangePayload(payload),
        (err) => err instanceof ShiftOverrideError && err.code === "INVALID_SPAN"
      );
    });

    it("menolak span inkonsisten dengan crosses_midnight", () => {
      // crosses_midnight false tetapi end < start
      const payload1 = {
        ...validBase,
        shifts: [{ ...validBase.shifts[0], start_time: "16:00", end_time: "08:00", crosses_midnight: false }],
      };
      assert.throws(
        () => validateDateRangePayload(payload1),
        (err) => err instanceof ShiftOverrideError && err.code === "INVALID_SPAN"
      );

      // crosses_midnight true tetapi end > start
      const payload2 = {
        ...validBase,
        shifts: [{ ...validBase.shifts[0], start_time: "08:00", end_time: "16:00", crosses_midnight: true }],
      };
      assert.throws(
        () => validateDateRangePayload(payload2),
        (err) => err instanceof ShiftOverrideError && err.code === "INVALID_SPAN"
      );
    });

    it("menolak standard_hours melebihi span", () => {
      // span 8 jam (480 menit), standard_hours 8.5 jam (510 menit)
      const payload = {
        ...validBase,
        shifts: [{ ...validBase.shifts[0], start_time: "08:00", end_time: "16:00", crosses_midnight: false, standard_hours: 8.5 }],
      };
      assert.throws(
        () => validateDateRangePayload(payload),
        (err) => err instanceof ShiftOverrideError && err.code === "STANDARD_EXCEEDS_SPAN"
      );
    });

    it("menolak duplikat kode shift", () => {
      const payload = {
        ...validBase,
        shifts: [
          validBase.shifts[0],
          { ...validBase.shifts[0], standard_hours: 6 },
        ],
      };
      assert.throws(
        () => validateDateRangePayload(payload),
        (err) => err instanceof ShiftOverrideError && err.code === "INVALID_SHIFTS"
      );
    });
  });

  describe("Aljabar interval dan overlap toleransi 0 menit", () => {
    const anchor = "2026-09-30";

    it("shift yang bersentuhan tepat [07:00-16:00) dan [16:00-23:00) TIDAK overlap", () => {
      const day = buildIntervalMinutes(anchor, "2026-10-01", "07:00:00", false, 9 * 60);
      const night = buildIntervalMinutes(anchor, "2026-10-01", "16:00:00", false, 7 * 60);

      const res = checkIntervalsForOverlap([
        { code: "DAY", date: "2026-10-01", ...day },
        { code: "NIGHT", date: "2026-10-01", ...night },
      ]);
      assert.equal(res.conflict, false);
    });

    it("NIGHT D-1 melewati tengah malam [20:00-05:00(+1)) overlap dengan DAY D [04:30-14:00)", () => {
      const nightDMinus1 = buildIntervalMinutes(anchor, "2026-10-01", "20:00:00", true, 9 * 60);
      const dayD = buildIntervalMinutes(anchor, "2026-10-02", "04:30:00", false, 9 * 60 + 30);

      const res = checkIntervalsForOverlap([
        { code: "NIGHT", date: "2026-10-01", ...nightDMinus1 },
        { code: "DAY", date: "2026-10-02", ...dayD },
      ]);
      assert.equal(res.conflict, true);
    });

    it("NIGHT D melewati tengah malam [22:00-08:00(+1)) overlap dengan DAY D+1 [07:00-16:00)", () => {
      const nightD = buildIntervalMinutes(anchor, "2026-10-01", "22:00:00", true, 10 * 60);
      const dayDPlus1 = buildIntervalMinutes(anchor, "2026-10-02", "07:00:00", false, 9 * 60);

      const res = checkIntervalsForOverlap([
        { code: "NIGHT", date: "2026-10-01", ...nightD },
        { code: "DAY", date: "2026-10-02", ...dayDPlus1 },
      ]);
      assert.equal(res.conflict, true);
    });
  });

  describe("validateReason", () => {
    it("validasi alasan untuk hari ini (wajib minimal 10 karakter)", () => {
      assert.throws(
        () => validateReason("pendek", true),
        (err) => err instanceof ShiftOverrideError && err.code === "REASON_REQUIRED"
      );
      assert.equal(validateReason("Pemadaman listrik terjadwal PLN", true), "Pemadaman listrik terjadwal PLN");
    });

    it("menolak alasan lebih dari 200 karakter", () => {
      assert.throws(
        () => validateReason("a".repeat(201), false),
        (err) => err instanceof ShiftOverrideError && err.code === "REASON_TOO_LONG"
      );
    });
  });

  describe("computePreviewToken", () => {
    it("menghasilkan hash sha256 deterministik", () => {
      const p = {
        from: "2026-10-01",
        to: "2026-10-02",
        shifts: [{ shift_code: "DAY", start_time: "08:00:00", end_time: "17:00:00", crosses_midnight: false, standard_hours: 8 }],
      };
      const s = [
        { id: 1, shift_code: "SHIFT-1", roster_shift_code: "DAY", is_default: true, start_time: "08:00:00", end_time: "17:00:00" },
      ];
      const tok1 = computePreviewToken(p, s);
      const tok2 = computePreviewToken(p, s);
      assert.equal(tok1.startsWith("sha256:"), true);
      assert.equal(tok1, tok2);
    });
  });

  describe("computeDeletePreviewToken & validateDeleteFallbackNoOverlap (Blocker #3)", () => {
    const { computeDeletePreviewToken, validateDeleteFallbackNoOverlap } = require("./ewsShiftOverrideService");

    it("computeDeletePreviewToken menghasilkan token kanonikal untuk DELETE_OVERRIDE", () => {
      const row = { id: 42, effective_date: "2026-10-15", roster_shift_code: "DAY", shift_code: "SHIFT-1" };
      const state = [
        { id: 1, shift_code: "SHIFT-1", roster_shift_code: "DAY", is_default: true, start_time: "07:00:00", end_time: "15:00:00" },
        { id: 42, shift_code: "SHIFT-1", roster_shift_code: "DAY", effective_date: "2026-10-15", is_default: false, is_active: true, start_time: "08:00:00", end_time: "16:00:00" },
      ];
      const token1 = computeDeletePreviewToken(row, state, "2026-10-15");
      const token2 = computeDeletePreviewToken(row, state, "2026-10-15");
      const tokenDiffDate = computeDeletePreviewToken({ ...row, effective_date: "2026-10-16" }, state, "2026-10-15");

      assert.strictEqual(token1, token2);
      assert.match(token1, /^sha256:[a-f0-9]{64}$/);
      assert.notStrictEqual(token1, tokenDiffDate);
    });

    it("validateDeleteFallbackNoOverlap mendeteksi overlap jika fallback default bertabrakan", () => {
      const defaults = [
        { id: 1, roster_shift_code: "DAY", start_time: "07:00:00", end_time: "16:00:00", crosses_midnight: false },
        { id: 2, roster_shift_code: "NIGHT", start_time: "16:00:00", end_time: "00:00:00", crosses_midnight: false },
      ];
      const overrides = [
        { id: 10, roster_shift_code: "DAY", effective_date: "2026-10-20", is_active: true, start_time: "07:00:00", end_time: "15:00:00", crosses_midnight: false },
        { id: 11, roster_shift_code: "NIGHT", effective_date: "2026-10-20", is_active: true, start_time: "15:00:00", end_time: "23:00:00", crosses_midnight: false },
      ];
      const rowToDelete = overrides[0]; // hapus DAY

      assert.throws(
        () => validateDeleteFallbackNoOverlap(rowToDelete, defaults, overrides),
        (err) => {
          assert.strictEqual(err.code, "OVERLAP_CONFLICT");
          return true;
        }
      );
    });
  });

  describe("ewsAuthGuard — Identity & RBAC", () => {
    const { authenticateAndAuthorizeActor } = require("./ewsAuthGuard");

    it("authenticateAndAuthorizeActor menolak request tanpa identitas aktor (fail closed)", async () => {
      const fakeClient = { query: async () => ({ rows: [] }) };
      const unauthenticatedReq = { headers: {} };

      await assert.rejects(
        async () => authenticateAndAuthorizeActor(fakeClient, unauthenticatedReq),
        (err) => {
          assert.strictEqual(err.status, 401);
          assert.strictEqual(err.code, "AUTHENTICATION_REQUIRED");
          return true;
        }
      );
    });

    it("authenticateAndAuthorizeActor mengambil nama & role dari server DB dan memeriksa RBAC", async () => {
      const authenticatedReq = {
        headers: {
          "x-user-id": "42",
          "x-user-name": "SpoofedClientName",
          "x-user-role": "superadmin_fake",
        },
      };

      const fakeClient = {
        query: async (sql) => {
          if (sql.includes("FROM public.users")) {
            return {
              rows: [
                {
                  id: 42,
                  username: "real_planner",
                  name: "Real Planner Server",
                  role: "planner",
                },
              ],
            };
          }
          return { rows: [] };
        },
      };

      const actor = await authenticateAndAuthorizeActor(fakeClient, authenticatedReq);
      // Nama dan role HARUS dari server, BUKAN dari spoofed headers!
      assert.strictEqual(actor.id, "42");
      assert.strictEqual(actor.name, "Real Planner Server");
      assert.strictEqual(actor.role, "planner");
      assert.notStrictEqual(actor.name, "SpoofedClientName");
      assert.notStrictEqual(actor.role, "superadmin_fake");
    });
  });
});
