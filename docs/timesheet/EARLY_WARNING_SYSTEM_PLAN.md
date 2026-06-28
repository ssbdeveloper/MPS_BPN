# Section 28 — POST GOLIVE Early Warning System (EWS)

> **Sumber**: Section 28 POST GOLIVE Early Warning System 1.docx  
> **Project**: MPS2 — Digital Timesheet & Production Monitoring (PT. Sanggar Sarana Baja)  
> **Path**: `D:\website\MPS2`  
> **Target**: Implementasi EWS berbasis 5 KPI di dalam aplikasi MPS2 existing

---

## 1. KONSEP BESAR

### 1.1 Apa itu EWS?

Early Warning System adalah sistem deteksi dini yang memonitor **5 KPI utama** secara real-time. Begitu ada KPI yang turun di bawah threshold, sistem langsung kasih alert + rekomendasi tindakan.

### 1.2 Struktur Layer

```
Alert ──→ Detail ──→ Standard Action ──→ Correction ──→ Escalation
```

| Layer | Fungsi | Output |
|-------|--------|--------|
| **Alert** | Deteksi masalah lebih awal | 🟢🟡🔴 status |
| **Detail** | Analisa akar masalah (where/when/why) | Breakdown per machine/operator/shift |
| **Std Action** | Tindakan wajib yang harus dilakukan | Action list per KPI |
| **Correction** | Tracking tindakan & PIC | Action_Table (status Open/Closed) |
| **Escalation** | Eskalasi ke manajemen jika overdue | Auto-notification |

### 1.3 5 KPI

| KPI | Formula | Target | Owner |
|-----|---------|--------|-------|
| **Uptime** | Online Time / Total Elapsed Time | ≥ 99% | IT (Wira) |
| **Accuracy** | 1 - (Error Record / Total Record) | ≥ 97% | Foreman/Spv |
| **Adoption** | 1 - (Missing Time / Total Time) | ≥ 95% | Foreman/Spv |
| **OEE** | Running Time / Total Time | ≥ 65% | Foreman/Spv/PPIC |
| **OLE** | Working Time / Total Time | ≥ 85% | Foreman/Spv/PPIC |

### 1.4 Coverage

EWS mencakup 5 dimensi: **Data**, **System**, **User**, **Machine**, **Manpower**

---

## 2. EWS ARCHITECTURE (CARA KERJA)

