"use strict";

const crypto = require("crypto");
const { resolveTimezone } = require("../config/timezone");
const { authenticateAndAuthorizeActor } = require("./ewsAuthGuard");
const { ShiftOverrideError } = require("./shiftOverrideError");

const ISO_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const MAX_RANGE_DAYS = 62;
const ROSTER_SHIFT_CODES = Object.freeze(["DAY", "NIGHT"]);

/**
 * Validasi tanggal format ISO YYYY-MM-DD dengan round-trip check kalender.
 */
function isValidIsoDate(str) {
  if (typeof str !== "string" || !ISO_DATE_REGEX.test(str)) return false;
  const [y, m, d] = str.split("-").map((v) => parseInt(v, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function parseTimeToMinutes(timeStr) {
  const m = String(timeStr || "").trim().match(TIME_REGEX);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  return hh * 60 + mm;
}

function normalizeTime(timeStr) {
  const m = String(timeStr || "").trim().match(TIME_REGEX);
  if (!m) return null;
  const hh = String(m[1]).padStart(2, "0");
  const mm = String(m[2]).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

function addDaysToIso(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function daysDifferenceInclusive(fromIso, toIso) {
  const [y1, m1, d1] = fromIso.split("-").map(Number);
  const [y2, m2, d2] = toIso.split("-").map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  const diffDays = Math.round((t2 - t1) / 86400000);
  return diffDays + 1;
}

function enumerateDatesInclusive(fromIso, toIso) {
  const list = [];
  let cur = fromIso;
  while (cur <= toIso) {
    list.push(cur);
    cur = addDaysToIso(cur, 1);
  }
  return list;
}

/**
 * Validasi payload dasar per spesifikasi §6.1
 */
function validateDateRangePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new ShiftOverrideError(400, "INVALID_PAYLOAD", "Payload harus berupa objek JSON");
  }

  const { from, to, shifts } = payload;

  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new ShiftOverrideError(400, "INVALID_DATE", "Tanggal harus dalam format ISO valid YYYY-MM-DD");
  }

  if (to < from) {
    throw new ShiftOverrideError(400, "RANGE_INVALID", "Tanggal akhir (to) tidak boleh sebelum tanggal awal (from)");
  }

  const rangeDays = daysDifferenceInclusive(from, to);
  if (rangeDays > MAX_RANGE_DAYS) {
    throw new ShiftOverrideError(
      400,
      "RANGE_TOO_LONG",
      `Rentang tanggal maksimal ${MAX_RANGE_DAYS} hari (diterima ${rangeDays} hari)`
    );
  }

  if (!Array.isArray(shifts) || shifts.length === 0 || shifts.length > 2) {
    throw new ShiftOverrideError(400, "INVALID_SHIFTS", "shifts harus berupa array berisi 1 atau 2 elemen");
  }

  const seenCodes = new Set();
  const normalizedShifts = [];

  for (const s of shifts) {
    if (!s || typeof s !== "object") {
      throw new ShiftOverrideError(400, "INVALID_SHIFTS", "Item shift harus berupa objek");
    }

    const code = String(s.shift_code || "").trim().toUpperCase();
    if (!ROSTER_SHIFT_CODES.includes(code)) {
      throw new ShiftOverrideError(400, "INVALID_SHIFTS", `shift_code harus salah satu dari ${ROSTER_SHIFT_CODES.join(", ")}`);
    }

    if (seenCodes.has(code)) {
      throw new ShiftOverrideError(400, "INVALID_SHIFTS", `Duplikat shift_code: ${code}`);
    }
    seenCodes.add(code);

    const startTime = normalizeTime(s.start_time);
    const endTime = normalizeTime(s.end_time);
    if (!startTime || !endTime) {
      throw new ShiftOverrideError(400, "INVALID_TIME", `Jam shift ${code} harus dalam format HH:MM (00:00 s.d. 23:59)`);
    }

    if (typeof s.crosses_midnight !== "boolean") {
      throw new ShiftOverrideError(400, "INVALID_SPAN", `crosses_midnight pada shift ${code} harus berupa boolean ketat`);
    }
    const crosses = s.crosses_midnight;

    const startMin = parseTimeToMinutes(startTime);
    const endMin = parseTimeToMinutes(endTime);

    if (startMin === endMin) {
      throw new ShiftOverrideError(400, "INVALID_SPAN", `Jam mulai dan jam selesai shift ${code} tidak boleh sama`);
    }

    let spanMin = 0;
    if (!crosses) {
      if (endMin <= startMin) {
        throw new ShiftOverrideError(
          400,
          "INVALID_SPAN",
          `crosses_midnight=false mensyaratkan jam selesai (${endTime}) setelah jam mulai (${startTime})`
        );
      }
      spanMin = endMin - startMin;
    } else {
      if (endMin >= startMin) {
        throw new ShiftOverrideError(
          400,
          "INVALID_SPAN",
          `crosses_midnight=true mensyaratkan jam selesai (${endTime}) sebelum jam mulai (${startTime})`
        );
      }
      spanMin = endMin + 1440 - startMin;
    }

    if (spanMin < 1 || spanMin > 1439) {
      throw new ShiftOverrideError(400, "INVALID_SPAN", `Durasi shift ${code} harus antara 1 s.d. 1439 menit (didapat ${spanMin} menit)`);
    }

    const stdHours = Number(s.standard_hours);
    if (typeof s.standard_hours !== "number" || !Number.isFinite(stdHours) || stdHours <= 0 || stdHours > 24) {
      throw new ShiftOverrideError(400, "STANDARD_EXCEEDS_SPAN", `standard_hours shift ${code} harus berupa angka positif hingga 24`);
    }

    const roundedStd = Math.round(stdHours * 100) / 100;
    if (Math.abs(stdHours - roundedStd) > 1e-6) {
      throw new ShiftOverrideError(400, "STANDARD_EXCEEDS_SPAN", `standard_hours shift ${code} maksimal 2 tempat desimal`);
    }

    if (roundedStd * 60 > spanMin + 1e-6) {
      throw new ShiftOverrideError(
        400,
        "STANDARD_EXCEEDS_SPAN",
        `standard_hours (${roundedStd} jam = ${roundedStd * 60} menit) tidak boleh melebihi durasi span (${spanMin} menit)`
      );
    }

    normalizedShifts.push({
      shift_code: code,
      start_time: startTime,
      end_time: endTime,
      crosses_midnight: crosses,
      standard_hours: roundedStd,
      span_minutes: spanMin,
    });
  }

  return {
    from,
    to,
    shifts: normalizedShifts,
  };
}

/**
 * Validasi alasan audit (§5.2)
 */
function validateReason(reason, isRequired = false) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (isRequired) {
    if (!trimmed || trimmed.length < 10) {
      throw new ShiftOverrideError(400, "REASON_REQUIRED", "Alasan perubahan hari ini wajib diisi minimal 10 karakter");
    }
  }
  if (trimmed.length > 200) {
    throw new ShiftOverrideError(400, "REASON_TOO_LONG", "Alasan perubahan maksimal 200 karakter");
  }
  return trimmed || null;
}

/**
 * Membangun interval waktu nyata [start, end) dalam menit sejak anchor (Epoch hari from-2).
 * Digunakan untuk aljabar interval overlap toleransi 0 menit (§6.2).
 */
function buildIntervalMinutes(anchorIso, dateIso, startTime, crossesMidnight, spanMinutes) {
  const diffDays = daysDifferenceInclusive(anchorIso, dateIso) - 1;
  const startDayMinutes = diffDays * 1440;
  const startMinuteOfDay = parseTimeToMinutes(startTime);
  const startAbs = startDayMinutes + startMinuteOfDay;
  const endAbs = startAbs + spanMinutes;
  return { start: startAbs, end: endAbs };
}

/**
 * Verifikasi overlap antar interval nyata.
 * Dua interval [s1, e1) dan [s2, e2) overlap jika max(s1, s2) < min(e1, e2).
 */
function checkIntervalsForOverlap(intervals) {
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i];
      const b = intervals[j];
      const overlapStart = Math.max(a.start, b.start);
      const overlapEnd = Math.min(a.end, b.end);
      if (overlapStart < overlapEnd) {
        return {
          conflict: true,
          first: a,
          second: b,
        };
      }
    }
  }
  return { conflict: false };
}

