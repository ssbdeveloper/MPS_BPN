---
type: plan
status: planning
tags: [domain/msproject, domain/timesheet]
---

# MS Project — Collaboration & Identity Hardening (lanjutan manufaktur)

> **Scope:** menutup gap **identitas · integritas write-path · visibilitas sinkron** pada
> integrasi MS Project (VBA) ↔ DB, **+ check-in manufaktur single/multiple + alur area→Select Job**
> (§6). BUKAN membangun ulang checkin/checkout MSP — itu sudah ada & jalan.
> **Basis keputusan yang diwarisi:** [[MSPROJECT_PWA_LITE_PLAN]] (K1–K5) & [[prd/manufacturing-variant]]
> (FR-1 check-in, D4). Dibuat **2026-07-28** dari investigasi current-state 4 lapis (VBA · backend/DB · frontend · vault).

---

## 0. Posisi — apa yang SUDAH ada (jangan dibangun ulang)

Model inti checkin/checkout **sudah dibangun & berfungsi** (verifikasi 2026-07-28):

- `ms_project_lock` (checkout pesimistik, 1 lock/proyek, `lock_token`, `heartbeat_at`, `expires_at`),
  `ms_project_revision` (snapshot jsonb tiap revisi), `ms_project_publish`, `ms_project_audit_log`.
- **Optimistic concurrency**: `sync`/`publish` butuh `last_known_revision_no` → **409 `PROJECT_REVISION_CONFLICT`**.
- Siklus penuh di VBA: `Ms_OpenFromServer → Ms_CheckOut → edit → Ms_SaveToServer → Ms_CheckIn`.
- Sync = **diff/merge** (upsert `local_*_uid` + daftar `deactivate`), bukan replace.
- **DB = source of truth · MS Project = editor · Web = hub/kontrol** (keputusan [[MSPROJECT_PWA_LITE_PLAN]]).
- Web Hub sudah menampilkan status lock + Force Check-In (admin).

Kerja plan ini = menutup gap yang membuat **kolaborasi & sinkron membingungkan**, bukan menulis ulang mesinnya.

---

## 1. Keputusan (dikunci 2026-07-28)

| # | Keputusan | Konsekuensi ke plan |
|---|---|---|
| **D-A** | **Identitas honor-system**: VBA dari `config.ini` (`user`, seperti `git user.name`), web dari sesi login; keduanya **divalidasi cocok** ke tabel `users`. Tanpa password di VBA. | Fase 1. Cukup untuk akuntabilitas di LAN internal (sejalan `verify_tls=false`, IP Tailscale). |
| **D-B** | **Web = kontrol lock + visibilitas saja**, BUKAN edit jadwal di web. | Non-goal "no web task editing" [[MSPROJECT_PWA_LITE_PLAN]] **dipertahankan**. Editing tetap di VBA. |
| **D-C** | **Lock tetap non-expiring** (K2). | **TTL/auto-release TIDAK dikerjakan.** Recovery lock nyangkut = force-checkin, dikompensasi visibilitas identitas (Fase 3). |
| **D-D** | **Single-writer** (tanpa merge konkuren). | `409` yang ada sudah cukup; yang diperbaiki hanya **UX konflik**-nya. |

**Ditunda (dikerjakan owner lain waktu, plan terpisah):**

- **(ii) Auth-bound VBA** — login/token di VBA sehingga `actor` diverifikasi server & tak bisa dipalsukan.
  Lebih aman tapi jauh lebih besar (perlu alur login di VBA). Dipisah dari plan ini secara sadar.

---

## 2. Non-goals (ditegaskan agar tak menyelinap masuk)

- ❌ Real-time presence / multi-editor konkuren — pertahankan non-goal [[MSPROJECT_PWA_LITE_PLAN]].
- ❌ TTL / auto-expiring lock (D-C).
- ❌ Web Gantt / edit task di web (D-B).
- ❌ Auth-bound VBA (ditunda ke plan owner).
- ❌ Merge konflik otomatis (D-D).

---

## 3. Yang perlu diperbaiki (prioritas, sudah di-scope ke keputusan)

