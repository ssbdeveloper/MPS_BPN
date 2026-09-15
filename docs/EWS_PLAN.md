---
type: plan
status: active
tags: [ews, plan, master, domain/ews]
created: 2026-07-12
---

# EWS — Master Plan (dokumen tunggal)

> **Satu-satunya dokumen planning EWS.** Menggantikan 7 dokumen terpisah (daftar di §9 —
> semuanya dihapus 2026-07-12; git history menyimpannya). Isi sudah direkonsiliasi dengan
> kode per hari ini. Panduan end-user tetap terpisah: [[frontend/EWS_PANDUAN_PENGGUNA]].

---

## 1. Apa itu EWS

Early Warning System: monitoring real-time 8 KPI produksi (labour & machine) dengan alert
berlapis, issue log otomatis dari backend, eskalasi berbasis umur, dan notifikasi TTS.

**Model lapisan** (kerangka konseptual — masih berlaku):

```
Alert ──→ Detail ──→ Standard Action ──→ Correction ──→ Escalation ──→ Control
 What     Where/When    How/Who/When      Issue Log       Report Case    Recurrence
```

**Arsitektur as-built:**

```
Sumber: timesheet_transaction · mch_productiondata/mch_transaction · sap_timesheet_staging
        public.mch_machine_ping_log (uptime HMI, live) · ews.shift_roster (adoption labour)
        [device_status + ews.device_heartbeat_daily — uptime tablet, infra siap, KPI belum]
   │  pg_notify('ews_source_changed') / interval
   ▼
ews-snapshot-job (~1 mnt, advisory-lock single leader)
   ├─ ewsCalculator.calculateSystemSummary() → UPSERT ews.kpi_snapshot
   │    (kolom fixed *_pct + detail_json.kpis[8]; overall_status status-only)
   ├─ ewsIssueGenerator.generateAll() → UPSERT ews.issue_log (dedup issue_key)
   └─ pg_notify('ews_snapshot_ready') → SSE /ews/stream broadcast (kalkulasi TIDAK PERNAH
      di request path; payload ringkas + version gating; heartbeat 25s; nginx buffering off)
Sibling jobs: ews-adoption-job (10 mnt, adoption_*_snapshot) · ews-roster-job · ews-tts-worker
```

## 2. 8 KPI — formula, threshold, sumber (sesuai kode)

Baris LABOUR: `uptime_tablet | accuracy_labour | adoption_labour | ole`
Baris MACHINE: `uptime_hmi | accuracy_machine | adoption_machine | oee`

| KPI | Formula (terverifikasi) | 🟢 | 🟡 | 🔴 | Sumber | Status |
|---|---|---|---|---|---|---|
| uptime_tablet | — (belum dihitung) | ≥99 | 98–99 | <98 | `ews.device_heartbeat_daily` (siap) | **placeholder no_data** |
| uptime_hmi | AVG per **device HMI** dari ping TERAKHIR-nya (terjangkau=100/tidak=0); 9 IP = 36 mesin; guard segar 10 mnt | ≥99 | 98–99 | <98 | `public.mch_machine_ping_log` | ✅ live (2026-07-22) |
| accuracy_labour | timesheet_ready/total; error = missing_order \| missing_operation \| sow_no_match; exclude state_flag=5 | ≥98 | 95–98 | <95 | timesheet + sap_staging | ✅ live |
| accuracy_machine | mch rows dgn `status_record=true` / total (GENERATED col) | ≥98 | 95–98 | <95 | mch_productiondata/transaction | ✅ live |
| adoption_labour | Σ LEAST(recorded,standard) / Σ standard — shift SELESAI saja | ≥95 | 90–95 | <90 | timesheet + roster | ✅ live |
| adoption_machine | 1 − gap (statusid 5 ∪ statusid 2 >300 dtk) / total | ≥95 | 90–95 | <90 | mch_productiondata (cache) | ✅ live |
| oee | run(M1,M2 ∪ productive) / denominator (excl. no job/off/preventive/breakdown/break/daily pm) — proxy waktu, bukan OEE klasik | ≥80 | 65–80 | <65 | mch_transaction | ✅ live |
| ole | working / available per operator | ≥85 | 70–85 | <70 | timesheet | ✅ live |

