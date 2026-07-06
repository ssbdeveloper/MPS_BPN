const db = global.pool || require("../db");
const { generateRoster } = require("../services/rosterGenerator");

const VALID_STATUS = new Set(["SCHEDULED", "OFF", "LEAVE", "SICK", "PERMIT"]);
const TZ = process.env.TIMEZONE || "Asia/Makassar";

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
      SELECT r.serialnumber, u.full_name AS operator_name, r.scheduled_shift, r.scheduled_standard_hours,
             r.status, r.source, r.updated_by,
             COALESCE(lg.recorded, 0)::float AS recorded_hours,
             ((r.business_date + os.end_time
               + CASE WHEN os.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) <= now() AS completed,
             CASE WHEN r.status <> 'SCHEDULED' THEN r.status
                  WHEN ((r.business_date + os.end_time + CASE WHEN os.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) > now() THEN 'IN_PROGRESS'
                  WHEN COALESCE(lg.recorded, 0) > 0 THEN 'PRESENT'
                  ELSE 'ABSENT' END AS attendance
      FROM ews.shift_roster r
      JOIN ews.operator_shift os ON os.shift_code = r.scheduled_shift
      LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb), '') = r.serialnumber
      LEFT JOIN logged lg ON lg.op = r.serialnumber
      WHERE r.business_date = $1::date
      ORDER BY r.scheduled_shift, u.full_name NULLS LAST, r.serialnumber
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
    const [shifts, workdays, rotation, groups] = await Promise.all([
      db.query(`SELECT shift_code, shift_name, start_time::text, end_time::text, crosses_midnight, standard_hours, is_active FROM ews.operator_shift ORDER BY shift_code`),
      db.query(`SELECT day_of_week, runs_day, runs_night FROM ews.roster_workday_rule ORDER BY day_of_week`),
      db.query(`SELECT id, anchor_week_start::text, anchor_group_a_shift, rotation_period_weeks, week_start_dow, effective_from::text, is_active FROM ews.rotation_config WHERE is_active ORDER BY effective_from DESC, id DESC LIMIT 1`),
      db.query(`SELECT rotation_group, COUNT(*)::int AS n FROM ews.operator_rotation_group GROUP BY rotation_group ORDER BY rotation_group`),
    ]);
    res.json({
      data: {
        shifts: shifts.rows,
        workday_rules: workdays.rows,
        rotation_config: rotation.rows[0] || null,
        group_counts: groups.rows,
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

module.exports = { getRoster, updateStatus, getConfig, updateWorkday, updateGroup, generate };
