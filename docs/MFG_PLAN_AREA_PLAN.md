---
type: plan
status: planning
tags: [domain/msproject, domain/sow]
updated: 2026-08-03
---

# Rencana — Scheduling Area Manufaktur (4 requirement owner)

> Analisa + rencana untuk `docs/my raw task/mfg plan area.md`. Menindaklanjuti
> [[SOW_SCHEDULING_MFG_UI_REDESIGN_PLAN]] (rombak UI 30 Juli + iterasi 2) dan bersinggungan
> dengan [[MSPROJECT_COLLAB_HARDENING_PLAN]]. Acuan: `CLAUDE.md` (Corporate Color System +
> UI Engineering Standards), [[KONVENSI]].
>
> **Ketujuh keputusan owner sudah diambil (§5, 3 Agustus 2026).** Fase 0–6 sudah **ditulis** dan
> lolos build/lint/test (§8), tetapi **belum di-commit, belum dideploy, dan dua migrasi belum
> dijalankan**. Status frontmatter tetap `planning` karena belum ada fase yang rilis ([[KONVENSI]] §3).

## 0. Permintaan owner (mentah)

1. Di halaman area, filter schedule **hanya 7 hari ke depan DAN yang belum selesai**. Schedule
   berasal dari MS Project = task di database.
2. Tampilan `/sow-scheduling/area` tidak efisien dan berat → **rombak total**. Layar pertama
   HANYA layout area full-screen; user pilih bay dulu, baru panel kiri memunculkan order yang
   bisa dipilih. User juga bisa **booking bay di luar job** (parkir unit, taruh barang).
3. Di scheduling area harus bisa **multiple order ditumpuk** pada satu bay.
4. Di SOW table, PPC bisa ganti workcenter ke **C5100SUB** untuk menandai operasi dikerjakan
   subcont — hours ditagihkan ke vendor, bukan hours yang dikonsumsi internal.

## 1. Metode & keandalan temuan

Skema dan data **diverifikasi langsung ke DB prod Cikupa** (`100.80.101.53:5433` → tunnel lokal
`127.0.0.1:5441`, db `ptssb`, read-only). File `.sql` migrasi **tidak** dipakai sebagai sumber
kebenaran — lihat anomali A-06.

| Sumber | Status |
|---|---|
| Query SQL yang dijalankan sendiri | Terverifikasi, aman dikutip |
| Pembacaan kode langsung (path:baris tercantum) | Terverifikasi |
| Angka dari agen investigasi (ditandai ⚠) | **Belum direproduksi.** Verifikator menandai sebagian angka investigator tidak reproducible. Jalankan ulang sebelum dikutip ke pihak lain. |

## 2. Reality check — permintaan vs kenyataan

### R1 — Filter "7 hari ke depan DAN belum selesai"

Permintaan ini terbelah jadi dua bagian dengan nasib berbeda.

**"Belum selesai" — ADA.** Sumbernya `ph3_order.operation_description` (status operasi SAP):

| Nilai | Ops | Order | Arti |
|---|---|---|---|
| REL | 4.355 | 67 | Released, belum dikerjakan |
| PCNF | 451 | 47 | Partially confirmed, sedang jalan |
| MCNF | 100 | 32 | Fully confirmed — **selesai** |
| TECO | 1.693 | 33 | Order technically complete |
| LKD | 739 | 15 | Locked |

Cross-tab konsisten: order REL bisa punya ops REL/PCNF/MCNF; order TECO semua ops-nya TECO.

**"7 hari ke depan" — nyaris tidak ada.** Tanggal hanya hidup di `ms_project_task.plan_start/
plan_finish` (terisi 1.026 dari 1.937 task), dan tabel itu cuma mencakup **3 dari 115 order** di
`sow`. `sow.plan_start`/`plan_finish` NULL 7.344/7.344.

**Tidak ada sinyal selesai di level task.** `ms_project_task.actual_start`, `actual_finish`,
`actual_progress`, `actual_work_minutes` — **nol terisi** dari 1.937 baris. `sow.systemstatus`
dan `sow.status` NULL 100%. `timesheet_transaction` 2 baris. `production_operations` 0 baris.
Akibatnya guard `COALESCE(systemstatus,'') NOT IN ('TECO','CLSD')` yang dipakai seluruh dashboard
**mati total** — tidak memfilter apa pun.

**Konsekuensi angka:** filter harfiah (punya task MSP overlap `[today, today+7]` **dan** non-TECO)
menyisakan **2 dari 115 order**. Ditambah 39 order berkode non-numerik (`P26-*`, order_type PP01)
yang secara struktural tidak akan pernah punya task MS Project.

⚠ Agen melaporkan filter ini **menyembunyikan order yang sedang memakai bay minggu ini**: order
1000128544 memegang reservasi 31 Jul–6 Agu padahal 83 task-nya berakhir 15 Juli. Akar masalahnya
baseline MS Project tidak pernah di-rebaseline (⚠ 780 dari 995 task aktif bertanggal sudah lewat).
Masalah hulu, bukan masalah filter.

→ **Diselesaikan oleh D6:** filter jadi tab/bucket, bukan penyembunyian.

### R2 — Rombak UI

**Keluhan "berat" valid, tapi penyebabnya sempit.** Terverifikasi: **nol `React.memo`** di 1.499
baris `SchedulingAreaPage.jsx`, dan state `orderSearch` hidup di komponen yang sama dengan peta
lantai — tiap ketikan me-render ulang seluruh ~79 sel bay. Tidak ada `AbortController`. Klaim
"grid 4.404px di-relayout tiap render" **tidak terbukti** — React tidak memutasi DOM saat props
tak berubah.

→ Memoization + pemecahan komponen sudah menyelesaikan keluhan "berat". Sisa argumen untuk
merombak adalah murni UX. Itu sah, tapi jangan dijual sebagai perbaikan performa.

**"Full-screen" bertabrakan dengan keterbacaan.** Peta butuh 4.404px per lane (38 kolom × 112px
+ gap). Menghapus panel kiri hanya menambah 332px (**7,5%**). Fit-to-width sungguhan menghasilkan
kolom **44px di 1920px** dan **24px di 1366px** — lebih sempit dari 26px yang **owner sendiri
tolak pada 30 Juli** ([[SOW_SCHEDULING_MFG_UI_REDESIGN_PLAN]] §6).

