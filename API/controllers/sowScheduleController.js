const db = global.pool || require("../db");

const MAX_LIMIT = 500;
const PLAN_EXCEEDED_MESSAGE = "Melebihi Standard SOW";
const SUPERVISOR_ROLES = new Set(["supervisor", "administrator"]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    const error = new Error(`${fieldName} must be greater than 0`);
    error.status = 400;
    throw error;
  }
  return number;
}

function toInt(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function clampLimit(value) {
  return Math.min(MAX_LIMIT, Math.max(1, parseInt(value, 10) || 50));
}

function todayDate() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: process.env.TIMEZONE || "Asia/Jakarta",
  });
}

function normalizeDate(value, fieldName = "date") {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error(`${fieldName} must use YYYY-MM-DD`);
    error.status = 400;
    throw error;
  }
  return text;
}

function normalizeTime(value, fieldName = "time") {
  const text = normalizeText(value);
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    const error = new Error(`${fieldName} must use HH:mm or HH:mm:ss`);
    error.status = 400;
    throw error;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) {
    const error = new Error(`${fieldName} is out of range`);
    error.status = 400;
    throw error;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function timeToMinutes(value) {
  const [hour, minute] = normalizeTime(value).split(":").map(Number);
  return hour * 60 + minute;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function buildDateTime(dateText, timeText) {
  return `${dateText} ${normalizeTime(timeText)}`;
}

function formatLocalDateTime(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-") + " " + [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join(":");
}

function addHours(dateTimeText, hours) {
  const date = new Date(String(dateTimeText).replace(" ", "T"));
  date.setMinutes(date.getMinutes() + Math.round(Number(hours || 0) * 60));
  return formatLocalDateTime(date);
}

function diffHours(startDateTime, endDateTime) {
  const start = new Date(String(startDateTime).replace(" ", "T"));
  const end = new Date(String(endDateTime).replace(" ", "T"));
  const hours = (end.getTime() - start.getTime()) / 3600000;
  return Math.round(hours * 100) / 100;
}

function shiftDurationHours(shift) {
  const start = timeToMinutes(shift.start_time);
  let end = timeToMinutes(shift.end_time);
  if (shift.crosses_midnight || end <= start) end += 24 * 60;
  return Math.round(((end - start) / 60) * 100) / 100;
}

function buildShiftWindow(scheduleDate, shift) {
  const date = normalizeDate(scheduleDate, "schedule_date");
  const start = buildDateTime(date, shift.start_time);
  const endDate = shift.crosses_midnight || timeToMinutes(shift.end_time) <= timeToMinutes(shift.start_time)
    ? addDays(date, 1)
    : date;
  const end = buildDateTime(endDate, shift.end_time);
  return { start, end, hours: shiftDurationHours(shift) };
}

function buildOvertimeWindow(overtimeDate, startTime, endTime) {
  const date = normalizeDate(overtimeDate, "overtime_date");
  const start = buildDateTime(date, startTime);
  const endDate = timeToMinutes(endTime) <= timeToMinutes(startTime) ? addDays(date, 1) : date;
  const end = buildDateTime(endDate, endTime);
  const hours = diffHours(start, end);
  if (hours <= 0) {
    const error = new Error("overtime end must be after start");
    error.status = 400;
    throw error;
  }
  return { start, end, hours };
}

function getRequestUser(req) {
  const headers = req && req.headers ? req.headers : {};
  const bodyUser = (req && req.body ? req.body.currentUser || req.body.user : {}) || {};
  return {
    id: toInt(headers["x-user-id"], toInt(bodyUser.id, null)),
    name: normalizeText(headers["x-user-name"] || bodyUser.name || bodyUser.username || (req && req.body ? req.body.requested_by_name : null) || "web"),
    role: normalizeText(headers["x-user-role"] || bodyUser.roles || bodyUser.role || (req && req.body ? req.body.requesterRole : null)),
  };
}

function roleTokens(role) {
  return normalizeText(role)
    .toLowerCase()
    .split(/[,\s/;|]+/)
    .filter(Boolean);
}

function hasSupervisorRole(req) {
  return roleTokens(getRequestUser(req).role).some((role) => SUPERVISOR_ROLES.has(role));
}

function sendError(res, err, fallback = "Request failed") {
  console.error("sowSchedule error:", err);
  res.status(err.status || 500).json({ error: err.message || fallback });
}

async function fetchShift(client, shiftId) {
  const result = await client.query(
    `SELECT id, shift_code, shift_name, start_time::text, end_time::text,
            crosses_midnight, default_capacity_hours
     FROM public.shift_definition
     WHERE id = $1 AND is_active = true`,
    [shiftId]
  );

  if (result.rowCount === 0) {
    const error = new Error("shift_id not found");
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

async function fetchSowActivity(client, payload, required = true) {
  const sowId = toInt(payload.sow_id, null);
  let result;

  if (sowId) {
    result = await client.query("SELECT * FROM public.sow WHERE idsow = $1 LIMIT 1", [sowId]);
  } else {
    const productionOrder = normalizeText(payload.production_order || payload.order_no);
    const operationNo = toInt(payload.operation_no, null);
    if (!productionOrder || operationNo == null) {
      if (!required) return null;
      const error = new Error("sow_id or production_order + operation_no is required");
      error.status = 400;
      throw error;
    }

    result = await client.query(
      `SELECT *
       FROM public.sow
       WHERE ltrim(order_no, '0') = ltrim($1, '0')
         AND operation_no = $2
       ORDER BY idsow DESC
       LIMIT 1`,
      [productionOrder, operationNo]
    );
  }

  if (result.rowCount === 0 && required) {
    const error = new Error("SOW activity not found");
    error.status = 404;
    throw error;
  }

  return result.rows[0] || null;
}

function resolveActivityFields(sow, payload) {
  return {
    sow_id: toInt(payload.sow_id, sow?.idsow || null),
    production_order: normalizeText(payload.production_order || payload.order_no || sow?.order_no) || null,
    operation_no: toInt(payload.operation_no, sow?.operation_no ?? null),
    sequence: toInt(payload.sequence, null),
    ssbr_id: normalizeText(payload.ssbr_id || sow?.ssbr_id) || null,
    workcenter: normalizeText(payload.workcenter || sow?.workcenter || sow?.wct_group) || null,
    original_planhours: toNumber(sow?.planhours, 0),
  };
}

async function getUsedNormalHours(client, { machineCode, scheduleDate, shiftId, excludeScheduleId = null }) {
  const params = [machineCode, scheduleDate, shiftId];
  let excludeSql = "";
  if (excludeScheduleId) {
    params.push(excludeScheduleId);
    excludeSql = `AND id <> $${params.length}`;
  }

  const result = await client.query(
    `WITH unbatched AS (
       SELECT COALESCE(SUM(planned_hours), 0)::numeric AS hours
       FROM public.sow_schedule
       WHERE machine_code = $1
         AND schedule_date = $2
         AND shift_id = $3
         AND schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
         AND is_overtime = false
         AND batch_id IS NULL
         ${excludeSql}
     ),
     batches AS (
       SELECT COALESCE(SUM(batch_capacity_hours), 0)::numeric AS hours
       FROM public.sow_schedule_batch
       WHERE machine_code = $1
         AND schedule_date = $2
         AND shift_id = $3
         AND batch_status <> 'CANCELLED'
     )
     SELECT (unbatched.hours + batches.hours)::numeric AS used_hours
     FROM unbatched, batches`,
    params
  );

  return toNumber(result.rows[0]?.used_hours, 0);
}

async function fetchBatch(client, batchId, required = false) {
  const id = toInt(batchId, null);
  if (!id) {
    if (!required) return null;
    const error = new Error("valid batch_id is required");
    error.status = 400;
    throw error;
  }

  const result = await client.query(
    `SELECT *
     FROM public.sow_schedule_batch
     WHERE id = $1
       AND batch_status <> 'CANCELLED'
     LIMIT 1`,
    [id]
  );

  if (result.rowCount === 0 && required) {
    const error = new Error("batch not found");
    error.status = 404;
    throw error;
  }

  return result.rows[0] || null;
}

async function getBatchUsedHours(client, batchId) {
  const result = await client.query(
    `SELECT COALESCE(SUM(planned_hours), 0)::numeric AS used_hours
     FROM public.sow_schedule
     WHERE batch_id = $1
       AND schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')`,
    [batchId]
  );
  return toNumber(result.rows[0]?.used_hours, 0);
}

async function getCapacityForSlot(client, { machineCode, scheduleDate, shiftId }) {
  const result = await client.query(
    `SELECT
       sd.id AS shift_id,
       sd.default_capacity_hours,
       cap.capacity_type,
       cap.base_capacity_hours,
       cap.manpower_count,
       cap.capacity_multiplier,
       cap.total_capacity_hours,
       wc.workcenter_description AS machine_name,
       wc.workcenternew AS default_workcenter
     FROM public.shift_definition sd
     LEFT JOIN public.sow_machine_capacity cap
       ON cap.shift_id = sd.id
      AND cap.machine_code = $1
      AND cap.schedule_date = $2
      AND cap.is_active = true
     LEFT JOIN public.workcenter wc
       ON wc.machineid = $1
     WHERE sd.id = $3`,
    [machineCode, scheduleDate, shiftId]
  );

  if (result.rowCount === 0) {
    const error = new Error("shift_id not found");
    error.status = 404;
    throw error;
  }

  const row = result.rows[0];
  return {
    ...row,
    total_capacity_hours: toNumber(row.total_capacity_hours, toNumber(row.default_capacity_hours, 0)),
  };
}

async function getNextQueueNo(client, { machineCode, scheduleDate, shiftId }) {
  const result = await client.query(
    `SELECT COALESCE(MAX(planned_queue_no), 0)::int + 1 AS next_queue
     FROM public.sow_schedule
     WHERE machine_code = $1
       AND schedule_date = $2
       AND shift_id = $3
       AND schedule_status <> 'CANCELLED'`,
    [machineCode, scheduleDate, shiftId]
  );
  return result.rows[0]?.next_queue || 1;
}

async function getTotalPlannedForActivity(client, fields) {
  const params = [fields.sow_id, fields.production_order, fields.operation_no];
  const result = await client.query(
    `WITH normal AS (
       SELECT COALESCE(SUM(planned_hours), 0) AS hours
       FROM public.sow_schedule
       WHERE schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
         AND is_overtime = false
         AND (
           ($1::int IS NOT NULL AND sow_id = $1)
           OR ($2::text IS NOT NULL AND production_order = $2 AND operation_no = $3)
         )
     ),
     overtime AS (
       SELECT COALESCE(SUM(overtime_hours), 0) AS hours
       FROM public.sow_overtime_request
       WHERE request_status IN ('PENDING', 'APPROVED')
         AND (
           ($1::int IS NOT NULL AND sow_id = $1)
           OR ($2::text IS NOT NULL AND production_order = $2 AND operation_no = $3)
         )
     )
     SELECT (normal.hours + overtime.hours)::numeric AS total_hours
     FROM normal, overtime`,
    params
  );
  return toNumber(result.rows[0]?.total_hours, 0);
}

function warningForPlanhours(totalHours, originalPlanhours) {
  if (Number(originalPlanhours) > 0 && Number(totalHours) > Number(originalPlanhours)) {
    return { warning_flag: true, warning_message: PLAN_EXCEEDED_MESSAGE };
  }
  return { warning_flag: false, warning_message: null };
}

function calculateCapacityTotal(payload, shiftDefaultHours) {
  const capacityType = normalizeText(payload.capacity_type || "STANDARD").toUpperCase();
  const baseCapacity = toNumber(payload.base_capacity_hours, toNumber(payload.total_capacity_hours, shiftDefaultHours));
  const manpowerCount = Math.max(0, toNumber(payload.manpower_count, 1));
  const multiplier = Math.max(0, toNumber(payload.capacity_multiplier, 1));
  const explicitTotal = toNumber(payload.total_capacity_hours, NaN);

  if (capacityType === "MANPOWER_BASED") return baseCapacity * manpowerCount;
  if (capacityType === "BATCH_BASED") return baseCapacity * multiplier;
  if (capacityType === "CUSTOM" && Number.isFinite(explicitTotal)) return explicitTotal;
  if (Number.isFinite(explicitTotal) && explicitTotal > 0) return explicitTotal;
  return baseCapacity;
}

function buildReportFilters(query, startParamIndex = 1) {
  const filters = [];
  const params = [];
  let index = startParamIndex;

  if (query.date_from) {
    params.push(normalizeDate(query.date_from, "date_from"));
    filters.push(`schedule_date >= $${index++}`);
  }
  if (query.date_to) {
    params.push(normalizeDate(query.date_to, "date_to"));
    filters.push(`schedule_date <= $${index++}`);
  }
  if (query.date) {
    params.push(normalizeDate(query.date, "date"));
    filters.push(`schedule_date = $${index++}`);
  }
  if (query.machine_code) {
    params.push(normalizeText(query.machine_code));
    filters.push(`machine_code = $${index++}`);
  }
  if (query.shift_id) {
    params.push(toInt(query.shift_id));
    filters.push(`shift_id = $${index++}`);
  }
  if (query.production_order) {
    params.push(normalizeText(query.production_order));
    filters.push(`production_order = $${index++}`);
  }

  return { filters, params, nextIndex: index };
}

async function queryReportView(req, res, viewName, orderBy) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = clampLimit(req.query.limit);
    const offset = (page - 1) * limit;
    const { filters, params, nextIndex } = buildReportFilters(req.query);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM public.${viewName} ${where}`,
      params
    );

    const dataParams = [...params, limit, offset];
    const dataResult = await db.query(
      `SELECT *
       FROM public.${viewName}
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
      dataParams
    );

    res.json({
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.max(1, Math.ceil((countResult.rows[0]?.total || 0) / limit)),
      },
    });
  } catch (err) {
    sendError(res, err);
  }
}