/**
 * Hitung canonical preview_token sha256 dari state DB terkini + payload.
 */
function computePreviewToken(payload, stateSnapshot, plantToday = null, operation = "APPLY_DATE_RANGE") {
  const canonicalObj = {
    operation,
    payload: {
      from: payload.from,
      to: payload.to,
      shifts: (payload.shifts || []).map((s) => ({
        shift_code: s.shift_code,
        start_time: s.start_time,
        end_time: s.end_time,
        crosses_midnight: Boolean(s.crosses_midnight),
        standard_hours: Number(s.standard_hours),
      })).sort((a, b) => a.shift_code.localeCompare(b.shift_code)),
    },
    state: (stateSnapshot || []).map((row) => ({
      id: Number(row.id),
      shift_code: row.shift_code,
      roster_shift_code: row.roster_shift_code,
      effective_date: row.effective_date,
      is_default: Boolean(row.is_default),
      is_active: Boolean(row.is_active),
      start_time: row.start_time,
      end_time: row.end_time,
      crosses_midnight: Boolean(row.crosses_midnight),
      standard_hours: Number(row.standard_hours),
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    })).sort((a, b) => {
      const d = (a.effective_date || "1900-01-01").localeCompare(b.effective_date || "1900-01-01");
      if (d !== 0) return d;
      return (a.roster_shift_code || "").localeCompare(b.roster_shift_code || "");
    }),
    plant_today: plantToday || null,
  };

  const hash = crypto.createHash("sha256").update(JSON.stringify(canonicalObj)).digest("hex");
  return `sha256:${hash}`;
}

/**
 * Token preview kanonikal untuk operasi penghapusan override (Spec §8.3 & Blocker #3)
 */
function computeDeletePreviewToken(row, stateSnapshot, plantToday) {
  const canonicalObj = {
    operation: "DELETE_OVERRIDE",
    override_id: Number(row.id),
    effective_date: row.effective_date,
    roster_shift_code: row.roster_shift_code,
    state: (stateSnapshot || []).map((r) => ({
      id: Number(r.id),
      shift_code: r.shift_code,
      roster_shift_code: r.roster_shift_code,
      effective_date: r.effective_date,
      is_default: Boolean(r.is_default),
      is_active: Boolean(r.is_active),
      start_time: r.start_time,
      end_time: r.end_time,
      crosses_midnight: Boolean(r.crosses_midnight),
      standard_hours: Number(r.standard_hours),
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    })).sort((a, b) => {
      const d = (a.effective_date || "1900-01-01").localeCompare(b.effective_date || "1900-01-01");
      if (d !== 0) return d;
      return (a.roster_shift_code || "").localeCompare(b.roster_shift_code || "");
    }),
    plant_today: plantToday,
  };

  const hash = crypto.createHash("sha256").update(JSON.stringify(canonicalObj)).digest("hex");
  return `sha256:${hash}`;
}

