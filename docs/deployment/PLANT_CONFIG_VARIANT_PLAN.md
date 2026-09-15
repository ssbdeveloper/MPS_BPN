# Plant Config & Variant Profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Satu sumber kebenaran per-plant (`plant_config` di DB tiap plant) untuk identitas plant + varian + timezone, dengan backend memuatnya saat startup + endpoint `GET /config`, dan frontend menentukan varian dari `/config` saat boot (satu build untuk semua plant).

**Architecture:** Tabel single-row `public.plant_config` (typed + `jsonb`). Backend `apps/api` memuatnya sekali di `startServer()` ke cache in-memory dan expose subset publik lewat `GET /config`. Frontend `apps/web` fetch `/api/config` sebelum render, cache di `localStorage`, dan `appVariant.js` menurunkan varian dari config termuat. Fallback env selama transisi.

**Tech Stack:** Express 4 (CommonJS), pg (`global.pool`), React 19 + Vite 7, `node:test` (Node 20 built-in), PostgreSQL 15, runner `database/migrate.js`.

## Global Constraints

- Design kanonik: `docs/deployment/PLANT_CONFIG_VARIANT_DESIGN.md` — jangan litigasi ulang skema.
- Migrasi: file di `database/migrations/api/`, nama `YYYYMMDD_deskripsi.sql`, **JANGAN tulis BEGIN/COMMIT** (runner membungkus), idempotent (`IF NOT EXISTS`).
- Pool access backend: `const db = global.pool || require("../db")`; query `db.query(text, params)` → `result.rows`. OID date/timestamp sudah di-string oleh app.
- Timezone: IANA-validated (pola `config/timezone.js`), jangan hard-code literal.
- Offline-first: tak boleh aset eksternal; frontend fallback ke `localStorage`.
- Commit hanya bila diminta user (aturan sesi) — plan menyertakan langkah commit tapi eksekutor menahannya sampai user minta.
- **Deviasi dari design (pasca-scout):** (1) jobs (`jobs/etl`, `jobs/sap_staging`) **di luar cakupan** — terblokir build-context Docker per-subfolder, jadi follow-up; jobs tetap baca env. (2) Backend test = `node:test` (nol dep). (3) Frontend tanpa test-runner baru → verifikasi `npm run build` + `npm run lint`. (4) `vite.config.js` tak diubah — `/api/config` sudah tercakup SW `api-cache` NetworkFirst. (5) Fallback varian backend via env `APP_VARIANT` (di-source dari `VITE_APP_VARIANT` root `.env`).

---

### Task 1: Migrasi tabel `plant_config`

**Files:**
- Create: `database/migrations/api/20260727_plant_config.sql`

**Interfaces:**
- Produces: tabel `public.plant_config` (single-row, `id=1`), kolom sesuai design §3.

- [ ] **Step 1: Tulis migrasi**

```sql
-- Tabel konfigurasi per-plant (single-row). Sumber kebenaran identitas plant + varian + timezone.
-- Design: docs/deployment/PLANT_CONFIG_VARIANT_DESIGN.md
-- Runner membungkus BEGIN/COMMIT — jangan tulis sendiri.

CREATE TABLE IF NOT EXISTS public.plant_config (
  id                 integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  plant_code         text NOT NULL,
  plant_name         text NOT NULL,
  variant            text NOT NULL CHECK (variant IN ('salvaging','manufacturing')),
  timezone           text NOT NULL,
  order_master_table text NOT NULL DEFAULT 'ph3_order',
  plant_filter       text,
  feature_flags      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sap_rules          jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by         text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plant_config IS
  'Single-row per-plant config: identitas plant + varian + timezone. Diisi via apps/api/scripts/seed_plant_config.js. Lihat docs/deployment/PLANT_CONFIG_VARIANT_DESIGN.md';
```

- [ ] **Step 2: Dry-run runner**

Run (dari repo root): `node database/migrate.js --dry-run`
Expected: daftar pending memuat `20260727_plant_config.sql`.

- [ ] **Step 3: (Aplikasi ke DB dilakukan di fase rollout, bukan di sini)** — jangan apply otomatis; tabel dibuat saat rollout terkontrol.

- [ ] **Step 4: Commit** (tahan sampai user minta)

