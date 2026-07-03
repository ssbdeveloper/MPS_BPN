# EWS Dashboard Data Strategy

Status: Planning  
Tanggal analisis: 2026-06-29  
Scope: `EwsControlTower.jsx` dan kebutuhan 5 KPI di `docs/timesheet/EARLY_WARNING_SYSTEM_PLAN.md`

## Ringkasan Keputusan

Dashboard EWS bisa dibangun mayoritas dari tabel yang sudah ada. Tidak perlu membuat ulang raw table seperti `event_data_hmi`, `fact_machinehours`, `dim_machine`, `dim_operator`, atau `dim_shift` karena padanannya di database aktif sudah ada dengan nama berbeda.

Tabel baru tetap diperlukan, tetapi hanya untuk layer EWS:

- `ews.kpi_snapshot`: hasil kalkulasi KPI per window agar dashboard tidak menghitung tabel besar setiap request.
- `ews.alert_log`: riwayat alert yang benar-benar muncul.
- `ews.action_table`: correction queue / PIC / status.
- `ews.action_history`: audit perubahan action.
- Opsional `ews.kpi_threshold`: konfigurasi threshold supaya tidak hardcode di API.

Tidak perlu membuat `ews.connectivity_log` karena sudah ada `public.mch_machine_ping_log`.
Tidak perlu membuat `ews.data_validation_log` pada tahap awal; accuracy bisa dihitung langsung dari `timesheet_transaction`, `sap_timesheet_staging`, dan `log_timesheet_sap`. Tabel validation log bisa ditambahkan fase 2 jika butuh audit error per field yang lebih detail.

## Temuan Database Aktual

Tabel yang disebut di dokumen EWS awal tidak ditemukan di DB aktif:

- `event_data_hmi`
- `hmi_event_with_duration`
- `fact_machinehours`
- `dim_machine`
- `dim_operator`
- `dim_shift`

Padanan yang tersedia dan relevan:

| Kebutuhan | Tabel/view aktual | Row saat analisis | Catatan |
|---|---:|---:|---|
| HMI/machine production event | `public.mch_productiondata` | 472,214 | Raw machine events dari SQL Server |
| Machine event enriched | `public.mch_transaction` | 461,199 | Sudah join machine, status, order, operator, timesheet |
| Uptime ping | `public.mch_machine_ping_log` | 12,564 | Sudah ada status `OK` / `DOWN`, latency, packet loss |
| Machine master | `public.mch_machines` | 79 | Machine, IP, group, model |
| Machine status master | `public.mch_statustypes` | 22 | Status Productive, Idle, Downtime, No Job, M2, dll |
| Operator master machine | `public.mch_user` | 60 | Operator ID ke nama/SN |
| Operator/user timesheet | `public.usernfc` | 226 | User NFC, workcenter, machine |
| Timesheet actual | `public.timesheet_transaction` | 109,653 | Operator checkin/checkout, duration, validation |
| Shift master | `public.shift_definition` | 4 | Shift code, time window, capacity |
| SOW operation plan | `public.sow` | 78,743 | Planhours, progress, workcenter, order operation |
| SOW scheduling | `public.sow_schedule` | 34 | Masih kecil, tapi paling tepat untuk planned vs actual |
| SAP staging | `public.sap_timesheet_staging` | 149,349 | Status PENDING/POSTED/FAILED, payload/response |
| SAP post log legacy | `public.log_timesheet_sap` | 182 | Response SAP historis |
| Timesheet performance view | `public.vw_timesheet_std_performance` | view | Alokasi actual vs SOW planhours |
| Plan vs actual schedule | `public.vw_sow_plan_vs_actual_hours` | view | Planned hours vs actual hours per schedule |

Rentang data utama:

| Tabel | Min timestamp | Max timestamp |
|---|---|---|
| `timesheet_transaction` | 2026-01-31 | 2026-06-29 |
| `mch_productiondata` | 2025-11-29 | 2026-06-29 |
| `mch_transaction` | 2026-01-01 | 2026-06-29 |
| `mch_machine_ping_log` | 2026-06-27 | 2026-06-29 |
| `sap_timesheet_staging` | 2026-06-14 | 2026-06-15 |

## Mapping KPI ke Data Source

### 1. Uptime

Target: `>= 99%`

Gunakan:

- Primary: `public.mch_machine_ping_log`
- Master: `public.mch_machines`

Formula awal:

```sql
uptime_pct = SUM(success_count) / NULLIF(SUM(ping_count), 0) * 100
```

