Baca file `D:\website\MPS2\CLAUDE.md` dan pahami struktur project, khususnya pola database, relasi, dan naming convention yang digunakan.

### Objective

Tambahkan fitur untuk mengelola NNVA (Non-Value-Added Activity) sebagai child dari setiap operation di `sow_standard`.

---

### Database Design

Buat 2 tabel baru di PostgreSQL:

1. `sow_nnva_base`
   Menyimpan master/base activity NNVA.
   Contoh data:

   * Setting
   * Loading
   * Unloading
   * Measurement

2. `sow_nnva_standard`
   Menyimpan relasi antara `sow_standard` (operation) dengan NNVA yang dipilih.

Relasi:

* `sow_standard` (1) → (N) `sow_nnva_standard`
* `sow_nnva_base` (1) → (N) `sow_nnva_standard`

Kolom utama:

* `sow_nnva_base`

  * id
  * name
  * created_at / updated_at

* `sow_nnva_standard`

  * id
  * sow_standard_id (FK)
  * nnva_base_id (FK)
  * standard_hours (editable)
  * created_at / updated_at

---

### Feature Requirements

#### 1. Add NNVA ke Operation

Di halaman list `sow_standard`, tambahkan button:

* **"Add NNVA"** pada setiap operation

Saat diklik:

* Tampilkan modal / form
* Tampilkan daftar `sow_nnva_base`
* User bisa memilih multiple (checkbox)
* Setiap item punya field `standard_hours` (default value, bisa di-edit)

Saat submit:

* Data disimpan ke `sow_nnva_standard`
* Terhubung ke `sow_standard` yang dipilih

---

#### 2. Edit NNVA per Operation

* User bisa mengedit NNVA yang sudah di-assign ke operation
* Bisa:

  * Ubah `standard_hours`
  * Tambah / hapus NNVA

---

#### 3. Manage NNVA Base

Tambahkan fitur untuk:

* Create NNVA base
* Edit NNVA base
* (Optional) Delete NNVA base

---

### Expected Behavior

* Satu operation bisa punya banyak NNVA
* Satu NNVA base bisa dipakai di banyak operation
* Data tetap konsisten dengan relasi yang jelas
* UI mengikuti pola existing di project (lihat `D:\website\MPS2\CLAUDE.md`)

---

### Notes

* Gunakan naming convention yang sudah ada di project
* Pastikan FK dan indexing optimal
* Validasi input terutama `standard_hours`
* update singkat CLAUDE.md setelah kamu melakukan perubahan