exports.getShifts = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, shift_code, shift_name, start_time::text, end_time::text,
              crosses_midnight, default_capacity_hours, is_active
       FROM public.shift_definition
       WHERE ($1::boolean IS false OR is_active = true)
       ORDER BY start_time, id`,
      [String(req.query.includeInactive || "").toLowerCase() !== "true"]
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getMachines = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         machineid AS machine_code,
         workcenter_description AS machine_name,
         workcenternew AS workcenter,
         workcenterot,
         workcenterold,
         groupname,
         categoryhours,
         position
       FROM public.workcenter
       WHERE machineid IS NOT NULL AND trim(machineid) <> ''
       ORDER BY position NULLS LAST, machineid ASC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getSowActivities = async (req, res) => {
  const search = normalizeText(req.query.search);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = clampLimit(req.query.limit);
  const offset = (page - 1) * limit;
  const params = [];
  const workcenterJoin = `
    LEFT JOIN LATERAL (
      SELECT w.machineid, w.workcenter_description
      FROM public.workcenter w
      WHERE w.machineid = s.workcenter
         OR w.workcenternew = s.workcenter
         OR w.workcenterold = s.workcenter
         OR w.workcenterot = s.workcenter
         OR w.workcenternew = s.wct_group
      ORDER BY w.position NULLS LAST, w.machineid
      LIMIT 1
    ) wc ON true
  `;
  let where = `
    WHERE s.order_no IS NOT NULL
      AND trim(s.order_no) <> ''
      AND s.operation_no IS NOT NULL
  `;

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += `
      AND (
        lower(coalesce(s.order_no, '')) LIKE $${params.length}
        OR lower(coalesce(s.ssbr_id, '')) LIKE $${params.length}
        OR lower(coalesce(s.part_name, '')) LIKE $${params.length}
        OR lower(coalesce(s.operation_text, '')) LIKE $${params.length}
        OR lower(coalesce(s.workcenter, '')) LIKE $${params.length}
        OR lower(coalesce(s.operation_no::text, '')) LIKE $${params.length}
        OR lower(coalesce(wc.machineid, '')) LIKE $${params.length}
        OR lower(coalesce(wc.workcenter_description, '')) LIKE $${params.length}
      )
    `;
  }

  try {
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM public.sow s ${workcenterJoin} ${where}`, params);
    const queryParams = [...params, limit, offset];
    const result = await db.query(
      `WITH schedule_totals AS (
         SELECT
           sow_id,
           production_order,
           operation_no,
           SUM(planned_hours) FILTER (WHERE schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED') AND is_overtime = false) AS scheduled_hours,
           SUM(planned_hours) FILTER (WHERE schedule_status = 'UNPLANNED') AS unplanned_hours
         FROM public.sow_schedule
         WHERE schedule_status <> 'CANCELLED'
         GROUP BY sow_id, production_order, operation_no
       ),
       overtime_totals AS (
         SELECT
           sow_id,
           production_order,
           operation_no,
           SUM(overtime_hours) FILTER (WHERE request_status = 'PENDING') AS pending_overtime_hours,
           SUM(overtime_hours) FILTER (WHERE request_status = 'APPROVED') AS approved_overtime_hours
         FROM public.sow_overtime_request
         WHERE request_status <> 'CANCELLED'
         GROUP BY sow_id, production_order, operation_no
       )
       SELECT
         s.idsow,
         s.order_no,
         s.operation_no,
         s.ssbr_id,
         s.part_name,
         s.part_number,
         s.model,
         s.operation_text,
         s.wct_group,
         s.workcenter,
         wc.machineid AS machine_code,
         wc.workcenter_description AS machine_name,
         s.status,
         COALESCE(s.planhours, 0)::numeric AS planhours,
         COALESCE(st.scheduled_hours, st_key.scheduled_hours, 0)::numeric(10,2) AS scheduled_hours,
         COALESCE(st.unplanned_hours, st_key.unplanned_hours, 0)::numeric(10,2) AS unplanned_hours,
         COALESCE(ot.pending_overtime_hours, ot_key.pending_overtime_hours, 0)::numeric(10,2) AS pending_overtime_hours,
         COALESCE(ot.approved_overtime_hours, ot_key.approved_overtime_hours, 0)::numeric(10,2) AS approved_overtime_hours,
         GREATEST(
           COALESCE(s.planhours, 0)
           - COALESCE(st.scheduled_hours, st_key.scheduled_hours, 0)
           - COALESCE(ot.approved_overtime_hours, ot_key.approved_overtime_hours, 0),
           0
         )::numeric(10,2) AS remaining_hours
       FROM public.sow s
       LEFT JOIN schedule_totals st ON st.sow_id = s.idsow
       LEFT JOIN schedule_totals st_key
         ON st_key.production_order = s.order_no
        AND st_key.operation_no = s.operation_no
        AND st_key.sow_id IS NULL
       LEFT JOIN overtime_totals ot ON ot.sow_id = s.idsow
       LEFT JOIN overtime_totals ot_key
         ON ot_key.production_order = s.order_no
        AND ot_key.operation_no = s.operation_no
        AND ot_key.sow_id IS NULL
       ${workcenterJoin}
       ${where}
       ORDER BY s.idsow DESC
       LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
      queryParams
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.max(1, Math.ceil((countResult.rows[0]?.total || 0) / limit)),
      },
    });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getBatches = async (req, res) => {
  const scheduleDate = req.query.date ? normalizeDate(req.query.date, "date") : null;
  const machineCode = normalizeText(req.query.machine_code);
  const shiftId = toInt(req.query.shift_id, null);
  const params = [];
  const filters = ["b.batch_status <> 'CANCELLED'"];

  if (scheduleDate) {
    params.push(scheduleDate);
    filters.push(`b.schedule_date = $${params.length}`);
  }
  if (machineCode) {
    params.push(machineCode);
    filters.push(`b.machine_code = $${params.length}`);
  }
  if (shiftId) {
    params.push(shiftId);
    filters.push(`b.shift_id = $${params.length}`);
  }

  try {
    const result = await db.query(
      `SELECT
         b.*,
         sd.shift_name,
         COALESCE(SUM(sc.planned_hours) FILTER (
           WHERE sc.schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
         ), 0)::numeric(10,2) AS used_inside_hours,
         GREATEST(
           b.batch_capacity_hours - COALESCE(SUM(sc.planned_hours) FILTER (
             WHERE sc.schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
           ), 0),
           0
         )::numeric(10,2) AS remaining_inside_hours,
         COUNT(sc.id) FILTER (WHERE sc.schedule_status <> 'CANCELLED')::int AS operation_count
       FROM public.sow_schedule_batch b
       LEFT JOIN public.shift_definition sd ON sd.id = b.shift_id
       LEFT JOIN public.sow_schedule sc ON sc.batch_id = b.id
       WHERE ${filters.join(" AND ")}
       GROUP BY b.id, sd.shift_name
       ORDER BY b.created_at DESC, b.id DESC`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.createBatch = async (req, res) => {
  const payload = req.body || {};
  const machineCode = normalizeText(payload.machine_code);
  const scheduleDate = normalizeDate(payload.schedule_date || payload.date, "schedule_date");
  const shiftId = toInt(payload.shift_id, null);
  const batchCapacityHours = toPositiveNumber(payload.batch_capacity_hours ?? payload.capacity_hours, "batch_capacity_hours");

  if (!machineCode || !shiftId) {
    return res.status(400).json({ error: "machine_code, schedule_date, shift_id, and batch_capacity_hours are required" });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await fetchShift(client, shiftId);
    const usedHours = await getUsedNormalHours(client, { machineCode, scheduleDate, shiftId });
    const capacity = await getCapacityForSlot(client, { machineCode, scheduleDate, shiftId });
    const availableHours = Math.max(toNumber(capacity.total_capacity_hours, 0) - usedHours, 0);

    if (batchCapacityHours > availableHours) {
      const error = new Error("batch capacity exceeds remaining machine capacity");
      error.status = 409;
      throw error;
    }

    const machine = await client.query(
      `SELECT workcenternew
       FROM public.workcenter
       WHERE machineid = $1
       LIMIT 1`,
      [machineCode]
    );
    const user = getRequestUser(req);
    const codeResult = await client.query("SELECT nextval('public.sow_schedule_batch_id_seq')::bigint AS next_id");
    const nextId = codeResult.rows[0]?.next_id;
    const batchCode = normalizeText(payload.batch_code)
      || `BATCH-${scheduleDate.replace(/-/g, "")}-${machineCode}-${String(nextId).padStart(4, "0")}`;

    const result = await client.query(
      `INSERT INTO public.sow_schedule_batch (
         id, batch_code, machine_code, workcenter, schedule_date, shift_id,
         batch_capacity_hours, batch_status, remarks, created_by_user_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9)
       RETURNING *`,
      [
        nextId,
        batchCode,
        machineCode,
        normalizeText(payload.workcenter || machine.rows[0]?.workcenternew) || null,
        scheduleDate,
        shiftId,
        batchCapacityHours,
        normalizeText(payload.remarks) || null,
        user.id,
      ]
    );

    await client.query("COMMIT");
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.deleteBatch = async (req, res) => {
  const batchId = toInt(req.params.id, null);
  if (!batchId) return res.status(400).json({ error: "valid batch id required" });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const batch = await fetchBatch(client, batchId, true);
    // Move all schedules out of the batch
    await client.query(
      `UPDATE public.sow_schedule SET batch_id = NULL WHERE batch_id = $1`,
      [batchId]
    );
    // Cancel the batch
    await client.query(
      `UPDATE public.sow_schedule_batch SET batch_status = 'CANCELLED' WHERE id = $1`,
      [batchId]
    );
    await client.query("COMMIT");
    res.json({ data: { id: batchId, deleted: true } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.getManpower = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT snssb, full_name, employee_category
       FROM usernfc
       WHERE full_name IS NOT NULL AND full_name <> ''
       ORDER BY full_name`
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getSchedules = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = clampLimit(req.query.limit);
  const offset = (page - 1) * limit;
  const params = [];
  const filters = ["1=1"];

  if (req.query.date) {
    params.push(normalizeDate(req.query.date, "date"));
    filters.push(`sc.schedule_date = $${params.length}`);
  }
  if (req.query.date_from) {
    params.push(normalizeDate(req.query.date_from, "date_from"));
    filters.push(`sc.schedule_date >= $${params.length}`);
  }
  if (req.query.date_to) {
    params.push(normalizeDate(req.query.date_to, "date_to"));
    filters.push(`sc.schedule_date <= $${params.length}`);
  }
  if (req.query.machine_code) {
    params.push(normalizeText(req.query.machine_code));
    filters.push(`sc.machine_code = $${params.length}`);
  }
  if (req.query.shift_id) {
    params.push(toInt(req.query.shift_id));
    filters.push(`sc.shift_id = $${params.length}`);
  }
  if (req.query.status) {
    params.push(normalizeText(req.query.status).toUpperCase());
    filters.push(`sc.schedule_status = $${params.length}`);
  }

  const where = `WHERE ${filters.join(" AND ")}`;

  try {
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM public.sow_schedule sc ${where}`, params);
    const dataParams = [...params, limit, offset];
    const result = await db.query(
      `SELECT
         sc.*,
         sd.shift_code,
         sd.shift_name,
         s.part_name,
         s.part_number,
         s.model,
         s.operation_text,
         s.planhours AS original_planhours,
         b.batch_code,
         b.batch_capacity_hours,
         b.batch_status
       FROM public.sow_schedule sc
       LEFT JOIN public.shift_definition sd ON sd.id = sc.shift_id
       LEFT JOIN public.sow s ON s.idsow = sc.sow_id
       LEFT JOIN public.sow_schedule_batch b ON b.id = sc.batch_id
       ${where}
       ORDER BY sc.schedule_date, sd.start_time, sc.machine_code, sc.planned_queue_no NULLS LAST, sc.id
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.max(1, Math.ceil((countResult.rows[0]?.total || 0) / limit)),
      },
    });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getPlannedSchedules = (req, res) => {
  req.query.status = req.query.status || "PLANNED";
  return exports.getSchedules(req, res);
};