Breakdown:

- Machine/IP: `machineid`, `machinename`, `ipaddress`
- Latency: `avg_latency_ms`, `max_latency_ms`
- Packet loss: `packet_loss_percent`
- Status: `OK`, `DOWN`

False alert protection:

- Alert critical hanya jika `DOWN` beruntun minimal 6 sample atau packet loss tinggi selama >= 1 menit.
- Jangan hanya pakai satu row `DOWN`, karena ping log per IP bisa transient.

Tabel baru:

- Tidak perlu `ews.connectivity_log`.
- Tambahkan `ews.alert_log` untuk mencatat alert uptime yang sudah melewati false-alert rule.

Catatan:

- Ping log baru tersedia sejak 2026-06-27, jadi trend jangka panjang belum kuat.
- Script existing: `scripts/ping_m5051_machines.js`.

### 2. Accuracy

Target: `>= 97%`

Gunakan:

- Primary: `public.timesheet_transaction`
- SAP validation: `public.sap_timesheet_staging`
- Legacy SAP response: `public.log_timesheet_sap`
- Plan reference: `public.sow`

Formula tahap 1:

```text
accuracy_pct = 1 - (error_record / total_record)
```

Definisi `error_record` tahap 1:

- Timesheet wajib tapi kosong:
  - `order_no` null untuk productive row.
  - `operation_no` null untuk productive row.
  - `longdate_checkin` null.
  - `longdate_checkout` null untuk row lama yang seharusnya sudah closed.
  - `duration` null atau negatif.
- Data tidak konsisten:
  - `duration` beda jauh dari selisih checkout-checkin.
  - `order_no` + `operation_no` tidak match ke `sow`.
  - `planhours` null padahal operation produktif.
- SAP error:
  - `sap_timesheet_staging.status = 'FAILED'`
  - `sap_response_text` atau `sap_error` berisi error.

Breakdown:

- Error type.
- Workcenter/machine.
- Operator `serialnumber` / `full_name`.
- Shift window dari `shift_definition`.

Tabel baru:

- Tahap 1 tidak perlu `ews.data_validation_log`.
- Jika butuh audit per field dan root cause historis, tambah `ews.data_validation_log` di fase 2.

Catatan penting:

- `sap_timesheet_staging` saat analisis mayoritas `PENDING` (149,341), jadi jangan menghitung semua pending sebagai error. Pending harus dipisah menjadi "posting backlog".
- Minimum sample rule: jika total record per window < 50, jangan trigger alert KPI.

### 3. Adoption

Target: `>= 95%`

Gunakan:

- Primary: `public.timesheet_transaction`
- Cross-check machine events: `public.mch_transaction`
- Shift target: `public.shift_definition`
- Operator/machine assignment: `public.usernfc`, `public.mch_user`

Formula tahap 1:

```text
adoption_pct = recorded_time / expected_time * 100
```

Alternatif per machine:

```text
adoption_pct = machine_event_time_with_matching_timesheet / machine_event_time_excluding_no_job * 100
```

Definisi yang disarankan:

- `recorded_time`: sum `timesheet_transaction.duration` atau checkout-checkin.
- `expected_time`: dari `mch_transaction.duration_hours` untuk status selain `No Job` / `Off`, atau dari shift capacity bila schedule sudah matang.
- Exclude `mch_statustypes.description = 'No Job'` sesuai dokumen.
- Productive adoption bisa dicari dari machine events yang punya `tsnumber` di `mch_transaction`.

Breakdown:

- Workcenter.
- Machine.
- Operator.
- Shift.
- Time slot kosong.

Tabel baru:

- Tidak perlu raw table baru.
- Snapshot hasil kalkulasi masuk `ews.kpi_snapshot`.

Risiko:

- `sow_schedule` masih 34 rows, jadi expected time berbasis schedule belum cukup. Untuk awal, gunakan machine event time dari `mch_transaction`; setelah scheduling dipakai konsisten, pindahkan denominator ke `sow_schedule` / `vw_sow_plan_vs_actual_hours`.

### 4. OEE

Target: `>= 80%`

Gunakan:

- Primary: `public.mch_transaction`
- Status master: `public.mch_statustypes`
- Machine master: `public.mch_machines`

Formula sesuai dokumen yang sederhana:

```text
oee_pct = running_time / denominator_time * 100
```

Mapping status:

