---
tags: [domain/msproject]
type: plan
status: active
---

# Rencana Refactor: MS Project ⇄ MPS2 — "PWA Lite"

**Tanggal:** 2026-07-07 · **Sasaran:** pengalaman ala *Project Web App* (Microsoft) versi sederhana:
save project ke DB, buka lagi untuk edit, check-out/check-in, dan satu **Hub web** untuk semua project tersimpan.
**Konteks:** solo developer — MS Project desktop tetap menjadi editor; web TIDAK dibuat menjadi Gantt editor.

Label bukti: **READ (langsung)** = saya buka filenya sesi ini; **READ (delegasi)** = dibaca sub-pass eksplorasi dengan bukti file:line; **INFERRED** = simpulan dari konteks.

---

## 1. Kesimpulan utama: fondasinya SUDAH ADA, yang kurang adalah Hub + perapian

Setelah membaca `ms_sync.bas` penuh, `VBA_SUMMARY.md`, `ms_config.bas` (READ langsung), route `/ms-project`, `msProjectController.js`, bagian inti `msProjectService.js` (~3.150 baris), 6 migrasi `ms_project_*`, dan `MsProjectAdminPage.jsx` (READ delegasi):

| Kebutuhanmu | Status sekarang | Bukti |
|---|---|---|
| Save project (upload ke DB) | ✅ Ada: `POST /projects` (create) + `PUT /projects/:id/sync` (update) + upload `.mpp` | READ (delegasi): `msProjectService.js` `publishProject` :2680, `syncProject` :2849 |
| Dipanggil lagi untuk edit | ✅ Ada: `GET /projects/:id/package` → `Ms_ImportProjectById` membangun ulang file di MS Project | READ (langsung): `ms_sync.bas:51`; READ (delegasi): service `getProjectPackage` |
| Check-out / check-in | ✅ Ada lengkap: lock table (1 lock per project), `checkout/heartbeat/checkin/force-checkin`, optimistic `revision_no` (409 conflict), audit log, snapshot revisi jsonb | READ (delegasi): `ms_project_lock` unique(project_id), `checkoutProject` :2442, `syncProject` 409 `PROJECT_REVISION_CONFLICT` |
| Hub web untuk semua project | ⚠️ **Hampir tidak ada.** Satu-satunya UI adalah `MsProjectAdminPage` (381 baris) = daftar project + **force check-in saja**, khusus role administrator | READ (delegasi): `MsProjectAdminPage.jsx` |
| Simpan file `.mpp` fisik | ✅ Upload ada (`POST /projects/:id/file`, 100 MB, hanya `.mpp`); ❌ **download TIDAK ada endpoint-nya** | READ (delegasi): `routes/msProject.js:8-27`; tidak ada `GET .../file` |

Jadi rencana ini bukan "bangun dari nol" — ini **(a) bangun Hub web di atas endpoint yang sudah ada, (b) tambah 2–3 endpoint kecil yang hilang, (c) rapikan VBA**. Jangan menulis ulang backend; desain lock + revision + snapshot-nya sudah benar.

---

## 2. Temuan per komponen

### 2.1 Backend (`apps/api` — `/ms-project`)

- **B1 — Semua operasi mutasi sudah transaksional dan aman konkuren.** READ (delegasi): `SELECT ... FOR UPDATE` pada project row, BEGIN/COMMIT/ROLLBACK, lock pesimis + cek `revision_no` optimis. Ini bagian terbaik dari seluruh integrasi — **jangan disentuh**.
- **B2 — Tidak ada endpoint download `.mpp`.** File tersimpan di `/uploads/ms-project-mpp/{project_id}.mpp` dengan metadata (`file_path/name/size/uploaded_at` di `ms_project`), tapi hanya bisa di-upload. Hub butuh tombol Download. (Catatan: folder `/uploads` disajikan statis tanpa auth — lihat R-B1.)
- **B3 — Lock tidak pernah kedaluwarsa** (`expires_at = now() + 100 tahun`, READ delegasi :7). Untuk tim kecil ini bisa diterima karena ada force-checkin, tapi Hub harus menampilkan "siapa pegang lock sejak kapan" agar lock nyangkut kelihatan.
- **B4 — `ms_project.status` teks bebas, tanpa CHECK.** VBA memakai status `TRIAL` yang **tidak dikenal backend sama sekali** (grep 0 hasil di apps/) — `Ms_ImportLatestTrialProject` bergantung pada konvensi yang tidak ditegakkan. Butuh lifecycle sederhana.
- **B5 — Re-import bersifat upsert + soft-deactivate, bukan replace-all.** Penghapusan task/assignment harus dikirim eksplisit lewat array `deactivate` (READ delegasi: `applyExplicitDeactivate` :965). Perilaku ini benar untuk integritas, tapi harus dipahami: task yang dihapus di file MS Project **tidak otomatis hilang** di DB kecuali VBA mengirim deactivate.
- **B6 — Snapshot revisi & publish (jsonb penuh) sudah tersimpan** di `ms_project_revision` / `ms_project_publish` tapi **tidak ada UI/endpoint pembacanya**. Bahan gratis untuk fitur "riwayat versi" di Hub.
- **B7 — Relasi ke SOW satu arah dan read-only** (SOW → `ms_project_task.sow_id/planhours`); tidak menulis balik ke `sow`/`sow_schedule`. READ (delegasi, grep). Aman dari sisi payroll.