> **Keputusan lingkup OEE/OLE:** kenapa proxy waktu (bukan model ISO 22400 A×P×Q penuh) & apa yang ikut terparkir → [[concepts/oee-proxy-vs-iso-dashboard]].

Sumber threshold: `DEFAULT_THRESHOLDS` (ewsCalculator.js) + override `ews.kpi_threshold`
(termasuk owner per KPI: uptime→IT, accuracy/adoption→Foreman/Spv, oee/ole→+PPIC).
Target accuracy diselesaikan ke **98** (drift 97-vs-98 lama sudah ditutup).

**Window:** today / rolling (5m–24h) / date (read-only) + delta vs window sebelumnya.
**Timezone:** satu sumber `TIMEZONE=Asia/Makassar` via `config/timezone.js` — jangan hardcode.

## 3. Keputusan terkunci (jangan dilitigasi ulang)

- **D1 — overall():** status-only (any critical → CRITICAL, any watch → WATCH). `overall_score`
  headline DIHAPUS; sub-skor di detail_json: performance = mean(oee,ole), health = mean(sisa)
  — label UI "Kesehatan Sistem/Data", BUKAN kesehatan produksi.
- **D2 — adoption_labour:** pro-rate MATI (false-flag 68–94% operator). Hanya shift SELESAI
  yang dinilai; in-progress ditampilkan tapi di luar rasio; capped di standard (overtime tidak
  menggembungkan). Window pakai BUSINESS_DATE (shift malam utuh di tanggal mulainya).
- **D3 — getTrend:** baca dari `detail_json.kpis` (8 KPI trend tanpa kolom baru); kolom legacy
  tetap ditulis untuk kompatibilitas.
- **Shift (owner-confirmed):** Day 08:00–17:00 std **8h** (checkin 07:00–18:00 → shift 1);
  Night 20:00–04:00 std **7h** (sisanya); checkin <07:00 → business_date hari sebelumnya;
  long-shift collapse ke Day/Night (standar tetap); satu operator TIDAK dipecah 2 shift per
  business_date (anchor = checkin pertama). `SHIFT_STANDARD_HOURS = {1:8, 2:7}` satu tempat.
- **Issue dedup contract:** `issue_key = "<category>:<business_date>:<scope>:<entity_id>"` —
  satu row per (KPI, hari bisnis, entitas). Regenerasi UPSERT selama `open`; TIDAK PERNAH
  menimpa row `resolved`. *Asal-usul aturan ini:* issue_key lama pakai window_end per-menit →
  ON CONFLICT tak pernah match → 423 action noise dari raw rows. Issue dibangun dari entitas
  AGREGAT, bukan raw rows.
- **OEE/OLE issue = critical-only** (warning tampil di gauge, bukan di log — log harus actionable).
- **Anti-false-alert:** accuracy minimum sample (total ≥50); issue hanya saat KPI watch/critical.
  uptime_hmi: KPI bereaksi seketika, tapi issue/TTS menunggu ≥3 siklus ping gagal beruntun
  (`EWS_UPTIME_HMI_DOWN_STREAK`) — blip satu siklus tidak membangunkan IT.
- **Bahasa issue:** `title/description` Bahasa Indonesia polos & SPESIFIK (SIAPA/APA/BERAPA/
  LAKUKAN APA) — frasa kabur ("terjadi ketidaksesuaian data") DILARANG. `error_code` stabil
  untuk mesin (MISSING_ORDER, SOW_NO_MATCH, ADOPTION_GAP, …); manusia baca title.
- **Realtime:** KPI calc tidak pernah di request path; SSE hanya snapshot ringkas + version
  gating; leader election advisory lock; drilldown data berat via endpoint terpisah.

## 4. Issue Log — pipeline & gate per KPI (as-built)

`ewsIssueGenerator.generateAll()` per business-day, hook di snapshot job (otonom — TIDAK
tergantung UI dibuka; kelemahan lama "FE-only generation" sudah mati).