→ **Diselesaikan oleh D5:** peta dua tingkat. Tingkat 1 fit-width dengan informasi minim (angka
saja), tingkat 2 detail penuh setelah area dipilih. Owner menerima sel kecil di tingkat 1 karena
isinya memang cuma angka.

### R2b — Booking di luar job

`ms_project_bay_schedule.order_no` bertipe `text NOT NULL`, plus FK `(project_id, task_id) →
ms_project_task`. `createBaySchedule` menolak payload tanpa `order_no`. Tidak ada satu pun jalur FE
yang bisa membuat booking tanpa task hari ini. **Ini pekerjaan skema, bukan UI.**

→ **Diselesaikan oleh D3 + Fase 2:** kolom `booking_type` + `purpose`, `order_no` nullable.

### R3 — Multiple order per bay

Diblokir keras di backend: dua blok conflict-check identik di `createBaySchedule`
(`apps/api/services/msProjectService.js:1974-1992` dan `:2089-2108`) menolak setiap overlap
bay+tanggal dengan `409 BAY_SCHEDULE_CONFLICT`. **DB sendiri tidak melarang apa pun** — tidak ada
EXCLUDE/UNIQUE constraint.

→ **Diselesaikan oleh D3:** 409 dihapus seluruhnya, diganti peringatan lunak. Tidak ada bay yang
eksklusif, termasuk booth PT/BL dan booking non-job.

### R4 — Subcont via C5100SUB

Mekanisme yang diminta **tidak bisa memindahkan jam ke mana pun**. Tiga alasan, semua terverifikasi:

1. **`sow.workcenter` adalah cermin ETL SAP, bukan field milik PPC.** Di prod, `sow.workcenter`
   identik dengan `ph3_order.work_center` untuk **7.338 dari 7.338 baris (0 beda)**. ETL
   `jobs/etl/etl_sync_v2.py:504-513` menimpanya tanpa syarat:
   ```sql
   ON CONFLICT (order_no, operation_no) DO UPDATE SET
       workcenter = EXCLUDED.workcenter,   -- ditimpa, tanpa guard
       planhours  = EXCLUDED.planhours, ...
   ```
   Bandingkan `sowController.js:2503` yang sengaja melindungi `status` dengan
   `COALESCE(sow.status, EXCLUDED.status)` — seseorang pernah sadar masalah ini untuk `status`,
   tapi `workcenter` dibiarkan. Penanda subcont akan hilang diam-diam pada konfirmasi SAP
   berikutnya, tanpa error, tanpa log.
2. **Jam tidak ikut berpindah.** ⚠ `planhours` read-only di layar SOW History, tidak ikut payload
   `PUT /sow/history-order/:orderNo/info`, dan backend `/info` tidak menyentuhnya.
3. **`C5100SUB` belum ada wujudnya.** `public.workcenter` di prod hanya **5 baris**
   (C5100BPP/FAB/FIT/MPR/QIM). Tidak ada di SAP, tidak ada di kode, tidak ada endpoint untuk
   menambah baris master. `resolveWctGroup()` (`sowController.js:157`) mengembalikan
   `wct_group = NULL` untuk kode tak dikenal.

Seluruh **67.838,66 jam** internal duduk di 5 kode C5100*. Tidak ada kolom vendor/PO/rate di
database; `costcenter_rate` NULL semua.

→ **Diselesaikan oleh D4:** penanda jadi flag terpisah, `workcenter` tidak disentuh. Kode
`C5100SUB` **tidak dipakai sama sekali**.

### R0 — Gerbang yang lebih mendasar dari keempatnya

Form reservasi mewajibkan minimal satu task terpilih (`canSubmit`,
`SchedulingAreaPage.jsx:708`), dan task hanya berasal dari `ms_project_task`. Karena hanya 3 dari
115 order punya task MSP, **hanya 3 order yang bisa dipesan hari ini**.

→ **Keputusan D2: gerbang ini DIPERTAHANKAN.** Reservasi tetap wajib task-level. Yang berubah
hanya keterbacaannya: pool order dipisah jadi tab "Ada jadwal MSP" vs "Belum ada jadwal", dan yang
belum punya jadwal diarahkan ke `/sow-scheduling/map` untuk di-map dulu. **Konsekuensi yang
diterima owner: halaman ini melayani booking untuk 3 order sampai hulu MS Project terisi.**

## 3. Anomali (di luar yang ditanyakan owner)

