# CHECKPOINT TAHAP 3 — Cutover Timesheet ETL (5100 / 5051)

Ditulis: 2026-09-28 00:05 WIB. Menggantikan klaim `CHECKPOINT_FINAL.md` (lihat koreksi di file itu).
Bukti mentah (JSON, skrip, before-image, backup) ada di `C:/Users/Admin/mps_cutover_20260927/`
(di luar Git, ACL hanya Admin + SYSTEM). Credential tidak disimpan di file mana pun di sana.

## Status ringkas

| Plant | Status | Keterangan singkat |
|---|---|---|
| 5100 Cikupa | PARTIAL | Execute prod SELESAI (run_id tercatat). Publish ke central BELUM — dua blocker di bawah. |
| 5051 Balikpapan | BLOCKED | Dry-run prod gagal fail-closed pada `DUPLICATE_ACTIVITY_OVERLAP`. Belum ada execute/publish. |

Auto-post: `false` di kedua plant. Tidak ada HTTP ke SAP. Tidak ada push.

## 1. Backup sebelum mutation

| Plant | File | Ukuran | Verifikasi |
|---|---|---|---|
| 5100 | `backup/ptssb_5100_pre_execute_20260927_225604.dump` | 27,95 MB | `pg_restore -l` 145 TABLE DATA; restore ke `mps2_restore_check_5100` rc=0; 6 metrik cocok dengan prod |
| 5051 | `backup/ptssb_5051_pre_execute_20260927_225604.dump` | 67,41 MB | `pg_restore -l` 126 TABLE DATA; belum di-restore uji |

## 2. Rehearsal lab 5100 (clone dari dump di atas)

- DB lab `mps2_restore_check_5100`; FDW `aws_staging` diarahkan ke `localhost/mps_sap_staging_test`.
- 14.391 exclusion TIMESHEET 5100 disalin dari central prod ke central lab agar setara.
- Dry-run lab rc=0; execute lab rc=0, run_id `aeb6328e-6cf0-4be6-a1d0-c9a2b3f2af42`,
  output_checksum `e639dd8b…4480` — sama persis dengan dry-run prod.

## 3. Execute prod 5100

- Perintah: `prod_etl.sh 5100 exec_5100 --execute --from-ts 2026-09-23T00:00:00+07:00 --to-ts 2026-09-27T18:00:00+07:00 --created-by cutover-20260927-hermes`
  (detached; transport Tailscale WireGuard, plant `ssl=off` sehingga `sslmode=disable` + `ALLOW_INSECURE_TRANSPORT=true`).
- rc=0, 425 detik, selesai 23:40:02 WIB.
- **run_id `07e3090a-9637-4406-8aae-bf64a1c21807`**, status `SAP_READY`.
- Window: `[2026-09-23 00:00+07, 2026-09-27 18:00+07)` — watermark 27/9 18:00 WIB.
- input_checksum `cad139c1…c5bde7`, output_checksum `e639dd8b…4480` (sama dengan dry-run prod dan lab).

| Tabel (plant 5100) | INSERT | UPDATE | DELETE |
|---|---|---|---|
| timesheet_etl_run | 1 | 0 | 0 |
| timesheet_etl_input | 6.303 | 48 (koreksi §4) | 0 |
| timesheet_etl_run_input | 6.303 | 0 | 0 |
| timesheet_cleaned_segment | 6.976 | 0 | 0 |
| timesheet_allocated_segment | 3.427 | 0 | 0 |
| timesheet_sap_ready | 5.741 | 72 (koreksi §4) | 0 |
| timesheet_etl_run_sap_ready | 5.741 | 0 | 0 |

Detik: union 16.029.558 = allocated 16.029.558 (delta 0); SAP-effective 14.186.165.
Pengecualian SAP-ready: UNKNOWN_CONFIRMATION 349, SUBCONT_ROLE 285, ACTIVITYTYPE_0000 7,
OPERATOR_DAY_OPEN 31, ZERO_EFFECTIVE_SECONDS 148; subdetik 12; open tidak di-capture 3.

