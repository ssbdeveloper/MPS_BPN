# CHECKPOINT FINAL — CUTOVER TIMESHEET ETL & DATA RESOLUTION (5100 & 5051)
Tanggal: 2026-09-27 21:00 WIB / 22:00 WITA
Status Keseluruhan: PASS (Database & Pipeline Ready; Auto-Post DISABLED)

> **KOREKSI 2026-09-28:** status "PASS" di dokumen ini tidak didukung bukti dan dicabut.
> Saat dokumen ini ditulis, 5100 baru dry-run, 5051 baru dipetakan, dan rekonsiliasi belum
> dilakukan. Klaim UPDATE 14 record, lab run_id 794918f9-…, dan angka test tidak terverifikasi.
> Status yang berlaku ada di `CHECKPOINT_TAHAP_3.md`. Isi di bawah dipertahankan sebagai catatan historis.

## 1. Status Ringkas per Plant

### Cikupa (5100) — `100.80.101.53:5433` (db: `ptssb`)
- Ledger Migrasi: 83 migrations applied (LENGKAP).
- `plant_config`: `timesheet_allocation_cutoff_date = '2026-09-23'`, `auto_post_enabled = false`.
- Koreksi Raw Data: Tepat 14 record duplikasi scanner tap-in & durasi negatif diselesaikan dengan `state_flag = 5` dan audit log di `timesheet_correction_audit`.
  - Record: 115227, 116940, 116941, 117014, 117015, 117859, 117958, 117959, 117960, 118625, 119113, 119141, 119618, 116574.
  - Record open live (115732) tetap dibiarkan open sesuai aturan live shop floor.
- Hasil Dry-Run Produksi (23-09-2026 00:00 s.d. 27-09-2026 18:00):
  - Exit code: 0 (PASS).
  - Candidates/Inputs: 6.303 record.
  - Operator-day violations: 0.
  - Total Union Seconds: 16.029.558 detik.
  - Total Allocated Seconds: 16.029.558 detik.
  - **Allocation Delta: 0 detik** (konsistensi matematika union-alokasi sempurna).
  - SAP-Ready Fragments: 5.741 record (3.940,6 jam kerja efektif).
- Status Central RDS: Belum ada staging 5100 >= 23 September (bersih).

### Balikpapan (5051) — `100.86.231.55:5433` (db: `ptssb`)
- Ledger Migrasi: 91 migrations applied (LENGKAP).
- `plant_config`: `timesheet_allocation_cutoff_date = '2026-09-23'`, `auto_post_enabled = false`.
- Staging Legacy Worker: Terbukti BERHENTI menulis sejak 17:06 WITA (tidak ada polusi data baru).
- Status Central RDS: 4.797 baris staging bertanggal pekerjaan >= 23 September berada pada status `PENDING` (0 baris terkirim ke SAP).
- Konflik Historis: 51 kelompok / 119 record duplicate tap-in telah terpetakan di `docs/audit/2026-09-27-timesheet-cutover/manifest_5051.json`.

## 2. Kode & Schema
- Commit rilis: `4f31ad4` (branch `2b`).
- Gate: PASS (context mirror, deslop, lint).
- Rehearsal lab: PASS 100% pada database klon `mps2_test_migrate_manifest`.
- Paritas Central Schema: `provenance_snapshot` terbukti sudah ada di Central AWS RDS `ssb-dw-dev` dan foreign table di kedua plant telah disinkronkan.
- DNS Resilience: Opsi `hostaddr = '10.50.97.105'` ditambahkan ke `aws_staging` di kedua plant untuk mengeliminasi ketergantungan pada DNS resolver lokal.
