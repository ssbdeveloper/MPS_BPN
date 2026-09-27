#!/usr/bin/env node
/**
 * database/migrate.js — migration runner fail-closed.
 *
 * Pakai:
 *   node database/migrate.js --dry-run
 *   node database/migrate.js --dry-run --only=a.sql,b.sql
 *   node database/migrate.js --only=a.sql,b.sql
 *
 * Safety:
 *   - --dry-run hanya SELECT; tidak membuat ledger/DDL apa pun.
 *   - file lama yang tidak tercatat tetapi berada sebelum migration terakhir di
 *     ledger diklasifikasikan sebagai HISTORICAL DRIFT, bukan kandidat apply.
 *   - apply ditolak selama historical drift belum direkonsiliasi terpisah.
 *   - --only adalah allowlist eksplisit, bukan cara menyembunyikan drift.
 *
 * Konvensi file migration:
 *   - Nama berurutan secara leksikografis (YYYYMMDD_deskripsi.sql).
 *   - JANGAN tulis BEGIN/COMMIT sendiri — runner yang membungkus.
 *   - `-- migrate:no-transaction` pada baris pertama untuk pengecualian.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
const MIGRATIONS_DIR = path.join(__dirname, "migrations", "api");

const RELEASE_MANIFESTS = Object.freeze({
  "timesheet-20260924": Object.freeze({
    releaseId: "timesheet-20260924",
    description: "Rilis sempit timesheet/payroll pipeline Cikupa & Balikpapan (Fase A & B)",
    migrations: Object.freeze([
      {
        filename: "20260922_timesheet_derived_time_contract.sql",
        sha256: "e290aec03a6a30b0997c21bd8057f0b2bba7cf3ec0e42a574df37955b407770a",
      },
      {
        filename: "20260922b_timesheet_freeze_and_audit.sql",
        sha256: "5922221a30350aa9488a1bafc3babab2199900c08de3e9852274239282a48411",
      },
      {
        filename: "20260923_timesheet_etl_pipeline.sql",
        sha256: "3b1addf8eb7d3310551346d7735399fa7e81ceb79bd4a74562ca2385bffd6d69",
      },
    ]),
  }),
  "timesheet-20260927": Object.freeze({
    releaseId: "timesheet-20260927",
    description: "Rilis timesheet-20260924 ditambah unique index aktivitas produktif aktif (20260925)",
    migrations: Object.freeze([
      {
        filename: "20260922_timesheet_derived_time_contract.sql",
        sha256: "e290aec03a6a30b0997c21bd8057f0b2bba7cf3ec0e42a574df37955b407770a",
      },
      {
        filename: "20260922b_timesheet_freeze_and_audit.sql",
        sha256: "5922221a30350aa9488a1bafc3babab2199900c08de3e9852274239282a48411",
      },
      {
        filename: "20260923_timesheet_etl_pipeline.sql",
        sha256: "3b1addf8eb7d3310551346d7735399fa7e81ceb79bd4a74562ca2385bffd6d69",
      },
      {
        filename: "20260925_timesheet_unique_active_productive_op.sql",
        sha256: "e7c20b0c23ce172b07f60a9c49526d3f1a534fb650da62cd55cf830714022a54",
      },
    ]),
  }),
});

function loadEnv() {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

function computeFileSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const allowHistoricalDrift = argv.includes("--allow-historical-drift");
  const onlyArg = argv.find((arg) => arg.startsWith("--only="));
  const only = onlyArg
    ? onlyArg.slice("--only=".length).split(",").map((v) => v.trim()).filter(Boolean)
    : [];
  const releaseArg = argv.find((arg) => arg.startsWith("--release="));
  const release = releaseArg ? releaseArg.slice("--release=".length).trim() : null;
  const confirmReleaseArg = argv.find((arg) => arg.startsWith("--confirm-release="));
  const confirmRelease = confirmReleaseArg ? confirmReleaseArg.slice("--confirm-release=".length).trim() : null;
  const plantArg = argv.find((arg) => arg.startsWith("--plant="));
  const plant = plantArg ? plantArg.slice("--plant=".length).trim() : null;

  const validArgFlags = new Set(["--dry-run", "--allow-historical-drift"]);
  const unknown = argv.filter((arg) => {
    if (validArgFlags.has(arg)) return false;
    if (arg.startsWith("--only=")) return false;
    if (arg.startsWith("--release=")) return false;
    if (arg.startsWith("--confirm-release=")) return false;
    if (arg.startsWith("--plant=")) return false;
    return true;
  });
  if (unknown.length) throw new Error(`Argumen tidak dikenal: ${unknown.join(", ")}`);
  if (release && only.length) {
    throw new Error("Argumen --release tidak boleh digabungkan dengan --only.");
  }
  if (plant && !release) {
    throw new Error("Argumen --plant hanya berlaku bersama --release.");
  }
  return { dryRun, only, allowHistoricalDrift, release, confirmRelease, plant };
}


async function readAppliedFilenames(client, { dryRun }) {
  const exists = await client.query(
    "SELECT to_regclass('public.schema_migrations')::text AS ledger"
  );
  if (!exists.rows[0]?.ledger) {
    if (dryRun) {
      throw new Error("Ledger public.schema_migrations tidak ada; dry-run tidak boleh membuatnya");
    }
    await client.query(`
      CREATE TABLE public.schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now(),
        note text
      )`);
  }
  const rows = await client.query("SELECT filename FROM public.schema_migrations ORDER BY filename");
  return new Set(rows.rows.map((row) => row.filename));
}

function computeMigrationPlan(files, applied, only = []) {
  const sorted = [...files].sort();
  const missingOnly = only.filter((name) => !sorted.includes(name));
  if (missingOnly.length) {
    throw new Error(`Target --only tidak ditemukan di folder migration: ${missingOnly.join(", ")}`);
  }
  const maxApplied = [...applied].sort().at(-1) || null;
  const allUnapplied = sorted.filter((name) => !applied.has(name));
  const historicalDrift = maxApplied
    ? allUnapplied.filter((name) => name < maxApplied)
    : [];
  const pending = allUnapplied.filter((name) => !historicalDrift.includes(name));
  const requested = only.length ? only : pending;
  const selected = requested.filter((name) => pending.includes(name));
  const alreadyAppliedRequested = requested.filter((name) => applied.has(name));
  const ignoredPending = pending.filter((name) => !selected.includes(name));
  return {
    files: sorted,
    applied,
    maxApplied,
    allUnapplied,
    historicalDrift,
    pending,
    selected,
    ignoredPending,
    alreadyAppliedRequested,
  };
}

const DRIFT_ALLOWED_DATABASES = Object.freeze(["mps_timesheet_bpn_test", "mps_timesheet_ckp_test"]);
const LOOPBACK_IPS = Object.freeze(["127.0.0.1", "::1"]);

function ensureSafeApply(plan, args, host = "localhost", database = "mps_timesheet_ckp_test", serverAddr = null) {
  if (args.dryRun) return;
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (args.allowHistoricalDrift) {
    if (!isLocalHost) {
      throw new Error("--allow-historical-drift hanya diizinkan di host localhost/loopback.");
    }
    if (!DRIFT_ALLOWED_DATABASES.includes(database)) {
      throw new Error(
        `--allow-historical-drift ditolak untuk database "${database}". ` +
        `Hanya diizinkan untuk database test: ${DRIFT_ALLOWED_DATABASES.join(", ")}.`
      );
    }
    if (serverAddr && !LOOPBACK_IPS.includes(serverAddr)) {
      throw new Error(
        `--allow-historical-drift ditolak: inet_server_addr() "${serverAddr}" bukan loopback address.`
      );
    }
    if (!args.only.length) {
      throw new Error("--allow-historical-drift wajib digunakan bersama --only eksplisit.");
    }
  } else {
    if (plan.historicalDrift.length) {
      throw new Error(
        `${plan.historicalDrift.length} historical ledger drift terdeteksi; ` +
        "apply ditolak. Rekonsiliasi ledger berdasarkan bukti pada pekerjaan terpisah."
      );
    }
    if (plan.ignoredPending.length) {
      throw new Error(
        `${plan.ignoredPending.length} pending migration di luar --only; apply ditolak agar urutan tidak dilompati.`
      );
    }
  }
}

function printPlan(plan, args) {
  console.log(
    `ledger: ${plan.applied.size} tercatat | folder: ${plan.files.length} file | ` +
    `historical-drift: ${plan.historicalDrift.length} | pending: ${plan.pending.length}`
  );
  if (plan.historicalDrift.length) {
    console.log(
      `PERINGATAN: ${plan.historicalDrift.length} file lama tidak tercatat di ledger; ` +
      "dikarantina dan TIDAK akan dianggap kandidat apply."
    );
  }
  plan.selected.forEach((name) => console.log("  pending:", name));
  plan.alreadyAppliedRequested.forEach((name) => console.log("  already-applied:", name));
  if (args.only.length && plan.ignoredPending.length) {
    console.log(
      `  drift-terkarantina-di-luar-allowlist: ${plan.ignoredPending.length} file ` +
      "(nama tidak ditampilkan sebagai migration target)"
    );
  }
  if (args.dryRun) console.log("(dry-run read-only — tidak ada DDL/DML yang dijalankan)");
}

async function applySelected(client, plan) {
  for (const filename of plan.selected) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
    const noTx = /^--\s*migrate:no-transaction/.test(sql);
    process.stdout.write(`apply ${filename}${noTx ? " [no-tx]" : ""} ... `);
    try {
      if (noTx) {
        await client.query(sql);
        await client.query("INSERT INTO public.schema_migrations(filename) VALUES ($1)", [filename]);
      } else {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO public.schema_migrations(filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      }
      console.log("OK");
    } catch (err) {
      if (!noTx) await client.query("ROLLBACK").catch(() => {});
      throw new Error(`Migration ${filename} gagal: ${err.message}`);
    }
  }
}

function verifyReleaseManifest(manifest, migrationsDir) {
  if (!manifest || !Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
    throw new Error("Release manifest tidak valid atau kosong.");
  }
  const verifiedItems = [];
  for (const item of manifest.migrations) {
    const filePath = path.join(migrationsDir, item.filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File rilis '${item.filename}' tidak ditemukan di folder ${migrationsDir}.`);
    }
    const buf = fs.readFileSync(filePath);
    const actualHash = crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();
    if (actualHash !== item.sha256.toLowerCase()) {
      throw new Error(
        `Integritas file '${item.filename}' gagal: hash ${actualHash} tidak cocok dengan manifest '${item.sha256}'.`
      );
    }
    verifiedItems.push({
      filename: item.filename,
      expectedSha256: item.sha256.toLowerCase(),
      sql: buf.toString("utf8"),
    });
  }
  return verifiedItems;
}

const ALLOWED_TARGET_DATABASES = Object.freeze([
  "ptssb",
  "mps_timesheet_ckp_test",
  "mps_timesheet_bpn_test",
  "mps2_test_migrate_manifest",
]);

const RELEASE_PLANT_TIMEZONES = Object.freeze({
  "5100": "Asia/Jakarta",
  "5051": "Asia/Makassar",
});

async function verifyTargetDatabase(client, { plant = null } = {}) {
  // 1. Verifikasi ledger schema_migrations ada
  const exists = await client.query("SELECT to_regclass('public.schema_migrations')::text AS ledger");
  if (!exists.rows[0]?.ledger) {
    throw new Error("Ledger public.schema_migrations tidak ditemukan; proses dibatalkan.");
  }

  // 2. Verifikasi nama database target aman
  const currentDbRes = await client.query("SELECT current_database() AS dbname");
  const dbname = currentDbRes.rows[0]?.dbname || client.database;
  if (!ALLOWED_TARGET_DATABASES.includes(dbname)) {
    throw new Error(
      `Database target '${dbname}' bukan database rilis Cikupa yang diizinkan (${ALLOWED_TARGET_DATABASES.join(", ")}).`
    );
  }

  // 3. plant_config must match the plant the operator named (--plant, default 5100)
  //    and that plant's timezone, so a mistyped DB_HOST cannot migrate the other plant.
  const expectedPlant = plant || "5100";
  const expectedTimezone = RELEASE_PLANT_TIMEZONES[expectedPlant];
  if (!expectedTimezone) {
    throw new Error(
      `Plant '${expectedPlant}' tidak dikenal untuk rilis (diizinkan: ${Object.keys(RELEASE_PLANT_TIMEZONES).join(", ")}).`
    );
  }
  const plantCfgExists = await client.query("SELECT to_regclass('public.plant_config')::text AS tbl");
  if (!plantCfgExists.rows[0]?.tbl) {
    throw new Error("Tabel public.plant_config tidak ditemukan di database target.");
  }
  const plantRes = await client.query("SELECT plant_code, timezone FROM public.plant_config WHERE id = 1");
  const plantCode = plantRes.rows[0]?.plant_code;
  const timezone = plantRes.rows[0]?.timezone;
  if (plantCode !== expectedPlant) {
    throw new Error(
      `Target plant_config.plant_code bukan '${expectedPlant}' (ditemukan: '${plantCode}'); migrasi dibatalkan demi keamanan.`
    );
  }
  if (timezone !== expectedTimezone) {
    throw new Error(
      `Target plant_config.timezone '${timezone}' tidak cocok dengan plant ${expectedPlant} ('${expectedTimezone}'); migrasi dibatalkan.`
    );
  }
}

function computeManifestPlan(manifest, applied, migrationsDir = MIGRATIONS_DIR) {
  const verifiedItems = verifyReleaseManifest(manifest, migrationsDir);
  const itemMap = new Map(verifiedItems.map((v) => [v.filename, v]));

  const filenames = manifest.migrations.map((m) => m.filename);
  const selected = [];
  const alreadyApplied = [];

  let seenPending = false;
  for (const filename of filenames) {
    if (applied.has(filename)) {
      if (seenPending) {
        throw new Error(
          `Inkonsistensi ledger: migrasi '${filename}' sudah tercatat di ledger, tetapi migrasi rilis sebelumnya belum tercatat.`
        );
      }
      alreadyApplied.push(filename);
    } else {
      seenPending = true;
      selected.push(itemMap.get(filename));
    }
  }

  return {
    manifest,
    applied,
    filenames,
    selected,
    pending: selected.map((s) => s.filename),
    alreadyApplied,
  };
}

async function ensureSafeManifestApply(client, plan, args) {
  // Identity checks are SELECT-only, so dry-run runs them too: a dry-run that passes
  // against the wrong plant would be a false green.
  if (args.dryRun) {
    await verifyTargetDatabase(client, args);
    return;
  }
  if (!args.confirmRelease) {
    throw new Error(
      `Apply rilis sempit '${plan.manifest.releaseId}' memerlukan argumen konfirmasi eksplisit --confirm-release=${plan.manifest.releaseId}.`
    );
  }
  if (args.confirmRelease !== plan.manifest.releaseId) {
    throw new Error(
      `Konfirmasi rilis '${args.confirmRelease}' tidak cocok dengan manifest target '${plan.manifest.releaseId}'.`
    );
  }

  // Verifikasi target database dan plant_code sebelum write apa pun
  await verifyTargetDatabase(client, args);
}

function printManifestPlan(plan, args) {
  console.log(
    `[RELEASE MANIFEST] id: ${plan.manifest.releaseId} | ledger: ${plan.applied.size} tercatat | ` +
    `target: ${plan.filenames.length} file | pending: ${plan.selected.length} | already-applied: ${plan.alreadyApplied.length}`
  );
  console.log(`  deskripsi: ${plan.manifest.description}`);
  plan.alreadyApplied.forEach((name) => console.log("  already-applied:", name));
  plan.selected.forEach((item) => console.log("  pending (terverifikasi in-memory):", item.filename));
  if (args.dryRun) console.log("(dry-run read-only — tidak ada DDL/DML yang dijalankan)");
}

async function applyManifestSelected(client, plan) {
  for (const item of plan.selected) {
    const { filename, sql } = item;
    const noTx = /^--\s*migrate:no-transaction/.test(sql);
    process.stdout.write(`apply ${filename}${noTx ? " [no-tx]" : ""} ... `);
    try {
      if (noTx) {
        await client.query(sql);
        await client.query("INSERT INTO public.schema_migrations(filename) VALUES ($1)", [filename]);
      } else {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO public.schema_migrations(filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      }
      console.log("OK");
    } catch (err) {
      if (!noTx) await client.query("ROLLBACK").catch(() => {});
      throw new Error(`Migration ${filename} gagal: ${err.message}`);
    }
  }
}

function createEnvClient() {
  loadEnv();
  return new Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ptssb",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
}

// `createClient` exists so tests can drive main() with a mock client; without it,
// main() would read the repo-root .env, which points at a production plant.
async function main(argv = process.argv.slice(2), { createClient = createEnvClient } = {}) {
  const args = parseArgs(argv);
  const client = createClient();
  await client.connect();
  try {
    let serverAddr = null;
    try {
      const addrRes = await client.query("SELECT inet_server_addr() AS addr");
      serverAddr = addrRes.rows[0]?.addr ? String(addrRes.rows[0].addr).trim() : null;
    } catch (_) {}
    // A release never creates the ledger: a missing ledger means the target is not the
    // database the manifest was written for, so it must fail before any write.
    const applied = await readAppliedFilenames(client, { dryRun: args.dryRun || Boolean(args.release) })
      .catch((err) => {
        if (args.release && /schema_migrations tidak ada/.test(err.message)) {
          throw new Error("Ledger public.schema_migrations tidak ditemukan; proses dibatalkan.");
        }
        throw err;
      });

    if (args.release) {
      const manifest = RELEASE_MANIFESTS[args.release];
      if (!manifest) {
        throw new Error(
          `Release manifest '${args.release}' tidak dikenal. Manifest tersedia: ${Object.keys(RELEASE_MANIFESTS).join(", ")}`
        );
      }
      const plan = computeManifestPlan(manifest, applied, MIGRATIONS_DIR);
      printManifestPlan(plan, args);
      await ensureSafeManifestApply(client, plan, args);
      if (!args.dryRun) await applyManifestSelected(client, plan);
    } else {
      const files = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
      const plan = computeMigrationPlan(files, applied, args.only);
      printPlan(plan, args);
      ensureSafeApply(plan, args, client.host, client.database, serverAddr);
      if (!args.dryRun) await applySelected(client, plan);
    }
  } finally {
    await client.end();
  }
}


module.exports = {
  RELEASE_MANIFESTS,
  computeFileSha256,
  verifyReleaseManifest,
  computeManifestPlan,
  ensureSafeManifestApply,
  printManifestPlan,
  applyManifestSelected,
  parseArgs,
  readAppliedFilenames,
  computeMigrationPlan,
  ensureSafeApply,
  printPlan,
  applySelected,
  main,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

