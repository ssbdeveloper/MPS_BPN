const db = global.pool || require("../db");
const { resolveTimezone } = require("../config/timezone");

const KPI_DEFS = {
  uptime_tablet: { label: "Uptime Tablet", target: 99, owner: "IT (Wira)", group: "labour", dimension: "health" },
  accuracy_labour: { label: "Accuracy Labour", target: 98, owner: "Foreman/Spv", group: "labour", dimension: "health" },
  adoption_labour: { label: "Adoption Labour", target: 95, owner: "Foreman/Spv", group: "labour", dimension: "health" },
  ole: { label: "OLE", target: 85, owner: "Foreman/Spv/PPIC", group: "labour", dimension: "performance" },
  uptime_hmi: { label: "Uptime HMI", target: 99, owner: "IT (Wira)", group: "machine", dimension: "health" },
  accuracy_machine: { label: "Accuracy Machine", target: 98, owner: "Foreman/Spv", group: "machine", dimension: "health" },
  adoption_machine: { label: "Adoption Machine", target: 95, owner: "Foreman/Spv/PPIC", group: "machine", dimension: "health" },
  oee: { label: "OEE", target: 80, owner: "Foreman/Spv/PPIC", group: "machine", dimension: "performance" },
};

// PROVISIONAL bands: accuracy target 98 (both sides) and adoption_labour band reuse
// existing adoption; revisit once labour/machine baselines are observed.
const DEFAULT_THRESHOLDS = {
  uptime_tablet: { normal_min: 99, warning_min: 98, critical_below: 98 },
  uptime_hmi: { normal_min: 99, warning_min: 98, critical_below: 98 },
  accuracy_labour: { normal_min: 98, warning_min: 95, critical_below: 95 },
  accuracy_machine: { normal_min: 98, warning_min: 95, critical_below: 95 },
  adoption_labour: { normal_min: 95, warning_min: 90, critical_below: 90 },
  adoption_machine: { normal_min: 95, warning_min: 90, critical_below: 90 },
  oee: { normal_min: 80, warning_min: 65, critical_below: 65 },
  ole: { normal_min: 85, warning_min: 70, critical_below: 70 },
};

// Standard work hours per shift. Single source of truth — do not scatter.
const SHIFT_STANDARD_HOURS = { 1: 8, 2: 7 };

// Shift-aware business day: the "today" window rolls over at shift-1 start (default
// 07:00) instead of calendar midnight. Between midnight and shift-1 the EWS keeps
// showing the previous operational day (last night's shift 2) so the warning stays
// visible until the new shift actually produces data, instead of reading 0.
const EWS_DAY_START_HOUR = Number(process.env.EWS_DAY_START_HOUR || 7);

const WINDOW_MAP = {
  "5m": "5 minutes",
  "15m": "15 minutes",
  "30m": "30 minutes",
  "60m": "60 minutes",
  "1h": "60 minutes",
  "4h": "4 hours",
  "8h": "8 hours",
  "24h": "24 hours",
};

function normalizeWindow(value) {
  return WINDOW_MAP[value] ? value : "15m";
}

function intervalForWindow(value) {
  return WINDOW_MAP[normalizeWindow(value)];
}

function num(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pct(numerator, denominator) {
  const top = num(numerator, 0);
  const bottom = num(denominator, 0);
  if (bottom <= 0) return null;
  return Math.max(0, Math.min(100, (top / bottom) * 100));
}

function round1(value) {
  const parsed = num(value);
  return parsed === null ? null : Math.round(parsed * 10) / 10;
}

function shouldCalculateAdoptionInMain() {
  return process.env.EWS_CALCULATE_ADOPTION_IN_MAIN === "1";
}

function getAdoptionSource() {
  const source = String(process.env.EWS_ADOPTION_SOURCE || "machine").toLowerCase();
  return source === "all" ? "all" : "machine";
}

async function columnExists(schema, table, column) {
  const result = await db.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
    ) AS exists
    `,
    [schema, table, column],
  );
  return Boolean(result.rows[0]?.exists);
}

async function getCachedAdoptionCalculation(grain) {
  const adoptionSource = getAdoptionSource();
  if (await tableExists("ews", "adoption_summary_snapshot")) {
    const hasAdoptionSource = await columnExists("ews", "adoption_summary_snapshot", "adoption_source");
    const sourceFilter = hasAdoptionSource ? "AND adoption_source = $2" : "";
    const queryParams = hasAdoptionSource ? [grain || "today", adoptionSource] : [grain || "today"];
    const summaryResult = await db.query(
      `
      SELECT *
      FROM ews.adoption_summary_snapshot
      WHERE grain = $1
        ${sourceFilter}
        AND adoption_pct IS NOT NULL
      ORDER BY window_end DESC, calculated_at DESC
      LIMIT 1
      `,
      queryParams,
    );

    const summary = summaryResult.rows[0];
    if (summary) {
      const expectedMinutes = num(summary.expected_bucket_count, 0) * 5;
      const missingMinutes = (num(summary.missing_bucket_count, 0) + num(summary.unidentified_bucket_count, 0)) * 5;
      return {
        value: num(summary.adoption_pct),
        helper: summary.detail_json?.helper || `${num(summary.covered_bucket_count, 0)}/${num(summary.expected_bucket_count, 0)} units covered`,
        detail: {
          bucket_minutes: 5,
          adoption_source: summary.adoption_source || "all",
          expected_bucket_count: num(summary.expected_bucket_count, 0),
          covered_bucket_count: num(summary.covered_bucket_count, 0),
          missing_bucket_count: num(summary.missing_bucket_count, 0),
          unidentified_bucket_count: num(summary.unidentified_bucket_count, 0),
          machine_count: num(summary.machine_count, 0),
          operator_count: num(summary.operator_count, 0),
          expected_minutes: expectedMinutes,
          missing_minutes: missingMinutes,
          total_duration_seconds: num(summary.detail_json?.total_duration_seconds, 0),
          unidentified_duration_seconds: num(summary.detail_json?.unidentified_duration_seconds, 0),
          long_status_2_duration_seconds: num(summary.detail_json?.long_status_2_duration_seconds, 0),
          gap_duration_seconds: num(summary.detail_json?.gap_duration_seconds, 0),
          unidentified_pct: num(summary.detail_json?.unidentified_pct),
          long_status_2_pct: num(summary.detail_json?.long_status_2_pct),
          gap_pct: num(summary.detail_json?.gap_pct),
          long_status_2_count: num(summary.detail_json?.long_status_2_count, 0),
          missing_time_buckets: summary.detail_json?.missing_time_buckets || [],
          per_machine: summary.detail_json?.per_machine || [],
          source: "ews.adoption_summary_snapshot",
          cache_hit: true,
          cached_at: summary.calculated_at,
        },
      };
    }
  }

  if (!(await tableExists("ews", "kpi_snapshot"))) {
    return {
      value: null,
      helper: "Adoption snapshot not available",
      detail: { source: "cached_snapshot", cache_hit: false },
    };
  }

  const result = await db.query(
    `
    SELECT adoption_pct::float AS adoption_pct, calculated_at, detail_json
    FROM ews.kpi_snapshot
    WHERE grain = $1
      AND scope_type = 'system'
      AND scope_key = 'ALL'
      AND adoption_pct IS NOT NULL
    ORDER BY calculated_at DESC
    LIMIT 1
    `,
    [grain || "today"],
  );

  const row = result.rows[0];
  if (!row) {
    return {
      value: null,
      helper: "Adoption is calculated by slower job; no cached value yet",
      detail: { source: "cached_snapshot", cache_hit: false },
    };
  }

  const detailKpi = Array.isArray(row.detail_json?.kpis)
    ? row.detail_json.kpis.find((kpi) => kpi.key === "adoption")
    : null;

  return {
    value: num(row.adoption_pct),
    helper: detailKpi?.helper || `Cached adoption from ${row.calculated_at}`,
    detail: {
      ...(detailKpi?.detail || {}),
      source: "cached_snapshot",
      cache_hit: true,
      cached_at: row.calculated_at,
    },
  };
}

async function tableExists(schema, table) {
  const result = await db.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2
    ) AS exists
    `,
    [schema, table],
  );
  return Boolean(result.rows[0]?.exists);
}

async function getWindowBounds(intervalText) {
  const result = await db.query(
    `
    SELECT
      date_trunc('minute', now()) - $1::interval AS window_start,
      date_trunc('minute', now()) AS window_end
    `,
    [intervalText],
  );
  return result.rows[0];
}

async function getTodayBounds() {
  // Business day starts at EWS_DAY_START_HOUR (shift 1), not calendar midnight:
  //  - 07:00..23:59  -> window = [today 00:00, now)          (live current day)
  //  - 00:00..06:59  -> window = [yesterday 00:00, today 00:00)  (last night's full day)
  const result = await db.query(
    `
    WITH biz AS (
      SELECT date_trunc('day', now() - make_interval(hours => $1::int)) AS day_start
    )
    SELECT
      day_start AS window_start,
      LEAST(now(), day_start + interval '1 day') AS window_end,
      day_start - interval '1 day' AS previous_start,
      day_start AS previous_end
    FROM biz
    `,
    [EWS_DAY_START_HOUR],
  );
  return result.rows[0];
}

function assertIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error("Invalid EWS date. Use YYYY-MM-DD.");
  }
}

async function getDateBounds(dateText) {
  assertIsoDate(dateText);
  const result = await db.query(
    `
    SELECT
      $1::date::timestamptz AS window_start,
      ($1::date + interval '1 day')::timestamptz AS window_end
    `,
    [dateText],
  );
  return result.rows[0];
}

