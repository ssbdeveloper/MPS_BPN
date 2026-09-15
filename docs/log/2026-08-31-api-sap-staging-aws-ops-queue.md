# 2026-08-31 — API SAP Staging → AWS (ops_request queue tersambung)

## Masalah
- Tombol UI SAP (Rebuild pending di Config Rules, retry_failed, post, recalc date, dsb) menitipkan
  request ke `sap_ops_request` di DB BPN LOKAL (pool API = DB_*), sedangkan `sap-ops-worker`
  membaca antrian dari AWS (connect_staging) → request tidak pernah sampai → semua tombol mati.
- Query rekonsiliasi SAP lainnya juga membaca staging BPN lokal yang STALE (19.794 baris lama).

## Solusi yang diimplementasikan
1. **`apps/api/dbStaging.js` (baru)** — pool khusus tabel SAP staging dengan prioritas env
   `SAP_STAGING_DB_*` → `AWS_PG*` → `DB_*` (pola sama seperti Python `staging_db_config()`),
   + **SSL otomatis** untuk target remote (RDS wajib SSL; node-postgres default non-SSL → ditolak:
   `no pg_hba.conf entry ... no encryption`).
2. **`dashboardController.js`** — routing SELEKTIF 15 query → `sapPool` (AWS):
   - semua baca/tulis `sap_ops_request` (enqueue ops, list requests, recalc_date, post_corrections)
   - query MURNI staging: summary counts, staging log, corrections, reconciliation summary per tanggal,
     detail bundle, exclude bucket lookup.
   - 8 query CAMPURAN (JOIN tabel source: mch_transaction, timesheet_transaction, usernfc,
     plant_config, activity_type_ref) TETAP di pool BPN — tabel source TIDAK ada di AWS (sudah
     diverifikasi: 94 tabel AWS, tidak ada usernfc/mch_transaction/timesheet_transaction/plant_config).
   - exclusion MCH (insert/delete/list) tetap di BPN lokal (fetch-side stage baca exclusion BPN).
3. **docker-compose.yml (dev & prod)** — service `api` mendapat pass-through 5 var `SAP_STAGING_DB_*`.

## Verifikasi (di server BPN, dalam container timesheet-api)
- `dbStaging` target: ssb-dw-dev...rds.amazonaws.com 5432/ssb_dw ✓
- `SELECT count(*) FROM sap_ops_request` = 80 (sesuai migrasi) ✓
- `INSERT ... ROLLBACK` ke AWS: OK (tanpa efek) ✓
- Server: branch 2b di `cca9e64`, image mps2-api rebuilt, container timesheet-api recreated.

## Efek
- Tombol Rebuild pending (dan semua tombol ops) di UI sekarang menulis ke AWS → sap-ops-worker
  (baca AWS) memproses → rebuild bekerja terhadap staging AWS dengan rules terbaru. ✓
- Summary/log/corrections UI baca staging AWS (live).

## Sisa (butuh keputusan arsitektur berikutnya)
- Query rekonsiliasi CAMPURAN (records, bundles per hari, export, daftar exclusion) masih membaca
  staging BPN lokal yang stale, karena butuh JOIN tabel source (mch_transaction, timesheet_transaction,
  usernfc, activity_type_ref) yang belum ada di AWS. Opsi: mirror tabel source ke AWS (sinkron berkala)
  lalu routing penuh ke AWS; atau postgres_fdw dari BPN ke AWS.
- Status worker: sap-ops-worker baca AWS (env sudah) — request dari UI akan diproses.

## Commit
- dev (Javanian, 2b): `2e911fa` (routing) + `cca9e64` (SSL) — sudah push ke Javanian/MPS2.
- prod (SSB, main): `ef19ede` + `9053825` — sudah push ke ssbdeveloper/MPS-SSB.
