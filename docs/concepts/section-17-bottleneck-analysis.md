---
title: "Section 17 — Bottleneck Analysis (Machine & Order Flow)"
section: 17
domain: manufacturing-analytics
subdomain: [bottleneck, queue, flow-efficiency, internal-delay, external-delay]
system: UNIFY_5051
platform: [Power BI (DAX)]
source_file: Section_17_Bottleneck_Analysis.docx
status: converted-from-docx
language: id-ID (mixed technical English)
depends_on:
  - "[[section-16-lead-time-analysis]]"
fact_tables:
  - UNIFY_5051_FACT_MACHINE_FLOW_DAY
  - UNIFY_5051_FACT_ORD_LT
---

# Section 17 — Bottleneck Analysis: Machine and Order Flow

> **Prasyarat:** section ini adalah lanjutan dari [[section-16-lead-time-analysis]] dan memakai **sumber data yang sama** (`UNIFY_5051_FACT_MACHINE_FLOW_DAY` dan `UNIFY_5051_FACT_ORD_LT`). Tidak ada pipeline ETL baru di section ini — hanya measure dan dashboard.

## 1. Komponen Lead Time

Analisis dimulai dengan membedah tiga komponen utama penyusun lead time:

```
Lead Time = Processing Time + Queue Time + Waiting Time
```

Bottleneck dianalisis dari dua perspektif yang saling melengkapi: **Machine Flow** (sisi resource) dan **Order Flow** (sisi order/customer).

---

## 2. Machine Flow Perspective

**Fokus:** perilaku *resource* / mesin dalam sistem produksi.

**Tujuan — mengidentifikasi:**
- mesin yang menghasilkan antrean terbesar
- mesin yang paling sering menjadi titik antrean
- mesin yang mengalami idle atau waiting berlebihan
- mesin yang berpotensi menjadi **physical bottleneck**

**KPI yang digunakan:**

| KPI | Makna |
|---|---|
| Productive Ratio | `productive minutes / total minutes` — efisiensi flow |
| Waiting Ratio | intensitas order menunggu di atas mesin (internal delay) |
| Queue Intensity | seberapa **sering** antrian terjadi di mesin tersebut |
| Queue Per Confirmation | seberapa **lama** antrian terjadi (rata-rata per job) |
| Queue Minute | total menit antrian |

---

## 3. Order Flow Perspective

**Fokus:** pengalaman *order* selama mengalir di dalam sistem produksi.

**Tujuan — mengidentifikasi:**
- order yang mengalami lead time berlebih
- besarnya kontribusi antrean terhadap lead time
- efektivitas aliran proses dari sudut pandang order
- order yang menjadi korban bottleneck (**bottleneck victim**)

**KPI yang digunakan:**

| KPI | Makna |
|---|---|
| Flow Efficiency | proporsi waktu produktif terhadap lead time |
| Queue Ratio | proporsi lead time yang habis untuk mengantri |
| Queue Exposure | rasio queue terhadap waktu proses |
| Waiting Ratio | proporsi internal delay |
| Lead Time | total waktu order di dalam sistem |

---

## 4. Internal Delay vs External Delay

Analisis membedakan dua sumber utama kehilangan waktu produksi. Pembedaan ini menentukan **siapa yang harus bertindak** — pemilik proses vs pemilik scheduling/kapasitas.

### Internal Delay
Kehilangan waktu yang berasal **dari dalam proses itu sendiri**.

**Dicerminkan oleh:** Waiting Time · Flow Efficiency · Process Loss

**Biasanya berkaitan dengan:**
- setup
- rework
- material waiting
- operator delay
- proses yang tidak efisien

### External Delay
Kehilangan waktu yang disebabkan oleh **antrean sebelum** suatu aktivitas dapat diproses.

**Dicerminkan oleh:** Queue Time · Queue Ratio · Queue Exposure · Queue Intensity

**Biasanya berkaitan dengan:**
- kapasitas resource
- scheduling
- dispatching
- unbalanced workload
- bottleneck machine / bottleneck operation

### Matriks diagnostik