```bash
git add database/migrations/api/20260727_plant_config.sql
git commit -m "feat(config): migrasi tabel plant_config (single-row per-plant)"
```

---

### Task 2: Backend loader `plantConfig.js`

**Files:**
- Create: `apps/api/config/plantConfig.js`
- Test: `apps/api/config/plantConfig.test.js` (Task 3)

**Interfaces:**
- Consumes: `db` (pg pool dengan `.query`), `process.env`.
- Produces:
  - `buildConfigFromEnv(env)` → object config lengkap dari env (pure, no DB).
  - `parseRow(row)` → object config dari baris DB (pure).
  - `toPublicSubset(config)` → `{ plant_code, plant_name, variant, timezone, feature_flags }` (pure).
  - `async loadPlantConfig(db)` → memuat dari DB (fallback env), set cache, return config.
  - `getPlantConfig()` → config tercache (throw bila belum dimuat).
  - `getPublicConfig()` → `toPublicSubset(getPlantConfig())`.
  - `async reloadPlantConfig(db)` → muat ulang.

- [ ] **Step 1: Tulis modul**

```js
"use strict";

// Single source of truth untuk profil per-plant (identitas + varian + timezone).
// Baris tunggal public.plant_config (id=1). Dimuat sekali saat startup ke cache,
// dengan fallback env selama transisi (sebelum baris di-seed).
// Design: docs/deployment/PLANT_CONFIG_VARIANT_DESIGN.md

const IANA_ZONE = /^[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)+$/;
const DEFAULT_TIMEZONE = "Asia/Makassar";
const VALID_VARIANTS = ["salvaging", "manufacturing"];

function normalizeVariant(raw) {
  const v = String(raw || "").split("#")[0].trim().split(/\s+/)[0].toLowerCase();
  return VALID_VARIANTS.includes(v) ? v : "salvaging";
}

function safeTimezone(raw) {
  const tz = String(raw || "").trim();
  return IANA_ZONE.test(tz) ? tz : DEFAULT_TIMEZONE;
}

// Bangun config dari env (fallback bila baris plant_config belum ada).
// Catatan: variant TIDAK ada env var di container api kecuali APP_VARIANT
// (di-source dari VITE_APP_VARIANT root .env via compose). Default 'salvaging'.
function buildConfigFromEnv(env) {
  const e = env || {};
  const flags = {};
  const variant = normalizeVariant(e.APP_VARIANT);
  return {
    plant_code: String(e.PLANT_SSB || "").trim() || "unknown",
    plant_name: String(e.PLANT_NAME || "").trim() || String(e.PLANT_SSB || "unknown").trim(),
    variant,
    timezone: safeTimezone(e.TIMEZONE),
    order_master_table: String(e.TGT_TABLE || "ph3_order").trim(),
    plant_filter: e.PLANT_FILTER ? String(e.PLANT_FILTER).trim() : null,
    feature_flags: flags,
    sap_rules: {},
    _source: "env-fallback",
  };
}

function parseRow(row) {
  return {
    plant_code: row.plant_code,
    plant_name: row.plant_name,
    variant: normalizeVariant(row.variant),
    timezone: safeTimezone(row.timezone),
    order_master_table: row.order_master_table || "ph3_order",
    plant_filter: row.plant_filter || null,
    feature_flags: row.feature_flags || {},
    sap_rules: row.sap_rules || {},
    _source: "db",
  };
}

function toPublicSubset(config) {
  return {
    plant_code: config.plant_code,
    plant_name: config.plant_name,
    variant: config.variant,
    timezone: config.timezone,
    feature_flags: config.feature_flags || {},
  };
}

let cached = null;

async function loadPlantConfig(db) {
  try {
    const result = await db.query(
      "SELECT * FROM public.plant_config WHERE id = 1 LIMIT 1"
    );
    if (result.rows && result.rows.length > 0) {
      cached = parseRow(result.rows[0]);
    } else {
      cached = buildConfigFromEnv(process.env);
      console.warn(
        "[plantConfig] baris plant_config tak ada — pakai fallback env " +
          `(variant=${cached.variant}). Seed via scripts/seed_plant_config.js.`
      );
    }
  } catch (err) {
    cached = buildConfigFromEnv(process.env);
    console.warn(
      `[plantConfig] gagal baca plant_config (${err.message}) — pakai fallback env.`
    );
  }
  console.log(
    `[plantConfig] loaded: plant=${cached.plant_code} variant=${cached.variant} ` +
      `tz=${cached.timezone} source=${cached._source}`
  );
  return cached;
}

function getPlantConfig() {
  if (!cached) throw new Error("plantConfig belum dimuat — panggil loadPlantConfig(db) dulu");
  return cached;
}

function getPublicConfig() {
  return toPublicSubset(getPlantConfig());
}

async function reloadPlantConfig(db) {
  return loadPlantConfig(db);
}

module.exports = {
  buildConfigFromEnv,
  parseRow,
  toPublicSubset,
  normalizeVariant,
  safeTimezone,
  loadPlantConfig,
  getPlantConfig,
  getPublicConfig,
  reloadPlantConfig,
  DEFAULT_TIMEZONE,
  VALID_VARIANTS,
};
```

