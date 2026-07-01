const db = global.pool || require("../db");

const KPI_DEFS = {
  uptime: { label: "Uptime", target: 99, owner: "IT" },
  accuracy: { label: "Accuracy", target: 97, owner: "Foreman" },
  adoption: { label: "Adoption", target: 95, owner: "Spv" },
  oee: { label: "OEE", target: 65, owner: "PPIC" },
  ole: { label: "OLE", target: 85, owner: "Spv" },
};

const DEFAULT_THRESHOLDS = {
  uptime: { normal_min: 98, warning_min: 95, critical_below: 95 },
  accuracy: { normal_min: 97, warning_min: 95, critical_below: 95 },
  adoption: { normal_min: 95, warning_min: 90, critical_below: 90 },
  oee: { normal_min: 65, warning_min: 50, critical_below: 50 },
  ole: { normal_min: 85, warning_min: 70, critical_below: 70 },
};

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

async function getCachedAdoptionCalculation(grain) {
  if (await tableExists("ews", "adoption_summary_snapshot")) {
    const summaryResult = await db.query(
      `
      SELECT *
      FROM ews.adoption_summary_snapshot
      WHERE grain = $1
        AND adoption_pct IS NOT NULL
      ORDER BY window_end DESC, calculated_at DESC
      LIMIT 1
      `,
      [grain || "today"],
    );

    const summary = summaryResult.rows[0];
    if (summary) {
      const expectedMinutes = num(summary.expected_bucket_count, 0) * 5;
      const missingMinutes = (num(summary.missing_bucket_count, 0) + num(summary.unidentified_bucket_count, 0)) * 5;
      return {
        value: num(summary.adoption_pct),
        helper: `${num(summary.covered_bucket_count, 0)}/${num(summary.expected_bucket_count, 0)} buckets covered`,
        detail: {
          bucket_minutes: 5,
          expected_bucket_count: num(summary.expected_bucket_count, 0),
          covered_bucket_count: num(summary.covered_bucket_count, 0),
          missing_bucket_count: num(summary.missing_bucket_count, 0),
          unidentified_bucket_count: num(summary.unidentified_bucket_count, 0),
          machine_count: num(summary.machine_count, 0),
          operator_count: num(summary.operator_count, 0),
          expected_minutes: expectedMinutes,
          missing_minutes: missingMinutes,
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

async function calculateUptime(bounds, options = {}) {
  if (!(await tableExists("public", "mch_machine_ping_log"))) {
    return { value: null, helper: "Ping log table not available", detail: { sample_count: 0 } };
  }

  const useTodayPingWindow = options.grain === "today" && options.role !== "previous";
  const result = await db.query(
    `
    WITH effective_bounds AS (
      SELECT
        CASE WHEN $3::boolean THEN date_trunc('day', now()) ELSE $1::timestamptz END AS window_start,
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
    [bounds.window_start, bounds.window_end, useTodayPingWindow],
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
      window_rule: useTodayPingWindow ? "today ping samples only" : "provided window bounds",
      denominator: "SUM(ping_count)",
      numerator: "SUM(success_count)",
    },
  };
}

async function calculateAccuracy(bounds) {
  const tsResult = await db.query(
    `
    WITH base AS (
      SELECT
        t.*,
        EXISTS (
          SELECT 1
          FROM public.sow s
          WHERE LTRIM(COALESCE(s.order_no, ''), '0') = LTRIM(COALESCE(t.order_no, ''), '0')
            AND s.operation_no::text = t.operation_no::text
        ) AS has_sow_match,
        ABS(
          COALESCE(t.duration, 0)
          - COALESCE(EXTRACT(EPOCH FROM (t.longdate_checkout - t.longdate_checkin)) / 3600.0, COALESCE(t.duration, 0))
        ) AS duration_delta_hours
      FROM public.timesheet_transaction t
      WHERE t.longdate_checkin >= $1
        AND t.longdate_checkin < $2
        AND COALESCE(t.state_flag, 1) <> 5
    ),
    flags AS (
      SELECT
        *,
        (activitytype IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NULL) AS missing_order,
        (activitytype IS NULL AND operation_no IS NULL) AS missing_operation,
        (longdate_checkin IS NULL) AS missing_checkin,
        (longdate_checkout IS NULL AND longdate_checkin < now() - interval '30 minutes') AS stale_open_checkout,
        (duration IS NULL OR duration < 0) AS invalid_duration,
        (longdate_checkout IS NOT NULL AND duration_delta_hours > 0.10) AS duration_mismatch,
        (activitytype IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL AND operation_no IS NOT NULL AND NOT has_sow_match) AS sow_no_match,
        (activitytype IS NULL AND planhours IS NULL) AS missing_planhours
      FROM base
    )
    SELECT
      COUNT(*)::int AS total_records,
      COUNT(*) FILTER (
        WHERE missing_order OR missing_operation OR missing_checkin OR stale_open_checkout
           OR invalid_duration OR duration_mismatch OR sow_no_match OR missing_planhours
      )::int AS error_records,
      COUNT(*) FILTER (WHERE missing_order)::int AS missing_order,
      COUNT(*) FILTER (WHERE missing_operation)::int AS missing_operation,
      COUNT(*) FILTER (WHERE stale_open_checkout)::int AS stale_open_checkout,
      COUNT(*) FILTER (WHERE invalid_duration)::int AS invalid_duration,
      COUNT(*) FILTER (WHERE duration_mismatch)::int AS duration_mismatch,
      COUNT(*) FILTER (WHERE sow_no_match)::int AS sow_no_match,
      COUNT(*) FILTER (WHERE missing_planhours)::int AS missing_planhours
    FROM flags
    `,
    [bounds.window_start, bounds.window_end],
  );

  const row = tsResult.rows[0] || {};
  let sapTotal = 0;
  let sapFailed = 0;
  let sapPending = 0;

  if (await tableExists("public", "sap_timesheet_staging")) {
    const sapResult = await db.query(
      `
      SELECT
        COUNT(*)::int AS total_records,
        COUNT(*) FILTER (WHERE UPPER(status) = 'FAILED')::int AS failed_records,
        COUNT(*) FILTER (WHERE UPPER(status) = 'PENDING')::int AS pending_records
      FROM public.sap_timesheet_staging
      WHERE created_at >= $1
        AND created_at < $2
      `,
      [bounds.window_start, bounds.window_end],
    );
    sapTotal = num(sapResult.rows[0]?.total_records, 0);
    sapFailed = num(sapResult.rows[0]?.failed_records, 0);
    sapPending = num(sapResult.rows[0]?.pending_records, 0);
  }

  const total = num(row.total_records, 0) + sapTotal;
  const errors = num(row.error_records, 0) + sapFailed;
  const value = total > 0 ? Math.max(0, (1 - errors / total) * 100) : null;

  return {
    value,
    helper: value === null ? "No timesheet record in window" : `${errors}/${total} error records`,
    detail: {
      total_records: total,
      timesheet_records: num(row.total_records, 0),
      error_records: errors,
      sap_total: sapTotal,
      sap_failed: sapFailed,
      sap_pending_backlog: sapPending,
      error_breakdown: {
        missing_order: num(row.missing_order, 0),
        missing_operation: num(row.missing_operation, 0),
        stale_open_checkout: num(row.stale_open_checkout, 0),
        invalid_duration: num(row.invalid_duration, 0),
        duration_mismatch: num(row.duration_mismatch, 0),
        sow_no_match: num(row.sow_no_match, 0),
        missing_planhours: num(row.missing_planhours, 0),
      },
      denominator: "timesheet records + SAP staging rows in window",
      numerator: "1 - (timesheet errors + SAP FAILED) / denominator",
      minimum_sample_met: total >= 50,
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
    SELECT
      COALESCE(SUM(duration_hours) FILTER (
        WHERE COALESCE(status_activitytype, '') = 'M1'
           OR LOWER(COALESCE(status_description, '')) = 'productive'
      ), 0)::float AS running_hours,
      COALESCE(SUM(duration_hours) FILTER (
        WHERE COALESCE(duration_hours, 0) > 0
          AND LOWER(COALESCE(status_description, '')) NOT IN ('no job', 'off')
      ), 0)::float AS denominator_hours,
      COALESCE(SUM(duration_hours) FILTER (
        WHERE LOWER(COALESCE(status_description, '')) IN ('downtime', 'breakdown')
      ), 0)::float AS downtime_hours,
      COALESCE(SUM(duration_hours) FILTER (
        WHERE COALESCE(status_activitytype, '') = 'M2'
      ), 0)::float AS setup_hours
    FROM public.mch_transaction
    WHERE startdatetime >= $1
      AND startdatetime < $2
    `,
    [bounds.window_start, bounds.window_end],
  );
  const row = result.rows[0] || {};
  const value = pct(row.running_hours, row.denominator_hours);
  return {
    value,
    helper: value === null
      ? "No machine event in window"
      : `${round1(row.running_hours)}h productive / ${round1(row.denominator_hours)}h counted`,
    detail: {
      running_hours: num(row.running_hours, 0),
      denominator_hours: num(row.denominator_hours, 0),
      downtime_hours: num(row.downtime_hours, 0),
      setup_hours: num(row.setup_hours, 0),
      denominator: "Productive + M2 + Downtime + Idle, excluding No Job and Off",
      numerator: "Productive machine event time",
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
  const value = round1(calculation.value);
  return {
    key,
    label: def.label,
    value,
    target: def.target,
    owner: thresholds[key]?.owner || def.owner,
    status: statusForValue(key, value, thresholds),
    helper: calculation.helper,
    detail: calculation.detail,
  };
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
    uptime: "Check repeated DOWN ping and HMI network path",
    accuracy: "Review error breakdown and SAP FAILED rows",
    adoption: "Check missing operator input vs machine event time",
    oee: "Review Productive, M2, Downtime, and Idle mix",
    ole: "Review productive labor rows vs total recorded time",
  };
  return actions[key] || "Review KPI detail";
}

function overall(kpis) {
  const withValues = kpis.filter((kpi) => kpi.value !== null && kpi.value !== undefined);
  if (!withValues.length) return { overall_score: null, overall_status: "NO_DATA" };

  const score = withValues.reduce((sum, kpi) => {
    const target = num(kpi.target, 100);
    return sum + Math.min(num(kpi.value, 0) / target, 1);
  }, 0) / withValues.length;

  const statuses = withValues.map((kpi) => kpi.status);
  const overall_status = statuses.includes("critical")
    ? "CRITICAL"
    : statuses.includes("watch")
      ? "WATCH"
      : "NORMAL";

  return { overall_score: Math.round(score * 100) / 100, overall_status };
}

async function saveSnapshot({ windowStart, windowEnd, grain, payload }) {
  if (!(await tableExists("ews", "kpi_snapshot"))) return;

  const byKey = Object.fromEntries(payload.kpis.map((kpi) => [kpi.key, kpi]));
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
      byKey.uptime?.value,
      byKey.accuracy?.value,
      byKey.adoption?.value,
      byKey.oee?.value,
      byKey.ole?.value,
      payload.overall_score,
      payload.overall_status,
      JSON.stringify({
        kpis: payload.kpis,
        issues: payload.issues,
        correction_queue: payload.correction_queue,
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
  const uptime = await safeCalculation("uptime", async () => calculateUptime(bounds, options));
  const accuracy = await safeCalculation("accuracy", async () => calculateAccuracy(bounds));
  const adoption = await calculateAdoptionForMainSnapshot(bounds, options.grain);
  const oee = await safeCalculation("oee", async () => calculateOee(bounds));
  const ole = await safeCalculation("ole", async () => calculateOle(bounds));

  return [
    buildKpi("uptime", uptime, thresholds),
    buildKpi("accuracy", accuracy, thresholds),
    buildKpi("adoption", adoption, thresholds),
    buildKpi("oee", oee, thresholds),
    buildKpi("ole", ole, thresholds),
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

async function resolveSummaryBounds(options = {}) {
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

  await saveSnapshot({
    windowStart: resolved.current.window_start,
    windowEnd: resolved.current.window_end,
    grain: resolved.grain,
    payload,
  }).catch((err) => {
    console.error("EWS saveSnapshot error:", err.message);
  });

  return payload;
}

module.exports = {
  calculateSystemSummary,
  normalizeWindow,
};