exports.getUnplannedSchedules = (req, res) => {
  req.query.status = "UNPLANNED";
  return exports.getSchedules(req, res);
};

exports.getCapacity = async (req, res) => {
  const scheduleDate = normalizeDate(req.query.date || todayDate(), "date");
  const params = [scheduleDate];
  const machineFilter = normalizeText(req.query.machine_code);
  const shiftFilter = toInt(req.query.shift_id, null);

  let machineWhere = "";
  if (machineFilter) {
    params.push(machineFilter);
    machineWhere = `AND w.machineid = $${params.length}`;
  }

  let shiftWhere = "sd.is_active = true";
  if (shiftFilter) {
    params.push(shiftFilter);
    shiftWhere += ` AND sd.id = $${params.length}`;
  }

  try {
    const result = await db.query(
      `WITH machines AS (
         SELECT
           w.machineid AS machine_code,
           w.workcenter_description AS machine_name,
           w.workcenternew AS workcenter,
           w.groupname,
           w.categoryhours,
           w.position
         FROM public.workcenter w
         WHERE w.machineid IS NOT NULL AND trim(w.machineid) <> ''
           ${machineWhere}
       )
       SELECT
         $1::date AS schedule_date,
         sd.id AS shift_id,
         sd.shift_code,
         sd.shift_name,
         m.machine_code,
         m.machine_name,
         COALESCE(cap.workcenter, m.workcenter) AS workcenter,
         COALESCE(cap.capacity_type, 'STANDARD') AS capacity_type,
         COALESCE(cap.base_capacity_hours, sd.default_capacity_hours)::numeric(10,2) AS base_capacity_hours,
         COALESCE(cap.manpower_count, 1)::numeric(10,2) AS manpower_count,
         COALESCE(cap.capacity_multiplier, 1)::numeric(10,2) AS capacity_multiplier,
         COALESCE(NULLIF(cap.total_capacity_hours, 0), sd.default_capacity_hours, 0)::numeric(10,2) AS total_capacity_hours,
         COALESCE(v.used_normal_planned_hours, 0)::numeric(10,2) AS used_normal_planned_hours,
         GREATEST(
           COALESCE(NULLIF(cap.total_capacity_hours, 0), sd.default_capacity_hours, 0)
           - COALESCE(v.used_normal_planned_hours, 0),
           0
         )::numeric(10,2) AS remaining_capacity_hours,
         COALESCE(v.unplanned_hours, 0)::numeric(10,2) AS unplanned_hours,
         COALESCE(v.pending_overtime_hours, 0)::numeric(10,2) AS pending_overtime_hours,
         COALESCE(v.approved_overtime_hours, 0)::numeric(10,2) AS approved_overtime_hours,
         cap.remarks,
         m.groupname,
         m.categoryhours
       FROM machines m
       CROSS JOIN public.shift_definition sd
       LEFT JOIN public.sow_machine_capacity cap
         ON cap.machine_code = m.machine_code
        AND cap.schedule_date = $1
        AND cap.shift_id = sd.id
        AND cap.is_active = true
       LEFT JOIN LATERAL (
         WITH unbatched AS (
           SELECT COALESCE(SUM(sc.planned_hours), 0)::numeric AS used_hours
           FROM public.sow_schedule sc
           WHERE sc.machine_code = m.machine_code
             AND sc.schedule_date = $1
             AND sc.shift_id = sd.id
             AND sc.schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
             AND sc.is_overtime = false
             AND sc.batch_id IS NULL
         ),
         batches AS (
           SELECT COALESCE(SUM(b.batch_capacity_hours), 0)::numeric AS used_hours
           FROM public.sow_schedule_batch b
           WHERE b.machine_code = m.machine_code
             AND b.schedule_date = $1
             AND b.shift_id = sd.id
             AND b.batch_status <> 'CANCELLED'
         ),
         unplanned AS (
           SELECT COALESCE(SUM(sc.planned_hours), 0)::numeric AS hours
           FROM public.sow_schedule sc
           WHERE sc.machine_code = m.machine_code
             AND sc.schedule_date = $1
             AND sc.shift_id = sd.id
             AND sc.schedule_status = 'UNPLANNED'
         ),
         overtime AS (
           SELECT
             COALESCE(SUM(ot.overtime_hours) FILTER (WHERE ot.request_status = 'PENDING'), 0)::numeric AS pending_hours,
             COALESCE(SUM(ot.overtime_hours) FILTER (WHERE ot.request_status = 'APPROVED'), 0)::numeric AS approved_hours
           FROM public.sow_overtime_request ot
           WHERE ot.machine_code = m.machine_code
             AND ot.overtime_date = $1
             AND ot.shift_id = sd.id
             AND ot.request_status <> 'CANCELLED'
         )
         SELECT
           (unbatched.used_hours + batches.used_hours)::numeric AS used_normal_planned_hours,
           unplanned.hours AS unplanned_hours,
           overtime.pending_hours AS pending_overtime_hours,
           overtime.approved_hours AS approved_overtime_hours
         FROM unbatched, batches, unplanned, overtime
       ) v ON true
       WHERE ${shiftWhere}
       ORDER BY m.position NULLS LAST, m.machine_code, sd.start_time`,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.upsertCapacity = async (req, res) => {
  const payload = req.body || {};
  const machineCode = normalizeText(payload.machine_code);
  const scheduleDate = normalizeDate(payload.schedule_date || payload.date, "schedule_date");
  const shiftId = toInt(payload.shift_id, null);

  if (!machineCode || !shiftId) {
    return res.status(400).json({ error: "machine_code, schedule_date, and shift_id are required" });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const shift = await fetchShift(client, shiftId);
    const totalCapacity = calculateCapacityTotal(payload, toNumber(shift.default_capacity_hours, 8));
    const capacityType = normalizeText(payload.capacity_type || "STANDARD").toUpperCase();

    const machine = await client.query(
      `SELECT workcenter_description, workcenternew
       FROM public.workcenter
       WHERE machineid = $1
       LIMIT 1`,
      [machineCode]
    );

    const result = await client.query(
      `INSERT INTO public.sow_machine_capacity (
         machine_code,
         machine_name,
         workcenter,
         schedule_date,
         shift_id,
         capacity_type,
         base_capacity_hours,
         manpower_count,
         capacity_multiplier,
         total_capacity_hours,
         remarks,
         is_active
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
       ON CONFLICT (machine_code, schedule_date, shift_id)
       DO UPDATE SET
         machine_name = EXCLUDED.machine_name,
         workcenter = EXCLUDED.workcenter,
         capacity_type = EXCLUDED.capacity_type,
         base_capacity_hours = EXCLUDED.base_capacity_hours,
         manpower_count = EXCLUDED.manpower_count,
         capacity_multiplier = EXCLUDED.capacity_multiplier,
         total_capacity_hours = EXCLUDED.total_capacity_hours,
         remarks = EXCLUDED.remarks,
         is_active = true
       RETURNING *`,
      [
        machineCode,
        normalizeText(payload.machine_name || machine.rows[0]?.workcenter_description) || null,
        normalizeText(payload.workcenter || machine.rows[0]?.workcenternew) || null,
        scheduleDate,
        shiftId,
        capacityType,
        toNumber(payload.base_capacity_hours, toNumber(payload.total_capacity_hours, shift.default_capacity_hours)),
        toNumber(payload.manpower_count, 1),
        toNumber(payload.capacity_multiplier, 1),
        totalCapacity,
        normalizeText(payload.remarks) || null,
      ]
    );

    await client.query("COMMIT");
    res.json({ data: result.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.createSchedule = async (req, res) => {
  const payload = req.body || {};
  const machineCode = normalizeText(payload.machine_code);
  const scheduleDate = normalizeDate(payload.schedule_date || payload.date, "schedule_date");
  const shiftId = toInt(payload.shift_id, null);
  const requestedHours = toPositiveNumber(payload.planned_hours ?? payload.hours, "planned_hours");

  if (!machineCode || !shiftId) {
    return res.status(400).json({ error: "machine_code, schedule_date, shift_id, and planned_hours are required" });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const shift = await fetchShift(client, shiftId);
    const sow = await fetchSowActivity(client, payload, normalizeText(payload.schedule_source_type || "SOW").toUpperCase() !== "MANUAL");
    const fields = resolveActivityFields(sow, payload);
    if (!fields.production_order || fields.operation_no == null) {
      const error = new Error("production_order and operation_no are required");
      error.status = 400;
      throw error;
    }

    const capacity = await getCapacityForSlot(client, { machineCode, scheduleDate, shiftId });
    const batch = await fetchBatch(client, payload.batch_id, false);
    if (batch) {
      if (batch.machine_code !== machineCode || String(batch.schedule_date).slice(0, 10) !== scheduleDate || Number(batch.shift_id) !== Number(shiftId)) {
        const error = new Error("batch must match machine, schedule_date, and shift_id");
        error.status = 400;
        throw error;
      }
      // Replace any existing schedule with the same production_order in this batch
      if (fields.production_order) {
        await client.query(
          `DELETE FROM public.sow_schedule
           WHERE batch_id = $1
             AND production_order = $2
             AND schedule_status IN ('PLANNED', 'PARTIAL')`,
          [batch.id, fields.production_order]
        );
      }
    }
    const usedHours = await getUsedNormalHours(client, { machineCode, scheduleDate, shiftId });
    const availableHours = Math.max(toNumber(capacity.total_capacity_hours, 0) - usedHours, 0);
    let plannedHours = Math.min(requestedHours, availableHours);
    // Batch caps per-activity hours but doesn't limit total batch usage
    if (batch && plannedHours > toNumber(batch.batch_capacity_hours, 0)) {
      plannedHours = toNumber(batch.batch_capacity_hours, 0);
    }
    const unplannedHours = Math.max(requestedHours - plannedHours, 0);
    const inserted = [];
    const user = getRequestUser(req);
    const queueNo = toInt(payload.planned_queue_no, await getNextQueueNo(client, { machineCode, scheduleDate, shiftId }));
    const totalAfter = await getTotalPlannedForActivity(client, fields);
    const warning = warningForPlanhours(totalAfter + plannedHours + unplannedHours, fields.original_planhours);

    if (plannedHours > 0) {
      const shiftWindow = buildShiftWindow(scheduleDate, shift);
      const offset = Math.min(usedHours, shiftWindow.hours);
      const plannedStart = addHours(shiftWindow.start, offset);
      const plannedEnd = addHours(plannedStart, Math.min(plannedHours, Math.max(shiftWindow.hours - offset, 0)) || plannedHours);
      const status = unplannedHours > 0 ? "PARTIAL" : "PLANNED";

      const result = await client.query(
        `INSERT INTO public.sow_schedule (
           sow_id, production_order, operation_no, sequence, ssbr_id, workcenter,
           machine_code, schedule_date, shift_id, planned_start_datetime, planned_end_datetime,
           planned_hours, planned_queue_no, priority_no, schedule_status, schedule_source_type,
           batch_id, warning_flag, warning_message, remarks, created_by_user_id, created_by_name
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING *`,
        [
          fields.sow_id,
          fields.production_order,
          fields.operation_no,
          fields.sequence,
          fields.ssbr_id,
          normalizeText(payload.workcenter || fields.workcenter || capacity.default_workcenter) || null,
          machineCode,
          scheduleDate,
          shiftId,
          plannedStart,
          plannedEnd,
          plannedHours,
          queueNo,
          toInt(payload.priority_no, queueNo),
          status,
          normalizeText(payload.schedule_source_type || "SOW").toUpperCase() === "MANUAL" ? "MANUAL" : "SOW",
          batch?.id || null,
          warning.warning_flag,
          warning.warning_message,
          normalizeText(payload.remarks) || null,
          user.id,
          user.name,
        ]
      );
      inserted.push(result.rows[0]);
    }

    if (unplannedHours > 0) {
      const result = await client.query(
        `INSERT INTO public.sow_schedule (
           sow_id, production_order, operation_no, sequence, ssbr_id, workcenter,
           machine_code, schedule_date, shift_id, planned_hours, planned_queue_no,
           priority_no, schedule_status, schedule_source_type, warning_flag,
           warning_message, remarks, created_by_user_id, created_by_name
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'UNPLANNED',$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          fields.sow_id,
          fields.production_order,
          fields.operation_no,
          fields.sequence,
          fields.ssbr_id,
          normalizeText(payload.workcenter || fields.workcenter || capacity.default_workcenter) || null,
          machineCode,
          scheduleDate,
          shiftId,
          unplannedHours,
          queueNo + inserted.length,
          toInt(payload.priority_no, queueNo) + inserted.length,
          normalizeText(payload.schedule_source_type || "SOW").toUpperCase() === "MANUAL" ? "MANUAL" : "SOW",
          warning.warning_flag,
          warning.warning_message || "Over.",
          normalizeText(payload.remarks) || null,
          user.id,
          user.name,
        ]
      );
      inserted.push(result.rows[0]);
    }

    await client.query("COMMIT");
    res.status(201).json({
      data: inserted,
      capacity: {
        total_capacity_hours: capacity.total_capacity_hours,
        used_normal_planned_hours: usedHours,
        available_before_save: availableHours,
      },
      warning,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.updateSchedule = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: "valid schedule id is required" });

  const allowed = [
    "machine_code",
    "workcenter",
    "schedule_date",
    "shift_id",
    "planned_start_datetime",
    "planned_end_datetime",
    "planned_hours",
    "planned_queue_no",
    "priority_no",
    "schedule_status",
    "batch_id",
    "remarks",
  ];

  const sets = [];
  const params = [];
  allowed.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
      params.push(req.body[field] === "" ? null : req.body[field]);
      sets.push(`${field} = $${params.length}`);
    }
  });

  if (sets.length === 0) return res.status(400).json({ error: "no fields to update" });

  params.push(id);
  try {
    const result = await db.query(
      `UPDATE public.sow_schedule
       SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "schedule not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.deleteSchedule = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: "valid schedule id is required" });

  try {
    const result = await db.query("DELETE FROM public.sow_schedule WHERE id = $1 RETURNING id", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "schedule not found" });
    res.json({ deleted: true });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getOvertime = async (req, res) => {
  req.query.date_from = req.query.date_from || req.query.from;
  req.query.date_to = req.query.date_to || req.query.to;
  return queryReportView(req, res, "vw_sow_overtime_summary", "overtime_date DESC, created_at DESC, id DESC");
};

exports.createOvertime = async (req, res) => {
  const payload = req.body || {};
  const machineCode = normalizeText(payload.machine_code);
  const overtimeDate = normalizeDate(payload.overtime_date || payload.date, "overtime_date");
  const shiftId = toInt(payload.shift_id, null);
  const startTime = normalizeTime(payload.start_time || payload.overtime_start_time, "start_time");
  const endTime = normalizeTime(payload.end_time || payload.overtime_end_time, "end_time");

  if (!machineCode || !shiftId) {
    return res.status(400).json({ error: "machine_code, overtime_date, shift_id, start_time, and end_time are required" });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await fetchShift(client, shiftId);
    const sow = await fetchSowActivity(client, payload, true);
    const fields = resolveActivityFields(sow, payload);
    const window = buildOvertimeWindow(overtimeDate, startTime, endTime);
    const totalAfter = await getTotalPlannedForActivity(client, fields);
    const warning = warningForPlanhours(totalAfter + window.hours, fields.original_planhours);
    const user = getRequestUser(req);

    const result = await client.query(
      `INSERT INTO public.sow_overtime_request (
         sow_id, production_order, operation_no, sequence, ssbr_id, workcenter, machine_code,
         overtime_date, shift_id, overtime_start_datetime, overtime_end_datetime, overtime_hours,
         note, request_status, requested_by_user_id, requested_by_name, warning_flag, warning_message
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDING',$14,$15,$16,$17)
       RETURNING *`,
      [
        fields.sow_id,
        fields.production_order,
        fields.operation_no,
        fields.sequence,
        fields.ssbr_id,
        normalizeText(payload.workcenter || fields.workcenter) || null,
        machineCode,
        overtimeDate,
        shiftId,
        window.start,
        window.end,
        window.hours,
        normalizeText(payload.note || payload.reason) || null,
        user.id,
        user.name,
        warning.warning_flag,
        warning.warning_message,
      ]
    );

    await client.query("COMMIT");
    res.status(201).json({ data: result.rows[0], warning });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.updateOvertime = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: "valid overtime id is required" });

  const allowed = ["note", "request_status", "machine_code", "workcenter"];
  const sets = [];
  const params = [];
  allowed.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
      params.push(req.body[field] === "" ? null : req.body[field]);
      sets.push(`${field} = $${params.length}`);
    }
  });
  if (sets.length === 0) return res.status(400).json({ error: "no fields to update" });

  params.push(id);
  try {
    const result = await db.query(
      `UPDATE public.sow_overtime_request
       SET ${sets.join(", ")}
       WHERE id = $${params.length}
         AND request_status = 'PENDING'
       RETURNING *`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "pending overtime not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.approveOvertime = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: "valid overtime id is required" });
  if (!hasSupervisorRole(req)) return res.status(403).json({ error: "Only supervisor users can approve overtime" });

  const user = getRequestUser(req);
  try {
    const result = await db.query(
      `UPDATE public.sow_overtime_request
       SET request_status = 'APPROVED',
           approved_by_user_id = $2,
           approved_by_name = $3,
           approved_at = now(),
           rejected_by_user_id = NULL,
           rejected_by_name = NULL,
           rejected_at = NULL,
           rejection_note = NULL
       WHERE id = $1
         AND request_status = 'PENDING'
       RETURNING *`,
      [id, user.id, user.name]
    );
    if (result.rowCount === 0) return res.status(409).json({ error: "overtime is not pending or not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.rejectOvertime = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: "valid overtime id is required" });
  if (!hasSupervisorRole(req)) return res.status(403).json({ error: "Only supervisor users can reject overtime" });

  const user = getRequestUser(req);
  try {
    const result = await db.query(
      `UPDATE public.sow_overtime_request
       SET request_status = 'REJECTED',
           rejected_by_user_id = $2,
           rejected_by_name = $3,
           rejected_at = now(),
           rejection_note = $4
       WHERE id = $1
         AND request_status = 'PENDING'
       RETURNING *`,
      [id, user.id, user.name, normalizeText(req.body?.rejection_note || req.body?.note) || null]
    );
    if (result.rowCount === 0) return res.status(409).json({ error: "overtime is not pending or not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.assignManpower = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: "valid overtime id is required" });
  const { assigned_to, assigned_to_name } = req.body || {};
  if (!assigned_to) return res.status(400).json({ error: "assigned_to is required" });

  const user = getRequestUser(req);
  try {
    const result = await db.query(
      `UPDATE public.sow_overtime_request
       SET assigned_to = $2,
           assigned_to_name = $3,
           assigned_by = $4
       WHERE id = $1
       RETURNING *`,
      [id, assigned_to, assigned_to_name || null, user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "overtime not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.deleteOvertime = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: "valid overtime id is required" });
  try {
    const result = await db.query(
      `UPDATE public.sow_overtime_request
       SET request_status = 'CANCELLED'
       WHERE id = $1
         AND request_status IN ('PENDING', 'APPROVED')
       RETURNING *`,
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "overtime not found or already processed" });
    res.json({ data: { id, deleted: true } });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getCapacityReport = (req, res) => queryReportView(
  req,
  res,
  "vw_sow_schedule_capacity",
  "schedule_date DESC, shift_id, machine_code"
);

exports.getPlanVsActualReport = (req, res) => queryReportView(
  req,
  res,
  "vw_sow_plan_vs_actual_hours",
  "schedule_date DESC, shift_id NULLS LAST, machine_code, production_order, operation_no"
);

exports.getPlannedQueueVsActualQueueReport = (req, res) => queryReportView(
  req,
  res,
  "vw_sow_planned_queue_vs_actual_queue",
  "schedule_date DESC, shift_id NULLS LAST, machine_code, planned_queue_no NULLS LAST, actual_queue_datetime NULLS LAST"
);

exports.getOvertimeSummaryReport = (req, res) => queryReportView(
  req,
  res,
  "vw_sow_overtime_summary",
  "overtime_date DESC, shift_id NULLS LAST, machine_code, created_at DESC"
);
