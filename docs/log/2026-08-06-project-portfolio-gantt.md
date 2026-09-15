---
title: Portfolio Gantt schedule di View All Projects (sow-scheduling/projects)
date: 2026-08-06
tags: [domain/manufacturing, domain/msproject, fe, gantt, ux]
---

# Rombak ProjectBrowserPage → Portfolio Gantt schedule (preview-only)

## Keputusan user (2026-08-06, format "1b 2b 3c 4b 5a")

- **1b** Portfolio view: SEMUA project jadi baris Gantt sekaligus, klik project
  expand jadi task tree (bukan 2-panel pilih-project-dulu).
- **2b** CRUD dihapus dari halaman ini (murni preview) — rename/delete project
  & edit task pindah ke MS Project Hub (sudah ada di sana).
- **3c** Dua-duanya: bar schedule (plan_start/finish) + badge booking area.
- **4b** Klik badge booking → navigasi ke map area (`/sow-scheduling/area?area=`).
- **5a** Halaman ini dirombak total (`/sow-scheduling/projects`).

## Temuan data (DB live CKP)

- 866/872 task punya plan_start+plan_finish (99.3%) → Gantt schedule layak.
- 5 project, window schedule 29 Mei – 24 Des 2026 = 210 hari.
- Booking bay minim: 11 baris, hanya 2 project (AMM FUEL TRAILER 6 booking,
  CRANE TRUCK 1) → booking jadi BADGE, bukan sumber timeline.

## Perubahan

### `pages/PPC/manufacturing/ProjectScheduleGantt.jsx` (BARU)
- Gantt portfolio read-only: baris = project (semua), expand → task tree
  (outline level indent, summary bold). Sticky kolom label (280px) + header
  hari; satu kolom per hari (DAY_W=28), window = min/max plan_start/finish
  semua project.
- Bar project = gabungan min/max task; bar task = plan_start→plan_finish
  (summary pakai warna project, task detail hijau teal).
- Badge booking per area (dedupe per area+start+end, karena 1 booking task
  banyak = baris ganda) → klik `onOpenArea(areaCode)`.
- Tidak ada drag/drop/edit — preview-only.

### Fix bar tabrakan (feedback user 2026-08-06)
- Track timeline div TIDAK punya height eksplisit → bar absolute `top-1/2`
  dari height 0 muncul menempel tanpa gap dan terlihat tabrakan antar baris
  saat scroll horizontal.
- Fix: `ROW_H = BAR_H + ROW_PAD_Y*2` (28px) dipakai sebagai height track,
  bar diposisikan `top: ROW_PAD_Y` (5px) + height BAR_H (18px) → bar selalu
  di dalam barisnya, gap antar baris konsisten (verified: project bar rows
  251→285→319→353, task bar top = track+5).

### Kolom meta task (feedback user 2026-08-06)
- Task row kini menampilkan kolom sebelum track: **Start · Finish · Dur ·
  Area · Workcenter** (META_COLS, lebar tetap 88/88/56/76/104px, header
  sticky sama seperti kolom hari).
- Sumber data: `plan_start` / `plan_finish` / `duration_minutes` (format
  "4d"/"418.5d") / `workcenter` dari task; `area_code` di-resolve dari
  booking per task_id (bookingsByProject sekarang menyimpan `task_id`).
- Baris project memakai MetaCells kosong (—) supaya kolom tetap sejajar.

### `pages/PPC/manufacturing/ProjectBrowserPage.jsx` (ROMBAK)
- Hapus CRUD (rename/delete project, edit task + semua modal) — 635 → 225 baris.
- Fetch: `fetchMsProjects` (search) + `fetchMsProjectTasks` SEMUA project
  (Promise.all, supaya window & bar project langsung benar tanpa perlu expand)
  + `fetchBaySchedules` (group client-side by project_id).
- Expand/collapse project = state lokal (tasks sudah ada, tanpa refetch).
- Header search + Refresh (PageHeader dari layout).

### `pages/PPC/manufacturing/SchedulingAreaPage.jsx` (PATCH kecil)
- Baca `useSearchParams` `?area=AREA-XX` → `selectedAreaCode` + auto
  `setLevel('area')` — landing langsung di level area dari Gantt (4b).

## Feedback iterasi (2026-08-06, kedua)

### Gantt — freeze kolom & zona detail
- SEMUA kolom kiri di-freeze (feedback "jangan ikut geser saat scroll"):
  label (280px) + meta Start/Finish/Dur/Area/Workcenter sticky kumulatif
  (left 280/364/448/504/612), hanya track timeline yang scroll horizontal.
  Header kolom meta ikut sticky (z 35).
- Badge booking AREA-XX Nd PINDAH dari label project ke KOLOM AREA (baris
  project) — label project tidak lagi berantakan.
- Kolom Area baris TASK = zona detail dari `bay_codes` booking via
  `bayLabel()` (mis. `A9E` → "A9 Edge", `A38C` → "A38 Center"), bukan
  AREA-XX. `ProjectBrowserPage` kini menyimpan `bay_codes` di booking map.

### Area page — schedule bebas SEMUA tanggal (feedback "filter 7 hari")
- `useBaySchedules` fetch dengan BOUNDS penuh (`WINDOW_BACK_DAYS`..`WINDOW_FORWARD_DAYS`
  = -180/+365 hari) bukan range 7 hari → peta bisa melihat reservasi di
  tanggal berapa pun (min/max input = bounds, bukan range).
- Preset 7/14/30 hari hanya tampil di mode TIMELINE (lebar sumbu-x); di map
  mode tidak ada — schedule area tidak lagi dibatasi 7 hari. Filter 7 hari
  untuk ORDER tetap via tab "To schedule" (due_by minggu ini di useSowOrders).
