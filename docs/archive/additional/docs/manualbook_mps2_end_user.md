# MANUAL BOOK END USER MPS2

Dokumen ini menjelaskan penggunaan aplikasi MPS2 dari sisi UI untuk halaman di `react-timesheet/src/pages`.

Versi: 1.0

Tanggal: 11 Mei 2026

## Cara Menggunakan Manual Ini

- Setiap modul berisi tujuan halaman, cara akses, langkah penggunaan, dan catatan penting.
- Bagian "Tempat Screenshot" sengaja disediakan agar gambar UI aktual dapat disisipkan setelah aplikasi dibuka di server.
- Gunakan screenshot dari environment produksi atau staging yang digunakan end user.
- Jika tampilan berbeda karena role user, sisipkan screenshot sesuai role yang bersangkutan.

[TEMPAT SCREENSHOT: Halaman utama atau cover aplikasi MPS2]

## Ringkasan Aplikasi

MPS2 adalah aplikasi operasional manufaktur untuk memantau order, mengelola SOW, membuat dan memvalidasi timesheet, melihat machine hours, melakukan scheduling pekerjaan ke mesin, mengelola consumable dan tools, serta mendukung proses receiving dan shipping.

Modul utama:

- Welcome dan login.
- Operations Hub.
- Dashboard dan MPS Dashboard.
- Timesheet operator dan validasi timesheet.
- SOW Management.
- SOW Scheduling.
- Component Tracking.
- Receiving and Shipping.
- Machine Hours.
- Consumable Request dan Consumable Control.
- Tools Request dan Tools Management.
- User dan NFC User Management.
- Export dan Settings.

## Hak Akses Umum

- Operator: login timesheet, pilih mesin, pilih job, mulai pekerjaan, stop pekerjaan, tambah note, request consumable atau tools.
- Foreman atau supervisor: validasi timesheet, review process control, approve/reject consumable, review machine hours, approve overtime sesuai hak akses.
- Admin: akses Operations Hub, user management, tools management, konfigurasi, dan halaman protected lain.
- Warehouse: memproses consumable ticket, adjustment quantity, approve/reject item, dan kontrol request.
- PE/PPC: mengelola SOW, revisi SOW, scheduling, component tracking, buffer, receiving, dan shipping.

Catatan: nama role mengikuti konfigurasi user pada aplikasi. Jika tombol tidak muncul, kemungkinan user belum memiliki role yang sesuai.

## Alur Navigasi Utama

- Buka aplikasi dari browser.
- Pilih akses di halaman Welcome.
- Login sesuai user.
- Setelah login admin, masuk ke Operations Hub.
- Gunakan panel kiri Operations Hub untuk membuka Dashboard, SOW Management, SOW Scheduling, Component Tracking, Receiving and Shipping, Consumable Control, Tools Management, Manage User, Validation, dan Machine Hours.
- Gunakan tombol Back di header halaman untuk kembali ke halaman sebelumnya atau ke Operations Hub.

[TEMPAT SCREENSHOT: Welcome page dan pilihan akses]

## Welcome Page

Tujuan:

- Menjadi pintu masuk aplikasi untuk operator dan user admin.
- Menampilkan pilihan akses ke area timesheet atau area management.

Langkah penggunaan:

- Buka URL aplikasi.
- Pilih jenis akses yang diperlukan.
- Untuk akses admin atau protected page, masukkan username dan password pada panel Login.
- Setelah berhasil, aplikasi akan mengarahkan user ke Operations Hub atau halaman terkait.

Catatan:

- Jika user diarahkan kembali ke halaman login, sesi login mungkin belum aktif atau sudah logout.
- Login admin saat ini diarahkan ke login baru, bukan password hardcoded lama.

[TEMPAT SCREENSHOT: Panel login Welcome Page]

## Operations Hub

Tujuan:

- Menjadi dashboard utama dan pusat navigasi MPS2.
- Menampilkan ringkasan active orders, overdue orders, latest labor hours, machine productive, order progress, machine activity, validation queue, order summary, machine status, dan recent activity.

Cara akses:

- Route: `/operations-hub` atau `/LandingPage`.
- Dari Welcome setelah login admin.

Langkah penggunaan:

- Baca KPI utama pada bagian atas halaman.
- Gunakan sidebar kiri untuk berpindah modul.
- Klik Open pada Validation Queue untuk menuju validasi timesheet.
- Klik View pada panel Orders untuk melihat daftar order progress.
- Gunakan tombol SAP untuk membuka link SAP sesuai environment.
- Gunakan switch PH3/QH3 untuk memilih environment SAP.
- Klik ikon Settings di kanan atas untuk ubah password.
- Klik Lock untuk logout atau mengunci sesi.

