# Timesheet /select-job (Manufacturing) — Grouping Job, Gear+NFC Area, Collapsible Filter — Plan

> **For Hermes:** Implement task-by-task; konfirmasi keputusan user dulu (bagian bawah).

**Goal:** Halaman Manufacturing SelectJob (/select-job) jadi lebih mudah dipakai operator:
1. Hilangkan info outline level di daftar job
2. Job di-group 2 level: **Project name → Unit task** (task yang namanya mengandung "Unit")
3. Dropdown Device Area pindah ke container sendiri, dibuka lewat tombol **gear** (di kiri tombol Refresh) — tiap klik wajib **input NFC ID**; hanya role **FOREMAN** (tabel `usernfc`) yang bisa ubah area
4. Select Bay tetap bebas untuk semua user (tanpa gate) — KONFIRMASI
5. Search box, tombol Search, Reset, label info, select bay → SATU container yang bisa **show/hide** biar fokus ke tabel job

---

## TEMUAN (verified 2026-08-13)

### Halaman & varian
- `/select-job` → `pages/TIMESHEET/SelectJobPage.jsx` = switch varian runtime (`config/appVariant.js`): manufacturing vs salvaging.
- **Manufacturing** `pages/TIMESHEET/manufacturing/SelectJobPage.jsx` (559 baris) = halaman yang dimaksud (device area, bay, password 12345, outline). Versi salvaging BEDA TOTAL (scan kamera) — tidak tersentuh.

### State & alur existing (manufacturing/SelectJobPage.jsx)
| Bagian | Lokasi | Kondisi |
|---|---|---|
| Password gate | `DEVICE_PASSWORD='12345'` (baris 16), `submitDevicePin` (245), `guardDeviceChange` (221) | Area DAN bay dua-duanya di-gate PIN; unlock persist sessionStorage `deviceUnlock` |
| Dropdown Device Area | baris 339-346 (di filter bar) | gated (handleAreaChange → guard) |
| Dropdown Bay | baris 354-364 | gated (handleBayChange → guard) |
| Refresh | header kanan (315) | — |
| Icon gear `Settings2` | cuma dipakai sebagai ikon label "Device Area" (325) | BUKAN tombol |
| Outline info | baris 481-483: tampil `job.outline_number` di bawah task_name | akan DIHAPUS |
| Filter bar | baris 321-406: grid area/bay/search/btn/btn + label info | akan jadi container collapsible |
| PIN modal | baris 502-556 | diganti modal NFC ID |

### Data API `GET /ms-project/bay-schedule-tasks` (msProjectService.js:2182)
- Response per baris: schedule_id, order_no, project_id, task_id, task_name, **outline_number**, operation_no, ssbr_id, workcenter, planned_work_minutes, is_summary, is_order_level, bay_codes, area_code, dates.
- **TIDAK ADA `project_name` dan TIDAK ADA `parent_task_id`/unit** → grouping butuh perubahan backend:
  - `project_name` → JOIN `ms_project` (kolom `project_name` ada ✓)
  - `unit_name` → naikkan rantai parent (`ms_project_task.parent_task_id`, ada ✓) sampai node summary yang namanya mengandung "Unit"
- Struktur task (verified DB): op (non-summary) → parent summary level 3 (mis. "MATERIAL PREPARATION" 2.1.1) → level 2 = **UNIT 2 / UNIT 1** ATAU section proses (BLASTING/PRIMER & PAINTING, FABRICATION, FITTING, ...). **TIDAK SEMUA project pakai UNIT** — yang tidak punya node "Unit" perlu fallback (keputusan 1).

### Auth NFC (sudah ada pattern-nya — REUSE)
- Endpoint: `GET /usernfc/nfcid/:nfcid` (routes/usernfc.js) — dipakai LoginTimesheetPage:171, ConsumableControlPage:345, SelectMachinePage:80
- Tabel `usernfc`: kolom `nfcid` (text), `full_name`, `roles` (text, bisa multi — cek ILIKE '%FOREMAN%'), `inactive_from`
- Utility FE: `normalizeNfcId` (utils/nfcId.js:37) — dipakai semua pemanggil
- `getdatausernfc` (usernfcController:24) mencocokkan beberapa varian nfcid + deteksi kartu duplikat

---

## DESAIN

### 1. Backend — bay-schedule-tasks + field grouping (msProjectService.js:2182)
- JOIN `ms_project mp ON mp.project_id = t.project_id` → `mp.project_name`
- LATERAL recursive (kedalaman max ~8) cari ancestor summary pertama yang `task_name ILIKE '%unit%'` → `unit_name`; kalau tidak ketemu → fallback `parent_name` (parent summary langsung) atau '—' sesuai keputusan user
- Response bertambah: `project_name`, `unit_name` — pemanggil lain? (grep `bay-schedule-tasks` — hanya SelectJobPage; verifikasi saat implementasi)
- `node --check` + test langsung (mock/curl ke endpoint dengan area+bay sampel, cek field baru terisi)

