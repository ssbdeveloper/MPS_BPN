# MPS Dashboard — AI Agent Task Specification
> **Section 10 | PT SSB Manufacturing Performance System**
> Dokumen ini adalah spesifikasi lengkap untuk membangun MPS Dashboard berbasis OEE, OLE, OTE, OTIF, Overtime, Schedule Performance, dan Order/Job Performance.

---

## 1. KONTEKS SISTEM

### 1.1 Stack Teknologi Target
- **Frontend / Visualization**: Power BI (utama), atau React + Recharts/Grafana
- **Backend / Data Pipeline**: PostgreSQL (sudah ada), Node.js/Express API
- **Data Sources**:
  - `SCADA/HMI` → machine state, output, cycle time (machine-based activity)
  - `Timesheet Digital` → labor activity VA/NNVA/NVA (labor-based activity)
  - `MPS/MES` → production orders, scheduling, bottleneck load
  - `SAP` → planned orders, routing, standard cycle time, BOM
- **Deployment**: Docker, existing infrastructure SSB

### 1.2 Prinsip Arsitektur (WAJIB DIPATUHI)
1. **Satu rule engine, dua perspektif**: Data Lean Activity → OEE view DAN Lean view dari sumber yang sama
2. **Activity-based, bukan KPI-based**: Rule engine bekerja di level event/aktivitas, bukan ringkasan harian
3. **Time is primary currency**: Semua kalkulasi dalam satuan waktu (minutes/hours)
4. **One activity → one OEE factor**: Tidak boleh double counting
5. **Lean classification tidak diubah**: VA/NNVA/NVA hanya ditambahkan layer OEE interpretation
6. **Rumus konsisten lintas role**: Operator, Manager, BOD melihat OEE dari logika yang sama

---

## 2. DATA MODEL

### 2.1 FACT_MachineActivity (Core Table)
```
Grain: satu record per aktivitas mesin per time bucket

Kolom wajib:
- activity_id         UUID, PK
- machine_id          FK → DIM_Machine
- shift_id            FK → DIM_Shift
- activity_code       VARCHAR → FK ke DIM_ActivityRule
- activity_start      TIMESTAMPTZ
- activity_end        TIMESTAMPTZ
- duration_min        NUMERIC (menit)
- machine_state       ENUM: 'RUN' | 'STOP' | 'IDLE' | 'SETUP' | 'BREAKDOWN' | 'WAIT'
- total_output        NUMERIC
- good_output         NUMERIC
- ideal_cycle_time    NUMERIC (menit per unit, dari master data)
- lean_category       ENUM: 'VA' | 'NNVA' | 'NVA'
- oee_loss_category   ENUM: 'Availability' | 'Performance' | 'Quality' | 'Productive'
- order_id            FK → FACT_ProductionOrder (nullable)
- operator_id         FK → DIM_Employee (nullable)
```

### 2.2 FACT_LaborActivity (OLE Source)
```
Grain: satu record per aktivitas per orang per time bucket

Kolom wajib:
- labor_activity_id   UUID, PK
- employee_id         FK → DIM_Employee
- shift_id            FK → DIM_Shift
- area_id             FK → DIM_Area
- activity_code       VARCHAR → FK ke DIM_ActivityRule
- activity_start      TIMESTAMPTZ
- activity_end        TIMESTAMPTZ
- duration_min        NUMERIC
- labor_state         ENUM: 'WORK' | 'IDLE' | 'ABSENT' | 'TRAINING' | 'WAIT'
- total_output        NUMERIC
- good_output         NUMERIC
- lean_category       ENUM: 'VA' | 'NNVA' | 'NVA'
- order_id            FK → FACT_ProductionOrder (nullable)
```

### 2.3 FACT_ProductionOrder
```
- order_id            UUID, PK
- order_number        VARCHAR
- product_code        FK → DIM_Product
- planned_start       TIMESTAMPTZ
- planned_finish      TIMESTAMPTZ
- actual_start        TIMESTAMPTZ
- actual_finish       TIMESTAMPTZ (nullable jika belum selesai)
- planned_qty         NUMERIC
- good_qty            NUMERIC
- status              ENUM: 'Open' | 'In Progress' | 'Completed' | 'Cancelled'
- bottleneck_process  VARCHAR (process code yang jadi constraint)
- plant_id            FK → DIM_Plant
- due_date            DATE (customer promise date)
- customer_id         FK → DIM_Customer (nullable)
- planned_cost        NUMERIC
- actual_cost         NUMERIC
- planned_labor_hours NUMERIC
- actual_labor_hours  NUMERIC
```