| | Internal Delay tinggi | External Delay tinggi |
|---|---|---|
| **Sinyal** | Waiting Ratio ↑, Flow Efficiency ↓ | Queue Ratio ↑, Queue Intensity ↑ |
| **Akar masalah** | eksekusi proses di mesin | kapasitas & penjadwalan |
| **Pemilik aksi** | production / maintenance | PPIC / scheduling |

---

## 5. Tujuan Analisis

Meskipun dianalisis dari perspektif berbeda, Machine Flow dan Order Flow memiliki tujuan yang sama:

> **Mengidentifikasi dan menghilangkan bottleneck yang menghambat kelancaran aliran produksi (production flow), sehingga lead time dapat dipersingkat dan throughput dapat ditingkatkan.**

---

## 6. Dashboard

### 6.1 Machine Bottleneck
<!-- IMAGE: dashboard machine bottleneck (image1.png) — tidak diekstrak -->

### 6.2 Operation Bottleneck
<!-- IMAGE: dashboard operation bottleneck (image2.png) — tidak diekstrak -->

---

## 7. Power BI DAX Measures

### 7.1 Machine Bottleneck
Tabel: `UNIFY_5051_FACT_MACHINE_FLOW_DAY`

```dax
-- Queue Time (Minutes): total waktu antrian
LT_Machine_Queue Minute =
SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Queue_Min] )

-- Queue Per Confirmation (Operation): rata-rata waktu antrian per job
LT_Machine_QueuePerConf =
DIVIDE(
    SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Queue_Min] ),
    SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Conf_Count] )
)

-- Queue Intensity: seberapa sering antrian terjadi
LT_Machine_Queue Intensity =
DIVIDE(
    SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Queue_Event_Count] ),
    SUM( UNIFY_5051_FACT_MACHINE_FLOW_DAY[Conf_Count] )
)

-- Productive Ratio: seberapa efisien proses
-- ⚠️ [LT_Machine_NoJobMinute] — di §16 measure ini bernama [LT_Machine_No Job Minute]
LT_MachineProductive Ratio =
DIVIDE(
    [LT_Machine_Productive Minute],
    [LT_Machine_WaitingMinute] + [LT_Machine_Productive Minute] + [LT_Machine_NoJobMinute]
)

-- Waiting Ratio: internal delay
LT_MachineWaitingRatio =
DIVIDE(
    [LT_Machine_WaitingMinute],
    [LT_Machine_WaitingMinute] + [LT_Machine_Productive Minute] + [LT_Machine_NoJobMinute]
)
```

### 7.2 Operation Bottleneck
Tabel: `UNIFY_5051_FACT_ORD_LT`

```dax
-- Total Order Queue Minute
LT_ORD_TotalQueueTime (Min) =
SUM( UNIFY_5051_FACT_ORD_LT[Queue_Min] )

-- Average Queue Time
-- ⚠️ [LT_ORD_Count] tidak terdefinisi di dokumen manapun
LT_ORD_AvgQueueTime (Min) =
DIVIDE( [LT_ORD_TotalQueueTime (Min)], [LT_ORD_Count] )

-- Order Queue Ratio: persentase lead time yang habis untuk mengantri
LT_ORD_Queue Ratio =
DIVIDE(
    SUM( UNIFY_5051_FACT_ORD_LT[Queue_Min] ),
    SUM( UNIFY_5051_FACT_ORD_LT[Lead_Time_Min] )
)

-- Order Queue Exposure
-- ⚠️ [LT_ORD_TotalProcessingTime (Min)] tidak terdefinisi; kandidat: [LT_ORD_TotalProductiveTime (Min)]
LT_ORD_QueueExposure =
DIVIDE( [LT_ORD_TotalQueueTime (Min)], [LT_ORD_TotalProcessingTime (Min)] )
```

---

## 8. Catatan Verifikasi (temuan inkonsistensi)

> Bagian ini **bukan** bagian dari dokumen asli. Hasil pembacaan silang dengan [[section-16-lead-time-analysis]].

### Blocker

