---
type: guide
tags: [domain/msproject, domain/timesheet]
updated: 2026-07-31
---

# Panduan UAT — MS Project Manufaktur

> Cek apakah fitur MS Project + jadwal bay + check-in operator jalan sesuai harapan.
> Tak perlu paham teknis — cukup **lakukan** langkahnya dan lihat **hasilnya**.
>
> **Cara isi kolom "Lulus?":** `✅` kalau hasilnya sesuai · `❌` kalau tidak · `—` kalau belum dites.
> Kalau `❌`, tulis singkat **apa yang terjadi** di kolom Catatan (lalu catat di tabel "Bug ditemukan").
>
> Kalau ada langkah yang error/nyangkut, lihat **Lampiran teknis** di bawah atau minta bantuan IT.
> Diperbarui 2026-07-31. Rencana induk: [[MSPROJECT_COLLAB_HARDENING_PLAN]] · [[MSPROJECT_PWA_LITE_PLAN]].

---

## Persiapan (lakukan sekali sebelum mulai)

| # | Yang dilakukan | Yang harus terjadi | Lulus? | Catatan |
|---|---|---|:---:|---|
| S1 | Buka MS Project → Alt+F11 → import semua modul + form login dari folder `tools/msproject-v2` (detail di Lampiran) | Semua ke-import, tak ada error | — | |
| S2 | Menu Debug → **Compile VBAProject** | **Tak ada tulisan error merah** | — | kalau error, cek Lampiran (modul kurang) |
| S3 | Isi alamat server (file `config.ini`, lihat Lampiran) | — | — | biasanya IT yang set |
| S4 | Jalankan `Ms_CheckConnection` | Muncul "connected" | — | gagal → koneksi/VPN, lihat Lampiran |

---

## 1. Positive test — hasilnya harus BERHASIL

Skenario pemakaian normal. Semua ini **harus jalan mulus**.

| # | Yang kamu lakukan | Yang harus terjadi | Lulus? | Catatan |
|---|---|---|:---:|---|
| P1 | Jalankan `Ms_Login`, isi **username & password yang benar** | Muncul pesan **"Berhasil login sebagai: \<nama kamu\>"** | — | |
| P2 | Jalankan `Ms_WhoAmI` | Muncul **nama kamu** (yang barusan login) | — | |
| P3 | Jalankan `Ms_OpenFromServer` | Muncul daftar project → pilih satu → ke-buka tanpa error | — | |
| P4 | Jalankan `Ms_CheckOut` (mulai mengedit) | Di web (`/ms-project-hub`) project itu jadi **"Checked out by \<nama kamu\>"** | — | harus nama kamu, bukan "ms-project-vba" |
| P5 | Ubah sesuatu → jalankan `Ms_SaveToServer` | Tersimpan, **nomor revisi naik** | — | |
| P6 | Jalankan `Ms_CheckIn` (selesai) | Di web project kembali **"Available"** | — | |
| P7 | **Belum login**, langsung jalankan `Ms_CheckOut` | **Form login muncul sendiri** → login → checkout lanjut atas nama kamu | — | sistem memaksa login supaya jelas siapa yang kerja |
| P8 | Di web **Scheduling Area**: taruh sebuah order ke bay → lalu di MS Project buka project itu, tampilkan kolom **Text4** & **Text5** | Task menampilkan **Area** (Text4) & **Bay** (Text5) sesuai yang diatur di web | — | order harus sudah di-Map ke MS Project dulu |
| P9 | Ulangi checkout → edit → simpan → check-in → buka lagi project-nya | **Area & Bay tetap sama** (tidak berubah) | — | web yang menentukan Area/Bay |
| P10 | Buka file `.mpp` lama hasil **download** (yang "dianggap project baru") → jalankan `Ms_LinkToServerProject` → pilih project yang benar → **Ctrl+S** → `Ms_CheckOut` | Checkout jalan **ke project itu** (bukan minta publish baru) | — | fitur menghubungkan ulang file lama |
| P11 | Di web taruh order ke area **Blasting** → cek muncul di jadwal | Reservasi blasting muncul & **tidak hilang** | — | |
| P12 | Operator di tablet: check-in mode **Single** | Baris kerja yang masih terbuka **otomatis ditutup** | — | |
| P13 | Operator di tablet: check-in mode **Multiple** | Baris kerja **menumpuk** (yang lama tetap terbuka) | — | |

