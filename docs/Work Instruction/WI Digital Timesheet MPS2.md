---
tags: [domain/timesheet]
---

# WI Digital Timesheet MPS2 - Mode Salvaging

## 1. Tujuan

Memberikan panduan kerja standar untuk penggunaan fitur Digital Timesheet MPS2 khusus mode Salvaging, mulai dari login operator, pemilihan workcenter dan job, pencatatan waktu kerja, pencatatan unproductive, pengecekan riwayat, koreksi data, validasi foreman/admin, sampai monitoring SAP posting.

WI ini dibuat agar data man-hours Salvaging:

- tercatat sesuai operator, workcenter, order, dan operation aktual,
- memiliki check-in/check-out yang jelas,
- dapat ditelusuri melalui `tsnumber`,
- siap divalidasi foreman/admin,
- dapat dikoreksi tanpa menghilangkan audit trail,
- dapat dimonitor jika terjadi SAP Reject.

## 2. Ruang Lingkup

Dokumen ini hanya membahas fitur Timesheet untuk mode Salvaging.

| Area | Fitur yang Dibahas |
|---|---|
| Login operator | Scan NFC internal, input eksternal, session operator, dan pilihan aksi login. |
| Productive timesheet | Pilih workcenter, pilih job dari SOW Salvaging, start, stop, dan riwayat operator. |
| Mode kerja | Single mode dan Multiple mode. |
| Unproductive timesheet | Quick unproductive dan daftar kode unproductive Salvaging. |
| Review data | View Timesheet, koreksi record, status Pending/Validated/SAP Reject/Deleted. |
| Validasi | Filter, search, review per operator, validate row, validate group, dan export. |
| SAP monitoring | SAP posting dari validasi, SAP Reject, dan SAP Post Log. |
| Analisa | Operator Performance untuk review order, operation, workcenter, dan detail transaksi. |

Modul di luar Timesheet Salvaging dikelola pada WI/prosedur terpisah.

## 3. Peran dan Hak Akses

| Peran | Hak Akses di Timesheet Salvaging |
|---|---|
| Operator | Login/scan NFC, pilih workcenter, pilih job, start productive, stop timesheet, input unproductive, lihat riwayat timesheet sendiri, tambah note jika tersedia. |
| Foreman / Supervisor | Review data timesheet, validasi, koreksi record, tindak lanjut SAP Reject, review operator performance, export data untuk audit. |
| Admin / IT | Support akses, NFC user, konfigurasi pendukung, SAP Post Log, investigasi API/koneksi, support koreksi teknis. |
| PE / PPC | Menjaga data SOW/order/operation/workcenter agar bisa dipilih operator dengan benar. |

## 4. RACI

R = Responsible, A = Accountable, C = Consulted, I = Informed.

| Aktivitas | Operator | Foreman | Admin/IT | PE/PPC |
|---|---:|---:|---:|---:|
| Login dan scan operator | R | I | C | - |
| Pilih workcenter/machine | R | A | C | - |
| Pilih job/order/operation | R | A | I | C |
| Start/stop productive timesheet | R | A | I | - |
| Input unproductive | R | A | I | - |
| Review riwayat operator | R | C | I | - |
| Koreksi timesheet | C | R/A | C | C |
| Validasi timesheet | C | R/A | I | C |
| Tindak lanjut SAP Reject | C | R/A | R | C |
| Export timesheet | - | R | C | I |
| Maintain data SOW/order | I | C | I | R/A |

## 5. Alur Utama Operator

Alur operator Salvaging menggunakan urutan berikut.

| Urutan | Halaman | Tujuan |
|---:|---|---|
| 1 | `/login-timesheet` | Login operator dan pilih aksi. |
| 2 | `/timesheet-mainmenu` | Melihat data operator, mode, workcenter, job, dan tombol aksi. |
| 3 | `/select-machine` | Memilih workcenter/machine. |
| 4 | `/select-job` | Memilih order dan operation dari SOW. |
| 5 | `/timesheet-mainmenu` | Start productive atau kembali memilih data yang belum benar. |
| 6 | `/login-timesheet` atau `/view-timesheet` | Stop timesheet saat pekerjaan selesai. |

