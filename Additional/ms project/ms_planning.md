# MS Project Integration Planning

Dokumen ini adalah planning implementasi integrasi Microsoft Project dengan PostgreSQL untuk project MPS2. Revisi ini menggabungkan requirement awal dari `ms_requirement.md` dan koreksi desain resource dari `ms_requirement2.md`.

Tujuan utama: Microsoft Project dipakai sebagai planning editor, sedangkan PostgreSQL menjadi pusat data project, task, resource, assignment, dependency, dan validasi lintas project.

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

Untuk MVP, predecessor dan successor harus berada dalam project yang sama. Cross-project dependency baru boleh masuk fase lanjutan setelah Single Project Editor stabil.

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
| `PUT` | `/ms-project/projects/:project_id/sync` | Sync existing project dalam transaksi. |
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
    "last_known_updated_at": "2026-06-03T00:00:00Z"
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
| Project | `project_updated_at` | `ProjectSummaryTask.Text29` | Untuk optimistic concurrency. |
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
3. `ProjectSummaryTask.Text29` menyimpan `project_updated_at`.
4. User boleh `Publish New Project`.
5. User boleh `Sync Existing Project`.
6. User boleh mengelola project resource team.
7. API sync hanya menerima task/assignment/dependency untuk satu `project_id`.

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
2. Hapus `project_updated_at` dari `ProjectSummaryTask.Text29`.
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

1. `ms_project.updated_at` dan `revision_no` disimpan di DB.
2. VBA menyimpan `project_updated_at` di `ProjectSummaryTask.Text29`.
3. Saat sync, VBA mengirim `last_known_updated_at`.
4. API menolak dengan `409 Conflict` jika DB lebih baru dari nilai yang dikirim.
5. User diminta reload/import ulang atau melakukan force sync pada fase berikutnya.

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
6. Optional migration SQL untuk `ms_project_dependency`.
7. Trigger `updated_at`.
8. Index dan constraint dasar.

Acceptance:

1. Migration idempotent.
2. `ms_project_resource` tersedia sejak MVP.
3. Check constraint resource type/category tersedia.
4. Unique anti-duplikasi resource tersedia.
5. Composite FK same-project tersedia untuk parent task, assignment, dan dependency.
6. Constraint units `> 0` tersedia untuk `max_units` dan `assignment_units`.

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
4. `PUT /ms-project/projects/:project_id/sync`.
5. `POST /ms-project/projects/bulk-load`.

Acceptance:

1. Publish/sync memakai transaksi.
2. Repeated sync tidak duplikat task/resource/assignment.
3. API mengembalikan mapping ID untuk task, assignment, dan dependency.
4. Payload memakai `project_resources`, bukan `resources`.
5. Publish project baru menerima temporary project team dalam bulk payload.
6. Local UID mapping resolve parent task, assignment, dan dependency.
7. Sync planning tidak overwrite kolom `actual_*`.

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
2. Sync current project.
3. Clone as New Project.
4. Import selected projects sebagai Master Portfolio View read-only.
5. Serialize project, project resources, tasks, assignments, dependencies.
6. Simpan `project_id`, `task_id`, `resource_id`, dan `assignment_id` ke field MS Project.
7. Kirim `local_task_uid`, `local_assignment_uid`, `parent_local_task_uid`, `predecessor_local_task_uid`, dan `successor_local_task_uid`.

Acceptance:

1. Klik sync berkali-kali tidak membuat duplikasi.
2. Task baru mendapat `task_id`.
3. Assignment baru mendapat `assignment_id`.
4. Person dan machine assignment terkirim ke PostgreSQL dengan `resource_id` yang valid.
5. `Sync Current Project` ditolak pada Master Portfolio View.
6. `Clone as New Project` menghapus UUID lama sebelum publish.

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

## 19. Risiko dan Mitigasi

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
| Dua user sync project sama | Update tertimpa | `updated_at`, `revision_no`, dan response `409 Conflict`. |
| API legacy masih dipakai | Regression SOW lama | Buat route `/ms-project` baru berdampingan, jangan hapus flow lama. |

## 20. Test Plan

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

1. Ubah schedule task.
2. Tambah task baru.
3. Tambah child task baru.
4. Tambah assignment person atau machine.
5. Tambah dependency baru.
6. Sync.
7. Sync ulang tanpa perubahan.
8. Pastikan tidak ada duplikasi.
9. Pastikan `actual_*` di DB tidak berubah oleh planning sync.

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

## 21. Keputusan MVP yang Dikunci

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
