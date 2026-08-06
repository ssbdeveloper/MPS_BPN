---
title: UX polish panel reservasi bay & halaman scheduling area
date: 2026-08-05
tags: [domain/bay-scheduling, ui/ux]
---

# Perapihan UX: panel reservasi, tab pool order, header scheduling area

Tiga keluhan owner (5 Agu 2026) tentang layar reservasi bay, semuanya UI tanpa
perubahan perilaku/data:

## 1. Panel save reservation — task tidak bisa dicari

Saat order punya puluhan task, daftar task hanya bisa di-scan dengan scroll.

Perbaikan (`apps/web/src/features/bayScheduling/ReservationPanel.jsx`):

- Input pencarian (komponen `SearchInput` yang sama dengan OrderPanel) di atas
  daftar task — filter lokal per `operation_no`, `task_name`, `workcenter`
  (case-insensitive).
- Indikator "N of M tasks" muncul hanya saat filter aktif.
- "Select all"/"Clear" bekerja pada **hasil pencarian**, bukan seluruh task —
  task di luar filter tidak ikut terseret.
- Empty state khusus saat pencarian tidak cocok ("No tasks match …").
- Area list diperlebar `max-h-64` → `max-h-72`.

## 2. Tab pool order (To schedule / No MSP task / Scheduled / Completed)

Animasi lama (`transition-all` per tombol + badge count yang muncul/hilang)
membuat baris tab berubah lebar dan terasa janky; badge tab lain baru muncul
setelah tab diklik.

Perbaikan (`OrderPanel.jsx`, `useSowOrders.js`, `apps/api/services/msProjectService.js`):

- Tab jadi **grid statis 2x2** (`grid grid-cols-2`) — kolom tetap, badge yang
  muncul/hilang tidak pernah menggeser tombol lain. `transition-all` dihapus.
- Badge jumlah **SEMUA tab muncul sejak awal** (tanpa perlu klik):
  - Server baru (`counts=true` + `counts_due_by` di `listSowOrders`) mengembalikan
    `{ perlu, belum_jadwal, terjadwal, selesai }` sekaligus — satu query, CTE yang
    sama, exact. `counts_due_by` sengaja terpisah dari `due_by` (filter) supaya
    badge 'perlu' benar walau tab aktif berbeda.
  - **Fallback klien** (jalan di server lama yang belum di-deploy): `useSowOrders`
    menarik semua halaman tiap tab lalu menerapkan `TAB_PREDICATE` yang sama
    dengan daftar — hasilnya exact juga, non-blocking, badge stabil saat ganti tab.
- Badge 0 disembunyikan.

## 3. Header scheduling area (Map date / From–To / presets / Refresh)

Tombol-tombol lama campur dalam satu baris `items-end` dengan tinggi tidak
konsisten (Refresh memakai `min-h-[44px]`, sisanya ~32px).

Perbaikan (`SchedulingAreaPage.jsx`, `SowSchedulingPage.jsx`):

- **Refresh pindah ke slot kanan PageHeader** (sejajar tombol Back menu), diisi
  sub-page lewat Outlet context (`setHeaderRight`) — layout menyediakan state,
  page me-render tombolnya via `useOutletContext`.
- Section halaman jadi dua baris rapi:
  - **Baris 1:** segmented Map/Timeline saja.
  - **Baris 2:** kontrol tanggal **kontekstual per mode** — Map mode cuma
    "Map date" (‹ › Today, as-of day A-08) + preset window 7/14/30; Timeline
    mode cuma From/To + preset yang sama. Dua konsep tanggal (as-of day vs
    range) tidak pernah tampil bersamaan, jadi tidak bingung.
- Semua kontrol sejajar `items-center`; label kecil ("Map date", "From", "To")
  inline di samping kontrol. Spasi antar-kelompok dilonggarkan (`gap-x-6`,
  gap internal `gap-2.5`).
- Perilaku handler tidak berubah sama sekali.

## Verifikasi

- ESLint: 0 error pada semua file yang diubah.
- `vite build`: SUCCESS.
- `listSowOrders` diuji langsung ke DB CKP: `counts` konsisten di ketiga tab
  (`{ perlu: 3, belum_jadwal: 106, terjadwal: 2, selesai: 33 }`), tanpa param
  `counts` respons tidak berubah (`rows/limit/offset/total`).
- Tidak ada perubahan data/API selain param opsional `counts`/`counts_due_by`.