### 2.4 DIM_ActivityRule (Rule Engine Master)
```
- activity_code       VARCHAR, PK
- activity_description VARCHAR
- lean_category       ENUM: 'VA' | 'NNVA' | 'NVA'
- oee_loss_category   ENUM: 'Availability' | 'Performance' | 'Quality' | 'Productive'
- oee_factor          ENUM: 'A' | 'P' | 'Q' | 'None'
- machine_state_expected ENUM: 'RUN' | 'STOP' | 'IDLE' | 'ANY'
- is_planned_shutdown BOOLEAN  -- jika TRUE, TIDAK masuk Planned Production Time
- notes               TEXT
```

**Contoh data DIM_ActivityRule:**
| activity_code | lean_category | oee_loss_category | oee_factor | machine_state_expected |
|---|---|---|---|---|
| MACHINING_NORMAL | VA | Productive | None | RUN |
| MACHINING_SLOW | VA | Performance | P | RUN |
| SETUP_CHANGEOVER | NNVA | Availability | A | STOP |
| PREVENTIVE_MAINT | NNVA | Availability | A | STOP |
| BREAKDOWN | NVA | Availability | A | STOP |
| WAITING_MATERIAL | NVA | Availability | A | STOP |
| WAITING_OPERATOR | NVA | Availability | A | STOP |
| REWORK_MACHINING | NNVA | Performance | P | RUN |
| SCRAP | NVA | Quality | Q | RUN |
| MINOR_ADJUSTMENT | NNVA | Performance | P | RUN |
| LOADING_UNLOADING | NNVA | Performance | P | RUN |
| SELF_INSPECTION | NNVA | Performance | P | RUN |
| COFFEE_BREAK | NVA | Availability | A | STOP |
| DAILY_PM | NVA | Performance | P | RUN |
| TOOL_PREPARATION | NVA | Performance | P | STOP |
| JIG_FIXTURE | NVA | Availability | A | STOP |
| WAITING_ENGINEERING | NVA | Performance | P | STOP |
| WAITING_INSPECTION | NVA | Performance | P | STOP |
| WAITING_NCR | NVA | Performance | P | STOP |
| ELECTRICITY_BLACKOUT | NVA | Availability | A | STOP |

### 2.5 Dimension Tables
```
DIM_Machine:     machine_id, machine_name, workcenter, plant_id, ideal_cycle_time_default
DIM_Employee:    employee_id, name, skill_group, shift_group, plant_id
DIM_Shift:       shift_id, shift_name, shift_date, shift_start, shift_end, planned_hours
DIM_Time:        date, week, month, quarter, year
DIM_Area:        area_id, area_name, is_bottleneck_flag, plant_id
DIM_Product:     product_code, product_name, family, standard_cycle_time_per_process
DIM_Plant:       plant_id, plant_name, location (Balikpapan|Sebamban|Kuala Kencana|Cikupa)
DIM_Customer:    customer_id, customer_name, priority_flag
```

---

## 3. RULE ENGINE LOGIC

### 3.1 Layer 1 — Planned Production Time
```
Planned_Production_Time =
  SUM(duration_min) dari FACT_MachineActivity
  WHERE is_planned_shutdown = FALSE
  -- Include: VA, NNVA, NVA reguler
  -- Exclude: planned corporate shutdown
```

### 3.2 Layer 2 — Availability Logic
```
-- Operating Time
Operating_Time =
  SUM(duration_min) WHERE machine_state = 'RUN'

-- Availability Loss Time
Availability_Loss_Time =
  SUM(duration_min) WHERE machine_state IN ('STOP','BREAKDOWN','SETUP','WAIT')
  AND oee_loss_category = 'Availability'

-- Availability %
Availability = Operating_Time / Planned_Production_Time

RULE A1: machine_state = 'RUN' → masuk Operating Time
RULE A2: machine_state IN ('STOP','BREAKDOWN','SETUP','WAIT') → Availability Loss
RULE: Semua SETUP = Availability Loss (WALAUPUN NNVA)
```