| ID | Sev | Temuan | Kenapa penting |
|---|---|---|---|
| A-01 | **Kritis** | `saveSowOrderRevision` melakukan `DELETE FROM sow WHERE order_no` lalu INSERT ulang dengan whitelist 33 kolom (`EDITABLE_SOW_COLUMNS`, `sowController.js:27-61`). **`people_required` tidak ada di whitelist.** | Fitur headcount yang dibangun 30 Juli kehilangan datanya tiap Create Revision. Mengunci D4: **kolom baru apa pun di tabel `sow` dijamin hilang.** (`codenumber` aman — `GENERATED ALWAYS AS ... STORED`.) |
| A-02 | **Kritis** | ⚠ Reservasi order-level warisan menyebarkan satu set task yang sama ke SETIAP bay yang dipesan order itu. Order 1000127649 → 53 task identik di B37, A36, A30–A27, A24. | Operator di empat bay berbeda melihat daftar job yang persis sama. Bug data aktif di produksi. **Ditangani Fase 1.** |
| A-03 | Tinggi (laten) | `PATCH /ms-project/sow-orders/:order_no/operations/people` tidak terdaftar di `rbac/manifest.js` maupun ALLOWLIST. Guard default-deny (`rbacGuard.js:61` → `unmapped_write`). `PUT /ms-project/projects/:id/status` juga tidak terpetakan. | Saat ini aman: `RBAC_ENFORCE` tidak diset (`rbacGuard.js:16`, log-only). Begitu dinyalakan → **403 untuk semua role termasuk administrator**, error ditelan toast. **Ditangani Fase 0.** |
| A-04 | Tinggi | `POST/DELETE /ms-project/bay-schedules` terikat feature `ms_project_admin` yang juga mencakup upload `.mpp`, checkout, force-checkin, publish. | Memberi hak booking = memberi kendali penuh file MS Project. **Ditangani Fase 0 (pemecahan feature per D1).** |
| A-05 | Tinggi | ⚠ Route `/sow-scheduling` dan anaknya didaftarkan dengan `page()` biasa, tanpa `RequireFeature`. Bandingkan `/sow-orders` yang memakai `guardedPage('sow_management')`. | Backend masih log-only → guard FE satu-satunya lapisan aktif, dan terbuka penuh. **Ditangani Fase 0.** |
| A-06 | Tinggi | Ledger migrasi tidak dapat dipercaya: `schema_migrations` **3 entri** vs **67 file**. `sow.people_required` ada di prod tapi tidak tercatat. ⚠ Constraint `uq_sow_order_operation` ada di prod tapi tidak ada di file repo. | Setiap DDL harus diverifikasi ke `information_schema`/`pg_constraint`. |
| A-07 | Tinggi | **Dikoreksi 3 Agu.** Klaim agen "2 user ber-role `staff`" **tidak terbukti** — tidak ada role `staff` di prod. Sebaran nyata: `user` 21, `administrator` 8, `supervisor` 4, **`roles` NULL 3**, `foreman` 1, `warehouse` 1. Role tak dikenal / NULL → `UNKNOWN_ROLE_LEVEL` = NO_ACCESS untuk semua fitur (`permissionMatrix.js`). | 3 user tanpa role tidak bisa membuka apa pun, dan gejalanya terlihat seperti halaman rusak. Perlu dibereskan bila salah satunya calon pemakai scheduling. |
| A-08 | Sedang | **Peta area tidak punya sumbu waktu.** `buildSchedulesByBay` memasukkan semua jadwal yang beririsan dengan window fetch ke satu sel dan merendernya bertumpuk. | Dua reservasi *berurutan* sudah tampak menumpuk. Begitu stacking dibuka, "dua order barengan" tak bisa dibedakan dari "dua order bergantian". **Kursor tanggal wajib — Fase 5.** |
| A-09 | Sedang | Tidak ada endpoint UPDATE untuk bay schedule (hanya GET/POST/DELETE). Menambah task ke reservasi yang ada → 409 melawan baris sibling-nya sendiri. Pembatalan = loop DELETE non-atomik. | Penjadwalan praktis write-once. **Ditangani Fase 2.** |
| A-10 | Sedang | FE minta 80 order sementara pool 115. ⚠ Yang tersembunyi = 19 REL + 16 TECO. Paginasi backend **sudah ada**, tapi service FE membuang meta respons. | 19 order released tidak pernah terlihat tanpa mengetik. **Ditangani Fase 4.** |
| A-11 | Sedang | ⚠ `ms_project_task.workcenter` teks bebas, 79 nilai distinct, termasuk `'flat tray'`, `'cek'`, `'Target kedatangan hari ini 25/06'`. Filter job operator memakai kesetaraan string persis. | Alasan tambahan kenapa penanda subcont tidak boleh menumpang kolom workcenter (D4). |
| A-12 | Sedang | ⚠ 7 order phantom di `ms_project_task` (490 task aktif) tanpa pasangan di `sow`/`ph3_order`; terbesar 1000126495 (136 task, 32 di window 7 hari). | Menyumbang 32 dari 47 task in-window. **Dibuang dari pool per D7.** |
| A-13 | Sedang | ⚠ `workcenter.machineid` NULL di 5/5 baris. `useWorkcenterData` memfilter habis semua baris → WorkcenterSelect kosong total di prod. | Tiga konsumen hilir sudah mati senyap. Tidak lagi menghalangi D4 (kode `C5100SUB` tidak jadi dipakai), tapi tetap utang. |
| A-14 | Sedang | ⚠ `cancelBaySchedule` FE mengirim actor hardcode `'web-manufacturing'`; `created_by` text tanpa FK, isi campur. Aktor dibaca dari **body payload**, bukan sesi → bisa dipalsukan klien. | Kepemilikan tidak bisa ditegakkan. Untuk booking non-job, "siapa yang membatalkan parkir saya" penting. **Ditangani Fase 0.** |
| A-15 | Rendah | Input rentang timeline `<input type="date">` tanpa min/max. Mengetik 2099 → ⚠ ~26.000 kolom DOM per baris bay. | **Ditangani Fase 4 (hard cap).** |
| A-16 | Rendah | Data sampah prod: baris CANCELLED bertanggal **2099-02-03** buatan `'codex-smoke-test'`, salah satunya memakai kode bay `{BP4,BP3}` yang sudah tidak ada di topologi. `bay_codes` tidak divalidasi terhadap master area. | **Dibersihkan di Fase 2.** |
| A-17 | Sedang | **Terverifikasi 3 Agu.** Dari 13 reservasi `RESERVED`, hanya **3** yang `order_no`-nya ada di `sow`/`ph3_order` → **10 reservasi yatim**. Di window 7 hari: 5 dari 8 baris aktif milik order yatim `1000120555`. | Dasar keputusan D7: yatim dibuang dari **pool**, tapi **tetap tampil di peta** — kalau disembunyikan, bay tampak kosong padahal terpakai. |

## 4. Rencana berfase

Urutan ditentukan ketergantungan nyata. **Fase 5 (UI) tidak boleh didahulukan** meski itu yang
paling terlihat owner — mengerjakannya sebelum Fase 2 menghasilkan layar yang menolak penyimpanan.

| Fase | Judul | Effort | Status |
|---|---|---|---|
| 0 | Pecah RBAC + guard FE + aktor dari sesi | M | **kode selesai** |
| 1 | Hentikan fan-out reservasi order-level | S | **kode selesai** |
| 2 | Skema & API bay booking (stacking + non-job) | **M** | **kode selesai** · migrasi belum jalan |
| 3 | Mode booking non-job di UI + penanda "belum ada jadwal" | S | **kode selesai** |
| 4 | Pool order: tab, paginasi, metadata | M | **kode selesai** |
| 5 | Rombak UI peta area (dua tingkat) | L | **kode selesai** |
| 6 | Penanda subcont + keluarkan dari beban internal | M | **kode selesai** · migrasi belum jalan |
| ~~7~~ | ~~Entitas subcontract penuh (vendor/PO/rate)~~ | — | **dibatalkan per D4** → §7 |

