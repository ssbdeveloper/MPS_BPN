# Manufacturing Version - UAT Guide

Dokumen ini menjelaskan fitur versi Manufacturing yang sudah dibuat untuk kebutuhan UAT. Fokusnya adalah cara kerja dari sisi user, alur test, dan hal yang perlu dicek saat validasi.

## 1. Mode Manufacturing

Aplikasi sekarang bisa bercabang antara mode Salvaging dan Manufacturing.

Mode aktif dibaca dari `.env`:

```env
VITE_APP_VARIANT=manufacturing
```

Jika mode ini aktif:

- `/timesheet-mainmenu` menampilkan halaman menu Manufacturing.
- `/select-job` memakai halaman Select Job khusus Manufacturing.
- Halaman Salvaging tetap ada, tetapi tidak dipakai saat variant Manufacturing aktif.

Catatan UAT:

- Setelah mengubah `.env`, restart Vite dev server.
- Jika tampilan masih seperti Salvaging, lakukan hard refresh browser.

## 2. Manufacturing Timesheet Main Menu

Halaman: `/timesheet-mainmenu`

Fitur yang tersedia:

- Menampilkan data operator dari session login NFC.
- Menampilkan workcenter dan machine operator.
- Menampilkan order dan operation yang sedang dipilih.
- Tombol `Check In`.
- Tombol `Check Out`.
- Tombol `Select Work Order`.
- Tombol `Select Workcenter`.

Cara kerja:

- `Select Work Order` membuka `/select-job`.
- `Select Workcenter` membuka `/select-machine`, sama seperti flow Salvaging untuk memilih workcenter/machine.
- Workcenter yang dipilih tersimpan ke data karyawan di session, lalu dipakai untuk filter task Manufacturing.

Skenario UAT:

1. Login sebagai operator.
2. Buka `/timesheet-mainmenu`.
3. Pastikan nama, SN, workcenter, dan machine tampil.
4. Klik `Select Workcenter`.
5. Pilih workcenter.
6. Kembali ke menu dan pastikan workcenter operator berubah sesuai pilihan.

## 3. Manufacturing Select Job

Halaman: `/select-job`

Fitur utama:

- Device/tablet bisa diset mewakili area tertentu.
- Area tersimpan permanen di browser/tablet memakai `localStorage`.
- User memilih bay dari area tersebut.
- Task yang muncul diambil dari schedule bay MS Project.
- Operation/task hanya muncul jika workcenter task sama dengan workcenter operator di session.

Sumber data:

- Schedule area dan bay: `ms_project_bay_schedule`
- Detail task/order: `ms_project_task`

Cara kerja filter:

1. User memilih `Device Area`.
2. Pilihan area disimpan di browser/tablet.
3. User memilih `Bay`.
4. Sistem mencari schedule aktif berdasarkan:
   - `area_code`
   - `bay_code`
   - tanggal hari ini berada di antara `start_date` dan `end_date`
   - status schedule bukan `CANCELLED`
5. Sistem mengambil task dari order yang ada di schedule tersebut.
6. Sistem hanya menampilkan task dengan `workcenter` yang sama dengan workcenter operator.

Field yang disimpan saat task dipilih:

- `order`
- `order_no`
- `operationtext`
- `operation_text`
- `operation_no`
- `workcenter`
- `planhours`
- `schedule_id`
- `task_id`
- `project_id`
- `manufacturing_area_code`
- `manufacturing_area_name`
- `manufacturing_bay_code`

Skenario UAT:

1. Login operator yang punya workcenter.
2. Buka `/select-job`.
3. Pilih `Device Area`.
4. Pilih `Bay`.
5. Pastikan list task muncul hanya dari order yang dijadwalkan di bay tersebut.
6. Pastikan task yang muncul hanya workcenter yang sama dengan workcenter operator.
7. Klik salah satu task.
8. Pastikan kembali ke `/timesheet-mainmenu`.
9. Pastikan order dan operation yang dipilih tampil di menu.

Skenario negative:

- Jika operator belum punya workcenter, task tidak boleh muncul.
- Jika bay tidak punya schedule aktif, task tidak boleh muncul.
- Jika schedule ada tetapi workcenter tidak sama, task tidak boleh muncul.

