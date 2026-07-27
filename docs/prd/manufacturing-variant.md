---
type: prd
status: active
tags: [prd, manufacturing, variant, timesheet, sap, domain/timesheet]
updated: 2026-07-14
---

# PRD — Varian Manufacturing MPS Timesheet

> **Tujuan dokumen:** checklist lengkap "apa saja yang harus dibedakan dari versi salvaging"
> untuk membangun varian manufacturing sampai production-ready. Disusun dari scan kode
> menyeluruh 2026-07-14 (`apps/web`, `apps/api`, `jobs/`) + dokumen keputusan yang sudah ada.
>
> **Status: draft** — §7 (keputusan terbuka D1–D11) harus dijawab owner sebelum status naik
> ke `approved`. Bagian lain adalah fakta kode, bukan usulan.

Basis keputusan yang TIDAK dilitigasi ulang di sini:
[[timesheet/MANUFACTURING_VERSION_UAT]] (fungsional yang sudah dibangun),
[[REFACTOR_PLAN]] F-R4 (dispatcher `VITE_APP_VARIANT` = seam yang disepakati),
[[_isolasi/ms_project_PRD]] (MS Project = planning, MPS2 = data resmi; sync tidak boleh
menimpa actual), [[concepts/payroll-data-path]], [[concepts/sap-staging-identity]],
[[concepts/order-no-spine]].

---

## 1. Konteks: kondisi nyata hari ini

Varian manufacturing **bukan greenfield** — sebagian sudah dibangun dan masuk UAT
([[timesheet/MANUFACTURING_VERSION_UAT]]). Kondisi per lapisan (hasil scan kode, bukan asumsi):

| Lapisan | Kondisi |
|---|---|
| Mekanisme varian | Terpusat & final: `apps/web/src/config/appVariant.js` membaca `VITE_APP_VARIANT` (**build-time**, default `salvaging`; ganti varian = rebuild). 3 dispatcher: `TIMESHEET/TimesheetMainMenuPage.jsx`, `TIMESHEET/SelectJobPage.jsx`, `PPC/SowSchedulingPage.jsx`. Kedua cabang ikut ter-bundle. |
| Frontend fork — jadi | **Select Job manufacturing** (fungsional: area→bay→task dari `/ms-project/bay-schedule-tasks`, filter workcenter operator) · **SowScheduling manufacturing** (fungsional: project browser + `MapSapOperationPage` + `SchedulingAreaPage`). |
| Frontend fork — placeholder | **Main Menu manufacturing** (200 baris): tombol Check In hanya toast "flow akan dibuat di tahap berikutnya" → navigate `/select-job`; Check Out jalan; tanpa Start/Finish/TTS/mode single-multiple. |
| Frontend shared (satu versi, de facto salvaging) | SELURUH core flow lain: `LoginTimesheetPage`, `SelectMachinePage`, `TimesheetPage`, `TimesheetListPage`, `TimesheetValidationPage`, `TimesheetEditPage`, `LogTimesheetPage`, `OperatorPerformancePage`, `UnproductiveMenuPage`, `NfcUserListPage`/`CreateEditNfcPage`, `DashboardPage`. Dipakai apa adanya oleh kedua varian. |
| Backend | **Tidak variant-aware sama sekali** (0 kemunculan `salvaging`/`APP_VARIANT` di `apps/api`). Satu codebase, di-tune per deployment via env: `PLANT_SSB`, `TGT_TABLE` (default `ph3_order`), `SAP_INBOUND_*`, `ID_TIMESHEET`, `TIMEZONE`. |
| Jobs (`jobs/`) | Tidak ada konsep varian — semuanya implisit salvaging. Pembeda riil = **plant** (`PLANT_SSB`, `PLANT_FILTER=5051`) dan **tabel order** (`TGT_TABLE`). |
| Database | Shared untuk kedua varian (dinyatakan eksplisit di banner UI manufacturing). Data khas manufacturing: `ms_project_bay_schedule`, `ms_project_task`. |

