# Analisa Fitur EWS (Early Warning System)

> Dokumen analisa: bagaimana setiap angka di EWS dihitung, dari sumber data mentah
> sampai ke **Control Tower**, **KPI Detail**, **Issue Log**, dan **Action Queue**.
> Ditulis berdasarkan pembacaan kode (bukan asumsi). Referensi file dicantumkan di tiap bagian.

---

## 1. Peta Komponen & Aliran Data

```
                        ┌──────────────────────────────────────────────┐
  SUMBER (public.*)     │  timesheet_transaction, mch_transaction,     │
                        │  mch_productiondata, sap_timesheet_staging,  │
                        │  sow, mch_machine_ping_log                   │
                        └───────────────┬──────────────────────────────┘
                                        │
             ┌──────────────────────────┼─────────────────────────────┐
             │ (LISTEN ews_source_changed / interval 60s)             │ (interval 10 mnt)
             ▼                                                        ▼
   ewsSnapshotJob.js                                       ewsAdoptionBucketJob.js
   → calculateSystemSummary()                              → ews.adoption_bucket_snapshot
   → tulis ews.kpi_snapshot                                → ews.adoption_summary_snapshot
             │                                                        │
             │  (Adoption dibaca-balik dari cache adoption job) ◄─────┘
             ▼
   ews.kpi_snapshot  ──►  ewsRealtimeHub (SSE /api/ews/stream)  ──►  EwsControlTower.jsx (5 kartu KPI)
             │                                                        │  klik "Detail"
             │                                                        ▼
             └──► ewsController (/kpi/:type/detail) ──► buildKpiSourceDetail() ──► EwsDetailPage.jsx
                                                                                      │
                                        Issue Log ◄── /ews/actions ◄── ews.action_table ◄── /ews/actions/sync
```

File kunci:
- Kalkulasi KPI: [ewsCalculator.js](../../apps/api/services/ewsCalculator.js)
- Endpoint + detail per-KPI + action: [ewsController.js](../../apps/api/controllers/ewsController.js)
- Snapshot job: [ewsSnapshotJob.js](../../apps/api/jobs/ewsSnapshotJob.js)
- Adoption job: [ewsAdoptionBucketJob.js](../../apps/api/jobs/ewsAdoptionBucketJob.js)
- Realtime SSE: [ewsRealtimeHub.js](../../apps/api/services/ewsRealtimeHub.js)
- Kartu KPI (dashboard): [EwsControlTower.jsx](../../apps/web/src/components/ews/EwsControlTower.jsx)
- Halaman detail + issue log: [EwsDetailPage.jsx](../../apps/web/src/pages/EwsDetailPage.jsx)
- Route API: [ews.js](../../apps/api/routes/ews.js)

---

## 2. Window Waktu (basis perhitungan)