---

### Fase 0 — Pecah RBAC, guard FE, aktor dari sesi `[M]`

**Tujuan:** memberi owner kontrol per-fitur yang spesifik (per D1) dan memastikan menyalakan
`RBAC_ENFORCE=1` tidak mematikan fitur secara senyap.

**Pemecahan feature `ms_project_admin`** — 16 route dipecah jadi 4 feature:

| Feature | Route | Untuk |
|---|---|---|
| `bay_scheduling` **(baru)** | `POST`/`DELETE`/`PUT` `/ms-project/bay-schedules*`, `PATCH /ms-project/sow-orders/:no/operations/people` | Scheduler bay (PPC) |
| `msproject_mapping` **(baru)** | `PUT /ms-project/projects/:id/tasks/map-sow-order` | Yang memetakan operasi SAP → task MSP (prasyarat booking, per D2) |
| `msproject_collab` **(baru)** | `POST /ms-project/projects`, `/bulk-load`, `/:id/file`, `/:id/checkout`, `/:id/heartbeat`, `PUT /:id/sync`, `POST /:id/publish`, `/:id/checkin`, `PUT /:id/status` | Planner yang mengedit file `.mpp` |
| `ms_project_admin` *(dipersempit)* | `POST /:id/force-checkin`, `/calendars/refresh-from-shifts`, `/resources/refresh`, `POST`/`DELETE` `/:id/resources*` | **Scheduling administrator** |

- `apps/api/rbac/features.js` + `apps/web/src/rbac/featureRegistry.js` — daftarkan 3 feature baru
  (harus cermin satu sama lain).
- `apps/api/rbac/permissionMatrix.js` — ketiga feature baru **default `NO_ACCESS` untuk semua role**;
  `administrator` tetap dapat lewat `DEFAULT_KEY: FULL_ACCESS`. Owner meng-assign per orang lewat
  `rbac.user_permissions` (mekanisme override sudah ada dan dipakai di prod).
- `apps/api/rbac/manifest.js` — pindahkan 16 route ke feature barunya; daftarkan dua route yang
  selama ini `unmapped_write` (A-03).
- `apps/web/src/router/index.jsx` — `/sow-scheduling/area` dibungkus `guardedPage(..., 'bay_scheduling')`;
  `/sow-scheduling/map` dengan `'msproject_mapping'` (A-05).
- `apps/web/src/services/msProjectService.js` — hentikan actor hardcode `'web-manufacturing'` pada
  `cancelBaySchedule` (A-14).
- `apps/api/services/msProjectService.js` — ambil aktor dari header/sesi, bukan body
  (`actorFromBody` dapat dipalsukan klien).
- Skrip cek konsistensi: parse `apps/api/routes/*.js`, cocokkan setiap non-GET ke MANIFEST/ALLOWLIST.
- **Periksa 3 user dengan `roles` NULL** (A-07) — kalau salah satunya calon pemakai scheduling,
  role-nya harus diisi dulu.

**Verifikasi:** skrip konsistensi → 0 selisih. Jalankan API lokal dengan `RBAC_ENFORCE=1`; user
dengan override `bay_scheduling` bisa booking tapi **403 di force-checkin**; user dengan
`ms_project_admin` bisa force-checkin tapi **403 di POST bay-schedules**. Log server nol baris
`unmapped_write`.

### Fase 1 — Hentikan fan-out reservasi order-level `[S]`

**Tujuan:** menghilangkan tampilan 53 task identik di empat bay berbeda (A-02).

- `apps/api/services/msProjectService.js` — `listBayScheduleTasks` (~1739-1853): cabang order-level
  (`s.task_id is null`) berhenti mem-fan-out seluruh task order ke setiap bay.
- Migrasi data: konversi reservasi order-level aktif jadi task-level, atau tandai eksplisit sebagai
  order-level di respons agar UI menampilkannya berbeda.
- `apps/web/src/pages/TIMESHEET/manufacturing/SelectJobPage.jsx` — penanda bila entri berasal dari
  reservasi order-level.

**Verifikasi:** `GET /ms-project/bay-schedule-tasks` untuk B37, A36, A30, A24 → daftar task tidak
lagi identik. Layar operator di dua bay berbeda menampilkan job berbeda.

### Fase 2 — Skema & API bay booking `[M]`

> Turun dari **L** ke **M** karena D3 menghapus konsep eksklusivitas: tidak ada `is_exclusive`,
> tidak ada advisory lock, tidak ada 409.

**Tujuan:** membuka multi-order per bay dan booking non-job di lapisan yang benar.

- **DDL `ms_project_bay_schedule`:**
  - `booking_type text not null default 'ORDER'` — CHECK in (`ORDER`,`PARKING`,`STORAGE`,`MAINTENANCE`,`OTHER`)
  - `purpose text` — wajib (CHECK) bila `booking_type <> 'ORDER'`
  - `schedule_group_id uuid` — satu reservasi = satu grup, N baris task
  - `order_no` → **nullable**, dengan CHECK: wajib terisi bila `booking_type = 'ORDER'`
  - **Tidak ada** `is_exclusive` (per D3).
- **Hapus `409 BAY_SCHEDULE_CONFLICT` seluruhnya.** Query overlap tetap dijalankan, tapi hasilnya
  dikembalikan sebagai `warnings: [{ type: 'BAY_OVERLAP', occupants: [...] }]` pada respons `201`.
  Ekstrak jadi satu fungsi `findBayOverlaps()` yang dipakai kedua cabang `createBaySchedule`
  (`:1974-1992` dan `:2089-2108`) — sekarang keduanya duplikat.
- Endpoint baru `GET /ms-project/bay-schedules/occupants?bay_codes=&start=&end=` — dipakai UI untuk
  menampilkan penghuni bay **sebelum** submit (peringatan lunak yang berguna, bukan penyesalan).
- `PUT`/`PATCH /bay-schedules/:schedule_group_id` (geser tanggal, tambah/hapus task, perpanjang);
  pembatalan jadi atomik satu transaksi per grup (A-09).