- Navigasi dari Gantt kini membawa TANGGAL: `/area?area=AREA-XX&date=YYYY-MM-DD`
  → kursor map date di-set ke tanggal booking + level area langsung terbuka
  (4b diperdalam; validasi `DATE_INPUT_RE` + clamp bounds).

## Feedback iterasi (2026-08-07, ketiga)

### Gantt — header project isi tanggal & badge pindah ke baris task
- Baris project Start/Finish/Dur TIDAK lagi null: **Start = min(plan_start)
  task**, **Finish = max(plan_finish) task**, **Dur = total hari span**
  (`max-min+1`, bold). Kolom Area/Workcenter project sengaja '—'.
- **Button area PINDAH dari baris project ke baris TASK** (feedback: "button
  area itu di task tasknya, bukan di header atau projectnya"): kolom Area
  task = button booking klik (`AREA-08 A9 Edge 4d` — area_code + zona detail
  `bayLabel()` + durasi) → `onOpenArea(area, start_date)`. Task tanpa booking
  = '—'. Map diganti `taskZoneByTaskId` (string zona) →
  `taskBookingByTaskId` (booking utuh), di-render `TaskAreaBooking`.
- Workcenter task: terisi sesuai data DB (`C5100MPR` dst); yang '—' memang
  NULL di DB (532/1147 task terisi; 6 dari 7 task terbooking workcenter-nya
  null di ms_project_task — bukan bug FE).

## Feedback iterasi (2026-08-07, keempat)

### Gantt — expand per level, warna lembut, today line, range filter, grid
- **Expand per OUTLINE LEVEL** (recursive tree): setiap summary task punya
  tombol chevron sendiri — bukan hanya expand/collapse project. `expandedIds`
  di ProjectBrowserPage = Set berisi project_id DAN task_id (satu toggle).
  Bangun tree via `childrenMap` (parent_task_id), `TaskNode` rekursif.
- **Label outline level dihapus**: badge `outline_number` di kanan label task
  tidak lagi dirender (label task bersih).
- **Warna lembut** (feedback "terlalu kontras"): project active
  `#7dd3fc→#bae6fd` (soft sky), checkedOut `#fbbf24→#fcd34d`, draft
  `#cbd5e1→#e2e8f0`; task `#6ee7b7→#a7f3d0` (soft emerald); badge RESERVED
  `#e0f2fe/#0369a1`. Ring shadow dikurangi (ring-black/5).
- **Garis TODAY**: garis vertikal rose (2px, `bg-rose-400/80`) di header +
  setiap track, posisi = tengah kolom hari ini.
- **Filter RANGE tanggal** (feedback "jangan terlalu jauh"): preset
  All dates / 1 month / 3 months / 6 months di header — window di-clamp ke
  N hari di sekitar hari ini (308 → 32 hari untuk 1 month). Track
  `overflow-hidden` supaya bar di luar window terpotong.
- **Label di bar dihapus**: `ScheduleBar` jadi kotak warna murni (label hanya
  di tooltip title).
- **Grid line + Sabtu/Minggu**: `TrackBackdrop` — repeating-linear-gradient
  garis vertikal tiap DAY_W (murah untuk 300+ hari) + stripe
  `rgba(100,116,139,0.07)` di kolom Sabtu/Minggu + garis today.
- Workcenter: value dari `ms_project_task.workcenter` (DB). Task yang terisi
  sudah berformat benar (`C5100MPR`/`C5100FAB`/`C5100FIT`/`C5100QIM`/`C5100BPP`);
  yang kosong/tidak standar memang NULL/teks bebas di DB — `operations.workcenter`
  kosong semua (0 baris), `sow.workcenter` hanya 332 task & tidak menolong task
  yang sow_id NULL (0 task NULL-workcenter bisa di-backfill dari sow).

## Verifikasi
- ESLint 0, `vite build` SUCCESS.
- Browser: "5 projects · 210 days", bar project biru + task hijau muncul
  (project bar 1956px, task 24px/hari sesuai durasi), badge AREA-08 4d /
  AREA-01 3d / AREA-14 8d / AREA-17 4d, expand project → task tree render.
- Klik badge → `/sow-scheduling/area?area=AREA-01` → halaman area langsung
  level "Area 1" (8 bays).
- Iterasi 2: kolom meta sticky (Start@280 Finish@364 Dur@448 Area@504
  Workcenter@612), kolom Area task = "A9 Edge", klik badge → `/area?area=AREA-08&date=2026-06-19` → map date 19 Jun + "As of 19 Jun" + Bay A9E 1 reservation, map date bounds min 2026-02-08 max 2027-08-07.
- Iterasi 3: header project "20 Feb · 8 Sep · 201d" (bukan null), expand
  CRANE TRUCK → task "LASER CUTTING 2.1.1.3 19 Jun 22 Jun 4d AREA-08 A9 Edge
  4d C5100MPR", klik badge → area page "Area 8 · 8 bays · As of 19 Jun" +
  Order 1000129233 di Bay A9E.
- Iterasi 4: expand project → tree per outline level (PRELIMINARIES →
  Drawing & BOM → ... → MANUFACTURING, tiap summary punya chevron sendiri),
  warna bar soft (rgb 125,211,252), label bar kosong, today line 14 elemen,
  grid repeating-gradient 13 track, weekend stripe 1232 kolom 28px, range
  filter 308→32 days (1 month).
- Catatan: vision model gagal (provider config) — verifikasi via DOM + URL.
