---
tags: [domain/sap]
---

# SAP Staging Check Queries

Query-query ini dipakai untuk audit hasil `sap_timesheet_staging` sebelum/selama posting ke SAP.

## 1. Summary Staging

```sql
SELECT
  source_system,
  status,
  COUNT(*) AS rows,
  MIN(created_at) AS min_created,
  MAX(created_at) AS max_created
FROM sap_timesheet_staging
GROUP BY source_system, status
ORDER BY source_system, status;
```

## 2. Range Machine Hours Staging

```sql
SELECT
  MIN(bucket_start) AS min_bucket,
  MAX(bucket_start) AS max_bucket,
  COUNT(*) AS rows,
  SUM(total_seconds) AS total_seconds,
  ROUND(SUM(total_seconds) / 3600.0, 2) AS total_hours
FROM sap_timesheet_staging
WHERE source_system = 'MCH_HOURS';
```

## 3. Duration Machine Hours Per Hari

```sql
SELECT
  bucket_start::date AS work_date,
  COUNT(*) AS bundle_rows,
  SUM(total_seconds) AS staging_seconds,
  ROUND(SUM(total_seconds) / 3600.0, 2) AS staging_hours
FROM sap_timesheet_staging
WHERE source_system = 'MCH_HOURS'
GROUP BY bucket_start::date
ORDER BY work_date DESC;
```

## 4. Bandingkan Duration Staging Vs Source Per Hari

```sql
WITH source_daily AS (
  SELECT
    startdatetime::date AS work_date,
    SUM(EXTRACT(EPOCH FROM (enddatetime - startdatetime)))::bigint AS source_seconds
  FROM mch_transaction
  WHERE startdatetime IS NOT NULL
    AND enddatetime IS NOT NULL
    AND enddatetime > startdatetime
    AND confirmation_number IS NOT NULL
    AND confirmation_number <> ''
    AND order_no IS NOT NULL
    AND order_no <> ''
    AND operation_no IS NOT NULL
    AND operation_no <> ''
  GROUP BY startdatetime::date
),
staging_daily AS (
  SELECT
    bucket_start::date AS work_date,
    SUM(total_seconds)::bigint AS staging_seconds
  FROM sap_timesheet_staging
  WHERE source_system = 'MCH_HOURS'
  GROUP BY bucket_start::date
)
SELECT
  COALESCE(s.work_date, st.work_date) AS work_date,
  s.source_seconds,
  st.staging_seconds,
  st.staging_seconds - s.source_seconds AS diff_seconds,
  ROUND(s.source_seconds / 3600.0, 2) AS source_hours,
  ROUND(st.staging_seconds / 3600.0, 2) AS staging_hours
FROM source_daily s
FULL JOIN staging_daily st USING (work_date)
ORDER BY work_date DESC;
```

Catatan: selisih kecil bisa muncul kalau source event melintas hari/jam, karena staging membagi ke bucket jam.

## 5. Cek Satu Bundle Machine Hours

Ganti `100000` dengan `id` staging yang mau dicek.

```sql
SELECT
  id,
  source_key,
  bucket_start,
  synthetic_start,
  synthetic_end,
  total_seconds,
  pernr,
  rueck,
  aufnr,
  vornr,
  zconf_type,
  lstar,
  arbpl,
  zbarcodeid,
  payload
FROM sap_timesheet_staging
WHERE id = 100000;
```

Source detail untuk bundle tersebut:

```sql
SELECT
  m.proddataid,
  m.startdatetime,
  m.enddatetime,
  EXTRACT(EPOCH FROM (
    LEAST(m.enddatetime, s.bucket_start + interval '1 hour')
    - GREATEST(m.startdatetime, s.bucket_start)
  ))::bigint AS seconds_in_bucket,
  m.sn_employee,
  m.confirmation_number,
  m.order_no,
  m.operation_no,
  m.status_activitytype,
  m.machineid,
  m.status_description
FROM sap_timesheet_staging s
JOIN mch_transaction m
  ON m.startdatetime < s.bucket_start + interval '1 hour'
 AND m.enddatetime > s.bucket_start
WHERE s.id = 100000
  AND s.source_system = 'MCH_HOURS'
  AND m.confirmation_number = LTRIM(s.rueck, '0')
  AND m.order_no = LTRIM(s.aufnr, '0')
  AND m.operation_no = LTRIM(s.vornr, '0')
  AND m.machineid = s.arbpl
ORDER BY m.startdatetime;
```