### 2.2 VBA (`docs/archive/additional/ms project/*.bas`)

- **V1 — Salah rumah.** Modul **aktif** (`ms_*.bas`, dipakai harian) berada di `docs/archive/` — folder yang menurut aturan repo berisi dokumen mati. Rawan terhapus/terabaikan.
- **V2 — Konfigurasi keras di kode.** READ (langsung) `ms_config.bas`: base URL `https://100.80.101.53/api/ms-project` (IP Tailscale) sebagai `Const`. Ganti server = edit modul di setiap PC pengguna.
- **V3 — TLS verification dimatikan.** READ (delegasi sebelumnya): `ms_http.bas` set WinHttp `Option(4) = 13056` (abaikan semua error sertifikat). Bisa di-MITM; minimal harus jadi opsi yang default-nya aman.
- **V4 — Bug timezone kandidat.** READ (langsung) `ms_config.bas:23`: `MS_DEFAULT_TIMEZONE_SUFFIX = "+07:00"` (WIB), padahal server/DB berjalan `Asia/Makassar` (+08, terverifikasi ke DB produksi 2026-07-07). Tanggal plan/actual yang dikirim VBA bisa bergeser 1 jam → salah hari pada jadwal. **HIPOTESIS** — konfirmasi: bandingkan `plan_start` satu task di DB vs tampilan MS Project untuk task yang mulai jam 07:00.
- **V5 — Kualitas kode inti sebenarnya baik.** READ (langsung) `ms_sync.bas` (633 baris): guard clause lengkap (belum checkout → tolak sync; lock invalid 423 → bersihkan token; revisi stale → 409), fase error jelas, mapping UUID balik ke custom fields rapi. Refactor VBA = **perapian, bukan penulisan ulang**.
- **V6 — UX macro masih "developer-grade".** Semua interaksi lewat `MsgBox`/`InputBox`/Immediate Window (`Ms_ListProjects` menampilkan daftar project di MsgBox; `Ms_ImportProjectById` minta ketik UUID manual). Ada ±16 macro publik termasuk 4 macro `Ms_Debug*` yang membingungkan pengguna akhir.
- **V7 — `httphelper.bas` + folder `legacy/` sudah mati** (READ delegasi + VBA_SUMMARY) — hapus.

### 2.3 Web UI (`apps/web`)

- **W1 — `MsProjectAdminPage` hanya force check-in** (admin-only, route `/ms-project-admin`, PIN + role administrator). Tidak ada halaman untuk melihat/mengunduh/meriwayatkan project bagi pengguna biasa.
- **W2 — Service web (`src/services/msProjectService.js`) sudah punya pola wrapper yang bersih** — tinggal ditambah fungsi baru untuk Hub. READ (delegasi).

---

## 3. Arsitektur target "PWA Lite"

Prinsip: **MS Project = editor; Web = hub & kontrol; DB = source of truth.**

