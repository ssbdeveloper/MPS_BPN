"use strict";

const defaultPool = global.pool || require("../db");
const { calculateMetrics, rollupMetrics, compareByConcern } = require("../utils/manufacturingProgressMetrics");
const { buildUpdateTrend } = require("../utils/progressUpdateTrend");

const ACTUAL_NOTE = "Temporary local hours — may include records not yet posted to SAP";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_HEALTH = new Set(["red", "yellow", "green", "unknown"]);
const VALID_STATUS = new Set(["active", "completed", "all"]);

const OPERATIONS_SQL = `
/* manufacturing-operations */
WITH RECURSIVE
candidate_tasks AS MATERIALIZED (
  SELECT t.*, p.project_name
  FROM public.ms_project_task t
  JOIN public.ms_project p ON p.project_id = t.project_id
  WHERE t.is_active AND t.order_no IS NOT NULL AND t.operation_no ~ '^0*[0-9]+$'
),
ancestors AS (
  SELECT c.task_id AS mapped_task_id, p.task_id, p.parent_task_id, p.task_name, 1 AS depth
  FROM candidate_tasks c
  JOIN public.ms_project_task p ON p.task_id = c.parent_task_id AND p.project_id = c.project_id
  UNION ALL
  SELECT a.mapped_task_id, p.task_id, p.parent_task_id, p.task_name, a.depth + 1
  FROM ancestors a
  JOIN public.ms_project_task p ON p.task_id = a.parent_task_id
),
nearest_unit AS MATERIALIZED (
  SELECT DISTINCT ON (mapped_task_id) mapped_task_id, task_id, task_name
  FROM ancestors
  WHERE task_name ILIKE '%unit%'
  ORDER BY mapped_task_id, depth
),
raw_mapped AS MATERIALIZED (
  SELECT c.project_id, c.project_name, c.task_id, c.task_name,
         unit.task_id AS unit_key, unit.task_name AS unit_name,
         s.idsow, ltrim(s.order_no, '0') AS order_key, s.order_no,
         s.operation_no, s.operation_text, s.workcenter, s.part_number, s.planhours AS plan_hours,
         CASE WHEN COALESCE(s.systemstatus, '') IN ('TECO', 'CLSD') OR EXISTS (
           SELECT 1 FROM public.ph3_order po
           WHERE ltrim(po.order_no, '0') = ltrim(s.order_no, '0')
             AND upper(trim(COALESCE(po.order_description, ''))) = 'TECO'
         ) THEN true ELSE false END AS is_teco,
         s.progress AS stored_progress, c.plan_start, c.plan_finish
  FROM candidate_tasks c
  JOIN public.sow s ON ltrim(s.order_no, '0') = ltrim(c.order_no, '0')
                   AND s.operation_no = c.operation_no::integer
  LEFT JOIN nearest_unit unit ON unit.mapped_task_id = c.task_id
),
mapped_ops AS MATERIALIZED (
  SELECT *, count(*) OVER (PARTITION BY project_id, order_key, operation_no)::int AS mapping_count,
         row_number() OVER (PARTITION BY project_id, order_key, operation_no ORDER BY task_id)::int AS mapping_rank
  FROM raw_mapped
),
actual_by_op AS MATERIALIZED (
  SELECT m.project_id, m.order_key, m.operation_no, sum(t.duration)::float AS actual_hours
  FROM (SELECT DISTINCT project_id, order_key, operation_no FROM mapped_ops) m
  JOIN public.timesheet_transaction t ON ltrim(t.order_no, '0') = m.order_key
    AND t.operation_no::text ~ '^0*[0-9]+$' AND t.operation_no::integer = m.operation_no
  WHERE t.state_flag <> 5 AND t.duration > 0
    -- Subcont role (2026-09-15, owner keputusan): jam operator Subcont tidak
    -- mengonsumsi planhours SAP operation — dikecualikan dari actual_hours di sini,
    -- sama seperti dikecualikan dari staging SAP. Tetap terhitung penuh di adoption
    -- (EWS), yang membaca timesheet_transaction langsung tanpa filter ini.
    AND NOT EXISTS (
      SELECT 1 FROM public.usernfc u
      WHERE upper(regexp_replace(COALESCE(u.snssb, ''), '\\s+', '', 'g'))
          = upper(regexp_replace(COALESCE(t.serialnumber, ''), '\\s+', '', 'g'))
        AND upper(btrim(COALESCE(u.roles, ''))) = 'SUBCONT'
    )
  GROUP BY m.project_id, m.order_key, m.operation_no
),
latest_evidence AS MATERIALIZED (
  SELECT DISTINCT ON (h.operation_id) h.operation_id, h.issue_description, h.image_path
  FROM public.progress_update_history h
  JOIN (SELECT DISTINCT idsow FROM mapped_ops) m ON m.idsow = h.operation_id
  ORDER BY h.operation_id, h.created_at DESC, h.id DESC
),
latest_subtask_evidence AS MATERIALIZED (
  SELECT DISTINCT ON (h.sub_operation_id) h.sub_operation_id, h.operation_id, h.issue_description
  FROM public.sow_sub_operation_progress_history h
  JOIN (SELECT DISTINCT idsow FROM mapped_ops) m ON m.idsow = h.operation_id
  ORDER BY h.sub_operation_id, h.created_at DESC, h.id DESC
),
/* Two most recent progress updates per operation. Hours and EAC come from the
   snapshot frozen at update time, so a later timesheet revision cannot rewrite
   what an earlier update reported. */
recent_updates AS MATERIALIZED (
  SELECT h.operation_id, h.progress, h.created_at,
         h.actual_hours_at_update, h.eac_hours_at_update,
         row_number() OVER (PARTITION BY h.operation_id ORDER BY h.created_at DESC, h.id DESC) AS rn
  FROM public.progress_update_history h
  JOIN (SELECT DISTINCT idsow FROM mapped_ops) m ON m.idsow = h.operation_id
),
update_trend AS MATERIALIZED (
  SELECT curr.operation_id,
         curr.created_at AS last_update_at, curr.progress::float AS last_progress_pct,
         curr.actual_hours_at_update::float AS last_actual_hours,
         curr.eac_hours_at_update::float AS last_eac_hours,
         prev.created_at AS prev_update_at, prev.progress::float AS prev_progress_pct,
         prev.actual_hours_at_update::float AS prev_actual_hours,
         prev.eac_hours_at_update::float AS prev_eac_hours
  FROM recent_updates curr
  LEFT JOIN recent_updates prev ON prev.operation_id = curr.operation_id AND prev.rn = 2
  WHERE curr.rn = 1
)
SELECT m.project_id, m.project_name, m.task_id, m.task_name, m.unit_key, m.unit_name,
       m.mapping_count, m.idsow, m.order_no, m.operation_no, m.operation_text, m.workcenter, m.part_number,
       m.plan_hours::float, COALESCE(a.actual_hours, 0)::float AS actual_hours,
       CASE WHEN m.is_teco THEN 100 ELSE m.stored_progress END::float AS progress_pct,
       m.is_teco, e.issue_description AS latest_issue, e.image_path AS latest_image_path,
       u.last_update_at, u.last_progress_pct, u.last_actual_hours, u.last_eac_hours,
       u.prev_update_at, u.prev_progress_pct, u.prev_actual_hours, u.prev_eac_hours,
       (($2 = 'all' OR ($2 = 'active' AND NOT m.is_teco) OR ($2 = 'completed' AND m.is_teco))
         AND ($3::date IS NULL OR m.plan_finish IS NULL OR m.plan_finish::date >= $3::date)
         AND ($4::date IS NULL OR m.plan_start IS NULL OR m.plan_start::date <= $4::date)
         AND ($1 = '' OR m.project_name ILIKE '%' || $1 || '%' OR m.task_name ILIKE '%' || $1 || '%'
           OR COALESCE(m.unit_name, '') ILIKE '%' || $1 || '%' OR m.order_no ILIKE '%' || $1 || '%'
           OR m.operation_no::text ILIKE '%' || $1 || '%' OR COALESCE(m.operation_text, '') ILIKE '%' || $1 || '%'
           OR COALESCE(m.workcenter, '') ILIKE '%' || $1 || '%' OR COALESCE(e.issue_description, '') ILIKE '%' || $1 || '%'
           OR EXISTS (SELECT 1 FROM public.sow_sub_operation so
             LEFT JOIN latest_subtask_evidence se ON se.sub_operation_id = so.id
             WHERE so.operation_id = m.idsow AND so.is_active
               AND (so.title ILIKE '%' || $1 || '%' OR COALESCE(se.issue_description, '') ILIKE '%' || $1 || '%')))
       ) AS is_visible
FROM mapped_ops m
LEFT JOIN actual_by_op a USING (project_id, order_key, operation_no)
LEFT JOIN latest_evidence e ON e.operation_id = m.idsow
LEFT JOIN update_trend u ON u.operation_id = m.idsow
WHERE m.mapping_rank = 1
  /* status_filter lives in is_visible so Overall Project always uses every canonical operation */
ORDER BY m.project_name, m.order_no, m.operation_no`;