- Running/Productive numerator: `status_activitytype IN ('M1', 'M2')` atau `status_description = 'Productive'`.
- VA detail bucket: `status_activitytype = 'M1'` atau `status_description = 'Productive'`.
- NNVA detail bucket: `status_activitytype = 'M2'`. M2 ikut numerator EWS OEE, tetapi tetap ditampilkan sebagai NNVA pada detail.
- Missing detail bucket: `statusid = 5`.
- NoJob detail bucket: `statusid = 4` atau `status_description IN ('No Job', 'Off')`.
- NVA detail bucket: machine time selain VA/NNVA/Missing/NoJob.

Rekomendasi denominator tahap 1:

```text
denominator_time = duration_hours > 0
  excluding No Job, Off, Preventive, Breakdown, Coffee Break / Lunch, Daily PM

running_time = M1 + M2 + Productive
```

Breakdown:

- Waterfall: Total Time -> Missing (`statusid = 5`, red) -> NNVA (`M2`) -> NoJob (`statusid = 4`) -> NVA -> VA.
- 100% stacked bar per machine: VA, NNVA, NVA, NoJob.
- By machine OEE: `(VA + NNVA) / denominator_time * 100`.
- Workcenter/order/operation jika tersedia.

Catatan akurasi istilah:

- Ini adalah **EWS time-based OEE proxy**, bukan OEE klasik `Availability x Performance x Quality`.
- `Breakdown` dikeluarkan dari denominator sesuai definisi EWS saat ini. Jika bisnis ingin breakdown menurunkan OEE sebagai unplanned loss, hapus `breakdown` dari daftar exclude.

Tabel baru:

- Tidak perlu raw table baru.
- Perlu `ews.kpi_snapshot` untuk aggregate per 5/15/60 menit.

Risiko:

- Jika `No Job` sangat besar, denominator harus eksplisit. Data 7 hari terakhir menunjukkan `No Job` dominan; jangan campur ke OEE utama karena akan menurunkan KPI secara tidak adil.
- Stop < 1 menit harus dianggap micro disturbance, bukan downtime alert besar.

### 5. OLE

Target: `>= 85%`

Gunakan:

- Primary: `public.timesheet_transaction`
- Machine/user cross-check: `public.mch_transaction`, `public.mch_user`, `public.usernfc`
- Performance helper: `public.vw_timesheet_std_performance`
- Shift: `public.shift_definition`

Formula tahap 1:

```text
ole_pct = working_time / available_operator_time * 100
```

Working time:

- Productive row: `timesheet_transaction.activitytype IS NULL` and `order_no IS NOT NULL`.
- Bisa juga gunakan `vw_timesheet_std_performance.std_performance_hours` untuk membatasi productive credit sampai planhours SOW.

Available operator time:

- Dari shift capacity per operator bila assignment jelas.
- Untuk tahap awal, gunakan total recorded time excluding allowed break/no job, karena assignment shift formal belum terlihat lengkap.

Breakdown:

- Operator.
- Workcenter.
- Activity type.
- Productive vs unproductive.
- Shift.

Tabel baru:

- Tidak perlu raw table baru.
- Snapshot aggregate masuk `ews.kpi_snapshot`.

Risiko:

- OLE butuh definisi bisnis yang paling sensitif. Jika denominator memakai total recorded time, KPI akan terlihat "baik" walaupun operator tidak login. Untuk EWS, kombinasikan dengan Adoption agar gap login tetap kelihatan.

## Tabel Baru yang Direkomendasikan

### 1. `ews.kpi_snapshot`

Tujuan: menyimpan hasil kalkulasi per window agar dashboard tidak scan `mch_transaction` dan `timesheet_transaction` setiap refresh.

```sql
CREATE SCHEMA IF NOT EXISTS ews;

CREATE TABLE ews.kpi_snapshot (
  id bigserial PRIMARY KEY,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  grain text NOT NULL DEFAULT '15m',
  scope_type text NOT NULL DEFAULT 'system',
  scope_key text NOT NULL DEFAULT 'ALL',
  shift_id bigint,
  uptime_pct numeric(10,4),
  accuracy_pct numeric(10,4),
  adoption_pct numeric(10,4),
  oee_pct numeric(10,4),
  ole_pct numeric(10,4),
  overall_score numeric(10,4),
  overall_status text NOT NULL,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (window_start, window_end, grain, scope_type, scope_key, shift_id)
);

CREATE INDEX idx_ews_kpi_snapshot_latest
  ON ews.kpi_snapshot (grain, scope_type, scope_key, window_end DESC);

CREATE INDEX idx_ews_kpi_snapshot_status
  ON ews.kpi_snapshot (overall_status, window_end DESC);
```

