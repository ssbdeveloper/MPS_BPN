# EWS Detail â€” Implementation Specification (MPS2)

> **Sumber**: EWS Detail.docx (Section 28 revisi)  
> **Project**: MPS2 â€” `D:\website\MPS2`  
> **Stack**: Node.js + Express + PostgreSQL + React + Vite + Tailwind  
> **Target**: Implementasi EWS per-KPI dengan alert engine, action table, escalation, dan dashboard detail

---

## 1. RINGKASAN SISTEM

### 1.1 5 KPI + Threshold Final

| KPI | Formula | ðŸŸ¢ Normal | ðŸŸ¡ Warning | ðŸ”´ Critical | Owner |
|-----|---------|----------|-----------|------------|-------|
| **Uptime** | Online Time / Total Elapsed Time | â‰¥ 99% | 98â€“99% | < 98% | IT (Wira) |
| **Accuracy** | 1 âˆ’ (Error Record / Total Record) | â‰¥ 98% | 95â€“98% | < 95% | Foreman/Spv |
| **Adoption** | 1 âˆ’ (Missing Time / Total Time) | â‰¥ 95% | 90â€“95% | < 90% | Foreman/Spv |
| **OEE_time** | Run Time / Total Time | â‰¥ 80% | 65â€“80% | < 65% | Foreman/Spv/PPIC |
| **OLE_time** | Working Time / Total Time | â‰¥ 85% | 70â€“85% | < 70% | Foreman/Spv/PPIC |

### 1.2 Layer System

```
Alert â”€â”€â†’ Detail â”€â”€â†’ Standard Action â”€â”€â†’ Correction â”€â”€â†’ Escalation â”€â”€â†’ Decision
  What     Where/When    How/Who/When       Action Table    Report Case     Manual Override
```