**Klarifikasi penting** (sering salah dipahami): `timesheet_transaction.serialnumber` = **SNSSB
karyawan** (badge → `PERNR` SAP), BUKAN serial number unit. Tidak ada field serial-unit di
payload SAP mana pun.

---

## 2. Perbedaan konseptual inti (model operasi)

Ini akar dari semua perbedaan teknis di bawah:

| Dimensi | Salvaging (existing) | Manufacturing (target) |
|---|---|---|
| Sumber pekerjaan | **SOW** — order lahir dari breakdown komponen datang (`ssbr_ident` → beberapa `production_order`), lihat [[concepts/order-no-spine]] | **Bay schedule MS Project** — task per area/bay dengan planned start–end (`ms_project_bay_schedule` + `ms_project_task`) |
| Identitas pekerjaan | `order_no` + `operation_no` + `ssbr_id` + `part_name` | `order_no` + `task_id` + `schedule_id` + `project_id` + `area/bay` |
| Cara operator pilih job | Cari nomor order / **scan barcode kamera** | Pilih **Area → Bay → task** yang terfilter workcenter operator; device diikat ke area |
| Kuota jam | `planhours` + `remaining_seconds_before` — job bisa "KEHABISAN JAM" | `planned_work_minutes` dari schedule; **tanpa konsep remaining** (di-set `null` konstan) |
| Selesai pekerjaan | Tombol **Finish** → `PUT /sow/finish/` + **TTS announcement** per `ssbr_id` | Belum didefinisikan (→ D9) |
| Penjadwalan PPC | Capacity board drag-drop Machine × Shift + batch pocket + overtime + timeline Gantt | Map SAP operation → schedule Area/Bay dari project MS Project |
| Mode operator | Toggle Single/Multiple, persist `PUT /usernfc/mode/{snssb}` | Belum ada (→ D4) |
| Verifikasi progres | `SowVerificationPage` (ladder operasi per order) | Tidak ada padanan (→ D8) |

---

## 3. Titik kode yang terikat asumsi salvaging

Inilah daftar konkret yang harus diputuskan/diubah agar manufacturing benar. Selain daftar
ini, backend & jobs **netral** (murni data / sudah parameterized via env).

### 3.1 Backend (`apps/api`)

| # | Lokasi | Asumsi salvaging | Dampak ke manufacturing |
|---|---|---|---|
| B1 | `timesheet_transactionController.js:1343-1347` (`postToSap`) | Derivasi `ZCONF_TYPE`: workcenter `*OT` → `OV`; order `32*` → `RW`; else `RG` | Konvensi prefix order & sufiks workcenter manufacturing bisa berbeda → salah klasifikasi confirmation SAP (→ D3) |
| B2 | `timesheet_transactionController.js:126-137` (`inferActivityType`) | Kode aktivitas 4-digit ditebak dari `operation_text` | Verifikasi set kode aktivitas non-produktif manufacturing sama (→ D3) |
| B3 | `machineHoursValidationController.js:46-55, 65` | Hard-code `M1`/`M2`; `ZTIMESHEETID = PLANT_SSB + proddataid` | Berlaku hanya jika jalur jam mesin dipakai manufacturing (→ D10) |
| B4 | 4 literal `ph3_order`: `dashboardController.js:40`, `componentTrackingController.js:212`, `machineHoursSqlServerController.js:17`, `sowScheduleController.js:2319` | Tabel master order di-hardcode (tidak ikut env `TGT_TABLE`) | Kalau D1 memilih tabel/instansi lain, 4 titik ini bocor; seragamkan ke `TGT_TABLE` |
| B5 | `sowController.js` + `componentTrackingController.js` | Model rekondisi: `part_number`+`model`+`customer`+`ssbr_id`; `DISTINCT ON (machineid)` (asumsi 1 mesin ↔ 1 operator aktif) | Halaman shared yang memakainya harus null-safe untuk baris manufacturing (FR-4) |
| B6 | Eligibility SAP = `LEFT JOIN ${TGT_TABLE}` by order+operation (`:1310-1312`); tanpa match → `RUECK` kosong | Order manufacturing WAJIB tersinkron ke tabel master agar bisa di-post (FR-0) |