async function getThresholds() {
  if (!(await tableExists("ews", "kpi_threshold"))) return DEFAULT_THRESHOLDS;

  const result = await db.query(`
    SELECT kpi_type, normal_min, warning_min, critical_below, owner
    FROM ews.kpi_threshold
  `);

  return result.rows.reduce((acc, row) => {
    acc[row.kpi_type] = {
      normal_min: num(row.normal_min, DEFAULT_THRESHOLDS[row.kpi_type]?.normal_min),
      warning_min: num(row.warning_min, DEFAULT_THRESHOLDS[row.kpi_type]?.warning_min),
      critical_below: num(row.critical_below, DEFAULT_THRESHOLDS[row.kpi_type]?.critical_below),
      owner: row.owner || KPI_DEFS[row.kpi_type]?.owner,
    };
    return acc;
  }, { ...DEFAULT_THRESHOLDS });
}

function statusForValue(key, value, thresholds) {
  if (value === null || value === undefined) return "no_data";
  const threshold = thresholds[key] || DEFAULT_THRESHOLDS[key];
  if (value < threshold.critical_below) return "critical";
  if (value < threshold.normal_min) return "watch";
  return "normal";
}

// Intentionally not wired into calculateKpisForBounds during the 8-KPI restructure:
// uptime_tablet/uptime_hmi ship as no_data placeholders and get their own (separate)
// tablet-vs-HMI uptime calc in a later phase. Kept here as the reference ping-based calc.
async function calculateUptime(bounds, options = {}) {
  if (!(await tableExists("public", "mch_machine_ping_log"))) {
    return { value: null, helper: "Ping log table not available", detail: { sample_count: 0 } };
  }

  const useTodayPingWindow = options.grain === "today" && options.role !== "previous";
  const timezone = resolveTimezone();
  const result = await db.query(
    `
    WITH effective_bounds AS (
      SELECT
        CASE
          WHEN $3::boolean THEN date_trunc('day', now() AT TIME ZONE $4) AT TIME ZONE $4
          ELSE $1::timestamptz
        END AS window_start,
        CASE WHEN $3::boolean THEN now() ELSE $2::timestamptz END AS window_end
    )
    SELECT
      COUNT(*)::int AS sample_count,
      COALESCE(SUM(ping_count), 0)::float AS ping_count,
      COALESCE(SUM(success_count), 0)::float AS success_count,
      COALESCE(SUM(failed_count), 0)::float AS failed_count,
      COUNT(*) FILTER (WHERE status = 'DOWN')::int AS down_samples,
      ROUND(AVG(avg_latency_ms), 2)::float AS avg_latency_ms,
      ROUND(MAX(packet_loss_percent), 2)::float AS max_packet_loss_percent
    FROM public.mch_machine_ping_log
    CROSS JOIN effective_bounds b
    WHERE checked_at >= b.window_start
      AND checked_at < b.window_end
    `,
    [bounds.window_start, bounds.window_end, useTodayPingWindow, timezone],
  );

  const row = result.rows[0] || {};
  const value = pct(row.success_count, row.ping_count);
  return {
    value,
    helper: value === null
      ? "No ping sample in window"
      : `${num(row.success_count, 0).toFixed(0)}/${num(row.ping_count, 0).toFixed(0)} ping success`,
    detail: {
      sample_count: num(row.sample_count, 0),
      ping_count: num(row.ping_count, 0),
      success_count: num(row.success_count, 0),
      failed_count: num(row.failed_count, 0),
      down_samples: num(row.down_samples, 0),
      avg_latency_ms: num(row.avg_latency_ms),
      max_packet_loss_percent: num(row.max_packet_loss_percent),
      window_rule: useTodayPingWindow ? `today ping samples only by checked_at in ${timezone}` : "provided window bounds",
      denominator: "SUM(ping_count)",
      numerator: "SUM(success_count)",
    },
  };
}

// uptime_hmi — machine availability from ews.machine_heartbeat_daily.
// The raw ~10s heartbeat is pre-aggregated per (work_date, machineno) by the sync job
// (pings, up_pings where heartbeat<>0, uptime_pct). Metric per request: for TODAY's
// calendar date (local tz), read each machine's stored uptime% then AVERAGE those
// per-machine percentages across all machines. machinename comes from mch_machines.
// role = "previous" compares against yesterday so the EWS delta is a day-over-day change.
async function calculateUptimeHmi(options = {}) {
  if (!(await tableExists("ews", "machine_heartbeat_daily"))) {
    return { value: null, helper: "Table ews.machine_heartbeat_daily tidak tersedia", detail: { source: "no_table", machine_count: 0 } };
  }

  const timezone = resolveTimezone();
  const isPrevious = options.role === "previous";

  const result = await db.query(
    `
    WITH target AS (
      SELECT ((now() AT TIME ZONE $2 - make_interval(hours => $3::int))::date - CASE WHEN $1::boolean THEN 1 ELSE 0 END) AS d
    ),
    per_machine AS (
      SELECT
        h.machineno,
        h.pings,
        h.up_pings,
        h.uptime_pct
      FROM ews.machine_heartbeat_daily h
      CROSS JOIN target t
      WHERE h.work_date = t.d
    )
    SELECT
      COUNT(*)::int AS machine_count,
      ROUND(AVG(pm.uptime_pct)::numeric, 2)::float AS avg_uptime_pct,
      COALESCE(SUM(pm.pings), 0)::bigint AS total_pings,
      COALESCE(SUM(pm.up_pings), 0)::bigint AS total_up_pings,
      (SELECT d FROM target)::text AS target_date,
      COALESCE(
        json_agg(
          json_build_object(
            'machineno', pm.machineno,
            'machineid', m.machineid,
            'machinename', m.machinename,
            'uptime_pct', ROUND(pm.uptime_pct::numeric, 1),
            'pings', pm.pings
          ) ORDER BY pm.uptime_pct ASC, pm.machineno ASC
        ) FILTER (WHERE pm.machineno IS NOT NULL),
        '[]'::json
      ) AS machines
    FROM per_machine pm
    LEFT JOIN public.mch_machines m ON m.machineno = pm.machineno
    `,
    [isPrevious, timezone, EWS_DAY_START_HOUR],
  );

  const row = result.rows[0] || {};
  const machineCount = num(row.machine_count, 0);
  const value = machineCount > 0 ? num(row.avg_uptime_pct) : null;

  return {
    value,
    helper: value === null
      ? "Tidak ada heartbeat pada tanggal ini"
      : `${machineCount} mesin · rata-rata uptime ${isPrevious ? "kemarin" : "hari ini"}`,
    detail: {
      target_date: row.target_date || null,
      machine_count: machineCount,
      total_pings: num(row.total_pings, 0),
      total_up_pings: num(row.total_up_pings, 0),
      machines: Array.isArray(row.machines) ? row.machines : [],
      method: "AVG per-machine uptime% (up-pings/total-pings) across distinct machines for the day",
      numerator: "COUNT(*) FILTER (heartbeat <> 0) per machine",
      denominator: "COUNT(*) per machine",
    },
  };
}

// SAP order/operation master the stager matches against (env TGT_TABLE, default ph3_order).
// Mirrors jobs/sap_staging/stage_timesheet_transaction.py so accuracy_labour uses the SAME
// eligibility truth as the stager. Validated as a bare identifier to stay injection-safe.
function ph3OrderTable() {
  const raw = String(process.env.TGT_TABLE || "ph3_order").trim();
  return /^[a-z_][a-z0-9_]*$/i.test(raw) ? raw : "ph3_order";
}