Semua KPI dihitung terhadap **rentang waktu (window)**. Ada 3 mode — lihat `resolveSummaryBounds()` ([ewsCalculator.js:877](../../apps/api/services/ewsCalculator.js#L877)):

| Basis | window_start | window_end | Dipakai untuk |
|-------|--------------|------------|---------------|
| `today` (default job) | `date_trunc('day', now())` | `now()` | Kartu Control Tower & default detail |
| `rolling` | `now() - interval` (5m/15m/30m/1h/4h/8h/24h) | `date_trunc('minute', now())` | Mode window pendek |
| `date` (manual) | `tanggal 00:00` | `tanggal +1 hari` | Debug/analisa historis, **read-only** (tidak ditulis ke snapshot) |

Mode `today` juga menghitung **previous window** (`kemarin` pada jam yang sama) untuk perbandingan tren (delta panah naik/turun).

---

## 3. Perhitungan 5 KPI

Ringkasan target & pemilik (`KPI_DEFS`, [ewsCalculator.js:3](../../apps/api/services/ewsCalculator.js#L3)):

| KPI | Target | Owner | Sumber utama |
|-----|--------|-------|--------------|
| Uptime | 99% | IT | `mch_machine_ping_log` |
| Accuracy | 98% | Foreman/Spv | `timesheet_transaction` + `sap_timesheet_staging` + `mch_productiondata`/`mch_transaction` |
| Adoption | 95% | Foreman/Spv | `mch_productiondata` (default) atau bucket `mch_transaction`↔`timesheet` |
| OEE | 80% | PPIC | `mch_transaction` |
| OLE | 85% | Spv | `timesheet_transaction` |

> ⚠️ **Catatan konsistensi target**: nilai target di beberapa tempat berbeda. Backend `KPI_DEFS` memakai Accuracy **98**, tetapi frontend `kpis` di [EwsControlTower.jsx:23](../../apps/web/src/components/ews/EwsControlTower.jsx#L23) dan `KPI_FALLBACK` di [ewsRealtimeHub.js:12](../../apps/api/services/ewsRealtimeHub.js#L12) memakai Accuracy **97**. Threshold status memakai `DEFAULT_THRESHOLDS` (accuracy critical <95). Perlu diselaraskan bila jadi acuan resmi.

### 3.1 Uptime — `calculateUptime()` ([:264](../../apps/api/services/ewsCalculator.js#L264))

```
Uptime% = SUM(success_count) / SUM(ping_count) × 100
```
- Sumber: `public.mch_machine_ping_log` (agregasi ping heartbeat mesin).
- Untuk basis `today`, window ping dihitung ulang khusus berdasarkan `checked_at` di timezone (`Asia/Makassar` default env).
- Detail menyimpan: `sample_count`, `failed_count`, `down_samples`, `avg_latency_ms`, `max_packet_loss_percent`.
- **Proteksi false-alert (di detail, bukan di KPI utama)**: sebuah mesin dianggap *down nyata* hanya jika `max_consecutive_fail ≥ 6` sampel berturut (± tiap sampel ~1 menit). Ping blip tunggal diabaikan. Aturan ini dihitung di `buildUptimeSourceDetail()` via window function ROW_NUMBER "islands & gaps" ([ewsController.js:264](../../apps/api/controllers/ewsController.js#L264)).

### 3.2 Accuracy — `calculateAccuracy()` ([:319](../../apps/api/services/ewsCalculator.js#L319))

```
Accuracy% = (timesheet_ready + machine_ready) / (timesheet_total + machine_total) × 100
```
Digabung dari 2 sumber pada window (berdasarkan `longdate_checkin` / `startdatetime`):

**A. Timesheet** (`timesheet_transaction`, kecuali `state_flag = 5`):
- `ready` = baris yang **sudah ada** di `sap_timesheet_staging` (`is_sap_staged`).
- `error` = `missing_order` OR `missing_operation` OR `sow_no_match`:
  - `missing_order` — activitytype kosong & order_no kosong.
  - `missing_operation` — activitytype kosong & operation_no NULL.
  - `sow_no_match` — punya order+operation tapi tidak ketemu di tabel `sow` (join `LTRIM(order_no,'0')` + `operation_no`).

**B. Mesin** (`mch_productiondata` LEFT JOIN `mch_transaction`):
- `ready` = baris `mch_productiondata` yang punya pasangan `mch_transaction` (`proddataid` tidak NULL).
- `missing_mch_transaction` = tidak punya pasangan.

- Flag `minimum_sample_met = total ≥ 50` — dipakai frontend untuk menandai alert "indikatif" bila sampel < 50 (proteksi false-alert).
- Detail per-error dibangun terpisah di `buildAccuracySourceDetail()` dengan klasifikasi 5 kategori: **Missing, Invalid, Inconsistent, Outlier, Duplicate** (+ menyertakan baris SAP staging berstatus FAILED/PENDING). Lihat [ewsController.js:374](../../apps/api/controllers/ewsController.js#L374).

### 3.3 Adoption — dua jalur perhitungan

Adoption **tidak** dihitung di snapshot utama secara default. `calculateAdoptionForMainSnapshot()` ([:784](../../apps/api/services/ewsCalculator.js#L784)) mengecek env `EWS_CALCULATE_ADOPTION_IN_MAIN`:
- Bila `≠ 1` (default) → **baca cache** dari `ews.adoption_summary_snapshot` (hasil adoption job).
- Bila `= 1` → hitung live via `calculateAdoption()`.

Sumber cache ditentukan `EWS_ADOPTION_SOURCE` (default **`machine`**):

**Jalur A — `machine` (default, `upsertMachineSummary`, [ewsAdoptionBucketJob.js:290](../../apps/api/jobs/ewsAdoptionBucketJob.js#L290))**
Berbasis **durasi** dari `mch_productiondata`:
```
gap_duration      = SUM(durasi) untuk statusid = 5  ATAU  (statusid = 2 DAN durasi > 300 detik)
total_duration    = SUM(durasi) semua baris valid pada window
Adoption% = (total_duration − gap_duration) / total_duration × 100
```
Artinya: adoption turun kalau banyak waktu mesin **Unidentified (status 5)** atau **idle status 2 yang panjang (>5 menit)** — indikasi operator tidak input.

**Jalur B — `all` (`calculateAdoption` / `upsertBuckets` + `upsertSummary`, [:434](../../apps/api/services/ewsCalculator.js#L434))**
Berbasis **bucket 5 menit**:
```
Adoption% = covered_bucket / expected_bucket × 100
```
- `expected_bucket` = bucket 5 menit dimana ada aktivitas mesin (`mch_transaction`, exclude *No Job* & *Off*, tapi status 5 tetap dihitung).
- `covered_bucket` = bucket yang punya timesheet cocok (via `serialnumber` operator ATAU `workcentercode` mesin) DAN tidak unidentified.
- `missing_bucket` = ada mesin, tidak ada timesheet.
- `unidentified_bucket` = statusid 5 / status "unidentified" → dihitung sebagai kategori gap, bukan dibuang dari denominator.

### 3.4 OEE — `calculateOee()` ([:559](../../apps/api/services/ewsCalculator.js#L559))

```
OEE% (proxy waktu) = running_hours / denominator_hours × 100
```
- Sumber: `mch_transaction` (durasi jam), window by `startdatetime`, hanya `duration_hours > 0`.
- `running_hours` (numerator) = SUM durasi dimana `status_activitytype ∈ (M1, M2)` ATAU `status_description = 'productive'`.
- `denominator_hours` = SUM durasi **kecuali**: `no job`, `off`, `preventive`, `breakdown`, `coffee break / lunch`, `daily pm`.
- Detail (`buildOeeSourceDetail`) memecah waktu ke bucket **VA / NNVA / NVA / NoJob / Missing** + membangun data **waterfall** dan **time-mix 100% per mesin** ([ewsController.js:617](../../apps/api/controllers/ewsController.js#L617)).

> ⚠️ Ini **bukan** OEE klasik (Availability × Performance × Quality). Kode sendiri menandai: *"EWS time-based OEE proxy"* ([:618](../../apps/api/services/ewsCalculator.js#L618)).

### 3.5 OLE — `calculateOle()` ([:623](../../apps/api/services/ewsCalculator.js#L623))

```
OLE% = working_hours / available_recorded_hours × 100
```
- Sumber: `timesheet_transaction` (kolom `duration`), window by `longdate_checkin`, exclude `state_flag = 5`.
- `working_hours` (numerator) = SUM durasi baris **produktif**: `activitytype IS NULL` DAN `order_no` terisi DAN `duration > 0`.
- `available_recorded_hours` (denominator) = SUM semua durasi tercatat (> 0).
- Detail (`buildOleSourceDetail`) mengelompokkan waktu ke bucket **Processing / Waiting / Idle / <activitytype>** per operator & per mesin, dan menghitung distribusi non-produktif per jenis aktivitas (join `ews.activity_type_ref` untuk label).

---

## 4. Penentuan Status (normal / watch / critical)

`statusForValue()` ([ewsCalculator.js:256](../../apps/api/services/ewsCalculator.js#L256)) memakai `DEFAULT_THRESHOLDS` (atau tabel `ews.kpi_threshold` bila ada):

| KPI | critical bila < | watch bila < | normal bila ≥ |
|-----|-----------------|--------------|---------------|
| Uptime | 98 | 99 | 99 |
| Accuracy | 95 | 98 | 98 |
| Adoption | 90 | 95 | 95 |
| OEE | 65 | 80 | 80 |
| OLE | 70 | 85 | 85 |

- Nilai `null` → `no_data`.
- Aturan: `value < critical_below → critical`; `value < normal_min → watch`; selain itu `normal`.

> Catatan: di halaman detail, **Uptime** memakai band sendiri (`uptimeStatusKey`, watch = target−2% sampai target) yang di-hardcode di frontend, terpisah dari threshold backend ([EwsDetailPage.jsx:124](../../apps/web/src/pages/EwsDetailPage.jsx#L124)).

### Overall Score & Status — `overall()` ([:702](../../apps/api/services/ewsCalculator.js#L702))
```
overall_score = rata-rata( min(value / target, 1) )  untuk KPI yang ada nilainya   → 0..1
overall_status = CRITICAL bila ada 1 KPI critical
               = WATCH    bila ada 1 KPI watch
               = NORMAL   selain itu
```

---

## 5. Top Issues (di Control Tower)

`buildIssues()` ([:675](../../apps/api/services/ewsCalculator.js#L675)) — dibangun langsung dari status KPI level sistem:
- Ambil KPI dengan status `critical` / `watch`.
- Urut: critical dulu, lalu nilai terkecil.
- Tiap issue: `{ machine: "SYSTEM", kpi, value, severity, action }`.
- `action` = teks saran statis per KPI dari `suggestedAction()` ([:691](../../apps/api/services/ewsCalculator.js#L691)).

Ini **berbeda** dari Issue Log di halaman detail (bagian 7) — Top Issues bersifat ringkas level-sistem, sedangkan Issue Log bersifat per-entitas (mesin/operator/kategori) dan persisten di database.

---

## 6. Snapshot, Cache & Realtime (SSE)

- **Snapshot job** ([ewsSnapshotJob.js](../../apps/api/jobs/ewsSnapshotJob.js)): dijalankan via `LISTEN ews_source_changed` (di-debounce 2.5s) + interval pengaman 60s. Memakai `pg_try_advisory_lock` supaya hanya satu instance jalan. Hasil `calculateSystemSummary()` disimpan ke `ews.kpi_snapshot` (upsert per `window_start/end, grain, scope`).
- **Adoption job** ([ewsAdoptionBucketJob.js](../../apps/api/jobs/ewsAdoptionBucketJob.js)): interval 10 menit, mengisi `adoption_bucket_snapshot` + `adoption_summary_snapshot` (dipakai balik oleh snapshot utama).
- **Realtime hub** ([ewsRealtimeHub.js](../../apps/api/services/ewsRealtimeHub.js)): frontend membuka `EventSource('/api/ews/stream?basis=today')`. Hub membaca snapshot terbaru dari DB (`getLatestSnapshotForQuery`), mem-*broadcast* event `snapshot`, dan mengirim heartbeat tiap 25s. Ada polling snapshot 15s + versi (`id` snapshot) supaya frontend hanya update bila versi lebih baru.
- **Freshness**: snapshot dianggap `STALE` bila umurnya > `max(interval×2, ...)` (default ±120 detik). Ditampilkan sebagai badge Live/Stale/Reconnecting di header Control Tower.
- **Cache endpoint**: `getSummary` & `getKpiDetailWithSource` punya cache in-memory TTL 60s; halaman detail frontend punya cache SWR 45s ([EwsDetailPage.jsx:46](../../apps/web/src/pages/EwsDetailPage.jsx#L46)).

---

## 7. KPI Detail → Issue Log → Action (rantai lengkap)

Ini bagian paling penting untuk pertanyaan "action berdasarkan apa".

### Langkah 1 — Ambil detail
`GET /api/ews/kpi/:type/detail` → `getKpiDetailWithSource` menggabungkan `kpi` (nilai + threshold + `detail`) dengan `source_detail` (agregasi per mesin/operator/kategori dari `buildKpiSourceDetail`). ([ewsController.js:1130](../../apps/api/controllers/ewsController.js#L1130))

### Langkah 2 — Bangun "Action Rows" dari agregasi (bukan baris mentah)
Di frontend, `buildActionRows()` ([EwsDetailPage.jsx:456](../../apps/web/src/pages/EwsDetailPage.jsx#L456)) mengubah `source_detail` menjadi baris tindakan per **entitas**. Tiap baris punya flag `isIssue` yang menentukan apakah layak dieskalasi:

| KPI | Baris per | `isIssue` = true bila | Severity |
|-----|-----------|------------------------|----------|
| Uptime | mesin | `max_consecutive_fail ≥ 6` (down nyata) | Critical bila ≥6, else Watch |
| Accuracy | kategori error | KPI status critical/watch **DAN** sampel ≥ 50 | ikut status KPI |
| Adoption | mesin | KPI status critical/watch (mesin punya `missing_minutes>0`) | ikut status KPI |
| OEE | mesin | status mesin (`oee_time_pct`) critical/watch | dari status mesin |
| OLE | operator | status operator (`ole_time_pct`) critical/watch | dari status operator |

Kolom yang dihasilkan: `area`, `metric`, `detail`, `errorType`, `action` (teks saran), `pic` (owner), `severity`. Teks `action` & `pic` berasal dari `KPI_CONFIG` + logika per-kategori (mis. error "Missing" → "Lengkapi field kosong…").

### Langkah 3 — Sync ke database (idempotent)
`buildIssuePayloads()` ([:471](../../apps/web/src/pages/EwsDetailPage.jsx#L471)) mengambil hanya baris `isIssue`, lalu membangun `issue_key` **stabil**:
```
issue_key = `${kpi.key}:${businessDate}:${scope}:${entity}`
```
`issue_key` **tidak** memakai timestamp per-menit → re-sync meng-UPDATE baris sama, bukan membuat baris baru (mencegah spam log). Dikirim ke `POST /api/ews/actions/sync`.

Server (`syncActions`, [ewsController.js:943](../../apps/api/controllers/ewsController.js#L943)) meng-UPSERT ke `ews.action_table` `ON CONFLICT (issue_key)`. Yang di-update: deskripsi, severity, pic, action_taken, detail_json — dan `last_updated` **kecuali** bila status sudah `Closed` (issue yang sudah ditutup tidak "hidup lagi").

### Langkah 4 — Tampilkan Issue Log
`GET /api/ews/actions?status=all&kpi_type=…` → `getActions` mengembalikan baris dari `ews.action_table` + menghitung `escalation_level` di SQL berdasarkan umur & severity ([ewsController.js:212](../../apps/api/controllers/ewsController.js#L212)):
```
Closed                                        → 'Closed'
Critical & action_date < now()-3 jam          → 'Plant Manager'
Critical & action_date < now()-1 jam          → 'Supervisor/Foreman'
selain itu                                    → 'PIC Monitor'
```
Frontend `buildIssueRows()` merender tabel Issue Log (kolom Issue, Owner+eskalasi, Sev, Status, Resolve).

### Langkah 5 — Resolve
Tombol resolve → `PUT /api/ews/actions/:id/resolve` (`resolveAction`, [:1033](../../apps/api/controllers/ewsController.js#L1033)):
- Set `action_status='Closed'`, `solved_date=now()`, `escalation_level='Closed'`.
- Tulis jejak ke `ews.action_history` (old→new status).

### Ringkas: "Action berdasarkan apa?"
1. **Nilai KPI vs threshold** menentukan status (critical/watch) → memicu issue.
2. **Agregasi `source_detail` per entitas** (mesin/operator/kategori error) menentukan **baris mana** yang jadi action, plus aturan proteksi (uptime ≥6 berturut, accuracy sampel ≥50).
3. **Teks action & PIC** berasal dari `KPI_CONFIG` + logika kategori (statis, bukan dihitung).
4. **Eskalasi** dihitung dari **umur** issue (`action_date`) × severity.
5. Semua issue persisten di `ews.action_table`, dedup lewat `issue_key` yang stabil.

---

## 8. Trend 7 Hari (sparkline)

`GET /api/ews/trend?days=7` → `getTrend` ([ewsController.js:114](../../apps/api/controllers/ewsController.js#L114)):
- Ambil snapshot **terakhir per hari bisnis** (`DISTINCT ON ((window_end AT TIME ZONE 'Asia/Jakarta')::date)`) dari `ews.kpi_snapshot`.
- Kembalikan array nilai per KPI → dirender jadi mini sparkline di tiap kartu Control Tower (warna mengikuti status).

---

## 9. Temuan / Catatan untuk Diperhatikan

1. **Target tidak konsisten** antara backend (`KPI_DEFS`), fallback SSE, dan konstanta frontend (Accuracy 98 vs 97). Sebaiknya satu sumber kebenaran (idealnya tabel `ews.kpi_threshold`).
2. **Timezone default berbeda**: banyak query fallback ke `Asia/Makassar` (`process.env.TIMEZONE || "Asia/Makassar"`), padahal standar project `Asia/Jakarta`. Aman selama env `TIMEZONE` terisi, tapi default kode berisiko bila env kosong.
3. **Adoption produksi memakai jalur `machine`** (durasi `mch_productiondata`, gap = status 5 / status 2 >5mnt), **bukan** jalur bucket 5-menit yang ada di `calculateAdoption()`. Dua definisi hidup berdampingan — pastikan yang mana yang jadi acuan resmi.
4. **OEE adalah proxy waktu**, bukan OEE klasik. Perlu disampaikan ke user bisnis agar tidak dibandingkan 1:1 dengan OEE standar.
5. **Uptime**: status di kartu (threshold backend) dan status di halaman detail (band hardcode `uptimeStatusKey`) dihitung dengan aturan berbeda — bisa terlihat tidak sinkron di kasus batas.
6. **Issue log hanya "sync" saat halaman detail dibuka** (`loadIssueLog` dipicu oleh load detail). Bila tidak ada yang membuka halaman detail suatu KPI, `action_table` untuk KPI itu tidak diperbarui dari UI. `correction_queue` di kartu Control Tower dibaca terpisah dari `/ews/actions?status=Open`.

---

*Dokumen ini murni hasil analisa kode; tidak ada perubahan kode yang dilakukan.*