Catatan:

- Status Live berarti data berhasil dimuat dari API.
- Status Offline berarti aplikasi gagal memuat data dashboard.
- Beberapa widget dapat diklik untuk membuka detail atau history.

[TEMPAT SCREENSHOT: Operations Hub lengkap dengan sidebar kiri]

## Ubah Password

Tujuan:

- Mengubah password user yang sedang login.

Langkah penggunaan:

- Dari Operations Hub, klik ikon Settings di kanan atas.
- Isi Old Password.
- Isi New Password dan Retype New Password.
- Klik Confirm.
- Tunggu notifikasi berhasil atau pesan error.

Catatan:

- Password baru minimal mengikuti validasi aplikasi.
- Retype New Password harus sama dengan New Password.

[TEMPAT SCREENSHOT: Panel Ubah Password]

## Dashboard

Tujuan:

- Menampilkan analisa operasional dan performa proses dalam bentuk grafik dan KPI.

Cara akses:

- Dari Operations Hub klik Dashboard.
- Route: `/dashboard`.

Langkah penggunaan:

- Gunakan filter yang tersedia untuk membatasi periode, workcenter, atau parameter lain.
- Baca KPI dan grafik seperti workload, on-time, OEE, validation rate, loss breakdown, dan progress.
- Gunakan grafik sebagai monitoring dan bahan analisa harian.

Catatan:

- Data dashboard mengikuti data yang tersedia di backend.
- Jika grafik kosong, cek filter dan ketersediaan data.

[TEMPAT SCREENSHOT: Dashboard dengan grafik utama]

## MPS Dashboard

Tujuan:

- Menampilkan ringkasan MPS atau monitoring produksi dalam tampilan dashboard.

Cara akses:

- Route: `/mps-dashboard`.

Langkah penggunaan:

- Buka halaman MPS Dashboard.
- Gunakan ringkasan dan visualisasi untuk memonitor status order dan validasi.
- Refresh browser jika data belum tampil.

[TEMPAT SCREENSHOT: MPS Dashboard]

## Timesheet Login

Tujuan:

- Login operator menggunakan NFC ID atau input manual sebelum membuat aktivitas timesheet.

Cara akses:

- Dari Welcome pilih akses timesheet.
- Route: `/login-timesheet`.

Langkah penggunaan:

- Scan kartu NFC atau isi ID pada field SCAN ID.
- Pastikan nama operator dan workcenter terdeteksi.
- Lanjutkan ke menu timesheet.

Catatan:

- Jika NFC tidak terbaca, gunakan input manual jika tersedia.
- Pastikan data NFC user sudah terdaftar pada NFC User Management.

[TEMPAT SCREENSHOT: Timesheet Login]

## Timesheet Main Menu

Tujuan:

- Menjadi menu kerja operator setelah login timesheet.
- Menampilkan aktivitas yang sedang berjalan dan tombol aksi.

Cara akses:

- Setelah operator login timesheet.
- Route: `/timesheet-mainmenu`.

Langkah penggunaan:

- Pilih Start untuk memulai pekerjaan baru jika belum ada aktivitas aktif.
- Pilih Rework jika pekerjaan adalah rework.
- Pilih Finish untuk menyelesaikan aktivitas aktif.
- Gunakan Refresh jika status aktivitas tidak berubah.
- Gunakan menu tambahan untuk memilih mesin, job, melihat timesheet, atau membuat aktivitas unproductive.

Catatan:

- Operator hanya boleh menjalankan aktivitas sesuai kondisi aktual.
- Pastikan aktivitas lama sudah selesai sebelum mulai aktivitas baru jika sistem membatasi satu aktivitas aktif.

[TEMPAT SCREENSHOT: Timesheet Main Menu]

## Select Machine

Tujuan:

- Memilih mesin atau workcenter yang akan digunakan oleh operator.

Cara akses:

- Dari Timesheet Main Menu pilih menu pemilihan mesin.
- Route: `/select-machine`.

Langkah penggunaan:

- Gunakan search untuk mencari machine, ID, atau group.
- Klik mesin yang sesuai.
- Gunakan Refresh jika daftar mesin belum muncul.
- Lanjutkan ke pemilihan job.

Catatan:

- Pilih mesin aktual yang digunakan di shopfloor.
- Kesalahan mesin akan berdampak ke machine hours dan validasi.

[TEMPAT SCREENSHOT: Select Machine]

## Job Selection

Tujuan:

- Memilih order atau job yang akan dikerjakan operator.

Cara akses:

- Setelah memilih mesin.
- Route: `/select-job`.

Langkah penggunaan:

- Isi Search Order dengan order number atau kata kunci.
- Klik Search.
- Pilih operation/order yang sesuai.
- Pastikan part, operation, dan workcenter sesuai sebelum mulai.

Catatan:

- Gunakan data order yang sesuai dengan traveler/SOW.
- Jika order tidak ditemukan, cek sinkronisasi order atau hubungi admin/PE/PPC.

[TEMPAT SCREENSHOT: Job Selection]

## View Timesheet

Tujuan:

- Melihat daftar aktivitas timesheet operator.
- Menambahkan note, stop, restart, atau membuka edit sesuai status data.

Cara akses:

- Route: `/view-timesheet`.

Langkah penggunaan:

- Buka daftar timesheet.
- Klik Refresh untuk memuat data terbaru.
- Gunakan tombol Note untuk menambahkan catatan.
- Gunakan Stop untuk checkout aktivitas yang masih aktif.
- Gunakan Restart jika aktivitas perlu dilanjutkan.
- Gunakan Edit untuk koreksi data jika diizinkan.

Catatan:

- Data yang sudah tervalidasi mungkin tidak dapat diedit.
- Setiap perubahan harus mengikuti aturan validasi internal.

[TEMPAT SCREENSHOT: View Timesheet]

## Edit Timesheet

Tujuan:

- Mengoreksi data timesheet sebelum validasi final.

Cara akses:

- Dari View Timesheet atau Timesheet Validation klik record yang perlu diedit.
- Route: `/timesheet-edit/:tsnumber`.

Langkah penggunaan:

- Periksa serial number, operator, workcenter, order, operation, check-in, checkout, duration, dan note.
- Ubah field yang diperlukan.
- Klik Save.
- Konfirmasi jika aplikasi menampilkan dialog.

Catatan:

- Record yang sudah Validated dapat dikunci.
- Record dengan SAP Reject dapat diperbaiki lalu divalidasi ulang sesuai prosedur.
- Tandai Deleted hanya jika aktivitas memang tidak valid.

[TEMPAT SCREENSHOT: Edit Timesheet]

## Timesheet Validation

Tujuan:

- Memvalidasi data timesheet sebelum dikirim atau disiapkan untuk SAP.

Cara akses:

- Dari Operations Hub klik Validation.
- Route: `/timesheet-validation`.

Langkah penggunaan:

- Gunakan tanggal start dan end untuk menentukan periode.
- Gunakan Search untuk mencari serial, nama, workcenter, atau order.
- Klik Refresh untuk memuat data.
- Expand group untuk melihat detail record.
- Klik Validate pada satu record untuk validasi individual.
- Klik Validate pada group untuk validasi semua pending dalam group.
- Gunakan Expand All dan Collapse All untuk membuka atau menutup semua group.
- Klik Download Excel untuk export hasil validasi.

Catatan:

- Status Pending berarti belum divalidasi.
- Status Validated berarti sudah valid.
- Status SAP Pending berarti menunggu konfirmasi SAP.
- Status SAP Reject berarti perlu koreksi sebelum validasi ulang.

[TEMPAT SCREENSHOT: Timesheet Validation dengan group terbuka]

## SAP Post Log

Tujuan:

- Melihat log posting data timesheet ke SAP.

Cara akses:

- Route: `/log-timesheet`.

Langkah penggunaan:

- Buka halaman SAP Post Log.
- Review status posting, pesan error, dan waktu proses.
- Gunakan informasi error untuk tindak lanjut perbaikan data.

[TEMPAT SCREENSHOT: SAP Post Log]

## Unproductive Menu

Tujuan:

- Mencatat aktivitas non-produktif seperti waiting, setting, atau aktivitas lain sesuai pilihan sistem.

Cara akses:

- Dari Timesheet Main Menu pilih Unproductive.
- Route: `/unproductive`.

Langkah penggunaan:

- Pilih jenis aktivitas unproductive.
- Isi informasi yang diminta jika ada.
- Submit atau mulai aktivitas.
- Gunakan Refresh jika status belum berubah.

Catatan:

- Aktivitas unproductive tetap perlu dicatat sesuai kondisi aktual.
- Pilihan aktivitas mengikuti konfigurasi backend.

[TEMPAT SCREENSHOT: Unproductive Menu]

## NFC User Management

Tujuan:

- Mengelola data user NFC untuk operator timesheet.

Cara akses:

- Route: `/nfc-users`.
- Dari Manage User pilih Manage NFC User.

Langkah penggunaan:

- Gunakan search untuk mencari nama, SNSSB, NFC ID, atau mesin.
- Klik Create New untuk menambah user NFC.
- Klik ikon edit untuk mengubah data.
- Klik ikon hapus untuk menghapus data jika diperlukan.

[TEMPAT SCREENSHOT: NFC User Management]

## Create atau Edit NFC User

Tujuan:

- Menambahkan atau mengubah data NFC user.

Cara akses:

- Dari NFC User Management klik Create New atau Edit.
- Route: `/create-edit-nfc`.

Langkah penggunaan:

- Isi NFC ID. Bisa ketik manual, scan NFC, atau generate jika tersedia.
- Isi nama operator.
- Isi SNSSB atau employee number.
- Pilih workcenter melalui search workcenter.
- Klik Save User atau Update User.

Catatan:

- NFC ID harus unik.
- Workcenter harus sesuai area operator.

[TEMPAT SCREENSHOT: Form Create/Edit NFC User]

## Export Timesheet

Tujuan:

- Mengunduh data timesheet dalam format Excel atau CSV.

Cara akses:

- Route: `/download`.

Langkah penggunaan:

- Pilih filter atau periode data.
- Klik Download Excel untuk file `.xlsx`.
- Klik Download CSV untuk file `.csv`.
- Tunggu proses download selesai.

Catatan:

- Jika tombol tidak berjalan, cek koneksi API dan periode data.

[TEMPAT SCREENSHOT: Export Timesheet]

## SOW Management

Tujuan:

- Mengelola master SOW, membuat SOW baru, dan melihat history revisi.

Cara akses:

- Dari Operations Hub klik SOW Management.
- Route utama: `/sow-management/list`.

Menu dalam SOW Management:

- SOW List: daftar standard SOW master data.
- Create SOW: membuat SOW baru dari order/part/master component.
- SOW History: melihat riwayat perubahan dan membuat revisi.

[TEMPAT SCREENSHOT: SOW Management dengan menu kiri]

## SOW List

Tujuan:

- Melihat dan mengelola daftar standard SOW berdasarkan part, model, dan operation.

Cara akses:

- Route: `/sow-management/list`.

Langkah penggunaan:

- Gunakan search untuk mencari part name, part number, atau model.
- Expand part untuk melihat operation list.
- Gunakan tombol tambah untuk menambahkan operation baru.
- Gunakan tombol edit untuk mengubah operation.
- Gunakan tombol hapus jika operation perlu dihapus.
- Pada modal operation, isi Operation No, Operation Text, Machine Group, Workcenter, Standard Hours, dan Source Plant.
- Upload attachment berupa PDF, gambar, atau Excel jika diperlukan.
- Gunakan preview untuk melihat attachment.

Catatan:

- Attachment membantu operator/PE melihat referensi operation.
- Pastikan operation no tidak duplikat untuk part yang sama.

[TEMPAT SCREENSHOT: SOW List dengan operation expanded]

## Create SOW

Tujuan:

- Membuat SOW baru untuk order produksi.
- Membuat preview travel card dan operation card.
- Menyimpan operation card image sebagai path file.

Cara akses:

- Route: `/sow-management/create`.

Langkah penggunaan:

- Cari order atau SSBR pada area pencarian atas.
- Pilih order yang akan dibuat SOW.
- Periksa informasi order, part number, part name, customer, location, dan operation.
- Pilih standard component atau master component yang sesuai.
- Tambahkan operation ke SOW.
- Isi atau koreksi plan hours, workcenter, operation text, dan detail lain.
- Pada area preview, periksa travel card dan operation card.
- Jika ada gambar operation card, tempatkan gambar pada box image.
- Klik Create SOW.

Catatan:

- Gambar operation card yang disimpan hanya area box image yang digenerate.
- Pastikan order number dan operation number sesuai karena menjadi referensi gambar operation card.
- Revision pertama menggunakan revision "Original".

[TEMPAT SCREENSHOT: Create SOW - search order dan operation list]

[TEMPAT SCREENSHOT: Create SOW - preview travel card dan operation card]

## Edit SOW Operation