const SUBTASKS_SQL = `
/* manufacturing-subtasks */
WITH latest AS (
  SELECT DISTINCT ON (h.sub_operation_id) h.sub_operation_id, h.issue_description, h.image_path, h.created_at
  FROM public.sow_sub_operation_progress_history h
  WHERE h.operation_id = ANY($1::int[])
  ORDER BY h.sub_operation_id, h.created_at DESC, h.id DESC
)
SELECT s.id, s.operation_id, s.title, s.sort_order, s.standard_hours::float,
       s.progress::float, s.status, l.issue_description AS latest_issue, l.image_path AS latest_image_path,
       l.created_at AS latest_update_at
FROM public.sow_sub_operation s
LEFT JOIN latest l ON l.sub_operation_id = s.id
WHERE s.is_active AND s.operation_id = ANY($1::int[])
ORDER BY s.operation_id, s.sort_order, s.id`;

function parseQuery(query = {}) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);
  const status = String(query.status || "active").toLowerCase();
  const dateFrom = query.date_from ? String(query.date_from) : null;
  const dateTo = query.date_to ? String(query.date_to) : null;
  const health = String(query.health || "").split(",").filter(Boolean).map((value) => value.toLowerCase());
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("page must be >= 1 and limit must be between 1 and 100");
  if (!VALID_STATUS.has(status)) throw new Error("status must be active, completed, or all");
  if ((dateFrom && !DATE_RE.test(dateFrom)) || (dateTo && !DATE_RE.test(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo))
    throw new Error("date_from/date_to must be valid YYYY-MM-DD range");
  if (health.some((value) => !VALID_HEALTH.has(value))) throw new Error("health contains an invalid value");
  return { page, limit, status, dateFrom, dateTo, health, q: String(query.q || "").trim().slice(0, 200) };
}