| category | scope | predikat (reuse kalkulasi KPI — WAJIB) | gate (env, tunable) | critical bila |
|---|---|---|---|---|
| accuracy_machine | machine | `status_record=false` per mesin | bad ≥5 `EWS_ACC_MACHINE_MIN_MISSING` | bad% ≥50 |
| accuracy_labour | operator | rows produktif invalid (order/op/wc/sn kosong ∪ no ph3 match) | bad ≥3 `EWS_ACC_LABOUR_MIN_BAD` | bad% ≥30 |
| adoption_labour | operator | shift selesai recorded<standard (reuse snapshot breakdown; roster LEAVE/SICK/PERMIT/OFF di-skip) | gap ≥1h | recorded% ≤50 |
| adoption_machine | machine | segmen gap statusid 5 ∪ 2 >5mnt (reuse adoption_summary_snapshot) | gap ≥15mnt | cover% ≤50 |
| oee | machine | band CRITICAL (reuse per_machine) | denom ≥2h | selalu |
| ole | operator | band CRITICAL (reuse per_operator) | avail ≥2h | selalu |
| uptime_hmi | **device** | ping terakhir gagal (reuse devices list) | gagal ≥3 siklus beruntun | selalu |
| uptime_tablet | — | skip sampai KPI-nya hidup | — | — |

**Resolve flow:** `PUT /ews/issue-log/:id/resolve` — justifikasi WAJIB (`resolution_note`,
`resolved_by`), optimistic update di UI. **Eskalasi umur (SQL):** Critical >3h → Manajer Plant;
Critical >1h → Supervisor/Foreman; selain itu → PIC Monitor.

**Klasifikasi error (masih dipakai detail builder):** Missing / Invalid / Inconsistent /
Outlier / Duplicate → akar masalah: operator / training / logic-system / abnormal / double-input.

**Diagnosa lintas-KPI (dipakai EwsDetailPage):** Adoption↓+Uptime↓ → masalah device, bukan
operator · OEE↓+OLE normal → masalah mesin/material · OLE↓+Adoption normal → beban kerja/idle.

## 5. Permukaan sistem (inventaris nyata)

- **Tabel:** `ews.kpi_snapshot`, `kpi_threshold`, `issue_log`, `machine_heartbeat_daily`,
  `adoption_bucket_snapshot`, `adoption_summary_snapshot`, `shift_roster`, `operator_shift`,
  `rotation_config`, `alert_log`, `tts_notification`, `activity_type_ref`,
  `device_heartbeat_daily` (+`public.device_status`) · legacy menunggu pensiun: `action_table`, `action_history`.
- **Endpoint:** `/ews/summary · /trend · /stream (SSE) · /health · /issue-log (GET/PUT resolve/
  POST generate) · /issue/:issueKey/records (drill) · /kpi/:type/detail · /notifications · /roster*`
  (legacy `/issues` & `/actions*` DIHAPUS 2026-07-12 — IL-last).
- **Jobs (compose):** ews-snapshot-job · ews-adoption-job · ews-roster-job · ews-tts-worker
  (Edge TTS id-ID-GadisNeural). Heartbeat HMI: `machine-heartbeat-sync` (compose terpisah).
- **Frontend:** `EwsControlTower.jsx` (8 kartu 2×4 + sparkline) · `EwsDetailPage.jsx`
  (gauge vs target, delta chip, breakdown per KPI, AutoIssueLogCard, diagnosa lintas-KPI) ·
  `EwsNotificationsPage` · `EwsRosterPage`/`Config`.
- **Env penting:** `EWS_JOB_*` (debounce/interval/lock/pool) · `EWS_SSE_*` (heartbeat/poll/max
  klien) · `EWS_SNAPSHOT_STALE_MS` · `EWS_ADOPTION_SOURCE=machine` ·
  `EWS_CALCULATE_ADOPTION_IN_MAIN` · `EWS_DAY_START_HOUR` · gate per-KPI (lihat §4).

## 6. ✅ Sudah selesai (kronologis ringkas)

