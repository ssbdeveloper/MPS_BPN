---
title: "Diagnosa export rekonsiliasi & timesheet validation timeout"
date: 2026-09-01
tags: [MPS2, rekonsiliasi, FDW, AWS, export, timeout, dashboard]
---

# Export rekonsiliasi timeout — diagnosa 2026-09-01

Keluhan: `GET /api/dashboard/sap-reconciliation-export?from=2026-08-31&to=2026-09-01` gagal
("Query read timeout") dan sangat lambat; export timesheet validation juga dikeluhkan gagal/lama.

## Fakta (verified live, bukan dugaan)

- **FDW**: di DB BPN (100.86.231.55:5433, db ptssb), `sap_timesheet_staging` dan
  `sap_staging_source` adalah FOREIGN TABLE ke server `aws_staging`
  (`ssb-dw-dev...ap-southeast-1.rds.amazonaws.com`, dbname ssb_dw) via postgres_fdw.
  Semua query rekonsiliasi yang menyentuh 2 tabel itu = round-trip internet ke AWS.
- **Error produksi** (docker logs timesheet-api, 10x dalam 24 jam, 2026-09-01 05:45–06:18 UTC):
  `sap-reconciliation-export error: Error: Query read timeout
   at async exportSapReconciliation (/app/controllers/dashboardController.js:2087:34)`
  → timeout terjadi di **query sheet Bundles** (7 correlated subquery per bundel).
- **Timeout config**: server .env TIDAK override `DB_QUERY_TIMEOUT_MS` → default node-pg
  `query_timeout` = **45 s** (db.js). API → pgbouncer:6432 → db:5432; `statement_timeout`
  tidak dipasang karena pgbouncer. nginx `/api/` proxy_read_timeout = 300 s (bukan limiter).
- **Pengukuran langsung** (via tunnel 5434, SQL identik dengan controller):
  - 2 hari (08-31..09-01): 565 bundel, 2.301 source rows.
  - Query Bundles penuh: **>300 s** (statement timeout 300 s membunuhnya; tidak selesai).
  - FDW join ringan (count-only, push-down): hanya 1.76 s → yang lambat adalah
    **7 correlated subquery per bundel** (tidak bisa di-push-down ke AWS → round-trip per baris).
  - Bundles 30 hari: 1.665 bundel → skala lebih parah.
- **EAI_AGAIN** ke hostname RDS: 2x/48 jam (`getaddrinfo EAI_AGAIN
  ssb-dw-dev...rds.amazonaws.com`) — DNS flaky, bikin query sapPool gagal instan sesekali.
- **Timesheet validation export** (`/timesheet/getexcel`): query-nya CEPAT (diukur: 2 hari
  0.5 s, 30 hari 3 s, 90 hari 17.8 s; ExcelJS+auto-size +0.1/1.7/6 s). Gagal hanya jika
  rentang super lebar (query >45 s → timeout sama) atau hari kosong (404 "No data found" →
  FE toast "Gagal download Excel"). Tidak ada error getexcel di log API 48 jam.

## Rantai penyebab (rekonsiliasi)

1. Bundles query (`dashboardController.js:2087`) = 7 correlated subquery per bundel
   (source_hrs, cut, nrows, stuck, operation, machine) atas tabel FDW → AWS.
2. Correlated subquery tidak bisa di-push-down → eksekusi remote berulang per baris → >300 s
   untuk 2 hari.
3. node-pg `query_timeout` 45 s membunuh query → HTTP 500 "Query read timeout" → export gagal.
4. Export juga seri: loadSapReconciliationData (3 query, 2 FDW) → Bundles → Records
   (UNION ALL MCH+TIMESHEET + break-cut subquery per baris) → ExcelJS 4 sheet. Semua sinkron
   satu request → "sangat lama".

## Opsi perbaikan (belum dieksekusi — menunggu keputusan user)

- 1a: Refactor Bundles: ganti correlated subquery → LEFT JOIN LATERAL/aggregate 1 pass
  (semua subquery pakai join yang sama: sap_staging_source + mch_transaction).
  Estimasi >300 s → detik. Fix utama di kode.
- 1b: Naikkan query_timeout khusus endpoint export (120–300 s) — plester, tetap lambat.
- 1c: Export async (queue + notifikasi) — perubahan arsitektur.
- 2a (getexcel): batasi rentang maks, hapus auto-size per-cell untuk baris banyak.
- 2b: cek range default halaman validation (30 hari) — masih aman (<45 s).

## EKSEKUSI (keputusan user: 1a + 2a, 2026-09-01) — DONE & TERVERIFIKASI

Commit: d108396 (branch 2b, 2026-09-01)