- `listBaySchedules`: SELECT kolom baru; lewati resolusi `sow` dan auto-resolve `project_id` untuk
  booking non-job; tambah LIMIT/paginasi.
- Validasi `bay_codes` terhadap topologi area (`config/manufacturingAreas.js`), bukan sekadar regex
  bentuk; bersihkan 2 baris sampah 2099 (A-16).
- Daftarkan route write baru di manifest RBAC (feature `bay_scheduling`).

**Verifikasi (test integrasi):** (a) dua order berbeda overlap di bay yang sama → **keduanya 201**,
respons kedua membawa `warnings.BAY_OVERLAP` berisi order pertama; (b) order ditumpuk di atas
booking `PARKING` → 201 + warning; (c) `booking_type=PARKING` tanpa `order_no` dengan `purpose`
terisi → 201; (d) `booking_type=ORDER` tanpa `order_no` → 400; (e) `booking_type=PARKING` tanpa
`purpose` → 400; (f) tambah task ke `schedule_group_id` yang sudah ada → 2xx, bukan 409; (g)
`bay_codes` berisi kode di luar topologi → 400. Verifikasi skema ke `information_schema`/
`pg_constraint`, **bukan** ke file migrasi.

### Fase 3 — Mode booking non-job + penanda "belum ada jadwal" `[S]`

> Diperkecil dari rencana awal: mode **order-level dibatalkan** karena D2 mempertahankan syarat
> task-level. Yang tersisa hanya mode non-job dan penandaan.

**Tujuan:** memungkinkan booking parkir/taruh barang, dan membuat jelas order mana yang belum bisa
dibooking beserta jalan keluarnya.

- Form reservasi dapat mode kedua: **NON-JOB** (`booking_type` + `purpose` wajib, tanpa order,
  tanpa task).
- Order tanpa task MSP: tombol reservasi **nonaktif** dengan penjelasan + tautan ke
  `/sow-scheduling/map` ("Map operasi SAP dulu agar order ini punya jadwal"). Bukan error saat
  submit — dicegah sejak awal.
- Write-back headcount (`updateOperationPeople`) tidak lagi gagal senyap: tampilkan error yang
  menghentikan submit.

**Verifikasi:** booking non-job tersimpan dan tampil dengan label `purpose` di peta & timeline, dan
TIDAK muncul di `/ms-project/bay-schedule-tasks`. Order tanpa task MSP: tombol reservasi mati dengan
tautan ke Map. Matikan endpoint headcount sementara → submit memberi pesan jelas, bukan lanjut diam-diam.

### Fase 4 — Pool order: tab, paginasi, metadata `[M]`

**Tujuan:** menaikkan order yang perlu dijadwalkan tanpa menyembunyikan backlog (D6), dan
menghentikan truncation senyap 35 order (A-10).

- `listSowOrders` (`:1167-1213`): parameter **OPSIONAL** (`window_start`/`window_end`, `completion`)
  dengan default yang **mempertahankan perilaku lama**; tambah kolom turunan `sap_status` (dari
  `ph3_order`), `has_msp_task`, `earliest_plan_start`/`latest_plan_finish`, `active_reservations`,
  dan `count(*) over ()` sebagai total.
- Implementasi sebagai `EXISTS`/`NOT EXISTS`, bukan JOIN, agar baris tidak berganda; normalisasi
  kunci konsisten (`ltrim`) dengan `getSowOrderOperations` dan `listBaySchedules`.
- **Buang order phantom** dari pool: `INNER JOIN`/`EXISTS` ke `ph3_order` (D7, A-12).
- **"Belum selesai" = REL + LKD** (82 order), diperlakukan sama, tanpa lane terpisah (D6).
  TECO/MCNF = selesai.
- **Tab** (bukan bucket menumpuk, per D6):
  `[Perlu dijadwalkan]` `[Belum ada jadwal MSP]` `[Sudah terjadwal]` `[Selesai/TECO]`
- FE: teruskan meta `limit/offset/total` (saat ini dibuang); tambah `AbortController`;
  indikator "menampilkan 80 dari 115" + tombol muat lagi memakai `offset` yang sudah ada.
- Window reservasi timeline: default 7 hari + preset 7/14/30, **dengan hard cap** min/max di input
  dan validasi rentang di backend (A-15).
- **Dua kontrol tanggal terpisah** (D6): timeline pakai window **reservasi**
  (`start_date`/`end_date`), pool order pakai window **task MSP** (`plan_start`/`plan_finish`).
- `MapSapOperationPage.jsx` **tidak** mengirim parameter baru — halaman itu justru yang MEMBUAT task
  MS Project; memfilter "harus punya task MSP" akan menciptakan deadlock ayam-telur.

**Verifikasi:** snapshot test — `GET /ms-project/sow-orders` tanpa parameter baru mengembalikan
jumlah & urutan identik dengan baseline (bukti MapSapOperationPage tidak terdampak). Dengan parameter
aktif, jumlah tiap tab sama dengan query SQL terpisah. Klik "muat lagi" sampai habis → total unik
sama dengan jumlah order non-phantom. Rentang 2099 → ditolak/clamp.

### Fase 5 — Rombak UI peta area (dua tingkat) `[L]`

**Tujuan:** layar pertama yang muat penuh dan enak dilihat, stacking yang terbaca, dan hilangnya
render ulang peta saat mengetik.

**Tingkat 1 — overview (fit-width, tanpa scroll horizontal):**
- Seluruh bay muat di layar. Sel boleh kecil — isinya **hanya angka**: jumlah order dan jumlah
  aktivitas pada tanggal kursor, plus warna okupansi.
- Tidak ada panel order di tingkat ini (sesuai permintaan awal "layar pertama hanya layout area").
- Klik area → tingkat 2.

**Tingkat 2 — area terpilih (lebar penuh):**
- Kiri: daftar order + operasinya (tab dari Fase 4). Kanan: area terpilih + daftar bay-nya.
- **Drag-and-drop hidup di tingkat ini** (D5). Drop ke bay → panel pilih operasi seperti sekarang.
- **Prefill tanggal booking dari jadwal MS Project** task terpilih (`plan_start`/`plan_finish`).
  Kalau kosong → peringatan "job belum ada jadwal" + tautan ke Map (sejalan Fase 3).