1. Fondasi snapshot + SSE + jobs (arsitektur §1) — Jul awal.
2. **Split 5→8 KPI** (Phase 1–4): backend + frontend + trend via detail_json — 2026-07-10.
3. **`ews.issue_log` backend-generated** untuk SEMUA KPI ber-kalkulasi (IL-1…IL-1g) +
   `AutoIssueLogCard` + resolve dengan justifikasi wajib — 2026-07-10/11 (commit af1f861, 159ef77).
4. **uptime_hmi live** via `ews.machine_heartbeat_daily` (agregat di SQL Server; daemon
   `machine-heartbeat-sync` diperbaiki & jalan 2026-07-11/12; tabel mentah 268 MB dihapus).
5. Timezone single-source; KPI status dievaluasi nilai unrounded (A-R4) — 2026-07-11.
6. **Infra uptime_tablet**: app Android `apps/mobile` + `POST /device-heartbeat` +
   `device_status` + `ews.device_heartbeat_daily` (endpoint teruji live) — 2026-07-12.
7. **IL-last**: action_table pensiun; TTS otonom di generator; correction queue → issue_log — 2026-07-12.
8. **OEE detail — komposisi bucket dirinci**: `by_loss_status` + `mix_composition_by_machine`
   di source_detail; tooltip Machine Time Mix & kartu Loss by Type menampilkan isi NNVA
   (Setting/Measure/Load/Unload) dan NVA (Downtime/Idle/Coffee Break/…) per status;
   rekonsiliasi bucket teruji persis — 2026-07-12.
9. **BUG FIX: mesin full-downtime tak pernah masuk issue log** — `SUM FILTER (running)`
   menghasilkan NULL (bukan 0) bila mesin tak punya baris running → `oee_pct NULL` →
   generator skip justru mesin TERPARAH (5 mesin downtime 8–19 jam invisible, hanya
   mesin 28.5% yang ter-log). Fix: COALESCE running_h di `calculateOee.by_machine` +
   kolom `downtime_hours` per mesin + description issue menyebut "Terutama Downtime X jam".
   Terbukti live: 5 issue critical muncul + TTS ter-enqueue & diproses worker — 2026-07-12.
10. **uptime_hmi jadi metrik HIDUP per device** — sumber pindah dari agregat harian
   `ews.machine_heartbeat_daily` (reaksi ~0,03 poin/mnt, tak pernah pulih di hari sama)
   ke ping TERAKHIR tiap device di `public.mch_machine_ping_log` (9 IP HMI = 36 mesin).
   Satu box mati = −11,1 poin seketika & balik 100% saat nyala; guard segar 10 mnt supaya
   ping worker mati ≠ 100% palsu; issue jadi per device + debounce 3 siklus (insiden 20-Jul:
   14 issue → 3). Uji ulang vs prod: 20-Jul terbaca 66,7% critical (lama 86,32%) —
   2026-07-22, [[log/2026-07-22-ews-uptime-hmi-live]].

## 7. 🔜 To-do (urutan disarankan)

### 7.1 Phase 6 — Drill-through ke culprit records ← ✅ **SELESAI 2026-07-12**
Dari issue di log → klik → lihat baris sumber SPESIFIK penyebabnya.
**Semua 6 kategori ber-kalkulasi hidup & teruji rekonsiliasi vs prod** (uptime_* sengaja
tanpa drill — empty-state anggun). Tambahan 2026-07-12 malam:
- **adoption_machine ✅** — segmen mch_productiondata statusid 5 / statusid 2 >5mnt
  (persis upsertMachineSummary): mesin 74 gap 34.3 → SUM 34.5 mnt (rounding 0.1/baris).
- **oee ✅** — baris LOSS (denominator ∧ ¬running, persis calculateOee): M5051CR1
  loss 7.19 → SUM 7.18 jam; kolom operator ikut tampil (siapa yang idle).
- **ole ✅** — baris non-produktif (duration>0 ∧ ¬(produktif+order), persis calculateOle):
  operator 11003499 NVA 2.22 → SUM 2.22 jam PERSIS.

