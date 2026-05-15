
## Objective

Buat table baru `sow_operationcard` untuk menyimpan data **Operation Card** beserta gambar-gambar yang sudah ditambahkan user ke dalam box Operation Card.

## Requirement

### 1. Database

Buat table baru:

`sow_operationcard`

Fungsinya:

* Menyimpan record Operation Card
* Menyimpan konfigurasi/layout gambar yang sudah ditambahkan ke box Operation Card
* Agar Operation Card yang sudah dibuat bisa dibuka kembali untuk preview/edit

Relasi yang dibutuhkan:

* Hubungkan `sow_operationcard` ke record table SOW yang relevan sesuai struktur existing project

Contoh field yang dibutuhkan:

* `id`
* `sow_id` atau `sow_standard_id` / operation reference sesuai struktur existing
* `title` / `name` jika diperlukan
* `images` atau `layout_data` dalam bentuk JSON
* `created_at`
* `updated_at`

### 2. Image Save Behavior

Saat user menambahkan gambar ke box Operation Card:

* Simpan data gambar ke record Operation Card
* Simpan juga metadata/layout gambar, seperti:

  * image URL / file path
  * posisi x dan y
  * width
  * height
  * rotation jika ada
  * urutan/layer jika ada

### 3. Save Operation Card

Saat user selesai mengedit Operation Card dan klik save:

* Semua gambar yang ada di box Operation Card ikut tersimpan
* Layout terakhir ikut tersimpan
* Data bisa dipanggil kembali nanti

### 4. Preview / Reload Behavior

Saat Operation Card dibuka kembali (dipanel edit history ada button untuk view operation card):

* Ambil data dari `sow_operationcard`
* Render ulang gambar-gambar di posisi dan ukuran terakhir
* Preview harus sama seperti kondisi terakhir saat disimpan

## Expected Result

* Operation Card bisa disimpan sebagai record
* Gambar-gambar di dalam Operation Card tidak hilang setelah refresh / buka ulang
* Layout gambar tetap sama seperti terakhir diedit
* Data siap digunakan untuk preview maupun edit ulang

## Notes

* Ikuti naming convention dan pola table existing
* Gunakan struktur penyimpanan image yang sudah ada di project
* Jika project sudah punya table/file storage untuk gambar, gunakan pola tersebut daripada membuat mekanisme baru