### 2. FE — grouping 2 level di tabel (manufacturing/SelectJobPage.jsx)
- Build `groups` dari `jobs`: `Map(project_name → Map(unit_name → rows[]))`, urut project → unit → operation_no
- Render: group header `<tr>` colspan=7 (baris penuh, bg-slate-100, teks bold kecil: `{project_name}` baris atas, `{unit_name}` sub — atau dua kolom) di atas row job-nya
- **Hapus** `job.outline_number` (baris 481-483)
- Order-level job (is_order_level) tetap tampil (badge amber) — taruh di group unit "—" atau sesuai unit_name hasil API

### 3. FE — gear + NFC foreman gate (ganti password 12345)
- Hapus `DEVICE_PASSWORD`, `readDeviceUnlock`, unlock sessionStorage, gate lama
- Header: `[Back] [Judul] [gear icon] [Refresh]` — gear (Settings2) di KIRI tombol Refresh
- Alur tiap klik gear:
  1. Buka modal NFC: input nfcid (placeholder "Scan / ketik NFC ID") + tombol Verifikasi + Batal
  2. `normalizeNfcId(input)` → `GET /usernfc/nfcid/:nfcid` → ambil row pertama
  3. Valid: `roles ILIKE '%FOREMAN%'` (case-insensitive) DAN `inactive_from` kosong/null → tutup modal NFC → buka **container Device Area** (dropdown area + tombol Simpan + Hapus setting; area berubah → reset bay + reload jobs)
  4. Gagal: NFC tidak dikenal / roles bukan FOREMAN → toast error "Akses ditolak — hanya foreman", modal tetap
- TIDAK ada unlock persist — setiap klik gear minta NFC lagi (sesuai permintaan)
- **Select Bay: HAPUS gate** (`handleBayChange` langsung `applyBayChange`) — semua user bisa ganti bay (keputusan 2 untuk konfirmasi)

### 4. FE — container filter collapsible
- Device Area dropdown KELUAR dari filter bar (pindah ke container gear)
- Filter bar (baris 321-406) jadi satu container: **Bay + Search box + tombol Search + Reset + label info** (area tersimpan/bay aktif/workcenter)
- Header container: toggle `[ChevronDown/Up] Filter` — show/hide isi; default tampil
- Saat hidden → konten hilang, tabel job dapat fokus penuh

### 5. Verifikasi
- Backend: curl bay-schedule-tasks (area+bay sampel) → project_name/unit_name terisi; grouping benar
- FE: eslint + build; browser: pilih bay → job ter-group project→unit; gear → NFC salah ditolak, NFC foreman terbuka; container filter hide/show
- Docs: `docs/log/2026-08-13-selectjob-grouping-nfc.md` + INDEX

---

## Files likely to change
- **Backend:** `apps/api/services/msProjectService.js` (listBayScheduleTasks ±2182)
- **FE:** `apps/web/src/pages/TIMESHEET/manufacturing/SelectJobPage.jsx`
- **Docs:** `docs/log/2026-08-13-selectjob-grouping-nfc.md`

---

## Yang perlu kamu putuskan (pola 1a/2a/3a)

1. **Fallback grouping kalau project TIDAK punya task bernama "Unit"** (terbukti ada: BLASTING/PRIMER & PAINTING, FABRICATION, FITTING, MATERIAL PREPARATION...):
   - 1a = group pakai parent summary langsung (mis. "FABRICATION", "BLASTING, PRIMER & PAINTING") — tetap terstruktur (REKOMENDASI)
   - 1b = semua yang tanpa Unit dimasukkan satu bucket "No Unit"
   - 1c = tanpa group kedua (flat di bawah project)

2. **Select Bay**: 
   - 2a = tanpa gate sama sekali — semua user bebas ganti bay (sesuai bacaanku atas "kalau select bay semua user bisa") (REKOMENDASI)
   - 2b = tetap butuh NFC foreman seperti sekarang

3. **NFC unlock**:
   - 3a = SETIAP klik gear harus input NFC ID lagi (sesuai "setiap klik gear harus masukkan password") (REKOMENDASI)
   - 3b = sekali verifikasi foreman per sesi browser (sessionStorage), seperti pola lama

4. **Posisi container Device Area setelah NFC sukses**:
   - 4a = modal NFC berubah jadi container area (dropdown area + Simpan/Hapus) — 1 modal (REKOMENDASI)
   - 4b = container area di baris filter (seperti sekarang tapi cuma muncul setelah NFC) — perlu tombol untuk buka/tutup terpisah
