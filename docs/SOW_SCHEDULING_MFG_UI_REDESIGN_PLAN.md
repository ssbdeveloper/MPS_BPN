---
type: plan
status: active
tags: [domain/sow, domain/msproject]
updated: 2026-07-30
---

# Rencana Perbaikan UI — SOW Scheduling (varian Manufaktur)

> Audit UI/UX halaman scheduling manufaktur + rencana perbaikan bertahap. Menunggu
> review owner. Terkait: [[MSPROJECT_COLLAB_HARDENING_PLAN]] (Fase 6 area→Select Job),
> [[MSPROJECT_PWA_LITE_PLAN]]. Acuan standar: `CLAUDE.md` (Corporate Color System +
> UI Engineering Standards). **Cakupan: hanya UI/UX frontend** — tidak menyentuh
> backend, model data, atau kontrak MS Project VBA.

## 0. Halaman yang tercakup

| File | Peran |
|---|---|
| `apps/web/src/pages/PPC/SowSchedulingPage.jsx` | Dispatcher varian (salvaging vs manufaktur) |
| `apps/web/src/pages/PPC/manufacturing/SowSchedulingPage.jsx` | Shell hub manufaktur (header + Back + 4 tile + view-switch in-page + `ProjectBrowserView`) |
| `apps/web/src/pages/PPC/manufacturing/SchedulingAreaPage.jsx` | Bay board (peta lantai, drag order → bay, `ReserveModal`) |
| `apps/web/src/pages/PPC/manufacturing/MapSapOperationPage.jsx` | Map operasi SAP → task MS Project |
| `apps/web/src/utils/navigation.js` | `goBackOrFallback` |

Ketiga sub-halaman (`ProjectBrowserView`, `SchedulingAreaPage`, `MapSapOperationPage`)
**tidak punya header sendiri** — semuanya dirender di dalam shell hub, yang memiliki satu
header + satu tombol Back. Split inilah akar kebingungan back.

---

## 1. Tiga keluhan → temuan terverifikasi

### Keluhan #3 — "action button membingungkan, back malah ke Operations Hub"

**Akar: model navigasi campur (React state, bukan route).** Diverifikasi langsung ke kode:

```jsx
// manufacturing/SowSchedulingPage.jsx:323
onClick={() => (activeView === 'menu'
  ? goBackOrFallback(navigate, '/operations-hub')   // level menu → keluar fitur
  : setActiveView('menu'))}                          // sub-view → balik ke tile (in-app)
```
```js
// utils/navigation.js:1-8
if (window.history.length > 1) { navigate(-1); return; }  // hampir SELALU true
navigate(fallback, { replace: true });                    // '/operations-hub'
```

- 4 tile (`projects`/`map`/`schedule`) memakai `setActiveView(...)` — **URL tetap
  `/sow-scheduling`, tak ada history entry**. Tile ke-4 (`admin`) justru `navigate('/ms-project-admin')`
  (pindah route). Empat tile, afordансi `ChevronRight` identik, tapi satu berperilaku beda.
- **Tombol back hardware/browser tablet** dari sub-view → pop ke referrer `/operations-hub`
  (sub-view tak pernah push history). Inilah "back malah ke Operations Hub".
- **Back level-menu** → `history.length > 1` selalu benar → `navigate(-1)` → mendarat di
  `/operations-hub`. Cabang fallback eksplisit praktis mati.
- **Bug tambahan:** `onBack` di-pass ke `MapSapOperationPage` (`:338`) & `SchedulingAreaPage`
  (`:339`) tapi kedua komponen **tak menerima props** → prop mati. Hanya `ProjectBrowserView`
  yang memakai `onBack`, dan ia merender **tombol back KEDUA** ("Menu") → dua kontrol back
  bersaing di layar Projects.
- Header = kartu mengambang `rounded-lg` (`:320`), bukan `border-b` flush; judul dipusatkan
  dengan **spacer hack** `<div className="h-11 w-[74px]" aria-hidden>` (`:333`).

Aksi lain yang membingungkan:
- **Map SAP:** tiga cara tumpang-tindih memicu mapping (drag, klik-order+tombol, klik-tree =
  pilih target). Drag pakai **HTML5 `draggable`** → **mati total di tablet sentuh** (perangkat
  target). Klik node tree menggabung expand/collapse + set-target (retarget diam-diam).
- **Bay board:** tak ada CTA primer; kontrol paling menonjol malah "Refresh" (outline).
  Reservasi dipicu implisit dengan klik sel peta — tak ditandai.