Scope examples:

- `system / ALL`
- `machine / M5051WLS`
- `workcenter / M5051WLS`
- `operator / 12345`
- `shift / 1`

### 2. `ews.alert_log`

Tujuan: unified alert stream untuk Top Issues dan Alert Monitor.

```sql
CREATE TABLE ews.alert_log (
  id bigserial PRIMARY KEY,
  alert_timestamp timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz,
  window_end timestamptz,
  scope_type text NOT NULL,
  scope_key text NOT NULL,
  machine_id text,
  operator_id text,
  kpi_type text NOT NULL,
  kpi_value numeric(10,4),
  threshold_value numeric(10,4),
  severity text NOT NULL,
  alert_status text NOT NULL DEFAULT 'OPEN',
  alert_message text NOT NULL,
  suggested_action text,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX idx_ews_alert_open
  ON ews.alert_log (alert_status, severity, alert_timestamp DESC);

CREATE INDEX idx_ews_alert_scope
  ON ews.alert_log (scope_type, scope_key, kpi_type, alert_timestamp DESC);
```

### 3. `ews.action_table`

Tujuan: Correction Queue di mockup.

```sql
CREATE TABLE ews.action_table (
  action_id bigserial PRIMARY KEY,
  alert_id bigint REFERENCES ews.alert_log(id),
  kpi_type text NOT NULL,
  scope_type text NOT NULL,
  scope_key text NOT NULL,
  machine_id text,
  status_reason text,
  action_taken text,
  pic text NOT NULL,
  action_status text NOT NULL DEFAULT 'Open',
  due_at timestamptz,
  action_date timestamptz NOT NULL DEFAULT now(),
  last_updated timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE INDEX idx_ews_action_status
  ON ews.action_table (action_status, due_at, last_updated DESC);
```

### 4. `ews.action_history`

```sql
CREATE TABLE ews.action_history (
  id bigserial PRIMARY KEY,
  action_id bigint REFERENCES ews.action_table(action_id),
  old_status text,
  new_status text,
  changed_by text,
  notes text,
  change_timestamp timestamptz NOT NULL DEFAULT now()
);
```

### 5. `ews.kpi_threshold` (opsional tapi disarankan)

```sql
CREATE TABLE ews.kpi_threshold (
  kpi_type text PRIMARY KEY,
  normal_min numeric(10,4),
  warning_min numeric(10,4),
  critical_below numeric(10,4),
  owner text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Default:

| KPI | Normal | Warning | Critical |
|---|---:|---:|---:|
| Uptime | >= 98 | 95-98 | < 95 |
| Accuracy | >= 97 | 95-97 | < 95 |
| Adoption | >= 95 | 90-95 | < 90 |
| OEE | >= 65 | 50-65 | < 50 |
| OLE | >= 85 | 70-85 | < 70 |

## API Strategy

Tambahkan:

- `apps/api/routes/ews.js`
- `apps/api/controllers/ewsController.js`
- `apps/api/services/ewsCalculator.js`

Endpoint tahap 1 untuk `EwsControlTower.jsx`:

| Endpoint | Fungsi |
|---|---|
| `GET /api/ews/summary?window=15m` | 5 KPI, status, score, timestamp |
| `GET /api/ews/issues?window=15m&limit=5` | Top Issues untuk card bawah |
| `GET /api/ews/actions?status=Open` | Correction Queue |
| `GET /api/ews/kpi/:type/detail` | Drilldown per KPI |

Frontend mockup `EwsControlTower.jsx` cukup diubah dari static array menjadi data dari `/api/ews/summary`.

Response shape yang cocok:

```json
{
  "overall_status": "NORMAL",
  "overall_score": 0.85,
  "window_start": "2026-06-29T23:15:00+08:00",
  "window_end": "2026-06-29T23:30:00+08:00",
  "kpis": [
    {
      "key": "uptime",
      "label": "Uptime",
      "value": 99.2,
      "target": 99,
      "owner": "IT",
      "status": "normal",
      "helper": "HMI heartbeat stable",
      "trend": [99.3, 99.1, 99.2]
    }
  ],
  "issues": [],
  "correction_queue": {
    "open_actions": 3,
    "critical_aging": 0,
    "next_escalation_minutes": 15
  }
}
```

## Calculation Job Strategy

Jangan hitung semua KPI langsung di request dashboard.

Gunakan job periodik:

- Every 1 minute:
  - hitung `system / ALL` untuk window terakhir 15 menit.
  - update `ews.kpi_snapshot`.
  - generate/close alert di `ews.alert_log`.
- Every 5 minutes:
  - hitung per machine/workcenter.
- Every 15 minutes:
  - hitung per operator/shift.

File yang cocok:

- `jobs/ews/calc_ews_snapshot.js`
- atau service Node internal bila ingin dijalankan bersama API.

Untuk database besar, lebih aman job terpisah agar request API tetap ringan.

## Index / Performance Notes

Index yang sudah membantu:

- `mch_productiondata`: `(machineno, startdatetime)`, `startdatetime`
- `mch_machine_ping_log`: `checked_at DESC`, `machineid`, `ipaddress`
- `timesheet_transaction`: `longdate_checkin`, `longdate_checkout`, `order_no`, `operation_no`, `workcentercode`, `serialnumber`
- `sow_schedule`: `machine_code, schedule_date, shift_id, schedule_status`
- `sap_timesheet_staging`: `status, created_at`, `source_system, bucket_start`

Index tambahan yang disarankan:

```sql
CREATE INDEX IF NOT EXISTS idx_mch_transaction_start_machine_status
  ON public.mch_transaction (startdatetime, machineid, statusid);