/**
 * Validasi bahwa saat override dihapus (fallback ke shift default),
 * jadwal default tidak menimbulkan overlap interval dengan shift lain di tanggal D, D-1, atau D+1.
 */
function validateDeleteFallbackNoOverlap(row, defaults, overrides) {
  const targetDate = row.effective_date;
  const prevDate = addDaysToIso(targetDate, -1);
  const nextDate = addDaysToIso(targetDate, 1);
  const defaultByCode = new Map(defaults.map((d) => [d.roster_shift_code, d]));
  const fallbackDef = defaultByCode.get(row.roster_shift_code);
  if (!fallbackDef) return;

  const evalDates = [prevDate, targetDate, nextDate];
  const activeShiftsMap = new Map();

  for (const d of evalDates) {
    for (const code of ROSTER_SHIFT_CODES) {
      const def = defaultByCode.get(code);
      if (def) {
        activeShiftsMap.set(`${code}_${d}`, {
          start_time: def.start_time,
          end_time: def.end_time,
          crosses_midnight: Boolean(def.crosses_midnight),
        });
      }
    }
  }

  for (const o of overrides) {
    if (o.is_active && evalDates.includes(o.effective_date)) {
      if (Number(o.id) === Number(row.id)) continue; // Abaikan baris yang sedang dihapus
      activeShiftsMap.set(`${o.roster_shift_code}_${o.effective_date}`, {
        start_time: o.start_time,
        end_time: o.end_time,
        crosses_midnight: Boolean(o.crosses_midnight),
      });
    }
  }

  const intervals = [];
  const anchorDate = addDaysToIso(prevDate, -1);
  for (const d of evalDates) {
    for (const code of ROSTER_SHIFT_CODES) {
      const sh = activeShiftsMap.get(`${code}_${d}`);
      if (sh) {
        const startMin = parseTimeToMinutes(sh.start_time);
        const endMin = parseTimeToMinutes(sh.end_time);
        const span = sh.crosses_midnight ? endMin + 1440 - startMin : endMin - startMin;
        intervals.push(
          buildIntervalMinutes(anchorDate, d, sh.start_time, sh.crosses_midnight, span)
        );
      }
    }
  }

  const check = checkIntervalsForOverlap(intervals);
  if (check.conflict) {
    throw new ShiftOverrideError(
      400,
      "OVERLAP_CONFLICT",
      "Penghapusan override shift dibatalkan karena kembalinya shift ke default menimbulkan overlap jadwal dengan shift sekitar"
    );
  }
}

/**
 * Validasi aktor dari request terhadap identitas server yang terautentikasi (Blocker #2)
 */
async function verifyActor(client, reqOrHeaders) {
  const req = reqOrHeaders && (reqOrHeaders.headers || reqOrHeaders.user || reqOrHeaders.session)
    ? reqOrHeaders
    : { headers: reqOrHeaders };
  return authenticateAndAuthorizeActor(client, req);
}

/**
 * Ambil tanggal plant hari ini langsung dari database dalam timezone plant
 */
async function getPlantToday(client) {
  const tz = resolveTimezone();
  const res = await client.query("SELECT (now() AT TIME ZONE $1)::date::text AS plant_today", [tz]);
  return res.rows[0].plant_today;
}

/**
 * Ambil state shift terkini di [from-1, to+1] beserta baris default
 */
async function fetchShiftState(client, fromIso, toIso, forUpdate = false) {
  const lockClause = forUpdate ? "FOR UPDATE" : "";
  const prevDate = addDaysToIso(fromIso, -1);
  const nextDate = addDaysToIso(toIso, 1);

  // Kunci baris default terlebih dahulu secara deterministik (ORDER BY id)
  const defaultRes = await client.query(
    `SELECT id, shift_code, shift_name, roster_shift_code, effective_date, is_default,
            start_time::text, end_time::text, crosses_midnight, default_capacity_hours,
            standard_hours, is_active, updated_at
     FROM public.shift_definition
     WHERE is_default = true AND roster_shift_code IN ('DAY', 'NIGHT')
     ORDER BY id ${lockClause}`
  );

  const defaults = defaultRes.rows;
  if (defaults.length < 2) {
    throw new ShiftOverrideError(404, "DEFAULT_SHIFT_MISSING", "Default master shift DAY dan NIGHT belum terkonfigurasi lengkap di database");
  }

  // Kunci baris override di rentang [prevDate, nextDate]
  const overrideRes = await client.query(
    `SELECT id, shift_code, shift_name, roster_shift_code, effective_date::text AS effective_date,
            is_default, start_time::text, end_time::text, crosses_midnight,
            default_capacity_hours, standard_hours, is_active, updated_at
     FROM public.shift_definition
     WHERE is_default = false
       AND effective_date BETWEEN $1::date AND $2::date
     ORDER BY id ${lockClause}`,
    [prevDate, nextDate]
  );

  return {
    defaults,
    overrides: overrideRes.rows,
    prevDate,
    nextDate,
  };
}

/**
 * Preview kalkulasi perubahan date-range tanpa menulis data (Read-Only)
 */
