# VBA Summary - MS Project Integration

Dokumen ringkas untuk memahami modul VBA di folder ini. Fokus MVP saat ini: **MS Project menjadi editor**, backend menyimpan **metadata project/task/resource** dan file fisik **`.mpp`** di server.

## Alur Utama MVP

```text
Publish New Project
  -> VBA serialize metadata dari file aktif
  -> POST /api/ms-project/projects
  -> API simpan project, task, resource, assignment, dependency
  -> API balas project_id + revision_no + mapping UUID
  -> VBA tulis UUID/revision ke custom fields
  -> VBA FileSaveAs ke temp .mpp
  -> VBA upload .mpp ke POST /api/ms-project/projects/:project_id/file
  -> API simpan file ke /uploads/ms-project-mpp/{project_id}.mpp

Sync Existing Project
  -> user checkout project dulu
  -> VBA serialize metadata dari file aktif
  -> PUT /api/ms-project/projects/:project_id/sync
  -> API validasi lock_token + revision_no
  -> API update metadata dan naikkan revision_no
  -> VBA update revision/mapping UUID
  -> VBA FileSave file .mpp aktif; jika belum ada path .mpp, FileSaveAs ke temp
  -> VBA upload ulang .mpp, overwrite file server
```

## Modul Aktif

| Module | Kegunaan |
|---|---|
| `ms_config.bas` | Konfigurasi API base URL, timeout, dan mapping custom fields MS Project. |
| `ms_http.bas` | Helper HTTP JSON (`GET/POST/PUT/DELETE`), parser success response, JSON escape, URL encode, dan upload multipart file `.mpp`. |
| `ms_fields.bas` | Getter/setter UUID di custom fields: project, task, resource, assignment, calendar, lock token, revision. Juga helper clear UUID untuk clone. |
| `ms_serializer.bas` | Mengubah file MS Project aktif menjadi payload JSON: project header, resources, tasks, assignments, dependencies. |
| `ms_sync.bas` | Entry point utama user: check connection, list/import project, publish, checkout, heartbeat, sync, check-in, upload `.mpp`, clone as new, resource conflict check. |
| `ms_import.bas` | Import package project dari API ke file MS Project aktif: project, resource sheet, task, assignment, dependency. |
| `ms_resources.bas` | Load project team dari API ke Resource Sheet dan serialize resource yang sudah punya `resource_id`. |
| `ms_calendars.bas` | Ambil calendar dari server, refresh calendar dari shift, dan apply calendar ke MS Project. |
| `JsonConverter.bas` | Library VBA-JSON untuk parse/convert JSON. Wajib ada. |
| `httphelper.bas` | Helper lama untuk macro legacy. Tidak dipakai oleh flow `ms_*` baru. |

## Macro Yang Paling Sering Dipakai

| Macro | Kapan Dipakai | Hasil |
|---|---|---|
| `Ms_CheckConnection` | Tes koneksi API. | Popup status API dan database. |
| `Ms_PublishNewProject` | File baru belum punya `project_id`. | Simpan metadata ke DB, tulis UUID ke file, upload `.mpp` ke server. |
| `Ms_CheckOutCurrentProject` | Sebelum edit/sync project existing. | Dapat `lock_token` dan revision aktif. |
| `Ms_SyncExistingProject` | Setelah edit project existing. | Update metadata DB, naikkan revision, upload ulang `.mpp`. |
| `Ms_CheckInCurrentProject` | Setelah selesai edit. | Lepas lock project. |
| `Ms_UploadCurrentProjectFile` | Retry upload `.mpp` jika publish/sync metadata sudah sukses tapi upload file gagal. | Upload file aktif ke server. |
| `Ms_ImportProjectById` | Buka ulang project dari DB berdasarkan `project_id`. | Rebuild project ke MS Project aktif. |
| `Ms_CloneAsNewProject` | File copy ingin jadi project baru. | Hapus UUID lama agar aman dipublish sebagai project baru. |
| `Ms_LoadProjectTeam` | Muat resource project ke Resource Sheet. | Resource siap dipakai assignment. |
| `Ms_SetProjectCalendarFromServer` | Set calendar project dari server. | Calendar diterapkan ke file aktif. |

## Field Mapping MS Project

