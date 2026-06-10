# Product Requirements Document 

Dokumen ini menjelaskan fitur integrasi Microsoft Project dengan MPS2 

## 1. Tujuan Fitur

Integrasi ini dibuat supaya planning kerja di Microsoft Project bisa tersimpan ke sistem MPS2.

Dengan fitur ini, user dapat:

1. Membuat atau membuka planning project di Microsoft Project.
2. Menggunakan resource resmi dari MPS2, seperti orang, mesin, workcenter, atau team.
3. Mengirim planning ke database MPS2. (Save and Publish)
4. Mengambil ulang project dari MPS2 ke Microsoft Project.
5. Mengecek potensi bentrok penggunaan resource.
6. Menghindari data duplikat saat sync berkali-kali. (Check-in Check-out File)

Microsoft Project tetap dipakai sebagai alat membuat jadwal. MPS2 menjadi tempat penyimpanan data resmi.

## 2. Siapa yang Menggunakan

Fitur untuk:

| User               | Kebutuhan                                                 |
| ------------------ | --------------------------------------------------------- |
| Planner            | Membuat jadwal kerja dan assignment resource (Dedicated). |
| SuperAdmin         | Menjaga master resource tetap rapi.                       |
| Portofolio Planner | Multiple Project View                                     |


## 3. Istilah Penting

| Istilah    | Arti Sederhana                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Project    | Satu pekerjaan atau rencana kerja di Microsoft Project.                                                 |
| Task       | Baris pekerjaan di dalam project. Biasanya mewakili operation atau aktivitas.                           |
| Resource   | Orang, mesin, workcenter, atau team yang dipakai untuk mengerjakan task.                                |
| Assignment | Hubungan antara task dan resource. Contoh: task A dikerjakan oleh mesin B.                              |
| Dependency | Hubungan urutan antar task. Contoh: task B baru mulai setelah task A selesai.(Successor dan Predecesor) |
| Publish    | Mengirim project baru dari Microsoft Project ke MPS2.                                                   |
| Sync       | Mengirim update planning project yang sudah ada ke MPS2.                                                |
| Conflict   | Peringatan bahwa resource dipakai bersamaan melebihi kapasitas.                                         |

## 4. Jenis Resource

Resource tidak hanya mesin.

Sistem mendukung beberapa jenis resource:

| Jenis Resource | Contoh                   | Keterangan                                  |
| -------------- | ------------------------ | ------------------------------------------- |
| Person         | Operator, welder, fitter | Orang yang bisa ditugaskan ke pekerjaan.    |
| Machine        | Mesin individual         | Mesin tertentu yang dipakai untuk produksi. |
| Workcenter     | Area atau kelompok kerja | Bisa dipakai sebagai kapasitas umum.        |
| Area           | Bay                      | Block lokasi kerja                          |

Catatan penting:

1. Workcenter tidak selalu sama dengan mesin.
2. Person/resource orang tidak sama dengan akun login aplikasi.
3. Resource yang dipakai harus berasal dari master data MPS2.
4. User tidak boleh membuat resource bebas langsung dari Microsoft Project tanpa terdaftar di MPS2. (Hanya SuperAdmin yang bisa Full Access ke Master Resource)

## 5. Alur Kerja Utama

### A. Membuka Project dari MPS2

1. User membuka Microsoft Project.
2. User memilih project dari daftar yang tersedia di MPS2.
3. Sistem mengambil data project, task, resource, assignment, dan dependency.
4. Microsoft Project menampilkan jadwal yang bisa dilihat dan diedit.

### B. Membuat Project Baru

1. User membuat file baru di Microsoft Project.
2. User membuat task atau jadwal kerja.
3. User memilih resource resmi dari MPS2.
4. User melakukan `Publish New Project`.
5. Sistem menyimpan project baru ke database MPS2.
6. Setelah berhasil, project mendapat ID resmi dari MPS2.

### C. Mengubah Project Existing

