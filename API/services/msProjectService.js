const dbModule = require("../db");

const MAX_LIMIT = 100;
const RESOURCE_CATEGORIES = new Set(["PERSON", "MACHINE", "WORKCENTER", "TEAM"]);
const RESOURCE_REFRESH_SOURCES = new Set(["WORKCENTER", "MACHINE", "EMPLOYEE"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function pool() {
  return global.pool || dbModule.pool || dbModule;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function nullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function assertUuid(value, fieldName = "id") {
  const text = normalizeText(value);
  if (!UUID_RE.test(text)) {
    throw new ApiError(400, "INVALID_UUID", `${fieldName} must be a valid UUID`, [{ field: fieldName }]);
  }
  return text;
}

function isUuid(value) {
  return UUID_RE.test(normalizeText(value));
}

function normalizeUuidArray(values, fieldName) {
  if (!Array.isArray(values)) {
    throw new ApiError(400, "INVALID_PAYLOAD", `${fieldName} must be an array`, [{ field: fieldName }]);
  }
  return values.map((value, index) => assertUuid(value, `${fieldName}[${index}]`));
}

function clampLimit(value, fallback = 50) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

function clampOffset(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function toBool(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = normalizeText(value).toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(text)) return true;
  if (["false", "0", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function toNullableInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveNumber(value, fieldName, fallback = 1) {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(400, "INVALID_UNITS", `${fieldName} must be greater than 0`, [{ field: fieldName }]);
  }
  return parsed;
}

function normalizeCategory(value) {
  const text = normalizeText(value).toUpperCase();
  if (!text) return null;
  if (!RESOURCE_CATEGORIES.has(text)) {
    throw new ApiError(400, "INVALID_RESOURCE_CATEGORY", "Unsupported resource category", [{ category: value }]);
  }
  return text;
}

function ensureObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_PAYLOAD", `${fieldName} must be an object`, [{ field: fieldName }]);
  }
  return value;
}

function ensureArray(value, fieldName) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(400, "INVALID_PAYLOAD", `${fieldName} must be an array`, [{ field: fieldName }]);
  }
  return value;
}

function makeDependencyKey(dep) {
  const pred = normalizeText(dep.predecessor_local_task_uid || dep.predecessor_task_id);
  const succ = normalizeText(dep.successor_local_task_uid || dep.successor_task_id);
  const type = normalizeText(dep.dependency_type || "FS").toUpperCase();
  const lag = toNullableInt(dep.lag_minutes) ?? 0;
  return `${pred}|${succ}|${type}|${lag}`;
}

function mapProject(row) {
  if (!row) return null;
  return {
    project_id: row.project_id,
    project_name: row.project_name,
    description: row.description,
    status: row.status,
    source_type: row.source_type,
    revision_no: row.revision_no,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildPackage(rows) {
  return {
    project: mapProject(rows.project),
    project_resources: rows.project_resources || [],
    tasks: rows.tasks || [],
    assignments: rows.assignments || [],
    dependencies: rows.dependencies || [],
  };
}

async function queryProjectPackage(client, projectId) {
  const [project, projectResources, tasks, assignments, dependencies] = await Promise.all([
    client.query("select * from ms_project where project_id = $1", [projectId]),
    client.query(
      `select
         pr.project_resource_id,
         pr.project_id,
         pr.resource_id,
         pr.is_active as project_resource_is_active,
         r.resource_code,
         r.resource_name,
         r.resource_type,
         r.resource_category,
         r.source_type,
         r.source_ref_id,
         r.employee_id,
         r.machine_id,
         r.workcenter_code,
         r.parent_resource_id,
         r.max_units,
         r.is_assignable,
         r.is_generic,
         r.is_active as resource_is_active,
         pr.created_at,
         pr.updated_at
       from ms_project_resource pr
       join ms_resource r on r.resource_id = pr.resource_id
       where pr.project_id = $1
       order by r.resource_category, r.resource_code`,
      [projectId]
    ),
    client.query(
      `select *
       from ms_project_task
       where project_id = $1
         and is_active = true
       order by outline_number nulls last, created_at, task_name`,
      [projectId]
    ),
    client.query(
      `select *
       from ms_project_assignment
       where project_id = $1
         and is_active = true
       order by created_at, assignment_id`,
      [projectId]
    ),
    client.query(
      `select *
       from ms_project_dependency
       where project_id = $1
         and is_active = true
       order by created_at, dependency_id`,
      [projectId]
    ),
  ]);

  if (!project.rows[0]) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  return buildPackage({
    project: project.rows[0],
    project_resources: projectResources.rows,
    tasks: tasks.rows,
    assignments: assignments.rows,
    dependencies: dependencies.rows,
  });
}

function normalizeProjectPayload(payload, isSync = false) {
  const body = ensureObject(payload, "payload");
  const project = ensureObject(body.project || {}, "project");
  const projectName = nullableText(project.project_name || project.name);

  if (!isSync && !projectName) {
    throw new ApiError(400, "INVALID_PROJECT", "project.project_name is required");
  }

  return {
    project: {
      project_id: project.project_id ? assertUuid(project.project_id, "project.project_id") : null,
      project_name: projectName,
      description: nullableText(project.description),
      status: nullableText(project.status) || (isSync ? null : "ACTIVE"),
      last_known_revision_no: toNullableInt(project.last_known_revision_no),
      created_by: nullableText(project.created_by),
      updated_by: nullableText(project.updated_by),
    },
    project_resources: ensureArray(body.project_resources, "project_resources"),
    tasks: ensureArray(body.tasks, "tasks"),
    assignments: ensureArray(body.assignments, "assignments"),
    dependencies: ensureArray(body.dependencies, "dependencies"),
    deactivate: body.deactivate && typeof body.deactivate === "object" ? body.deactivate : {},
  };
}

function normalizeTaskPayload(task, index, isPublish) {
  const taskId = task.task_id ? assertUuid(task.task_id, `tasks[${index}].task_id`) : null;
  const localTaskUid = nullableText(task.local_task_uid);
  const hasParentReference =
    Object.prototype.hasOwnProperty.call(task, "parent_task_id") ||
    Object.prototype.hasOwnProperty.call(task, "parent_local_task_uid");
  if (!taskId && !localTaskUid) {
    throw new ApiError(400, "LOCAL_TASK_UID_REQUIRED", "New task must include local_task_uid", [{ index }]);
  }
  return {
    task_id: isPublish ? null : taskId,
    local_task_uid: localTaskUid,
    has_parent_reference: hasParentReference,
    parent_task_id: task.parent_task_id ? assertUuid(task.parent_task_id, `tasks[${index}].parent_task_id`) : null,
    parent_local_task_uid: nullableText(task.parent_local_task_uid),
    task_name: nullableText(task.task_name || task.name) || "Untitled Task",
    outline_level: toNullableInt(task.outline_level),
    outline_number: nullableText(task.outline_number),
    order_no: nullableText(task.order_no),
    operation_no: nullableText(task.operation_no),
    ssbr_id: nullableText(task.ssbr_id),
    sow_id: toNullableInt(task.sow_id),
    workcenter: nullableText(task.workcenter),
    plan_start: nullableText(task.plan_start),
    plan_finish: nullableText(task.plan_finish),
    duration_minutes: toNullableInt(task.duration_minutes),
    planned_work_minutes: toNullableInt(task.planned_work_minutes),
    is_summary: Boolean(task.is_summary),
    is_active: task.is_active === undefined ? true : Boolean(task.is_active),
  };
}

function normalizeAssignmentPayload(assignment, index, isPublish) {
  const assignmentId = assignment.assignment_id
    ? assertUuid(assignment.assignment_id, `assignments[${index}].assignment_id`)
    : null;
  const localAssignmentUid = nullableText(assignment.local_assignment_uid);
  if (!assignmentId && !localAssignmentUid) {
    throw new ApiError(400, "LOCAL_ASSIGNMENT_UID_REQUIRED", "New assignment must include local_assignment_uid", [{ index }]);
  }
  return {
    assignment_id: isPublish ? null : assignmentId,
    local_assignment_uid: localAssignmentUid,
    task_id: assignment.task_id ? assertUuid(assignment.task_id, `assignments[${index}].task_id`) : null,
    local_task_uid: nullableText(assignment.local_task_uid),
    resource_id: assertUuid(assignment.resource_id, `assignments[${index}].resource_id`),
    assignment_units: toPositiveNumber(assignment.assignment_units, `assignments[${index}].assignment_units`, 1),
    planned_work_minutes: toNullableInt(assignment.planned_work_minutes),
    assignment_start: nullableText(assignment.assignment_start),
    assignment_finish: nullableText(assignment.assignment_finish),
    is_active: assignment.is_active === undefined ? true : Boolean(assignment.is_active),
  };
}

function normalizeDependencyPayload(dep, index, isPublish) {
  const dependencyId = dep.dependency_id ? assertUuid(dep.dependency_id, `dependencies[${index}].dependency_id`) : null;
  const localDependencyKey = nullableText(dep.local_dependency_key) || makeDependencyKey(dep);
  if (!dependencyId && !localDependencyKey) {
    throw new ApiError(400, "LOCAL_DEPENDENCY_KEY_REQUIRED", "New dependency must include local_dependency_key", [{ index }]);
  }
  return {
    dependency_id: isPublish ? null : dependencyId,
    local_dependency_key: localDependencyKey,
    predecessor_task_id: dep.predecessor_task_id
      ? assertUuid(dep.predecessor_task_id, `dependencies[${index}].predecessor_task_id`)
      : null,
    predecessor_local_task_uid: nullableText(dep.predecessor_local_task_uid),
    successor_task_id: dep.successor_task_id ? assertUuid(dep.successor_task_id, `dependencies[${index}].successor_task_id`) : null,
    successor_local_task_uid: nullableText(dep.successor_local_task_uid),
    dependency_type: nullableText(dep.dependency_type) || "FS",
    lag_minutes: toNullableInt(dep.lag_minutes) ?? 0,
    is_active: dep.is_active === undefined ? true : Boolean(dep.is_active),
  };
}

async function validateProjectResources(client, resourceIds) {
  const ids = Array.from(new Set(resourceIds));
  if (ids.length === 0) return [];

  const result = await client.query(
    `select resource_id, resource_code, resource_name, is_active, is_assignable
     from ms_resource
     where resource_id = any($1::uuid[])`,
    [ids]
  );
  const found = new Map(result.rows.map((row) => [row.resource_id, row]));
  const errors = [];

  for (const id of ids) {
    const row = found.get(id);
    if (!row) {
      errors.push({ resource_id: id, reason: "NOT_FOUND" });
    } else if (!row.is_active) {
      errors.push({ resource_id: id, reason: "INACTIVE" });
    } else if (!row.is_assignable) {
      errors.push({ resource_id: id, reason: "NOT_ASSIGNABLE" });
    }
  }

  if (errors.length) {
    throw new ApiError(400, "INVALID_PROJECT_RESOURCE", "One or more resources are not valid for assignment", errors);
  }

  return result.rows;
}

function extractProjectResourceIds(projectResources) {
  return projectResources
    .map((item, index) => {
      if (typeof item === "string") return assertUuid(item, `project_resources[${index}]`);
      if (!item || typeof item !== "object") {
        throw new ApiError(400, "INVALID_PROJECT_RESOURCE", "project_resources item must be object or UUID", [{ index }]);
      }
      return assertUuid(item.resource_id, `project_resources[${index}].resource_id`);
    });
}

async function upsertProjectResources(client, projectId, projectResources) {
  const resourceIds = Array.from(new Set(extractProjectResourceIds(projectResources)));
  await validateProjectResources(client, resourceIds);

  let created = 0;
  let updated = 0;
  const rows = [];

  for (const resourceId of resourceIds) {
    const result = await client.query(
      `insert into ms_project_resource (project_id, resource_id, is_active)
       values ($1, $2, true)
       on conflict (project_id, resource_id)
       do update set is_active = true, updated_at = now()
       returning *, (xmax = 0) as inserted`,
      [projectId, resourceId]
    );
    rows.push(result.rows[0]);
    if (result.rows[0].inserted) created += 1;
    else updated += 1;
  }

  return { rows, created, updated, resourceIds };
}

async function ensureResourceInProjectTeam(client, projectId, resourceIds) {
  const ids = Array.from(new Set(resourceIds));
  if (!ids.length) return;
  const result = await client.query(
    `select pr.resource_id
     from ms_project_resource pr
     join ms_resource r on r.resource_id = pr.resource_id
     where pr.project_id = $1
       and pr.resource_id = any($2::uuid[])
       and pr.is_active = true
       and r.is_active = true
       and r.is_assignable = true`,
    [projectId, ids]
  );
  const found = new Set(result.rows.map((row) => row.resource_id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new ApiError(400, "RESOURCE_NOT_IN_PROJECT_TEAM", "Assignments may only use active project team resources", missing);
  }
}

function resolveTaskId(item, taskMap, fieldName) {
  if (item.task_id) return item.task_id;
  const local = nullableText(item.local_task_uid);
  if (local && taskMap.has(local)) return taskMap.get(local);
  throw new ApiError(400, "TASK_REFERENCE_NOT_FOUND", `${fieldName} could not be resolved`, {
    task_id: item.task_id || null,
    local_task_uid: local,
  });
}

function resolveDependencyTaskId(taskId, localTaskUid, taskMap, fieldName) {
  if (taskId) return taskId;
  if (localTaskUid && taskMap.has(localTaskUid)) return taskMap.get(localTaskUid);
  throw new ApiError(400, "TASK_REFERENCE_NOT_FOUND", `${fieldName} could not be resolved`, {
    task_id: taskId || null,
    local_task_uid: localTaskUid || null,
  });
}

async function upsertTasks(client, projectId, tasks, isPublish) {
  const normalized = tasks.map((task, index) => normalizeTaskPayload(task, index, isPublish));
  const localTaskMap = new Map();
  const mappings = [];
  let created = 0;
  let updated = 0;

  for (const task of normalized) {
    let result;
    if (!isPublish && task.task_id) {
      result = await client.query(
        `update ms_project_task
         set task_name = $3,
             outline_level = $4,
             outline_number = $5,
             order_no = $6,
             operation_no = $7,
             ssbr_id = $8,
             sow_id = $9,
             workcenter = $10,
             plan_start = $11,
             plan_finish = $12,
             duration_minutes = $13,
             planned_work_minutes = $14,
             is_summary = $15,
             is_active = $16,
             local_task_uid = coalesce($17, local_task_uid)
         where project_id = $1 and task_id = $2
         returning task_id, local_task_uid`,
        [
          projectId,
          task.task_id,
          task.task_name,
          task.outline_level,
          task.outline_number,
          task.order_no,
          task.operation_no,
          task.ssbr_id,
          task.sow_id,
          task.workcenter,
          task.plan_start,
          task.plan_finish,
          task.duration_minutes,
          task.planned_work_minutes,
          task.is_summary,
          task.is_active,
          task.local_task_uid,
        ]
      );
      if (!result.rows[0]) {
        throw new ApiError(404, "TASK_NOT_FOUND", "Task not found in project", [{ task_id: task.task_id }]);
      }
      updated += 1;
    } else {
      result = await client.query(
        `insert into ms_project_task (
           project_id, parent_task_id, task_name, outline_level, outline_number,
           order_no, operation_no, ssbr_id, sow_id, workcenter,
           plan_start, plan_finish, duration_minutes, planned_work_minutes,
           is_summary, is_active, local_task_uid
         )
         values ($1, null, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         on conflict (project_id, local_task_uid)
         where local_task_uid is not null
         do update set
           task_name = excluded.task_name,
           outline_level = excluded.outline_level,
           outline_number = excluded.outline_number,
           order_no = excluded.order_no,
           operation_no = excluded.operation_no,
           ssbr_id = excluded.ssbr_id,
           sow_id = excluded.sow_id,
           workcenter = excluded.workcenter,
           plan_start = excluded.plan_start,
           plan_finish = excluded.plan_finish,
           duration_minutes = excluded.duration_minutes,
           planned_work_minutes = excluded.planned_work_minutes,
           is_summary = excluded.is_summary,
           is_active = excluded.is_active,
           parent_task_id = null,
           updated_at = now()
         returning task_id, local_task_uid, (xmax = 0) as inserted`,
        [
          projectId,
          task.task_name,
          task.outline_level,
          task.outline_number,
          task.order_no,
          task.operation_no,
          task.ssbr_id,
          task.sow_id,
          task.workcenter,
          task.plan_start,
          task.plan_finish,
          task.duration_minutes,
          task.planned_work_minutes,
          task.is_summary,
          task.is_active,
          task.local_task_uid,
        ]
      );
      if (result.rows[0].inserted) created += 1;
      else updated += 1;
    }

    const row = result.rows[0];
    if (task.local_task_uid) localTaskMap.set(task.local_task_uid, row.task_id);
    mappings.push({ local_task_uid: task.local_task_uid, task_id: row.task_id });
  }

  for (const task of normalized) {
    const taskId = task.task_id || (task.local_task_uid ? localTaskMap.get(task.local_task_uid) : null);
    if (!taskId) continue;
    if (!isPublish && !task.has_parent_reference) continue;

    let parentTaskId = null;
    if (task.parent_task_id) parentTaskId = task.parent_task_id;
    if (!parentTaskId && task.parent_local_task_uid) {
      parentTaskId = localTaskMap.get(task.parent_local_task_uid);
      if (!parentTaskId) {
        throw new ApiError(400, "PARENT_TASK_NOT_FOUND", "parent_local_task_uid could not be resolved", {
          parent_local_task_uid: task.parent_local_task_uid,
        });
      }
    }

    if (parentTaskId === taskId) {
      throw new ApiError(400, "INVALID_PARENT_TASK", "Task cannot be its own parent", [{ task_id: taskId }]);
    }

    await client.query(
      `update ms_project_task
       set parent_task_id = $3
       where project_id = $1 and task_id = $2`,
      [projectId, taskId, parentTaskId]
    );
  }

  return { localTaskMap, mappings, created, updated };
}

async function upsertAssignments(client, projectId, assignments, taskMap, isPublish) {
  const normalized = assignments.map((assignment, index) => normalizeAssignmentPayload(assignment, index, isPublish));
  await ensureResourceInProjectTeam(client, projectId, normalized.map((assignment) => assignment.resource_id));

  const mappings = [];
  let created = 0;
  let updated = 0;

  for (const assignment of normalized) {
    const taskId = resolveTaskId(assignment, taskMap, "assignment task");
    let result;

    if (!isPublish && assignment.assignment_id) {
      result = await client.query(
        `update ms_project_assignment
         set task_id = $3,
             resource_id = $4,
             assignment_units = $5,
             planned_work_minutes = $6,
             assignment_start = $7,
             assignment_finish = $8,
             is_active = $9,
             local_assignment_uid = coalesce($10, local_assignment_uid)
         where project_id = $1 and assignment_id = $2
         returning assignment_id, local_assignment_uid`,
        [
          projectId,
          assignment.assignment_id,
          taskId,
          assignment.resource_id,
          assignment.assignment_units,
          assignment.planned_work_minutes,
          assignment.assignment_start,
          assignment.assignment_finish,
          assignment.is_active,
          assignment.local_assignment_uid,
        ]
      );
      if (!result.rows[0]) {
        throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found in project", [
          { assignment_id: assignment.assignment_id },
        ]);
      }
      updated += 1;
    } else {
      result = await client.query(
        `insert into ms_project_assignment (
           project_id, task_id, resource_id, assignment_units, planned_work_minutes,
           assignment_start, assignment_finish, is_active, local_assignment_uid
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (project_id, local_assignment_uid)
         where local_assignment_uid is not null
         do update set
           task_id = excluded.task_id,
           resource_id = excluded.resource_id,
           assignment_units = excluded.assignment_units,
           planned_work_minutes = excluded.planned_work_minutes,
           assignment_start = excluded.assignment_start,
           assignment_finish = excluded.assignment_finish,
           is_active = excluded.is_active,
           updated_at = now()
         returning assignment_id, local_assignment_uid, (xmax = 0) as inserted`,
        [
          projectId,
          taskId,
          assignment.resource_id,
          assignment.assignment_units,
          assignment.planned_work_minutes,
          assignment.assignment_start,
          assignment.assignment_finish,
          assignment.is_active,
          assignment.local_assignment_uid,
        ]
      );
      if (result.rows[0].inserted) created += 1;
      else updated += 1;
    }

    mappings.push({
      local_assignment_uid: assignment.local_assignment_uid,
      assignment_id: result.rows[0].assignment_id,
    });
  }

  return { mappings, created, updated };
}

async function upsertDependencies(client, projectId, dependencies, taskMap, isPublish) {
  const normalized = dependencies.map((dep, index) => normalizeDependencyPayload(dep, index, isPublish));
  const mappings = [];
  let created = 0;
  let updated = 0;

  for (const dep of normalized) {
    const predecessorTaskId = resolveDependencyTaskId(
      dep.predecessor_task_id,
      dep.predecessor_local_task_uid,
      taskMap,
      "predecessor task"
    );
    const successorTaskId = resolveDependencyTaskId(
      dep.successor_task_id,
      dep.successor_local_task_uid,
      taskMap,
      "successor task"
    );
    let result;

    if (!isPublish && dep.dependency_id) {
      result = await client.query(
        `update ms_project_dependency
         set predecessor_task_id = $3,
             successor_task_id = $4,
             dependency_type = $5,
             lag_minutes = $6,
             local_dependency_key = coalesce($7, local_dependency_key),
             is_active = $8
         where project_id = $1 and dependency_id = $2
         returning dependency_id, local_dependency_key`,
        [
          projectId,
          dep.dependency_id,
          predecessorTaskId,
          successorTaskId,
          dep.dependency_type,
          dep.lag_minutes,
          dep.local_dependency_key,
          dep.is_active,
        ]
      );
      if (!result.rows[0]) {
        throw new ApiError(404, "DEPENDENCY_NOT_FOUND", "Dependency not found in project", [
          { dependency_id: dep.dependency_id },
        ]);
      }
      updated += 1;
    } else {
      const existingByPair = await client.query(
        `select dependency_id
         from ms_project_dependency
         where project_id = $1
           and predecessor_task_id = $2
           and successor_task_id = $3
           and coalesce(dependency_type, 'FS') = coalesce($4, 'FS')
           and coalesce(lag_minutes, 0) = coalesce($5, 0)
           and is_active = true
         order by created_at, dependency_id
         limit 1`,
        [projectId, predecessorTaskId, successorTaskId, dep.dependency_type, dep.lag_minutes]
      );

      if (existingByPair.rows[0]) {
        result = await client.query(
          `update ms_project_dependency
           set local_dependency_key = coalesce($3, local_dependency_key),
               is_active = $4,
               updated_at = now()
           where project_id = $1 and dependency_id = $2
           returning dependency_id, local_dependency_key, false as inserted`,
          [projectId, existingByPair.rows[0].dependency_id, dep.local_dependency_key, dep.is_active]
        );
        updated += 1;
      } else {
      result = await client.query(
        `insert into ms_project_dependency (
           project_id, predecessor_task_id, successor_task_id, dependency_type,
           lag_minutes, local_dependency_key, is_active
         )
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (project_id, local_dependency_key)
         where local_dependency_key is not null
         do update set
           predecessor_task_id = excluded.predecessor_task_id,
           successor_task_id = excluded.successor_task_id,
           dependency_type = excluded.dependency_type,
           lag_minutes = excluded.lag_minutes,
           is_active = excluded.is_active,
           updated_at = now()
         returning dependency_id, local_dependency_key, (xmax = 0) as inserted`,
        [
          projectId,
          predecessorTaskId,
          successorTaskId,
          dep.dependency_type,
          dep.lag_minutes,
          dep.local_dependency_key,
          dep.is_active,
        ]
      );
      if (result.rows[0].inserted) created += 1;
      else updated += 1;
      }
    }

    mappings.push({
      local_dependency_key: result.rows[0].local_dependency_key,
      predecessor_local_task_uid: dep.predecessor_local_task_uid,
      successor_local_task_uid: dep.successor_local_task_uid,
      dependency_id: result.rows[0].dependency_id,
    });
  }

  return { mappings, created, updated };
}

async function applyExplicitDeactivate(client, projectId, deactivate = {}) {
  const assignmentIds = normalizeUuidArray(deactivate.assignment_ids || [], "deactivate.assignment_ids");
  const dependencyIds = normalizeUuidArray(deactivate.dependency_ids || [], "deactivate.dependency_ids");
  const taskIds = normalizeUuidArray(deactivate.task_ids || [], "deactivate.task_ids");
  const resourceIds = normalizeUuidArray(deactivate.resource_ids || [], "deactivate.resource_ids");

  if (assignmentIds.length) {
    await client.query(
      `update ms_project_assignment
       set is_active = false
       where project_id = $1 and assignment_id = any($2::uuid[])`,
      [projectId, assignmentIds]
    );
  }

  if (dependencyIds.length) {
    await client.query(
      `update ms_project_dependency
       set is_active = false
       where project_id = $1 and dependency_id = any($2::uuid[])`,
      [projectId, dependencyIds]
    );
  }

  if (taskIds.length) {
    const blockers = await client.query(
      `select 'assignment' as type, assignment_id::text as id
       from ms_project_assignment
       where project_id = $1
         and task_id = any($2::uuid[])
         and is_active = true
       union all
       select 'dependency' as type, dependency_id::text as id
       from ms_project_dependency
       where project_id = $1
         and is_active = true
         and (predecessor_task_id = any($2::uuid[]) or successor_task_id = any($2::uuid[]))`,
      [projectId, taskIds]
    );
    if (blockers.rows.length) {
      throw new ApiError(409, "TASK_DEACTIVATE_BLOCKED", "Task is still used by active assignment or dependency", blockers.rows);
    }
    await client.query(
      `update ms_project_task
       set is_active = false
       where project_id = $1 and task_id = any($2::uuid[])`,
      [projectId, taskIds]
    );
  }

  if (resourceIds.length) {
    const blockers = await client.query(
      `select assignment_id, task_id, resource_id
       from ms_project_assignment
       where project_id = $1
         and resource_id = any($2::uuid[])
         and is_active = true`,
      [projectId, resourceIds]
    );
    if (blockers.rows.length) {
      throw new ApiError(409, "RESOURCE_DEACTIVATE_BLOCKED", "Resource is still used by active assignments", blockers.rows);
    }
    await client.query(
      `update ms_project_resource
       set is_active = false
       where project_id = $1 and resource_id = any($2::uuid[])`,
      [projectId, resourceIds]
    );
  }

  return {
    tasks_deactivated: taskIds.length,
    assignments_deactivated: assignmentIds.length,
    dependencies_deactivated: dependencyIds.length,
    resources_deactivated: resourceIds.length,
  };
}

async function health() {
  await pool().query("select 1");
  return { service: "ms-project", database: "connected" };
}

async function listProjects(query) {
  const values = [];
  const where = [];
  const status = nullableText(query.status);
  const q = nullableText(query.q);

  if (status) {
    values.push(status);
    where.push(`status = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    where.push(`project_name ilike $${values.length}`);
  }

  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  values.push(limit, offset);

  const sql = `
    select project_id, project_name, description, status, source_type, revision_no, created_at, updated_at
    from ms_project
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by updated_at desc
    limit $${values.length - 1} offset $${values.length}
  `;
  const result = await pool().query(sql, values);
  return { rows: result.rows, limit, offset };
}

async function getProjectPackage(projectId) {
  return queryProjectPackage(pool(), assertUuid(projectId, "project_id"));
}

async function bulkLoadProjectPackages(projectIds) {
  const ids = normalizeUuidArray(projectIds, "project_ids");
  if (!ids.length) {
    throw new ApiError(400, "INVALID_PAYLOAD", "project_ids must not be empty");
  }
  const packages = [];
  for (const id of ids) {
    packages.push(await queryProjectPackage(pool(), id));
  }
  return packages;
}

async function searchResources(query) {
  const values = [];
  const where = [];
  const active = toBool(query.active, null);
  const category = normalizeCategory(query.category);
  const q = nullableText(query.q);
  const workcenterCode = nullableText(query.workcenter_code);

  if (active !== null) {
    values.push(active);
    where.push(`is_active = $${values.length}`);
  }
  if (category) {
    values.push(category);
    where.push(`resource_category = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    where.push(`(resource_code ilike $${values.length} or resource_name ilike $${values.length})`);
  }
  if (workcenterCode) {
    values.push(workcenterCode);
    where.push(`workcenter_code = $${values.length}`);
  }

  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  values.push(limit, offset);

  const result = await pool().query(
    `select *
     from ms_resource
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by resource_category, resource_code
     limit $${values.length - 1} offset $${values.length}`,
    values
  );
  return { rows: result.rows, limit, offset };
}

async function upsertResourceFromRow(client, data) {
  const result = await client.query(
    `insert into ms_resource (
       resource_code, resource_name, resource_type, resource_category,
       source_type, source_ref_id, employee_id, machine_id, workcenter_code,
       max_units, is_assignable, is_generic, is_active, description
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13)
     on conflict (source_type, source_ref_id)
     where source_ref_id is not null
     do update set
       resource_code = excluded.resource_code,
       resource_name = excluded.resource_name,
       resource_type = excluded.resource_type,
       resource_category = excluded.resource_category,
       employee_id = excluded.employee_id,
       machine_id = excluded.machine_id,
       workcenter_code = excluded.workcenter_code,
       max_units = excluded.max_units,
       is_assignable = excluded.is_assignable,
       is_generic = excluded.is_generic,
       is_active = true,
       description = excluded.description,
       updated_at = now()
     returning resource_id, (xmax = 0) as inserted`,
    [
      data.resource_code,
      data.resource_name,
      data.resource_type || "WORK",
      data.resource_category,
      data.source_type,
      data.source_ref_id,
      data.employee_id || null,
      data.machine_id || null,
      data.workcenter_code || null,
      data.max_units || 1,
      data.is_assignable !== false,
      data.is_generic === true,
      data.description || null,
    ]
  );
  return result.rows[0];
}

async function refreshResources(body) {
  const requestedSources = ensureArray(body?.sources || ["WORKCENTER", "MACHINE", "EMPLOYEE"], "sources")
    .map((source) => normalizeText(source).toUpperCase());
  const invalid = requestedSources.filter((source) => !RESOURCE_REFRESH_SOURCES.has(source));
  if (invalid.length) {
    throw new ApiError(400, "INVALID_RESOURCE_SOURCE", "Unsupported refresh source", invalid);
  }

  const client = await pool().connect();
  const summary = { created: 0, updated: 0, skipped: 0, warnings: [] };

  try {
    await client.query("begin");

    if (requestedSources.includes("EMPLOYEE")) {
      const result = await client.query(
        `select snssb, full_name, machineid, workcenter
         from usernfc
         where snssb is not null and trim(snssb) <> ''`
      );
      for (const row of result.rows) {
        const key = normalizeText(row.snssb);
        if (!key) {
          summary.skipped += 1;
          continue;
        }
        const upserted = await upsertResourceFromRow(client, {
          resource_code: `EMP-${key}`,
          resource_name: nullableText(row.full_name) || key,
          resource_category: "PERSON",
          source_type: "EMPLOYEE_MASTER",
          source_ref_id: key,
          employee_id: key,
          machine_id: nullableText(row.machineid),
          workcenter_code: nullableText(row.workcenter),
          max_units: 1,
          is_assignable: true,
          is_generic: false,
          description: "Synced from usernfc",
        });
        if (upserted.inserted) summary.created += 1;
        else summary.updated += 1;
      }
    }

    if (requestedSources.includes("MACHINE")) {
      const result = await client.query(
        `select machineid, workcenter_description, workcenternew
         from workcenter
         where machineid is not null and trim(machineid) <> ''`
      );
      for (const row of result.rows) {
        const key = normalizeText(row.machineid);
        if (!key) {
          summary.skipped += 1;
          continue;
        }
        const upserted = await upsertResourceFromRow(client, {
          resource_code: `MCH-${key}`,
          resource_name: nullableText(row.workcenter_description) || key,
          resource_category: "MACHINE",
          source_type: "MACHINE_MASTER",
          source_ref_id: key,
          machine_id: key,
          workcenter_code: nullableText(row.workcenternew),
          max_units: 1,
          is_assignable: true,
          is_generic: false,
          description: "Synced from workcenter.machineid",
        });
        if (upserted.inserted) summary.created += 1;
        else summary.updated += 1;
      }
    }

    if (requestedSources.includes("WORKCENTER")) {
      const result = await client.query(
        `select workcenternew, workcenter_description
         from workcenter
         where workcenternew is not null and trim(workcenternew) <> ''`
      );
      for (const row of result.rows) {
        const key = normalizeText(row.workcenternew);
        if (!key) {
          summary.skipped += 1;
          continue;
        }
        const upserted = await upsertResourceFromRow(client, {
          resource_code: `WC-${key}`,
          resource_name: nullableText(row.workcenter_description) || key,
          resource_category: "WORKCENTER",
          source_type: "WORKCENTER_MASTER",
          source_ref_id: key,
          workcenter_code: key,
          max_units: 1,
          is_assignable: true,
          is_generic: true,
          description: "Synced from workcenter.workcenternew",
        });
        if (upserted.inserted) summary.created += 1;
        else summary.updated += 1;
      }
    }

    await client.query("commit");
    return summary;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function getProjectResources(projectId) {
  const result = await pool().query(
    `select
       pr.project_resource_id,
       pr.project_id,
       pr.resource_id,
       pr.is_active as project_resource_is_active,
       r.resource_code,
       r.resource_name,
       r.resource_type,
       r.resource_category,
       r.source_type,
       r.source_ref_id,
       r.employee_id,
       r.machine_id,
       r.workcenter_code,
       r.parent_resource_id,
       r.max_units,
       r.is_assignable,
       r.is_generic,
       r.is_active as resource_is_active,
       pr.created_at,
       pr.updated_at
     from ms_project_resource pr
     join ms_resource r on r.resource_id = pr.resource_id
     where pr.project_id = $1
     order by r.resource_category, r.resource_code`,
    [assertUuid(projectId, "project_id")]
  );
  return result.rows;
}

async function addProjectResources(projectId, resourceIds) {
  const id = assertUuid(projectId, "project_id");
  const client = await pool().connect();
  try {
    await client.query("begin");
    const project = await client.query("select project_id from ms_project where project_id = $1", [id]);
    if (!project.rows[0]) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    const result = await upsertProjectResources(client, id, resourceIds.map((resource_id) => ({ resource_id })));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function deactivateProjectResource(projectId, resourceId) {
  const pid = assertUuid(projectId, "project_id");
  const rid = assertUuid(resourceId, "resource_id");
  const client = await pool().connect();

  try {
    await client.query("begin");
    const blockers = await client.query(
      `select assignment_id, task_id, resource_id
       from ms_project_assignment
       where project_id = $1 and resource_id = $2 and is_active = true`,
      [pid, rid]
    );
    if (blockers.rows.length) {
      throw new ApiError(409, "RESOURCE_DEACTIVATE_BLOCKED", "Resource is still used by active assignments", blockers.rows);
    }
    const result = await client.query(
      `update ms_project_resource
       set is_active = false
       where project_id = $1 and resource_id = $2
       returning *`,
      [pid, rid]
    );
    if (!result.rows[0]) throw new ApiError(404, "PROJECT_RESOURCE_NOT_FOUND", "Project resource not found");
    await client.query("commit");
    return result.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function publishProject(payload) {
  const normalized = normalizeProjectPayload(payload, false);
  const client = await pool().connect();

  try {
    await client.query("begin");

    const projectResult = await client.query(
      `insert into ms_project (project_name, description, status, created_by, updated_by)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [
        normalized.project.project_name,
        normalized.project.description,
        normalized.project.status,
        normalized.project.created_by,
        normalized.project.updated_by,
      ]
    );
    const project = projectResult.rows[0];
    const projectId = project.project_id;

    const projectResourceResult = await upsertProjectResources(client, projectId, normalized.project_resources);
    const taskResult = await upsertTasks(client, projectId, normalized.tasks, true);
    const assignmentResult = await upsertAssignments(client, projectId, normalized.assignments, taskResult.localTaskMap, true);
    const dependencyResult = await upsertDependencies(client, projectId, normalized.dependencies, taskResult.localTaskMap, true);

    await client.query("commit");

    return {
      project_id: project.project_id,
      revision_no: project.revision_no,
      updated_at: project.updated_at,
      summary: {
        project_resources_created: projectResourceResult.created,
        project_resources_updated: projectResourceResult.updated,
        tasks_created: taskResult.created,
        tasks_updated: taskResult.updated,
        assignments_created: assignmentResult.created,
        assignments_updated: assignmentResult.updated,
        dependencies_created: dependencyResult.created,
        dependencies_updated: dependencyResult.updated,
      },
      task_mappings: taskResult.mappings,
      resource_mappings: projectResourceResult.resourceIds.map((resource_id) => ({ resource_id })),
      assignment_mappings: assignmentResult.mappings,
      dependency_mappings: dependencyResult.mappings,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function syncProject(projectIdParam, payload) {
  const projectId = assertUuid(projectIdParam, "project_id");
  const normalized = normalizeProjectPayload(payload, true);
  if (normalized.project.project_id && normalized.project.project_id !== projectId) {
    throw new ApiError(400, "PROJECT_ID_MISMATCH", "Path project_id and payload project_id do not match");
  }
  if (!Number.isInteger(normalized.project.last_known_revision_no)) {
    throw new ApiError(400, "REVISION_REQUIRED", "project.last_known_revision_no is required for sync");
  }

  const client = await pool().connect();

  try {
    await client.query("begin");
    const locked = await client.query("select * from ms_project where project_id = $1 for update", [projectId]);
    const project = locked.rows[0];
    if (!project) {
      throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    }
    if (Number(project.revision_no) !== Number(normalized.project.last_known_revision_no)) {
      throw new ApiError(409, "PROJECT_REVISION_CONFLICT", "Project has been updated by another user.", {
        current_revision_no: project.revision_no,
      });
    }

    await client.query(
      `update ms_project
       set project_name = coalesce($2, project_name),
           description = coalesce($3, description),
           status = coalesce($4, status),
           updated_by = coalesce($5, updated_by)
       where project_id = $1`,
      [
        projectId,
        normalized.project.project_name,
        normalized.project.description,
        normalized.project.status,
        normalized.project.updated_by,
      ]
    );

    const projectResourceResult = await upsertProjectResources(client, projectId, normalized.project_resources);
    const taskResult = await upsertTasks(client, projectId, normalized.tasks, false);
    const assignmentResult = await upsertAssignments(client, projectId, normalized.assignments, taskResult.localTaskMap, false);
    const dependencyResult = await upsertDependencies(client, projectId, normalized.dependencies, taskResult.localTaskMap, false);
    const deactivateSummary = await applyExplicitDeactivate(client, projectId, normalized.deactivate);

    const revisionResult = await client.query(
      `update ms_project
       set revision_no = revision_no + 1,
           updated_at = now()
       where project_id = $1
       returning project_id, revision_no, updated_at`,
      [projectId]
    );

    await client.query("commit");

    return {
      project_id: revisionResult.rows[0].project_id,
      revision_no: revisionResult.rows[0].revision_no,
      updated_at: revisionResult.rows[0].updated_at,
      summary: {
        project_resources_created: projectResourceResult.created,
        project_resources_updated: projectResourceResult.updated,
        tasks_created: taskResult.created,
        tasks_updated: taskResult.updated,
        assignments_created: assignmentResult.created,
        assignments_updated: assignmentResult.updated,
        dependencies_created: dependencyResult.created,
        dependencies_updated: dependencyResult.updated,
        ...deactivateSummary,
      },
      task_mappings: taskResult.mappings,
      resource_mappings: projectResourceResult.resourceIds.map((resource_id) => ({ resource_id })),
      assignment_mappings: assignmentResult.mappings,
      dependency_mappings: dependencyResult.mappings,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function toTime(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function buildConflictFilters(query) {
  const values = [];
  const where = [
    "a.is_active = true",
    "t.is_active = true",
    "r.is_active = true",
    "coalesce(a.assignment_start, t.plan_start) is not null",
    "coalesce(a.assignment_finish, t.plan_finish) is not null",
  ];

  if (query.project_id) {
    values.push(assertUuid(query.project_id, "project_id"));
    where.push(`a.project_id = $${values.length}`);
  }
  if (query.resource_id) {
    values.push(assertUuid(query.resource_id, "resource_id"));
    where.push(`a.resource_id = $${values.length}`);
  }
  if (query.category) {
    values.push(normalizeCategory(query.category));
    where.push(`r.resource_category = $${values.length}`);
  }
  if (query.start) {
    values.push(query.start);
    where.push(`coalesce(a.assignment_finish, t.plan_finish) > $${values.length}::timestamptz`);
  }
  if (query.finish) {
    values.push(query.finish);
    where.push(`coalesce(a.assignment_start, t.plan_start) < $${values.length}::timestamptz`);
  }

  return { values, where };
}

function calculateGenericConflict(resource, assignments) {
  const boundaries = [];
  for (const assignment of assignments) {
    const start = toTime(assignment.start_at);
    const finish = toTime(assignment.finish_at);
    if (start === null || finish === null || finish <= start) continue;
    boundaries.push(start, finish);
  }
  const ordered = Array.from(new Set(boundaries)).sort((a, b) => a - b);
  let best = null;

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const start = ordered[i];
    const finish = ordered[i + 1];
    if (finish <= start) continue;
    const active = assignments.filter((assignment) => {
      const assignmentStart = toTime(assignment.start_at);
      const assignmentFinish = toTime(assignment.finish_at);
      return assignmentStart !== null && assignmentFinish !== null && assignmentStart < finish && assignmentFinish > start;
    });
    const peakUnits = active.reduce((sum, assignment) => sum + Number(assignment.assignment_units || 0), 0);
    if (peakUnits > Number(resource.max_units || 0) && (!best || peakUnits > best.peak_units)) {
      best = {
        resource_id: resource.resource_id,
        resource_code: resource.resource_code,
        resource_name: resource.resource_name,
        resource_category: resource.resource_category,
        max_units: Number(resource.max_units),
        peak_units: peakUnits,
        overlap_start: new Date(start).toISOString(),
        overlap_finish: new Date(finish).toISOString(),
        assignments: active.map((assignment) => ({
          assignment_id: assignment.assignment_id,
          project_id: assignment.project_id,
          task_id: assignment.task_id,
          task_name: assignment.task_name,
          assignment_units: Number(assignment.assignment_units),
          start_at: assignment.start_at,
          finish_at: assignment.finish_at,
        })),
      };
    }
  }

  return best;
}

async function getConflicts(query) {
  const { values, where } = buildConflictFilters(query);
  const result = await pool().query(
    `select
       a.assignment_id,
       a.project_id,
       a.task_id,
       t.task_name,
       a.resource_id,
       r.resource_code,
       r.resource_name,
       r.resource_category,
       r.max_units,
       coalesce(a.assignment_start, t.plan_start) as start_at,
       coalesce(a.assignment_finish, t.plan_finish) as finish_at,
       coalesce(a.assignment_units, 1.0) as assignment_units
     from ms_project_assignment a
     join ms_project_task t
       on t.project_id = a.project_id
      and t.task_id = a.task_id
     join ms_resource r on r.resource_id = a.resource_id
     where ${where.join(" and ")}
     order by r.resource_code, start_at`,
    values
  );

  const grouped = new Map();
  for (const row of result.rows) {
    if (!grouped.has(row.resource_id)) {
      grouped.set(row.resource_id, {
        resource_id: row.resource_id,
        resource_code: row.resource_code,
        resource_name: row.resource_name,
        resource_category: row.resource_category,
        max_units: Number(row.max_units),
        assignments: [],
      });
    }
    grouped.get(row.resource_id).assignments.push(row);
  }

  const warnings = [];

  for (const resource of grouped.values()) {
    if (["PERSON", "MACHINE"].includes(resource.resource_category)) {
      const assignments = resource.assignments;
      for (let i = 0; i < assignments.length; i += 1) {
        for (let j = i + 1; j < assignments.length; j += 1) {
          const a = assignments[i];
          const b = assignments[j];
          const start = Math.max(toTime(a.start_at), toTime(b.start_at));
          const finish = Math.min(toTime(a.finish_at), toTime(b.finish_at));
          if (finish <= start) continue;
          const peakUnits = Number(a.assignment_units || 0) + Number(b.assignment_units || 0);
          if (peakUnits > resource.max_units) {
            warnings.push({
              resource_id: resource.resource_id,
              resource_code: resource.resource_code,
              resource_name: resource.resource_name,
              resource_category: resource.resource_category,
              max_units: resource.max_units,
              peak_units: peakUnits,
              overlap_start: new Date(start).toISOString(),
              overlap_finish: new Date(finish).toISOString(),
              assignments: [a, b].map((assignment) => ({
                assignment_id: assignment.assignment_id,
                project_id: assignment.project_id,
                task_id: assignment.task_id,
                task_name: assignment.task_name,
                assignment_units: Number(assignment.assignment_units),
                start_at: assignment.start_at,
                finish_at: assignment.finish_at,
              })),
            });
          }
        }
      }
    } else if (["WORKCENTER", "TEAM"].includes(resource.resource_category)) {
      const warning = calculateGenericConflict(resource, resource.assignments);
      if (warning) warnings.push(warning);
    }
  }

  return warnings;
}

module.exports = {
  ApiError,
  addProjectResources,
  bulkLoadProjectPackages,
  deactivateProjectResource,
  getConflicts,
  getProjectPackage,
  getProjectResources,
  health,
  listProjects,
  publishProject,
  refreshResources,
  searchResources,
  syncProject,
};
