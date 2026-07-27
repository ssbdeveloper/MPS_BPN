---
type: design
status: active
tags: [domain/ops, domain/timesheet]
updated: 2026-07-27
---

# Design — Per-Plant Configuration & Variant Profile

> Tujuan: satu sumber kebenaran per plant untuk **identitas plant + varian
> (salvaging/manufacturing) + timezone + parameter deploy**, menggantikan tebaran
> `.env` + build-arg frontend + hard-code. Sehingga frontend & backend tak bisa beda
> diam-diam, dan menyalakan plant baru = seed satu baris, bukan merakit env satu-satu.
>
> **Status: active** — design disepakati (brainstorming 2026-07-27); **kode implementasi
> SELESAI 2026-07-27** (plan + hasil: [[PLANT_CONFIG_VARIANT_PLAN]]; backend `node:test` 4/4,
> frontend build sukses, lint bersih, review adversarial 0 temuan). **Pending rollout**
> (migrate + seed + deploy per plant — belum di-apply ke DB manapun). Bagian di bawah = desain final.

Terkait: [[prd/manufacturing-variant]] (perbedaan varian per fitur), [[REFACTOR_PLAN]]
(F-R4). **Design ini secara sadar merevisi F-R4** ("varian build-time") → varian jadi
**runtime-config fetch** (bukan runtime-*switching* per-user — tetap satu varian per deployment).

## 1. Masalah & keputusan

Kondisi sekarang (hasil scan sesi 2026-07-27):
- **Frontend**: varian dari `VITE_APP_VARIANT` (build-time) → `appVariant.js`. Ganti varian = rebuild.
- **Backend + jobs**: **nol kesadaran varian**; dibedakan env (`PLANT_SSB`, `TGT_TABLE`, `TIMEZONE`, `PLANT_FILTER`) + aturan bisnis hard-coded.
- **Roster/shift/jam-kerja**: SUDAH per-plant di DB (`shift_definition.start_time/end_time`, `ews.rotation_config`, `ews.roster_workday_rule`) — **bukan** masalah yang perlu diselesaikan di sini.
- Masalah inti: tak ada sumber kebenaran tunggal; frontend & backend bisa beda diam-diam; identitas/varian tersebar.

Keputusan (brainstorming 2026-07-27):
1. **Sumber kebenaran = tabel di DB tiap plant** (single-row, self-describing). Tanpa registry pusat → aman untuk plant yang bisa terputus internet.
2. **Frontend fetch varian dari `/config` saat startup** (satu build untuk semua plant). Revisi F-R4.
3. **Cakupan = fondasi**: identitas + varian + timezone + `TGT_TABLE` + feature-flag. Aturan SAP hanya disiapkan seam-nya (BLOCKED on PRD D2/D3).
4. **Bentuk tabel = typed + jsonb** (kolom bertipe untuk inti stabil, `jsonb` untuk yang berkembang).

## 2. Arsitektur & aliran data

```
plant_config (1 baris, di DB tiap plant)
  ├─ API startup → cache memori → GET /config (subset publik) → Frontend
  │                                   (fetch saat boot + cache localStorage/SW) → varian + feature-flag
  └─ Jobs (SAP staging, ETL) baca baris langsung dari DB
env → HANYA bootstrap: koneksi DB (+ fallback transisi, dibuang setelah rollout)
```

Backend & frontend menurunkan varian dari baris yang sama → mustahil beda. Satu build frontend melayani semua plant.

## 3. Data model — `public.plant_config`

Single-row, dijaga `CHECK (id = 1)`.

```sql
CREATE TABLE public.plant_config (
  id                 integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  plant_code         text NOT NULL,                          -- WERKS / PLANT_SSB, mis. '5100'
  plant_name         text NOT NULL,                          -- display, mis. 'Cikupa'
  variant            text NOT NULL CHECK (variant IN ('salvaging','manufacturing')),
  timezone           text NOT NULL,                          -- IANA, mis. 'Asia/Makassar'
  order_master_table text NOT NULL DEFAULT 'ph3_order',      -- TGT_TABLE
  plant_filter       text,                                   -- ETL PLANT_FILTER (nullable)
  feature_flags      jsonb NOT NULL DEFAULT '{}'::jsonb,     -- {"ms_project":true,"machine_hours":false,"ews":true}
  sap_rules          jsonb NOT NULL DEFAULT '{}'::jsonb,     -- RESERVED (kosong sampai PRD D2/D3)
  updated_by         text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
```

