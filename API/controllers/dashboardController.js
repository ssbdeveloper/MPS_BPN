const pool = global.pool || require("../db");

const meta = () => ({ generated_at: new Date().toISOString() });

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
};