```
┌─────────────────────────────────────────────────────────────┐
│                     SOURCE DATA LAYER                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ HMI Events   │  │ Ping Log     │  │ Production Data    │  │
│  │ (Timesheet)  │  │ (Uptime)     │  │ (OEE/OLE)         │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘  │
├─────────┼─────────────────┼───────────────────┼──────────────┤
│         ▼                 ▼                   ▼              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              ALERT ENGINE (Node.js API)               │    │
│  │  ┌───────────┐  ┌──────────┐  ┌──────────────────┐   │    │
│  │  │ Alert      │  │ Detail   │  │ Std Action        │   │    │
│  │  │ Flag       │──│ Breakdown│──│ Suggestion        │   │    │
│  │  │ Condition  │  │ Root     │  │ Mapping per KPI   │   │    │
│  │  │ 🟢🟡🔴    │  │ Cause    │  │                   │   │    │
│  │  └───────────┘  └──────────┘  └──────────────────┘   │    │
│  └──────────────────────┬───────────────────────────────┘    │
├─────────────────────────┼────────────────────────────────────┤
│                         ▼                                    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              PRESENTATION LAYER                        │    │
│  │  ┌────────────────┐  ┌────────────┐  ┌─────────────┐ │    │
│  │  │ React Dashboard│  │ Power BI   │  │ TTS / Audio │  │    │
│  │  │ (apps/web)     │  │ (optional) │  │ Announcer   │  │    │
│  │  └────────────────┘  └────────────┘  └─────────────┘ │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. DATABASE TABLES (YANG PERLU DIBUAT / DIMODIFIKASI)

### 3.1 Tabel yang SUDAH ADA di MPS2

| Table | Fungsi | Relevan untuk EWS |
|-------|--------|-------------------|
| `event_data_hmi` | Data timesheet HMI (production events) | ✅ Accuracy, Adoption |
| `hmi_event_with_duration` | HMI event dengan kalkulasi durasi | ✅ Adoption |
| `fact_machinehours` | Production data per machine | ✅ OEE |
| `dim_machine` | Master machine | ✅ Semua KPI |
| `dim_operator` | Master operator | ✅ OLE, Adoption |
| `dim_shift` | Shift definition | ✅ Semua breakdown |

### 3.2 Tabel BARU yang Perlu Dibuat

#### a) `connectivity_log` — Uptime

```sql
CREATE TABLE ews.connectivity_log (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    ip_address VARCHAR(45),
    ping_status INTEGER NOT NULL CHECK (ping_status IN (0, 1)), -- 1=success, 0=fail
    ping_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    response_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_connectivity_device_time ON ews.connectivity_log(device_id, ping_timestamp);
```

#### b) `data_validation_log` — Accuracy

```sql
CREATE TABLE ews.data_validation_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL,
    device_id VARCHAR(50),
    operator_id VARCHAR(50),
    order_number VARCHAR(100),
    field_name VARCHAR(100),
    error_type VARCHAR(50) NOT NULL, -- Missing, Invalid, Inconsistent, Outlier
    raw_value TEXT,
    is_error INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_validation_time ON ews.data_validation_log(timestamp);
CREATE INDEX idx_validation_type ON ews.data_validation_log(error_type);
```

#### c) `alert_log` — Unified Alert Table

```sql
CREATE TABLE ews.alert_log (
    id SERIAL PRIMARY KEY,
    alert_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    machine_id VARCHAR(50),
    kpi_type VARCHAR(50) NOT NULL, -- Uptime, Accuracy, Adoption, OEE, OLE
    kpi_value DECIMAL(10,6),
    threshold_value DECIMAL(10,6),
    severity VARCHAR(20) NOT NULL, -- Normal, Warning, Critical
    alert_flag INTEGER DEFAULT 0, -- 0=no alert, 1=alert
    alert_message TEXT,
    detail_json JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_alert_time ON ews.alert_log(alert_timestamp);
CREATE INDEX idx_alert_severity ON ews.alert_log(severity, kpi_type);
CREATE INDEX idx_alert_flag ON ews.alert_log(alert_flag, alert_timestamp);
```

#### d) `action_table` — Correction Layer

```sql
CREATE TABLE ews.action_table (
    action_id SERIAL PRIMARY KEY,
    alert_id INTEGER REFERENCES ews.alert_log(id),
    machine_id VARCHAR(50),
    kpi_type VARCHAR(50),
    status_reason TEXT,
    action_taken TEXT NOT NULL,
    pic VARCHAR(100) NOT NULL,
    action_status VARCHAR(50) DEFAULT 'Open', -- Open, In Progress, Closed
    action_date TIMESTAMP DEFAULT NOW(),
    last_updated TIMESTAMP DEFAULT NOW(),
    updated_by VARCHAR(100)
);

CREATE INDEX idx_action_status ON ews.action_table(action_status);
CREATE INDEX idx_action_machine ON ews.action_table(machine_id);
```

#### e) `action_history` — Audit Trail

```sql
CREATE TABLE ews.action_history (
    id SERIAL PRIMARY KEY,
    action_id INTEGER REFERENCES ews.action_table(action_id),
    old_status VARCHAR(50),
    new_status VARCHAR(50),
    changed_by VARCHAR(100),
    change_timestamp TIMESTAMP DEFAULT NOW(),
    notes TEXT
);
```

#### f) `ews_kpi_summary` — Materialized / Aggregate View

```sql
CREATE TABLE ews.kpi_summary (
    id SERIAL PRIMARY KEY,
    calc_timestamp TIMESTAMP NOT NULL,
    machine_id VARCHAR(50),
    operator_id VARCHAR(50),
    shift_id INTEGER,
    
    -- Uptime metrics
    uptime_pct DECIMAL(10,6),
    uptime_status VARCHAR(20),
    
    -- Accuracy metrics
    accuracy_pct DECIMAL(10,6),
    error_rate DECIMAL(10,6),
    accuracy_status VARCHAR(20),
    
    -- Adoption metrics
    adoption_pct DECIMAL(10,6),
    missing_minutes DECIMAL(10,2),
    adoption_status VARCHAR(20),
    
    -- OEE metrics
    oee_availability DECIMAL(10,6),
    oee_status VARCHAR(20),
    
    -- OLE metrics
    ole_availability DECIMAL(10,6),
    ole_status VARCHAR(20),
    
    -- System-level
    overall_status VARCHAR(20),
    overall_score DECIMAL(10,6),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_kpi_time ON ews.kpi_summary(calc_timestamp);
CREATE INDEX idx_kpi_machine ON ews.kpi_summary(machine_id, calc_timestamp);
```

---

## 4. ALERT THRESHOLD & LOGIC

### 4.1 Threshold per KPI

| KPI | 🟢 Normal | 🟡 Warning | 🔴 Critical |
|-----|----------|-----------|------------|
| **Uptime** | ≥ 98% | 95–98% | < 95% |
| **Accuracy** | ≥ 97% | 95–97% | < 95% |
| **Adoption** | ≥ 95% | 90–95% | < 90% |
| **OEE** | ≥ 65% | 50–65% | < 50% |
| **OLE** | ≥ 85% | 70–85% | < 70% |

### 4.2 False Alert Protection

- **Uptime**: Gunakan "continuous failure" — 6 consecutive fail (6 × 10 detik = 1 menit) baru dianggap real problem
- **Accuracy**: Minimum record threshold — kalau < 50 record, ignore alert
- **Adoption**: Status "4" (No Job) dikecualikan dari Total_Time
- **OEE**: Stop < 1 menit = micro disturbance (bukan real downtime)
- **OLE**: Cek konteks — OEE tinggi + OLE rendah = mesin OK, operator tidak efektif

### 4.3 Overall System Status (unified alert)

```
Jika ada 1 KPI 🔴  → System CRITICAL
Jika 0 🔴 tapi ada 🟡 → System WARNING
Jika semua 🟢 → System NORMAL
```

### 4.4 Severity Scoring (weighted)

```
Alert_Score = (Accuracy × 0.3) + (Adoption × 0.25) + (OEE × 0.2) + (OLE × 0.15) + (Uptime × 0.1)

0.0 – 0.4  → 🟢 Normal
0.4 – 0.7  → 🟡 Warning  
> 0.7      → 🔴 Critical
```

---

## 5. STEP-BY-STEP IMPLEMENTATION PLAN

### Phase 1: DATABASE SETUP (2-3 hari)

#### Step 1.1 — Create EWS Schema
Buat schema `ews` di database `ptssb`. Lokasi file SQL: `database/schema/ews_schema.sql`

**Tindakan**: Buat schema + semua tabel baru yang disebut di Section 3.2

#### Step 1.2 — Seed Data (Test)
Import sample data untuk testing alert logic:
- `connectivity_log` — sample ping data dengan beberapa failure
- `data_validation_log` — sample error records (missing, invalid, etc.)

#### Step 1.3 — Create DB Views / Functions
Buat PostgreSQL functions untuk kalkulasi KPI:
- `ews.calc_uptime(machine_id, from_ts, to_ts)` → returns uptime %
- `ews.calc_accuracy(machine_id, from_ts, to_ts)` → returns accuracy % + error rate
- `ews.calc_adoption(machine_id, from_ts, to_ts)` → returns adoption % + missing minutes
- `ews.calc_oee(machine_id, from_ts, to_ts)` → returns OEE availability
- `ews.calc_ole(machine_id, operator_id, from_ts, to_ts)` → returns OLE

---

### Phase 2: PING / UPTIME MONITOR (2-3 hari)

#### Step 2.1 — Machine Ping Script
Buat cron job yang ping HMI devices setiap 10 detik.

**File**: `jobs/machine_ping/ping_monitor.js`

**Logic**:
```
For each HMI device:
  ping device → success/fail
  insert ke ews.connectivity_log
  jika 6 consecutive fail → trigger alert
```

**Gunakan existing**: `scripts/ping_m5051_machines.js` sebagai referensi

#### Step 2.2 — Uptime Calculator
Buat API endpoint `/api/ews/uptime` yang return:
```json
{
  "machine_id": "HMI-01",
  "uptime_pct": 98.5,
  "status": "🟡 Warning",
  "downtime_minutes": 2.5,
  "last_failure": "2026-06-27T08:00:00+07:00",
  "trend": [...]
}
```

---

### Phase 3: API — ALERT ENGINE (5-7 hari)

#### Step 3.1 — Create EWS Route File
**File**: `apps/api/routes/ews.js` (atau tambahkan ke server.js)

Endpoints:

| Method | Route | Function |
|--------|-------|----------|
| GET | `/api/ews/status` | Overall system status (5 KPI lights) |
| GET | `/api/ews/uptime` | Uptime per machine + alert |
| GET | `/api/ews/accuracy` | Accuracy + error breakdown |
| GET | `/api/ews/adoption` | Adoption + missing time analysis |
| GET | `/api/ews/oee` | OEE availability + downtime classification |
| GET | `/api/ews/ole` | OLE per operator + activity breakdown |
| GET | `/api/ews/alerts` | Active alerts list |
| GET | `/api/ews/alerts/:id` | Alert detail + root cause |
| POST | `/api/ews/actions` | Create correction action |
| PUT | `/api/ews/actions/:id` | Update action status |
| GET | `/api/ews/actions` | Action tracking list |

#### Step 3.2 — Alert Calculation Logic
Implement 5 fungsi kalkulasi KPI di `apps/api/services/ewsCalculator.js`:

```javascript
// Template untuk setiap KPI calculator
async function calcKPI(machineId, fromTs, toTs) {
  // 1. Query raw data dari database
  // 2. Hitung KPI value
  // 3. Tentukan status (Normal/Warning/Critical) berdasarkan threshold
  // 4. Generate alert message & suggested action
  // 5. Insert ke ews.alert_log jika ada alert
  // 6. Return { value, status, message, action }
}
```

#### Step 3.3 — Accuracy Calculator (Detail)
```
Accuracy = 1 - (Error Record / Total Record)

Error types:
  - Missing: field kosong / null
  - Invalid: runtime negative, output = 0 terus
  - Inconsistent: processing + waiting ≠ total
  - Outlier: runtime > 10 jam (tidak masuk akal)
  - Duplicate: timestamp sama → double record

Breakdown by: Error Type, Machine, Operator, Shift
```

#### Step 3.4 — Adoption Calculator (Detail)
```
Adoption = 1 - (Missing Time / Total Time)

Missing Time = waktu tanpa aktivitas tercatat  
Total Time = SUM duration (excluding status "4" = No Job)

Breakdown by: Machine, Operator, Shift, Time Slot

NOTE: Step ini sudah ada SQL-nya di dokumen asli
(pakai HMI_Event_With_Duration + Power Query M script)
Terjemahkan ke PostgreSQL query/JS.
```

#### Step 3.5 — Unified Alert Engine
Buat `/api/ews/status` yang mengkombinasikan semua KPI:

```javascript
// Pseudo-code
function getOverallStatus() {
  const kpis = {
    uptime: calcUptime(),
    accuracy: calcAccuracy(),
    adoption: calcAdoption(),
    oee: calcOEE(),
    ole: calcOLE()
  };
  
  const critical = Object.values(kpis).filter(k => k.status === 'Critical');
  const warning = Object.values(kpis).filter(k => k.status === 'Warning');
  
  if (critical.length > 0) return { status: 'CRITICAL', color: '#C00000' };
  if (warning.length > 0) return { status: 'WARNING', color: '#FFC000' };
  return { status: 'NORMAL', color: '#00B050' };
}
```

---

### Phase 4: FRONTEND — EWS DASHBOARD (5-7 hari)

**Path**: `apps/web/src/pages/EWS/` atau tambahkan komponent ke dashboard existing

#### Step 4.1 — Control Tower (Block 1)
Components:
```
┌──────────────────────────────────────────────────────────┐
│  🟢 SYSTEM NORMAL                          Score: 0.85   │
├──────────┬──────────┬──────────┬──────────┬──────────────┤
│ UPTIME   │ ACCURACY │ ADOPTION │ OEE      │ OLE          │
│   99.2%  │   97.5%  │   96.1%  │   72.3%  │   88.0%      │
│   🟢     │   🟢     │   🟢     │   🟡     │   🟢         │
├──────────┴──────────┴──────────┴──────────┴──────────────┤
│ 🔥 Top 5 Issues                                          │
│ HMI-03: OEE 48.2%   HMI-07: Adoption 89.1%              │
└──────────────────────────────────────────────────────────┘
```

#### Step 4.2 — Alert Monitor (Block 2)
Table of active alerts dengan: Machine, KPI, Status, Severity, Aging, Action

#### Step 4.3 — Detail View (Block 3)
Drill-down per machine/operator/shift:
- **Uptime**: Timeline ping (kayak ECG monitor)
- **Accuracy**: Error by type, machine, operator
- **Adoption**: Gap timeline (jam kosong)
- **OEE**: Downtime reason breakdown
- **OLE**: Activity breakdown (Processing vs Waiting vs Idle)

#### Step 4.4 — Action Board (Block 4)
Table: Alert → Action → PIC → Status (Open/In Progress/Closed)
Form input action: Reason, PIC, Action, Status

#### Step 4.5 — Escalation View (Block 5)
List open issues, aging status, overdue items

---

### Phase 5: ACTION & ESCALATION SYSTEM (3-4 hari)

#### Step 5.1 — Action CRUD API
Implement POST/PUT/GET untuk `ews.action_table`:
- Create action item saat alert muncul
- Update status (Open → In Progress → Closed)
- Log history ke `ews.action_history`

#### Step 5.2 — Escalation Logic
```
Critical > 15 menit → notifikasi supervisor
Critical > 1 jam   → notifikasi manager
Critical > 1 shift → notifikasi plant head
```

#### Step 5.3 — Auto-Notification (Optional - Power Automate)
Kalau pakai Power Automate:
- Trigger: SQL query check alert_log
- Filter: overdue (alert masih open > threshold)
- Action: kirim email / Teams notification

Alternatif pure Node.js: gunakan `nodemailer` + cron job di `jobs/`

#### Step 5.4 — TTS Announcement Integration
Gunakan TTS worker existing (`apps/tts-worker/`) untuk announce critical alert:
- Trigger: alert severity = Critical
- Format: "Perhatian! [KPI] pada [Machine] status kritis. [Action]"

---

### Phase 6: INTEGRATION & TESTING (3-5 hari)

#### Step 6.1 — API Integration Tests
Test setiap endpoint dengan sample data

#### Step 6.2 — Frontend-Backend Integration
Wire up dashboard components ke API

#### Step 6.3 — Database Performance
- Index optimization untuk query KPI
- Materialized view untuk `ews.kpi_summary` (refresh setiap 60 detik)
- Connection pooling via `db.js` existing

#### Step 6.4 — UAT Scenarios
Testing scenario (dari dokumen):
- **Case 1**: Accuracy 🔴 + Adoption 🔴 + Uptime 🟢 = system OK, user issue
- **Case 2**: OEE 🔴 + OLE 🟢 = machine problem, operator OK
- **Case 3**: Uptime 🔴 + Adoption 🔴 + Accuracy 🔴 = total system failure

---

## 6. STANDARD ACTION MAPPING (UNTUK ALERT ENGINE)

### Uptime
| Status | Action | PIC |
|--------|--------|-----|
| 🔴 Critical | Cek jaringan → cek power device → restart HMI → notify IT | IT (Wira) |
| 🟡 Warning | Monitor → cek koneksi | IT |
| 🟢 Normal | No action | - |

Escalation: Critical > 5 min → supervisor, > 15 min → IT, > 30 min → manager

### Accuracy
| Status | Action | PIC |
|--------|--------|-----|
| 🔴 Critical | Cek input operator → validasi data → retraining → fix form HMI | Foreman/Spv |
| 🟡 Warning | Monitoring → reminder operator | Foreman |
| 🟢 Normal | No action | - |

Escalation: Critical > 1 shift → supervisor, > 1 hari → manager

### Adoption
| Status | Action | PIC |
|--------|--------|-----|
| 🔴 Critical | Cek alasan tidak input → cek HMI/system → briefing operator | Foreman/Spv |
| 🟡 Warning | Reminder → monitoring | Foreman |
| 🟢 Normal | No action | - |

Escalation: Critical > 1 shift → supervisor, > 2 hari → manager

### OEE
| Status | Action | PIC |
|--------|--------|-----|
| 🔴 Critical | Cek mesin (breakdown) → cek material → cek operator → technical support | Foreman/Spv/PPIC |
| 🟡 Warning | Monitor → preventive check | PPIC |
| 🟢 Normal | No action | - |

Escalation: Critical > 10 min → supervisor, > 30 min → maintenance, > 1 jam → manager

### OLE
| Status | Action | PIC |
|--------|--------|-----|
| 🔴 Critical | Cek workflow → cek material readiness → cek coordination → coaching operator | Foreman/Spv |
| 🟡 Warning | Monitoring → improvement ringan | Spv |
| 🟢 Normal | No action | - |

Escalation: Critical > 1 shift → supervisor, > 2 hari → manager

---

## 7. QUICK START (UNTUK AI AGENT)

Saat AI agent diminta mengerjakan EWS, gunakan prompt seperti ini:

```
Implement Early Warning System di D:\website\MPS2.
Baca file D:\website\MPS2\docs\timesheet\EARLY_WARNING_SYSTEM_PLAN.md
untuk spesifikasi lengkap.

Phase yang akan dikerjakan: [sebutkan phase]

Database: PostgreSQL di 100.86.231.55:5433
  database: ptssb
  user: tag
  pass: @dmintag

Tailscale SOCKS5 proxy: 127.0.0.1:1055

Gunakan tunnel untuk koneksi database:
  python C:\Users\tee.san\tools\tailscale\tunnel.py 100.86.231.55 5433 5434
  lalu DB_HOST=localhost DB_PORT=5434

Stack:
  - Backend: Node.js + Express (apps/api/)
  - Frontend: React + Vite + Tailwind (apps/web/)
  - Database: PostgreSQL (skema ews.*)
  - Jobs: Python/Node.js cron scripts (jobs/)

Kerjakan step by step, mulai dari database schema.
```

---

## 8. IMPORTANT INSIGHTS (DARI DOKUMEN ASLI)

1. **Ping ≠ 100% reliability** — ping success bisa aja HMI hang. Next level: heartbeat app + user activity + screen update

2. **Accuracy rendah ≠ operator malas** — bisa jadi UI HMI sulit, system lag, atau WI tidak jelas. Jangan "blame people" → lihat system dulu.

3. **Adoption = indikator TRUST** — high adoption → data valid. Low adoption → seluruh system gagal karena data tidak bisa dipakai.

4. **OEE rendah + OLE tinggi** = mesin problem. **OEE tinggi + OLE rendah** = operator tidak efektif. Jangan lihat satu KPI isolasi → selalu cross-reference.

5. **Micro vs Major** distinction penting — jangan setiap 1-2 detik downtime langsung dianggap problem. Gunakan threshold durasi minimum.

6. **Accuracy, Adoption, OEE, OLE** semuanya bisa digabung untuk diagnosis yang lebih akurat — misal: Adoption rendah + OLE rendah = input issue (bukan real inefficiency).

---

## 9. FILE STRUCTURE (SETELAH IMPLEMENTASI)

```
D:\website\MPS2\
├── database/
│   └── schema/
│       ├── ews_schema.sql          ← TABLES + INDEXES
│       ├── ews_functions.sql       ← CALCULATION FUNCTIONS
│       └── ews_seed.sql            ← SAMPLE DATA
├── apps/
│   └── api/
│       ├── routes/
│       │   └── ews.js              ← API ENDPOINTS
│       ├── services/
│       │   └── ewsCalculator.js    ← KPI CALCULATION LOGIC
│       └── middleware/
│           └── ewsAuth.js          ← AUTH (kalau perlu)
│   └── web/
│       └── src/
│           ├── pages/
│           │   └── EWS/
│           │       ├── ControlTower.jsx
│           │       ├── AlertMonitor.jsx
│           │       ├── DetailView.jsx
│           │       ├── ActionBoard.jsx
│           │       └── EscalationView.jsx
│           ├── components/
│           │   └── ews/
│           │       ├── KpiCard.jsx
│           │       ├── TrafficLight.jsx
│           │       ├── AlertTable.jsx
│           │       └── ActionForm.jsx
│           └── hooks/
│               └── useEWS.js       ← API HOOKS
├── jobs/
│   └── machine_ping/
│       ├── ping_monitor.js         ← UPTIME CRON
│       └── Dockerfile
└── docs/
    └── timesheet/
        └── EARLY_WARNING_SYSTEM_PLAN.md  ← THIS FILE
```

---

**Status**: 📋 PLANNING  
**Last Updated**: 2026-06-27  
**Next Action**: Phase 1 — Database Schema
