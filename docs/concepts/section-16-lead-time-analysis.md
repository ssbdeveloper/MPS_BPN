---
title: "Section 16 — Lead Time Analysis"
section: 16
domain: manufacturing-analytics
subdomain: [lead-time, queue, flow-efficiency, machine-flow]
system: UNIFY_5051
platform: [Power Query (M), Power BI (DAX)]
source_file: Section_16_Lead_Time_Analysis.docx
status: converted-from-docx
language: id-ID (mixed technical English)
related:
  - "[[section-17-bottleneck-analysis]]"
---

# Section 16 — Lead Time Analysis

> Ruang lingkup: Processing, Waiting, Queue, Flow, Bottleneck (identifikasi awal).
> Lanjutan analisis ada di [[section-17-bottleneck-analysis]].

## 1. Overview

Analisis sebelumnya berfokus pada kinerja mesin (OEE) dan kinerja operator (OLE & Multitasking). Pertanyaan bisnis berikutnya:

> **"Kenapa sebuah order selesai lama?"**

Untuk menjawabnya dibangun **Lead Time Analytics** dari perspektif *Production Order*.

### Definisi inti

```
Lead Time = Queue Time + Processing Time + Waiting Time
```

| Komponen | Definisi |
|---|---|
| **Queue Time** | Waktu order menunggu operasi berikutnya (antrian antar-operasi). |
| **Processing Time** | Waktu yang benar-benar digunakan mengerjakan pekerjaan (value added). |
| **Waiting Time** | Waktu order sudah berada di mesin tetapi belum menghasilkan nilai tambah (internal delay). |

Dengan pendekatan ini sistem tidak hanya mendeteksi bahwa order terlambat, tetapi dapat menjelaskan **penyebab** keterlambatan. Temuan konseptual yang diklaim dokumen: masalah utama bukan kapasitas proses, melainkan **antrian antar operasi**.

### Machine Flow Analytics

Selain sisi order, dibangun **Machine Flow Analytics** untuk melihat tiap mesin dari sisi:

- jumlah order yang diproses
- waktu produktif
- waktu menunggu
- waktu tanpa pekerjaan (No Job)
- intensitas antrian
- eksposur multitasking operator

Tujuan tahap ini **bukan** langsung menetapkan *true bottleneck*, melainkan mengidentifikasi:

> "Mesin mana yang paling berpotensi menjadi penghambat aliran order."

Sehingga pertanyaan analitik naik level dari *"Mesin mana yang performanya rendah?"* menjadi *"Mesin mana yang memperlambat penyelesaian order pelanggan?"* — fondasi untuk pengelolaan **Turn Around Time (TAT)**, peningkatan flow process, dan identifikasi bottleneck yang objektif.

---

## 2. Definisi Operasional

**Lead Time** = total waktu dari awal sampai selesai suatu order atau *activity confirmation*.

### Formula (perspektif mesin/operator, satu cycle process)

```
Lead Time = Processing + Waiting + Queue
```

### Pemetaan ke HMI system

| Istilah | Formula / Sumber |
|---|---|
| `Processing_Minutes` | `Running_Minutes (statusid 1, 2) + SmallStop_Minutes (statusid 6, 7, 8, 9)` |
| `Waiting Time` | Waktu tidak dikerjakan meskipun komponen (job) sudah berada di atas mesin. |
| `Queue Time` | `FirstStart_Time − Arrival_Time` (hanya bagian awal dari waiting). |
| `Arrival_Time` | `Event_Time` terakhir dari *finish activity* sebelumnya. |
| `FirstStart_Time` | `Start_Job`. Dalam konteks HMI Event: `[Login_Job]` → `[Start_Job]`. |

### Urutan sesuai flow aktivitas

```
Lead Time = Queue (waiting di awal) + Processing + Waiting (internal delay)
```

<!-- IMAGE: ilustrasi timeline lead time (image1.png, image2.emf) — tidak diekstrak -->

---

## 3. Data Pipeline

Rantai transformasi (Power Query M):

```
UNIFY_5051_TB (source, eksternal — tidak didefinisikan di dokumen ini)
  ├─> UNIFY_5051_LT_TIMELINE ──> UNIFY_5051_ORD_OPR_KPI ──┐
  └─> UNIFY_5051_FACT_ORD_OPR <───────────────────────────┘ (join by conf_number)
        ├─> UNIFY_5051_FACT_ORD_LT            (grain: order)
        └─> UNIFY_5051_FACT_MACHINE_FLOW_DAY  (grain: date x machine)
              └─ join UNIFY_5051_MT_DTC (multitask exposure, sumber eksternal)
```