// accuracy_labour: input eligibility straight from timesheet_transaction, realtime.
// ZERO reads to sap_timesheet_staging (decoupled from the stager backlog).
// eligible = row NOT failing any stager block rule (missing_order/missing_operation/sow_no_match
// against ph3_order). Rows with activitytype set are always eligible. In-progress rows
// (no checkout) are included by decision — window is by longdate_checkin.
async function calculateAccuracyLabour(bounds) {
  const ph3 = ph3OrderTable();
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        (NULLIF(BTRIM(COALESCE(t.activitytype, '')), '') IS NULL) AS is_productive,
        (NULLIF(BTRIM(COALESCE(t.order_no, '')), '') IS NULL) AS order_empty,
        (t.operation_no IS NULL) AS operation_null,
        EXISTS (
          SELECT 1
          FROM public.${ph3} po
          WHERE LTRIM(COALESCE(po.order_no, ''), '0') = LTRIM(COALESCE(t.order_no, ''), '0')
            AND LTRIM(COALESCE(po.operation_no, ''), '0') = t.operation_no::text
        ) AS has_ph3_match
      FROM public.timesheet_transaction t
      WHERE t.longdate_checkin >= $1
        AND t.longdate_checkin < $2
        AND COALESCE(t.state_flag, 0) <> 5
    ),
    flags AS (
      SELECT
        (is_productive AND order_empty) AS missing_order,
        (is_productive AND operation_null) AS missing_operation,
        (is_productive AND NOT order_empty AND NOT operation_null AND NOT has_ph3_match) AS sow_no_match
      FROM base
    )
    SELECT
      COUNT(*)::int AS total_records,
      COUNT(*) FILTER (WHERE NOT (missing_order OR missing_operation OR sow_no_match))::int AS eligible_records,
      COUNT(*) FILTER (WHERE missing_order OR missing_operation OR sow_no_match)::int AS error_records,
      COUNT(*) FILTER (WHERE missing_order)::int AS missing_order,
      COUNT(*) FILTER (WHERE missing_operation)::int AS missing_operation,
      COUNT(*) FILTER (WHERE sow_no_match)::int AS sow_no_match
    FROM flags
    `,
    [bounds.window_start, bounds.window_end],
  );

  const row = result.rows[0] || {};
  const total = num(row.total_records, 0);
  const eligible = num(row.eligible_records, 0);
  const value = pct(eligible, total);
  return {
    value,
    helper: value === null ? "No timesheet record in window" : `${eligible}/${total} eligible for SAP`,
    detail: {
      total_records: total,
      ready_records: eligible,
      not_ready_records: num(row.error_records, 0),
      error_records: num(row.error_records, 0),
      minimum_sample_met: total >= 50,
      error_breakdown: {
        missing_order: num(row.missing_order, 0),
        missing_operation: num(row.missing_operation, 0),
        sow_no_match: num(row.sow_no_match, 0),
      },
      denominator: "timesheet_transaction rows in window (exclude state_flag=5)",
      numerator: `rows passing all stager eligibility rules (order/operation match against public.${ph3})`,
      match_table: `public.${ph3}`,
      staging_read: false,
    },
  };
}

// accuracy_machine: mch_transaction rows with complete job/operator data (status_record).
// TRUE = statusid 0/3/4 (Off/Downtime/NoJob) OR order_no+operation_no+sn_employee+
// confirmation_number all present. FALSE = incomplete record.
async function calculateAccuracyMachine(bounds) {
  const result = await db.query(
    `
    SELECT
      COUNT(*)::int AS total_records,
      COUNT(*) FILTER (WHERE status_record)::int AS ready_records,
      COUNT(*) FILTER (WHERE NOT status_record)::int AS not_ready_records
    FROM public.mch_transaction
    WHERE startdatetime >= $1
      AND startdatetime < $2
    `,
    [bounds.window_start, bounds.window_end],
  );

  const row = result.rows[0] || {};
  const total = num(row.total_records, 0);
  const ready = num(row.ready_records, 0);
  const value = pct(ready, total);
  return {
    value,
    helper: value === null ? "No machine record in window" : `${ready}/${total} record lengkap`,
    detail: {
      total_records: total,
      ready_records: ready,
      not_ready_records: num(row.not_ready_records, 0),
      minimum_sample_met: total >= 50,
      denominator: "mch_transaction rows in window",
      numerator: "rows with status_record = true (order_no+operation_no+sn_employee+confirmation_number present, or statusid 0/3/4)",
    },
  };
}

// adoption_labour: of operators who logged a COMPLETED shift on the target business_date,
// the share meeting their full standard hours (Day 8h / Night 7h). Source: timesheet_transaction
// ONLY (no roster yet — operators with zero rows are invisible; surfaced in detail.limitation).
//
// Two accepted design decisions baked in here:
//  - Windowed by BUSINESS_DATE, not raw check-in day: a night shift (20:00-04:00) is kept whole
//    on its start date instead of being split at midnight (ISSUE 1 fix; also removes the
//    cross-run double-count because a shift belongs to exactly one business_date).
//  - COMPLETED shifts only: in-progress shifts are counted but NOT scored (no elapsed-based
//    pro-rate — proven to false-critical). The card surfaces in_progress_count separately.
// No correlated subqueries; aliases qualified.
//
// FALLBACK path: used only for business_dates with no roster rows (e.g. before the roster
// backfill start). Population = operators who LOGGED a completed shift (not attendance-based).
async function calculateAdoptionLabourFromLogs(bounds) {
  const timezone = resolveTimezone();
  const result = await db.query(
    `
    WITH params AS (
      SELECT ($1::timestamptz AT TIME ZONE $2)::date AS target_bd
    ),
    scoped AS (
      -- Scan the target day plus the following early morning so a night shift's post-midnight
      -- tail (check-in before 07:00, business_date = previous day) is captured whole.
      -- An in-progress row accrues elapsed time (see logged_rows in the roster variant): duration
      -- is only written at checkout, and dropping the open row understates the operator.
      SELECT
        NULLIF(BTRIM(t.serialnumber), '') AS operator_key,
        NULLIF(BTRIM(t.full_name), '') AS operator_name,
        (t.longdate_checkin AT TIME ZONE $2) AS lct,
        (CASE
           WHEN t.longdate_checkout IS NULL
             THEN LEAST(GREATEST(EXTRACT(EPOCH FROM (now() - t.longdate_checkin)) / 3600.0, 0), 12)
           ELSE COALESCE(t.duration, 0)
         END)::float AS dur
      FROM public.timesheet_transaction t, params
      WHERE t.longdate_checkin >= (params.target_bd::timestamp AT TIME ZONE $2)
        AND t.longdate_checkin <  ((params.target_bd + 2)::timestamp AT TIME ZONE $2)
        AND COALESCE(t.state_flag, 0) <> 5
        AND (COALESCE(t.duration, 0) > 0 OR t.longdate_checkout IS NULL)
        AND NULLIF(BTRIM(t.serialnumber), '') IS NOT NULL
    ),
    classified AS (
      -- Day (shift 1): first check-in 07:00-18:00 -> standard 8h, ends 17:00.
      -- Night (shift 2): everything else -> standard 7h, ends 04:00 next day; check-in before
      -- 07:00 belongs to the previous day's night shift. Long shifts collapse into these two.
      SELECT
        s.operator_key, s.operator_name, s.lct, s.dur,
        CASE WHEN s.lct::time >= TIME '07:00' AND s.lct::time < TIME '18:00' THEN 1 ELSE 2 END AS row_shift,
        CASE WHEN s.lct::time < TIME '07:00' THEN (s.lct::date - 1) ELSE s.lct::date END AS business_date
      FROM scoped s
    ),
    grouped AS (
      SELECT
        c.operator_key, c.business_date,
        MAX(c.operator_name) AS operator_name,
        (array_agg(c.row_shift ORDER BY c.lct))[1] AS shift,
        SUM(c.dur) AS recorded
      FROM classified c, params
      WHERE c.business_date = params.target_bd
      GROUP BY c.operator_key, c.business_date
    ),
    flagged AS (
      SELECT
        g.operator_key, g.operator_name, g.business_date, g.shift, g.recorded,
        CASE WHEN g.shift = 1 THEN 8.0 ELSE 7.0 END AS full_standard,
        (
          (CASE WHEN g.shift = 1 THEN (g.business_date + TIME '17:00')
                ELSE ((g.business_date + 1) + TIME '04:00') END) AT TIME ZONE $2
        ) <= now() AS completed
      FROM grouped g
    )
    SELECT
      ROUND((SUM(LEAST(f.recorded, f.full_standard)) FILTER (WHERE f.completed)
             / NULLIF(SUM(f.full_standard) FILTER (WHERE f.completed), 0) * 100)::numeric, 4)::float AS adoption_pct,
      ROUND((SUM(LEAST(f.recorded, f.full_standard)) FILTER (WHERE f.completed AND f.shift = 1)
             / NULLIF(SUM(f.full_standard) FILTER (WHERE f.completed AND f.shift = 1), 0) * 100)::numeric, 4)::float AS day_adoption_pct,
      ROUND((SUM(LEAST(f.recorded, f.full_standard)) FILTER (WHERE f.completed AND f.shift = 2)
             / NULLIF(SUM(f.full_standard) FILTER (WHERE f.completed AND f.shift = 2), 0) * 100)::numeric, 4)::float AS night_adoption_pct,
      COUNT(*) FILTER (WHERE f.completed)::int AS completed_shift_count,
      COUNT(*) FILTER (WHERE NOT f.completed)::int AS in_progress_count,
      COUNT(*) FILTER (WHERE f.completed AND f.shift = 1)::int AS completed_day_count,
      COUNT(*) FILTER (WHERE f.completed AND f.shift = 2)::int AS completed_night_count,
      ROUND(SUM(f.recorded) FILTER (WHERE f.completed)::numeric, 2)::float AS total_recorded_hours,
      ROUND(SUM(f.full_standard) FILTER (WHERE f.completed)::numeric, 2)::float AS total_standard_hours,
      COALESCE(jsonb_agg(jsonb_build_object(
        'operator_key', f.operator_key,
        'operator_name', f.operator_name,
        'shift', f.shift,
        'business_date', f.business_date,
        'recorded_hours', ROUND(f.recorded::numeric, 2),
        'standard_hours', f.full_standard,
        'gap_hours', ROUND(GREATEST(f.full_standard - f.recorded, 0)::numeric, 2),
        'completed', f.completed
      ) ORDER BY f.completed DESC, GREATEST(f.full_standard - f.recorded, 0) DESC), '[]'::jsonb) AS breakdown
    FROM flagged f
    `,
    [bounds.window_start, timezone],
  );

  const row = result.rows[0] || {};
  const nn = (v) => (v === null || v === undefined ? null : num(v));
  const completed = num(row.completed_shift_count, 0);
  const inProgress = num(row.in_progress_count, 0);
  const rawPct = row.adoption_pct;
  const value = completed > 0 && rawPct !== null && rawPct !== undefined ? num(rawPct) : null;
  return {
    value,
    helper: completed > 0
      ? `${completed} shifts completed${inProgress ? `, ${inProgress} in progress` : ""}`
      : inProgress > 0
        ? `${inProgress} shifts in progress, none completed yet`
        : "No completed operator shift on this business date",
    detail: {
      completed_shift_count: completed,
      in_progress_count: inProgress,
      completed_day_count: num(row.completed_day_count, 0),
      completed_night_count: num(row.completed_night_count, 0),
      day_adoption_pct: nn(row.day_adoption_pct),
      night_adoption_pct: nn(row.night_adoption_pct),
      total_recorded_hours: num(row.total_recorded_hours, 0),
      total_standard_hours: num(row.total_standard_hours, 0),
      shift_standard_hours: SHIFT_STANDARD_HOURS,
      breakdown: row.breakdown || [],
      denominator: "SUM of full standard hours over COMPLETED (operator, business_date) shifts; in-progress shifts excluded from the ratio (not pro-rated)",
      numerator: "SUM of LEAST(recorded, full standard) — overtime never inflates",
      window_rule: "windowed by business_date (whole shift incl. cross-midnight night tail), not raw check-in calendar day",
      limitation: "Completed shifts only; in-progress shifts are counted but not scored. No roster yet — operators with zero logged rows are invisible, so this is 'of operators who logged a completed shift, % meeting standard hours', NOT attendance-based adoption.",
      staging_read: false,
      roster_read: false,
    },
  };
}

// R2 — attendance-based adoption_labour from the roster. Population = SCHEDULED operators on
// the target business_date (not "operators who logged"). A scheduled operator with zero logged
// hours counts as ABSENT (0), dragging the number down — that is the point. Excused statuses
// (LEAVE/SICK/PERMIT/OFF) are excluded from the denominator. Completed-only; whole shift by
// business_date. Operators not in the rotation roster remain invisible (roster completeness).
async function calculateAdoptionLabourFromRoster(bounds) {
  const timezone = resolveTimezone();
  const result = await db.query(
    `
    WITH params AS (SELECT ($1::timestamptz AT TIME ZONE $2)::date AS target_bd),
    logged_rows AS (
      -- duration is only written at CHECKOUT, so a row still in progress reads as 0 hours. This
      -- KPI compares recorded hours against expected-SO-FAR (elapsed clock), so ignoring the open
      -- row compares closed work against running time and understates every operator who happens
      -- to be mid-task: measured at 16:22, 33 of 44 day-shift operators looked behind, but only 8
      -- were once the in-progress row was counted. An open row therefore accrues its elapsed time,
      -- which is exactly the value duration will take at checkout. Capped at 12h so a forgotten
      -- checkout cannot inflate the day.
      SELECT NULLIF(BTRIM(t.serialnumber), '') AS operator_key,
             (t.longdate_checkin AT TIME ZONE $2) AS lci,
             (CASE
                WHEN t.longdate_checkout IS NULL
                  THEN LEAST(GREATEST(EXTRACT(EPOCH FROM (now() - t.longdate_checkin)) / 3600.0, 0), 12)
                ELSE COALESCE(t.duration, 0)
              END)::float AS dur
      FROM public.timesheet_transaction t, params
      WHERE t.longdate_checkin >= (params.target_bd::timestamp AT TIME ZONE $2)
        AND t.longdate_checkin <  ((params.target_bd + 2)::timestamp AT TIME ZONE $2)
        AND COALESCE(t.state_flag, 0) <> 5
        AND (COALESCE(t.duration, 0) > 0 OR t.longdate_checkout IS NULL)
        AND NULLIF(BTRIM(t.serialnumber), '') IS NOT NULL
    ),
    logged AS (
      SELECT lr.operator_key, SUM(lr.dur) AS recorded
      FROM logged_rows lr, params p
      WHERE (CASE WHEN lr.lci::time < TIME '07:00' THEN (lr.lci::date - 1) ELSE lr.lci::date END) = p.target_bd
      GROUP BY lr.operator_key
    ),
    roster AS (
      SELECT r.serialnumber, r.scheduled_shift AS shift, r.scheduled_standard_hours AS std,
             r.status, r.business_date,
             ((r.business_date + os.start_time) AT TIME ZONE $2) AS shift_start_ts,
             (EXTRACT(EPOCH FROM (os.end_time - os.start_time
                + CASE WHEN os.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END)) / 3600.0) AS clock_hours,
             MAX(NULLIF(BTRIM(u.full_name), '')) AS operator_name
      FROM ews.shift_roster r
      JOIN params p ON r.business_date = p.target_bd
      JOIN ews.operator_shift os ON os.shift_code = r.scheduled_shift
      LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb), '') = r.serialnumber
      GROUP BY r.serialnumber, r.scheduled_shift, r.scheduled_standard_hours, r.status,
               r.business_date, os.start_time, os.end_time, os.crosses_midnight
    ),
    j AS (
      -- Progressive: expected_so_far = elapsed clock time (capped at shift length) scaled
      -- by std/clock so the break is spread proportionally. Reaches full std at shift end,
      -- so the number converges to the completed-only value exactly when the shift closes.
      SELECT ro.serialnumber, ro.operator_name, ro.shift, ro.std, ro.status, ro.business_date,
             COALESCE(lg.recorded, 0) AS recorded,
             GREATEST(LEAST(EXTRACT(EPOCH FROM (now() - ro.shift_start_ts)) / 3600.0, ro.clock_hours), 0)
               * (ro.std / NULLIF(ro.clock_hours, 0)) AS expected_so_far,
             (ro.shift_start_ts + (ro.clock_hours * INTERVAL '1 hour')) <= now() AS completed
      FROM roster ro LEFT JOIN logged lg ON lg.operator_key = ro.serialnumber
    )
    SELECT
      ROUND((SUM(LEAST(j.recorded, j.expected_so_far)) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far > 0)
             / NULLIF(SUM(j.expected_so_far) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far > 0), 0) * 100)::numeric, 4)::float AS adoption_pct,
      ROUND((SUM(LEAST(j.recorded, j.expected_so_far)) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far > 0 AND j.shift='DAY')
             / NULLIF(SUM(j.expected_so_far) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far > 0 AND j.shift='DAY'), 0) * 100)::numeric, 4)::float AS day_adoption_pct,
      ROUND((SUM(LEAST(j.recorded, j.expected_so_far)) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far > 0 AND j.shift='NIGHT')
             / NULLIF(SUM(j.expected_so_far) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far > 0 AND j.shift='NIGHT'), 0) * 100)::numeric, 4)::float AS night_adoption_pct,
      COUNT(*) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far > 0)::int AS started,
      COUNT(*) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far > 0 AND j.recorded > 0)::int AS present,
      COUNT(*) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far > 0 AND j.recorded = 0)::int AS absent,
      COUNT(*) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far <= 0)::int AS not_started,
      COUNT(*) FILTER (WHERE j.status IN ('LEAVE','SICK','PERMIT','OFF'))::int AS excused,
      ROUND(SUM(j.recorded) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far > 0)::numeric, 2)::float AS total_recorded_hours,
      ROUND(SUM(j.expected_so_far) FILTER (WHERE j.status='SCHEDULED' AND j.expected_so_far > 0)::numeric, 2)::float AS total_expected_hours,
      ROUND(SUM(j.std) FILTER (WHERE j.status='SCHEDULED')::numeric, 2)::float AS total_standard_hours,
      COALESCE(jsonb_agg(jsonb_build_object(
        'operator_key', j.serialnumber, 'operator_name', j.operator_name,
        'shift', j.shift, 'business_date', j.business_date,
        'recorded_hours', ROUND(j.recorded::numeric, 2), 'standard_hours', j.std,
        'expected_hours', ROUND(j.expected_so_far::numeric, 2),
        'gap_hours', ROUND(GREATEST(j.std - j.recorded, 0)::numeric, 2),
        'completed', j.completed,
        'status', j.status,
        'attendance', CASE WHEN j.status <> 'SCHEDULED' THEN j.status
                           WHEN j.expected_so_far <= 0 THEN 'NOT_STARTED'
                           WHEN j.recorded > 0 THEN 'PRESENT' ELSE 'ABSENT' END
      ) ORDER BY (CASE WHEN j.status='SCHEDULED' AND j.expected_so_far > 0 AND j.recorded=0 THEN 0 ELSE 1 END),
                 GREATEST(j.expected_so_far - j.recorded, 0) DESC), '[]'::jsonb) AS breakdown
    FROM j
    `,
    [bounds.window_start, timezone],
  );

  const row = result.rows[0] || {};
  const nn = (v) => (v === null || v === undefined ? null : num(v));
  const started = num(row.started, 0);
  const present = num(row.present, 0);
  const absent = num(row.absent, 0);
  const notStarted = num(row.not_started, 0);
  const value = started > 0 && row.adoption_pct !== null && row.adoption_pct !== undefined ? num(row.adoption_pct) : null;
  return {
    value,
    helper: started > 0
      ? `${present}/${started} logged, ${absent} with nothing yet${notStarted ? `, ${notStarted} not started` : ""}`
      : notStarted > 0
        ? `${notStarted} shifts scheduled, none started yet`
        : "No scheduled operator on this business date",
    detail: {
      basis: "roster_progressive",
      started,
      present,
      absent,
      not_started: notStarted,
      excused: num(row.excused, 0),
      day_adoption_pct: nn(row.day_adoption_pct),
      night_adoption_pct: nn(row.night_adoption_pct),
      total_recorded_hours: num(row.total_recorded_hours, 0),
      total_expected_hours: num(row.total_expected_hours, 0),
      total_standard_hours: num(row.total_standard_hours, 0),
      shift_standard_hours: SHIFT_STANDARD_HOURS,
      breakdown: row.breakdown || [],
      denominator: "SUM of expected-so-far hours (elapsed clock time capped at shift length, scaled by std/clock) over SCHEDULED started shifts; excused leave/sick/permit/off excluded",
      numerator: "SUM of LEAST(recorded, expected_so_far); a started operator with zero logs counts as 0",
      window_rule: "progressive by business_date: expected accrues as the shift elapses and reaches full standard at shift end (then equals the completed-only value)",
      limitation: "Progressive & no grace: early in a shift few hours are expected, so a not-yet-logged operator swings the number hard; a 'not-yet-logged' operator is indistinguishable from a truly absent one until the shift ends. Operators not in the rotation roster are still invisible.",
      staging_read: false,
      roster_read: true,
    },
  };
}

// HMI time an operator can be credited with, per business day.
//
// An operator only appears in mch_transaction.sn_employee if they tapped their NFC at the HMI, so
// the machine IS a time record for them: time outside their timesheet windows is real work the
// system captured but the timesheet missed. It is therefore ADDED to recorded hours.
//
// WHAT COUNTS: everything except the machine being out of service — statusid 0 (Off), 4 (No Job)
// and 5 (Unidentified). VA (M1/productive), NNVA (M2/setup) AND NVA (Idle, Wait For Handling,
// Tool Preparation, Coffee Break…) all count, because the timesheet side counts them too:
// timesheet_transaction.activitytype and mch_transaction.status_activitytype share one code space
// (1670 Idle, 1520 Coffee Break, 1590 Wait For Handling, …) and adoption_labour's recorded hours
// already include those rows. Crediting only running time would recognise unproductive time from
// the timesheet but discard it from the HMI — penalising the operators who did tap in.
// Off/NoJob must stay out: a machine stays linked to its operator while parked, and raw duration
// would credit 27-hour days (one operator: 27.4h total, 26.9h of it Off).
//
// Overlap is subtracted exactly: only the portion OUTSIDE the operator's timesheet intervals is
// added. Those intervals are merged first (gaps-and-islands) because an operator can have
// overlapping timesheet rows; subtracting per-row overlaps without merging removes the same second
// twice and can even go negative. This is also what protects against double counting a break that
// the operator logged in BOTH systems.
async function getMachineHoursByOperator(bounds) {
  const timezone = resolveTimezone();
  const result = await db.query(
    `
    WITH params AS (SELECT ($1::timestamptz AT TIME ZONE $2)::date AS target_bd),
    ts_scoped AS (
      -- An open row runs until now(). It must be part of the timesheet interval, because its
      -- elapsed time is now counted as recorded hours: leaving it out would credit the machine
      -- time inside that task a second time as "outside the timesheet".
      SELECT
        NULLIF(BTRIM(t.serialnumber), '') AS operator_key,
        (t.longdate_checkin AT TIME ZONE $2) AS a,
        (COALESCE(t.longdate_checkout, now()) AT TIME ZONE $2) AS b
      FROM public.timesheet_transaction t, params p
      WHERE t.longdate_checkin >= (p.target_bd::timestamp AT TIME ZONE $2)
        AND t.longdate_checkin <  ((p.target_bd + 2)::timestamp AT TIME ZONE $2)
        AND COALESCE(t.state_flag, 0) <> 5
        AND (COALESCE(t.duration, 0) > 0 OR t.longdate_checkout IS NULL)
        AND NULLIF(BTRIM(t.serialnumber), '') IS NOT NULL
        AND COALESCE(t.longdate_checkout, now()) > t.longdate_checkin
    ),
    ts_biz AS (
      SELECT s.* FROM ts_scoped s, params p
      WHERE (CASE WHEN s.a::time < make_time($3::int, 0, 0) THEN (s.a::date - 1) ELSE s.a::date END) = p.target_bd
    ),
    ts_ord AS (
      SELECT operator_key, a, b,
        MAX(b) OVER (PARTITION BY operator_key ORDER BY a
                     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max
      FROM ts_biz
    ),
    ts_grp AS (
      SELECT *, SUM(CASE WHEN prev_max IS NULL OR a > prev_max THEN 1 ELSE 0 END)
                  OVER (PARTITION BY operator_key ORDER BY a ROWS UNBOUNDED PRECEDING) AS grp
      FROM ts_ord
    ),
    ts_merged AS (
      SELECT operator_key, MIN(a) AS a, MAX(b) AS b FROM ts_grp GROUP BY operator_key, grp
    ),
    mch AS (
      SELECT
        ROW_NUMBER() OVER () AS rid,
        NULLIF(BTRIM(m.sn_employee), '') AS operator_key,
        m.startdatetime AS a,
        m.enddatetime AS b
      FROM public.mch_transaction m, params p
      WHERE (CASE WHEN m.startdatetime::time < make_time($3::int, 0, 0)
                  THEN (m.startdatetime::date - 1) ELSE m.startdatetime::date END) = p.target_bd
        AND m.enddatetime > m.startdatetime
        AND COALESCE(m.statusid, 0) NOT IN (0, 4, 5)
        AND LOWER(BTRIM(COALESCE(m.status_description, ''))) NOT IN ('no job', 'off')
    ),
    mch_extra AS (
      SELECT
        n.operator_key,
        n.rid,
        EXTRACT(EPOCH FROM (n.b - n.a)) AS dur_sec,
        -- FILTER is load-bearing. Postgres LEAST/GREATEST IGNORE NULL arguments, so on a
        -- LEFT JOIN miss (t.* NULL) the expression collapses to (n.b - n.a) and reports a
        -- non-overlapping machine interval as 100% overlapping — silently zeroing the credit.
        COALESCE(
          SUM(EXTRACT(EPOCH FROM (LEAST(n.b, t.b) - GREATEST(n.a, t.a))))
            FILTER (WHERE t.operator_key IS NOT NULL),
          0
        ) AS ov_sec
      FROM mch n
      LEFT JOIN ts_merged t ON t.operator_key = n.operator_key AND t.a < n.b AND t.b > n.a
      WHERE n.operator_key IS NOT NULL
      GROUP BY n.operator_key, n.rid, n.a, n.b
    ),
    per_op AS (
      SELECT
        operator_key,
        ROUND((SUM(dur_sec) / 3600.0)::numeric, 2)::float AS machine_hours,
        ROUND((SUM(GREATEST(dur_sec - ov_sec, 0)) / 3600.0)::numeric, 2)::float AS machine_extra_hours
      FROM mch_extra
      GROUP BY operator_key
    )
    SELECT
      (SELECT COALESCE(jsonb_object_agg(operator_key,
                jsonb_build_object('machine_hours', machine_hours, 'machine_extra_hours', machine_extra_hours)),
              '{}'::jsonb) FROM per_op) AS by_operator,
      (SELECT COUNT(*)::int FROM per_op WHERE machine_hours > 0) AS operators_with_machine,
      COALESCE(ROUND((SUM(EXTRACT(EPOCH FROM (b - a))) FILTER (WHERE operator_key IS NOT NULL) / 3600.0)::numeric, 1), 0)::float AS attributed_hours,
      COALESCE(ROUND((SUM(EXTRACT(EPOCH FROM (b - a))) FILTER (WHERE operator_key IS NULL) / 3600.0)::numeric, 1), 0)::float AS unattributed_hours
    FROM mch
    `,
    [bounds.window_start, timezone, EWS_DAY_START_HOUR],
  );

  const row = result.rows[0] || {};
  const attributed = num(row.attributed_hours, 0);
  const unattributed = num(row.unattributed_hours, 0);
  const totalRunning = attributed + unattributed;
  return {
    byOperator: row.by_operator || {},
    attribution: {
      rule: "HMI time by sn_employee excluding statusid 0/4/5 (Off, No Job, Unidentified) — VA + NNVA + NVA — minus the part overlapping the operator's merged timesheet intervals",
      operators_with_machine: num(row.operators_with_machine, 0),
      attributed_hours: attributed,
      unattributed_hours: unattributed,
      coverage_pct: totalRunning > 0 ? round1((attributed / totalRunning) * 100) : null,
    },
  };
}

// Fold machine time into the adoption_labour result: recorded = timesheet + machine-outside-timesheet.
// The KPI aggregates are recomputed from the enriched breakdown so the headline number, the shift
// split, and present/absent all agree with the bars the detail page draws.
function applyMachineHoursToAdoptionLabour(base, machine) {
  const rows = Array.isArray(base?.detail?.breakdown) ? base.detail.breakdown : [];
  if (!rows.length) return base;

  const isRoster = base.detail.basis === "roster_progressive";
  const enriched = rows.map((r) => {
    const entry = machine.byOperator[r.operator_key];
    const timesheetHours = num(r.recorded_hours, 0);
    const extra = entry ? num(entry.machine_extra_hours, 0) : 0;
    const recorded = Math.round((timesheetHours + extra) * 100) / 100;
    const standard = num(r.standard_hours, 0);
    return {
      ...r,
      timesheet_hours: timesheetHours,
      machine_hours: entry ? num(entry.machine_hours, 0) : null,
      machine_extra_hours: entry ? extra : null,
      recorded_hours: recorded,
      gap_hours: Math.round(Math.max(standard - recorded, 0) * 100) / 100,
    };
  });

  const eligible = isRoster
    ? enriched.filter((r) => r.status === "SCHEDULED" && num(r.expected_hours, 0) > 0)
    : enriched.filter((r) => r.completed === true);
  const denomOf = (r) => (isRoster ? num(r.expected_hours, 0) : num(r.standard_hours, 0));

  const ratio = (list) => {
    const den = list.reduce((a, r) => a + denomOf(r), 0);
    if (den <= 0) return null;
    const numer = list.reduce((a, r) => a + Math.min(num(r.recorded_hours, 0), denomOf(r)), 0);
    return round1((numer / den) * 100);
  };
  const isDayShift = (r) => r.shift === 1 || String(r.shift).toUpperCase() === "DAY";

  const value = ratio(eligible);
  const present = eligible.filter((r) => num(r.recorded_hours, 0) > 0).length;
  const absent = eligible.filter((r) => num(r.recorded_hours, 0) === 0).length;

  return {
    ...base,
    value,
    helper: isRoster
      ? `${present}/${eligible.length} logged, ${absent} with nothing yet`
      : base.helper,
    detail: {
      ...base.detail,
      breakdown: enriched,
      machine_attribution: machine.attribution,
      recorded_rule: "recorded_hours = timesheet duration + machine running time outside the timesheet intervals",
      day_adoption_pct: ratio(eligible.filter(isDayShift)),
      night_adoption_pct: ratio(eligible.filter((r) => !isDayShift(r))),
      total_recorded_hours: Math.round(eligible.reduce((a, r) => a + num(r.recorded_hours, 0), 0) * 100) / 100,
      ...(isRoster ? { present, absent } : {}),
    },
  };
}

// Dispatcher: use the roster (attendance-based) when the target business_date has roster rows;
// otherwise fall back to the log-based computation (pre-roster dates).
async function calculateAdoptionLabour(bounds) {
  const timezone = resolveTimezone();
  let base;
  if (!(await tableExists("ews", "shift_roster"))) {
    base = await calculateAdoptionLabourFromLogs(bounds);
  } else {
    const has = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM ews.shift_roster WHERE business_date = ($1::timestamptz AT TIME ZONE $2)::date
       ) AS e`,
      [bounds.window_start, timezone],
    );
    base = has.rows[0]?.e ? await calculateAdoptionLabourFromRoster(bounds) : await calculateAdoptionLabourFromLogs(bounds);
  }

  try {
    const machine = await getMachineHoursByOperator(bounds);
    return applyMachineHoursToAdoptionLabour(base, machine);
  } catch (err) {
    // Machine credit is an enrichment: never let it take down the KPI.
    console.error("EWS adoption_labour machine-hours error:", err.message);
    return base;
  }
}