Tujuan:

- Mengubah detail operation SOW yang sudah dibuat.

Cara akses:

- Route: `/sow-edit/:id`.

Langkah penggunaan:

- Periksa data SSBR ID, part number, part name, model, customer, dan location.
- Ubah operation text, workcenter, plan hours, weight, status, confirmation, group, category, atau note sesuai kebutuhan.
- Simpan perubahan.

Catatan:

- Gunakan edit hanya untuk koreksi data yang masih valid secara proses.
- Untuk perubahan resmi antar revisi, gunakan Create Revision dari SOW History.

[TEMPAT SCREENSHOT: Edit SOW Operation]

## SOW History

Tujuan:

- Melihat history SOW, daftar revisi, dan memulai proses revisi SOW.

Cara akses:

- Route: `/sow-management/history`.

Langkah penggunaan:

- Gunakan search order_no atau ssbr_id.
- Klik Refresh untuk memuat data.
- Pilih order untuk melihat detail.
- Pilih revision yang ingin ditampilkan jika tersedia.
- Klik Create Revision untuk membuka halaman edit revisi.

Catatan:

- History menyimpan perubahan SOW dan revision number.
- Table SOW akan merefleksikan revisi terbaru setelah revisi dibuat.

[TEMPAT SCREENSHOT: SOW History dan detail revision]

## Create SOW Revision

Tujuan:

- Membuat revisi SOW berdasarkan SOW yang sudah ada.
- Menambahkan atau mengganti part jika diperlukan.
- Menggunakan fitur yang sama dengan Create SOW, tetapi berbasis data existing.

Cara akses:

- Dari SOW History klik Create Revision.
- Route: `/sow-edit/revision/:orderNo`.

Langkah penggunaan:

- Pilih revision sumber yang ingin direvisi.
- Jika perlu, gunakan fitur ganti part.
- Tambahkan operation dari part number yang sama atau part baru yang dipilih.
- Periksa preview travel card.
- Periksa operation card dan gambar operation card.
- Jika gambar operation card berubah atau ada gambar baru, sistem generate image path baru.
- Jika gambar tidak berubah, sistem tetap menggunakan URL lama.
- Klik Create Revision.

Catatan:

- Setiap Create Revision akan menaikkan revision number.
- Gunakan revisi untuk perubahan formal, bukan edit langsung.

[TEMPAT SCREENSHOT: Create SOW Revision]

## Order Progress Update

Tujuan:

- Memperbarui progress operation/order dan mencatat masalah progress.

Cara akses:

- Dari Operations Hub klik View pada panel Orders.
- Route: `/sow-orders`.

Langkah penggunaan:

- Pilih order atau operation yang ingin diupdate.
- Isi progress 1 sampai 100 persen.
- Isi issue description jika ada kendala.
- Upload image jika diperlukan.
- Klik Submit Update.
- Lihat history update di panel kanan.

Catatan:

- Progress tidak boleh lebih kecil dari progress terakhir jika validasi sistem menerapkan rule tersebut.
- Gunakan issue description untuk kendala produksi.

[TEMPAT SCREENSHOT: Order Progress Update]

## SOW Scheduling

Tujuan:

- Menjadwalkan operation SOW ke mesin dan shift tertentu.
- Mengatur capacity mesin harian, batch schedule, manpower, dan overtime request.

Cara akses:

- Dari Operations Hub klik SOW Scheduling.
- Route: `/sow-scheduling`.

Langkah penggunaan:

- Pilih tanggal pada header.
- Gunakan SOW Activity List di kiri untuk mencari operation.
- Gunakan search pada panel kiri untuk mencari order/operation.
- Gunakan search machine untuk mencari mesin.
- Drag activity dari SOW Activity List ke drop zone shift pada machine card.
- Pada modal Schedule Activity, pilih mode Single atau Batch.
- Untuk Single, isi scheduled hours dan note bila perlu.
- Untuk Batch, pilih batch yang sudah ada atau klik Create untuk membuat batch baru.
- Klik Save/Schedule.
- Activity yang sudah masuk drop zone dapat dipindah antar shift dengan drag and drop.
- Activity dapat dihapus dari drop zone jika perlu reset plan.
- Gunakan tombol OT untuk membuka panel overtime approval.

Catatan:

- Capacity mesin berkurang sesuai scheduled hours atau batch capacity.
- Jika capacity tidak cukup, activity dapat menjadi unplanned atau perlu dipindah ke hari/shift lain.
- Approval overtime hanya dapat dilakukan oleh role yang memiliki hak approve.