## 6. Cek Outsource PERNR

Jumlah row staging yang memakai PERNR outsource:

```sql
SELECT
  source_system,
  COUNT(*) AS rows
FROM sap_timesheet_staging
WHERE pernr = '11009413'
GROUP BY source_system
ORDER BY source_system;
```

Timesheet outsource yang belum benar:

```sql
SELECT COUNT(*) AS bad_timesheet
FROM sap_timesheet_staging s
JOIN timesheet_transaction t
  ON s.source_system = 'TIMESHEET'
 AND s.source_key = t.tsnumber::text
JOIN LATERAL (
  SELECT employee_category
  FROM usernfc u
  WHERE upper(regexp_replace(coalesce(u.snssb,''), '\s+', '', 'g'))
      = upper(regexp_replace(coalesce(t.serialnumber,''), '\s+', '', 'g'))
  LIMIT 1
) u ON true
WHERE u.employee_category ILIKE '%Outsource%'
  AND (s.pernr <> '11009413' OR s.payload->>'PERNR' <> '11009413');
```

Machine-hours outsource yang belum benar:

```sql
SELECT COUNT(*) AS bad_mch
FROM sap_timesheet_staging s
JOIN LATERAL (
  SELECT employee_category
  FROM usernfc u
  WHERE upper(regexp_replace(coalesce(u.snssb,''), '\s+', '', 'g'))
      = upper(regexp_replace(coalesce(s.pernr,''), '\s+', '', 'g'))
  LIMIT 1
) u ON true
WHERE s.source_system = 'MCH_HOURS'
  AND u.employee_category ILIKE '%Outsource%'
  AND (s.pernr <> '11009413' OR s.payload->>'PERNR' <> '11009413');
```

## 7. Cek Payload Sama Dengan Kolom Staging

```sql
SELECT COUNT(*) AS mismatch
FROM sap_timesheet_staging
WHERE payload->>'ZTIMESHEETID' <> ztimesheetid
   OR payload->>'PERNR' <> pernr
   OR payload->>'RUECK' <> rueck
   OR payload->>'AUFNR' <> aufnr
   OR payload->>'VORNR' <> vornr
   OR payload->>'FLGAT' <> flgat
   OR payload->>'PLNFL' <> plnfl
   OR payload->>'VORNR_B' <> vornr_b
   OR payload->>'VORNR_R' <> vornr_r
   OR payload->>'ZCONF_TYPE' <> zconf_type
   OR payload->>'ARBPL' <> arbpl
   OR payload->>'LSTAR' <> lstar
   OR payload->>'ISDD' <> isdd
   OR payload->>'ISDZ' <> isdz
   OR payload->>'IEDD' <> iedd
   OR payload->>'IEDZ' <> iedz
   OR payload->>'WERKS' <> werks
   OR payload->>'AUERU' <> aueru
   OR payload->>'ZBARCODEID' <> zbarcodeid;
```

## 8. Lihat Sample Payload Siap SAP

```sql
SELECT
  id,
  source_system,
  source_key,
  status,
  jsonb_pretty(payload) AS payload
FROM sap_timesheet_staging
WHERE status = 'PENDING'
ORDER BY id DESC
LIMIT 10;
```

## 9. Cek Cursor

```sql
SELECT *
FROM sap_stage_cursor
ORDER BY source_system, plant;
```

## 10. Cek Duplicate Source Key

Seharusnya hasilnya kosong karena sudah ada unique constraint.

```sql
SELECT
  source_system,
  source_key,
  COUNT(*) AS rows
FROM sap_timesheet_staging
GROUP BY source_system, source_key
HAVING COUNT(*) > 1
ORDER BY rows DESC;
```
