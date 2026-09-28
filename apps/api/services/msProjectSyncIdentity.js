"use strict";

// Validasi identitas task payload sync/publish MS Project SEBELUM ada mutasi.
//
// Kenapa ada: VBA mengirim Text10 sebagai task_id. Bila satu baris MS Project di-copy,
// Text10 ikut tersalin sehingga dua UID berbeda membawa task_id yang sama. upsertTasks
// memproses baris itu berurutan dan baris terakhir diam-diam menimpa yang pertama, lalu
// task yang "hilang" dinonaktifkan oleh deactivate diff. Aturan di sini: satu baris payload
// = tepat satu row DB, dan sebaliknya. Konflik ditolak utuh, tidak pernah di-dedupe diam-diam.

const MAX_DETAILS = 50;

function lower(value) {
  return value ? String(value).toLowerCase() : null;
}

function describe(task, index) {
  return {
    index,
    task_id: task.task_id || null,
    local_task_uid: task.local_task_uid || null,
    task_name: task.task_name || null,
    outline_number: task.outline_number || null,
  };
}

function groupDuplicates(tasks, keyOf) {
  const groups = new Map();
  tasks.forEach((task, index) => {
    const key = keyOf(task);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(describe(task, index));
  });
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, rows }));
}

function identityError(ApiError, status, code, message, details) {
  return new ApiError(status, code, message, details.slice(0, MAX_DETAILS));
}

// Pemeriksaan murni atas payload yang sudah dinormalisasi (tanpa DB).
// `tasks` = hasil normalizeTaskPayload; `deactivateTaskIds` = deactivate.task_ids.
function assertPayloadTaskIdentity(ApiError, tasks, deactivateTaskIds = []) {
  const dupIds = groupDuplicates(tasks, (t) => lower(t.task_id));
  if (dupIds.length) {
    throw identityError(
      ApiError, 400, "DUPLICATE_TASK_ID",
      "Satu task_id dipakai oleh lebih dari satu baris MS Project. Biasanya akibat baris yang disalin beserta Text10. Kosongkan Text10 pada salinan yang merupakan task baru.",
      dupIds.map((g) => ({ task_id: g.key, rows: g.rows }))
    );
  }

  const dupUids = groupDuplicates(tasks, (t) => t.local_task_uid);
  if (dupUids.length) {
    throw identityError(
      ApiError, 400, "DUPLICATE_LOCAL_TASK_UID",
      "Satu local_task_uid muncul di lebih dari satu baris payload.",
      dupUids.map((g) => ({ local_task_uid: g.key, rows: g.rows }))
    );
  }

  const deactivated = new Set(deactivateTaskIds.map(lower));
  const both = [];
  tasks.forEach((task, index) => {
    if (task.task_id && task.is_active && deactivated.has(lower(task.task_id))) {
      both.push(describe(task, index));
    }
  });
  if (both.length) {
    throw identityError(
      ApiError, 400, "TASK_UPSERT_DEACTIVATE_CONFLICT",
      "Task yang sama dikirim aktif sekaligus diminta dinonaktifkan.",
      both
    );
  }
}

// Pemeriksaan terhadap DB, dijalankan di transaksi sync sebelum mutasi pertama.
// Memastikan: task_id milik project ini, dan tidak ada dua baris payload (task_id vs
// local_task_uid) yang resolve ke row DB yang sama, serta baris yang resolve lewat UID
// tidak sekaligus ada di deactivate.task_ids.
async function assertDbTaskIdentity(ApiError, client, projectId, tasks, deactivateTaskIds = []) {
  const ids = [...new Set(tasks.map((t) => lower(t.task_id)).filter(Boolean))];
  const uids = [...new Set(tasks.filter((t) => !t.task_id && t.local_task_uid).map((t) => t.local_task_uid))];
  if (!ids.length && !uids.length) return;

  const byId = new Map();
  if (ids.length) {
    const result = await client.query(
      `select task_id::text as task_id, project_id::text as project_id
         from ms_project_task
        where task_id = any($1::uuid[])`,
      [ids]
    );
    for (const row of result.rows) byId.set(lower(row.task_id), row);
  }

  const foreign = [];
  const missing = [];
  tasks.forEach((task, index) => {
    if (!task.task_id) return;
    const row = byId.get(lower(task.task_id));
    if (!row) missing.push(describe(task, index));
    else if (lower(row.project_id) !== lower(projectId)) foreign.push(describe(task, index));
  });
  if (foreign.length) {
    throw identityError(
      ApiError, 409, "TASK_PROJECT_MISMATCH",
      "task_id pada payload milik project lain. Kemungkinan baris disalin dari file project berbeda.",
      foreign
    );
  }
  if (missing.length) {
    throw identityError(ApiError, 404, "TASK_NOT_FOUND", "Task not found in project", missing);
  }

  const byUid = new Map();
  if (uids.length) {
    const result = await client.query(
      `select task_id::text as task_id, local_task_uid
         from ms_project_task
        where project_id = $1 and local_task_uid = any($2::text[])`,
      [projectId, uids]
    );
    for (const row of result.rows) byUid.set(row.local_task_uid, lower(row.task_id));
  }

  const resolved = new Map();
  tasks.forEach((task, index) => {
    const target = task.task_id ? lower(task.task_id) : byUid.get(task.local_task_uid);
    if (!target) return;
    if (!resolved.has(target)) resolved.set(target, []);
    resolved.get(target).push({ ...describe(task, index), resolved_via: task.task_id ? "task_id" : "local_task_uid" });
  });
  const aliases = [...resolved.entries()].filter(([, rows]) => rows.length > 1);
  if (aliases.length) {
    throw identityError(
      ApiError, 409, "TASK_IDENTITY_CONFLICT",
      "Dua baris payload merujuk row task server yang sama (lewat task_id dan local_task_uid).",
      aliases.map(([taskId, rows]) => ({ task_id: taskId, rows }))
    );
  }

  const deactivated = new Set(deactivateTaskIds.map(lower));
  const viaUid = [];
  tasks.forEach((task, index) => {
    if (task.task_id || !task.is_active) return;
    const target = byUid.get(task.local_task_uid);
    if (target && deactivated.has(target)) viaUid.push({ ...describe(task, index), task_id: target });
  });
  if (viaUid.length) {
    throw identityError(
      ApiError, 400, "TASK_UPSERT_DEACTIVATE_CONFLICT",
      "Task yang sama dikirim aktif sekaligus diminta dinonaktifkan.",
      viaUid
    );
  }
}

module.exports = { assertPayloadTaskIdentity, assertDbTaskIdentity };
