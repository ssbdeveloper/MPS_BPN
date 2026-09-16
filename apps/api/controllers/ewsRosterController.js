const db = global.pool || require("../db");
const { generateRoster } = require("../services/rosterGenerator");
const { resolveTimezone } = require("../config/timezone");

const VALID_STATUS = new Set(["SCHEDULED", "OFF", "LEAVE", "SICK", "PERMIT", "SITE_VISIT"]);
const TZ = resolveTimezone();

function assertIsoDate(value) {
  const text = String(value || "");
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error("Invalid date. Use YYYY-MM-DD.");
  }
}

function clampText(value, fallback = "", max = 160) {
  const t = String(value ?? fallback).trim();
  return t.length > max ? t.slice(0, max) : t;
}

// GET /ews/roster?date=YYYY-MM-DD — roster for a business date with attendance (present/absent).
async function getRoster(req, res) {
  try {
    const date = req.query.date;
    assertIsoDate(date);
    const result = await db.query(
      `
      WITH logged AS (
        SELECT NULLIF(BTRIM(t.serialnumber), '') AS op, SUM(t.duration::float) AS recorded
        FROM public.timesheet_transaction t
        WHERE t.longdate_checkin >= ($1::date)::timestamp
          AND t.longdate_checkin <  ($1::date + 2)::timestamp
          AND COALESCE(t.state_flag, 0) <> 5 AND COALESCE(t.duration, 0) > 0
          AND NULLIF(BTRIM(t.serialnumber), '') IS NOT NULL
          AND (CASE WHEN (t.longdate_checkin AT TIME ZONE $2)::time < TIME '07:00'
                    THEN (t.longdate_checkin AT TIME ZONE $2)::date - 1
                    ELSE (t.longdate_checkin AT TIME ZONE $2)::date END) = $1::date
        GROUP BY 1
      )
      SELECT r.serialnumber, u.full_name AS operator_name, r.eff_shift AS scheduled_shift, r.eff_std AS scheduled_standard_hours,
             r.status, r.source, r.updated_by, r.half_day,
             r.shift_override, r.standard_hours_override, r.fixed_shift,
             COALESCE(lg.recorded, 0)::float AS recorded_hours,
             CASE WHEN r.end_time IS NULL THEN NULL ELSE
               ((r.business_date + r.end_time
                 + CASE WHEN r.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) <= now()
             END AS completed,
             CASE WHEN r.status <> 'SCHEDULED' THEN r.status
                  WHEN r.end_time IS NULL THEN
                    (CASE WHEN COALESCE(lg.recorded, 0) > 0 THEN 'PRESENT' ELSE 'IN_PROGRESS' END)
                  WHEN ((r.business_date + r.end_time + CASE WHEN r.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) > now() THEN 'IN_PROGRESS'
                  WHEN COALESCE(lg.recorded, 0) > 0 THEN 'PRESENT'
                  ELSE 'ABSENT' END AS attendance
      FROM ews.roster_effective r
      LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb), '') = r.serialnumber
      LEFT JOIN logged lg ON lg.op = r.serialnumber
      WHERE r.business_date = $1::date
      ORDER BY r.eff_shift, u.full_name NULLS LAST, r.serialnumber
      `,
      [date, TZ],
    );
    res.json({ data: result.rows, meta: { business_date: date, count: result.rows.length } });
  } catch (err) {
    if (err.code === "42P01") return res.status(503).json({ error: "Roster tables not created. Run the roster migration." });
    console.error("ews roster get error:", err);
    res.status(400).json({ error: err.message });
  }
}