async function calculateAdoption(bounds) {
  const result = await db.query(
    `
    WITH bounds AS (
      SELECT
        $1::timestamptz AS window_start,
        $2::timestamptz AS window_end
    ),
    buckets AS (
      SELECT
        gs AS bucket_start,
        gs + interval '5 minutes' AS bucket_end
      FROM bounds b
      CROSS JOIN generate_series(
        b.window_start,
        GREATEST(b.window_start, b.window_end - interval '5 minutes'),
        interval '5 minutes'
      ) AS gs
    ),
    machine_buckets AS (
      SELECT
        b.bucket_start,
        b.bucket_end,
        COALESCE(NULLIF(BTRIM(mt.machineid), ''), NULLIF(BTRIM(mt.workcentercode), ''), 'UNKNOWN') AS machine_key,
        NULLIF(BTRIM(mt.sn_employee), '') AS operator_key,
        MAX(NULLIF(BTRIM(mt.full_name), '')) AS operator_name,
        BOOL_OR(mt.statusid = 5 OR LOWER(COALESCE(mt.status_description, '')) = 'unidentified') AS has_unidentified,
        COUNT(*)::int AS machine_event_count
      FROM buckets b
      JOIN public.mch_transaction mt
        ON mt.startdatetime < b.bucket_end
       AND COALESCE(mt.enddatetime, mt.startdatetime) > b.bucket_start
      WHERE COALESCE(mt.duration_hours, 0) > 0
        AND COALESCE(mt.statusid, 0) <> 4
        AND LOWER(COALESCE(mt.status_description, '')) NOT IN ('no job', 'off')
      GROUP BY b.bucket_start, b.bucket_end, 3, 4
    ),
    timesheet_buckets AS (
      SELECT DISTINCT
        b.bucket_start,
        NULLIF(BTRIM(t.serialnumber), '') AS operator_key,
        NULLIF(BTRIM(t.workcentercode), '') AS machine_key
      FROM buckets b
      JOIN public.timesheet_transaction t
        ON t.longdate_checkin < b.bucket_end
       AND COALESCE(t.longdate_checkout, t.longdate_checkin) > b.bucket_start
      WHERE COALESCE(t.state_flag, 1) <> 5
        AND COALESCE(t.duration, 0) > 0
    ),
    classified AS (
      SELECT
        mb.*,
        EXISTS (
          SELECT 1
          FROM timesheet_buckets tb
          WHERE tb.bucket_start = mb.bucket_start
            AND (
              (mb.operator_key IS NOT NULL AND tb.operator_key = mb.operator_key)
              OR (tb.machine_key IS NOT NULL AND tb.machine_key = mb.machine_key)
            )
        ) AS has_timesheet_match
      FROM machine_buckets mb
    ),
    summary AS (
      SELECT
        COUNT(*)::int AS expected_bucket_count,
        COUNT(*) FILTER (WHERE has_timesheet_match AND NOT has_unidentified)::int AS covered_bucket_count,
        COUNT(*) FILTER (WHERE NOT has_timesheet_match AND NOT has_unidentified)::int AS missing_bucket_count,
        COUNT(*) FILTER (WHERE has_unidentified)::int AS unidentified_bucket_count,
        COUNT(DISTINCT machine_key)::int AS machine_count,
        COUNT(DISTINCT operator_key) FILTER (WHERE operator_key IS NOT NULL)::int AS operator_count
      FROM classified
    ),
    sample_gaps AS (
      SELECT COALESCE(jsonb_agg(row_to_json(gap_row)), '[]'::jsonb) AS gaps
      FROM (
        SELECT
          to_char(bucket_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket_start,
          to_char(bucket_end, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket_end,
          machine_key,
          operator_key,
          operator_name,
          CASE
            WHEN has_unidentified THEN 'unidentified'
            ELSE 'missing_timesheet'
          END AS gap_type,
          machine_event_count
        FROM classified
        WHERE has_unidentified OR NOT has_timesheet_match
        ORDER BY bucket_start DESC, machine_key, operator_key NULLS LAST
        LIMIT 12
      ) gap_row
    ),
    -- Per-machine gap breakdown, reused by the adoption_machine issue generator so it
    -- never has to re-run this expensive bucket query. Only machines WITH a gap are kept.
    by_machine AS (
      SELECT COALESCE(
        jsonb_agg(m ORDER BY (m->>'gap_minutes')::int DESC),
        '[]'::jsonb
      ) AS machines
      FROM (
        SELECT jsonb_build_object(
          'machine_key', machine_key,
          'expected_buckets', COUNT(*),
          'covered_buckets', COUNT(*) FILTER (WHERE has_timesheet_match AND NOT has_unidentified),
          'missing_buckets', COUNT(*) FILTER (WHERE NOT has_timesheet_match AND NOT has_unidentified),
          'unidentified_buckets', COUNT(*) FILTER (WHERE has_unidentified),
          'gap_minutes', (COUNT(*) FILTER (WHERE NOT has_timesheet_match OR has_unidentified)) * 5,
          'cover_pct', ROUND(100.0 * COUNT(*) FILTER (WHERE has_timesheet_match AND NOT has_unidentified) / COUNT(*), 1)
        ) AS m
        FROM classified
        GROUP BY machine_key
        HAVING COUNT(*) FILTER (WHERE NOT has_timesheet_match OR has_unidentified) > 0
      ) x
    )
    SELECT summary.*, sample_gaps.gaps, by_machine.machines
    FROM summary CROSS JOIN sample_gaps CROSS JOIN by_machine
    `,
    [bounds.window_start, bounds.window_end],
  );
  const row = result.rows[0] || {};
  const value = pct(row.covered_bucket_count, row.expected_bucket_count);
  const expectedMinutes = num(row.expected_bucket_count, 0) * 5;
  const missingMinutes = (num(row.missing_bucket_count, 0) + num(row.unidentified_bucket_count, 0)) * 5;
  return {
    value,
    helper: value === null
      ? "No machine bucket in window"
      : `${num(row.covered_bucket_count, 0)}/${num(row.expected_bucket_count, 0)} buckets covered`,
    detail: {
      bucket_minutes: 5,
      expected_bucket_count: num(row.expected_bucket_count, 0),
      covered_bucket_count: num(row.covered_bucket_count, 0),
      missing_bucket_count: num(row.missing_bucket_count, 0),
      unidentified_bucket_count: num(row.unidentified_bucket_count, 0),
      machine_count: num(row.machine_count, 0),
      operator_count: num(row.operator_count, 0),
      expected_minutes: expectedMinutes,
      missing_minutes: missingMinutes,
      missing_time_buckets: row.gaps || [],
      per_machine: row.machines || [],
      denominator: "5-minute machine/operator buckets from mch_transaction, excluding No Job and Off but including statusid 5",
      numerator: "buckets with matching timesheet by operator serialnumber or machine/workcenter, excluding unidentified buckets",
      unidentified_rule: "statusid = 5 or status_description = Unidentified is counted as an adoption gap category, not excluded from denominator",
    },
  };
}