CREATE INDEX IF NOT EXISTS idx_mch_transaction_machine_workdate
  ON public.mch_transaction (machineid, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_mch_transaction_tsnumber
  ON public.mch_transaction (tsnumber)
  WHERE tsnumber IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_timesheet_checkin_workcenter_activity
  ON public.timesheet_transaction (longdate_checkin, workcentercode, activitytype);
```

Catatan: tambah index ini setelah diuji dengan `EXPLAIN ANALYZE`, karena beberapa index mungkin sudah tercakup oleh query dashboard existing.

## Prioritas Implementasi

### Phase 1 - Dashboard data nyata minimum

1. Buat schema `ews` dan tabel `kpi_snapshot`, `alert_log`, `action_table`, `action_history`, `kpi_threshold`.
2. Buat service kalkulasi system-level 5 KPI untuk window 15 menit.
3. Buat endpoint `GET /api/ews/summary`.
4. Wire `EwsControlTower.jsx` ke endpoint.

Output: mockup berubah dari static menjadi live summary.

### Phase 2 - Top Issues dan drilldown

1. Hitung per machine/workcenter.
2. Generate top issues dari KPI terendah.
3. Detail KPI:
   - Uptime: ping timeline.
   - Accuracy: error type breakdown.
   - Adoption: missing time / unmatched machine event.
   - OEE: status/downtime breakdown.
   - OLE: operator/activity breakdown.

### Phase 3 - Correction and escalation

1. CRUD action queue.
2. Auto-open action untuk critical alert.
3. Escalation aging.
4. Optional TTS critical alert.

## Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| `sap_timesheet_staging` mayoritas pending | Accuracy bisa terlihat buruk kalau pending dianggap error | Pisahkan pending backlog dari failed/error |
| `sow_schedule` masih sedikit | OEE/OLE berbasis plan schedule belum matang | Tahap awal pakai `mch_transaction` dan `timesheet_transaction`; schedule dipakai saat data sudah konsisten |
| `No Job` dominan di machine event | OEE bisa jatuh tidak adil | Exclude `No Job` dari denominator utama, tampilkan sebagai diagnostic terpisah |
| Ping success tidak berarti aplikasi HMI sehat | Uptime terlalu optimis | Tahap berikut tambah heartbeat app-level dari HMI |
| Dashboard refresh terlalu sering | Beban DB tinggi | Pakai `ews.kpi_snapshot`, TTL API 30-60 detik, dan job kalkulasi periodik |
| KPI OLE sensitif definisi denominator | Interpretasi salah | Tampilkan OLE bersama Adoption, jangan isolasi |

## Kesimpulan

Strategi terbaik adalah memakai tabel existing sebagai source of truth:

- `mch_machine_ping_log` untuk Uptime.
- `timesheet_transaction`, `sap_timesheet_staging`, `log_timesheet_sap`, `sow` untuk Accuracy.
- `mch_transaction` + `timesheet_transaction` untuk Adoption.
- `mch_transaction` + `mch_statustypes` untuk OEE.
- `timesheet_transaction` + `vw_timesheet_std_performance` untuk OLE.

Tabel baru yang dibuat hanya layer EWS: snapshot, alert, action, history, threshold. Ini menjaga implementasi tidak menduplikasi raw data, tetapi tetap cepat untuk dashboard live dan aman untuk ribuan user.