### 3.2 Jobs (`jobs/`)

| # | Lokasi | Asumsi salvaging | Dampak |
|---|---|---|---|
| J1 | `stage_sap_timesheet.py:76-81` + `stage_timesheet_transaction.py:68-73` | Duplikat aturan B1 (`32*`→RW, `*OT`→OV) | Harus konsisten dengan keputusan D3 di DUA tempat + API |
| J2 | `stage_sap_timesheet.py:65,231,280` | PERNR Outsource hard-code `'11009413'` | Kemungkinan berbeda per plant/entitas (→ D2) |
| J3 | `stage_sap_timesheet.py:307-324` | `source_key` md5 memuat `werks` | Mengubah plant = seluruh kunci riwayat berubah — perhatikan "Batas Berbahaya" di `jobs/sap_staging/README.md` sebelum menyalakan plant baru |
| J4 | `etl_order.py:41`, `jobs/sow/.env.example` | `PLANT_FILTER` default `5051` | Set nilai plant manufacturing via env, jangan hard-code |
| J5 | `etl_machinehours.py` | Menyalin SEMUA mesin SSB_OEE tanpa filter plant | Putuskan apakah mesin manufacturing ikut `mch_transaction` yang sama (→ D10) |
| J6 | `etl_sync_v2.py:143-198` | Multi-target per `plant_code` **sudah generik** | Manufacturing = tambah entry `_TARGET_DEFS` + env — bukan duplikasi kode ✅ |

### 3.3 Frontend (`apps/web`)

| # | Lokasi | Masalah | Dampak |
|---|---|---|---|
| F1 | `TIMESHEET/manufacturing/TimesheetMainMenuPage.jsx` | Check In = placeholder (toast + navigate) | Alur inti belum ada — FR-1 |
| F2 | `TIMESHEET/manufacturing/SelectJobPage.jsx` | `AREA_OPTIONS` 18 area + bay **hard-coded di kode**; binding device→area/bay di `localStorage` | Ganti master data & ganti device = deploy ulang / setting hilang — FR-2 (→ D6, D7) |
| F3 | `router/index.jsx:197` | Route `/sow-verification` import langsung versi **salvaging** (bukan dispatcher) | Varian manufacturing tetap memuat halaman salvaging (→ D8) |
| F4 | Halaman shared (Validation, List, Edit, dsb.) | Kolom `ssbr_id`/`part_name`/remaining berorientasi salvaging | Harus diverifikasi render wajar untuk baris manufacturing — FR-4 |

---

## 4. Requirement (FR)

### FR-0 — Prasyarat data (blocking semua jalur SAP)
1. Order manufacturing tersedia di tabel master (`TGT_TABLE`) — tanpa ini `RUECK` kosong dan
   posting SAP gagal (B6). Konfirmasi feed: Lambda `aws/sap-ph3-order-lambda` hanya menulis
   `ph3_order`; **tidak ada** endpoint padanan lain (→ D1).
2. Sync MS Project operasional dan `ms_project_bay_schedule` terisi untuk area/bay yang dipakai —
   Select Job manufacturing bergantung pada schedule aktif hari ini (dicatat di UAT §9).
3. Fallback ketika schedule belum punya `task_id` (ambil task by `order_no`) diformalkan sebagai
   aturan, bukan sekadar perilaku darurat.

### FR-1 — Check-in / Check-out manufacturing (mengganti placeholder)
1. Check In membuat `timesheet_transaction` nyata (`POST /timesheet/`) dengan field
   manufacturing yang sudah didefinisikan UAT (`schedule_id`, `task_id`, `project_id`,
   `manufacturing_area_*`, `manufacturing_bay_*`) — perilaku persis (auto-checkout dulu?
   mode single/multiple?) diputuskan di D4.
2. Check Out mempertahankan kontrak existing (`PUT /timesheet/checkout`).
3. Business rule final check-in (UAT §9 menyebut "belum seluruh business rule final") ditulis
   di dokumen ini sebelum implementasi — bukan diputuskan sambil koding.