async function calculateOee(bounds) {
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        COALESCE(NULLIF(BTRIM(machineid), ''), NULLIF(BTRIM(workcentercode), ''), 'UNKNOWN') AS machine_key,
        duration_hours::float AS duration_hours,
        statusid,
        COALESCE(status_activitytype, '') AS status_activitytype,
        LOWER(BTRIM(COALESCE(status_description, ''))) AS status_description
      FROM public.mch_transaction
      WHERE startdatetime >= $1
        AND startdatetime < $2
        AND COALESCE(duration_hours, 0) > 0
    ),
    sys AS (
      SELECT
        COALESCE(SUM(duration_hours) FILTER (
          WHERE status_activitytype IN ('M1', 'M2')
             OR status_description = 'productive'
        ), 0)::float AS running_hours,
        COALESCE(SUM(duration_hours) FILTER (
          WHERE status_description NOT IN (
            'no job',
            'off',
            'preventive',
            'breakdown',
            'coffee break / lunch',
            'daily pm'
          )
        ), 0)::float AS denominator_hours,
        COALESCE(SUM(duration_hours) FILTER (
          WHERE status_description = 'downtime'
        ), 0)::float AS downtime_hours,
        COALESCE(SUM(duration_hours) FILTER (
          WHERE status_activitytype = 'M2'
        ), 0)::float AS setup_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE statusid = 5), 0)::float AS missing_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE statusid = 4), 0)::float AS nojob_hours,
        COALESCE(SUM(duration_hours), 0)::float AS total_hours
      FROM base
    ),
    -- Per-machine OEE breakdown, consumed by the oee issue generator (no re-query).
    -- running_h WAJIB COALESCE 0: mesin yang full-downtime tidak punya baris running
    -- sama sekali -> SUM FILTER = NULL -> oee_pct NULL -> generator men-skip justru
    -- mesin TERPARAH (bug 2026-07-12: 5 mesin downtime 8-19 jam tak pernah masuk
    -- issue log). NULL hanya untuk denom_h = 0 (murni NoJob/PM — memang no-data).
    by_machine AS (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'machine_key', machine_key,
        'running_hours', ROUND(running_h::numeric, 2),
        'denominator_hours', ROUND(denom_h::numeric, 2),
        'oee_pct', CASE WHEN denom_h > 0 THEN ROUND((running_h / denom_h * 100)::numeric, 1) ELSE NULL END,
        'loss_hours', ROUND((denom_h - running_h)::numeric, 2),
        'downtime_hours', ROUND(downtime_h::numeric, 2)
      ) ORDER BY (denom_h - running_h) DESC), '[]'::jsonb) AS machines
      FROM (
        SELECT
          b.machine_key,
          COALESCE(SUM(b.duration_hours) FILTER (
            WHERE b.status_activitytype IN ('M1', 'M2') OR b.status_description = 'productive'
          ), 0) AS running_h,
          SUM(b.duration_hours) FILTER (
            WHERE b.status_description NOT IN
              ('no job', 'off', 'preventive', 'breakdown', 'coffee break / lunch', 'daily pm')
          ) AS denom_h,
          COALESCE(SUM(b.duration_hours) FILTER (WHERE b.status_description = 'downtime'), 0) AS downtime_h
        FROM base b
        GROUP BY b.machine_key
        HAVING SUM(b.duration_hours) FILTER (
          WHERE b.status_description NOT IN
            ('no job', 'off', 'preventive', 'breakdown', 'coffee break / lunch', 'daily pm')
        ) > 0
      ) g
    )
    SELECT sys.*, by_machine.machines
    FROM sys CROSS JOIN by_machine
    `,
    [bounds.window_start, bounds.window_end],
  );
  const row = result.rows[0] || {};
  const value = pct(row.running_hours, row.denominator_hours);
  return {
    value,
    helper: value === null
      ? "No machine event in window"
      : `${round1(row.running_hours)}h running / ${round1(row.denominator_hours)}h counted`,
    detail: {
      running_hours: num(row.running_hours, 0),
      denominator_hours: num(row.denominator_hours, 0),
      downtime_hours: num(row.downtime_hours, 0),
      setup_hours: num(row.setup_hours, 0),
      missing_hours: num(row.missing_hours, 0),
      nojob_hours: num(row.nojob_hours, 0),
      total_hours: num(row.total_hours, 0),
      per_machine: row.machines || [],
      denominator: "Positive machine time excluding No Job, Off, Preventive, Breakdown, Coffee Break/Lunch, and Daily PM",
      numerator: "M1 + M2 + Productive machine event time",
      note: "This is an EWS time-based OEE proxy, not classic Availability x Performance x Quality OEE.",
    },
  };
}

async function calculateOle(bounds) {
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        NULLIF(BTRIM(serialnumber), '') AS operator_key,
        NULLIF(BTRIM(full_name), '') AS operator_name,
        activitytype,
        order_no,
        duration::float AS duration
      FROM public.timesheet_transaction
      WHERE longdate_checkin >= $1
        AND longdate_checkin < $2
        AND COALESCE(state_flag, 1) <> 5
    ),
    sys AS (
      SELECT
        COALESCE(SUM(duration) FILTER (
          WHERE activitytype IS NULL
            AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
            AND COALESCE(duration, 0) > 0
        ), 0)::float AS working_hours,
        COALESCE(SUM(duration) FILTER (
          WHERE COALESCE(duration, 0) > 0
        ), 0)::float AS available_recorded_hours,
        COUNT(DISTINCT operator_key) FILTER (WHERE operator_key IS NOT NULL)::int AS operator_count
      FROM base
    ),
    -- Per-operator OLE breakdown, consumed by the ole issue generator (no re-query).
    by_operator AS (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'operator_key', operator_key,
        'operator_name', operator_name,
        'working_hours', ROUND(working_h::numeric, 2),
        'available_hours', ROUND(avail_h::numeric, 2),
        'ole_pct', CASE WHEN avail_h > 0 THEN ROUND((working_h / avail_h * 100)::numeric, 1) ELSE NULL END,
        'nva_hours', ROUND((avail_h - working_h)::numeric, 2)
      ) ORDER BY (avail_h - working_h) DESC), '[]'::jsonb) AS operators
      FROM (
        SELECT
          operator_key,
          MAX(operator_name) AS operator_name,
          SUM(duration) FILTER (
            WHERE activitytype IS NULL
              AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
              AND COALESCE(duration, 0) > 0
          ) AS working_h,
          SUM(duration) FILTER (WHERE COALESCE(duration, 0) > 0) AS avail_h
        FROM base
        WHERE operator_key IS NOT NULL
        GROUP BY operator_key
        HAVING SUM(duration) FILTER (WHERE COALESCE(duration, 0) > 0) > 0
      ) g
    )
    SELECT sys.*, by_operator.operators
    FROM sys CROSS JOIN by_operator
    `,
    [bounds.window_start, bounds.window_end],
  );
  const row = result.rows[0] || {};
  const value = pct(row.working_hours, row.available_recorded_hours);
  return {
    value,
    helper: value === null
      ? "No labor record in window"
      : `${round1(row.working_hours)}h productive / ${round1(row.available_recorded_hours)}h recorded`,
    detail: {
      working_hours: num(row.working_hours, 0),
      available_recorded_hours: num(row.available_recorded_hours, 0),
      operator_count: num(row.operator_count, 0),
      per_operator: row.operators || [],
      denominator: "total recorded operator duration, excluding deleted rows",
      numerator: "productive rows with order_no and activitytype NULL",
    },
  };
}