## 6. Persiapan Sebelum Input Timesheet

Sebelum operator membuat timesheet, pastikan:

| Pengecekan | Standar |
|---|---|
| Perangkat | Tablet/PC terhubung jaringan dan dapat membuka MPS2. |
| Operator | NFC/user sudah terdaftar dan memiliki `snssb`, nama, dan workcenter. |
| Workcenter | Workcenter/machine sesuai tempat kerja aktual. |
| Job | Order dan operation tersedia di SOW. |
| Mode | Operator memahami apakah sedang memakai Single atau Multiple mode. |
| Browser | Jika Web NFC tidak tersedia, gunakan mode Eksternal. |

## 7. Login Timesheet

Halaman: `/login-timesheet`

### 7.1 Mode Scan

| Mode Scan | Dipakai Saat | Cara Pakai |
|---|---|---|
| Internal | Tablet/browser mendukung Web NFC. | Pilih Internal, dekatkan kartu NFC. |
| Eksternal | Web NFC tidak tersedia atau memakai reader eksternal. | Pilih Eksternal, scan/input ID, tekan Enter. |

### 7.2 Aksi Login

| Aksi | Fungsi | Hasil |
|---|---|---|
| Productive | Masuk ke menu productive timesheet. | Sistem membuka `/timesheet-mainmenu`. |
| Stop Timesheet | Mengakhiri timesheet terbuka operator. | Sistem melakukan checkout untuk timesheet operator. |
| Unproductive | Mencatat aktivitas non-produktif. | Sistem membuka `/unproductive` atau membuat quick unproductive. |
| Tools & Consumable | Membuka request tools/consumable. | Sistem membuka halaman request terkait, bukan bagian inti WI ini. |

### 7.3 Ketentuan Login

1. Operator wajib menggunakan NFC/user miliknya sendiri.
2. Jika login gagal, ulangi scan/input dan cek koneksi.
3. Jika diarahkan kembali ke login, session dianggap belum aktif atau sudah hilang.
4. Setelah login Productive, sistem memuat aktivitas productive terakhir jika masih valid.

## 8. Timesheet Main Menu Salvaging

Halaman: `/timesheet-mainmenu`

Menu ini adalah pusat kerja operator Salvaging.

| Area Tampilan | Yang Harus Dicek |
|---|---|
| Operator | Nama dan SN operator benar. |
| Mode | Single/Multiple sesuai kebutuhan kerja. |
| Workcenter/Machine | Sesuai area kerja aktual. |
| Order | Production order benar. |
| Operation | Operation text dan sequence benar. |
| Part Name / Ident | Sesuai job yang dikerjakan jika tersedia. |

Tombol utama:

| Tombol | Fungsi |
|---|---|
| Select Machine | Memilih workcenter/machine. |
| Select Job | Memilih order/operation dari SOW. |
| Start / Play | Membuat record productive timesheet. |
| View Timesheet | Melihat riwayat timesheet operator. |
| Refresh | Memuat ulang tampilan/session. |

## 9. Pilih Workcenter / Machine

Halaman: `/select-machine`

1. Dari Timesheet Main Menu, klik `Select Machine`.
2. Pilih workcenter/machine yang sesuai pekerjaan.
3. Pastikan workcenter muncul di Timesheet Main Menu.
4. Jika workcenter salah, ulangi pemilihan sebelum start timesheet.

Ketentuan:

- Workcenter digunakan dalam record timesheet dan payload SAP.
- Workcenter yang salah harus dikoreksi sebelum validasi/posting.
- Operator tidak boleh start pekerjaan jika workcenter belum sesuai.

## 10. Pilih Job Salvaging

Halaman: `/select-job`

### 10.1 Cara Pilih Job

