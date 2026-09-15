---
title: "Auto staging TIMESHEET BPN (sap-stage-ts-worker) + investigasi backlog"
type: log
date: 2026-09-02
tags: [domain/sap, staging, TIMESHEET, worker]
---

# Auto staging TIMESHEET BPN (2026-09-02)

Lanjutan [[log/2026-08-31-aws-staging-reset-1b-26plus]] (baris 35 mencatat gap ini: TIMESHEET
tanpa penjadwal otomatis). Commit: `9b34504` (branch `2b`).

## Apa yang diubah
- `docker-compose.yml`: service baru **`sap-stage-ts-worker`** (pola `sap-stage-worker`):
  `while true; do python stage_timesheet_transaction.py --loop 10 || true; sleep
  ${SAP_STAGE_TS_INTERVAL:-900}; done` — cursor mode, hingga 10 langkah cursor per siklus
  (berhenti lebih awal kalau cursor tak maju). Pengiriman ke SAP tetap manual via UI.
- 3 env diteruskan ke anchor `x-sap-env` (sebelumnya hanya di .env host, container diam-diam
  memakai default kode): `SAP_STAGE_INITIAL_FROM_TS` (default anchor 2026-08-26T00:00:00 —
  jangkar kode 2026-01-01 berbahaya kalau cursor hilang), `SAP_STAGE_CURSOR_OVERLAP_MINUTES`
  (30), `SAP_STAGE_SAFETY_DELAY_MINUTES` (1).
- Deploy BPN (`/home/tag/MPS2` — CATATAN: path /opt/MPS2 di plan lama TIDAK ada di server
  ini; yang aktif /home/tag/MPS2): `git pull` + `docker compose up -d sap-stage-ts-worker`.

## Hasil (run pertama 13:21–13:22 WITA)
- Iterasi 1: window `2026-08-27 00:00..2026-09-02 13:20:53`, prepared=4.159, inserted=1.688
  (catatan: log `inserted` MENYESATKAN — `cur.rowcount` psycopg2 setelah `execute_values`
  page_size=1000 hanya mencerminkan BATCH TERAKHIR; untuk prepared 4.159 (5 batch) log
  bilang 159 padahal 1.688 baris benar-benar masuk — lihat verifikasi created_at 13:21).
- Cursor `TIMESHEET|5051` di AWS ssb_dw: 2026-08-27 00:30 → **2026-09-02 13:17:23** ✓
- POSTED tetap **742** (tidak ada yang berpindah) ✓ · FAILED 87 tetap ✓ · PENDING 1.649 → 3.337.
- Log worker: 0 traceback. Siklus berikutnya tiap 15 menit (steady-state 6 baris/siklus saat
  verifikasi — window 30 mnt overlap menangkap checkout baru).

## Verifikasi kriteria lulus (SQL resmi, BPN)
| Tanggal | eligible | belum | belum tapi EXCLUDED |
|---|---|---|---|
| 26-08 | 662 | 662 | **662** (by design) |
| 27-08 | 831 | 37 | **37** (by design) |
| 28-08 s/d 01-09 | 807/479/142/648/824 | 0 | 0 |
| 02-09 (hari berjalan) | 464 | 1 | 0 (wajar: safety delay 1 mnt) |

## ⚠️ Backfill 26-08 DIBATALKAN (temuan menyimpang dari konteks tugas)
Dry-run `--from-ts 2026-08-26T00:00:00 --to-ts 2026-08-27T00:30:00` → **prepared=0**, bukan
~662. Penyebab: **1.266 baris `sap_staging_exclusion` (TIMESHEET) dibuat 31-08 14:26 oleh
`reset-1b` dengan note "posted 26-08 (jangan dikirim ulang)"** — mencakup record checkout
25-08..27-08 (1.263 cocok). Stager punya guard `NOT EXISTS sap_staging_exclusion` → baris
excluded TIDAK PERNAH di-stage (sengaja: hari 26-08 sudah diposting ke SAP manual di luar
pipeline). Angka backlog 662 di konteks tugas dihitung dengan SQL yang tidak mengecek
exclusion → false positive. Tidak ada yang perlu di-backfill.

## Investigasi §5 (lapor, tidak diubah)
### Anomali 686 baris (3.164 → 2.478)
Penyebab paling mungkin: cleanup reset-1b — record yang "posted 26-08" di-exclude (1.266
baris, 31-08 14:26) dan baris staging-nya dibuang (Δ686 = excluded yang punya baris staging;
exclusion sisanya mencakup record yang memang belum/tidak pernah masuk staging, mis. 25-08).
Riwayat `sap_ops_request` 31-08 hanya post_bundles (1), post_date (25), recalc_date (2) —
**TIDAK ada rebuild_pending** → penurunan bukan dari rebuild via antrian. Guard exclusion
memastikan baris itu tidak akan pernah di-stage ulang (oleh desain, bukan bug).

### Cikupa (plant 5100) — cursor TIMESHEET beku 22-08
Tidak ada mekanisme otomatis TIMESHEET di CKP: crontab user tag hanya ETL
(etl_machine_conf/etl_mch_transaction tiap 10 mnt), tidak ada systemd timer staging, proses
hanya `stage_machinehours.py --catchup` (MCH worker — makanya cursor MCH 5100 current) +
`ops_worker.py`. Tidak ada service sap-stage-ts-worker di compose CKP. TIMESHEET 5100 terakhir
dijalankan manual (cursor 22-08) dan mandek — gap yang SAMA dengan BPN sebelum fix. Usul
(lain tugas): `docker compose up -d sap-stage-ts-worker` di CKP setelah pull — TIDAK
dilakukan di tugas ini.

## Catatan tambahan
- Log "inserted" di stage_timesheet_transaction/stage_machinehours menyesatkan untuk batch
  > page_size (rowcount = batch terakhir). Perbaikan pelaporan ada di `insert_staging_rows`
  (sap_staging_common.py, shared MCH+TIMESHEET) — di luar scope, dicatat saja.
- `{1,9}` guard di API (dashboardController) sudah konsisten dengan format source_key
  `5051:<tsnumber>`; data TIMESHEET 0 non-numerik (diverifikasi 4.453/4.453).
