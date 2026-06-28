# Early Warning System Plan - Timesheet & Machine Hours

Tanggal analisis: 2026-06-23  
Database: `ptssb` dari root `.env` (`D:\website\MPS2\.env`)  
Scope awal: `timesheet_transaction`, `mch_transaction`, `mch_productiondata`, `sow`, `ph3_order`

## 1. Goal

Membuat early warning system untuk mendeteksi risiko operasional sebelum menjadi masalah validasi, SAP posting, atau cost overrun.

Fokus utama:

1. Planhours habis atau hampir habis berdasarkan akumulasi actual hours.
2. Selisih antara timesheet manual dan machine hours.
3. Akurasi data mesin dari `mch_productiondata`.
4. Data transaction yang tidak bisa di-map ke SOW / SAP order.
5. Aktivitas open terlalu lama atau durasi tidak masuk akal.
6. Order TECO / status SAP yang masih menerima transaksi.

Sistem ini sebaiknya dimulai sebagai dashboard read-only + alert list, lalu baru berkembang menjadi blocking rule atau approval workflow.

## 2. Baseline Data Saat Analisis

Jumlah row aktual:

| Table | Row count |
|---|---:|
| `timesheet_transaction` | 104,435 |
| `mch_transaction` | 444,836 |
| `mch_productiondata` | 454,879 |
| `sow` | 76,815 |
| `ph3_order` | 58,707 |

Temuan awal dari query database:

| Check | Count / Finding |
|---|---:|
| `timesheet_transaction` key tidak match ke `sow` | 161 distinct order-operation |
| `mch_transaction` key tidak match ke `sow` | 11 distinct order-operation |
| `sow` key tidak match ke `ph3_order` | 20,656 distinct order-operation |
| `timesheet_transaction` pada PH3 TECO | 3,908 distinct order-operation |
| `mch_transaction` pada PH3 TECO | 1,425 distinct order-operation |
| Timesheet open lebih dari 12 jam | 2 row |
| Machine transaction open lebih dari 12 jam | 64 row |
| Timesheet duration negatif | 25 row |
| SOW planhours null atau <= 0 | 25,660 row |
| Duplicate `sow(order_no, operation_no)` | 0 |
| Duplicate `ph3_order(order_no, operation_no)` | 2 |
| Timesheet tanpa `order_no` atau `operation_no` | 55,559 row |
| MCH tanpa valid `order_no` atau numeric `operation_no` | 173,166 row |

Catatan: transaksi tanpa order-operation mungkin mencakup unproductive / non-job activity. Untuk alert produksi, filter wajib membedakan productive vs non-productive activity supaya tidak menghasilkan false positive.

## 3. Existing Query Yang Sudah Ada

File:

```text
jobs/etl/sql_anomali_mch_productiondata.sql
```

Query tersebut menghitung akurasi `mch_productiondata` per tanggal + machine:

- Valid jika `jobid` prefix `1`, `6`, `3`, atau `7`.
- Anomaly jika `jobid` prefix `n`, `8`, atau `Karakter Tidak Terdaftar`.
- Output: `production_date`, `machineno`, `machinename`, `anomaly_count`, `valid_count`, `total_count`, `accuracy_pct`.

Baseline 30 hari terakhir menunjukkan drop besar:

| Date | Total | Anomaly | Valid | Accuracy |
|---|---:|---:|---:|---:|
| 2026-06-23 | 2,851 | 161 | 2,690 | 94.35% |
| 2026-06-22 | 3,751 | 383 | 3,368 | 89.79% |
| 2026-06-21 | 2,507 | 864 | 1,643 | 65.54% |
| 2026-06-20 | 4,292 | 775 | 3,517 | 81.94% |

Machine dengan akurasi buruk dalam 14 hari terakhir:

