# WI Operator - Digital Timesheet Salvaging

| Kontrol Dokumen | Keterangan |
|---|---|
| Nomor Dokumen | WI-MPS2-TS-SALVAGING-OPR-001 |
| Revisi | Rev. 00 |
| Tanggal Berlaku | TBD |
| Pemilik Dokumen | Production / MPS2 Process Owner |
| Prepared By | TBD |
| Reviewed By | TBD |
| Approved By | TBD |

## 1. Tujuan

Memberikan panduan singkat bagi operator Salvaging untuk mencatat waktu kerja menggunakan Digital Timesheet MPS2 secara benar, mulai dari login, memilih workcenter, memilih job, start pekerjaan, stop pekerjaan, mencatat unproductive, dan mengecek riwayat timesheet.

## 2. Ruang Lingkup

WI ini hanya berlaku untuk operator yang menggunakan Timesheet MPS2 mode Salvaging.

| Dibahas | Tidak Dibahas |
|---|---|
| Login operator | Validasi foreman/admin |
| Pilih workcenter | Koreksi data oleh admin |
| Pilih job Salvaging | SAP posting detail |
| Start/Stop timesheet | API dan konfigurasi teknis |
| Input unproductive | Manufacturing mode |
| Cek riwayat timesheet | Machine Hours |

## 3. Definisi

| Istilah | Arti |
|---|---|
| Timesheet | Catatan waktu kerja operator. |
| Workcenter | Area kerja atau mesin tempat operator bekerja. |
| Job | Order dan operation yang dikerjakan operator. |
| Productive | Aktivitas kerja langsung pada job/order. |
| Unproductive | Aktivitas non-produktif seperti briefing, break, waiting material, maintenance, dan lainnya. |
| Start | Mulai mencatat waktu kerja. |
| Stop | Mengakhiri pencatatan waktu kerja. |
| TS Number | Nomor transaksi timesheet untuk penelusuran data. |
| SAP Reject | Data timesheet ditolak SAP dan perlu ditindaklanjuti foreman/admin. |

## 4. Tanggung Jawab Operator

| Tanggung Jawab | Keterangan |
|---|---|
| Login dengan user sendiri | Operator wajib menggunakan kartu/input ID miliknya sendiri. |
| Memilih workcenter yang benar | Workcenter harus sesuai tempat kerja aktual. |
| Memilih job yang benar | Order dan operation harus sesuai pekerjaan aktual. |
| Start saat mulai bekerja | Timesheet dibuat saat pekerjaan dimulai. |
| Stop saat pekerjaan selesai | Timesheet harus dihentikan saat pekerjaan selesai. |
| Mencatat unproductive dengan benar | Pilih kode unproductive sesuai kondisi aktual. |
| Melapor jika ada data salah | Hubungi foreman/admin jika salah pilih job, salah workcenter, lupa stop, atau muncul status abnormal. |

## 5. Persiapan Sebelum Input Timesheet

Sebelum mencatat timesheet, pastikan:

| Checklist | Standar |
|---|---|
| Perangkat | Tablet/PC terhubung ke jaringan dan aplikasi MPS2 bisa dibuka. |
| User operator | Kartu NFC atau ID operator tersedia. |
| Workcenter | Operator tahu workcenter tempat bekerja. |
| Job | Operator tahu order dan operation yang akan dikerjakan. |
| Kondisi browser | Jika NFC tidak bisa digunakan, pakai mode Eksternal. |

## 6. Login Timesheet

Halaman: **Login Timesheet**

1. Buka aplikasi MPS2.
2. Pilih menu Timesheet.
3. Pilih mode scan:
   - **Internal** jika menggunakan NFC di tablet/browser.
   - **Eksternal** jika menggunakan reader/input ID manual.
4. Pilih aksi yang dibutuhkan.
5. Scan kartu NFC atau input ID operator.

| Aksi | Kapan Dipakai | Hasil |
|---|---|---|
| Productive | Saat akan mulai atau melanjutkan pekerjaan job. | Masuk ke menu utama timesheet. |
| Stop Timesheet | Saat pekerjaan selesai. | Timesheet aktif operator dihentikan. |
| Unproductive | Saat akan mencatat aktivitas non-produktif. | Masuk ke menu unproductive atau membuat quick unproductive. |
| Tools & Consumable | Saat perlu request tools/consumable. | Masuk ke halaman request terkait. |

Jika sistem kembali ke halaman login, ulangi proses login.

## 7. Pilih Workcenter

Halaman: **Pilih Workcenter / Machine**

1. Dari menu utama timesheet, pilih **Select Machine**.
2. Pilih workcenter sesuai area kerja aktual.
3. Pastikan workcenter tampil benar di menu utama.
4. Jika salah, ulangi pemilihan sebelum start.

Operator tidak boleh start timesheet jika workcenter belum sesuai.

## 8. Pilih Job

Halaman: **Pilih Job**

1. Masukkan nomor order di kolom pencarian.
2. Klik **Search** atau gunakan scan barcode.
3. Pilih order dan operation yang sesuai pekerjaan.
4. Sistem kembali ke menu utama.
5. Pastikan order dan operation tampil benar sebelum start.

Jika muncul peringatan **JOB KEHABISAN JAM**, jangan lanjut tanpa konfirmasi foreman.

| Kondisi | Tindakan Operator |
|---|---|
| Job benar dan tidak ada peringatan | Lanjut start pekerjaan. |
| Job tidak ditemukan | Cek nomor order atau hubungi foreman. |
| Operation tidak sesuai | Jangan pilih, cari operation yang benar. |
| Job kehabisan jam | Hubungi foreman sebelum lanjut. |

## 9. Start Productive Timesheet