### 3.3 Layer 3 — Performance Logic
```
-- Performance hanya dihitung saat mesin RUN

-- Total Output (saat RUN)
Total_Output_Run = SUM(total_output) WHERE machine_state = 'RUN'

-- Ideal Output (dari master data)
Ideal_Output = Operating_Time / ideal_cycle_time

-- Performance %
Performance = MIN(Total_Output_Run / Ideal_Output, 1.0)

-- Performance Loss Time (untuk waterfall chart)
Performance_Loss_Time = Operating_Time - (Operating_Time * Performance)

RULE P1: Hanya machine_state = 'RUN' masuk Performance Evaluation Window
RULE P2: Actual_Output_Rate = total_output / run_time
RULE P3: IF machine_running AND performance_ratio < 100% → shortfall = Performance Loss
```

### 3.4 Layer 4 — Quality Logic
```
-- Quality Rate
Quality_Rate = good_output / total_output (saat RUN)

-- Quality Loss Time
Quality_Loss_Time = Operating_Time * (1 - Quality_Rate)

-- Untuk servis rekondisi (MTO, qty=1/order) → gunakan Time-based Quality:
Quality_MTO = 1 - (Rework_Time / Operating_Time)

RULE Q1: Total_Produced = SUM(output) WHERE machine_state = 'RUN'
RULE Q2: Quality_Rate = good_output / total_output
RULE Q3: Quality_Loss_Time = Operating_Time × (1 - Quality_Rate)
RULE: Scrap total (tidak bisa direpair) → Quality Loss
RULE: Reject final inspection → Quality Loss
RULE: Rework berhasil → BUKAN Quality Loss (masuk Availability atau Performance Loss)
RULE: Small stop KARENA rework → Availability Loss atau Performance Loss (BUKAN Quality Loss)
```

### 3.5 Layer 5 — OEE Final
```
OEE = Availability × Performance × Quality
```

### 3.6 Anti-Pattern (HARUS DIHINDARI)
```
❌ VA otomatis dianggap "good OEE"
❌ Setup dianggap planned time (menipu availability)
❌ Performance selalu 100%
❌ Scrap mengurangi Availability
❌ Satu aktivitas dihitung di dua faktor OEE
❌ Rework langsung → Quality Loss (cek machine_state dulu)
```

---

## 4. OEE DASHBOARD

### 4.1 Operator Dashboard (Shopfloor / Shift Level)

**Target user**: Operator, Shift Supervisor  
**Refresh rate**: Near real-time (≤ 5 menit)  
**Filter default**: Hari ini, Shift berjalan  

**Section 1 — OEE Status (Atas)**
- KPI Card BESAR: OEE %, dengan color coding 🔴🟡🟢
- KPI Card: Availability %, Performance %, Quality %
- KPI Card: Output Aktual vs Target
- Maksimal 5 KPI total

**Section 2 — Top Loss Saat Ini (Tengah)**
- Simple Bar Chart (horizontal), satuan menit
- Kategori: Setup | Breakdown | Waiting | Slow Run
- Max 5 bar
- Tujuan: operator langsung tahu masalah terbesar

**Section 3 — Lean Activity Time Bar (Bawah)**
- Stacked Bar: VA | VA (slow) | NNVA | NVA
- Satuan: jam
- Ini "bahasa operator", bukan bahasa KPI

**Yang TIDAK ADA di Operator Dashboard:**
- Trend 30 hari
- Benchmark mesin lain
- Financial impact
- Slicer berlebihan

---

### 4.2 Manager Dashboard (Plant Level)

**Target user**: Plant Manager, Supervisor, CI Team  
**Refresh rate**: Harian / Per shift  
**Filter / Slicer**: Area | Machine | Shift | Product | Date Range  

**Section 1 — OEE Summary (Atas)**
- KPI Cards: OEE, Availability, Performance, Quality (day/week)
- Trend indicator (naik/turun dari periode sebelumnya)

**Section 2 — OEE & Factor Trend (Tengah Kiri)**
- Line Chart: OEE harian/mingguan
- Overlay line: Availability, Performance, Quality
- Tujuan: "Sejak kapan performance drop?"

**Section 3 — Loss Breakdown by Factor (Tengah Kanan)**
- Stacked Bar / Waterfall: Availability Loss | Performance Loss | Quality Loss
- Satuan: MENIT (bukan hanya %)
- Lengkap dengan % contribution

**Section 4 — Lean vs OEE View Matrix (Bawah Kiri)**
- Stacked Column: VA Productive | VA Performance Loss | NNVA | NVA
- Tujuan: "NNVA kita besar, bisa dikurangi?"

**Section 5 — Pareto Top Loss Activity (Bawah Kanan)**
- Top 5 activity_code penyebab loss terbesar
- Satuan: jam
- Drillthrough: Loss → ActivityCode → Shift → Machine

