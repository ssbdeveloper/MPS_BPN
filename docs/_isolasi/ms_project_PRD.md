# PRD - Integrasi Microsoft Project dengan MPS2

Dokumen ini menjelaskan kebutuhan fitur integrasi Microsoft Project dengan MPS2 dalam bahasa sederhana untuk end user.

## 1. Ringkasan

Fitur ini dipakai agar planner dapat membuat dan mengubah jadwal kerja di Microsoft Project, lalu menyimpannya ke MPS2.

Microsoft Project dipakai untuk membuat planning. MPS2 dipakai sebagai tempat penyimpanan data resmi.

## 2. Tujuan

Dengan fitur ini, user dapat:

1. Membuka daftar project dari MPS2.
2. Mengambil project ke Microsoft Project.
3. Membuat project baru di Microsoft Project.
4. Menyimpan project baru ke MPS2.
5. Mengubah jadwal project yang sudah ada.
6. Mengirim perubahan jadwal ke MPS2.
7. Memakai resource resmi dari MPS2.
8. Mengecek potensi bentrok resource.
9. Mencegah data dobel saat sync berulang.

## 3. Pengguna

| Pengguna | Kebutuhan |
| --- | --- |
| Planner | Membuat dan mengubah jadwal project. |
| Supervisor | Melihat jadwal dan mengecek potensi bentrok resource. |
| SuperAdmin | Mengelola master resource dan membantu jika project terkunci. |
| Portfolio Planner | Melihat beberapa project dalam satu tampilan. |

## 4. Istilah Sederhana

| Istilah | Arti |
| --- | --- |
| Project | Satu rencana kerja. |
| Task | Baris pekerjaan di dalam project. |
| Resource | Orang, mesin, workcenter, team, atau area yang dipakai untuk pekerjaan. |
| Assignment | Resource yang ditugaskan ke task. |
| Dependency | Urutan antar task, misalnya task B mulai setelah task A selesai. |
| Publish | Menyimpan project baru dari Microsoft Project ke MPS2. |
| Sync | Mengirim perubahan project yang sudah ada ke MPS2. |
| Check-out | Mengunci project agar hanya satu user yang mengedit. |
| Check-in | Melepas kunci setelah selesai edit. |
| Conflict | Warning jika resource dipakai bersamaan melebihi kapasitas. |

## 5. Resource yang Dipakai

Resource harus berasal dari master data MPS2.

Jenis resource:

| Jenis | Contoh |
| --- | --- |
| Person | Operator, welder, fitter. |
| Machine | Mesin individual. |
| Workcenter | Area kerja atau kelompok kerja. |
| Team | Kelompok person. |
| Area | Bay atau lokasi kerja. |

Aturan penting:

1. User tidak membuat resource bebas langsung dari Microsoft Project.
2. Resource harus dipilih dari data MPS2.
3. Resource yang tidak aktif tidak boleh dipakai untuk planning baru.
4. Workcenter tidak selalu sama dengan mesin.

## 6. Alur Kerja Utama

### A. Membuat Project Baru

1. User membuka Microsoft Project.
2. User membuat task dan jadwal.
3. User memilih resource dari MPS2.
4. User klik `Publish New Project`.
5. MPS2 menyimpan project.
6. Project mendapat ID resmi dari MPS2.

### B. Mengubah Project Existing

1. User membuka project dari MPS2.
2. User melakukan `Check-out`.
3. User mengubah task, tanggal, durasi, resource, atau dependency.
4. User klik `Sync Existing Project`.
5. MPS2 menyimpan perubahan.
6. User melakukan `Check-in` setelah selesai.

### C. Melihat Banyak Project

1. User memilih beberapa project.
2. Microsoft Project menampilkan project dalam satu file.
3. Mode ini hanya untuk melihat pada tahap awal.
4. Sync tidak boleh dilakukan dari mode ini.

## 7. Calendar dan Jam Kerja

Setting calendar dari Microsoft Project dapat dikirim ke MPS2 sebagai metadata.

Data yang dapat disimpan:

1. Nama calendar project.
2. Calendar resource.
3. Calendar task.
4. Hari kerja dan hari libur.
5. Jam kerja per hari.
6. Exception day, misalnya holiday atau maintenance.
7. Pengaturan `Ignore Resource Calendar`.

Catatan:

1. Microsoft Project tetap menjadi alat utama untuk menghitung jadwal.
2. MPS2 menyimpan informasi calendar agar data planning bisa ditelusuri dan digunakan untuk reporting.

