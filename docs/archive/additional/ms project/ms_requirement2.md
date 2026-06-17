Implementasikan backend API baru untuk integrasi Microsoft Project berdasarkan dokumen:

`D:\website\MPS2\Additional\ms project\ms_planning.md`
m
## Scope pekerjaan

Fokus hanya pada backend Node.js Express dan PostgreSQL.

Jangan mengerjakan VBA, UserForm, file `.bas`, frontend React, atau perubahan UI pada tahap ini.

Jangan menggunakan FastAPI untuk fitur baru.

FastAPI existing harus tetap dipertahankan karena mungkin masih digunakan macro legacy:

* Jangan hapus folder FastAPI.
* Jangan hapus endpoint FastAPI existing.
* Jangan refactor endpoint legacy.
* Jangan memindahkan route existing dari FastAPI.
* Jangan mengubah Docker Compose service FastAPI kecuali benar-benar diperlukan untuk mencegah error build existing.
* Jangan mengubah Nginx routing existing kecuali route Express baru tidak dapat diakses karena konfigurasi existing. Jika tidak perlu, jangan sentuh Nginx.

Tambahkan route baru secara berdampingan pada Node.js Express:

```js
app.use('/ms-project', require('./routes/msProject'));
```

## Langkah awal wajib

Sebelum coding:

1. Baca struktur folder:

```text
D:\website\MPS2\API
D:\website\MPS2\database
D:\website\MPS2\Additional\ms project
D:\website\MPS2\docker-compose.yml
```

2. Analisis pola existing:

* `API/server.js`
* route existing di `API/routes`
* controller existing di `API/controllers`
* pola error response
* pola penggunaan `global.pool` atau database pool existing
* migration SQL existing
* `.env` usage

1. Jangan membuat arsitektur baru yang berlebihan. Ikuti pola project existing.

Jika project existing hanya memakai route dan controller, pertahankan pola tersebut. Tambahkan service atau repository hanya jika memang membantu menjaga transaction logic tetap terbaca.

4. Audit schema PostgreSQL live jika koneksi tersedia.

Gunakan kredensial `.env`, tetapi jangan expose password pada log atau dokumentasi.

5. Jika tabel `ms_project*` belum ada, buat migration SQL baru yang idempotent. Jangan auto-run migration tanpa perintah eksplisit.

Pastikan migration menggunakan:

```sql
create extension if not exists pgcrypto;
```

karena schema memakai:

```sql
gen_random_uuid()
```

## Deliverable utama

Buat atau sesuaikan file berikut mengikuti pola existing:

```text
API/routes/msProject.js
API/controllers/msProjectController.js
API/services/msProjectService.js
API/migrations/YYYYMMDD_create_ms_project_integration.sql
```

File `services/msProjectService.js` boleh digabung ke controller jika project existing memang menggunakan controller sederhana. Namun transaction logic yang kompleks jangan ditaruh seluruhnya di file route.

Tambahkan dokumentasi pengujian:

```text
API/docs/ms-project-api-testing.md
```

Atau file `.http` jika project sudah memakai pola tersebut.

## Database migration

Gunakan desain pada `ms_planning.md` terbaru sebagai dasar.

Minimal buat:

```text
ms_project
ms_project_task
ms_resource
ms_project_resource
ms_project_assignment
ms_project_dependency
```

Tambahkan trigger `updated_at` yang konsisten untuk tabel terkait.

### Tambahan wajib untuk dependency

Tambahkan kolom:

```sql
local_dependency_key text
```

Tambahkan unique partial index:

```sql
create unique index if not exists uq_ms_project_dependency_local_key
on ms_project_dependency(project_id, local_dependency_key)
where local_dependency_key is not null;
```

Format rekomendasi:

```text
{predecessor_local_task_uid}|{successor_local_task_uid}|{dependency_type}|{lag_minutes}
```

Gunakan `dependency_id` untuk dependency existing. Gunakan `local_dependency_key` sebagai correlation key untuk dependency baru.

### Concurrency

Gunakan `revision_no` sebagai optimistic concurrency token utama.

Payload sync existing harus menerima:

```json
{
  "project": {
    "project_id": "uuid",
    "last_known_revision_no": 3
  }
}
```

Response publish dan sync harus mengembalikan:

```json
{
  "project_id": "uuid",
  "revision_no": 4,
  "updated_at": "timestamp"
}
```

`updated_at` tetap dikembalikan sebagai metadata, tetapi jangan dijadikan satu-satunya token concurrency.

## Endpoint Express yang harus dibuat

### Health

```http
GET /ms-project/health
```

Response minimal:

```json
{
  "success": true,
  "service": "ms-project",
  "database": "connected"
}
```

### Project list

```http
GET /ms-project/projects
```

Query opsional:

```text
status
q
limit
offset
```

Batasi `limit` dengan nilai aman, misalnya maksimal `100`.

### Project package

```http
GET /ms-project/projects/:project_id/package
```

Return:

```json
{
  "project": {},
  "project_resources": [],
  "tasks": [],
  "assignments": [],
  "dependencies": []
}
```

