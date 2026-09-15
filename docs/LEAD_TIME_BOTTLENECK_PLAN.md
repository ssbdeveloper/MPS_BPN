---
type: plan
status: planning
tags: [domain/timesheet, domain/ews]
updated: 2026-07-29
related:
  - "[[concepts/section-16-lead-time-analysis]]"
  - "[[concepts/section-17-bottleneck-analysis]]"
---

# Lead Time & Bottleneck Analytics — Implementasi di DB + Backend MPS

> Tujuan dokumen: (1) hasil verifikasi kesesuaian `.docx` ↔ `.md` untuk Section 16 & 17,
> dan (2) rencana kerja untuk **mewujudkan** analitik Lead Time (§16) + Bottleneck (§17) —
> yang sekarang hidup sebagai pipeline **Power BI / Power Query (`UNIFY_5051_*`)** — ke dalam
> **PostgreSQL + Express** MPS. Sumber kanonik = kedua file `.md` di `docs/concepts/`.

## A. Verifikasi `.docx` ↔ `.md` (SUDAH DICEK 2026-07-29)

**Kesimpulan: konversi FAITHFUL, dan `.md` lebih andal dari `.docx`.** Ekstrak teks docx
(unzip `word/document.xml`) dibandingkan baris-per-baris: setiap query M, measure DAX, kamus
KPI, dan narasi ada di `.md`. `.md` **memperbaiki** cacat docx dan menandainya di bagian
"Catatan Verifikasi":

| Perbaikan `.md` vs `.docx` | Bukti di docx |
|---|---|
| `in Finallet Source = UNIFY_5051_FACT_ORD_OPR_FINAL,` (paste rusak) → dinormalkan `in Final` | docx S16 ada persis (potongan nyangkut) |
| Label salah "Max_Queue_Min = Antrian tercepat" (harusnya terlama) | docx S16 menulis "Antrian tercepat" |
| Label salah "Queue_Event_Count = Antrian terlama" (harusnya jumlah kejadian) | docx S16 menulis "Antrian terlama" |
| `Total_Min` didefinisikan dua kali beda arti (HMI total vs exclude No Job) | docx S16: "tercatat di sistem (HMI)" vs "exclude No Job Minutes" |
| Measure broken: `LT_ORD_TotalProcessingTime`, `LT_ORD_Count`, `LT_Machine_No Job Minute` vs `NoJobMinute` | docx S16/S17 mengandung ketiganya |

**Perbedaan wajar (bukan cacat konversi):** gambar dashboard (`image1..9.png/.emf`) tidak
diekstrak — kedua `.md` sudah menandainya `<!-- IMAGE ... tidak diekstrak -->`. Tak ada
tabel/konten docx yang hilang dari `.md`.

**Rekomendasi:** perlakukan `.md` sebagai sumber kebenaran; `.docx` boleh diarsipkan. Tak ada
pekerjaan "sinkronisasi docx↔md" yang perlu — yang perlu dikerjakan ada di sisi DB/backend (di bawah).

## B. Pemetaan `UNIFY_5051_*` → skema MPS nyata

`UNIFY_5051` adalah sistem Power BI eksternal; substrat datanya = jam mesin HMI/SSB_OEE, yang
di MPS sudah dicerminkan ke `mch_transaction` (via ETL). Pemetaan:

| Entitas UNIFY | Padanan MPS Postgres | Gap / catatan |
|---|---|---|
| `UNIFY_5051_TB` (grain per-menit `Time_Bucket × Machineid`) | `mch_transaction` (grain **interval**, bukan per-menit) | Tak perlu ekspansi per-menit: agregasi langsung dari durasi interval (`end_effective − startdatetime`). **WAJIB `COALESCE(end_effective, enddatetime)`** (lihat C1). |
| `statusid` → `LT_State` | `mch_transaction.statusid` + `mch_statustypes` | **KONFLIK — lihat C2.** |
| `conf_number` | `mch_transaction.confirmation_number` | terisi ~82% Juli |
| `order_number` / `Opr_no` / `Machineid` / `sn_employee` | `order_no` / `operation_no` / `machineno`(int) atau `machineid`(text) / `sn_employee` | ada |
| `STD_time` (standard time per operasi) | `production_operations.estimate_hour` (per order+operation+confirmation) **atau** `sow_standard.std_hours` | **keputusan D-STD** (mana yang otoritatif; satuan **jam** → konversi ke menit) |
| `Portfolio` (product type) | belum langsung — kandidat `production_operations.order_type` / material/part | **keputusan D-PF** |
| `DateTime_Finish` (batas lifecycle) | `mch_transaction.finish_job`/`enddatetime` atau order finish | perlu definisi eksplisit |
| `MT_DTC` / `IsMultitask` (eksposur multitask) | belum ada tabel; bisa diturunkan (operator sama, mesin ≠, waktu tumpang-tindih) | **keputusan D-MT** |
| `UNIFY_5051_LT_TIMELINE` | **tidak perlu** (agregasi dari interval) | menyederhanakan pipeline |
| `UNIFY_5051_ORD_OPR_KPI` / `FACT_ORD_OPR` | view/matview baru per `conf/order-operation` | queue via window function (lebih aman dari index M, lihat C3) |
| `UNIFY_5051_FACT_ORD_LT` | view/matview per `order_no` | |
| `UNIFY_5051_FACT_MACHINE_FLOW_DAY` | view/matview per `machineno × work_date` | |

> Cek dulu view yang SUDAH ADA: `vw_sow_planned_queue_vs_actual_queue`, `v_kanban_queue_candidates`
> — mungkin sebagian queue-analytics sudah ada; jangan duplikasi.

## C. Yang WAJIB diperbaiki di sisi DB (koreksi vs pipeline UNIFY)

Ini temuan yang **mengubah angka** dan harus diputuskan sebelum implementasi — di luar bug Power BI
yang sudah dicatat di `.md`.

- **C1 — Pakai `end_effective`, bukan `enddatetime` mentah.** Pipeline UNIFY memakai ujung interval
  mentah (`List.Max([Time_Bucket])`). Di MPS itu **overcount** karena baris "nyangkut"/overlap —
  persis bug jam-mesin→SAP yang sudah dinormalisasi lapis-3 (`end_effective = LEAST(enddatetime,
  start berikutnya)`, lihat [[concepts/mch-interval-normalization]]). **Semua durasi lead-time/queue
  harus dari `COALESCE(end_effective, enddatetime)`.** Kalau tidak, Lead Time & Queue akan menggelembung.
- **C2 — Klasifikasi `statusid` bertentangan.** docx/md menetapkan `ProductiveStatus = {1,2,6,7,8,9}`.
  Tapi `mch_statustypes` MPS: **statusid 2 = "Idle" (activitytype 1670, UNPRODUKTIF)**; produktif MPS =
  M1 (1) + M2 (6,7,8,9). Jadi memasukkan statusid 2 ke "Productive" **salah** untuk semantik MPS —
  akan menaikkan Productive_Min & Flow_Efficiency palsu. **Keputusan D-STATUS:** pakai peta MPS
  (`activitytype` M1/M2 = productive; 2/1670 = waiting/idle) atau ikuti UNIFY? Rekomendasi: peta MPS.
- **C3 — Queue via window function, bukan index global.** `.md` R3 sudah menandai logika `[Idx]+1`
  di Power Query rapuh. Di SQL, hitung queue dengan `LEAD(start) OVER (PARTITION BY order_no ORDER BY
  start)` per order — aman terhadap filter/urutan. `Queue = next_op_start − this_op_end_effective`,
  hanya untuk order yang sama.
- **C4 — Overlap/`Queue_Anomaly` jangan disembunyikan.** Queue negatif (operasi paralel order sama)
  di-clamp 0 di UNIFY → menutupi overlap (`.md` R4, S17 G4). Simpan `queue_anomaly` sebagai kolom +
  ekspos sebagai gate kualitas data, jangan hanya clamp.
- **C5 — Timezone & batas hari.** `mch_transaction.startdatetime` = `timestamp without tz` (jam dinding
  plant). Agregasi harian (`Date × Machineid`) harus **clip interval ke batas hari** (interval lintas
  tengah-malam dibagi) — bukan hanya `DATE(startdatetime)` (bug report harian yang sudah dicatat di
  PLANNING). Untuk multi-plant, batas hari ikut zona plant (`machine_plantid`).
