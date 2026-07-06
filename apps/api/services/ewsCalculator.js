const db = global.pool || require("../db");

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

// Provisional pending HR policy. Single source of truth — do not scatter.
const ADOPTION_LABOUR_GRACE_MINUTES = 15;
const SHIFT_STANDARD_HOURS = { 1: 8, 2: 7 };

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
  const result = await db.query(`
    SELECT
      date_trunc('day', now()) AS window_start,
      now() AS window_end,
      date_trunc('day', now()) - interval '1 day' AS previous_start,
      now() - interval '1 day' AS previous_end
  `);
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
  const timezone = process.env.TIMEZONE || "Asia/Makassar";
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

// accuracy_machine: unchanged math — mch_productiondata rows matched to mch_transaction.
async function calculateAccuracyMachine(bounds) {
  const result = await db.query(
    `
    SELECT
      COUNT(*)::int AS total_records,
      COUNT(*) FILTER (WHERE mt.proddataid IS NOT NULL)::int AS ready_records,
      COUNT(*) FILTER (WHERE mt.proddataid IS NULL)::int AS missing_mch_transaction
    FROM public.mch_productiondata pd
    LEFT JOIN public.mch_transaction mt
      ON mt.proddataid = pd.proddataid
    WHERE pd.startdatetime >= $1
      AND pd.startdatetime < $2
    `,
    [bounds.window_start, bounds.window_end],
  );

  const row = result.rows[0] || {};
  const total = num(row.total_records, 0);
  const ready = num(row.ready_records, 0);
  const value = pct(ready, total);
  return {
    value,
    helper: value === null ? "No machine record in window" : `${ready}/${total} matched machine records`,
    detail: {
      total_records: total,
      ready_records: ready,
      not_ready_records: Math.max(0, total - ready),
      missing_mch_transaction: num(row.missing_mch_transaction, 0),
      minimum_sample_met: total >= 50,
      denominator: "mch_productiondata rows in window",
      numerator: "mch_productiondata rows present in mch_transaction",
    },
  };
}