1. Masukkan nomor order pada kolom search.
2. Klik `Search`, atau gunakan tombol `Barcode` untuk scan order.
3. Sistem mengambil data order/operation dari SOW.
4. Pilih row job yang sesuai.
5. Sistem menyimpan job ke session dan kembali ke `/timesheet-mainmenu`.
6. Cek kembali order dan operation di Timesheet Main Menu.

### 10.2 Data Job yang Disimpan

| Data | Keterangan |
|---|---|
| `order` / `order_no` | Production order yang dipilih. |
| `operation_no` | Sequence/operation number. |
| `operationtext` | Deskripsi operation. |
| `part_name` | Nama part jika tersedia. |
| `ssbr_id` | Identifikasi tambahan dari SOW jika tersedia. |
| `workcenter` | Workcenter dari job/SOW. |
| `planhours` | Jam rencana job. |
| `remaining_seconds_before` | Sisa jam sebelum start, jika tersedia. |

### 10.3 Peringatan Job Kehabisan Jam

Jika plan hours tersedia dan sisa jam tidak tersedia/habis, sistem memberi peringatan `JOB KEHABISAN JAM`.

| Kondisi | Tindakan Operator | Tindakan Foreman |
|---|---|---|
| Sisa jam masih ada | Lanjut sesuai prosedur normal. | Monitor saat validasi. |
| Sisa jam habis | Jangan lanjut tanpa konfirmasi. | Cek actual vs plan, putuskan apakah pekerjaan boleh dilanjutkan. |
| Plan hours kosong | Lanjut jika job benar, tetapi informasikan jika data plan perlu dilengkapi. | Koordinasi dengan PE/PPC untuk perbaikan SOW. |

## 11. Start Productive Timesheet

Start dilakukan dari `/timesheet-mainmenu`.

Sebelum klik start, operator wajib memastikan:

| Cek | Harus Benar |
|---|---|
| Operator | Nama dan SN sesuai kartu/user. |
| Mode | Single/Multiple sesuai kondisi kerja. |
| Workcenter | Sesuai area aktual. |
| Order | Sesuai pekerjaan. |
| Operation | Sesuai aktivitas aktual. |
| Part/Ident | Sesuai job jika ditampilkan. |

Langkah:

1. Pastikan data di Timesheet Main Menu benar.
2. Klik tombol Start/Play.
3. Sistem membuat record timesheet baru.
4. Sistem mencatat waktu check-in.
5. Jika mode Single aktif, sistem checkout aktivitas sebelumnya sebelum membuat record baru.
6. Setelah berhasil, operator dapat kembali ke login atau melanjutkan pekerjaan sesuai flow tablet.

## 12. Stop / Checkout Timesheet

Timesheet dapat dihentikan melalui:

| Cara Stop | Halaman | Kapan Dipakai |
|---|---|---|
| Stop Timesheet dari login | `/login-timesheet` | Cara utama saat operator selesai bekerja. |
| Stop by record | `/view-timesheet` | Saat perlu menghentikan record tertentu berdasarkan `tsnumber`. |

Langkah stop dari login:

1. Buka `/login-timesheet`.
2. Pilih aksi `Stop Timesheet`.
3. Scan/input ID operator.
4. Sistem checkout timesheet terbuka milik operator.
5. Pastikan muncul notifikasi berhasil.

Data check-out yang diisi sistem:

| Field | Isi |
|---|---|
| `longdate_checkout` | Timestamp checkout. |
| `date_checkout` | Tanggal checkout. |
| `hour_checkout` | Jam checkout. |
| `duration` | Durasi dari check-in sampai check-out. |

## 13. Mode Single dan Multiple

Mode ini mempengaruhi cara sistem menutup aktivitas lama saat aktivitas baru dibuat.