4. Guard planhours ([[timesheet/PLANHOURS_GUARD_IMPLEMENTATION_PLAN]]): varian manufacturing
   minimal membaca flag `can_start` yang sama agar perilakunya konsisten.

### FR-2 — Select Job manufacturing: hardening
1. Master Area/Bay pindah dari konstanta kode ke tabel DB + endpoint (→ D7).
2. Binding device→area/bay pindah dari `localStorage` ke DB (kandidat: `tablet_status`) supaya
   setting selamat dari clear-cache dan bisa diadministrasi terpusat (→ D6).
3. Aturan filter task DIPERTAHANKAN sesuai keputusan UAT: `area_code` + `bay_code` + tanggal
   hari ini dalam `start_date`..`end_date` + status ≠ `CANCELLED` + workcenter = workcenter operator.
4. Operator tanpa workcenter di session diarahkan ke `/select-machine` dengan pesan jelas
   (sekarang hanya toast warning).

### FR-3 — Select Workcenter (halaman shared `/select-machine`)
1. Verifikasi `SelectMachinePage` cocok untuk manufacturing (pilihan workcenter menentukan
   filter task — apakah konsep "machine" salvaging relevan atau manufacturing cukup workcenter).
2. Workcenter tersimpan ke `datakaryawan` session — kontrak yang sudah dipakai filter FR-2.

### FR-4 — Kompatibilitas halaman shared
1. `TimesheetPage`, `TimesheetListPage`, `TimesheetValidationPage`, `TimesheetEditPage`,
   `LogTimesheetPage`, `OperatorPerformancePage` harus menampilkan baris manufacturing secara
   wajar: `ssbr_id`/`part_name` bisa kosong, jam dari `planned_work_minutes`, tanpa konsep
   remaining. Uji eksplisit, jangan diasumsikan.
2. Kolom/label yang berbau salvaging (mis. SSBR) disembunyikan atau diberi fallback saat data
   manufacturing — TANPA mem-fork halaman (ikuti [[REFACTOR_PLAN]] F-R4: fork hanya bila
   divergensi besar; selebihnya props/kondisional).

### FR-5 — Posting SAP timesheet manufacturing
1. Keputusan D3 (aturan `ZCONF_TYPE`) diimplementasikan di **tiga** tempat sekaligus:
   `postToSap` (B1), `stage_sap_timesheet.py`, `stage_timesheet_transaction.py` (J1) — satu
   sumber aturan, jangan tiga salinan yang bisa drift.
2. `WERKS`/plant dari env per-deployment (D2); TIDAK menyalakan plant baru di jalur staging
   sebelum membaca "Batas Berbahaya" `jobs/sap_staging/README.md` (J3 — `source_key` memuat werks).
3. Identitas & guard staging ([[concepts/sap-staging-identity]]) dipakai apa adanya —
   **non-goal** untuk didesain ulang.

### FR-6 — Konsistensi tabel master di backend
1. Ganti 4 literal `ph3_order` (B4) menjadi `TGT_TABLE` — prasyarat kalau D1 memilih tabel
   berbeda; tetap layak sebagai pembersihan meski D1 memilih `ph3_order`.

### FR-7 — PPC manufacturing (sudah fungsional — sisa gap)
1. `MapSapOperationPage` + `SchedulingAreaPage` dipertahankan; pastikan hasil mapping/schedule
   persist ke DB (bukan state lokal) dan actor audit `web-manufacturing` konsisten.
2. Force Check-In admin (`/ms-project-admin`, audit `FORCE_CHECKIN`) — sudah ada, masuk WI.

### FR-8 — Operasional & deployment
1. Varian tetap build-time (keputusan F-R4): deployment manufacturing = build frontend dengan
   `VITE_APP_VARIANT=manufacturing` (compose sudah meneruskan build arg) + set env API/jobs
   sesuai D1/D2. Dokumentasikan resep deploy per varian di `docs/operations/`.
2. Work Instruction manufacturing dibuat (operator + foreman) — saat ini WI hanya ada untuk
   mode salvaging (`docs/Work Instruction/`).
