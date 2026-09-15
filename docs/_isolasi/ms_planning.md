# MS Project Integration Planning

Dokumen ini adalah planning implementasi integrasi Microsoft Project dengan PostgreSQL untuk project MPS2. Revisi ini menggabungkan requirement awal dari `ms_requirement.md` dan koreksi desain resource dari `ms_requirement2.md`.

Tujuan utama: Microsoft Project dipakai sebagai planning editor, sedangkan PostgreSQL menjadi pusat data project, task, resource, assignment, dependency, publish state, revision history, audit log, dan validasi lintas project.

## 0. Referensi Konsep PWA yang Akan Direplikasi

Microsoft Project Web App (PWA) / Project Server tidak bekerja sebagai file server `.mpp` biasa. PWA memakai central project database, API/business object layer, queue untuk operasi berat, calculation service, dan pemisahan state project.

Konsep PWA yang relevan untuk sistem pengganti MPS:

| Konsep PWA | Arti Teknis | Replikasi di MPS |
| --- | --- | --- |
| Draft data | Perubahan project yang belum dipublish. | Data current/editable di tabel `ms_project*` dengan lock aktif. |
| Published data | Project yang terlihat untuk user lain, report, dan portfolio. | `published_revision_no` di `ms_project` + snapshot publish di `ms_project_publish`. |
| Archive/version | Backup versi project lama. | `ms_project_revision` dan snapshot JSON per revision/publish. |
| Reporting data | Read model untuk laporan, tidak dipakai sebagai write target. | View/materialized view PostgreSQL untuk dashboard. |
| Check-out | Lock eksklusif agar satu user mengedit satu project. | `ms_project_lock` dengan `lock_token`, heartbeat, expiry, dan force check-in. |
| Check-in | Release lock setelah save/sync/publish selesai. | Endpoint `/checkin`, audit log, dan optional publish. |
| Publish | Promosi draft/current menjadi versi yang terlihat. | Endpoint `/publish` yang membuat publish snapshot dan increment revision. |
| Project Center | Daftar project, status, owner, last update, checked-out-by. | `GET /ms-project/projects` plus lock/publish metadata. |
| Resource Center | Enterprise resource pool. | `ms_resource` + `ms_project_resource`. |
| Security category/RBS | Scope akses project/resource berdasarkan role dan struktur organisasi. | Role + project membership + workcenter/resource scope. |

Prinsip desain:

1. Client tidak boleh menulis langsung ke PostgreSQL. Semua write harus lewat Express API.
2. `.mpp` bukan canonical source setelah project dipublish. PostgreSQL menjadi canonical source, `.mpp` menjadi editor/sync client.
3. `revision_no` adalah optimistic concurrency token utama.
4. `lock_token` adalah pessimistic concurrency token saat user mengedit.
5. Reporting/dashboard membaca read model, bukan draft/current write path.

## 0A. Review Validasi Resmi Microsoft Project / PWA / Project Server

Status review: divalidasi ulang terhadap dokumentasi resmi Microsoft Project Object Model VBA, Project Server/PWA architecture, Project Server CSOM, Project Server queue, Project Online/Project Server export data definitions, dan Microsoft Support calendar/scheduling guidance.

Sumber resmi utama:

| Area | Dokumentasi resmi |
| --- | --- |
| Project Object Model | `https://learn.microsoft.com/en-us/office/vba/api/project.project` |
| Task Object Model | `https://learn.microsoft.com/en-us/office/vba/api/project.task` |
| Assignment Object Model | `https://learn.microsoft.com/en-us/office/vba/api/project.assignment` |
| Resource Object Model | `https://learn.microsoft.com/en-us/office/vba/api/project.resource` |
| Calendar Object Model | `https://learn.microsoft.com/en-us/office/vba/api/project.calendar` |
| Task Calendar | `https://learn.microsoft.com/en-us/office/vba/api/project.task.calendar` |
| Ignore Resource Calendar | `https://learn.microsoft.com/en-us/office/vba/api/project.task.ignoreresourcecalendar` |
| Resource Calendar / Max Units / Availability | `https://learn.microsoft.com/en-us/office/vba/api/project.resource.calendar`, `resource.maxunits`, `resource.availabilities` |
| Calendar WeekDays / Exceptions | `https://learn.microsoft.com/en-us/office/vba/api/project.calendar.weekdays`, `calendar.exceptions`, `weekday`, `exception` |
| Project Server architecture | `https://learn.microsoft.com/en-us/office/client-developer/project/project-server-2013-architecture` |
| Project Server 2019 architecture | `https://learn.microsoft.com/en-us/project/project-server-2019-architecture` |
| CSOM create/publish sample | `https://learn.microsoft.com/en-us/office/client-developer/project/getting-started-with-the-project-server-csom-and-net` |
| Queue settings/jobs | `https://learn.microsoft.com/en-us/project/manage-queue-settings-for-project-web-app`, `https://learn.microsoft.com/en-us/project/manage-queue-jobs-project-server-2013` |
| Export data definitions | `https://learn.microsoft.com/en-us/projectonline/project-online-and-project-server-export-data-definitions` |
| Calendar scheduling behavior | `https://support.microsoft.com/en-us/project/how-project-schedules-tasks-behind-the-scenes`, `work-with-calendars-in-project`, `task-calendar-task-field` |
| Project sites/documents | `https://learn.microsoft.com/en-us/project/manage-connected-sharepoint-sites-in-project-server-2013`, Project Online/Server export `WorkspaceItems` |

### Validasi Umum

Hasil review:

1. Desain `project -> task -> assignment -> resource` sudah selaras dengan object model Microsoft Project. `Task` dan `Resource` memiliki collection `Assignments`, sedangkan `Assignment` menyimpan referensi ke task/resource.
2. Keputusan menyimpan `task_id`, `assignment_id`, dan `resource_id` sendiri di custom field tetap benar. Microsoft Project punya `Guid` dan `UniqueID`, tetapi `Guid` bersifat read-only dan `UniqueID` hanya aman sebagai correlation dalam satu file/sesi. UUID database tetap harus menjadi canonical ID setelah publish.
3. `ms_project_resource` sebagai project team cocok dengan konsep enterprise resource pool + selected project team. Microsoft Project juga punya flow enterprise team builder/resource import dari Project Server.
4. Check-out/check-in/locking wajib untuk project existing. Microsoft Project Professional membuka enterprise project sebagai read-only lalu checkout menjadi read/write; jika sudah checkout oleh user lain, Project menolak edit.
5. Publish bukan sekadar save. Dalam Project Server, save menulis draft/working copy, sedangkan publish mengirim pekerjaan ke Queue Service agar perubahan terlihat di published/read model dan, jika ada, project workspace.
6. Direct write ke tabel Project Server draft/published/archive tidak didukung. Microsoft merekomendasikan CSOM/PSI untuk write path; reporting tables/views dan OData adalah read/reporting path. Karena itu keputusan MPS "write only lewat Express API" sudah benar.
7. Calendar design perlu naik prioritas. Scheduling Microsoft Project sangat bergantung pada project calendar, task calendar, resource calendar, working time, exception, max units, dan assignment units. Tanpa metadata calendar, backend hanya menyimpan hasil tanggal, belum bisa mendekati capacity/scheduling behavior.

### Core Entity Compatibility Matrix

#### Project

| Aspek | Microsoft Project / PWA | Desain MPS saat ini | Status | Koreksi / rekomendasi |
| --- | --- | --- | --- | --- |
| Identitas | `Project.Guid`, `Project.UniqueID`, server project GUID, name. | `ms_project.project_id`, `project_name`. | Critical - sesuai. | Simpan juga `server_project_guid`/`mpp_project_guid` optional jika diambil dari Object Model. |
| Summary custom fields | `Project.ProjectSummaryTask` dapat menyimpan local custom field project. Enterprise custom field perlu `GetField/SetField`. | Custom field Text30/Text29/Text28/Text27 dipakai untuk project id/revision/mode/lock. | Critical - sesuai. | Dokumentasikan bahwa field ini local custom field, bukan enterprise custom field. |
| Schedule settings | Project punya `Calendar`, `ProjectStart`, `ProjectFinish`, `StatusDate`, `ScheduleFromStart`, `HoursPerDay`, `HoursPerWeek`, `DaysPerMonth`, `DefaultStartTime`, `DefaultFinishTime`. | Baru menyimpan name/description/status/revision. | Gap Critical untuk calendar. | Tambah kolom schedule settings atau `ms_project_schedule_option`. |
| Save vs publish | Save ke draft; publish ke published/read model via queue. | `sync` menaikkan revision; `publish` snapshot. | Critical - sebagian sesuai. | Pisahkan istilah `sync/save draft` dan `publish`; jangan setiap sync dianggap published. |
| Check-out/check-in | Enterprise project harus checkout agar editable; checkin bisa save/no-save dan dapat publish. | `ms_project_lock` + heartbeat + checkin. | Critical - sesuai. | Tambah stale lock policy dan audit actor wajib. |
| Calculated fields | Finish, duration, percent complete, critical/slack, rollup summary dihitung engine. | Tanggal hasil Project disimpan. | Sesuai. | Jangan hitung ulang full scheduling engine di backend MVP. |

Wajib MVP:

1. `project_id`, `project_name`, `status`, `revision_no`.
2. `published_revision_no`, `last_published_at`.
3. `checked_out_by`, `checked_out_at`, `lock_token`.
4. Project calendar reference atau minimal calendar name untuk kompatibilitas scheduling.

Opsional fase lanjut:

1. `mpp_project_guid`, `server_project_guid`, `database_project_unique_id`.
2. Default scheduling options (`hours_per_day`, `hours_per_week`, `days_per_month`, default start/finish time).
3. Enterprise custom field definitions.

#### Task

| Aspek | Microsoft Project / PWA | Desain MPS saat ini | Status | Koreksi / rekomendasi |
| --- | --- | --- | --- | --- |
| Identitas | `Task.Guid` read-only, `Task.UniqueID`, `Task.ID` row-like, WBS/Outline. | `task_id`, `local_task_uid`, outline fields. | Critical - sesuai. | Jangan pakai `Task.ID` sebagai key; tambahkan optional `mpp_task_guid`. |
| Hierarchy | `OutlineLevel`, `OutlineNumber`, `OutlineParent`, summary task. | `parent_task_id`, outline fields, `is_summary`. | Critical - sesuai. | Parent resolution by local UID sudah benar. |
| Scheduling fields | `Start`, `Finish`, `Duration`, `Work`, constraint, deadline, task mode, calendar. | Start/finish/duration/work ada; constraint/deadline/task mode belum. | Important gap. | Tambah `constraint_type`, `constraint_date`, `deadline`, `task_mode`, `calendar_id`. |
| Calendar | `Task.Calendar` adalah nama calendar; jika none maka project calendar. `Task.IgnoreResourceCalendar` menentukan apakah resource calendar dipakai. | Stage 8 sudah menambah `calendar_id`, `ignore_resource_calendar`. | Important - roadmap sesuai. | Implementasi calendar harus export/import property ini dari VBA. |
| Dependencies | Predecessor/successor link dengan type/lag. | `ms_project_dependency`. | Critical - sesuai. | Tambah support relation type selain FS di VBA, bukan hardcode FS saja. |
| Actuals | Actual start/finish/work/progress ada di Project, tetapi ownership MPS adalah timesheet/PostgreSQL. | `actual_*` tidak diubah sync planning. | Critical - sesuai. | Tetap reject planning payload yang mencoba overwrite actual. |

Wajib MVP:

1. `task_id`, `project_id`, `local_task_uid`, `task_name`.
2. `parent_task_id` atau `parent_local_task_uid`.
3. `plan_start`, `plan_finish`, `duration_minutes`, `planned_work_minutes`.
4. `is_summary`, `is_active`.
5. Business keys MPS (`order_no`, `operation_no`, `ssbr_id`, `workcenter`).

Important fase berikutnya:

1. `mpp_task_guid`.
2. `constraint_type`, `constraint_date`, `deadline`, `task_mode`.
3. `calendar_id`, `calendar_name`, `ignore_resource_calendar`.
4. Full dependency type/lag parsing dari Object Model.

Calculated / jangan jadi write authority:

1. Critical/slack/early/late dates.
2. Summary rollup start/finish/work/cost.
3. Percent complete jika actual owner adalah timesheet.

#### Assignment

| Aspek | Microsoft Project / PWA | Desain MPS saat ini | Status | Koreksi / rekomendasi |
| --- | --- | --- | --- | --- |
| Identitas | `Assignment.Guid`, `Assignment.UniqueID`, `TaskUniqueID`, `ResourceUniqueID`. | `assignment_id`, `local_assignment_uid`, task/resource FK. | Critical - sesuai. | Tambah optional `mpp_assignment_guid`. |
| Core relation | Assignment menghubungkan task dan resource, dengan units/work/start/finish. | `task_id`, `resource_id`, `assignment_units`, work/start/finish. | Critical - sesuai. | `assignment_units` decimal 1.0 = 100% tetap benar. |
| Scheduling impact | Assignment units dan resource calendar memengaruhi work/duration/finish. | Conflict check memakai units dan window. | Important - sebagian. | Calendar-aware conflict perlu Stage 8/9. |
| Actuals | Assignment punya actual work/start/finish. | `actual_*` tersedia tetapi planning sync tidak overwrite. | Critical - sesuai. | Actual assignment update harus dari actual sync endpoint, bukan planning sync. |
| Contour/timephased | Assignment punya work contour dan timescale data. | Belum ada. | Optional/Important untuk capacity detail. | Tambah timephased assignment read model jika dashboard resource loading perlu presisi. |

Wajib MVP:

1. `assignment_id`, `project_id`, `task_id`, `resource_id`.
2. `local_assignment_uid`.
3. `assignment_units`, `planned_work_minutes`.
4. `assignment_start`, `assignment_finish`.

Important fase berikutnya:

1. `mpp_assignment_guid`.
2. `work_contour`, `cost_rate_table`, `booking_type`.
3. Timephased assignment buckets untuk capacity planning.

#### Resource

| Aspek | Microsoft Project / PWA | Desain MPS saat ini | Status | Koreksi / rekomendasi |
| --- | --- | --- | --- | --- |
| Identitas | `Resource.Guid`, `UniqueID`, enterprise properties, Windows account, code, group. | `resource_id`, `resource_code`, source mapping. | Critical - sesuai. | Tambah optional `mpp_resource_guid`/`enterprise_resource_uid`. |
| Type/category | Project resource type: work/material/cost. Business category bukan bawaan Project. | `resource_type` + `resource_category`. | Critical - sesuai. | Category MPS harus tetap internal, tidak disamakan dengan Project `Type`. |
| Calendar | `Resource.Calendar` read-only calendar object for resource; material resource tidak meaningful. | Stage 8 `ms_resource.calendar_id`. | Important gap. | Jangan assign calendar ke MATERIAL. |
| Capacity | `MaxUnits` percent availability; `Availabilities` date-ranged capacity. | `max_units` tunggal. | Important gap. | Tambah `ms_resource_availability` untuk date-ranged max units. |
| Enterprise pool | Enterprise resource pool dikelola pusat; project memilih team. | `ms_resource` + `ms_project_resource`. | Critical - sesuai. | Add/remove project team harus audit. |
| Over-allocation | Project menghitung overallocated dari assignment/resource calendar/units. | Conflict warning manual. | Important. | Conflict check harus calendar-aware dan range-aware. |