- **C6 — Rekonsiliasi wall-clock.** `Lead_Time_Min` operasi = jumlah durasi interval yang ADA di data;
  bila HMI mati, under-report (`.md` R5). Bandingkan terhadap `Finish − Start` wall-clock dan tandai gap.

## D. Rencana DB (bertahap)

Semua sebagai **VIEW/MATVIEW** (bukan tabel duplikat), agar konsisten dan tak dobel-sumber. Grain
mengikuti §B.

- **D1 — `vw_lt_ord_opr` (grain: order × operation × machine × conf).** Dari `mch_transaction`:
  agregasi menit per `confirmation_number` (Productive/Waiting/NoJob dari `statusid` per peta D-STATUS,
  durasi dari `end_effective`), `Start = min(startdatetime)`, `Finish = max(end_effective)`,
  `Lead_Time_Min`, `Queue_Min` (window LEAD per order, C3), `queue_anomaly` (C4), join `STD` (D-STD),
  `Work_Complete`, `Flow_Efficiency`.
- **D2 — `vw_lt_ord` (grain: order).** SUM dari D1 + `Lead_Time_Min` = wall-clock (`Order_Finish −
  Order_Start`), `Flow_Efficiency`, `Delay_Ratio`, `Queue_Ratio`.
- **D3 — `mv_lt_machine_flow_day` (grain: machine × day).** MATVIEW (dipakai dashboard, mahal): dari D1,
  clip ke batas hari (C5), + `Order_Count/Conf_Count`, `Queue_Min/Avg/Max`, `Queue_Event_Count`,
  `Queue_Anomaly_Count`, `Avg_Work_Complete`, `Avg_Flow_Efficiency`. Multitask (`MT_Min`) = D-MT.
  Refresh via job (pola `refresh_mv_kanban_order_board`).
- **D4 — Migrasi + registrasi.** File di `database/migrations/api/`, `CREATE OR REPLACE VIEW` +
  `CREATE MATERIALIZED VIEW`. Regenerate `schema_prod.sql`. (Ingat: ckp belum di ledger — lihat
  [[log/2026-07-27-schema-diff-ckp-vs-balikpapan]].)

## E. Rencana Backend (Express `apps/api`)

Endpoint baru `/lead-time` (atau perluas machine-hours). Mirror measure DAX §16.6/§17.7 sebagai SQL —
tapi **betulkan bug measure** yang `.md` tandai (B1/B2/B3): `TotalProcessingTime` → `TotalProductiveTime`,
`LT_ORD_Count` → `DISTINCTCOUNT(order_no)`, satukan nama NoJob.

- **E1 — `GET /lead-time/machine-flow?from&to&plant`** → dari `mv_lt_machine_flow_day`: Productive/Waiting
  Ratio, Queue Intensity, Queue Per Conf, top-N machine.
- **E2 — `GET /lead-time/order-flow?from&to`** → dari `vw_lt_ord`: Avg Lead Time, Flow Efficiency,
  Queue Ratio, Work Complete, top queue orders.
- **E3 — `GET /lead-time/bottleneck`** → §17: matriks Internal vs External delay, ranking; **plus**
  yang belum ada di UNIFY (S17 G1–G4): **threshold/aturan bottleneck** (bukan sekadar Top-10),
  **persistensi** (bottleneck struktural vs temporer), **bottleneck victim** (order↔mesin penyebab
  antrian, dari D1 `Queue_Min` per machine).
- **E4 — Frontend (fase berikut):** dashboard Machine Flow + Order Flow + Bottleneck (ECharts, ikut
  §8 Dataviz CLAUDE.md). Di luar cakupan fase DB/backend.

## F. Keputusan terbuka (WAJIB dijawab owner sebelum implementasi)