// PUT /ews/roster/status  { serialnumber, business_date, status, updated_by }
async function updateStatus(req, res) {
  try {
    const serialnumber = clampText(req.body?.serialnumber, "", 80);
    const business_date = req.body?.business_date;
    const status = String(req.body?.status || "").toUpperCase();
    const updated_by = clampText(req.body?.updated_by, "ews-roster-ui", 120);
    assertIsoDate(business_date);
    if (!serialnumber) return res.status(400).json({ error: "serialnumber is required" });
    if (!VALID_STATUS.has(status)) return res.status(400).json({ error: "Invalid status" });

    const result = await db.query(
      `
      UPDATE ews.shift_roster
      SET status = $3, source = 'manual', updated_by = $4, updated_at = now()
      WHERE serialnumber = $1 AND business_date = $2::date
      RETURNING serialnumber, business_date::text, scheduled_shift, status, source, updated_by
      `,
      [serialnumber, business_date, status, updated_by],
    );
    if (!result.rows.length) return res.status(404).json({ error: "Roster row not found for that operator/date" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("ews roster status error:", err);
    res.status(400).json({ error: err.message });
  }
}

// PUT /ews/roster/half-day  { serialnumber, business_date, half_day }
// Toggle operator "masuk setengah hari" untuk satu tanggal: jam standar shift-nya
// dibagi dua (eff_std di ews.roster_effective /2) — berlaku juga ke denominator
// adoption EWS tanpa ubah kalkulator.
async function updateHalfDay(req, res) {
  try {
    const serialnumber = clampText(req.body?.serialnumber, "", 80);
    const business_date = req.body?.business_date;
    const half_day = Boolean(req.body?.half_day);
    const updated_by = clampText(req.body?.updated_by, "ews-roster-ui", 120);
    assertIsoDate(business_date);
    if (!serialnumber) return res.status(400).json({ error: "serialnumber is required" });

    const result = await db.query(
      `
      UPDATE ews.shift_roster
      SET half_day = $3, source = 'manual', updated_by = $4, updated_at = now()
      WHERE serialnumber = $1 AND business_date = $2::date
      RETURNING serialnumber, business_date::text, half_day, status, source, updated_by
      `,
      [serialnumber, business_date, half_day, updated_by],
    );
    if (!result.rows.length) return res.status(404).json({ error: "Roster row not found for that operator/date" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("ews roster half-day error:", err);
    res.status(400).json({ error: err.message });
  }
}

// DELETE /ews/roster  { business_date, shift?, serialnumber? }
// Hapus baris roster yang SUDAH di-generate. Forward-only: tanggal yang sudah lewat
// (atau hari ini) TIDAK bisa dihapus — barisnya dipakai perhitungan adoption KPI.
// Filter opsional: shift (DAY/NIGHT) dan/atau serialnumber untuk hapus sebagian.
async function deleteRoster(req, res) {
  try {
    const business_date = req.body?.business_date;
    const shift = String(req.body?.shift || "").toUpperCase();
    const serialnumber = clampText(req.body?.serialnumber, "", 80);
    assertIsoDate(business_date);
    if (shift && shift !== "DAY" && shift !== "NIGHT") {
      return res.status(400).json({ error: "shift must be DAY or NIGHT" });
    }

    const todayRes = await db.query(`SELECT (now() AT TIME ZONE $1)::date AS today`, [TZ]);
    if (String(business_date) < todayRes.rows[0].today) {
      return res.status(400).json({
        error: "Past dates are frozen (adoption already counted). Only today or future dates can be deleted.",
      });
    }

    const params = [business_date];
    let where = `business_date = $1::date`;
    if (shift) {
      params.push(shift);
      where += ` AND scheduled_shift = $${params.length}`;
    }
    if (serialnumber) {
      params.push(serialnumber);
      where += ` AND serialnumber = $${params.length}`;
    }

    const result = await db.query(`DELETE FROM ews.shift_roster WHERE ${where}`, params);
    res.json({
      data: {
        business_date,
        shift: shift || null,
        serialnumber: serialnumber || null,
        rows_deleted: result.rowCount,
      },
    });
  } catch (err) {
    console.error("ews roster delete error:", err);
    res.status(400).json({ error: err.message });
  }
}

// GET /ews/roster/month?month=YYYY-MM&scope=team|all
// Heatmap bulanan: SEMUA baris roster sebulan + attendance + recorded hours.
// scope=team → hanya anggota foreman_team milik user login (header x-user-id).
async function getRosterMonth(req, res) {
  try {
    const month = String(req.query.month || "");
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "Invalid month. Use YYYY-MM." });
    }
    const scope = String(req.query.scope || "all") === "team" ? "team" : "all";
    const userId = String(req.headers["x-user-id"] || "");
    const params = [`${month}-01`, TZ];
    let teamFilter = "";
    if (scope === "team") {
      if (!/^\d+$/.test(userId)) return res.json({ data: [], meta: { month, scope } });
      params.push(userId);
      teamFilter = ` AND r.serialnumber IN (
        SELECT member_serialnumber FROM ews.foreman_team WHERE foreman_user_id = $${params.length}
      )`;
    }
    const result = await db.query(
      `
      WITH logged AS (
        SELECT NULLIF(BTRIM(t.serialnumber), '') AS op,
               CASE WHEN (t.longdate_checkin AT TIME ZONE $2)::time < TIME '07:00'
                    THEN (t.longdate_checkin AT TIME ZONE $2)::date - 1
                    ELSE (t.longdate_checkin AT TIME ZONE $2)::date END AS business_date,
               SUM(t.duration::float) AS recorded
        FROM public.timesheet_transaction t
        WHERE t.longdate_checkin >= ($1::date)::timestamp
          AND t.longdate_checkin <  ($1::date + interval '1 month 7 hours')::timestamp
          AND COALESCE(t.state_flag, 0) <> 5 AND COALESCE(t.duration, 0) > 0
          AND NULLIF(BTRIM(t.serialnumber), '') IS NOT NULL
        GROUP BY 1, 2
      )
      SELECT r.serialnumber, u.full_name AS operator_name, r.business_date::text,
             r.eff_shift AS scheduled_shift, r.eff_std AS scheduled_standard_hours,
             r.status, r.half_day, r.shift_locked,
             r.shift_override, r.standard_hours_override, r.fixed_shift,
             COALESCE(lg.recorded, 0)::float AS recorded_hours,
             CASE WHEN r.end_time IS NULL THEN NULL ELSE
               ((r.business_date + r.end_time
                 + CASE WHEN r.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) <= now()
             END AS completed,
             CASE WHEN r.status <> 'SCHEDULED' THEN r.status
                  WHEN r.end_time IS NULL THEN
                    (CASE WHEN COALESCE(lg.recorded, 0) > 0 THEN 'PRESENT' ELSE 'IN_PROGRESS' END)
                  WHEN ((r.business_date + r.end_time + CASE WHEN r.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) > now() THEN 'IN_PROGRESS'
                  WHEN COALESCE(lg.recorded, 0) > 0 THEN 'PRESENT'
                  ELSE 'ABSENT' END AS attendance
      FROM ews.roster_effective r
      LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb), '') = r.serialnumber
      LEFT JOIN logged lg ON lg.op = r.serialnumber AND lg.business_date = r.business_date
      WHERE r.business_date >= $1::date AND r.business_date < ($1::date + interval '1 month')::date
      ${teamFilter}
      ORDER BY u.full_name NULLS LAST, r.serialnumber, r.business_date
      `,
      params
    );
    res.json({ data: result.rows, meta: { month, scope, count: result.rows.length } });
  } catch (err) {
    if (err.code === "42P01") return res.status(503).json({ error: "Roster tables not created. Run the roster migration." });
    console.error("ews roster month error:", err);
    res.status(400).json({ error: err.message });
  }
}

// PUT /ews/roster/bulk  { serialnumbers[], business_dates[], status?, half_day?, shift_override?, standard_hours_override? }
// Apply status/half-day ke kombinasi serialnumber × tanggal sekaligus (bulk select).
// Forward-only: semua tanggal harus >= hari ini (guard per tanggal).
async function bulkUpdateRoster(req, res) {
  try {
    const requestedCells = req.body?.cells;
    let cells;
    if (requestedCells !== undefined) {
      if (!Array.isArray(requestedCells)) return res.status(400).json({ error: "cells must be an array" });
      cells = requestedCells.map((cell) => ({
        serialnumber: clampText(cell?.serialnumber, "", 80),
        business_date: String(cell?.business_date || "").trim(),
      }));
    } else {
      if (!Array.isArray(req.body?.serialnumbers) || !Array.isArray(req.body?.business_dates)) {
        return res.status(400).json({ error: "cells or serialnumbers and business_dates arrays are required" });
      }
      const serialnumbers = req.body.serialnumbers.map((s) => clampText(s, "", 80)).filter(Boolean);
      const businessDates = req.body.business_dates.map((d) => String(d).trim()).filter(Boolean);
      cells = serialnumbers.flatMap((serialnumber) => businessDates.map((business_date) => ({ serialnumber, business_date })));
    }
    cells = [...new Map(cells.map((cell) => [`${cell.serialnumber}\0${cell.business_date}`, cell])).values()];
    const status = String(req.body?.status || "").toUpperCase();
    const hasHalfDay = req.body?.half_day !== undefined;
    const halfDay = Boolean(req.body?.half_day);
    const hasShiftOverride = Object.prototype.hasOwnProperty.call(req.body || {}, "shift_override");
    const shiftOverride = req.body?.shift_override == null || req.body.shift_override === ""
      ? null : String(req.body.shift_override).trim().toUpperCase();
    const hasHoursOverride = Object.prototype.hasOwnProperty.call(req.body || {}, "standard_hours_override");
    const hoursOverride = req.body?.standard_hours_override == null || req.body.standard_hours_override === ""
      ? null : Number(req.body.standard_hours_override);
    const updated_by = clampText(req.body?.updated_by, "ews-roster-ui", 120);

    if (!cells.length || cells.some((cell) => !cell.serialnumber || !cell.business_date)) {
      return res.status(400).json({ error: "Each cell requires serialnumber and business_date" });
    }
    if (status && !VALID_STATUS.has(status)) return res.status(400).json({ error: "Invalid status" });
    if (hasShiftOverride && shiftOverride !== null && shiftOverride !== "DAY" && shiftOverride !== "NIGHT") {
      return res.status(400).json({ error: "shift_override must be DAY, NIGHT, or null" });
    }
    if (hasHoursOverride && hoursOverride !== null && (!Number.isFinite(hoursOverride) || hoursOverride <= 0 || hoursOverride > 24)) {
      return res.status(400).json({ error: "standard_hours_override must be null or a number greater than 0 and at most 24" });
    }
    if (!status && !hasHalfDay && !hasShiftOverride && !hasHoursOverride) {
      return res.status(400).json({ error: "At least one roster change is required" });
    }
    for (const cell of cells) assertIsoDate(cell.business_date);

    const todayRes = await db.query(`SELECT (now() AT TIME ZONE $1)::date AS today`, [TZ]);
    const today = String(todayRes.rows[0].today).slice(0, 10);
    if (cells.some((cell) => cell.business_date < today)) {
      return res.status(400).json({
        error: "Past dates are frozen (adoption already counted). Only today or future dates can be updated.",
      });
    }

    const sets = [];
    const params = [JSON.stringify(cells)];
    if (status) {
      params.push(status);
      sets.push(`status = $${params.length}`);
    }
    if (hasHalfDay) {
      params.push(halfDay);
      sets.push(`half_day = $${params.length}`);
    }
    if (hasShiftOverride) {
      params.push(shiftOverride);
      sets.push(`shift_override = $${params.length}`);
    }
    if (hasHoursOverride) {
      params.push(hoursOverride);
      sets.push(`standard_hours_override = $${params.length}`);
    }
    params.push(updated_by);
    sets.push(`source = 'manual', updated_by = $${params.length}, updated_at = now()`);

    const result = await db.query(
      `UPDATE ews.shift_roster r SET ${sets.join(", ")}
       FROM jsonb_to_recordset($1::jsonb) AS cell(serialnumber text, business_date date)
       WHERE r.serialnumber = cell.serialnumber AND r.business_date = cell.business_date`,
      params
    );
    res.json({
      data: {
        rows_updated: result.rowCount,
        cells: cells.length,
        status: status || null,
        half_day: hasHalfDay ? halfDay : null,
        shift_override: hasShiftOverride ? shiftOverride : undefined,
        standard_hours_override: hasHoursOverride ? hoursOverride : undefined,
      },
    });
  } catch (err) {
    console.error("ews roster bulk error:", err);
    res.status(400).json({ error: err.message });
  }
}

// GET /ews/foreman-team — foremen (users role foreman) + members + semua operator NFC.
async function getForemanTeam(req, res) {
  try {
    const [foremen, members, operators] = await Promise.all([
      db.query(
        `SELECT id, username, name FROM public.users
         WHERE COALESCE(NULLIF(roles, ''), role) = 'foreman'
         ORDER BY lower(name), username`
      ),
      db.query(
        `SELECT ft.foreman_user_id, ft.member_serialnumber, u.full_name
         FROM ews.foreman_team ft
         LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb), '') = ft.member_serialnumber
         ORDER BY ft.member_serialnumber`
      ),
      db.query(
        `SELECT snssb, full_name FROM public.usernfc
         WHERE snssb IS NOT NULL AND btrim(snssb) <> '' AND full_name IS NOT NULL AND btrim(full_name) <> ''
           AND (inactive_from IS NULL OR inactive_from > (now() AT TIME ZONE $1)::date)
         ORDER BY lower(full_name), snssb`,
        [TZ]
      ),
    ]);
    res.json({
      data: {
        foremen: foremen.rows,
        members: members.rows,
        operators: operators.rows,
      },
    });
  } catch (err) {
    if (err.code === "42P01") return res.status(503).json({ error: "Foreman team table not created. Run the migration." });
    console.error("ews foreman team error:", err);
    res.status(500).json({ error: err.message });
  }
}

// PUT /ews/foreman-team/member  { foreman_user_id, member_serialnumber }
// Assign operator ke foreman (pindah: 1 operator = 1 foreman).
async function setForemanMember(req, res) {
  try {
    const foremanUserId = Number.parseInt(req.body?.foreman_user_id, 10);
    const memberSerialnumber = clampText(req.body?.member_serialnumber, "", 80);
    const created_by = clampText(req.body?.updated_by, "ews-roster-ui", 120);
    if (!Number.isInteger(foremanUserId) || foremanUserId < 1) {
      return res.status(400).json({ error: "foreman_user_id wajib diisi" });
    }
    if (!memberSerialnumber) return res.status(400).json({ error: "member_serialnumber wajib diisi" });

    const f = await db.query(
      `SELECT id FROM public.users WHERE id = $1 AND COALESCE(NULLIF(roles, ''), role) = 'foreman'`,
      [foremanUserId]
    );
    if (!f.rows.length) return res.status(404).json({ error: "Foreman tidak ditemukan (users role foreman)" });
    const m = await db.query(
      `SELECT 1 FROM public.usernfc WHERE NULLIF(BTRIM(snssb), '') = $1`,
      [memberSerialnumber]
    );
    if (!m.rows.length) return res.status(404).json({ error: "Operator NFC tidak ditemukan" });

    const client = await (db.pool || db).connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM ews.foreman_team WHERE member_serialnumber = $1`, [memberSerialnumber]);
      const ins = await client.query(
        `INSERT INTO ews.foreman_team (foreman_user_id, member_serialnumber, created_by)
         VALUES ($1, $2, $3) RETURNING id, foreman_user_id, member_serialnumber`,
        [foremanUserId, memberSerialnumber, created_by]
      );
      await client.query("COMMIT");
      res.json({ data: ins.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("ews foreman set member error:", err);
    res.status(400).json({ error: err.message });
  }
}

// DELETE /ews/foreman-team/member  { member_serialnumber }
async function removeForemanMember(req, res) {
  try {
    const memberSerialnumber = clampText(req.body?.member_serialnumber, "", 80);
    if (!memberSerialnumber) return res.status(400).json({ error: "member_serialnumber wajib diisi" });
    const result = await db.query(
      `DELETE FROM ews.foreman_team WHERE member_serialnumber = $1 RETURNING id, foreman_user_id, member_serialnumber`,
      [memberSerialnumber]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Member tidak ada di tim mana pun" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("ews foreman remove member error:", err);
    res.status(400).json({ error: err.message });
  }
}

// GET /ews/roster/config — shift defs, workday rules, active rotation config, group counts.
async function getConfig(req, res) {
  try {
    const [shifts, overrides, workdays, rotation, groups, members, roster] = await Promise.all([
      // Master tunggal: shift yang dipakai roster, diresolusi untuk hari ini. span_minutes =
      // rentang kehadiran, standard_minutes = jam kerja bersih, selisihnya waktu istirahat.
      db.query(`SELECT sd.roster_shift_code AS shift_code, sd.shift_code AS sow_shift_code,
                       sd.shift_name, sd.start_time::text, sd.end_time::text, sd.crosses_midnight,
                       sd.standard_hours, sd.default_capacity_hours, sd.is_active,
                       (sd.standard_hours * 60)::int AS standard_minutes,
                       (EXTRACT(EPOCH FROM (sd.end_time - sd.start_time)) / 60
                         + CASE WHEN sd.crosses_midnight THEN 1440 ELSE 0 END)::int AS span_minutes
                FROM public.resolve_shift_definition((now() AT TIME ZONE $1)::date) sd
                WHERE sd.roster_shift_code IS NOT NULL
                ORDER BY sd.start_time`, [TZ]),
      // Override tanggal (mis. shift pendek saat hari besar) — dibaca dari baris non-default.
      db.query(`SELECT sd.id, sd.shift_code AS sow_shift_code, sd.roster_shift_code AS shift_code,
                       sd.shift_name, sd.effective_date::text, sd.start_time::text, sd.end_time::text,
                       sd.crosses_midnight, sd.standard_hours, sd.is_active
                FROM public.shift_definition sd
                WHERE sd.roster_shift_code IS NOT NULL AND sd.effective_date IS NOT NULL
                ORDER BY sd.effective_date DESC, sd.shift_code`),
      db.query(`SELECT day_of_week, runs_day, runs_night FROM ews.roster_workday_rule ORDER BY day_of_week`),
      db.query(`SELECT id, anchor_week_start::text, anchor_group_a_shift, rotation_period_weeks, week_start_dow, effective_from::text, is_active FROM ews.rotation_config WHERE is_active ORDER BY effective_from DESC, id DESC LIMIT 1`),
      db.query(`SELECT rotation_group, COUNT(*)::int AS n FROM ews.operator_rotation_group GROUP BY rotation_group ORDER BY rotation_group`),
      db.query(`SELECT g.serialnumber, g.rotation_group, g.fixed_shift, g.fixed_shift_effective_from::text, u.full_name, u.inactive_from::text AS inactive_from
                FROM ews.operator_rotation_group g
                LEFT JOIN usernfc u ON u.snssb = g.serialnumber
                ORDER BY g.rotation_group, u.full_name NULLS LAST, g.serialnumber`),
      db.query(`SELECT u.snssb, u.full_name, g.rotation_group, g.fixed_shift,
                       CASE WHEN g.fixed_shift IS NOT NULL THEN 'fixed'
                            WHEN g.rotation_group IS NOT NULL THEN 'rotation'
                            ELSE 'unassigned' END AS assignment_status
                FROM usernfc u
                LEFT JOIN ews.operator_rotation_group g ON g.serialnumber = NULLIF(BTRIM(u.snssb), '')
                WHERE u.snssb IS NOT NULL AND btrim(u.snssb) <> '' AND u.full_name IS NOT NULL AND btrim(u.full_name) <> ''
                  AND (u.inactive_from IS NULL OR u.inactive_from > (now() AT TIME ZONE $1)::date)
                ORDER BY lower(u.full_name), u.snssb`, [TZ]),
    ]);
    res.json({
      data: {
        shifts: shifts.rows,
        shift_overrides: overrides.rows,
        workday_rules: workdays.rows,
        rotation_config: rotation.rows[0] || null,
        group_counts: groups.rows,
        group_members: members.rows,
        operators: roster.rows,
      },
    });
  } catch (err) {
    if (err.code === "42P01") return res.status(503).json({ error: "Roster tables not created. Run the roster migration." });
    console.error("ews roster config error:", err);
    res.status(500).json({ error: err.message });
  }
}

// PUT /ews/roster/config/workday  { day_of_week, runs_day, runs_night }
async function updateWorkday(req, res) {
  try {
    const dow = Number.parseInt(req.body?.day_of_week, 10);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) return res.status(400).json({ error: "day_of_week must be 0..6" });
    const result = await db.query(
      `UPDATE ews.roster_workday_rule SET runs_day = $2, runs_night = $3, updated_at = now()
       WHERE day_of_week = $1 RETURNING day_of_week, runs_day, runs_night`,
      [dow, Boolean(req.body?.runs_day), Boolean(req.body?.runs_night)],
    );
    if (!result.rows.length) return res.status(404).json({ error: "day_of_week not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("ews roster workday error:", err);
    res.status(400).json({ error: err.message });
  }
}

// PUT /ews/roster/group  { serialnumber, rotation_group, updated_by }
async function updateGroup(req, res) {
  try {
    const serialnumber = clampText(req.body?.serialnumber, "", 80);
    const group = String(req.body?.rotation_group || "").toUpperCase();
    const updated_by = clampText(req.body?.updated_by, "ews-roster-ui", 120);
    if (!serialnumber) return res.status(400).json({ error: "serialnumber is required" });
    // rotation_group kosong = UNASSIGN (hapus dari operator_rotation_group).
    if (group === "") {
      await db.query(`DELETE FROM ews.operator_rotation_group WHERE serialnumber = $1`, [serialnumber]);
      return res.json({ data: { serialnumber, rotation_group: null, source: null } });
    }
    if (group !== "A" && group !== "B") return res.status(400).json({ error: "rotation_group must be A or B" });
    const result = await db.query(
      `
      INSERT INTO ews.operator_rotation_group (serialnumber, rotation_group, source, effective_from, updated_by)
      VALUES ($1, $2, 'manual', (now() AT TIME ZONE $4)::date, $3)
      ON CONFLICT (serialnumber) DO UPDATE SET
        rotation_group = EXCLUDED.rotation_group, source = 'manual',
        updated_by = EXCLUDED.updated_by, updated_at = now()
      RETURNING serialnumber, rotation_group, source
      `,
      [serialnumber, group, updated_by, TZ],
    );
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("ews roster group error:", err);
    res.status(400).json({ error: err.message });
  }
}

// PUT /ews/roster/permanent-shift { serialnumber, fixed_shift: DAY|NIGHT|null, updated_by }
async function updatePermanentShift(req, res) {
  try {
    const serialnumber = clampText(req.body?.serialnumber, "", 80);
    const fixedShift = req.body?.fixed_shift == null || req.body.fixed_shift === ""
      ? null : String(req.body.fixed_shift).trim().toUpperCase();
    const updatedBy = clampText(req.body?.updated_by, "ews-roster-ui", 120);
    if (!serialnumber) return res.status(400).json({ error: "serialnumber is required" });
    if (fixedShift !== null && fixedShift !== "DAY" && fixedShift !== "NIGHT") {
      return res.status(400).json({ error: "fixed_shift must be DAY, NIGHT, or null" });
    }
    const result = await db.query(
      `UPDATE ews.operator_rotation_group
       SET fixed_shift = $2,
           fixed_shift_effective_from = CASE WHEN $2::text IS NULL THEN NULL ELSE (now() AT TIME ZONE $4)::date END,
           source = 'manual', updated_by = $3, updated_at = now()
       WHERE serialnumber = $1
       RETURNING serialnumber, rotation_group, fixed_shift, fixed_shift_effective_from::text, source`,
      [serialnumber, fixedShift, updatedBy, TZ],
    );
    if (!result.rows.length) return res.status(404).json({ error: "Operator is not assigned to the roster" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("ews roster permanent shift error:", err);
    res.status(400).json({ error: err.message });
  }
}

// POST /ews/roster/generate  { from, to }  (re)materialize forward roster for a range
async function generate(req, res) {
  try {
    const from = req.body?.from;
    const to = req.body?.to;
    assertIsoDate(from);
    assertIsoDate(to);
    const inserted = await generateRoster(from, to);
    res.json({ data: { from, to, rows_inserted: inserted } });
  } catch (err) {
    console.error("ews roster generate error:", err);
    res.status(400).json({ error: err.message });
  }
}

// POST /ews/roster/lock  { serialnumber, locked_shift, effective_from, lock_weeks, created_by }
// Shift-lock: pin an operator to DAY or NIGHT for N weeks, immune to the weekly crew flip. The lock is
// applied at read time by the VIEW ews.roster_effective (readers not switched yet). lock_end is computed
// in SQL from ews.rotation_config.week_start_dow (single source), snapped to the week boundary so it lines
// up with the flip. Forward-only: effective_from must be today or later (never lock historical dates —
// aligns with the never-regenerate rule). Anti-overlap is enforced by the DB EXCLUDE constraint.
async function setLock(req, res) {
  try {
    const serialnumber = clampText(req.body?.serialnumber, "", 80);
    const locked_shift = String(req.body?.locked_shift || "").trim().toUpperCase();
    const effective_from = req.body?.effective_from;
    const lock_weeks = Number.parseInt(req.body?.lock_weeks, 10);
    const created_by = clampText(req.body?.created_by, "ews-roster-ui", 120);

    if (!serialnumber) return res.status(400).json({ error: "serialnumber is required" });
    if (locked_shift !== "DAY" && locked_shift !== "NIGHT") {
      return res.status(400).json({ error: "locked_shift must be DAY or NIGHT" });
    }
    assertIsoDate(effective_from);
    if (!Number.isInteger(lock_weeks) || lock_weeks < 1) {
      return res.status(400).json({ error: "lock_weeks must be a positive integer" });
    }

    // Pre-flight (clean errors instead of raw DB failures): active config exists, operator is in the
    // rotation, and the start is not historical.
    const pre = await db.query(
      `SELECT
         (SELECT week_start_dow FROM ews.rotation_config WHERE is_active ORDER BY effective_from DESC, id DESC LIMIT 1) AS week_start_dow,
         ($1::date >= (now() AT TIME ZONE $3)::date) AS not_historical,
         EXISTS (SELECT 1 FROM ews.operator_rotation_group WHERE serialnumber = $2) AS operator_exists`,
      [effective_from, serialnumber, TZ],
    );
    const p = pre.rows[0] || {};
    if (p.week_start_dow === null || p.week_start_dow === undefined) {
      return res.status(503).json({ error: "No active rotation_config found" });
    }
    if (!p.operator_exists) return res.status(404).json({ error: "Operator tidak ada di rotation roster" });
    if (!p.not_historical) {
      return res.status(400).json({ error: "effective_from tidak boleh di masa lalu (lock forward-only)" });
    }

    // lock_end = week_start(effective_from) + lock_weeks*7, week_start_dow from the active rotation_config.
    const result = await db.query(
      `
      WITH cfg AS (
        SELECT week_start_dow FROM ews.rotation_config WHERE is_active ORDER BY effective_from DESC, id DESC LIMIT 1
      )
      INSERT INTO ews.operator_shift_lock (serialnumber, locked_shift, effective_from, lock_weeks, lock_end, created_by)
      SELECT $1, $2, $3::date, $4::int,
             ($3::date - ((EXTRACT(dow FROM $3::date)::int - cfg.week_start_dow + 7) % 7)) + $4::int * 7,
             $5
      FROM cfg
      RETURNING id, serialnumber, locked_shift, effective_from::text, lock_weeks, lock_end::text, created_by, created_at
      `,
      [serialnumber, locked_shift, effective_from, lock_weeks, created_by],
    );
    res.json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === "23P01") {
      return res.status(409).json({ error: "Operator sudah punya lock aktif yang tumpang tindih pada rentang tanggal itu" });
    }
    if (err.code === "23503") return res.status(400).json({ error: "locked_shift bukan shift yang dikenal" });
    if (err.code === "23514") return res.status(400).json({ error: "Nilai lock tidak valid (cek lock_weeks / lock_end)" });
    if (err.code === "42P01") return res.status(503).json({ error: "Tabel lock belum ada. Jalankan migration operator_shift_lock." });
    console.error("ews roster setLock error:", err);
    res.status(400).json({ error: err.message });
  }
}

// POST /ews/roster/lock/:id/cancel — soft-cancel (set cancelled_at), forward-only. A lock whose
// effective_from is already in the past cannot be cancelled (it is in effect / historical).
async function cancelLock(req, res) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "invalid lock id" });

    const result = await db.query(
      `
      UPDATE ews.operator_shift_lock
      SET cancelled_at = now()
      WHERE id = $1 AND cancelled_at IS NULL AND effective_from >= (now() AT TIME ZONE $2)::date
      RETURNING id, serialnumber, locked_shift, effective_from::text, lock_end::text, cancelled_at
      `,
      [id, TZ],
    );
    if (result.rows.length) return res.json({ data: result.rows[0] });

    // Nothing updated — say precisely why.
    const why = await db.query(
      `SELECT (cancelled_at IS NOT NULL) AS already_cancelled,
              (effective_from < (now() AT TIME ZONE $2)::date) AS already_started
       FROM ews.operator_shift_lock WHERE id = $1`,
      [id, TZ],
    );
    if (!why.rows.length) return res.status(404).json({ error: "Lock tidak ditemukan" });
    const w = why.rows[0];
    if (w.already_cancelled) return res.status(409).json({ error: "Lock sudah dibatalkan" });
    if (w.already_started) {
      return res.status(400).json({ error: "Tidak bisa membatalkan lock yang effective_from-nya sudah lewat (forward-only)" });
    }
    return res.status(400).json({ error: "Gagal membatalkan lock" });
  } catch (err) {
    if (err.code === "42P01") return res.status(503).json({ error: "Tabel lock belum ada. Jalankan migration operator_shift_lock." });
    console.error("ews roster cancelLock error:", err);
    res.status(400).json({ error: err.message });
  }
}

// GET /ews/roster/locks?all=1 — active (non-cancelled) locks by default; all=1 includes cancelled.
async function listLocks(req, res) {
  try {
    const includeAll = String(req.query.all || "") === "1";
    const result = await db.query(
      `
      SELECT l.id, l.serialnumber, l.locked_shift, l.effective_from::text, l.lock_weeks, l.lock_end::text,
             l.created_by, l.created_at, l.cancelled_at, u.full_name,
             (l.cancelled_at IS NULL AND l.lock_end > (now() AT TIME ZONE $1)::date) AS active_now
      FROM ews.operator_shift_lock l
      LEFT JOIN usernfc u ON u.snssb = l.serialnumber
      WHERE $2::boolean OR l.cancelled_at IS NULL
      ORDER BY l.effective_from DESC, l.serialnumber
      `,
      [TZ, includeAll],
    );
    res.json({ data: result.rows });
  } catch (err) {
    if (err.code === "42P01") return res.status(503).json({ error: "Tabel lock belum ada. Jalankan migration operator_shift_lock." });
    console.error("ews roster listLocks error:", err);
    res.status(500).json({ error: err.message });
  }
}

// ---- Master shift (single source) ---------------------------------------------------------
// public.shift_definition adalah satu-satunya master jadwal: jam shift, jam kerja bersih,
// dan override tanggal. Roster generator, heatmap, dan kalkulator adoption membacanya lewat
// public.resolve_shift_definition(date), jadi perubahan di sini langsung ikut terpakai.
const ROSTER_SHIFT_CODES = new Set(["DAY", "NIGHT"]);

function normalizeClock(value, field) {
  const text = String(value ?? "").trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    const error = new Error(`${field} must be HH:MM`);
    error.status = 400;
    throw error;
  }
  return text;
}

// PUT /ews/roster/shift
// { shift_code: DAY|NIGHT, start_time?, end_time?, crosses_midnight?, standard_hours?, is_active?, updated_by? }
async function updateShiftMaster(req, res) {
  try {
    const shiftCode = String(req.body?.shift_code || "").trim().toUpperCase();
    if (!ROSTER_SHIFT_CODES.has(shiftCode)) {
      return res.status(400).json({ error: "shift_code must be DAY or NIGHT" });
    }
    const sets = [];
    const params = [shiftCode];
    const body = req.body || {};
    if (body.start_time !== undefined) {
      params.push(normalizeClock(body.start_time, "start_time"));
      sets.push(`start_time = $${params.length}::time`);
    }
    if (body.end_time !== undefined) {
      params.push(normalizeClock(body.end_time, "end_time"));
      sets.push(`end_time = $${params.length}::time`);
    }
    if (body.crosses_midnight !== undefined) {
      params.push(Boolean(body.crosses_midnight));
      sets.push(`crosses_midnight = $${params.length}`);
    }
    if (body.standard_hours !== undefined) {
      const hours = Number(body.standard_hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
        return res.status(400).json({ error: "standard_hours must be greater than 0 and at most 24" });
      }
      params.push(hours);
      sets.push(`standard_hours = $${params.length}`);
    }
    if (body.is_active !== undefined) {
      params.push(Boolean(body.is_active));
      sets.push(`is_active = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: "At least one shift field is required" });
    sets.push(`updated_at = now()`);

    const result = await db.query(
      `UPDATE public.shift_definition
          SET ${sets.join(", ")}
        WHERE roster_shift_code = $1 AND is_default = true
        RETURNING id, shift_code AS sow_shift_code, roster_shift_code AS shift_code, shift_name,
                  start_time::text, end_time::text, crosses_midnight, standard_hours,
                  default_capacity_hours, is_active,
                  (standard_hours * 60)::int AS standard_minutes,
                  (EXTRACT(EPOCH FROM (end_time - start_time)) / 60
                    + CASE WHEN crosses_midnight THEN 1440 ELSE 0 END)::int AS span_minutes`,
      params,
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: `No default shift row mapped to ${shiftCode}` });
    }
    res.json({ data: result.rows[0] });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error("ews roster shift update error:", err);
    res.status(400).json({ error: err.message });
  }
}

