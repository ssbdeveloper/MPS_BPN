---
title: Full English UI halaman manufaktur (Update Progress, Order List, sub-task) + rapikan label info
date: 2026-08-06
tags: [domain/manufacturing, domain/sow, i18n, ux]
---

# Full English UI + label info dirapikan (kluster sow-scheduling & progress manufaktur)

Permintaan user: halaman sow scheduling versi manufaktur masih banyak bahasa
Indonesia → ganti FULL English sekalian rapikan label info yang berlebihan
(diringkas/dihilangkan).

## Hasil scan

Kluster `/sow-scheduling` (menu, area, map, timeline, OrderPanel, ReservationPanel,
FloorMapOverview) ternyata **sudah English** — sisa hanya komentar. Yang masih
banyak Indonesia adalah halaman **Update Progress** (`/progress-update`),
**Order List** (PE), dan panel sub-task bersama (`features/progress/*`) — ini
yang diterjemahkan.

## Perubahan

### `pages/ProgressUpdatePage.jsx`
- Eyebrow `Foreman · Estimasi Fisik` → `Foreman · Physical Progress`; `Segarkan`
  → `Refresh`; `Pilih Order` → `Select Order`; `Cari order, part, SSBR...` →
  `Search order, part, SSBR...`; badge `N op` → `N ops`; `N order` → `N orders`
- Op card: `memuat sub-task…` → `loading sub-tasks…`; `tanpa sub-task` →
  `no sub-tasks`; `N sub-task` → `N sub-tasks`
- `Operasi & Estimasi Progress` → `Operations & Progress`; `Progress Order` →
  `Order Progress`
