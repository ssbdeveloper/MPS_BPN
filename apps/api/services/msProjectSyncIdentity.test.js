"use strict";

// Kontrak identitas task pada sync/publish MS Project (langkah B, rencana
// docs/planning/2026-09-28-scheduling-map-sap-reliability.md).
//
// Tes murni: helper msProjectSyncIdentity tanpa DB (client palsu).
// Tes transaksional: syncProject/publishProject sungguhan terhadap DB lab LOKAL, hanya bila
// MSPROJECT_IDENTITY_TEST_DB diisi connection string. Semua fixture dan mutasi service
// berjalan di dalam satu transaksi luar yang selalu di-ROLLBACK; begin/commit/rollback milik
// service dipetakan ke savepoint. Server non-loopback ditolak supaya tes tidak pernah
// menulis ke DB produksi.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const svc = require("./msProjectService");
const { assertPayloadTaskIdentity, assertDbTaskIdentity } = require("./msProjectSyncIdentity");

const { ApiError } = svc;
const PROJECT = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_PROJECT = "aaaaaaaa-0000-4000-8000-000000000002";
const T1 = "bbbbbbbb-0000-4000-8000-000000000001";
const T2 = "bbbbbbbb-0000-4000-8000-000000000002";

function task(overrides = {}) {
  return { task_id: null, local_task_uid: null, task_name: "X", outline_number: "1", is_active: true, ...overrides };
}

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
}

async function asyncCodeOf(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  return null;
}

// ---------- murni ----------

test("task_id sama pada dua UID ditolak DUPLICATE_TASK_ID dengan info baris", () => {
  let error;
  try {
    assertPayloadTaskIdentity(ApiError, [
      task({ task_id: T1, local_task_uid: "10", task_name: "UNIT 1", outline_number: "2" }),
      task({ task_id: T1, local_task_uid: "57", task_name: "UNIT 11", outline_number: "12" }),
    ]);
  } catch (err) {
    error = err;
  }
  assert.equal(error.code, "DUPLICATE_TASK_ID");
  assert.equal(error.status, 400);
  assert.deepEqual(error.details[0].rows.map((r) => [r.index, r.local_task_uid]), [[0, "10"], [1, "57"]]);
  assert.equal(error.details[0].rows[1].task_name, "UNIT 11");
});

test("UUID beda huruf besar/kecil tetap dianggap sama", () => {
  assert.equal(
    codeOf(() => assertPayloadTaskIdentity(ApiError, [
      task({ task_id: T1, local_task_uid: "1" }),
      task({ task_id: T1.toUpperCase(), local_task_uid: "2" }),
    ])),
    "DUPLICATE_TASK_ID"
  );
});

test("local_task_uid ganda ditolak", () => {
  assert.equal(
    codeOf(() => assertPayloadTaskIdentity(ApiError, [task({ local_task_uid: "5" }), task({ local_task_uid: "5" })])),
    "DUPLICATE_LOCAL_TASK_UID"
  );
});

test("task aktif yang juga ada di deactivate.task_ids ditolak", () => {
  assert.equal(
    codeOf(() => assertPayloadTaskIdentity(ApiError, [task({ task_id: T1, local_task_uid: "1" })], [T1.toUpperCase()])),
    "TASK_UPSERT_DEACTIVATE_CONFLICT"
  );
});

test("payload normal lolos: task baru tanpa task_id, task lama, dan task nonaktif yang juga dideactivate", () => {
  assert.equal(
    codeOf(() => assertPayloadTaskIdentity(ApiError, [
      task({ task_id: T1, local_task_uid: "1" }),
      task({ local_task_uid: "2" }),
      task({ local_task_uid: "3" }),
      task({ task_id: T2, local_task_uid: "4", is_active: false }),
    ], [T2])),
    null
  );
});

function fakeClient({ byId = [], byUid = [] } = {}) {
  const log = [];
  return {
    log,
    async query(sql, values) {
      log.push(sql);
      if (/where task_id = any/.test(sql)) return { rows: byId.filter((r) => values[0].includes(r.task_id)) };
      if (/local_task_uid = any/.test(sql)) return { rows: byUid.filter((r) => values[1].includes(r.local_task_uid)) };
      return { rows: [] };
    },
  };
}