**Drill-through path:** Loss → Activity → Machine → Shift → Operator Team

---

### 4.3 BOD / Executive Dashboard (Strategic View)

**Target user**: BOD, GM, Director  
**Refresh rate**: Mingguan / Bulanan  
**Filter**: Plant | Quarter | Year  

**Section 1 — OEE Scorecard**
- OEE by Plant / Line (ranking)
- Color coding sederhana
- Trend 3–12 bulan

**Section 2 — Trend Jangka Menengah**
- Line Chart: OEE rolling 12 bulan
- Target vs Actual
- Tidak menampilkan fluktuasi harian

**Section 3 — Lost Capacity View**
- Total planned capacity (jam)
- Lost capacity (jam) → breakdown: Availability | Performance | Quality
- Recovered capacity (dari Kaizen)
- Bahasa: "jam hilang", bukan "% OEE"

**Section 4 — Improvement Tracking**
- Before–After: OEE baseline vs OEE after improvement project
- Delta OEE impact

**Yang TIDAK ADA di BOD Dashboard:**
- Activity code detail
- VA/NNVA/NVA detail
- Shift comparison
- Alarm atau real-time data

---

## 5. OLE DASHBOARD

### 5.1 Formula OLE
```
OLE = Labor_Availability × Labor_Performance × Labor_Quality

Labor_Availability = Actual_Working_Time / Paid_Working_Time
Labor_Performance  = Standard_Output / Actual_Output  (atau standard_time × output / actual_working_time)
Labor_Quality      = Good_Output / Total_Output
```

### 5.2 OLE Data Model Tambahan
```
FACT_LaborActivity (grain: activity × person × time):
- labor_state: ENUM 'WORK' | 'IDLE' | 'ABSENT' | 'TRAINING' | 'WAIT'
- standard_time_per_unit: NUMERIC (dari master data routing)
- output_qty: NUMERIC
- good_output_qty: NUMERIC

DIM_Employee: skill_group (BUKAN untuk KPI individu — hanya system metric)
```

### 5.3 OLE Calculation DAX / SQL Logic
```
-- Paid Working Time
Paid_Time = SUM(shift_hours) × COUNT(DISTINCT employee_id)

-- Actual Working Time (labor_state = 'WORK')
Actual_Working_Time = SUM(duration_min) WHERE labor_state = 'WORK'

-- Labor Availability
Labor_Availability = Actual_Working_Time / Paid_Time

-- Standard Output (ideal)
Standard_Output = SUM(output_qty × standard_time_per_unit)

-- Labor Performance
Labor_Performance = Standard_Output / Actual_Working_Time

-- Good Output
Good_Output = SUM(good_output_qty)

-- Labor Quality
Labor_Quality = Good_Output / SUM(output_qty)

-- OLE
OLE = Labor_Availability × Labor_Performance × Labor_Quality

-- Loss Times (untuk visual)
Availability_Loss_Time = Paid_Time - Actual_Working_Time
Performance_Loss_Time  = Actual_Working_Time × (1 - Labor_Performance)
Quality_Loss_Time      = Actual_Working_Time × (1 - Labor_Quality)
```

### 5.4 OLE Dashboard — Layer A (Calculation)

**Section 1 — OLE KPI Summary**
- KPI Cards: OLE % | Availability % | Performance % | Quality % dengan traffic light

**Section 2 — OLE Trend**
- Line Chart: OLE Daily (last 30 days)
- Optional overlay: Availability, Performance, Quality

**Section 3 — Loss by OLE Factor**
- Waterfall / Stacked Bar (satuan: jam orang)
- Paid Hours → -Availability Loss → -Performance Loss → -Quality Loss → OLE Hours

### 5.5 OLE Dashboard — Layer B (Lean Diagnostic)

**Section 4 — Lean Time Distribution**
- Stacked Bar / Area Chart: VA | NNVA | NVA
- Satuan: jam orang dan % dari paid hours

**Section 5 — Lean Activity vs OLE Loss Matrix**
- Matrix / Stacked Column: NNVA & NVA breakdown per OLE factor
- Insight: "Availability loss dominan dari NNVA & NVA"

**Section 6 — Top Lean Activities Driving OLE Loss**
- Pareto Chart: top activity code penyebab OLE loss (jam orang)
- Contoh: Waiting material | Searching tools | Manual handling | Rework | Idle imbalance