- **Dihapus**: kotak info "estimasi subjektif foreman" (label penjelasan
  berlebihan), deskripsi EmptyState ("Pilih order untuk mulai", "Belum ada
  operasi", "Belum ada order" — judul saja cukup), `Info` import ikut dibuang
- Error/empty state: `Coba lagi` → `Retry`; `Gagal memuat ...` → `Failed to load ...`

### `pages/OrderListPage.jsx`
- `Memuat operations...` → `Loading operations...`; `Deskripsi Operasi` →
  `Operation Description`; `Memuat...`/`Memuat data orders...` → `Loading...`;
  `Cari Order No, SSBR ID...` → `Search order no, SSBR ID...`; `Tidak ada data`
  → `No data`; toast `Progress operasi tersimpan` → `Operation progress saved`

### `features/progress/*` (panel sub-task bersama)
- `helpers.js`: status pill `Belum Mulai/Berjalan/Ditahan/Selesai` →
  `Not Started/In Progress/On Hold/Done`
- `subtasks.jsx`: `Tambah Sub-task` → `Add Sub-task`; `Dari Standar` →
  `From Standard`; modal `Tambah dari Standar` → `Add from Standard`; `Judul` →
  `Title`; `Jam Standar` → `Std Hours`; `Urutan` → `Order`; `Bobot` → `Weight`;
  `N jam` → `N hrs`; tombol `Batal/Simpan/Tambah/Menyimpan...` → `Cancel/Save/
  Add/Saving...`; `Belum ada sub-task` → `No sub-tasks yet`; `Nonaktifkan
  sub-task?` → `Deactivate sub-task?`; toasts + error → English. **Dihapus**:
  `<p>` penjelasan "Bobot dihitung otomatis dari jam (0 = tak dihitung)" dan
  deskripsi EmptyState
- `ProgressUpdatePanel.jsx`: `Informasi` → `Info`; `Riwayat Update` →
  `Update History`; `N catatan` → `N notes`; `Simpan Progress` → `Save
  Progress`; `Menyimpan...` → `Saving...`; `Foto` → `Photo`; `Ambil Foto /
  Pilih Gambar` → `Take photo / choose image`; placeholder/warn/error/toast →
  English. **Dihapus**: deskripsi EmptyState riwayat
- `primitives.jsx`: `Lihat foto` → `View photo`; `Foto` → `Photo`;
  `Dokumentasi` → `Documentation`; aria `Tutup` → `Close`
- `SubTaskImport.jsx`: `Menganalisis file…` → `Analyzing file…`; tile
  `Dibuat/Diupdate/Ditolak` → `Created/Updated/Rejected`; `Baris Ditolak` →
  `Rejected Rows`; `Baris N` → `Row N`; `Batal` → `Cancel`; `Proses` →
  `Apply`; `Memproses…` → `Applying…`; toasts → English

### `features/bayScheduling/FloorMapOverview.jsx`
- Label legenda `Numbers: reservations / activities` → `reservations /
  activities` (prefix "Numbers:" dibuang — label info redundan)

## Verifikasi
- ESLint 0, `vite build` SUCCESS
- Browser: header "FOREMAN · PHYSICAL PROGRESS", "SELECT ORDER / 150 orders /
  Search order, part, SSBR...", badge "ops", panel "SUB-TASKS / From Standard /
  No sub-tasks yet / Add Sub-task", op card "no sub-tasks" ✓
- Sisa teks Indonesia di kluster = komentar saja (tidak render)

## Catatan
- Komentar kode sengaja TIDAK diterjemahkan (bukan UI).
- Halaman `/sow-scheduling` (menu/area/map) sudah English sejak sesi
  sebelumnya — tidak diubah kecuali label legenda "Numbers:".

## Lanjutan: MS Project Hub (`/ms-project-admin`, `/ms-project-hub`)

User menemukan MsProjectHubPage.jsx masih banyak Indonesia (halaman ini tidak
masuk scope terjemahan pertama — waktu itu hanya kena tambahan modal
rename/delete di commit `9e8785f`). Sisa teks Indonesia diterjemahkan:

- Modal **Revision History**: `Riwayat Revisi` → `Revision History`;
  `Memuat riwayat...` → `Loading history...`; `Belum ada revisi tercatat` →
  `No revisions recorded`
- Modal **Force Check-In**: `Lock project akan dilepas paksa` → `The project
  lock will be force-released`; `Perubahan yang belum di-sync ... TIDAK ikut
  tersimpan` → `Unsynced changes ... will NOT be saved`; placeholder alasan →
  English
- Modal **Rename**: placeholder `Nama project baru` → `New project name`;
  catatan sync menimpa nama → `Note: the next sync from the .mpp file will
  overwrite this name.`
- Modal **Delete**: `Hapus Project` → `Delete Project`; deskripsi konsekuensi
  delete + force delete, peringatan reservasi aktif (`N ACTIVE bay
  reservation(s)`), title tombol, footer → English
- Toast: `Gagal load MS Project` → `Failed to load MS Project`; `Project
  berhasil force check-in` → `Project force check-in successful`; `Project
  di-rename` → `Project renamed`; `Project + reservasi dihapus` → `Project +
  reservations deleted`; `... gagal` → `... failed`; dst.
- Header: `Semua project tersimpan · checkout · file · riwayat` → `All stored
  projects · checkout · file · history`; search placeholder → English
- Tabel: kolom `Aksi` → `Actions`; title tooltip (riwayat revisi, ubah status,
  hapus project, download .mpp) → English; `Belum ada file` → `No file yet`
- Empty state: `Belum ada project tersimpan ...` → `No projects stored yet ...`;
  `Tidak ada project sesuai filter` → `No projects match the filter.`
- Footer: `Alur editor: buka MS Project → ...` → `Editor flow: open MS
  Project → ...`
- Lock badge: `Lock lebih dari 24 jam` → `Locked over 24h — likely stuck`;
  `Lock > 24 jam` → `Lock > 24h`

Catatan: route `/ms-project-admin` dan `/ms-project-hub` sama-sama menunjuk ke
`MsProjectHubPage.jsx` (MsProjectAdminPage.jsx legacy tidak dipakai router).

Verifikasi: scan ulang 0 sisa teks Indonesia di file, ESLint 0, `vite build`
SUCCESS (11.72s).
