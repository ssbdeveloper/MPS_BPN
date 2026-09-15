---
title: Max Record Duration per Activity Type + rekonsiliasi TIMESHEET
date: 2026-08-30
tags: [sap-staging, config-rules, reconciliation, manufacturing]
---

# Max Record Duration per Jenis Aktivitas (No Limit / angka) + TIMESHEET di rekonsiliasi

Keputusan user 2026-08-30: **1a** (kunci MCH per statusid), **2b** (semua jenis eksplisit,
tanpa default kategori), **3a** (No Limit = bebas cap saja, break hours tetap), **4a** (UI
full-width + 2 tab), **5a** (repo D:\website\MPS2 dulu, port bersih ke MPS\MPS2), **6a**
(rebuild manual oleh user), **7b** (sheet Records export satu tabel + kolom Source).

## Struktur config baru (plant_config.sap_rules.max_record_minutes)

```json
{
  "mch":       { "1": 300, "2": null, "12": 30, "20": 150 },
  "timesheet": { "": 300, "1510": 150, "1670": null }
}
```

- `mch` key = `mch_statustypes.statusid`; `timesheet` key = `activitytype` (`""` = productive).
- Nilai = menit (>=1) atau **null = No Limit** (LEAST di Postgres mengabaikan NULL → durasi
  asli lolos utuh). Jenis TIDAK ada di map = tanpa cap, FE menandai "not configured".
- Config lama (angka tunggal / {va,nnva,nva}) DI-EXPAND saat dibaca: `load_sap_rules`
  (Python) & `loadMaxRecordConfig` (JS) memanggil `legacy_category_minutes` +
  `expand_legacy_into_type_maps` + katalog (`mch_statustypes`, `ews.activity_type_ref`),
  jadi perilaku lama IDENTIK sampai user menyimpan config baru (2b).
- `max_record_fallback` (hanya di Python) = nilai kategori lama untuk jenis yang tidak ada
  di map, pengaman ganda.

## File berubah (D:\website\MPS2)

| File | Isi |
|---|---|
| `apps/api/controllers/configRulesController.js` | normalizer baru (per-jenis + null), `legacyCategoryMinutes`, `expandLegacyIntoTypeMaps`, `loadActivityCatalog`, endpoint `getActivityCatalog` |
| `apps/api/routes/config.js` | route GET `/config/activity-catalog` |
| `apps/api/controllers/dashboardController.js` | `loadMaxRecordConfig` + `MCH_CAP_MINUTES`/`TS_CAP_MINUTES`/`TS_BREAK_CUT_SECONDS` (identik dgn staging), `buildRecordsSql` (UNION MCH+TIMESHEET, kolom Source), records endpoint + param `source=all|mch|timesheet`, sheet Records export + kolom Source |
| `jobs/sap_staging/sap_staging_common.py` | `normalize_max_record_minutes` per jenis, katalog, ekspansi legacy, `max_record_fallback` |
| `jobs/sap_staging/stage_sap_timesheet.py` | CTE `cap_cfg` (JSONB per statusid) → cap per statusid di source_rows |
| `jobs/sap_staging/stage_timesheet_transaction.py` | CTE `cap_cfg` → `cap_minutes` per activitytype di base → effective |
| `apps/web/src/pages/ConfigurationRulesPage.jsx` | rail jadi 3 default + full-width section 2 tab (MCH 19 baris staged / TIMESHEET 18 baris), `MaxRecordTypeRow` (toggle No Limit + input) |
| `apps/web/src/components/sap/ReconciliationPanel.jsx` | filter Source (All/MCH/TS), kolom Source, tombol Exclude disembunyikan untuk TS |

## Verifikasi (semua live ke BPN via tunnel, read-only)

1. Asumsi Postgres: `LEAST(x, NULL)` = x; `jsonb_typeof` bedakan null-eksplisit vs key hilang. ✓
2. Unit JS normalizer 6/6 PASS, Python 6/6 PASS.
3. **Regresi A/B (git HEAD vs baru, config BPN asli, 8-19 Agt)**: MCH 63 rows/78.685s IDENTIK,
   TIMESHEET 5.476 rows/13.365.778s IDENTIK. ✓ (sempet beda 1,3M s karena config DB sempat
   terisi data smoke-test — OLD code salah baca struktur baru; bukan bug kode baru.)
4. Smoke cap semua record 30 hari: delta 0,0 jam; skenario No Limit/cap 30 mnt bekerja
   (statusid 1 No Limit +49,7 jam; statusid 12 30m −53,6 jam; TS productive No Limit +35,2 jam;
   TS 1670 30m −847,4 jam). ✓
5. Endpoint: GET /config/rules (22 mch + 18 ts, ekspansi legacy), GET /config/activity-catalog
   (19/22 staged), PUT rules (tersimpan `{"1":null,"12":30,...}`). ✓
6. Records rekonsiliasi: MCH 6.308 segmen + TIMESHEET 4.352 (12-18 Agt), recognized TS
   **0/4.352 mismatch** vs total_seconds staging. ✓
7. FE: eslint 0 error, `npm run build` SUCCESS. ✓

## PITFALL yang kena saat kerja

- **PUT /config/rules test memakai global.pool patch = bocor ke produksi**: `putConfigRules`
  memanggil `reloadPlantConfig(pool)` yang memakai pool GLOBAL (bukan argumen) → UPDATE
  jalan di pool asli walau query utama pakai client transaksi → config BPN tertimpa
  "smoke-test" 2026-08-30 10:20 → di-restore manual ke `{va:300,nnva:150,nnva:150}`.
  **Test PUT wajib stub `reloadPlantConfig`** (atau jangan patch global.pool).
- **OLD staging code (git HEAD) TIDAK kompatibel dengan config struktur baru**: baca
  `max_record.get("va")` → None → default 90 menit (bukan 300). Artinya: kalau config baru
  disimpan SEBELUM kode baru di-deploy, staging produksi diam-diam cap 90 menit. **Urutan
  deploy: kode dulu, simpan config baru setelahnya.**
- A/B test MCH via `fetch_machine_hour_rows` = 0 baris (provenance filter, segmen sudah
  di-stage) → uji cap MCH langsung ke mch_transaction per statusid, bukan lewat fetch.

## Deploy (urutan wajib)

1. `git pull` + `docker compose restart sap-stage-worker sap-ops-worker` di BPN
   (file Python di-mount; worker lama di memory tidak baca file baru).
2. Rebuild api + frontend: `docker compose build api frontend && docker compose up -d api frontend`.
3. Baru simpan config rules dari halaman /config-rules (2b: isi eksplisit per jenis).
4. Rebuild pending antrian PENDING lama: `rebuild_pending --from <tanggal>` (manual, 6a).