// Filter baris future yang aman disinkronkan ke master: hasil generate, masih SCHEDULED,
// tanpa override operator / half-day / lock.
const RESYNCABLE_SQL = `
  r.source = 'auto' AND r.status = 'SCHEDULED'
  AND r.shift_override IS NULL AND r.standard_hours_override IS NULL
  AND COALESCE(r.half_day, false) = false AND NOT e.shift_locked`;

// GET /ews/roster/shift/impact?shift_code=DAY
// Pratinjau dampak master saat ini: berapa baris future berbeda dari master, berapa aman
// di-resync, dan berapa yang dilewati karena override/lock/manual.
async function getShiftImpact(req, res) {
  try {
    const shiftCode = String(req.query?.shift_code || "").trim().toUpperCase();
    if (shiftCode && !ROSTER_SHIFT_CODES.has(shiftCode)) {
      return res.status(400).json({ error: "shift_code must be DAY or NIGHT" });
    }
    const result = await db.query(
      `WITH t AS (SELECT (now() AT TIME ZONE $2)::date AS today),
       rows AS (
         SELECT r.serialnumber, r.business_date, r.scheduled_shift, r.scheduled_standard_hours,
                COALESCE(r.shift_override, r.scheduled_shift) AS eff_code,
                (${RESYNCABLE_SQL}) AS resyncable
         FROM ews.shift_roster r
         JOIN ews.roster_effective e USING (serialnumber, business_date)
         CROSS JOIN t
         WHERE r.business_date >= t.today
           AND ($1::text IS NULL OR COALESCE(r.shift_override, r.scheduled_shift) = $1::text)
       ),
       master AS (
         SELECT r.serialnumber, r.business_date, m.roster_shift_code AS code, m.standard_hours
         FROM rows r
         CROSS JOIN LATERAL public.resolve_shift_definition(r.business_date) m
         WHERE m.roster_shift_code IS NOT NULL AND m.roster_shift_code = r.eff_code
       )
       SELECT COUNT(*)::int AS future_rows,
              COUNT(*) FILTER (WHERE m.code IS NOT NULL
                AND (r.scheduled_shift IS DISTINCT FROM m.code
                     OR r.scheduled_standard_hours IS DISTINCT FROM m.standard_hours))::int AS differing_rows,
              COUNT(*) FILTER (WHERE r.resyncable AND m.code IS NOT NULL
                AND (r.scheduled_shift IS DISTINCT FROM m.code
                     OR r.scheduled_standard_hours IS DISTINCT FROM m.standard_hours))::int AS resyncable_rows,
              COUNT(*) FILTER (WHERE NOT r.resyncable)::int AS skipped_rows
         FROM rows r
         LEFT JOIN master m ON m.serialnumber = r.serialnumber AND m.business_date = r.business_date`,
      [shiftCode || null, TZ],
    );
    res.json({ data: { shift_code: shiftCode || null, ...result.rows[0] } });
  } catch (err) {
    console.error("ews roster shift impact error:", err);
    res.status(400).json({ error: err.message });
  }
}