| Mode | Aturan | Contoh Pemakaian |
|---|---|---|
| Single | Hanya satu aktivitas berjalan. Saat membuat aktivitas baru, aktivitas lama di-checkout. | Operator fokus pada satu pekerjaan atau satu unproductive. |
| Multiple | Productive dapat tetap berjalan saat mencatat unproductive tertentu. Saat membuat unproductive, hanya unproductive lama yang di-checkout. | Operator tetap memiliki pekerjaan productive berjalan tetapi perlu mencatat break/briefing/housekeeping. |

Ketentuan:

- Mode disimpan pada data user NFC.
- Jika update mode gagal, sistem kembali memakai mode sebelumnya.
- Foreman wajib memahami mode operator saat review duration.

## 14. Unproductive Timesheet

Halaman: `/unproductive`

### 14.1 Cara Input Unproductive

1. Dari `/login-timesheet`, pilih aksi `Unproductive`.
2. Scan/input ID operator.
3. Sistem membuka `/unproductive`.
4. Pilih kode aktivitas non-produktif.
5. Sistem membuat record unproductive.
6. Sistem kembali ke login.

### 14.2 Quick Unproductive dari Login

Beberapa unproductive dapat dibuat langsung dari login melalui quick mode:

| Quick Mode | Kode | Aktivitas |
|---|---:|---|
| Briefing | 1510 | BRIEFING |
| Break | 1520 | COFFEE BREAKS |
| Housekeeping | 1530 | HOUSEKEEPING |

### 14.3 Daftar Kode Unproductive

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

### 14.4 Dampak Mode terhadap Unproductive

| Mode | Saat Unproductive Dibuat |
|---|---|
| Single | Productive dan unproductive terbuka sebelumnya di-checkout, lalu unproductive baru dibuat. |
| Multiple | Hanya unproductive lama yang di-checkout; productive tetap berjalan. |

## 15. View Timesheet Operator

Halaman: `/view-timesheet`

Fungsi halaman:

| Fungsi | Keterangan |
|---|---|
| Lihat riwayat | Menampilkan record timesheet operator berdasarkan SN. |
| Lihat running | Menampilkan aktivitas yang belum checkout. |
| Stop record | Checkout record tertentu berdasarkan `tsnumber`. |
| Restart productive | Membuat ulang productive dari data record tertentu jika masih valid. |
| Note | Menambah/mengubah catatan jika tersedia di UI. |

Ketentuan:

- Operator mengecek riwayat jika ragu apakah timesheet sudah stop.
- Record yang tidak memiliki order/operation harus ditindaklanjuti sebelum validasi.
- Foreman dapat menggunakan halaman ini untuk investigasi awal sebelum koreksi admin.

## 16. Koreksi Timesheet

Halaman: `/timesheet-edit/:tsnumber`

Koreksi dilakukan oleh foreman/admin, bukan operator umum.

### 16.1 Kondisi yang Memerlukan Koreksi

| Kondisi | Contoh |
|---|---|
| Workcenter salah | Operator start dengan workcenter lama. |
| Order/operation salah | Operator memilih job yang tidak sesuai pekerjaan aktual. |
| Waktu salah | Check-in/check-out perlu disesuaikan. |
| Duration tidak normal | Terlalu besar, nol, atau tidak sesuai shift. |
| SAP Reject | SAP menolak payload karena data master/mapping salah. |
| Note kurang | Perlu alasan koreksi atau kondisi abnormal. |

### 16.2 Field Koreksi

| Field | Ketentuan |
|---|---|
| Operator / SN | Koreksi hanya jika benar-benar salah identitas. |
| Order | Harus sesuai pekerjaan aktual. |
| Operation | Harus sesuai operation aktual. |
| Workcenter | Pilih dari daftar workcenter valid. |
| Check-in | Wajib terisi. |
| Check-out | Wajib terisi untuk validasi. |
| Note | Isi alasan koreksi bila ada perubahan penting. |
| `std_foreman_hours` | Diisi jika digunakan dalam proses review foreman. |
| `planhours` | Dilengkapi jika perlu untuk review plan vs actual. |

### 16.3 Aturan Koreksi

