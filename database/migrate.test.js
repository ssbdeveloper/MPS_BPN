"use strict";

/** Kontrak safety runner migration — tidak pernah membuka koneksi production. */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  computeMigrationPlan,
  ensureSafeApply,
  readAppliedFilenames,
} = require("./migrate");

const TARGETS = [
  "20260922_timesheet_derived_time_contract.sql",
  "20260922b_timesheet_freeze_and_audit.sql",
];

test("--only menerima dua filename eksplisit", () => {
  const args = parseArgs([
    "--dry-run",
    `--only=${TARGETS.join(",")}`,
  ]);
  assert.equal(args.dryRun, true);
  assert.deepEqual(args.only, TARGETS);
});

test("plan melaporkan drift historis tetapi selected hanya dua target", () => {
  const files = ["old_a.sql", "old_b.sql", ...TARGETS];
  const applied = new Set();
  const plan = computeMigrationPlan(files, applied, TARGETS);
  assert.deepEqual(plan.pending, [...files].sort());
  assert.deepEqual(plan.selected, TARGETS);
  assert.deepEqual(plan.ignoredPending, ["old_a.sql", "old_b.sql"]);
});

test("target --only yang tidak ada fail-closed", () => {
  assert.throws(
    () => computeMigrationPlan(TARGETS, new Set(), ["missing.sql"]),
    /tidak ditemukan/i,
  );
});

test("apply tanpa --only ditolak bila ada pending historis", () => {
  const plan = computeMigrationPlan(
    ["20240101_old.sql", ...TARGETS], new Set(), TARGETS,
  );
  assert.throws(() => ensureSafeApply(plan, { dryRun: false, only: [] }), /--only/i);
});

