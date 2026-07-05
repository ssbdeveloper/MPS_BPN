const ewsCalculator = require("../services/ewsCalculator");
const ewsRealtimeHub = require("../services/ewsRealtimeHub");
const db = global.pool || require("../db");

const summaryCache = new Map();
const SUMMARY_TTL_MS = 60 * 1000;
const detailCache = new Map();
const DETAIL_TTL_MS = 60 * 1000;
const VALID_KPIS = new Set(["uptime", "accuracy", "adoption", "oee", "ole"]);

function getPool() {
  return db.pool || db;
}

function clampLimit(value, fallback = 5) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 50);
}

function normalizeActionStatus(value) {
  return String(value || "Open").toLowerCase() === "closed" ? "Closed" : "Open";
}

function normalizeSeverity(value) {
  const severity = String(value || "Watch").toLowerCase();
  if (severity === "critical") return "Critical";
  if (severity === "normal") return "Normal";
  return "Watch";
}

function clampText(value, fallback = "", maxLength = 1000) {
  const text = String(value ?? fallback).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sourceStatus(value, normalMin, criticalBelow) {
  if (value === null || value === undefined) return "no_data";
  const parsed = num(value, null);
  if (parsed === null) return "no_data";
  if (parsed < criticalBelow) return "critical";
  if (parsed < normalMin) return "watch";
  return "normal";
}

function normalizeIssuePayload(issue, kpiType) {
  const issueKey = clampText(issue.issue_key || issue.id, "", 240);
  if (!issueKey) return null;

  return {
    issue_key: issueKey,
    kpi_type: kpiType,
    scope_type: clampText(issue.scope_type, "system", 40),
    scope_key: clampText(issue.scope_key, "ALL", 120),
    machine_id: issue.machine_id ? clampText(issue.machine_id, "", 120) : null,
    issue_description: clampText(issue.issue_description || issue.issueDescription, "EWS issue", 1600),
    error_type: clampText(issue.error_type || issue.errorType, kpiType, 160),
    pic: clampText(issue.pic, "Supervisor", 160),
    action_taken: clampText(issue.action_taken || issue.action, "Review EWS issue", 1600),
    severity: normalizeSeverity(issue.severity),
    action_status: normalizeActionStatus(issue.status),
    action_date: issue.created_date || issue.createdDate || new Date().toISOString(),
    detail_json: issue.detail_json || issue.detailJson || {},
    updated_by: clampText(issue.updated_by, "ews-detail-page", 120),
  };
}

async function getSummary(req, res) {
  try {
    const isManualDate = req.query.basis === "date" && req.query.date;

    if (req.query.live !== "1" && !isManualDate) {
      const summary = await ewsRealtimeHub.getLatestSnapshotForQuery(req.query);
      res.set("X-Data-Source", "kpi-snapshot");
      res.json(summary);
      return;
    }

    const cacheKey = JSON.stringify({
      basis: req.query.basis || "rolling",
      window: req.query.window || "",
      date: req.query.date || "",
    });
    const cached = summaryCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < SUMMARY_TTL_MS) {
      res.set("X-Cache", "HIT");
      res.json(cached.payload);
      return;
    }

    const summary = await ewsCalculator.calculateSystemSummary({
      basis: req.query.basis || "rolling",
      window: req.query.window,
      date: req.query.date,
    });
    summaryCache.set(cacheKey, { createdAt: Date.now(), payload: summary });
    res.set("X-Cache", "MISS");
    res.json(summary);
  } catch (err) {
    if (err.code === "42P01") {
      res.status(503).json({ error: "EWS snapshot table is not available. Run the EWS migration first." });
      return;
    }
    console.error("ews summary error:", err);
    res.status(503).json({ error: err.message });
  }
}