async function previewDateRange(client, payload) {
  const validated = validateDateRangePayload(payload);
  const plantToday = await getPlantToday(client);
  const affectsToday = validated.from <= plantToday && plantToday <= validated.to;

  const { defaults, overrides } = await fetchShiftState(client, validated.from, validated.to, false);
  const stateSnapshot = [...defaults, ...overrides];
  const previewToken = computePreviewToken(validated, stateSnapshot, plantToday, "APPLY_DATE_RANGE");

  const defaultByCode = new Map(defaults.map((d) => [d.roster_shift_code, d]));
  const overrideKey = (code, date) => `${code}_${date}`;
  const overrideMap = new Map(overrides.map((o) => [overrideKey(o.roster_shift_code, o.effective_date), o]));

  const dates = enumerateDatesInclusive(validated.from, validated.to);
  const items = [];
  const blocking = [];

  for (const dateIso of dates) {
    for (const shift of validated.shifts) {
      const code = shift.shift_code;
      const def = defaultByCode.get(code);
      const existing = overrideMap.get(overrideKey(code, dateIso));

      let action = "CREATE";
      let before = null;
      let id = null;

      if (!existing) {
        action = "CREATE";
        before = {
          source: "default",
          id: Number(def.id),
          start_time: def.start_time,
          end_time: def.end_time,
          crosses_midnight: def.crosses_midnight,
          standard_hours: Number(def.standard_hours),
        };
      } else if (existing.is_active) {
        id = Number(existing.id);
        before = {
          source: "override",
          id,
          start_time: existing.start_time,
          end_time: existing.end_time,
          crosses_midnight: existing.crosses_midnight,
          standard_hours: Number(existing.standard_hours),
        };

        const isUnchanged =
          existing.start_time === shift.start_time &&
          existing.end_time === shift.end_time &&
          existing.crosses_midnight === shift.crosses_midnight &&
          Number(existing.standard_hours) === shift.standard_hours;

        action = isUnchanged ? "UNCHANGED" : "UPDATE";
      } else {
        id = Number(existing.id);
        before = {
          source: "inactive_override",
          id,
          start_time: existing.start_time,
          end_time: existing.end_time,
          crosses_midnight: existing.crosses_midnight,
          standard_hours: Number(existing.standard_hours),
        };
        action = "REACTIVATE";
      }

      // Periksa dependensi SOW jika aksi bukan UNCHANGED
      let sowRefs = { sow_machine_capacity: 0, sow_schedule: 0, sow_schedule_batch: 0, sow_overtime_request: 0 };
      if (action !== "UNCHANGED") {
        // Cari seluruh id keluarga shift untuk kode bersangkutan
        const familyRes = await client.query(
          "SELECT array_agg(id) AS ids FROM public.shift_definition WHERE lower(shift_code) = lower($1)",
          [def.shift_code]
        );
        const familyIds = familyRes.rows[0]?.ids || [def.id];

        const refRes = await client.query(
          "SELECT public.ews_sow_blocking_refs($1::date, $2::bigint[]) AS info",
          [dateIso, familyIds]
        );
        const info = refRes.rows[0]?.info || {};
        sowRefs = info.counts || sowRefs;
        if (info.total > 0) {
          blocking.push({
            date: dateIso,
            shift_code: code,
            total: info.total,
            counts: info.counts,
            samples: info.samples,
          });
        }
      }

      // Info khusus hari ini jika terdampak
      let todayInfo = null;
      if (dateIso === plantToday) {
        let stats = null;
        try {
          const statsRes = await client.query(
            `WITH logged AS (
               SELECT NULLIF(BTRIM(t.serialnumber), '') AS op,
                      SUM(t.duration::float) AS recorded
               FROM public.timesheet_transaction t
               WHERE t.longdate_checkin >= ($1::date)::timestamp
                 AND t.longdate_checkin <  ($1::date + 2)::timestamp
                 AND COALESCE(t.state_flag, 0) <> 5 AND COALESCE(t.duration, 0) > 0
                 AND NULLIF(BTRIM(t.serialnumber), '') IS NOT NULL
               GROUP BY 1
             )
             SELECT
               COUNT(DISTINCT r.serialnumber) FILTER (WHERE r.eff_shift = $2)::int AS scheduled_operators,
               COUNT(DISTINCT r.serialnumber) FILTER (WHERE r.eff_shift = $2 AND COALESCE(lg.recorded, 0) > 0)::int AS operators_with_records
             FROM ews.roster_effective r
             LEFT JOIN logged lg ON lg.op = r.serialnumber
             WHERE r.business_date = $1::date`,
            [dateIso, code]
          );
          const sRow = statsRes.rows[0];
          stats = {
            scheduled_operators: sRow?.scheduled_operators != null ? Number(sRow.scheduled_operators) : 0,
            operators_with_records: sRow?.operators_with_records != null ? Number(sRow.operators_with_records) : 0,
            stats_status: "available",
            stats_error: null,
          };
        } catch (err) {
          stats = {
            scheduled_operators: null,
            operators_with_records: null,
            stats_status: "unavailable",
            stats_error: err.message,
          };
        }

        // Periksa apakah shift sudah dimulai berdasarkan jam plant sekarang
        const tz = resolveTimezone();
        const nowRes = await client.query("SELECT (now() AT TIME ZONE $1)::time::text AS cur_time", [tz]);
        const curTime = nowRes.rows[0].cur_time;
        const curMin = parseTimeToMinutes(curTime);
        const startMinOld = parseTimeToMinutes(before ? before.start_time : def.start_time);
        const startMinNew = parseTimeToMinutes(shift.start_time);
        const started = curMin >= startMinOld || curMin >= startMinNew;

        todayInfo = {
          started,
          scheduled_operators: stats.scheduled_operators,
          operators_with_records: stats.operators_with_records,
          stats_status: stats.stats_status,
          stats_error: stats.stats_error,
        };
      }

      items.push({
        date: dateIso,
        shift_code: code,
        action,
        id,
        before,
        after: {
          start_time: shift.start_time,
          end_time: shift.end_time,
          crosses_midnight: shift.crosses_midnight,
          standard_hours: shift.standard_hours,
        },
        sow_refs: sowRefs,
        today: todayInfo,
      });
    }
  }

  return {
    plant_today: plantToday,
    affects_today: affectsToday,
    preview_token: previewToken,
    items,
    blocking,
    refresh_note: "Roster dan kehadiran mengikuti saat dimuat ulang; KPI dashboard pada siklus snapshot berikutnya.",
  };
}