| Date | Machine | Name | Total | Anomaly | Accuracy |
|---|---:|---|---:|---:|---:|
| 2026-06-23 | 56 | Goodway 2 | 161 | 161 | 0.00% |
| 2026-06-22 | 56 | Goodway 2 | 30 | 30 | 0.00% |
| 2026-06-22 | 74 | FAT 4 | 25 | 25 | 0.00% |
| 2026-06-22 | 50 | WB | 27 | 27 | 0.00% |
| 2026-06-22 | 55 | DT 3000 2 | 101 | 52 | 48.51% |
| 2026-06-21 | 66 | Bensaw | 42 | 42 | 0.00% |
| 2026-06-21 | 73 | Honing 2 | 38 | 38 | 0.00% |
| 2026-06-21 | 72 | Honing 1 | 55 | 55 | 0.00% |
| 2026-06-21 | 79 | Shibaura 4 | 52 | 52 | 0.00% |

Kesimpulan: query akurasi ini layak menjadi salah satu warning utama, tetapi perlu threshold dan suppression agar mesin dengan volume kecil tidak terlalu noisy.

## 4. Proposed Warning Categories

### 4.1 Planhours Consumption Warning

Tujuan: mendeteksi order-operation yang actual hours-nya hampir habis atau sudah melewati `sow.planhours`.

Sumber:

- Plan: `sow.order_no + sow.operation_no + sow.planhours`
- Timesheet actual: `timesheet_transaction.order_no + operation_no`, sum `duration`
- Machine actual: `mch_transaction.order_no + operation_no`, sum `duration_hours`

Metric:

```text
timesheet_hours = SUM(timesheet_transaction.duration)
machine_hours   = SUM(mch_transaction.duration_hours)
combined_hours  = timesheet_hours + machine_hours
consume_pct     = combined_hours / sow.planhours * 100
remaining_hours = sow.planhours - combined_hours
```

Severity:

| Severity | Rule |
|---|---|
| INFO | `consume_pct >= 70` and `< 85` |
| WARNING | `consume_pct >= 85` and `< 100` |
| CRITICAL | `consume_pct >= 100` |
| CRITICAL | `over_hours >= 8` even if percentage is distorted by very small planhours |

Important nuance:

- Jika `planhours <= 0` atau null, jangan hitung overrun. Masukkan ke kategori master data warning.
- Jika planhours sangat kecil, percentage bisa ekstrem. Perlu tampilkan `over_hours` sebagai metric utama.
- Perlu keputusan bisnis apakah `timesheet_hours + machine_hours` memang dijumlahkan, atau harus dibandingkan sebagai dua sumber actual berbeda. Untuk early warning awal, tampilkan ketiganya: timesheet, machine, combined.

Temuan contoh tertinggi:

| Order | Op | Plan | TS | MCH | Combined | Over | Consume |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1000124915 | 500 | 0.50 | 1080.97 | 0.66 | 1081.63 | 1081.13 | 216326.4% |
| 1000124685 | 10 | 2.00 | 4.27 | 773.82 | 778.09 | 776.09 | 38904.7% |
| 1000121347 | 270 | 4.00 | 2.96 | 655.68 | 658.64 | 654.64 | 16466.0% |

Interpretasi: sebagian besar critical ekstrem kemungkinan bukan sekadar overrun, tetapi mismatch mapping, planhours terlalu kecil, atau machine transaction menempel ke operation yang tidak tepat. Maka alert ini perlu drilldown.

### 4.2 Timesheet vs Machine Hours Variance

Tujuan: mendeteksi selisih besar antara manual timesheet dan machine hours untuk order-operation yang sama.

Metric:

```text
variance_hours = ABS(timesheet_hours - machine_hours)
variance_pct   = variance_hours / NULLIF(GREATEST(timesheet_hours, machine_hours), 0)
```

Severity:

| Severity | Rule |
|---|---|
| WARNING | `variance_hours >= 2` and `variance_pct >= 30%` |
| CRITICAL | `variance_hours >= 8` and `variance_pct >= 50%` |

Use case:

- Operator mencatat manual tetapi mesin tidak jalan.
- Mesin jalan tetapi tidak ada timesheet operator.
- Machine mapping ke order-operation salah.
- Transaksi machine terlalu panjang karena no checkout / stale jobid.

### 4.3 Machine Data Accuracy Warning