### Keluhan #2 — "banyak label info berlebihan"

- **Teks < 12px di mana-mana** — `text-[10px]` puluhan titik, bahkan `text-[9px]`
  (SchedulingArea badge order+tanggal `:156,:173`). CLAUDE.md: `text-[10px]` ke bawah **dilarang**;
  `text-[11px]` hanya eyebrow uppercase. Ini pendorong utama kesan "kasar/sempit".
- **Eyebrow & judul ganda:** header sudah menampilkan judul view (`title`, `:310-316`), tapi
  tiap sub-view mengulang judulnya sendiri + eyebrow ("MANUFACTURING" `:330`, "MS PROJECT DATABASE",
  "PROJECT TASKS"). Judul tampil dua kali.
- **Redundansi bay board:** tiap ~38 kolom bay diberi caption kode; kata "Ready" dicetak di
  **setiap sel kosong** (30+ kali); tiap area 2–3 label; chip meta rangkap tiga menduplikasi kartu.

### Keluhan #1 — "UI kasar"

- **Bay board tak muat viewport:** grid 38 kolom × 104px = `LANE_WIDTH ≈ 3.990px`
  (`SchedulingAreaPage.jsx:64-66`) → scroll horizontal berat; di tablet hanya terlihat irisan
  tipis — justru mematikan tujuan "lihat seluruh lantai".
- **Realisme dekoratif = noise:** road marker, band "Main Aisle", caption per-bay, "Ready" —
  mengubur satu-satunya yang penting: **bay mana ter-reserve & oleh siapa**. Badge reserved
  malah elemen terkecil & kontras terendah (9px).
- **Warna:** tombol primer Map memakai `bg-[#0096c7]` + `text-xs text-white` = **3.4:1, gagal AA**
  (`MapSapOperationPage.jsx:528`), base/hover terbalik dari standar. Blasting area dicat **amber**
  permanen (warna status, bukan dekoratif). Spinner `#0096c7` (standar `#00b4d8`).
- **Responsif:** split 2 kolom di-gate `lg:` (1024px) bukan `md:` (768px) → di tablet landscape
  (800–960px) panel menumpuk vertikal, metafora kiri→kanan pecah; panel `min-h-[680px]`.
- **State standar hilang:** loading tanpa skeleton; error fetch **toast-only** (panel jadi kosong,
  rancu dengan "empty" asli, tanpa retry); empty state polos tanpa ikon/aksi.
- **Modal:** `ReserveModal` bukan `ui/Modal.jsx` — tanpa `role="dialog"`, Escape, focus trap/return.
- **Touch target < 44px:** tombol cancel schedule badge 20px; clear "X" project 36px.
- **Angka tanpa `tabular-nums`** (order_no, jam, qty, rev) → digit tak sejajar antar-baris.

---

## 2. Penilaian arsitektur informasi

**Hub 4-tile + view-switch in-page memang membingungkan.** Dua masalah struktural:

1. **Model navigasi campur** — 3 view = state, 1 = route; afordansi sama. Tak ada deep-link,
   tak ada dukungan back hardware, URL tak bisa dibagikan. Di PWA tablet (yang mengundang
   back hardware) desain ini rusak. **Ini akar keluhan back-button.**
2. **Nama tak cocok isi** — "SOW Scheduling" sebenarnya **workspace MS Project**: hanya 1 dari 4
   tile ("Scheduling Area") yang scheduling; sisanya browse project, map operasi SAP, dan link
   admin. Label meremehkan cakupan fitur.

---

## 3. Rencana perbaikan bertahap

Diurut dari akar masalah → kosmetik. Tiap fase berdiri sendiri (bisa di-commit terpisah).

### Fase 0 — Navigasi & shell *(memperbaiki keluhan #3 + separuh #1)*

- Ubah 3 view in-page jadi **route bersarang nyata**: `/sow-scheduling/projects | /map | /area`
  (admin tetap route sendiri). Efek: back hardware/browser & `navigate(-1)` balik ke menu,
  deep-link & URL berbagi jalan, `goBackOrFallback` berperilaku benar. **(lihat Keputusan D-1)**
- Ekstrak **`PageHeader`** (`components/layout/`): back + eyebrow + title + slot action, flush
  `bg-white border-b border-slate-200 shadow-sm`, grid 3-kolom (bukan spacer hack).
