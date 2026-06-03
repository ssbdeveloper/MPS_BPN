Tolong analisis folder berikut terlebih dahulu:

`D:\website\MPS2\Additional\ms project`

Di dalam folder tersebut sudah ada VBA untuk Microsoft Project yang berfungsi mengirim data ke API/PostgreSQL dan mengambil data aktual dari PostgreSQL. Jangan langsung mengganti seluruh kode. Pelajari struktur yang sudah ada, identifikasi bagian yang masih dapat dipakai, lalu lakukan refactor secara bertahap.

## Tujuan utama

Saya ingin membuat integrasi Microsoft Project dengan PostgreSQL yang konsepnya mirip **Project Web App (PWA) di SharePoint**.

PostgreSQL menjadi sumber data terpusat untuk menyimpan daftar project dan detail task atau operation. Microsoft Project digunakan oleh user untuk mengambil project, melakukan editing schedule, lalu mengirimkan perubahan kembali ke PostgreSQL.

## Alur bisnis yang diinginkan

### 1. Melihat daftar project dari PostgreSQL

Saat user membuka Microsoft Project, sediakan menu atau VBA UserForm untuk:

* Mengambil daftar project yang tersedia dari PostgreSQL melalui API.
* Menampilkan informasi ringkas seperti:

  * Project ID
  * Project Name
  * Customer atau Project Description
  * Status
  * Last Updated
* Memungkinkan user memilih satu atau beberapa project yang ingin ditampilkan di Microsoft Project.
* Mengambil detail task atau operation dari project yang dipilih, kemudian memasukkannya ke file Microsoft Project aktif.

### 2. Membuat project baru dari Microsoft Project

Saat file Microsoft Project belum pernah disimpan ke PostgreSQL:

* User dapat menekan tombol **Publish New Project**.
* Data project beserta task dikirim ke API.
* PostgreSQL membuat ID unik untuk project baru, sebaiknya menggunakan UUID atau ID stabil yang tidak berubah.
* API mengembalikan `project_id`.
* VBA menyimpan `project_id` tersebut di file Microsoft Project, misalnya menggunakan:

  * `ProjectSummaryTask.Text1`, atau
  * custom field khusus, atau
  * project property yang paling aman dan mudah dipertahankan.
* Setelah itu file Microsoft Project dianggap sudah terhubung dengan project di PostgreSQL.

### 3. Mengikat task Microsoft Project dengan record PostgreSQL

Setiap task atau operation juga harus memiliki ID unik agar proses update tidak membuat duplikasi.

Gunakan konsep berikut:

* `project_id`: ID unik untuk satu project.
* `task_id`: ID unik untuk setiap task atau operation.
* `order_no` dan `operation_no`: tetap disimpan sebagai business key.
* `task_id`: digunakan sebagai technical key untuk sinkronisasi.
* Saat task baru dibuat di Microsoft Project dan belum memiliki `task_id`, PostgreSQL membuat `task_id`, lalu API mengembalikannya agar VBA menyimpannya ke custom field pada task, misalnya `Text10` atau field lain yang belum digunakan.

Pastikan field yang dipakai tidak bertabrakan dengan mapping VBA yang sudah ada. Dokumentasikan mapping custom field Microsoft Project secara jelas.

### 4. Update project yang sudah pernah dipublish

Saat file Microsoft Project sudah memiliki `project_id`:

* Tombol berubah fungsi menjadi **Sync / Update Project**.
* VBA mengirimkan seluruh task atau hanya task yang berubah.
* API melakukan mekanisme `UPSERT`, bukan insert biasa.
* Task yang memiliki `task_id` diperbarui.
* Task baru yang belum memiliki `task_id` dibuatkan ID baru.
* API mengembalikan daftar task baru beserta `task_id` yang dihasilkan.
* VBA menyimpan `task_id` tersebut ke masing-masing task.
* Hindari duplikasi data jika tombol sync ditekan berulang kali.

### 5. Import beberapa project ke satu file Microsoft Project

User dapat memilih beberapa project dari PostgreSQL dan memasukkannya ke satu file Microsoft Project sebagai grouped tasks atau summary tasks.

Contoh tampilan:

* Project A

  * Operation 0010
  * Operation 0020
* Project B

  * Operation 0010
  * Operation 0030

Pastikan setiap task tetap memiliki `project_id` dan `task_id`, sehingga update dapat dikirim kembali ke project yang benar.

## Ketentuan teknis

Gunakan stack yang sudah tersedia pada project:

* PostgreSQL
* API existing yang sudah ada di project MPS2
* VBA Microsoft Project

Jangan membuat query kompleks langsung di API jika dapat dipisahkan menjadi:

* PostgreSQL view
* Stored function sederhana
* Query ringan dengan index yang sesuai

Tambahkan migration SQL jika diperlukan.

Minimal buat atau sesuaikan struktur tabel berikut:

### Tabel project master

`ms_project`

Kolom minimal:

* `project_id`
* `project_name`
* `description`
* `status`
* `created_at`
* `updated_at`
* `created_by`
* `updated_by`

### Tabel project task

`ms_project_task`

Kolom minimal:

* `task_id`
* `project_id`
* `parent_task_id`
* `task_name`
* `outline_level`
* `order_no`
* `operation_no`
* `workcenter`
* `resource_name`
* `plan_start`
* `plan_finish`
* `duration`
* `progress`
* `created_at`
* `updated_at`

Sesuaikan dengan tabel `sow` dan struktur existing. Jangan menduplikasi tabel jika data yang dibutuhkan sebenarnya sudah tersedia. Jelaskan apakah lebih baik:

1. Menambahkan kolom `project_id` dan `task_id` pada tabel existing.
2. Membuat tabel mapping tambahan.
3. Membuat tabel baru khusus Microsoft Project.

Pilih desain yang paling aman untuk existing application dan jelaskan alasannya.

## Endpoint API yang diperlukan

Analisis API existing terlebih dahulu. Jika belum tersedia, buat endpoint dengan pola yang konsisten, misalnya:

* `GET /ms-project/projects`

  * Mengambil daftar project.

* `GET /ms-project/projects/:project_id/tasks`

  * Mengambil detail task untuk project terpilih.

* `POST /ms-project/projects`

  * Membuat project baru beserta task.
  * Mengembalikan `project_id` dan daftar `task_id`.

* `PUT /ms-project/projects/:project_id/sync`

  * Sinkronisasi task project yang sudah terhubung.
  * Menggunakan UPSERT.
  * Mengembalikan task baru beserta `task_id`.

* `POST /ms-project/projects/bulk-load`

  * Mengambil beberapa project sekaligus untuk dimasukkan ke Microsoft Project.

Gunakan transaksi database saat melakukan publish atau sync agar tidak terjadi data setengah tersimpan.

## VBA User Interface

Tambahkan VBA UserForm atau menu sederhana dengan fungsi minimal:

* **Load Projects**
* **Import Selected Projects**
* **Publish New Project**
* **Sync Current Project**
* **Check Connection**
* Area log untuk menampilkan status berhasil atau error.

Tampilkan pesan error yang informatif. Jangan hanya menggunakan `MsgBox "Error"` tanpa detail.

Tambahkan logging untuk:

* Endpoint yang dipanggil
* HTTP status code
* Project ID
* Jumlah task terkirim
* Jumlah task berhasil dibuat
* Jumlah task berhasil diperbarui
* Error response dari API

## Hal yang perlu diperhatikan

* Jangan mengandalkan nomor baris task Microsoft Project sebagai ID karena dapat berubah saat user melakukan insert, delete, atau reorder task.
* Jangan membuat task duplikat saat user melakukan sync berkali-kali.
* Jangan menghapus task dari PostgreSQL secara otomatis hanya karena task tidak ditemukan pada file Microsoft Project. Gunakan soft delete atau status inactive jika fitur delete memang diperlukan.
* Pertahankan backward compatibility dengan fitur VBA existing selama masih relevan.
* Gunakan bulk request, bukan request satu per satu untuk setiap task.
* Buat validasi agar satu file Microsoft Project tidak secara tidak sengaja dipublish sebagai project baru jika sebenarnya sudah memiliki `project_id`.

## Output yang saya harapkan

Sebelum melakukan perubahan kode, buat analisis singkat yang berisi:

1. Struktur folder dan file VBA existing.
2. Flow existing saat kirim dan ambil data.
3. Field Microsoft Project yang saat ini sudah digunakan.
4. Rekomendasi struktur database.
5. Rekomendasi endpoint.
6. Mapping field Microsoft Project ke PostgreSQL.
7. Risiko perubahan terhadap fitur existing.
8. Tahapan implementasi.

Setelah analisis selesai, implementasikan secara bertahap:

1. Migration database.
2. Endpoint API.
3. Refactor VBA.
4. VBA UserForm.
5. Dokumentasi penggunaan.
6. Contoh skenario testing end-to-end.

Jangan membuat implementasi terlalu kompleks. Prioritaskan flow yang mudah dipahami dan dapat diuji terlebih dahulu.

## Resource dan Assignment Management

Resource dan assignment merupakan bagian inti dari integrasi. Jangan hanya menyimpan `resource_name` atau `workcenter` langsung pada tabel task.