## 4. Koreksi pasca-execute 5100: companion pra-cutoff (LEGACY_RETAINED)

Temuan: 53 input berasal dari check-in 22/9 (companion lintas tengah malam). 48 tsnumber di
antaranya menghasilkan 72 baris SAP-ready (328.152 s) — dan **ke-48 tsnumber itu sudah POSTED
di central oleh writer legacy** (isdd 20260922, freeze BACKFILL). Mem-publish-nya = double-stage.

Tindakan (skrip `s5_invalidate_precutoff.py`, dry-run rollback dulu, lalu satu transaksi):
- `timesheet_sap_ready` 72 baris SAP_READY → INVALIDATED.
- `timesheet_etl_input` 48 baris SAP_READY → INVALIDATED + `invalidated_reason`.
- Before-image: `s5_before_image_precutoff.json`. Recovery: UPDATE balik dari before-image
  (status + kolom invalidated_* ke nilai semula) dalam satu transaksi.
- Hasil run: 5.669 SAP_READY (13.858.013 s) + 72 INVALIDATED (328.152 s) = 5.741 / 14.186.165.
- 5 input pra-cutoff lain tidak menghasilkan SAP-ready (0 baris), tidak perlu tindakan.

Catatan cakupan: runner tidak menerapkan `timesheet_allocation_cutoff_date` saat memilih
input companion. Ini celah kode, dicatat sebagai sisa pekerjaan — bukan diperbaiki diam-diam.

## 5. Blocker publish 5100

B1. **Kontrak kolom central salah di runner.** Central prod: `sap_timesheet_staging.is_productive`
`GENERATED ALWAYS AS (zconf_type IN ('M1','M2'))` (sesuai migration `20260831_sap_staging_aws_schema.sql:68`).
Runner (`insert_central_staging_batch`) mengisi kolom itu secara eksplisit, dan
`assert_semantic_contract_match` mengharapkan `confirmation_type<>'NONE' AND activitytype kosong`.
Diuji: insert nilai eksplisit ke kolom generated → `ERROR: cannot insert a non-DEFAULT value`.
Pada 5.669 kandidat, 2.689 (RG/OV) akan mismatch semantik. Fixture lab central (kolom biasa)
menyembunyikan ini. Publish prod dengan kode sekarang pasti gagal fail-closed.

B2. **Central tidak terjangkau dari mesin kerja.** `10.50.97.105:5432` timeout; SSH ke kedua
host ditolak; tidak ada subnet route Tailscale. Runner membutuhkan koneksi psycopg2 langsung
ke central. Jalur dblink/FDW dari plant ada, tetapi runner tidak mendukungnya.

## 6. 5051

- Dry-run prod `[2026-09-23 00:00+08, 2026-09-27 18:00+08)` rc=1:
  `DUPLICATE_ACTIVITY_OVERLAP` operator 50410, order 1000131646 op 190,
  tsnumber 173457 [01:00,01:40) vs 173460 [01:30,04:00) pada 23/9.
- Audit sebelumnya: 74 pasangan / 121 tsnumber konflik di 5051.
- Central 5051 sudah memuat 4.797 baris legacy PENDING dengan isdd ≥ 20260923.

## 7. Temuan state lain

- 30 sesi `mps2-etl-cikupa` di 5100: semuanya `idle`, dari 192.168.100.1, backend_start
  11/9, state_change terakhir 26/9 10:10. Tidak ada transaksi terbuka; bukan sisa execute.
- Tidak ada proses ETL lokal yang tertinggal.
- Central 5100 TIMESHEET: 20–22/9 POSTED/FAILED, tidak ada baris isdd ≥ 20260923;
  max(updated_at) 23/9 15:44 WIB.
- DDL prod dari fase 2 (belum ber-manifest sebelumnya): `CREATE EXTENSION dblink`, kolom
  `provenance_snapshot` pada FT `sap_timesheet_staging`, opsi `hostaddr` pada server
  `aws_staging` — di kedua plant.