function createManufacturingOrderProgressController({ pool = defaultPool, cacheTtlMs = 45_000 } = {}) {
  const cache = new Map();
  return async function getManufacturingOrderProgress(req, res) {
    let input;
    try { input = parseQuery(req.query); }
    catch (error) { return res.status(400).json({ error: error.message }); }

    const cacheKey = JSON.stringify(input);
    const cached = cache.get(cacheKey);
    if (req.query.refresh !== "1" && cached && Date.now() - cached.createdAt < cacheTtlMs) {
      res.set("X-Cache", "HIT");
      return res.json(cached.payload);
    }

    try {
      const operationResult = await pool.query(OPERATIONS_SQL, [input.q, input.status, input.dateFrom, input.dateTo]);
      const projects = buildProjects(operationResult.rows, input.health);
      const totalProjects = projects.length;
      const pageProjects = projects.slice((input.page - 1) * input.limit, input.page * input.limit);
      const ids = pageProjects.flatMap((project) => project.units.flatMap((unit) => unit.operations.map((operation) => operation.idsow)));
      const subtaskResult = await pool.query(SUBTASKS_SQL, [ids]);
      attachSubtasks(pageProjects, subtaskResult.rows);
      const summary = { red: 0, yellow: 0, green: 0, unknown: 0 };
      for (const project of projects) summary[project.health]++;
      const payload = {
        data: pageProjects,
        pagination: { page: input.page, limit: input.limit, total_projects: totalProjects },
        summary,
        meta: {
          actual_source: "LOCAL_TIMESHEET_TEMPORARY",
          actual_is_posted: false,
          actual_note: ACTUAL_NOTE,
          generated_at: new Date().toISOString(),
        },
      };
      cache.set(cacheKey, { createdAt: Date.now(), payload });
      res.set("X-Cache", "MISS");
      return res.json(payload);
    } catch (error) {
      console.error("manufacturing-order-progress error:", error);
      return res.status(500).json({ error: error.message });
    }
  };
}