async function getTrend(req, res) {
  try {
    const days = clampLimit(req.query.days, 7);
    const pool = getPool();
    const result = await pool.query(
      `
      WITH latest_daily AS (
        SELECT DISTINCT ON ((window_end AT TIME ZONE 'Asia/Jakarta')::date)
          id,
          (window_end AT TIME ZONE 'Asia/Jakarta')::date AS business_date,
          window_end,
          uptime_pct,
          accuracy_pct,
          adoption_pct,
          oee_pct,
          ole_pct
        FROM ews.kpi_snapshot
        WHERE scope_type = 'system'
          AND scope_key = 'ALL'
          AND window_end >= (now() - ($1::int * interval '1 day'))
        ORDER BY (window_end AT TIME ZONE 'Asia/Jakarta')::date DESC, window_end DESC, id DESC
      )
      , limited AS (
        SELECT *
        FROM latest_daily
        ORDER BY business_date DESC
        LIMIT $1
      )
      SELECT *
      FROM limited
      ORDER BY business_date ASC
      `,
      [days],
    );

    const trend = {
      uptime: [],
      accuracy: [],
      adoption: [],
      oee: [],
      ole: [],
    };

    for (const row of result.rows) {
      const point = {
        snapshot_id: row.id,
        date: row.business_date,
        window_end: row.window_end,
      };
      trend.uptime.push({ ...point, value: row.uptime_pct === null ? null : num(row.uptime_pct, null) });
      trend.accuracy.push({ ...point, value: row.accuracy_pct === null ? null : num(row.accuracy_pct, null) });
      trend.adoption.push({ ...point, value: row.adoption_pct === null ? null : num(row.adoption_pct, null) });
      trend.oee.push({ ...point, value: row.oee_pct === null ? null : num(row.oee_pct, null) });
      trend.ole.push({ ...point, value: row.ole_pct === null ? null : num(row.ole_pct, null) });
    }

    res.json({
      data: trend,
      meta: {
        days,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (err.code === "42P01") {
      res.status(503).json({ error: "EWS snapshot table is not available. Run the EWS migration first." });
      return;
    }
    console.error("ews trend error:", err);
    res.status(500).json({ error: err.message });
  }
}

async function getIssues(req, res) {
  try {
    const limit = clampLimit(req.query.limit, 5);
    const isManualDate = req.query.basis === "date" && req.query.date;
    const summary = req.query.live === "1" || isManualDate
      ? await ewsCalculator.calculateSystemSummary({
        basis: req.query.basis || "rolling",
        window: req.query.window,
        date: req.query.date,
      })
      : await ewsRealtimeHub.getLatestSnapshotForQuery(req.query);
    res.json({
      data: summary.issues.slice(0, limit),
      meta: {
        window_start: summary.window_start,
        window_end: summary.window_end,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("ews issues error:", err);
    res.status(500).json({ error: err.message });
  }
}

async function getActions(req, res) {
  try {
    const status = req.query.status || "Open";
    const kpiType = String(req.query.kpi_type || "").toLowerCase();
    const result = await db.query(
      `
      SELECT
        action_id,
        alert_id,
        kpi_type,
        scope_type,
        scope_key,
        machine_id,
        issue_key,
        issue_description,
        error_type,
        severity,
        status_reason,
        action_taken,
        pic,
        action_status,
        CASE
          WHEN action_status = 'Closed' THEN 'Closed'
          WHEN severity = 'Critical' AND action_date < now() - interval '3 hours' THEN 'Plant Manager'
          WHEN severity = 'Critical' AND action_date < now() - interval '1 hour' THEN 'Supervisor/Foreman'
          ELSE COALESCE(escalation_level, 'PIC Monitor')
        END AS escalation_level,
        due_at,
        action_date,
        solved_date,
        last_updated,
        updated_by,
        detail_json
      FROM ews.action_table
      WHERE ($1 = 'all' OR action_status = $1)
        AND ($2 = '' OR kpi_type = $2)
      ORDER BY due_at ASC NULLS LAST, last_updated DESC
      LIMIT 100
      `,
      [status, kpiType],
    );
    res.json({ data: result.rows, meta: { generated_at: new Date().toISOString() } });
  } catch (err) {
    if (err.code === "42P01") {
      res.json({ data: [], meta: { generated_at: new Date().toISOString(), warning: "ews.action_table not created" } });
      return;
    }
    console.error("ews actions error:", err);
    res.status(500).json({ error: err.message });
  }
}

async function buildUptimeSourceDetail(windowStart, windowEnd) {
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        id,
        checked_at,
        machineid,
        machinename,
        ipaddress,
        COALESCE(ping_count, 0) AS ping_count,
        COALESCE(success_count, 0) AS success_count,
        COALESCE(failed_count, 0) AS failed_count,
        avg_latency_ms::float AS avg_latency_ms,
        packet_loss_percent::float AS packet_loss_percent,
        status,
        (COALESCE(failed_count, 0) > 0 OR UPPER(COALESCE(status, '')) = 'DOWN') AS is_failure
      FROM public.mch_machine_ping_log
      WHERE checked_at >= $1::timestamptz
        AND checked_at < $2::timestamptz
    ),
    streaks AS (
      SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY machineid ORDER BY checked_at)
          - ROW_NUMBER() OVER (PARTITION BY machineid, is_failure ORDER BY checked_at) AS streak_group
      FROM base
    ),
    failure_streaks AS (
      SELECT machineid, COUNT(*)::int AS failure_count
      FROM streaks
      WHERE is_failure
      GROUP BY machineid, streak_group
    ),
    per_machine AS (
      SELECT
        b.machineid,
        MAX(b.machinename) AS machinename,
        MAX(b.ipaddress) AS ipaddress,
        COUNT(*)::int AS sample_count,
        SUM(b.ping_count)::int AS ping_count,
        SUM(b.success_count)::int AS success_count,
        SUM(b.failed_count)::int AS failed_count,
        COUNT(*) FILTER (WHERE b.is_failure)::int AS failed_samples,
        ROUND(((SUM(b.success_count)::numeric / NULLIF(SUM(b.ping_count), 0)) * 100)::numeric, 2)::float AS uptime_pct,
        ROUND(((SUM(b.failed_count)::numeric * 10.0) / 60.0)::numeric, 2)::float AS downtime_minutes,
        ROUND(AVG(b.avg_latency_ms)::numeric, 2)::float AS avg_latency_ms,
        ROUND(MAX(b.packet_loss_percent)::numeric, 2)::float AS max_packet_loss_percent,
        COALESCE(MAX(fs.failure_count), 0)::int AS max_consecutive_fail
      FROM base b
      LEFT JOIN failure_streaks fs ON fs.machineid = b.machineid
      GROUP BY b.machineid
    )
    SELECT
      COALESCE(jsonb_agg(to_jsonb(per_machine) ORDER BY uptime_pct ASC NULLS LAST, failed_count DESC), '[]'::jsonb) AS by_machine,
      (
        SELECT COALESCE(jsonb_agg(to_jsonb(bad_rows) ORDER BY checked_at DESC), '[]'::jsonb)
        FROM (
          SELECT
            'public.mch_machine_ping_log' AS source_table,
            id::text AS source_id,
            checked_at,
            machineid,
            machinename,
            ipaddress,
            status,
            ping_count,
            success_count,
            failed_count,
            packet_loss_percent,
            avg_latency_ms,
            CASE
              WHEN is_failure THEN 'Ping/heartbeat failure'
              ELSE 'Monitor'
            END AS issue_description
          FROM base
          WHERE is_failure
          ORDER BY checked_at DESC
          LIMIT 50
        ) bad_rows
      ) AS sample_rows,
      (
        SELECT COALESCE(jsonb_agg(row_to_json(h) ORDER BY h.hour_ts), '[]'::jsonb)
        FROM (
          SELECT
            to_char(date_trunc('hour', checked_at AT TIME ZONE $3), 'HH24:00') AS hour_label,
            MIN(checked_at) AS hour_ts,
            SUM(ping_count)::int AS ping_count,
            SUM(success_count)::int AS success_count,
            SUM(failed_count)::int AS failed_count,
            ROUND(((SUM(success_count)::numeric / NULLIF(SUM(ping_count), 0)) * 100)::numeric, 2)::float AS uptime_pct
          FROM base
          GROUP BY 1
        ) h
      ) AS hourly
    FROM per_machine
    `,
    [windowStart, windowEnd, process.env.TIMEZONE || "Asia/Makassar"],
  );

  const row = result.rows[0] || {};
  return {
    source_tables: ["public.mch_machine_ping_log"],
    false_alert_rule: "Real problem when max_consecutive_fail >= 6 samples",
    by_machine: row.by_machine || [],
    hourly: row.hourly || [],
    sample_rows: row.sample_rows || [],
  };
}

async function buildAccuracySourceDetail(windowStart, windowEnd) {
  const result = await db.query(
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
        ) AS duration_delta_hours,
        COUNT(*) OVER (
          PARTITION BY t.serialnumber, t.order_no, t.operation_no, t.longdate_checkin
        ) AS duplicate_count
      FROM public.timesheet_transaction t
      WHERE t.longdate_checkin >= $1::timestamptz
        AND t.longdate_checkin < $2::timestamptz
        AND COALESCE(t.state_flag, 1) <> 5
    ),
    flags AS (
      SELECT
        *,
        (activitytype IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NULL) AS missing_order,
        (activitytype IS NULL AND operation_no IS NULL) AS missing_operation,
        (longdate_checkin IS NULL) AS missing_checkin,
        (activitytype IS NULL AND planhours IS NULL) AS missing_planhours,
        (duration IS NULL OR duration < 0) AS invalid_duration,
        (activitytype IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL AND operation_no IS NOT NULL AND NOT has_sow_match) AS sow_no_match,
        (longdate_checkout IS NOT NULL AND duration_delta_hours > 0.10) AS duration_mismatch,
        (COALESCE(duration, 0) > 10 OR (longdate_checkout IS NULL AND longdate_checkin < now() - interval '90 minutes')) AS outlier_duration,
        (duplicate_count > 1) AS duplicate_record
      FROM base
    ),
    ts_errors AS (
      SELECT
        'public.timesheet_transaction' AS source_table,
        tsnumber::text AS source_id,
        longdate_checkin AS event_time,
        NULLIF(BTRIM(workcentercode), '') AS machine_id,
        NULLIF(BTRIM(serialnumber), '') AS operator_id,
        full_name AS operator_name,
        order_no,
        operation_no::text AS operation_no,
        err.error_type,
        err.error_code,
        err.issue_description,
        jsonb_build_object(
          'duration', duration,
          'planhours', planhours,
          'confirmationnumber', confirmationnumber,
          'state_flag', state_flag
        ) AS raw_context
      FROM flags
      CROSS JOIN LATERAL (
        VALUES
          ('Missing', 'missing_order', 'Order number is empty'),
          ('Missing', 'missing_operation', 'Operation number is empty'),
          ('Missing', 'missing_checkin', 'Check-in timestamp is empty'),
          ('Missing', 'missing_planhours', 'Plan hours is empty'),
          ('Invalid', 'invalid_duration', 'Duration is null or negative'),
          ('Invalid', 'sow_no_match', 'Order and operation do not match SOW'),
          ('Inconsistent', 'duration_mismatch', 'Duration does not match check-in/check-out time'),
          ('Outlier', 'outlier_duration', 'Runtime is abnormal or checkout is stale'),
          ('Duplicate', 'duplicate_record', 'Potential duplicate timesheet row')
      ) AS err(error_type, error_code, issue_description)
      WHERE CASE err.error_code
        WHEN 'missing_order' THEN missing_order
        WHEN 'missing_operation' THEN missing_operation
        WHEN 'missing_checkin' THEN missing_checkin
        WHEN 'missing_planhours' THEN missing_planhours
        WHEN 'invalid_duration' THEN invalid_duration
        WHEN 'sow_no_match' THEN sow_no_match
        WHEN 'duration_mismatch' THEN duration_mismatch
        WHEN 'outlier_duration' THEN outlier_duration
        WHEN 'duplicate_record' THEN duplicate_record
        ELSE false
      END
    ),
    sap_errors AS (
      SELECT
        'public.sap_timesheet_staging' AS source_table,
        id::text AS source_id,
        created_at AS event_time,
        NULLIF(BTRIM(arbpl), '') AS machine_id,
        NULLIF(BTRIM(pernr), '') AS operator_id,
        NULL::text AS operator_name,
        aufnr AS order_no,
        vornr AS operation_no,
        CASE WHEN UPPER(status) = 'PENDING' THEN 'Missing' ELSE 'Invalid' END AS error_type,
        LOWER(status) AS error_code,
        COALESCE(sap_error, sap_response_text, 'SAP staging row needs attention') AS issue_description,
        jsonb_build_object(
          'status', status,
          'ztimesheetid', ztimesheetid,
          'source_key', source_key,
          'sap_response', sap_response
        ) AS raw_context
      FROM public.sap_timesheet_staging
      WHERE created_at >= $1::timestamptz
        AND created_at < $2::timestamptz
        AND UPPER(COALESCE(status, '')) IN ('FAILED', 'PENDING')
    ),
    errors AS (
      SELECT * FROM ts_errors
      UNION ALL
      SELECT * FROM sap_errors
    )
    SELECT
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY error_records DESC), '[]'::jsonb)
       FROM (
         SELECT error_type, COUNT(*)::int AS error_records
         FROM errors
         GROUP BY error_type
       ) x) AS by_error_type,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY error_records DESC), '[]'::jsonb)
       FROM (
         SELECT COALESCE(machine_id, 'UNKNOWN') AS machine_id, COUNT(*)::int AS error_records
         FROM errors
         GROUP BY COALESCE(machine_id, 'UNKNOWN')
         LIMIT 20
       ) x) AS by_machine,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY error_records DESC), '[]'::jsonb)
       FROM (
         SELECT COALESCE(operator_id, 'UNKNOWN') AS operator_id, MAX(operator_name) AS operator_name, COUNT(*)::int AS error_records
         FROM errors
         GROUP BY COALESCE(operator_id, 'UNKNOWN')
         LIMIT 20
       ) x) AS by_operator,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY event_time DESC), '[]'::jsonb)
       FROM (
         SELECT *
         FROM errors
         ORDER BY event_time DESC
         LIMIT 80
       ) x) AS sample_rows
    `,
    [windowStart, windowEnd],
  );

  const row = result.rows[0] || {};
  return {
    source_tables: ["public.timesheet_transaction", "public.sap_timesheet_staging", "public.sow"],
    classification: ["Missing", "Invalid", "Inconsistent", "Outlier", "Duplicate"],
    by_error_type: row.by_error_type || [],
    by_machine: row.by_machine || [],
    by_operator: row.by_operator || [],
    sample_rows: row.sample_rows || [],
  };
}

async function buildAdoptionSourceDetail(windowStart, windowEnd) {
  const result = await db.query(
    `
    WITH gaps AS (
      SELECT
        bucket_start,
        bucket_end,
        machine_key,
        operator_key,
        operator_name,
        has_unidentified,
        has_timesheet_match,
        machine_event_count,
        COALESCE(gap_type, CASE
          WHEN has_unidentified THEN 'unidentified'
          WHEN NOT has_timesheet_match THEN 'missing_timesheet'
          ELSE 'covered'
        END) AS gap_type
      FROM ews.adoption_bucket_snapshot
      WHERE bucket_start >= $1::timestamptz
        AND bucket_start < $2::timestamptz
    ),
    problem_gaps AS (
      SELECT *
      FROM gaps
      WHERE has_unidentified OR NOT has_timesheet_match OR gap_type <> 'covered'
    )
    SELECT
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY missing_minutes DESC), '[]'::jsonb)
       FROM (
         SELECT machine_key, COUNT(*)::int AS gap_buckets, COUNT(*)::int * 5 AS missing_minutes
         FROM problem_gaps
         GROUP BY machine_key
         ORDER BY missing_minutes DESC
         LIMIT 20
       ) x) AS by_machine,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY missing_minutes DESC), '[]'::jsonb)
       FROM (
         SELECT COALESCE(operator_key, 'UNKNOWN') AS operator_key, MAX(operator_name) AS operator_name, COUNT(*)::int AS gap_buckets, COUNT(*)::int * 5 AS missing_minutes
         FROM problem_gaps
         GROUP BY COALESCE(operator_key, 'UNKNOWN')
         ORDER BY missing_minutes DESC
         LIMIT 20
       ) x) AS by_operator,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY gap_buckets DESC), '[]'::jsonb)
       FROM (
         SELECT gap_type, COUNT(*)::int AS gap_buckets, COUNT(*)::int * 5 AS missing_minutes
         FROM problem_gaps
         GROUP BY gap_type
       ) x) AS by_gap_type,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY bucket_start DESC), '[]'::jsonb)
       FROM (
         SELECT
           'ews.adoption_bucket_snapshot' AS source_table,
           CONCAT(machine_key, ':', bucket_start) AS source_id,
           bucket_start,
           bucket_end,
           machine_key,
           operator_key,
           operator_name,
           gap_type,
           machine_event_count,
           has_timesheet_match,
           has_unidentified,
           CASE
             WHEN has_unidentified THEN 'Machine event has unidentified operator'
             WHEN NOT has_timesheet_match THEN 'Machine activity has no matching timesheet bucket'
             ELSE 'Adoption gap'
           END AS issue_description
         FROM problem_gaps
         ORDER BY bucket_start DESC
         LIMIT 80
       ) x) AS sample_rows
    `,
    [windowStart, windowEnd],
  );

  const row = result.rows[0] || {};
  return {
    source_tables: ["ews.adoption_bucket_snapshot", "public.mch_transaction", "public.timesheet_transaction"],
    bucket_minutes: 5,
    by_machine: row.by_machine || [],
    by_operator: row.by_operator || [],
    by_gap_type: row.by_gap_type || [],
    sample_rows: row.sample_rows || [],
  };
}

async function buildOeeSourceDetail(windowStart, windowEnd) {
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        proddataid,
        startdatetime,
        enddatetime,
        machineid,
        machinename,
        statusid,
        status_description,
        status_activitytype,
        duration_hours::float AS duration_hours,
        order_no,
        operation_no,
        sn_employee,
        full_name,
        LOWER(BTRIM(COALESCE(status_description, ''))) AS normalized_status,
        CASE
          WHEN statusid = 4 OR LOWER(BTRIM(COALESCE(status_description, ''))) IN ('no job', 'off') THEN 'NoJob'
          WHEN statusid = 5 THEN 'Missing'
          WHEN COALESCE(status_activitytype, '') = 'M2'
            THEN 'NNVA'
          WHEN COALESCE(status_activitytype, '') = 'M1'
            OR LOWER(BTRIM(COALESCE(status_description, ''))) = 'productive'
            THEN 'VA'
          ELSE 'NVA'
        END AS activity_bucket,
        CASE
          WHEN LOWER(BTRIM(COALESCE(status_description, ''))) NOT IN (
            'no job',
            'off',
            'preventive',
            'breakdown',
            'coffee break / lunch',
            'daily pm'
          )
          THEN TRUE
          ELSE FALSE
        END AS denominator_eligible
      FROM public.mch_transaction
      WHERE startdatetime >= $1::timestamp
        AND startdatetime < $2::timestamp
        AND COALESCE(duration_hours, 0) > 0
    ),
    totals AS (
      SELECT
        COALESCE(SUM(duration_hours), 0)::float AS total_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'VA'), 0)::float AS va_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'NNVA'), 0)::float AS nnva_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'NVA'), 0)::float AS nva_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'Missing'), 0)::float AS missing_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'NoJob'), 0)::float AS nojob_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE denominator_eligible), 0)::float AS denominator_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket IN ('VA', 'NNVA')), 0)::float AS running_hours
      FROM base
    ),
    waterfall AS (
      SELECT *
      FROM totals t
      CROSS JOIN LATERAL (
        VALUES
          (1, 'Total Time', 'total', 0::float, t.total_hours, t.total_hours),
          (2, 'Missing', 'loss', t.total_hours, t.total_hours - t.missing_hours, -t.missing_hours),
          (3, 'NNVA', 'segment', t.total_hours - t.missing_hours, t.total_hours - t.missing_hours - t.nnva_hours, -t.nnva_hours),
          (4, 'NoJob', 'loss', t.total_hours - t.missing_hours - t.nnva_hours, t.total_hours - t.missing_hours - t.nnva_hours - t.nojob_hours, -t.nojob_hours),
          (5, 'NVA', 'loss', t.total_hours - t.missing_hours - t.nnva_hours - t.nojob_hours, t.total_hours - t.missing_hours - t.nnva_hours - t.nojob_hours - t.nva_hours, -t.nva_hours),
          (6, 'VA', 'final', 0::float, t.va_hours, t.va_hours)
      ) AS w(sort_order, label, step_type, start_hours, end_hours, delta_hours)
    ),
    per_machine AS (
      SELECT
        machineid,
        MAX(machinename) AS machinename,
        SUM(duration_hours) AS total_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'VA'), 0)::float AS va_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'NNVA'), 0)::float AS nnva_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket IN ('NVA', 'Missing')), 0)::float AS nva_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'NoJob'), 0)::float AS nojob_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE denominator_eligible), 0)::float AS denominator_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket IN ('VA', 'NNVA')), 0)::float AS running_hours,
        ROUND(((COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket IN ('VA', 'NNVA')), 0)::numeric / NULLIF(COALESCE(SUM(duration_hours) FILTER (WHERE denominator_eligible), 0), 0)) * 100)::numeric, 2)::float AS oee_time_pct,
        COUNT(*) FILTER (WHERE activity_bucket <> 'VA')::int AS stop_count
      FROM base
      GROUP BY machineid
    )
    SELECT
      (SELECT row_to_json(t) FROM totals t) AS totals,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY sort_order), '[]'::jsonb)
       FROM (
         SELECT
           sort_order,
           label,
           step_type,
           start_hours,
           delta_hours,
           end_hours,
           ABS(delta_hours)::float AS hours
         FROM waterfall
       ) x) AS waterfall,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY oee_time_pct ASC NULLS LAST, loss_hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           *,
           GREATEST(0, total_hours - running_hours)::float AS loss_hours,
           CASE
           WHEN oee_time_pct < 65 THEN 'critical'
           WHEN oee_time_pct < 80 THEN 'watch'
           ELSE 'normal'
           END AS status
         FROM per_machine
         LIMIT 20
       ) x) AS by_machine,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY total_hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           machineid,
           machinename,
           total_hours,
           va_hours,
           nnva_hours,
           nva_hours,
           nojob_hours
         FROM per_machine
         WHERE total_hours > 0
         LIMIT 20
       ) x) AS distribution_by_machine,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           activity_bucket AS loss_type,
           SUM(duration_hours)::float AS hours,
           COUNT(*)::int AS event_count
         FROM base
         WHERE activity_bucket <> 'VA'
         GROUP BY activity_bucket
       ) x) AS by_loss_type,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY startdatetime DESC), '[]'::jsonb)
       FROM (
         SELECT
           'public.mch_transaction' AS source_table,
           proddataid::text AS source_id,
           startdatetime,
           enddatetime,
           machineid,
           machinename,
           statusid,
           status_description,
           status_activitytype,
           activity_bucket AS loss_type,
           duration_hours,
           order_no,
           operation_no,
           sn_employee,
           full_name,
           CASE
             WHEN activity_bucket = 'Missing' THEN 'Missing machine/operator mapping'
             WHEN activity_bucket = 'NoJob' THEN 'NoJob time'
             WHEN activity_bucket = 'NNVA' THEN 'NNVA setup time'
             WHEN duration_hours >= 5 THEN 'Major loss >5h'
             WHEN duration_hours < 1 THEN 'Micro loss <1h'
             ELSE 'Medium loss'
           END AS loss_size,
           CASE
             WHEN activity_bucket = 'Missing' THEN 'StatusID 5 is classified as Missing in OEE detail'
             WHEN activity_bucket = 'NoJob' THEN 'StatusID 4 is classified as NoJob and excluded from OEE denominator'
             WHEN activity_bucket = 'NNVA' THEN 'M2 setup is counted in EWS OEE running hours but shown as NNVA detail'
             ELSE 'Machine time is not VA/NNVA running time'
           END AS issue_description
         FROM base
         WHERE activity_bucket <> 'VA'
         ORDER BY startdatetime DESC
         LIMIT 80
       ) x) AS sample_rows
    `,
    [windowStart, windowEnd],
  );

  const row = result.rows[0] || {};
  return {
    source_tables: ["public.mch_transaction"],
    totals: row.totals || {},
    waterfall: row.waterfall || [],
    by_machine: row.by_machine || [],
    distribution_by_machine: row.distribution_by_machine || [],
    by_loss_type: row.by_loss_type || [],
    sample_rows: row.sample_rows || [],
  };
}

async function buildOleSourceDetail(windowStart, windowEnd) {
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        tsnumber,
        longdate_checkin,
        longdate_checkout,
        serialnumber,
        full_name,
        workcentercode,
        workcenterdescription,
        duration::float AS duration_hours,
        activitytype,
        order_no,
        operation_no,
        CASE
          WHEN activitytype IS NULL
            AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
            AND COALESCE(duration, 0) > 0
          THEN 'Processing'
          WHEN LOWER(COALESCE(activitytype, '')) LIKE '%wait%' THEN 'Waiting'
          WHEN NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NULL THEN 'Idle'
          ELSE COALESCE(NULLIF(activitytype, ''), 'NVA')
        END AS activity_bucket
      FROM public.timesheet_transaction
      WHERE longdate_checkin >= $1::timestamptz
        AND longdate_checkin < $2::timestamptz
        AND COALESCE(state_flag, 1) <> 5
        AND COALESCE(duration, 0) > 0
    ),
    per_operator AS (
      SELECT
        COALESCE(serialnumber, 'UNKNOWN') AS operator_id,
        MAX(full_name) AS operator_name,
        SUM(duration_hours) AS total_hours,
        SUM(duration_hours) FILTER (WHERE activity_bucket = 'Processing') AS working_hours,
        SUM(duration_hours) FILTER (WHERE activity_bucket <> 'Processing') AS nva_hours,
        ROUND(((SUM(duration_hours) FILTER (WHERE activity_bucket = 'Processing')::numeric / NULLIF(SUM(duration_hours), 0)) * 100)::numeric, 2)::float AS ole_time_pct
      FROM base
      GROUP BY COALESCE(serialnumber, 'UNKNOWN')
    )
    SELECT
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY ole_time_pct ASC NULLS LAST, nva_hours DESC), '[]'::jsonb)
       FROM (
         SELECT *, CASE
           WHEN ole_time_pct < 70 THEN 'critical'
           WHEN ole_time_pct < 85 THEN 'watch'
           ELSE 'normal'
         END AS status
         FROM per_operator
         LIMIT 20
       ) x) AS by_operator,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY nva_hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           COALESCE(workcentercode, 'UNKNOWN') AS machine_id,
           MAX(workcenterdescription) AS machine_name,
           COALESCE(SUM(duration_hours), 0)::float AS total_hours,
           COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'Processing'), 0)::float AS working_hours,
           COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket <> 'Processing'), 0)::float AS nva_hours
         FROM base
         GROUP BY COALESCE(workcentercode, 'UNKNOWN')
         HAVING COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket <> 'Processing'), 0) > 0
         ORDER BY nva_hours DESC
         LIMIT 20
       ) x) AS by_machine,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           b.activitytype AS activity_bucket,
           COALESCE(r.description, 'Aktivitas ' || b.activitytype) AS activity_label,
           SUM(b.duration_hours)::float AS hours,
           COUNT(*)::int AS record_count
         FROM (
           SELECT NULLIF(BTRIM(activitytype), '') AS activitytype, duration_hours
           FROM base
           WHERE NULLIF(BTRIM(activitytype), '') IS NOT NULL
         ) b
         LEFT JOIN ews.activity_type_ref r ON r.activitytype = b.activitytype
         GROUP BY b.activitytype, COALESCE(r.description, 'Aktivitas ' || b.activitytype)
       ) x) AS by_activity,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY longdate_checkin DESC), '[]'::jsonb)
       FROM (
         SELECT
           'public.timesheet_transaction' AS source_table,
           tsnumber::text AS source_id,
           longdate_checkin,
           longdate_checkout,
           serialnumber AS operator_id,
           full_name AS operator_name,
           workcentercode AS machine_id,
           workcenterdescription AS machine_name,
           activity_bucket,
           activitytype,
           duration_hours,
           order_no,
           operation_no,
           CASE
             WHEN activity_bucket = 'Idle' THEN 'Recorded labor has no production order'
             WHEN activity_bucket = 'Waiting' THEN 'Waiting/NVA labor time'
             ELSE 'Non productive labor time'
           END AS issue_description
         FROM base
         WHERE activity_bucket <> 'Processing'
         ORDER BY longdate_checkin DESC
         LIMIT 80
       ) x) AS sample_rows
    `,
    [windowStart, windowEnd],
  );

  const row = result.rows[0] || {};
  return {
    source_tables: ["public.timesheet_transaction"],
    by_operator: row.by_operator || [],
    by_machine: row.by_machine || [],
    by_activity: row.by_activity || [],
    sample_rows: row.sample_rows || [],
  };
}

