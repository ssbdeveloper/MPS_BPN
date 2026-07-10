const pool = global.pool || require("../db");
const { resolveTimezone } = require("../config/timezone");

// Timezone comes from the root .env (TIMEZONE). Never hardcode it here: the daily buckets
// below compare against CURRENT_DATE, which follows the Postgres session timezone, so a
// mismatched literal silently shifts rows into the wrong calendar day.
const TZ = resolveTimezone();


const meta = () => ({ generated_at: new Date().toISOString() });
let operationsHubCache = null;
const OPERATIONS_HUB_TTL_MS = 30 * 1000;

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function refreshOrderMatviews() {
  try {
    await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_order_plan_vs_actual");
    await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_order_activity_detail");
  } catch (err) {
    console.error("refreshOrderMatviews error:", err.message);
  }
}

// GET /dashboard/order-progress — plan vs actual per order with weight-based progress
async function getOrderProgress(req, res) {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const status = req.query.status || 'all';
    const filter = req.query.filter || '';

    const where = [];
    if (status === 'ongoing') {
      where.push(`m.order_no NOT IN (
        SELECT LTRIM(order_no, '0') FROM ph3_order WHERE order_description ILIKE '%TECO%'
      )`);
    }
    if (filter === 'red') {
      where.push("m.total_actual_hours >= m.total_planhours");
    } else if (filter === 'yellow') {
      where.push("m.total_actual_hours >= m.total_planhours * 0.9 AND m.total_actual_hours < m.total_planhours");
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const baseQuery = `SELECT m.* FROM mv_order_plan_vs_actual m ${whereClause}`;
    const countQuery = `SELECT COUNT(*)::int AS total FROM mv_order_plan_vs_actual m ${whereClause}`;

    const [totalResult, rowsResult] = await Promise.all([
      pool.query(countQuery),
      pool.query(`${baseQuery} ORDER BY actual_pct DESC NULLS LAST, total_planhours DESC LIMIT $1 OFFSET $2`, [limit, offset]),
    ]);

    res.json({
      data: rowsResult.rows.map(r => ({
        ...r,
        total_planhours: num(r.total_planhours),
        total_actual_hours: num(r.total_actual_hours),
        weighted_progress: num(r.weighted_progress),
        actual_pct: num(r.actual_pct, 0),
      })),
      pagination: { page, limit, total: totalResult.rows[0]?.total || 0 },
      meta: meta(),
    });
  } catch (err) {
    console.error("order-progress error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/order-activity-detail — per-activity breakdown for an order
async function getOrderActivityDetail(req, res) {
  try {
    const { orderNo } = req.params;
    if (!orderNo) return res.status(400).json({ error: "orderNo required" });

    const result = await pool.query(
      `SELECT * FROM mv_order_activity_detail WHERE order_no = $1 ORDER BY operation_no`,
      [orderNo]
    );

    res.json({
      data: result.rows.map(r => ({
        ...r,
        planhours: num(r.planhours),
        actual_hours: num(r.actual_hours),
        weight: num(r.weight),
        progress: num(r.progress),
      })),
      meta: meta(),
    });
  } catch (err) {
    console.error("order-activity-detail error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/operation-timesheet-history — timesheet history per operation
async function getOperationTimesheetHistory(req, res) {
  try {
    const { orderNo, operationNo } = req.query;
    if (!orderNo || !operationNo) return res.status(400).json({ error: "orderNo and operationNo required" });

    const result = await pool.query(
      `SELECT
         serialnumber, full_name,
         DATE((longdate_checkin AT TIME ZONE '${TZ}'))::text AS work_date,
         ROUND(SUM(duration)::numeric, 2) AS total_hours,
         COUNT(*)::int AS entry_count
       FROM timesheet_transaction
       WHERE order_no = $1
         AND operation_no::integer = $2::integer
         AND state_flag != 5
         AND duration IS NOT NULL
       GROUP BY serialnumber, full_name, DATE((longdate_checkin AT TIME ZONE '${TZ}'))
       ORDER BY work_date ASC, serialnumber ASC`,
      [orderNo, operationNo]
    );

    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error("operation-timesheet-history error:", err);
    res.status(500).json({ error: err.message });
  }
}

async function getOperationsHub(req, res) {
  let client;
  try {
    if (operationsHubCache && Date.now() - operationsHubCache.createdAt < OPERATIONS_HUB_TTL_MS) {
      res.set("X-Cache", "HIT");
      res.json(operationsHubCache.payload);
      return;
    }

    client = await pool.connect();
    const q = (text, params) => client.query(text, params);
    const [
      overview,
      machineTrend,
      machineStatus,
      progressStatus,
      sapPosting,
      laborByWorkcenter,
      topOperators,
    ] = await Promise.all([
      q(`
        WITH latest_machine_day AS (
          SELECT MAX(startdatetime::date) AS day
          FROM public.mch_productiondata
        ),
        machine_day AS (
          SELECT
            p.statusid,
            GREATEST(EXTRACT(EPOCH FROM (COALESCE(p.enddatetime, p.startdatetime) - p.startdatetime)), 0) AS seconds
          FROM public.mch_productiondata p
          JOIN latest_machine_day d ON p.startdatetime::date = d.day
        ),
        latest_labor_day AS (
          SELECT MAX((longdate_checkin AT TIME ZONE '${TZ}')::date) AS day
          FROM public.timesheet_transaction
          WHERE state_flag != 5
        ),
        sow_kpi AS (
          SELECT
            COUNT(DISTINCT TRIM(order_no)) FILTER (
              WHERE COALESCE(systemstatus, '') NOT IN ('TECO', 'CLSD')
            )::int AS active_orders,
            COUNT(DISTINCT TRIM(order_no)) FILTER (
              WHERE plan_finish < CURRENT_DATE
                AND COALESCE(progress, 0) < 100
                AND COALESCE(systemstatus, '') NOT IN ('TECO', 'CLSD')
            )::int AS overdue_orders,
            ROUND(AVG(progress) FILTER (WHERE progress IS NOT NULL), 1) AS avg_progress
          FROM public.sow
        ),
        validation_kpi AS (
          SELECT
            COUNT(*) FILTER (
              WHERE validation_status IS NULL OR validation_status = ''
            )::int AS validation_pending,
            COUNT(*)::int AS validation_total
          FROM public.processcontroldata
        )
        SELECT
          COALESCE(s.active_orders, 0) AS active_orders,
          COALESCE(s.overdue_orders, 0) AS overdue_orders,
          COALESCE(s.avg_progress, 0)::float AS avg_progress,
          COALESCE(v.validation_pending, 0) AS validation_pending,
          COALESCE(v.validation_total, 0) AS validation_total,
          COALESCE((
            SELECT ROUND(SUM(duration), 2)::float
            FROM public.timesheet_transaction t
            JOIN latest_labor_day d ON (t.longdate_checkin AT TIME ZONE '${TZ}')::date = d.day
            WHERE t.state_flag != 5
          ), 0) AS latest_labor_hours,
          COALESCE((
            SELECT ROUND(SUM(seconds) / 3600.0, 2)::float
            FROM machine_day
          ), 0) AS latest_machine_hours,
          COALESCE((
            SELECT ROUND(SUM(CASE WHEN statusid = 1 THEN seconds ELSE 0 END) / NULLIF(SUM(seconds), 0) * 100.0, 1)::float
            FROM machine_day
          ), 0) AS machine_productive_pct,
          (SELECT to_char(day, 'YYYY-MM-DD') FROM latest_machine_day) AS machine_date,
          (SELECT to_char(day, 'YYYY-MM-DD') FROM latest_labor_day) AS labor_date
        FROM sow_kpi s
        CROSS JOIN validation_kpi v
      `),
      q(`
        WITH daily AS (
          SELECT
            startdatetime::date AS day,
            SUM(CASE WHEN statusid = 1 THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(enddatetime, startdatetime) - startdatetime)), 0) ELSE 0 END) / 3600.0 AS productive_hours,
            SUM(CASE WHEN statusid <> 1 THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(enddatetime, startdatetime) - startdatetime)), 0) ELSE 0 END) / 3600.0 AS support_loss_hours,
            SUM(GREATEST(EXTRACT(EPOCH FROM (COALESCE(enddatetime, startdatetime) - startdatetime)), 0)) / 3600.0 AS total_hours
          FROM public.mch_productiondata
          GROUP BY startdatetime::date
          ORDER BY startdatetime::date DESC
          LIMIT 7
        )
        SELECT
          to_char(day, 'DD Mon') AS label,
          to_char(day, 'YYYY-MM-DD') AS day,
          ROUND(productive_hours, 2)::float AS productive_hours,
          ROUND(support_loss_hours, 2)::float AS support_loss_hours,
          ROUND(total_hours, 2)::float AS total_hours,
          ROUND(productive_hours / NULLIF(total_hours, 0) * 100.0, 1)::float AS productive_pct
        FROM daily
        ORDER BY day
      `),
      q(`
        WITH latest_machine_day AS (
          SELECT MAX(startdatetime::date) AS day
          FROM public.mch_productiondata
        )
        SELECT
          COALESCE(st.description, 'Unknown') AS status,
          COUNT(*)::int AS event_count,
          ROUND(SUM(GREATEST(EXTRACT(EPOCH FROM (COALESCE(p.enddatetime, p.startdatetime) - p.startdatetime)), 0)) / 3600.0, 2)::float AS hours
        FROM public.mch_productiondata p
        JOIN latest_machine_day d ON p.startdatetime::date = d.day
        LEFT JOIN public.mch_statustypes st ON st.statusid = p.statusid
        GROUP BY COALESCE(st.description, 'Unknown')
        ORDER BY hours DESC, event_count DESC
        LIMIT 8
      `),
      q(`
        SELECT
          COALESCE(NULLIF(workcenter, ''), 'No Workcenter') AS label,
          ROUND(COALESCE(AVG(progress) FILTER (WHERE progress IS NOT NULL), 0), 1)::float AS value,
          COUNT(*)::int AS operation_count,
          ROUND(COALESCE(SUM(planhours), 0), 2)::float AS plan_hours
        FROM public.sow
        WHERE COALESCE(systemstatus, '') NOT IN ('TECO', 'CLSD')
        GROUP BY COALESCE(NULLIF(workcenter, ''), 'No Workcenter')
        ORDER BY operation_count DESC
        LIMIT 6
      `),
      q(`
        SELECT
          (SELECT COUNT(*) FROM public.sap_timesheet_staging WHERE UPPER(COALESCE(status,'')) = 'PENDING')::int AS pending,
          (SELECT COUNT(*) FROM public.sap_timesheet_staging WHERE UPPER(COALESCE(status,'')) = 'FAILED')::int AS failed,
          (SELECT COUNT(*) FROM public.sap_timesheet_staging WHERE UPPER(COALESCE(status,'')) = 'POSTED' AND created_at >= now() - interval '7 days')::int AS posted_7d,
          (SELECT COUNT(*) FROM public.sap_timesheet_staging WHERE created_at >= now() - interval '7 days')::int AS staged_7d
      `),
      q(`
        WITH base AS (
          SELECT
            COALESCE(NULLIF(BTRIM(workcentercode), ''), '-') AS wc,
            workcenterdescription AS wd,
            duration::float AS d,
            activitytype,
            order_no
          FROM public.timesheet_transaction
          WHERE longdate_checkin >= now() - interval '24 hours'
            AND COALESCE(state_flag, 1) <> 5
            AND COALESCE(duration, 0) > 0
        )
        SELECT
          wc AS workcenter,
          MAX(wd) AS workcenter_name,
          ROUND(SUM(d)::numeric, 1)::float AS total_hours,
          ROUND(COALESCE(SUM(d) FILTER (
            WHERE activitytype IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
          ), 0)::numeric, 1)::float AS productive_hours
        FROM base
        GROUP BY wc
        ORDER BY total_hours DESC
        LIMIT 8
      `),
      q(`
        WITH base AS (
          SELECT
            COALESCE(NULLIF(BTRIM(full_name), ''), NULLIF(BTRIM(serialnumber), ''), 'UNKNOWN') AS name,
            duration::float AS d,
            activitytype,
            order_no
          FROM public.timesheet_transaction
          WHERE longdate_checkin >= now() - interval '24 hours'
            AND COALESCE(state_flag, 1) <> 5
            AND COALESCE(duration, 0) > 0
        )
        SELECT
          name,
          ROUND(COALESCE(SUM(d) FILTER (
            WHERE activitytype IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
          ), 0)::numeric, 1)::float AS productive_hours,
          ROUND(SUM(d)::numeric, 1)::float AS total_hours
        FROM base
        GROUP BY name
        ORDER BY productive_hours DESC, total_hours DESC
        LIMIT 8
      `),
    ]);

    const overviewRow = overview.rows[0] || {};
    const payload = {
      data: {
        kpi: {
          active_orders: num(overviewRow.active_orders),
          overdue_orders: num(overviewRow.overdue_orders),
          latest_labor_hours: num(overviewRow.latest_labor_hours),
          latest_machine_hours: num(overviewRow.latest_machine_hours),
          avg_progress: num(overviewRow.avg_progress),
          validation_pending: num(overviewRow.validation_pending),
          validation_total: num(overviewRow.validation_total),
          machine_productive_pct: num(overviewRow.machine_productive_pct),
        },
        basis_dates: {
          machine_date: overviewRow.machine_date || null,
          labor_date: overviewRow.labor_date || null,
        },
        machine_trend: machineTrend.rows,
        machine_status: machineStatus.rows,
        progress_status: progressStatus.rows,
        sap_posting: sapPosting.rows[0] || {},
        labor_by_workcenter: laborByWorkcenter.rows,
        top_operators: topOperators.rows,
      },
      meta: meta(),
    };

    operationsHubCache = { createdAt: Date.now(), payload };
    res.set("X-Cache", "MISS");
    res.json(payload);
  } catch (err) {
    console.error("dashboard operations-hub error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
}

// GET /dashboard/sap-timesheet-staging-log
async function getSapTimesheetStagingLog(req, res) {
  try {
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit, 10) || 30));
    const cursor = Number.parseInt(req.query.cursor, 10);
    const status = String(req.query.status || "all").toUpperCase();
    const search = String(req.query.search || "").trim();

    const where = [];
    const params = [];

    if (Number.isFinite(cursor) && cursor > 0) {
      params.push(cursor);
      where.push(`id < $${params.length}`);
    }

    if (status !== "ALL") {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      where.push(`(
        source_key ILIKE $${idx}
        OR source_ref_id ILIKE $${idx}
        OR ztimesheetid ILIKE $${idx}
        OR pernr ILIKE $${idx}
        OR aufnr ILIKE $${idx}
        OR vornr ILIKE $${idx}
        OR arbpl ILIKE $${idx}
        OR sap_response_text ILIKE $${idx}
        OR sap_error ILIKE $${idx}
        OR payload::text ILIKE $${idx}
        OR sap_response::text ILIKE $${idx}
      )`);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    params.push(limit + 1);

    const result = await pool.query(
      `
      SELECT
        id,
        ztimesheetid,
        source_system,
        source_key,
        source_ref_id,
        werks,
        pernr,
        rueck,
        aufnr,
        vornr,
        arbpl,
        lstar,
        isdd,
        isdz,
        iedd,
        iedz,
        total_seconds,
        source_row_count,
        status,
        payload,
        sap_response,
        sap_response_text,
        sap_error,
        posted_at,
        created_at,
        updated_at
      FROM public.sap_timesheet_staging
      ${whereClause}
      ORDER BY id DESC
      LIMIT $${params.length}
      `,
      params
    );

    const rows = result.rows.slice(0, limit);
    const extraRow = result.rows[limit];

    res.json({
      data: rows,
      pagination: {
        limit,
        next_cursor: extraRow ? rows[rows.length - 1]?.id || null : null,
        has_more: Boolean(extraRow),
      },
      meta: meta(),
    });
  } catch (err) {
    console.error("sap-timesheet-staging-log error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/kpi
async function getKpi(req, res) {
  try {
    const [activeOrders, overdueOrders, todayHours, avgProgress] =
      await Promise.all([
        pool.query(`
          SELECT COUNT(DISTINCT order_no)::int AS count
          FROM sow
          WHERE systemstatus NOT IN ('TECO', 'CLSD')
        `),
        pool.query(`
          SELECT COUNT(DISTINCT order_no)::int AS count
          FROM sow
          WHERE plan_finish < CURRENT_DATE
            AND progress < 100
            AND systemstatus NOT IN ('TECO', 'CLSD')
        `),
        pool.query(`
          SELECT COALESCE(SUM(duration), 0)::numeric(10,2) AS total_hours
          FROM timesheet_transaction
          WHERE DATE(longdate_checkin AT TIME ZONE '${TZ}') = CURRENT_DATE
            AND state_flag != 5
        `),
        pool.query(`
          SELECT ROUND(AVG(avg_progress), 1) AS avg_progress
          FROM vw_sow_orders
          WHERE systemstatus NOT IN ('TECO', 'CLSD')
            AND avg_progress IS NOT NULL
        `),
      ]);

    res.json({
      data: {
        active_orders: activeOrders.rows[0].count,
        overdue_orders: overdueOrders.rows[0].count,
        today_hours: parseFloat(todayHours.rows[0].total_hours),
        avg_progress: parseFloat(avgProgress.rows[0].avg_progress) || 0,
      },
      meta: meta(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/order-status
async function getOrderStatus(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(status, 'Unknown') AS status,
        COUNT(DISTINCT order_no)::int AS count
      FROM sow
      GROUP BY status
      ORDER BY count DESC
    `);
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/workload
async function getWorkload(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        workcenter,
        ROUND(SUM(planhours), 2)::float    AS total_planhours,
        ROUND(SUM(actual_hours), 2)::float  AS total_actual_hours,
        COUNT(DISTINCT order_no)::int       AS order_count
      FROM sow
      WHERE systemstatus NOT IN ('TECO', 'CLSD')
        AND workcenter IS NOT NULL
      GROUP BY workcenter
      ORDER BY total_planhours DESC
      LIMIT 20
    `);
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/daily-hours?workcenter=all&days=30
async function getDailyHours(req, res) {
  try {
    const workcenter = req.query.workcenter || "all";
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));

    const result = await pool.query(
      `
      SELECT
        DATE(longdate_checkin AT TIME ZONE '${TZ}')::text AS day,
        ROUND(SUM(duration), 2)::float AS total_hours
      FROM timesheet_transaction
      WHERE longdate_checkin >= NOW() - ($2 || ' days')::interval
        AND state_flag != 5
        AND ($1 = 'all' OR workcentercode = $1)
      GROUP BY 1
      ORDER BY 1
    `,
      [workcenter, days]
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/operator-efficiency?from=&to=&workcenter=all
async function getOperatorEfficiency(req, res) {
  try {
    const workcenter = req.query.workcenter || "all";
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(now.getDate() - 30);

    const from = req.query.from
      ? new Date(req.query.from)
      : defaultFrom;
    const to = req.query.to ? new Date(req.query.to) : now;

    const result = await pool.query(
      `
      SELECT
        full_name,
        ROUND(SUM(duration), 2)::float   AS total_duration,
        ROUND(SUM(planhours), 2)::float  AS total_planhours,
        CASE
          WHEN SUM(planhours) > 0
          THEN ROUND(SUM(duration) / SUM(planhours) * 100, 1)::float
          ELSE NULL
        END AS efficiency_pct
      FROM timesheet_transaction
      WHERE longdate_checkin BETWEEN $1 AND $2
        AND state_flag != 5
        AND activitytype IS NULL
        AND ($3 = 'all' OR workcentercode = $3)
      GROUP BY full_name
      HAVING SUM(planhours) > 0
      ORDER BY efficiency_pct DESC NULLS LAST
      LIMIT 10
    `,
      [from.toISOString(), to.toISOString(), workcenter]
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/ontime-monthly
async function getOntimeMonthly(req, res) {
  try {
    const result = await pool.query(`
      WITH order_summary AS (
        SELECT DISTINCT ON (order_no)
          order_no,
          plan_finish,
          actual_finish,
          progress
        FROM sow
        WHERE plan_finish IS NOT NULL
        ORDER BY order_no, operation_no
      )
      SELECT
        TO_CHAR(DATE_TRUNC('month', plan_finish), 'YYYY-MM') AS month,
        COUNT(CASE WHEN actual_finish <= plan_finish OR progress = 100 THEN 1 END)::int AS on_time,
        COUNT(CASE WHEN plan_finish < CURRENT_DATE AND progress < 100 AND
                       (actual_finish IS NULL OR actual_finish > plan_finish) THEN 1 END)::int AS overdue,
        COUNT(CASE WHEN plan_finish >= CURRENT_DATE AND progress < 100 THEN 1 END)::int AS in_progress
      FROM order_summary
      GROUP BY DATE_TRUNC('month', plan_finish)
      ORDER BY DATE_TRUNC('month', plan_finish)
    `);
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/progress-distribution
async function getProgressDistribution(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        CASE
          WHEN progress = 0             THEN '0'
          WHEN progress BETWEEN 1  AND 20  THEN '1-20'
          WHEN progress BETWEEN 21 AND 40  THEN '21-40'
          WHEN progress BETWEEN 41 AND 60  THEN '41-60'
          WHEN progress BETWEEN 61 AND 80  THEN '61-80'
          WHEN progress BETWEEN 81 AND 99  THEN '81-99'
          WHEN progress = 100           THEN '100'
          ELSE 'N/A'
        END AS bucket,
        COUNT(*)::int AS count,
        MIN(COALESCE(progress, -1)) AS sort_order
      FROM sow
      GROUP BY bucket
      ORDER BY sort_order NULLS LAST
    `);
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/validation-rate?workcenter=all
async function getValidationRate(req, res) {
  try {
    const workcenter = req.query.workcenter || "all";

    const result = await pool.query(
      `
      SELECT
        workcenter,
        COUNT(*)::int AS total,
        COUNT(CASE WHEN validation_status IS NOT NULL AND validation_status != '' THEN 1 END)::int AS validated,
        ROUND(
          COUNT(CASE WHEN validation_status IS NOT NULL AND validation_status != '' THEN 1 END)::numeric
          / NULLIF(COUNT(*), 0) * 100, 1
        )::float AS pass_rate
      FROM processcontroldata
      WHERE workcenter IS NOT NULL
        AND ($1 = 'all' OR workcenter = $1)
      GROUP BY workcenter
      ORDER BY pass_rate DESC NULLS LAST
    `,
      [workcenter]
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/operator-heatmap?days=30
async function getOperatorHeatmap(req, res) {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));

    const result = await pool.query(
      `
      SELECT
        full_name,
        EXTRACT(hour FROM longdate_checkin AT TIME ZONE '${TZ}')::int AS hour,
        COUNT(*)::int AS activity_count
      FROM timesheet_transaction
      WHERE longdate_checkin >= NOW() - ($1 || ' days')::interval
        AND state_flag != 5
      GROUP BY full_name, hour
      ORDER BY full_name, hour
    `,
      [days]
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/workcenter-list
async function getWorkcenterList(req, res) {
  try {
    const result = await pool.query(`
      SELECT DISTINCT workcenterot AS workcenter, workcenter_description
      FROM workcenter
      WHERE workcenterot IS NOT NULL
      ORDER BY workcenterot
    `);
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getKpi,
  getOrderStatus,
  getWorkload,
  getDailyHours,
  getOperatorEfficiency,
  getOntimeMonthly,
  getProgressDistribution,
  getValidationRate,
  getOperatorHeatmap,
  getWorkcenterList,
  getOperationsHub,
  getSapTimesheetStagingLog,
  getOrderProgress,
  getOrderActivityDetail,
  getOperationTimesheetHistory,
  refreshOrderMatviews,
};
