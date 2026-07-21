const db = global.pool || require("../db");
const { generateRoster } = require("../services/rosterGenerator");
const { resolveTimezone } = require("../config/timezone");

const VALID_STATUS = new Set(["SCHEDULED", "OFF", "LEAVE", "SICK", "PERMIT"]);
const TZ = resolveTimezone();

function assertIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) throw new Error("Invalid date. Use YYYY-MM-DD.");
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
             r.status, r.source, r.updated_by,
             COALESCE(lg.recorded, 0)::float AS recorded_hours,
             ((r.business_date + os.end_time
               + CASE WHEN os.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) <= now() AS completed,
             CASE WHEN r.status <> 'SCHEDULED' THEN r.status
                  WHEN ((r.business_date + os.end_time + CASE WHEN os.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) > now() THEN 'IN_PROGRESS'
                  WHEN COALESCE(lg.recorded, 0) > 0 THEN 'PRESENT'
                  ELSE 'ABSENT' END AS attendance
      FROM ews.roster_effective r
      JOIN ews.operator_shift os ON os.shift_code = r.eff_shift
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

// GET /ews/roster/config — shift defs, workday rules, active rotation config, group counts.
async function getConfig(req, res) {
  try {
    const [shifts, workdays, rotation, groups, members] = await Promise.all([
      db.query(`SELECT shift_code, shift_name, start_time::text, end_time::text, crosses_midnight, standard_hours, is_active FROM ews.operator_shift ORDER BY shift_code`),
      db.query(`SELECT day_of_week, runs_day, runs_night FROM ews.roster_workday_rule ORDER BY day_of_week`),
      db.query(`SELECT id, anchor_week_start::text, anchor_group_a_shift, rotation_period_weeks, week_start_dow, effective_from::text, is_active FROM ews.rotation_config WHERE is_active ORDER BY effective_from DESC, id DESC LIMIT 1`),
      db.query(`SELECT rotation_group, COUNT(*)::int AS n FROM ews.operator_rotation_group GROUP BY rotation_group ORDER BY rotation_group`),
      db.query(`SELECT g.serialnumber, g.rotation_group, u.full_name
                FROM ews.operator_rotation_group g
                LEFT JOIN usernfc u ON u.snssb = g.serialnumber
                ORDER BY g.rotation_group, u.full_name NULLS LAST, g.serialnumber`),
    ]);
    res.json({
      data: {
        shifts: shifts.rows,
        workday_rules: workdays.rows,
        rotation_config: rotation.rows[0] || null,
        group_counts: groups.rows,
        group_members: members.rows,
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

module.exports = { getRoster, updateStatus, getConfig, updateWorkday, updateGroup, generate, setLock, cancelLock, listLocks };