- [ ] **Step 2: Commit** (tahan sampai user minta)

```bash
git add apps/api/config/plantConfig.js
git commit -m "feat(config): backend plantConfig loader + env fallback + public subset"
```

---

### Task 3: Test loader (`node:test`)

**Files:**
- Create: `apps/api/config/plantConfig.test.js`
- Modify: `apps/api/package.json` (script `test`)

**Interfaces:**
- Consumes: exports Task 2 (`buildConfigFromEnv`, `parseRow`, `toPublicSubset`, `normalizeVariant`).

- [ ] **Step 1: Tulis test (harus GAGAL dulu bila modul belum ada — tapi Task 2 sudah bikin; jalankan untuk konfirmasi PASS)**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const pc = require("./plantConfig");

test("buildConfigFromEnv memetakan env ke config", () => {
  const c = pc.buildConfigFromEnv({
    PLANT_SSB: "5051", PLANT_NAME: "Cikupa", APP_VARIANT: "manufacturing",
    TIMEZONE: "Asia/Makassar", TGT_TABLE: "ph3_order", PLANT_FILTER: "5051",
  });
  assert.equal(c.plant_code, "5051");
  assert.equal(c.plant_name, "Cikupa");
  assert.equal(c.variant, "manufacturing");
  assert.equal(c.timezone, "Asia/Makassar");
  assert.equal(c.order_master_table, "ph3_order");
  assert.equal(c.plant_filter, "5051");
  assert.equal(c._source, "env-fallback");
});

test("variant tak dikenal jatuh ke salvaging", () => {
  assert.equal(pc.normalizeVariant("bogus"), "salvaging");
  assert.equal(pc.normalizeVariant(""), "salvaging");
  assert.equal(pc.normalizeVariant("manufacturing # comment"), "manufacturing");
});

test("timezone invalid jatuh ke default", () => {
  assert.equal(pc.safeTimezone("not a zone"), pc.DEFAULT_TIMEZONE);
  assert.equal(pc.safeTimezone("Asia/Jakarta"), "Asia/Jakarta");
});

test("toPublicSubset tak membocorkan sap_rules/plant_filter/order_master_table", () => {
  const full = pc.parseRow({
    plant_code: "5051", plant_name: "Cikupa", variant: "manufacturing",
    timezone: "Asia/Makassar", order_master_table: "ph3_order", plant_filter: "5051",
    feature_flags: { ms_project: true }, sap_rules: { zconf: "secret" },
  });
  const pub = pc.toPublicSubset(full);
  assert.deepEqual(Object.keys(pub).sort(), ["feature_flags", "plant_code", "plant_name", "timezone", "variant"]);
  assert.equal(pub.sap_rules, undefined);
  assert.equal(pub.plant_filter, undefined);
  assert.equal(pub.order_master_table, undefined);
  assert.deepEqual(pub.feature_flags, { ms_project: true });
});
```

- [ ] **Step 2: Update `apps/api/package.json` script `test`**

Ganti baris `"test": "echo \"Error: no test specified\" && exit 1"` menjadi:
```json
"test": "node --test"
```

- [ ] **Step 3: Jalankan test**

Run (dari `apps/api`): `node --test config/plantConfig.test.js`
Expected: `# pass 4  # fail 0`.