// PUT /ews/roster/shift/resync-future { updated_by? }
// Menyamakan snapshot baris future (hasil generate) dengan master terbaru. Forward-only dan
// hanya baris bersih; baris dengan override/lock/half-day/manual tidak disentuh.
async function resyncFutureShifts(req, res) {
  try {
    const updatedBy = clampText(req.body?.updated_by, "ews-roster-ui", 120);
    const result = await db.query(
      `WITH t AS (SELECT (now() AT TIME ZONE $2)::date AS today),
       target AS (
         SELECT r.serialnumber, r.business_date, m.roster_shift_code AS code, m.standard_hours AS std
         FROM ews.shift_roster r
         JOIN ews.roster_effective e USING (serialnumber, business_date)
         CROSS JOIN t
         CROSS JOIN LATERAL public.resolve_shift_definition(r.business_date) m
         WHERE r.business_date >= t.today
           AND ${RESYNCABLE_SQL}
           AND m.roster_shift_code IS NOT NULL
           AND m.roster_shift_code = COALESCE(r.shift_override, r.scheduled_shift)
           AND (r.scheduled_shift IS DISTINCT FROM m.roster_shift_code
                OR r.scheduled_standard_hours IS DISTINCT FROM m.standard_hours)
       )
       UPDATE ews.shift_roster s
          SET scheduled_shift = t.code,
              scheduled_standard_hours = t.std,
              updated_by = $1,
              updated_at = now()
         FROM target t
        WHERE s.serialnumber = t.serialnumber AND s.business_date = t.business_date`,
      [updatedBy, TZ],
    );
    res.json({ data: { rows_updated: result.rowCount, updated_by: updatedBy } });
  } catch (err) {
    console.error("ews roster shift resync error:", err);
    res.status(400).json({ error: err.message });
  }
}

module.exports = { getRoster, getRosterMonth, updateStatus, updateHalfDay, deleteRoster, bulkUpdateRoster, getConfig, updateWorkday, updateGroup, updatePermanentShift, updateShiftMaster, getShiftImpact, resyncFutureShifts, generate, setLock, cancelLock, listLocks, getForemanTeam, setForemanMember, removeForemanMember };
