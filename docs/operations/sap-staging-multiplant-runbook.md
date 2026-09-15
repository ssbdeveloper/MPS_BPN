# SAP Staging Multi-Plant — Runbook

## Arsitektur

```text
DB plant 5051 ─┐
DB plant 5071 ─┼─ stage worker ─> AWS RDS ssb_dw.sap_timesheet_staging
DB plant 5153 ─┤                         │
DB plant 5100 ─┘                         └─ poster di masing-masing server ─> SAP CPI
```

| Plant | Jenis | Source yang dikirim |
|---|---|---|
| 5051 Balikpapan | Salvaging | TIMESHEET + MCH_HOURS |
| 5071 Kuala Kencana | Salvaging | TIMESHEET + MCH_HOURS |
| 5153 Sebamban | Salvaging | TIMESHEET + MCH_HOURS |
| 5100 Cikupa | Manufacturing | TIMESHEET saja |

Setiap identitas source memakai `(source_system, plant, source_row_id)`.
`source_row_id` tetap ID asli (`tsnumber`/`proddataid`) sehingga bisa ditelusuri ke DB plant.
UUID tidak diperlukan. `ZTIMESHEETID` tetap `id::text` dari identity global AWS.

## Cara kerja

### TIMESHEET

1. `sap-stage-ts-worker` membaca `timesheet_transaction` lokal.
2. `source_key = PLANT_SSB:tsnumber`, misalnya `5051:159061`.
3. Payload masuk staging AWS sebagai `PENDING`.
4. `sap_staging_source` mencatat `(plant, tsnumber, source_min_start)` sebagai provenance.
5. Poster pada server plant hanya mengambil `werks=PLANT_SSB`.
6. Respons SAP mengubah status menjadi `POSTED`, `FAILED`, atau `SKIPPED`.

### MCH_HOURS (salvaging saja)

1. `sap-stage-worker` membaca `mch_transaction` lokal.
2. Record valid dipotong per hari dan dibundel per operator/order/operasi/mesin/aktivitas.
3. `sap_staging_source` mencatat setiap sumber sebagai `(plant, proddataid, bucket_start)`.
4. Hari yang belum pernah POSTED menghasilkan bundel normal; hari tertutup menghasilkan koreksi.
5. Normal hari selesai boleh auto-post. Koreksi tetap harus dipost manual.

Advisory lock memastikan satu worker per `(source_system, plant)` berjalan pada satu waktu.

## Deployment pertama

### Prasyarat wajib

Pada setiap server, dua nilai ini harus sama:

```bash
grep '^PLANT_SSB=' .env
```

```sql
SELECT plant_code FROM public.plant_config WHERE id=1;
```

Jangan deploy jika berbeda. Pada laptop pengembangan saat runbook ini dibuat ditemukan
`.env PLANT_SSB=5051`, tetapi DB port 5441 melaporkan `plant_config=5100`.

### Urutan deployment

1. Stop semua service SAP pada plant aktif:

```bash
docker compose stop sap-stage-worker sap-stage-ts-worker sap-post-worker sap-ops-worker
```

2. Jalankan di AWS RDS:

```text
database/migrations/aws/20260911_sap_staging_multiplant_identity.sql
```

3. Jalankan pada DB masing-masing plant, urut:

```text
database/migrations/api/20260911_sap_staging_multiplant_fdw.sql
database/migrations/api/20260911_sap_staging_multiplant_triggers.sql
```

Migrasi FDW menolak otomatis jika `sap_staging_exclusion` lokal masih punya data.
Pindahkan data tersebut ke AWS dengan plant yang benar sebelum mengulang.

4. Deploy kode dan restart API.

5. Nyalakan service:

Salvaging (5051, 5071, 5153):

```bash
docker compose up -d sap-stage-worker sap-stage-ts-worker sap-post-worker sap-ops-worker
```

Manufacturing (5100):

```bash
docker compose up -d sap-stage-ts-worker sap-post-worker sap-ops-worker
# JANGAN nyalakan sap-stage-worker di 5100
```

6. Verifikasi:

```sql
SELECT source_system, werks, status, count(*)
FROM sap_timesheet_staging GROUP BY 1,2,3 ORDER BY 1,2,3;

SELECT plant, count(*) FROM sap_staging_source GROUP BY 1 ORDER BY 1;

SELECT plant, source_system, source_row_id, bucket_start, count(*)
FROM sap_staging_source WHERE posted_at IS NOT NULL
GROUP BY 1,2,3,4 HAVING count(*) > 1;
-- harus 0 baris
```

## Onboarding 5071 dan 5153

Isi tanggal awal terlebih dahulu:

```env
SAP_STAGE_INITIAL_FROM_TS=YYYY-MM-DDT00:00:00
```

Tanggal ditentukan user/admin plant berdasarkan batas data yang sudah pernah masuk SAP.
Jangan menebak atau mengambil seluruh sejarah karena dapat menggandakan payroll.

Urutan aman:

1. 5153: nyalakan staging, pantau 48 jam.
2. Setelah bersih: nyalakan 5071.
3. Periksa kedua source (`TIMESHEET`, `MCH_HOURS`) dan cursor masing-masing.

## Posting manual rentang tanggal

Kedua tanggal wajib diisi. Rentang bersifat inklusif.

Semua source untuk satu plant:

```bash
python post_sap_staging.py --plant 5153 \
  --date-from 2026-09-01 --date-to 2026-09-07 \
  --limit 2000 --workers 4
```

TIMESHEET saja:

```bash
python post_sap_staging.py --plant 5071 --source-system TIMESHEET \
  --date-from 2026-09-01 --date-to 2026-09-07 \
  --limit 2000 --workers 4
```

MCH_HOURS saja (salvaging):

```bash
python post_sap_staging.py --plant 5051 --source-system MCH_HOURS \
  --date-from 2026-09-01 --date-to 2026-09-07 \
  --limit 2000 --workers 4
```

Filter TIMESHEET memakai `payload.ISDD`; MCH_HOURS memakai `bucket_start`.
Posting manual tetap mematuhi guard exclusion, anti-double-post, status koreksi, dan
ZTIMESHEETID yang pernah diterima SAP.

## Troubleshooting

### Tidak ada data masuk

```bash
docker logs sap-stage-ts-worker --tail 100
docker logs sap-stage-worker --tail 100
```

Cek:
- `PLANT_SSB` benar;
- `SAP_STAGE_INITIAL_FROM_TS` tidak terlalulalu maju;
- cursor bergerak di `sap_stage_cursor`;
- koneksi `AWS_PG*` tersedia.

### PENDING menumpuk

```bash
docker logs sap-post-worker --tail 100
```

Poster mati tidak menghilangkan data. Baris tetap PENDING dan dapat dikirim dengan
perintah manual rentang tanggal.

### Worker berkata masih berjalan

Advisory lock mendeteksi proses lain untuk source+plant sama. Jangan paksa instance kedua;
cari container duplikat.

### Larangan

- Jangan mengubah `PLANT_SSB` setelah plant mulai staging.
- Jangan reset sequence staging.
- Jangan memakai `--allow-posted` untuk operasi normal.
- Jangan menyalakan MCH_HOURS di 5100.
- Jangan onboarding data historis tanpa menetapkan batas yang sudah masuk SAP.
