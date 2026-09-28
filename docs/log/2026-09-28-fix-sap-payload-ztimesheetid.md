# Log: Fix Missing ZTIMESHEETID on SAP Posting Payload & Data Remediation

Tanggal: 2026-09-28
Penulis: Javanian <teesanfajar@gmail.com>
Scope: `jobs/sap_staging`

---

## 1. Konteks & Gejala Masalah

Saat menjalankan `post_sap_staging.py` untuk memposting baris staging hasil runner ETL baru (`run_timesheet_etl.py`), seluruh baris ditolak oleh SAP CPI dengan respons:
```
HTTP 200: {"n0:ABM_CPP_223_MT_Timesheet_Res": {"STATUS": "E", "MESSAGE": "Mandatory data Timesheet ID (ZTIMESHEETID) is empty."}}
```
Pada tabel audit `log_timesheet_sap`, kolom `ztimesheetid` tercatat sebagai string kosong `""`.

## 2. Investigasi & Akar Masalah

1. **Hulu ETL (`run_timesheet_etl.py`):**
   - Pada tahap F4 (`build_sap_ready_plan`), payload SAP dibentuk di plant DB (`timesheet_sap_ready`) sebelum baris memiliki identity AWS central. Payload memuat field fungsional SAP (`WERKS`, `PERNR`, `RUECK`, dll.) tanpa `ZTIMESHEETID`.
   - Pada tahap F5 (`publish_to_central_staging`), payload di-INSERT langsung ke kolom JSONB `payload` di `public.sap_timesheet_staging`. Runner tidak menjalankan query UPDATE untuk menyuntikkan `ZTIMESHEETID: ztimesheetid` seperti yang dilakukan pipeline lama (`sap_staging_common.py` `PAYLOAD_UPDATE_SQL`).
   - Validasi semantik `assert_semantic_contract_match` membandingkan kandidat vs central tanpa memeriksa `ZTIMESHEETID`.

2. **Hilir Poster (`post_sap_staging.py`):**
   - Di `post_one()`, pembacaan ID dilakukan dengan `zid = (row["payload"] or {}).get("ZTIMESHEETID")`.
   - Script tidak memiliki fallback ke `str(row["id"])` atau `row["ztimesheetid"]` jika key tersebut absen di JSON payload, sehingga mengirim payload tanpa `ZTIMESHEETID` ke SAP CPI.

3. **Dampak Riil di Database:**
   - 5.680 baris `TIMESHEET` di `sap_timesheet_staging` (ID 1002633082 s/d 1002640062) tidak memiliki `ZTIMESHEETID` di dalam payload.
   - 538 baris berstatus `FAILED` (reject dari CPI).
   - 5.142 baris tertahan di status `POSTING` akibat proses dihentikan.
   - Record `timesheet_transaction` lokal terverifikasi tetap aman (`state_flag = 1`).

## 3. Perbaikan Kode

1. **`jobs/sap_staging/post_sap_staging.py`:**
   - Menambahkan guard defensif di `post_one()`:
     ```python
     zid = str(payload.get("ZTIMESHEETID") or row_id)
     payload["ZTIMESHEETID"] = zid
     row["payload"] = payload
     ```
   - Menjamin `payload` ke SAP CPI dan parameter audit `log_timesheet_sap` selalu membawa `ZTIMESHEETID`.

2. **`jobs/sap_staging/run_timesheet_etl.py`:**
   - Menyuntikkan `UPDATE public.sap_timesheet_staging SET payload = jsonb_set(payload, '{ZTIMESHEETID}', to_jsonb(ztimesheetid))` setelah batch insert di F5.
   - Mengabaikan `ZTIMESHEETID` pada `assert_semantic_contract_match` karena identity baru dialokasikan di AWS central.

3. **Script Remediasi Data (`jobs/sap_staging/remedy_missing_ztimesheetid.py`):**
   - Transaksi tunggal (fail-closed).
   - Dry-run default, opsi `--apply --yes`.
   - Meng-update 5.680 baris `sap_timesheet_staging` (`status = 'PENDING'`, `sap_error = NULL`, `payload` diinjeksi `ZTIMESHEETID`).

## 4. Verifikasi

- `test_run_timesheet_etl.py`: 28/28 OK
- `test_etl_f5_publish.py`: 21/21 OK
- `remedy_missing_ztimesheetid.py` (dry-run): 5.680 baris teridentifikasi tepat sasaran (538 FAILED, 5142 POSTING).
