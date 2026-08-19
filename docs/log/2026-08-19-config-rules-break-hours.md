---
title: Configuration Rules page — break hours + max record duration untuk SAP staging
date: 2026-08-19
tags: [config-rules, sap-staging, break-hours, plant-config]
---

# Configuration Rules — break hours + max record duration (keputusan user 1b 2a 3 4 5)

## Latar belakang & keputusan

User minta halaman "Configuration Rules" untuk mengatur logic pipeline SAP
(break hours & max record). Keputusan user (1b 2a 3 4 5):
- **1b**: simpan rules di `plant_config.sap_rules` JSONB (kolom sudah ada, tadinya `{}`).
- **2a**: max record = 90 menit (default, configurable).
- **3**: record/segmen yang berada di jam istirahat dianggap TIDAK VALID (diabaikan);
  break windows hanya dipotong dari record PRODUKTIF (MCH: status_activitytype M1/M2,
  TIMESHEET: activitytype kosong).
- **4**: IEDD/IEDZ TIMESHEET jadi SINTETIS = checkin + durasi efektif (filosofi MCH).
- **5**: tombol rebuild antrian PENDING dengan pilihan tanggal mulai.

## Temuan data BPN (sebelum implementasi)

- `sow.systemstatus` tidak pernah berisi TECO/CLSD (string gabungan SAP) — di luar scope.
- Cap 90 menit memotong 11,3% record timesheet (2.279/20.153, 30 hari) & 2% machine
  (1.316/64.839); 33 record timesheet > 8 jam (max 89,79 jam = nyangkut).
- Overlap lunch 12:00-13:00: 217 record timesheet/bulan (produktif melintasi lunch
  terpotong 3600 dtk — verified).
- `processcontroldata` KOSONG di BPN — validation KPI hub sudah pindah ke timesheet
  (lihat log 2026-08-19-operations-hub-kpi-cards).

## Struktur sap_rules

```json
{
  "break_windows": [
    {"start":"12:00","end":"13:00","days":[1,2,3,4,5,6,0]},
    {"start":"00:00","end":"01:00","days":[1,2,3,4,5]},
    {"start":"18:30","end":"19:00","days":[6,0]},
    {"start":"22:00","end":"22:30","days":[6,0]}
  ],
  "max_record_minutes": 90
}
```
`days` = DOW Postgres (0=Sunday..6=Saturday).

## Perubahan

### Migration `database/migrations/api/20260819_sap_config_rules.sql` (applied CKP + BPN)
- Seed `plant_config.sap_rules` (4 break windows + max 90 menit).
- ALTER `sap_ops_request.action` CHECK: tambah `rebuild_pending`.

### Python staging (`jobs/sap_staging/`)
- `sap_staging_common.py`: `load_sap_rules(conn)` + `load_sap_rules_default()`
  (fallback aman bila plant_config tak terbaca).
- `stage_sap_timesheet.py` (MCH bundling):
  - `source_rows`: CAP per record — `LEAST(end_effective, start + max_minutes)`.
  - CTE `break_windows` (dari JSON rules) + `segments`: hitung `break_seconds`
    (overlap segmen dengan window, HANYA M1/M2), `valid_segments` membuang segmen
    efektif <= 0, `bundled` pakai `SUM(effective_seconds)`.
  - `fetch_machine_hour_rows` load rules + kirim param (max_minutes, break_windows_json).
- `stage_timesheet_transaction.py` (TIMESHEET): CTE `break_windows` + `base` +
  `effective` — raw_seconds − break_seconds (produktif saja), cap max_minutes,
  `WHERE effective_seconds > 0`, IEDD/IEDZ = checkin + effective_seconds (SINTETIS),
  `source_max_end` ikut sintetis.
- `rebuild_pending.py` (BARU): rebuild MCH (`rebuild_machinehours.py --from X --to Y`)
  + TIMESHEET (`stage_timesheet_transaction.py --from-ts/--to-ts`) dari tanggal pilihan
  sampai besok; `--dry-run` didukung. Baris POSTED/SKIPPED/FAILED tak disentuh.
- `ops_worker.py`: aksi `rebuild_pending` (butuh params.from_date, timeout 3600s).

### API (apps/api)
- `controllers/configRulesController.js` (BARU): GET/PUT `/config/rules` —
  normalisasi (validasi time HH:MM, days 0-6, max>=1), PUT update plant_config +
  `reloadPlantConfig` (cache).
- `routes/config.js`: `GET/PUT /rules`.
- `rbac/manifest.js`: PUT `/config/rules` → feature `config_rules` W. BERSIH (160 mapped).
- `dashboardController.js` `enqueueSapOps`: ALLOWED tambah `rebuild_pending`,
  validasi `from_date` YYYY-MM-DD, INSERT dengan `params`.

### FE (apps/web)
- `pages/ConfigurationRulesPage.jsx` (BARU, route `/config-rules`, guard feature
  `config_rules`): edit break windows (time + day toggle Mon..Sun), max minutes,
  Save → PUT /config/rules; section Rebuild pending dengan date picker →
  POST /dashboard/sap-ops/enqueue {action:'rebuild_pending', params:{from_date}}.
  Full English UI.
- `router/index.jsx` + `rbac/featureRegistry.js` + `rbac/permissionMatrix.js`
  (supervisor + admin full) + sidebar OperationsHubPage (group Administration).

## Verifikasi

- Python: py_compile 3 script; `stage_timesheet_transaction.py --dry-run` 724 rows OK;
  `stage_sap_timesheet.py mchours --dry-run` 56 rows OK; `rebuild_pending.py --dry-run`
  menjalankan 2 sub-perintah OK.
- Break overlap terverifikasi live: record produktif melintasi 12:00-13:00 dipotong
  tepat 3600 dtk; record berakhir tepat 12:00 overlap 3 dtk; record non-produktif
  (activitytype 1590) TIDAK dipotong.
- API: GET/PUT /config/rules 200 (PUT tulis test-hermes ke DB, GET balik sama);
  enqueue rebuild_pending 202, tanpa from_date 400, action unknown 400; cleanup OK.
- FE: eslint 0 error baru (1 pre-existing di router NotFoundPage, bukan dari sesi ini),
  `npm run build` OK.

## Catatan deploy

- Backend dev TIDAK hot-reload: restart `node server.js` untuk route baru.
- Python scripts di-mount ke container (`./jobs/sap_staging:/app`) — `git pull` +
  restart container `sap-stage-worker`/`sap-ops-worker` cukup (tanpa --build).
- Rules baru berlaku untuk staging berikutnya; antrian PENDING lama butuh tombol
  "Rebuild pending" di halaman (atau CLI `python rebuild_pending.py --from YYYY-MM-DD`).
- `rebuild_machinehours.py` punya "lantai otomatis" (catch-up floor) — rebuild_pending
  memanggilnya dengan --from eksplisit, jadi aman dari floor tersebut.