- Seragamkan drag ke `@dnd-kit` yang sudah terpasang.

**Lintas tingkat:**
- Ekstrak `apps/web/src/features/bayScheduling/` (`FloorMapOverview`, `AreaDetail`, `BayCell`,
  `OrderPanel`, `ReservationDetail`, `useBaySchedules`, `useSowOrders`, `constants`) mengikuti
  preseden `features/progress`; halaman jadi orkestrator ~150 baris.
- **Kursor tanggal (as-of day)** — wajib di kedua tingkat; tanpa itu tumpukan tak bisa dibedakan
  dari reservasi berurutan (A-08).
- **Peringatan lunak okupansi**: saat bay dipilih, panel menampilkan siapa saja yang sudah memakai
  bay itu pada rentang yang dipilih (memakai endpoint `occupants` dari Fase 2). Bukan blokir.
- Dedupe badge & lane per **reservasi** (`schedule_group_id`), bukan per baris jadwal — di sel bay
  dan `BayReservationTimeline`.
- Booking non-job dan operasi subcont ditampilkan dengan **badge/warna berbeda** dari job internal.
- `React.memo` pada sel bay/badge/blok area/kartu order; pindahkan state pencarian order ke komponen
  anak; `useCallback` untuk seluruh handler; hapus arrow inline per-bay.
- Reservasi yatim (A-17) tetap tampil dengan badge **"order tidak dikenal"** (D7).

**Verifikasi:** React DevTools Profiler — mengetik satu karakter di pencarian order menghasilkan
commit yang **tidak** memuat komponen peta. Tingkat 1 muat tanpa scroll horizontal di 1366px dan
1920px. Bay dengan dua order aktif pada tanggal kursor menampilkan dua kartu berbeda; menggeser
kursor satu hari mengubah isi sel. Drop order ke bay yang sudah terisi → tersimpan, dengan
peringatan yang menyebut penghuni lain.

### Fase 6 — Penanda subcont + keluarkan dari beban internal `[M]`

**Tujuan (per D4):** menandai operasi sebagai dikerjakan eksternal, sehingga **jadwal start/finish
tetap ada** tapi jamnya **tidak jadi outstanding workshop internal**. Kode `C5100SUB` tidak dipakai;
`workcenter` tidak disentuh.

- Tabel baru `public.sow_subcont_mark` ber-key `(order_no, operation_no)` — **BUKAN FK ke
  `sow(idsow)`**, karena Create Revision menghapus & menyisipkan ulang baris `sow` (A-01). Kolom:
  `marked_by`, `marked_at`, `unmarked_at`, `original_workcenter`, `note`.
- **Toggle di SOW table** (`apps/web/src/pages/PE/SowHistoryPage.jsx`), per baris operasi (D4a).
  Endpoint tandai/batal-tandai dengan audit — **jangan** lewat `saveSowOrderInfo` yang tidak menulis
  riwayat apa pun.
- **Kecualikan operasi bertanda** dari agregasi yang membaca `sow.planhours`:
  `sowScheduleController.js:812-815` (sisa kapasitas) dan `:281`, `msProjectService.js:1202`
  (`total_planhours`), `dashboardController.js:258` & `:1121`, `mpsDashboardController.js:52` &
  `:438`, `mpsDashboardSocket.js:60`, `timesheet_transactionController.js:1181`.
- **Tetap boleh dibooking ke bay** (D4b) — unit bisa saja parkir di workshop menunggu vendor. Tampil
  di peta dengan badge/warna berbeda.
- **Operator TIDAK bisa check-in/timesheet** ke operasi bertanda (D4c). Blokir di dua tempat:
  daftar job `SelectJobPage` (disaring) **dan** validasi `POST /timesheet` di controller — catatan:
  route `/timesheet` ada di `ALLOWLIST` RBAC, jadi blokirnya harus logika, bukan izin.
- Pelaporan dipisah: total jam internal, total jam subcont, dan totalnya — jangan sekadar memindahkan
  bucket di laporan per-workcenter.
- Feature RBAC terpisah (`sow_subcont`) — penandaan berimplikasi biaya, tidak boleh berbagi izin
  dengan pengeditan teknis SOW.

**Verifikasi:** sebelum/sesudah menandai satu operasi C5100FAB — `SUM(planhours)` internal turun
tepat sebesar `planhours` operasi itu di **semua** endpoint terdaftar (bandingkan respons JSON, bukan
satu dashboard); total jam subcont naik dengan angka sama. **Jalankan Create Revision pada order
tersebut → penanda subcont masih ada** (membuktikan model key-nya benar). Operator mencoba check-in
ke operasi bertanda → ditolak dengan pesan jelas. Jadwal start/finish operasi itu tetap tampil.

## 5. Keputusan owner — SUDAH DIAMBIL (3 Agustus 2026)

| ID | Pertanyaan | Keputusan |
|---|---|---|
| **D1** | Pengaturan akses fitur scheduling | **Pecah `ms_project_admin` jadi 4 feature spesifik** (`bay_scheduling`, `msproject_mapping`, `msproject_collab`, `ms_project_admin` yang dipersempit ke force-checkin/calendar/resource). Semua feature baru default `NO_ACCESS`; owner **assign manual per user** lewat `rbac.user_permissions`. |
| **D2** | Boleh reservasi order tanpa task MS Project? | **Tidak.** Tetap wajib task-level. Mitigasinya di UI (D5): pool dipisah tab "ada jadwal" vs "belum ada jadwal", yang belum diarahkan ke Map SAP Operations. Konsekuensi diterima: booking hanya untuk order yang sudah di-map. |
| **D3** | Aturan okupansi bay | **Tidak ada bay yang eksklusif.** Semua bay — termasuk booth PT/BL dan booking non-job — boleh ditumpuk. 409 dihapus, diganti **peringatan lunak** yang menampilkan penghuni bay. Tanpa `is_exclusive`, tanpa advisory lock. Fase 2 turun L → M. |
| **D4** | Subcont | **Label/penanda saja**, bukan penagihan. Flag terpisah di tabel sendiri; `workcenter` tidak disentuh; `C5100SUB` tidak dipakai. Toggle di SOW table; operasi subcont **tetap boleh dibooking ke bay**; operator **tidak boleh** timesheet ke operasi itu. Entitas vendor/PO/rate dibatalkan. |
| **D5** | Arti "full-screen" | **Peta dua tingkat.** Tingkat 1 fit-width, semua bay muat, isi sel hanya angka (jumlah order & aktivitas). Tingkat 2 setelah area dipilih: kiri daftar order+operasi, kanan bay area itu, **drag-and-drop di sini**. Tanggal booking di-prefill dari jadwal MS Project; kosong → peringatan. |
| **D6** | Bentuk filter & definisi "belum selesai" | **Tab**, bukan hard filter. **LKD diperlakukan sama dengan REL** = belum selesai (82 order). Timeline pakai window reservasi, pool order pakai window task MSP — dua kontrol terpisah. |
| **D7** | Order phantom & reservasi yatim | **Pool:** buang yang tidak ada di `ph3_order`. **Peta/timeline:** tetap tampilkan dengan badge "order tidak dikenal" — menyembunyikannya membuat bay tampak kosong padahal terpakai (A-17). **Plus:** bersihkan 10 reservasi yatim sebagai data, terpisah dari perubahan kode. |