**Catatan OLE:**
- OLE adalah **system metric**, BUKAN KPI personal/individu
- Lean Activity = WHY layer OLE, BUKAN faktor OLE
- ❌ Jangan hitung OLE per individu secara langsung
- ❌ Jangan jadikan OLE KPI personal

---

## 6. OTE DASHBOARD

### 6.1 Formula OTE
```
OTE = Actual_Good_Throughput / Planned_Throughput

Actual_Throughput  = SUM(good_qty) WHERE order_status = 'Completed'
Planned_Throughput = Available_Time_Bottleneck × Standard_Rate_Bottleneck
Standard_Rate      = 1 / Standard_Cycle_Time_Bottleneck
```

### 6.2 Bottleneck Identification Logic
```
-- Metode A: Highest Load Ratio
Load_Ratio = Required_Time / Available_Time (per process)
Bottleneck = process WHERE Load_Ratio = MAX(Load_Ratio)

-- Metode B: Longest Queue
WIP_Queue = COUNT(orders waiting) per process sebelum mulai

-- Metode C: OEE/OLE terendah di jalur kritis
Constraint = proses dengan OEE terendah yang membatasi output order

-- FLAG bottleneck di DIM_Area: is_bottleneck_flag = TRUE
-- Bottleneck bisa berubah per product family / periode → perlu review periodik
```

### 6.3 OTE Loss Breakdown
```
OTE hanya peduli loss di BOTTLENECK:

Availability_Loss_Bottleneck  = jam breakdown/setup/waiting di bottleneck
Performance_Loss_Bottleneck   = (1 - Performance_bottleneck) × Operating_Time_bottleneck
Quality_Loss_Bottleneck       = (1 - Quality_bottleneck) × Operating_Time_bottleneck

OTE_Loss = Total loss di bottleneck / Planned_Throughput
```

### 6.4 OTE Dashboard — Executive Grade

**Section 1 — OTE KPI**
- KPI Cards: OTE % | Throughput vs Plan | Bottleneck Utilization %

**Section 2 — Planned vs Actual Throughput**
- Bar Chart: planned vs actual per periode

**Section 3 — Bottleneck Loss Breakdown**
- Stacked Bar / Waterfall: hours lost at bottleneck (Availability | Performance | Quality)

**Section 4 — OTE Trend**
- Line Chart: weekly/monthly trend

**Section 5 (Manager level, optional) — Diagnostic**
- OEE & OLE khusus bottleneck process
- Lean activity khusus bottleneck

**Anti-Pattern OTE (FATAL):**
```
❌ Menghitung OTE dari rata-rata OEE semua mesin
❌ OTE dari total output semua proses
❌ Menganggap semua waste berdampak ke OTE
❌ Menggunakan OTIF sebagai pengganti OTE
❌ Menghilangkan setup dari available time bottleneck
```

---

## 7. OVERTIME DECISION DASHBOARD

### 7.1 Framework Keputusan OT (4 Gate Questions)
```
GATE 1: Apakah OTIF terancam? (Business Trigger)
  → IF OTIF aman → STOP, tidak perlu OT

GATE 2: Apakah OTE < target? (System Gap)
  → IF OTE ≥ target → STOP, overtime tidak relevan
  → IF OTE < target → lanjut ke Gate 3

GATE 3: Di mana bottleneck?
  → Tentukan lokasi OT (hanya di bottleneck)
  → IF bottleneck tidak jelas → STOP

GATE 4: Apakah bottleneck layak dilemburkan? (OEE & OLE Check)
  → Syarat OEE: Availability ≥ 85%, Performance ≥ 90%, Quality stabil
  → Syarat OLE: Labor Availability ≥ 85%, Performance stabil, fatigue dikelola
  → IF quality rendah → ❌ No OT (overtime = mempercepat scrap)
  → IF semua syarat terpenuhi → ✅ OT Possible
```

### 7.2 Overtime Dashboard — Page 1: Decision Gate

**Section 1 — Business Trigger (OTIF Risk)**
- KPI Card: OTIF at Risk % | Orders Near Due Date | Late Orders count/value

**Section 2 — System Capability (OTE)**
- KPI Card: OTE actual vs target
- Bar: Planned vs Actual Throughput

**Section 3 — Bottleneck Identification**
- Bar: Load vs Capacity per process (dari MPS)
- Bar: WIP/Queue sebelum tiap proses

**Section 4 — Bottleneck Readiness (OEE & OLE Gate)**
- KPI Cards: OEE bottleneck (A/P/Q) | OLE bottleneck
- Stacked Bar: Loss breakdown at bottleneck