function buildKpi(key, calculation, thresholds) {
  const def = KPI_DEFS[key];
  const raw = calculation.value;
  const value = raw === null || raw === undefined ? null : round1(raw);
  return {
    key,
    label: def.label,
    value,
    target: def.target,
    owner: thresholds[key]?.owner || def.owner,
    group: def.group,
    dimension: def.dimension,
    // Status dievaluasi pada nilai UNROUNDED (A-R4): 94.95 harus "watch" meski
    // tampil 95.0 — round1 hanya untuk display.
    status: statusForValue(key, raw === undefined ? null : raw, thresholds),
    helper: calculation.helper,
    detail: calculation.detail,
  };
}

// Registered-but-not-yet-computed KPI (uptime_*, and adoption_labour until Phase 2).
function placeholderCalculation(note) {
  return { value: null, helper: note, detail: { source: "placeholder", computed: false } };
}

function buildIssues(kpis) {
  return kpis
    .filter((kpi) => kpi.status === "critical" || kpi.status === "watch")
    .sort((a, b) => {
      const order = { critical: 0, watch: 1 };
      return order[a.status] - order[b.status] || (a.value ?? 999) - (b.value ?? 999);
    })
    .map((kpi) => ({
      machine: "SYSTEM",
      kpi: kpi.label,
      value: kpi.value === null ? "No data" : `${kpi.value.toFixed(1)}%`,
      severity: kpi.status === "critical" ? "Critical" : "Watch",
      action: suggestedAction(kpi.key),
    }));
}