- **Satu** kontrol Back, label sesuai tujuan ("← Menu" di sub-view, "← Operations Hub" hanya di
  menu). Hapus tombol back kedua di `ProjectBrowserView` + prop `onBack` mati.
- Bedakan visual tile "keluar halaman" (admin) dari 3 tile in-feature (mis. ikon external-link).

### Fase 1 — Kepatuhan design system *(memperbaiki keluhan #1 + #2)*

- **Bunuh semua teks < 12px** → `text-xs`; `text-[11px]` hanya untuk eyebrow uppercase asli.
- Buang eyebrow redundan, judul ganda, spam "Ready", chip meta duplikat.
- Tombol primer `#0096c7` → **`bg-[#0077b6] hover:bg-[#023e8a]`** (AA). Spinner → `#00b4d8`.
- `tabular-nums` di semua kolom angka/mono.
- **State standar:** skeleton loading; error fetch **inline + "Coba lagi"** per panel; `EmptyState`
  (ikon + 1 kalimat + aksi). Bangun komponennya (belum ada).
- `ReserveModal` → host di `ui/Modal.jsx` (warisi a11y), pertahankan shell responsif bottom-sheet↔center.
- Touch target ≥ 44px (cancel badge, clear-X).
- Split responsif `lg:` → **`md:`**; lepas `min-h-[680px]`.

### Fase 2 — Kejelasan aksi *(memperbaiki keluhan #3)*

- **Map SAP:** jadikan **alur klik terpandu** jalur utama (pilih project → pilih parent task →
  pilih order → tombol "Map"), dengan stepper/hint status terlihat. Drag = *enhancement desktop
  opsional* dengan highlight drop-zone; **atau hapus total** (klik-only). **(lihat Keputusan D-3)**
- Pisah chevron expand dari afordansi "set target" di tree (jangan gabung).
- **Bay board:** CTA primer reservasi jelas + hint satu baris ("Tarik order ke bay, atau ketuk bay");
  turunkan Refresh secara visual.

### Fase 3 — Metafora bay board *(memperbaiki inti keluhan #1)*

- **Fit-to-width / zoom-out** menggantikan lebar tetap 3.990px, agar seluruh lantai terlihat di tablet. **(lihat Keputusan D-2)**
- Strip noise dekoratif (road marker, "Main Aisle", caption per-bay, "Ready").
- Reserved-vs-ready terbaca sekilas via fill/border; badge reserved dinaikkan ke ukuran legible.
- Recolor aside blasting dari amber (warna status) ke brand/neutral (`#caf0f8`/slate).

### Cross-cutting — ekstraksi komponen (CLAUDE.md §1 Component-First)

Pola diulang ≥2× di ketiga file → bangun di `components/` lalu pakai:
`PageHeader`, `EmptyState`, `SearchInput`, `OrderCard`, `StatCard`, `Skeleton`.

---

## 4. Keputusan terbuka (butuh jawabanmu saat review)

- **D-1 — Model navigasi.** (a) **Route bersarang nyata** *(rekomendasi)* — benar secara arsitektur,
  memperbaiki back/deep-link, tapi menyentuh router + cara 3 sub-halaman menerima props. (b)
  Pertahankan state + push history manual per view — lebih ringan, tapi tetap tanpa deep-link/URL berbagi.
- **D-2 — Bay board.** (a) **Fit-to-width/zoom** *(rekomendasi)* vs (b) tetap fixed-width tapi
  hanya strip noise (lebih murah, tapi scroll tetap).
- **D-3 — Drag di Map SAP.** (a) Turunkan jadi opsional desktop *(rekomendasi bila masih dipakai
  di desktop)* vs (b) **hapus total**, klik-terpandu saja (paling sederhana & aman tablet).
- **D-4 — Rename hub?** "SOW Scheduling" → "MS Project Scheduling" / "Scheduling Workspace"?
  (opsional, prioritas rendah — hanya label + entri route/menu).
- **D-5 — Urutan & cakupan.** Kerjakan Fase 0→3 penuh, atau prioritaskan sebagian dulu
  (mis. Fase 0 + Fase 1 = perbaikan terasa paling besar; Fase 3 paling berat)?

## 5. Yang TIDAK disentuh

Backend/endpoint, model data (`ms_project_bay_schedule`, reservasi), kontrak MS Project VBA
(Text4/Text5 Area/Bay tetap web-authoritative), dan varian salvaging. Ini murni perombakan UI/UX
lapisan React pada 4 file di atas + komponen `components/` baru.

---