| # | Masalah (bukti) | Tipe | Masuk |
|---|---|---|---|
| **P0-1** | Identitas hardcoded `"ms-project-vba"` (`ms_sync.bas:338,340,361,386`) / `"web-manufacturing"`,`"web-hub"` (`Map:403`,`Bay:467`,`svc:98`). Server `actorFromBody` (`msProjectService.js:~178`) SUDAH menerima actor nyata — client tak pernah kirim. | Gap | **Fase 1** |
| **P0-2** | Write-path menembus protokol lock: `PUT /projects/:id/tasks/map-sow-order` & bay writes mutasi tanpa cek lock/revisi (bisa ubah saat VBA checkout). `/sow-scheduling` **tulis tanpa guard** (`router:192-193`). | Gap | **Fase 2** |
| **P0-3** | `schema_prod.sql` **basi**: tak memuat `ms_project_lock/_revision/_publish/_audit_log`, kalender, `bay_schedule`, + kolom pasca-`20260603`. Yang percaya dump → simpulkan sistem lock "tak ada". | Governance | **Fase 4** |
| **P1-2** | Konflik `409` hanya dilempar sebagai error mentah MsgBox di VBA (`ms_sync.bas`) — tak ada pesan "orang lain sudah ubah, buka ulang". | UX | **Fase 2** |
| **P1-3** | Visibilitas sinkron lemah: draft-vs-published cuma 2 angka `Rev X / Pub Y`; tak ada "checked out by [nama] sejak [jam]" yang bermakna (karena identitas palsu); tak ada peringatan `.mpp` stale. | Gap | **Fase 3** |
| **P1-4** | Bay board terputus total dari jadwal MSP (`bay_schedule` dataset sendiri, tanpa penanda/tautan) — memperkuat "jadwal asli yang mana?". | Gap | **Fase 4** |
| **P2-1** | Dead code `MsProjectAdminPage.jsx` (orphan) + sisa header kosong pasca-merge Hub. | Kebersihan | **Fase 4** |
| **P2-2** | `.mpp` ditimpa tiap upload (tak ada binary per-revisi; download salah-label `-rev{n}`); sync-delete andalkan kejujuran client. | Gap | **Ditunda** (opsional) |

> **Keluar dari scope karena D-C:** infra TTL/heartbeat (`expires_at`/`heartbeat_at` + interval `"100 tahun"`,
> `msProjectService.js:7,2478,2529`) **dibiarkan mati sesuai keputusan**. Jangan diaktifkan di plan ini.

---

## 4. Fase implementasi

### Fase 1 — Identitas nyata (honor-system) · P0-1 · [D-A]
1. `tools/msproject-v2/config.ini`: tambah `user` (username; opsional `display_name`). Loader `ms_config.bas`.
2. VBA: kirim `user` sebagai `actor` di checkout/sync/heartbeat/checkin/publish; **buang** string hardcoded.
3. Web: kirim user login (`authUser`/header `x-user-id`) sebagai `actor` di Map/Bay/Hub; buang `"web-*"`.
4. Server: resolusi/validasi `actor` → tabel `users` (tolak/tandai jika bukan user dikenal); simpan ke
   `locked_by` + audit. Plumbing sudah ada.
- **Acceptance:** Hub menampilkan `checked_out_by` = nama orang asli; audit_log actor = user valid; tak ada lagi `"ms-project-vba"`/`"web-*"` di baris baru.

### Fase 2 — Integritas write-path & UX konflik · P0-2, P1-2 · [D-D]
1. Guard `/sow-scheduling` (PIN minimum; pertimbangkan RBAC feature) — write pages tak boleh telanjang.
2. `map-sow-order` + bay writes: WAJIB sadar lock/revisi — tolak/putuskan sadar bila proyek sedang di-checkout
   oleh orang lain (hindari mutasi diam saat VBA memegang). Minimal: cek `checked_out_by` & beri peringatan.
3. UX `409` VBA: ganti error mentah → pesan jelas "Jadwal sudah diubah [nama] (rev X). Buka ulang sebelum simpan."
- **Acceptance:** dua penulis tak bisa mutasi diam-diam saat satu checkout; user dapat pesan konflik yang bisa ditindak, bukan error mentah.

### Fase 3 — Visibilitas sinkron (tanpa real-time) · P1-3 · [D-C kompensasi]
1. Hub & scheduling: tampilkan **"checked out by [nama] sejak [jam]"** bermakna (buah Fase 1) + tombol
   **release lock sendiri** (bukan hanya force-checkin admin) → pengganti TTL yang dipilih (D-C).
