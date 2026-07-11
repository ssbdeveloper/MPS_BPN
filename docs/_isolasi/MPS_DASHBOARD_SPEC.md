# MPS Dashboard — Implementation Specification

> **Target audience:** AI coding agents (Claude Code, Cursor, Copilot) implementing the MPS2 dashboard suite.
> **Source:** Section 10 — MPS Dashboard (PT SSB internal design document).
> **Context:** PT SSB performs repair/recondition services (MTO — Make-To-Order) for mining equipment components across multiple plants. Output qty per order is typically 1, processes are long, and the main risk is rework/scrap rather than volume.

---

## 1. Goal

Build a **5-page integrated KPI dashboard ecosystem** on top of the MPS2 data layer (Postgres + SAP + SCADA/HMI + digital timesheets) that answers, in order:

| Page | KPI | Question answered | Audience |
|------|-----|-------------------|----------|
| 1 | **OEE Dashboard** | Apakah resource (mesin) efisien? | Operator → Manager → BOD |
| 2 | **OLE Dashboard** | Apakah resource (orang) efektif? | Operator → Manager → BOD |
| 3 | **OTE Dashboard** | Apakah sistem mampu memenuhi rencana? | Manager → BOD |
| 4 | **OTIF Dashboard** | Apakah janji ke customer terpenuhi? | Sales / BOD / Planner |
| 5 | **Overtime Dashboard** | Apakah lembur layak dilakukan? | Plant Manager / Production Control |
| (6) | **Schedule Performance** | Apakah eksekusi disiplin? | Planner / PIC |
| (7) | **Job/Order Performance** | Apakah bisnis masih untung per order? | Cost Control / Manager |

All dashboards must share **one data model, one rule engine, one version of the truth**. An operator and a BOD must never see different OEE numbers for the same shift.

---

## 2. Non-Negotiable Principles

These are hard constraints. The agent must NOT violate them when writing code, designing schema, or building DAX/SQL.

1. **OEE follows ISO 22400-2:2014.** `OEE = Availability × Performance × Quality`. No deviation.
2. **Rule engine works at activity/event level**, not at "daily summary" level. Aggregation happens AFTER classification.
3. **One activity → exactly one OEE factor.** No double-counting. Prevent this at the rule-mapping table layer.
4. **Lean classification (VA / NNVA / NVA) is NEVER a column in the OEE formula.** Lean is the *WHY layer* (diagnostic), not the *WHAT layer* (calculation).
5. **Time is the primary currency.** Everything is in minutes (or hours). Output is only used to derive Performance and Quality back into time.
6. **Quality Loss = bad output, NOT lost time fixing things.** Rework that stops the machine → Availability Loss. Rework while machine runs → Performance Loss. Only final-rejected output → Quality Loss.
7. **OTE is system-level, not station-level.** `OTE ≠ avg(OEE)`. OTE is driven by **bottleneck only**.
8. **OTIF is a lagging outcome.** Do not "improve OTIF directly" — improve OTE, OTIF follows.
9. **Overtime is a decision, not a KPI.** It must be gated by OTIF risk → OTE gap → bottleneck identified → OEE/OLE health at bottleneck.
10. **Quality for MTO/recondition uses Time-Based Quality**, not unit-based. `Quality = 1 - (Rework_Time / Operating_Time)`. Unit-based gives only 0% or 100% and is meaningless.

---

## 3. Core Concepts (Reference)

### 3.1 OEE (ISO 22400-2)

```
OEE = Availability × Performance × Quality

Availability = Operating Time / Planned Production Time
Performance  = (Ideal Cycle Time × Total Output) / Operating Time
Quality      = Good Output / Total Output
```

**Machine state vocabulary (standardized):** `RUN`, `IDLE`, `STOP`, `BREAKDOWN`, `SETUP`, `WAIT`.

### 3.2 Lean Activity Classification

| Class | Meaning | Default OEE mapping |
|-------|---------|---------------------|
| **VA** (Value Added) | Aktivitas langsung menambah nilai | Productive Time IF (running normal speed AND good output). Else → Performance Loss or Quality Loss. |
| **NNVA** (Necessary Non-Value Added) | Tidak menambah nilai tapi diperlukan (setup, PM, inspection) | Availability Loss (when STOP) or Performance Loss (when RUN) |
| **NVA** (Non-Value Added) | Pure waste (breakdown, waiting, idle no-job) | Availability Loss (almost always) |

**SSB-specific NVA mapping (use these as defaults):**

| Activity | Default OEE Loss |
|----------|------------------|
| Coffee Break / Lunch | Availability Loss |
| Daily PM | Performance Loss |
| Tool Preparation | Performance Loss |
| Labor Necessity | Performance Loss |
| Jig & Fixture | Availability Loss |
| Waiting for Engineering / Inspection / NCR / Handling / Material | Performance Loss (RUN) or Availability Loss (STOP) |
| Breakdown | Availability Loss |
| Rework (machine RUN) | Performance Loss |
| Rework (machine STOP) | Availability Loss |
| Scrap (final reject) | Quality Loss |

### 3.3 OLE (Overall Labor Effectiveness)

