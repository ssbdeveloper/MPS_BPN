const db = global.pool || require("../db");

const PLANT_SSB = process.env.PLANT_SSB || "";

const DEFAULT_DAYS = 7;
const MAX_LIMIT = 1000;

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - DEFAULT_DAYS);
  return { start: dateOnly(start), end: dateOnly(end) };
}

function normalizeRange(query) {
  const defaults = defaultRange();
  return {
    start: query.start || query.from || defaults.start,
    end: query.end || query.to || defaults.end,
  };
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function padLeft(value, length) {
  const text = String(value ?? "").trim();
  return text ? text.padStart(length, "0") : "";
}

function formatSapDate(value) {
  return String(value || "").slice(0, 10).replaceAll("-", "");
}

function formatSapTime(value) {
  return String(value || "").slice(11, 19).replaceAll(":", "");
}

function getConfType(row) {
  const activityType = String(row.activitytype || "").trim().toUpperCase();
  return activityType === "M1" || activityType === "M2" ? activityType : "";
}

function getLstar(row) {
  const activityType = String(row.activitytype || "").trim();
  const normalized = activityType.toUpperCase();
  return normalized === "M1" || normalized === "M2" ? "" : activityType;
}

function buildSapPayload(row) {
  const zconfType = getConfType(row);
  const startDateTime = row.first_startdatetime;
  const endDateTime = row.last_enddatetime || row.first_startdatetime;

  return {
    ZTIMESHEETID: `${PLANT_SSB}${row.min_proddataid || ""}`,
    PERNR: String(row.operatorid || ""),
    RUECK: zconfType === "M1" || zconfType === "M2" ? padLeft(row.jobid, 10) : "",
    AUFNR: padLeft(row.order_no || row.jobid, 12),
    VORNR: padLeft(row.operation_no, 4),
    FLGAT: row.sequence_category || "",
    PLNFL: row.ph3_sequence_number || "",
    VORNR_B: row.branch_operation_no || "",
    VORNR_R: row.return_operation_no || "",
    ZCONF_TYPE: zconfType,
    ARBPL: row.machineid || row.work_center || "",
    LSTAR: getLstar(row),
    ISDD: formatSapDate(startDateTime),
    ISDZ: formatSapTime(startDateTime),
    IEDD: formatSapDate(endDateTime),
    IEDZ: formatSapTime(endDateTime),
    WERKS: PLANT_SSB,
    AUERU: "",
    ZBARCODEID: zconfType === "M2" ? row.status_description || "" : "",
  };
}

function withSapPayload(rows) {
  return rows.map((row) => ({
    ...row,
    sap_payload: buildSapPayload(row),
  }));
}

function buildFilters(query, offset = 1) {
  const { start, end } = normalizeRange(query);
  const params = [start, end];
  let paramIdx = offset + 2;
  const clauses = [
    `p.startdatetime >= $${offset}::date`,
    `p.startdatetime < ($${offset + 1}::date + interval '1 day')`,
    "p.startdatetime IS NOT NULL",
  ];

  if (query.search && query.search.trim()) {
    const searchLike = `%${query.search.trim().toLowerCase()}%`;
    clauses.push(`(
      LOWER(COALESCE(m.machineid, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(m.machinename, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(m.description, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(st.description, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(p.operatorid, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(p.jobid, '')) LIKE $${paramIdx}
    )`);
    params.push(searchLike);
    paramIdx += 1;
  }

  if (query.machineno) {
    clauses.push(`p.machineno = $${paramIdx}::int`);
    params.push(query.machineno);
    paramIdx += 1;
  }

  if (query.statusid) {
    clauses.push(`p.statusid = $${paramIdx}::int`);
    params.push(query.statusid);
    paramIdx += 1;
  }

  if (query.operatorid && query.operatorid.trim()) {
    clauses.push(`p.operatorid = $${paramIdx}`);
    params.push(query.operatorid.trim());
    paramIdx += 1;
  }

  if (query.jobid && query.jobid.trim()) {
    clauses.push(`p.jobid = $${paramIdx}`);
    params.push(query.jobid.trim());
  }

  return {
    start,
    end,
    params,
    whereSQL: clauses.join(" AND "),
  };
}

const groupedSelect = `
  SELECT
    concat_ws('|',
      p.machineno::text,
      p.statusid::text,
      COALESCE(p.operatorid, ''),
      COALESCE(p.jobid, ''),
      to_char(p.startdatetime::date, 'YYYY-MM-DD')
    ) AS record_key,
    MIN(p.proddataid) AS min_proddataid,
    to_char(p.startdatetime::date, 'YYYY-MM-DD') AS work_date,
    p.machineno,
    COALESCE(m.machineid, '') AS machineid,
    COALESCE(m.machinename, '') AS machinename,
    COALESCE(NULLIF(m.description, ''), m.machinename, m.machineid, 'Machine ' || p.machineno::text) AS machine_description,
    m.plantid,
    p.statusid,
    COALESCE(st.description, 'Unknown') AS status_description,
    COALESCE(st.activitytype, '') AS activitytype,
    p.operatorid,
    p.jobid,
    COALESCE(q.order_no, '') AS order_no,
    COALESCE(q.operation_no, '') AS operation_no,
    COALESCE(q.sequence_category, '') AS sequence_category,
    COALESCE(q.sequence_number, '') AS sequence_number,
    COALESCE(ph3.sequence_number, '') AS ph3_sequence_number,
    COALESCE(q.branch_operation_no, '') AS branch_operation_no,
    COALESCE(q.return_operation_no, '') AS return_operation_no,
    COALESCE(q.work_center, '') AS work_center,
    COUNT(*)::int AS event_count,
    SUM(CASE WHEN p.enddatetime IS NULL THEN 1 ELSE 0 END)::int AS open_event_count,
    to_char(MIN(p.startdatetime), 'YYYY-MM-DD"T"HH24:MI:SS') AS first_startdatetime,
    to_char(MAX(p.enddatetime), 'YYYY-MM-DD"T"HH24:MI:SS') AS last_enddatetime,
    SUM(
      CASE
        WHEN p.enddatetime IS NULL THEN 0
        ELSE GREATEST(EXTRACT(EPOCH FROM (p.enddatetime - p.startdatetime)), 0)
      END
    )::bigint AS duration_seconds,
    ROUND(
      SUM(
        CASE
          WHEN p.enddatetime IS NULL THEN 0
          ELSE GREATEST(EXTRACT(EPOCH FROM (p.enddatetime - p.startdatetime)), 0)
        END
      ) / 3600.0,
      4
    ) AS duration_hours
  FROM public.mch_productiondata p
  LEFT JOIN public.mch_machines m ON m.machineno = p.machineno
  LEFT JOIN public.mch_statustypes st ON st.statusid = p.statusid
  LEFT JOIN LATERAL (
    SELECT
      q.order_no,
      q.operation_no,
      q.sequence_category,
      q.sequence_number,
      q.branch_operation_no,
      q.return_operation_no,
      q.work_center
    FROM public.qh3_order q
    WHERE q.confirmation_number = regexp_replace(COALESCE(p.jobid, ''), '^0+', '')
       OR q.order_no = p.jobid
    ORDER BY
      CASE WHEN q.confirmation_number = regexp_replace(COALESCE(p.jobid, ''), '^0+', '') THEN 0 ELSE 1 END,
      q.id DESC
    LIMIT 1
  ) q ON true
  LEFT JOIN LATERAL (
    SELECT ph3.sequence_number
    FROM public.ph3_order ph3
    WHERE ph3.confirmation_number = p.jobid
       OR ph3.confirmation_number = regexp_replace(COALESCE(p.jobid, ''), '^0+', '')
    ORDER BY
      CASE WHEN ph3.confirmation_number = p.jobid THEN 0 ELSE 1 END,
      ph3.id DESC
    LIMIT 1
  ) ph3 ON true
`;

const groupedBy = `
  GROUP BY
    p.startdatetime::date,
    p.machineno,
    m.machineid,
    m.machinename,
    COALESCE(NULLIF(m.description, ''), m.machinename, m.machineid, 'Machine ' || p.machineno::text),
    m.plantid,
    p.statusid,
    st.description,
    st.activitytype,
    p.operatorid,
    p.jobid,
    q.order_no,
    q.operation_no,
    q.sequence_category,
    q.sequence_number,
    ph3.sequence_number,
    q.branch_operation_no,
    q.return_operation_no,
    q.work_center
`;

exports.validationStats = async (req, res) => {
  try {
    const filters = buildFilters(req.query);

    const query = `
      WITH grouped AS (
        ${groupedSelect}
        WHERE ${filters.whereSQL}
        ${groupedBy}
      )
      SELECT
        machineno,
        MAX(machineid) AS machineid,
        MAX(machinename) AS machinename,
        MAX(machine_description) AS machine_description,
        MAX(plantid) AS plantid,
        COUNT(*)::int AS record_count,
        COALESCE(SUM(event_count), 0)::int AS event_count,
        COALESCE(SUM(open_event_count), 0)::int AS open_event_count,
        COALESCE(SUM(duration_seconds), 0)::bigint AS duration_seconds,
        ROUND(COALESCE(SUM(duration_hours), 0), 4) AS duration_hours,
        to_char(MAX(first_startdatetime::timestamp), 'YYYY-MM-DD"T"HH24:MI:SS') AS latest_startdatetime,
        SUM(COUNT(*)) OVER ()::int AS g_total_records,
        COUNT(*) OVER ()::int AS g_total_machines,
        COALESCE(SUM(SUM(event_count)) OVER (), 0)::int AS g_total_events,
        COALESCE(SUM(SUM(open_event_count)) OVER (), 0)::int AS g_total_open_events,
        ROUND(COALESCE(SUM(SUM(duration_hours)) OVER (), 0), 4) AS g_total_hours
      FROM grouped
      GROUP BY machineno
      ORDER BY MAX(first_startdatetime::timestamp) DESC, machineno ASC
    `;

    const result = await db.query(query, filters.params);
    const first = result.rows[0];

    res.json({
      success: true,
      meta: {
        start: filters.start,
        end: filters.end,
        plant: PLANT_SSB,
        generated_at: new Date().toISOString(),
      },
      stats: first ? {
        totalRecords: Number(first.g_total_records || 0),
        totalMachines: Number(first.g_total_machines || 0),
        totalEvents: Number(first.g_total_events || 0),
        totalOpenEvents: Number(first.g_total_open_events || 0),
        totalHours: Number(first.g_total_hours || 0).toFixed(2),
        totalPending: Number(first.g_total_records || 0),
        totalValidated: 0,
      } : {
        totalRecords: 0,
        totalMachines: 0,
        totalEvents: 0,
        totalOpenEvents: 0,
        totalHours: "0.00",
        totalPending: 0,
        totalValidated: 0,
      },
      groups: result.rows.map(({
        g_total_records,
        g_total_machines,
        g_total_events,
        g_total_open_events,
        g_total_hours,
        ...row
      }) => row),
    });
  } catch (err) {
    console.error("machineHoursValidation validationStats error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.validationGroupRecords = async (req, res) => {
  try {
    const { machineno } = req.params;
    const filters = buildFilters({ ...req.query, machineno });
    const limit = clampLimit(req.query.limit);
    const params = [...filters.params, limit];

    const query = `
      ${groupedSelect}
      WHERE ${filters.whereSQL}
      ${groupedBy}
      ORDER BY MIN(p.startdatetime) DESC, p.statusid ASC, p.operatorid ASC, p.jobid ASC
      LIMIT $${params.length}
    `;

    const result = await db.query(query, params);

    res.json({
      success: true,
      meta: {
        start: filters.start,
        end: filters.end,
        plant: PLANT_SSB,
        generated_at: new Date().toISOString(),
      },
      data: withSapPayload(result.rows),
    });
  } catch (err) {
    console.error("machineHoursValidation validationGroupRecords error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