3. UI manufacturing mengikuti Corporate Color System + UI Engineering Standards (CLAUDE.md) —
   halaman baru memakai `#0077b6` sebagai primary, bukan `#0096c7`.

---

## 5. Non-goals (v1 varian manufacturing)

- **Tidak** mendesain ulang identitas/guard SAP staging ([[concepts/sap-staging-identity]]).
- **Tidak** mengubah mekanisme varian (build-time dispatcher — keputusan F-R4 tetap).
- **Tidak** runtime switching per-user/per-request antara dua varian dalam satu instance.
- **Tidak** menggabungkan pasangan halaman varian (collapse behind props) — itu pekerjaan
  terpisah [[REFACTOR_PLAN]] F-R4, jangan dicampur dengan pembangunan fitur.
- **Tidak** menyentuh jalur payroll `original_planhours` dari `sow.planhours` untuk data
  salvaging — invariant [[concepts/payroll-data-path]].

---

## 6. Risiko utama

1. **Payroll/insentif** (terbesar): jalur insentif existing berdiri di `sow.planhours` +
   `sow_standard` ([[concepts/payroll-data-path]]). Task manufacturing datang dari
   `ms_project_task` — sumber jam standar untuk insentif manufacturing belum terdefinisi (→ D5).
   Salah desain di sini merusak gaji orang.
2. **Posting SAP diam-diam salah klasifikasi**: kalau aturan `ZCONF_TYPE` salvaging dibiarkan
   berlaku untuk order manufacturing (mis. kebetulan berprefix `32`), baris terkirim sebagai
   `RW` tanpa ada yang sadar (→ D3).
3. **Plant & `source_key`**: menyalakan plant baru mengubah kunci anti-double-post (J3) —
   wajib ikuti prosedur README staging, jangan improvisasi.
4. **Halaman shared regresi dua arah**: perubahan untuk manufacturing di halaman shared bisa
   merusak salvaging yang sedang produksi — setiap perubahan FR-4 diuji di KEDUA varian.

---

## 7. Keputusan terbuka (WAJIB dijawab sebelum `approved`)

| ID | Pertanyaan | Opsi / fakta pendukung | Rekomendasi |
|---|---|---|---|
| D1 | Tabel master order untuk eligibility SAP manufacturing? | `ph3_order` = master produksi (feed Lambda satu-satunya); `qh3_order` = QA/inspection (~85 baris, skema identik, TIDAK direferensikan API) — bukan kandidat | Tetap `ph3_order`, dibedakan per `plant_code`/workcenter; pastikan order manufacturing masuk feed Lambda |
| D2 | Nilai `WERKS`/plant manufacturing? (env sekarang `PLANT_SSB=5100`, ETL `PLANT_FILTER=5051`; payload contoh memuat keduanya) | Menentukan `WERKS`, `ZTIMESHEETID` jam mesin, filter ETL, dan `source_key` (J3). Termasuk: PERNR outsource per plant (J2) | Owner konfirmasi mapping plant↔varian — jangan ditebak dari kode |
| D3 | Aturan `ZCONF_TYPE` untuk order manufacturing? | Sekarang: `*OT`→OV, `32*`→RW, else RG (B1/J1). Kode aktivitas non-produktif 4-digit & M1/M2 ikut ditinjau | Definisikan eksplisit per konvensi order manufacturing; implement satu sumber aturan (FR-5.1) |
| D4 | Semantik Check In manufacturing? | (a) identik "Start" salvaging (auto-checkout lalu insert); (b) check-in per task tanpa auto-checkout; mode single/multiple berlaku atau tidak | Mulai dari (a) — memakai kontrak API existing, deviasi hanya bila proses lantai produksi menuntut |
| D5 | Sumber jam standar & jalur insentif manufacturing? | Salvaging: `sow.planhours`/`sow_standard`. Manufacturing: `planned_work_minutes` dari MS Project? Tabel standar baru? | Blocking untuk payroll — putuskan bersama pemilik proses HR/insentif sebelum FR-1 dibangun |
| D6 | Binding device→area/bay dipersist ke mana? | `localStorage` (sekarang, UAT §9 mencatatnya sebagai batasan) vs tabel DB (`tablet_status` sudah ada) | Tabel DB + endpoint admin |
| D7 | Master Area/Bay dari mana? | Hard-code `AREA_OPTIONS` (sekarang, 18 area) vs tabel DB | Tabel DB (perubahan area tidak boleh butuh deploy) |
| D8 | Perlu `SowVerificationPage` versi manufacturing? | Route `/sow-verification` sekarang hardcode versi salvaging (F3) | Tentukan kebutuhan verifikasi progres manufacturing; kalau tidak perlu, sembunyikan menu-nya di varian manufacturing |
| D9 | Penanda "selesai" + TTS untuk manufacturing? | Salvaging: Finish → `/sow/finish/` + TTS per `ssbr_id`. Manufacturing belum ada | Tentukan: apakah task manufacturing selesai otomatis via progress MS Project, atau perlu aksi eksplisit operator |
| D10 | Jam mesin (`mch_transaction`/SSB_OEE) ikut untuk mesin manufacturing? | ETL menyalin semua mesin tanpa filter plant (J5); staging M1/M2 semantik SSB_OEE (B3) | Jawab bersama D2; kalau ya, verifikasi peta status M1/M2 berlaku untuk mesin manufacturing |
| D11 | Dashboard & EWS mencakup data manufacturing? | KPI EWS memakai eligibility match `TGT_TABLE` (`sow_no_match`); dashboard exclude TECO via `ph3_order` (B4) | v1: verifikasi angka tidak salah campur; perluasan KPI manufacturing = fase berikutnya |