// adoption_labour: of operators who logged something in the window, the share meeting their
// PRO-RATED standard shift hours. Source: timesheet_transaction ONLY (no roster source exists,
// so operators with zero rows are invisible — surfaced in detail.limitation). No correlated
// subqueries here, but aliases are qualified regardless.
async function calculateAdoptionLabour(bounds) {
  const timezone = process.env.TIMEZONE || "Asia/Makassar";
  const result = await db.query(
    `
    WITH scoped AS (
      SELECT
        NULLIF(BTRIM(t.serialnumber), '') AS operator_key,
        NULLIF(BTRIM(t.full_name), '') AS operator_name,
        (t.longdate_checkin AT TIME ZONE $3) AS lct,
        t.duration::float AS dur
      FROM public.timesheet_transaction t
      WHERE t.longdate_checkin >= $1
        AND t.longdate_checkin < $2
        AND COALESCE(t.state_flag, 0) <> 5
        AND COALESCE(t.duration, 0) > 0
        AND NULLIF(BTRIM(t.serialnumber), '') IS NOT NULL
    ),
    classified AS (
      SELECT
        s.operator_key,
        s.operator_name,
        s.lct,
        s.dur,
        CASE
          WHEN s.lct::time >= TIME '08:00' AND s.lct::time < TIME '17:00' THEN 1
          WHEN s.lct::time >= TIME '17:00' THEN 2
          WHEN s.lct::time < TIME '06:00' THEN 2
          ELSE NULL
        END AS row_shift,
        CASE WHEN s.lct::time < TIME '06:00' THEN (s.lct::date - 1) ELSE s.lct::date END AS business_date
      FROM scoped s
    ),
    grouped AS (
      SELECT
        c.operator_key,
        c.business_date,
        MAX(c.operator_name) AS operator_name,
        (array_agg(c.row_shift ORDER BY c.lct))[1] AS shift,
        SUM(c.dur) AS recorded
      FROM classified c
      WHERE c.row_shift IS NOT NULL
      GROUP BY c.operator_key, c.business_date
    ),
    prorated AS (
      SELECT
        g.operator_key,
        g.operator_name,
        g.business_date,
        g.shift,
        g.recorded,
        CASE WHEN g.shift = 1 THEN 8.0 ELSE 7.0 END AS full_standard,
        GREATEST(
          EXTRACT(EPOCH FROM (
            now() - ((g.business_date + CASE WHEN g.shift = 1 THEN TIME '08:00' ELSE TIME '17:00' END) AT TIME ZONE $3)
          )) / 3600.0,
          0
        ) AS elapsed_hours
      FROM grouped g
    ),
    final AS (
      SELECT
        p.operator_key,
        p.operator_name,
        p.business_date,
        p.shift,
        p.recorded,
        p.full_standard,
        LEAST(GREATEST(p.elapsed_hours - ($4::numeric / 60.0), 0), p.full_standard) AS prorated_standard
      FROM prorated p
    )
    SELECT
      ROUND((SUM(LEAST(f.recorded, f.prorated_standard)) / NULLIF(SUM(f.prorated_standard), 0) * 100)::numeric, 4)::float AS adoption_pct,
      COUNT(*)::int AS operator_shift_count,
      COUNT(*) FILTER (WHERE f.prorated_standard < f.full_standard)::int AS in_progress_count,
      ROUND(SUM(f.recorded)::numeric, 2)::float AS total_recorded_hours,
      ROUND(SUM(f.prorated_standard)::numeric, 2)::float AS total_prorated_standard_hours,
      ROUND(SUM(f.full_standard)::numeric, 2)::float AS total_full_standard_hours,
      COALESCE(jsonb_agg(jsonb_build_object(
        'operator_key', f.operator_key,
        'operator_name', f.operator_name,
        'shift', f.shift,
        'business_date', f.business_date,
        'recorded_hours', ROUND(f.recorded::numeric, 2),
        'prorated_standard_hours', ROUND(f.prorated_standard::numeric, 2),
        'full_standard_hours', f.full_standard,
        'gap_hours', ROUND(GREATEST(f.prorated_standard - f.recorded, 0)::numeric, 2),
        'is_in_progress', (f.prorated_standard < f.full_standard)
      ) ORDER BY GREATEST(f.prorated_standard - f.recorded, 0) DESC), '[]'::jsonb) AS breakdown
    FROM final f
    `,
    [bounds.window_start, bounds.window_end, timezone, ADOPTION_LABOUR_GRACE_MINUTES],
  );

  const row = result.rows[0] || {};
  const count = num(row.operator_shift_count, 0);
  const rawPct = row.adoption_pct;
  const value = count > 0 && rawPct !== null && rawPct !== undefined ? num(rawPct) : null;
  return {
    value,
    helper: count > 0
      ? `${count} operator-shift, ${num(row.in_progress_count, 0)} berjalan`
      : "No operator timesheet in window",
    detail: {
      operator_shift_count: count,
      in_progress_count: num(row.in_progress_count, 0),
      total_recorded_hours: num(row.total_recorded_hours, 0),
      total_prorated_standard_hours: num(row.total_prorated_standard_hours, 0),
      total_full_standard_hours: num(row.total_full_standard_hours, 0),
      grace_minutes: ADOPTION_LABOUR_GRACE_MINUTES,
      shift_standard_hours: SHIFT_STANDARD_HOURS,
      breakdown: row.breakdown || [],
      denominator: "SUM of pro-rated standard hours per (operator, business_date) — pro-rated to elapsed-minus-grace for in-progress shifts",
      numerator: "SUM of LEAST(recorded, pro-rated standard) — overtime never inflates",
      limitation: "Only operators who logged rows are visible (no roster source). This is 'of operators who logged, % meeting pro-rated standard hours', NOT attendance-based adoption.",
      staging_read: false,
      roster_read: false,
    },
  };
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
    )
    SELECT summary.*, sample_gaps.gaps
    FROM summary CROSS JOIN sample_gaps
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
        duration_hours::float AS duration_hours,
        statusid,
        COALESCE(status_activitytype, '') AS status_activitytype,
        LOWER(BTRIM(COALESCE(status_description, ''))) AS status_description
      FROM public.mch_transaction
      WHERE startdatetime >= $1
        AND startdatetime < $2
        AND COALESCE(duration_hours, 0) > 0
    )
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
      denominator: "Positive machine time excluding No Job, Off, Preventive, Breakdown, Coffee Break/Lunch, and Daily PM",
      numerator: "M1 + M2 + Productive machine event time",
      note: "This is an EWS time-based OEE proxy, not classic Availability x Performance x Quality OEE.",
    },
  };
}

async function calculateOle(bounds) {
  const result = await db.query(
    `
    SELECT
      COALESCE(SUM(duration) FILTER (
        WHERE activitytype IS NULL
          AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
          AND COALESCE(duration, 0) > 0
      ), 0)::float AS working_hours,
      COALESCE(SUM(duration) FILTER (
        WHERE COALESCE(duration, 0) > 0
      ), 0)::float AS available_recorded_hours,
      COUNT(DISTINCT serialnumber) FILTER (WHERE serialnumber IS NOT NULL)::int AS operator_count
    FROM public.timesheet_transaction
    WHERE longdate_checkin >= $1
      AND longdate_checkin < $2
      AND COALESCE(state_flag, 1) <> 5
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
    status: statusForValue(key, value, thresholds),
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
    ON CONFLICT (window_start, window_end, grain, scope_type, scope_key, shift_id)
    DO UPDATE SET
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
    buildKpi("uptime_hmi", placeholderCalculation("Uptime HMI not computed yet"), thresholds),
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
  const timezone = process.env.TIMEZONE || "Asia/Makassar";
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

async function calculateSystemSummary(input = {}) {
  const options = typeof input === "string" ? { window: input } : input;
  const resolved = await resolveSummaryBounds(options);
  const thresholds = await getThresholds();

  let kpis = await calculateKpisForBounds(resolved.current, thresholds, { grain: resolved.grain, role: "current" });
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