test("DB: task_id milik project lain ditolak TASK_PROJECT_MISMATCH", async () => {
  const client = fakeClient({ byId: [{ task_id: T1, project_id: OTHER_PROJECT }] });
  const err = await asyncCodeOf(() => assertDbTaskIdentity(ApiError, client, PROJECT, [task({ task_id: T1, local_task_uid: "1" })]));
  assert.equal(err.code, "TASK_PROJECT_MISMATCH");
  assert.equal(err.status, 409);
});

test("DB: alias task_id dan local_task_uid ke row yang sama ditolak TASK_IDENTITY_CONFLICT", async () => {
  const client = fakeClient({
    byId: [{ task_id: T1, project_id: PROJECT }],
    byUid: [{ task_id: T1, local_task_uid: "10" }],
  });
  const err = await asyncCodeOf(() => assertDbTaskIdentity(ApiError, client, PROJECT, [
    task({ task_id: T1, local_task_uid: "57" }),
    task({ local_task_uid: "10" }),
  ]));
  assert.equal(err.code, "TASK_IDENTITY_CONFLICT");
  assert.deepEqual(err.details[0].rows.map((r) => r.resolved_via), ["task_id", "local_task_uid"]);
});

test("DB: task lewat UID yang juga dideactivate ditolak", async () => {
  const client = fakeClient({ byUid: [{ task_id: T2, local_task_uid: "4" }] });
  const err = await asyncCodeOf(() => assertDbTaskIdentity(ApiError, client, PROJECT, [task({ local_task_uid: "4" })], [T2]));
  assert.equal(err.code, "TASK_UPSERT_DEACTIVATE_CONFLICT");
});

test("DB: payload sah lolos dan helper hanya menjalankan SELECT", async () => {
  const client = fakeClient({
    byId: [{ task_id: T1, project_id: PROJECT }],
    byUid: [{ task_id: T1, local_task_uid: "1" }],
  });
  const err = await asyncCodeOf(() => assertDbTaskIdentity(ApiError, client, PROJECT, [
    task({ task_id: T1, local_task_uid: "1" }),
    task({ local_task_uid: "99" }),
  ]));
  assert.equal(err, null);
  assert.ok(client.log.every((sql) => /^\s*select/i.test(sql)));
});

test("sync menolak duplikat sebelum membuka koneksi DB", async () => {
  const previous = global.pool;
  let connected = false;
  global.pool = { connect: async () => { connected = true; throw new Error("tidak boleh dipanggil"); } };
  try {
    const err = await asyncCodeOf(() => svc.syncProject(PROJECT, {
      project: { project_id: PROJECT, last_known_revision_no: 1, lock_token: "x" },
      tasks: [
        { task_id: T1, local_task_uid: "10", task_name: "UNIT 1" },
        { task_id: T1, local_task_uid: "57", task_name: "UNIT 11" },
      ],
    }));
    assert.equal(err.code, "DUPLICATE_TASK_ID");
    assert.equal(connected, false);
  } finally {
    global.pool = previous;
  }
});

// ---------- transaksional (DB lab lokal) ----------

const LAB_DB = process.env.MSPROJECT_IDENTITY_TEST_DB;

async function openLab() {
  const { Client } = require("pg");
  const client = new Client({ connectionString: LAB_DB });
  await client.connect();
  const probe = await client.query("select inet_server_addr()::text as addr, current_database() as db");
  const addr = probe.rows[0].addr;
  if (addr && !["127.0.0.1/32", "::1/128", "127.0.0.1", "::1"].includes(addr)) {
    await client.end();
    throw new Error(`MSPROJECT_IDENTITY_TEST_DB harus server loopback, didapat ${addr}`);
  }
  await client.query("begin");
  return client;
}

// Pool palsu: transaksi service menjadi savepoint di dalam transaksi luar.
function savepointPool(outer) {
  let depth = 0;
  const wrapped = {
    async query(text, values) {
      const sql = typeof text === "string" ? text.trim().toLowerCase() : "";
      if (sql === "begin") { depth += 1; return outer.query(`savepoint svc_${depth}`); }
      if (sql === "commit") { const d = depth; depth -= 1; return outer.query(`release savepoint svc_${d}`); }
      if (sql === "rollback") { const d = depth; depth -= 1; return outer.query(`rollback to savepoint svc_${d}`); }
      return outer.query(text, values);
    },
    release() {},
  };
  return { connect: async () => wrapped, query: (t, v) => outer.query(t, v) };
}

