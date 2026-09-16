const db = global.pool || require("../db");

// Shared resolver: an exception applies to its exact date only, otherwise use the weekday rule.
const EFFECTIVE_CALENDAR_SQL = `effective_calendar AS (
  SELECT d.bd,
         COALESCE(ce.runs_day, wr.runs_day) AS runs_day,
         COALESCE(ce.runs_night, wr.runs_night) AS runs_night
  FROM dates d
  JOIN ews.roster_workday_rule wr ON wr.day_of_week = EXTRACT(dow FROM d.bd)::int
  LEFT JOIN ews.roster_calendar_exception ce ON ce.business_date = d.bd
)`;

// Materialize ews.shift_roster for a date range from the rotation config, group assignments,
// shift definitions and the working-day rules. Set-based, forward-only:
//   ON CONFLICT DO NOTHING means existing rows (incl. manual foreman edits) are never overwritten.
// Rotation: two groups flip every rotation_period_weeks at the week boundary. A row is created
// only for (operator, date, shift) that the workday rule enables for that day-of-week; other
// days are simply absent (no row = not scheduled, so not counted as absence).
const GENERATE_SQL = `
WITH cfg AS (
  SELECT anchor_week_start, anchor_group_a_shift, rotation_period_weeks, week_start_dow
  FROM ews.rotation_config
  WHERE is_active
  ORDER BY effective_from DESC, id DESC
  LIMIT 1
),
dates AS (
  SELECT generate_series($1::date, $2::date, interval '1 day')::date AS bd
),
${EFFECTIVE_CALENDAR_SQL},
weeks AS (
  SELECT d.bd,
    d.bd - ((EXTRACT(dow FROM d.bd)::int - c.week_start_dow + 7) % 7) AS week_start,
    c.anchor_week_start, c.anchor_group_a_shift, c.rotation_period_weeks
  FROM dates d CROSS JOIN cfg c
),
parity AS (
  SELECT w.bd, w.anchor_group_a_shift,
    (((((w.week_start - w.anchor_week_start) / 7) / GREATEST(w.rotation_period_weeks, 1)) % 2) + 2) % 2 AS cycle_parity
  FROM weeks w
),
gshift AS (
  SELECT p.bd,
    CASE WHEN p.cycle_parity = 0 THEN p.anchor_group_a_shift
         ELSE CASE WHEN p.anchor_group_a_shift = 'DAY' THEN 'NIGHT' ELSE 'DAY' END END AS group_a_shift,
    CASE WHEN p.cycle_parity = 0
         THEN CASE WHEN p.anchor_group_a_shift = 'DAY' THEN 'NIGHT' ELSE 'DAY' END
         ELSE p.anchor_group_a_shift END AS group_b_shift
  FROM parity p
),
op_date AS (
  -- Exclude operators inactive AS OF each generated date: no NEW rows on/after inactive_from.
  -- LEFT JOIN so operators without a usernfc row are kept (inactive_from IS NULL). Existing frozen
  -- rows are never touched (ON CONFLICT DO NOTHING below); this only stops fresh rows being added.
  SELECT g.bd, org.serialnumber,
    COALESCE(org.fixed_shift,
      CASE WHEN org.rotation_group = 'A' THEN g.group_a_shift ELSE g.group_b_shift END
    ) AS shift_code
  FROM gshift g
  CROSS JOIN LATERAL (
    SELECT base.serialnumber, base.rotation_group,
           CASE WHEN base.fixed_shift_effective_from <= g.bd THEN base.fixed_shift END AS fixed_shift
    FROM ews.operator_rotation_group base
  ) org
  LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb), '') = org.serialnumber
  WHERE u.inactive_from IS NULL OR g.bd < u.inactive_from
),
scheduled AS (
  -- Master tunggal: jam kerja bersih diambil dari public.shift_definition (termasuk
  -- override tanggal), bukan dari snapshot tabel lama ews.operator_shift.
  SELECT od.bd, od.serialnumber, od.shift_code, sd.standard_hours
  FROM op_date od
  JOIN effective_calendar ec ON ec.bd = od.bd
  JOIN public.resolve_shift_definition(od.bd) sd ON sd.roster_shift_code = od.shift_code
  WHERE (od.shift_code = 'DAY' AND ec.runs_day)
     OR (od.shift_code = 'NIGHT' AND ec.runs_night)
)
INSERT INTO ews.shift_roster
  (serialnumber, business_date, scheduled_shift, scheduled_standard_hours, status, source)
SELECT s.serialnumber, s.bd, s.shift_code, s.standard_hours, 'SCHEDULED', 'auto'
FROM scheduled s
ON CONFLICT (serialnumber, business_date) DO NOTHING
`;

async function generateRoster(fromDate, toDate) {
  const result = await db.query(GENERATE_SQL, [fromDate, toDate]);
  return result.rowCount;
}