Same shape as OEE, but object is the human worker.

```
OLE = Labor_Availability × Labor_Performance × Labor_Quality

Labor_Availability = Actual_Working_Time / Paid_Working_Time
Labor_Performance  = Standard_Time_for_Output / Actual_Working_Time
Labor_Quality      = Good_Output / Total_Output
```

**Critical:** OLE is a **system metric**, never a personal KPI. Never display OLE per individual person.

### 3.4 OTE (Overall Throughput Effectiveness)

```
OTE = Actual_Good_Throughput / Planned_Throughput_at_Bottleneck
```

Where:
- `Actual_Good_Throughput` = SUM(Good_Quantity) WHERE Order_Status = 'Completed'
- `Planned_Throughput` = `Available_Time_at_Bottleneck × Standard_Rate_at_Bottleneck`
- `Available_Time_at_Bottleneck = Planned_Shift_Time - Planned_Shutdown` (planned setup is INCLUDED, do not subtract it)

**Bottleneck identification** (data-driven, choose one or combine):
- A: Highest Load Ratio → `Required_Time / Available_Time`
- B: Longest Queue / WIP accumulation upstream
- C: Lowest OEE/OLE on the critical path

Bottleneck **may shift** per product family or period — OTE must be computed **per value stream**, not globally.

### 3.5 OTIF (On-Time In-Full)

```
OTIF = Orders_Delivered_OnTime_AND_InFull / Total_Orders_Delivered
```

Lagging. Causal chain: `OEE/OLE → OTE → Lead Time stability → OTIF`.

---

## 4. Required Data Model

The agent must implement the following star schema. Names are recommendations — adapt to existing MPS2 conventions if they exist (check `schema.sql`).

### 4.1 Fact Tables

#### `fact_machine_activity` (grain: 1 row per activity event per machine)

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial PK | |
| `plant_code` | varchar(10) | e.g. '5051' (Balikpapan) |
| `machine_id` | varchar | FK → dim_machine |
| `work_center_id` | varchar | FK → dim_work_center |
| `order_no` | varchar | FK → dim_order (nullable for non-order activity) |
| `operation_no` | varchar | FK to operation within order |
| `activity_code` | varchar | FK → dim_activity_rule |
| `start_ts` | timestamptz | NOT NULL |
| `end_ts` | timestamptz | NOT NULL |
| `duration_min` | numeric(10,2) | Generated: `EXTRACT(EPOCH FROM end_ts - start_ts)/60` |
| `machine_state` | varchar(20) | one of: RUN, IDLE, STOP, BREAKDOWN, SETUP, WAIT |
| `total_output` | numeric | only when state=RUN |
| `good_output` | numeric | only when state=RUN |
| `ideal_cycle_time_sec` | numeric | from routing master |
| `shift_id` | varchar | |
| `created_at` | timestamptz default now() | |

**Indexes required:**
- `(plant_code, start_ts)` — primary slicing
- `(machine_id, start_ts)`
- `(order_no, operation_no)`
- `(activity_code)`

#### `fact_labor_activity` (grain: 1 row per activity event per person)

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial PK | |
| `plant_code` | varchar(10) | |
| `employee_id` | varchar | **NEVER expose to OLE display** |
| `skill_group` | varchar | use this for aggregation |
| `work_center_id` | varchar | |
| `order_no` | varchar | nullable |
| `activity_code` | varchar | FK → dim_activity_rule |
| `start_ts` | timestamptz | |
| `end_ts` | timestamptz | |
| `duration_min` | numeric(10,2) | |
| `labor_state` | varchar(20) | WORK, IDLE, BREAK, ABSENT, MEETING, TRAINING |
| `total_output` | numeric | nullable |
| `good_output` | numeric | nullable |
| `standard_time_min` | numeric | from SOW master |
| `is_paid` | boolean | |
| `shift_id` | varchar | |

#### `fact_order` (grain: 1 row per production order)

| Column | Type | Notes |
|--------|------|-------|
| `order_no` | varchar PK | |
| `plant_code` | varchar(10) | |
| `value_stream` | varchar | for OTE grouping |
| `product_family` | varchar | |
| `customer_id` | varchar | |
| `planned_start` | timestamptz | |
| `planned_finish` | timestamptz | |
| `actual_start` | timestamptz | |
| `actual_finish` | timestamptz | |
| `due_date` | date | for OTIF |
| `delivered_date` | date | for OTIF |
| `planned_qty` | numeric | usually 1 for MTO |
| `good_qty` | numeric | |
| `status` | varchar | DRAFT, IN_PROGRESS, COMPLETED, CANCELLED |
| `is_otif` | boolean | computed: `delivered_date <= due_date AND good_qty >= planned_qty` |
| `planned_cost` | numeric | for Order Performance dashboard |
| `actual_cost` | numeric | |
| `rework_time_min` | numeric | |

### 4.2 Dimension Tables

#### `dim_activity_rule` (THE rule engine table — single source of truth)

