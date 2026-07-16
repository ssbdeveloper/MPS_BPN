const pool = global.pool || require("../db");
const { resolveTimezone } = require("../config/timezone");
const { classifySapError } = require("../utils/sapErrorClassifier");

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

    // Terjemahkan pesan SAP jadi sebab yang bisa ditindak — di server, supaya label
    // konsisten dengan pengelompokan di endpoint ringkasan (satu classifier).
    const enriched = rows.map((row) => {
      const cause = classifySapError(row.sap_error || row.sap_response_text);
      return {
        ...row,
        cause_key: cause.key,
        cause_label: cause.label,
        cause_action: cause.action,
      };
    });

    res.json({
      data: enriched,
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

// GET /dashboard/sap-timesheet-staging-summary
// Ringkasan antrian: hitungan per status + kegagalan dikelompokkan per SEBAB (bukan per
// baris) supaya "56 baris gagal karena work center yang sama" terbaca sekali pandang.
async function getSapTimesheetStagingSummary(req, res) {
  try {
    const [byStatus, dateRange, failing] = await Promise.all([
      pool.query(`
        SELECT status, COUNT(*)::int AS n
        FROM public.sap_timesheet_staging
        GROUP BY status
      `),
      pool.query(`
        SELECT
          MIN(bucket_start)::date AS oldest,
          MAX(bucket_start)::date AS newest,
          COUNT(*) FILTER (WHERE status = 'PENDING' AND bucket_start::date = (now() AT TIME ZONE '${TZ}')::date)::int AS pending_today,
          COUNT(*) FILTER (WHERE status = 'POSTED'  AND posted_at::date   = (now() AT TIME ZONE '${TZ}')::date)::int AS posted_today
        FROM public.sap_timesheet_staging
      `),
      // Hanya FAILED + SKIPPED perlu triase. Ambil pesan mentah, klasifikasi di JS.
      pool.query(`
        SELECT id, status, sap_error, sap_response_text
        FROM public.sap_timesheet_staging
        WHERE status IN ('FAILED', 'SKIPPED')
        ORDER BY id DESC
      `),
    ]);

    const statusCounts = { PENDING: 0, POSTING: 0, POSTED: 0, FAILED: 0, SKIPPED: 0 };
    let total = 0;
    for (const r of byStatus.rows) {
      statusCounts[r.status] = r.n;
      total += r.n;
    }

    // Kelompokkan kegagalan per sebab.
    const groups = new Map();
    for (const r of failing.rows) {
      const cause = classifySapError(r.sap_error || r.sap_response_text);
      const g = groups.get(cause.key) || {
        cause_key: cause.key,
        label: cause.label,
        action: cause.action,
        count: 0,
        statuses: new Set(),
        sample_ids: [],
        sample_message: cause.message,
      };
      g.count += 1;
      g.statuses.add(r.status);
      if (g.sample_ids.length < 5) g.sample_ids.push(r.id);
      groups.set(cause.key, g);
    }
    const failures = [...groups.values()]
      .map((g) => ({ ...g, statuses: [...g.statuses] }))
      .sort((a, b) => b.count - a.count);

    res.json({
      data: {
        by_status: statusCounts,
        total,
        failing_total: failing.rows.length,
        oldest: dateRange.rows[0]?.oldest || null,
        newest: dateRange.rows[0]?.newest || null,
        pending_today: dateRange.rows[0]?.pending_today || 0,
        posted_today: dateRange.rows[0]?.posted_today || 0,
        failures,
      },
      meta: meta(),
    });
  } catch (err) {
    console.error("sap-timesheet-staging-summary error:", err);
    res.status(500).json({ error: err.message });
  }
}

// Kelayakan SAP = kolom status_record (satu sumber kebenaran; gerbang staging & kolom
// pakai logika productive/unproductive yang sama — migration 20260715_status_record_
// unproductive). Dashboard hanya menampilkan record non-0/3/4 (DISPLAY_EXCLUDE), jadi di
// antara yang tampil, status_record = TRUE berarti layak SAP.
const SAP_ELIGIBLE_SQL = "m.status_record";

const POSTED_EXISTS_SQL = `EXISTS (
  SELECT 1 FROM public.sap_staging_source s
  WHERE s.source_system = 'MCH_HOURS'
    AND s.source_row_id = m.proddataid::text
    AND s.posted_at IS NOT NULL
)`;

// Alasan sebuah baris TIDAK layak SAP — enumerable, untuk ditampilkan di drill.
// Label status diambil dari status_description (mch_statustypes) supaya tidak salah
// hardcode: 0=Off, 3=Downtime, 4=No Job.
// Alasan sebuah baris TIDAK layak (status_record = false). Hanya bermakna untuk record
// non-0/3/4 yang tampil di drill. Selaras dengan definisi status_record baru.
const INELIGIBLE_REASON_SQL = `CASE
  WHEN m.enddatetime IS NULL THEN 'Belum selesai (enddatetime kosong)'
  WHEN NULLIF(btrim(m.sn_employee),'') IS NULL THEN 'Operator kosong'
  WHEN m.status_activitytype IN ('M1','M2')
       AND (COALESCE(m.order_no,'') = '' OR COALESCE(m.operation_no,'') = '' OR COALESCE(m.confirmation_number,'') = '')
    THEN 'Order/operasi tak cocok di SAP (tanpa confirmation) — perbaiki job'
  WHEN NULLIF(btrim(m.status_activitytype),'') IS NULL THEN 'Tanpa activity type'
  ELSE NULL
END`;

// Off (0), Downtime (3), No Job (4): bukan jam kerja nyata. Dikeluarkan TOTAL dari
// heatmap & drill — tidak dihitung sebagai jam, tidak muncul di daftar record.
const DISPLAY_EXCLUDE_SQL = "m.statusid NOT IN (0, 3, 4)";

function clampDateRange(fromRaw, toRaw, defaultDays = 7, maxDays = 62) {
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  let to = isDate(toRaw) ? new Date(`${toRaw}T00:00:00Z`) : new Date();
  let from = isDate(fromRaw) ? new Date(`${fromRaw}T00:00:00Z`) : null;
  const day = 86400000;
  if (!from) from = new Date(to.getTime() - (defaultDays - 1) * day);
  if (from > to) [from, to] = [to, from];
  // batasi rentang supaya tidak men-scan berbulan-bulan sekaligus
  if ((to - from) / day > maxDays) from = new Date(to.getTime() - maxDays * day);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

// GET /dashboard/machine-hours-matrix?from=&to=
// Matriks jam per operator per hari + overlay SAP (total / layak / terkirim).
async function getMachineHoursMatrix(req, res) {
  try {
    const { from, to } = clampDateRange(req.query.from, req.query.to);

    const result = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(btrim(m.sn_employee),''), '__none__') AS operator_key,
        COALESCE(NULLIF(btrim(m.full_name),''), '(operator kosong)') AS operator_name,
        (m.startdatetime AT TIME ZONE '${TZ}')::date AS day,
        ROUND(SUM(COALESCE(m.duration_hours,0))::numeric, 2) AS total_h,
        ROUND(SUM(COALESCE(m.duration_hours,0)) FILTER (WHERE ${SAP_ELIGIBLE_SQL})::numeric, 2) AS eligible_h,
        ROUND(SUM(COALESCE(m.duration_hours,0)) FILTER (WHERE ${POSTED_EXISTS_SQL})::numeric, 2) AS posted_h,
        COUNT(*)::int AS n_records
      FROM public.mch_transaction m
      WHERE m.startdatetime >= ($1::date)
        AND m.startdatetime <  (($2::date) + 1)
        AND ${DISPLAY_EXCLUDE_SQL}
      GROUP BY operator_key, operator_name, day
      HAVING SUM(COALESCE(m.duration_hours,0)) > 0
      `,
      [from, to]
    );

    // Bentuk ke: daftar hari, daftar operator (urut jam desc), sel per (operator,hari).
    const days = [];
    const dayCursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (dayCursor <= end) {
      days.push(dayCursor.toISOString().slice(0, 10));
      dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
    }

    const opMap = new Map();
    const cells = {};
    for (const r of result.rows) {
      const dayStr = typeof r.day === "string" ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10);
      const op = opMap.get(r.operator_key) || {
        operator_key: r.operator_key, operator_name: r.operator_name,
        total_h: 0, eligible_h: 0, posted_h: 0, n_records: 0,
      };
      op.total_h += Number(r.total_h);
      op.eligible_h += Number(r.eligible_h || 0);
      op.posted_h += Number(r.posted_h || 0);
      op.n_records += r.n_records;
      opMap.set(r.operator_key, op);

      cells[`${r.operator_key}|${dayStr}`] = {
        total_h: Number(r.total_h),
        eligible_h: Number(r.eligible_h || 0),
        posted_h: Number(r.posted_h || 0),
        n_records: r.n_records,
      };
    }

    const operators = [...opMap.values()].sort((a, b) => b.total_h - a.total_h);
    const totals = operators.reduce(
      (acc, o) => {
        acc.total_h += o.total_h; acc.eligible_h += o.eligible_h;
        acc.posted_h += o.posted_h; acc.n_records += o.n_records;
        if (o.operator_key === "__none__") acc.unattributed_h += o.total_h;
        return acc;
      },
      { total_h: 0, eligible_h: 0, posted_h: 0, n_records: 0, unattributed_h: 0 }
    );
    for (const k of ["total_h", "eligible_h", "posted_h", "unattributed_h"]) totals[k] = Math.round(totals[k] * 10) / 10;

    res.json({ data: { from, to, days, operators, cells, totals }, meta: meta() });
  } catch (err) {
    console.error("machine-hours-matrix error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/machine-hours-records?operator=&day=&bucket=
// Drill: record mch_transaction untuk satu (operator, hari). bucket opsional:
// eligible | posted | ineligible.
async function getMachineHoursRecords(req, res) {
  try {
    const operator = String(req.query.operator || "").trim();
    const day = String(req.query.day || "").trim();
    const bucket = String(req.query.bucket || "all").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return res.status(400).json({ error: "Parameter 'day' harus YYYY-MM-DD" });
    }

    const params = [day];
    const where = [
      `(m.startdatetime AT TIME ZONE '${TZ}')::date = $1::date`,
      DISPLAY_EXCLUDE_SQL, // Off + No Job dikeluarkan dari drill
    ];
    if (operator === "__none__") {
      where.push(`NULLIF(btrim(m.sn_employee),'') IS NULL`);
    } else if (operator) {
      params.push(operator);
      where.push(`m.sn_employee = $${params.length}`);
    }
    if (bucket === "eligible") where.push(`${SAP_ELIGIBLE_SQL} AND NOT ${POSTED_EXISTS_SQL}`);
    else if (bucket === "posted") where.push(POSTED_EXISTS_SQL);
    else if (bucket === "ineligible") where.push(`NOT ${SAP_ELIGIBLE_SQL}`);

    const result = await pool.query(
      `
      SELECT
        m.proddataid,
        m.order_no, m.operation_no, m.confirmation_number, m.operation_short_text,
        m.machineid, m.machinename, m.workcentercode,
        m.startdatetime, m.enddatetime,
        ROUND(COALESCE(m.duration_hours,0)::numeric, 2) AS duration_hours,
        m.statusid, m.status_description, m.status_activitytype,
        m.full_name, m.sn_employee,
        ${SAP_ELIGIBLE_SQL} AS eligible,
        ${POSTED_EXISTS_SQL} AS posted,
        ${INELIGIBLE_REASON_SQL} AS ineligible_reason
      FROM public.mch_transaction m
      WHERE ${where.join(" AND ")}
      ORDER BY m.startdatetime
      LIMIT 500
      `,
      params
    );

    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error("machine-hours-records error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/ph3-jobs?search=&limit=
// Picker job dari ph3_order untuk koreksi manual (edit job). Satu baris per
// (order_no, operation_no), ambil yang terbaru (id DESC) — konsisten dengan ETL.
async function getPh3Jobs(req, res) {
  try {
    const search = String(req.query.search || "").trim();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const params = [];
    let filter = "COALESCE(order_no,'') <> '' AND COALESCE(operation_no,'') <> ''";
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      filter += ` AND (order_no ILIKE $${i} OR operation_short_text ILIKE $${i} OR order_description ILIKE $${i} OR confirmation_number ILIKE $${i})`;
    }
    params.push(limit);

    const result = await pool.query(
      `
      SELECT DISTINCT ON (order_no, operation_no)
        order_no, operation_no, confirmation_number,
        operation_short_text, order_description, work_center, cost_center
      FROM public.ph3_order
      WHERE ${filter}
      ORDER BY order_no, operation_no, id DESC
      LIMIT $${params.length}
      `,
      params
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error("ph3-jobs error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/operators?search=
// Picker operator dari usernfc untuk koreksi manual (assign operator).
async function getOperators(req, res) {
  try {
    const search = String(req.query.search || "").trim();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const params = [];
    let filter = "NULLIF(btrim(snssb),'') IS NOT NULL";
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      filter += ` AND (full_name ILIKE $${i} OR snssb ILIKE $${i})`;
    }
    params.push(limit);
    const result = await pool.query(
      `SELECT DISTINCT snssb, full_name FROM public.usernfc
        WHERE ${filter}
        ORDER BY full_name
        LIMIT $${params.length}`,
      params
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error("operators error:", err);
    res.status(500).json({ error: err.message });
  }
}

// POST /dashboard/machine-hours-override
// Koreksi manual satu record mch_transaction: assign job (dari ph3_order) dan/atau
// operator (snssb). Diterapkan LANGSUNG ke mch_transaction + dicatat di
// mch_transaction_override supaya bertahan re-derivasi ETL (lihat migration).
async function saveMachineHoursOverride(req, res) {
  const client = await pool.connect();
  try {
    const proddataid = parseInt(req.body?.proddataid, 10);
    const orderNo = req.body?.order_no ? String(req.body.order_no).trim() : null;
    const operationNo = req.body?.operation_no ? String(req.body.operation_no).trim() : null;
    const snEmployee = req.body?.sn_employee ? String(req.body.sn_employee).trim() : null;
    const note = req.body?.note ? String(req.body.note).trim() : null;
    const by = req.header("x-user-id") || null;

    if (!Number.isFinite(proddataid)) {
      return res.status(400).json({ error: "proddataid wajib" });
    }
    if (orderNo && !operationNo) {
      return res.status(400).json({ error: "operation_no wajib bila order_no diisi" });
    }
    if (!orderNo && !snEmployee) {
      return res.status(400).json({ error: "Tidak ada yang diubah (isi job atau operator)" });
    }

    // Tolak kalau sudah terkirim ke SAP — koreksi butuh storno, bukan edit senyap.
    const posted = await client.query(
      `SELECT 1 FROM public.sap_staging_source
        WHERE source_system='MCH_HOURS' AND source_row_id=$1::text AND posted_at IS NOT NULL LIMIT 1`,
      [proddataid]
    );
    if (posted.rows.length > 0) {
      return res.status(409).json({ error: "Record sudah terkirim ke SAP. Koreksi butuh storno di SAP dulu." });
    }

    await client.query("BEGIN");

    if (orderNo) {
      // Ambil field job dari ph3_order (terbaru) + SOW untuk workcenter/ssbr.
      const upd = await client.query(
        `
        WITH j AS (
          SELECT * FROM public.ph3_order
          WHERE order_no = $2 AND operation_no = $3
          ORDER BY id DESC LIMIT 1
        ),
        s AS (
          SELECT ssbr_id, workcenter FROM public.sow
          WHERE COALESCE(NULLIF(ltrim(trim(coalesce(order_no,'')),'0'),''),'0') = COALESCE(NULLIF(ltrim(trim($2),'0'),''),'0')
            AND COALESCE(NULLIF(ltrim(trim(operation_no::text),'0'),''),'0') = COALESCE(NULLIF(ltrim(trim($3),'0'),''),'0')
          LIMIT 1
        )
        UPDATE public.mch_transaction m SET
          order_no = j.order_no,
          operation_no = j.operation_no,
          confirmation_number = j.confirmation_number,
          operation_short_text = j.operation_short_text,
          operation_description = j.operation_description,
          sequence_category = j.sequence_category,
          sequence_number = j.sequence_number,
          branch_operation_no = j.branch_operation_no,
          return_operation_no = j.return_operation_no,
          cost_center = j.cost_center,
          material_no = j.material_no,
          material_description = j.material_description,
          ssbr_id = COALESCE((SELECT ssbr_id FROM s), m.ssbr_id),
          workcentercode = COALESCE((SELECT workcenter FROM s), m.workcentercode),
          refreshed_at = now()
        FROM j
        WHERE m.proddataid = $1
        RETURNING m.proddataid
        `,
        [proddataid, orderNo, operationNo]
      );
      if (upd.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: `Job ${orderNo}/${operationNo} tidak ada di ph3_order, atau record tidak ditemukan` });
      }
    }

    if (snEmployee) {
      await client.query(
        `
        UPDATE public.mch_transaction m SET
          sn_employee = $2,
          full_name = COALESCE((SELECT full_name FROM public.usernfc WHERE snssb = $2 LIMIT 1), m.full_name),
          refreshed_at = now()
        WHERE m.proddataid = $1
        `,
        [proddataid, snEmployee]
      );
    }

    // Catat override (bertahan re-derivasi). Merge dengan yang ada.
    await client.query(
      `
      INSERT INTO public.mch_transaction_override (proddataid, order_no, operation_no, sn_employee, note, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (proddataid) DO UPDATE SET
        order_no = COALESCE(EXCLUDED.order_no, mch_transaction_override.order_no),
        operation_no = COALESCE(EXCLUDED.operation_no, mch_transaction_override.operation_no),
        sn_employee = COALESCE(EXCLUDED.sn_employee, mch_transaction_override.sn_employee),
        note = COALESCE(EXCLUDED.note, mch_transaction_override.note),
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      `,
      [proddataid, orderNo, operationNo, snEmployee, note, by]
    );

    await client.query("COMMIT");

    // Kembalikan record terbaru + status kelayakan.
    const fresh = await pool.query(
      `
      SELECT m.proddataid, m.order_no, m.operation_no, m.confirmation_number,
        m.machineid, m.full_name, m.sn_employee,
        ROUND(COALESCE(m.duration_hours,0)::numeric,2) AS duration_hours,
        ${SAP_ELIGIBLE_SQL} AS eligible,
        ${INELIGIBLE_REASON_SQL} AS ineligible_reason
      FROM public.mch_transaction m WHERE m.proddataid = $1
      `,
      [proddataid]
    );
    res.json({ data: fresh.rows[0] || null, meta: meta() });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    console.error("machine-hours-override error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// POST /dashboard/sap-ops/enqueue
// Titipkan permintaan operasi (stage_catchup / retry_failed) ke antrian sap_ops_request.
// API TIDAK menjalankan Python — worker (ops_worker.py) yang mengeksekusi. Lihat migration
// 20260715_sap_ops_request untuk alasannya.
async function enqueueSapOps(req, res) {
  const ALLOWED = new Set(["stage_catchup", "retry_failed"]);
  try {
    const action = String(req.body?.action || "").trim();
    if (!ALLOWED.has(action)) {
      return res.status(400).json({ error: `Aksi tidak dikenal: ${action || "(kosong)"}` });
    }
    const requestedBy = req.header("x-user-id") || null;

    // Unique index parsial menolak kalau sudah ada QUEUED/RUNNING untuk aksi yang sama.
    let result;
    try {
      result = await pool.query(
        `INSERT INTO public.sap_ops_request (action, requested_by)
         VALUES ($1, $2)
         RETURNING id, action, status, requested_at`,
        [action, requestedBy]
      );
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "Permintaan serupa masih diproses. Tunggu sampai selesai." });
      }
      throw err;
    }

    res.status(202).json({ data: result.rows[0], meta: meta() });
  } catch (err) {
    console.error("enqueueSapOps error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/sap-ops/requests — status permintaan terbaru (untuk UI polling)
async function getSapOpsRequests(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, action, status, requested_by, requested_at, started_at, finished_at, result, error
       FROM public.sap_ops_request
       ORDER BY id DESC
       LIMIT 20`
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error("getSapOpsRequests error:", err);
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
  getSapTimesheetStagingSummary,
  enqueueSapOps,
  getSapOpsRequests,
  getMachineHoursMatrix,
  getMachineHoursRecords,
  getPh3Jobs,
  getOperators,
  saveMachineHoursOverride,
  getOrderProgress,
  getOrderActivityDetail,
  getOperationTimesheetHistory,
  refreshOrderMatviews,
};