---

### 3.1 `UNIFY_5051_LT_TIMELINE`

**Tujuan:** state engine per menit (time bucket) — mengklasifikasikan tiap bucket menjadi Productive / Waiting / No Job.
**Grain:** `Time_Bucket × Machineid`

```powerquery
let
    // LOAD SOURCE DATA
    Source = UNIFY_5051_TB,

    // FILTER VALID
    Base = Table.SelectRows(Source, each [Time_Bucket] <> null and [Machineid] <> null),

    // ADD DATE
    AddDate = Table.AddColumn(Base, "Date", each Date.From([Time_Bucket]), type date),

    // ADD LEAD TIME STATE ENGINE
    ProductiveStatus = {"1","2","6","7","8","9"},
    AddState = Table.AddColumn(AddDate, "LT_State", each
        if List.Contains(ProductiveStatus, [statusid]) then "Productive"
        else if [statusid] = "4" then "No Job"
        else "Waiting", type text),

    // ADD FLAG
    IsProductive  = Table.AddColumn(AddState,      "IsProductive",  each if [LT_State] = "Productive" then 1 else 0, Int64.Type),
    IsNoJob       = Table.AddColumn(IsProductive,  "IsNoJob",       each if [LT_State] = "No Job"     then 1 else 0, Int64.Type),
    IsWaiting     = Table.AddColumn(IsNoJob,       "IsWaiting",     each if [LT_State] = "Waiting"    then 1 else 0, Int64.Type),
    IsActiveOrder = Table.AddColumn(IsWaiting,     "IsActiveOrder", each if [conf_number] <> null     then 1 else 0, Int64.Type),

    IsPostCompletion = Table.AddColumn(IsActiveOrder, "IsPostCompletion", each
        if [DateTime_Finish] = null then 0
        else if [Time_Bucket] > [DateTime_Finish] then 1 else 0, Int64.Type),

    IsActiveLifecycle = Table.AddColumn(IsPostCompletion, "IsActiveLifecycle", each
        if [DateTime_Finish] = null then null
        else if [Time_Bucket] <= [DateTime_Finish] then 1 else 0, Int64.Type),

    // FINAL COLUMN SET
    Final = Table.SelectColumns(IsActiveLifecycle, {
        "Time_Bucket","Date","Machineid","sn_employee",
        "order_number","Opr_no","conf_number","statusid","LT_State",
        "IsProductive","IsWaiting","IsNoJob","IsActiveOrder","IsPostCompletion","IsActiveLifecycle"}),

    // TYPE FIX
    FixTypes = Table.TransformColumnTypes(Final, {
        {"Machineid", type text},{"sn_employee", type text},
        {"order_number", type text},{"Opr_no", type text},{"conf_number", type text}})
in
    FixTypes
```

#### State mapping (kanonik)

| `statusid` | `LT_State` | Keterangan |
|---|---|---|
| 1, 2 | `Productive` | Running |
| 6, 7, 8, 9 | `Productive` | Small Stop |
| 4 | `No Job` | Tidak ada assignment |
| selain di atas | `Waiting` | Internal delay |

#### Kamus kolom output

| Kolom | Definisi |
|---|---|
| `Time_Bucket` | Timeline bucket |
| `Date` | Timeline date |
| `Machineid` | Work center / mesin |
| `sn_employee` | Operator ID |
| `order_number` | Production order number |
| `Opr_no` | Operation sequence (SOW / routing) |
| `conf_number` | SAP confirmation number |
| `statusid` | Status mesin (HMI) |
| `LT_State` | Lead time state (Productive / Waiting / No Job) |
| `IsProductive` | Flag productive |
| `IsWaiting` | Flag waiting |
| `IsNoJob` | Flag no job |
| `IsActiveOrder` | Flag current job |
| `IsPostCompletion` | Flag bucket setelah `DateTime_Finish` |
| `IsActiveLifecycle` | Flag bucket dalam lifecycle order |

---

### 3.2 `UNIFY_5051_ORD_OPR_KPI`

**Tujuan:** KPI dari perspektif order-operation (agregasi menit per confirmation).
**Grain:** `conf_number`
**Source:** `UNIFY_5051_LT_TIMELINE`