## 6. Status implementasi (2026-07-30 — branch 2b, pending test owner + commit)

Keputusan owner: **desktop-only, layar lebar** (abaikan tablet/sentuh; drag mouse dipertahankan
kelas-satu). Semua rekomendasi D-1..D-5 dikerjakan via workflow multi-agen
(Komponen → Navigasi → Halaman → Verifikasi). **Build PASS, lint bersih** pada semua file tersentuh
(diverifikasi ulang manual: `text-[10px]`=0, `bg-[#0096c7]`=0).

**Komponen bersama baru** (`apps/web/src/components/`): `layout/PageHeader`, `ui/EmptyState`,
`ui/Skeleton` (+`SkeletonText`/`SkeletonRow`), `forms/SearchInput` — terdaftar di barrel `index.js`.

**Fase 0 (navigasi):** `/sow-scheduling` → route bersarang (index=menu, `/projects` `/map` `/area`).
Dispatcher render layout (PageHeader+`<Outlet/>`) untuk manufaktur; salvaging tak tersentuh. Judul
dari route `handle` (useMatches). Back: index→Operations Hub, sub→Menu; **back browser/hardware kini
benar**. Menu diekstrak (`SchedulingMenuPage`, tile admin dibedakan ExternalLink); ProjectBrowser
diekstrak (`ProjectBrowserPage`); shell lama dirapikan (hapus `activeView`/`MENU_ITEMS`).

**Fase 1–3 (per halaman):**
- **Bay board** (`SchedulingAreaPage`): fit-to-width (grid fleksibel, hapus lebar tetap ~4000px),
  strip noise dekoratif (road/aisle/"Ready"/caption per-bay), reserved-vs-ready legible via fill/border,
  blasting off-amber ke brand/neutral, drag desktop + jalur klik + CTA, ReserveModal a11y.
- **Map SAP** (`MapSapOperationPage`): primary `#0077b6`, stepper 3-langkah + drag berhighlight,
  pisah expand vs set-target, inline error+retry per panel fetch, label dipangkas.
- **Project Browser** (`ProjectBrowserPage`): design-system, skeleton/EmptyState/inline-error, SearchInput bersama.

**Deviasi & catatan (untuk ditimbang):**
- ReserveModal a11y diimplementasikan **lokal**, bukan via `ui/Modal.jsx` — sebab `ui/Modal.jsx`
  ternyata modal kamera `bg-black` (tanpa `role=dialog`/Escape/focus-trap). Klaim CLAUDE.md §1 bahwa
  Modal.jsx reusable **tidak akurat**. Follow-up: ekstrak Modal primitif accessible bersama.
- **Fit-to-width DIBATALKAN (owner feedback 2026-07-30):** memaksa 38 bay muat viewport bikin sel
  terlalu sempit → job tak kebaca. Diganti: bay kolom lebar minimum **112px** (order+siapa kebaca) +
  **pan horizontal** (floor map memang untuk di-scroll). `MIN_BAY_COL 26→112` di `SchedulingAreaPage`.
- **Blasting & Prime (AREA-18) → 5 booth:** 3 Painting (`PT1-3`) + 2 Blasting (`BL1-2`), dikelompokkan
  & dilabeli. Kode diganti dari `BP*` seragam jadi `PT*`/`BL*` biar painting vs blasting jelas
  (`config/manufacturingAreas.js`; komentar migrasi `SelectJobPage` disesuaikan). Reservasi lama
  ber-bay `BP*` (kalau ada di dev) akan orphan — pilih ulang bay.

---

## 7. Iterasi 2 (2026-07-30) — detail reservasi, headcount, polish, Gantt view

Permintaan owner: (1) klik card reservasi → info order lebih informatif; (2) pola set **berapa orang
yang dibutuhkan per task** (owner tanya: di SOW atau di mana?); (3) polish visual — tetap corporate
tapi kurangi "hambar"; (4) **view Gantt/timeline reservasi bay (read-only)**.

### Temuan data-model (2 agen investigasi)
- `ms_project_bay_schedule` (migrasi `20260618_...`, BUKAN di `schema_prod`) = **satu baris per task**
  (reservasi 3 task = 3 baris berbagi `order_no`/`bay_codes`/tanggal, beda `task_id`/`project_id`).
  Kolom: `schedule_id, order_no, project_id, task_id, area_code/name, bay_codes[], start/end_date,
  status (RESERVED/CONFIRMED/DONE/CANCELLED), notes, created_by/updated_by, timestamps`. → headcount
  natural **per-task** (1 nilai/baris), tanpa tabel baru.
