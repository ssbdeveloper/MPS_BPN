---
title: CRUD project & task di ProjectBrowserPage
date: 2026-08-05
tags: [domain/msproject, feature]
---

# CRUD /sow-scheduling/projects — rename project, edit task, delete project

Halaman ProjectBrowserPage (rute `/sow-scheduling/projects`) sebelumnya hanya
baca: pilih project → lihat task. Sekarang punya CRUD:

- **Rename project** (tombol per kartu, muncul saat hover) — ubah `project_name`.
- **Edit task** (ikon pensil per baris task) — ubah `task_name`,
  `plan_start`, `plan_finish` (boleh dikosongkan).
- **Delete project** (tombol per kartu + konfirmasi) — hapus project beserta
  seluruh dependensinya.

## Endpoint baru (backend)

`apps/api/routes/msProject.js` + `controllers/msProjectController.js` +
`services/msProjectService.js`:

| Method | Path | Fungsi |
|---|---|---|
| `PUT` | `/ms-project/projects/:project_id` | `updateProjectInfo` — rename (project_name wajib, description opsional) |
| `PUT` | `/ms-project/projects/:project_id/tasks/:task_id` | `updateProjectTask` — task_name + plan_start/finish |
| `DELETE` | `/ms-project/projects/:project_id` | `deleteProject` — hapus total |

RBAC: rename & edit task = `msproject_collab` W; delete = `ms_project_admin` W
(destruktif). Aktor dari header sesi (`actorOf`), bukan body. Setiap aksi
menulis `ms_project_audit_log` (PROJECT_RENAME / TASK_UPDATE / PROJECT_DELETE).

### deleteProject — urutan & pengaman

- **409 `PROJECT_HAS_ACTIVE_RESERVATIONS`** kalau masih ada bay schedule
  `status <> 'CANCELLED'` — menghapus project tidak boleh menghapus reservasi
  diam-diam; user harus cancel dulu.
- Hapus berurutan mengikuti FK (NO ACTION): `ms_project_bay_schedule` →
  `ms_project_assignment` → `ms_project_dependency` (predecessor/successor) →
  `ms_project_resource` → `ms_project_lock` → `ms_project_publish` →
  `ms_project_revision` → audit log (ditulis SEBELUM project dihapus, karena FK
  audit_log ke project ber-ON DELETE SET NULL) → `ms_project_task` (satu
  statement, self-ref `parent_task_id` aman) → `ms_project`.

## Frontend

`apps/web/src/services/msProjectService.js`: `updateMsProject`,
`updateMsProjectTask`, `deleteMsProject`.

`ProjectBrowserPage.jsx`:

- Kartu project jadi `div role="button"` (bukan `<button>`) supaya aksi
  Rename/Delete bisa jadi tombol di dalamnya (HTML valid); aksi muncul saat
  hover/fokus, `stopPropagation` agar tidak membuka detail.
- Baris task dapat kolom aksi (ikon pensil) → modal edit task.
- Modal ringan inline (`ModalShell`): rename (1 input), delete (konfirmasi
  merah), edit task (nama + 2 date). Escape/klik luar menutup.
- Toast sonner untuk sukses; error ditampilkan inline di modal.

## Verifikasi (langsung ke DB CKP via tunnel)

Data throwaway `ZZTEST-hermes-*` dibuat lalu dihapus oleh fungsi itu sendiri:

- Rename: PASS (nama berubah, audit PROJECT_RENAME tercatat)
- Edit task: PASS (nama + plan_start/finish berubah, audit TASK_UPDATE)
- Delete dengan reservasi aktif: **409** PASS (tidak jadi hapus)
- Delete setelah reservasi di-cancel: PASS — cleanup total, semua tabel
  dependen 0 baris (`ms_project`, `task`, `revision`, `lock`, `resource`,
  `bay_schedule`), audit PROJECT_DELETE tersisa dengan `details.project_name`
- Error: nama kosong → 400 `PROJECT_NAME_REQUIRED`; finish < start → 400
  `INVALID_DATE_RANGE`; project tidak ada → 404 `PROJECT_NOT_FOUND`
- `check_rbac_manifest.js`: BERSIH (0 write route tidak terpetakan)
- ESLint 0 error, `vite build` SUCCESS

## Hotfix CSS: tombol modal invisible (5 Agu 2026, sesudah review)

Tombol aksi modal (Delete/Save) sempat tidak terlihat — hanya Cancel yang muncul.
Bukan blokir server: `MODAL_BTN` base mengandung `bg-white`, lalu tombol aksi
menambah `bg-red-600`/`bg-[#0077b6]` di elemen yang sama. Dua kelas `bg-*` yang
konflik tidak bisa diandalkan urutannya di Tailwind (yang menang urutan di CSS
file, bukan urutan attribute), jadi `bg-white` menang + `text-white` = tombol
putih di atas putih.

Perbaikan: base `MODAL_BTN` dipisah jadi layout-only (tanpa bg/border-color/
hover-bg); tiap tombol memakai varian eksplisit `MODAL_BTN_CANCEL` (putih),
`MODAL_BTN_PRIMARY` (biru), `MODAL_BTN_DANGER` (merah).

## Catatan penting

- **Bukan sumber kebenaran jadwal**: sync berikutnya dari file `.mpp` (via
  `PUT /projects/:id/sync` / tool msproject-v2) akan MENIMPA `project_name`,
  `task_name`, dan tanggal plan yang diedit manual di sini. Fitur ini untuk
  edit darurat/perbaikan cepat, bukan pengganti MSP.
- File `.mpp` di disk tidak dihapus saat project dihapus (hanya baris DB).