## 8. Planned vs Actual

Planning dan actual harus dipisahkan.

| Data | Sumber Resmi |
| --- | --- |
| Planned start | Microsoft Project |
| Planned finish | Microsoft Project |
| Planned duration | Microsoft Project |
| Planned resource | Microsoft Project |
| Actual progress | MPS2 / timesheet / transaksi lapangan |
| Actual work | MPS2 / timesheet / transaksi lapangan |
| Actual start-finish | MPS2 / timesheet / transaksi lapangan |

Aturan penting:

1. Sync dari Microsoft Project tidak boleh menimpa actual progress.
2. Actual tetap berasal dari data lapangan.
3. Microsoft Project dipakai untuk rencana, bukan sumber utama actual.

## 9. Conflict Check

Conflict check memberi warning jika resource dipakai melebihi kapasitas.

Contoh:

| Kondisi | Hasil |
| --- | --- |
| Operator yang sama dipakai di dua pekerjaan pada waktu sama. | Warning |
| Mesin yang sama dipakai untuk dua pekerjaan bersamaan. | Warning |
| Workcenter kapasitas 3, tetapi dipakai 4 pekerjaan bersamaan. | Warning |
| Resource dipakai bergantian. | Tidak warning |

Conflict pada tahap awal adalah warning. User tetap perlu review dan koordinasi sebelum final.

## 10. Tombol atau Menu Utama

| Menu | Fungsi |
| --- | --- |
| Check Connection | Mengecek koneksi ke MPS2. |
| List Projects | Melihat daftar project dari MPS2. |
| Import Project | Mengambil project dari MPS2 ke Microsoft Project. |
| Publish New Project | Menyimpan project baru ke MPS2. |
| Check-out | Mengunci project sebelum edit. |
| Sync Existing Project | Mengirim perubahan project ke MPS2. |
| Publish Current Revision | Membuat revision saat ini menjadi data published. |
| Check-in | Melepas kunci project. |
| Load Project Team | Mengambil resource team project. |
| Check Resource Conflicts | Mengecek potensi bentrok resource. |
| Clone as New Project | Menghapus ID lama agar file bisa dipublish sebagai project baru. |

## 11. Hal yang Boleh Dilakukan

User boleh:

1. Membuat task baru.
2. Mengubah nama task.
3. Mengubah tanggal planning.
4. Mengubah durasi planning.
5. Menambahkan resource resmi dari MPS2.
6. Mengubah dependency.
7. Publish project baru.
8. Sync project existing.
9. Mengecek conflict resource.

## 12. Hal yang Harus Dihindari

User sebaiknya tidak:

1. Membuat resource bebas langsung di Microsoft Project.
2. Menghapus ID custom field secara manual.
3. Menyalin file project lama lalu sync sebagai project existing.
4. Sync dari Master Portfolio View.
5. Mengubah actual progress di Microsoft Project dan menganggapnya data resmi.
6. Mengabaikan warning conflict tanpa review.

## 13. Error yang Mungkin Muncul

| Pesan | Arti | Tindakan |
| --- | --- | --- |
| Project locked | Project sedang diedit user lain. | Tunggu user lain check-in atau minta SuperAdmin. |
| Revision conflict | Project sudah berubah di MPS2. | Import ulang data terbaru sebelum sync. |
| Resource not found | Resource tidak ada di MPS2. | Pilih resource dari master MPS2. |
| Resource not in project team | Resource belum masuk team project. | Tambahkan resource ke project team. |
| Master Portfolio read-only | File hanya untuk melihat banyak project. | Gunakan Single Project Editor untuk sync. |

## 14. Checklist Sebelum Publish atau Sync

Sebelum publish atau sync, pastikan:

1. Project yang dibuka sudah benar.
2. Task sudah rapi.
3. Resource berasal dari MPS2.
4. Assignment sudah sesuai.
5. Dependency sudah sesuai.
6. Conflict sudah dicek jika diperlukan.
7. File copy lama sudah di-`Clone as New Project` jika ingin dibuat project baru.

## 15. Ringkasan Akhir

Integrasi ini membantu user membuat planning di Microsoft Project dan menyimpannya ke MPS2 dengan aman.

Prinsip utamanya:

1. Microsoft Project untuk planning.
2. MPS2 untuk data resmi.
3. Resource harus dari MPS2.
4. Actual data tidak ditimpa oleh planning.
5. Check-out dan check-in mencegah update saling tabrak.
6. Conflict check membantu user melihat potensi bentrok resource.