/**
 * Eksekusi mutasi Date-Range Shift Override secara ACID (§8.2)
 */
async function applyDateRange(client, payload, reqHeaders) {
  const validated = validateDateRangePayload(payload);

  // 1. Dapatkan advisory lock transaksi agar mutasi override serial
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('ews_shift_override'))");

  // 2. Dapatkan plant_today
  const plantToday = await getPlantToday(client);

  if (validated.from < plantToday) {
    throw new ShiftOverrideError(400, "PAST_DATE_LOCKED", `Tanggal awal (${validated.from}) berada di masa lampau (hari ini: ${plantToday})`);
  }

  // 3. Ambil state dengan row lock FOR UPDATE
  const { defaults, overrides, prevDate, nextDate } = await fetchShiftState(
    client,
    validated.from,
    validated.to,
    true
  );

  const stateSnapshot = [...defaults, ...overrides];
  const currentToken = computePreviewToken(validated, stateSnapshot, plantToday, "APPLY_DATE_RANGE");

  const defaultByCode = new Map(defaults.map((d) => [d.roster_shift_code, d]));
  const overrideKey = (code, date) => `${code}_${date}`;
  const overrideMap = new Map(overrides.map((o) => [overrideKey(o.roster_shift_code, o.effective_date), o]));

  const dates = enumerateDatesInclusive(validated.from, validated.to);
  const plannedItems = [];
  let touchesTodayWithMutation = false;

  for (const dateIso of dates) {
    for (const shift of validated.shifts) {
      const code = shift.shift_code;
      const def = defaultByCode.get(code);
      const existing = overrideMap.get(overrideKey(code, dateIso));

      let action = "CREATE";
      let targetId = existing ? existing.id : null;
      let before = null;

      if (!existing) {
        action = "CREATE";
        before = null;
      } else if (existing.is_active) {
        const isUnchanged =
          existing.start_time === shift.start_time &&
          existing.end_time === shift.end_time &&
          existing.crosses_midnight === shift.crosses_midnight &&
          Number(existing.standard_hours) === shift.standard_hours;

        action = isUnchanged ? "UNCHANGED" : "UPDATE";
        before = {
          start_time: existing.start_time,
          end_time: existing.end_time,
          crosses_midnight: existing.crosses_midnight,
          standard_hours: Number(existing.standard_hours),
          is_active: true,
        };
      } else {
        action = "REACTIVATE";
        before = {
          start_time: existing.start_time,
          end_time: existing.end_time,
          crosses_midnight: existing.crosses_midnight,
          standard_hours: Number(existing.standard_hours),
          is_active: false,
        };
      }

      if (dateIso === plantToday && action !== "UNCHANGED") {
        touchesTodayWithMutation = true;
      }

      plannedItems.push({
        date: dateIso,
        shift_code: code,
        action,
        id: targetId,
        def,
        existing,
        before,
        shift,
      });
    }
  }

  // 4. Verifikasi identitas aktor server yang terautentikasi dan hak tulis RBAC (Blocker #2)
  // Wajib pada SELURUH mutasi, baik menyentuh hari ini maupun tanggal mendatang!
  const actor = await verifyActor(client, reqHeaders);
  let reason = null;

  if (touchesTodayWithMutation) {
    if (payload.confirm_today_impact !== true) {
      throw new ShiftOverrideError(
        400,
        "TODAY_CONFIRMATION_REQUIRED",
        "Perubahan jadwal hari ini memerlukan konfirmasi eksplisit confirm_today_impact = true"
      );
    }
    reason = validateReason(payload.reason, true);

    // Blocker #3: preview_token WAJIB disertakan pada perubahan hari ini
    if (!payload.preview_token) {
      throw new ShiftOverrideError(
        400,
        "PREVIEW_REQUIRED",
        "preview_token wajib disertakan untuk perubahan jadwal hari ini. Silakan muat ulang preview."
      );
    }
    if (payload.preview_token !== currentToken) {
      throw new ShiftOverrideError(
        409,
        "PREVIEW_STALE",
        "Kondisi shift telah berubah sejak preview terakhir atau token tidak valid. Silakan muat ulang preview."
      );
    }
  } else {
    reason = validateReason(payload.reason, false);
  }

  // 5. Validasi aljabar interval overlap toleransi 0 menit pada [prevDate, nextDate] (§6.2)
  const allIntervals = [];
  const anchorDate = addDaysToIso(prevDate, -1);
  const evalDates = enumerateDatesInclusive(prevDate, nextDate);

  // Buat map shift efektif hasil akhir
  const finalShiftsMap = new Map();
  // Isi dengan default
  for (const d of evalDates) {
    for (const code of ROSTER_SHIFT_CODES) {
      const def = defaultByCode.get(code);
      finalShiftsMap.set(`${code}_${d}`, {
        start_time: def.start_time,
        end_time: def.end_time,
        crosses_midnight: def.crosses_midnight,
        span_minutes: def.crosses_midnight
          ? parseTimeToMinutes(def.end_time) + 1440 - parseTimeToMinutes(def.start_time)
          : parseTimeToMinutes(def.end_time) - parseTimeToMinutes(def.start_time),
      });
    }
  }
  // Terapkan override aktif yang ada di luar payload atau yang tidak diubah
  for (const o of overrides) {
    if (o.is_active) {
      const key = `${o.roster_shift_code}_${o.effective_date}`;
      const span = o.crosses_midnight
        ? parseTimeToMinutes(o.end_time) + 1440 - parseTimeToMinutes(o.start_time)
        : parseTimeToMinutes(o.end_time) - parseTimeToMinutes(o.start_time);
      finalShiftsMap.set(key, {
        start_time: o.start_time,
        end_time: o.end_time,
        crosses_midnight: o.crosses_midnight,
        span_minutes: span,
      });
    }
  }
  // Terapkan rencana mutasi dari payload
  for (const item of plannedItems) {
    const key = `${item.shift_code}_${item.date}`;
    finalShiftsMap.set(key, {
      start_time: item.shift.start_time,
      end_time: item.shift.end_time,
      crosses_midnight: item.shift.crosses_midnight,
      span_minutes: item.shift.span_minutes,
    });
  }

  for (const [key, conf] of finalShiftsMap.entries()) {
    const [code, dateIso] = key.split("_");
    const interval = buildIntervalMinutes(
      anchorDate,
      dateIso,
      conf.start_time,
      conf.crosses_midnight,
      conf.span_minutes
    );
    allIntervals.push({
      code,
      date: dateIso,
      start: interval.start,
      end: interval.end,
      start_time: conf.start_time,
      end_time: conf.end_time,
    });
  }

  const overlapResult = checkIntervalsForOverlap(allIntervals);
  if (overlapResult.conflict) {
    const { first, second } = overlapResult;
    throw new ShiftOverrideError(
      409,
      "SHIFT_OVERLAP",
      `Shift bertabrakan (overlap): ${first.code} ${first.date} (${first.start_time}-${first.end_time}) dengan ${second.code} ${second.date} (${second.start_time}-${second.end_time})`,
      { first, second }
    );
  }

  // 6. Jalankan Guard SOW 1C untuk semua mutasi aktif
  for (const item of plannedItems) {
    if (item.action === "UNCHANGED") continue;

    const familyRes = await client.query(
      "SELECT array_agg(id) AS ids FROM public.shift_definition WHERE lower(shift_code) = lower($1)",
      [item.def.shift_code]
    );
    const familyIds = familyRes.rows[0]?.ids || [item.def.id];

    const refRes = await client.query(
      "SELECT public.ews_sow_blocking_refs($1::date, $2::bigint[]) AS info",
      [item.date, familyIds]
    );
    const info = refRes.rows[0]?.info || {};
    if (info.total > 0) {
      throw new ShiftOverrideError(
        409,
        "SOW_REFERENCE_CONFLICT",
        `Perubahan shift ${item.shift_code} pada tanggal ${item.date} diblokir oleh ${info.total} referensi SOW aktif`,
        { date: item.date, shift_code: item.shift_code, total: info.total, counts: info.counts, samples: info.samples }
      );
    }
  }

  // 7. Eksekusi mutasi dan catat audit trail
  const requestId = crypto.randomUUID();
  const counts = { CREATE: 0, UPDATE: 0, REACTIVATE: 0, UNCHANGED: 0 };
  const resultItems = [];

  for (const item of plannedItems) {
    let finalId = item.id;
    let afterObj = null;

    if (item.action === "CREATE") {
      const insRes = await client.query(
        `INSERT INTO public.shift_definition (
           shift_code, shift_name, roster_shift_code, effective_date, is_default,
           start_time, end_time, crosses_midnight, default_capacity_hours, standard_hours, is_active
         ) VALUES ($1, $2, $3, $4::date, false, $5::time, $6::time, $7, $8, $9, true)
         RETURNING id`,
        [
          item.def.shift_code,
          item.def.shift_name,
          item.shift_code,
          item.date,
          item.shift.start_time,
          item.shift.end_time,
          item.shift.crosses_midnight,
          item.def.default_capacity_hours,
          item.shift.standard_hours,
        ]
      );
      finalId = insRes.rows[0].id;
      counts.CREATE++;
      afterObj = {
        start_time: item.shift.start_time,
        end_time: item.shift.end_time,
        crosses_midnight: item.shift.crosses_midnight,
        standard_hours: item.shift.standard_hours,
        is_active: true,
      };
    } else if (item.action === "UPDATE") {
      await client.query(
        `UPDATE public.shift_definition
         SET start_time = $1::time,
             end_time = $2::time,
             crosses_midnight = $3,
             standard_hours = $4,
             updated_at = now()
         WHERE id = $5`,
        [
          item.shift.start_time,
          item.shift.end_time,
          item.shift.crosses_midnight,
          item.shift.standard_hours,
          finalId,
        ]
      );
      counts.UPDATE++;
      afterObj = {
        start_time: item.shift.start_time,
        end_time: item.shift.end_time,
        crosses_midnight: item.shift.crosses_midnight,
        standard_hours: item.shift.standard_hours,
        is_active: true,
      };
    } else if (item.action === "REACTIVATE") {
      await client.query(
        `UPDATE public.shift_definition
         SET is_active = true,
             start_time = $1::time,
             end_time = $2::time,
             crosses_midnight = $3,
             standard_hours = $4,
             updated_at = now()
         WHERE id = $5`,
        [
          item.shift.start_time,
          item.shift.end_time,
          item.shift.crosses_midnight,
          item.shift.standard_hours,
          finalId,
        ]
      );
      counts.REACTIVATE++;
      afterObj = {
        start_time: item.shift.start_time,
        end_time: item.shift.end_time,
        crosses_midnight: item.shift.crosses_midnight,
        standard_hours: item.shift.standard_hours,
        is_active: true,
      };
    } else {
      counts.UNCHANGED++;
    }

    if (item.action !== "UNCHANGED") {
      await client.query(
        `INSERT INTO ews.shift_definition_audit (
           request_id, action, shift_definition_id, roster_shift_code, effective_date,
           before, after, affects_today, reason, actor_user_id, actor_name, actor_role
         ) VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12)`,
        [
          requestId,
          item.action,
          finalId,
          item.shift_code,
          item.date,
          item.before ? JSON.stringify(item.before) : null,
          JSON.stringify(afterObj),
          item.date === plantToday,
          reason,
          actor.id,
          actor.name,
          actor.role,
        ]
      );
    }

    resultItems.push({
      id: Number(finalId),
      date: item.date,
      shift_code: item.shift_code,
      sow_shift_code: item.def.shift_code,
      action: item.action,
      start_time: item.shift.start_time,
      end_time: item.shift.end_time,
      crosses_midnight: item.shift.crosses_midnight,
      standard_hours: item.shift.standard_hours,
      is_active: true,
    });
  }

  return {
    request_id: requestId,
    from: validated.from,
    to: validated.to,
    counts,
    items: resultItems,
  };
}