| Column | Type | Notes |
|--------|------|-------|
| `activity_code` | varchar PK | |
| `description` | varchar | |
| `lean_category` | varchar | VA, NNVA, NVA |
| `default_machine_state` | varchar | for validation |
| `oee_loss_category` | varchar | AVAILABILITY_LOSS, PERFORMANCE_LOSS, QUALITY_LOSS, PRODUCTIVE_TIME |
| `oee_factor_impact` | varchar | A, P, Q, NONE |
| `ole_loss_category` | varchar | LABOR_AVAILABILITY_LOSS, LABOR_PERFORMANCE_LOSS, LABOR_QUALITY_LOSS, PRODUCTIVE |
| `is_planned_shutdown` | boolean | exclude from Planned Production Time only if TRUE |
| `effective_from` | date | for governance / change tracking |
| `effective_to` | date | nullable |

This table is **edited only via migration / governance process**, never ad-hoc by users.

#### Other dimensions
- `dim_machine` (machine_id, machine_name, work_center_id, plant_code, is_bottleneck_candidate)
- `dim_work_center` (work_center_id, name, plant_code, value_stream)
- `dim_employee` (employee_id, skill_group, plant_code) — **never join to OLE display layer except via skill_group**
- `dim_time` (date, week, month, quarter, year, shift_id)
- `dim_order` (mirrors fact_order keys)

### 4.3 Computed Layer (views or materialized views)

Implement these **layered**, in order. Each layer must be testable independently.

```
Layer 1: vw_planned_production_time
   = SUM(duration_min) WHERE NOT is_planned_shutdown, GROUP BY plant, machine, shift, date

Layer 2: vw_operating_time
   = SUM(duration_min) WHERE machine_state = 'RUN', GROUP BY ...

Layer 3: vw_availability_loss
   = SUM(duration_min) WHERE machine_state IN ('STOP','BREAKDOWN','SETUP','WAIT')

Layer 4: vw_performance_metrics
   = (ideal_cycle_time_sec/60 × total_output) / operating_time   -- per slice
   performance_loss_time = operating_time × (1 - performance_ratio)

Layer 5: vw_quality_metrics
   For mass production: good_output / total_output
   For MTO/recondition: 1 - (rework_time / operating_time)
   quality_loss_time = operating_time × (1 - quality_rate)

Layer 6: vw_oee
   availability = operating_time / planned_production_time
   performance  = ... (from Layer 4)
   quality      = ... (from Layer 5)
   oee = availability × performance × quality
```

---

## 5. Rule Engine Implementation Spec

The rule engine is the **single bridge** between raw activity data and OEE/OLE numbers. Implement it as a deterministic pipeline:

```
Raw Activity (fact_machine_activity)
        ↓
JOIN dim_activity_rule  ← rule lookup
        ↓
Normalize to time buckets (Planned Time, Operating Time, A-Loss, P-Loss, Q-Loss)
        ↓
Aggregate per (plant, machine, shift, date) at minimum
        ↓
Compute A, P, Q, OEE
```

### 5.1 Rule Pseudocode (use this exactly)

```python
def classify_activity(row, rule):
    """Returns (time_bucket, factor) for one activity row."""
    if rule.is_planned_shutdown:
        return ('EXCLUDED', None)

    # Layer A: Availability
    if row.machine_state in ('STOP', 'BREAKDOWN', 'SETUP', 'WAIT'):
        return ('AVAILABILITY_LOSS', 'A')

    # Layer P: Performance (machine running)
    if row.machine_state == 'RUN':
        if row.total_output and row.ideal_cycle_time_sec:
            actual_rate = row.total_output / (row.duration_min * 60)
            ideal_rate = 1.0 / row.ideal_cycle_time_sec
            perf_ratio = min(actual_rate / ideal_rate, 1.0)
            productive_time = row.duration_min * perf_ratio
            perf_loss_time = row.duration_min - productive_time
            # Quality split happens after, on productive_time
            return ('OPERATING_TIME', None, productive_time, perf_loss_time)
        return ('OPERATING_TIME', None)

    # IDLE = small-stop (Performance Loss in this model)
    if row.machine_state == 'IDLE':
        return ('PERFORMANCE_LOSS', 'P')

    return ('UNCLASSIFIED', None)  # must be 0 in production
```

### 5.2 Validation rules (CI tests)

The agent must add these as automated tests:

- `SUM(time_bucket) per (machine, shift, date) == Planned_Production_Time` (no leakage, no double-counting)
- `Availability_Loss + Operating_Time == Planned_Production_Time`
- `Performance_Loss + Productive_Time == Operating_Time`
- `0 <= A, P, Q <= 1` (clamp at 1.0; values >1.0 indicate bad standard time data → flag)
- `UNCLASSIFIED count == 0`
- `OEE <= Availability` and `OEE <= Performance` and `OEE <= Quality`

---

## 6. Page-by-Page UI Spec

Each page must serve **a single role** with a **single primary question**. Don't build one mega-dashboard.

### 6.1 Page 1 — OEE Dashboard

**Operator view (shopfloor / shift):**
- 4 large KPI cards with traffic-light colors: OEE %, A %, P %, Q % (current shift)
- Output vs Target (KPI card)
- Top 3 Loss right now (simple bar chart, in minutes)
- Lean Activity Time bar (stacked: VA | VA-slow | NNVA | NVA)
- Activity log last 2-4 hours
- **Max 5 KPIs.** No 30-day trend, no benchmarking.