| ID | Pertanyaan | Rekomendasi |
|---|---|---|
| **D-STATUS** | statusid 2 (Idle) → Productive (ikut UNIFY) atau Waiting (ikut `mch_statustypes` MPS)? | Ikut MPS (produktif = M1+M2 = {1,6,7,8,9}); 2 = waiting/idle |
| **D-STD** | Sumber STD_time otoritatif: `production_operations.estimate_hour` atau `sow_standard.std_hours`? | `production_operations` (punya confirmation & order+operation; satuan jam → ×60) |
| **D-PF** | `Portfolio` (product type) diambil dari mana? | `production_operations.order_type` atau kelompok part — konfirmasi |
| **D-MT** | Sumber multitask exposure (`MT_DTC`)? | Turunkan: operator sama pada ≥2 mesin di jendela waktu tumpang-tindih (bukan tabel eksternal) |
| **D-THRESH** | Aturan penetapan bottleneck (S17 G1) — threshold apa? | Definisikan (mis. mesin masuk Top-3 queue ≥ N hari) — tanpa ini output tak actionable |
| **D-END** | Sudah dinormalisasi pakai `end_effective` — konfirmasi lead-time/queue harus konsisten dengan angka yang dikirim ke SAP | Ya, `COALESCE(end_effective, enddatetime)` |

## F2. Lembar Keputusan (ISI DI SINI — owner)

> Isi tanda `[x]` / `→` tiap butir. Setelah lengkap, Fase 1 (`vw_lt_ord_opr`, `vw_lt_ord`) bisa mulai.

**D-STATUS — `statusid 2` (Idle) dihitung sebagai apa?**
(konflik: docx/UNIFY = Productive; `mch_statustypes` MPS = Idle/unproduktif)
- [ ] A) **Waiting/Idle** (ikut MPS; produktif = M1+M2 = {1,6,7,8,9}) — *rekomendasi*
- [ ] B) Productive (ikut UNIFY, {1,2,6,7,8,9})
- → pilih: ______

**D-STD — sumber Standard Time per operasi?**
- [ ] A) `production_operations.estimate_hour` (order+operation+confirmation; jam → ×60) — *rekomendasi*
- [ ] B) `sow_standard.std_hours` (component+operation)
- [ ] C) lainnya: ______
- → pilih: ______

**D-PF — sumber "Portfolio" (product type)?**
- [ ] A) `production_operations.order_type`
- [ ] B) kelompok part/material (kolom: ______)
- [ ] C) belum perlu dulu
- → pilih: ______

**D-MT — sumber multitask exposure (`MT_Min`)?**
- [ ] A) **Diturunkan dari data** (operator sama, ≥2 mesin, waktu overlap) — *rekomendasi*
- [ ] B) tabel/sumber lain: ______
- [ ] C) skip dulu
- → pilih: ______

**D-THRESH — aturan penetapan bottleneck (bukan cuma Top-10)?**
- Mesin masuk Top-3 queue **≥ N hari** → N = ______   ·   dan/atau Queue Ratio **> ___%**   ·   dan/atau Queue Per Conf **> ___ menit**
- → aturan: ______

**D-END — semua lead-time/queue pakai `end_effective` (konsisten dg angka SAP)?**
- [ ] A) **Ya** — *rekomendasi* (cegah overcount seperti bug jam-mesin→SAP)
- [ ] B) Tidak, `enddatetime` mentah — alasan: ______
- → pilih: ______

**Opsional (default aman bila kosong):**
- Timezone batas hari agregasi `machine × day`: default ikut zona plant (`machine_plantid`). Preferensi lain? ______
- Periode/scope awal uji (plant 5051 / mesin / rentang tanggal): ______

## G. Non-goals & catatan

- **Bukan** memperbaiki dashboard Power BI UNIFY (itu sistem lain); ini re-implementasi di stack MPS.
- **Bukan** menyentuh ETL/interval mentah/payload SAP (lihat aturan di PLANNING machine-hours).
- Bug measure Power BI (`.md` §7/§8 blocker) hanya relevan bila tetap dipakai di Power BI; di
  re-implementasi Postgres/Express, measure ditulis ulang benar (E).
- Fase disarankan: **Fase 1** jawab F + bangun D1/D2 (order-level, murah). **Fase 2** D3 + E1–E3.
  **Fase 3** frontend E4 + bottleneck lanjutan (persistensi, victim).