1. User membuka project yang sudah pernah dipublish.
2. User mengubah planning, tanggal, durasi, assignment, atau dependency (Successor + Predecesor).
3. User menjalankan `Sync Existing Project`.
4. MPS2 menyimpan perubahan tanpa membuat duplikasi.

### D. Clone Project (Deprecated)

Jika user ingin membuat project baru dari file lama:

1. Jalankan `Clone as New Project`.
2. Sistem menghapus ID lama dari file Microsoft Project.
3. User bisa publish sebagai project baru.

Ini penting supaya file copy tidak menimpa project lama.

## 6. Mode Penggunaan

### Single Project Editor

Mode ini digunakan untuk mengedit satu project.

Ciri-ciri:

1. Satu file Microsoft Project berisi satu project.
2. User boleh edit dan sync.
3. Ini adalah mode utama untuk MVP.

### Master Portfolio View

Mode ini digunakan untuk melihat beberapa project dalam satu file.
(Task Usage / Resource Usage)
Ciri-ciri:

1. Satu file bisa menampilkan banyak project.
2. Untuk tahap awal, mode ini hanya untuk melihat.
3. User tidak boleh melakukan sync dari mode ini.

Tujuannya agar update banyak project tidak salah kirim.

## 7. Resource Team Project

Setiap project punya daftar resource yang boleh digunakan.

Contoh:

| Project   | Resource Team                                       |
| --------- | --------------------------------------------------- |
| Project A | Operator 1, Mesin A, Workcenter Welding, Area (Bay) |
| Project B | Operator 2, Mesin B, Team Assembly                  |

Manfaatnya:

1. File Microsoft Project tidak perlu memuat semua resource perusahaan.
2. User hanya melihat resource yang relevan.
3. Assignment lebih rapi.
4. Resource yang tidak terdaftar tidak bisa dipakai sembarangan.

## 8. Conflict Check

Conflict check membantu melihat apakah resource dipakai melebihi kapasitas.

Contoh:

| Kondisi                                                      | Hasil            |
| ------------------------------------------------------------ | ---------------- |
| Operator A dipakai di dua task pada jam yang sama            | Warning conflict |
| Mesin B dipakai bersamaan untuk dua pekerjaan                | Warning conflict |
| Workcenter kapasitas 3, tetapi dipakai 4 pekerjaan bersamaan | Warning conflict |
| Resource dipakai bergantian, tidak bersamaan                 | Tidak conflict   |
| Area melebihi kapasitas area                                 | Warning conflict |

Conflict pada tahap awal bersifat warning. Artinya user diberi peringatan, tetapi sistem tidak perlu otomatis memblokir semua proses.

## 9. Planned vs Actual

Ada dua jenis data yang harus dibedakan.

| Data | Sumber |
| --- | --- |
| Planned start | Microsoft Project |
| Planned finish | Microsoft Project |
| Planned duration | Microsoft Project |
| Planned resource assignment | Microsoft Project |
| Actual progress | MPS2, timesheet, transaksi lapangan |
| Actual work | MPS2, timesheet, transaksi lapangan |
| Actual start/finish | MPS2, timesheet, transaksi lapangan |

Aturan penting:

1. Sync planning dari Microsoft Project tidak boleh menimpa actual progress.
2. Actual data tetap berasal dari transaksi lapangan.
3. Microsoft Project dipakai untuk rencana, bukan sebagai sumber utama actual.

## 10. Pencegahan Duplikasi

Sistem dirancang agar sync berkali-kali tidak membuat data double.

Yang dicegah:

1. Project dobel.
2. Task dobel.
3. Assignment dobel.
4. Resource dobel.
5. Dependency dobel.

Setiap data yang sudah tersimpan di MPS2 memiliki ID khusus. ID ini disimpan di file Microsoft Project agar sync berikutnya tahu data mana yang harus diupdate.

## 11. Hal yang Boleh Dilakukan User

User boleh:

1. Membuat task baru.
2. Mengubah nama task.
3. Mengubah start dan finish planning.
4. Mengubah durasi planning.
5. Menambahkan assignment resource resmi.
6. Mengubah urutan dependency.
7. Publish project baru.
8. Sync project existing.
9. Check conflict resource.
10. Mengubah Status Project

## 12. Hal yang Perlu Dihindari

User sebaiknya tidak:

1. Membuat resource baru langsung di Microsoft Project tanpa mengambil dari MPS2.
2. Menghapus ID custom field secara manual.
3. Menyalin file project lama lalu langsung sync sebagai project existing.
4. Melakukan sync dari Master Portfolio View.
5. Menganggap warning conflict sebagai data final tanpa review.
6. Mengubah actual progress di Microsoft Project lalu berharap menjadi data resmi MPS2.

## 13. Contoh Skenario Sederhana

### Skenario 1: Planner Membuat Project Baru

1. Planner buka Microsoft Project.
2. Planner buat task sesuai operation.
3. Planner pilih resource dari MPS2.
4. Planner assign resource ke task.
5. Planner klik publish.
6. Project tersimpan di MPS2.

### Skenario 2: Planner Update Jadwal

1. Planner buka project existing.
2. Planner geser tanggal task.
3. Planner klik sync.
4. MPS2 menyimpan perubahan planning.
5. Actual progress tidak berubah.

### Skenario 3: Supervisor Cek Bentrok Resource

1. Supervisor buka project.
2. Supervisor klik check conflict.
3. Sistem menampilkan warning jika ada resource bentrok.
4. Supervisor dapat koordinasi dengan planner.

## 14. Pesan Error yang Mungkin Muncul

| Pesan | Arti | Tindakan |
| --- | --- | --- |
| Project revision conflict | Project sudah diubah user lain | Reload project terbaru sebelum sync. |
| Resource not found | Resource tidak terdaftar di MPS2 | Pilih resource dari resource pool MPS2. |
| Resource not in project team | Resource belum masuk team project | Tambahkan resource ke project team. |
| Invalid assignment units | Nilai kapasitas resource tidak valid | Pastikan units lebih dari 0. |
| Master Portfolio read-only | File berisi banyak project | Gunakan Single Project Editor untuk sync. |
Force Checkin  bisa dilakukan oleh SuperAdmin.

## 15. Checklist Sebelum Publish atau Sync

Sebelum publish/sync, pastikan:

1. Project yang dibuka memang benar.
2. Task sudah rapi.
3. Resource diambil dari MPS2.
4. Assignment sudah sesuai.
5. Dependency sudah sesuai.
6. Tidak sedang membuka file copy yang seharusnya menjadi project baru.
7. Conflict warning sudah dicek jika diperlukan.

## 16. Ringkasan Singkat

Integrasi Microsoft Project MPS2 membantu planner membuat jadwal di Microsoft Project dan menyimpannya ke MPS2.

Poin utama:

1. Microsoft Project untuk planning.
2. MPS2 untuk database resmi.
3. Resource harus dari master data MPS2.
4. Sync tidak menimpa actual data.
5. Conflict check memberi warning penggunaan resource.
6. Master Portfolio View hanya untuk melihat pada tahap awal.

## 17. Fungsi Tabel Database untuk Microsoft Project

Bagian ini menjelaskan fungsi tabel-tabel utama yang dipakai untuk menyimpan data Microsoft Project di MPS2.

### Ringkasan Tabel

| Tabel                   | Fungsi Utama                                                            | Contoh Isi                                       |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| `ms_project`            | Menyimpan header atau identitas utama project.                          | Nama project, status, revision number.           |
| `ms_project_task`       | Menyimpan daftar pekerjaan atau task di dalam project.                  | Operation, start, finish, durasi, parent task.   |
| `ms_resource`           | Menyimpan master resource perusahaan untuk kebutuhan Microsoft Project. | Person, mesin, workcenter, Area                  |
| `ms_project_resource`   | Menyimpan daftar resource yang dipilih untuk satu project tertentu.     | Resource team project A.                         |
| `ms_project_assignment` | Menyimpan hubungan antara task dan resource.                            | Task welding dikerjakan oleh workcenter welding. |
| `ms_project_dependency` | Menyimpan hubungan urutan antar task.                                   | Task B mulai setelah task A selesai.             |