| # | Temuan | Dampak |
|---|---|---|
| B1 | `LT_ORD_QueueExposure` memanggil `[LT_ORD_TotalProcessingTime (Min)]` yang tidak pernah didefinisikan. Measure yang ada di §16 bernama `LT_ORD_TotalProductiveTime (Min)`. | Measure blank/error. Sama dengan bug pada `LT_ORD_FlowEfficiency` di §16. |
| B2 | `LT_ORD_AvgQueueTime (Min)` memanggil `[LT_ORD_Count]` yang tidak didefinisikan di §16 maupun §17. | Measure blank/error. Kandidat pengganti: `DISTINCTCOUNT(UNIFY_5051_FACT_ORD_LT[order_number])`. |
| B3 | `LT_MachineProductive Ratio` dan `LT_MachineWaitingRatio` di section ini memanggil `[LT_Machine_NoJobMinute]`, sedangkan §16 mendefinisikan `[LT_Machine_No Job Minute]` (dengan spasi). | Salah satu versi pasti broken. Perlu ditetapkan satu nama kanonik. |

### Inkonsistensi definisi

| # | Temuan |
|---|---|
| D1 | **Definisi Waiting Ratio berbeda antara narasi dan DAX.** Narasi §2 menyatakan "intensitas order menunggu di atas mesin", implementasi DAX adalah `Waiting / (Waiting + Productive + NoJob)` — yaitu proporsi waktu, bukan intensitas. Istilah "intensitas" sudah dipakai untuk `Queue Intensity`, jadi ini membingungkan. |
| D2 | **`Productive Ratio` didefinisikan sebagai `productive / total minutes`**, tetapi DAX memakai penyebut `Waiting + Productive + NoJob`. Ini hanya identik jika `Total_Min` benar-benar sama dengan ketiganya — sesuatu yang belum diverifikasi (lihat temuan D1 di §16 tentang ambiguitas `Total_Min`). |
| D3 | **`Queue Exposure` tidak diberi definisi naratif** di section ini, hanya muncul sebagai daftar KPI dan sebagai DAX yang broken. Interpretasi dari formulanya: `Queue_Min / Productive_Min` — berapa menit antri per menit kerja. Perlu dikonfirmasi. |
| D4 | Judul dashboard §6.2 adalah "Operation Bottleneck", tetapi measure di §7.2 semuanya bergrain **order** (`UNIFY_5051_FACT_ORD_LT`), bukan operation (`UNIFY_5051_FACT_ORD_OPR`). Penamaan menyesatkan. |

### Gap metodologis

| # | Temuan |
|---|---|
| G1 | Dokumen menyatakan tujuannya "mengidentifikasi dan menghilangkan bottleneck", tetapi **tidak mendefinisikan threshold atau aturan keputusan** untuk menetapkan sebuah mesin sebagai bottleneck. Semua KPI bersifat ranking relatif (Top 10). Tanpa threshold, output analisis tidak bisa dijadikan trigger tindakan. |
| G2 | Tidak ada pembedaan antara **bottleneck struktural** (mesin selalu jadi antrean) dan **bottleneck temporer** (akibat lonjakan beban). Keduanya butuh respons berbeda: investasi kapasitas vs re-scheduling. Data `Date × Machineid` sudah mendukung pembedaan ini — tinggal ditambahkan metrik persistensi (mis. jumlah hari mesin masuk Top-3 queue dalam periode). |
| G3 | Konsep **bottleneck victim** disebut di §3 tetapi tidak ada KPI atau measure yang mengoperasionalkannya. Perlu penghubung eksplisit order ↔ mesin penyebab antrian (data untuk itu ada di `UNIFY_5051_FACT_ORD_OPR`, kolom `Queue_Min` per `Machineid`). |
| G4 | `Queue_Anomaly_Count` (queue negatif akibat operasi paralel, lihat §16 R4) tidak diperhitungkan sama sekali di analisis bottleneck. Mesin dengan banyak overlap akan tampak "sehat" karena queue negatifnya di-clamp ke 0. |

---

## 9. Referensi Silang

- [[section-16-lead-time-analysis]] — definisi lead time, pipeline ETL, kamus kolom fact table, dan measure dasar yang direferensikan section ini.