Tujuan: menjadikan SQL anomali `mch_productiondata` sebagai health signal per mesin per shift/hari.

Metric:

```text
accuracy_pct = valid_count / total_count * 100
anomaly_pct  = anomaly_count / total_count * 100
```

Severity:

| Severity | Rule |
|---|---|
| INFO | `accuracy_pct < 98` and `total_count >= 50` |
| WARNING | `accuracy_pct < 95` and `total_count >= 50` |
| CRITICAL | `accuracy_pct < 80` and `total_count >= 50` |
| CRITICAL | `accuracy_pct = 0` and `total_count >= 20` |

Recommended grouping:

- Daily: untuk trend / dashboard.
- Shift or rolling 2 hours: untuk early warning real-time.
- Machine-level: supaya maintenance / admin tahu mesin mana yang bermasalah.

### 4.4 Missing Mapping Warning

Tujuan: mendeteksi transaction yang tidak bisa dihubungkan ke master SOW atau SAP PH3 order.

Rules:

| Warning | Rule |
|---|---|
| `TS_WITHOUT_SOW` | productive timesheet key tidak ada di `sow` |
| `MCH_WITHOUT_SOW` | machine transaction key tidak ada di `sow` |
| `SOW_WITHOUT_PH3` | SOW key tidak ada di `ph3_order` |
| `PH3_DUPLICATE_KEY` | duplicate `ph3_order(order_no, operation_no)` |
| `MISSING_ORDER_OPERATION` | productive row tidak punya order_no / operation_no |

Baseline:

- `TS_WITHOUT_SOW`: 161 distinct key.
- `MCH_WITHOUT_SOW`: 11 distinct key.
- `SOW_WITHOUT_PH3`: 20,656 distinct key.
- `PH3_DUPLICATE_KEY`: 2 distinct key.

Catatan:

- `SOW_WITHOUT_PH3` cukup besar, perlu dibedakan apakah order lama, QH3/PH3 berbeda, atau belum masuk staging.
- Untuk timesheet dan MCH, filter productive wajib dipastikan dulu. Banyak row tanpa order-operation mungkin legitimate untuk unproductive.

### 4.5 TECO / Closed Order Activity Warning

Tujuan: mendeteksi activity masuk ke order yang sudah TECO / closed di SAP source.

Rule:

```text
ph3_order.order_description ILIKE '%TECO%'
AND ada timesheet_transaction atau mch_transaction pada key itu
```

Baseline:

- Timesheet pada PH3 TECO: 3,908 distinct order-operation.
- MCH pada PH3 TECO: 1,425 distinct order-operation.

Severity:

| Severity | Rule |
|---|---|
| WARNING | Activity baru pada order TECO dalam 7 hari terakhir |
| CRITICAL | Activity hari ini pada order TECO |

### 4.6 Open Transaction / Stale Checkout Warning

Tujuan: mendeteksi transaksi yang belum checkout / belum end terlalu lama.

Rules:

| Warning | Rule |
|---|---|
| `TS_OPEN_GT_8H` | `longdate_checkout IS NULL` and age > 8 hours |
| `TS_OPEN_GT_12H` | age > 12 hours |
| `MCH_OPEN_GT_8H` | `enddatetime IS NULL` and age > 8 hours |
| `MCH_OPEN_GT_12H` | age > 12 hours |

Baseline:

- Timesheet open > 12 jam: 2.
- Machine transaction open > 12 jam: 64.

Severity:

| Severity | Rule |
|---|---|
| WARNING | > 8 hours |
| CRITICAL | > 12 hours |

### 4.7 Impossible Duration / Human Capacity Warning

Tujuan: mendeteksi durasi tidak masuk akal secara manusia atau teknis.

Rules:

| Warning | Rule |
|---|---|
| Negative duration | `duration < 0` atau `duration_hours < 0` |
| Daily operator overload | total duration per operator per day > 16 hours |
| Excessive single transaction | single duration > 12 hours |
| Too many fragmented rows | count row per operator-day > threshold |

Baseline:

