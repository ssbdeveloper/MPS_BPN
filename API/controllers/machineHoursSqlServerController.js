const sql = require("mssql");

const sqlServerConfig = {
  server: process.env.SQLSERVER_HOST || "10.169.13.13",
  port: parseInt(process.env.SQLSERVER_PORT || "57970", 10),
  database: process.env.SQLSERVER_DATABASE || "SSB_OEE",
  user: process.env.SQLSERVER_USER || "bsa",
  password: process.env.SQLSERVER_PASSWORD || "@dminbsa",
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  connectionTimeout: 10000,
  requestTimeout: 30000,
};

function getSafeConnectionInfo() {
  return {
    server: sqlServerConfig.server,
    port: sqlServerConfig.port,
    database: sqlServerConfig.database,
    user: sqlServerConfig.user ? "configured" : "missing",
  };
}

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(sqlServerConfig)
      .connect()
      .catch((err) => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

function parseIntParam(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseDateParam(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function applyFilters(request, filters = {}) {
  const where = ["p.startdatetime IS NOT NULL"];

  const from = parseDateParam(filters.from);
  if (from) {
    request.input("from", sql.Date, from);
    where.push("CAST(p.startdatetime AS DATE) >= @from");
  }

  const to = parseDateParam(filters.to);
  if (to) {
    request.input("to", sql.Date, to);
    where.push("CAST(p.startdatetime AS DATE) <= @to");
  }

  const statusId = filters.statusid ? parseInt(filters.statusid, 10) : null;
  if (Number.isInteger(statusId)) {
    request.input("statusid", sql.Int, statusId);
    where.push("p.statusid = @statusid");
  }

  const machineNo = filters.machineno ? parseInt(filters.machineno, 10) : null;
  if (Number.isInteger(machineNo)) {
    request.input("machineno", sql.Int, machineNo);
    where.push("p.machineno = @machineno");
  }

  if (filters.operatorid) {
    request.input("operatorid", sql.VarChar(64), String(filters.operatorid));
    where.push("p.operatorid = @operatorid");
  }

  if (filters.jobid) {
    request.input("jobid", sql.VarChar(64), String(filters.jobid));
    where.push("p.jobid = @jobid");
  }

  return where.join(" AND ");
}

function normalizeRow(row) {
  return {
    ...row,
    work_date: row.work_date instanceof Date ? row.work_date.toISOString().slice(0, 10) : row.work_date,
    first_startdatetime:
      row.first_startdatetime instanceof Date ? row.first_startdatetime.toISOString() : row.first_startdatetime,
    last_enddatetime:
      row.last_enddatetime instanceof Date ? row.last_enddatetime.toISOString() : row.last_enddatetime,
    duration_hours: row.duration_hours == null ? 0 : Number(row.duration_hours),
    duration_seconds: row.duration_seconds == null ? 0 : Number(row.duration_seconds),
    event_count: row.event_count == null ? 0 : Number(row.event_count),
    open_event_count: row.open_event_count == null ? 0 : Number(row.open_event_count),
  };
}

async function fetchMachineHoursRows(filters = {}) {
  const limit = parseIntParam(filters.limit, 200, 1, 1000);
  const pool = await getPool();
  const request = pool.request();
  request.input("limit", sql.Int, limit);

  const where = applyFilters(request, filters);
  const result = await request.query(`
    SELECT TOP (@limit)
      CAST(p.startdatetime AS DATE) AS work_date,
      p.statusid,
      st.description AS status_description,
      p.machineno,
      m.machineid,
      m.machinename,
      COALESCE(NULLIF(m.description, ''), m.machinename) AS machine_description,
      m.plantid,
      p.operatorid,
      p.jobid,
      COUNT(*) AS event_count,
      SUM(CASE WHEN p.enddatetime IS NULL THEN 1 ELSE 0 END) AS open_event_count,
      DATEADD(HOUR, -8, MIN(p.startdatetime)) AS first_startdatetime,
      DATEADD(HOUR, -8, MAX(p.enddatetime)) AS last_enddatetime,
      SUM(
        CASE
          WHEN p.enddatetime IS NULL THEN 0
          ELSE DATEDIFF(SECOND, p.startdatetime, p.enddatetime)
        END
      ) AS duration_seconds,
      ROUND(
        CAST(
          SUM(
            CASE
              WHEN p.enddatetime IS NULL THEN 0
              ELSE DATEDIFF(SECOND, p.startdatetime, p.enddatetime)
            END
          ) AS NUMERIC(18, 4)
        ) / 3600.0,
        4
      ) AS duration_hours
    FROM dbo.ProductionData p
    LEFT JOIN dbo.Machines m ON m.machineno = p.machineno
    LEFT JOIN dbo.StatusTypes st ON st.statusid = p.statusid
    WHERE ${where}
    GROUP BY
      CAST(p.startdatetime AS DATE),
      p.statusid,
      st.description,
      p.machineno,
      m.machineid,
      m.machinename,
      COALESCE(NULLIF(m.description, ''), m.machinename),
      m.plantid,
      p.operatorid,
      p.jobid
    ORDER BY MIN(p.startdatetime) DESC, p.machineno ASC, p.operatorid ASC, p.jobid ASC
  `);

  return result.recordset.map(normalizeRow);
}

async function getMachineHours(req, res) {
  try {
    const rows = await fetchMachineHoursRows(req.query);
    res.json({
      success: true,
      data: rows,
      meta: {
        count: rows.length,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("SQL Server machine hours error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
      source: "sqlserver",
      connection: getSafeConnectionInfo(),
    });
  }
}

async function getHealth(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query("SELECT TOP 1 startdatetime FROM dbo.ProductionData");
    res.json({
      success: true,
      connected: true,
      sample_count: result.recordset.length,
      connection: getSafeConnectionInfo(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      connected: false,
      error: err.message,
      connection: getSafeConnectionInfo(),
    });
  }
}

module.exports = {
  fetchMachineHoursRows,
  getHealth,
  getMachineHours,
};
