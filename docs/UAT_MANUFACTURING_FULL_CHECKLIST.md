---
title: "UAT Checklist — MPS Manufacturing (Cikupa)"
date: 2026-08-10
tags: [UAT, manufacturing, cikupa, checklist]
---

# UAT Checklist — MPS Manufacturing Version (Cikupa)

- **Scope**: PT. Sanggar Sarana Baja — manufacturing version, plant Cikupa (CKP).
- **TIDAK INCLUDE**: Machine Hours / Timesheet SAP Posting (module terpisah).
- **Sumber data**: DB CKP via tailscale tunnel (localhost:5441, db ptssb).
- **Cara pakai**: centang `[ ]` → `[x]` saat lulus. Tulis hasil di kolom Notes.
- **Environment**: `DEV` (lokal) → `UAT` (server staging) → `PROD` (CKP).

---

## 0. Setup Server & Infrastruktur

### 0.1 Provisioning server
- [ ] Server (VPS/on-prem) siap: OS, user deploy (non-root), akses SSH key
- [ ] Node.js + npm terpasang (versi sesuai repo / package.json engines)
- [ ] PostgreSQL terpasang & berjalan (versi sesuai migration)
- [ ] PM2 (atau systemd) terpasang untuk daemon API/job
- [ ] Docker (jika dipakai) — compose file build & up tanpa error
- [ ] Nginx/reverse-proxy: HTTPS (Let's Encrypt) aktif, redirect HTTP→HTTPS

### 0.2 Aplikasi (API)
- [ ] `git clone` repo → `npm install` sukses (apps/api & apps/web)
- [ ] `apps/api/.env` lengkap: DB_HOST/PORT/NAME/USER/PASSWORD, JWT secret, TZ (Asia/Jakarta)
- [ ] `npm run build` sukses di apps/web (Vite build, PWA generate)
- [ ] Migration DB ter-apply (sesuai `database/migrations`, ledger `schema_migrations` benar)
- [ ] Seed data dasar (shift, area, workcenter, user awal) ada
- [ ] API start via PM2: `pm2 list` OK, log tanpa error fatal
- [ ] Web serve via Nginx: `https://<host>` terbuka, PWA ter-installable
- [ ] Health check: `GET /health` (atau endpoint sejenis) → 200

### 0.3 Konektivitas & data
- [ ] Koneksi DB CKP berhasil dari server (query sample `select 1`)
- [ ] Data pokok terverifikasi: `ms_project_task` terisi (bukan BPN yang kosong)
- [ ] Job EWS (`ewsSnapshotJob`) berjalan: log `[EWS job] run started` muncul
- [ ] Backup DB terjadwal (pg_dump cron) + restore test pernah sukses

---

## 1. Backend API & Keamanan

### 1.1 Auth & RBAC
- [ ] Login user valid → token JWT diterima
- [ ] Login password salah → 401 dengan pesan jelas
- [ ] Token expired → 401, FE redirect ke login
- [ ] Role admin akses route admin → OK; role biasa → 403
- [ ] RBAC manifest `check_rbac_manifest.js` → BERSIH (tidak ada route write tanpa entry)
- [ ] Semua route write ada di RBAC (`sow_management`, `msproject_collab`, `ms_project_admin`, dst.)

### 1.2 API umum
- [ ] Error handler: 404 route tak dikenal → JSON error
- [ ] Validasi body: payload invalid → 400 dengan pesan field
- [ ] SQL injection cepat: `' OR 1=1--` di input → tidak bocor data
- [ ] CORS/security headers terpasang (production)

---

## 2. SOW Order Pool (Order Panel)

### 2.1 Tab & badge count
- [ ] 4 tab: **To schedule (perlu)** / **Belum Jadwal** / **Terjadwal** / **Selesai**
- [ ] Badge count semua tab muncul TANPA klik (dari server `counts`)
- [ ] Badge 0 → disembunyikan; pindah tab tidak menggeser tombol (layout statis)
- [ ] Ganti tab instan tanpa animasi reflow

### 2.2 Filter
- [ ] Filter due date: order dengan task `plan_finish/plan_start <= due` (overdue ikut)
- [ ] Filter status SAP: REL/LKD muncul, TECO masuk tab Selesai
- [ ] `exclude_unknown=true`: order tak dikenal SAP tidak muncul
- [ ] Search order (nomor/deskripsi) bekerja case-insensitive
- [ ] Pagination: load 100 baris, scroll/next page lanjut tanpa duplikat

### 2.3 Detail & navigasi
- [ ] Klik order → detail operasi (operation list, standard hours dari `planhours`)
- [ ] Navigasi ke scheduling area dari order → area + task terpilih benar

---

## 3. Bay Scheduling (SchedulingAreaPage)

### 3.1 Mode Map
- [ ] Peta area: hanya kontrol **Map date** (as-of day ‹ › Today) — tanpa From/To
- [ ] As-of day berfungsi: reservasi berurutan di bay yang sama tidak dobel tampil
- [ ] Klik area → zoom ke level area; kembali ke overview
- [ ] Preset window (7/14/30) tidak memotong data schedule (bounds penuh tetap)

### 3.2 Mode Timeline
- [ ] Hanya kontrol **From/To** (bukan Map date)
- [ ] Bar reservasi tampil di kolom hari yang benar (start/end date)
- [ ] Bar yang mulai sebelum window → dijepit (stub) tidak hilang total
- [ ] CANCELLED reservasi tidak tampil (exclude backend)

### 3.3 Reservasi (CRUD)
- [ ] Buat reservasi baru: pilih project/task, area, tanggal → save sukses
- [ ] Task picker: search (op/task/workcenter), Select all/Clear bekerja pada hasil filter
- [ ] Edit reservasi (tanggal/area) → update sukses
- [ ] Cancel reservasi → status CANCELLED, hilang dari layout
- [ ] Validasi bentrok: booking di bay yang sama & tanggal tumpang tindih → warning/block
- [ ] Indikator jumlah: "N of M tasks" hanya saat filter aktif

### 3.4 Deep-link
- [ ] `?area=AREA-XX&date=YYYY-MM-DD` dari Gantt → langsung fokus area + kursor tanggal
- [ ] Area tidak valid di URL → fallback normal tanpa error

---

## 4. Portfolio Gantt (ProjectBrowserPage / ProjectScheduleGantt)

- [ ] Semua project tampil sebagai baris Gantt SEKALIGUS (tanpa perlu expand)
- [ ] Expand project → tree task per outline level (recursive, chevron)
- [ ] Kolom kiri (label + meta) freeze; hanya day-track yang scroll
- [ ] Project row: Start = min(plan_start), Finish = max(plan_finish), Dur = total hari
- [ ] Task row: bar dari plan_start/finish; Area cell = badge booking (klik → deep-link area)
- [ ] Workcenter tampil dari `ms_project_task.workcenter` (NULL = data, bukan bug)
- [ ] Range filter All/1m/3m/6m: window berubah, bar di luar window ter-clip
- [ ] Today line (rose) tampil di header + semua track
- [ ] Weekend stripe + grid hari terlihat
- [ ] Tooltip bar: nama task; tanpa teks di dalam bar
- [ ] Expand/collapse tidak crash (`expandedIds` Set diteruskan benar)

---

## 5. MS Project Hub (`/ms-project-admin` = `/ms-project-hub`)

### 5.1 Daftar project
- [ ] List project: nama, status, revision, active_reservation_count
- [ ] Search project berfungsi

### 5.2 Rename project
- [ ] Rename sukses; peringatan "sync .mpp berikutnya menimpa nama" tampil
- [ ] Rename dengan nama kosong → validasi tolak

### 5.3 Delete project
- [ ] Project tanpa reservasi aktif → Delete normal sukses
- [ ] Project dengan reservasi aktif → tombol Delete disabled + alasan
- [ ] **Force Delete**: menghapus reservasi aktif + file .mpp fisik, audit `PROJECT_DELETE_FORCE`
- [ ] Setelah delete: project hilang dari list, reservasi hilang dari area layout

### 5.4 Edit task
- [ ] Edit task name/plan dates → sukses; audit log tercatat
- [ ] Edit task id invalid → 404/400

### 5.5 Revision/lock
- [ ] Check-in/check-out (.mpp) — lock token berfungsi (Text27)
- [ ] Revision history tampil per project

---

## 6. MS Project VBA Tool (`tools/msproject-v2`)

- [ ] config.ini override base_url (`localhost:8443` → tunnel) bekerja
- [ ] Identity custom field: Text30=project_id, Text29=revision, Text27=lock tersimpan di .mpp
- [ ] **Save to Server** (sync): project + task + assignment + dependency ter-upload
- [ ] Task workcenter = **Resource Names** (fallback Notes) terkirim ke server
- [ ] Import dependency (predecessor): dependency benar-benar masuk DB (cek audit log / DB)
- [ ] Link type: 0=FF, 1=FS, 2=SS, 3=SF tersimpan benar (SS/SF tidak tertukar)
- [ ] Retarget .mpp ke project lain: 4 gerbang (mismatch/lock/revision) bekerja
- [ ] Restart MS Project + macro: login form → project picker → save, tanpa crash

---

## 7. Progress Sub-Task (sow_sub_operation)

### 7.1 Operasi & sub-task
- [ ] Operasi SOW menampilkan sub-task (autoseed dari master standar untuk order baru)
- [ ] Tambah sub-task manual: title + standard_hours → sukses
- [ ] Edit sub-task (title/hours) → sukses
- [ ] Soft-delete sub-task (`is_active=false`) → hilang dari UI, tidak merusak roll-up

### 7.2 Progress & roll-up
- [ ] Update progress sub-task (0-100) → sukses
- [ ] Roll-up: `sow.progress` = round(SUM(progress×hours)/SUM(hours)) — hitung manual cocok
- [ ] Standard hours 0 → bobot 0 (tidak ikut roll-up)
- [ ] Cap: total jam sub-task > `sow.planhours` → 400 "melebihi jam standar operasi"
- [ ] Cap skip saat `planhours <= 0`
- [ ] History progress per sub-task tercatat (progress_history)

### 7.3 Import Excel
- [ ] Template download (link di header, SEBELUM upload) tersedia & bisa dibuka
- [ ] Upload file valid → preview (dry-run) benar
- [ ] Commit import → sub-task + standard_hours masuk
- [ ] Baris duplikat title → skip (dilaporkan `skipped`)
- [ ] File salah format → error jelas, tidak ada data berubah

### 7.4 Master Standar ("Tambah dari Standar")
- [ ] Master per part_number + operation_text (bukan operation_no)
- [ ] Batch tambah dari standar: create + cap total + dedupe aktif → benar
- [ ] CRUD master (sow_sub_operation_standard) berfungsi

---

## 8. Timesheet Tapping (Operator Check-in/Check-out)

> Bagian ini khusus **tapping operator** (check-in/check-out, pilih job/mesin).
> **EXCLUDE**: posting ke SAP (`/timesheet/log-sap`, machine hours) — di luar scope
> manufacturing version.

### 8.1 Alur check-in / check-out
- [ ] Login operator via kartu NFC / serialnumber device → identitas benar (nama, SN karyawan)
- [ ] Tap check-in pada shift aktif → record masuk tercatat
- [ ] Pilih job (order + operation) → transaksi terikat ke job yang benar
- [ ] Pilih machine → transaksi terikat ke mesin yang benar
- [ ] Tap check-out → record selesai, durasi terhitung (end - start)
- [ ] Tapping di luar jam shift (sebelum start / setelah end) → ditolak atau di-flag dengan benar
- [ ] Shift `crosses_midnight` (mis. 22:00–06:00) → check-in/out melewati tengah malam benar
- [ ] Tapping tanpa job terpilih → validasi tolak dengan pesan jelas
- [ ] Tapping ganda (check-in 2× tanpa check-out) → terdeteksi/diblok
- [ ] Kartu/device tidak dikenal → ditolak dengan pesan jelas
- [ ] Edit timesheet (TimesheetEditPage) → update tersimpan + tercatat siapa yang edit

### 8.2 Data & shift (operator_shift)
- [ ] CRUD shift: `shift_code`, `shift_name`, `start_time`, `end_time`, `crosses_midnight`, `standard_hours`, `is_active`
- [ ] `operator_shift_lock`: lock shift per device (`serialnumber`) — `effective_from`, `lock_weeks`, `lock_end`
- [ ] Cancel lock → `cancelled_at` terisi, device bebas shift
- [ ] Device yang ter-lock shift tertentu → tapping masuk ke shift itu
- [ ] `standard_hours` shift → dipakai sebagai dasar KPI adoption_labour (gap ≥ 1 jam → issue)

### 8.3 Operator performance & log
- [ ] OperatorPerformancePage: performa per workcenter / order / operation / timesheet benar
- [ ] LogTimesheetPage: daftar transaksi tampil, search by SN / nama / id berfungsi
- [ ] Validation stats (per device) + validation group records benar
- [ ] Data yang belum divalidasi tampil; setelah validasi → konsisten dengan KPI

### 8.4 Manajemen user NFC
- [ ] NfcUserListPage: daftar user kartu NFC tampil
- [ ] CreateEditNfcPage: tambah/edit kartu (SN karyawan, nama) → tersimpan
- [ ] Kartu dinonaktifkan → tapping ditolak

### 8.5 Integrasi EWS
- [ ] Data tapping hari ini → KPI adoption (machine/labour) ter-update sesuai business day
- [ ] Gap timesheet (machine ≥ 15 menit / labour ≥ 1 jam) → issue adoption lahir
- [ ] Status excused (LEAVE/SICK/PERMIT/OFF) → tidak jadi issue

---

## 9. EWS (Early Warning System)

### 9.1 KPI Dashboard (EwsDetailPage)
- [ ] KPI strip: OEE, OLE, Accuracy, Adoption, Uptime tampil dengan nilai + status
- [ ] Breakdown per machine/labour untuk tiap KPI (tile + chart waterfall/distribution)
- [ ] Snapshot KPI harian tersimpan (ews.kpi_snapshot) sesuai business day (roll EWS_DAY_START_HOUR)
- [ ] Status badge/warna konsisten (ewsStatus theme, severity critical/warning)

### 9.2 Issue Log
- [ ] Job generator berjalan → issue lahir di `ews.issue_log` (category accuracy/adoption/oee/ole/uptime)
- [ ] Issue dari business day sebelumnya auto-resolved ("business day rolled over")
- [ ] Masalah yang sama hari ini → issue key baru lahir (bukan duplikat)
- [ ] Resolve issue manual → wajib justification (resolution_note) → status resolved
- [ ] TTS notifier: issue baru memicu pengumuman suara (best-effort, tidak gagalkan generation)

### 9.3 Drill & detail
- [ ] Klik issue → drill records (getIssueRecords) menampilkan culprit rows
- [ ] Filter issue by category & status di list

### 9.4 Roster
- [ ] EwsRosterPage: roster shift tampil
- [ ] EwsRosterConfigPage: konfigurasi shift/rotasi tersimpan
- [ ] `ews.roster_effective` VIEW (3-layer) menghasilkan roster yang benar

---

## 10. Dashboard & Navigasi Umum

- [ ] Dashboard (MpDashboardPage) memuat chart + data tanpa error
- [ ] Navigasi: back button DETERMINISTIK (tidak `navigate(-1)` yang salah arah)
- [ ] Refresh button di header (slot kanan, sejajar tombol Back) bekerja
- [ ] PWA: install prompt, offline shell, SW precache tidak error console

---

## 11. UAT by User (Acceptance Testing)

### 11.1 Role Foreman
- [ ] Melihat order pool + area map untuk jadwal harian
- [ ] Update progress sub-task operasi yang dikerjakan
- [ ] Melihat issue EWS yang relevan shift-nya

### 11.2 Role PE / Planner
- [ ] Membuat/edit reservasi bay
- [ ] Portfolio Gantt untuk overview semua project
- [ ] Rename/delete project via Hub (termasuk Force Delete dengan alasan)

### 11.3 Role Admin
- [ ] Master standar sub-task CRUD
- [ ] Konfigurasi shift/roster EWS
- [ ] RBAC/user management
- [ ] Resolve issue EWS dengan justification

### 11.4 E2E skenario utama
- [ ] Order baru masuk (ph3_order REL) → muncul di pool "To schedule"
- [ ] Planner jadwalkan di bay → reservasi tampil di map & timeline
- [ ] Task di-sync dari MS Project (VBA) → muncul di Gantt portfolio
- [ ] Foreman update progress → roll-up ke operasi/order
- [ ] Mesin bermasalah → KPI turun → issue EWS lahir + TTS
- [ ] Semua data uji bisa di-rollback / tidak merusak data produksi nyata

---

## 12. Non-Fungsional & Sign-off

- [ ] Performance: halaman berat (Gantt 300+ hari, order pool 100+) load < 3 detik
- [ ] Mobile: halaman inti tidak horizontal scroll berlebihan (PWA)
- [ ] Error console browser: 0 uncaught error saat skenario utama
- [ ] Backup/restore DB pernah diverifikasi
- [ ] UAT sign-off: tanggal + nama tester + status (LULUS/BERSYARAT/GAGAL)

---

## Catatan penting

- UI user-facing manufacturing = **FULL ENGLISH** (jangan tambah label Indonesia baru).
- `ms_project_task.actual_*` selalu NULL — "selesai" ditentukan dari SAP (REL/LKD vs TECO).
- Backend yang ter-deploy bisa LAG dari repo — fitur FE yang butuh param API baru wajib
  punya fallback client-side.
- Job EWS wajib berjalan agar issue log terisi (lihat `docs/log/2026-08-10-ews-issue-log-spesifik.md`).
