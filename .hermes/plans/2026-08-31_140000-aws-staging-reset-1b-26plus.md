# AWS Staging Reset — Identity 1.000.000.000, Data 26-08 ke Atas + Sinkronisasi Edit

Tanggal: 2026-08-31. Status: DIEKSEKUSI (user sudah setujui cleanup; plan sinkronisasi edit = desain untuk nanti).

## 1. Keputusan terkunci (user, 2026-08-31)
- ZTIMESHEETID identity AWS mulai **1.000.000.000** (bukan 2.000.000.000).
- SAP sudah di-reset manual oleh user → mulai 1B aman (tidak bentrok dengan ID lama).
- Hanya data **26-08 ke atas** yang boleh ada di staging AWS (TIMESHEET maupun MACHINE_HOURS).
- Semua data staging AWS dibersihkan dulu ("benar-benar mulai dari 1 miliar").

## 2. Fakta terverifikasi sebelum eksekusi
- `sap_timesheet_staging.id` = `GENERATED ALWAYS AS IDENTITY (START WITH 2000000000)`; `ztimesheetid = id::text` (generated).
- `sap_staging_source.id` = identity (mulai 1); FK `staging_id → sap_timesheet_staging(id) ON DELETE CASCADE`.
- `sap_staging_eligibility_audit` TIDAK punya FK ke staging → truncate terpisah.
- Isi AWS saat ini: ±19.835 staging (19.794 migrasi id 1..2.628.518 + 41 collector id 2.000.000.001+), provenance 79.741, audit 5.035, cursor MCH_HOURS/5051 = 29-08.
- Worker BPN = `stage_machinehours.py --catchup` tiap interval; lantai catchup (`managed_floor`) = **min(bucket_start) di antrian staging** → setelah antrian mulai 26-08, catchup HANYA menyapu 26-08+ → **batas 26-08 terproteksi otomatis, tidak perlu ubah command worker**.
- Script baca .env (`load_dotenv` tanpa override) → export env menang.
- Tunnel lokal: SOCKS5 1055 ✓, BPN source 5434 ✓, AWS 5445 (dinyalakan saat eksekusi).

## 3. Eksekusi cleanup (SQL di AWS ssb_dw, via tunnel 5445)
```sql
TRUNCATE public.sap_staging_eligibility_audit;
TRUNCATE public.sap_timesheet_staging CASCADE;          -- cascade hapus provenance (sap_staging_source)
ALTER TABLE public.sap_timesheet_staging ALTER COLUMN id RESTART WITH 1000000000;
ALTER TABLE public.sap_staging_source    ALTER COLUMN id RESTART WITH 1;
-- cursor mundur ke 26-08 (upsert, 2 sistem)
INSERT INTO public.sap_stage_cursor (source_system, plant, last_processed_at) VALUES
  ('MCH_HOURS', '5051', '2026-08-26T00:00:00'),
  ('TIMESHEET', '5051', '2026-08-26T00:00:00')
ON CONFLICT (source_system, plant) DO UPDATE
  SET last_processed_at = EXCLUDED.last_processed_at, updated_at = now();
```
TIDAK disentuh: `sap_staging_exclusion` (8 baris, config manual), `sap_ops_request` (80), `log_timesheet_sap` (13.777, riwayat audit), `sap_source_change_blocked` (0).

Verifikasi pasca-cleanup: staging = 0 baris; `nextval` staging = 1.000.000.000; source = 1; cursor 26-08.

## 4. Re-stage 26-08+ (dari lokal, source BPN 5434 → AWS 5445)
```bash
export SAP_STAGING_DB_HOST=127.0.0.1 SAP_STAGING_DB_PORT=5445 SAP_STAGING_DB_NAME=ssb_dw SAP_STAGING_DB_USER=ssb_admin
export SAP_STAGING_DB_PASSWORD="$(grep -E '^AWS_PGpass=' .env | cut -d= -f2-)"
python jobs/sap_staging/stage_machinehours.py --loop 200 --loop-sleep-seconds 1
python jobs/sap_staging/stage_timesheet_transaction.py --loop 200 --loop-sleep-seconds 1
```
Cursor mode (cursor = 26-08) → hanya baris dengan checkout/bucket ≥ 26-08. Verifikasi: min id ≥ 1.000.000.000, min tanggal = 26-08, semua PENDING.

## 5. Efek samping yang disengaja
- Baris yang tadinya POSTED (26-08+) ikut di-wipe → di-stage ulang sebagai **PENDING dengan id baru 1.000.000.000+** → akan dikirim ulang ke SAP (asumsi: reset SAP = data lama dihapus; kalau SAP masih simpan data lama, konfirmasi sebelum posting — duplikat di sisi SAP).

## 6. Sinkronisasi edit (desain, BELUM dieksekusi — butuh keputusan)
Masalah: staging di AWS, tapi trigger invalidasi MCH masih DELETE dari staging LOKAL BPN; TIMESHEET tanpa trigger & tanpa loop.
Desain yang diusulkan (pola antrean, aman cross-DB):
1. Trigger invalidasi MCH diubah → INSERT ke tabel `sap_staging_invalidate (source_system, source_row_id, invalidated_at)` di DB plant (bukan DELETE langsung).
2. Trigger BARU di `timesheet_transaction` (field pembentuk bundel berubah) → INSERT ke tabel yang sama.
3. Collector (yang konek AWS) tiap run: baca antrean → DELETE bundle PENDING di AWS yang kena (`posted_at IS NULL`) → hapus antrean → stage ulang. Bundle POSTED tetap dilindungi (koreksi manual).
4. TIMESHEET dijadwalkan rutin (cron `*/15` atau masuk worker loop) — setara dengan MCH.
Efek: edit data lama pun tersinkron (trigger menulis antrean apa pun umurnya). Murni data baru + trigger baru di DB plant → butuh approval sebelum eksekusi.

## 7. Cara jalan manual (sekarang) & otomasi (nanti)
MANUAL (di server BPN, `cd /opt/MPS2`):
- MCH: `python jobs/sap_staging/stage_machinehours.py --catchup` (sudah otomatis via worker tiap interval).
- TIMESHEET: `python jobs/sap_staging/stage_timesheet_transaction.py` (cursor mode; tambah `--loop 10` kalau mau jalan terus sampai selesai).
- Cek: `python jobs/sap_staging/post_sap_staging.py --dry-run` (Fase 3 poster nanti lewat Lambda).

OTOMATIS:
- MCH: SUDAH (worker sap-stage-worker, catchup aman karena managed_floor).
- TIMESHEET: BELUM → tambah cron: `*/15 * * * * cd /opt/MPS2 && python jobs/sap_staging/stage_timesheet_transaction.py >> /var/log/sap-stage-timesheet.log 2>&1`.
- Poster: Fase 3 Lambda (nanti).

## 8. Risiko
- Worker BPN jalan selama cleanup: antrian kosong → catchup skip (floor None) → aman. Setelah re-stage → floor 26-08 → hanya 26-08+ yang disapu.
- Race re-stage lokal vs worker BPN: idempotent (UNIQUE source_key + ON CONFLICT WHERE PENDING) → aman.
- Gap identity dari era 2M (2.000.000.395) hilang dengan wipe — bersih dari 1B.