**Section 5 — Decision Summary**
- Status Card: ✅ Approved | ✅ Proposed | ⚠️ Conditional | ❌ Not Approved
- Table: Where to OT — Process/Machine | Shift | Target Order

### 7.3 Overtime Dashboard — Page 2: Diagnostic (Jika OT Ditolak)

**Section A** — Why OTE Low? (OTE Loss Waterfall + OEE Bottleneck Trend)  
**Section B** — Lean PoV: Stacked Bar VA|NNVA|NVA at bottleneck  
**Section C** — Alternative Actions: Reschedule | Subcontract | Split order | Due date renegotiation

---

## 8. OTIF DASHBOARD

### 8.1 Formula OTIF
```
OTIF = Orders delivered On-Time AND In-Full / Total Orders Delivered

On-Time  = actual_finish <= due_date
In-Full  = good_qty >= planned_qty
OTIF     = COUNT(orders where on_time=TRUE AND in_full=TRUE) / COUNT(all completed orders)
```

### 8.2 OTIF Dashboard — Page 1: Status & Risk

**Section 1 — OTIF Scorecard (Outcome)**
- KPI Cards: OTIF % | On-Time % | In-Full % | Orders Delivered count/value

**Section 2 — OTIF Risk (Early Warning — Paling Penting)**
- KPI Card: Orders at Risk (count/value)
- Bar/Scatter: Due Date vs Remaining Lead Time
- Bar dengan warna 🔴🟡🟢: Days to Due Date per order
- Tujuan: deteksi order yang belum terlambat TAPI AKAN terlambat

**Section 3 — Order Promise vs Reality**
- Bar: Planned Completion vs Actual/Forecast Completion
- Bar: Lead Time Planned vs Actual

**Section 4 — OTIF Impact (Business)**
- Late Order Value | Penalty/Revenue at Risk | Customer Priority Flag

### 8.3 OTIF Dashboard — Page 2: Root Cause

**Section A** — OTE vs OTIF Trend (Line Chart, overlay)  
**Section B** — Bottleneck Impact: Load vs Capacity | WIP Queue | Orders waiting table  
**Section C** — Quality & Rework Impact: Orders with rework | Rework Time vs Planned | FPY  
**Section D** — Lean Perspective (optional): Lean Activity at bottleneck (VA|NNVA|NVA stacked bar)

---

## 9. SCHEDULE PERFORMANCE DASHBOARD

### 9.1 KPI Utama
```
Schedule_Adherence    = Tasks completed on-time / Total tasks scheduled
Tasks_On_Time %       = tasks dengan actual_finish ≤ planned_finish
Critical_Tasks_Late   = COUNT(tasks on critical path WHERE status = 'Late')
Milestone_Slippage    = AVG(actual_finish - planned_finish) untuk milestone tasks
```

### 9.2 Visuals

**Section 1 — Schedule Health KPI**
- KPI Cards: Schedule Adherence % | Tasks On-Time % | Critical Tasks Late count | Avg Slippage (days)

**Section 2 — Schedule Adherence Trend**
- Line Chart: daily/weekly adherence %
- Tujuan: "Apakah disiplin eksekusi memburuk atau membaik?"

**Section 3 — Planned vs Actual Start/Finish**
- Bar Chart per: Process | Order | Work Center
- Highlight deviasi sistemik (area yang selalu molor)

**Section 4 — Gantt Delta View (Simplified)**
- Baseline vs Actual, highlight slip
- Bukan full MS Project — hanya deviasi

**Section 5 — Orders / Tasks at Risk Table**
- Kolom: Order | Planned Finish | Actual Progress % | Slack (days) | Risk Flag
- Sangat powerful untuk daily production meeting

### 9.3 Data Source
```
MS Project → baseline dan schedule (via existing msp_tasks table)
MPS/MES    → actual start/finish dari production order execution
Dashboard  → schedule variance = actual vs baseline
```

---

## 10. ORDER / JOB PERFORMANCE DASHBOARD

### 10.1 KPI Utama (Per Order / Job)
```
Cost_Variance         = Actual_Cost - Planned_Cost
Labor_Hour_Variance   = Actual_Labor_Hours - Planned_Labor_Hours
Machine_Hour_Variance = Actual_Machine_Hours - Planned_Machine_Hours
Rework_Cost           = SUM(labor_cost + machine_cost selama aktivitas rework)
Estimated_Cost_at_Completion = Actual_Cost + (Remaining_Work / Performance_Factor × Cost_Rate)
```

