# 2026-08-31 — Plant scope per server + FDW staging ke AWS (rekonsiliasi CKP hidup)

## Masalah
1. SAP-Log page di MPS Cikupa kosong: `.env` VITE_API_URL duplikat + nginx CKP tanpa proxy /api (container 4 minggu, conf lama). FIX: hapus duplikat + `docker compose restart nginx`.
2. User minta tampilan PER PLANT: SAP-Log hanya menampilkan plant server itu.
3. Record rekonsiliasi Cikupa kosong: query UI masih baca tabel staging LOKAL BPN/CKP yang kosong/stale (staging asli di AWS).

## Keputusan (jalur 1 FDW — sudah direkomendasikan sebelumnya)
FDW 2 tabel di SETIAP DB plant menunjuk AWS ssb_dw; tabel lokal di-rename `_legacy` (TIDAK dihapus).

## Eksekusi
### Kode (dev 2b / prod main)
- `apps/api/controllers/dashboardController.js`:
  - Helper `PLANT_SSB` (regex `^\d{4}$` dari env), `PW_SQL` (tanpa alias), `plantScope(alias)`.
  - Filter `werks = PLANT_SSB` di SEMUA query sap_*: dashboard stats (4 subquery), getSapTimesheetStagingLog, getSapTimesheetStagingSummary (3 query), sap-corrections, loadSapReconciliationData (stgByDate + actions + failed/skipped bundles), export bundleRows, getSapReconciliationDay, buildRecordsSql (mch/ts), buildRecordsPageSql (mchBase/tsBase), excludeSapRecord, getSapReconciliationRecord head.
  - FIX bug JOIN source_key TS: `t.tsnumber::text = st.source_key` → `split_part(st.source_key, ':', 2)` di tsSql, tsBase, tsHeavy (source_key kini `plant:tsnumber`).
- Commits: dev `4af5ed3` (plant scope), `274e5e9` (stgByDate + failed/skipped + tsHeavy); prod `80439b6`, `d1f997e`.

### DB (BPN via tunnel 5434, CKP via tunnel 5441)
- `CREATE EXTENSION postgres_fdw; CREATE SERVER aws_staging ... host=RDS, dbname=ssb_dw; CREATE USER MAPPING FOR CURRENT_USER ... (creds AWS_PG*);`
- `ALTER TABLE sap_timesheet_staging RENAME TO sap_timesheet_staging_legacy;` (+ `sap_staging_source` → `_legacy`). FK source.staging_id → staging.id ikut rename (valid antar _legacy). Trigger BPN `trg_sap_staging_mark_segments_posted` ikut tabel _legacy (tidak berpengaruh).
- `CREATE FOREIGN TABLE` nama asli, kolom lengkap (42 + 8).
- Verifikasi: BPN FDW count 4.860 / source 7.035; legacy 19.835 utuh. CKP FDW 4.860 / 7.035; legacy 995 utuh.
- CKP sudah punya tabel staging lokal (995 baris yatim tanpa segmen) — di-rename, bukan drop.

### Deploy
- BPN & CKP: `git pull origin 2b` → `docker compose up -d --build api` (SERVICE NAME = `api`, bukan timesheet-api!).
- Pitfall: `git pull ... && docker compose ...` dalam satu command sempat gagal pull ("and the repository exists.") — pull dijalankan terpisah baru sukses.

## Verifikasi (curl https://localhost/api/... via nginx)
- BPN: log = 5051 semua; summary total 3.815 (1.688 PENDING + 2.040 POSTED + 87 FAILED); records TS 2.478; records MCH 7.055; funnel MCH staged 569.18 hrs.
- CKP: log = 5100 semua (TIMESHEET); summary total 1.046 PENDING; records TS **1.046** (C5100FAB); records MCH 0 (wajar, MCH CKP belum ada); funnel MCH 0.
- Rekonsiliasi funnel hanya MCH (by design — rantai jam mesin); TIMESHEET tampil di tab Records.

## Catatan
- Data lokal lama BPN (19.835 staging / 73.685 source) & CKP (995) aman di `_legacy`.
- Dev .env PLANT_SSB terisi → dev lokal ikut ter-filter (OK).
- ewsController query sap_timesheet_staging via pool lokal → kini baca FDW (AWS) — tidak error, tanpa filter plant (perlu dicek kalau KPI EWS CKP menampilkan data 5051 — plant filter ewsController terpisah).
