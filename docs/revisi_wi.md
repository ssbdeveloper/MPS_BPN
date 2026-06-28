## Kesimpulan review

**Belum sepenuhnya siap masuk Document Management System sebagai WI end-user.** Isinya sudah lengkap secara proses, tetapi masih terlalu bercampur antara:

1. **instruksi operator**,
2. **instruksi foreman/supervisor**,
3. **admin/IT support**,
4. **detail teknis sistem/API**,
5. **data structure dan audit trail teknis**.

Untuk DMS perusahaan, dokumen ini lebih kuat jika dijadikan **WI utama untuk pengguna operasional**, lalu bagian teknis dipindahkan ke **appendix teknis** atau dokumen terpisah. Dokumen saat ini sudah mencakup tujuan, ruang lingkup, peran, alur operator, validasi, SAP posting, troubleshooting, dan lampiran teknis. 

---

## Penilaian sebagai Work Instruction

| Area                     | Penilaian                                   | Catatan                                                                                                                                                             |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tujuan                   | **Cukup baik, tapi terlalu panjang**        | Tujuan sudah jelas, tetapi terlalu banyak menyebut istilah teknis seperti `tsnumber`, SAP Reject, audit trail. Untuk end user, tujuan perlu dibuat lebih sederhana. |
| Ruang lingkup            | **Baik**                                    | Sudah jelas bahwa dokumen hanya untuk Timesheet mode Salvaging.                                                                                                     |
| Peran dan akses          | **Baik, tetapi perlu diringkas**            | Cocok untuk DMS, namun terlalu detail jika targetnya operator.                                                                                                      |
| RACI                     | **Opsional**                                | Berguna untuk governance, tetapi biasanya lebih cocok di SOP/prosedur, bukan WI operator harian.                                                                    |
| Langkah kerja operator   | **Cukup sesuai**                            | Alur login, pilih workcenter, pilih job, start, stop, dan unproductive sudah sistematis.                                                                            |
| Validasi foreman/admin   | **Sesuai, tapi sebaiknya dokumen terpisah** | Ini bukan instruksi end user operator. Bisa jadi WI tersendiri: “WI Validasi Timesheet Salvaging”.                                                                  |
| SAP Posting / SAP Reject | **Terlalu teknis untuk operator**           | Operator cukup tahu: jika SAP Reject, foreman/admin yang tindak lanjut. Detail SAP Log lebih cocok untuk foreman/admin/IT.                                          |
| API Timesheet            | **Tidak cocok untuk end user WI**           | Bagian endpoint API sebaiknya dipindahkan ke dokumen teknis IT atau appendix restricted.                                                                            |
| Troubleshooting          | **Baik**                                    | Sangat berguna, tetapi perlu dibuat lebih praktis dan tidak terlalu teknis.                                                                                         |
| Checklist                | **Baik**                                    | Checklist harian operator dan checklist validasi sangat cocok untuk DMS.                                                                                            |

---

## Bagian yang terlalu teknikal untuk end user

Berikut bagian yang sebaiknya disederhanakan atau dipindahkan:

| Bagian                                                | Masalah                                                    | Rekomendasi                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Route UI seperti `/login-timesheet`, `/select-job`    | Terlihat seperti informasi developer, bukan instruksi user | Ganti dengan nama halaman: **Halaman Login Timesheet**, **Halaman Pilih Job**. Route bisa tetap di appendix teknis. |
| Istilah `payload SAP`                                 | Terlalu teknis                                             | Ganti menjadi “data yang dikirim ke SAP”.                                                                           |
| `tsnumber`                                            | Boleh dipakai, tapi perlu definisi sederhana               | Ganti menjadi “Nomor transaksi timesheet / TS Number”.                                                              |
| `state_flag = 3`, `state_flag = 5`                    | Terlalu teknis untuk operator dan foreman umum             | Ganti dengan status bisnis: **SAP Reject**, **Deleted**. Detail kode pindah ke appendix.                            |
| `validation_date`, `serialnumber`, `longdate_checkin` | Nama field database                                        | Untuk end user gunakan: **Tanggal validasi**, **SN Operator**, **Waktu mulai**.                                     |
| API endpoint                                          | Tidak perlu untuk end user                                 | Pindahkan ke “Dokumen Teknis IT – API Timesheet”.                                                                   |
| `session`, `Web NFC`, `API/koneksi`                   | Sebagian perlu, tapi bahasanya perlu disederhanakan        | “Sesi login”, “fitur scan NFC di browser”, “koneksi sistem”.                                                        |
| `POST /timesheet/post-to-sap` dan sejenisnya          | Murni teknis                                               | Jangan masuk WI end user utama.                                                                                     |

---

## Contoh perbaikan bahasa

| Saat ini                                                                           | Usulan bahasa untuk end user                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| “Sistem menyimpan job ke session”                                                  | “Sistem menyimpan pilihan job sementara dan kembali ke menu utama.”                            |
| “Workcenter digunakan dalam record timesheet dan payload SAP.”                     | “Workcenter akan tercatat pada timesheet dan dikirim ke SAP.”                                  |
| “SAP Reject (`state_flag = 3`) dikoreksi lalu divalidasi/posting ulang.”           | “Jika status SAP Reject, foreman/admin harus memperbaiki data, lalu melakukan validasi ulang.” |
| “Jika diarahkan kembali ke login, session dianggap belum aktif atau sudah hilang.” | “Jika kembali ke halaman login, ulangi proses login.”                                          |
| “PUT /timesheet/checkout-unprod”                                                   | Hapus dari WI end user; pindahkan ke dokumen teknis.                                           |
| “Record duration = 0 ditandai Deleted (`state_flag = 5`).”                         | “Jika durasi 0, data tidak dihitung sebagai timesheet valid.”                                  |