**Manager view (plant / day-week):**
- OEE & A/P/Q line chart (daily, 30-90 days)
- Loss breakdown stacked bar (Availability/Performance/Quality, in minutes)
- Lean vs OEE matrix (VA productive | VA perf-loss | NNVA | NVA)
- Pareto top-5 loss activity codes
- Slicers: Area, Machine, Shift, Product
- Drill-through: Loss → Activity → Machine → Shift

**BOD/Executive view:**
- OEE scorecard by plant/line (ranked, color-coded)
- 3-12 month rolling trend, target vs actual
- Lost capacity in HOURS (not %), waterfall: Total planned → Lost → Recovered
- Improvement before/after deltas
- **No activity codes, no VA/NNVA/NVA detail, no shift comparison.**

### 6.2 Page 2 — OLE Dashboard

Same 3-role split as OEE, computed from `fact_labor_activity`.

**Layer A (calculation, neutral):**
- KPI cards: OLE, Labor Availability, Labor Performance, Labor Quality
- Trend line (daily 30 days)
- Loss waterfall in **person-hours** (not %)

**Layer B (Lean diagnostic, manager-up only):**
- Lean Time Distribution (stacked: VA / NNVA / NVA)
- Lean × OLE-Loss matrix
- Pareto top Lean activities driving OLE loss
- VA Efficiency view (VA Effective | VA Performance Loss | VA Quality Loss)

**Hard rule:** never display OLE for an individual `employee_id`. Aggregate by `skill_group` minimum.

### 6.3 Page 3 — OTE Dashboard

Executive-grade; one page only.

- KPI: OTE %, Throughput vs Plan, Bottleneck Utilization
- Bar chart: Planned vs Actual Throughput
- Bottleneck loss breakdown (HOURS) — waterfall preferred
- Trend OTE (weekly/monthly)
- (Manager drill) OEE & OLE **at bottleneck only**, Lean activity at bottleneck

**Filters:** value_stream, product_family, time period.

### 6.4 Page 4 — OTIF Dashboard (2 sub-pages)

**Sub-page 1 — Status & Risk:**
- KPI cards: OTIF %, On-Time %, In-Full %, Orders Delivered (count + value)
- Orders At Risk (count + value) — orders not yet late but trending late
- Days-to-Due bar (red/yellow/green)
- Planned vs Actual completion
- Late Order Value, Penalty/Revenue at Risk, Customer Priority Flag

**Sub-page 2 — Root Cause:**
- OTE vs OTIF trend overlay
- Bottleneck Load vs Capacity (bar), Queue/WIP before bottleneck (bar)
- Orders waiting at bottleneck (table)
- Orders with rework, FPY KPI
- Lean activity at bottleneck (stacked VA/NNVA/NVA)

### 6.5 Page 5 — Overtime Readiness Decision

This is a **decision dashboard**, not a report. Render as a vertical gate flow:

```
Section 1 → OTIF at Risk?              [No → STOP. show "OT not justified"]
   ↓ Yes
Section 2 → OTE < Target?              [No → STOP. system already maxed]
   ↓ Yes
Section 3 → Bottleneck identified?     [No → STOP. unclear where to OT]
   ↓ Yes
Section 4 → Bottleneck OEE/OLE healthy?
            (A>=85%, P>=90%, Q stable)
   ↓ Yes if all green
Section 5 → Decision Card:
            ✅ Approved | ⚠️ Conditional | ❌ Not Approved
            "Where to OT": Process / Machine / Shift / Target Order
```

**Optional Page 2 (rejected/contested cases):** OTE Loss Waterfall, OEE Bottleneck Trend, Lean activity at bottleneck (if NNVA/NVA dominant → OT = waste).

### 6.6 Page 6 — Schedule Performance (optional)

- KPIs: Schedule Adherence %, Tasks Completed On-Time %, Critical Tasks Late, Milestone Slippage (days)
- Schedule Adherence trend line
- Planned vs Actual Start/Finish bar (per process / order / work_center)
- Simplified Gantt delta view (baseline vs actual)
- Table: Orders/Tasks at Risk (Planned Finish, Actual Progress, Slack, Risk Flag)

Pulls baseline from MS Project, actuals from MPS2.

### 6.7 Page 7 — Order/Job Performance (optional)

Per-order leading-cost-indicator dashboard:

- Cost Variance, Labor Hour Variance, Machine Hour Variance, Rework Cost, Estimated Cost at Completion
- Bar: Planned vs Actual Cost (per order/process/category)
- Waterfall: Planned + Extra Labor + Extra Machine + Rework = Forecast Final Cost
- Table: Orders at Financial Risk (cost > x%, effort > estimate, margin < threshold)

---

## 7. Chart Type Selection (use this lookup)

The agent must choose the **right chart** for each question:

| Question | Chart |
|----------|-------|
| Berapa OEE sekarang? | KPI Card |
| Faktor terburuk? | Bar / Stacked Bar |
| Komposisi loss? | Stacked Bar |
| Membaik atau memburuk? | Line |
| Loss terbesar apa? | Pareto |
| Kenapa angka segini? (storytelling) | Waterfall |
| Pola sistemik (cross-dim)? | Heatmap / Matrix |