---

## 2. Negative test — hasilnya harus DITOLAK / berhenti dengan aman

Sengaja salah / kondisi tak wajar. Sistem **tidak boleh** menerima ini diam-diam — harus menolak dengan pesan jelas, tanpa merusak data.

| # | Yang kamu lakukan (sengaja) | Yang harus terjadi | Lulus? | Catatan |
|---|---|---|:---:|---|
| N1 | `Ms_Login` dengan **password salah** | **Gagal login** (pesan/status merah). Tetap belum login | — | |
| N2 | **Belum login**, jalankan `Ms_CheckOut`, lalu **Batal** di form login | Aksi **berhenti** — tidak jadi checkout | — | membatalkan login = tidak ada yang terjadi |
| N3 | Dua orang buka project sama; orang lain simpan duluan, lalu **kamu** `Ms_SaveToServer` | **Ditolak** dengan pesan (revisi sudah berubah). Kerja orang lain **tidak tertimpa** | — | |
| N4 | Lock kamu dilepas admin (Force Check-In di web), lalu kamu `Ms_SaveToServer` | **Ditolak** dengan pesan (lock sudah hilang) | — | |
| N5 | Edit **Area/Bay langsung di MS Project** (kolom Text4/Text5) → `Ms_SaveToServer` | Di server **tidak berubah** — web tetap yang menentukan | — | wajar; MS Project cuma menampilkan |
| N6 | Di tablet, ubah **Device Area/Bay** tanpa/ salah **PIN** | **Ditolak** — diminta PIN dulu | — | PIN `12345` |
| N7 | Di **Scheduling Area**, buka order yang **belum di-Map** ke MS Project | Daftar task **kosong** (tak bisa direservasi sebelum di-Map) | — | |

---

## Bug ditemukan saat UAT

| # | Test (mis. P4 / N3) | Apa yang terjadi | Parah? (ringan/berat) | Status |
|---|---|---|---|---|
| | | | | |

---

## Lampiran teknis (untuk IT bila ada yang gagal)

**S1 — modul yang diimport** (folder `tools/msproject-v2`): semua file `.bas` (termasuk `JsonConverter.bas` dan **`ms_auth.bas` — wajib**) + 2 UserForm: **`frmLogin`** (login) & **`frmProjectPicker`** (daftar project). Hapus dulu modul versi lama. Tanpa `ms_auth` → compile gagal.

**S3 — `config.ini`** (di `%APPDATA%\mps-msproject\`): `base_url=https://127.0.0.1:8443/api/ms-project`, `verify_tls=false`, `tz_suffix=+08:00`. Login menembak alamat **sibling** `/api/auth/login` (bukan di bawah `/ms-project`).

**S4 — koneksi** (akses dari luar pabrik): butuh SOCKS Tailscale `127.0.0.1:1055` **dan** forwarder HTTPS (`pg_socks_tunnel.py … 8443`) jalan. Uji: `curl -k https://127.0.0.1:8443/api/ms-project/health` → 200.

**Kode error yang mungkin muncul** saat `Ms_SaveToServer`: **409** = revisi sudah berubah (N3) · **423** = lock hilang (N4).

**Cek langsung ke database** (via tunnel `127.0.0.1:5441`), kalau perlu bukti:
- Check-in manufaktur mengisi kolom `ms_*`: `SELECT ms_task_id, ms_area_code, ms_bay_schedule_id FROM timesheet_transaction ORDER BY tsnumber DESC LIMIT 5;`
- Setelah check-in, reservasi jadi CONFIRMED: `SELECT status, count(*) FROM ms_project_bay_schedule GROUP BY status;`
- Prasyarat: migrasi `20260728` (5 kolom `ms_*`) & `20260730` (`sow.people_required`) sudah dijalankan; varian Cikupa = `manufacturing` (`GET /api/config`).

**Perilaku yang benar (bukan bug):**
- Header kolom MS Project tampil `Text4`/`Text5`, bukan "MPS Area"/"MPS Bay" — rename manual via klik-kanan kolom → Field Settings (auto-rename sengaja tak dipakai karena bikin "Automation error").
- PIN device-bay `12345` cuma penghalang di sisi tablet (bukan keamanan server) — cukup untuk LAN pabrik.
- Order yang belum di-Map ke MS Project → daftar task kosong di Scheduling Area (Map SAP Operations dulu).