| Data | Field |
|---|---|
| `project_id` | `ProjectSummaryTask.Text30` |
| `revision_no` | `ProjectSummaryTask.Text29` |
| `mode` | `ProjectSummaryTask.Text28` |
| `lock_token` | `ProjectSummaryTask.Text27` |
| `project calendar_id` | `ProjectSummaryTask.Text26` |
| `task_id` | `Task.Text10` |
| `task project_id` | `Task.Text11` |
| `parent_task_id` | `Task.Text12` |
| `task calendar_id` | `Task.Text13` |
| `order_no` | `Task.Text1` |
| `operation_no` | `Task.Text2` |
| `ssbr_id` | `Task.Text3` |
| `resource_id` | `Resource.Text9` |
| `resource calendar_id` | `Resource.Text8` |
| `assignment_id` | `Assignment.Text10` |

`order_no` dan `operation_no` boleh kosong untuk MVP metadata-only. Dampaknya hanya fitur matching/report by SOW tidak bisa bekerja untuk task tersebut.

## Endpoint Yang Dipakai

Base URL ada di `ms_config.bas`:

```vb
Public Const MS_API_BASE_URL As String = "https://100.80.101.53/api/ms-project"
```

| Endpoint | Method | Dipakai Oleh | Fungsi |
|---|---|---|---|
| `/health` | GET | `Ms_CheckConnection` | Tes koneksi. |
| `/projects` | GET | `Ms_ListProjects`, import latest | List project. |
| `/projects` | POST | `Ms_PublishNewProject` | Buat project baru dan simpan metadata. |
| `/projects/:project_id/package` | GET | `MsImportProjectPackage` | Ambil full package project. |
| `/projects/:project_id/checkout` | POST | `Ms_CheckOutCurrentProject` | Ambil lock edit. |
| `/projects/:project_id/heartbeat` | POST | `Ms_HeartbeatCurrentProject` | Cek/refresh lock aktif. |
| `/projects/:project_id/sync` | PUT | `Ms_SyncExistingProject` | Update metadata project existing. |
| `/projects/:project_id/file` | POST multipart | `Ms_UploadCurrentProjectFile`, publish/sync | Upload/overwrite file `.mpp`. |
| `/projects/:project_id/publish` | POST | `Ms_PublishCurrentRevision` | Tandai revision DB sebagai published. |
| `/projects/:project_id/checkin` | POST | `Ms_CheckInCurrentProject` | Lepas lock. |
| `/resources` | GET | resource picker/import helper | Cari resource. |
| `/projects/:project_id/resources` | GET/POST/DELETE | resource helper | Kelola project team. |
| `/resources/conflicts` | GET | `Ms_CheckResourceConflicts` | Cek konflik resource. |
| `/calendars` | GET | calendar helper | List calendar. |
| `/calendars/:calendar_id` | GET | `Ms_SetProjectCalendarFromServer` | Ambil detail calendar. |
| `/calendars/refresh-from-shifts` | POST | `Ms_RefreshCalendarsFromShifts` | Refresh calendar dari shift rules. |

## Catatan Cara Kerja

- Sync existing wajib punya `project_id`, `revision_no`, dan `lock_token`.
- Lock token tidak expired untuk MVP; API akan menolak sync jika revision file sudah stale (`409 conflict`) atau lock sudah dilepas/dimiliki sesi lain (`423`).
- Perubahan outline/indent task ikut dikirim lewat `parent_local_task_uid`, `outline_level`, dan `outline_number`.
- Task baru wajib punya `local_task_uid` dari `Task.UniqueID`; task lama lebih stabil kalau sudah punya `task_id`.
- File `.mpp` disimpan backend di folder khusus `uploads/ms-project-mpp`, bukan folder SOW.
- Jika upload file gagal setelah metadata sukses, jalankan `Ms_UploadCurrentProjectFile` untuk retry.

## Legacy Modules

Macro lama ada di folder `legacy/`. Fungsinya historis:

| Legacy Module | Fungsi Lama |
|---|---|
| `createReAPI.bas` | Ambil SOW baru dari FastAPI lama, buat subproject `.mpp` per order, insert ke master project. |
| `createwithrresource.bas` / `createresource.bas` | Versi CSV/resource pool dari pembuat subproject lama. |
| `senddata.bas` / `senddatabulk.bas` | Push plan date task ke endpoint SOW lama. |
| `getdata.bas` | Pull actual progress/hours dari endpoint lama ke task. |
| `getmissing2.bas` | Cari operation SOW yang belum ada di MS Project lama. |

Untuk MVP baru, gunakan modul `ms_*` dan `JsonConverter.bas`.