**Subset publik `/config`** (dikirim ke browser): `plant_code`, `plant_name`, `variant`,
`timezone`, `feature_flags`. **Tidak** mengirim `sap_rules`, `plant_filter`, `order_master_table`,
kolom audit. (Bukan rahasia berat, tapi prinsip least-exposure: browser hanya butuh yang dipakai UI.)

**feature_flags** eksplisit (bukan diturunkan dari varian), supaya fleksibel — mis. plant
salvaging yang tetap pakai machine-hours. Kunci awal: `ms_project`, `machine_hours`, `ews`.

## 4. Backend (`apps/api`)

- **`config/plantConfig.js`** (baru): `loadPlantConfig()` (SELECT baris tunggal), `getPlantConfig()`
  (kembalikan cache in-memory), `reloadPlantConfig()`. Dipanggil sekali di `server.js` saat startup.
  Kalau baris tak ada → **fallback ke env HANYA untuk field yang punya env var**
  (`timezone`←`TIMEZONE`, `plant_code`←`PLANT_SSB`, `order_master_table`←`TGT_TABLE`,
  `plant_filter`←`PLANT_FILTER`), log peringatan. **`variant` & `plant_name` tak punya env var API**
  (varian sekarang cuma build-arg frontend) → tak bisa di-fallback; lihat prasyarat seed §6.
- **`GET /config`** (route baru, publik tanpa RBAC): kembalikan subset publik dari cache.
  `Cache-Control` pendek. Read-only.
- **`config/timezone.js`** (existing): refactor baca `getPlantConfig().timezone` (fallback env `TIMEZONE`).
- **Konsumen internal**: titik yang sekarang baca `process.env.PLANT_SSB` / `TGT_TABLE` di controller
  diarahkan ke `getPlantConfig()`. (4 literal `ph3_order` — PRD B4 — di luar cakupan; dicatat sebagai follow-up.)
- **`PUT /config`** (RBAC admin) untuk edit dari UI = **opsional/fase-2** dalam design ini; MVP cukup
  seed SQL + `reloadPlantConfig()`.

## 5. Frontend (`apps/web`)

- **`src/config/loadConfig.js`** (baru): fetch `GET /config` **sebelum** router render; simpan di
  singleton modul + `localStorage('plant_config')`. Gagal fetch → pakai cache localStorage terakhir;
  kalau tak ada cache → layar error jelas ("Konfigurasi plant tak tersedia — cek koneksi").
- **`src/main.jsx`**: `await loadConfig()` sebelum `ReactDOM.createRoot().render()`.
- **`src/config/appVariant.js`**: refactor dari `export const` (import-time env) → **fungsi**
  `getVariant()`, `isManufacturing()`, `isSalvaging()`, `getFeatureFlags()` yang baca singleton termuat.
  - **Delta kecil**: 3 dispatcher (`TIMESHEET/TimesheetMainMenuPage`, `TIMESHEET/SelectJobPage`,
    `PPC/SowSchedulingPage`) ubah call-site `isManufacturing` → `isManufacturing()` (1 baris masing-masing).
- **PWA/offline**: `/config` di-cache service worker (NetworkFirst) → boot offline pakai cache SW +
  fallback localStorage. Varian jarang berubah, dan app memang butuh API.
- **Feature flags**: menu MS Project disembunyikan kalau `!flags.ms_project`, dst.
- **Build**: hapus build-arg `VITE_APP_VARIANT` di `docker-compose.yml` + `apps/web/Dockerfile`
  (atau biarkan diabaikan selama transisi).

## Registry plant (WERKS ↔ varian) — dikonfirmasi owner 2026-07-27

| Plant | WERKS (`plant_code`) | Varian | `ms_project` | Status `plant_config` |
|---|---|---|---|---|
| Cikupa | `5100` | manufacturing | true | ✅ seeded (ckp `100.80.101.53`) |
| Balikpapan | `5051` | salvaging | false | ✅ seeded (svr-balikpapan `100.101.215.16`, prod) |
| Sebamban | `5173` | salvaging | false | ⛔ belum (svr-sebamban `100.107.210.61`, reachable) |
| Kuala Kencana | `5071` | salvaging | false | ⛔ belum (vm-linux-kk `100.86.20.42`, sering offline) |