| Layer | Fungsi | Output |
|-------|--------|--------|
| **Alert** | Mendeteksi masalah lebih awal (What) | ðŸŸ¢ðŸŸ¡ðŸ”´ |
| **Detail** | Menganalisa masalah (Where/When/Why) | Breakdown per machine/operator/shift |
| **Std Action** | Tindakan wajib (How/Who/When) | Action list per KPI |
| **Correction** | Tracking tindakan + PIC + Aging | Action Table (Open/Closed) |
| **Escalation** | Report case, status, result (Report + Decision Req'd) | Auto-notification |
| **Control** | Monitoring impact, recurrent detection (Sustainability) | Trend analysis |

### 1.3 Coverage

EWS mencakup 5 dimensi: **Data**, **System**, **User**, **Machine**, **Manpower**

---

## 2. UPTIME HMI â€” Alert & Detail Specification

### 2.1 Tujuan

Monitoring dan deteksi apakah HMI benar-benar aktif (online) dan terhubung ke internet secara real-time.

### 2.2 Data Flow

```
PING/HEARTBEAT â†’ Connectivity Log â†’ Uptime % â†’ Alert Status â†’ FIXED Issues â†’ Escalate IF > 30 min â†’ Decision: Switch Manual
```

### 2.3 Data Structure (2 metode)

| Field | PING Method | HEARTBEAT Method |
|-------|-------------|------------------|
| Timestamp | âœ… | âœ… |
| Device_ID / IP â†’ Machine_ID | âœ… | âœ… |
| Ping_Status (1=success, 0=fail) | âœ… | â€” |
| Beat_Status (1=OK, 0=missing) | â€” | âœ… |

### 2.4 Database Table

```sql
CREATE TABLE ews.connectivity_log (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    ip_address VARCHAR(45),
    ping_status INTEGER NOT NULL CHECK (ping_status IN (0, 1)),
    heartbeat_status INTEGER CHECK (heartbeat_status IN (0, 1)),  -- NEW
    ping_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    response_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_conn_device_time ON ews.connectivity_log(device_id, ping_timestamp);
```

### 2.5 Calculation Logic (PostgreSQL)

```sql
-- Uptime % per device per periode
SELECT
    device_id,
    ROUND(SUM(ping_status)::numeric / COUNT(*) * 100, 2) AS uptime_pct,
    ROUND(COUNT(*) FILTER (WHERE ping_status = 0) * 10.0 / 60, 2) AS downtime_minutes
FROM ews.connectivity_log
WHERE ping_timestamp BETWEEN $1 AND $2
GROUP BY device_id;
```

### 2.6 False Alert Protection

- **Continuous failure**: 6 consecutive fail (6 Ã— 10 detik = 1 menit) baru real problem
- **Implementation**: `failure_count_consecutive >= 6`

### 2.7 Advanced Signals

| Signal | Perhitungan | Fungsi |
|--------|-------------|--------|
| **Availability Window** | Uptime last 5 menit / 15 menit | Deteksi short spike vs real issue |
| **Downtime Duration** | (SUM ping_status=0) Ã— 10 / 60 | Durasi downtime sebenarnya |
| **Device Stability Index** | Jumlah putus-nyambung | Network issue tersembunyi |

### 2.8 Aggregation Level (WAJIB)

| Level | Scope | Pengguna |
|-------|-------|----------|
| Level 1 | Per device per hour | Monitor stability |
| Level 2 | Per shift | Kaitkan dengan operator/kondisi |
| Level 3 | Daily | Management view |

### 2.9 Dashboard Structure

```
PAGE: UPTIME
â”œâ”€â”€ OVERVIEW
â”‚   â”œâ”€â”€ Total System Uptime %
â”‚   â”œâ”€â”€ Critical Device Count
â”‚   â””â”€â”€ Uptime rate by Machine
â”œâ”€â”€ DETAIL â€” ACTION TABLE
â”‚   â”œâ”€â”€ Device list
â”‚   â”œâ”€â”€ Status (ðŸŸ¢ðŸŸ¡ðŸ”´)
â”‚   â””â”€â”€ Downtime duration
â””â”€â”€ TIMELINE (ECG monitor per device)
```

### 2.10 Standard Actions

| Status | Action |
|--------|--------|
| ðŸ”´ Critical | Cek jaringan â†’ Cek perangkat HMI â†’ Restart system â†’ **Backup data & Restore program** |
| ðŸŸ¡ Warning | Monitor â†’ Cek koneksi |
| ðŸŸ¢ Normal | No action |

### 2.11 Escalation

| Duration | Target |
|----------|--------|
| > 5 menit | Alert IT |
| > 30 menit (NOT FIXED) | **Eskalasi Plant Manager** |
| Decision needed | **Switch to Manual Time Record** |

---

## 3. ACCURACY DATA â€” Alert & Detail Specification

### 3.1 Tujuan

Mendeteksi apakah data dari HMI benar, lengkap, dan bisa dipercaya (valid).

### 3.2 Definisi Accuracy

```
Accuracy = 1 âˆ’ (SUM_Error Record / Total Record)
Error_Rate = SUM(Error) / COUNTROWS(Data)     â† lebih sensitif untuk alert
```

### 3.3 Error Type Classification (WAJIB)

| Error Type | Definisi | Contoh | Root Cause |
|------------|----------|--------|-------------|
| **Missing** | Field kosong/null | machineid kosong, conf_number null, sn_employee null | Operator tidak input |
| **Invalid** | Nilai tidak valid | Invalid ID_card, invalid job_number, status=5 terus | Training issue |
| **Inconsistent** | Data tidak konsisten | processing + waiting â‰  total | Logic/system |
| **Outlier** | Abnormal | Runtime 10 jam, output 0 terus | Abnormal event |
| **Duplicate** | Double input | Timestamp sama â†’ double record | System/operator |

### 3.4 Database Table

```sql
CREATE TABLE ews.data_validation_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL,
    device_id VARCHAR(50),
    operator_id VARCHAR(50),
    order_number VARCHAR(100),
    field_name VARCHAR(100),
    error_type VARCHAR(50) NOT NULL,  -- Missing, Invalid, Inconsistent, Outlier, Duplicate
    raw_value TEXT,
    is_error INTEGER DEFAULT 1,
    error_detail JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_valid_time ON ews.data_validation_log(timestamp);
CREATE INDEX idx_valid_type ON ews.data_validation_log(error_type);
CREATE INDEX idx_valid_machine ON ews.data_validation_log(device_id);
```

### 3.5 Calculation Logic (PostgreSQL)

```sql
-- Accuracy per machine per periode
SELECT
    device_id,
    COUNT(*) AS total_records,
    SUM(is_error) AS error_records,
    ROUND(1.0 - SUM(is_error)::numeric / COUNT(*), 4) AS accuracy_pct,
    ROUND(SUM(is_error)::numeric / COUNT(*), 4) AS error_rate
FROM ews.data_validation_log
WHERE timestamp BETWEEN $1 AND $2
GROUP BY device_id;
```

### 3.6 Alert Engine Threshold

| Status | Range |
|--------|-------|
| ðŸŸ¢ Normal | â‰¥ 98% |
| ðŸŸ¡ Warning | 95â€“98% |
| ðŸ”´ Critical | < 95% |

### 3.7 Root Cause Breakdown (WAJIB)

```
By ERROR TYPE:
  Missing    â†’ operator issue
  Invalid    â†’ training issue / HMI UI issue
  Inconsistent â†’ logic/system bug
  Outlier    â†’ abnormal event
  Duplicate  â†’ system/operator

By MACHINE    â†’ Machine A error tinggi
By OPERATOR   â†’ Operator shift tertentu input error
By SHIFT      â†’ Shift malam error tinggi
```

### 3.8 Dashboard Structure

```
PAGE: ACCURACY
â”œâ”€â”€ OVERVIEW
â”‚   â”œâ”€â”€ Accuracy %
â”‚   â”œâ”€â”€ Error Rate
â”‚   â””â”€â”€ Top error type
â”œâ”€â”€ DETAIL â€” By Machine / By Operator
â”‚   â”œâ”€â”€ Error by machine
â”‚   â”œâ”€â”€ Error by operator
â”‚   â””â”€â”€ Error type breakdown (pie/bar)
â””â”€â”€ ACTION TABLE
    â”œâ”€â”€ Error_Type + PIC + Action + Status
    â””â”€â”€ Aging
```

### 3.9 Standard Actions

| Status | Action |
|--------|--------|
| ðŸ”´ Critical | Cek input data operator (HMI) â†’ **Cek QR code operation card** â†’ Validasi record oleh foreman â†’ Re-training |
| ðŸŸ¡ Warning | Monitoring â†’ Reminder operator |
| ðŸŸ¢ Normal | No action |

### 3.10 Escalation

| Duration | Target |
|----------|--------|
| > 1 jam | Supervisor/Foreman |
| > 3 jam | **Plant Manager** |

### 3.11 Important Insight

> Accuracy rendah â‰  operator malas. Bisa jadi: UI HMI sulit dipahami, system lag, WI tidak jelas. Jangan langsung "blame people" â†’ lihat system.

---

## 4. ADOPTION â€” Alert & Detail Specification

### 4.1 Tujuan

Memastikan sistem benar-benar digunakan secara konsisten dengan mendeteksi waktu tidak tercatat.

### 4.2 Definisi

```
Adoption = 1 âˆ’ (Missing Time / Total Time)
Missing Time = waktu tanpa aktivitas tercatat (gap antar record)
Total Time = SUM duration (EXCLUDING status "4" = No Job)
```

### 4.3 Detect Missing Time â€” Logic

Expected: 1 record / 10 detik per HMI. Kalau ada gap > expected â†’ missing.

```
Contoh:
  08:00â€“08:10 â†’ tidak ada data âŒ  (missing = 10 menit)
  08:10â€“08:20 â†’ ada data âœ…
  Adoption = 1 - (10/20) = 50%
```

### 4.4 Data Source

**Table**: `event_data_hmi` â†’ transform via **HMI_Event_With_Duration** (Power Query / Node.js equivalent)

### 4.5 HMI_Event_With_Duration Logic (M Power Query â†’ PostgreSQL translation)

```sql
-- Equivalent PostgreSQL untuk kalkulasi durasi antar event per machine
WITH sorted AS (
    SELECT
        machineid,
        timestamp,
        statusid,
        conf_number,
        ROW_NUMBER() OVER (PARTITION BY machineid ORDER BY timestamp) AS idx
    FROM event_data_hmi
    ORDER BY machineid, timestamp
),
with_next AS (
    SELECT
        s.*,
        LEAD(timestamp) OVER (PARTITION BY machineid ORDER BY timestamp) AS next_timestamp
    FROM sorted s
)
SELECT
    machineid,
    timestamp,
    statusid,
    conf_number,
    idx,
    next_timestamp,
    CASE
        WHEN next_timestamp IS NULL THEN 0
        ELSE EXTRACT(EPOCH FROM (next_timestamp - timestamp))
    END AS duration_seconds,
    LEAST(
        CASE WHEN next_timestamp IS NULL THEN 0
             ELSE EXTRACT(EPOCH FROM (next_timestamp - timestamp)) END,
        600  -- cap 10 menit (anti spike)
    ) AS duration_seconds_capped
INTO TEMP TABLE hmi_event_with_duration
FROM with_next;
```

### 4.6 Alert Engine

| Status | Range |
|--------|-------|
| ðŸŸ¢ Normal | â‰¥ 95% |
| ðŸŸ¡ Warning | 90â€“95% |
| ðŸ”´ Critical | < 90% |

### 4.7 False Signal Protection

Status "4" (No Job) dikecualikan dari Total Time â€” briefing operator tidak dianggap missing.

```sql
Total_Time = SUM(duration_seconds) WHERE statusid <> '4'
```

### 4.8 Root Cause Breakdown

```
By MACHINE   â†’ HMI A adoption rendah
By OPERATOR  â†’ Operator tertentu tidak konsisten
By SHIFT     â†’ Shift malam adoption drop
By TIME SLOT â†’ Jam tertentu missing tinggi (behavior vs system)
```

### 4.9 Problem Classification (PENTING)

| Cause | Symptoms | Action |
|-------|----------|--------|
| **Human** | Tidak input, lupa, tidak disiplin | Briefing, enforcement, training |
| **System** | HMI lambat, login sulit, UI tidak user friendly | Improve HMI system |
| **Process** | Tidak ada waktu input, flow kerja tidak memungkinkan | Redesign workflow |

> **Key insight**: Adoption adalah indikator TRUST. Adoption rendah = data tidak valid = seluruh system gagal.

### 4.10 Dashboard Structure

```
PAGE: ADOPTION
â”œâ”€â”€ OVERVIEW
â”‚   â”œâ”€â”€ Adoption %
â”‚   â”œâ”€â”€ Trend harian
â”‚   â””â”€â”€ Jumlah critical
â”œâ”€â”€ DETAIL
â”‚   â”œâ”€â”€ Adoption by machine
â”‚   â”œâ”€â”€ Adoption by operator
â”‚   â”œâ”€â”€ Adoption by shift
â”‚   â””â”€â”€ Gap timeline (jam kosong) â€” POWERFUL
â””â”€â”€ ACTION TABLE
```

### 4.11 Standard Actions

| Status | Action |
|--------|--------|
| ðŸ”´ Critical | Cek alasan tidak input â†’ Cek HMI/system â†’ Briefing operator |
| ðŸŸ¡ Warning | Reminder â†’ Monitoring |
| ðŸŸ¢ Normal | No action |

### 4.12 Escalation

| Duration | Target |
|----------|--------|
| > 3 jam | Supervisor/Foreman |
| > 2 hari | Manager |

### 4.13 Advanced Cross-KPI Diagnosis

| Condition | Insight |
|-----------|---------|
| Adoption rendah + Uptime tinggi | Human issue |
| Adoption rendah + Uptime rendah | System issue (HMI down/network) |
| Adoption rendah + OLE rendah | Input issue, bukan real inefficiency |

---

## 5. OEE_time â€” Alert & Detail Specification

### 5.1 Definisi (UPDATED â€” berbeda dari dokumen sebelumnya)

```text
OEE_time = Running Time / Denominator Time * 100
```

Definisi yang dipakai EWS saat ini:

- `Running Time` = `status_activitytype IN ('M1', 'M2')` atau `status_description = 'Productive'`.
- `Denominator Time` = `duration_hours > 0`, kecuali `No Job`, `Off`, `Preventive`, `Breakdown`, `Coffee Break / Lunch`, dan `Daily PM`.
- `M2` dihitung sebagai running untuk KPI, tetapi tetap ditampilkan sebagai `NNVA` di detail.
- `statusid = 5` ditampilkan sebagai `Missing`.
- `statusid = 4` ditampilkan sebagai `NoJob`.

Catatan: ini adalah **time-based OEE proxy** untuk EWS, bukan OEE klasik `Availability x Performance x Quality`.

### 5.2 Data Structure

| Field | Type |
|-------|------|
| Timestamp | TIMESTAMP |
| Machineid | VARCHAR |
| Is_Run (1=jalan, 0=stop) | INTEGER |
| Downtime_Type (optional) | VARCHAR |

### 5.3 Calculation Logic (PostgreSQL)

```sql
WITH base AS (
  SELECT
    machineid,
    machinename,
    duration_hours,
    statusid,
    COALESCE(status_activitytype, '') AS status_activitytype,
    LOWER(BTRIM(COALESCE(status_description, ''))) AS status_description
  FROM public.mch_transaction
  WHERE startdatetime >= $1
    AND startdatetime < $2
    AND COALESCE(duration_hours, 0) > 0
)
SELECT
  machineid,
  MAX(machinename) AS machinename,
  COALESCE(SUM(duration_hours) FILTER (
    WHERE status_activitytype IN ('M1', 'M2')
       OR status_description = 'productive'
  ), 0) AS running_hours,
  COALESCE(SUM(duration_hours) FILTER (
    WHERE status_description NOT IN (
      'no job',
      'off',
      'preventive',
      'breakdown',
      'coffee break / lunch',
      'daily pm'
    )
  ), 0) AS denominator_hours,
  ROUND(
    COALESCE(SUM(duration_hours) FILTER (
      WHERE status_activitytype IN ('M1', 'M2')
         OR status_description = 'productive'
    ), 0)::numeric
    / NULLIF(COALESCE(SUM(duration_hours) FILTER (
      WHERE status_description NOT IN (
        'no job',
        'off',
        'preventive',
        'breakdown',
        'coffee break / lunch',
        'daily pm'
      )
    ), 0), 0) * 100,
    2
  ) AS oee_time_pct
FROM base
GROUP BY machineid;
```

### 5.4 Alert Engine

| Status | Range |
|--------|-------|
| ðŸŸ¢ Normal | â‰¥ 80% |
| ðŸŸ¡ Warning | 65â€“80% |
| ðŸ”´ Critical | < 65% |

### 5.5 Downtime Classification (VERY POWERFUL)

| Downtime Type | Penyebab | Action Owner |
|---------------|----------|-------------|
| **Breakdown** | Mesin rusak | Maintenance |
| **Setup** | Change order, loading/setting/measure/unloading | Operator/Setuper |
| **Material** | Nunggu material | PPIC/Logistik |
| **Operator** | Tidak standby | Foreman |

> Ini bikin OEE bukan cuma angka â€” tapi penyebab. Availability = system problem, bukan mesin saja.

### 5.6 Root Cause Analysis

```text
By MACHINE         -> Machine A sering stop
Waterfall          -> Total Time, Missing, NNVA, NoJob, NVA, VA
100% stacked bar   -> VA / NNVA / NVA / NoJob per machine
By SHIFT           -> shift malam availability rendah
```

### 5.7 Dashboard Structure

```
PAGE: OEE
â”œâ”€â”€ OVERVIEW
â”‚   â”œâ”€â”€ Availability % (OEE_time)
â”‚   â”œâ”€â”€ Trend harian
â”‚   â””â”€â”€ Critical machine count
â”œâ”€â”€ DETAIL â€” Machine View
â”‚   â”œâ”€â”€ Machine ranking
â”‚   â”œâ”€â”€ Status (ðŸŸ¢ðŸŸ¡ðŸ”´)
â”‚   â””â”€â”€ Downtime duration
â””â”€â”€ LOSS ANALYSIS
    â”œâ”€â”€ Downtime reason breakdown (Six Big Loss)
    â””â”€â”€ Micro (<1 min) vs Major (>5 min) loss
```

### 5.8 Standard Actions

| Status | Action |
|--------|--------|
| ðŸ”´ Critical | Cek mesin (breakdown) â†’ Cek material â†’ Cek operator â†’ Technical support |
| ðŸŸ¡ Warning | Monitor â†’ Preventive check |
| ðŸŸ¢ Normal | No action |

### 5.9 Escalation

| Duration | Target |
|----------|--------|
| > 10 menit | Supervisor |
| > 30 menit | Maintenance |
| > 1 jam | Manager |

### 5.10 Advanced

| Metric | Description |
|--------|-------------|
| MTBF | Mean Time Between Failure |
| MTTR | Mean Time To Repair |
| Micro vs Major loss | <1 min minor, >5 min major |
| Bottleneck + OEE | Low OEE + bottleneck = critical system issue |

---

## 6. OLE_time â€” Alert & Detail Specification

### 6.1 Definisi

```
OLE_time = Effective Working Time / Planned Working Time
```
"Berapa banyak waktu operator benar-benar efektif bekerja"

### 6.2 Data Structure

| Field | Type |
|-------|------|
| Timestamp | TIMESTAMP |
| Operator_ID | VARCHAR |
| Machineid | VARCHAR |
| Is_Working (1=aktif, 0=tidak) | INTEGER |
| Activity_Type | VARCHAR (optional) |

### 6.3 Activity Breakdown (RECOMMENDED)

| Activity | Makna | Kategori |
|----------|-------|----------|
| Processing / NNVA | Kerja produktif | âœ… |
| Waiting | Nunggu material/mesin | âŒ NVA |
| Idle | Tidak kerja | âŒ NVA |

### 6.4 Alert Engine

| Status | Range |
|--------|-------|
| ðŸŸ¢ Normal | â‰¥ 85% |
| ðŸŸ¡ Warning | 70â€“85% |
| ðŸ”´ Critical | < 70% |

### 6.5 Root Cause Analysis

```
By OPERATOR       â†’ Operator A OLE rendah
By MACHINE        â†’ Machine A operator sering idle
By SHIFT          â†’ Shift tertentu drop
By ACTIVITY TYPE  â†’ waiting tinggi = material issue, idle tinggi = scheduling issue
```

### 6.6 Dashboard Structure

```
PAGE: OLE
â”œâ”€â”€ OVERVIEW
â”‚   â”œâ”€â”€ OLE %
â”‚   â”œâ”€â”€ Trend
â”‚   â””â”€â”€ Critical operator count
â”œâ”€â”€ DETAIL â€” Operator View
â”‚   â”œâ”€â”€ Operator ranking
â”‚   â”œâ”€â”€ Status (ðŸŸ¢ðŸŸ¡ðŸ”´)
â”‚   â””â”€â”€ Activity breakdown: Processing vs Waiting vs Idle
â””â”€â”€ ACTION TABLE
```

### 6.7 Standard Actions

| Status | Action |
|--------|--------|
| ðŸ”´ Critical | Cek workflow â†’ Cek material readiness â†’ Cek coordination â†’ Coaching operator |
| ðŸŸ¡ Warning | Monitoring â†’ Improvement ringan |
| ðŸŸ¢ Normal | No action |

### 6.8 Cross-KPI Diagnosis (GAME CHANGER)

| Condition | Insight |
|-----------|---------|
| OEE rendah + OLE tinggi | **Mesin problem**, operator OK |
| OEE tinggi + OLE rendah | **Operator tidak efektif**, mesin OK |
| OLE rendah + Adoption rendah | **Input issue** |
| OLE rendah + Adoption tinggi | **Real inefficiency** |
| OLE rendah + Bottleneck | **Critical system issue** |

### 6.9 Escalation

| Duration | Target |
|----------|--------|
| > 1 shift | Supervisor |
| > 2 hari | Manager |

### 6.10 Advanced

| Metric | Description |
|--------|-------------|
| **Team efficiency** | Avg OLE per team |
| **Operator consistency** | Variance antar operator |
| **Skill gap detection** | Operator A jauh lebih rendah â†’ training need |

---

## 7. UNIFIED ALERT SYSTEM (CONTROL TOWER)

### 7.1 Overall System Status

```
Jika ada 1 KPI ðŸ”´ â†’ System CRITICAL
Jika 0 ðŸ”´ + ada ðŸŸ¡ â†’ System WARNING
Jika semua ðŸŸ¢ â†’ System NORMAL
```

### 7.2 Weighted Severity Scoring

```
Alert_Score =
    Accuracy Ã— 0.30 +
    Adoption Ã— 0.25 +
    OEE      Ã— 0.20 +
    OLE      Ã— 0.15 +
    Uptime   Ã— 0.10

Score interpretation:
  0.0 â€“ 0.4 â†’ ðŸŸ¢ Normal
  0.4 â€“ 0.7 â†’ ðŸŸ¡ Warning
  > 0.7     â†’ ðŸ”´ Critical
```

### 7.3 Alert Priority

| Combination | Priority |
|-------------|----------|
| Critical + High Impact | **URGENT â€” ðŸ”´ Immediate Action** |
| Critical + Low Impact | **NORMAL â€” ðŸŸ¡ Plan Action** |
| Warning | **MONITOR â€” ðŸŸ¢ Monitor** |

### 7.4 Alert Table Structure (WAJIB)

| Field | Tipe | Deskripsi |
|-------|------|-----------|
| Date | TIMESTAMP | Tanggal alert |
| Machine | VARCHAR | Machine ID |
| KPI_Type | VARCHAR | Uptime / Accuracy / Adoption / OEE / OLE |
| Status | VARCHAR | ðŸŸ¢ðŸŸ¡ðŸ”´ |
| Severity | VARCHAR | Critical / Warning / Normal |
| Action | TEXT | Suggested action |
| PIC | VARCHAR | Penanggung jawab |
| Status_Action | VARCHAR | Open / In Progress / Closed |
| Aging | INTERVAL | Durasi sejak alert muncul |

### 7.5 Action Tracking Table

```sql
CREATE TABLE ews.action_table (
    action_id SERIAL PRIMARY KEY,
    alert_id INTEGER REFERENCES ews.alert_log(id),
    machine_id VARCHAR(50),
    kpi_type VARCHAR(50),
    status_reason TEXT,
    action_taken TEXT NOT NULL,
    pic VARCHAR(100) NOT NULL,
    action_status VARCHAR(50) DEFAULT 'Open',
    start_time TIMESTAMP DEFAULT NOW(),
    close_time TIMESTAMP,
    aging INTERVAL GENERATED ALWAYS AS (
        CASE WHEN close_time IS NULL
             THEN NOW() - start_time
             ELSE close_time - start_time
        END
    ) STORED,
    last_updated TIMESTAMP DEFAULT NOW(),
    updated_by VARCHAR(100)
);
```

### 7.6 Escalation Engine (Time-Based)

| Duration | Escalation Level |
|----------|-----------------|
| > 15 menit | Supervisor |
| > 1 jam | Manager |
| > 1 shift | **Plant Head** |

Auto-flag: `Escalation_Level` field di alert table.

### 7.7 Escalation Rules Per KPI

| KPI | ðŸ”´ Duration â†’ Escalation |
|-----|--------------------------|
| Uptime | > 5 min â†’ IT Alert; > 30 min â†’ Plant Manager |
| Accuracy | > 1 hour â†’ Supervisor; > 3 hours â†’ Plant Manager |
| Adoption | > 3 hours â†’ Supervisor; > 2 days â†’ Manager |
| OEE | > 10 min â†’ Supervisor; > 30 min â†’ Maintenance; > 1 hour â†’ Manager |
| OLE | > 1 shift â†’ Supervisor; > 2 days â†’ Manager |

---

## 8. DASHBOARD STRUCTURE (FINAL)

### 8.1 Multi-Page Design

```
MAIN PAGE = CONTROL TOWER
â”œâ”€â”€ Overall Status (GIANT INDICATOR)
â”œâ”€â”€ 5 KPI traffic lights
â”œâ”€â”€ Top 5 issues
â”œâ”€â”€ Alert Monitor (list alert aktif + severity + aging)
â””â”€â”€ Escalation pending

PAGE 1 â€” UPTIME
  Detail by PLC/Machine/HMI + Status + Action Table
  Timeline ECG per device

PAGE 2 â€” ADOPTION
  Detail by Machine ID / Operator ID
  Gap timeline

PAGE 3 â€” ACCURACY
  Detail by Machine ID / Operator ID
  Error type breakdown

PAGE 4 â€” OEE
  Detail by Machine_ID + OEE Loss (Six Big Loss)
  Reason for STOP + Action Table

PAGE 5 â€” OLE
  Detail by Machine_ID + OLE Loss (NVA)
  Processing vs Waiting vs Idle + Action Table
```

---

## 9. ALERT ENGINE â€” 4-Layer System (UNTUK IMPLEMENTASI)

### Layer 1: Alert Trigger (Condition)

```javascript
// API: apps/api/services/ewsCalculator.js
function getAlertFlag(kpis) {
    return (
        kpis.invalid_record_count > 0 ||
        kpis.adoption_rate < 0.90 ||
        kpis.accuracy_rate < 0.95 ||
        kpis.oee_time < 0.65 ||
        kpis.ole_time < 0.70
    ) ? 1 : 0;
}
```

### Layer 2: Alert Classification (Type)

```javascript
function getAlertType(kpis) {
    if (kpis.invalid_record_count > 0) return 'DATA ISSUE';
    if (kpis.adoption_rate < 0.90) return 'USER DISCIPLINE';
    if (kpis.accuracy_rate < 0.95) return 'DATA QUALITY';
    if (kpis.oee_time < 0.65) return 'MACHINE PERFORMANCE';
    if (kpis.ole_time < 0.70) return 'LABOR EFFICIENCY';
    return 'NORMAL';
}
```

### Layer 3: Alert Message (Insight)

```javascript
function getAlertMessage(kpis) {
    if (kpis.invalid_record_count > 0)
        return 'ðŸš¨ Data tidak valid (event >90 menit). Validasi diperlukan sebelum analisis';
    if (kpis.adoption_rate < 0.90)
        return 'ðŸš¨ Adoption rendah. Operator belum disiplin input aktivitas';
    if (kpis.accuracy_rate < 0.95)
        return 'ðŸš¨ Accuracy rendah. Data tidak lengkap atau tidak konsisten';
    if (kpis.oee_time < 0.65)
        return 'ðŸš¨ OEE sangat rendah. Mesin tidak optimal, cek downtime & loss';
    if (kpis.ole_time < 0.70)
        return 'ðŸš¨ Produktivitas operator rendah. Banyak waktu tidak produktif';
    return 'âœ… Sistem berjalan normal';
}
```

### Layer 4: Alert Severity (Color)

```javascript
function getAlertColor(kpis) {
    if (kpis.invalid_record_count > 0) return '#C00000'; // Critical
    if (kpis.oee_time < 0.65) return '#C00000';
    if (kpis.ole_time < 0.70) return '#C00000';
    if (kpis.adoption_rate < 0.90) return '#FFC000'; // Warning
    if (kpis.accuracy_rate < 0.95) return '#FFC000';
    return '#00B050'; // Normal
}
```

---

## 10. IMPLEMENTATION STEPS (AI AGENT READY)

### Phase 1: Database Migration

1. Buat SQL migration file: `database/schema/ews_detail_schema.sql`
2. Tambahkan tabel: `connectivity_log` (dengan heartbeat_status), `data_validation_log`, `action_table` (dengan aging column)
3. Tambahkan escalation fields: `escalation_level`, `escalation_time`

### Phase 2: Uptime Calculator

1. `apps/api/services/ewsCalculator.js` â†’ tambahkan method `calcUptime(machineId, fromTs, toTs)`
2. Hitung: uptime_pct, downtime_minutes, continuous_failure_count
3. Implementasi false alert protection (6 consecutive fail)

### Phase 3: Accuracy Calculator

1. Method `calcAccuracy(machineId, operatorId, fromTs, toTs)`
2. Error type classification: Missing, Invalid, Inconsistent, Outlier, Duplicate
3. Breakdown by error type, machine, operator, shift

### Phase 4: Adoption Calculator

1. Method `calcAdoption(machineId, fromTs, toTs)`
2. HMI_Event_With_Duration logic (PostgreSQL window function)
3. Missing_time detection (gap analysis)
4. Status "4" exclusion

### Phase 5: OEE_time + OLE_time Calculator

1. Method `calcOEETime(machineId, fromTs, toTs)` â†’ Run Time / Total Time
2. Method `calcOLETime(machineId, operatorId, fromTs, toTs)` â†’ Working / Total Time
3. Downtime classification (Breakdown/Setup/Material/Operator)
4. Activity breakdown (Processing/Waiting/Idle)

### Phase 6: Unified Alert Engine

1. Method `calculateSystemSummary()` â€” combine 5 KPI
2. Overall status, severity score, alert priority
3. Alert table insert ke `ews.alert_log`

### Phase 7: Dashboard Pages (Frontend)

1. Control Tower (main page) â€” 5 KPI lights + top issues
2. Page Uptime â€” ECG timeline + action table
3. Page Accuracy â€” Error breakdown + operator drill-down
4. Page Adoption â€” Gap timeline + machine/operator/shift breakdown
5. Page OEE â€” Loss analysis (Six Big Loss) + action table
6. Page OLE â€” Processing vs Waiting vs Idle + operator ranking

### Phase 8: Action & Escalation

1. Action table CRUD API (`/api/ews/actions`)
2. Escalation logic per KPI (time-based)
3. Auto-escalation flag update
4. Action history / audit trail

---

## 11. QUICK START PROMPT (UNTUK AI AGENT)

```
Implement EWS Detail per KPI di D:\website\MPS2.
Baca spesifikasi di:
  - D:\website\MPS2\docs\timesheet\EARLY_WARNING_SYSTEM_PLAN.md (arsitektur)
  - D:\website\MPS2\docs\timesheet\EWS_DETAIL.md                   (file ini, detail per KPI)

Database: PostgreSQL di 100.86.231.55:5433, database ptssb
  user: tag, pass: @dminta9

Gunakan tunnel:
  python C:\Users\tee.san\tools\tailscale\tunnel.py 100.86.231.55 5433 5434
  DB_HOST=localhost DB_PORT=5434

Stack: Node.js + Express + React + Vite + Tailwind

Phase yang akan dikerjakan: [pilih phase dari Section 10]
```

---

**Status**: ðŸ“‹ SPECIFICATION READY  
**Last Updated**: 2026-06-27  
**Sumber**: EWS Detail.docx