const ROSTER_PLAN_SQL = `
cfg AS (
  SELECT anchor_week_start, anchor_group_a_shift, rotation_period_weeks, week_start_dow
  FROM ews.rotation_config WHERE is_active
  ORDER BY effective_from DESC, id DESC LIMIT 1
),
dates AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS bd),
${EFFECTIVE_CALENDAR_SQL},
group_shift AS (
  SELECT d.bd,
    CASE WHEN ((((((d.bd - ((EXTRACT(dow FROM d.bd)::int - c.week_start_dow + 7) % 7)) - c.anchor_week_start) / 7)
      / GREATEST(c.rotation_period_weeks, 1)) % 2) + 2) % 2 = 0
      THEN c.anchor_group_a_shift ELSE CASE WHEN c.anchor_group_a_shift = 'DAY' THEN 'NIGHT' ELSE 'DAY' END END AS a_shift
  FROM dates d CROSS JOIN cfg c
),
desired AS (
  SELECT org.serialnumber, g.bd AS business_date,
    COALESCE(CASE WHEN org.fixed_shift_effective_from <= g.bd THEN org.fixed_shift END,
      CASE WHEN org.rotation_group = 'A' THEN g.a_shift ELSE CASE WHEN g.a_shift = 'DAY' THEN 'NIGHT' ELSE 'DAY' END END) AS shift_code,
    sd.standard_hours
  FROM group_shift g
  JOIN effective_calendar ec ON ec.bd = g.bd
  CROSS JOIN ews.operator_rotation_group org
  LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb), '') = org.serialnumber
  CROSS JOIN LATERAL public.resolve_shift_definition(g.bd) sd
  WHERE sd.roster_shift_code = COALESCE(CASE WHEN org.fixed_shift_effective_from <= g.bd THEN org.fixed_shift END,
      CASE WHEN org.rotation_group = 'A' THEN g.a_shift ELSE CASE WHEN g.a_shift = 'DAY' THEN 'NIGHT' ELSE 'DAY' END END)
    AND (u.inactive_from IS NULL OR g.bd < u.inactive_from)
    AND ((sd.roster_shift_code = 'DAY' AND ec.runs_day) OR (sd.roster_shift_code = 'NIGHT' AND ec.runs_night))
),
t AS (SELECT (now() AT TIME ZONE $3)::date AS today),
existing AS (
  SELECT r.*,
    (r.business_date >= t.today AND r.source = 'auto' AND r.status = 'SCHEDULED'
      AND COALESCE(r.half_day, false) = false AND r.shift_override IS NULL
      AND r.standard_hours_override IS NULL) AS safe
  FROM ews.shift_roster r CROSS JOIN t
  WHERE r.business_date BETWEEN $1::date AND $2::date
),
changes AS (
  SELECT COALESCE(d.serialnumber, e.serialnumber) AS serialnumber,
    COALESCE(d.business_date, e.business_date) AS business_date,
    d.shift_code, d.standard_hours, e.safe,
    CASE WHEN e.serialnumber IS NULL AND d.business_date >= t.today THEN 'add'
         WHEN d.serialnumber IS NULL AND e.safe THEN 'remove'
         WHEN d.serialnumber IS NOT NULL AND e.safe AND
           (e.scheduled_shift IS DISTINCT FROM d.shift_code OR e.scheduled_standard_hours IS DISTINCT FROM d.standard_hours) THEN 'update'
         WHEN e.serialnumber IS NOT NULL AND
           (d.serialnumber IS NULL OR e.scheduled_shift IS DISTINCT FROM d.shift_code
             OR e.scheduled_standard_hours IS DISTINCT FROM d.standard_hours) THEN 'protected'
    END AS action
  FROM desired d
  FULL JOIN existing e USING (serialnumber, business_date)
  CROSS JOIN t
)`;

const PREVIEW_SQL = `WITH ${ROSTER_PLAN_SQL}
SELECT COUNT(*) FILTER (WHERE action = 'add')::int AS rows_added,
       COUNT(*) FILTER (WHERE action = 'update')::int AS rows_updated,
       COUNT(*) FILTER (WHERE action = 'remove')::int AS rows_removed,
       COUNT(*) FILTER (WHERE action = 'protected')::int AS rows_protected,
       COALESCE(json_agg(DISTINCT business_date::text) FILTER (WHERE action = 'protected'), '[]') AS protected_dates
FROM changes`;

const APPLY_SQL = `WITH ${ROSTER_PLAN_SQL},
deleted AS (
  DELETE FROM ews.shift_roster r USING changes c
  WHERE c.action = 'remove' AND r.serialnumber = c.serialnumber AND r.business_date = c.business_date
  RETURNING 1
),
updated AS (
  UPDATE ews.shift_roster r SET scheduled_shift = c.shift_code,
    scheduled_standard_hours = c.standard_hours, updated_by = $4, updated_at = now()
  FROM changes c WHERE c.action = 'update' AND r.serialnumber = c.serialnumber AND r.business_date = c.business_date
  RETURNING 1
),
inserted AS (
  INSERT INTO ews.shift_roster (serialnumber, business_date, scheduled_shift, scheduled_standard_hours, status, source, updated_by)
  SELECT serialnumber, business_date, shift_code, standard_hours, 'SCHEDULED', 'auto', $4
  FROM changes WHERE action = 'add'
  ON CONFLICT (serialnumber, business_date) DO NOTHING RETURNING 1
)
SELECT (SELECT COUNT(*)::int FROM inserted) AS rows_added,
       (SELECT COUNT(*)::int FROM updated) AS rows_updated,
       (SELECT COUNT(*)::int FROM deleted) AS rows_removed,
       (SELECT COUNT(*)::int FROM changes WHERE action = 'protected') AS rows_protected`;

async function previewRoster(fromDate, toDate, queryable = db) {
  const result = await queryable.query(PREVIEW_SQL, [fromDate, toDate, require("../config/timezone").resolveTimezone()]);
  return result.rows[0];
}

async function applyRoster(fromDate, toDate, updatedBy, queryable) {
  const result = await queryable.query(APPLY_SQL, [fromDate, toDate, require("../config/timezone").resolveTimezone(), updatedBy]);
  return result.rows[0];
}

module.exports = { generateRoster, previewRoster, applyRoster, GENERATE_SQL, EFFECTIVE_CALENDAR_SQL, ROSTER_PLAN_SQL, PREVIEW_SQL, APPLY_SQL };
