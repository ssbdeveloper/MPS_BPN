const ewsCalculator = require("../services/ewsCalculator");
const ewsRealtimeHub = require("../services/ewsRealtimeHub");
const db = global.pool || require("../db");

const summaryCache = new Map();
const SUMMARY_TTL_MS = 60 * 1000;

function clampLimit(value, fallback = 5) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 50);
}

async function getSummary(req, res) {
  try {
    if (req.query.live !== "1") {
      const summary = await ewsRealtimeHub.getLatestSnapshotForQuery(req.query);
      res.set("X-Data-Source", "kpi-snapshot");
      res.json(summary);
      return;
    }

    const cacheKey = JSON.stringify({
      basis: req.query.basis || "rolling",
      window: req.query.window || "",
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

async function getIssues(req, res) {
  try {
    const limit = clampLimit(req.query.limit, 5);
    const summary = req.query.live === "1"
      ? await ewsCalculator.calculateSystemSummary({
        basis: req.query.basis || "rolling",
        window: req.query.window,
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
    const result = await db.query(
      `
      SELECT
        action_id,
        alert_id,
        kpi_type,
        scope_type,
        scope_key,
        machine_id,
        status_reason,
        action_taken,
        pic,
        action_status,
        due_at,
        action_date,
        last_updated,
        updated_by
      FROM ews.action_table
      WHERE ($1 = 'all' OR action_status = $1)
      ORDER BY due_at ASC NULLS LAST, last_updated DESC
      LIMIT 100
      `,
      [status],
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

module.exports = {
  getSummary,
  getIssues,
  getActions,
  getKpiDetail,
  stream,
  getHealth,
};