1. Check-in date/time wajib terisi.
2. Check-out date/time wajib terisi.
3. Workcenter wajib dipilih.
4. Duration dihitung ulang dari check-in dan check-out.
5. Jika duration = 0, record ditandai Deleted (`state_flag = 5`).
6. SAP Reject (`state_flag = 3`) dikoreksi lalu divalidasi/posting ulang.
7. Jangan menghapus record untuk koreksi operasional; gunakan status/koreksi agar audit trail tetap ada.

## 17. Validasi Timesheet

Halaman: `/timesheet-validation`

Validasi dilakukan oleh foreman/supervisor/admin setelah record sudah checkout dan datanya benar.

### 17.1 Fitur Halaman Validasi

| Fitur | Fungsi |
|---|---|
| Filter tanggal | Membatasi periode data. |
| Search | Mencari operator/order/operation tertentu. |
| Summary card | Melihat total Pending, SAP Reject, Validated. |
| Group operator | Review data per operator. |
| Expand detail | Melihat detail record dalam group. |
| Validate row | Validasi satu record. |
| Validate group | Validasi semua pending dalam satu group. |
| SAP toggle | Mengaktifkan/nonaktifkan posting SAP setelah validasi. |
| Download Excel | Export data sesuai filter. |
| SAP Log | Shortcut ke `/log-timesheet`. |
| Performance | Shortcut ke `/operator-performance`. |

### 17.2 Status Validasi

| Status | Kondisi Sistem | Tindakan |
|---|---|---|
| Pending | `validation_date` kosong dan `state_flag` bukan `3`/`5`. | Review dan validasi jika benar. |
| Validated | `validation_date` terisi dan `state_flag` bukan `5`. | Monitor atau lanjut SAP posting. |
| SAP Reject | `state_flag = 3` dan `validation_date` dikosongkan. | Koreksi record, lalu validasi/posting ulang. |
| Deleted | `state_flag = 5`. | Tidak dihitung sebagai data valid. |

### 17.3 Checklist Sebelum Validasi

Foreman/admin wajib mengecek:

| Data | Standar |
|---|---|
| Operator | Nama dan SN benar. |
| Order | Sesuai pekerjaan aktual. |
| Operation | Sesuai operation aktual. |
| Workcenter | Sesuai tempat kerja aktual. |
| Check-in/check-out | Lengkap dan masuk akal. |
| Duration | Tidak nol, negatif, atau abnormal tanpa alasan. |
| Unproductive | Kode sesuai kondisi aktual. |
| Note | Terisi jika ada koreksi/abnormalitas. |
| SAP Reject | Sudah dikoreksi sebelum validasi ulang. |

### 17.4 Langkah Validasi

1. Buka `/timesheet-validation`.
2. Pilih tanggal start dan end.
3. Gunakan search/status filter jika perlu.
4. Expand group operator.
5. Review detail record.
6. Jika data benar, klik validate row atau validate group.
7. Jika SAP toggle aktif, sistem posting ke SAP setelah validasi.
8. Jika SAP Reject muncul, lakukan koreksi sebelum posting ulang.

## 18. SAP Posting dan SAP Reject

SAP posting dipicu dari halaman validasi jika SAP toggle aktif.

### 18.1 Hasil Posting

| Hasil SAP | Dampak di Timesheet | Tindakan |
|---|---|---|
| Success / Accepted | Record tetap Validated. | Tidak perlu koreksi. |
| Reject | `state_flag` menjadi `3`, `validation_date` dikosongkan. | Baca pesan SAP, koreksi, validasi/posting ulang. |
| Network/API Error | Diperlakukan sebagai SAP Reject. | Cek koneksi/API, ulangi setelah stabil. |

### 18.2 Penyebab Umum SAP Reject

