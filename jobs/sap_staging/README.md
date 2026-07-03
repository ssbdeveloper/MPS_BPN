# SAP Staging Jobs

Folder ini berisi script untuk menyiapkan payload timesheet/machine-hours ke tabel `sap_timesheet_staging`, lalu mengirimkannya ke SAP.

Semua script membaca `.env` dari root repo `MPS2/.env`.

## Alur Utama

1. Source lokal dibaca dari PostgreSQL MPS.
2. Row yang layak masuk SAP dimasukkan ke `sap_timesheet_staging`.
3. Payload JSON SAP dibuat otomatis di kolom `payload`.
4. `post_sap_staging.py` mengambil row `PENDING` lalu post ke SAP.
5. Hasil post mengubah status menjadi `POSTED` atau `FAILED`.

Tabel penting:

- `sap_timesheet_staging`: queue payload SAP.
- `sap_stage_cursor`: posisi terakhir staging job untuk mode catch-up.
- `sap_staging_eligibility_audit`: audit kenapa source row sudah/belum layak masuk staging.

## Script Ringkas

| Script | Fungsi |
|--------|--------|
| `sap_staging_common.py` | Shared helper: koneksi DB, schema DDL, insert staging, payload builder, cursor, audit eligibility. Tidak dijalankan langsung. |
| `stage_timesheet_transaction.py` | Job otomatis/cursor untuk memasukkan `timesheet_transaction` yang sudah checkout ke `sap_timesheet_staging`. |
| `stage_machinehours.py` | Job otomatis/cursor untuk memasukkan bundle `mch_transaction` per jam ke `sap_timesheet_staging`. |
| `stage_sap_timesheet.py` | Tool manual/utility untuk init schema dan staging ad-hoc by `tsnumber`, date range, atau machine-hour window. |
| `post_sap_staging.py` | Worker yang post payload dari `sap_timesheet_staging` ke SAP inbound API. |
| `seed_sap_staging_manual.py` | Tool testing untuk seed satu payload manual ke staging. |
| `requirements.txt` | Dependency Python untuk folder ini. |

## `sap_staging_common.py`

Ini file pondasi yang dipakai script lain.

Isi utamanya:

- Load `.env`.
- Membuat koneksi source DB dan staging DB.
- Membuat/migrasi tabel staging lewat `ensure_staging_schema`.
- Insert row ke `sap_timesheet_staging`.
- Build kolom `payload` SAP dari kolom staging.
- Simpan cursor job incremental.
- Simpan audit eligibility ke `sap_staging_eligibility_audit`.
- Helper SAP credential dan local reject handling.

Script ini tidak punya `main()`, jadi jangan dijalankan langsung.

## `stage_timesheet_transaction.py`

Dipakai untuk job rutin timesheet.

Source:

- `timesheet_transaction`
- lookup `ph3_order`/`TGT_TABLE`
- lookup `usernfc`

Default mode:

- Membaca cursor `sap_stage_cursor` untuk `TIMESHEET`.
- Mengambil row yang sudah checkout.
- Ada overlap cursor untuk menangkap late update.
- Insert ke `sap_timesheet_staging`.
- Update cursor setelah sukses.

Command:

```powershell
cd jobs/sap_staging
python stage_timesheet_transaction.py
```

Dry run:

```powershell
python stage_timesheet_transaction.py --dry-run
```

Window manual:

```powershell
python stage_timesheet_transaction.py --from-ts 2026-07-02T08:00:00 --to-ts 2026-07-02T10:00:00
```

Audit eligibility:

- Row yang berhasil disiapkan dicatat sebagai `STAGED`.
- Row hari ini yang gagal kriteria dicatat sebagai `BLOCKED`.

Kriteria blocked timesheet saat ini:

- `activitytype` kosong dan `order_no` kosong.
- `activitytype` kosong dan `operation_no` kosong.
- `activitytype` kosong, `order_no` + `operation_no` ada, tetapi tidak match ke SOW/`ph3_order`.

## `stage_machinehours.py`

Dipakai untuk job rutin machine-hours.

Source:

- `mch_transaction`

Default mode:

- Mengambil previous completed hour.
- Membaca cursor `sap_stage_cursor` untuk `MCH_HOURS`.
- Bundle machine-hour per jam.
- Insert ke `sap_timesheet_staging`.
- Update cursor.

Command:

```powershell
cd jobs/sap_staging
python stage_machinehours.py
```

Dry run:

```powershell
python stage_machinehours.py --dry-run
```

