# CHECKPOINT TAHAP A — BASELINE DAN PENGAMAN
Waktu: 2026-09-27 20:05 WIB / 21:05 WITA
Status: PASS

## 1. Baseline Git & Workspace
- Branch: 2b
- HEAD Commit: c8d82de (feat(timesheet-etl): migration + runner + API guard + tests for Cikupa & Balikpapan)
- Working tree: Pekerjaan pengguna dipertahankan utuh (CLAUDE.md, bayScheduling, docs). Tidak ada stash/reset/clean.

## 2. Verifikasi Target Production & Server Identity
- Plant 5100 (Cikupa):
  - Host: 100.80.101.53:5433
  - Database: ptssb (PostgreSQL 15.18)
  - Timezone: Asia/Jakarta
  - plant_config: id=1, plant_code='5100', timezone='Asia/Jakarta', timesheet_allocation_cutoff_date='2026-09-23', auto_post_enabled=false
  - Ledger migrations: 83 file tercatat (termasuk 20260922, 20260922b, 20260923, 20260925)
  - Derived drift: 0 baris
  - Unique index: idx_timesheet_active_productive_op VALID & UNIQUE
- Plant 5051 (Balikpapan):
  - Host: 100.86.231.55:5433
  - Database: ptssb (PostgreSQL 15.15)
  - Timezone: Asia/Makassar
  - plant_config: id=1, plant_code='5051', timezone='Asia/Makassar', timesheet_allocation_cutoff_date='2026-09-23', auto_post_enabled=false
  - Ledger migrations: 91 file tercatat (termasuk 20260922, 20260922b, 20260923, 20260925)
  - Derived drift: 0 baris
  - Unique index: idx_timesheet_active_productive_op VALID & UNIQUE

## 3. Verifikasi Worker & Poster Production
- Cikupa (5100):
  - API (mps2-api): Running, koneksi aktif sejak rebuild 17:44 WIB (PID 1071002).
  - Staging worker: Tidak ada worker staging aktif sejak 23 September.
  - Poster: auto_post_enabled = false.
- Balikpapan (5051):
  - API (mps2-api): Running, koneksi aktif sejak rebuild 18:23 WITA (PID 459000).
  - Staging worker legacy (sap-stage-ts-worker): Berhenti. Tidak ada sesi aktif di pg_stat_activity, tidak ada baris baru di sap_timesheet_staging sejak 17:06:21 WITA.
  - Poster: auto_post_enabled = false.

## 4. Bukti Backup & Restore Lab
- Lokasi binary dump:
  - C:\Users\Admin\AppData\Local\Temp\ts_deploy_0927\backup\ptssb_5100_pre_timesheet_20260927_165343.dump (27.8 MB)
  - C:\Users\Admin\AppData\Local\Temp\ts_deploy_0927\backup\ptssb_5051_pre_timesheet_20260927_165600.dump (67.2 MB)
- Uji restore lab: Berhasil di-restore ke clone disposable mps2_test_migrate_manifest dan mps_timesheet_bpn_test.
- Kredensial: Dikecualikan sepenuhnya dari repo dan audit log.

## 5. Status Blocker Aktual Menuju Cutover
- Cikupa: 9 kelompok konflik overlap (23 record) dalam cohort sejak cutoff 2026-09-23 memicu DUPLICATE_ACTIVITY_OVERLAP di F2.
- Balikpapan: 51 kelompok konflik (119 record) dalam cohort cutoff. 4.366 staging PENDING ada di central.
- Next Step: Membangun manifest inventaris deterministik dan perbaikan terverifikasi (Tahap B).