function operationFromRow(row) {
  const mappingConflict = Number(row.mapping_count) > 1;
  const metrics = calculateMetrics({ ...row, progress_pct: row.is_teco ? 100 : row.progress_pct });
  if (mappingConflict) {
    metrics.health = "red";
    metrics.health_note = "Mapping Conflict";
  }
  return {
    idsow: Number(row.idsow), order_no: row.order_no, operation_no: Number(row.operation_no),
    operation_text: row.operation_text, workcenter: row.workcenter, part_number: row.part_number ?? null,
    latest_issue: row.latest_issue ?? null, latest_image_path: row.latest_image_path ?? null,
    mapping_conflict: mappingConflict, update_trend: buildUpdateTrend(row), subtasks: [], ...metrics,
  };
}

function buildProjects(rows, healthFilter) {
  const byProject = new Map();
  for (const row of rows) {
    let project = byProject.get(row.project_id);
    if (!project) {
      project = { project_id: row.project_id, project_name: row.project_name, allRows: [], visibleRows: [] };
      byProject.set(row.project_id, project);
    }
    const operation = operationFromRow(row);
    project.allRows.push({ row, operation });
    if (row.is_visible !== false && (!healthFilter.length || healthFilter.includes(operation.health))) project.visibleRows.push({ row, operation });
  }

  return [...byProject.values()].filter((project) => project.visibleRows.length).map((project) => {
    const groupIdentity = (row) => Number(row.mapping_count) > 1 ? ["mapping-conflict", "Mapping Conflict"] : [row.unit_key || "no-unit", row.unit_name || "No Unit"];
    const allGroups = new Map();
    for (const item of project.allRows) {
      const [key] = groupIdentity(item.row);
      if (!allGroups.has(key)) allGroups.set(key, []);
      allGroups.get(key).push(item.operation);
    }
    const groups = new Map();
    for (const item of project.visibleRows) {
      const [unitKey, unitName] = groupIdentity(item.row);
      if (!groups.has(unitKey)) groups.set(unitKey, { unit_key: unitKey, unit_name: unitName, operations: [] });
      groups.get(unitKey).operations.push(item.operation);
    }
    const units = [...groups.values()].map((unit) => ({
      ...unit, ...rollupMetrics(allGroups.get(unit.unit_key) || unit.operations),
      ...countTrendFlags(allGroups.get(unit.unit_key) || unit.operations),
      operations: unit.operations.sort(compareByConcern),
    })).sort(compareByConcern);
    const allOperations = project.allRows.map((item) => item.operation);
    return {
      project_id: project.project_id, project_name: project.project_name,
      ...rollupMetrics(allOperations), ...countTrendFlags(allOperations), units,
    };
  }).sort(compareByConcern);
}

/** Flag counts so a collapsed project/unit header can show them without expanding. */
function countTrendFlags(operations) {
  return {
    progress_stalled_count: operations.filter((operation) => operation.update_trend?.progress_stalled).length,
    eac_jump_count: operations.filter((operation) => operation.update_trend?.eac_jumped).length,
  };
}

function attachSubtasks(projects, rows) {
  const operations = new Map(projects.flatMap((project) => project.units.flatMap((unit) => unit.operations.map((operation) => [operation.idsow, operation]))));
  for (const row of rows) {
    const operation = operations.get(Number(row.operation_id));
    if (!operation) continue;
    operation.subtasks.push({
      id: Number(row.id), title: row.title, sort_order: Number(row.sort_order),
      standard_hours: row.standard_hours == null ? null : Number(row.standard_hours),
      progress_pct: row.progress == null ? null : Number(row.progress), status: row.status,
      latest_issue: row.latest_issue ?? null, latest_image_path: row.latest_image_path ?? null,
      latest_update_at: row.latest_update_at ?? null,
    });
  }
}

const getManufacturingOrderProgress = createManufacturingOrderProgressController();
module.exports = { ACTUAL_NOTE, OPERATIONS_SQL, SUBTASKS_SQL, parseQuery, buildProjects, createManufacturingOrderProgressController, getManufacturingOrderProgress };
