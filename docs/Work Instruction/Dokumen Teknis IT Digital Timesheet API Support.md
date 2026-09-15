---
tags: [domain/timesheet]
---

# Dokumen Teknis IT - Digital Timesheet API & Support

| Kontrol Dokumen | Keterangan |
|---|---|
| Nomor Dokumen | TECH-MPS2-TS-API-001 |
| Revisi | Rev. 00 |
| Tanggal Berlaku | TBD |
| Pemilik Dokumen | IT / MPS2 Technical Owner |
| Prepared By | TBD |
| Reviewed By | TBD |
| Approved By | TBD |

## 1. Tujuan

Menyediakan referensi teknis untuk support Digital Timesheet MPS2, termasuk endpoint API, field penting, status teknis, dan investigasi awal untuk issue login, checkout, validasi, SAP posting, dan SAP Reject.

Dokumen ini bukan WI end-user.

## 2. Ruang Lingkup

| Dibahas | Tidak Dibahas |
|---|---|
| API Timesheet utama | Instruksi operator detail |
| Field data penting | Validasi bisnis foreman detail |
| Status teknis record | Training end user |
| SAP Post Log teknis | Infrastruktur production secara lengkap |
| Troubleshooting teknis awal | Source code walkthrough lengkap |

## 3. Endpoint Timesheet Utama

| Endpoint | Fungsi |
|---|---|
| `GET /timesheet/getsn/:snkaryawan` | Ambil timesheet berdasarkan SN operator. |
| `GET /timesheet/getid/:id` | Ambil detail timesheet berdasarkan TS Number. |
| `POST /timesheet/` | Membuat productive/unproductive timesheet. |
| `PUT /timesheet/checkout` | Checkout timesheet terbuka berdasarkan operator. |
| `PUT /timesheet/checkout-unprod` | Checkout unproductive terbuka tanpa menghentikan productive. |
| `PUT /timesheet/checkoutid/` | Checkout timesheet berdasarkan TS Number. |
| `PUT /timesheet/validation` | Bulk validation timesheet. |
| `POST /timesheet/post-to-sap` | Posting timesheet tervalidasi ke SAP. |
| `PUT /timesheet/updateadmin/:id` | Koreksi admin/foreman. |
| `PATCH /timesheet/:tsnumber` | Update parsial field tambahan. |
| `GET /timesheet/validation-stats` | Summary validasi. |
| `GET /timesheet/validation-group/:serialnumber` | Detail group validasi per operator. |
| `GET /timesheet/getexcel` | Export Excel timesheet. |
| `GET /timesheet/log-sap` | Ambil SAP Post Log. |

## 4. Route UI Terkait

| Route | Fungsi |
|---|---|
| `/login-timesheet` | Login/scan operator dan pilih aksi. |
| `/timesheet-mainmenu` | Menu utama Timesheet Salvaging. |
| `/select-machine` | Pilih workcenter/machine. |
| `/select-job` | Pilih order/operation dari SOW Salvaging. |
| `/view-timesheet` | Lihat riwayat timesheet operator. |
| `/unproductive` | Pilih aktivitas unproductive. |
| `/timesheet-validation` | Validasi, SAP posting, dan export timesheet. |
| `/timesheet-edit/:tsnumber` | Koreksi record timesheet. |
| `/operator-performance` | Review performa operator/order/workcenter. |
| `/log-timesheet` | SAP Post Log. |
| `/nfc-users` | List user NFC. |
| `/create-edit-nfc` | Create/edit user NFC. |

## 5. Field Penting

| Field | Fungsi |
|---|---|
| `tsnumber` | Primary identifier transaksi timesheet. |
| `serialnumber` | SN operator. |
| `full_name` | Nama operator. |
| `order_no` | Production order. |
| `operation_no` | Operation number. |
| `operation_text` | Deskripsi operation atau unproductive. |
| `activitytype` | Kode unproductive/activity type jika ada. |
| `workcentercode` | Workcenter code. |
| `workcenterdescription` | Workcenter description. |
| `longdate_checkin` | Timestamp check-in. |
| `longdate_checkout` | Timestamp checkout. |
| `duration` | Durasi transaksi. |
| `note` | Catatan/keterangan. |
| `planhours` | Plan hours dari SOW jika tersedia. |
| `std_foreman_hours` | Jam standar foreman jika digunakan. |
| `state_flag` | Status teknis record. |
| `validation_date` | Waktu/tanggal validasi. |

## 6. Status Teknis

| Status Bisnis | Kondisi Teknis | Arti |
|---|---|---|
| Pending | `validation_date` kosong dan `state_flag` bukan `3`/`5`. | Belum divalidasi. |
| Validated | `validation_date` terisi dan `state_flag` bukan `5`. | Sudah divalidasi. |
| SAP Reject | `state_flag = 3`, `validation_date` dikosongkan. | Ditolak SAP atau gagal posting. |
| Deleted | `state_flag = 5`. | Tidak dihitung sebagai data valid. |

## 7. SAP Posting Teknis

Ringkasan alur:

1. User melakukan validasi dari halaman Timesheet Validation.
2. Frontend memanggil endpoint validasi.
3. Jika SAP toggle aktif, frontend memanggil endpoint posting SAP.
4. Backend membentuk data SAP.
5. Backend mengirim data ke SAP.
6. Hasil dicatat di SAP Post Log.
7. Jika SAP reject/error, record sumber diubah menjadi SAP Reject.

## 8. Investigasi Awal Issue

| Issue | Cek Awal |
|---|---|
| Login gagal | Cek `usernfc`, NFC ID, SN, koneksi API. |
| Productive tidak start | Cek session user, selected job, workcenter, payload create. |
| Stop gagal | Cek record terbuka berdasarkan SN dan checkout endpoint. |
| Unproductive overlap | Cek mode user: Single atau Multiple. |
| Validasi gagal | Cek checkout sudah terisi, status record, request body validasi. |
| SAP Reject | Cek SAP Post Log, order, operation, workcenter, activity type, PERNR/operator. |
| Export gagal | Cek periode/filter, jumlah data, response server. |

## 9. Activity Type Unproductive

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

## 10. Record Retention

Retensi data teknis mengikuti kebijakan database, backup, dan DMS perusahaan. Export manual dan SAP Post Log harus diperlakukan sebagai dokumen audit jika digunakan untuk rekonsiliasi.

## 11. Riwayat Revisi

| Revisi | Tanggal | Perubahan | Dibuat Oleh |
|---|---|---|---|
| 00 | TBD | Initial issue Dokumen Teknis IT Digital Timesheet API & Support. | TBD |