> **Progres 2026-07-12:** fondasi + KPI pertama SELESAI & teruji live —
> `services/ewsIssueDrill.js` (registry builder per kategori), endpoint
> `GET /ews/issue/:issueKey/records`, halaman `/ews/issue/:issueKey`
> (`EwsIssueDrillPage.jsx`), tombol 🔍 per row di AutoIssueLogCard.
> **accuracy_labour ✅** — rekonsiliasi terverifikasi vs prod: issue open (bad=6 → 6 rows),
> issue historis (bad=3 → 3 rows), 404 & graceful-unimplemented OK.
> **accuracy_machine ✅** (2026-07-12) — rekonsiliasi vs prod: mesin 58 (bad=24 → 24 rows),
> mesin 49 (bad=175 → 175 rows; pagination teruji: 100+75, truncated benar). Alasan per
> baris = daftar field kosong (order/operasi/SN/confirmation) dari definisi `status_record`.
> **adoption_labour ✅** (2026-07-12) — uji rekonsiliasi MENANGKAP bug desain awal: drill
> versi-1 hanya menjumlah baris timesheet (1.89 jam) vs recorded issue 4.79 — selisihnya
> = **kredit jam mesin** (`applyMachineHoursToAdoptionLabour`). Final: tabel dua-sumber
> (TIMESHEET + MESIN-kredit dgn interval-merge overlap persis kalkulator) → 1.89+2.92=4.81
> vs 4.79 ✓ (selisih 0.02 = rounding + drift open-row). Kasus absen → 0 rows + note khusus ✓.
> Catatan penting: window kategori ini scan [bd, bd+2) + derivasi business_date per baris
> (BUKAN bounds generik — ekor shift malam), cutoff logs literal 07:00 vs cutoff mesin
> EWS_DAY_START_HOUR (mengikuti kalkulator apa adanya). Prefilter sargable ditambah:
> 5.1s → 1.5s via idx_mch_transaction_sap_window.
> **Keputusan:** window TIDAK disimpan di issue_log — diturunkan deterministik dari
> `business_date` (rumus sama `getBizBounds`; catatan: window mulai 00:00 tanggal bisnis,
> `EWS_DAY_START_HOUR` hanya menentukan tanggal) → tanpa migration.
> **Sisa: tidak ada** — drill uptime_* menunggu KPI-nya sendiri hidup (§7.2).

- **READ-ONLY** — tidak membuat/mengubah issue.
- **Predikat culprit = REUSE PERSIS predikat kalkulasi KPI** di ewsCalculator/generator —
  jangan definisi ulang "error"/"gap"; jumlah baris HARUS rekonsil dengan angka kartu.
- Query pakai window si issue (bukan now()): simpan `window_start/window_end` di issue_log
  (migration kecil) ATAU derive deterministik dari `business_date` via `getBizBounds`.
- Scope ketat: entity + window + error_code; LIMIT 500 + pagination; NO `SELECT *`.
  (Modul ini pernah kena 66s→665ms join fix — jangan regresi.)
- Endpoint: `GET /ews/issue/:issueKey/records` → `{ issue_summary, columns, rows[], total, truncated }`.
- Page baru `/ews/issue/:issueKey` (deep-linkable, survive refresh) + link dari tiap row Issue Log.
- Culprit per KPI: accuracy_labour → rows error + staging FAILED/PENDING (+ "kenapa gagal" per
  row) · accuracy_machine → mch rows tanpa transaction · adoption_labour → rows timesheet
  operator-shift (recorded vs standard vs gap) · adoption_machine → segmen gap (kenapa dihitung
  gap) · oee → rows bucket non-produktif mesin · ole → rows non-produktif operator ·
  uptime_* → skip, empty-state anggun.
- **Mulai dari SATU KPI (accuracy_labour), uji rekonsiliasi vs kartu, baru sebar.**

### 7.2 Aktifkan uptime_tablet ← 🔴 URGENT (ada kosmetik yang harus dicabut)
> ⚠️ **Per 2026-07-13 kartu uptime_tablet DIPALSUKAN 100%/normal di frontend**
> (`apps/web/src/theme/ewsCosmetic.js`, keputusan owner — kosmetik sementara supaya
> dashboard tampak lengkap). Backend/snapshot tetap jujur `no_data`. Konsekuensi:
> angka di dashboard BUKAN kenyataan sampai KPI ini selesai — **prioritas naik**.
> Saat mengaktifkan: hapus `ewsCosmetic.js` + 2 pemakainya (EwsControlTower, EwsDetailPage).

