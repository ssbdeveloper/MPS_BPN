# Configuration Rules — break hours exclusion + max record duration

Tanggal: 2026-08-19. Status: MENUNGGU KEPUTUSAN USER (belum coding).

## Yang diminta

Halaman FE baru "Configuration Rules" untuk mengatur logic/rules yang dipakai
pipeline SAP. Rules awal yang diminta:

1. **Break hours (jam istirahat) — tidak dihitung dari durasi kerja**:
   - 12:00–13:00 → Senin–Minggu
   - 00:00–01:00 → Senin–Jumat
   - 18:30–19:00 → Sabtu–Minggu
   - 22:00–22:30 → Sabtu–Minggu
   - Hanya berlaku untuk record **produktif** ("tidak dianggap jika status bukan produktif").
2. **Max durasi per record** (contoh 90 menit): record `timesheet_transaction` /
   `mch_transaction` yang lebih panjang dipotong di batas, sisanya tidak dianggap.
3. Tujuan: payload yang dikirim ke SAP bersih (tanpa jam istirahat & record gila).

## Temuan arsitektur (verified dari source + DB BPN)

### Pipeline SAP staging (jobs/sap_staging, Python)
```
TIMESHEET: timesheet_transaction → stage_timesheet_transaction.py → sap_timesheet_staging
MCH:       mch_productiondata → ETL etl_mch_transaction_v3 → mch_transaction
           → stage_machinehours.py → stage_sap_timesheet.py (bundling SQL) → sap_timesheet_staging
           → post_sap_staging.py → SAP (POSTED/FAILED/SKIPPED)
```

- **TIMESHEET**: 1 baris staging = 1 record source (source_row_count=1). Payload
  ISDD/ISDZ/IEDD/IEDZ = **waktu checkin/checkout ASLI**. Durasi tidak dikirim
  sebagai angka — SAP menghitung dari jendela waktu. Untuk memotong jam istirahat,
  IEDZ harus jadi **sintetis** = ISDZ + durasi_terpotong (filosofi yang sama sudah
  dipakai MCH: "yang akurat adalah durasi, bukan jendela waktunya", README baris 90-92).
- **MCH**: bundling per hari di CTE `segments` (`stage_sap_timesheet.py`):
  `segment_seconds = EXTRACT(EPOCH FROM (segment_end - segment_start))`, lalu
  `SUM(segment_seconds)` → `total_seconds`, dan IEDD/IEDZ = `source_min_start +
  total_seconds` (sudah sintetis). Ini TITIK yang tepat untuk: (a) kurangi overlap
  break dari tiap segmen, (b) cap durasi per record source.
- `post_sap_staging.py` hanya mengirim payload — tidak menghitung ulang durasi.
  Jadi rules cukup di-apply di DUA tempat staging (TIMESHEET fetch SQL + MCH
  bundling SQL), lalu `rebuild_machinehours.py` untuk antrian PENDING lama.
- Python scripts **TIDAK membaca plant_config** (cuma .env). Kalau rules disimpan
  di DB, staging harus query tabel config saat run (connect_source/connect_staging
  sudah ada).

### Data BPN (30 hari terakhir, tunnel 5434) — dampak rules
| Metrik | TIMESHEET | MCH |
|---|---|---|
| Total record | 20.153 | 64.839 |
| > 90 menit | **2.279 (11,3%)** | 1.316 (2,0%) |
| > 8 jam | 33 (max 89,79 jam = record nyangkut!) | — |
| Avg durasi | 0,68 jam | — |
| Overlap 12:00–13:00 | 217 record | — |
| Overlap 18:30–19:00 (Sab/Ming) | 21 | — |
| Overlap 22:00–22:30 (Sab/Ming) | 20 | — |

→ Cap 90 menit akan memotong 11,3% record timesheet — termasuk yang legit
(kerja 2–4 jam tanpa istirahat). Nilai cap perlu keputusan (90 menit itu "misal").

## Opsi penyimpanan config

- **A. Tabel baru `config_rules`** (id, rule_key, rule_type, payload jsonb,
  enabled, sort, updated_by, timestamps) — extensible untuk "logic2 dan rules"
  lain di masa depan, per-rule bisa di-enable/disable. API CRUD + Python SELECT.
- **B. `plant_config.sap_rules` JSONB** (kolom sudah ada, `{}` sekarang) —
  nol migrasi struktur, tapi blob tunggal: edit = timpa seluruh objek, tidak ada
  enable/disable per rule, dan API me-cache plant_config saat startup (perlu
  reload). Python tetap perlu query JSONB.

Rekomendasi: **A** (halaman ini memang untuk banyak rules ke depan).

## Rencana implementasi (setelah keputusan)

1. **Migration** `database/migrations/api/20260819_config_rules.sql`:
   tabel `config_rules` + seed 4 break windows + max_record_minutes=90
   (apply ke CKP **dan** BPN, commit eksplisit).
2. **Backend**: controller `configRulesController.js` + route `GET/PUT
   /config/rules` (RBAC feature baru `config_rules` W di manifest) —
   GET daftar rules, PUT upsert (per rule_key).
3. **Python staging**:
   - `sap_staging_common.py`: helper `load_rules(conn)` → SELECT config_rules.
   - `stage_sap_timesheet.py` (MCH bundling): di CTE `source_rows`/`segments` —
     cap per record (`end = LEAST(end, start + max_minutes)`), kurangi overlap
     break per segmen **hanya status produktif**.
   - `stage_timesheet_transaction.py` (TIMESHEET): IEDD/IEDZ jadi sintetis =
     ISDZ + (durasi asli − overlap break − cap).
   - `rebuild_machinehours.py` dipakai untuk antrian PENDING lama setelah rules
     berubah (sudah ada, tinggal dijalankan).
4. **FE**: halaman `ConfigurationRulesPage.jsx` — route `/config-rules`,
   sidebar group Administration, featureRegistry `config_rules`, tombol
   "Apply to pending (rebuild)" → enqueue `sap_ops_request` (pola SapLogPage).
5. **Verifikasi**: unit test query staging (window kecil, bandingkan total_seconds
   sebelum/sesudah rules), node --check, eslint, build, docs/log.

## Keputusan yang diminta user

1. **Storage**: A (tabel baru) atau B (plant_config.sap_rules)?
2. **Nilai max record**: 90 menit, atau lebih besar (data: 11,3% timesheet
   kena cap 90; 33 record > 8 jam yang jelas nyangkut)?
3. **Break hanya untuk produktif** — konfirmasi interpretasi: jam istirahat
   DIKURANGKAN hanya dari record/segmen produktif (MCH statusid=1 / M1-M2;
   TIMESHEET activitytype kosong); record non-produktif dilewati apa adanya?
4. **TIMESHEET IEDZ jadi sintetis**: setuju waktu checkout yang dikirim ke SAP
   digeser (ISDZ + durasi bersih) — sama seperti MCH?
5. **Tombol rebuild**: perlu tombol "Apply rules → rebuild pending" di halaman,
   atau rules hanya berlaku untuk staging ke depan (tanpa sentuh antrian lama)?
