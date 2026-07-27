---
tags: [domain/timesheet]
---

# WI Foreman Admin - Validasi Timesheet Salvaging

| Kontrol Dokumen | Keterangan |
|---|---|
| Nomor Dokumen | WI-MPS2-TS-SALVAGING-VAL-001 |
| Revisi | Rev. 00 |
| Tanggal Berlaku | TBD |
| Pemilik Dokumen | Production / MPS2 Process Owner |
| Prepared By | TBD |
| Reviewed By | TBD |
| Approved By | TBD |

## 1. Tujuan

Memberikan panduan bagi foreman, supervisor, admin, dan fungsi support terkait untuk review, koreksi, validasi, export, monitoring SAP posting, dan tindak lanjut SAP Reject pada Timesheet MPS2 mode Salvaging.

## 2. Ruang Lingkup

| Dibahas | Tidak Dibahas |
|---|---|
| Review data timesheet operator | Cara operator start/stop detail |
| Koreksi timesheet | API teknis |
| Validasi row/group | Database field detail |
| SAP posting dari halaman validasi | Konfigurasi SAP interface |
| SAP Reject handling | Manufacturing mode |
| SAP Post Log | Machine Hours |
| Export dan Operator Performance | Infrastruktur server |

## 3. Definisi

| Istilah | Arti |
|---|---|
| Pending | Timesheet belum divalidasi. |
| Validated | Timesheet sudah disetujui foreman/admin. |
| SAP Reject | Data ditolak SAP dan harus dikoreksi sebelum dikirim ulang. |
| Deleted | Data tidak dihitung sebagai timesheet valid. |
| TS Number | Nomor transaksi timesheet untuk penelusuran record. |

## 4. Tanggung Jawab

| Peran | Tanggung Jawab |
|---|---|
| Foreman/Supervisor | Review kebenaran data, validasi, meminta koreksi, dan memastikan abnormalitas ditindaklanjuti. |
| Admin | Membantu koreksi data, monitor SAP Post Log, export data, dan support issue sistem. |
| IT Support | Menangani gangguan koneksi, API, akses, dan investigasi teknis. |
| PE/PPC | Membantu jika data SOW/order/operation/workcenter tidak sesuai. |

## 5. Review Data Timesheet

Halaman: **Timesheet Validation**

Langkah:

1. Buka halaman Timesheet Validation.
2. Pilih periode tanggal.
3. Gunakan search atau filter status jika diperlukan.
4. Expand group operator.
5. Review detail record sebelum validasi.

Checklist review:

| Data | Standar Review |
|---|---|
| Operator | Nama dan SN sesuai orang yang bekerja. |
| Order | Sesuai pekerjaan aktual. |
| Operation | Sesuai aktivitas aktual. |
| Workcenter | Sesuai area kerja aktual. |
| Waktu mulai | Masuk akal terhadap shift/pekerjaan. |
| Waktu selesai | Sudah terisi sebelum validasi. |
| Durasi | Tidak nol, negatif, atau abnormal tanpa alasan. |
| Unproductive | Kode sesuai kondisi aktual. |
| Note | Terisi untuk koreksi atau kejadian abnormal. |

## 6. Koreksi Timesheet

Halaman: **Edit Timesheet**

Koreksi dilakukan jika ditemukan data salah atau abnormal.

| Kondisi | Tindakan |
|---|---|
| Workcenter salah | Pilih workcenter yang benar. |
| Order salah | Koreksi order sesuai pekerjaan aktual. |
| Operation salah | Koreksi operation sesuai pekerjaan aktual. |
| Waktu salah | Koreksi waktu mulai/selesai sesuai bukti kerja. |
| Durasi 0 | Data tidak dihitung sebagai timesheet valid. |
| SAP Reject | Baca pesan SAP, koreksi data sumber, lalu validasi ulang. |

Ketentuan:

1. Koreksi harus berdasarkan informasi yang bisa dipertanggungjawabkan.
2. Isi note jika perubahan memerlukan alasan.
3. Jangan menghapus record untuk koreksi operasional.
4. Setelah koreksi, lakukan validasi ulang jika data sudah benar.

## 7. Validasi Timesheet

Status yang digunakan:

| Status | Arti | Tindakan |
|---|---|---|
| Pending | Belum divalidasi. | Review sebelum approve. |
| Validated | Sudah disetujui. | Siap untuk proses berikutnya. |
| SAP Reject | Ditolak SAP. | Koreksi dan validasi ulang. |
| Deleted | Tidak dihitung sebagai valid. | Tidak perlu dikirim sebagai jam kerja valid. |

Langkah validasi:

1. Review detail data.
2. Jika satu record benar, klik validate pada record tersebut.
3. Jika semua record dalam group benar, gunakan validate group.
4. Jika SAP toggle aktif, sistem akan mengirim data ke SAP setelah validasi.
5. Cek notifikasi hasil validasi dan SAP posting.

## 8. SAP Posting

SAP posting terjadi dari halaman validasi jika toggle SAP aktif.

| Hasil | Arti | Tindakan |
|---|---|---|
| Success | Data diterima SAP. | Tidak perlu tindak lanjut. |
| Reject | Data ditolak SAP. | Baca pesan, koreksi, validasi ulang. |
| Error koneksi/sistem | Pengiriman gagal. | Cek status sistem atau hubungi IT Support. |

Bahasa pengguna yang dipakai:

- Gunakan istilah **data dikirim ke SAP**, bukan payload.
- Gunakan istilah **status SAP Reject**, bukan kode teknis status.

## 9. SAP Reject Handling

Langkah tindak lanjut:

1. Buka Timesheet Validation dan filter status SAP Reject.
2. Buka detail record.
3. Baca informasi error dari SAP atau SAP Post Log.
4. Koreksi data sumber melalui Edit Timesheet.
5. Simpan koreksi.
6. Validasi ulang.
7. Pastikan hasil SAP berikutnya success.

Penyebab umum:

| Penyebab | Tindakan |
|---|---|
| Order tidak sesuai | Cek SOW/SAP, koreksi order. |
| Operation tidak sesuai | Koreksi operation. |
| Workcenter tidak sesuai | Pilih workcenter valid. |
| Data operator bermasalah | Cek master user/NFC. |
| Waktu tidak valid | Koreksi waktu mulai/selesai. |
| Activity type tidak sesuai | Koreksi jenis productive/unproductive. |

## 10. SAP Post Log

Halaman: **SAP Post Log**

Dipakai untuk melihat riwayat pengiriman data timesheet ke SAP.

| Kolom | Keterangan |
|---|---|
| Status | Success atau error. |
| TS ID | ID transaksi/log SAP. |
| Employee | Operator/PERNR. |
| Order | Order yang dikirim. |
| Operation | Operation yang dikirim. |
| Work Center | Workcenter yang dikirim. |
| Activity | Activity type. |
| Start/End | Waktu mulai dan selesai. |
| SAP Response | Pesan balikan dari SAP. |
| Posted At | Waktu pengiriman/log dibuat. |

Jika SAP Response berisi error, gunakan informasi tersebut untuk koreksi data.

## 11. Export Timesheet

Export dilakukan dari halaman Timesheet Validation.

1. Pilih periode tanggal.
2. Pilih filter status/search jika perlu.
3. Klik Download Excel.
4. Gunakan file export untuk audit atau rekonsiliasi.

## 12. Operator Performance

Halaman Operator Performance digunakan untuk:

- review jam per order,
- review jam per workcenter,
- drill-down operation,
- cek detail transaksi sumber,
- identifikasi durasi abnormal.

## 13. Eskalasi

| Kondisi | Eskalasi |
|---|---|
| Data operator salah | Admin NFC / IT Support |
| Order/operation tidak ada | PE/PPC |
| SAP Reject berulang | Admin / IT Support / PE-PPC sesuai penyebab |
| Sistem tidak bisa validasi | IT Support |
| Durasi abnormal tanpa penjelasan | Foreman/Supervisor ke operator terkait |

## 14. Checklist Validasi

| Checklist | Ya/Tidak |
|---|---|
| Periode filter sudah benar. |  |
| Data operator benar. |  |
| Order dan operation benar. |  |
| Workcenter benar. |  |
| Waktu mulai dan selesai lengkap. |  |
| Durasi masuk akal. |  |
| Unproductive memakai kode yang tepat. |  |
| Note tersedia untuk kejadian abnormal. |  |
| SAP Reject sudah ditindaklanjuti. |  |
| Export dibuat jika diperlukan audit. |  |

## 15. Training Requirement

Foreman/admin wajib memahami:

- alur operator,
- status validasi,
- cara koreksi data,
- cara membaca SAP Reject,
- cara export,
- kapan harus eskalasi ke IT atau PE/PPC.

## 16. Record Retention

Data validasi dan log tersimpan di sistem MPS2. Export Excel disimpan sesuai kebijakan retensi dokumen perusahaan.

## 17. Riwayat Revisi

| Revisi | Tanggal | Perubahan | Dibuat Oleh |
|---|---|---|---|
| 00 | TBD | Initial issue WI Foreman/Admin Validasi Timesheet Salvaging. | TBD |