Setelah armada tablet terpasang app heartbeat.
Kalkulasi ≈ copy `calculateUptimeHmi` → baca `ews.device_heartbeat_daily`
(`uptime% = beats/(86400/interval_sec)`), lalu tambah generator issue-nya.

### 7.3 IL-last — pensiunkan legacy action_table ← ✅ **SELESAI 2026-07-12**
- Dihapus: `getIssues`/`getActions`/`syncActions`/`resolveAction` + helper-nya +
  `VALID_KPIS` stale + route `/ews/issues` & `/ews/actions*` + 2 entri manifest RBAC.
- **TTS dipindah ke `ewsIssueGenerator.upsertIssue`** (enqueue saat issue BARU ter-insert)
  — pengumuman audio kini OTONOM bersama snapshot job, tidak lagi tergantung halaman
  detail dibuka (menutup cacat lama untuk selamanya).
- ControlTower correction queue → `GET /ews/issue-log?status=open` (mapper mempertahankan
  bentuk lama; escalation ladder Critical>3h/1h direplikasi client-side).
- **Bonus:** manifest RBAC ditambal — `PUT /ews/issue-log/:id/resolve` & `POST
  /ews/issue-log/generate` tadinya unmapped (akan 403 saat RBAC_ENFORCE=1).
- Tabel DB `ews.action_table`/`action_history`/`alert_log` TIDAK di-drop (arsip data) —
  **karantina: drop setelah ≥ 2026-08-15** bila tidak ada yang mencarinya.
- Verifikasi: module-load test (17 route valid), vite build bersih, grep nol pemanggil
  tersisa. Uji live tertunda — server tak terjangkau via Tailscale saat pengerjaan;
  jalankan `POST /ews/issue-log/generate` + buka Control Tower setelah deploy.

### 7.4 Register isu kecil yang belum ditutup
- [ ] Band uptime hardcoded di FE vs threshold backend — satukan ke `ews.kpi_threshold`.
- [ ] `due_at`/SLA di issue_log belum dipakai — pakai atau buang (verifikasi dulu).
- [ ] Perilaku "issue resolved tidak re-open bila kambuh" — verifikasi & putuskan.
- [ ] Band adoption_labour masih "provisional" — review setelah beberapa minggu data.

## 8. Risiko yang diketahui (dari perencanaan awal, masih relevan)

Backlog SAP pending menekan accuracy_labour · dominasi No-Job menyembunyikan masalah OEE ·
ping/heartbeat ≠ kesehatan aplikasi (uptime bisa 100% saat app kiosk crash — justru ini yang
dijawab uptime_tablet) · OLE sensitif ke denominator available · adoption_labour buta terhadap
operator yang TIDAK log sama sekali kecuali roster terisi (limitation terdokumentasi di UI).

## 9. Provenance — dokumen yang dilebur ke sini (dihapus 2026-07-12)

`timesheet/EWS_DETAIL.md` (spec §28 asal; 5-KPI framing + connectivity_log/data_validation_log
tak pernah dibangun) · `frontend/EWS_REVISION_PLAN.md` (plan hidup 5→8 + issue_log + Phase 6)
· `frontend/EWS_ANALISA_PERHITUNGAN.md` (analisis formula terverifikasi) ·
`timesheet/EWS_DETAIL_IMPROVEMENT.md` (asal-usul anti-noise) ·
`operations/EWS_ISSUE_LOG_ACTION_CONCEPT.md` (konsep pipeline) ·
`operations/ews-dashboard-data-strategy.md` (strategi sumber data) ·
`operations/ews-realtime-sse-architecture.md` (arsitektur SSE). Sebelumnya juga:
`EARLY_WARNING_SYSTEM_PLAN.md` (dihapus 2026-07-11). Semua ada di git history.