Wajib MVP:

1. `resource_id`, `resource_code`, `resource_name`.
2. `resource_type`, `resource_category`.
3. `source_type`, `source_ref_id`.
4. `max_units`, `is_assignable`, `is_generic`, `is_active`.
5. `ms_project_resource` sebagai project team.

Important fase berikutnya:

1. `calendar_id`.
2. `ms_resource_availability(resource_id, available_from, available_to, max_units)`.
3. `enterprise_resource_uid`, Windows account/email jika ada.

#### Calendar

| Aspek | Microsoft Project / PWA | Desain MPS saat ini | Status | Koreksi / rekomendasi |
| --- | --- | --- | --- | --- |
| Calendar object | `Calendar` untuk project/resource; punya `BaseCalendar`, `Exceptions`, `WeekDays`, `WorkWeeks`, `Guid`, `Enterprise`. | Stage 8 schema calendar. | Important - roadmap sesuai. | Tambah `calendar_guid`, `enterprise`, `work_week` detail. |
| Weekdays | `Calendar.WeekDays` collection; `WeekDay.Working`, `Shift1..Shift5`. | `calendar_weekday` + `working_time` segment. | Sesuai. | Segment max 5 mengikuti Object Model Project. |
| Exceptions | `Calendar.Exceptions`; `Exception` punya start/finish, type, recurrence-like fields, Shift1..Shift5. | `calendar_exception` + `exception_time` + JSON recurrence. | Sesuai. | JSON recurrence harus mampu memetakan `Type`, `Occurrences`, `Month`, `MonthDay`, `DaysOfWeek`. |
| Project calendar | `Project.Calendar`; base calendar bisa dipilih dari Project Information. | `ms_project.calendar_id` Stage 8. | Important. | Implementasikan sebelum server-side capacity dianggap valid. |
| Task calendar | `Task.Calendar`; default None. | `ms_project_task.calendar_id` Stage 8. | Important. | Simpan juga `calendar_name` agar roundtrip VBA mudah. |
| Resource calendar | Resource calendar biasanya berbasis project/base calendar; vacation/maintenance masuk exception. | `ms_resource.calendar_id` Stage 8. | Important. | Tambah resource exception dari leave/maintenance jika tersedia. |

Wajib untuk calendar feature:

1. Enterprise/base calendar master.
2. Weekday working/non-working + working time segment.
3. Exception/holiday/non-working period.
4. Project/task/resource calendar reference.
5. `ignore_resource_calendar`.
6. Hours/day, hours/week, days/month.

Optional:

1. Full `WorkWeeks` effective date pattern.
2. Full exception recurrence parity.
3. Calendar versioning dan effective dating.

### Calendar & Scheduling Validation

Aturan Microsoft yang harus diikuti:

1. Jika task tidak punya task calendar, Project memakai project calendar.
2. Jika task punya task calendar, task calendar menggantikan project calendar untuk task itu.
3. Jika resource assigned, resource calendar juga diperhitungkan.
4. Jika task calendar dan resource calendar sama-sama ada, scheduling memakai intersection working time keduanya.
5. Jika `IgnoreResourceCalendar = true`, task calendar dapat mengabaikan non-working time resource.
6. Resource `MaxUnits`, resource availability periods, assignment units, dan calendar bersama-sama menentukan capacity.
7. Holiday/vacation/maintenance direpresentasikan sebagai calendar exceptions; recurring holiday/vacation perlu recurrence metadata.
8. Working time satu hari bisa multi-shift/segment. Object Model menyediakan sampai `Shift1..Shift5` untuk weekday/exception.

Koreksi terhadap asumsi sebelumnya:

1. `ms_project_calendar_weekday` + `ms_project_calendar_working_time` sudah benar, tetapi perlu batasi/validasi `segment_no` agar kompatibel dengan `Shift1..Shift5`.
2. `recurrence_rule jsonb` tetap valid, tetapi harus mencakup field Object Model exception: `Type`, `Occurrences`, `Month`, `MonthDay`, `MonthItem`, `MonthPosition`, `DaysOfWeek`, `Period`.
3. `hours_per_day`, `hours_per_week`, dan `days_per_month` tidak sekadar metadata display; nilai ini memengaruhi konversi duration/work di Project dan harus ikut package.
4. Calendar harus punya `calendar_guid` atau `source_ref_id` yang stabil agar roundtrip tidak bergantung pada nama calendar saja.
5. Resource availability tidak cukup hanya `max_units`; Microsoft punya date-ranged availability grid. Tambah tabel availability pada fase capacity.

### Project Lifecycle & Server Feature Validation

| Fitur Microsoft | Perilaku resmi | Rekomendasi MPS | Prioritas |
| --- | --- | --- | --- |
| Open project | Project Professional dapat membuka enterprise project dari Project Server; read-only jika belum checkout. | Import package dari API sebagai Single Project Editor; Master Portfolio read-only. | Critical |
| Save project | Save menyimpan working/draft state, bukan publish. | `PUT /sync` diperlakukan sebagai save draft/current. | Critical |
| Publish project | Publish mengirim job ke Project Server Queue dan mempromosikan draft ke published. | `POST /publish` buat published snapshot dan audit. | Critical |
| Check-out | Mengubah read-only enterprise project menjadi read/write untuk user pemegang lock. | `ms_project_lock`, `lock_token`, heartbeat. | Critical |
| Check-in | Release lock; dapat menyimpan atau tidak menyimpan perubahan; pada Project method bisa menutup file. | `/checkin` release lock; optional publish tetap endpoint terpisah. | Critical |
| Project locking | User lain ditolak sampai project check-in atau admin force check-in. | Conflict `PROJECT_LOCKED`; admin `/force-checkin`. | Critical |
| Version control | Project Server punya draft/published/archive; SharePoint document library bisa punya revision comments untuk documents. | `ms_project_revision` dan `ms_project_publish`. | Important |
| Enterprise resource pool | Resource pusat dikelola enterprise; project memilih team. | `ms_resource` + `ms_project_resource`. | Critical |
| Assignment management | Assignment adalah entity sendiri dan dapat punya owner/status/timephased. | `ms_project_assignment` saat ini cukup MVP. | Critical |
| Queue processing | Publish/check-in/reporting jobs asynchronous dan dapat dilihat/retry/cancel di queue. | MPS bisa synchronous MVP; queue table/job worker fase berikutnya. | Important |
| Force check-in enterprise objects | Admin dapat force check-in project/object yang terkunci. | `/force-checkin` + audit. | Critical |
| Enterprise calendars/custom fields checked out | Export definitions menunjukkan enterprise calendar/custom field dapat checked out. | Calendar/custom field admin editing perlu lock terpisah. | Important |

Rekomendasi queue MPS:

1. MVP boleh synchronous untuk sync/publish jika payload kecil.
2. Tambah `ms_project_queue_job` sebelum payload besar, publish multi-project, snapshot berat, atau calendar recalculation warning.
3. Job type awal: `SYNC_PROJECT`, `PUBLISH_PROJECT`, `REFRESH_RESOURCES`, `REFRESH_CALENDARS`, `BUILD_REPORTING_SNAPSHOT`.
4. Job status: `QUEUED`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.

### File & Storage Management Validation

Pola Microsoft:

1. `.mpp` lokal tetap bisa disimpan sebagai file, tetapi enterprise/PWA project disimpan dan diakses lewat server/business layer.
2. Project Server 2013 memakai satu Project database per PWA instance untuk draft/published/archive/reporting; Project Server 2019 memakai SharePoint content database untuk PWA information dan tidak lagi separate Project Server database.
3. Project Server/Online memakai SharePoint project sites untuk dokumen, issues, risks, deliverables, dan linked workspace items.
4. Document/revision comments pada check-in berlaku untuk dokumen SharePoint/library scenarios, bukan pengganti publish revision planning.

Rekomendasi MPS:

| Area | Rekomendasi | Prioritas |
| --- | --- | --- |
| Canonical planning data | Tetap PostgreSQL via API, bukan file share `.mpp`. | Critical |
| File metadata | Simpan optional file import metadata: original filename, hash, imported_by, imported_at, parser version. | Important |
| MPP binary storage | Tidak wajib simpan `.mpp` binary pada MVP; cukup data structured hasil VBA. | Optional |
| Supporting documents | Buat `ms_project_document` untuk link attachment/drawing/SOW/support docs. | Important |
| Linked task documents | Buat `ms_project_object_link` untuk link task/resource/project ke dokumen, issue, risk. | Optional |
| Folder/document storage | Reuse storage aplikasi existing atau network path; DB menyimpan metadata/link, bukan blob besar. | Important |
| Project site equivalent | Jika ingin meniru PWA, project workspace MPS dapat berupa folder/document list per project. | Optional |

Schema roadmap dokumen:

```sql
create table if not exists ms_project_document (
  document_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id) on delete cascade,
  document_type text not null,
  title text not null,
  file_name text,
  file_path text,
  file_url text,
  content_hash text,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  is_active boolean not null default true
);

create table if not exists ms_project_object_link (
  link_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  document_id uuid references ms_project_document(document_id) on delete cascade,
  link_type text not null default 'REFERENCE',
  created_by text,
  created_at timestamptz not null default now()
);
```

### Compatibility Classification

| Feature | Classification | Alasan |
| --- | --- | --- |
| Project master + revision token | Critical | Semua sync/publish bergantung pada identity dan concurrency. |
| Task hierarchy + schedule result | Critical | Core planning object dan output scheduling engine. |
| Assignment entity | Critical | Resource planning tidak valid tanpa assignment sebagai entity tersendiri. |
| Enterprise resource pool mirror | Critical | Mencegah free-text resource dan duplikasi. |
| Project resource team | Critical | Meniru selected team dari enterprise pool. |
| Check-out/check-in/lock | Critical | Perilaku utama Project Server/PWA untuk edit project. |
| Publish snapshot | Critical | Memisahkan draft/current dari data yang terlihat/reportable. |
| Calendar reference minimal | Critical | Project/task/resource calendar memengaruhi scheduling. Minimal ID/name harus ada. |
| Calendar working time/exception full schema | Important | Dibutuhkan untuk capacity/conflict akurat, tetapi schedule calculation tetap dari Project Desktop. |
| Resource date-ranged availability | Important | Microsoft mendukung availability grid; perlu untuk capacity planning. |
| Queue processing | Important | Meniru Project Server untuk operasi berat; MVP bisa synchronous. |
| Baseline | Important | Penting untuk kontrol project, tetapi bisa setelah sync/publish stabil. |
| Custom field definitions/values | Important | Dibutuhkan untuk kompatibilitas enterprise field dan reporting. |
| Timephased assignment data | Important | Dibutuhkan untuk resource/capacity dashboard presisi. |
| Project document storage/link | Important | PWA memakai project sites untuk dokumen/issue/risk; MPS minimal perlu link dokumen. |
| Server-side scheduling engine penuh | Not Required | Microsoft scheduling engine kompleks; MPS harus menyimpan hasil kalkulasi dari Project Desktop pada MVP. |
| Direct Project Server DB table parity | Not Required | Tidak perlu meniru internal table Project Server; cukup behavior/API-compatible. |
| `.mpp` binary as canonical store | Not Required | Bertentangan dengan tujuan PostgreSQL sebagai canonical structured data. |

### Gap Analysis Desain Saat Ini vs Microsoft Project

| Gap | Dampak | Prioritas | Rekomendasi |
| --- | --- | --- | --- |
| Belum menyimpan `Task.Calendar` dan `IgnoreResourceCalendar`. | Schedule roundtrip calendar belum akurat. | Critical untuk Stage 8. | Tambah field dan VBA export/import. |
| Belum menyimpan `Project.HoursPerDay`, `HoursPerWeek`, `DaysPerMonth`, default start/finish time. | Duration/work conversion bisa beda dari file asli. | Important. | Tambah schedule options di project/calendar package. |
| Dependency VBA masih cenderung FS/0. | Link SS/FF/SF dan lag hilang. | Critical. | Parse `TaskDependencies`/predecessor detail dari Object Model. |
| Belum ada constraint/deadline/task mode. | Schedule hasil import ulang bisa berubah dari file asli. | Important. | Tambah metadata task lanjutan. |
| Resource availability grid belum ada. | Capacity planning tidak setara MaxUnits date range. | Important. | Tambah `ms_resource_availability`. |
| Calendar recurrence belum dipetakan ke property Exception Object. | Recurring holiday/vacation bisa tidak roundtrip. | Important. | Definisikan JSON schema recurrence sesuai Object Model. |
| Queue job belum ada. | Publish besar dapat timeout dan tidak punya retry/cancel. | Important. | Tambah queue setelah endpoint stabil. |
| Document/project workspace belum ada. | Belum meniru PWA project site/document link. | Important. | Tambah project document/link metadata. |
| Enterprise custom fields belum ada. | Reporting dan project metadata belum enterprise-compatible. | Important. | Tambah custom field definitions/values. |
| Server-side read model published belum dipisah fisik. | Dashboard bisa salah baca draft jika query tidak disiplin. | Important. | Buat view/materialized view published setelah publish stabil. |

### MVP yang Harus Dibangun Terlebih Dahulu

Urutan MVP agar mendekati perilaku Microsoft Project/Project Server:

1. Project/package API dengan `project_id`, revision, published metadata, lock metadata.
2. Resource refresh dari master MPS menjadi enterprise resource pool mirror.
3. Project resource team API.
4. Publish new project dari VBA dengan tasks, resources, assignments, dependencies.
5. Checkout/heartbeat/sync/checkin project existing.
6. Publish current revision dengan snapshot dan audit.
7. Import package single project editor dan master portfolio read-only.
8. Dependency type/lag lengkap dari VBA.
9. Minimal calendar reference: project/resource/task calendar ID/name + `ignore_resource_calendar`.
10. Calendar schema enterprise/base + weekday working time + exception.
11. Conflict check peak units, lalu calendar-aware conflict.
12. Published read model untuk dashboard/report.

## 1. Ringkasan MVP Revisi

MVP harus mendukung:

1. User dapat mengambil daftar project dari PostgreSQL.
2. User dapat import satu atau beberapa project ke file Microsoft Project aktif.
3. User dapat publish project baru dari Microsoft Project.
4. User dapat sync project existing tanpa duplikasi task, resource, assignment, dan dependency.
5. Resource master tetap berasal dari PostgreSQL, bukan dibuat bebas dari Microsoft Project.
6. Resource MVP mencakup `PERSON`, `MACHINE`, `WORKCENTER`, dan `TEAM`, bukan hanya workcenter atau mesin.
7. User dapat memilih project resource team sebelum assignment.
8. Assignment hanya boleh memakai resource aktif yang sudah masuk `ms_project_resource`.
9. Conflict check menghitung peak concurrent capacity, bukan total semua assignment dalam rentang filter.
10. Planned schedule berasal dari Microsoft Project; actual data tetap berasal dari PostgreSQL/timesheet/transaksi lapangan.
11. Single Project Editor menjadi mode edit/sync MVP; Master Portfolio View menjadi read-only pada MVP.
12. Check-out/check-in wajib tersedia sebelum project existing boleh diedit.
13. Publish wajib membuat revision/snapshot dan audit log.
14. `revision_no` menjadi token concurrency utama; `updated_at` hanya metadata.