### `ms_project`

Tabel ini adalah data induk project.

Fungsinya:

1. Menyimpan satu baris untuk setiap project.
2. Menyimpan nama project.
3. Menyimpan system_status project, misalnya active atau inactive.
4. Menyimpan revision number untuk mencegah user menimpa update user lain.
5. Menjadi penghubung utama ke task, resource team, assignment, dan dependency.

Contoh sederhana:

| project_name          | system_status | revision_no |
| --------------------- | ------------- | ----------- |
| Project Repair Pump A | ACTIVE        | 3           |
| Trial MS Project SOW  | INACTIVE      | 1           |

### `ms_project_task`

Tabel ini menyimpan task atau pekerjaan di dalam project.

Fungsinya:

1. Menyimpan daftar task dari Microsoft Project.
2. Menyimpan struktur parent-child task.
3. Menyimpan planned start dan planned finish.
4. Menyimpan durasi planning.
5. Menyimpan business reference seperti `order_no`, `operation_no`, dan `ssbr_id`.
6. Menyimpan actual data sebagai informasi dari MPS2/timesheet, tetapi planning sync tidak boleh menimpanya.

Contoh sederhana:

| task_name | order_no | operation_no | planned data |
| --- | --- | --- | --- |
| Welding Frame | 1000114780 | 10 | start, finish, duration |
| Quality Check | 1000114780 | 20 | start, finish, duration |

Catatan:

1. Task summary juga disimpan di tabel ini.
2. Child task terhubung ke parent task.
3. Setiap task punya ID khusus agar sync berikutnya tidak membuat task dobel.
4. Calculate Column custom field PWA di Level Task

### `ms_resource`

Tabel ini adalah master resource untuk Microsoft Project.

Fungsinya:

1. Menyimpan semua resource yang boleh dipakai dalam planning.
2. Membedakan resource person, machine, workcenter, dan Area.
3. Menyimpan kapasitas resource melalui `max_units`.
4. Menyimpan asal data resource, misalnya dari `usernfc` atau `workcenter`.
5. Mencegah resource duplikat.

Contoh sederhana:

| resource_code | resource_category | Arti                    |
| ------------- | ----------------- | ----------------------- |
| EMP-00123     | PERSON            | Operator atau employee. |
| MCH-LATHE-01  | MACHINE           | Mesin individual.       |
| WC-WELDING    | WORKCENTER        | Workcenter welding.     |


Catatan:

1. Resource diambil dari master data MPS2.
2. User tidak boleh membuat resource bebas langsung dari Microsoft Project.
3. Resource inactive tidak boleh dipakai untuk assignment baru.

### `ms_project_resource`

Tabel ini menyimpan resource team untuk satu project.

Fungsinya:

1. Menentukan resource mana saja yang boleh dipakai di project tertentu.
2. Membuat file Microsoft Project lebih ringan karena tidak perlu memuat semua resource perusahaan.
3. Menjadi filter sebelum resource bisa di-assign ke task.
4. Mendukung soft delete, sehingga resource bisa dinonaktifkan dari project tanpa menghapus master resource.

Contoh sederhana:

| Project | Resource Team |
| --- | --- |
| Project A | Operator 1, Mesin A, Workcenter Welding |
| Project B | Operator 2, Mesin B, Team Assembly |

Catatan:

1. Resource harus masuk project team dulu sebelum dipakai pada assignment.
2. Add ulang resource yang pernah dihapus akan mengaktifkan kembali data lama.
3. Jika resource masih dipakai assignment aktif, resource tidak boleh dinonaktifkan sembarangan.

