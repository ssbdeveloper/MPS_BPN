---
title: MS Project Hub — rename project + delete (biasa & force delete)
date: 2026-08-06
tags: [domain/msproject, feature]
---

# MS Project Hub: rename + delete project (dengan opsi force delete)

Halaman `/ms-project-admin` (MsProjectHubPage / Super Admin Panel) sebelumnya
hanya: list project, ubah status, download .mpp, riwayat revisi, force
check-in. Sekarang punya **rename** dan **delete** — backend-nya sudah ada dari
sesi CRUD ProjectBrowserPage (commit 9acb37d); yang ditambah di sini tombol +
modal + opsi **force delete** (keputusan user: 1b 2a 3a).

## Keputusan user

1. **1b** — tombol delete menampilkan 2 pilihan: **Delete** (biasa, diblokir
   server bila ada reservasi aktif) dan **Force Delete** (merah, menghapus
   reservasi dari area layout juga). Peringatan force ditampilkan jelas.
2. **2a** — file fisik .mpp di disk ikut dihapus (bukan cuma metadata).
3. **3a** — rename boleh; sync berikutnya dari .mpp tetap menimpa nama
   (peringatan ditampilkan di modal).

## Backend (`apps/api/services/msProjectService.js`)

- `deleteProject(projectId, { force })`:
  - Tanpa `force` + ada reservasi AKTIF (`status <> 'CANCELLED'`) → 409
    `PROJECT_HAS_ACTIVE_RESERVATIONS` (perilaku lama, pesan ditambah saran force).
  - Dengan `force: true` → blokir dilewati; SEMUA reservasi bay (termasuk aktif)
    ikut dihapus. Audit action menjadi `PROJECT_DELETE_FORCE` dengan
    `details.cancelled_reservations` (jejak siapa & berapa yang terhapus).
  - **File .mpp fisik** di `apps/api/uploads/ms-project-mpp/` di-unlink setelah
    commit (best-effort; resolusi path divalidasi `startsWith(uploadsRoot)`
    seperti getProjectFile). Metadata file ada di baris `ms_project` → ikut
    terhapus bersama project.
  - Urutan hapus & blokir lain tidak berubah (task/assignment/dependency/
    resource/lock/publish/revision; audit SET NULL; sow/sow_sub_operation TIDAK
    disentuh — data SAP tetap aman).
- `listProjects` — tambah kolom `active_reservation_count` (subquery
  ms_project_bay_schedule non-CANCELLED) supaya UI bisa menampilkan jumlah &
  men-disable Delete biasa. Backward-compatible (ProjectBrowserPage tidak
  terpengaruh).
- `controllers/msProjectController.js` — `deleteProject` meneruskan `req.body`
  (sebelumnya hanya actor) sehingga `force` sampai ke service.

## Frontend (`apps/web/src/pages/PPC/MsProjectHubPage.jsx` + service)

- Tombol **Rename** (pensil) + **Delete** (trash) di kolom Aksi tiap baris.
- `RenameProjectModal`: input project_name + catatan "sync .mpp akan menimpa
  nama", PUT `/ms-project/projects/:id`.
- `DeleteProjectModal`: peringatan scope delete (SEMUA task/reservasi/lock/
  revisi/file .mpp; data SAP/sow TIDAK), blok amber "N reservasi bay AKTIF"
  bila ada (Delete biasa di-disable + alasan), tombol **Delete** dan
  **Force Delete** (merah), footer "Force Delete menghapus reservasi juga dari
  area layout." Error server (409 dll) tampil inline + toast.
- `deleteMsProject(projectId, { force })` — DELETE dengan body `{ force }`.

## Verifikasi (CIKUPA, data throwaway `ZZTEST-del-*`)

14/14 test PASS:
- setup reservasi AKTIF + CANCELLED + file .mpp palsu di disk
- `listProjects.active_reservation_count` = 1 (aktif) / 0 (bersih)
- delete biasa → 409, project + file TETAP ada
- force delete → sukses; project/task/reservasi 0; file .mpp fisik HILANG;
  audit `PROJECT_DELETE_FORCE` (details.force=true, cancelled_reservations=1)
- delete biasa tanpa reservasi → sukses + audit `PROJECT_DELETE` (bukan force)
- ESLint 0, `vite build` SUCCESS, `check_rbac_manifest` BERSIH
- Browser: tombol rename/delete muncul di tiap baris; modal delete 2-opsi
  (Delete + Force Delete + peringatan); modal rename (input + catatan sync)

## Catatan

- Data live: 16 project, mayoritas data test; 2 project punya reservasi aktif
  (AMM - FUEL TRAILER: 4, "contoh project": 2) → force delete adalah satu-satunya
  cara hapus tanpa cancel manual.
- RBAC: rename = `msproject_collab`, delete = `ms_project_admin` (tidak berubah).
- **Restart `node server.js` wajib** agar `force` + `active_reservation_count`
  aktif (proses lama belum punya perubahan ini).
