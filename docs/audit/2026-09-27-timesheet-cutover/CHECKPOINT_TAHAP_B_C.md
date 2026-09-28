# CHECKPOINT TAHAP B & C — INVENTARIS MANIFEST & REHEARSAL LAB
Waktu: 2026-09-27 20:35 WIB
Status: PASS

## 1. Inventaris & Manifest Data Konflik
- Cikupa (5100):
  - 10 kelompok kasus (9 duplikasi scanner tap-in, 1 interval negatif, 1 open row pending checkout).
  - 16 record terdampak: 15 record akan ditetapkan `state_flag = 5` dengan alasan audit terperinci, 1 record open (ts 115732) tetap dibiarkan open sesuai SOP operasional live.
  - Manifest lengkap disimpan di `docs/audit/2026-09-27-timesheet-cutover/manifest_5100.json`.
- Balikpapan (5051):
  - 51 kelompok / 119 record konflik; seluruhnya sudah berada di central staging sebagai `PENDING` (belum ke SAP) dan berstatus `BACKFILL` di plant.
  - Manifest disimpan di `docs/audit/2026-09-27-timesheet-cutover/manifest_5051.json`.

## 2. Perbaikan Minimum Kode & Rehearsal Lab
- Perbaikan:
  - Scoping cross-boundary duplicate check di `run_timesheet_etl.py` agar record companion di luar target window (sebelum cutoff) tidak saling memvalidasi satu sama lain jika tidak bersinggungan dengan target inputs.
  - Penambahan unit test `test_companion_vs_companion_historical_overlap_outside_window_not_rejected`.
  - Commit rilis: `4f31ad4` (branch `2b`).
- Gate: PASS (context mirror, deslop clean).
- Rehearsal Lab End-to-End pada database klon `mps2_test_migrate_manifest`:
  - Dry-run: PASS (6.285 inputs, 0 operator-day violation, allocation delta = 0 detik).
  - Execute: PASS (Run ID: `794918f9-dede-4583-9701-264ca23b85e8`, 5.528 SAP-ready rows).
  - Preview-publish: PASS (5.528 rows).
  - Publish: PASS (5.528 rows ke central staging `mps_sap_staging_test`).
  - Reconcile: PASS (0 discrepancy).
  - Test suites: 182 database tests PASS + 150 ETL tests PASS.