- Timesheet duration negatif: 25 row.
- Operator-day > 16 hours dalam 30 hari terakhir banyak muncul, contoh:
  - `2763-M` pada 2026-06-02 = 55.18 hours dari 34 row.
  - `2763-M` pada 2026-06-17 = 50.16 hours dari 44 row.
  - `11009630` pada 2026-06-19 = 37.65 hours dari 32 row.

Interpretasi: ini bisa berarti multi-row overlap, duration calculation issue, atau operator login di banyak job sekaligus.

### 4.8 Workcenter / Operation Drift Warning

Tujuan: mendeteksi satu order-operation dicatat di banyak workcenter dalam periode pendek.

Baseline 30 hari:

| Order | Op | Distinct WC | Operators | Hours |
|---|---:|---:|---:|---:|
| 1000128218 | 50 | 9 | 7 | 32.59 |
| 1000128218 | 40 | 7 | 5 | 23.55 |
| 1000128217 | 5001 | 5 | 11 | 146.08 |

Rule awal:

| Severity | Rule |
|---|---|
| INFO | `distinct workcentercode >= 3` within 30 days |
| WARNING | `distinct workcentercode >= 5` within 30 days |
| CRITICAL | `distinct workcentercode >= 5` and consume_pct >= 100 |

Catatan: bisa legitimate jika operation memang lintas station. Butuh allowlist atau compare ke expected workcenter dari `sow.workcenter`.

### 4.9 SAP Posting Readiness Warning

Tujuan: warning sebelum data gagal post ke SAP.

Sumber:

- `timesheet_transaction`
- `mch_transaction`
- `ph3_order`
- log SAP existing jika tersedia

Rules:

| Warning | Rule |
|---|---|
| Missing confirmation | order-operation tidak punya `ph3_order.confirmation_number` |
| Missing sequence data | `sequence_category`, `sequence_number`, branch/return op missing saat dibutuhkan |
| Missing activity type | `activitytype` null untuk productive timesheet |
| Missing employee mapping | `serialnumber` / `sn_employee` tidak match ke `usernfc` |
| Invalid plant | plant transaction tidak sama dengan `.env PLANT_SSB` untuk mode plant aktif |

## 5. Proposed Data Model

### 5.1 Warning Event Table

Gunakan satu table generic supaya semua warning bisa masuk ke satu inbox.

```sql
CREATE TABLE public.early_warning_event (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  warning_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  source_table TEXT,
  source_key JSONB,
  order_no TEXT,
  operation_no INTEGER,
  workcenter TEXT,
  machineno INTEGER,
  serialnumber TEXT,
  title TEXT NOT NULL,
  message TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_early_warning_event_severity
    CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  CONSTRAINT chk_early_warning_event_status
    CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED'))
);
```

Suggested unique identity:

```sql
CREATE UNIQUE INDEX uq_early_warning_event_open_identity
ON public.early_warning_event (
  warning_type,
  COALESCE(order_no, ''),
  COALESCE(operation_no, -1),
  COALESCE(workcenter, ''),
  COALESCE(machineno, -1),
  COALESCE(serialnumber, '')
)
WHERE status IN ('OPEN', 'ACKNOWLEDGED');
```

### 5.2 Warning Snapshot Views

Recommended views:

1. `vw_ew_planhours_consumption`
2. `vw_ew_timesheet_machine_variance`
3. `vw_ew_mch_data_accuracy_daily`
4. `vw_ew_missing_mapping`
5. `vw_ew_open_transactions`
6. `vw_ew_sap_readiness`

Views untuk read/query; table `early_warning_event` untuk persisted inbox, acknowledgement, dan history.

## 6. MVP Design

MVP sebaiknya tidak langsung blocking operator. Start dari visibility dulu.

### MVP 1 - Read-only Dashboard

Deliverable:

- SQL views:
  - planhours consumption
  - machine data accuracy daily
  - open stale transaction
  - missing mapping
- API:
  - `GET /early-warning/summary`
  - `GET /early-warning/events?severity=&type=&status=&date=`
  - `GET /early-warning/order/:orderNo/:operationNo`