Perubahan penting dari planning sebelumnya:

| Area | Keputusan lama | Keputusan revisi |
| --- | --- | --- |
| Employee/person resource | Ditunda | Masuk MVP |
| `ms_project_resource` | Ditunda fase 2 | Masuk MVP sebagai project resource team |
| Payload sync | `resources` | `project_resources` |
| Resource source | Fokus workcenter | Upsert dari `WORKCENTER`, `MACHINE`, dan `EMPLOYEE` |
| Conflict check | Overlap resource sama | Conflict jika peak concurrent units lebih besar dari `max_units` |

## 2. Analisis Struktur Existing

Folder `Additional/ms project` berisi macro existing:

| File | Fungsi saat ini |
| --- | --- |
| `createReAPI.bas` | Ambil operation baru dari API, buat `.mpp` per `order_no`, link resource pool, insert subproject, update sync. |
| `createwithrresource.bas` | Launcher/UI entry point untuk flow create dari API/resource. |
| `createresource.bas` | Legacy CSV to MPP dengan resource assignment dari CSV. |
| `senddata.bas` | Kirim plan per task satu per satu ke endpoint update plan. |
| `senddatabulk.bas` | Kirim plan task secara bulk. Ini pola yang paling cocok untuk sync baru. |
| `getdata.bas` | Ambil actual progress/hours dari API dan update task di MS Project. |
| `getmissing2.bas` | Ambil operation yang belum ada untuk order tertentu lalu insert ke MS Project. |
| `httphelper.bas` | Helper HTTP POST berbasis `WinHttp`/`MSXML`. |
| `JsonConverter.bas` | VBA JSON parser. Wajib dipakai untuk response mapping ID. |

Backend MPS2 existing:

| Area | Kondisi |
| --- | --- |
| Express API | `API/server.js` sudah register banyak route aplikasi. Route baru disarankan `/ms-project`. |
| DB pool | PostgreSQL via `pg` di `API/db.js` dan `global.pool`. |
| Workcenter API | `GET /workcenter` mengambil semua row `workcenter`. |
| User NFC API | `API/routes/usernfc.js` dan `API/controllers/usernfcController.js` mengelola master operator/person berbasis NFC. |
| Migration style | SQL migration ada di `database/migration/*.sql` dan `API/migrations/*.sql`. |

## 3. Temuan Master Data Existing

Temuan dari schema dan dokumen lokal:

| Master | Tabel existing | Stable key kandidat | Catatan |
| --- | --- | --- | --- |
| Employee/person | `usernfc` | `snssb` | Ada constraint unique `usernfc_snssb_unique`. Jangan disamakan dengan user login aplikasi. |
| NFC card | `usernfc` | `nfcid` | Ada index unique `uq_usernfc_nfcid`. Ini identitas kartu, bukan resource ID utama untuk MS Project. |
| Machine | `workcenter` | `machineid` | Ada constraint unique `workcenter_machineid_unique`. Cocok sebagai sumber resource `MACHINE`. |
| Workcenter | `workcenter` | `workcenternew` | Ada constraint unique `workcenter_workcenternew_unique`. `workcenterold` dan `workcenterot` tetap berguna sebagai alias/history. |
| Timesheet employee reference | `timesheet_transaction` | `serialnumber` | FK existing ke `usernfc.snssb`. Bisa dipakai untuk validasi history employee, bukan master baru. |

Kolom penting yang sudah ditemukan:

| Tabel | Kolom relevan |
| --- | --- |
| `usernfc` | `nfcid`, `full_name`, `snssb`, `machineid`, `machinename`, `workcenter`, `roles` |
| `workcenter` | `idrow`, `workcenterot`, `machineid`, `workcenter_description`, `workcenternew`, `workcenterold` |
| `timesheet_transaction` | `serialnumber`, `full_name`, `machineid`, `workcentercode`, `workcenterdescription`, `order_no`, `operation_no` |

Keputusan awal:

1. `usernfc` menjadi sumber master awal untuk resource `PERSON`.
2. `workcenter.machineid` menjadi sumber master awal untuk resource `MACHINE`.
3. `workcenter.workcenternew` menjadi sumber master awal untuk resource `WORKCENTER`.
4. `timesheet_transaction` tidak menjadi master resource, tetapi dipakai untuk validasi histori, conflict context, atau audit relasi person-machine-workcenter.
5. Jangan membuat tabel master employee baru selama `usernfc` masih valid sebagai sumber person.

Audit live PostgreSQL tetap wajib sebelum migration final. Pakai kredensial `.env`, tetapi jangan expose password di log/dokumen.

Query audit yang disarankan:

```sql
select count(*) from public.usernfc;
select count(*) from public.workcenter;

select snssb, count(*)
from public.usernfc
where snssb is not null and trim(snssb) <> ''
group by snssb
having count(*) > 1;

select machineid, count(*)
from public.workcenter
where machineid is not null and trim(machineid) <> ''
group by machineid
having count(*) > 1;

select workcenternew, count(*)
from public.workcenter
where workcenternew is not null and trim(workcenternew) <> ''
group by workcenternew
having count(*) > 1;

select
  u.snssb,
  u.full_name,
  u.machineid,
  u.workcenter,
  w.workcenternew,
  w.workcenter_description
from public.usernfc u
left join public.workcenter w on w.machineid = u.machineid
order by u.full_name
limit 50;

select
  workcenternew,
  count(*) filter (where machineid is not null and trim(machineid) <> '') as machine_count
from public.workcenter
group by workcenternew
order by workcenternew;
```

## 4. Definisi Resource

Pisahkan dua konsep ini sejak database, API, dan VBA.

### `resource_type`

Klasifikasi teknis yang kompatibel dengan Microsoft Project:

| Value | Makna |
| --- | --- |
| `WORK` | Resource berbasis waktu/kapasitas kerja. Person, machine, workcenter, dan team biasanya masuk sini. |
| `MATERIAL` | Material consumable. Bisa disiapkan, tetapi bukan prioritas MVP. |
| `COST` | Cost resource. Bisa disiapkan, tetapi bukan prioritas MVP. |

### `resource_category`

Klasifikasi bisnis internal:

| Value | Makna |
| --- | --- |
| `PERSON` | Employee/operator/person dari `usernfc`. |
| `MACHINE` | Mesin individual dari `workcenter.machineid`. |
| `WORKCENTER` | Workcenter/generic capacity group dari kode workcenter. |
| `TEAM` | Resource grup manual, misalnya team welder atau project team. |
| `MATERIAL` | Material jika nanti diperlukan. |

Catatan desain:

1. Employee/person umumnya `resource_type = 'WORK'` dan `resource_category = 'PERSON'`.
2. Mesin individual umumnya `resource_type = 'WORK'` dan `resource_category = 'MACHINE'`.
3. Workcenter bukan mesin individual. Workcenter bisa menjadi grouping, generic resource, dan pada kasus tertentu bisa assignable.
4. Employee resource bukan app user account. Login aplikasi tetap konsep terpisah.

## 5. Database Design MVP

Rekomendasi tetap membuat tabel khusus `ms_project*`, bukan memodifikasi besar tabel `sow`.

### `ms_project`

```sql
create table if not exists ms_project (
  project_id uuid primary key default gen_random_uuid(),
  project_name text not null,
  description text,
  status text not null default 'ACTIVE',
  source_type text default 'MS_PROJECT',
  revision_no integer not null default 1,
  published_revision_no integer,
  last_published_at timestamptz,
  checked_out_by text,
  checked_out_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Index:

```sql
create index if not exists idx_ms_project_status_updated
on ms_project(status, updated_at desc);
```

`checked_out_by` dan `checked_out_at` di `ms_project` hanya denormalized display metadata untuk Project Center. Source of truth lock tetap `ms_project_lock`.

### `ms_project_task`

```sql
create table if not exists ms_project_task (
  task_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id),
  parent_task_id uuid null,
  task_name text not null,
  outline_level integer,
  outline_number text,
  order_no text,
  operation_no text,
  ssbr_id text,
  sow_id integer null,
  workcenter text,
  plan_start timestamptz,
  plan_finish timestamptz,
  duration_minutes integer,
  planned_work_minutes integer,
  actual_start timestamptz,
  actual_finish timestamptz,
  actual_work_minutes integer,
  actual_progress numeric(5,2),
  actual_source text,
  actual_updated_at timestamptz,
  is_summary boolean default false,
  is_active boolean default true,
  local_task_uid text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (project_id, task_id),
  constraint fk_ms_project_task_parent_same_project
    foreign key (project_id, parent_task_id)
    references ms_project_task(project_id, task_id)
);
```

Index:

```sql
create index if not exists idx_ms_project_task_project
on ms_project_task(project_id, is_active);

create index if not exists idx_ms_project_task_business
on ms_project_task(project_id, order_no, operation_no);

create index if not exists idx_ms_project_task_window
on ms_project_task(plan_start, plan_finish);

create unique index if not exists uq_ms_project_task_local_uid
on ms_project_task(project_id, local_task_uid)
where local_task_uid is not null;
```

Jangan unique-kan `project_id + order_no + operation_no` pada MVP. Gunakan `task_id` sebagai technical upsert key karena MS Project bisa punya summary/manual task dan duplikasi bisnis yang perlu dibersihkan user.

Actual ownership:

1. `plan_start`, `plan_finish`, `duration_minutes`, dan `planned_work_minutes` berasal dari Microsoft Project.
2. `actual_start`, `actual_finish`, `actual_work_minutes`, dan `actual_progress` berasal dari PostgreSQL/timesheet/transaksi lapangan.
3. Endpoint sync planning tidak boleh mengubah kolom `actual_*`.
4. Existing actual sync tetap berupa read-from-API flow yang mengisi Microsoft Project dari data lapangan.

### `ms_resource`

`ms_resource` adalah central resource registry untuk Microsoft Project. Tabel ini tidak mengganti master existing seperti `usernfc` dan `workcenter`; tabel ini menyimpan ID stabil, mapping sumber, dan properti kapasitas untuk kebutuhan MS Project.

```sql
create table if not exists ms_resource (
  resource_id uuid primary key default gen_random_uuid(),
  resource_code text unique not null,
  resource_name text not null,
  resource_type text not null default 'WORK',
  resource_category text not null,
  source_type text not null,
  source_ref_id text,
  employee_id text null,
  machine_id text null,
  workcenter_code text null,
  parent_resource_id uuid null references ms_resource(resource_id),
  max_units numeric(10,2) not null default 1,
  is_assignable boolean not null default true,
  is_generic boolean not null default false,
  is_active boolean not null default true,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint chk_ms_resource_type
    check (resource_type in ('WORK', 'MATERIAL', 'COST')),
  constraint chk_ms_resource_category
    check (resource_category in ('PERSON', 'MACHINE', 'WORKCENTER', 'TEAM', 'MATERIAL')),
  constraint chk_ms_resource_max_units_positive
    check (max_units > 0)
);
```

Index/constraint tambahan:

```sql
create unique index if not exists uq_ms_resource_source
on ms_resource(source_type, source_ref_id)
where source_ref_id is not null;

create index if not exists idx_ms_resource_search
on ms_resource(resource_category, is_active, resource_code);

create index if not exists idx_ms_resource_workcenter
on ms_resource(workcenter_code)
where workcenter_code is not null;
```

Contoh isi:

| resource_code | resource_type | resource_category | source_type | source_ref_id | max_units |
| --- | --- | --- | --- | --- | --- |
| `EMP-00123` | `WORK` | `PERSON` | `EMPLOYEE_MASTER` | `00123` | `1.0` |
| `MCH-LATHE-01` | `WORK` | `MACHINE` | `MACHINE_MASTER` | `LATHE-01` | `1.0` |
| `WC-LATHE` | `WORK` | `WORKCENTER` | `WORKCENTER_MASTER` | `WC-LATHE` | `1.0` atau lebih |
| `TEAM-WELDER` | `WORK` | `TEAM` | `MANUAL_ADMIN` | manual key | `1.0` atau lebih |

`source_ref_id` harus menyimpan stable key aktual, bukan nama kolom literal. Nama kolom hanya muncul di dokumentasi mapping dan query upsert.

Mapping sumber awal:

| Category | Source | Mapping |
| --- | --- | --- |
| `PERSON` | `usernfc` | `resource_code = 'EMP-' || snssb`, `resource_name = full_name`, `employee_id = snssb`, `machine_id = usernfc.machineid`, `workcenter_code = usernfc.workcenter` |
| `MACHINE` | `workcenter` | `resource_code = 'MCH-' || machineid`, `resource_name = workcenter_description atau machineid`, `machine_id = machineid`, `workcenter_code = workcenternew` |
| `WORKCENTER` | `workcenter` | `resource_code = 'WC-' || workcenternew`, `resource_name = workcenter_description atau workcenternew`, `workcenter_code = workcenternew`, `is_generic = true` |
| `TEAM` | Admin/manual | `resource_code = 'TEAM-' || code`, `is_generic = true` |

Keputusan workcenter:

1. Workcenter dipakai sebagai grouping/generic capacity resource.
2. Workcenter boleh `is_assignable = true` jika planner ingin assign ke kapasitas umum, bukan mesin/person spesifik.
3. Machine individual tetap resource terpisah dari workcenter.
4. `parent_resource_id` dapat menghubungkan machine/person ke workcenter generic jika mapping sumbernya jelas.
5. Audit cardinality `workcenternew -> machineid` wajib dilakukan sebelum memutuskan default `is_assignable` untuk `WORKCENTER` dan `MACHINE` sama-sama aktif.

Keputusan machine:

1. Machine individual diprioritaskan dari `workcenter.machineid`.
2. Jika `machineid` kosong, row itu tetap bisa menghasilkan `WORKCENTER`, tetapi tidak menghasilkan `MACHINE`.
3. Audit live DB harus memastikan apakah semua mesin yang dipakai operation/timesheet memang tersedia di `workcenter`.

### `ms_project_resource`

`ms_project_resource` masuk MVP. Tabel ini adalah project resource team, yaitu resource perusahaan yang dipilih untuk satu project meskipun belum memiliki assignment.

```sql
create table if not exists ms_project_resource (
  project_resource_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id),
  resource_id uuid not null references ms_resource(resource_id),
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (project_id, resource_id)
);
```

Pembagian peran:

| Tabel | Peran |
| --- | --- |
| `ms_resource` | Seluruh master resource perusahaan untuk MS Project. |
| `ms_project_resource` | Resource yang dipilih masuk ke project tertentu. |
| `ms_project_assignment` | Resource yang benar-benar ditugaskan ke task tertentu. |

Jangan load semua active company resources ke setiap file `.mpp`. Macro harus load Resource Sheet hanya dari project resource team.

### `ms_project_assignment`

```sql
create table if not exists ms_project_assignment (
  assignment_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id),
  task_id uuid not null,
  resource_id uuid not null references ms_resource(resource_id),
  assignment_units numeric(10,2) not null default 1,
  planned_work_minutes integer,
  actual_work_minutes integer,
  actual_start timestamptz,
  actual_finish timestamptz,
  assignment_start timestamptz,
  assignment_finish timestamptz,
  is_active boolean default true,
  local_assignment_uid text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (project_id, assignment_id),
  constraint chk_ms_project_assignment_units_positive
    check (assignment_units > 0),
  constraint fk_ms_project_assignment_task_same_project
    foreign key (project_id, task_id)
    references ms_project_task(project_id, task_id),
  constraint fk_ms_project_assignment_project_resource
    foreign key (project_id, resource_id)
    references ms_project_resource(project_id, resource_id)
);
```

Index:

```sql
create index if not exists idx_ms_project_assignment_resource_window
on ms_project_assignment(resource_id, assignment_start, assignment_finish)
where is_active = true;

