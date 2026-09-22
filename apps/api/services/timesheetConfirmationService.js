"use strict";

const OFF_SHIFT_STATUSES = ["OFF", "LEAVE", "SICK", "PERMIT", "SITE_VISIT"];
const MAX_ANOMALY_HOURS = 24;
const DEFERRED_CONFIRMATION_CODES = new Set([
  "PH3_MISSING",
  "PH3_AMBIGUOUS",
  "PH3_INVALID",
  "ROSTER_MISSING",
]);

class ConfirmationCheckoutError extends Error {
  constructor(code, message, statusCode = 409, details = {}) {
    super(message);
    this.name = "ConfirmationCheckoutError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizeText = (value) => String(value ?? "").trim();

const isProductiveRow = (row) => {
  if (normalizeText(row.activitytype)) return false;
  if (normalizeText(row.order_no) || row.operation_no != null) return true;
  return !/^\s*\d{4}/.test(normalizeText(row.operation_text));
};

const assertRuntimeContext = (configuredTimezone, expectedPlant, row) => {
  if (!row) {
    throw new ConfirmationCheckoutError(
      "PLANT_CONFIG_MISSING",
      "Konfigurasi plant tidak ditemukan; checkout dibatalkan.",
      503,
    );
  }
  const databasePlant = normalizeText(row.plant_code);
  const databaseTimezone = normalizeText(row.timezone);
  if (databasePlant !== normalizeText(expectedPlant)) {
    throw new ConfirmationCheckoutError(
      "PLANT_MISMATCH",
      `PLANT_SSB ${expectedPlant} berbeda dari plant_config ${databasePlant}.`,
      503,
    );
  }
  if (!configuredTimezone || configuredTimezone !== databaseTimezone) {
    throw new ConfirmationCheckoutError(
      "TIMEZONE_MISMATCH",
      `TIMEZONE ${configuredTimezone || "(kosong)"} berbeda dari plant_config ${databaseTimezone}.`,
      503,
    );
  }
  return databaseTimezone;
};

const CLASSIFICATION_SQL = `
WITH source AS (
  SELECT
    t.*,
    t.longdate_checkin AT TIME ZONE $2 AS ci_local,
    t.longdate_checkout AT TIME ZONE $2 AS co_local,
    (
      t.date_checkin IS NOT DISTINCT FROM
        to_char(t.longdate_checkin AT TIME ZONE $2, 'DD/MM/YYYY')
      AND t.hour_checkin IS NOT DISTINCT FROM
        to_char(t.longdate_checkin AT TIME ZONE $2, 'HH24:MI')
      AND t.date_checkout IS NOT DISTINCT FROM
        to_char(t.longdate_checkout AT TIME ZONE $2, 'DD/MM/YYYY')
      AND t.hour_checkout IS NOT DISTINCT FROM
        to_char(t.longdate_checkout AT TIME ZONE $2, 'HH24:MI')
    ) AS clock_consistent
  FROM public.timesheet_transaction t
  WHERE t.tsnumber = $1
),
ph3_matches AS MATERIALIZED (
  SELECT DISTINCT NULLIF(BTRIM(p.confirmation_number), '') AS confirmation_base
  FROM public.ph3_order p
  CROSS JOIN source s
  WHERE NULLIF(BTRIM(p.confirmation_number), '') IS NOT NULL
    AND CASE
          WHEN NULLIF(BTRIM(p.order_no), '') IS NULL THEN NULL
          WHEN BTRIM(p.order_no) ~ '^[0-9]+$'
            THEN COALESCE(NULLIF(LTRIM(BTRIM(p.order_no), '0'), ''), '0')
          ELSE BTRIM(p.order_no)
        END = CASE
          WHEN NULLIF(BTRIM(s.order_no), '') IS NULL THEN NULL
          WHEN BTRIM(s.order_no) ~ '^[0-9]+$'
            THEN COALESCE(NULLIF(LTRIM(BTRIM(s.order_no), '0'), ''), '0')
          ELSE BTRIM(s.order_no)
        END
    AND CASE
          WHEN NULLIF(BTRIM(p.operation_no), '') IS NULL THEN NULL
          WHEN BTRIM(p.operation_no) ~ '^[0-9]+$'
            THEN COALESCE(NULLIF(LTRIM(BTRIM(p.operation_no), '0'), ''), '0')
          ELSE BTRIM(p.operation_no)
        END = CASE
          WHEN s.operation_no IS NULL THEN NULL
          ELSE COALESCE(NULLIF(LTRIM(s.operation_no::text, '0'), ''), '0')
        END
),
ph3_summary AS (
  SELECT MIN(confirmation_base) AS confirmation_base,
         COUNT(*)::int AS confirmation_count
  FROM ph3_matches
),
windows AS (
  SELECT
    re.business_date,
    re.status AS roster_status,
    re.eff_shift,
    re.business_date + re.start_time AS shift_start_local,
    re.business_date + re.end_time
      + CASE WHEN re.crosses_midnight THEN interval '1 day' ELSE interval '0' END
      AS shift_end_local,
    (re.business_date + re.start_time) AT TIME ZONE $2 AS shift_start_ts,
    (re.business_date + re.end_time
      + CASE WHEN re.crosses_midnight THEN interval '1 day' ELSE interval '0' END)
      AT TIME ZONE $2 AS shift_end_ts
  FROM ews.roster_effective re
  CROSS JOIN source s
  WHERE re.serialnumber = s.serialnumber
    AND re.business_date BETWEEN (s.ci_local::date - 1) AND s.co_local::date
),
window_stats AS (
  SELECT
    COUNT(w.business_date)::int AS roster_count,
    COUNT(*) FILTER (
      WHERE s.ci_local < w.shift_end_local
        AND s.co_local > w.shift_start_local
    )::int AS intersecting_count
  FROM source s
  LEFT JOIN windows w ON true
),
picked AS (
  SELECT w.*
  FROM windows w
  CROSS JOIN source s
  ORDER BY
    CASE WHEN s.ci_local < w.shift_end_local AND s.co_local > w.shift_start_local
         THEN 0 ELSE 1 END,
    CASE WHEN s.ci_local >= w.shift_start_local AND s.ci_local < w.shift_end_local
         THEN 0 ELSE 1 END,
    ABS(EXTRACT(EPOCH FROM (s.ci_local - w.shift_start_local)))
  LIMIT 1
),
regular_windows AS (
  SELECT
    GREATEST(s.longdate_checkin, w.shift_start_ts) AS regular_start,
    LEAST(s.longdate_checkout, w.shift_end_ts) AS regular_end
  FROM windows w
  CROSS JOIN source s
  WHERE COALESCE(w.roster_status, '') <> ALL($3::text[])
    AND s.longdate_checkin < w.shift_end_ts
    AND s.longdate_checkout > w.shift_start_ts
),
facts AS (
  SELECT
    s.*,
    p.confirmation_base,
    p.confirmation_count,
    ws.roster_count,
    ws.intersecting_count,
    w.business_date,
    w.roster_status,
    w.eff_shift,
    w.shift_start_local,
    w.shift_end_local,
    w.shift_start_ts,
    w.shift_end_ts,
    COALESCE(NULLIF(LTRIM(BTRIM(s.order_no), '0'), ''), '0') LIKE '32%' AS is_rework
  FROM source s
  CROSS JOIN ph3_summary p
  CROSS JOIN window_stats ws
  LEFT JOIN picked w ON true
),
decision AS (
  SELECT
    f.*,
    CASE
      WHEN f.longdate_checkin IS NULL THEN 'CHECKIN_MISSING'
      WHEN f.longdate_checkout IS NULL THEN 'OPEN'
      WHEN f.longdate_checkout <= f.longdate_checkin THEN 'INVALID_INTERVAL'
      WHEN f.longdate_checkout - f.longdate_checkin > interval '${MAX_ANOMALY_HOURS} hours'
        THEN 'ANOMALY'
      WHEN NOT f.clock_consistent THEN 'CLOCK_MISMATCH'
      WHEN COALESCE(f.state_flag, 0) = 5 THEN 'SOURCE_DELETED'
      WHEN NULLIF(BTRIM(f.confirmationnumber), '') IS NOT NULL
        THEN 'CONFIRMATION_PRESENT'
      WHEN COALESCE(BTRIM(f.plant::text), '') <> $4 THEN 'PLANT_ROW_MISMATCH'
      WHEN f.confirmation_count = 0 THEN 'PH3_MISSING'
      WHEN f.confirmation_count > 1 THEN 'PH3_AMBIGUOUS'
      WHEN f.confirmation_base !~ '^[0-9]+$' THEN 'PH3_INVALID'
      WHEN f.roster_count = 0 THEN 'ROSTER_MISSING'
      ELSE NULL
    END AS block_reason
  FROM facts f
),
boundaries AS (
  SELECT d.longdate_checkin AS boundary
  FROM decision d
  WHERE d.block_reason IS NULL

  UNION

  SELECT d.longdate_checkout
  FROM decision d
  WHERE d.block_reason IS NULL

  UNION

  SELECT rw.regular_start
  FROM regular_windows rw

  UNION

  SELECT rw.regular_end
  FROM regular_windows rw
),
boundary_pairs AS (
  SELECT
    ROW_NUMBER() OVER (ORDER BY boundary) AS segment_order,
    boundary AS segment_start,
    LEAD(boundary) OVER (ORDER BY boundary) AS segment_end
  FROM boundaries
),
classified_segments AS (
  SELECT
    bp.segment_order,
    CASE
      WHEN d.is_rework THEN 'RW'
      WHEN EXISTS (
        SELECT 1
        FROM regular_windows rw
        WHERE bp.segment_start < rw.regular_end
          AND bp.segment_end > rw.regular_start
      ) THEN 'RG'
      ELSE 'OV'
    END AS suffix,
    bp.segment_start,
    bp.segment_end
  FROM boundary_pairs bp
  CROSS JOIN decision d
  WHERE bp.segment_end > bp.segment_start
),
segment_transitions AS (
  SELECT
    cs.*,
    CASE
      WHEN cs.suffix IS DISTINCT FROM LAG(cs.suffix) OVER (ORDER BY cs.segment_order)
        THEN 1
      ELSE 0
    END AS starts_group
  FROM classified_segments cs
),
segment_grouped AS (
  SELECT
    st.*,
    SUM(st.starts_group) OVER (ORDER BY st.segment_order) AS segment_group
  FROM segment_transitions st
),
segment_rows AS (
  SELECT
    MIN(sg.segment_order) AS segment_order,
    sg.suffix,
    MIN(sg.segment_start) AS segment_start,
    MAX(sg.segment_end) AS segment_end
  FROM segment_grouped sg
  GROUP BY sg.segment_group, sg.suffix
),
segment_math AS (
  SELECT
    sr.*,
    EXTRACT(EPOCH FROM (sr.segment_end - sr.segment_start)) / 36.0
      AS exact_hundredths,
    FLOOR(EXTRACT(EPOCH FROM (sr.segment_end - sr.segment_start)) / 36.0)::int
      AS floor_hundredths
  FROM segment_rows sr
  WHERE sr.segment_end > sr.segment_start
),
segment_ranked AS (
  SELECT
    sm.*,
    ROW_NUMBER() OVER (
      ORDER BY
        sm.exact_hundredths - sm.floor_hundredths DESC,
        sm.segment_start,
        sm.segment_order
    ) AS allocation_rank,
    ROUND(SUM(sm.exact_hundredths) OVER ())::int
      - SUM(sm.floor_hundredths) OVER ()::int AS units_to_add
  FROM segment_math sm
)
SELECT
  d.tsnumber,
  d.confirmation_base,
  d.confirmation_count,
  d.business_date,
  d.roster_status,
  d.eff_shift,
  d.block_reason,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'suffix', sr.suffix,
          'start', sr.segment_start,
          'end', sr.segment_end,
          'duration',
            (sr.floor_hundredths
              + CASE WHEN sr.allocation_rank <= sr.units_to_add THEN 1 ELSE 0 END
            )::numeric / 100
        )
        ORDER BY sr.segment_start, sr.segment_order
      )
      FROM segment_ranked sr
    ),
    '[]'::jsonb
  ) AS segments
FROM decision d
`;

const UPDATE_ORIGINAL_SEGMENT_SQL = `
UPDATE public.timesheet_transaction
SET longdate_checkout = $2::timestamptz,
    date_checkin = to_char(longdate_checkin AT TIME ZONE $4, 'DD/MM/YYYY'),
    hour_checkin = to_char(longdate_checkin AT TIME ZONE $4, 'HH24:MI'),
    date_checkout = to_char($2::timestamptz AT TIME ZONE $4, 'DD/MM/YYYY'),
    hour_checkout = to_char($2::timestamptz AT TIME ZONE $4, 'HH24:MI'),
    duration = $5::numeric,
    confirmationnumber = $3,
    modified_at = now()
WHERE tsnumber = $1
RETURNING *
`;

const INSERT_CLONE_SEGMENT_SQL = `
INSERT INTO public.timesheet_transaction (
  activitytype, operation_text, confirmationnumber, ssbr_id,
  date_checkin, date_checkout, full_name, hour_checkin, hour_checkout,
  longdate_checkin, longdate_checkout, note, part_name, planhours, plant,
  serialnumber, state_flag, std_foreman_hours, validation_date,
  workcentercode, workcenterdescription, duration, operation_no, order_no,
  modified_at, ms_area_code, ms_bay_codes, ms_task_id, ms_project_id,
  ms_bay_schedule_id
)
SELECT
  t.activitytype, t.operation_text, $4, t.ssbr_id,
  to_char($2::timestamptz AT TIME ZONE $5, 'DD/MM/YYYY'),
  to_char($3::timestamptz AT TIME ZONE $5, 'DD/MM/YYYY'),
  t.full_name,
  to_char($2::timestamptz AT TIME ZONE $5, 'HH24:MI'),
  to_char($3::timestamptz AT TIME ZONE $5, 'HH24:MI'),
  $2::timestamptz, $3::timestamptz, t.note, t.part_name, t.planhours, t.plant,
  t.serialnumber, t.state_flag, t.std_foreman_hours, NULL,
  t.workcentercode, t.workcenterdescription,
  $6::numeric,
  t.operation_no, t.order_no, now(), t.ms_area_code, t.ms_bay_codes,
  t.ms_task_id, t.ms_project_id, t.ms_bay_schedule_id
FROM public.timesheet_transaction t
WHERE t.tsnumber = $1
RETURNING *
`;

const loadRuntimeContext = async (client, configuredTimezone, expectedPlant) => {
  const result = await client.query(
    "SELECT plant_code, timezone FROM public.plant_config WHERE id = 1 LIMIT 1",
  );
  return assertRuntimeContext(configuredTimezone, expectedPlant, result.rows[0]);
};

const assertNoExposure = async (client, rows, plant) => {
  const ids = rows.map((row) => String(row.tsnumber));
  if (ids.length === 0) return;
  const excluded = await client.query(
    `SELECT source_row_id
     FROM public.sap_staging_exclusion
     WHERE source_system = 'TIMESHEET'
       AND plant = $1
       AND source_row_id = ANY($2::text[])`,
    [plant, ids],
  );
  const staged = await client.query(
    `SELECT source_row_id
     FROM public.sap_staging_source
     WHERE source_system = 'TIMESHEET'
       AND plant = $1
       AND source_row_id = ANY($2::text[])`,
    [plant, ids],
  );
  if (excluded.rows.length || staged.rows.length) {
    throw new ConfirmationCheckoutError(
      "SOURCE_EXPOSED",
      "Timesheet sudah memiliki exclusion atau staging; checkout otomatis dibatalkan.",
      409,
      {
        excluded: excluded.rows.map((row) => row.source_row_id),
        staged: staged.rows.map((row) => row.source_row_id),
      },
    );
  }
};

const closeLockedRows = async (client, ids, checkoutAt, timezone) => {
  const result = await client.query(
    `UPDATE public.timesheet_transaction
     SET longdate_checkout = $2::timestamptz,
         date_checkout = to_char($2::timestamptz AT TIME ZONE $3, 'DD/MM/YYYY'),
         hour_checkout = to_char($2::timestamptz AT TIME ZONE $3, 'HH24:MI'),
         duration = ROUND(
           EXTRACT(EPOCH FROM ($2::timestamptz - longdate_checkin)) / 3600.0,
           2
         ),
         modified_at = now()
     WHERE tsnumber = ANY($1::int[])
       AND longdate_checkout IS NULL
       AND date_checkout IS NULL
     RETURNING *`,
    [ids, checkoutAt, timezone],
  );
  if (result.rows.length !== ids.length) {
    throw new ConfirmationCheckoutError(
      "CONCURRENT_CHECKOUT",
      "Timesheet berubah saat checkout; muat ulang data dan coba lagi.",
    );
  }
  return result.rows;
};

const planSegments = async (client, tsnumber, timezone, plant) => {
  const result = await client.query(CLASSIFICATION_SQL, [
    tsnumber,
    timezone,
    OFF_SHIFT_STATUSES,
    plant,
  ]);
  const plan = result.rows[0];
  if (!plan) {
    throw new ConfirmationCheckoutError("SOURCE_MISSING", `TS ${tsnumber} tidak ditemukan.`);
  }
  if (plan.block_reason) {
    throw new ConfirmationCheckoutError(
      plan.block_reason,
      `TS ${tsnumber} tidak dapat diklasifikasikan: ${plan.block_reason}.`,
      409,
      { tsnumber, block_reason: plan.block_reason },
    );
  }
  if (!Array.isArray(plan.segments) || plan.segments.length === 0) {
    throw new ConfirmationCheckoutError(
      "EMPTY_SEGMENTS",
      `TS ${tsnumber} tidak menghasilkan segmen confirmation.`,
    );
  }
  return plan;
};

const writeSegments = async (client, sourceRow, plan, timezone) => {
  const [first, ...rest] = plan.segments;
  const base = normalizeText(plan.confirmation_base);
  const firstResult = await client.query(UPDATE_ORIGINAL_SEGMENT_SQL, [
    sourceRow.tsnumber,
    first.end,
    `${base}${first.suffix}`,
    timezone,
    first.duration,
  ]);
  const family = [firstResult.rows[0]];
  for (const segment of rest) {
    const clone = await client.query(INSERT_CLONE_SEGMENT_SQL, [
      sourceRow.tsnumber,
      segment.start,
      segment.end,
      `${base}${segment.suffix}`,
      timezone,
      segment.duration,
    ]);
    family.push(clone.rows[0]);
  }
  return family;
};

const verifyFamily = async (client, sourceRow, plan, family, timezone) => {
  const ids = family.map((row) => row.tsnumber);
  const expectedStart = plan.segments[0].start;
  const expectedEnd = plan.segments[plan.segments.length - 1].end;
  const result = await client.query(
    `WITH ordered AS (
       SELECT
         t.*,
         LAG(t.longdate_checkout) OVER (
           ORDER BY t.longdate_checkin, t.longdate_checkout, t.tsnumber
         ) AS previous_end
       FROM public.timesheet_transaction t
       WHERE t.tsnumber = ANY($1::int[])
     )
     SELECT
       COUNT(*)::int AS segment_count,
       MIN(longdate_checkin) IS DISTINCT FROM $2::timestamptz AS start_mismatch,
       MAX(longdate_checkout) IS DISTINCT FROM $3::timestamptz AS end_mismatch,
       SUM(EXTRACT(EPOCH FROM (longdate_checkout - longdate_checkin)))
         IS DISTINCT FROM EXTRACT(EPOCH FROM ($3::timestamptz - $2::timestamptz))
         AS duration_mismatch,
       COUNT(*) FILTER (WHERE previous_end IS NOT NULL
                          AND previous_end <> longdate_checkin)::int AS gap_count,
       COUNT(*) FILTER (WHERE longdate_checkout <= longdate_checkin)::int AS invalid_count,
       COUNT(*) FILTER (WHERE confirmationnumber !~ '^[0-9]+(RG|OV|RW)$')::int
         AS bad_confirmation,
       SUM(duration) IS DISTINCT FROM
         ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - $2::timestamptz)) / 3600.0, 2)
         AS stored_duration_mismatch,
       COUNT(*) FILTER (
         WHERE date_checkin IS DISTINCT FROM
                 to_char(longdate_checkin AT TIME ZONE $4, 'DD/MM/YYYY')
            OR hour_checkin IS DISTINCT FROM
                 to_char(longdate_checkin AT TIME ZONE $4, 'HH24:MI')
            OR date_checkout IS DISTINCT FROM
                 to_char(longdate_checkout AT TIME ZONE $4, 'DD/MM/YYYY')
            OR hour_checkout IS DISTINCT FROM
                 to_char(longdate_checkout AT TIME ZONE $4, 'HH24:MI')
       )::int AS bad_clock
     FROM ordered`,
    [ids, expectedStart, expectedEnd, timezone],
  );
  const check = result.rows[0];
  if (
    check.segment_count !== ids.length
    || check.start_mismatch
    || check.end_mismatch
    || check.duration_mismatch
    || check.gap_count
    || check.invalid_count
    || check.bad_confirmation
    || check.stored_duration_mismatch
    || check.bad_clock
  ) {
    throw new ConfirmationCheckoutError(
      "SEGMENT_INVARIANT",
      `Invariant split gagal untuk TS ${sourceRow.tsnumber}.`,
      500,
      check,
    );
  }
};

const confirmClosedTimesheet = async (client, row, timezone, plant) => {
  if (!isProductiveRow(row)) return row;
  const plan = await planSegments(client, row.tsnumber, timezone, plant);
  const family = await writeSegments(client, row, plan, timezone);
  await verifyFamily(client, row, plan, family, timezone);
  return family[0];
};

const confirmClosedTimesheetOrDefer = async (client, row, timezone, plant) => {
  if (!isProductiveRow(row)) return row;
  await client.query("SAVEPOINT confirmation_write");
  try {
    const confirmed = await confirmClosedTimesheet(client, row, timezone, plant);
    await client.query("RELEASE SAVEPOINT confirmation_write");
    return confirmed;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT confirmation_write");
    await client.query("RELEASE SAVEPOINT confirmation_write");
    if (
      error instanceof ConfirmationCheckoutError
      && DEFERRED_CONFIRMATION_CODES.has(error.code)
    ) {
      return row;
    }
    throw error;
  }
};

const lockRows = async (client, selector, value) => {
  if (selector === "serialnumber") {
    return client.query(
      `SELECT *
       FROM public.timesheet_transaction
       WHERE serialnumber = $1
         AND longdate_checkout IS NULL
         AND date_checkout IS NULL
       ORDER BY tsnumber
       FOR UPDATE`,
      [value],
    );
  }
  return client.query(
    `SELECT *
     FROM public.timesheet_transaction
     WHERE tsnumber = $1
       AND longdate_checkout IS NULL
       AND date_checkout IS NULL
     FOR UPDATE`,
    [value],
  );
};

const createTimesheetConfirmationService = ({ pool, timezone, plant }) => {
  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("Timesheet confirmation service requires a pg Pool");
  }

  const checkout = async (selector, value) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const runtimeTimezone = await loadRuntimeContext(client, timezone, plant);
      const locked = await lockRows(client, selector, value);
      if (locked.rows.length === 0) {
        await client.query("ROLLBACK");
        return [];
      }

      await assertNoExposure(client, locked.rows, plant);
      const now = await client.query("SELECT clock_timestamp() AS checkout_at");
      const checkoutAt = now.rows[0].checkout_at;
      const ids = locked.rows.map((row) => row.tsnumber);
      const closed = await closeLockedRows(client, ids, checkoutAt, runtimeTimezone);

      const originalRows = [];
      for (const row of closed.sort((a, b) => a.tsnumber - b.tsnumber)) {
        originalRows.push(
          await confirmClosedTimesheetOrDefer(client, row, runtimeTimezone, plant),
        );
      }

      await client.query("COMMIT");
      return originalRows;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    checkoutBySerial: (serialnumber) => checkout("serialnumber", serialnumber),
    checkoutById: (tsnumber) => checkout("tsnumber", tsnumber),
  };
};

module.exports = {
  CLASSIFICATION_SQL,
  ConfirmationCheckoutError,
  assertRuntimeContext,
  confirmClosedTimesheet,
  createTimesheetConfirmationService,
  isProductiveRow,
};