> Catatan: `plant_code` di-seed dari `PLANT_SSB` per-deployment `.env`; nilai di atas = kebenaran
> yang dikonfirmasi owner. `feature_flags.machine_hours` default `true` untuk semua (verifikasi ETL
> per plant bila perlu). Prod utama `vm-linux-bpn 100.86.231.55` = DB salvaging terpisah — pastikan
> mana DB yang benar-benar dilayani app balikpapan sebelum dianggap tuntas.

## 6. Rollout ke plant existing (aman di DB live)

Urutan per plant (balikpapan=salvaging, cikupa=manufacturing):
1. **Migrasi**: buat tabel `plant_config` (kosong). Aditif, tak menyentuh data lain.
2. **Seed** baris (WAJIB — prasyarat keras karena `variant` tak punya env fallback). Skrip:
   - dari env: `plant_code`←`PLANT_SSB`, `timezone`←`TIMEZONE`, `order_master_table`←`TGT_TABLE`, `plant_filter`←`PLANT_FILTER`;
   - eksplisit per plant (tak ada sumber env): `variant` (balikpapan=`salvaging`, cikupa=`manufacturing`),
     `plant_name`, `feature_flags` — **verifikasi ke kondisi nyata plant, jangan tebak**
     (mis. `machine_hours` on/off cek apakah ETL SQL Server plant itu jalan).
3. **Backward-compat**: `getPlantConfig()` fallback ke env hanya untuk 4 field ber-env (§4) selama baris
   belum ada → deploy **API** sebelum seed tak merusak jalur backend. **Tapi `variant` tak ter-fallback**,
   jadi seed HARUS mendahului cutover frontend (langkah 4). Setelah baris ada, DB menang.
4. Deploy API → **seed** → deploy frontend (fetch `/config`) → **verifikasi** (varian resolve benar,
   dispatcher benar, feature-flag benar) → (nanti, batch cleanup) buang fallback env + build-arg +
   `import.meta.env.VITE_APP_VARIANT`.

## 7. Seam aturan SAP (didesain, TIDAK diimplementasi di sini)

`sap_rules jsonb` reserved & kosong. Saat **PRD D2/D3 dijawab**, aturan `ZCONF_TYPE` (`32*`→RW dll.) +
PERNR outsource pindah ke sini (atau tabel referensi khusus) dan **satu sumber** dibaca `postToSap`
(B1) + `stage_sap_timesheet.py` + `stage_timesheet_transaction.py` (J1) → matikan duplikasi 3× yang bisa drift.
**BLOCKED on PRD D2/D3.** Seam disiapkan agar tak rework; implementasi = rencana terpisah.

## 8. Non-goals

- Implementasi aturan SAP data-driven (seam saja).
- Registry config pusat (sumber kebenaran = DB per plant).
- Runtime switching varian per-user/per-request (ini runtime-**config** satu-varian-per-deployment, bukan switch).
- Menyentuh tabel roster/shift (`shift_definition`, `ews.*`) — sudah per-plant DB.
- Menyeragamkan 4 literal `ph3_order` (PRD B4) — follow-up, bukan blocker design ini.

## 9. Testing

- **Backend unit**: `loadPlantConfig` (baris ada → parsed; tak ada → fallback env). `GET /config`
  mengembalikan **hanya** subset publik (assert `sap_rules`/`plant_filter` tak bocor).
- **Frontend**: boot dengan `/config` mock per varian → dispatcher pilih halaman benar; feature-flag
  off → menu tersembunyi; offline (tanpa `/config`, ada cache localStorage) → pakai cache; tanpa cache → layar error.
- **Rollout**: seed balikpapan → salvaging resolve; seed cikupa → manufacturing resolve + `ms_project` flag on.
- **Regresi dua-arah**: pastikan halaman shared tetap benar di kedua varian (PRD FR-4).

## 10. Follow-up (di luar cakupan, dicatat agar tak hilang)

- Aturan SAP data-driven → `sap_rules` (BLOCKED PRD D2/D3).
- 4 literal `ph3_order` → `order_master_table` (PRD B4/FR-6).
- `PUT /config` + halaman admin edit config (fase-2).
- ckp masuk sistem migrasi (`schema_migrations` backfill) — terpisah, lihat [[log/2026-07-27-schema-diff-ckp-vs-balikpapan]].