2. Draft-vs-published sebagai **status kata**, bukan angka: "Ada N revisi belum dipublish" / "Ini baseline terpublish".
3. Peringatan **`.mpp` stale**: saat download/buka, tandai bila `revision_no` DB > revisi file yang dipegang.
- **Acceptance:** user bisa jawab tanpa nebak — "siapa pegang ini, apakah salinanku terbaru, apakah ada perubahan belum dipublish". Semua tanpa SSE/presence.

### Fase 4 — Kebersihan & konsistensi · P0-3, P1-4, P2-1
1. **Regenerate `schema_prod.sql`** dari prod (mencakup semua tabel `ms_project_*` pasca-`20260603`).
2. Bay board: beri **penanda/tautan** hubungannya ke jadwal MSP (bukan menyatukan datanya — sekadar signposting agar tak dikira "jadwal lain").
3. Hapus `MsProjectAdminPage.jsx` (dead code) + rapikan header sisa pasca-merge Hub.
- **Acceptance:** dump kanonik kembali dipercaya; bay board tak lagi ambigu; nol dead code MSP.

---

## 5. Urutan & ketergantungan

Fase 1 **prasyarat** Fase 3 (visibilitas identitas mustahil tanpa identitas nyata). Fase 2 & 4 independen —
bisa paralel. Fase 4.1 (regen schema) bisa dikerjakan kapan saja (kecil, governance).

---

## 6. Kebutuhan tambahan (ditambahkan 2026-07-28) — check-in & area→Select Job

Dua kebutuhan owner, sudah diverifikasi ke kode 2026-07-28. Keduanya menyentuh **D4 (semantik check-in)**
di [[prd/manufacturing-variant]] — foldkan ke FR-1, jangan bercabang.

### R1 — Check-in manufaktur: single & multiple (paritas salvaging)

**Klarifikasi:** di salvaging "single/multiple" = **mode per-operator** (`usernfc.mode`), BUKAN multi-select.
- **Single:** Start → `PUT /timesheet/checkout` (tutup semua baris terbuka) → `POST /timesheet/`.
- **Multiple:** lewati checkout → `POST /timesheet/` saja → operator menumpuk beberapa baris produktif terbuka.
- Login checkout: single → `/checkout` (tutup semua); multiple → `/checkout-unprod` (sisakan produktif).

**Kondisi manufaktur = PLACEHOLDER** (`manufacturing/TimesheetMainMenuPage.jsx:77` cuma `toast.info`, tak posting).
Tak ada toggle mode / Start / `postdata`. Hanya checkout jalan.

**Gap = hampir seluruhnya FRONTEND** — backend `POST /timesheet/` sudah mendukung single+multiple generik.
Kerja: port `postdata()` + toggle mode + mapping payload dari `salvaging/TimesheetMainMenuPage.jsx:182-235`.
Verifikasi `usernfc.mode` tersedia untuk operator manufaktur.

> **R1-a — DIPUTUSKAN & sebagian jalan (run 1, 2026-07-28):** kolom nullable dibuat di
> `timesheet_transaction` — `ms_area_code`,`ms_bay_codes`,`ms_task_id`,`ms_project_id`,`ms_bay_schedule_id`
> (tipe `uuid` untuk id, sesuai PK `ms_project_task`/`ms_project_bay_schedule`), migrasi
> `20260728_timesheet_ms_project_link.sql`. Karena granularitas TASK-LEVEL (R2-a), `ms_task_id` **DIISI**.

### R2 — Planning job ke area → muncul di Select Job (**PERBAIKI**, bukan "sudah beres")

**Verdikt jujur: setengah jalan + ada bug.** Drag order ke bay (`SchedulingAreaPage.jsx:460-469`) menulis
`order_no`+area+`bay_codes`, tapi **`task_id`/`project_id` = NULL** (`msProjectService.js:1820-1829`) — TIDAK
terhubung ke `ms_project_task`. Job baru muncul di Select Job **hanya jika** order dipetakan terpisah via
`MapSapOperationPage` (langkah manual kedua). Join null-task = cocokkan string order ke task aktif mana pun.

Bug/fragilitas konkret:
- 🔴 **Blasting tak pernah muncul:** planning `area_code='AREA-18'` (`SchedulingAreaPage.jsx:44`) vs Select Job
  device-area `'BLASTING'` (`SelectJobPage.jsx:29`) → filter `upper(s.area_code)=area` tak pernah cocok.