---

## 8. Urutan pengerjaan yang disarankan

1. **Fase 0 — Keputusan & data**: jawab D1–D11; validasi order manufacturing ada di master;
   MS Project sync + bay schedule terisi (FR-0).
2. **Fase 1 — Alur operator inti**: FR-1 (check-in nyata), FR-2 (hardening select job),
   FR-3, FR-4 (kompatibilitas halaman shared). Hasil: operator manufacturing bisa
   check-in → kerja → check-out → tervalidasi.
3. **Fase 2 — Jalur SAP**: FR-5 + FR-6 + bagian jobs (J1–J4) sesuai D2/D3; uji post ke SAP
   dengan order manufacturing nyata.
4. **Fase 3 — PPC & operasional**: FR-7, FR-8 (deploy per varian, WI manufacturing), D8/D9.

---

## 9. Lampiran — sumber scan (2026-07-14)

- Frontend: `apps/web/src/config/appVariant.js`; dispatcher di `apps/web/src/pages/TIMESHEET/{TimesheetMainMenuPage,SelectJobPage}.jsx`, `apps/web/src/pages/PPC/SowSchedulingPage.jsx`; folder varian `pages/TIMESHEET/{salvaging,manufacturing}/`, `pages/PPC/{salvaging,manufacturing}/`; `router/index.jsx:197` (hardcode sow-verification); Dockerfile + `docker-compose.yml` service `frontend` (build arg varian).
- Backend: `apps/api/controllers/timesheet_transactionController.js` (`postToSap` :1269-1477, `inferActivityType` :126-137), `machineHoursValidationController.js:46-85`, literal `ph3_order` di 4 controller (§3.1 B4).
- Jobs: `jobs/sap_staging/README.md` (aturan staging + Batas Berbahaya), `stage_sap_timesheet.py`, `stage_timesheet_transaction.py`, `post_sap_staging.py`, `jobs/etl/etl_sync_v2.py`, `etl_order.py`, `etl_machinehours.py`, `aws/sap-ph3-order-lambda/index.js`.
- Dokumen: [[timesheet/MANUFACTURING_VERSION_UAT]], [[REFACTOR_PLAN]] (F-F5/F-R4), [[_isolasi/ms_project_PRD]], [[timesheet/PLANHOURS_GUARD_IMPLEMENTATION_PLAN]], [[timesheet/sow Scheduling master plan]], konsep-konsep di §pembuka.