| Penyebab | Contoh Tindakan |
|---|---|
| Order salah | Koreksi order sesuai SOW/SAP. |
| Operation salah | Koreksi operation number. |
| Workcenter salah | Pilih workcenter valid. |
| Activity type salah/kosong | Koreksi unproductive/productive mapping. |
| Employee/PERNR bermasalah | Cek data user NFC/operator. |
| Tanggal/jam tidak valid | Koreksi check-in/check-out. |

## 19. SAP Post Log

Halaman: `/log-timesheet`

SAP Post Log dipakai untuk melihat hasil komunikasi timesheet ke SAP.

| Kolom | Keterangan |
|---|---|
| Status | Indikator success/error. |
| TS ID | ID timesheet/log SAP. |
| Employee | PERNR dan nama operator. |
| Order | Production order dan confirmation data. |
| Operation | Operation number. |
| Type | Confirmation type. |
| Work Center | Workcenter SAP. |
| Activity | Activity type. |
| Start | Tanggal dan jam mulai. |
| End | Tanggal dan jam selesai. |
| Plant | Plant code. |
| SAP Response | Pesan dari SAP. |
| Posted At | Waktu posting/log dibuat. |

Jika `SAP Response` diawali `ERROR`, foreman/admin wajib menelusuri record sumber dan melakukan koreksi.

## 20. Export dan Operator Performance

### 20.1 Export Timesheet

Export dilakukan dari `/timesheet-validation`.

1. Pilih periode start dan end.
2. Pilih status/search jika perlu.
3. Klik Download Excel.
4. Simpan file untuk audit atau rekonsiliasi.

Export dipakai untuk:

- audit foreman,
- review man-hours,
- rekonsiliasi SAP Reject,
- analisa data abnormal.

### 20.2 Operator Performance

Halaman: `/operator-performance`

Fungsi:

| Fungsi | Keterangan |
|---|---|
| Review per order | Melihat akumulasi jam per order. |
| Filter workcenter | Fokus pada area kerja tertentu. |
| Filter tanggal | Membatasi periode analisa. |
| Drill-down operation | Melihat detail operation dalam order. |
| Detail timesheet | Menelusuri transaksi sumber. |

## 21. Data Minimum dan Audit Trail

### 21.1 Productive Timesheet

| Field | Keterangan |
|---|---|
| `tsnumber` | ID transaksi timesheet. |
| `serialnumber` | SN operator. |
| `full_name` | Nama operator. |
| `order_no` | Production order. |
| `operation_no` | Operation number. |
| `operation_text` | Deskripsi operation. |
| `workcentercode` | Kode workcenter. |
| `workcenterdescription` | Deskripsi workcenter. |
| `longdate_checkin` | Timestamp check-in. |
| `longdate_checkout` | Timestamp check-out. |
| `duration` | Durasi jam kerja. |
| `planhours` | Jam rencana jika tersedia. |
| `note` | Catatan/keterangan jika ada. |
| `state_flag` | Status teknis record. |
| `validation_date` | Tanggal validasi. |

### 21.2 Unproductive Timesheet

| Field | Keterangan |
|---|---|
| `tsnumber` | ID transaksi timesheet. |
| `serialnumber` | SN operator. |
| `full_name` | Nama operator. |
| `activitytype` / `id_unprod` | Kode unproductive. |
| `operation_text` | Nama aktivitas unproductive. |
| `workcentercode` | Kode workcenter. |
| `longdate_checkin` | Timestamp mulai. |
| `longdate_checkout` | Timestamp selesai. |
| `duration` | Durasi aktivitas. |
| `state_flag` | Status teknis record. |
| `validation_date` | Tanggal validasi. |

### 21.3 Aturan Audit Trail

- Jangan menghapus record untuk koreksi operasional.
- Gunakan koreksi terotorisasi dan isi note jika ada perubahan penting.
- Record duration = 0 ditandai Deleted (`state_flag = 5`).
- SAP Reject tetap harus bisa ditelusuri dari `tsnumber` dan SAP Post Log.

## 22. Troubleshooting