**Forbidden combinations:**
- ❌ KPI card for analysis (use only for status)
- ❌ Line chart for category comparison
- ❌ Bar chart for trend over time
- ❌ Heatmap for operator dashboards (too complex)
- ❌ Gauge chart when there are >1 KPIs (KPI card is almost always better)

---

## 8. Anti-Patterns (DO NOT)

The agent must refuse / refactor any code that does these:

1. ❌ Treat all VA as "good OEE" automatically
2. ❌ Count Setup as Planned Time (it's Availability Loss even though NNVA)
3. ❌ Make Performance always 100%
4. ❌ Let Scrap reduce Availability (it's Quality only)
5. ❌ Let one activity affect two OEE factors
6. ❌ Compute OTE as average of OEE across machines
7. ❌ Compute OTE from total output across all processes (must be bottleneck)
8. ❌ Treat all waste as reducing OTE (only bottleneck waste does)
9. ❌ Use OTIF as an internal improvement KPI
10. ❌ Subtract planned setup from bottleneck Available Time
11. ❌ Display OLE per individual employee
12. ❌ Use unit-based Quality for MTO/recondition orders
13. ❌ Put VA/NNVA/NVA into the OEE/OLE/OTE numerator or denominator

---

## 9. Suggested Tech Stack (consistent with MPS2 conventions)

- **DB:** PostgreSQL (existing MPS2 schema). Add tables/views from §4.
- **Backend:** FastAPI or Node.js/Express (existing MPS2 patterns) — expose `/oee`, `/ole`, `/ote`, `/otif`, `/overtime-readiness`, `/schedule-perf`, `/order-perf`.
- **Frontend:** React + Vite + Tailwind (existing MPS2 stack). TanStack Query for data fetching. Recharts or ECharts for visualizations.
- **Alternative BI option:** Power BI with DAX — the source document repeatedly references DAX measure patterns.
- **Cache layer:** materialized views refreshed every 5 minutes for shopfloor pages, hourly for manager pages, daily for BOD pages.

---

## 10. Implementation Order (suggested for the agent)

**Phase 1 — Foundation (do not skip):**
1. Create `dim_activity_rule` and seed it with current SSB activity codes + Lean classification.
2. Create `fact_machine_activity` and `fact_labor_activity` schemas.
3. Implement Layer 1-6 views (§4.3). Add the 6 validation tests from §5.2 as a CI job.
4. Verify on 1 plant, 1 week of historical data. Numbers must reconcile manually.

**Phase 2 — Single-role OEE first:**
5. Build OEE Manager page only (the most-used view). Validate with one plant manager.
6. Add OEE Operator page (real-time concerns).
7. Add OEE BOD page.

**Phase 3 — Expand:**
8. Repeat for OLE.
9. Define `value_stream` and bottleneck identification logic. Build OTE.
10. Hook OTIF (depends on `fact_order.due_date` and `delivered_date` being populated).
11. Overtime Readiness — composes existing data, no new fact tables.
12. Schedule Performance, Order Performance — read-only views over MS Project sync + cost data.

---

## 11. Glossary (one-line definitions)

| Term | Meaning |
|------|---------|
| **OEE** | Overall Equipment Effectiveness (machine) |
| **OLE** | Overall Labor Effectiveness (worker) |
| **OTE** | Overall Throughput Effectiveness (system, bottleneck-driven) |
| **OTIF** | On-Time In-Full (delivery promise outcome) |
| **VA** | Value Added activity |
| **NNVA** | Necessary Non-Value Added |
| **NVA** | Non-Value Added (waste) |
| **MTO** | Make-To-Order |
| **FPY** | First Pass Yield |
| **Bottleneck** | Process with highest load ratio / longest queue / lowest OEE on critical path |
| **Six Big Losses** | TPM losses: Breakdown, Setup, Idling/Minor Stop, Reduced Speed, Process Defect, Startup Loss |
| **TOC** | Theory of Constraints (Goldratt) — basis for OTE |
| **TPM** | Total Productive Maintenance — basis for OEE |

---

## 12. Done Criteria

The dashboard suite is "done" when an agent or human can answer this single integrated question, in one pass through the dashboards, with no spreadsheet help:

> *"Why did OTIF miss this week, where in the system, what was the throughput cost, and what should we do — overtime, reschedule, or fix quality first?"*

If the answer requires opening Excel or asking three different teams, the dashboard is incomplete.

---

## 13. Data Source Mapping — Existing MPS2 Postgres Schema (audited 2026-04-29)

> Audit date: 2026-04-29. Database: MPS2 Postgres `public` schema (33 tables). The agent must NOT create new fact/dim tables blindly — first wrap existing sources as views with the canonical column names from §4. Only when a column truly does not exist anywhere should new ETL be added.

### 13.1 Source Inventory (what we already have)

| Spec target (§4) | Existing table(s) | Row count | Coverage assessment |
|---|---|---|---|
| `dim_activity_rule` | **`mch_statustypes`** (22 rows) + activity codes used in `timesheet_transaction.activitytype` (1510–1680, M1, M2) | 22 / 17 distinct codes used | **80% ready** — descriptions already cover the SSB-specific NVA list in §3.2 (Coffee Break, Daily PM, Tool Prep, Labour Necessity, Jig Fixtures, Wait-for-X, Breakdown, Setup variants Load/Setting/Measure/Unload). Missing the lean/OEE-mapping columns. |
| `dim_machine` | `mch_machines` (79) | 79 | OK as base — needs join to `workcenter` for `work_center_id`, `plant_code` derived from `plantid`. |
| `dim_work_center` | `workcenter` (43) | 43 | Has `plant`, `costcenter`, `costcenter_rate`, `machineid`, `groupname`, `categoryhours`. Missing `value_stream`. |
| `dim_employee` | `users` (4), `usernfc`, `timesheet_transaction.full_name` (81 distinct workers) | 4 / 81 | Source-of-truth for workers is currently `timesheet_transaction.full_name` (free text). No `skill_group`. **HR master is missing.** |
| `dim_customer` | `customers` (15) | 15 | OK. |
| `dim_order` / `fact_order` (plan side) | **`ph3_order`** (53,859 confirmation/operation rows, 2,514 distinct order_no) + `production_operations` (empty) + `sow` (98,193) | 53,859 / 98,193 | Plan/master side is rich. `sow.planhours` populated on 91,950 rows (good ideal-time source). |
| `fact_machine_activity` | **`mch_productiondata`** (schema exists, **0 rows**) → aggregated view `mch_daily_machinehours_by_status` (also **0 rows**) | 0 | **Schema is correct shape (start/end/duration/status/operator/job)** — but the SCADA/MQTT ingest is not running. This is the biggest data gap. |
| `fact_labor_activity` | **`timesheet_transaction`** (18,296 rows, 2025-08-21 → 2026-04-11) | 18,296 | Live and growing. Has check-in/out timestamps, duration, activitytype, workcenter, plant, full_name. Missing `state` enum, `standard_time_min`, `is_paid`. |
| Routing master / ideal cycle time | `operations` (2,727; 1,990 with positive `planhours`), `sow.planhours` (90,196 with positive value), `ph3_order.standard_value` | 2,727 / 90,196 | Sufficient for first-pass standard time. Granularity is per operation, not per cycle — Performance loss must be approximated as `actual_hours / planhours` until SCADA cycle-time exists. |
| Quality data | `processcontroldata` + `processcontroldata_item` (parameter-level inspection results), `qh3_order` (85 rows) | varies | Inspection results exist but `good_qty`/`total_qty`/`rework_time` are NOT explicit columns. Use **time-based quality** (§3.1 / Anti-Pattern #12) — fits MTO recondition. |
| `fact_order` (delivery side, OTIF) | `receiving_orders` (100) + `shipping_records` (95) | OK | **OTIF computable today**: `received_date` → `delivery_date`. `due_date` (customer-promised) is **missing** — currently no SLA column. |
| Schedule baseline (Page 6) | `sow.plan_start`, `sow.plan_finish` (**0 rows populated**), `sow.actual_start` (5), `sow.actual_finish` (0), `sow.actual_hours` (5), `progress_update_history` (**0 rows**) | almost empty | Schema exists, **data does not flow yet**. Needs MS Project ETL hookup. |
| SAP confirmation log | `log_timesheet_sap` (3 rows) | 3 | Mostly empty — for traceability only, not a primary KPI source. |

### 13.2 Existing Activity Code → OEE/Lean Mapping (immediate quick-win)

`mch_statustypes` already groups by `mainstatusid` and the descriptions match the §3.2 default mapping exactly. Apply this mapping in a view (or `ALTER TABLE` adding the columns):

| `statusid` | `description` | `mainstatusid` | Lean | OEE Loss | Factor | Planned Shutdown |
|---|---|---|---|---|---|---|
| 0 | Off | 0 | — | EXCLUDED | — | TRUE |
| 1 | Productive | 1 | VA | PRODUCTIVE_TIME | NONE | FALSE |
| 2 | Idle | 2 | NVA | PERFORMANCE_LOSS | P | FALSE |
| 3 | Downtime | 4 | NVA | AVAILABILITY_LOSS | A | FALSE |
| 4 | No Job | 3 | NVA | AVAILABILITY_LOSS | A | FALSE |
| 5 | Unidentified | 5 | NVA | AVAILABILITY_LOSS | A | FALSE |
| 6 | Load | 5 | NNVA | AVAILABILITY_LOSS | A | FALSE |
| 7 | Setting (Setup) | 5 | NNVA | AVAILABILITY_LOSS | A | FALSE |
| 8 | Measure | 5 | NNVA | AVAILABILITY_LOSS | A | FALSE |
| 9 | Unload | 5 | NNVA | AVAILABILITY_LOSS | A | FALSE |
| 10 | Preventive | 4 | NNVA | AVAILABILITY_LOSS | A | FALSE *(set TRUE only if scheduled PM)* |
| 11 | Breakdown | 4 | NVA | AVAILABILITY_LOSS | A | FALSE |
| 12 | Coffee Break / Lunch | 6 | NVA | AVAILABILITY_LOSS | A | FALSE |
| 13 | Daily PM | 6 | NNVA | PERFORMANCE_LOSS | P | FALSE |
| 14 | Tool Preparation | 6 | NNVA | PERFORMANCE_LOSS | P | FALSE |
| 15 | Labour Necessity | 6 | NNVA | PERFORMANCE_LOSS | P | FALSE |
| 16 | Jig Fixtures | 6 | NNVA | AVAILABILITY_LOSS | A | FALSE |
| 17 | Waiting for Engineer | 6 | NVA | PERFORMANCE_LOSS | P | FALSE |
| 18 | Waiting for Inspection | 6 | NVA | PERFORMANCE_LOSS | P | FALSE |
| 19 | Waiting for NCR | 6 | NVA | PERFORMANCE_LOSS | P | FALSE |
| 20 | Wait For Handling | 6 | NVA | PERFORMANCE_LOSS | P | FALSE |
| 21 | Wait For Material | 6 | NVA | PERFORMANCE_LOSS | P | FALSE |

> **Migration suggestion (Phase-1 quick win):**
> ```sql
> ALTER TABLE mch_statustypes
>   ADD COLUMN lean_category varchar(8),
>   ADD COLUMN oee_loss_category varchar(32),
>   ADD COLUMN oee_factor_impact varchar(8),
>   ADD COLUMN ole_loss_category varchar(32),
>   ADD COLUMN is_planned_shutdown boolean DEFAULT false,
>   ADD COLUMN effective_from date DEFAULT CURRENT_DATE,
>   ADD COLUMN effective_to date;
> ```
> Then seed the table from the matrix above. Treat `mch_statustypes` as the canonical `dim_activity_rule`.

### 13.3 Recommended View Layer (use existing tables, no new fact tables yet)

| Spec view | SQL skeleton (build on existing tables) |
|---|---|
| `dim_activity_rule` | `SELECT statusid AS activity_code, description, lean_category, oee_loss_category, oee_factor_impact, ole_loss_category, is_planned_shutdown FROM mch_statustypes` (after §13.2 ALTER) |
| `vw_fact_machine_activity` | `SELECT proddataid, machineno, statusid, startdatetime, enddatetime, durationseconds/60.0 AS duration_min, jobid AS order_no, operatorid FROM mch_productiondata` — wrap as the canonical fact (no copy) |
| `vw_fact_labor_activity` | `SELECT tsnumber, plant, full_name, workcentercode, order_no, operation_no, ssbr_id, activitytype AS activity_code, longdate_checkin AS start_ts, longdate_checkout AS end_ts, duration*60 AS duration_min, planhours, std_foreman_hours FROM timesheet_transaction WHERE state_flag = 1` |
| `vw_dim_machine` | `SELECT m.machineno, m.machineid, m.machinename, w.workcenterot AS work_center_id, w.plant AS plant_code, w.groupname FROM mch_machines m LEFT JOIN workcenter w ON w.machineid = m.machineid` |
| `vw_dim_work_center` | `SELECT workcenterot AS work_center_id, workcenter_description AS name, plant AS plant_code, NULL::text AS value_stream, costcenter, costcenter_rate FROM workcenter` |
| `vw_dim_order` | `SELECT DISTINCT order_no, plant_code, order_type, order_description, material_no, material_description FROM ph3_order` |
| `vw_planned_production_time` | aggregate `mch_productiondata.duration` per `(machineno, work_date, shift)` excluding statuses where `is_planned_shutdown = true` |
| `vw_operating_time` | aggregate where `statusid = 1` (Productive) |
| `vw_otif` | `SELECT r.ssbr_ident, r.received_date, s.delivery_date, (s.delivery_date - r.received_date) AS lead_time_days FROM receiving_orders r JOIN shipping_records s ON s.receiving_order_id = r.id` — **add `due_date` once column is created** |

### 13.4 Gap Register (must be added before each dashboard ships)

| # | Gap | Blocks dashboard | Recommended fix |
|---|---|---|---|
| **G1** | `mch_productiondata` is empty (0 rows). Schema exists. | OEE (Page 1), OTE (Page 3), Overtime (Page 5) — all machine-side KPIs | Activate the SCADA/MQTT collector defined in `mch_machines.mqtt_topic`. Without this, OEE = 0%. **Highest priority.** |
| **G2** | `dim_activity_rule` columns missing on `mch_statustypes`. | Rule engine (§5) | Apply the ALTER + seed from §13.2. ~1 hour of work. |
| **G3** | No `due_date` (customer-promised delivery date) on receiving/shipping. | OTIF (Page 4) — On-Time half is unmeasurable today | Add `due_date date` to `receiving_orders`, populate from customer PO during receiving step. |
| **G4** | No `good_qty` / `total_qty` / `rework_time_min` on `sow` or `ph3_order`. | Quality factor of OEE/OLE | For MTO use **time-based quality** (Anti-Pattern #12): `Quality = 1 - (rework_activity_minutes / operating_minutes)`, where rework is detected via `timesheet_transaction.operation_text ILIKE '%rework%'` and `ph3_order.operation_short_text ILIKE 'Ops Rework%'` (already seen in samples). Add explicit `rework_time_min` column to a future `fact_order` rollup. |
| **G5** | `sow.plan_start` / `plan_finish` are **0% populated**; `actual_start` 5 rows, `actual_finish` 0, `progress_update_history` 0 rows. | Schedule Performance (Page 6) | Build MS-Project → `sow` ETL. Wire the existing `OperationsHubPage` progress UI to write `progress_update_history`. |
| **G6** | `dim_employee` does not exist; `timesheet_transaction.full_name` is free text; no `skill_group`. | OLE (Page 2) — cannot aggregate by skill | Create `dim_employee (employee_id, full_name, skill_group, plant_code)` and backfill from `usernfc` + HR export. Until then, aggregate OLE by `workcentercode` only (NEVER by `full_name`). |
| **G7** | No `value_stream` attribute on `workcenter`. | OTE (Page 3) — bottleneck must be per value stream | Add `value_stream varchar(40)` to `workcenter`. Map manually for first iteration (e.g., HEX cylinder, Engine, Hydraulic). |
| **G8** | No `planned_cost` / `actual_cost` per order. Only `costcenter_rate` exists at workcenter level. | Order/Job Performance (Page 7) | Compute on the fly: `actual_cost = SUM(timesheet duration × workcenter.costcenter_rate)`. `planned_cost = SUM(sow.planhours × costcenter_rate)`. Materialize when needed. |
| **G9** | `timesheet_transaction.order_no` is filled on only 29 of 18,296 rows; `ssbr_id` is filled on 6,052 (33%). | Per-order OLE & cost rollup is leaky | Make `order_no` (or `ssbr_id`) **required** at check-in for any operation activity (1510 BRIEFING etc. can stay null). UI change in `TimesheetPage`. |
| **G10** | `production_operations` table is empty; appears to duplicate `ph3_order`. | Nothing critical | Either drop or backfill. Recommend **drop** and standardize on `ph3_order`. |
| **G11** | No `shift_id` anywhere (not on `timesheet_transaction`, not on `mch_productiondata`). | Shift-level slicing (operator dashboards, BOD shift comparison) | Derive in a view from `EXTRACT(HOUR FROM start_ts)` against a `dim_shift` table — create `dim_shift (shift_id, plant_code, start_hour, end_hour)`. |
| **G12** | `mch_daily_machinehours_by_status` view depends on G1 — empty until SCADA flows. | Cached OEE | Once G1 is fixed, this view becomes the Layer-1/2 source automatically. |

### 13.5 Updated Implementation Order (revised from §10 with current data reality)

**Phase 0 — Unblock data flow (do FIRST):**
0a. Fix **G1** — turn on the SCADA/MQTT machine collector. Without machine activity rows, every machine KPI is 0.
0b. Fix **G2** — ALTER `mch_statustypes` and seed the lean/OEE/OLE columns from §13.2.
0c. Fix **G6** lite — create skeleton `dim_employee` from `usernfc` so OLE aggregation has a non-PII grain.

**Phase 1 — Wrap existing data, do not duplicate:**
1. Build §13.3 views as the canonical layer (no fact-table copies).
2. Implement §4.3 Layer 1–6 views on top of the §13.3 wrappers.
3. Add the 6 validation tests from §5.2 against the wrapped data.
4. Validate OEE on plant 5051 for one week — numbers must reconcile manually.

**Phase 2 — OEE Manager → Operator → BOD** (unchanged from §10).

**Phase 3 — Add the missing master/transaction columns as KPIs are unlocked:**
- OLE: G6 full, G11 (shift)
- OTE: G7 (value_stream)
- OTIF: G3 (due_date), G4 (rework time-based quality)
- Order Perf: G8 (cost rollup), G9 (mandatory order_no on timesheet)
- Schedule Perf: G5 (MS Project ETL + progress write-back)

### 13.6 Empty / Deprecated Tables (do not build on)

| Table | Status | Action |
|---|---|---|
| `mch_productiondata` | Schema OK, 0 rows | Wait for G1 |
| `mch_daily_machinehours_by_status` | View, 0 rows (depends on above) | Auto-fills after G1 |
| `production_operations` | 0 rows, duplicates `ph3_order` | Drop (G10) |
| `progress_update_history` | 0 rows | Wire from `OperationsHubPage` (G5) |
| `log_timesheet_sap` | 3 rows | Keep for SAP audit trail only |
| `qh3_order` | 85 rows, partial | Keep for inspection orders, not load-bearing |

---

**Bottom line:** ~70% of the dashboard data model is already present in the existing schema (rule-engine seed in `mch_statustypes`, labor activity in `timesheet_transaction`, plan side in `ph3_order`/`sow`, OTIF endpoints in `receiving_orders`/`shipping_records`). The single biggest blocker is **G1 (SCADA ingest off → no machine-state rows)**, which gates every machine-side KPI. The second is **G3 (no `due_date` field)** which gates the On-Time half of OTIF. Everything else is additive (columns, views, ETL hookups) and does not require rebuilding what is there.