Window manual:

```powershell
python stage_machinehours.py --from-ts 2026-07-02T08:00:00 --to-ts 2026-07-02T09:00:00
```

Audit eligibility:

- Source `mch_productiondata` hari ini yang belum muncul di `mch_transaction` dicatat sebagai `BLOCKED`.
- Reason saat ini: `missing_mch_transaction`.

Catatan: `mch_transaction` dianggap sudah melalui transformasi yang membuatnya layak masuk jalur SAP staging.

## `stage_sap_timesheet.py`

Ini tool manual/utility, bukan job rutin utama.

Fungsinya:

- Init schema staging.
- Stage timesheet tertentu by `tsnumber`.
- Stage timesheet by date range.
- Stage machine-hour untuk window tertentu.

Init schema:

```powershell
cd jobs/sap_staging
python stage_sap_timesheet.py init-db
```

Stage timesheet tertentu:

```powershell
python stage_sap_timesheet.py timesheet --tsnumbers 97179,97180
```

Stage timesheet by date:

```powershell
python stage_sap_timesheet.py timesheet --from-date 2026-07-02 --to-date 2026-07-02
```

Stage machine-hours manual:

```powershell
python stage_sap_timesheet.py mchours --from-ts 2026-07-02T08:00:00 --to-ts 2026-07-02T09:00:00
```

Gunakan ini untuk testing, backfill kecil, atau manual recovery. Untuk job rutin gunakan `stage_timesheet_transaction.py` dan `stage_machinehours.py`.

## `post_sap_staging.py`

Mengirim payload `PENDING` dari `sap_timesheet_staging` ke SAP inbound API.

Command umum:

```powershell
cd jobs/sap_staging
python post_sap_staging.py --limit 50
```

Post source tertentu:

```powershell
python post_sap_staging.py --source-system TIMESHEET --limit 50
python post_sap_staging.py --source-system MCH_HOURS --limit 50
```

Retry failed:

```powershell
python post_sap_staging.py --retry-failed --limit 50
```

Post id tertentu:

```powershell
python post_sap_staging.py --ids 123
```

Jika SAP menolak payload timesheet, script dapat menandai local `timesheet_transaction` sebagai reject lewat helper di `sap_staging_common.py`.

## `seed_sap_staging_manual.py`

Untuk testing payload manual.

Contoh:

```powershell
cd jobs/sap_staging
python seed_sap_staging_manual.py --payload-file ..\..\samples\sap_payloads\manual_payload.json
```

Setelah seed, post dengan:

```powershell
python post_sap_staging.py --ids <id>
```

## Urutan Operasional Harian

Minimal:

```powershell
python stage_timesheet_transaction.py
python stage_machinehours.py
python post_sap_staging.py --limit 50
```

Untuk loop/catch-up terbatas:

```powershell
python stage_timesheet_transaction.py --loop 5 --loop-sleep-seconds 1
python stage_machinehours.py --loop 5 --loop-sleep-seconds 1
```

## Hubungan Dengan EWS Accuracy

EWS Accuracy sekarang memakai konsep SAP-ready:

- Timesheet ready jika `timesheet_transaction.tsnumber` sudah ada di `sap_timesheet_staging` dengan `source_system = 'TIMESHEET'`.
- Machine ready jika `mch_productiondata.proddataid` sudah ada di `mch_transaction`.
- Row yang belum layak bisa dilihat di `sap_staging_eligibility_audit`.

Query audit cepat:

```sql
SELECT source_system, eligibility_status, block_reason, COUNT(*)
FROM sap_staging_eligibility_audit
WHERE source_date = CURRENT_DATE
GROUP BY source_system, eligibility_status, block_reason
ORDER BY source_system, eligibility_status, block_reason;
```

## Env Yang Dipakai

Utama:

```text
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD
PLANT_SSB
TIMEZONE
TGT_TABLE
SAP_INBOUND_URL
SAP_INBOUND_USERNAME
SAP_INBOUND_PASSWORD
```

Opsional staging DB terpisah:

```text
SAP_STAGING_DB_HOST
SAP_STAGING_DB_PORT
SAP_STAGING_DB_NAME
SAP_STAGING_DB_USER
SAP_STAGING_DB_PASSWORD
```

Cursor:

```text
SAP_STAGE_INITIAL_FROM_TS
SAP_STAGE_CURSOR_OVERLAP_MINUTES
SAP_STAGE_SAFETY_DELAY_MINUTES
```