/**
 * Soft delete override berdasarkan id (§8.3)
 */
async function deleteOverrideById(client, overrideId, body = {}, reqHeaders = {}) {
  // 1. Verifikasi identitas aktor server yang terautentikasi dan hak tulis RBAC (Blocker #2)
  // Wajib dilakukan di awal sebelum memeriksa data atau row keberadaan!
  const actor = await verifyActor(client, reqHeaders);

  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('ews_shift_override'))");

  const plantToday = await getPlantToday(client);

  const res = await client.query(
    `SELECT id, shift_code, shift_name, roster_shift_code, effective_date::text AS effective_date,
            is_default, start_time::text, end_time::text, crosses_midnight, standard_hours, is_active
     FROM public.shift_definition
     WHERE id = $1
     FOR UPDATE`,
    [overrideId]
  );

  const row = res.rows[0];
  if (!row) {
    throw new ShiftOverrideError(404, "OVERRIDE_NOT_FOUND", "Override shift tidak ditemukan");
  }

  if (row.is_default) {
    throw new ShiftOverrideError(400, "DEFAULT_PROTECTED", "Shift default tidak boleh dihapus");
  }

  if (!row.is_active) {
    return {
      id: Number(row.id),
      date: row.effective_date,
      shift_code: row.roster_shift_code,
      action: "ALREADY_INACTIVE",
    };
  }

  if (row.effective_date < plantToday) {
    throw new ShiftOverrideError(400, "PAST_DATE_LOCKED", "Override tanggal lampau tidak boleh dihapus");
  }

  let reason = null;

  // 2. Ambil snapshot state di sekitar tanggal target untuk validasi overlap fallback & preview token
  const { defaults, overrides } = await fetchShiftState(
    client,
    row.effective_date,
    row.effective_date,
    true
  );

  // 3. Pastikan kembalinya shift ke default saat override dihapus tidak menciptakan overlap
  validateDeleteFallbackNoOverlap(row, defaults, overrides);

  // 4. Verifikasi aturan jika menghapus jadwal hari ini (Blocker #3)
  if (row.effective_date === plantToday) {
    if (body.confirm_today_impact !== true) {
      throw new ShiftOverrideError(
        400,
        "TODAY_CONFIRMATION_REQUIRED",
        "Penghapusan jadwal hari ini memerlukan konfirmasi eksplisit confirm_today_impact = true"
      );
    }
    reason = validateReason(body.reason, true);

    if (!body.preview_token) {
      throw new ShiftOverrideError(
        400,
        "PREVIEW_REQUIRED",
        "preview_token wajib disertakan untuk penghapusan jadwal hari ini. Silakan muat ulang preview."
      );
    }
    const expectedToken = computeDeletePreviewToken(row, [...defaults, ...overrides], plantToday);
    if (body.preview_token !== expectedToken) {
      throw new ShiftOverrideError(
        409,
        "PREVIEW_STALE",
        "Kondisi shift telah berubah sejak preview terakhir atau token tidak valid. Silakan muat ulang preview."
      );
    }
  } else {
    reason = validateReason(body.reason, false);
  }

  // Guard SOW
  const familyRes = await client.query(
    "SELECT array_agg(id) AS ids FROM public.shift_definition WHERE lower(shift_code) = lower($1)",
    [row.shift_code]
  );
  const familyIds = familyRes.rows[0]?.ids || [row.id];

  const refRes = await client.query(
    "SELECT public.ews_sow_blocking_refs($1::date, $2::bigint[]) AS info",
    [row.effective_date, familyIds]
  );
  const info = refRes.rows[0]?.info || {};
  if (info.total > 0) {
    throw new ShiftOverrideError(
      409,
      "SOW_REFERENCE_CONFLICT",
      `Penghapusan shift override tanggal ${row.effective_date} diblokir oleh ${info.total} referensi SOW aktif`,
      { date: row.effective_date, shift_code: row.roster_shift_code, total: info.total, counts: info.counts, samples: info.samples }
    );
  }

  // Lakukan soft-delete
  await client.query(
    "UPDATE public.shift_definition SET is_active = false, updated_at = now() WHERE id = $1",
    [row.id]
  );

  const requestId = crypto.randomUUID();
  await client.query(
    `INSERT INTO ews.shift_definition_audit (
       request_id, action, shift_definition_id, roster_shift_code, effective_date,
       before, after, affects_today, reason, actor_user_id, actor_name, actor_role
     ) VALUES ($1, 'DEACTIVATE', $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11)`,
    [
      requestId,
      row.id,
      row.roster_shift_code,
      row.effective_date,
      JSON.stringify({
        start_time: row.start_time,
        end_time: row.end_time,
        crosses_midnight: row.crosses_midnight,
        standard_hours: Number(row.standard_hours),
        is_active: true,
      }),
      JSON.stringify({ is_active: false }),
      row.effective_date === plantToday,
      reason,
      actor.id,
      actor.name,
      actor.role,
    ]
  );

  return {
    id: Number(row.id),
    date: row.effective_date,
    shift_code: row.roster_shift_code,
    action: "DEACTIVATE",
  };
}