---

## Struktur yang lebih cocok untuk DMS

Saya sarankan dokumen dibagi seperti ini:

### 1. WI Operator – Digital Timesheet Salvaging

Isi hanya untuk operator:

1. Tujuan
2. Ruang Lingkup
3. Tanggung Jawab Operator
4. Persiapan Sebelum Input Timesheet
5. Login Timesheet
6. Pilih Workcenter
7. Pilih Job
8. Start Productive Timesheet
9. Stop Timesheet
10. Input Unproductive
11. Cek Riwayat Timesheet
12. Kondisi Abnormal dan Eskalasi
13. Checklist Harian Operator

### 2. WI Foreman/Admin – Validasi Timesheet Salvaging

Isi untuk foreman/admin:

1. Review data timesheet
2. Koreksi timesheet
3. Validasi row/group
4. SAP posting
5. SAP Reject handling
6. Export
7. Operator Performance
8. Checklist validasi

### 3. Dokumen Teknis IT – Digital Timesheet API & Support

Isi teknis:

1. API endpoint
2. Field database
3. `state_flag`
4. SAP Post Log teknis
5. Mapping activity type
6. Troubleshooting API/koneksi

---

## Kekurangan untuk standar DMS perusahaan

Dokumen ini perlu ditambahkan elemen kontrol dokumen berikut sebelum masuk DMS:

| Elemen DMS                              | Status Saat Ini | Rekomendasi                                                                                      |
| --------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| Nomor dokumen                           | Belum ada       | Tambahkan, misalnya `WI-MPS2-TS-SALVAGING-001`.                                                  |
| Revisi                                  | Belum ada       | Tambahkan `Rev. 00` atau sesuai sistem DMS.                                                      |
| Tanggal berlaku                         | Belum ada       | Tambahkan effective date.                                                                        |
| Pemilik dokumen                         | Belum ada       | Tentukan, misalnya Production / MPS2 Process Owner.                                              |
| Prepared by / Reviewed by / Approved by | Belum ada       | Wajib untuk DMS formal.                                                                          |
| Riwayat revisi                          | Belum ada       | Tambahkan tabel revision history.                                                                |
| Referensi dokumen terkait               | Belum ada       | Tambahkan SOP produksi, prosedur SAP confirmation, prosedur koreksi data, dll.                   |
| Definisi istilah                        | Belum ada       | Tambahkan definisi: Timesheet, Workcenter, Job, Operation, Productive, Unproductive, SAP Reject. |
| Training requirement                    | Belum ada       | Tambahkan: operator/foreman wajib training sebelum penggunaan.                                   |
| Record retention                        | Belum ada       | Tambahkan masa simpan export/log jika perusahaan mensyaratkan.                                   |

---

## Risiko jika dokumen ini langsung dipakai end user

| Risiko                                                    | Dampak                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| Operator bingung karena terlalu banyak istilah teknis     | Salah input atau mengabaikan instruksi penting.                    |
| Tanggung jawab operator, foreman, admin bercampur         | User tidak jelas siapa melakukan apa.                              |
| Detail API terlihat di dokumen operasional                | Tidak relevan untuk user dan bisa dianggap tidak sesuai format WI. |
| Instruksi terlalu panjang                                 | Sulit dipakai di area kerja/shopfloor.                             |
| Istilah teknis tidak didefinisikan                        | Interpretasi bisa berbeda antar user.                              |
| Single/Multiple mode belum diberi warning yang cukup kuat | Risiko jam overlap atau salah interpretasi durasi.                 |

---

## Rekomendasi revisi prioritas

### Wajib sebelum masuk DMS

1. **Pisahkan dokumen operator dan foreman/admin.**
2. **Pindahkan API endpoint ke dokumen teknis IT.**
3. **Tambahkan header kontrol dokumen DMS.**
4. **Tambahkan definisi istilah.**
5. **Sederhanakan bahasa field teknis menjadi bahasa user.**
6. **Tambahkan bagian eskalasi: kapan operator harus hubungi foreman/admin/IT.**
7. **Konsistenkan istilah: pilih salah satu antara “Start/Stop” atau “Check-in/Check-out”.**

### Bagus jika ditambahkan

1. Screenshot halaman utama.
2. Contoh kasus salah input.
3. Contoh tampilan notifikasi berhasil/gagal.
4. Flowchart sederhana operator.
5. Checklist satu halaman untuk ditempel di area kerja.

---

## Verdict akhir

**Substansi prosesnya sudah kuat**, terutama karena sudah mencakup alur operator, validasi, koreksi, SAP Reject, audit trail, dan troubleshooting.

Namun, untuk **WI end user dan DMS perusahaan**, dokumen ini masih perlu direstrukturisasi. Saat ini formatnya lebih mirip **gabungan WI + admin guide + technical specification**. Rekomendasi saya: **jangan langsung submit ke DMS dalam bentuk sekarang**. Pisahkan scope, sederhanakan bahasa, dan tambahkan kontrol dokumen formal terlebih dahulu.