Sebelum implementasi, analisis bagaimana resource saat ini digunakan pada VBA existing, tabel `sow`, tabel `workcenter`, dan tabel lain yang relevan. Tentukan apakah resource berupa:

* Workcenter
* Mesin individual
* Employee
* Material
* Resource lain

Jangan menduplikasi master data apabila tabel existing sudah cukup. Jika tabel existing dapat dipakai sebagai master resource, buat mapping atau view yang sesuai.

## Pembagian responsibility

Gunakan desain hybrid berikut:

### PostgreSQL sebagai source of truth untuk resource master

Resource master dikelola secara terpusat di PostgreSQL.

Microsoft Project hanya mengambil daftar resource aktif dari API dan memasukkannya ke Resource Sheet. User dapat melakukan assignment terhadap resource yang sudah tersedia.

Pada tahap awal, jangan membiarkan user membuat resource baru secara bebas dari Microsoft Project karena berisiko membuat data duplikat atau nama resource yang tidak konsisten.

Jika resource yang dibutuhkan belum tersedia, tampilkan warning bahwa resource harus ditambahkan atau diaktifkan di master data terlebih dahulu.

### Microsoft Project sebagai planning editor

Microsoft Project digunakan untuk:

* Membuat dan mengubah task
* Mengatur hierarchy task
* Mengatur predecessor dan dependency
* Memilih resource untuk task
* Mengatur assignment units
* Mengatur planned work
* Mengatur start dan finish
* Melakukan scheduling dan melihat over-allocation secara lokal

Setelah user selesai melakukan planning, VBA mengirimkan hasilnya ke PostgreSQL melalui bulk API.

### PostgreSQL sebagai pusat penyimpanan dan validasi lintas project

PostgreSQL digunakan untuk:

* Menyimpan project
* Menyimpan task
* Menyimpan resource master
* Menyimpan assignment
* Melakukan validasi bahwa resource masih aktif
* Menyediakan laporan penggunaan resource lintas project
* Memberikan warning jika resource digunakan melebihi kapasitas pada waktu yang bertabrakan
* Menyediakan data untuk dashboard capacity planning

Jangan mencoba membuat ulang scheduling engine Microsoft Project di PostgreSQL pada tahap awal. PostgreSQL cukup menyimpan hasil schedule dan melakukan validasi atau reporting.

## Struktur tabel resource

Buat atau sesuaikan tabel `ms_resource`.

Kolom minimal:

* `resource_id` UUID primary key
* `resource_code` VARCHAR unique
* `resource_name` VARCHAR
* `resource_category` VARCHAR

  * Contoh: `WORKCENTER`, `MACHINE`, `EMPLOYEE`, atau `MATERIAL`
* `resource_type` VARCHAR

  * Sesuaikan dengan kebutuhan Microsoft Project, misalnya `WORK` atau `MATERIAL`
* `max_units` NUMERIC
* `is_active` BOOLEAN
* `workcenter_code` VARCHAR nullable
* `machine_id` VARCHAR nullable
* `description` TEXT nullable
* `created_at`
* `updated_at`

Analisis apakah tabel `workcenter` atau master mesin existing dapat dijadikan sumber data. Jika iya, jangan langsung membuat data ganda. Pertimbangkan membuat view atau tabel mapping.

## Struktur tabel assignment

Buat tabel `ms_project_assignment`.

Kolom minimal:

* `assignment_id` UUID primary key
* `project_id` UUID foreign key
* `task_id` UUID foreign key
* `resource_id` UUID foreign key
* `assignment_units` NUMERIC
* `planned_work_minutes` INTEGER nullable
* `actual_work_minutes` INTEGER nullable
* `assignment_start` TIMESTAMPTZ nullable
* `assignment_finish` TIMESTAMPTZ nullable
* `is_active` BOOLEAN default true
* `local_assignment_uid` VARCHAR nullable
* `created_at`
* `updated_at`

Gunakan `assignment_id` dari PostgreSQL sebagai technical key permanen.

Jangan memakai nomor baris, index task, nama resource, atau assignment ID lokal Microsoft Project sebagai satu-satunya technical key.

Evaluasi apakah perlu menambahkan unique constraint pada kombinasi:

`task_id + resource_id + is_active`

Gunakan constraint tersebut hanya jika satu resource memang tidak boleh memiliki lebih dari satu assignment aktif pada task yang sama.

## Project resource team

Evaluasi kebutuhan tabel `ms_project_resource`.

Tabel ini digunakan untuk menyimpan daftar resource yang tersedia atau sudah dimasukkan ke dalam satu project, meskipun resource tersebut belum memiliki assignment ke task.

Kolom minimal:

* `project_resource_id` UUID primary key
* `project_id` UUID foreign key
* `resource_id` UUID foreign key
* `is_active` BOOLEAN
* `created_at`
* `updated_at`