- [ ] **Step 4: Commit** (tahan sampai user minta)

```bash
git add apps/api/config/plantConfig.test.js apps/api/package.json
git commit -m "test(config): node:test untuk plantConfig loader"
```

---

### Task 4: Route `GET /config` + wiring di `server.js`

**Files:**
- Create: `apps/api/routes/config.js`
- Modify: `apps/api/server.js` (mount route dekat baris 184–203; startup load setelah `connected = true` ~baris 259)

**Interfaces:**
- Consumes: `getPublicConfig`, `loadPlantConfig` (Task 2).
- Produces: `GET /config` → JSON subset publik.

- [ ] **Step 1: Tulis route**

```js
"use strict";
const express = require("express");
const router = express.Router();
const { getPublicConfig } = require("../config/plantConfig");

// GET /config — subset publik profil plant (dipakai frontend saat boot).
router.get("/", (req, res) => {
  try {
    res.set("Cache-Control", "public, max-age=60");
    res.json(getPublicConfig());
  } catch (err) {
    res.status(503).json({ error: "plant config belum siap" });
  }
});

module.exports = router;
```

- [ ] **Step 2: Mount route di `server.js`** (di area mount router, bersama `app.use('/ews', ...)`):

```js
app.use('/config', require('./routes/config'));
```

- [ ] **Step 3: Load saat startup di `server.js`** — di `startServer()`, tepat setelah `connected = true;` (sebelum `server.listen`), tambahkan:

```js
    // Muat profil plant sekali ke cache sebelum melayani request.
    await require('./config/plantConfig').loadPlantConfig(global.pool);
```

- [ ] **Step 4: Verifikasi manual** — jalankan API lokal terhubung tunnel DB (port 3001), lalu:

Run: `curl -s http://localhost:3001/config`
Expected: JSON `{plant_code, plant_name, variant, timezone, feature_flags}` (dari baris DB bila ada, atau fallback env).

- [ ] **Step 5: Commit** (tahan sampai user minta)

```bash
git add apps/api/routes/config.js apps/api/server.js
git commit -m "feat(config): GET /config + load plantConfig saat startup"
```

---

### Task 5: `config/timezone.js` baca dari plantConfig

**Files:**
- Modify: `apps/api/config/timezone.js`

**Interfaces:**
- Consumes: `getPlantConfig` (Task 2).
- Produces: `resolveTimezone()` mengembalikan `plantConfig.timezone` bila termuat, else fallback env (kontrak lama dipertahankan).

- [ ] **Step 1: Refactor `resolveTimezone`**

```js
"use strict";

// Single source of truth timezone aplikasi.
// Prioritas: plant_config.timezone (bila plantConfig sudah dimuat) → env TIMEZONE → default.
// Divalidasi IANA agar aman diinterpolasi ke SQL.

const DEFAULT_TIMEZONE = "Asia/Makassar";
const IANA_ZONE = /^[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)+$/;

function validTz(raw) {
  const s = String(raw || "").trim();
  return IANA_ZONE.test(s) ? s : null;
}

function resolveTimezone() {
  try {
    const { getPlantConfig } = require("./plantConfig");
    const fromConfig = validTz(getPlantConfig().timezone);
    if (fromConfig) return fromConfig;
  } catch (_) { /* plantConfig belum dimuat — fallback ke env */ }
  return validTz(process.env.TIMEZONE) || DEFAULT_TIMEZONE;
}

module.exports = { resolveTimezone, DEFAULT_TIMEZONE };
```

- [ ] **Step 2: Commit** (tahan sampai user minta)

```bash
git add apps/api/config/timezone.js
git commit -m "refactor(config): timezone dari plantConfig (fallback env)"
```

---

### Task 6: Seed script `seed_plant_config.js`

**Files:**
- Create: `apps/api/scripts/seed_plant_config.js`

**Interfaces:**
- Consumes: root `.env` (`PLANT_SSB`, `PLANT_NAME`?, `VITE_APP_VARIANT`, `TIMEZONE`, `TGT_TABLE`, `PLANT_FILTER`), `DB_*`.
- Produces: UPSERT baris `plant_config` (id=1) dari env. Idempotent.