Sebelum start, cek data berikut:

| Data | Harus Sesuai |
|---|---|
| Nama operator | Sesuai user yang login. |
| SN operator | Sesuai operator. |
| Workcenter | Sesuai area kerja aktual. |
| Order | Sesuai pekerjaan. |
| Operation | Sesuai aktivitas yang dikerjakan. |

Langkah start:

1. Pastikan semua data benar.
2. Klik tombol Start/Play.
3. Pastikan muncul notifikasi berhasil.
4. Kerjakan pekerjaan sesuai order dan operation.

## 10. Stop Timesheet

Stop dilakukan saat pekerjaan selesai atau operator berhenti mengerjakan job.

Langkah:

1. Buka halaman Login Timesheet.
2. Pilih aksi **Stop Timesheet**.
3. Scan NFC atau input ID operator.
4. Pastikan muncul notifikasi bahwa timesheet berhasil dihentikan.

Jika lupa stop atau ragu status timesheet, cek melalui halaman **View Timesheet** atau hubungi foreman.

## 11. Mode Single dan Multiple

| Mode | Arti | Catatan untuk Operator |
|---|---|---|
| Single | Operator hanya mencatat satu aktivitas aktif. | Mode ini paling aman untuk pekerjaan normal. |
| Multiple | Productive dapat tetap berjalan saat operator mencatat unproductive tertentu. | Gunakan hanya jika sudah diarahkan foreman. |

Peringatan:

- Pastikan memahami mode yang sedang aktif.
- Mode Multiple dapat membuat waktu productive dan unproductive berjalan dalam periode yang sama.
- Jika tidak yakin, gunakan Single atau hubungi foreman.

## 12. Input Unproductive

Unproductive dipakai untuk mencatat aktivitas non-produktif.

Langkah:

1. Dari Login Timesheet, pilih **Unproductive**.
2. Scan NFC atau input ID operator.
3. Pilih kode unproductive yang sesuai.
4. Pastikan muncul notifikasi berhasil.

Quick mode yang tersedia:

| Quick Mode | Aktivitas |
|---|---|
| Briefing | BRIEFING |
| Break | COFFEE BREAKS |
| Housekeeping | HOUSEKEEPING |

Daftar kode unproductive:

| Kode | Aktivitas |
|---:|---|
| 1510 | BRIEFING |
| 1520 | COFFEE BREAKS |
| 1530 | HOUSEKEEPING |
| 1540 | TRAINING |
| 1550 | WAITING FOR MATERIAL |
| 1560 | WAITING FOR NCR |
| 1570 | WAITING FOR ENGINEERING |
| 1580 | WAITING FOR INSPECTION |
| 1590 | WAITING FOR HANDLING |
| 1610 | JIGS & FIXTURES |
| 1620 | TOOL PREPARATION |
| 1630 | MAINTENANCE |
| 1640 | LABOUR NECESSITY |
| 1650 | MACHINE / ELECTRICITY BREAKDOWN |
| 1660 | DAILY PM |
| 1670 | WAITING FOR JOB |
| 1680 | OTHERS |

## 13. Cek Riwayat Timesheet

Halaman: **View Timesheet**

Gunakan halaman ini untuk:

- melihat riwayat timesheet,
- memastikan timesheet sudah stop,
- melihat timesheet yang masih berjalan,
- meminta bantuan foreman jika ada data salah.

Jika ada data salah, jangan membuat koreksi sendiri di luar prosedur. Laporkan ke foreman/admin.

## 14. Kondisi Abnormal dan Eskalasi

| Kondisi | Tindakan Operator | Hubungi |
|---|---|---|
| Tidak bisa login | Ulangi scan/input dan cek koneksi. | Foreman/Admin IT |
| Workcenter salah | Pilih ulang workcenter sebelum start. | Foreman jika sudah terlanjur start |
| Salah pilih job | Stop jika perlu dan laporkan. | Foreman/Admin |
| Lupa stop timesheet | Cek View Timesheet dan laporkan. | Foreman/Admin |
| Job kehabisan jam | Jangan lanjut tanpa arahan. | Foreman |
| Timesheet tidak muncul | Refresh dan cek koneksi. | Foreman/Admin IT |
| SAP Reject | Operator tidak perlu memperbaiki sendiri. | Foreman/Admin |

## 15. Checklist Harian Operator

| Checklist | Ya/Tidak |
|---|---|
| Login memakai kartu/user sendiri. |  |
| Workcenter sudah sesuai. |  |
| Order sudah sesuai. |  |
| Operation sudah sesuai. |  |
| Mode Single/Multiple sudah dipahami. |  |
| Timesheet sudah start saat pekerjaan dimulai. |  |
| Timesheet sudah stop saat pekerjaan selesai. |  |
| Unproductive dicatat dengan kode yang benar. |  |
| Kondisi abnormal sudah dilaporkan ke foreman. |  |

## 16. Training Requirement

Operator wajib menerima training penggunaan Digital Timesheet MPS2 sebelum memakai sistem di area kerja.

Materi training minimal:

- login dan scan NFC/input eksternal,
- pilih workcenter,
- pilih job,
- start dan stop timesheet,
- input unproductive,
- penggunaan mode Single/Multiple,
- eskalasi jika terjadi salah input atau error.

## 17. Record Retention

Data timesheet tersimpan di sistem MPS2. Export manual hanya digunakan jika diminta foreman/admin untuk audit atau rekonsiliasi.

## 18. Riwayat Revisi

| Revisi | Tanggal | Perubahan | Dibuat Oleh |
|---|---|---|---|
| 00 | TBD | Initial issue WI Operator Digital Timesheet Salvaging. | TBD |