Jika tabel ini tidak diperlukan untuk versi awal, jelaskan alasannya dan jangan membuat kompleksitas tambahan.

## Mapping ID ke Microsoft Project

Analisis custom field yang sudah digunakan VBA existing terlebih dahulu. Jangan menimpa field existing.

Gunakan konsep mapping berikut sebagai titik awal:

| Object Microsoft Project | Nilai           | Contoh Field                                    |
| ------------------------ | --------------- | ----------------------------------------------- |
| Project                  | `project_id`    | Project property atau summary-task custom field |
| Task                     | `task_id`       | `Task.Text10`                                   |
| Resource                 | `resource_id`   | `Resource.Text9`                                |
| Assignment               | `assignment_id` | `Assignment.Text10`                             |

Jika field tersebut sudah digunakan, pilih field kosong lain dan dokumentasikan mapping final.

Saat project baru dipublish:

1. Kirim project.
2. Kirim seluruh task.
3. Kirim resource team jika diperlukan.
4. Kirim seluruh assignment.
5. PostgreSQL membuat `project_id`, `task_id`, dan `assignment_id`.
6. API mengembalikan hasil mapping.
7. VBA menyimpan ID tersebut ke custom field object Microsoft Project yang sesuai.

Saat project existing disinkronkan:

1. Baca `project_id`.
2. Baca seluruh `task_id`.
3. Baca seluruh `resource_id`.
4. Baca seluruh `assignment_id`.
5. Kirim data secara bulk.
6. Gunakan UPSERT.
7. Kembalikan ID untuk task atau assignment baru.
8. Simpan ID baru ke file Microsoft Project.
9. Jangan membuat duplikasi saat sync dijalankan berulang kali.

## Endpoint tambahan

Analisis pola API existing terlebih dahulu. Jika belum tersedia, tambahkan endpoint berikut:

* `GET /ms-project/resources?active=true`

  * Mengambil master resource aktif.

* `GET /ms-project/projects/:project_id/package`

  * Mengambil satu paket data berisi project, task, resource team, assignment, dan dependency.

* `PUT /ms-project/projects/:project_id/sync`

  * Mengirim task dan assignment dalam satu transaksi database.

* `GET /ms-project/resources/conflicts`

  * Mengambil warning bentrok penggunaan resource lintas project berdasarkan rentang tanggal.

Untuk sync, gunakan payload bulk dengan struktur sederhana seperti:

```json
{
  "project": {},
  "tasks": [],
  "resources": [],
  "assignments": [],
  "dependencies": []
}
```

Jangan mengirim HTTP request satu per satu untuk setiap task atau assignment.

## Validasi sync

Tambahkan validasi berikut:

* Resource harus tersedia pada master PostgreSQL.
* Resource harus aktif.
* Task baru harus mendapatkan `task_id`.
* Assignment baru harus mendapatkan `assignment_id`.
* Assignment harus mengacu pada `task_id` dan `resource_id` yang valid.
* Sync berulang kali tidak boleh menghasilkan data duplikat.
* Assignment yang hilang dari file Microsoft Project jangan langsung dihapus permanen.
* Gunakan soft delete atau status inactive.
* Tambahkan project revision atau `updated_at` check untuk mendeteksi jika project diedit oleh dua user secara bersamaan.

## UI VBA

Pada UserForm, tambahkan:

* Tombol **Load Active Resources**
* Tombol **Refresh Resources**
* Tombol **Import Selected Projects**
* Tombol **Publish New Project**
* Tombol **Sync Current Project**
* Tombol **Check Resource Conflicts**
* Area log detail

Pada area log, tampilkan:

* Project ID
* Jumlah task
* Jumlah resource
* Jumlah assignment
* Jumlah task baru
* Jumlah assignment baru
* Jumlah update
* Jumlah warning conflict
* Error dari API

## Analisis yang harus diberikan sebelum coding

Sebelum mengubah kode, jelaskan:

1. Bagaimana resource saat ini disimpan pada VBA dan database.
2. Apakah tabel `workcenter` existing dapat digunakan sebagai master resource.
3. Apakah resource berarti mesin, workcenter, employee, atau kombinasi beberapa tipe.
4. Bagaimana assignment diekstrak dari Microsoft Project.
5. Custom field Microsoft Project yang masih kosong.
6. Apakah `ms_project_resource` diperlukan pada versi awal.
7. Desain conflict checking lintas project.
8. Risiko jika project yang sama dibuka dan diedit oleh dua user.
9. Tahapan implementasi paling sederhana untuk MVP.

Prioritaskan MVP yang mudah diuji. Jangan membangun replika penuh Project Web App pada tahap pertama.