### `ms_project_assignment`

Tabel ini menyimpan assignment, yaitu hubungan antara task dan resource.

Fungsinya:

1. Menyimpan resource apa yang mengerjakan task tertentu.
2. Menyimpan kapasitas pemakaian resource, misalnya 100% atau 50%.
3. Menyimpan planned work.
4. Menyimpan planned assignment start dan finish.
5. Menjadi dasar conflict check resource.

Contoh sederhana:

| Task | Resource | Units |
| --- | --- | --- |
| Welding Frame | WC-WELDING | 1.0 |
| Machining Part | MCH-LATHE-01 | 1.0 |
| Assembly | TEAM-ASSEMBLY | 0.5 |

Arti units:

| Value | Arti |
| --- | --- |
| `1.0` | 100% kapasitas resource. |
| `0.5` | 50% kapasitas resource. |
| `2.0` | 200% kapasitas resource. |

Catatan:

1. Assignment hanya boleh memakai resource yang aktif.
2. Resource harus sudah masuk project team.
3. Planning sync tidak boleh menimpa actual work dari data lapangan.

### `ms_project_dependency`

Tabel ini menyimpan hubungan urutan antar task.

Fungsinya:

1. Menyimpan task mana yang harus selesai lebih dulu.
2. Menyimpan task mana yang bergantung pada task lain.
3. Membantu Microsoft Project membentuk urutan jadwal.
4. Mencegah dependency dobel saat sync.

Contoh sederhana:

| Predecessor | Successor | Arti |
| --- | --- | --- |
| Cutting | Welding | Welding mulai setelah Cutting selesai. |
| Welding | Quality Check | Quality Check mulai setelah Welding selesai. |

Catatan:

1. Untuk tahap awal, dependency hanya berlaku dalam project yang sama.
2. Cross-project dependency belum menjadi prioritas MVP.

### `ms_calender`

Menyimpan base Calender, Jumlah jam kerja per hari, working non working, exception days


## 18. Hubungan Antar Tabel

Secara sederhana, hubungan tabelnya seperti ini:

```text
ms_project
  ├─ ms_project_task
  │    └─ ms_project_dependency
  ├─ ms_project_resource
  │    └─ ms_resource
  └─ ms_project_assignment
       ├─ ms_project_task
       └─ ms_resource
```

Penjelasan:

1. Satu project memiliki banyak task.
2. Satu project memiliki banyak resource team.
3. Resource team mengambil data dari master `ms_resource`.
4. Assignment menghubungkan task dengan resource.
5. Dependency menghubungkan task dengan task lain.

## 19. Kenapa Tabelnya Dipisah

Tabel dipisah supaya data lebih rapi dan aman.

Manfaatnya:

1. Project bisa disync berkali-kali tanpa duplikasi.
2. Resource master tidak tercampur dengan assignment.
3. Resource bisa dipakai di banyak project.
4. Satu task bisa punya lebih dari satu resource.
5. Conflict check lebih mudah dihitung.
6. Actual data tidak tertimpa planning data.

## 20. Contoh Alur Data

Contoh saat user publish project baru:

1. Data project masuk ke `ms_project`.
2. Daftar task masuk ke `ms_project_task`.
3. Resource yang dipilih masuk ke `ms_project_resource`.
4. Hubungan task dan resource masuk ke `ms_project_assignment`.
5. Urutan antar task masuk ke `ms_project_dependency`.
6. Master resource tetap berada di `ms_resource`.

Contoh saat user sync project existing:

1. Sistem cek `revision_no` di `ms_project`.
2. Task existing diupdate di `ms_project_task`.
3. Task baru ditambahkan jika ada.
4. Assignment existing diupdate di `ms_project_assignment`.
5. Assignment baru ditambahkan jika ada.
6. Dependency diupdate atau ditambahkan.
7. Actual data tidak ditimpa oleh sync planning.