[TEMPAT SCREENSHOT: SOW Scheduling - layout activity list, machine card, dan drop zone]

[TEMPAT SCREENSHOT: Modal Schedule Activity Single/Batch]

[TEMPAT SCREENSHOT: Overtime Approval Panel]

## Component Tracking

Tujuan:

- Melacak progress component/order berdasarkan machine, operator, workcenter, order, atau part.

Cara akses:

- Dari Operations Hub klik Component Tracking.
- Route: `/component-tracking`.

Langkah penggunaan:

- Gunakan search untuk mencari machine ID, operator, workcenter, order, atau part.
- Klik Refresh untuk memuat data terbaru.
- Buka detail order/component untuk melihat status operation.

Catatan:

- Data tracking bergantung pada timesheet, SOW, dan progress update.

[TEMPAT SCREENSHOT: Component Tracking]

## Buffer Transaction

Tujuan:

- Mencatat dan mengelola buffer transaction antara SOW operation dan mesin/operator.

Cara akses:

- Route: `/buffer-transaction`.

Langkah penggunaan:

- Gunakan search SOW untuk mencari order, SSBR, part, model, atau operation.
- Pilih operation yang akan dibuat buffer.
- Pilih machine atau operator pada panel mesin.
- Isi note buffer jika diperlukan.
- Klik Send atau tombol submit yang tersedia.

Catatan:

- Gunakan buffer untuk mencatat perpindahan atau penempatan pekerjaan yang belum langsung masuk proses utama.

[TEMPAT SCREENSHOT: Buffer Transaction]

## Receiving and Shipping

Tujuan:

- Mengelola data receiving, shipping, delivery note, dan detail SSBR.

Cara akses:

- Dari Operations Hub klik Receiving and Shipping.
- Route: `/receiving-shipment`.

Langkah penggunaan:

- Gunakan search untuk mencari SSBR, customer, DN, atau component.
- Klik Refresh untuk memuat data terbaru.
- Klik Create untuk membuat SSBR record baru.
- Isi detail customer, component, send by, receiving/shipping detail, dan field lain yang diminta.
- Pilih record untuk melihat SSBR Detail.
- Edit record jika diperlukan dan diizinkan.

Catatan:

- Pastikan DN dan SSBR sesuai dokumen fisik.
- Isi Send By sesuai pengirim aktual.

[TEMPAT SCREENSHOT: Receiving and Shipping]

## Machine Hours Validation

Tujuan:

- Melihat, memfilter, export, dan memvalidasi machine hours.

Cara akses:

- Dari Operations Hub klik Machine Hours.
- Route: `/machine-hours-sqlserver`.
- Halaman menggunakan tampilan Machine Hours Validation.

Langkah penggunaan:

- Pilih tanggal start dan end.
- Gunakan Search untuk mencari machine, status, operator, atau job.
- Gunakan filter Machine No, Status ID, Operator, dan Job jika perlu.
- Klik Refresh.
- Expand group mesin untuk melihat record detail.
- Klik Validate untuk validasi record atau group.
- Klik Download Excel untuk export data.

Catatan:

- Duration ditampilkan dalam format jam:menit:detik.
- Kolom TIME menampilkan detik agar waktu lebih jelas.
- Status Validated berarti record sudah divalidasi.

[TEMPAT SCREENSHOT: Machine Hours Validation]

## Process Control

Tujuan:

- Mengisi dan melihat data process control pada aktivitas mesin atau operation.

Cara akses:

- Route: `/process-control`.

Langkah penggunaan:

- Isi parameter process control sesuai item yang tampil.
- Gunakan pilihan Other jika nilai tidak tersedia pada daftar.
- Isi angka hasil pengukuran jika diminta.
- Tambahkan catatan pada field Catatan.
- Submit atau simpan sesuai tombol yang tersedia.

Catatan:

- Isi data process control sesuai kondisi aktual dan instruksi kualitas.

[TEMPAT SCREENSHOT: Process Control]

## Edit Parameter

Tujuan:

- Mengubah parameter process control dan melakukan accept/reject untuk foreman.

Cara akses:

- Route: `/edit-parameter`.

Langkah penggunaan:

- Review Process Control Data.
- Ubah item parameter jika diperlukan.
- Klik Update Items untuk menyimpan perubahan item.
- Untuk role foreman, gunakan Accept atau Reject.
- Jika Reject, pastikan alasan atau catatan sesuai prosedur.