create index if not exists idx_ms_project_assignment_project
on ms_project_assignment(project_id, is_active);

create unique index if not exists uq_ms_project_assignment_local_uid
on ms_project_assignment(project_id, local_assignment_uid)
where local_assignment_uid is not null;
```

Validation wajib di API:

1. `task_id` harus valid dan aktif.
2. `resource_id` harus valid dan aktif.
3. `resource_id` harus sudah ada di `ms_project_resource` untuk `project_id` yang sama.
4. `assignment_units` harus decimal lebih besar dari nol. `1.0 = 100%`, `0.5 = 50%`, `2.0 = 200%`.
5. Jika resource belum masuk project team, response warning/error terstruktur. Jangan silently insert assignment.

Actual ownership di assignment:

1. `assignment_start`, `assignment_finish`, `assignment_units`, dan `planned_work_minutes` berasal dari Microsoft Project.
2. `actual_work_minutes`, `actual_start`, dan `actual_finish` berasal dari PostgreSQL/timesheet/transaksi lapangan.
3. Endpoint sync planning tidak boleh overwrite `actual_*`.

Jangan unique-kan `task_id + resource_id` dulu pada MVP. MS Project dapat punya assignment split atau pola assignment yang perlu dipastikan dulu.

### `ms_project_dependency`

MVP boleh dibuat ringan:

```sql
create table if not exists ms_project_dependency (
  dependency_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id),
  predecessor_task_id uuid not null,
  successor_task_id uuid not null,
  dependency_type text,
  lag_minutes integer,
  local_dependency_key text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (project_id, dependency_id),
  constraint fk_ms_project_dependency_pred_same_project
    foreign key (project_id, predecessor_task_id)
    references ms_project_task(project_id, task_id),
  constraint fk_ms_project_dependency_succ_same_project
    foreign key (project_id, successor_task_id)
    references ms_project_task(project_id, task_id)
);
```

Index dependency:

```sql
create unique index if not exists uq_ms_project_dependency_local_key
on ms_project_dependency(project_id, local_dependency_key)
where local_dependency_key is not null;
```

Format `local_dependency_key` rekomendasi:

```text
{predecessor_local_task_uid}|{successor_local_task_uid}|{dependency_type}|{lag_minutes}
```

Untuk MVP, predecessor dan successor harus berada dalam project yang sama. Cross-project dependency baru boleh masuk fase lanjutan setelah Single Project Editor stabil.

### `ms_project_lock`

`ms_project_lock` adalah replikasi konsep check-out PWA. Satu project hanya boleh punya satu lock aktif.

```sql
create table if not exists ms_project_lock (
  project_id uuid primary key references ms_project(project_id) on delete cascade,
  locked_by text not null,
  lock_token uuid not null default gen_random_uuid(),
  locked_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz,
  lock_reason text,
  client_info jsonb
);
```

Aturan lock:

1. `checkout` insert row baru jika belum ada lock aktif.
2. Jika lock aktif milik user lain, API return `409 Conflict`.
3. Semua `sync`, `publish`, dan `checkin` project existing wajib membawa `lock_token`.
4. Heartbeat memperbarui `heartbeat_at` dan optional `expires_at`.
5. Admin boleh force check-in lock stale, tetapi wajib masuk audit log.

### `ms_project_revision`

`ms_project_revision` menyimpan histori revision project. MVP boleh menyimpan summary dan snapshot ringkas dalam JSONB. Jika kebutuhan diff semakin besar, snapshot bisa dinormalisasi ke tabel `*_version`.

```sql
create table if not exists ms_project_revision (
  revision_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id) on delete cascade,
  revision_no integer not null,
  revision_type text not null,
  created_by text,
  created_at timestamptz not null default now(),
  summary jsonb,
  snapshot jsonb,
  unique (project_id, revision_no),
  constraint chk_ms_project_revision_type
    check (revision_type in ('IMPORT', 'PUBLISH_NEW', 'SYNC', 'PUBLISH', 'CHECKOUT', 'CHECKIN', 'FORCE_CHECKIN', 'CLONE'))
);
```

### `ms_project_publish`

`ms_project_publish` adalah published state. Ini meniru published database PWA tanpa langsung memecah semua tabel draft/published pada MVP.

```sql
create table if not exists ms_project_publish (
  publish_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id) on delete cascade,
  revision_no integer not null,
  published_by text,
  published_at timestamptz not null default now(),
  publish_status text not null default 'PUBLISHED',
  snapshot jsonb not null,
  unique (project_id, revision_no)
);
```

Untuk MVP, `snapshot` berisi package project published:

```json
{
  "project": {},
  "project_resources": [],
  "tasks": [],
  "assignments": [],
  "dependencies": []
}
```

Fase lanjutan dapat memecah published state ke tabel fisik seperti `ms_project_task_published`, tetapi jangan lakukan sebelum workflow check-out/sync/publish stabil.

### `ms_project_audit_log`

Audit log wajib untuk menelusuri perubahan, force check-in, publish, clone, dan sync dari VBA/API.

```sql
create table if not exists ms_project_audit_log (
  audit_id uuid primary key default gen_random_uuid(),
  project_id uuid references ms_project(project_id) on delete set null,
  revision_no integer,
  actor text,
  action text not null,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  client_info jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ms_project_audit_project_time
on ms_project_audit_log(project_id, created_at desc);
```

### Tabel fase lanjutan

Tabel berikut tidak wajib untuk API backend MVP pertama, tetapi harus masuk roadmap agar sistem tidak mentok saat ingin mendekati kemampuan PWA:

| Tabel | Fungsi |
| --- | --- |
| `ms_project_file_import` | Metadata import `.mpp`/XML: filename, hash, parser version, imported_by. |
| `ms_project_calendar` | Calendar project/resource. |
| `ms_project_calendar_exception` | Hari libur, non-working time, shift exception. |
| `ms_project_resource_availability` | Date-ranged `MaxUnits`/availability seperti Resource Availability grid Microsoft Project. |
| `ms_project_baseline` | Header baseline project. |
| `ms_project_baseline_task` | Baseline start/finish/duration/work per task. |
| `ms_project_baseline_assignment` | Baseline work/units per assignment. |
| `ms_project_custom_field` | Definisi custom field yang diimpor dari MS Project. |
| `ms_project_custom_field_value` | Nilai custom field per project/task/resource/assignment. |
| `ms_project_queue_job` | Queue/retry/cancel untuk publish, sync berat, refresh resource/calendar, dan reporting snapshot. |
| `ms_project_document` | Metadata dokumen/attachment/link pendukung project. |
| `ms_project_object_link` | Link project/task/resource/assignment ke dokumen, issue, risk, atau deliverable. |

### Desain Calendar & Scheduling Roadmap

Status: belum masuk backend/VBA MVP. Section ini mengunci desain agar implementasi calendar nanti tidak sekadar menyimpan nama kalender, tetapi cukup lengkap untuk mendekati perilaku Microsoft Project / PWA.

Referensi konsep Microsoft:

1. Microsoft Project memiliki empat tipe kalender utama: `base calendar`, `project calendar`, `resource calendar`, dan `task calendar`.
2. Base calendar bertindak sebagai template untuk project/resource/task calendar. Default Project Desktop mencakup `Standard`, `24 Hours`, dan `Night Shift`.
3. Project, resource, dan task calendar "stack together" saat scheduling; kalender membatasi kapan work boleh dijadwalkan.
4. Pada Project Server/PWA, enterprise calendar dikelola terpusat oleh administrator. Project Professional atau Project Web App memakai scheduling/calculation service untuk menghitung perubahan schedule.
5. Project Server menyarankan client memakai API/business layer (`CSOM`/`PSI`) dan reporting objects, bukan direct write ke draft/published/archive table.

Implikasi untuk MPS:

1. PostgreSQL harus menyimpan calendar sebagai master scheduling metadata, tetapi Microsoft Project Desktop tetap menjadi engine kalkulasi utama pada MVP calendar.
2. Backend tidak boleh mencoba reimplement full scheduling engine Microsoft Project pada tahap awal. Backend menyimpan hasil schedule (`plan_start`, `plan_finish`, `duration_minutes`, `planned_work_minutes`) beserta calendar definition yang dipakai.
3. Jika MPS nantinya ingin capacity planning server-side, calendar dipakai untuk menghitung working window, resource availability, dan conflict warning yang lebih akurat.
4. Calendar master harus enterprise-level, bukan dibuat bebas dari tiap file `.mpp`, supaya standard shift dan holiday perusahaan konsisten.

#### Konsep kalender yang harus didukung

| Konsep | Definisi | Mapping MPS |
| --- | --- | --- |
| Base Calendar | Template working/non-working time. Contoh: Standard, 24 Hours, Night Shift. | `ms_project_calendar.calendar_scope = 'BASE'`. |
| Enterprise Calendar | Base calendar yang dikelola pusat di PWA/Project Server. | Semua calendar global MPS dengan `is_enterprise = true`. |
| Project Calendar | Kalender default project. Menentukan working time default untuk task tanpa override. | `ms_project.calendar_id`. |
| Resource Calendar | Kalender resource/person/machine/team; bisa punya exception seperti cuti, maintenance, shift khusus. | `ms_resource.calendar_id` atau mapping override di tabel assignment calendar. |
| Task Calendar | Kalender khusus task, misalnya pekerjaan weekend/night shift. | `ms_project_task.calendar_id`. |
| Exception Calendar | Tanggal/rentang khusus yang override weekly pattern: holiday, shutdown, cuti, maintenance. | `ms_project_calendar_exception`. |
| Recurring Exception | Exception berulang: weekly, monthly, yearly, atau pola tertentu. | `ms_project_calendar_exception.recurrence_rule`. |

#### Tabel calendar yang disarankan

##### `ms_project_calendar`

```sql
create table if not exists ms_project_calendar (
  calendar_id uuid primary key default gen_random_uuid(),
  calendar_code text unique not null,
  calendar_name text not null,
  calendar_scope text not null default 'BASE',
  base_calendar_id uuid null references ms_project_calendar(calendar_id),
  is_enterprise boolean not null default true,
  is_default boolean not null default false,
  is_active boolean not null default true,
  hours_per_day numeric(10,2) not null default 8,
  hours_per_week numeric(10,2) not null default 40,
  days_per_month numeric(10,2) not null default 20,
  timezone text not null default 'Asia/Jakarta',
  description text,
  source_type text not null default 'MPS',
  source_ref_id text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ms_project_calendar_scope
    check (calendar_scope in ('BASE', 'PROJECT', 'RESOURCE', 'TASK')),
  constraint chk_ms_project_calendar_hours_positive
    check (hours_per_day > 0 and hours_per_week > 0 and days_per_month > 0)
);
```

Catatan:

1. `calendar_scope = 'BASE'` dipakai untuk enterprise/base calendar seperti `STANDARD`, `24H`, `NIGHT_SHIFT`.
2. `base_calendar_id` membuat turunan calendar seperti resource calendar dari base calendar.
3. `hours_per_day`, `hours_per_week`, dan `days_per_month` disimpan karena Microsoft Project memakai setting ini untuk konversi durasi.
4. `timezone` wajib karena MPS beroperasi lintas zona waktu Indonesia dan date/time dari Project Desktop perlu dinormalisasi.

##### `ms_project_calendar_weekday`

```sql
create table if not exists ms_project_calendar_weekday (
  calendar_weekday_id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references ms_project_calendar(calendar_id) on delete cascade,
  day_of_week integer not null,
  day_type text not null default 'WORKING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_id, day_of_week),
  constraint chk_ms_project_calendar_weekday_dow
    check (day_of_week between 1 and 7),
  constraint chk_ms_project_calendar_weekday_type
    check (day_type in ('WORKING', 'NON_WORKING', 'DEFAULT'))
);
```

Konvensi `day_of_week`: `1 = Monday` sampai `7 = Sunday`.

##### `ms_project_calendar_working_time`

```sql
create table if not exists ms_project_calendar_working_time (
  working_time_id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references ms_project_calendar(calendar_id) on delete cascade,
  day_of_week integer not null,
  segment_no integer not null default 1,
  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_id, day_of_week, segment_no),
  constraint chk_ms_project_calendar_working_time_dow
    check (day_of_week between 1 and 7),
  constraint chk_ms_project_calendar_working_time_segment
    check (segment_no > 0)
);
```

Catatan:

1. Satu hari bisa punya beberapa segment, misalnya `08:00-12:00` dan `13:00-17:00`.
2. Night shift yang melewati tengah malam harus pakai `crosses_midnight = true`, bukan menyimpan jam negatif.

##### `ms_project_calendar_exception`

```sql
create table if not exists ms_project_calendar_exception (
  exception_id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references ms_project_calendar(calendar_id) on delete cascade,
  exception_name text not null,
  exception_type text not null default 'NON_WORKING',
  start_date date not null,
  end_date date not null,
  recurrence_rule jsonb,
  priority integer not null default 100,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ms_project_calendar_exception_type
    check (exception_type in ('WORKING', 'NON_WORKING', 'REDUCED_WORKING')),
  constraint chk_ms_project_calendar_exception_window
    check (end_date >= start_date)
);
```

`recurrence_rule` memakai JSON agar cukup fleksibel untuk pola berulang:

```json
{
  "frequency": "YEARLY",
  "interval": 1,
  "month": 12,
  "day": 25,
  "until": "2030-12-31"
}
```

##### `ms_project_calendar_exception_time`

```sql
create table if not exists ms_project_calendar_exception_time (
  exception_time_id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references ms_project_calendar_exception(exception_id) on delete cascade,
  segment_no integer not null default 1,
  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exception_id, segment_no),
  constraint chk_ms_project_calendar_exception_time_segment
    check (segment_no > 0)
);
```

Jika `exception_type = 'NON_WORKING'`, tabel time ini boleh kosong. Jika `WORKING` atau `REDUCED_WORKING`, tabel ini mendefinisikan working segment override pada tanggal exception.

#### Relasi calendar ke entity planning

Tambahkan kolom saat calendar feature diimplementasikan:

```sql
alter table ms_project
  add column if not exists calendar_id uuid null references ms_project_calendar(calendar_id);

alter table ms_resource
  add column if not exists calendar_id uuid null references ms_project_calendar(calendar_id);

alter table ms_project_task
  add column if not exists calendar_id uuid null references ms_project_calendar(calendar_id),
  add column if not exists ignore_resource_calendar boolean not null default false;