test("dry-run membaca ledger tanpa CREATE TABLE", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(String(sql));
      if (/to_regclass/i.test(sql)) return { rows: [{ ledger: "schema_migrations" }] };
      if (/SELECT filename/i.test(sql)) return { rows: [{ filename: "old.sql" }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const result = await readAppliedFilenames(client, { dryRun: true });
  assert.deepEqual([...result], ["old.sql"]);
  assert.equal(queries.some((q) => /CREATE TABLE/i.test(q)), false);
});

test("dry-run fail-closed bila ledger belum ada", async () => {
  const client = {
    async query(sql) {
      if (/to_regclass/i.test(String(sql))) return { rows: [{ ledger: null }] };
      throw new Error("query kedua tidak boleh terjadi");
    },
  };
  await assert.rejects(
    () => readAppliedFilenames(client, { dryRun: true }),
    /ledger.*tidak ada/i,
  );
});

test("--allow-historical-drift ditolak bila host bukan localhost (fail-closed)", () => {
  const plan = computeMigrationPlan(
    ["20240101_old.sql", ...TARGETS], new Set(["20240201_mid.sql"]), TARGETS,
  );
  assert.throws(
    () => ensureSafeApply(plan, { dryRun: false, only: TARGETS, allowHistoricalDrift: true }, "100.80.101.53", "mps_timesheet_ckp_test", "100.80.101.53"),
    /hanya diizinkan di host localhost/i,
  );
});

test("--allow-historical-drift ditolak bila nama database bukan allowlist (misal ptssb)", () => {
  const plan = computeMigrationPlan(
    ["20240101_old.sql", ...TARGETS], new Set(["20240201_mid.sql"]), TARGETS,
  );
  assert.throws(
    () => ensureSafeApply(plan, { dryRun: false, only: TARGETS, allowHistoricalDrift: true }, "localhost", "ptssb", "127.0.0.1"),
    /ditolak untuk database "ptssb"/i,
  );
});

test("--allow-historical-drift ditolak bila serverAddr bukan loopback", () => {
  const plan = computeMigrationPlan(
    ["20240101_old.sql", ...TARGETS], new Set(["20240201_mid.sql"]), TARGETS,
  );
  assert.throws(
    () => ensureSafeApply(plan, { dryRun: false, only: TARGETS, allowHistoricalDrift: true }, "localhost", "mps_timesheet_ckp_test", "192.168.1.100"),
    /bukan loopback address/i,
  );
});

test("--allow-historical-drift ditolak bila tanpa --only eksplisit", () => {
  const plan = computeMigrationPlan(
    ["20240101_old.sql", ...TARGETS], new Set(["20240201_mid.sql"]), TARGETS,
  );
  assert.throws(
    () => ensureSafeApply(plan, { dryRun: false, only: [], allowHistoricalDrift: true }, "localhost", "mps_timesheet_ckp_test", "127.0.0.1"),
    /wajib digunakan bersama --only/i,
  );
});

test("--allow-historical-drift diizinkan pada localhost, database allowlist, dan loopback serverAddr", () => {
  const plan = computeMigrationPlan(
    ["20240101_old.sql", ...TARGETS], new Set(["20240201_mid.sql"]), TARGETS,
  );
  assert.doesNotThrow(
    () => ensureSafeApply(plan, { dryRun: false, only: TARGETS, allowHistoricalDrift: true }, "localhost", "mps_timesheet_ckp_test", "127.0.0.1"),
  );
  assert.doesNotThrow(
    () => ensureSafeApply(plan, { dryRun: false, only: TARGETS, allowHistoricalDrift: true }, "localhost", "mps_timesheet_bpn_test", "127.0.0.1"),
  );
});

const {
  RELEASE_MANIFESTS,
  verifyReleaseManifest,
  computeManifestPlan,
  ensureSafeManifestApply,
  main,
} = require("./migrate");
const path = require("path");
const fs = require("fs");

const MIGRATIONS_DIR = path.join(__dirname, "migrations", "api");

test("manifest timesheet-20260924 mematok tepat 3 file dan hash sha256 valid", () => {
  const m = RELEASE_MANIFESTS["timesheet-20260924"];
  assert.ok(m);
  assert.equal(m.migrations.length, 3);
  assert.equal(m.migrations[0].filename, "20260922_timesheet_derived_time_contract.sql");
  assert.equal(m.migrations[1].filename, "20260922b_timesheet_freeze_and_audit.sql");
  assert.equal(m.migrations[2].filename, "20260923_timesheet_etl_pipeline.sql");

  // Verifikasi hash terhadap file aktual di disk
  assert.doesNotThrow(() => verifyReleaseManifest(m, MIGRATIONS_DIR));
});

test("verifyReleaseManifest menolak bila hash file diubah (tamper detection)", () => {
  const fakeManifest = {
    releaseId: "test-tamper",
    migrations: [
      {
        filename: "20260922_timesheet_derived_time_contract.sql",
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    ],
  };
  assert.throws(
    () => verifyReleaseManifest(fakeManifest, MIGRATIONS_DIR),
    /hash.*tidak cocok/i,
  );
});

test("parseArgs mendukung --release dan menolak gabungan dengan --only", () => {
  const args = parseArgs(["--release=timesheet-20260924", "--dry-run"]);
  assert.equal(args.release, "timesheet-20260924");
  assert.equal(args.dryRun, true);

  assert.throws(
    () => parseArgs(["--release=timesheet-20260924", "--only=foo.sql"]),
    /tidak boleh digabungkan/i,
  );
});

test("simulasi ledger Cikupa: 79 applied, 15 historical drift, 1 pending EWS -> HANYA 3 target dipilih", () => {
  const manifest = RELEASE_MANIFESTS["timesheet-20260924"];
  
  // 79 applied files tiruan Cikupa
  const applied = new Set();
  for (let i = 1; i <= 79; i++) {
    applied.add(`20260101_applied_${String(i).padStart(3, "0")}.sql`);
  }

  const plan = computeManifestPlan(manifest, applied, MIGRATIONS_DIR);

  assert.equal(plan.selected.length, 3);
  assert.deepEqual(plan.selected.map((s) => s.filename), [
    "20260922_timesheet_derived_time_contract.sql",
    "20260922b_timesheet_freeze_and_audit.sql",
    "20260923_timesheet_etl_pipeline.sql",
  ]);
  assert.equal(plan.alreadyApplied.length, 0);

  // File lain (drift dan EWS) tidak ada di selected plan
  const selectedNames = plan.selected.map((s) => s.filename);
  assert.equal(selectedNames.includes("20260916c_ews_roster_calendar_exception.sql"), false);
  assert.equal(selectedNames.includes("20260503_buffer_transaction_operation_fields.sql"), false);
});


test("rerun manifest idempoten: bila sudah applied, selected kosong dan safe apply no-op", () => {
  const manifest = RELEASE_MANIFESTS["timesheet-20260924"];
  
  const applied = new Set([
    "20260922_timesheet_derived_time_contract.sql",
    "20260922b_timesheet_freeze_and_audit.sql",
    "20260923_timesheet_etl_pipeline.sql",
  ]);

  const plan = computeManifestPlan(manifest, applied, MIGRATIONS_DIR);
  assert.equal(plan.selected.length, 0);
  assert.equal(plan.alreadyApplied.length, 3);
});

test("inkonsistensi ledger: target #2 sudah applied tetapi target #1 belum applied DITOLAK", () => {
  const manifest = RELEASE_MANIFESTS["timesheet-20260924"];
  
  const applied = new Set([
    "20260922b_timesheet_freeze_and_audit.sql", // #2 ada tapi #1 belum
  ]);

  assert.throws(
    () => computeManifestPlan(manifest, applied, MIGRATIONS_DIR),
    /inkonsistensi ledger/i,
  );
});

test("ensureSafeManifestApply menolak apply bila tanpa --confirm-release eksplisit", async () => {
  const manifest = RELEASE_MANIFESTS["timesheet-20260924"];
  const plan = computeManifestPlan(manifest, new Set(), MIGRATIONS_DIR);

  const mockClient = {
    database: "ptssb",
    async query(sql) {
      if (/to_regclass\('public.schema_migrations'\)/i.test(sql)) return { rows: [{ ledger: "schema_migrations" }] };
      if (/to_regclass\('public.plant_config'\)/i.test(sql)) return { rows: [{ tbl: "plant_config" }] };
      if (/current_database/i.test(sql)) return { rows: [{ dbname: "ptssb" }] };
      if (/plant_code/i.test(sql)) return { rows: [{ plant_code: "5100", timezone: "Asia/Jakarta" }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  // dry-run aman
  await assert.doesNotReject(() => ensureSafeManifestApply(mockClient, plan, { dryRun: true }));

  // apply tanpa confirm-release ditolak
  await assert.rejects(
    () => ensureSafeManifestApply(mockClient, plan, { dryRun: false }),
    /memerlukan argumen konfirmasi/i,
  );

  // apply dengan confirm-release salah ditolak
  await assert.rejects(
    () => ensureSafeManifestApply(mockClient, plan, { dryRun: false, confirmRelease: "wrong-id" }),
    /tidak cocok/i,
  );

  // apply dengan confirm-release yang cocok diterima
  await assert.doesNotReject(
    () => ensureSafeManifestApply(mockClient, plan, { dryRun: false, confirmRelease: "timesheet-20260924" }),
  );
});

test("target guard: ledger schema_migrations tidak ada DITOLAK (0 writes)", async () => {
  const manifest = RELEASE_MANIFESTS["timesheet-20260924"];
  const plan = computeManifestPlan(manifest, new Set(), MIGRATIONS_DIR);

  const clientNoLedger = {
    database: "ptssb",
    async query(sql) {
      if (/to_regclass\('public.schema_migrations'\)/i.test(sql)) return { rows: [{ ledger: null }] };
      throw new Error("Query lanjutan tidak boleh dijalankan");
    },
  };

  await assert.rejects(
    () => ensureSafeManifestApply(clientNoLedger, plan, { dryRun: false, confirmRelease: "timesheet-20260924" }),
    /ledger public.schema_migrations tidak ditemukan/i,
  );
});

test("target guard: plant_config.plant_code bukan 5100 (misal 5051) DITOLAK (0 writes)", async () => {
  const manifest = RELEASE_MANIFESTS["timesheet-20260924"];
  const plan = computeManifestPlan(manifest, new Set(), MIGRATIONS_DIR);

  const clientWrongPlant = {
    database: "ptssb",
    async query(sql) {
      if (/to_regclass\('public.schema_migrations'\)/i.test(sql)) return { rows: [{ ledger: "schema_migrations" }] };
      if (/current_database/i.test(sql)) return { rows: [{ dbname: "ptssb" }] };
      if (/to_regclass\('public.plant_config'\)/i.test(sql)) return { rows: [{ tbl: "plant_config" }] };
      if (/plant_code/i.test(sql)) return { rows: [{ plant_code: "5051", timezone: "Asia/Makassar" }] }; // Balikpapan!
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  await assert.rejects(
    () => ensureSafeManifestApply(clientWrongPlant, plan, { dryRun: false, confirmRelease: "timesheet-20260924" }),
    /bukan '5100'/i,
  );
});

test("target guard: database target tidak dikenal DITOLAK (0 writes)", async () => {
  const manifest = RELEASE_MANIFESTS["timesheet-20260924"];
  const plan = computeManifestPlan(manifest, new Set(), MIGRATIONS_DIR);

  const clientWrongDb = {
    database: "unknown_foreign_db",
    async query(sql) {
      if (/to_regclass\('public.schema_migrations'\)/i.test(sql)) return { rows: [{ ledger: "schema_migrations" }] };
      if (/current_database/i.test(sql)) return { rows: [{ dbname: "unknown_foreign_db" }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  await assert.rejects(
    () => ensureSafeManifestApply(clientWrongDb, plan, { dryRun: false, confirmRelease: "timesheet-20260924" }),
    /bukan database rilis Cikupa yang diizinkan/i,
  );
});

function plantClient(plantCode, timezone) {
  return {
    database: "ptssb",
    async query(sql) {
      if (/to_regclass\('public.schema_migrations'\)/i.test(sql)) return { rows: [{ ledger: "schema_migrations" }] };
      if (/current_database/i.test(sql)) return { rows: [{ dbname: "ptssb" }] };
      if (/to_regclass\('public.plant_config'\)/i.test(sql)) return { rows: [{ tbl: "plant_config" }] };
      if (/plant_code/i.test(sql)) return { rows: [{ plant_code: plantCode, timezone }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test("target guard: --plant=5051 menerima Balikpapan dengan timezone Asia/Makassar", async () => {
  const plan = computeManifestPlan(RELEASE_MANIFESTS["timesheet-20260927"], new Set(), MIGRATIONS_DIR);
  await assert.doesNotReject(() => ensureSafeManifestApply(
    plantClient("5051", "Asia/Makassar"), plan,
    { dryRun: false, confirmRelease: "timesheet-20260927", plant: "5051" },
  ));
});

test("target guard: --plant=5051 menolak DB Cikupa (salah host)", async () => {
  const plan = computeManifestPlan(RELEASE_MANIFESTS["timesheet-20260927"], new Set(), MIGRATIONS_DIR);
  await assert.rejects(() => ensureSafeManifestApply(
    plantClient("5100", "Asia/Jakarta"), plan,
    { dryRun: false, confirmRelease: "timesheet-20260927", plant: "5051" },
  ), /bukan '5051'/);
});

test("target guard: timezone plant tidak cocok ditolak", async () => {
  const plan = computeManifestPlan(RELEASE_MANIFESTS["timesheet-20260927"], new Set(), MIGRATIONS_DIR);
  await assert.rejects(() => ensureSafeManifestApply(
    plantClient("5051", "Asia/Jakarta"), plan,
    { dryRun: false, confirmRelease: "timesheet-20260927", plant: "5051" },
  ), /timezone/);
});

test("target guard: plant tidak dikenal ditolak", async () => {
  const plan = computeManifestPlan(RELEASE_MANIFESTS["timesheet-20260927"], new Set(), MIGRATIONS_DIR);
  await assert.rejects(() => ensureSafeManifestApply(
    plantClient("9999", "Asia/Jakarta"), plan,
    { dryRun: false, confirmRelease: "timesheet-20260927", plant: "9999" },
  ), /tidak dikenal/);
});

test("target guard: dry-run juga memverifikasi identitas plant (SELECT saja)", async () => {
  const plan = computeManifestPlan(RELEASE_MANIFESTS["timesheet-20260927"], new Set(), MIGRATIONS_DIR);
  await assert.rejects(() => ensureSafeManifestApply(
    plantClient("5100", "Asia/Jakarta"), plan, { dryRun: true, plant: "5051" },
  ), /bukan '5051'/);
});

test("parseArgs: --plant hanya berlaku bersama --release", () => {
  assert.throws(() => parseArgs(["--dry-run", "--plant=5051"]), /hanya berlaku bersama --release/);
  assert.equal(parseArgs(["--release=timesheet-20260927", "--plant=5051", "--dry-run"]).plant, "5051");
});

function recordingClient({ ledger, dbname = "ptssb", plantCode = "5100", timezone = "Asia/Jakarta", applied = [] }) {
  const queries = [];
  return {
    queries,
    host: "localhost",
    database: dbname,
    async connect() {},
    async end() {},
    async query(sql) {
      const text = String(sql);
      queries.push(text);
      if (/inet_server_addr/i.test(text)) return { rows: [{ addr: "127.0.0.1" }] };
      if (/to_regclass\('public.schema_migrations'\)/i.test(text)) return { rows: [{ ledger }] };
      if (/to_regclass\('public.plant_config'\)/i.test(text)) return { rows: [{ tbl: "plant_config" }] };
      if (/current_database/i.test(text)) return { rows: [{ dbname }] };
      if (/SELECT plant_code/i.test(text)) return { rows: [{ plant_code: plantCode, timezone }] };
      if (/SELECT filename FROM public.schema_migrations/i.test(text)) {
        return { rows: applied.map((filename) => ({ filename })) };
      }
      return { rows: [] };
    },
  };
}

const WRITE_SQL = /\b(CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|BEGIN)\b/i;

test("main --release tanpa ledger: ditolak dan NOL query write (termasuk CREATE schema_migrations)", async () => {
  const client = recordingClient({ ledger: null });
  const releaseId = Object.keys(RELEASE_MANIFESTS).at(-1);
  await assert.rejects(
    () => main([`--release=${releaseId}`, `--confirm-release=${releaseId}`], { createClient: () => client }),
    /schema_migrations tidak ditemukan/i,
  );
  const writes = client.queries.filter((q) => WRITE_SQL.test(q));
  assert.deepEqual(writes, []);
});

test("main --release --dry-run tanpa ledger: ditolak tanpa write", async () => {
  const client = recordingClient({ ledger: null });
  const releaseId = Object.keys(RELEASE_MANIFESTS).at(-1);
  await assert.rejects(
    () => main([`--release=${releaseId}`, "--dry-run"], { createClient: () => client }),
    /schema_migrations/i,
  );
  assert.deepEqual(client.queries.filter((q) => WRITE_SQL.test(q)), []);
});

test("manifest rilis terbaru mencakup index 20260925 dengan hash file aktual", () => {
  const latest = RELEASE_MANIFESTS[Object.keys(RELEASE_MANIFESTS).at(-1)];
  const names = latest.migrations.map((m) => m.filename);
  assert.deepEqual(names, [
    "20260922_timesheet_derived_time_contract.sql",
    "20260922b_timesheet_freeze_and_audit.sql",
    "20260923_timesheet_etl_pipeline.sql",
    "20260925_timesheet_unique_active_productive_op.sql",
  ]);
  assert.doesNotThrow(() => verifyReleaseManifest(latest, MIGRATIONS_DIR));
});

test("manifest 20260925: ledger yang sudah berisi 3 file lama hanya memilih index 20260925", () => {
  const latest = RELEASE_MANIFESTS[Object.keys(RELEASE_MANIFESTS).at(-1)];
  const applied = new Set(latest.migrations.slice(0, 3).map((m) => m.filename));
  const plan = computeManifestPlan(latest, applied, MIGRATIONS_DIR);
  assert.deepEqual(plan.pending, ["20260925_timesheet_unique_active_productive_op.sql"]);
});

test("discovery forward migration tidak memindai rollback file", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"));

  // Tidak boleh ada file rollback di dalam MIGRATIONS_DIR (database/migrations/api)
  const rollbackInApi = files.filter((name) => /rollback/i.test(name));
  assert.deepEqual(
    rollbackInApi,
    [],
    `Ditemukan file rollback di folder migrasi forward ${MIGRATIONS_DIR}: ${rollbackInApi.join(", ")}`
  );

  // File rollback harus tersimpan di database/migrations/rollback/
  const rollbackDir = path.join(__dirname, "migrations", "rollback");
  assert.ok(fs.existsSync(rollbackDir), "Direktori rollback tidak ditemukan");
  const rollbackFiles = fs.readdirSync(rollbackDir).filter((name) => name.endsWith(".sql"));
  assert.ok(
    rollbackFiles.includes("20261001_ews_shift_date_override_guard_rollback.sql"),
    "File rollback 20261001_ews_shift_date_override_guard_rollback.sql harus ada di database/migrations/rollback/"
  );
});