```
┌─ MS Project + VBA (per planner) ─────────────────────────────┐
│  Buka dari server:  pilih project (UserForm) → import package │
│  Checkout  ──────►  lock + revision                           │
│  Edit di MS Project                                           │
│  Simpan ke server:  sync (metadata) + upload .mpp  (1 macro)  │
│  Check-in  ──────►  lepas lock                                │
└──────────────────────────────────────────────────────────────┘
                          ▲            │
                          │  REST /api/ms-project (SUDAH ADA)
                          ▼            ▼
┌─ Web Hub (/ms-project-hub) — BARU ───────────────────────────┐
│  Daftar semua project: status, rev, published rev,            │
│  lock (siapa & sejak kapan), file .mpp (ukuran, tanggal)      │
│  Aksi: Download .mpp · Riwayat revisi · Ubah status ·         │
│        Force check-in (admin) · Arsipkan                      │
└──────────────────────────────────────────────────────────────┘
```

Yang sengaja **tidak** dibangun (over-engineering untuk satu maintainer): web Gantt editor, edit task via web, real-time presence, konversi `.mpp` di server, notifikasi. Kalau suatu hari butuh "lihat isi project di web", cukup tabel task read-only dari `GET /projects/:id/tasks` (endpoint sudah ada).

---

## 4. Rencana kerja

### Fase A — Backend kecil (±1 hari)

**A1. Endpoint download file** — `GET /projects/:project_id/file` di `routes/msProject.js`: baca `file_path` dari `ms_project`, validasi path di dalam `uploads/ms-project-mpp` (pakai pola guard `startsWith(uploadsRoot)` yang sudah ada di sowController), `res.download()` dengan nama `"{project_name}-rev{revision_no}.mpp"`. Sekaligus audit `FILE_DOWNLOAD`.

**A2. Perkaya `GET /projects`** agar Hub tidak perlu N+1: sertakan `file_name/file_size/file_uploaded_at`, `checked_out_by/at`, `published_revision_no`, `last_published_at` (sebagian besar kolom sudah ada di tabel — tinggal ditambahkan ke SELECT bila belum).

**A3. Endpoint riwayat** — `GET /projects/:project_id/revisions?limit=20`: baca `ms_project_revision` (tanpa kolom `snapshot` untuk list; detail snapshot hanya saat diminta satu revisi). Data sudah ada (B6), endpoint-nya saja yang belum.

**A4. Lifecycle status sederhana** — migrasi baru: `CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED'))` + backfill nilai lama (`UPDATE ... SET status='ACTIVE' WHERE status NOT IN (...)`). `PUT /projects/:id/status` kecil untuk Hub. Hapus konsep `TRIAL` dari VBA (`Ms_ImportLatestTrialProject` diganti "import terbaru per status" atau dihapus — pilihanmu, lihat §7 K1).

**A5. (Opsional, keputusanmu — §7 K2) TTL lock.** Ganti `+100 tahun` menjadi mis. 8 jam + heartbeat memperpanjang; checkout atas lock kedaluwarsa otomatis merebut. VBA sudah punya heartbeat, jadi biaya perubahan kecil. Kalau tim masih 1–3 planner, boleh tunda — force-checkin di Hub sudah cukup.

**R-B1 (catatan keamanan, tumpang tindih dengan REFACTOR_PLAN.md A-R1):** folder `/uploads` disajikan statis tanpa auth — file `.mpp` bisa diunduh siapa saja yang tahu URL. Endpoint A1 tidak memperburuk ini, tapi solusi sebenarnya adalah auth API global dari rencana refactor utama.

### Fase B — Web Hub (±2–3 hari)

**B1. Halaman baru `MsProjectHubPage`** di `apps/web/src/pages/PPC/`, route `/ms-project-hub` (daftarkan di `src/router/index.jsx`; guard: PIN `ProtectedRoute` dulu — jangan tunggu RBAC baru). Ikuti Corporate Color System (CLAUDE.md).

Isi halaman (satu halaman saja, jangan lebih):
- **Stat tiles:** Total · Checked-out · Published · Archived.
- **Tabel project:** Nama + ID (mono) · Status badge (DRAFT amber / ACTIVE emerald / ARCHIVED slate) · Rev X / Pub Y · Lock: `checked_out_by` + sejak kapan (badge merah bila > 24 jam — deteksi lock nyangkut) · File: ukuran + tanggal upload (atau "belum ada file") · Updated by/at.
- **Aksi per baris:** ⬇ Download `.mpp` (A1) · 🕘 Riwayat (drawer/modal berisi list revisi dari A3: rev, type CREATE/SYNC/PUBLISH/FORCE_CHECKIN, actor, waktu) · Ubah status (A4) · Force check-in (pindahkan logika modal dari `MsProjectAdminPage`, tetap admin-only).
- Search + filter status + toggle "checked-out only" (pola sudah ada di `MsProjectAdminPage` — jadikan dasar, jangan tulis dari nol).