```

Aturan inheritance:

1. `ms_project.calendar_id` adalah default project calendar.
2. `ms_project_task.calendar_id` override project calendar untuk task tertentu.
3. `ms_resource.calendar_id` menentukan availability resource.
4. Jika task punya task calendar dan resource assignment, scheduling harus mempertimbangkan perpotongan task calendar dan resource calendar, kecuali `ignore_resource_calendar = true`.
5. Jika tidak ada calendar khusus, gunakan enterprise default calendar (`is_default = true`).

#### Scheduling rules yang harus dipertahankan

1. Durasi task dihitung berdasarkan working time calendar, bukan elapsed wall-clock time, kecuali task dibuat sebagai elapsed duration di Microsoft Project.
2. Non-working day tidak boleh menghasilkan planned work normal.
3. Holiday/company shutdown harus berasal dari exception calendar.
4. Resource availability untuk conflict/capacity harus memakai `resource calendar + max_units + assignment_units`.
5. Dependency `FS/SS/FF/SF` tetap dihitung oleh Microsoft Project Desktop pada MVP; backend menyimpan hasil tanggal dan dependency metadata.
6. Backend conflict check fase lanjut boleh menghitung overlap berdasarkan working windows, bukan hanya timestamp overlap.
7. Perubahan calendar harus membuat warning bahwa schedule perlu recalculation di Microsoft Project sebelum publish.

#### Integrasi dengan shift MPS existing

MPS sudah memiliki `shift_definition` untuk SOW scheduling. Integrasi calendar tidak boleh menduplikasi konsep shift tanpa mapping.

Mapping awal:

| Sumber MPS | Calendar target |
| --- | --- |
| `shift_definition.shift_code` | `ms_project_calendar.calendar_code` untuk calendar shift. |
| `start_time`, `end_time`, `crosses_midnight` | `ms_project_calendar_working_time`. |
| `default_capacity_hours` | `hours_per_day` atau capacity hint. |
| Date override shift | `ms_project_calendar_exception` + `exception_time`. |

Keputusan:

1. `shift_definition` tetap sumber operasional SOW scheduling.
2. `ms_project_calendar` menjadi mirror/scheduling profile untuk MS Project integration.
3. Sync shift ke calendar harus idempotent dan menulis `source_type = 'SHIFT_DEFINITION'`.

#### API calendar roadmap

Endpoint yang perlu dibuat saat calendar feature dimulai:

| Endpoint | Fungsi |
| --- | --- |
| `GET /ms-project/calendars` | List/search enterprise calendars. |
| `GET /ms-project/calendars/:calendar_id` | Detail calendar lengkap dengan weekday, working time, exception. |
| `POST /ms-project/calendars` | Create calendar enterprise/manual. |
| `PUT /ms-project/calendars/:calendar_id` | Update header calendar. |
| `PUT /ms-project/calendars/:calendar_id/weekdays` | Replace weekly working pattern. |
| `POST /ms-project/calendars/:calendar_id/exceptions` | Add exception/holiday/maintenance. |
| `PUT /ms-project/calendars/:calendar_id/exceptions/:exception_id` | Update exception. |
| `DELETE /ms-project/calendars/:calendar_id/exceptions/:exception_id` | Deactivate/delete exception. |
| `POST /ms-project/calendars/refresh-from-shifts` | Build/update calendars from `shift_definition`. |

#### VBA calendar roadmap

VBA harus memakai Microsoft Project Object Model sebagai sumber utama calendar data dari file aktif.

Deliverable:

1. Export active project calendar name, hours/day, hours/week, days/month.
2. Export base calendar name for project, resource, dan task jika accessible.
3. Export weekday working times dari `WeekDays`.
4. Export exception dates dari calendar exceptions jika accessible.
5. Import enterprise calendar list dari API.
6. Set project calendar dari selected enterprise calendar.
7. Set resource base calendar saat loading project team.
8. Simpan `calendar_id` pada custom field yang aman jika Object Model tidak menyediakan stable enterprise UID.

Acceptance:

1. Project baru dapat memilih enterprise calendar sebelum publish.
2. Resource calendar tidak dibuat bebas di file `.mpp`; harus berasal dari API/enterprise calendar.
3. Holiday/maintenance dari API muncul sebagai non-working time setelah import ke MS Project.
4. Jika calendar berubah di server setelah project diimport, VBA memberi warning untuk reload/recalculate sebelum sync.
5. Publish/sync mengirim `calendar_id` untuk project/resource/task jika tersedia.

### Relational integrity wajib

Jika `project_id` disimpan juga di assignment dan dependency untuk kemudahan query, schema dan API harus mencegah relasi lintas project.

Aturan:

1. `ms_project_task.parent_task_id` harus berada pada `project_id` yang sama.
2. `ms_project_assignment.task_id` harus berada pada `project_id` yang sama.
3. `ms_project_assignment.resource_id` harus sudah berada di `ms_project_resource` untuk `project_id` yang sama.
4. `ms_project_dependency.predecessor_task_id` dan `successor_task_id` harus berada pada `project_id` yang sama untuk MVP.
5. Assignment hanya boleh mengacu ke resource yang aktif dan assignable.
6. Assignment hanya boleh mengacu ke project resource team yang aktif.

Yang bisa dikunci di DB:

1. Composite FK `(project_id, parent_task_id)` ke `ms_project_task(project_id, task_id)`.
2. Composite FK `(project_id, task_id)` dari assignment ke task.
3. Composite FK `(project_id, resource_id)` dari assignment ke project resource team.
4. Composite FK dependency ke predecessor/successor task dalam project sama.

Yang tetap harus divalidasi API:

1. `ms_resource.is_active = true`.
2. `ms_resource.is_assignable = true`.
3. `ms_project_resource.is_active = true`.
4. Business rule snapshot/deactivation.

## 6. Pencegahan Duplikasi Resource

Aturan anti-duplikasi:

1. `ms_resource.resource_code` unique.
2. `(source_type, source_ref_id)` unique jika `source_ref_id` tidak null.
3. Refresh resource memakai upsert berdasarkan source identity, bukan insert bebas.
4. Macro Microsoft Project tidak boleh membuat master resource baru secara bebas.
5. Jika resource tidak ditemukan, user diarahkan memakai Search Resource Pool atau admin refresh.
6. `Resource.Text9` wajib menyimpan `resource_id`.
7. `ms_project_resource` punya `unique(project_id, resource_id)`.
8. `Assignment.Text10` menyimpan `assignment_id`, bukan dipakai untuk resource identity.

## 7. API Design

Gunakan Express route baru:

```js
app.use('/ms-project', require('./routes/msProject'));
```

Endpoint MVP:

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/ms-project/health` | Check API dan DB dari VBA. |
| `GET` | `/ms-project/projects` | List project ringkas. Query: `status`, `q`, `limit`. |
| `GET` | `/ms-project/projects/:project_id/package` | Ambil project, project resources, tasks, assignments, dependencies. |
| `POST` | `/ms-project/projects` | Publish project baru. |
| `POST` | `/ms-project/projects/:project_id/checkout` | Check-out project existing dan buat lock eksklusif. |
| `POST` | `/ms-project/projects/:project_id/heartbeat` | Perpanjang lock session saat user masih mengedit. |
| `PUT` | `/ms-project/projects/:project_id/sync` | Sync existing project dalam transaksi. |
| `POST` | `/ms-project/projects/:project_id/publish` | Publish current revision menjadi published snapshot. |
| `POST` | `/ms-project/projects/:project_id/checkin` | Release lock setelah sync/publish selesai. |
| `POST` | `/ms-project/projects/:project_id/force-checkin` | Admin release lock stale atau lock bermasalah. |
| `POST` | `/ms-project/projects/bulk-load` | Ambil beberapa package project sekaligus. |
| `GET` | `/ms-project/resources` | Search resource pool. |
| `GET` | `/ms-project/projects/:project_id/resources` | Load project resource team. |
| `POST` | `/ms-project/projects/:project_id/resources` | Add/reactivate selected resource ke project team existing. |
| `DELETE` | `/ms-project/projects/:project_id/resources/:resource_id` | Deactivate resource dari project team existing. |
| `POST` | `/ms-project/resources/refresh` | Upsert resource dari sumber master. |
| `GET` | `/ms-project/resources/conflicts` | Check warning konflik kapasitas resource. |

Contoh query resource:

```http
GET /ms-project/resources
GET /ms-project/resources?active=true&category=PERSON&q=keyword
GET /ms-project/resources?active=true&category=MACHINE&workcenter_code=LATHE
```

Refresh resource tidak boleh hanya dari workcenter:

```json
{
  "sources": ["WORKCENTER", "MACHINE", "EMPLOYEE"]
}
```

API refresh behavior:

| Source | Action |
| --- | --- |
| `EMPLOYEE` | Upsert `PERSON` dari `usernfc`. |
| `MACHINE` | Upsert `MACHINE` dari `workcenter.machineid`. |
| `WORKCENTER` | Upsert `WORKCENTER` dari `workcenter.workcenternew`. |
| `TEAM` | Untuk MVP manual/admin endpoint berikutnya, tidak dari refresh otomatis kecuali master team sudah ada. |

Catatan publish project baru:

1. `POST /ms-project/projects/:project_id/resources` tidak dipakai sebelum project memiliki `project_id`.
2. Project baru mengirim `project_resources` dalam payload `POST /ms-project/projects`.
3. API menyimpan project, resource team, task, assignment, dan dependency dalam satu transaksi.
4. Endpoint add/remove project team hanya untuk project existing.

Catatan check-out/check-in:

1. `checkout` mengembalikan `lock_token`, `revision_no`, dan project package.
2. `sync`, `publish`, `heartbeat`, dan `checkin` wajib mengirim `lock_token`.
3. `force-checkin` hanya untuk role admin dan wajib menulis `ms_project_audit_log`.
4. Project Center harus menampilkan `checked_out_by`, `checked_out_at`, dan apakah lock stale.

Contoh response checkout:

```json
{
  "success": true,
  "data": {
    "project_id": "uuid",
    "revision_no": 4,
    "lock_token": "uuid",
    "locked_by": "planner.name",
    "package": {
      "project": {},
      "project_resources": [],
      "tasks": [],
      "assignments": [],
      "dependencies": []
    }
  }
}
```

### Workflow check-out, sync, publish, check-in

Workflow project existing:

```text
User pilih project
  -> POST /checkout
  -> API validasi permission dan lock
  -> API return package + revision_no + lock_token
  -> VBA isi MS Project dan simpan project_id/revision_no
  -> User edit schedule
  -> PUT /sync dengan lock_token + last_known_revision_no
  -> API validasi lock dan revision
  -> API upsert project_resources/tasks/assignments/dependencies dalam transaksi
  -> API increment revision_no dan tulis audit
  -> VBA simpan mapping UUID dan revision_no terbaru
  -> Optional POST /publish
  -> POST /checkin
```

Workflow publish project baru:

```text
File belum punya project_id
  -> User pilih temporary project team
  -> User klik Publish New Project
  -> POST /projects dengan full package
  -> API insert project/resources/tasks/assignments/dependencies dalam transaksi
  -> API buat revision PUBLISH_NEW
  -> API buat published snapshot awal
  -> API return project_id, revision_no, mapping UUID
  -> VBA simpan UUID ke custom fields
```

Workflow force check-in:

```text
Admin melihat project terkunci/stale
  -> POST /force-checkin
  -> API validasi role admin
  -> API release lock
  -> API tulis audit FORCE_CHECKIN dengan reason
  -> User berikutnya wajib checkout ulang
```

## 8. Sync Payload

### Publish project baru

Project baru belum memiliki `project_id`, sehingga belum dapat memakai endpoint:

```http
POST /ms-project/projects/:project_id/resources
```

Untuk project baru, resource team disimpan sementara di VBA UserForm dan/atau Resource Sheet. Saat user menekan `Publish New Project`, VBA mengirim satu bulk payload:

```json
{
  "project": {
    "project_name": "Master Schedule",
    "description": "",
    "status": "ACTIVE"
  },
  "project_resources": [],
  "tasks": [],
  "assignments": [],
  "dependencies": []
}
```

API wajib melakukan semua langkah berikut dalam satu transaksi:

1. Membuat `project_id`.
2. Menyimpan `project_resources`.
3. Insert tasks baru dan membuat mapping `local_task_uid -> task_id`.
4. Resolve parent task menggunakan `parent_local_task_uid`.
5. Insert assignments menggunakan mapping task dan `resource_id`.
6. Insert dependencies menggunakan mapping predecessor/successor.
7. Return mapping ID ke VBA.

Endpoint add/remove project team hanya dipakai setelah project sudah pernah dipublish dan memiliki `project_id`.

### Sync project existing

Payload sync existing:

```json
{
  "project": {
    "project_id": "uuid",
    "project_name": "Master Schedule",
    "description": "",
    "status": "ACTIVE",
    "last_known_revision_no": 3,
    "lock_token": "uuid"
  },
  "project_resources": [],
  "tasks": [],
  "assignments": [],
  "dependencies": []
}
```

`project_resources` berisi team project:

```json
[
  {
    "resource_id": "uuid",
    "is_active": true
  }
]
```

Task payload:

```json
[
  {
    "task_id": "uuid-or-null",
    "local_task_uid": "42",
    "parent_task_id": "uuid-or-null",
    "parent_local_task_uid": "10",
    "task_name": "Operation 0010",
    "outline_level": 2,
    "outline_number": "1.1",
    "order_no": "45000123",
    "operation_no": "0010",
    "ssbr_id": "SSBR-001",
    "plan_start": "2026-06-03T08:00:00+07:00",
    "plan_finish": "2026-06-03T16:00:00+07:00",
    "duration_minutes": 480,
    "planned_work_minutes": 480,
    "is_summary": false
  }
]
```

Assignment person/machine/workcenter/team dikirim dengan format yang sama:

```json
[
  {
    "assignment_id": "uuid-or-null",
    "local_assignment_uid": "123",
    "task_id": "uuid-or-null",
    "local_task_uid": "42",
    "resource_id": "uuid",
    "assignment_units": 1.0,
    "planned_work_minutes": 480,
    "assignment_start": "2026-06-03T08:00:00+07:00",
    "assignment_finish": "2026-06-03T16:00:00+07:00"
  }
]
```

Dependency payload:

```json
[
  {
    "dependency_id": "uuid-or-null",
    "predecessor_task_id": "uuid-or-null",
    "predecessor_local_task_uid": "42",
    "successor_task_id": "uuid-or-null",
    "successor_local_task_uid": "43",
    "dependency_type": "FS",
    "lag_minutes": 0,
    "is_active": true
  }
]
```

### Local UID correlation

Task, assignment, hierarchy, dan dependency baru belum memiliki UUID PostgreSQL. Gunakan local UID dari Microsoft Project sebagai correlation key lokal:

| Object | Local UID |
| --- | --- |
| Task | `Task.UniqueID` -> `local_task_uid` |
| Assignment | `Assignment.UniqueID` -> `local_assignment_uid` |
| Parent task | parent `Task.UniqueID` -> `parent_local_task_uid` |
| Dependency predecessor | predecessor `Task.UniqueID` -> `predecessor_local_task_uid` |
| Dependency successor | successor `Task.UniqueID` -> `successor_local_task_uid` |

Aturan:

1. Jangan gunakan nomor baris task sebagai correlation key.
2. Upsert task existing berdasarkan `task_id`.
3. Insert task baru jika belum memiliki `task_id`.
4. Buat mapping `local_task_uid -> task_id`.
5. Resolve parent task, assignment, dan dependency menggunakan mapping tersebut.
6. Return mapping ID ke VBA.
7. VBA menyimpan UUID PostgreSQL ke custom field Microsoft Project.

Validation:

1. `project.project_id` wajib valid untuk sync existing, tetapi kosong untuk publish project baru.
2. `project_resources[].resource_id` wajib ada di `ms_resource` dan aktif.
3. `tasks[].local_task_uid` wajib ada untuk task baru.
4. `assignments[].local_assignment_uid` wajib ada untuk assignment baru.
5. `assignments[].task_id` atau `assignments[].local_task_uid` wajib dapat resolve ke task project yang sama.
6. `dependencies` wajib resolve predecessor dan successor ke task project yang sama.
7. `assignment_units` wajib decimal lebih besar dari nol. `1.0 = 100%`, `0.5 = 50%`, `2.0 = 200%`.
8. VBA wajib menormalisasi Microsoft Project units menjadi decimal sebelum mengirim payload.
9. Planned sync tidak boleh mengirim atau mengubah kolom `actual_*`.
10. Sync tidak boleh menonaktifkan record hanya karena record tidak ada di payload kecuali request memakai mode snapshot/deactivate eksplisit.
11. `assignments[].resource_id` wajib ada di `project_resources`.
12. Unknown resource dari VBA tidak boleh otomatis dibuat.
13. API harus pakai transaksi untuk publish/sync.

Response sync:

```json
{
  "project_id": "...",
  "revision_no": 4,
  "updated_at": "...",
  "summary": {
    "tasks_created": 0,
    "tasks_updated": 0,
    "project_resources_created": 0,
    "project_resources_updated": 0,
    "assignments_created": 0,
    "assignments_updated": 0,
    "warnings": 0
  },
  "task_mappings": [
    { "local_task_uid": "12", "task_id": "..." }
  ],
  "resource_mappings": [
    { "resource_code": "EMP-00123", "resource_id": "..." }
  ],
  "assignment_mappings": [
    { "local_assignment_uid": "34", "assignment_id": "..." }
  ],
  "dependency_mappings": [
    { "predecessor_local_task_uid": "12", "successor_local_task_uid": "13", "dependency_id": "..." }
  ],
  "warnings": []
}
```

## 9. Microsoft Project Field Mapping

Jangan menimpa `Text1`, `Text2`, dan `Text3` karena sudah digunakan flow existing.

| Object | Data | Field rekomendasi | Catatan |
| --- | --- | --- | --- |
| Project | `project_id` | `ProjectSummaryTask.Text30` | ID project DB. |
| Project | `revision_no` | `ProjectSummaryTask.Text29` | Optimistic concurrency token utama. |
| Project | `project_mode` | `ProjectSummaryTask.Text28` | `SINGLE_PROJECT_EDITOR` atau `MASTER_PORTFOLIO_VIEW`. |
| Project session | `lock_token` | Project custom property atau field configurable | Token check-out session. Jangan simpan permanen saat clone. |
| Project | `project_name` | `ActiveProject.Title` | Disinkronkan dengan DB. |
| Task | `task_id` | `Task.Text10` | Technical key permanen. |
| Task | `project_id` | `Task.Text11` | Wajib untuk multi-project dalam satu file. |
| Task | `parent_task_id` | `Task.Text12` | Opsional, bisa dihitung dari outline. |
| Task | `order_no` | `Task.Text1` | Backward compatible. |
| Task | `operation_no` | `Task.Text2` | Backward compatible. |
| Task | `ssbr_id` | `Task.Text3` | Backward compatible. |
| Resource | `resource_id` | `Resource.Text9` | ID master resource dari PostgreSQL. |
| Resource | `resource_code` | `Resource.Name` atau `Resource.Initials` | Display dan matching fallback. |
| Assignment | `assignment_id` | `Assignment.Text10` | Technical key permanen. |
| Assignment | `local_assignment_uid` | `Assignment.UniqueID` payload | Jangan jadi primary key DB. |

Sebelum coding VBA, buat macro kecil `AuditCustomFields()` untuk scan field `Text1..Text30` di project aktif, task, resource, dan assignment. Jika field rekomendasi sudah dipakai user, pindahkan mapping lewat modul konfigurasi tunggal.

## 10. Mode File Microsoft Project

### Single Project Editor

Mode MVP untuk edit dan sync.

Aturan:

1. Satu file `.mpp` mewakili satu project.
2. `ProjectSummaryTask.Text30` menyimpan `project_id`.
3. `ProjectSummaryTask.Text29` menyimpan `revision_no`.
4. User boleh `Publish New Project` jika belum memiliki `project_id`.
5. User wajib `Check Out` sebelum `Sync Existing Project` atau `Publish`.
6. User boleh `Sync Existing Project` jika `lock_token` dan `revision_no` valid.
7. User boleh mengelola project resource team.
8. API sync hanya menerima task/assignment/dependency untuk satu `project_id`.

### Master Portfolio View

Mode MVP untuk view/read-only.

Aturan:

1. Satu file `.mpp` dapat menampilkan beberapa project.
2. Setiap summary task dan child task menyimpan `Task.Text11 = project_id`.
3. Untuk MVP, mode ini read-only.
4. Jangan izinkan `Sync Current Project` dari master portfolio view.
5. Macro harus mendeteksi lebih dari satu `project_id` aktif di task tree dan menampilkan warning read-only.
6. Sync beberapa project dari satu master file menjadi fase lanjutan setelah Single Project Editor stabil.

## 11. Save As dan Clone MPP

Risiko: user dapat menyalin file `.mpp` yang sudah memiliki UUID PostgreSQL, lalu menganggapnya project baru. Jika file hasil copy disync sebagai existing project, data DB lama bisa tertimpa.

Tambahkan dua action berbeda:

| Action | Fungsi |
| --- | --- |
| `Sync Existing Project` | Update project DB yang UUID-nya sudah tersimpan di file. |
| `Clone as New Project` | Membuat project baru dari file/template existing. |

Flow `Clone as New Project`:

1. Hapus `project_id` dari `ProjectSummaryTask.Text30`.
2. Hapus `revision_no` dari `ProjectSummaryTask.Text29`.
3. Hapus seluruh `task_id` dari `Task.Text10`.
4. Hapus seluruh `assignment_id` dari `Assignment.Text10`.
5. Pertahankan business key seperti `order_no`, `operation_no`, `ssbr_id`, task name, schedule, resource team, dan assignment planning.
6. Publish sebagai project baru memakai bulk payload.
7. Simpan UUID baru yang dikembalikan API.

Macro harus menampilkan konfirmasi sebelum clone karena action ini sengaja membuat project baru, bukan update project lama.

## 12. VBA UserForm MVP

Nama rekomendasi: `frmMsProjectSync`.

Kontrol utama:

| Control | Fungsi |
| --- | --- |
| `btnCheckConnection` | Cek API/DB. |
| `btnLoadProjects` | Load daftar project. |
| `lstProjects` | Multi-select project. |
| `btnImportSelectedProjects` | Import selected project. |
| `txtResourceSearch` | Keyword search resource pool. |
| `cmbResourceCategory` | Filter `PERSON`, `MACHINE`, `WORKCENTER`, `TEAM`. |
| `cmbWorkcenterFilter` | Filter by workcenter. |
| `btnSearchResourcePool` | Search resource pool. |
| `lstResourcePool` | Hasil resource pool. |
| `btnAddSelectedResourceToProject` | Add resource ke project team. |
| `btnRemoveResourceFromProject` | Remove/deactivate resource dari project team. |
| `btnLoadProjectTeam` | Load project resource team. |
| `btnRefreshResources` | Trigger refresh resource master dari API. |
| `btnPublishNewProject` | Publish project baru. |
| `btnSyncCurrentProject` | Sync project existing. |
| `btnCloneAsNewProject` | Clone file existing menjadi project baru. |
| `btnCheckResourceConflicts` | Check warning conflict. |
| `txtLog` | Log multiline. |

Import flow:

1. Ambil project package.
2. Ambil project resource team.
3. Isi Resource Sheet hanya dengan project team resources.
4. Buat task.
5. Buat assignment.
6. Simpan `resource_id` ke `Resource.Text9`.
7. Simpan `assignment_id` ke `Assignment.Text10`.
8. Simpan `project_id` dan `task_id` ke field custom yang sudah ditentukan.

Project team selection:

1. User search resource pool.
2. User filter category dan workcenter.
3. Jika file belum punya `project_id`, user add selected resources ke temporary project team di UserForm/Resource Sheet.
4. Jika file sudah punya `project_id`, macro/API menyimpan ke `ms_project_resource`.
5. Saat `Publish New Project`, temporary team dikirim sebagai `project_resources` dalam bulk payload.
6. Resource Sheet di `.mpp` hanya berisi project team, bukan semua resource perusahaan.

## 13. Modul VBA yang Disarankan

| Modul | Isi |
| --- | --- |
| `MsProjectConfig.bas` | Base URL, endpoint constants, field mapping constants. |
| `MsProjectHttp.bas` | Wrapper HTTP GET/POST/PUT/DELETE dengan status code dan response body. |
| `MsProjectJson.bas` | Helper JSON build/escape dan parse via `JsonConverter`. |
| `MsProjectFields.bas` | Read/write `project_id`, `task_id`, `resource_id`, `assignment_id`. |
| `MsProjectSerializer.bas` | Convert ActiveProject ke payload project/tasks/project_resources/assignments/dependencies. |
| `MsProjectImporter.bas` | Import project package ke MS Project. |
| `MsProjectSync.bas` | Publish new project dan sync existing project. |
| `MsProjectResources.bas` | Search resource pool, load project team, update Resource Sheet. |
| `MsProjectConflicts.bas` | Request conflict warnings dan tampilkan log. |
| `MsProjectAudit.bas` | Scan custom field usage. |

## 14. Conflict Checking Design

Conflict bukan sekadar ada overlap, dan juga bukan menjumlahkan seluruh assignment yang intersect terhadap satu rentang filter. Conflict harus melihat peak concurrent units pada waktu yang benar-benar bersamaan.

Normalisasi units:

| Value | Makna |
| --- | --- |
| `1.0` | 100% capacity |
| `0.5` | 50% capacity |
| `2.0` | 200% capacity |

Aturan units:

1. `assignment_units` dan `max_units` disimpan sebagai decimal.
2. Nilai harus lebih besar dari nol.
3. VBA wajib menormalisasi value Microsoft Project sebelum mengirim payload.
4. API wajib validasi ulang karena payload bisa datang dari client lain.

Aturan MVP:

1. `PERSON` individual umumnya `max_units = 1.0`.
2. `MACHINE` individual umumnya `max_units = 1.0`.
3. `WORKCENTER` generic dapat memiliki `max_units > 1.0`.
4. `TEAM` generic dapat memiliki `max_units > 1.0`.
5. Hasil conflict check berupa warning, belum blocking sync.
6. Warning harus menyertakan `resource_category`.

### Pairwise overlap untuk `PERSON` dan `MACHINE`

Untuk MVP pertama, implement pairwise overlap sederhana untuk resource individual (`PERSON` dan `MACHINE`) dengan `max_units = 1.0`.

Conflict jika:

1. Resource sama.
2. Keduanya aktif.
3. Rentang assignment benar-benar overlap.
4. Assignment berbeda.
5. `assignment_units_a + assignment_units_b > resource.max_units`.

Konsep query pairwise:

```sql
with assignment_windows as (
  select
    a.assignment_id,
    a.project_id,
    a.resource_id,
    coalesce(a.assignment_start, t.plan_start) as start_at,
    coalesce(a.assignment_finish, t.plan_finish) as finish_at,
    coalesce(a.assignment_units, 1.0) as assignment_units
  from ms_project_assignment a
  join ms_project_task t
    on t.project_id = a.project_id
   and t.task_id = a.task_id
  where a.is_active = true
    and t.is_active = true
)
select
  r.resource_id,
  r.resource_code,
  r.resource_name,
  r.resource_category,
  r.max_units,
  a.assignment_id as assignment_a,
  b.assignment_id as assignment_b,
  a.assignment_units + b.assignment_units as peak_units,
  greatest(a.start_at, b.start_at) as overlap_start,
  least(a.finish_at, b.finish_at) as overlap_finish
from assignment_windows a
join assignment_windows b
  on b.resource_id = a.resource_id
 and b.assignment_id > a.assignment_id
 and tstzrange(a.start_at, a.finish_at, '[)')
     && tstzrange(b.start_at, b.finish_at, '[)')
join ms_resource r on r.resource_id = a.resource_id
where r.resource_category in ('PERSON', 'MACHINE')
  and a.assignment_units + b.assignment_units > r.max_units;
```

Catatan: pairwise cukup aman untuk individual resource `max_units = 1.0`. Jika ada person/machine dengan `max_units > 1.0`, pairwise masih bisa mendeteksi banyak kasus, tetapi peak calculation penuh lebih akurat.

### Generic capacity untuk `WORKCENTER` dan `TEAM`

Untuk generic resource, jangan memakai total semua assignment dalam filter date range. Gunakan peak concurrent units.

Algorithm yang direkomendasikan:

1. Ambil semua assignment window untuk satu resource.
2. Buat event `start = +assignment_units` dan `finish = -assignment_units`.
3. Urutkan event berdasarkan timestamp. Untuk timestamp sama, proses finish sebelum start jika memakai range `[)`.
4. Sweep event dan hitung running units.
5. Conflict jika running peak > `max_units`.
6. Return interval dan assignment contributors yang menyebabkan peak.

Alternatif jika lebih mudah di SQL tahap awal:

1. Time-slicing berdasarkan boundary start/finish assignment.
2. Untuk setiap slice, jumlahkan assignment yang aktif.
3. Conflict jika total slice > `max_units`.

Jika generic conflict check belum diimplementasikan penuh pada MVP pertama, endpoint harus menandai hasil `WORKCENTER`/`TEAM` sebagai warning terbatas dan tidak mengklaim validasi final.

## 15. Actual Data Ownership

Aturan ownership:

| Data | Owner |
| --- | --- |
| Planned start/finish | Microsoft Project |
| Planned duration | Microsoft Project |
| Planned work | Microsoft Project |
| Planned assignment units | Microsoft Project |
| Planned dependency | Microsoft Project |
| Actual progress | PostgreSQL/timesheet/transaksi lapangan |
| Actual work | PostgreSQL/timesheet/transaksi lapangan |
| Actual start/finish | PostgreSQL/timesheet/transaksi lapangan |

Aturan API:

1. Tombol `Publish New Project` dan `Sync Existing Project` hanya menulis planned fields.
2. Planning sync tidak boleh overwrite `actual_progress`, `actual_work_minutes`, `actual_start`, dan `actual_finish`.
3. Existing actual sync dipertahankan sebagai read-from-API flow yang memperbarui Microsoft Project dari data lapangan.
4. Jika Microsoft Project menampilkan actual fields, nilainya dianggap display/imported actual, bukan source of truth.
5. Endpoint package boleh mengirim planned dan actual data secara eksplisit dalam property terpisah agar UI/VBA tidak salah tulis.

## 16. Soft Delete dan Reactivation

Jangan hard delete otomatis untuk:

1. `ms_project_resource`.
2. `ms_project_task`.
3. `ms_project_assignment`.
4. `ms_project_dependency`.

Aturan:

1. Remove menggunakan `is_active = false`.
2. Add ulang resource ke project team melakukan upsert dan mengaktifkan kembali record existing.
3. Sync tidak boleh menonaktifkan task/assignment/dependency hanya karena record tidak ditemukan pada payload.
4. Deactivation hanya terjadi jika request eksplisit mengirim mode snapshot atau daftar deactivate.
5. Hard delete hanya untuk maintenance/admin manual setelah audit, bukan flow normal VBA.

Contoh payload eksplisit untuk deactivate:

```json
{
  "deactivate": {
    "task_ids": [],
    "assignment_ids": [],
    "dependency_ids": [],
    "resource_ids": []
  }
}
```

Jika MVP belum menyediakan deactivate eksplisit, maka sync bersifat additive/update-only.

## 17. Concurrency dan Revision

Risiko: project yang sama dibuka dua user, lalu sync saling menimpa.

MVP handling:

1. `revision_no` disimpan di `ms_project` dan menjadi optimistic concurrency token utama.
2. VBA menyimpan `revision_no` di `ProjectSummaryTask.Text29`.
3. `updated_at` tetap dikembalikan sebagai metadata display, tetapi tidak boleh menjadi satu-satunya token concurrency.
4. Project existing harus di-checkout sebelum sync/publish.
5. `checkout` mengembalikan `lock_token`.
6. Saat sync/publish, VBA mengirim `last_known_revision_no` dan `lock_token`.
7. API menolak dengan `409 Conflict` jika `last_known_revision_no` tidak sama dengan `ms_project.revision_no`.
8. API menolak dengan `423 Locked` atau `409 Conflict` jika lock tidak valid, expired, atau dimiliki user lain.
9. Setiap sync/publish yang sukses increment `revision_no` dalam transaksi yang sama.
10. User diminta reload/import ulang jika revision conflict.

Contoh payload minimal sync existing:

```json
{
  "project": {
    "project_id": "uuid",
    "last_known_revision_no": 3,
    "lock_token": "uuid"
  },
  "project_resources": [],
  "tasks": [],
  "assignments": [],
  "dependencies": []
}
```

Contoh response conflict:

```json
{
  "success": false,
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Project revision has changed. Reload the project before syncing.",
    "current_revision_no": 4,
    "client_revision_no": 3
  }
}
```

## 18. Implementation Stages

### Stage 0 - Audit data dan field

Deliverable:

1. Audit live PostgreSQL untuk `usernfc`, `workcenter`, `timesheet_transaction`.
2. Validasi stable key: `usernfc.snssb`, `workcenter.machineid`, `workcenter.workcenternew`.
3. Audit cardinality `workcenternew -> machineid`.
4. Audit custom fields MS Project.
5. Finalisasi mapping source resource.

Acceptance:

1. Jelas sumber employee/person.
2. Jelas mesin individual mana yang tersedia di DB.
3. Jelas apakah workcenter dipakai sebagai generic assignable resource.
4. Jelas apakah `WORKCENTER` dan `MACHINE` sama-sama assignable secara default.
5. Jelas field MS Project yang aman dipakai.

### Stage 1 - Database migration

Deliverable:

1. Migration SQL untuk `ms_project`.
2. Migration SQL untuk `ms_project_task`.
3. Migration SQL untuk `ms_resource`.
4. Migration SQL untuk `ms_project_resource`.
5. Migration SQL untuk `ms_project_assignment`.
6. Migration SQL untuk `ms_project_dependency`.
7. Migration SQL untuk `ms_project_lock`.
8. Migration SQL untuk `ms_project_revision`.
9. Migration SQL untuk `ms_project_publish`.
10. Migration SQL untuk `ms_project_audit_log`.
11. Trigger `updated_at`.
12. Index dan constraint dasar.

Acceptance:

1. Migration idempotent.
2. `ms_project_resource` tersedia sejak MVP.
3. Check constraint resource type/category tersedia.
4. Unique anti-duplikasi resource tersedia.
5. Composite FK same-project tersedia untuk parent task, assignment, dan dependency.
6. Constraint units `> 0` tersedia untuk `max_units` dan `assignment_units`.
7. Unique index `local_dependency_key` tersedia untuk dependency baru.
8. Lock, revision, publish, dan audit table tersedia sejak MVP.

### Stage 2 - Resource refresh API

Deliverable:

1. `POST /ms-project/resources/refresh`.
2. Upsert `PERSON` dari `usernfc`.
3. Upsert `MACHINE` dari `workcenter.machineid`.
4. Upsert `WORKCENTER` dari `workcenter.workcenternew`.
5. `GET /ms-project/resources` dengan filter `active`, `category`, `q`, `workcenter_code`.

Acceptance:

1. Refresh berulang tidak membuat duplikasi.
2. Employee/person muncul sebagai resource.
3. Machine dan workcenter tidak tercampur.
4. Search resource pool bisa dipakai VBA.

### Stage 3 - Project resource team API

Deliverable:

1. `GET /ms-project/projects/:project_id/resources`.
2. `POST /ms-project/projects/:project_id/resources`.
3. `DELETE /ms-project/projects/:project_id/resources/:resource_id`.

Acceptance:

1. Resource dapat dipilih masuk project.
2. Resource dapat dihapus/deactivate dari project.
3. `unique(project_id, resource_id)` mencegah duplikasi team.
4. Assignment ke resource di luar project team ditolak atau diberi warning terstruktur.
5. Add ulang resource yang inactive melakukan reactivation, bukan insert baru.
6. Endpoint ini hanya untuk project existing yang sudah punya `project_id`.

### Stage 4 - Project package dan sync API

Deliverable:

1. `GET /ms-project/projects`.
2. `GET /ms-project/projects/:project_id/package`.
3. `POST /ms-project/projects`.
4. `POST /ms-project/projects/:project_id/checkout`.
5. `POST /ms-project/projects/:project_id/heartbeat`.
6. `PUT /ms-project/projects/:project_id/sync`.
7. `POST /ms-project/projects/:project_id/publish`.
8. `POST /ms-project/projects/:project_id/checkin`.
9. `POST /ms-project/projects/:project_id/force-checkin`.
10. `POST /ms-project/projects/bulk-load`.

Acceptance:

1. Publish/sync memakai transaksi.
2. Repeated sync tidak duplikat task/resource/assignment.
3. API mengembalikan mapping ID untuk task, assignment, dan dependency.
4. Payload memakai `project_resources`, bukan `resources`.
5. Publish project baru menerima temporary project team dalam bulk payload.
6. Local UID mapping resolve parent task, assignment, dan dependency.
7. Sync planning tidak overwrite kolom `actual_*`.
8. Project existing wajib lock valid sebelum sync/publish.
9. `revision_no` naik setelah sync/publish sukses.
10. Publish membuat snapshot dan audit log.

### Stage 5 - VBA resource flow

Deliverable:

1. Search Resource Pool.
2. Filter category.
3. Filter workcenter.
4. Add Selected Resource ke temporary team jika project belum publish.
5. Add Selected Resource ke `ms_project_resource` jika project sudah publish.
6. Load Project Team.
7. Isi Resource Sheet dari project team.
8. Simpan `resource_id` ke `Resource.Text9`.

Acceptance:

1. User tidak perlu load semua resource perusahaan.
2. Unknown local resource tidak otomatis dibuat di DB.
3. Assignment hanya memakai resource valid dari project team.
4. Project baru dapat publish dengan temporary resource team.

### Stage 6 - VBA publish/sync/import

Deliverable:

1. Publish new project.
2. Check Out project existing.
3. Heartbeat lock saat sesi edit berjalan.
4. Sync current project.
5. Publish current revision.
6. Check In project.
7. Clone as New Project.
8. Import selected projects sebagai Master Portfolio View read-only.
9. Serialize project, project resources, tasks, assignments, dependencies.
10. Simpan `project_id`, `revision_no`, `task_id`, `resource_id`, dan `assignment_id` ke field MS Project.
11. Kirim `lock_token`, `last_known_revision_no`, `local_task_uid`, `local_assignment_uid`, `parent_local_task_uid`, `predecessor_local_task_uid`, dan `successor_local_task_uid`.
12. Serialize dependency type `FS/SS/FF/SF` dan lag aktual dari Object Model, bukan hardcode `FS|0`.

Acceptance:

1. Klik sync berkali-kali tidak membuat duplikasi.
2. Task baru mendapat `task_id`.
3. Assignment baru mendapat `assignment_id`.
4. Person dan machine assignment terkirim ke PostgreSQL dengan `resource_id` yang valid.
5. `Sync Current Project` ditolak pada Master Portfolio View.
6. `Clone as New Project` menghapus UUID lama sebelum publish.
7. Sync/publish ditolak jika belum checkout.
8. Sync/publish ditolak jika `revision_no` stale.
9. Checkin melepas lock dan tidak menghapus revision history.
10. Dependency hasil roundtrip mempertahankan type dan lag.

Status implementasi 2026-06-11:

1. `ms_serializer.bas` sudah memakai `Task.TaskDependencies` dan `TaskDependency.Type/Lag` untuk export dependency `FS/SS/FF/SF` plus lag minutes.
2. `ms_import.bas` sudah memakai `TaskDependencies.Add` saat import dependency agar type dan lag dari server dipertahankan.
3. Fallback full parse string `Predecessors` tidak dipakai sebagai jalur utama karena Object Model resmi menyediakan `TaskDependency` untuk type dan lag.

### Stage 7 - Conflict check

Deliverable:

1. `GET /ms-project/resources/conflicts`.
2. Button `Check Resource Conflicts` di VBA.
3. Pairwise conflict untuk `PERSON` dan `MACHINE`.
4. Generic conflict untuk `WORKCENTER`/`TEAM` memakai event-sweep/time-slicing atau diberi label warning terbatas.
5. Warning menampilkan resource code, name, category, time window, peak units, max units, dan project/task terkait.

Acceptance:

1. Overlap tidak otomatis conflict jika peak concurrent units masih <= `max_units`.
2. Conflict person/machine/workcenter/team mudah dibedakan.
3. MVP hanya warning, belum blocking sync.

### Stage 8 - Calendar settings and scheduling metadata

Deliverable:

1. Migration `ms_project_calendar`.
2. Migration `ms_project_calendar_weekday`.
3. Migration `ms_project_calendar_working_time`.
4. Migration `ms_project_calendar_exception`.
5. Migration `ms_project_calendar_exception_time`.
6. Tambah `calendar_id` di `ms_project`, `ms_resource`, dan `ms_project_task`.
7. Tambah `ignore_resource_calendar` di `ms_project_task`.
8. Tambah `calendar_guid`/`source_ref_id` untuk roundtrip yang tidak bergantung pada nama calendar.
9. Tambah `ms_project_resource_availability` untuk date-ranged `MaxUnits`.
10. Seed default calendars: `STANDARD`, `24H`, dan `NIGHT_SHIFT`.
11. Endpoint CRUD calendar dan endpoint `refresh-from-shifts`.
12. VBA export/import project calendar, resource calendar, task calendar, working time, exception, dan `IgnoreResourceCalendar`.
13. Warning recalculation jika calendar berubah setelah file `.mpp` diimport.

Acceptance:

1. Project dapat memilih enterprise calendar sebelum publish.
2. Resource dapat memakai base/resource calendar dari API.
3. Task dapat memakai task calendar optional.
4. Working time mendukung multi-segment dalam satu hari dengan batas kompatibel `Shift1..Shift5`.
5. Night shift/cross-midnight didukung eksplisit.
6. Holiday dan recurring exception tersimpan di DB.
7. Calendar dari `shift_definition` dapat direfresh berulang tanpa duplikasi.
8. Sync calendar tidak mengganti hasil schedule tanpa recalculation di MS Project.
9. Conflict/capacity fase lanjut dapat memakai calendar working window.
10. Resource availability date range dapat menurunkan/menaikkan capacity tanpa membuat resource baru.

#### Stage 8.1 - Implementasi fondasi calendar scheduling (2026-06-10)

Status: diimplementasikan sebagai fondasi compatible untuk stack PostgreSQL, NodeJS, dan VBA. Tahap ini sengaja belum membuat scheduling engine server-side baru; Microsoft Project Desktop tetap menjadi kalkulator utama untuk start/finish/duration/work pada MVP.

File implementasi:

1. Migration: `API/migrations/20260610_ms_project_calendar_scheduling.sql`.
2. Backend NodeJS: `API/services/msProjectService.js`, `API/controllers/msProjectController.js`, `API/routes/msProject.js`.
3. VBA: `Additional/ms project/ms_config.bas`, `ms_fields.bas`, `ms_serializer.bas`, `ms_import.bas`, `ms_resources.bas`, `ms_calendars.bas`.

Yang sudah ada pada tahap ini:

1. Tabel enterprise/base calendar: `ms_project_calendar`.
2. Tabel weekday pattern: `ms_project_calendar_weekday`.
3. Tabel working time segment dengan batas `segment_no 1..5`: `ms_project_calendar_working_time`.
4. Tabel exception dan exception working time: `ms_project_calendar_exception`, `ms_project_calendar_exception_time`.
5. Relasi calendar ke `ms_project`, `ms_resource`, dan `ms_project_task`.
6. `ms_project_task.ignore_resource_calendar`.
7. `ms_project_resource_availability` untuk date-ranged resource capacity.
8. Seed default calendar `STANDARD`, `24H`, dan `NIGHT_SHIFT`.
9. Endpoint `GET /ms-project/calendars`, `GET /ms-project/calendars/:calendar_id`, dan `POST /ms-project/calendars/refresh-from-shifts`.
10. Payload publish/sync menyimpan `project.calendar_id`, `project.calendar_name`, `task.calendar_id`, `task.calendar_name`, dan `task.ignore_resource_calendar`.
11. VBA menyimpan UUID calendar di custom fields dan membaca nama calendar dari Microsoft Project Object Model jika tersedia.
12. VBA menyediakan macro `Ms_ListCalendars`, `Ms_RefreshCalendarsFromShifts`, dan `Ms_SetProjectCalendarFromServer`.
13. VBA dapat membuat/memakai base calendar lokal dari detail API dan mengisi weekday working time non-cross-midnight ke `WeekDays/Shift1..Shift5` secara best-effort.

Alasan teknis perubahan:

1. PostgreSQL dipakai sebagai canonical metadata store karena calendar perlu FK, constraint, seed idempotent, dan future capacity query.
2. NodeJS Express tetap menjadi write path tunggal agar VBA tidak pernah menulis langsung ke database.
3. VBA mengirim hasil schedule dari Microsoft Project dan metadata calendar; backend tidak menghitung ulang full scheduling agar tidak menyimpang dari engine Microsoft Project.
4. `calendar_name` disimpan sebagai fallback round-trip karena Object Model mudah membaca nama calendar, sedangkan stable enterprise calendar ID tidak selalu tersedia dari file lokal.
5. `segment_no` dibatasi 1 sampai 5 agar kompatibel dengan model `Shift1..Shift5` pada WeekDay/Exception Microsoft Project.

Belum termasuk pada tahap ini:

1. Full CRUD UI/admin untuk calendar weekday dan exception.
2. Full mapping recurring exception ke semua property Exception Object Model.
3. Apply otomatis cross-midnight working time ke MS Project masih diberi warning karena Project Desktop perlu pemodelan split-shift yang lebih hati-hati.
4. Warning otomatis jika calendar server berubah setelah file `.mpp` diimport.
5. Calendar-aware conflict/capacity engine.
6. Queue job untuk refresh calendar dan rebuild reporting snapshot.

### Stage 9 - Queue, published read model, and project documents

Deliverable:

1. `ms_project_queue_job` untuk operasi berat/asynchronous.
2. Worker atau job runner untuk publish snapshot/reporting snapshot.
3. Status job: `QUEUED`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
4. Endpoint queue status per project.
5. Published read model/view untuk dashboard agar tidak membaca draft.
6. `ms_project_document` untuk metadata dokumen project.
7. `ms_project_object_link` untuk link task/resource/project ke dokumen atau artefak pendukung.

Acceptance:

1. Publish besar tidak timeout di request utama.
2. User dapat melihat status job publish/sync/reporting.
3. Dashboard/portfolio membaca published read model.
4. Dokumen pendukung project tersimpan sebagai metadata/link, bukan blob besar wajib di DB.
5. Link dokumen ke task/resource/project dapat diaudit.

## 19. Data `.mpp` yang Perlu Disimpan

Saat import atau sync dari Microsoft Project, simpan data inti berikut agar PostgreSQL bisa menjadi canonical source dan tidak tergantung pada file `.mpp` lokal.

| Area | Data yang disimpan |
| --- | --- |
| Project | `project_id`, name/title, description, start, finish, status date, manager/owner, calendar, notes, source file metadata. |
| Tasks | `task_id`, `local_task_uid`, name, outline level, outline number/WBS, parent, summary flag, milestone flag, start, finish, duration, work, percent complete planned view, constraint type/date, deadline, priority, notes. |
| Business keys | `order_no`, `operation_no`, `ssbr_id`, `sow_id`, workcenter, operation text. |
| Resources | `resource_id`, code, name, type, category, max units, calendar, group/workcenter, source mapping. |
| Project resource team | Resource yang dipilih untuk project, meskipun belum assigned. |
| Assignments | `assignment_id`, `local_assignment_uid`, task, resource, units, planned work, start, finish. |
| Dependencies | predecessor, successor, dependency type `FS/SS/FF/SF`, lag, `local_dependency_key`. |
| Calendars | `calendar_id`, base/project/resource/task calendar, weekday working pattern, working time segments, exception days, recurring exceptions, holiday/shift rules, hours/day, hours/week, days/month, timezone. MVP runtime boleh ditunda, tetapi schema dan API roadmap sudah dikunci. |
| Baselines | Baseline start/finish/duration/work per task dan assignment. MVP boleh ditunda setelah publish/sync stabil. |
| Custom fields | Definisi field dan nilai field penting dari project/task/resource/assignment. |
| File import metadata | Original filename, file hash, parser/importer version, imported_by, imported_at. |

Ownership data:

1. Planned schedule berasal dari Microsoft Project.
2. Actual progress/work berasal dari PostgreSQL/timesheet/transaksi lapangan.
3. Resource master berasal dari PostgreSQL, bukan dari free-text Resource Sheet.
4. Setelah project punya `project_id`, `.mpp` hanya editor client; PostgreSQL adalah source of truth.

## 20. Risiko Khusus Jika `.mpp` Menjadi Sumber Data Tunggal

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Format `.mpp` proprietary | Parser server-side bisa tidak membaca semua fitur dengan sempurna | Gunakan VBA/Project Object Model untuk sync utama; server-side import dipakai sebagai fallback. |
| Scheduling engine kompleks | Hasil kalkulasi durasi/start/finish bisa beda dari Microsoft Project Desktop | Simpan hasil kalkulasi dari Desktop; jangan reimplement scheduling engine penuh pada MVP. |
| File dicopy beserta UUID | Project lama bisa tertimpa | Wajib `Clone as New Project` untuk menghapus UUID lama sebelum publish baru. |
| `Task.UniqueID` hanya stabil dalam satu file | Clone/import ulang dapat menciptakan korelasi palsu | Gunakan UUID DB (`task_id`) setelah publish; `local_task_uid` hanya correlation sementara. |
| Nomor baris task berubah | Upsert salah atau duplikasi | Jangan pernah memakai row number sebagai key. |
| Resource free-text berubah nama | Assignment putus atau resource duplikat | Assignment wajib memakai `resource_id` dari `Resource.Text9`. |
| Password-protected/corrupt `.mpp` | Import gagal | Validasi file, catat import error, sediakan path export XML/VBA sync. |
| Actual diedit di `.mpp` | Data lapangan rusak | Planning sync tidak boleh overwrite `actual_*`. |

## 21. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| `usernfc` ternyata bukan master employee lengkap | Person resource kurang lengkap | Audit live DB; gunakan mapping layer `ms_resource`; jangan buat duplicate employee master sebelum jelas. |
| Workcenter disamakan dengan machine | Assignment dan conflict salah | Pisahkan `resource_category = MACHINE` dan `WORKCENTER`. |
| Machine tidak lengkap di `workcenter` | Planner tidak bisa assign mesin tertentu | Audit gap dari timesheet/SOW; unknown machine jadi warning admin. |
| Resource dibuat bebas dari MS Project | Master duplikat | Macro tidak boleh create master; wajib search/add dari API. |
| Semua resource diload ke setiap MPP | File berat dan membingungkan | Resource Sheet hanya dari `ms_project_resource`. |
| Sync berulang membuat duplikasi | Data DB kotor | Upsert by `task_id`, `assignment_id`, `resource_id`; unique source resource. |
| Assignment di luar project team | Planning tidak konsisten | API validasi resource harus masuk `ms_project_resource`. |
| Project baru belum punya `project_id` | Endpoint project resources belum bisa dipakai | Simpan temporary team di VBA/Resource Sheet dan kirim dalam bulk publish payload. |
| Task baru belum punya UUID | Parent/assignment/dependency gagal resolve | Gunakan `Task.UniqueID` sebagai `local_task_uid`, bukan nomor baris. |
| Master portfolio disync seperti single project | Salah update banyak project | Master Portfolio View read-only pada MVP. |
| Conflict generic false positive | Planner tidak percaya warning | Hitung peak concurrent units; jangan total seluruh intersect range. |
| Planning sync menimpa actual | Data lapangan rusak | Pisahkan planned dan actual fields; planning sync tidak update `actual_*`. |
| File `.mpp` dicopy dengan UUID lama | Project lama tertimpa | Sediakan `Clone as New Project` yang menghapus UUID sebelum publish. |
| Field custom MS Project bertabrakan | ID hilang/tertukar | Audit field dulu; mapping di modul konfigurasi. |
| Dua user sync project sama | Update tertimpa | Wajib checkout; validasi `lock_token`, `revision_no`, dan response `409 Conflict`. |
| Lock tidak dilepas karena MS Project crash | Project tidak bisa diedit user lain | Heartbeat, stale lock detection, dan admin force check-in dengan audit. |
| Publish gagal di tengah transaksi | Published snapshot tidak konsisten | Publish harus transactional; jangan update `published_revision_no` sebelum snapshot sukses. |
| Dashboard membaca draft | User melihat data belum dipublish | Reporting harus membaca published/read model, bukan current draft jika konteksnya portfolio. |
| Client menulis langsung ke DB | Permission, audit, dan lock bypass | Semua write wajib lewat Express API `/ms-project`. |
| API legacy masih dipakai | Regression SOW lama | Buat route `/ms-project` baru berdampingan, jangan hapus flow lama. |

## 22. Test Plan

### Scenario 1 - Resource refresh

1. Panggil `POST /ms-project/resources/refresh` dengan `["WORKCENTER", "MACHINE", "EMPLOYEE"]`.
2. Panggil ulang endpoint yang sama.
3. Pastikan tidak ada resource duplikat.
4. Pastikan `PERSON`, `MACHINE`, dan `WORKCENTER` muncul sebagai kategori berbeda.

### Scenario 2 - Search resource pool

1. Search `category=PERSON&q=nama`.
2. Search `category=MACHINE&workcenter_code=...`.
3. Search `category=WORKCENTER`.
4. Pastikan hasil sesuai source dan filter.

### Scenario 3 - Project team

1. Untuk project baru tanpa `project_id`, add person, machine, dan workcenter ke temporary team.
2. Publish project.
3. Pastikan temporary team tersimpan ke `ms_project_resource`.
4. Untuk project existing, add resource yang sama lagi.
5. Pastikan tidak duplikat karena `unique(project_id, resource_id)`.
6. Remove salah satu resource.
7. Add ulang resource yang sama.
8. Pastikan record lama reactivated, bukan insert baru.

### Scenario 4 - Publish new project

1. Buat file baru di MS Project.
2. Pilih temporary project team.
3. Buat parent-child task.
4. Assign person dan machine ke task.
5. Buat dependency antar task.
6. Publish.
7. Pastikan DB punya project, tasks, project_resources, assignments, dependencies.
8. Pastikan mapping `local_task_uid -> task_id` benar.
9. Pastikan assignment dan dependency resolve ke task baru.
10. Pastikan ID kembali ke VBA dan tersimpan di field custom.

### Scenario 5 - Sync existing project

1. Checkout project existing.
2. Pastikan API mengembalikan `lock_token` dan `revision_no`.
3. Ubah schedule task.
4. Tambah task baru.
5. Tambah child task baru.
6. Tambah assignment person atau machine.
7. Tambah dependency baru.
8. Sync dengan `lock_token` dan `last_known_revision_no`.
9. Sync ulang tanpa perubahan.
10. Pastikan tidak ada duplikasi.
11. Pastikan `actual_*` di DB tidak berubah oleh planning sync.
12. Pastikan `revision_no` naik setelah sync sukses.

### Scenario 5A - Checkout conflict

1. User A checkout project.
2. User B mencoba checkout project yang sama.
3. Pastikan API menolak dengan conflict/locked response.
4. User A checkin.
5. User B checkout ulang.
6. Pastikan checkout User B sukses setelah lock dilepas.

### Scenario 5B - Revision conflict

1. User A checkout project revision 3.
2. Admin/API test menaikkan project ke revision 4 melalui sync/publish valid.
3. User A mencoba sync dengan `last_known_revision_no = 3`.
4. Pastikan API menolak dengan `REVISION_CONFLICT`.
5. Pastikan user diminta reload/import ulang.

### Scenario 5C - Publish and audit

1. Checkout project.
2. Sync perubahan schedule.
3. Publish project.
4. Pastikan `ms_project_publish` berisi snapshot revision terbaru.
5. Pastikan `ms_project.published_revision_no` dan `last_published_at` ter-update.
6. Pastikan `ms_project_revision` berisi revision type `PUBLISH`.
7. Pastikan `ms_project_audit_log` mencatat action publish.
8. Checkin project.

### Scenario 6 - Import project

1. Load daftar project.
2. Import satu project sebagai Single Project Editor.
3. Pastikan Resource Sheet hanya berisi project team.
4. Pastikan assignment terbuat dan `Resource.Text9` terisi.
5. Import beberapa project sebagai Master Portfolio View.
6. Pastikan `Sync Current Project` ditolak pada Master Portfolio View.

### Scenario 7 - Conflict warning

1. Assign person atau machine yang sama pada overlapping date.
2. Pastikan conflict pairwise muncul jika peak units > `max_units`.
3. Assign workcenter/team generic dengan beberapa assignment.
4. Pastikan generic conflict memakai peak concurrent units atau diberi label warning terbatas jika belum full.
5. Pastikan warning menyertakan `resource_category`.

### Scenario 8 - Clone as new project

1. Buka file `.mpp` yang sudah punya `project_id`, `task_id`, dan `assignment_id`.
2. Klik `Clone as New Project`.
3. Pastikan UUID project/task/assignment dihapus.
4. Publish.
5. Pastikan DB membuat project baru dan project lama tidak berubah.

## 23. Keputusan MVP yang Dikunci

1. Resource bukan hanya mesin. MVP wajib support person, machine, workcenter, dan team.
2. `resource_type` adalah klasifikasi teknis Microsoft Project: `WORK`, `MATERIAL`, `COST`.
3. `resource_category` adalah klasifikasi bisnis: `PERSON`, `MACHINE`, `WORKCENTER`, `TEAM`, `MATERIAL`.
4. Sumber master employee existing adalah `usernfc`, dengan stable key utama `snssb`.
5. Workcenter dipakai sebagai grouping/generic resource dan dapat assignable jika planner memilih kapasitas umum.
6. Machine individual berasal dari `workcenter.machineid`; availability final harus diaudit dari DB live.
7. Project team dipilih melalui Search Resource Pool; untuk project baru disimpan sementara dulu, lalu masuk `ms_project_resource` saat publish.
8. Person dan machine assignment dikirim ke PostgreSQL lewat `assignments[].resource_id`.
9. Conflict check menghitung peak concurrent `assignment_units` dibanding `resource.max_units`.
10. Sistem mencegah duplikasi resource dengan unique `resource_code`, unique `(source_type, source_ref_id)`, upsert refresh, `Resource.Text9`, dan unique `ms_project_resource(project_id, resource_id)`.
11. Macro Microsoft Project tidak boleh membuat master resource baru secara bebas.
12. Express route baru adalah `/ms-project`.
13. Payload sync memakai `project_resources`.
14. MVP menggunakan warning untuk conflict, bukan blocking sync.
15. Project baru mengirim temporary project team dalam bulk publish payload.
16. Endpoint add/remove project team hanya untuk project existing.
17. Task, assignment, hierarchy, dan dependency baru di-resolve memakai local UID dari Microsoft Project.
18. Single Project Editor adalah mode edit/sync MVP.
19. Master Portfolio View adalah read-only pada MVP.
20. Units dinormalisasi decimal: `1.0 = 100%`, `0.5 = 50%`, `2.0 = 200%`.
21. Planned data berasal dari Microsoft Project; actual data berasal dari PostgreSQL/timesheet/transaksi lapangan.
22. Planning sync tidak boleh overwrite actual data.
23. Soft delete/reactivation dipakai untuk resource team, task, assignment, dan dependency.
24. `Clone as New Project` wajib menghapus UUID lama sebelum publish baru.
25. Project existing wajib checkout sebelum sync atau publish.
26. `lock_token` wajib divalidasi untuk sync, publish, heartbeat, dan checkin.
27. `revision_no` adalah optimistic concurrency token utama; `updated_at` hanya metadata.
28. Publish wajib membuat snapshot di `ms_project_publish`.
29. Sync/publish/force-checkin wajib menulis `ms_project_audit_log`.
30. Project Center harus menampilkan lock metadata dan published revision metadata.
31. `.mpp` bukan canonical source setelah project dipublish; PostgreSQL adalah source of truth.
32. Dashboard/portfolio membaca published/read model, bukan draft/current yang sedang diedit.
33. Calendar runtime full scheduling belum termasuk MVP checkout/sync/publish, tetapi fondasi schema, API list/detail/refresh, dan payload VBA calendar sudah dimulai pada Stage 8.1.
34. Baseline dan custom field detail masuk roadmap setelah checkout/sync/publish stabil.