### Tugas data terpisah (bukan fase kode)

- Tinjau & bereskan **10 reservasi `RESERVED` yatim** (A-17) — hapus atau perbaiki `order_no`-nya.
- Isi `roles` untuk **3 user yang NULL** (A-07) bila termasuk calon pemakai scheduling.
- Hapus 2 baris sampah `codex-smoke-test` bertanggal 2099 (A-16) — dieksekusi di Fase 2.

## 6. Risiko

- Menyalakan `RBAC_ENFORCE=1` sebelum Fase 0 selesai akan mematikan seluruh fitur reservasi bay dan
  write-back headcount, dengan gejala yang **tidak terlihat seperti masalah izin**.
- Ledger migrasi tidak dapat dipercaya (A-06). Setiap DDL di Fase 2 & 6 harus diverifikasi ke
  `information_schema`/`pg_constraint` sebelum dan sesudah, lalu didaftarkan ulang manual.
- **Konsekuensi D3:** sistem tidak akan pernah *mencegah* double-booking, hanya memberi tahu. Kalau
  di lapangan ternyata ada bay yang benar-benar tidak boleh ditumpuk, aturannya harus ditambahkan
  belakangan — dan menambah aturan keras di atas data yang sudah menumpuk lebih mahal daripada
  memasangnya sekarang.
- **Konsekuensi D2:** halaman melayani booking untuk 3 order sampai lebih banyak order di-map di
  `/sow-scheduling/map`. Kalau setelah rilis ternyata PPC jarang memakai halaman Map, gerbang ini
  akan terasa seperti fitur rusak. Pantau pemakaian Map setelah rilis.
- Mengubah `listSowOrders` tanpa default backward-compatible menciptakan **deadlock ayam-telur** di
  `/sow-scheduling/map` — halaman itu justru yang MEMBUAT task MS Project.
- Mengerjakan Fase 5 sebelum Fase 2 menghasilkan layar yang menolak penyimpanan. **Urutan tidak
  boleh dibalik** meski UI yang paling terlihat owner.
- Data produksi terlalu tipis untuk UAT bermakna: 13 reservasi aktif, 3 order dengan task MSP,
  timesheet praktis kosong. **Siapkan skenario uji sintetis.**
- Sebagian angka investigasi tidak reproducible (ditandai ⚠). Jangan dikutip tanpa dijalankan ulang.
- Fase 6 memperbaiki agregasi `sow.planhours`, tetapi guard "selesai" yang dipakai dashboard
  (`systemstatus NOT IN TECO/CLSD`) **mati total** karena `systemstatus` NULL 7.344/7.344 — angka
  dashboard tetap salah karena alasan lain. Kalau Fase 6 dievaluasi lewat dashboard, hasilnya
  membingungkan. Evaluasi lewat respons JSON per endpoint.
- Perubahan kode/label bay tanpa validasi topologi akan meng-orphan reservasi lagi (sudah terjadi
  dengan BP3/BP4 saat AREA-18 diubah 30 Juli). Ditutup di Fase 2.

## 7. Di luar cakupan

- **Entitas subcontract penuh** (master vendor, PO, rate, jam vendor, nilai tagihan) — dibatalkan
  per D4. Kalau nanti butuh angka rupiah, ini proyek tersendiri; `sow_subcont_mark` dirancang agar
  bisa diperluas tanpa migrasi ulang.
- Menghidupkan write-back progres dari MS Project (`actual_*` nol terisi dari 1.937 task).
- Rebaseline plan MS Project (⚠ 780 dari 995 task aktif bertanggal sudah lewat). Tidak bisa
  diperbaiki dari sisi aplikasi.
- Rekonsiliasi ledger migrasi (3 entri vs 67 file) — hanya objek yang disentuh Fase 2 & 6 yang
  diverifikasi.
- ⚠ Sistem penjadwalan kedua yang mati di DB (`sow_schedule` 34 baris, `sow_schedule_batch` 3,
  `sow_overtime_request` 4, semuanya Mei 2026, seluruh `sow_id` NULL).
- Perbaikan `useWorkcenterData`/`WorkcenterSelect` yang kosong karena `machineid` NULL (A-13) —
  tidak lagi menghalangi karena `C5100SUB` tidak jadi dipakai.
- Ekstraksi primitif Modal/Dialog accessible bersama dan koreksi klaim `ui/Modal.jsx` di `CLAUDE.md`
  — hanya sejauh dibutuhkan Fase 5.
- Rework alur timesheet & shopfloor, termasuk FK pada `timesheet_transaction.ms_bay_schedule_id`.
- Membersihkan 39 order non-numerik (`P26-*`, PP01) agar bisa dipetakan ke MS Project — masalah hulu
  ETL/SAP.

## 8. Status implementasi (4 Agustus 2026)

Fase 0–6 ditulis lewat tiga workflow multi-agen + perbaikan manual atas temuan review adversarial.
**Belum di-commit. Belum dideploy. Dua migrasi belum dijalankan.**