## 4. Device Area Setting

Area device/tablet disimpan di browser masing-masing.

Artinya:

- Tablet Area 1 bisa diset ke `AREA-01`.
- Tablet Area 2 bisa diset ke `AREA-02`.
- Setting tetap tersimpan walaupun browser ditutup.
- Setting akan hilang jika user klik `Reset` atau browser data/localStorage dibersihkan.

Cara reset:

1. Buka `/select-job`.
2. Klik `Reset`.
3. Pilih ulang area dan bay.

Catatan UAT:

- Setting area ini belum disimpan ke database.
- Setting ini per device/browser.

## 5. MS Project Admin - Force Check-In

Halaman: `/ms-project-admin`

Halaman ini dibuat untuk admin agar bisa melepas project yang tertahan dalam status checked out.

Fitur:

- List semua MS Project.
- Filter `Checked out only`.
- Search project.
- Melihat project yang sedang checked out.
- Melihat siapa user yang melakukan checkout.
- Melihat waktu checkout.
- Tombol `Force Check-In`.
- Input reason sebelum force check-in.

Cara kerja:

1. Admin membuka `/ms-project-admin`.
2. Sistem menampilkan project dari MS Project table.
3. Project yang sedang checked out dapat dipilih.
4. Admin klik `Force Check-In`.
5. Admin mengisi reason.
6. Sistem memanggil API:

```http
POST /ms-project/projects/:project_id/force-checkin
```

7. Lock project dilepas.
8. Audit log dicatat sebagai `FORCE_CHECKIN`.

Skenario UAT:

1. Login sebagai administrator.
2. Buka `/ms-project-admin`.
3. Aktifkan filter `Checked out only`.
4. Pilih project yang sedang checked out.
5. Klik `Force Check-In`.
6. Isi reason.
7. Submit.
8. Pastikan project tidak lagi checked out.
9. Refresh list dan pastikan status berubah.

Skenario negative:

- User non-administrator tidak boleh menggunakan halaman ini.
- Project yang tidak checked out tidak bisa di-force check-in.
- Reason wajib diisi.

## 6. Super Admin Panel di SOW Scheduling

Halaman: `/sow-scheduling`

Di versi Manufacturing, menu `Super Admin Panel` sekarang diarahkan ke:

```text
/ms-project-admin
```

Skenario UAT:

1. Buka `/sow-scheduling`.
2. Klik `Super Admin Panel`.
3. Pastikan diarahkan ke halaman `MS Project Admin`.

## 7. API yang Dipakai

### Ambil task berdasarkan area, bay, dan workcenter

```http
GET /ms-project/bay-schedule-tasks?area_code=AREA-01&bay_code=A38&workcenter=M5051PL1
```

Dipakai oleh halaman Manufacturing Select Job.

### Force check-in project

```http
POST /ms-project/projects/:project_id/force-checkin
```

Dipakai oleh halaman MS Project Admin.

Payload:

```json
{
  "actor": "admin-web",
  "reason": "Release stale checkout"
}
```

## 8. Checklist UAT Ringkas

- Mode Manufacturing aktif dari `.env`.
- `/timesheet-mainmenu` menampilkan menu Manufacturing.
- Tombol `Select Workcenter` membuka halaman pilih workcenter.
- `/select-job` menampilkan pilihan area dan bay.
- Area tersimpan setelah browser ditutup dan dibuka lagi.
- Task yang muncul sesuai area schedule.
- Task yang muncul sesuai bay schedule.
- Task yang muncul sesuai workcenter operator.
- Pilih task mengisi order dan operation di main menu.
- `/sow-scheduling` menu `Super Admin Panel` membuka `/ms-project-admin`.
- `/ms-project-admin` hanya bisa dipakai administrator.
- Force check-in melepas project yang checked out.

## 9. Catatan Batasan Saat Ini

- Setting area device masih tersimpan di browser, belum di database.
- Manufacturing check-in flow masih mengikuti struktur existing dan belum seluruh business rule final.
- Select Job Manufacturing bergantung pada schedule aktif hari ini.
- Jika schedule belum punya `task_id`, sistem fallback mengambil task berdasarkan `order_no`.
- Data task harus memiliki `workcenter` yang sama dengan workcenter operator agar muncul.