function suggestedAction(key) {
  const actions = {
    uptime_tablet: "Uptime tablet belum dihitung",
    uptime_hmi: "Uptime HMI belum dihitung",
    accuracy_labour: "Review timesheet error breakdown and SAP FAILED rows",
    accuracy_machine: "Check mch_productiondata rows without mch_transaction",
    adoption_labour: "Check operator recorded hours vs shift standard",
    adoption_machine: "Check missing operator input vs machine event time",
    oee: "Review Productive, M2, Downtime, and Idle mix",
    ole: "Review productive labor rows vs total recorded time",
  };
  return actions[key] || "Review KPI detail";
}

// D1: status-only headline. overall_score is retired (null); Performance and Health are
// scored separately so a flat 8-KPI average never masks a critical dimension.
function dimensionScore(kpis, dimension) {
  const withValues = kpis.filter(
    (kpi) => kpi.dimension === dimension && kpi.value !== null && kpi.value !== undefined,
  );
  if (!withValues.length) return null;
  const score = withValues.reduce((sum, kpi) => {
    const target = num(kpi.target, 100);
    return sum + Math.min(num(kpi.value, 0) / target, 1);
  }, 0) / withValues.length;
  return Math.round(score * 100) / 100;
}

function overall(kpis) {
  const withValues = kpis.filter((kpi) => kpi.value !== null && kpi.value !== undefined);
  if (!withValues.length) {
    return { overall_score: null, overall_status: "NO_DATA", performance_score: null, health_score: null };
  }

  const statuses = withValues.map((kpi) => kpi.status);
  const overall_status = statuses.includes("critical")
    ? "CRITICAL"
    : statuses.includes("watch")
      ? "WATCH"
      : "NORMAL";

  return {
    overall_score: null,
    overall_status,
    performance_score: dimensionScore(kpis, "performance"),
    health_score: dimensionScore(kpis, "health"),
  };
}

async function saveSnapshot({ windowStart, windowEnd, grain, payload }) {
  if (!(await tableExists("ews", "kpi_snapshot"))) return;

  const byKey = Object.fromEntries(payload.kpis.map((kpi) => [kpi.key, kpi]));
  // D3: keep the legacy accuracy_pct/adoption_pct columns filled for backward-compat readers.
  const labourTotal = num(byKey.accuracy_labour?.detail?.total_records, 0);
  const machineTotal = num(byKey.accuracy_machine?.detail?.total_records, 0);
  const combinedReady = num(byKey.accuracy_labour?.detail?.ready_records, 0)
    + num(byKey.accuracy_machine?.detail?.ready_records, 0);
  const combinedTotal = labourTotal + machineTotal;
  const legacyAccuracy = combinedTotal > 0 ? round1((combinedReady / combinedTotal) * 100) : null;
  await db.query(
    `
    INSERT INTO ews.kpi_snapshot (
      window_start, window_end, grain, scope_type, scope_key,
      uptime_pct, accuracy_pct, adoption_pct, oee_pct, ole_pct,
      overall_score, overall_status, detail_json
    )
    VALUES ($1, $2, $3, 'system', 'ALL', $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    ON CONFLICT (window_start, grain, scope_type, scope_key, shift_id)
    DO UPDATE SET
      window_end = EXCLUDED.window_end,
      uptime_pct = EXCLUDED.uptime_pct,
      accuracy_pct = EXCLUDED.accuracy_pct,
      adoption_pct = EXCLUDED.adoption_pct,
      oee_pct = EXCLUDED.oee_pct,
      ole_pct = EXCLUDED.ole_pct,
      overall_score = EXCLUDED.overall_score,
      overall_status = EXCLUDED.overall_status,
      detail_json = EXCLUDED.detail_json,
      calculated_at = now()
    `,
    [
      windowStart,
      windowEnd,
      grain,
      byKey.uptime_hmi?.value ?? null,
      legacyAccuracy,
      byKey.adoption_machine?.value ?? null,
      byKey.oee?.value,
      byKey.ole?.value,
      payload.overall_score,
      payload.overall_status,
      JSON.stringify({
        kpis: payload.kpis,
        issues: payload.issues,
        correction_queue: payload.correction_queue,
        performance_score: payload.performance_score,
        health_score: payload.health_score,
        previous_window_start: payload.previous_window_start,
        previous_window_end: payload.previous_window_end,
        meta: payload.meta,
      }),
    ],
  );
}