- UI:
  - page dashboard early warning
  - cards: critical count, warning count, accuracy today, open stale count
  - table with filter severity/type/workcenter/machine

### MVP 2 - Persisted Event Inbox

Deliverable:

- Table `early_warning_event`.
- Job scheduled every 5-15 minutes:
  - reads views
  - upserts open warning events
  - marks resolved if rule no longer true after grace window
- Actions:
  - acknowledge
  - suppress
  - resolve with note

### MVP 3 - Operator Guardrail

Deliverable:

- Reuse / extend `PLANHOURS_GUARD_IMPLEMENTATION_PLAN.md`.
- Saat pilih job:
  - show planhours status
  - block only for hard rules such as TECO or effective limit exhausted
  - request overrun flow for planhours exhausted

### MVP 4 - Notification

Deliverable:

- Email / Teams / WhatsApp gateway later.
- Notification only for CRITICAL.
- Daily digest untuk WARNING.

## 7. SQL Sketch

### 7.1 Planhours Consumption View

```sql
CREATE OR REPLACE VIEW public.vw_ew_planhours_consumption AS
WITH sow_plan AS (
  SELECT
    order_no,
    operation_no,
    MAX(planhours) AS planhours,
    MAX(part_name) AS part_name,
    MAX(workcenter) AS expected_workcenter
  FROM public.sow
  WHERE order_no IS NOT NULL
    AND operation_no IS NOT NULL
  GROUP BY order_no, operation_no
),
ts AS (
  SELECT
    order_no,
    operation_no,
    SUM(COALESCE(duration, 0)) AS timesheet_hours,
    COUNT(*) AS timesheet_rows,
    MAX(longdate_checkout) AS last_timesheet_checkout
  FROM public.timesheet_transaction
  WHERE order_no IS NOT NULL
    AND operation_no IS NOT NULL
    AND COALESCE(state_flag, 0) <> 5
  GROUP BY order_no, operation_no
),
mch AS (
  SELECT
    order_no,
    NULLIF(operation_no, '')::int AS operation_no,
    SUM(COALESCE(duration_hours, 0)) AS machine_hours,
    COUNT(*) AS machine_rows,
    MAX(enddatetime) AS last_machine_end
  FROM public.mch_transaction
  WHERE order_no IS NOT NULL
    AND operation_no ~ '^[0-9]+$'
  GROUP BY order_no, NULLIF(operation_no, '')::int
)
SELECT
  sp.order_no,
  sp.operation_no,
  sp.part_name,
  sp.expected_workcenter,
  sp.planhours,
  COALESCE(ts.timesheet_hours, 0) AS timesheet_hours,
  COALESCE(mch.machine_hours, 0) AS machine_hours,
  COALESCE(ts.timesheet_hours, 0) + COALESCE(mch.machine_hours, 0) AS combined_hours,
  sp.planhours - (COALESCE(ts.timesheet_hours, 0) + COALESCE(mch.machine_hours, 0)) AS remaining_hours,
  100 * (COALESCE(ts.timesheet_hours, 0) + COALESCE(mch.machine_hours, 0)) / NULLIF(sp.planhours, 0) AS consume_pct,
  CASE
    WHEN COALESCE(sp.planhours, 0) <= 0 THEN 'NO_PLAN'
    WHEN COALESCE(ts.timesheet_hours, 0) + COALESCE(mch.machine_hours, 0) >= sp.planhours THEN 'CRITICAL'
    WHEN 100 * (COALESCE(ts.timesheet_hours, 0) + COALESCE(mch.machine_hours, 0)) / NULLIF(sp.planhours, 0) >= 85 THEN 'WARNING'
    WHEN 100 * (COALESCE(ts.timesheet_hours, 0) + COALESCE(mch.machine_hours, 0)) / NULLIF(sp.planhours, 0) >= 70 THEN 'INFO'
    ELSE 'OK'
  END AS warning_level,
  GREATEST(ts.last_timesheet_checkout, mch.last_machine_end::timestamptz) AS last_activity_at
FROM sow_plan sp
LEFT JOIN ts
  ON ts.order_no = sp.order_no
 AND ts.operation_no = sp.operation_no
LEFT JOIN mch
  ON mch.order_no = sp.order_no
 AND mch.operation_no = sp.operation_no;
```