**B2. Nasib `MsProjectAdminPage`:** setelah Hub jadi, jadikan `/ms-project-admin` redirect ke Hub (atau hapus route-nya) supaya tidak ada dua daftar project yang harus dirawat.

**B3. Tambah wrapper di `src/services/msProjectService.js`:** `downloadMsProjectFile`, `fetchMsProjectRevisions`, `updateMsProjectStatus`. Ikuti pola wrapper yang ada.

### Fase C — Refactor VBA (±1–2 hari)

**C1. Pindah rumah:** `docs/archive/additional/ms project/` → **`tools/msproject-vba/`** (modul `ms_*.bas` + `JsonConverter.bas` + `VBA_SUMMARY.md`). Hapus `legacy/*.bas` dan `httphelper.bas` (git menyimpan sejarah). Perbarui referensi di CLAUDE.md.

**C2. Konfigurasi eksternal:** ganti `Const MS_API_BASE_URL` dengan pembacaan file `%APPDATA%\mps-msproject\config.ini` (base_url, timeout, verify_tls) dengan fallback ke konstanta. ±30 baris VBA. Satu build modul jalan di semua PC/server.

**C3. TLS:** default **verifikasi aktif**; `Option(4)=13056` hanya bila `verify_tls=false` di config. Karena servermu ber-IP (bukan hostname), langkah praktisnya: terbitkan sertifikat self-signed dengan SAN IP dan pasang di trust store PC planner — atau sadar-risiko tetap `false` di jaringan Tailscale (keputusanmu, §7 K3).

**C4. Fix timezone (V4):** `MS_DEFAULT_TIMEZONE_SUFFIX` → `"+08:00"` setelah hipotesis V4 terkonfirmasi. Jadikan nilai config (C2), bukan konstanta.

**C5. Rampingkan permukaan macro** menjadi 6 perintah pengguna + 1 UserForm:

| Macro (baru) | Isi |
|---|---|
| `Ms_OpenFromServer` | **UserForm** daftar project (nama, rev, status, lock) dari `GET /projects` → pilih → import package. Mengganti `Ms_ListProjects` + `Ms_ImportProjectById` + `Ms_ImportLatestTrialProject`. |
| `Ms_CheckOut` | seperti sekarang |
| `Ms_SaveToServer` | = sync + upload `.mpp` (sudah tergabung) — rename dari `Ms_SyncExistingProject` agar bahasa pengguna |
| `Ms_CheckIn` | tawarkan "Simpan dulu?" bila ada perubahan belum di-sync, lalu check-in |
| `Ms_PublishNewProject` | seperti sekarang |
| `Ms_CloneAsNewProject` | seperti sekarang |

Macro `Ms_Debug*`, `Ms_HeartbeatCurrentProject`, `Ms_UploadCurrentProjectFile` tetap ada tapi dipindah ke modul `ms_debug.bas` (bukan menu utama). Heartbeat otomatis: panggil diam-diam di awal `Ms_SaveToServer` (pola pengecekan lock-nya sudah ada di `Ms_CheckOutCurrentProject` :470-489).

**C6. Ribbon/toolbar sederhana (opsional):** file `.mpp` global template (`Global.MPT`) dengan 6 tombol di atas — pengalaman "PWA lite" terasa nyata di sisi MS Project. Effort kecil, nilai UX besar.

### Fase D — Dokumentasi (±½ hari)

**D1.** Perbarui `VBA_SUMMARY.md` (ikut pindah ke `tools/msproject-vba/`): alur baru 6 macro, config.ini, tabel field mapping tetap.
**D2.** Tambah baris route `/ms-project-hub` + service compose (tidak berubah) di CLAUDE.md.
**D3.** Satu halaman runbook `docs/operations/MSPROJECT_HUB.md`: cara planner memakai (buka → checkout → edit → save → checkin), cara admin melepas lock nyangkut.

---

## 5. Prioritas (impact × effort)

