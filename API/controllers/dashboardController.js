const pool = global.pool || require("../db");

const meta = () => ({ generated_at: new Date().toISOString() });

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getOperationsHub(req, res) {
  try {
    const [
      overview,
      machineTrend,
      machineStatus,
      validationQueue,
      progressStatus,
      orderSummaries,
      recentActivities,
      topMachines,
    ] = await Promise.all([
      pool.query(`
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
          SELECT MAX((longdate_checkin AT TIME ZONE 'Asia/Makassar')::date) AS day
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
            JOIN latest_labor_day d ON (t.longdate_checkin AT TIME ZONE 'Asia/Makassar')::date = d.day
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
      pool.query(`
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
      pool.query(`
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
      pool.query(`
        SELECT
          COALESCE(NULLIF(full_name, ''), 'Unknown') AS operator,
          COALESCE(NULLIF(workcenter, ''), NULLIF(machineid, ''), '-') AS workcenter,
          COUNT(*)::int AS item_count,
          MAX(createddate) AS latest_at,
          CASE
            WHEN COUNT(*) FILTER (WHERE validation_status IS NULL OR validation_status = '') > 0 THEN 'Pending'
            ELSE 'Ready'
          END AS status
        FROM public.processcontroldata
        WHERE validation_status IS NULL OR validation_status = ''
        GROUP BY 1, 2
        ORDER BY MAX(createddate) DESC NULLS LAST, COUNT(*) DESC
        LIMIT 6
      `),
      pool.query(`
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
      pool.query(`
        WITH orders AS (
          SELECT
            TRIM(order_no) AS order_no,
            (ARRAY_AGG(NULLIF(part_name, '') ORDER BY operation_no))[1] AS part_name,
            (ARRAY_AGG(NULLIF(customer, '') ORDER BY operation_no))[1] AS customer,
            (ARRAY_AGG(NULLIF(workcenter, '') ORDER BY operation_no))[1] AS owner,
            ROUND(COALESCE(AVG(progress) FILTER (WHERE progress IS NOT NULL), 0), 1)::float AS progress,
            MIN(plan_finish) AS eta,
            COUNT(*)::int AS operation_count,
            ROUND(COALESCE(SUM(planhours), 0), 2)::float AS plan_hours
          FROM public.sow
          WHERE COALESCE(systemstatus, '') NOT IN ('TECO', 'CLSD')
          GROUP BY TRIM(order_no)
        )
        SELECT *
        FROM orders
        ORDER BY eta ASC NULLS LAST, operation_count DESC
        LIMIT 8
      `),
      pool.query(`
        SELECT *
        FROM (
          SELECT
            'Process validation recorded' AS title,
            COALESCE(production_order, operation_text, workcenter, '-') AS meta,
            createddate AS event_ts,
            'validation' AS type
          FROM public.processcontroldata
          WHERE createddate IS NOT NULL
          UNION ALL
          SELECT
            'Timesheet activity logged' AS title,
            CONCAT_WS(' - ', full_name, order_no, workcentercode) AS meta,
            longdate_checkin AS event_ts,
            'timesheet' AS type
          FROM public.timesheet_transaction
          WHERE longdate_checkin IS NOT NULL
          UNION ALL
          SELECT
            'Machine status captured' AS title,
            CONCAT_WS(' - ', m.machineid, st.description, p.jobid) AS meta,
            p.startdatetime AS event_ts,
            'machine' AS type
          FROM public.mch_productiondata p
          LEFT JOIN public.mch_machines m ON m.machineno = p.machineno
          LEFT JOIN public.mch_statustypes st ON st.statusid = p.statusid
          WHERE p.startdatetime >= (SELECT MAX(startdatetime) - interval '7 days' FROM public.mch_productiondata)
        ) recent
        ORDER BY event_ts DESC NULLS LAST
        LIMIT 6
      `),
      pool.query(`
        WITH latest_machine_day AS (
          SELECT MAX(startdatetime::date) AS day
          FROM public.mch_productiondata
        ),
        machine_hours AS (
          SELECT
            p.machineno,
            COALESCE(m.machineid, 'Machine ' || p.machineno::text) AS machineid,
            COALESCE(NULLIF(m.machinename, ''), m.description, '-') AS machinename,
            SUM(CASE WHEN p.statusid = 1 THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(p.enddatetime, p.startdatetime) - p.startdatetime)), 0) ELSE 0 END) / 3600.0 AS productive_hours,
            SUM(GREATEST(EXTRACT(EPOCH FROM (COALESCE(p.enddatetime, p.startdatetime) - p.startdatetime)), 0)) / 3600.0 AS total_hours,
            COUNT(*)::int AS event_count
          FROM public.mch_productiondata p
          JOIN latest_machine_day d ON p.startdatetime::date = d.day
          LEFT JOIN public.mch_machines m ON m.machineno = p.machineno
          GROUP BY p.machineno, COALESCE(m.machineid, 'Machine ' || p.machineno::text), COALESCE(NULLIF(m.machinename, ''), m.description, '-')
        )
        SELECT
          machineno,
          machineid,
          machinename,
          ROUND(productive_hours, 2)::float AS productive_hours,
          ROUND(total_hours, 2)::float AS total_hours,
          ROUND(productive_hours / NULLIF(total_hours, 0) * 100.0, 1)::float AS productive_pct,
          event_count
        FROM machine_hours
        ORDER BY total_hours DESC
        LIMIT 6
      `),
    ]);

    const overviewRow = overview.rows[0] || {};
    res.json({
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
        validation_queue: validationQueue.rows,
        progress_status: progressStatus.rows,
        order_summaries: orderSummaries.rows,
        recent_activities: recentActivities.rows,
        top_machines: topMachines.rows,
      },
      meta: meta(),
    });
  } catch (err) {
    console.error("dashboard operations-hub error:", err);
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
          WHERE DATE(longdate_checkin AT TIME ZONE 'Asia/Makassar') = CURRENT_DATE
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
        DATE(longdate_checkin AT TIME ZONE 'Asia/Makassar')::text AS day,
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
        EXTRACT(hour FROM longdate_checkin AT TIME ZONE 'Asia/Makassar')::int AS hour,
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
};