### 7.2 Machine Accuracy View

Use query from `jobs/etl/sql_anomali_mch_productiondata.sql`, then add severity:

```sql
CASE
  WHEN total_count >= 20 AND accuracy_pct = 0 THEN 'CRITICAL'
  WHEN total_count >= 50 AND accuracy_pct < 80 THEN 'CRITICAL'
  WHEN total_count >= 50 AND accuracy_pct < 95 THEN 'WARNING'
  WHEN total_count >= 50 AND accuracy_pct < 98 THEN 'INFO'
  ELSE 'OK'
END AS warning_level
```

### 7.3 Open Transaction View

```sql
SELECT
  'TIMESHEET' AS source,
  tsnumber::text AS source_id,
  order_no,
  operation_no,
  workcentercode AS workcenter,
  serialnumber,
  full_name,
  longdate_checkin AS started_at,
  EXTRACT(EPOCH FROM (now() - longdate_checkin)) / 3600 AS open_hours,
  CASE
    WHEN longdate_checkin < now() - interval '12 hours' THEN 'CRITICAL'
    WHEN longdate_checkin < now() - interval '8 hours' THEN 'WARNING'
    ELSE 'OK'
  END AS warning_level
FROM public.timesheet_transaction
WHERE longdate_checkout IS NULL
  AND longdate_checkin IS NOT NULL
UNION ALL
SELECT
  'MACHINE' AS source,
  proddataid::text AS source_id,
  order_no,
  NULLIF(operation_no, '')::int,
  workcentercode,
  sn_employee,
  full_name,
  startdatetime::timestamptz,
  EXTRACT(EPOCH FROM (now() - startdatetime::timestamptz)) / 3600,
  CASE
    WHEN startdatetime < now() - interval '12 hours' THEN 'CRITICAL'
    WHEN startdatetime < now() - interval '8 hours' THEN 'WARNING'
    ELSE 'OK'
  END
FROM public.mch_transaction
WHERE enddatetime IS NULL
  AND startdatetime IS NOT NULL
  AND operation_no ~ '^[0-9]+$';
```

## 8. UI Concept

Route suggestion:

```text
/early-warning
```

Layout:

- Header white, page background `bg-slate-50`.
- Summary cards:
  - Critical
  - Warning
  - Planhours exhausted
  - Machine accuracy below threshold
  - Open stale transaction
  - Missing mapping
- Tabs:
  - All
  - Planhours
  - Machine Accuracy
  - Mapping
  - Open Transactions
  - SAP Readiness
- Table columns:
  - Severity
  - Type
  - Order / Operation
  - Workcenter / Machine
  - Metric
  - Last seen
  - Status
  - Action
- Detail drawer:
  - source rows count
  - SQL-derived metrics
  - recommended action

## 9. Recommended Actions Per Warning

| Warning | Recommended user action |
|---|---|
| Planhours exhausted | Review SOW planhours, check mapping, request/approve overrun if actual work is valid |
| TS vs MCH variance | Compare timesheet records vs machine records; check machine jobid mapping |
| Machine accuracy low | Check machine data capture, operator jobid input, ETL mapping |
| Missing SOW mapping | Create/update SOW or correct transaction order-operation |
| SOW without PH3 | Check SAP staging / PH3 ETL completeness |
| TECO activity | Stop activity, check SAP status, decide reversal/rework flow |
| Open stale transaction | Force checkout / correct transaction |
| Negative duration | Correct timestamp/duration calculation |
| Operator > 16h/day | Check overlapping checkins or fragmented rows |

## 10. Implementation Plan

### Phase 0 - Confirm Rules

1. Confirm whether `combined_hours = timesheet + machine` is correct for plan consumption, or if system should treat them as separate actual sources.
2. Confirm `state_flag` values and which states must be excluded.
3. Confirm how to identify productive vs unproductive timesheet rows.
4. Confirm whether TECO source is only `ph3_order.order_description`, or there is a better SAP status column.
5. Confirm alert thresholds with PE / production / PPC.