| # | Item | Impact | Effort | Urutan |
|---|---|---|---|---|
| A1+A2 | Download `.mpp` + enrich list | Tinggi (Hub tak berguna tanpa ini) | Rendah | **1** |
| B1+B3 | Halaman Hub | Tinggi (permintaan utama) | Sedang | **2** |
| C4 | Fix timezone +07→+08 | Tinggi bila terkonfirmasi (jadwal salah 1 jam) | Sangat rendah | **3** (verifikasi dulu) |
| C1+C2 | Pindah folder + config.ini | Sedang-tinggi (operasional) | Rendah | 4 |
| C5 | Rampingkan macro + UserForm | Sedang (UX planner) | Sedang | 5 |
| A3+B1-riwayat | Riwayat revisi di Hub | Sedang | Rendah | 6 |
| A4 | Lifecycle status | Sedang | Rendah | 7 |
| C3 | TLS | Sedang (keamanan) | Rendah-sedang | 8 |
| A5 | TTL lock | Rendah (force-checkin sudah ada) | Rendah | 9 / tunda |
| C6 | Ribbon | Rendah (nice-to-have) | Rendah | 10 |

Total estimasi inti (1–7): **±5 hari kerja** efektif.

---

## 6. Yang TIDAK saya inspeksi (jujur soal cakupan)

- Body `msProjectService.js` baris ~1541–2442 & ~2969–3142 (kalender, resource, bay schedule, conflicts, `getProjectPackage`/`bulkLoad`) — hanya signature. Rencana ini tidak menyentuhnya.
- `ms_import.bas`, `ms_serializer.bas`, `ms_fields.bas`, `ms_resources.bas`, `ms_calendars.bas` — belum dibaca baris-per-baris (fungsinya diketahui dari VBA_SUMMARY + pemanggilan di `ms_sync.bas`). C5 tidak mengubah logika serialisasi, hanya permukaan macro.
- `JsonConverter.bas` (library pihak ketiga) — tidak diaudit.
- Perilaku runtime lock/sync belum diuji terhadap server (tidak ada tes end-to-end di sesi ini).
- Isi tabel `ms_project*` di DB produksi belum di-query (berapa project nyata, ada lock nyangkut atau tidak) — layak dicek sebelum Fase B agar Hub didesain dengan data nyata.

---

## 7. Keputusan (DIJAWAB 2026-07-07) & status implementasi

- **K1 — Status lifecycle:** ✅ `DRAFT / ACTIVE / ARCHIVED`; `TRIAL` dipetakan ke `DRAFT` (migrasi `20260707_ms_project_status_lifecycle.sql`).
- **K2 — Lock TTL:** ✅ tetap non-expiring; pelepasan via force check-in di Hub. A5 tidak dikerjakan.
- **K3 — TLS:** ✅ jadi opsi `verify_tls` di config.ini (default `false`); server akan pindah ke IP lokal, sertifikat menyusul.
- **K4 — Akses Hub:** ✅ PIN (`ProtectedRoute`) saja; RBAC menunggu redevelopment backend.
- **K5 — File:** ✅ overwrite satu `.mpp` per project agar tidak menumpuk.

### Status implementasi (2026-07-07)

| Fase | Status |
|---|---|
| A1 download `.mpp`, A2 enrich list, A3 riwayat revisi, A4 lifecycle status | ✅ Selesai (`routes/msProject.js`, `msProjectController.js`, `msProjectService.js`, migrasi 20260707) |
| A5 TTL lock | ⏭ Dilewati (K2) |
| B1–B3 Hub web | ✅ Selesai — `MsProjectHubPage.jsx`, route `/ms-project-hub` (+ `/ms-project-admin` jadi alias), wrapper service baru |
| C1–C5 VBA v2 | ✅ Selesai di **`tools/msproject-v2/`** (folder baru; v1 di docs/archive dibiarkan): config.ini eksternal, TLS opsional, tz default `+08:00`, macro 8+debug terpisah, `Ms_OpenFromServer` picker bernomor |
| C6 ribbon | ⏳ Belum (opsional) |
| D1–D3 docs | ✅ `tools/msproject-v2/README.md`, `docs/operations/MSPROJECT_HUB.md`, CLAUDE.md diperbarui |

**Catatan produksi penting:** DB produksi baru punya migrasi `ms_project` dasar (terverifikasi 2026-07-07 — tabel lock/file/revision belum ada, `ms_project` kosong). Urutan penerapan migrasi ada di `docs/operations/MSPROJECT_HUB.md`. Fitur checkout/file TIDAK akan jalan di produksi sebelum itu diterapkan.
