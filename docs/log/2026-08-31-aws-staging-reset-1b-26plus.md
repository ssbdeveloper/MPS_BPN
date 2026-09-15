# 2026-08-31 — AWS Staging Reset: Identity 1.000.000.000, Data 26-08 ke Atas

## Keputusan (user)
- ZTIMESHEETID identity AWS mulai **1.000.000.000** (SAP sudah di-reset manual user → aman).
- Hanya data **26-08 ke atas** yang boleh ada di staging AWS (TIMESHEET & MACHINE_HOURS).
- Semua data lama staging AWS dibersihkan ("benar-benar mulai dari 1 miliar").

## Eksekusi (via tunnel 2-hop 127.0.0.1:5445)
1. `TRUNCATE sap_staging_eligibility_audit` + `TRUNCATE sap_timesheet_staging CASCADE`
   (cascade hapus provenance `sap_staging_source`). Sebelum: 19.838 staging, 79.760 provenance, 5.035 audit.
2. `ALTER TABLE sap_timesheet_staging ALTER COLUMN id RESTART WITH 1000000000`
   (identity `GENERATED ALWAYS`); `sap_staging_source.id` RESTART WITH 1.
3. Cursor `sap_stage_cursor` di-upsert ke `2026-08-26T00:00:00` untuk (MCH_HOURS,5051) & (TIMESHEET,5051).
4. Re-stage dari source BPN (via tunnel 5434) → AWS: `stage_machinehours.py --loop` + `stage_timesheet_transaction.py --loop` (cursor mode).
5. Bersihkan 6 baris artefak overlap cursor 30 menit (payload ISDD/IEDD = 20260825) → `DELETE` + geser cursor TIMESHEET ke `2026-08-26T00:30:00` (window berikutnya mulai 26-08 00:00, baris 25-08 tak pernah masuk lagi).

## Hasil terverifikasi
- Staging: **4.396 baris** (MCH_HOURS 1.232 + TIMESHEET 3.164), semua status **PENDING**, werks 5051.
- **MIN id = 1.000.000.001**, MAX id = 1.000.007.694 → identity benar-benar mulai 1 milyar.
- 0 baris dengan source_max_end < 2026-08-26T00:00:00.
- Provenance 6.436 (segmen MCH). Tabel config dipertahankan: exclusion 8, ops_request 80, log_timesheet_sap 13.777 (riwayat).
- Cursor: MCH_HOURS 31-08 12:00, TIMESHEET 26-08 00:30.

## Temuan teknis
- `managed_floor` (min bucket_start di antrian) otomatis membatasi catchup worker BPN ke 26-08+ — data sebelum 26-08 TIDAK akan pernah ditarik ulang oleh `--catchup` tanpa ubah apa pun.
- Loop `stage_timesheet_transaction --loop` tampak "macet" saat window kecil (50 baris sisa dengan source_max_end < cursor): bukan kehilangan data — baris di-upsert ulang idempotent; data baru masuk saat window membesar. `--limit` default 5000.
- Baris night-shift 25-08 23:30-23:59 ikut tertangkap overlap cursor 30 menit (by design) — dihapus manual, cursor digeser 00:30.

## Cara jalan (manual, di server BPN `cd /opt/MPS2`)
- MCH: `python jobs/sap_staging/stage_machinehours.py --catchup` (SUDAH otomatis via sap-stage-worker tiap interval).
- TIMESHEET: `python jobs/sap_staging/stage_timesheet_transaction.py` (cursor mode; `--loop 10` untuk lanjut terus).
- Koneksi AWS sudah ter-set di .env server (SAP_STAGING_DB_* = AWS) + compose pass-through (Opsi A).

## Otomasi
- MCH: sudah (worker). TIMESHEET: belum → usul cron `*/15 * * * * cd /opt/MPS2 && python jobs/sap_staging/stage_timesheet_transaction.py >> /var/log/sap-stage-timesheet.log 2>&1`.
- Poster: Fase 3 Lambda (nanti).

## Sinkronisasi edit (desain, belum dieksekusi)
Trigger invalidasi MCH masih DELETE dari staging LOKAL BPN (sekarang staging di AWS) → usul pola antrean `sap_staging_invalidate(source_system, source_row_id)` di DB plant; collector baca antrean → DELETE bundle PENDING di AWS (`posted_at IS NULL`) → stage ulang. TIMESHEET perlu trigger yang sama. Menunggu keputusan user (lihat plan `.hermes/plans/2026-08-31_140000-aws-staging-reset-1b-26plus.md`).