- **dashboardController.js**:
  - Query sheet Bundles (`exportSapReconciliation`, ~2087): 7 correlated subquery per bundel
    → `WITH bundle_sources AS MATERIALIZED` (1 aggregate pass + LEFT JOIN mch dengan guard
    `source_row_id ~ '^[0-9]+$'`; bundel TIMESHEET tetap dapat nrows, kolom mch NULL —
    semantik identik, diverifikasi 5/5 sampel vs query lama).
  - Query `getSapReconciliationDay` (~2233): refactor yang sama (juga timeout di log prod).
  - Export rekonsiliasi diberi batas rentang 62 hari (`SAP_RECON_EXPORT_MAX_DAYS`) → 400
    dengan pesan jelas (sheet Records berat, rentang super lebar berisiko timeout 45 s).
- **timesheet_transactionController.js** (getexcel): batas rentang 62 hari (`MAX_EXPORT_DAYS`)
  → 400; auto-size kolom di-skip (>10.000 baris, `EXPORT_AUTOSIZE_MAX_ROWS`) → lebar tetap
  (`TIMESHEET_EXPORT_WIDTHS`).
- **TimesheetValidationPage.jsx**: toast error export menampilkan pesan server (sebelumnya
  generik "Gagal download Excel").

### Hasil ukur (test API lokal → BPN prod via tunnel, PLANT 5051)

| Skenario | Sebelum | Sesudah |
|---|---|---|
| Bundles query 2 hari (08-31..09-01) | >300 s (statement timeout) | 2,8 s |
| Bundles query 30 hari | >45 s (timeout prod) | 6,2 s |
| Export penuh 2 hari (URL user) | HTTP 500 "Query read timeout" (45 s) | HTTP 200, 266 KB, ~13 s |
| Export penuh 30 hari | timeout | HTTP 200, 994 KB, ~21 s |
| Export penuh 62 hari | timeout | HTTP 200, ~22 s |
| sap-reconciliation-day 1 hari | timeout (di log prod) | HTTP 200, ~1,4 s |
| getexcel 2 hari | OK | OK ~0,6 s |
| getexcel 30 hari | OK | OK ~8,7 s (2 MB) |
| getexcel rentang 244 hari | >45 s (timeout) | HTTP 400 pesan batas 62 hari |
| export rekonsiliasi 200 hari | timeout | HTTP 400 pesan batas 62 hari |

Catatan: di test lokal, `SAP_STAGING_DB_HOST=` dan `AWS_PGhost=` dikosongkan supaya sapPool
ikut DB lokal (dev .env menunjuk localhost tapi dbStaging memaksa SSL → "server does not
support SSL connections" — quirk env dev saja, produksi sapPool→AWS RDS dengan SSL benar).

### Sisa risiko (di luar scope 1a/2a, dicatat)

- Sheet Records query masih per-baris subquery break/cap (keluarga sama) — aman sampai
  ±62 hari (ukur 30 hari ≈ 14 s), untuk rentang >62 hari kini diblokir cap. Kalau mau lebih
  lebar ke depan: refactor Records seperti Bundles (agregat 1 pass) atau export async.
- EAI_AGAIN DNS ke hostname RDS (2x/48 jam) — bikin query sapPool gagal instan sesekali;
  belum ditangani (bukan bagian 1a/2a).

## LANJUTAN: EAI_AGAIN DNS + DEPLOY PROD (2026-09-01) — DONE

Setelah 1a+2a di-deploy user (d108396), export masih 500 dengan error BARU:
`getaddrinfo EAI_AGAIN ssb-dw-dev...rds.amazonaws.com` — DNS Docker embedded (127.0.0.11 →
host systemd-resolved) di API container flaky (transient; resolve normal lagi dalam hitungan
detik, 2x/24 jam).

- **Fix**: `apps/api/dbStaging.js` — sapPool.query di-wrap retry 3x (backoff 300ms) HANYA
  untuk error DNS (code EAI_AGAIN / pesan getaddrinfo). Query lain tetap gagal langsung.
  Commit ae0de54.
- **Deploy prod**: git pull (fast-forward ae0de54) + `docker compose build api && up -d api`
  (container recreate) + FE sudah include (d108396). Verifikasi via nginx dari server:
  - EXPORT 30 hari (from=2026-08-03&to=2026-09-01): **HTTP 200, 23,8 s, 995 KB** (sebelumnya 500)
  - day: 200, 1,3 s | getexcel 30 hari: 200, 11,2 s, 2 MB | getexcel 244 hari: 400 cap ✓
  - error log bersih.
- Catatan deploy: `sudo -S cd` gagal (builtin) — wajib `sudo -S bash -c 'cd ... && docker compose ...'`.

## Catatan teknis

- Verifikasi FDW: `SELECT srvname, srvoptions FROM pg_foreign_server` + pg_foreign_table.
- Replikasi SQL Bundles persis: konstanta CAP/CLAMPED/BREAK dari dashboardController.js
  (loadMaxRecordConfig dari plant_config id=1; break_windows 4 window; max_record_minutes
  mch 22 status + timesheet per activitytype).
- psycopg3 placeholder `%s` (bukan $1) — $1/$2 di SQL asli harus diganti saat test manual.