async function seedProject(db, name) {
  const project = (await db.query(
    "insert into ms_project (project_name, created_by) values ($1, 'identity-test') returning project_id, revision_no",
    [name]
  )).rows[0];
  const token = crypto.randomUUID();
  await db.query(
    `insert into ms_project_lock (project_id, lock_token, locked_by, expires_at)
     values ($1, $2, 'identity-test', now() + interval '1 hour')`,
    [project.project_id, token]
  );
  const rows = [];
  for (const [uid, name2, outline] of [["1", "UNIT 1", "1"], ["2", "UNIT 2", "2"], ["3", "UNIT 3", "3"]]) {
    rows.push((await db.query(
      `insert into ms_project_task (project_id, task_name, outline_number, outline_level, local_task_uid, is_summary)
       values ($1, $2, $3, 1, $4, true) returning task_id::text, local_task_uid`,
      [project.project_id, name2, outline, uid]
    )).rows[0]);
  }
  return { projectId: project.project_id, revision: project.revision_no, token, tasks: rows };
}

async function fingerprint(db, projectId) {
  const r = await db.query(
    `select (select revision_no from ms_project where project_id = $1) as revision_no,
            (select string_agg(task_id || ':' || task_name || ':' || is_active || ':' || coalesce(local_task_uid, '')
                               || ':' || coalesce(parent_task_id::text, ''), '|' order by task_id)
               from ms_project_task where project_id = $1) as tasks,
            (select count(*) from ms_project_revision where project_id = $1)::int as revisions,
            (select count(*) from ms_project_audit_log where project_id = $1)::int as audits`,
    [projectId]
  );
  return r.rows[0];
}

function syncBody(seed, tasks, deactivate) {
  return {
    project: { project_id: seed.projectId, last_known_revision_no: seed.revision, lock_token: seed.token, updated_by: "identity-test" },
    tasks,
    deactivate,
  };
}

async function withLab(fn) {
  const db = await openLab();
  const previous = global.pool;
  global.pool = savepointPool(db);
  try {
    await fn(db);
  } finally {
    global.pool = previous;
    await db.query("rollback");
    await db.end();
  }
}

const labOpts = { skip: LAB_DB ? false : "MSPROJECT_IDENTITY_TEST_DB tidak diisi (DB lab lokal)" };

test("lab: reproduksi task_id duplikat pada dua UID ditolak tanpa perubahan parsial", labOpts, () => withLab(async (db) => {
  const seed = await seedProject(db, "identity-test dup");
  const [u1, u2, u3] = seed.tasks;
  const before = await fingerprint(db, seed.projectId);
  const err = await asyncCodeOf(() => svc.syncProject(seed.projectId, syncBody(seed, [
    { task_id: u1.task_id, local_task_uid: "1", task_name: "UNIT 1 BARU", outline_number: "1", is_summary: true },
    { task_id: u1.task_id.toUpperCase(), local_task_uid: "11", task_name: "UNIT 11", outline_number: "11", is_summary: true },
  ], { task_ids: [u2.task_id, u3.task_id] })));
  assert.equal(err.code, "DUPLICATE_TASK_ID");
  assert.deepEqual(await fingerprint(db, seed.projectId), before);
}));

test("lab: alias task_id vs local_task_uid ke row sama ditolak tanpa perubahan parsial", labOpts, () => withLab(async (db) => {
  const seed = await seedProject(db, "identity-test alias");
  const [u1] = seed.tasks;
  const before = await fingerprint(db, seed.projectId);
  const err = await asyncCodeOf(() => svc.syncProject(seed.projectId, syncBody(seed, [
    { task_id: u1.task_id, local_task_uid: "57", task_name: "UNIT 11", outline_number: "11", is_summary: true },
    { local_task_uid: "1", task_name: "UNIT 1", outline_number: "1", is_summary: true },
  ])));
  assert.equal(err.code, "TASK_IDENTITY_CONFLICT");
  assert.deepEqual(await fingerprint(db, seed.projectId), before);
}));