### Phase 1 - Database Views

1. Add migration:
   - `database/migrations/api/20260623_early_warning_views.sql`
2. Create views:
   - `vw_ew_planhours_consumption`
   - `vw_ew_mch_data_accuracy_daily`
   - `vw_ew_open_transactions`
   - `vw_ew_missing_mapping`
   - `vw_ew_timesheet_machine_variance`
3. Add indexes if query plan is slow:
   - `timesheet_transaction(order_no, operation_no)`
   - `timesheet_transaction(longdate_checkin, longdate_checkout)`
   - `mch_transaction(order_no, operation_no)`
   - `mch_transaction(startdatetime, enddatetime)`
   - `mch_productiondata(startdatetime, machineno, jobid)`
   - `sow(order_no, operation_no)`
   - `ph3_order(order_no, operation_no)`

### Phase 2 - API

1. Add routes:
   - `GET /early-warning/summary`
   - `GET /early-warning/events`
   - `GET /early-warning/order/:orderNo/:operationNo`
2. First version can query views directly.
3. Return normalized response:

```json
{
  "severity": "CRITICAL",
  "type": "PLANHOURS_EXHAUSTED",
  "order_no": "1000124915",
  "operation_no": 500,
  "title": "Planhours exhausted",
  "metrics": {
    "planhours": 0.5,
    "timesheet_hours": 1080.97,
    "machine_hours": 0.66,
    "consume_pct": 216326.4
  }
}
```

### Phase 3 - Frontend Dashboard

1. Add page under operations/manufacturing area.
2. Keep it read-only.
3. Use corporate light color system.
4. Add filters:
   - severity
   - warning type
   - date range
   - workcenter
   - machine
   - order_no

### Phase 4 - Persisted Event Table

1. Create `early_warning_event`.
2. Add scheduled backend job.
3. Upsert warning events from views.
4. Add acknowledge / resolve endpoints.

### Phase 5 - Guardrails

1. Integrate with job selection.
2. Show non-blocking warning first.
3. Only block:
   - TECO order
   - planhours effective limit exhausted after overrun workflow exists
   - missing critical SAP confirmation data

## 11. Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Too many false positives | Start with read-only dashboard, tune thresholds |
| Unproductive rows pollute missing mapping | Add productive filter before counting |
| Planhours too small causes extreme percentages | Use `over_hours` and minimum planhours guard |
| Machine data anomaly bursts create noisy alerts | Use minimum `total_count`, rolling windows, and machine-level suppression |
| PH3 missing because source table incomplete | Separate `SOW_WITHOUT_PH3` from transaction blocking |
| Query performance | Materialized view or persisted event table after MVP |

## 12. Open Questions

1. Apakah actual plan consumption harus memakai:
   - timesheet only,
   - machine hours only,
   - atau combined timesheet + machine?
2. Activity type apa saja yang dianggap productive?
3. Apakah `ph3_order.order_description ILIKE '%TECO%'` cukup valid untuk status closed?
4. Apakah operator boleh start job jika planhours sudah 100% tetapi belum ada approval overrun?
5. Warning dikirim ke siapa:
   - PE,
   - PPC,
   - foreman,
   - atau admin timesheet?
6. Apakah warning machine accuracy perlu real-time per 2 jam atau cukup daily?

## 13. Recommended MVP Priority

Urutan yang paling bernilai:

1. `MCH_DATA_ACCURACY_LOW` karena sudah ada SQL dan terlihat ada drop besar.
2. `PLANHOURS_EXHAUSTED` untuk order-operation yang actual sudah melewati plan.
3. `OPEN_TRANSACTION_STALE` untuk mengurangi data kotor.
4. `MISSING_MAPPING` untuk membersihkan sumber gagal join/SAP post.
5. `TECO_ACTIVITY` untuk mencegah transaksi di order tertutup.
6. `TS_MCH_VARIANCE` setelah rule combined-hours dipastikan.