```powerquery
let
    // LOAD SOURCE DATA
    Source = UNIFY_5051_LT_TIMELINE,

    // FILTER VALID
    Base = Table.SelectRows(Source, each [conf_number] <> null and [Time_Bucket] <> null),

    // OPERATION KPI
    OperationKPI = Table.Group(Base, {"conf_number"}, {
        {"Date",           each List.Min([Date]), type date},
        {"Machineid",      each List.First(List.RemoveNulls([Machineid])), type text},
        {"order_number",   each List.First(List.RemoveNulls([order_number])), type text},
        {"Opr_no",         each List.First(List.RemoveNulls([Opr_no])), type text},
        {"Productive_Min", each List.Sum([IsProductive]), Int64.Type},
        {"Waiting_Min",    each List.Sum([IsWaiting]), Int64.Type},
        {"NoJob_Min",      each List.Sum([IsNoJob]), Int64.Type},
        {"Total_Min",      each Table.RowCount(_), Int64.Type}})
in
    OperationKPI
```

**Output aktual query ini:** `conf_number`, `Date`, `Machineid`, `order_number`, `Opr_no`, `Productive_Min`, `Waiting_Min`, `NoJob_Min`, `Total_Min`.

> ⚠️ Dokumen asli mencantumkan daftar KPI di bawah query ini yang memuat `Start_Time`, `Finish_Time`, `Lead_Time_Min`, `Queue_Min`, `STD_Time`, `Work_Complete`, `Flow_Efficiency`, `Portfolio`. Kolom-kolom itu **tidak dihasilkan** oleh query ini — mereka milik `UNIFY_5051_FACT_ORD_OPR` (§3.3). Lihat [Catatan Verifikasi](#7-catatan-verifikasi-temuan-inkonsistensi).

---

### 3.3 `UNIFY_5051_FACT_ORD_OPR`

**Tujuan:** join lead time KPI dari perspektif order ke mesin + perhitungan **Queue Time**.
**Grain:** `order_number × Opr_no × Machineid × conf_number`
**Source:** `UNIFY_5051_TB` (+ join `UNIFY_5051_ORD_OPR_KPI`)

```powerquery
let
    // LOAD SOURCE DATA
    Source = UNIFY_5051_TB,

    // FILTER VALID
    Base = Table.SelectRows(Source, each
        [Time_Bucket] <> null and [order_number] <> null
        and [Opr_no] <> null and [Machineid] <> null),

    // GROUP BY ORDER, OPERATION DAN MESIN
    OperationGroup = Table.Group(Base, {"order_number","Opr_no","Machineid","conf_number"}, {
        {"Start_Time",    each List.Min([Time_Bucket]), type datetime},
        {"Finish_Time",   each List.Max([Time_Bucket]), type datetime},
        {"Lead_Time_Min", each Table.RowCount(_), Int64.Type},
        {"STD_Time",      each List.Max([STD_time]), Int64.Type},
        {"Portfolio",     each List.First([Portfolio]), type text}}),

    // SORT DATA
    Sorted = Table.Sort(OperationGroup, {
        {"order_number", Order.Ascending},{"Start_Time", Order.Ascending}}),

    // ADD INDEX
    AddIndex = Table.AddIndexColumn(Sorted, "Idx", 0, 1, Int64.Type),

    // BUFFER DATA (SUPAYA CEPAT)
    Buffered = Table.Buffer(AddIndex),

    // ACTUAL SEQUENCE (OPSIONAL — lihat catatan: step ini orphaned)
    AddActualSeq = Table.AddColumn(Buffered, "Actual_Seq",
        each List.Count(Table.SelectRows(Buffered,
            (r) => r[order_number] = [order_number] and r[Start_Time] <= [Start_Time])[order_number]), Int64.Type),

    // CARI OPERASI BERIKUTNYA
    NextOrder = Table.AddColumn(Buffered, "Next_Order",
        each try Buffered[order_number]{[Idx]+1} otherwise null, type text),

    // CARI NEXT START OPERASI BERIKUTNYA
    NextStart = Table.AddColumn(NextOrder, "Next_Start",
        each try Buffered[Start_Time]{[Idx]+1} otherwise null, type datetime),

    // NEXT OPERATION
    NextOpr = Table.AddColumn(NextStart, "Next_Opr",
        each try Buffered[Opr_no]{[Idx]+1} otherwise null, type text),

    // HITUNG QUEUE TIME (UNTUK ORDER YANG SAMA)
    AddQueueRaw = Table.AddColumn(NextOpr, "Queue_Min_Raw",
        each if [order_number] <> [Next_Order] then null
             else Duration.TotalMinutes([Next_Start] - [Finish_Time]), Int64.Type),

    AddQueue = Table.AddColumn(AddQueueRaw, "Queue_Min",
        each if [Queue_Min_Raw] = null then null
             else if [Queue_Min_Raw] < 0 then 0
             else Number.Round([Queue_Min_Raw], 0), Int64.Type),

    AddQueueAnomaly = Table.AddColumn(AddQueue, "Queue_Anomaly",
        each if [Queue_Min_Raw] <> null and [Queue_Min_Raw] < 0 then 1 else 0, Int64.Type),

    // LOAD OPERATION KPI + JOIN
    OPR_KPI  = UNIFY_5051_ORD_OPR_KPI,
    JoinKPI  = Table.NestedJoin(AddQueueAnomaly, {"conf_number"}, OPR_KPI, {"conf_number"}, "KPI", JoinKind.LeftOuter),
    ExpandKPI = Table.ExpandTableColumn(JoinKPI, "KPI", {"Date","Productive_Min","Waiting_Min","NoJob_Min","Total_Min"}),

    // ADD WORK COMPLETE
    AddWorkComplete = Table.AddColumn(ExpandKPI, "Work_Complete",
        each if [STD_Time] = null or [STD_Time] = 0 then null
             else Number.Round([Productive_Min] / [STD_Time], 4), Percentage.Type),

    // ADD FLOW EFFICIENCY
    AddFlowEfficiency = Table.AddColumn(AddWorkComplete, "Flow_Efficiency",
        each if [Lead_Time_Min] = null or [Lead_Time_Min] = 0 then null
             else Number.Round([Productive_Min] / [Lead_Time_Min], 4), Percentage.Type),

    // FINAL
    Final = Table.ReorderColumns(AddFlowEfficiency, {
        "Date","order_number","Opr_no","Machineid","conf_number",
        "Start_Time","Finish_Time","Lead_Time_Min","Queue_Min",
        "Productive_Min","Waiting_Min","NoJob_Min","STD_Time",
        "Work_Complete","Flow_Efficiency","Queue_Anomaly","Portfolio"})
in
    Final
```

#### Logika Queue Time

1. Urutkan seluruh operasi per `order_number` berdasarkan `Start_Time`.
2. `Queue_Min_Raw = Next_Start − Finish_Time`, hanya jika baris berikutnya masih **order yang sama**; jika beda order → `null`.
3. Nilai negatif (operasi paralel/overlap) → di-clamp ke `0` dan ditandai `Queue_Anomaly = 1`.

#### Kamus kolom output

| Kolom | Definisi |
|---|---|
| `Date` | Record date |
| `order_number` | Production order |
| `Opr_no` | Operation sequence (SOW / routing) |
| `Machineid` | Work center / mesin |
| `conf_number` | SAP activity confirmation number |
| `Start_Time` | Start operation |
| `Finish_Time` | Finish operation |
| `Lead_Time_Min` | Lead time operasi (= jumlah time bucket dalam grup) |
| `Queue_Min` | Antrian menuju operasi berikutnya |
| `Productive_Min` | Productive minutes (VA + NNVA) |
| `Waiting_Min` | Non-productive minutes — exclude No Job |
| `NoJob_Min` | No job minutes (no assignment) |
| `STD_Time` | Standard time operation |
| `Work_Complete` | `Productive_Min / STD_Time` (absorption) |
| `Flow_Efficiency` | `Productive_Min / Lead_Time_Min` |
| `Queue_Anomaly` | Flag queue negatif |
| `Total_Min` | Total minutes (dari `ORD_OPR_KPI`) |
| `Portfolio` | Product type |

---

### 3.4 `UNIFY_5051_FACT_ORD_LT`

**Tujuan:** agregasi lead time ke level order (impact analytics).
**Grain:** `order_number`
**Source:** `UNIFY_5051_FACT_ORD_OPR`

```powerquery
let
    // LOAD SOURCE DATA
    Source = UNIFY_5051_FACT_ORD_OPR,

    // GROUP BY ORDER NUMBER
    OrderGroup = Table.Group(Source, {"order_number"}, {
        {"Order_Start",    each List.Min([Start_Time]), type datetime},
        {"Order_Finish",   each List.Max([Finish_Time]), type datetime},
        {"Productive_Min", each List.Sum([Productive_Min]), Int64.Type},
        {"Waiting_Min",    each List.Sum([Waiting_Min]), Int64.Type},
        {"NoJob_Min",      each List.Sum([NoJob_Min]), Int64.Type},
        {"Queue_Min",      each List.Sum(List.RemoveNulls([Queue_Min])), Int64.Type},
        {"STD_Time",       each List.Sum([STD_Time]), Int64.Type},
        {"Portfolio",      each List.First(List.RemoveNulls([Portfolio])), type text}}),

    // HITUNG ORDER LEAD TIME
    AddLeadTime = Table.AddColumn(OrderGroup, "Lead_Time_Min",
        each Duration.TotalMinutes([Order_Finish] - [Order_Start]) + 1, Int64.Type),

    // ADD FLOW EFFICIENCY (opsional, bisa dipindah ke DAX)
    AddFlowEfficiency = Table.AddColumn(AddLeadTime, "Flow_Efficiency",
        each if [Lead_Time_Min] = 0 then null
             else Number.Round([Productive_Min] / [Lead_Time_Min], 4), Percentage.Type),

    // ADD WORK COMPLETE (opsional)
    AddWorkComplete = Table.AddColumn(AddFlowEfficiency, "Work_Complete",
        each if [STD_Time] = null or [STD_Time] = 0 then null
             else Number.Round([Productive_Min] / [STD_Time], 4), Percentage.Type),

    // ADD DELAY RATIO (opsional)
    AddDelayRatio = Table.AddColumn(AddWorkComplete, "Delay_Ratio",
        each if [Lead_Time_Min] = 0 then null
             else Number.Round([Waiting_Min] / [Lead_Time_Min], 4), Percentage.Type),

    // ADD QUEUE RATIO (opsional)
    AddQueueRatio = Table.AddColumn(AddDelayRatio, "Queue_Ratio",
        each if [Lead_Time_Min] = 0 then null
             else Number.Round([Queue_Min] / [Lead_Time_Min], 4), Percentage.Type),

    // FINAL
    Final = Table.ReorderColumns(AddQueueRatio, {
        "order_number","Portfolio","Order_Start","Order_Finish","Lead_Time_Min",
        "Productive_Min","Waiting_Min","Queue_Min","NoJob_Min","Flow_Efficiency",
        "STD_Time","Work_Complete","Delay_Ratio","Queue_Ratio"})
in
    Final
```

> ⚠️ Kode asli di dokumen berbunyi `in Finallet Source = UNIFY_5051_FACT_ORD_OPR_FINAL,` — potongan paste yang rusak. Di atas sudah dinormalisasi menjadi `in Final`. Lihat [Catatan Verifikasi](#7-catatan-verifikasi-temuan-inkonsistensi).

#### Kamus kolom output

| Kolom | Definisi |
|---|---|
| `order_number` | Production order number |
| `Portfolio` | Product type |
| `Order_Start` | Order start |
| `Order_Finish` | Order finish |
| `Lead_Time_Min` | Order lead time (internal process, wall-clock + 1) |
| `Productive_Min` | Productive minutes (VA + NNVA) |
| `Waiting_Min` | Internal delay (semua NNVA/waiting) — exclude No Job |
| `Queue_Min` | Total order queue |
| `NoJob_Min` | Total no job (opsional) |
| `Flow_Efficiency` | `Productive_Min / Lead_Time_Min` |
| `STD_Time` | Standard time order (SUM `STD_Time` operasi) |
| `Work_Complete` | `Productive_Min / STD_Time` |
| `Delay_Ratio` | `Waiting_Min / Lead_Time_Min` |
| `Queue_Ratio` | `Queue_Min / Lead_Time_Min` |

---

### 3.5 `UNIFY_5051_FACT_MACHINE_FLOW_DAY`

**Tujuan:** machine flow analytics harian + multitask exposure.
**Grain:** `Date × Machineid`
**Source:** `UNIFY_5051_FACT_ORD_OPR` (+ join `UNIFY_5051_MT_DTC`)

```powerquery
let
    // SOURCE
    Source = UNIFY_5051_FACT_ORD_OPR,

    // GROUP MACHINE DAY
    MachineFlow = Table.Group(Source, {"Date","Machineid"}, {
        {"Order_Count",         each List.Count(List.Distinct(List.RemoveNulls([order_number]))), Int64.Type},
        {"Conf_Count",          each List.Count(List.Distinct(List.RemoveNulls([conf_number]))), Int64.Type},
        {"Productive_Min",      each List.Sum([Productive_Min]), Int64.Type},
        {"Waiting_Min",         each List.Sum([Waiting_Min]), Int64.Type},
        {"NoJob_Min",           each List.Sum([NoJob_Min]), Int64.Type},
        {"Queue_Min",           each List.Sum(List.RemoveNulls([Queue_Min])), type number},
        {"Avg_Queue_Min",       each List.Average(List.RemoveNulls([Queue_Min])), type number},
        {"Max_Queue_Min",       each List.Max(List.RemoveNulls([Queue_Min])), type number},
        {"Queue_Event_Count",   each List.Count(List.RemoveNulls([Queue_Min])), Int64.Type},
        {"Queue_Anomaly_Count", each List.Sum([Queue_Anomaly]), Int64.Type},
        {"Avg_Work_Complete",   each List.Average(List.RemoveNulls([Work_Complete])), type number},
        {"Avg_Flow_Efficiency", each List.Average(List.RemoveNulls([Flow_Efficiency])), type number}}),

    // MULTI TASK EXPOSURE
    MT_Machine = Table.Group(UNIFY_5051_MT_DTC, {"Date","Machineid"}, {
        {"MT_Min",       each List.Sum([IsMultitask]), Int64.Type},
        {"Observed_Min", each Table.RowCount(_), Int64.Type}}),

    // JOIN MT
    JoinMT = Table.NestedJoin(MachineFlow, {"Date","Machineid"}, MT_Machine, {"Date","Machineid"}, "MT", JoinKind.LeftOuter),

    // EXPAND MT
    ExpandMT = Table.ExpandTableColumn(JoinMT, "MT", {"MT_Min","Observed_Min"}),

    // HANDLE NULL
    FixNullMT = Table.ReplaceValue(ExpandMT, null, 0, Replacer.ReplaceValue, {"MT_Min","Observed_Min"}),
    Final = FixNullMT
in
    Final
```

#### Kamus kolom output

| Kolom | Definisi | Catatan |
|---|---|---|
| `Date` | Record date | |
| `Machineid` | Work center / mesin | |
| `Order_Count` | Jumlah order yang di-load ke mesin | |
| `Conf_Count` | Jumlah order activity yang di-load ke mesin | |
| `Productive_Min` | Productive minutes | |
| `Waiting_Min` | Waiting minutes | |
| `NoJob_Min` | No job minutes | |
| `Queue_Min` | Total antrian di mesin | |
| `Avg_Queue_Min` | Rata-rata antrian | |
| `Max_Queue_Min` | Antrian **terlama** | dokumen asli menulis "antrian tercepat" — salah |
| `Queue_Event_Count` | **Jumlah kejadian** antrian | dokumen asli menulis "antrian terlama" — salah |
| `Queue_Anomaly_Count` | Jumlah queue negatif | tidak didokumentasikan di daftar KPI asli |
| `Avg_Work_Complete` | Productive to STD time | |
| `Avg_Flow_Efficiency` | Productive / total time | |
| `MT_Min` | Multitask exposure minutes | |
| `Observed_Min` | Observed minutes (dari MT_DTC) | tidak didokumentasikan di daftar KPI asli |

---

## 4. Analytics — Machine Flow

**Pertanyaan:** *Mesin mana yang menyebabkan gangguan flow produksi?*

| KPI | Formula | Makna | Grain | Visual |
|---|---|---|---|---|
| Productive Ratio | `Productive_Min / Total_Min` | % waktu benar-benar produktif | date × machine | Bar chart (Top 10 machine) |
| Waiting Ratio | `Waiting_Min / Total_Min` | Flow loss di level mesin | date × machine | Bar chart (Top 10 machine) |
| Queue Intensity | `Queue_Event_Count / Conf_Count` | Seberapa **sering** operasi mengalami antrian | date × machine | Bar chart (Top 10 machine) |
| Queue Per Operation | `Queue_Min / Conf_Count` | Seberapa **parah** rata-rata antrian per mesin | date × machine | Bar chart (Top 10 machine) |

**Queue Heat Map** — dimensi: `Machine × Date × Queue_Per_Conf`
**Scatter Plot** — X: `Queue Per Conf`, Y: `Queue Intensity`, size: `Conf_Count`

<!-- IMAGE: dashboard machine flow (image8.png) — tidak diekstrak -->

---

## 5. Analytics — Order Flow

**Pertanyaan:** *Apa yang dirasakan (impact) terhadap order/customer?*

**KPI Cards**
- Order Average Lead Time
- Order Flow Efficiency
- Order Queue Ratio
- Order Work Complete

**Detail (WHERE)**
- Lead Time by Order — bar chart
- Top Queue Order — bar chart

**Heat Map (WHERE & WHEN)**
- `Portfolio × Date × Average Lead Time`

**Scatter Plot #1** — `Queue_Min` vs `Lead Time Productive Min`
→ menjawab: apakah lead time tinggi disebabkan antrian?

**Scatter Plot #2** — `Order Work Complete` vs `Lead Time Queue_Min`
→ menjawab: lead time tinggi karena pekerjaan besar, atau karena flow buruk?

**Trend (multiple line)**
- Queue Ratio trend
- Flow Efficiency trend

<!-- IMAGE: dashboard order flow (image9.png) — tidak diekstrak -->

---

## 6. Power BI DAX Measures

### 6.1 Machine Flow Lead Time
Tabel: `UNIFY_5051_FACT_MACHINE_FLOW_DAY`

```dax
LT_Machine_AvgWorkComplete =
AVERAGE( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Avg_Work_Complete] )

LT_Machine_MTExposure =
DIVIDE(
    SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[MT_Min] ),
    SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Productive_Min] )
)

LT_Machine_No Job Minute =
SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[NoJob_Min] )

LT_Machine_Productive Minute =
SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Productive_Min] )

LT_Machine_Queue Intensity =
DIVIDE(
    SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Queue_Event_Count] ),
    SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Conf_Count] )
)

LT_Machine_QueuePerConf =
DIVIDE(
    SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Queue_Min] ),
    SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Conf_Count] )
)

LT_Machine_WaitingMinute =
SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Waiting_Min] )

LT_MachineProductive Ratio =
DIVIDE(
    [LT_Machine_Productive Minute],
    [LT_Machine_WaitingMinute] + [LT_Machine_Productive Minute] + [LT_Machine_No Job Minute]
)

LT_MachineWaitingRatio =
DIVIDE(
    [LT_Machine_WaitingMinute],
    [LT_Machine_WaitingMinute] + [LT_Machine_Productive Minute] + [LT_Machine_No Job Minute]
)
```

### 6.2 Order Lead Time
Tabel: `UNIFY_5051_FACT_ORD_LT`

```dax
LT_ORD_AvgLeadTime (Min) =
DIVIDE(
    SUM( UNIFY_5051_FACT_ORD_LT[Lead_Time_Min] ),
    DISTINCTCOUNT( UNIFY_5051_FACT_ORD_LT[order_number] )
)

LT_ORD_TotalLeadTime (Min) =
SUM( UNIFY_5051_FACT_ORD_LT[Lead_Time_Min] )

LT_ORD_TotalProductiveTime (Min) =
SUM( UNIFY_5051_FACT_ORD_LT[Productive_Min] )

LT_ORD_TotalQueueTime (Min) =
SUM( UNIFY_5051_FACT_ORD_LT[Queue_Min] )

LT_ORD_TotalWaitingTime (Min) =
SUM( UNIFY_5051_FACT_ORD_LT[Waiting_Min] )

-- ⚠️ referensi [LT_ORD_TotalProcessingTime (Min)] tidak terdefinisi di manapun
LT_ORD_FlowEfficiency =
DIVIDE( [LT_ORD_TotalProcessingTime (Min)], [LT_ORD_TotalLeadTime (Min)] )

LT_ORD_Queue Ratio =
DIVIDE(
    SUM( UNIFY_5051_FACT_ORD_LT[Queue_Min] ),
    SUM( UNIFY_5051_FACT_ORD_LT[Lead_Time_Min] )
)

LT_ORD_WaitingRatio =
DIVIDE( [LT_ORD_TotalWaitingTime (Min)], [LT_ORD_TotalLeadTime (Min)] )
```

---

## 7. Catatan Verifikasi (temuan inkonsistensi)

> Bagian ini **bukan** bagian dari dokumen asli. Ini hasil pembacaan silang antara narasi, kode M, dan DAX. Harus divalidasi sebelum dijadikan acuan implementasi.

### Blocker

| # | Temuan | Dampak |
|---|---|---|
| B1 | `LT_ORD_FlowEfficiency` memanggil `[LT_ORD_TotalProcessingTime (Min)]` yang **tidak pernah didefinisikan**. Measure yang ada bernama `LT_ORD_TotalProductiveTime (Min)`. | Measure error / blank di Power BI. Berlaku juga untuk `LT_ORD_QueueExposure` di [[section-17-bottleneck-analysis]]. |
| B2 | Kode `UNIFY_5051_FACT_ORD_LT` berakhir dengan `in Finallet Source = UNIFY_5051_FACT_ORD_OPR_FINAL,` — artefak paste. | Query tidak akan compile jika disalin apa adanya. |
| B3 | Penamaan measure NoJob berbeda antar section: `LT_Machine_No Job Minute` (§16) vs `LT_Machine_NoJobMinute` (§17). | Salah satu referensi pasti broken. |

### Inkonsistensi definisi

| # | Temuan |
|---|---|
| D1 | **`Total_Min` didefinisikan dua kali dengan arti berbeda.** §3.2 menyatakan "total minutes tercatat di sistem (HMI)", §3.3 menyatakan "total minutes **exclude** No Job". Kode-nya `Table.RowCount(_)` yang **termasuk** bucket No Job. Definisi "exclude No Job" salah. |
| D2 | **`Flow_Efficiency` dilabeli `Productive / Total Minutes`**, tetapi kode menghitung `Productive_Min / Lead_Time_Min`. Di level operasi keduanya kebetulan sama (`Lead_Time_Min = RowCount`), tapi di level order `Lead_Time_Min` adalah wall-clock (`Order_Finish − Order_Start + 1`) sehingga **tidak** sama dengan total minutes. Label harus diperbaiki. |
| D3 | **Semantik `Lead_Time_Min` berubah antar grain.** Level operasi = jumlah time bucket (tidak termasuk queue). Level order = durasi wall-clock (termasuk queue antar-operasi). Konsekuensi: `Queue_Ratio` hanya bermakna di level order; di level operasi rasio queue/lead-time akan menyesatkan. |
| D4 | Istilah **Processing** vs **Productive** dipakai bergantian. Narasi memakai `Processing_Minutes`, kode memakai `Productive_Min`. Sebaiknya distandardisasi pada satu istilah. |
| D5 | Daftar KPI di bawah `UNIFY_5051_ORD_OPR_KPI` sebenarnya mendeskripsikan output `UNIFY_5051_FACT_ORD_OPR`. |
| D6 | `Max_Queue_Min` dideskripsikan "antrian tercepat" (seharusnya terlama) dan `Queue_Event_Count` dideskripsikan "antrian terlama" (seharusnya jumlah kejadian). |

### Risiko teknis

| # | Temuan |
|---|---|
| R1 | **`AddActualSeq` adalah dead code yang mahal.** Step berikutnya (`NextOrder`) mengambil dari `Buffered`, bukan dari `AddActualSeq`, sehingga kolom `Actual_Seq` tidak pernah sampai ke output. Padahal step ini melakukan `Table.SelectRows` di dalam `Table.AddColumn` → kompleksitas O(n²). Hapus jika memang tidak dipakai. |
| R2 | `Queue_Min_Raw` diberi tipe `Int64.Type` padahal `Duration.TotalMinutes` mengembalikan desimal. Berpotensi error/truncation sebelum `Number.Round` dijalankan. |
| R3 | Logika `Next_*` mengandalkan indeks global `[Idx]+1` pada tabel yang di-sort. Aman selama sort stabil, tetapi rapuh: jika ada perubahan urutan atau baris yang di-filter di hulu, queue akan salah kalkulasi tanpa error. Alternatif lebih aman: group per `order_number` lalu shift di dalam grup. |
| R4 | Operasi paralel (dua operasi order yang sama berjalan bersamaan) menghasilkan queue negatif yang di-clamp ke 0. Ini **menyembunyikan** overlap. `Queue_Anomaly_Count` sudah ada tetapi belum diekspos sebagai KPI monitoring — sebaiknya dijadikan gate kualitas data. |
| R5 | `Lead_Time_Min` di level operasi = jumlah bucket yang **ada di data**. Jika HMI mati / bucket hilang, lead time akan under-report tanpa terdeteksi. Perlu rekonsiliasi terhadap wall-clock (`Finish_Time − Start_Time`). |
| R6 | `IsPostCompletion` dan `IsActiveLifecycle` dihitung di `LT_TIMELINE` tetapi tidak pernah dikonsumsi oleh query hilir manapun dalam dokumen ini. |
| R7 | `UNIFY_5051_TB` dan `UNIFY_5051_MT_DTC` adalah dependensi eksternal yang tidak didefinisikan di dokumen ini — grain, filter, dan kolom `DateTime_Finish`, `STD_time`, `Portfolio`, `IsMultitask` diasumsikan sudah tersedia. |

---

## 8. Referensi Silang

- [[section-17-bottleneck-analysis]] — lanjutan analisis, memakai fact table yang sama (`UNIFY_5051_FACT_MACHINE_FLOW_DAY`, `UNIFY_5051_FACT_ORD_LT`).