### 10.2 Visuals

**Section 1 — Order Health Summary**
- KPI Cards: Cost Variance | Labor Hour Variance | Rework Cost total | Orders at Financial Risk count

**Section 2 — Planned vs Actual Cost**
- Bar Chart per: Order | Process | Cost Category (labor/machine/material/overhead)

**Section 3 — Cost Breakdown Waterfall**
```
Waterfall:
Planned Cost
  + Extra Labor Hours
  + Extra Machine Hours
  + Rework Cost
  = Forecast Final Cost
```

**Section 4 — Orders at Financial Risk Table**
- Flag trigger: cost > X% over plan | effort > estimate | margin < threshold
- Kolom: Order | Planned Cost | Actual Cost | Variance % | Margin % | Status Flag

### 10.3 Link ke Lean & OLE
```
Cost variance sering berasal dari:
- NNVA tinggi → tambah labor hours
- Rework → tambah machine + labor hours
- Low labor performance → efficiency rendah

Drill-through: Cost Variance → OLE trend → Lean activity pareto
```

---

## 11. SIX BIG LOSSES MAPPING

### 11.1 Mapping Table (Reference for DIM_ActivityRule)
| OEE Factor | Six Big Losses | Machine State | Lean Category | Contoh Activity Code |
|---|---|---|---|---|
| Availability | Breakdown Loss | STOP (unplanned) | NVA | BREAKDOWN, WAITING_MAINT, ELECTRICITY_BLACKOUT |
| Availability | Setup & Adjustment | STOP (planned) | NNVA | SETUP_CHANGEOVER, TOOL_SETTING, TRIAL_RUN |
| Performance | Idling & Minor Stop | RUN/IDLE | NNVA | MINOR_ADJUSTMENT, QUICK_CLEANING, WAITING_MATERIAL_MINOR |
| Performance | Reduced Speed | RUN | VA | MACHINING_SLOW, NON_STANDARD_METHOD |
| Quality | Process Defect | RUN | NNVA/NVA | REWORK, SCRAP, INSPECTION_ULANG |
| Quality | Startup/Yield Loss | RUN (start) | NNVA | TRIAL_RUN_START, SETTING_ULANG, STARTUP_SCRAP |

### 11.2 SSB-Specific NVA Activities
| Activity | OEE Mapping |
|---|---|
| Coffee Break / Lunch | Availability Loss (mesin tidak bisa run tanpa operator) |
| Daily PM | Performance Loss |
| Tool Preparation | Performance Loss |
| Labor Necessity | Performance Loss |
| Jig & Fixture | Availability Loss |
| Waiting for Engineering | Performance Loss |
| Waiting for Inspection | Performance Loss |
| Waiting for NCR | Performance Loss |
| Waiting for Handling | Performance Loss |
| Waiting for Material | Performance Loss / Availability Loss (tergantung durasi) |

---

## 12. CHART SELECTION GUIDE

| Pertanyaan yang dijawab | Jenis Chart |
|---|---|
| Berapa OEE / OLE / OTE sekarang? | KPI Card (traffic light) |
| Mana faktor terburuk? | Bar Chart |
| Bagaimana komposisi loss? | Stacked Bar Chart |
| Apakah membaik dari waktu ke waktu? | Line Chart (Trend) |
| Loss terbesar apa? | Pareto Chart |
| Kenapa angka hasil akhir segini? | Waterfall Chart |
| Di mana masalah sistemik (pola)? | Heatmap / Matrix |
| Status vs target (non-teknis)? | Gauge (pakai hemat, KPI Card lebih baik) |

### Layout Standar Per Dashboard Page
```
[ATAS]   → Status: KPI Cards (OEE, A, P, Q atau OLE atau OTE)
[TENGAH] → WHY: Stacked Bar Loss + Pareto Top Loss
[BAWAH]  → ACTION: Trend Line + Lean Time Distribution
```

---

## 13. PAGE STRUCTURE (POWER BI)

```
Page 1  — OEE Operator (Shopfloor)
Page 2  — OEE Manager (Plant)
Page 3  — OEE Executive (BOD)
Page 4  — OLE Calculation (Layer A)
Page 5  — OLE Lean Diagnostic (Layer B)
Page 6  — OTE System Throughput
Page 7  — OTIF Status & Risk
Page 8  — OTIF Root Cause
Page 9  — Overtime Decision Gate
Page 10 — Overtime Diagnostic
Page 11 — Schedule Performance
Page 12 — Order / Job Performance
```