- `sow` = **satu baris per operasi** (identity `order_no`+`operation_no`), punya `planhours` +
  `workcenter`/`wct_group`. **Belum ada** kolom manpower.
- Manpower yang ADA (bukan per-operasi): `sow_machine_capacity.manpower_count` (salvaging, per
  mesin/shift) & `ms_project_assignment.assignment_units` (MS Project resource units, import-synced, berat).
- `fetchBaySchedules` SUDAH mengembalikan `task_name/operation_no/status/notes/project_name/area_name`
  — **belum dipakai** di card (detail bisa langsung lebih kaya tanpa ubah backend untuk field itu).

### Scope
1. **Klik badge reservasi → panel detail** — order, part, customer, area/bay, tanggal, status, who,
   notes, + task (operation, workcenter, planhours, headcount). Sebagian data sudah tersedia; sisanya
   butuh join tambahan (part/customer dari `sow`, planhours per task).
2. **Headcount per task** — lokasi = KEPUTUSAN (bawah).
3. **Polish visual** (tetap corporate, 80/20): gradient header kecil (sanctioned utk elemen kecil),
   aksen warna per lane/area, badge lebih kaya (status pill + chip headcount + ikon), heat okupansi bay.
4. **View Gantt/timeline reservasi (read-only)** — toggle "Peta"/"Timeline" di section peta; baris =
   bay/area, sumbu-x = rentang tanggal, bar = reservasi (order) span `start_date→end_date`. CSS-grid
   timeline (offline-first, tanpa lib berat; ECharts opsional).

### Keputusan terbuka — lokasi headcount (butuh jawaban owner)
- **A (rekomendasi) — `sow.people_required`:** rumah yang benar (properti kerja, reusable lintas
  booking, feed capacity planning), sebaris dengan `planhours`. Scheduler tetap set/edit **in-flow** di
  reserve modal (write-back ke SOW). Butuh: 1 migrasi + endpoint update kecil + join di `fetchOrderTasks`.
- **B — `ms_project_bay_schedule.people_required` (per-reservasi):** paling simpel (1 migrasi, tanpa
  UI SOW), pas dgn storage per-task. Kelemahan: tak reusable, tak terlihat planning.
- **C — keduanya:** SOW = master default, reservasi = aktual/override. Paling fleksibel, paling banyak kerja.

### Status implementasi (2026-07-30 — KEPUTUSAN owner: A; dikerjakan, pending migrasi + test + commit)
Dibangun via 3 agen paralel (backend / komponen Gantt / halaman) + integrasi manual. **Build + lint hijau.**
- **Backend:** migrasi `database/migrations/api/20260730_sow_people_required.sql` (ADD COLUMN + CHECK, **BELUM dijalankan**); `listOrderTasks` +`people_required`/`planhours`; `listBaySchedules` +`people_required`/`planhours`/`part_name`/`customer`/`workcenter`; endpoint `PATCH /ms-project/sow-orders/:order_no/operations/people` (write-back ke `sow`); FE `updateOperationPeople(orderNo, updates)`. `schema_prod.sql` disinkron.
- **Frontend `SchedulingAreaPage.jsx`:** input "Orang" per task di ReserveModal (prefill dari SOW, **write-back saat submit sebelum reservasi**); **ReservationDetailModal** (klik badge terisi → detail order/part/customer/status pill/tasks+workcenter/planhours/headcount + batal semua sibling); toggle **Peta/Timeline**; polish (status pill, chip headcount, aksen gradient kecil, dot per-area). Hook a11y modal diekstrak `useDialogA11y`.
- **Komponen baru `BayReservationTimeline.jsx`:** Gantt read-only (baris=bay, x=tanggal, bar per status, lane-packing overlap, sticky header, EmptyState guard).
- **PRASYARAT TEST:** jalankan migrasi dulu — tanpa kolom `sow.people_required`, endpoint join akan 500. Deploy Cikupa: jalankan migrasi di sana juga.
- **Catatan:** headcount opsional (nullable); mengosongkan field yang sudah terisi = HAPUS (tulis NULL); reservasi order-level lama (`task_id` NULL) → 4 field baru NULL.
- "Who" pada badge reserved = `created_by` (bisa user id mentah bila tak ada display name — tanpa ubah backend).
- Map: sukses/gagal mapping tetap toast (sesuai design system §4); hanya panel FETCH yang dapat inline+retry.