async function buildKpiSourceDetail(type, summary) {
  const windowStart = summary.window_start;
  const windowEnd = summary.window_end;
  if (!windowStart || !windowEnd) return null;

  if (type === "uptime") return buildUptimeSourceDetail(windowStart, windowEnd);
  if (type === "accuracy") return buildAccuracySourceDetail(windowStart, windowEnd);
  if (type === "adoption") return buildAdoptionSourceDetail(windowStart, windowEnd);
  if (type === "oee") return buildOeeSourceDetail(windowStart, windowEnd);
  if (type === "ole") return buildOleSourceDetail(windowStart, windowEnd);
  return null;
}

async function syncActions(req, res) {
  const client = await getPool().connect();
  try {
    const kpiType = String(req.body?.kpi_type || "").toLowerCase();
    if (!VALID_KPIS.has(kpiType)) {
      res.status(400).json({ error: "Invalid EWS KPI type" });
      return;
    }

    const issues = Array.isArray(req.body?.issues)
      ? req.body.issues.map((issue) => normalizeIssuePayload(issue, kpiType)).filter(Boolean).slice(0, 50)
      : [];

    await client.query("BEGIN");
    const rows = [];

    for (const issue of issues) {
      const result = await client.query(
        `
        INSERT INTO ews.action_table (
          issue_key,
          kpi_type,
          scope_type,
          scope_key,
          machine_id,
          issue_description,
          status_reason,
          error_type,
          action_taken,
          pic,
          severity,
          action_status,
          action_date,
          last_updated,
          updated_by,
          detail_json
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12::timestamptz, now(), $13, $14::jsonb
        )
        ON CONFLICT (issue_key) WHERE issue_key IS NOT NULL
        DO UPDATE SET
          issue_description = EXCLUDED.issue_description,
          status_reason = EXCLUDED.status_reason,
          error_type = EXCLUDED.error_type,
          action_taken = EXCLUDED.action_taken,
          pic = EXCLUDED.pic,
          severity = EXCLUDED.severity,
          scope_type = EXCLUDED.scope_type,
          scope_key = EXCLUDED.scope_key,
          machine_id = EXCLUDED.machine_id,
          detail_json = EXCLUDED.detail_json,
          last_updated = CASE
            WHEN ews.action_table.action_status = 'Closed' THEN ews.action_table.last_updated
            ELSE now()
          END,
          updated_by = EXCLUDED.updated_by
        RETURNING *
        `,
        [
          issue.issue_key,
          issue.kpi_type,
          issue.scope_type,
          issue.scope_key,
          issue.machine_id,
          issue.issue_description,
          issue.error_type,
          issue.action_taken,
          issue.pic,
          issue.severity,
          issue.action_status,
          issue.action_date,
          issue.updated_by,
          JSON.stringify(issue.detail_json),
        ],
      );
      rows.push(result.rows[0]);
    }

    await client.query("COMMIT");
    res.json({ data: rows, meta: { generated_at: new Date().toISOString(), synced: rows.length } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("ews action sync error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function resolveAction(req, res) {
  const client = await getPool().connect();
  try {
    const actionId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(actionId)) {
      res.status(400).json({ error: "Invalid action id" });
      return;
    }

    const updatedBy = clampText(req.body?.updated_by, "ews-detail-page", 120);
    await client.query("BEGIN");

    const before = await client.query(
      "SELECT action_status FROM ews.action_table WHERE action_id = $1 FOR UPDATE",
      [actionId],
    );
    if (!before.rows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "EWS action not found" });
      return;
    }

    const oldStatus = before.rows[0].action_status;
    const result = await client.query(
      `
      UPDATE ews.action_table
      SET action_status = 'Closed',
          solved_date = COALESCE(solved_date, now()),
          escalation_level = 'Closed',
          last_updated = now(),
          updated_by = $2
      WHERE action_id = $1
      RETURNING *
      `,
      [actionId, updatedBy],
    );

    if (oldStatus !== "Closed") {
      await client.query(
        `
        INSERT INTO ews.action_history (action_id, old_status, new_status, changed_by, notes)
        VALUES ($1, $2, 'Closed', $3, 'Resolved from EWS detail page')
        `,
        [actionId, oldStatus, updatedBy],
      );
    }

    await client.query("COMMIT");
    res.json({ data: result.rows[0], meta: { generated_at: new Date().toISOString() } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("ews action resolve error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function getKpiDetail(req, res) {
  try {
    const type = String(req.params.type || "").toLowerCase();
    const summary = req.query.live === "1"
      ? await ewsCalculator.calculateSystemSummary({
        basis: req.query.basis || "rolling",
        window: req.query.window,
      })
      : await ewsRealtimeHub.getLatestSnapshotForQuery(req.query);
    const kpi = summary.kpis.find((item) => item.key === type);
    if (!kpi) return res.status(404).json({ error: "Unknown KPI type" });
    res.json({
      data: kpi,
      meta: {
        window_start: summary.window_start,
        window_end: summary.window_end,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("ews kpi detail error:", err);
    res.status(500).json({ error: err.message });
  }
}

function stream(req, res) {
  ewsRealtimeHub.subscribe(req, res);
}

async function getHealth(req, res) {
  try {
    const health = await ewsRealtimeHub.getHealth(req.query);
    res.status(health.snapshot_available ? 200 : 503).json(health);
  } catch (err) {
    console.error("ews health error:", err);
    res.status(500).json({ error: err.message });
  }
}

async function getKpiDetailWithSource(req, res) {
  try {
    const type = String(req.params.type || "").toLowerCase();

    // Short-lived cache: the KPI recompute + per-KPI aggregation is expensive.
    // Serving a value up to DETAIL_TTL_MS old keeps repeat loads / navigation instant
    // and prevents the heavy query from running on every page load.
    const cacheKey = JSON.stringify({
      type,
      basis: req.query.basis || "rolling",
      window: req.query.window || "",
      date: req.query.date || "",
      live: req.query.live || "",
    });
    const cached = detailCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < DETAIL_TTL_MS) {
      res.set("X-Cache", "HIT");
      res.json(cached.payload);
      return;
    }

    const isManualDate = req.query.basis === "date" && req.query.date;
    const summary = req.query.live === "1" || isManualDate
      ? await ewsCalculator.calculateSystemSummary({
        basis: req.query.basis || "rolling",
        window: req.query.window,
        date: req.query.date,
      })
      : await ewsRealtimeHub.getLatestSnapshotForQuery(req.query);

    const kpi = summary.kpis.find((item) => item.key === type);
    if (!kpi) return res.status(404).json({ error: "Unknown KPI type" });

    const sourceDetail = await buildKpiSourceDetail(type, summary);
    const payload = {
      data: {
        ...kpi,
        source_detail: sourceDetail,
      },
      meta: {
        window_start: summary.window_start,
        window_end: summary.window_end,
        generated_at: new Date().toISOString(),
      },
    };
    detailCache.set(cacheKey, { createdAt: Date.now(), payload });
    res.set("X-Cache", "MISS");
    res.json(payload);
  } catch (err) {
    console.error("ews kpi detail error:", err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getSummary,
  getTrend,
  getIssues,
  getActions,
  syncActions,
  resolveAction,
  getKpiDetail: getKpiDetailWithSource,
  stream,
  getHealth,
};