test("lab: task_id dari project lain ditolak tanpa perubahan di kedua project", labOpts, () => withLab(async (db) => {
  const seed = await seedProject(db, "identity-test a");
  const other = await seedProject(db, "identity-test b");
  const before = [await fingerprint(db, seed.projectId), await fingerprint(db, other.projectId)];
  const err = await asyncCodeOf(() => svc.syncProject(seed.projectId, syncBody(seed, [
    { task_id: other.tasks[0].task_id, local_task_uid: "1", task_name: "SALINAN", is_summary: true },
  ])));
  assert.equal(err.code, "TASK_PROJECT_MISMATCH");
  assert.deepEqual([await fingerprint(db, seed.projectId), await fingerprint(db, other.projectId)], before);
}));

test("lab: upsert aktif yang juga dideactivate ditolak", labOpts, () => withLab(async (db) => {
  const seed = await seedProject(db, "identity-test deact");
  const before = await fingerprint(db, seed.projectId);
  const err = await asyncCodeOf(() => svc.syncProject(seed.projectId, syncBody(seed, [
    { local_task_uid: "2", task_name: "UNIT 2", is_summary: true },
  ], { task_ids: [seed.tasks[1].task_id] })));
  assert.equal(err.code, "TASK_UPSERT_DEACTIVATE_CONFLICT");
  assert.deepEqual(await fingerprint(db, seed.projectId), before);
}));

test("lab: sync sah tetap jalan — rename, reparent, task baru, penghapusan sah", labOpts, () => withLab(async (db) => {
  const seed = await seedProject(db, "identity-test normal");
  const [u1, u2, u3] = seed.tasks;
  const result = await svc.syncProject(seed.projectId, syncBody(seed, [
    { task_id: u1.task_id, local_task_uid: "1", task_name: "UNIT 1 RENAMED", outline_number: "1", outline_level: 1, is_summary: true, parent_task_id: null },
    { task_id: u2.task_id.toUpperCase(), local_task_uid: "2", task_name: "UNIT 2", outline_number: "1.1", outline_level: 2, is_summary: true, parent_task_id: u1.task_id },
    { local_task_uid: "9", task_name: "TASK BARU", outline_number: "1.2", outline_level: 2, parent_local_task_uid: "1" },
  ], { task_ids: [u3.task_id] }));
  assert.equal(result.revision_no, seed.revision + 1);
  const rows = (await db.query(
    `select local_task_uid, task_name, is_active, parent_task_id::text as parent
       from ms_project_task where project_id = $1 order by local_task_uid`,
    [seed.projectId]
  )).rows;
  assert.deepEqual(rows.map((r) => [r.local_task_uid, r.task_name, r.is_active, r.parent]), [
    ["1", "UNIT 1 RENAMED", true, null],
    ["2", "UNIT 2", true, u1.task_id],
    ["3", "UNIT 3", false, null],
    ["9", "TASK BARU", true, u1.task_id],
  ]);
}));

test("lab: publish normal berhasil, publish dengan UID ganda ditolak sebelum insert", labOpts, () => withLab(async (db) => {
  const ok = await svc.publishProject({
    project: { project_name: "identity-test publish", created_by: "identity-test" },
    tasks: [
      { local_task_uid: "1", task_name: "UNIT 1", outline_number: "1", outline_level: 1, is_summary: true },
      { local_task_uid: "2", task_name: "OP", outline_number: "1.1", outline_level: 2, parent_local_task_uid: "1" },
    ],
  });
  assert.ok(ok.project_id);
  const count = async () => (await db.query("select count(*)::int as n from ms_project where project_name = 'identity-test publish dup'")).rows[0].n;
  const err = await asyncCodeOf(() => svc.publishProject({
    project: { project_name: "identity-test publish dup" },
    tasks: [{ local_task_uid: "1", task_name: "A" }, { local_task_uid: "1", task_name: "B" }],
  }));
  assert.equal(err.code, "DUPLICATE_LOCAL_TASK_UID");
  assert.equal(await count(), 0);
}));