Catatan:

- Tombol Accept/Reject hanya muncul untuk role yang berhak.

[TEMPAT SCREENSHOT: Edit Parameter]

## Consumable Request

Tujuan:

- Membuat request consumable material.

Cara akses:

- Dari Welcome atau request hub.
- Route: `/consumable-request`.

Langkah penggunaan:

- Cari material berdasarkan material code, code MM, description, atau type.
- Pilih material yang dibutuhkan.
- Isi quantity sesuai kebutuhan dan tidak melebihi remaining stock jika dibatasi.
- Tambahkan comment optional.
- Submit request.
- Lihat Historical Request untuk memantau request sebelumnya.

Catatan:

- Quantity harus sesuai kebutuhan aktual.
- Material yang tidak ditemukan perlu dicek master data warehouse.

[TEMPAT SCREENSHOT: Consumable Request]

## Consumable Control

Tujuan:

- Mengontrol, approve, reject, dan menyesuaikan item consumable request.

Cara akses:

- Dari Operations Hub klik Consumable Control.
- Route: `/consumable-control`.

Langkah penggunaan:

- Login/scan ID jika diminta.
- Klik Refresh untuk memuat ticket.
- Pilih CIS Ticket.
- Review item dan quantity.
- Gunakan Approve to Warehouse atau Approve sesuai role.
- Gunakan Reject pada item jika ada item yang tidak disetujui.
- Isi Reject reason saat menolak item.
- Adjust quantity jika hanya sebagian yang disetujui.

Catatan:

- Alur approval bergantung role: foreman, warehouse, atau admin.
- Reject item harus disertai alasan yang jelas.

[TEMPAT SCREENSHOT: Consumable Control]

## Tools and Consumable Request Hub

Tujuan:

- Halaman hub untuk memilih request consumable atau tools.

Cara akses:

- Route: `/tools-consumable-request`.

Langkah penggunaan:

- Pilih Consumable Request untuk material consumable.
- Pilih Tools Request untuk tools.

[TEMPAT SCREENSHOT: Tools and Consumable Request Hub]

## Tools Request

Tujuan:

- Membuat request peminjaman tools dan melakukan handover tools.

Cara akses:

- Route: `/tools-request`.

Langkah penggunaan:

- Gunakan search untuk mencari nama, kode, ukuran, atau range tools.
- Pilih tools yang ingin dipinjam.
- Isi purpose atau keterangan.
- Submit request.
- Pada tab Handover, pilih tools yang sedang dipinjam.
- Buat handover ke user lain jika perlu.
- Review Incoming Handover, lalu Accept atau Reject.

Catatan:

- Tools yang sedang dipinjam ditampilkan pada panel khusus.
- Handover harus diterima oleh penerima agar status berpindah.

[TEMPAT SCREENSHOT: Tools Request - request tools]

[TEMPAT SCREENSHOT: Tools Request - handover dan incoming handover]

## Tools Management

Tujuan:

- Mengelola inventory tools dan approval reservation.

Cara akses:

- Dari Operations Hub klik Tools Management.
- Route: `/tools-management`.

Langkah penggunaan:

- Gunakan search untuk mencari asset, code, atau name.
- Klik Refresh untuk memuat data.
- Pilih item tools pada Inventory.
- Gunakan Admin Update untuk mengubah data status/stock/tools.
- Review List Reservation.
- Klik Approve untuk menyetujui reservation.
- Klik Reject untuk menolak reservation.

Catatan:

- Halaman ini untuk admin atau user dengan hak tools management.

[TEMPAT SCREENSHOT: Tools Management]

## Manage User

Tujuan:

- Menjadi pintu ringkas menuju pengelolaan NFC User dan Users.

Cara akses:

- Dari Operations Hub klik Manage User.
- Route: `/manage-user`.

Langkah penggunaan:

- Pilih Manage NFC User untuk data NFC operator.
- Pilih Users untuk user login aplikasi.

[TEMPAT SCREENSHOT: Manage User]

## Users

Tujuan:

- Mengelola user login aplikasi.

Cara akses:

- Route: `/manage-users`.

Langkah penggunaan:

- Isi username.
- Isi password untuk user baru, atau password baru jika ingin mengganti password saat edit.
- Pilih role.
- Klik Register untuk user baru atau Update untuk user existing.
- Gunakan search users untuk mencari user terdaftar.
- Klik Refresh untuk memuat data terbaru.

Catatan:

- Role menentukan akses menu protected.
- Simpan data user dengan hati-hati karena berpengaruh ke akses aplikasi.

[TEMPAT SCREENSHOT: Users Management]

## Settings

Tujuan:

- Halaman konfigurasi umum aplikasi.

Cara akses:

- Route: `/setting`.

Langkah penggunaan:

- Review profile dan konfigurasi.
- Klik Update Profile jika mengubah profil.
- Klik Reset to Default jika ingin mengembalikan setting default.
- Klik Export Settings jika perlu export konfigurasi.

Catatan:

- Beberapa pengaturan mungkin belum terhubung ke backend produksi.

[TEMPAT SCREENSHOT: Settings]

## Image Editor

Tujuan:

- Mengedit atau menyiapkan gambar di dalam aplikasi.

Cara akses:

- Route: `/editor-image`.

Langkah penggunaan:

- Buka halaman Image Editor.
- Gunakan kontrol yang tersedia untuk mengatur gambar.
- Simpan atau lanjutkan sesuai kebutuhan proses.

Catatan:

- Halaman ini lebih bersifat utility/internal.

[TEMPAT SCREENSHOT: Image Editor]

## 404 Page

Tujuan:

- Menampilkan pesan saat user membuka route yang tidak tersedia.

Langkah penggunaan:

- Klik Back to MPS Main untuk kembali ke Operations Hub.

[TEMPAT SCREENSHOT: 404 Page]

## Tips Penggunaan Harian

- Selalu klik Refresh jika data tidak sesuai kondisi terakhir.
- Gunakan search sebelum membuat data baru agar tidak duplikat.
- Pastikan tanggal filter benar sebelum validasi atau export.
- Periksa order number, operation number, machine, operator, dan duration sebelum validasi.
- Untuk data yang sudah tervalidasi atau sudah terkirim SAP, lakukan koreksi sesuai prosedur agar tidak terjadi mismatch.
- Gunakan note/comment/reject reason untuk meninggalkan jejak audit yang jelas.

## Troubleshooting Ringan

- Tidak bisa login: cek username, password, dan koneksi API.
- Menu tidak muncul atau tombol disabled: cek role user.
- Data kosong: cek filter tanggal, search keyword, dan apakah backend sudah sinkron.
- Upload gagal: cek ukuran file, format file, dan koneksi.
- Export gagal: cek periode data dan koneksi server.
- SAP Reject: buka detail record, baca pesan error, koreksi data, lalu validasi ulang.
- NFC tidak terbaca: gunakan input manual atau cek device/browser NFC.

## Lampiran: Daftar Route UI

- `/welcome`: Welcome Page.
- `/operations-hub`: Operations Hub.
- `/dashboard`: Dashboard.
- `/mps-dashboard`: MPS Dashboard.
- `/login-timesheet`: Timesheet Login.
- `/timesheet-mainmenu`: Timesheet Main Menu.
- `/select-machine`: Select Machine.
- `/select-job`: Job Selection.
- `/view-timesheet`: View Timesheet.
- `/timesheet-edit/:tsnumber`: Edit Timesheet.
- `/timesheet-validation`: Timesheet Validation.
- `/log-timesheet`: SAP Post Log.
- `/unproductive`: Unproductive Menu.
- `/nfc-users`: NFC User Management.
- `/create-edit-nfc`: Create/Edit NFC User.
- `/download`: Export Timesheet.
- `/sow-management/list`: SOW List.
- `/sow-management/create`: Create SOW.
- `/sow-management/history`: SOW History.
- `/sow-edit/:id`: Edit SOW Operation.
- `/sow-edit/revision/:orderNo`: Create SOW Revision.
- `/sow-orders`: Order Progress Update.
- `/sow-scheduling`: SOW Scheduling.
- `/component-tracking`: Component Tracking.
- `/buffer-transaction`: Buffer Transaction.
- `/receiving-shipment`: Receiving and Shipping.
- `/machine-hours-sqlserver`: Machine Hours Validation.
- `/machine-hours-validation`: Machine Hours Validation protected route.
- `/process-control`: Process Control.
- `/edit-parameter`: Edit Parameter.
- `/consumable-request`: Consumable Request.
- `/consumable-control`: Consumable Control.
- `/tools-consumable-request`: Tools and Consumable Request Hub.
- `/tools-request`: Tools Request.
- `/tools-management`: Tools Management.
- `/manage-user`: Manage User.
- `/manage-users`: Users.
- `/setting`: Settings.
- `/editor-image`: Image Editor.