- [ ] **Step 1: Tulis script** (pola `reset-password.js` — inline `.env` parser + `pg.Client`)

```js
"use strict";
// Seed/upsert baris tunggal public.plant_config (id=1) dari root .env.
// Jalankan per-deployment (env plant itu) SETELAH migrasi plant_config.
// Idempotent: UPDATE bila sudah ada. Varian dari VITE_APP_VARIANT.
//   node apps/api/scripts/seed_plant_config.js
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..", "..", "..");
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
} catch { /* .env opsional bila DB_* sudah di env */ }

function variantFromEnv() {
  const v = String(process.env.VITE_APP_VARIANT || process.env.APP_VARIANT || "salvaging")
    .split("#")[0].trim().split(/\s+/)[0].toLowerCase();
  return ["salvaging", "manufacturing"].includes(v) ? v : "salvaging";
}

async function main() {
  const variant = variantFromEnv();
  const plantCode = String(process.env.PLANT_SSB || "").trim();
  if (!plantCode) throw new Error("PLANT_SSB wajib ada di .env untuk seed plant_config");
  const plantName = String(process.env.PLANT_NAME || plantCode).trim();
  const timezone = String(process.env.TIMEZONE || "Asia/Makassar").trim();
  const tgtTable = String(process.env.TGT_TABLE || "ph3_order").trim();
  const plantFilter = process.env.PLANT_FILTER ? String(process.env.PLANT_FILTER).trim() : null;
  const featureFlags = { ews: true, machine_hours: true, ms_project: variant === "manufacturing" };

  const client = new Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ptssb",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    application_name: "seed-plant-config",
  });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO public.plant_config
         (id, plant_code, plant_name, variant, timezone, order_master_table, plant_filter, feature_flags, updated_by, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7::jsonb, 'seed-script', now())
       ON CONFLICT (id) DO UPDATE SET
         plant_code = EXCLUDED.plant_code, plant_name = EXCLUDED.plant_name,
         variant = EXCLUDED.variant, timezone = EXCLUDED.timezone,
         order_master_table = EXCLUDED.order_master_table, plant_filter = EXCLUDED.plant_filter,
         feature_flags = EXCLUDED.feature_flags, updated_by = 'seed-script', updated_at = now()`,
      [plantCode, plantName, variant, timezone, tgtTable, plantFilter, JSON.stringify(featureFlags)]
    );
    const { rows } = await client.query("SELECT plant_code, plant_name, variant, timezone FROM public.plant_config WHERE id = 1");
    console.log("plant_config seeded:", rows[0]);
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error("seed gagal:", e.message); process.exitCode = 1; });
```

- [ ] **Step 2: Verifikasi (fase rollout, bukan di sini)** — dijalankan terkontrol per-plant.

- [ ] **Step 3: Commit** (tahan sampai user minta)

```bash
git add apps/api/scripts/seed_plant_config.js
git commit -m "feat(config): seed script plant_config dari .env"
```

---

### Task 7: Frontend `loadConfig.js`

**Files:**
- Create: `apps/web/src/config/loadConfig.js`

**Interfaces:**
- Produces:
  - `async loadConfig()` → fetch `${VITE_API_URL||'/api'}/config`, simpan singleton + `localStorage('plant_config')`; gagal → cache localStorage; tak ada → throw.
  - `getConfig()` → singleton (atau null bila belum dimuat).

- [ ] **Step 1: Tulis modul**

```js
// Muat profil plant dari backend saat boot; cache di localStorage untuk offline.
const API_BASE = import.meta.env.VITE_API_URL || "/api";
const LS_KEY = "plant_config";

let current = null;

export function getConfig() {
  return current;
}