### Publish project baru

```http
POST /ms-project/projects
```

Terima satu bulk payload:

```json
{
  "project": {},
  "project_resources": [],
  "tasks": [],
  "assignments": [],
  "dependencies": []
}
```

Project baru belum mempunyai `project_id`.

API harus melakukan seluruh proses dalam satu database transaction.

Urutan wajib:

1. Validasi payload.
2. Insert `ms_project`.
3. Insert atau reactivate `ms_project_resource`.
4. Insert seluruh task baru dengan `parent_task_id = null`.
5. Buat mapping `local_task_uid -> task_id`.
6. Update parent task pada pass kedua menggunakan `parent_local_task_uid`.
7. Insert assignment menggunakan hasil mapping task.
8. Insert dependency menggunakan mapping predecessor dan successor.
9. Commit.
10. Return seluruh mapping UUID.

Jangan insert child task langsung dengan parent UUID yang belum tersedia.

### Sync project existing

```http
PUT /ms-project/projects/:project_id/sync
```

Terima bulk payload yang sama dengan publish, tetapi project wajib menyertakan:

```json
{
  "project_id": "uuid",
  "last_known_revision_no": 3
}
```

Urutan wajib:

1. Begin transaction.
2. Lock project:

```sql
select *
from ms_project
where project_id = $1
for update;
```

3. Jika project tidak ditemukan, balas `404`.
4. Jika `revision_no` berbeda, rollback dan balas:

```http
409 Conflict
```

Response:

```json
{
  "success": false,
  "code": "PROJECT_REVISION_CONFLICT",
  "message": "Project has been updated by another user.",
  "current_revision_no": 4
}
```

5. Upsert atau reactivate project resource team.
6. Upsert task existing berdasarkan `task_id`.
7. Insert task baru berdasarkan `local_task_uid`.
8. Resolve parent task pada pass kedua.
9. Upsert assignment existing berdasarkan `assignment_id`.
10. Insert assignment baru berdasarkan `local_assignment_uid`.
11. Upsert dependency existing berdasarkan `dependency_id`.
12. Insert dependency baru berdasarkan `local_dependency_key`.
13. Apply explicit deactivate list jika tersedia.
14. Increment `revision_no`.
15. Update `updated_at`.
16. Commit.
17. Return mappings dan summary.

Planning sync tidak boleh menulis atau menimpa kolom:

```text
actual_start
actual_finish
actual_work_minutes
actual_progress
actual_source
actual_updated_at
```

### Bulk load

```http
POST /ms-project/projects/bulk-load
```

Body:

```json
{
  "project_ids": ["uuid-1", "uuid-2"]
}
```

Return package untuk beberapa project. Endpoint ini dipakai untuk Master Portfolio View read-only.

### Resource search

```http
GET /ms-project/resources
```

Query opsional:

```text
active
category
q
workcenter_code
limit
offset
```

Gunakan parameterized query.

Support kategori:

```text
PERSON
MACHINE
WORKCENTER
TEAM
```

### Resource refresh

```http
POST /ms-project/resources/refresh
```

Body:

```json
{
  "sources": ["WORKCENTER", "MACHINE", "EMPLOYEE"]
}
```

Behavior:

* `EMPLOYEE`: upsert `PERSON` dari `usernfc.snssb`.
* `MACHINE`: upsert `MACHINE` dari `workcenter.machineid`.
* `WORKCENTER`: upsert `WORKCENTER` dari `workcenter.workcenternew`.

Aturan:

1. Skip null atau blank stable key.
2. Trim value.
3. Upsert berdasarkan `(source_type, source_ref_id)`.
4. Refresh berulang tidak boleh membuat duplikasi.
5. Jangan mass-deactivate resource hanya karena tidak ditemukan pada satu request refresh.
6. Jangan membuat master resource dari payload arbitrary client.
7. Return summary:

```json
{
  "created": 0,
  "updated": 0,
  "skipped": 0,
  "warnings": []
}
```

### Load project resource team

```http
GET /ms-project/projects/:project_id/resources
```

### Add atau reactivate resource ke project team

```http
POST /ms-project/projects/:project_id/resources
```

Body:

```json
{
  "resource_ids": ["uuid-1", "uuid-2"]
}
```

Gunakan upsert:

```sql
on conflict (project_id, resource_id)
do update set
  is_active = true,
  updated_at = now()
```

Validate resource:

```text
is_active = true
is_assignable = true
```

### Deactivate project resource team

```http
DELETE /ms-project/projects/:project_id/resources/:resource_id
```

Ini soft delete, bukan hard delete:

```sql
update ms_project_resource
set is_active = false,
    updated_at = now()
where project_id = $1
  and resource_id = $2;
```

Jika resource masih dipakai assignment aktif, jangan silently deactivate. Balas `409 Conflict` atau warning terstruktur.

### Explicit deactivate pada sync

Payload sync boleh memiliki:

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

Aturan:

1. Tidak ada auto-delete.
2. Tidak ada auto-deactivate hanya karena data tidak dikirim.
3. Semua deactivate harus eksplisit.
4. Gunakan soft delete.
5. Validasi relasi dependency dan assignment sebelum menonaktifkan task atau resource.

### Conflict check

```http
GET /ms-project/resources/conflicts
```

Query opsional:

```text
project_id
resource_id
start
finish
category
```

Implementasikan:

1. Pairwise overlap untuk `PERSON` dan `MACHINE`.
2. Peak concurrent capacity untuk `WORKCENTER` dan `TEAM`.

Untuk generic capacity gunakan event sweep pada service layer:

1. Query assignment window aktif.
2. Gunakan fallback task window jika assignment window kosong.
3. Buat event start `+assignment_units`.
4. Buat event finish `-assignment_units`.
5. Sort timestamp ascending.
6. Untuk timestamp sama, proses finish sebelum start karena memakai interval `[start, finish)`.
7. Hitung running units dan peak.
8. Return warning hanya jika peak lebih besar dari `max_units`.

Response warning minimal:

```json
{
  "resource_id": "uuid",
  "resource_code": "WC-LATHE",
  "resource_name": "Lathe",
  "resource_category": "WORKCENTER",
  "max_units": 3.0,
  "peak_units": 4.0,
  "overlap_start": "timestamp",
  "overlap_finish": "timestamp",
  "assignments": []
}
```

Jangan menjumlahkan semua assignment yang hanya kebetulan masuk pada date filter tetapi tidak overlap secara bersamaan.

## Validation rules

Gunakan helper validation sederhana. Jangan menambah library besar jika tidak diperlukan.

Validate:

1. UUID format.
2. `resource_category`.
3. `assignment_units > 0`.
4. `max_units > 0`.
5. Task baru wajib memiliki `local_task_uid`.
6. Assignment baru wajib memiliki `local_assignment_uid`.
7. Dependency baru wajib memiliki `local_dependency_key`.
8. Resource assignment harus:

   * aktif;
   * assignable;
   * berada dalam project resource team aktif.
9. Task assignment harus berada dalam project yang sama.
10. Parent task harus berada dalam project yang sama.
11. Predecessor dan successor dependency harus berada dalam project yang sama.
12. Query `limit` memiliki batas maksimum.
13. Semua SQL memakai parameterized query.
14. Error tidak boleh membocorkan password, connection string, stack trace internal, atau isi `.env`.

## Response format

Gunakan format konsisten:

### Success

```json
{
  "success": true,
  "data": {},
  "summary": {},
  "warnings": []
}
```

### Error

```json
{
  "success": false,
  "code": "ERROR_CODE",
  "message": "Readable error message",
  "details": []
}
```

Gunakan HTTP status yang sesuai:

```text
200 OK
201 Created
400 Bad Request
404 Not Found
409 Conflict
500 Internal Server Error
```

## Logging

Tambahkan logging secukupnya:

* method
* endpoint
* status code
* project_id jika tersedia
* jumlah tasks
* jumlah assignments
* jumlah dependencies
* jumlah resource team
* duration request
* error code

Jangan log payload penuh jika berpotensi besar atau mengandung informasi sensitif.

Jangan log password, `.env`, connection string, atau token.

## Testing wajib

Buat dokumentasi pengujian menggunakan curl atau file `.http`.

Minimal test:

1. `GET /ms-project/health`.
2. Refresh resource pertama.
3. Refresh resource kedua dan pastikan tidak duplikat.
4. Search `PERSON`.
5. Search `MACHINE`.
6. Publish project baru dengan:

   * temporary resource team;
   * parent-child task;
   * assignment person;
   * assignment machine;
   * dependency.
7. Sync project tanpa perubahan dan pastikan tidak duplikat.
8. Tambah task baru saat sync.
9. Tambah child task baru saat sync.
10. Tambah assignment baru saat sync.
11. Test `409 PROJECT_REVISION_CONFLICT`.
12. Test planning sync tidak overwrite `actual_*`.
13. Deactivate project resource yang masih dipakai dan pastikan ditolak.
14. Reactivate project resource.
15. Bulk load dua project.
16. Conflict individual `PERSON`.
17. Conflict individual `MACHINE`.
18. Conflict generic `WORKCENTER` dengan peak concurrent units.
19. Invalid UUID.
20. Invalid assignment units.

Jika database live tidak aman untuk test write, buat SQL fixture atau dokumentasi curl tanpa menjalankan write test ke production.

## Output akhir yang saya harapkan

Setelah implementasi:

1. Tampilkan ringkasan analisis existing architecture.
2. Sebutkan file yang dibuat atau diubah.
3. Jelaskan migration SQL yang dibuat.
4. Sebutkan endpoint yang selesai.
5. Jelaskan keputusan teknis penting.
6. Laporkan test yang berhasil dijalankan.
7. Laporkan test yang belum dapat dijalankan beserta alasannya.
8. Sebutkan risiko atau TODO tersisa.
9. Pastikan FastAPI existing masih tetap ada dan tidak dihapus.
10. Jangan lanjut membuat VBA sebelum diminta.