/**
 * Preview penghapusan override shift untuk mengecek dampak, dependensi SOW, dan menghasilkan preview_token (Spec §8.3 & Blocker #3)
 */
async function previewDeleteOverrideById(client, overrideId) {
  const plantToday = await getPlantToday(client);
  const ovRes = await client.query(
    `SELECT id, shift_code, roster_shift_code, effective_date::text AS effective_date,
            start_time::text, end_time::text, crosses_midnight, standard_hours, is_active, is_default
     FROM public.shift_definition WHERE id = $1`,
    [overrideId]
  );
  const row = ovRes.rows[0];
  if (!row) {
    throw new ShiftOverrideError(404, "OVERRIDE_NOT_FOUND", "Shift override tidak ditemukan");
  }
  if (row.is_default) {
    throw new ShiftOverrideError(400, "DEFAULT_PROTECTED", "Shift default tidak boleh dihapus");
  }

  const { defaults, overrides } = await fetchShiftState(client, row.effective_date, row.effective_date, false);
  const defaultByCode = new Map(defaults.map((d) => [d.roster_shift_code, d]));
  const fallbackDef = defaultByCode.get(row.roster_shift_code);

  let overlapConflict = null;
  try {
    validateDeleteFallbackNoOverlap(row, defaults, overrides);
  } catch (err) {
    overlapConflict = err.message;
  }

  const familyRes = await client.query(
    "SELECT array_agg(id) AS ids FROM public.shift_definition WHERE lower(shift_code) = lower($1)",
    [row.shift_code]
  );
  const familyIds = familyRes.rows[0]?.ids || [row.id];

  const refRes = await client.query(
    "SELECT public.ews_sow_blocking_refs($1::date, $2::bigint[]) AS info",
    [row.effective_date, familyIds]
  );
  const sowInfo = refRes.rows[0]?.info || {};

  const isToday = row.effective_date === plantToday;
  let todayInfo = null;
  let previewToken = null;

  if (isToday) {
    let stats = null;
    try {
      const statsRes = await client.query(
        `WITH logged AS (
           SELECT NULLIF(BTRIM(t.serialnumber), '') AS op,
                  SUM(t.duration::float) AS recorded
           FROM public.timesheet_transaction t
           WHERE t.longdate_checkin >= ($1::date)::timestamp
             AND t.longdate_checkin <  ($1::date + 2)::timestamp
             AND COALESCE(t.state_flag, 0) <> 5 AND COALESCE(t.duration, 0) > 0
             AND NULLIF(BTRIM(t.serialnumber), '') IS NOT NULL
           GROUP BY 1
         )
         SELECT
           COUNT(DISTINCT r.serialnumber) FILTER (WHERE r.eff_shift = $2)::int AS scheduled_operators,
           COUNT(DISTINCT r.serialnumber) FILTER (WHERE r.eff_shift = $2 AND COALESCE(lg.recorded, 0) > 0)::int AS operators_with_records
         FROM ews.roster_effective r
         LEFT JOIN logged lg ON lg.op = r.serialnumber
         WHERE r.business_date = $1::date`,
        [plantToday, row.roster_shift_code]
      );
      const sRow = statsRes.rows[0];
      stats = {
        scheduled_operators: sRow?.scheduled_operators != null ? Number(sRow.scheduled_operators) : 0,
        operators_with_records: sRow?.operators_with_records != null ? Number(sRow.operators_with_records) : 0,
        stats_status: "available",
        stats_error: null,
      };
    } catch (err) {
      stats = {
        scheduled_operators: null,
        operators_with_records: null,
        stats_status: "unavailable",
        stats_error: err.message,
      };
    }

    todayInfo = {
      is_today: true,
      business_date: plantToday,
      scheduled_operators: stats.scheduled_operators,
      operators_with_records: stats.operators_with_records,
      stats_status: stats.stats_status,
      stats_error: stats.stats_error,
      fallback_to: fallbackDef
        ? {
            start_time: fallbackDef.start_time,
            end_time: fallbackDef.end_time,
            standard_hours: Number(fallbackDef.standard_hours),
          }
        : null,
    };

    previewToken = computeDeletePreviewToken(row, [...defaults, ...overrides], plantToday);
  }

  return {
    id: Number(row.id),
    effective_date: row.effective_date,
    shift_code: row.roster_shift_code,
    sow_shift_code: row.shift_code,
    affects_today: isToday,
    plant_today: plantToday,
    preview_token: previewToken,
    sow_blocking: sowInfo.total > 0,
    sow_refs: sowInfo,
    overlap_conflict: overlapConflict,
    today: todayInfo,
  };
}

module.exports = {
  ShiftOverrideError,
  isValidIsoDate,
  parseTimeToMinutes,
  normalizeTime,
  daysDifferenceInclusive,
  enumerateDatesInclusive,
  validateDateRangePayload,
  validateReason,
  buildIntervalMinutes,
  checkIntervalsForOverlap,
  computePreviewToken,
  computeDeletePreviewToken,
  validateDeleteFallbackNoOverlap,
  verifyActor,
  getPlantToday,
  fetchShiftState,
  previewDateRange,
  applyDateRange,
  previewDeleteOverrideById,
  deleteOverrideById,
};
