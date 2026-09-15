---
title: Migrasi multi-plant Fase 1 dijalankan (AWS + BPN + CKP)
date: 2026-09-14
tags: [sap-staging, multi-plant, migration, aws, bpn, ckp]
---

# Migrasi Fase 1 (identitas provenance + exclusion ber-plant) — EKSEKUSI

Dijalankan 2026-09-14 oleh Hermes atas permintaan owner ("bisa bantu migrasi? AWS, BPN, CKP").
Kode (jobs + API) SENGAJA belum dideploy — owner yang pull + rebuild docker.
Rencana: `.hermes/plans/2026-09-11_143000-sap-staging-multiplant.md`, runbook:
`docs/operations/sap-staging-multiplant-runbook.md`.

## Pra-cek (semua lolos sebelum menyentuh data)

| Cek | Hasil |
|---|---|
| Provenance dengan `werks` kosong (migrasi ABORT kalau >0) | 0 dari 21.789 |
| Duplikat yang akan melanggar `uq_sap_staging_source_posted_segment` | 0 |
| Duplikat untuk index `_multiplant` | 0 |
| Exclusion lama vs plant source (guard migrasi) | aman (semua 5051) |
| `sap_source_change_blocked` ada di BPN & CKP | ya (dipakai trigger baru) |
| Service SAP yang menulis staging | dihentikan dulu (Task 1.0) |

Snapshot rollback tersimpan di
`C:\Users\tee.san\AppData\Local\Temp\mps2_migration_backup\pre_migration_snapshot.json`
+ `bpn_exclusion_backup.json` (1.299 baris, md5 `ab89d7d9acbe35c48abc740059e7d98f`).

## Yang dijalankan

1. **Stop service** (BPN: sap-stage-worker, sap-stage-ts-worker, sap-ops-worker;
   CKP: sap-stage-worker, sap-ops-worker). Tidak ada `sap-post-worker` yang jalan di kedua
   plant → posting otomatis tidak terpengaruh.
2. **AWS** — `database/migrations/aws/20260911_sap_staging_multiplant_identity.sql`
   (satu transaksi, selesai 3,8 s):
   - `sap_staging_source`: +kolom `plant` (NOT NULL), backfill dari `sap_timesheet_staging.werks`,
     +provenance TIMESHEET yang sebelumnya tidak ada → **21.789 → 37.728 baris**
     (MCH 5051 21.789; TIMESHEET 5051 13.964; TIMESHEET 5100 1.975).
   - index baru `uq_sap_staging_source_segment_per_bundle_multiplant` +
     `uq_sap_staging_source_posted_segment`; index lama `uq_..._segment_per_bundle`
     SENGAJA dibiarkan (kompatibilitas rollout), `idx_..._segment` di-recreate ber-plant.
   - trigger `trg_sap_staging_mark_segments_posted` (isi `posted_at` saat status → POSTED).
   - `sap_staging_exclusion`: +kolom `plant`; PK `(source_system, source_row_id)` →
     **`(source_system, plant, source_row_id)`**.
3. **Salin exclusion BPN → AWS** (implementasi peringatan runbook): 1.299 baris
   (1.266 TIMESHEET 31-08 + 33 MCH_HOURS) → AWS dengan `plant='5051'`, diverifikasi
   per-source sama, baru tabel lokal BPN dikosongkan (`delete` 1.299, sisa 0).
   Alasan: `fdw.sql` men-DROP tabel lokal dan menolak jalan bila masih berisi; kalau
   dilewat, 1.266 exclusion TIMESHEET hilang → record itu eligible lagi saat re-stage.
4. **BPN + CKP** — `api/20260911_sap_staging_multiplant_fdw.sql` lalu
   `api/20260911_sap_staging_multiplant_triggers.sql`:
   `sap_staging_source` +kolom `plant` (foreign table), `sap_staging_exclusion` lokal →
   **FOREIGN TABLE ke AWS** (relkind `f`), trigger MCH lokal jadi plant-scoped.
5. **Ledger** `schema_migrations` di BPN + CKP dicatat untuk kedua file plant-side
   (AWS tidak punya tabel ledger).

## Verifikasi sesudah

- Invarian: 0 duplikat segmen POSTED, 0 `plant` kosong, 0 duplikat `(staging, source, plant, row, bucket)`.
- `sap_timesheet_staging` **identik dengan snapshot** (jumlah & `sum(total_seconds)` per
  source/werks/status tidak berubah — tidak ada baris yang tersentuh).
- Via FDW di BPN & CKP: `plant` 5051 = 35.753, 5100 = 1.975; exclusion 5051 = 1.299.
- Uji trigger `mch_transaction_freeze_posted` (BEGIN…ROLLBACK, tidak persist):
  UPDATE `order_no` baris yang sudah POSTED → nilai DIKEMBALIKAN ke aslinya dan
  percobaan tercatat di `sap_source_change_blocked` (0 → 1); sesudah rollback
  `blocked = 0`, tidak ada baris uji tertinggal.

## ⚠️ Status sekarang: service SAP BPN + CKP MASIH MATI

Kode lama TIDAK kompatibel dengan DB baru: `insert_provenance` lama menulis tanpa `plant`
→ `NOT NULL` violation, dan API lama meng-insert exclusion tanpa `plant` → 500. Jadi
urutan wajib: **deploy kode dulu, baru nyalakan service.**

Deploy (owner):
1. Di dev copy: commit + push branch `2b` (kedua server pull dari `Javanian/MPS2.git`).
   Wajib ikut: `jobs/sap_staging/*.py` (6 file) + `apps/api/controllers/dashboardController.js`
   + file migrasi + runbook ini.
   Catatan: `apps/api/routes/dashboard.js` di working tree berisi pekerjaan sesi lain
   (manufacturing-order-progress) — jangan diikutkan kalau controllernya belum naik.
2. Di server (user `tag`, TANPA sudo untuk git):
   `cd /home/tag/MPS2 && git pull --ff-only`
   lalu `docker compose build api && docker compose up -d api`.
3. Nyalakan service: **BPN** `docker compose up -d sap-stage-worker sap-stage-ts-worker sap-ops-worker`;
   **CKP** `docker compose up -d sap-ops-worker` (jangan nyalakan `sap-stage-worker` MCH di 5100 —
   kode baru pun menolaknya).
4. Cek: `docker logs sap-stage-ts-worker --tail 30` (harus jalan tanpa error plant),
   cursor bergerak di `sap_stage_cursor`, dan halaman rekonsiliasi + tombol
   Exclude/Un-exclude berfungsi (plant = 5051).

## Efek sementara yang perlu diketahui

- Selama API belum dideploy, halaman rekonsiliasi memakai kode lama yang TIDAK memfilter
  `plant` → baris CKP (5100) ikut terlihat dan tombol Exclude akan gagal (insert tanpa plant).
  Karena itu jendela antara migrasi ini dan deploy kode sebaiknya pendek.
- Data PENDING/POSTED tidak tersentuh; tidak ada hari kerja yang hilang.