| Gejala | Kemungkinan Penyebab | Tindakan | Owner |
|---|---|---|---|
| Tidak bisa login | NFC/user tidak dikenal, koneksi API bermasalah | Cek NFC/input ID, koneksi, dan data user NFC | Operator/Admin |
| Web NFC tidak jalan | Browser/device tidak mendukung atau izin NFC ditolak | Gunakan mode Eksternal atau device yang mendukung | Operator/IT |
| Data operator salah | User NFC belum update | Update data user NFC | Admin |
| Workcenter salah | Operator belum pilih machine/workcenter terbaru | Pilih ulang di `/select-machine` | Operator |
| Job tidak muncul | Order tidak ada di SOW atau search salah | Cek nomor order, SOW, dan data PE/PPC | Operator/Foreman/PE |
| Job kehabisan jam | Remaining hours habis | Koordinasi foreman sebelum lanjut | Operator/Foreman |
| Timesheet tidak start | Session/job/workcenter belum lengkap | Re-login, pilih workcenter dan job ulang | Operator |
| Timesheet belum checkout | Operator lupa stop atau koneksi terputus | Stop dari login atau `/view-timesheet` | Operator/Foreman |
| Duration abnormal | Check-in/out salah atau lupa stop | Koreksi melalui `/timesheet-edit/:tsnumber` | Foreman/Admin |
| SAP Reject | Data order/operation/workcenter/activity/operator tidak match | Baca SAP Response, koreksi, validasi ulang | Foreman/Admin/IT |
| Export kosong | Filter tanggal/status salah | Cek filter dan ulangi export | Foreman/Admin |

## 23. Lampiran

### 23.1 Route UI Salvaging Timesheet

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

### 23.2 API Timesheet Utama

| Endpoint | Fungsi |
|---|---|
| `GET /timesheet/getsn/:snkaryawan` | Ambil timesheet berdasarkan SN operator. |
| `GET /timesheet/getid/:id` | Ambil detail timesheet berdasarkan `tsnumber`. |
| `POST /timesheet/` | Membuat productive/unproductive timesheet. |
| `PUT /timesheet/checkout` | Checkout timesheet terbuka berdasarkan operator. |
| `PUT /timesheet/checkout-unprod` | Checkout unproductive terbuka tanpa menghentikan productive. |
| `PUT /timesheet/checkoutid/` | Checkout timesheet berdasarkan `tsnumber`. |
| `PUT /timesheet/validation` | Bulk validation timesheet. |
| `POST /timesheet/post-to-sap` | Posting timesheet tervalidasi ke SAP. |
| `PUT /timesheet/updateadmin/:id` | Koreksi admin/foreman. |
| `PATCH /timesheet/:tsnumber` | Update parsial field tambahan. |
| `GET /timesheet/validation-stats` | Summary validasi. |
| `GET /timesheet/validation-group/:serialnumber` | Detail group validasi per operator. |
| `GET /timesheet/getexcel` | Export Excel timesheet. |
| `GET /timesheet/log-sap` | Ambil SAP Post Log. |

### 23.3 Checklist Harian Operator

| Checklist | OK |
|---|---|
| Login memakai NFC/user sendiri. |  |
| Workcenter sudah benar. |  |
| Order sudah benar. |  |
| Operation sudah benar. |  |
| Mode Single/Multiple sudah sesuai. |  |
| Timesheet sudah stop saat pekerjaan selesai. |  |
| Unproductive dicatat dengan kode yang sesuai. |  |

### 23.4 Checklist Validasi Foreman/Admin

| Checklist | OK |
|---|---|
| Periode filter sudah benar. |  |
| Operator dan SN benar. |  |
| Order dan operation benar. |  |
| Workcenter benar. |  |
| Check-in/check-out lengkap. |  |
| Duration masuk akal. |  |
| Unproductive memakai kode yang sesuai. |  |
| SAP Reject sudah dikoreksi sebelum validasi ulang. |  |
| Export dilakukan jika dibutuhkan untuk audit. |  |