### Verifikasi terakhir

| Cek | Hasil |
|---|---|
| `node apps/api/scripts/check_rbac_manifest.js` | **BERSIH** — 156 route non-GET: 148 terpetakan, 8 allow-listed, **0 tak terpetakan** |
| API modules load (12 modul) | lolos |
| `apps/api` `npm test` | 5/5 lolos |
| `apps/web` `npx eslint` (file tersentuh) | 0 error, 0 warning |
| `apps/web` `npm run build` | sukses |

Lint SELURUH repo tetap gagal (105 error) — **utang lama**, terbukti: ~44 dari `dev-dist/` (file
generated) dan sisanya di ~35 file yang tidak disentuh. Lima error di `SowHistoryPage.jsx`
(`esc`, `normalizeProductionOrder`, `saving`, `addOperation`, `saveRevision`) juga pre-existing —
kelimanya hanya muncul 1× di HEAD, artinya sudah dead code sebelum fase ini.

### ⚠️ URUTAN DEPLOY — WAJIB

1. Jalankan `database/migrations/api/20260803_bay_booking_type.sql`
2. Jalankan `database/migrations/api/20260803b_sow_subcont_mark.sql`
3. Baru deploy kode.

Terbalik = **peta area PPC, layar pilih-job operator, grid SOW History, dan beberapa dashboard
langsung 500** (SQLSTATE 42703 / relasi tidak ada). Ini bukan "fitur baru mati" — jalur BACA yang
hari ini jalan ikut mati. Verifikasi read-only 4 Agu: ketiga kolom Fase 2 dan tabel
`sow_subcont_mark` **belum ada** di prod.

Catatan: `.env` di root menunjuk `DB_PORT=5441` = tunnel prod Cikupa, jadi `node database/migrate.js`
dari mesin dev **menulis langsung ke produksi**. Migrasi sengaja tidak dijalankan oleh agen.

### Struktur baru

`apps/web/src/features/bayScheduling/` (3.159 baris, 11 file): `constants.js`, `useBaySchedules.js`,
`useSowOrders.js`, `useDialogA11y.js`, `FloorMapOverview.jsx` (tingkat 1), `BayAreaDetail.jsx`
(tingkat 2), `OrderPanel.jsx`, `ReservationPanel.jsx`, `ReservationDetailModal.jsx`, `index.js`.
`SchedulingAreaPage.jsx` turun dari 1.499 → **478 baris** (target <300 tidak tercapai; sisanya
toolbar rentang tanggal + kursor + orkestrasi aksi).

### Perbaikan atas temuan review (di luar hasil agen)

| Temuan | Perbaikan |
|---|---|
| Penanda Fase 1 tak pernah sampai ke layar — filter workcenter `AND` atas `t.workcenter` yang NULL untuk baris order-level | Predikat jadi `(s.task_id is null or upper(...)=...)` + filter klien meloloskan `is_order_level`. Diverifikasi ke prod: 0 → 5 baris lolos |
| Peringatan overlap tidak pernah muncul (D3 setengah jalan: pencegahan dicabut, pemberitahuan absen) | Toast membedakan "tersimpan" vs "tersimpan — bay dipakai bersama" + daftar penghuni |
| Pembatalan masih loop non-atomik (A-09) | `cancelBayScheduleGroup`, fallback loop untuk baris warisan |
| Fail-open guard subcont palsu — `42P01` meracuni transaksi, query berikutnya mati `25P02` | Dibungkus `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` |
| `mv_order_plan_vs_actual` melaporkan jam berbeda dari endpoint lain | Jam subcont dikurangkan di query; `actual_pct`/`is_exceeded` dihitung ulang. SQL diuji ke prod |
| `sow_subcont` tak ada di featureRegistry FE → tidak bisa di-assign per-user | Ditambahkan (`routes: []`) |
| Badge D7 memakai heuristik salah (`!part_name && !customer`) — order sah yang task-nya tak ber-`sow_id` ikut tertuduh | Kolom `order_known` di `listBaySchedules`. Diuji ke prod: 2 dikenal, 2 tidak |
| Badge subcont di peta = kode mati | Kolom `is_subcont` di `listBaySchedules` |
| Penghuni bay dihitung per baris task, bukan per reservasi | `DISTINCT ON (schedule_group_id)` + `count(distinct ...)` |
| `active_reservations` menghitung baris | `count(distinct schedule_group_id)` |
| `fetchBayOccupants` membuang `truncated`/`total` | Diteruskan |
| Chip headcount tak pernah tampil (`people_required` tidak disalin `dedupeByGroup`) | Pakai `people_total` |
| Tombol "Muat lagi" hilang saat tab hasil-saring kosong → user terjebak di EmptyState | Syarat footer jadi `orders.length > 0 \|\| canLoadMore` |

### Sisa pekerjaan (belum dikerjakan)

- Tombol write belum di-gate di FE — supervisor/foreman akan melihat tombol Booking lalu 403 saat
  `RBAC_ENFORCE=1`.
- Endpoint counts per tab pool order (badge angka hanya muncul di tab aktif).
- Prop `loadingMore` di `OrderPanel` (tombol "Muat lagi" tanpa spinner).
- `today` dibekukan saat mount di `SchedulingAreaPage` (tab yang dibuka melewati tengah malam salah).
- Helper duplikat (`statusStyle`, `bookingTypeOf`, `bookingTypeLabel`) belum dikonsolidasi ke
  `constants.js`; `bookingTypeOf` punya dua semantik berbeda dengan nama sama.
- Tinjau 10 reservasi yatim + 3 user `roles` NULL (§5 Tugas data terpisah).
- Keputusan terbuka: `POST /dashboard/machine-hours-override` dipetakan ke `machine_hours`, tapi
  komponennya hanya dirender di `/sap-log` yang digating `sap_log` → supervisor/foreman bisa menulis
  dari halaman yang read-only bagi mereka. Pindah ke `sap_log` atau biarkan?

---

**Terhubung:** [[SOW_SCHEDULING_MFG_UI_REDESIGN_PLAN]] · [[MSPROJECT_COLLAB_HARDENING_PLAN]] ·
[[PLANNING]] · [[KONVENSI]] · [[00-INDEX]]