**Navigation rule**: BOD → Manager → Operator (drill-down satu arah)

---

## 14. KPI HIERARCHY

```
OEE / OLE
    ↓ (resource efficiency)
OTE (system throughput capability)
    ↓
Lead Time Stability (actual vs planned lead time)
    ↓
OTIF (customer delivery outcome)

Overtime → tactical action, BUKAN KPI
Schedule Performance → internal discipline KPI
Order Performance → financial health KPI per order
```

**Kalimat kunci:**
- *"OTIF is a promise kept. OTE is the ability to keep promises."*
- *"Only losses at the bottleneck reduce OTE."*
- *"OEE and OLE matter only where they constrain throughput."*
- *"Six Big Losses tells us WHAT we lose. Lean activity tells us WHY we lose it."*

---

## 15. VALIDASI WAJIB SEBELUM GO-LIVE

### OEE Validation
```
✅ Planned Production Time = Σ semua activity time (kecuali planned shutdown corporate)
✅ Operating Time ≤ Planned Production Time
✅ Availability ≤ 1.0
✅ Performance TIDAK selalu 100%
✅ Satu activity hanya masuk SATU OEE factor
✅ Setup SELALU = Availability Loss
✅ Scrap/Rework dengan mesin RUN → Performance atau Quality (BUKAN Availability)
```

### OLE Validation
```
✅ Paid Time = Σ employee × shift hours
✅ Actual Working Time ≤ Paid Time
✅ OLE ≤ Availability
✅ Standard time terdokumentasi dan dikontrol governance-nya
✅ Lean category TIDAK mengubah nilai OLE
✅ OLE dihitung per area/group, BUKAN per individu
```

### OTE Validation
```
✅ Actual Throughput = good completed orders only (bukan WIP)
✅ Planned Throughput = dari kapasitas bottleneck (bukan rata-rata semua)
✅ OTE BUKAN rata-rata OEE
✅ Bottleneck teridentifikasi per product family
✅ Setup TIDAK dihilangkan dari available time bottleneck
```

### OTIF Validation
```
✅ On-Time = actual_finish ≤ due_date (bukan planned_finish)
✅ In-Full = good_qty ≥ planned_qty (bukan total output)
✅ OTIF % = per order, bukan per unit
✅ Risk orders = belum terlambat tapi projected akan terlambat
```

---

## 16. IMPLEMENTATION NOTES

### Priority Build Order (Rekomendasi)
```
Phase 1 (Foundational):
  1. DIM_ActivityRule → isi semua activity codes dengan mapping Lean & OEE
  2. FACT_MachineActivity → pastikan machine_state dan ideal_cycle_time terisi
  3. OEE Rule Engine (Layer 1–5)
  4. OEE Manager Dashboard (Page 2)

Phase 2 (Operational):
  5. OEE Operator Dashboard (Page 1)
  6. FACT_LaborActivity + OLE Calculation
  7. OLE Dashboard (Page 4–5)

Phase 3 (Strategic):
  8. FACT_ProductionOrder → OTE & OTIF
  9. OTE Dashboard (Page 6)
  10. OTIF Dashboard (Page 7–8)
  11. Overtime Decision Dashboard (Page 9–10)

Phase 4 (Advanced):
  12. Schedule Performance Dashboard (Page 11) → link ke msp_tasks
  13. Order/Job Performance Dashboard (Page 12)
  14. OEE Executive/BOD Dashboard (Page 3)
```

### Multi-Plant Considerations
```
Plants: Balikpapan | Sebamban | Kuala Kencana | Cikupa
- Semua plant menggunakan DIM_ActivityRule YANG SAMA (rule engine konsisten)
- Filter by plant_id di semua dashboard
- BOD dashboard = cross-plant comparison / ranking
- Standard cycle time bisa berbeda per plant untuk mesin yang berbeda
```

### MTO / Servis Rekondisi Specific Rules
```
- Quality factor: gunakan Time-based Quality = 1 - (Rework_Time / Operating_Time)
  (BUKAN good_qty/total_qty karena qty = 1/order)
- Quality Loss = hanya jika scrap total atau reject final inspection
- Rework berhasil → Availability Loss (jika STOP) atau Performance Loss (jika RUN)
- Bottleneck bisa berubah per order type
```

---

*End of Task Specification*
*Version: 1.0 | Source: Section 10 MPS Dashboard Documentation*
*Context: PT SSB — Mining Equipment Component Repair Services*