- **Workcenter** = hard-filter ganda (server+client); tanpa Select Machine dulu → session workcenter kosong → job kosong.
- **Today-only:** Select Job tak kirim tanggal → server paksa `current_date BETWEEN start AND end`; job masa
  depan tak terlihat; risiko batas hari (server TZ vs `Asia/Makassar`).
- **Join fuzzy:** `task_id IS NULL` → semua operasi order muncul (di semua proyek), bukan yang dipetakan ke bay itu.
- **Topologi area/bay hardcoded di 2 file** (`SchedulingAreaPage` vs `SelectJobPage`) — sudah drift (bug blasting).
- **Loop tak tertutup:** check-in tak simpan `schedule_id`/`task_id`; status `ms_project_bay_schedule` tak pernah
  `RESERVED→CONFIRMED/DONE`.

> **R2-a — MODEL FINAL (dikonfirmasi owner 2026-07-28):**
> - **Device = bay**, disimpan di `localStorage` (seperti sekarang), tapi **ubah dilindungi PASSWORD**
>   (fleksibilitas foreman; operator tak bisa ganti sembarangan). `Select Machine` **TETAP**.
> - **`workcenter` manufaktur = GRUP ORANG** (mis. `M5100FAB`=grup fabrikasi; juga FIT dll), BUKAN mesin —
>   lihat memori `manufacturing-vs-salvaging-workcenter`. Filter task per workcenter-grup **DISENGAJA & benar**
>   (orang FAB lihat task FAB, FIT lihat FIT). Jadi filter workcenter BUKAN bug — koreksi catatan run 1.
> - **Granularitas TASK-LEVEL**: scheduler menaruh **task/operasi spesifik** ke bay (bukan order). Kolom
>   `ms_project_bay_schedule.task_id` **DIISI** (satu baris per task→bay); branch direct-task di
>   `listBayScheduleTasks` (sudah ada) menampilkannya, difilter bay + workcenter-grup + tanggal.
>   Ini **MEMBATALKAN deviasi order-level** run 1 (yang sengaja NULL-kan `task_id`).
> - **DIPUTUSKAN 2026-07-28 — (a) di WEB.** Scheduler assign task→bay di `SchedulingAreaPage` (pilih order →
>   operasi/task → bay), `task_id` diisi. **MS Project MEMBACA** area/bay per task saat sync/Open (`/package`)
>   dan menaruhnya ke **kolom custom Text MSP yang masih bebas** (Text27=lock token; pakai lain, mis. Text26)
>   — display saja, agar scheduler MSP tahu task di-set ke Area mana. **Web = otoritatif**; MSP jangan clobber balik.

### Fase lanjutan
- **Fase 5 — Check-in parity (R1):** frontend port single/multiple + toggle mode + payload mapping;
  jika R1-a = persist → migrasi kolom nullable + sertakan di `create`.
- **Fase 6 — Model device-bay TASK-LEVEL (R2), revisi 2026-07-28:**
  (a) device-bay di localStorage + **gate PASSWORD** untuk ubah (foreman); Select Machine TETAP;
  (b) planning menaruh **task ke bay** (`task_id` diisi) — bukan order-level;
  (c) `listBayScheduleTasks` pakai branch direct-task, filter bay + workcenter-grup + tanggal;
  (d) SUDAH di run 1: fix blasting + topologi bersama, kolom `ms_*` + migrasi, tutup loop `RESERVED→CONFIRMED`.
  (e) `/package` (yang di-pull VBA) sertakan area/bay per task; VBA `ms_import.bas` petakan ke kolom Text MSP bebas (display).
  Sisa: nasib window today-only (job masa depan tak tampil) — putuskan saat implementasi.

> **Kaitan penting:** R1-a (persist link di check-in) dan R2 (tutup loop) = **lever yang sama** — putuskan bersama.

---

## 7. Referensi & keputusan yang dihormati

- Induk: [[MSPROJECT_PWA_LITE_PLAN]] (K1–K5; DB=source of truth; non-goal presence/web-edit).
- Check-in manufaktur: [[prd/manufacturing-variant]] FR-1 & **D4 (semantik check-in)** — pekerjaan check-in
  harus konsisten dengan PRD ini, jangan fork. D5 (jam-insentif) = risiko payroll, di luar scope plan ini.
- Scheduling: [[timesheet/sow Scheduling master plan]] (invarian I3 Plan≠Actual — sync MSP jangan menimpa actual).
- Runbook: [[operations/MSPROJECT_HUB]].
- Ditunda: **(ii) auth-bound VBA** — plan terpisah milik owner.