export async function loadConfig() {
  try {
    const res = await fetch(`${API_BASE}/config`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    current = data;
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (_) { /* ignore quota */ }
    return current;
  } catch (err) {
    const cachedRaw = (() => { try { return localStorage.getItem(LS_KEY); } catch (_) { return null; } })();
    if (cachedRaw) {
      try {
        current = JSON.parse(cachedRaw);
        console.warn("[loadConfig] pakai cache localStorage (offline/backend tak tersedia)");
        return current;
      } catch (_) { /* cache korup */ }
    }
    throw new Error("Konfigurasi plant tak tersedia — cek koneksi ke server");
  }
}
```

- [ ] **Step 2: Commit** (tahan sampai user minta)

```bash
git add apps/web/src/config/loadConfig.js
git commit -m "feat(config): frontend loadConfig (fetch /config + cache localStorage)"
```

---

### Task 8: Refactor `appVariant.js` → fungsi baca config termuat

**Files:**
- Modify: `apps/web/src/config/appVariant.js`

**Interfaces:**
- Consumes: `getConfig` (Task 7).
- Produces: `getVariant()`, `isManufacturing()`, `isSalvaging()`, `getFeatureFlags()` (SEMUA fungsi — bukan const lagi).

- [ ] **Step 1: Ganti isi file**

```js
import { getConfig } from './loadConfig';

// Varian kini runtime (dari /config), bukan build-time VITE_APP_VARIANT.
export function getVariant() {
  const v = String(getConfig()?.variant || 'salvaging').toLowerCase();
  return v === 'manufacturing' ? 'manufacturing' : 'salvaging';
}

export function isManufacturing() {
  return getVariant() === 'manufacturing';
}

export function isSalvaging() {
  return !isManufacturing();
}

export function getFeatureFlags() {
  return getConfig()?.feature_flags || {};
}
```

- [ ] **Step 2: Commit** (tahan sampai user minta)

```bash
git add apps/web/src/config/appVariant.js
git commit -m "refactor(config): appVariant sebagai fungsi baca config runtime"
```

---

### Task 9: `main.jsx` await loadConfig sebelum render

**Files:**
- Modify: `apps/web/src/main.jsx`

**Interfaces:**
- Consumes: `loadConfig` (Task 7).

- [ ] **Step 1: Ganti isi `main.jsx`**

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { loadConfig } from './config/loadConfig'

const root = createRoot(document.getElementById('root'))

loadConfig()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch((err) => {
    root.render(
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: '#334155', background: '#f8fafc' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Konfigurasi plant tak tersedia</div>
          <div style={{ fontSize: 14, color: '#64748b' }}>{String(err?.message || err)}</div>
        </div>
      </div>,
    )
  })
```

- [ ] **Step 2: Commit** (tahan sampai user minta)

```bash
git add apps/web/src/main.jsx
git commit -m "feat(config): await loadConfig sebelum render + layar error fallback"
```

---

### Task 10: Update 3 dispatcher (`isManufacturing` → `isManufacturing()`)

**Files:**
- Modify: `apps/web/src/pages/TIMESHEET/SelectJobPage.jsx`
- Modify: `apps/web/src/pages/PPC/SowSchedulingPage.jsx`
- Modify: `apps/web/src/pages/TIMESHEET/TimesheetMainMenuPage.jsx`

**Interfaces:**
- Consumes: `isManufacturing()` (Task 8, sekarang fungsi).

- [ ] **Step 1: Di tiap file, ubah call-site** dari `return isManufacturing ? A : B;` menjadi `return isManufacturing() ? A : B;` (import line tetap `import { isManufacturing } from '.../config/appVariant';`).

Contoh (`SelectJobPage.jsx`):
```jsx
return isManufacturing() ? <ManufacturingSelectJobPage /> : <SalvagingSelectJobPage />;
```
(Sama untuk `SowSchedulingPage.jsx` → `<ManufacturingSowSchedulingPage/>/<SalvagingSowSchedulingPage/>` dan `TimesheetMainMenuPage.jsx` → `<ManufacturingTimesheetMainMenu/>/<SalvagingTimesheetMainMenu/>`.)

- [ ] **Step 2: Verifikasi tak ada pemakaian `isManufacturing` non-fungsi tersisa**

Run (dari `apps/web`): `grep -rn "isManufacturing" src` — semua pemakaian harus `isManufacturing()`.

- [ ] **Step 3: Commit** (tahan sampai user minta)

```bash
git add apps/web/src/pages/TIMESHEET/SelectJobPage.jsx apps/web/src/pages/PPC/SowSchedulingPage.jsx apps/web/src/pages/TIMESHEET/TimesheetMainMenuPage.jsx
git commit -m "refactor(config): dispatcher pakai isManufacturing() (runtime)"
```

---

### Task 11: Deploy config — env `api` + hapus build-arg frontend

**Files:**
- Modify: `docker-compose.yml` (service `api` env: tambah `APP_VARIANT`; service `frontend` build args: hapus `VITE_APP_VARIANT`)
- Modify: `apps/web/Dockerfile` (hapus ARG/ENV `VITE_APP_VARIANT`)

**Interfaces:**
- Produces: env `APP_VARIANT` untuk fallback loader backend; frontend build tak lagi butuh varian.

- [ ] **Step 1: `docker-compose.yml` service `api` environment** — tambahkan baris (dekat `PLANT_SSB`):
```yaml
      - APP_VARIANT=${VITE_APP_VARIANT:-salvaging}
```

- [ ] **Step 2: `docker-compose.yml` service `frontend` build args** — hapus baris:
```yaml
        VITE_APP_VARIANT: ${VITE_APP_VARIANT:-salvaging}
```

- [ ] **Step 3: `apps/web/Dockerfile`** — hapus dua baris:
```dockerfile
ARG VITE_APP_VARIANT=salvaging
ENV VITE_APP_VARIANT=$VITE_APP_VARIANT
```

- [ ] **Step 4: Commit** (tahan sampai user minta)

```bash
git add docker-compose.yml apps/web/Dockerfile
git commit -m "chore(config): APP_VARIANT ke api env; hapus build-arg VITE_APP_VARIANT frontend"
```

---

### Task 12: Verifikasi menyeluruh

- [ ] **Step 1: Backend test** — dari `apps/api`: `node --test config/plantConfig.test.js` → `# pass 4 # fail 0`.
- [ ] **Step 2: Backend syntax** — dari `apps/api`: `node -e "require('./config/plantConfig'); require('./routes/config'); console.log('ok')"` → `ok`.
- [ ] **Step 3: Frontend build** — dari `apps/web`: `npm run build` → sukses tanpa error (khususnya tak ada referensi `import.meta.env.VITE_APP_VARIANT` tersisa; tak ada import rusak).
- [ ] **Step 4: Frontend lint** — dari `apps/web`: `npm run lint` → tanpa error baru.
- [ ] **Step 5: grep sisa** — `grep -rn "VITE_APP_VARIANT" apps/web/src` → kosong (tak ada konsumen tersisa di src).

---

## Rollout (fase terpisah, terkontrol — BUKAN bagian eksekusi kode)

Per plant (balikpapan=salvaging, cikupa=manufacturing), urutan:
1. `node database/migrate.js` (apply migrasi `plant_config`).
2. `node apps/api/scripts/seed_plant_config.js` (seed baris dari `.env` plant itu; **verifikasi `variant`/`plant_name`/`feature_flags` benar** — jangan tebak).
3. Deploy API (load plantConfig saat startup; sebelum seed, fallback env aktif).
4. Deploy frontend (fetch `/config`).
5. Verifikasi: `/config` benar, dispatcher benar, feature-flag benar.
6. (Cleanup batch berikut) buang fallback env + build-arg sisa.

## Follow-up (di luar plan ini)

- Jobs (`jobs/etl`, `jobs/sap_staging`) baca `plant_config` → butuh pelebaran build-context Docker ke `./jobs` (pola `sow_exporter`) + `jobs/common/plant_config.py`.
- Aturan SAP data-driven → `sap_rules` (BLOCKED PRD D2/D3).
- 4 literal `ph3_order` → `order_master_table` (PRD B4/FR-6).
- `PUT /config` + halaman admin edit (fase-2).

## Self-Review

- **Spec coverage:** design §3 tabel→Task 1; §4 loader/route/timezone→Task 2,4,5; §5 frontend→Task 7,8,9,10; §6 rollout→bagian Rollout; §7 seam sap_rules→kolom di Task 1 (reserved) + follow-up; §8 non-goals→jobs di follow-up. ✔
- **Placeholder scan:** semua step berisi kode nyata; tak ada TODO/TBD. ✔
- **Type consistency:** `isManufacturing()` fungsi (Task 8) dipakai fungsi di Task 10; `getPublicConfig`/`loadPlantConfig` konsisten Task 2↔4; `getConfig`/`loadConfig` konsisten Task 7↔8↔9. ✔