async function safeCalculation(key, calculateFn) {
  try {
    return await calculateFn();
  } catch (err) {
    console.error(`EWS ${key} calculation error:`, err.message);
    return {
      value: null,
      helper: `${KPI_DEFS[key]?.label || key} unavailable: ${err.message}`,
      detail: {
        error: err.message,
        source: "calculation_error",
      },
    };
  }
}

async function calculateAdoptionForMainSnapshot(bounds, grain) {
  if (!shouldCalculateAdoptionInMain()) {
    return getCachedAdoptionCalculation(grain);
  }

  return safeCalculation("adoption", async () => calculateAdoption(bounds));
}

async function calculateKpisForBounds(bounds, thresholds, options = {}) {
  const accuracyLabour = await safeCalculation("accuracy_labour", async () => calculateAccuracyLabour(bounds));
  const accuracyMachine = await safeCalculation("accuracy_machine", async () => calculateAccuracyMachine(bounds));
  const adoptionLabour = await safeCalculation("adoption_labour", async () => calculateAdoptionLabour(bounds));
  const adoptionMachine = await calculateAdoptionForMainSnapshot(bounds, options.grain);
  const oee = await safeCalculation("oee", async () => calculateOee(bounds));
  const ole = await safeCalculation("ole", async () => calculateOle(bounds));

  // Row LABOUR
  return [
    buildKpi("uptime_tablet", placeholderCalculation("Uptime tablet not computed yet"), thresholds),
    buildKpi("accuracy_labour", accuracyLabour, thresholds),
    buildKpi("adoption_labour", adoptionLabour, thresholds),
    buildKpi("ole", ole, thresholds),
    // Row MACHINE
    buildKpi("uptime_hmi", await safeCalculation("uptime_hmi", async () => calculateUptimeHmi({ role: options.role })), thresholds),
    buildKpi("accuracy_machine", accuracyMachine, thresholds),
    buildKpi("adoption_machine", adoptionMachine, thresholds),
    buildKpi("oee", oee, thresholds),
  ];
}

function withComparison(currentKpis, previousKpis) {
  const previousByKey = Object.fromEntries(previousKpis.map((kpi) => [kpi.key, kpi]));
  return currentKpis.map((kpi) => {
    const previous = previousByKey[kpi.key];
    const currentValue = num(kpi.value);
    const previousValue = num(previous?.value);
    const delta = currentValue === null || previousValue === null
      ? null
      : Math.round((currentValue - previousValue) * 10) / 10;
    return {
      ...kpi,
      comparison: {
        previous_value: previousValue,
        delta,
        direction: delta === null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
        label: "vs previous day same time",
      },
    };
  });
}

// Adoption is read from a cached "today" snapshot, so its "previous window"
// value equals the current one (delta 0). Pull yesterday's real adoption from
// the historical daily snapshot instead so the comparison is meaningful.
async function getYesterdayAdoption() {
  if (!(await tableExists("ews", "kpi_snapshot"))) return null;
  const timezone = resolveTimezone();
  const result = await db.query(
    `
    SELECT adoption_pct::float AS value
    FROM ews.kpi_snapshot
    WHERE scope_type = 'system'
      AND scope_key = 'ALL'
      AND adoption_pct IS NOT NULL
      AND (window_end AT TIME ZONE $1)::date = ((now() AT TIME ZONE $1)::date - 1)
    ORDER BY window_end DESC
    LIMIT 1
    `,
    [timezone],
  );
  return result.rows[0] ? num(result.rows[0].value) : null;
}

async function applyYesterdayAdoptionComparison(kpis) {
  let previousAdoption = null;
  try {
    previousAdoption = await getYesterdayAdoption();
  } catch (err) {
    console.error("EWS yesterday adoption comparison error:", err.message);
    return kpis;
  }
  return kpis.map((kpi) => {
    if (kpi.key !== "adoption_machine") return kpi;
    const current = num(kpi.value);
    const delta = current === null || previousAdoption === null
      ? null
      : Math.round((current - previousAdoption) * 10) / 10;
    return {
      ...kpi,
      comparison: {
        previous_value: previousAdoption,
        delta,
        direction: delta === null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
        label: "vs kemarin",
      },
    };
  });
}

async function resolveSummaryBounds(options = {}) {
  if (options.basis === "date") {
    const bounds = await getDateBounds(options.date);
    return {
      // Manual date mode is for safe local/debug analysis only.
      // It uses live reads and is intentionally not written into ews.kpi_snapshot.
      basis: "date",
      grain: "date",
      read_only: true,
      current: {
        window_start: bounds.window_start,
        window_end: bounds.window_end,
      },
      previous: null,
    };
  }

  if (options.basis === "today") {
    const bounds = await getTodayBounds();
    return {
      basis: "today",
      grain: "today",
      current: {
        window_start: bounds.window_start,
        window_end: bounds.window_end,
      },
      previous: {
        window_start: bounds.previous_start,
        window_end: bounds.previous_end,
      },
    };
  }

  const grain = normalizeWindow(options.window);
  const intervalText = intervalForWindow(grain);
  const bounds = await getWindowBounds(intervalText);
  return {
    basis: "rolling",
    grain,
    current: bounds,
    previous: null,
  };
}

// Resilience: a transient calc failure (DB connection/timeout) makes safeCalculation
// return a null value tagged source="calculation_error". Writing that null over a good
// snapshot value makes the KPI card flip to 0/no_data and back — the "kadang muncul
// kadang 0" symptom. Instead, carry forward the last non-null value for the errored KPI.
async function carryForwardErroredKpis(kpis, grain) {
  if (!kpis.some((k) => k?.detail?.source === "calculation_error")) return kpis;
  if (!(await tableExists("ews", "kpi_snapshot"))) return kpis;
  let prevByKey = {};
  try {
    const res = await db.query(
      `SELECT detail_json->'kpis' AS kpis
         FROM ews.kpi_snapshot
        WHERE grain = $1 AND scope_type = 'system' AND scope_key = 'ALL'
        ORDER BY window_end DESC, calculated_at DESC
        LIMIT 1`,
      [grain],
    );
    const prev = res.rows[0]?.kpis;
    if (Array.isArray(prev)) prevByKey = Object.fromEntries(prev.map((k) => [k.key, k]));
  } catch (_err) {
    return kpis; // no previous snapshot to fall back on — leave as-is
  }
  return kpis.map((k) => {
    if (k?.detail?.source !== "calculation_error") return k;
    const prev = prevByKey[k.key];
    if (!prev || prev.value === null || prev.value === undefined) return k;
    return {
      ...k,
      value: prev.value,
      status: prev.status || k.status,
      helper: `${prev.helper || "nilai terakhir"} · (nilai terakhir — hitung ulang gagal)`,
      detail: { ...(prev.detail || {}), carried_forward: true, last_error: k.detail?.error || null },
    };
  });
}

async function calculateSystemSummary(input = {}) {
  const options = typeof input === "string" ? { window: input } : input;
  const resolved = await resolveSummaryBounds(options);
  const thresholds = await getThresholds();

  let kpis = await calculateKpisForBounds(resolved.current, thresholds, { grain: resolved.grain, role: "current" });
  if (!resolved.read_only) kpis = await carryForwardErroredKpis(kpis, resolved.grain);
  let previousSummary = null;

  if (resolved.previous) {
    const previousKpis = await calculateKpisForBounds(resolved.previous, thresholds, { grain: resolved.grain, role: "previous" });
    previousSummary = overall(previousKpis);
    kpis = withComparison(kpis, previousKpis);
    kpis = await applyYesterdayAdoptionComparison(kpis);
  }

  const summary = overall(kpis);
  const issues = buildIssues(kpis);

  const payload = {
    ...summary,
    window_start: resolved.current.window_start,
    window_end: resolved.current.window_end,
    previous_window_start: resolved.previous?.window_start || null,
    previous_window_end: resolved.previous?.window_end || null,
    basis: resolved.basis,
    grain: resolved.grain,
    kpis,
    issues,
    correction_queue: {
      open_actions: 0,
      critical_aging: 0,
      next_escalation_minutes: 15,
    },
    meta: {
      calculated_at: new Date().toISOString(),
      source: "live_calculation",
      previous_overall_score: previousSummary?.overall_score ?? null,
      previous_overall_status: previousSummary?.overall_status ?? null,
    },
  };

  if (!resolved.read_only) {
    await saveSnapshot({
      windowStart: resolved.current.window_start,
      windowEnd: resolved.current.window_end,
      grain: resolved.grain,
      payload,
    }).catch((err) => {
      console.error("EWS saveSnapshot error:", err.message);
    });
  }

  return payload;
}

module.exports = {
  calculateSystemSummary,
  normalizeWindow,
};
