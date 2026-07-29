---
type: guide
tags: [domain/msproject, domain/timesheet]
---

# UAT Checklist — Manufaktur: Check-in + Area→Bay + MS Project VBA

> Uji end-to-end fitur slice [[MSPROJECT_COLLAB_HARDENING_PLAN]] §6: web assign **task→bay**,
> MS Project menampilkan **MPS Area/Bay** per task, operator **check-in single/multiple**.
> Plan induk: [[MSPROJECT_PWA_LITE_PLAN]]. Konteks manufaktur yang sudah ada:
> [[timesheet/MANUFACTURING_VERSION_UAT]].
>
> Isi kolom **Status**: ✅ lulus · ❌ gagal · — belum diuji. Catat error/observasi di **Catatan**.
> Dibuat 2026-07-29.

## 0. Prasyarat lingkungan

| # | Item | Cara cek | Status | Catatan |
|---|---|---|---|---|
| P1 | Migrasi `20260728` ter-apply di DB Cikupa | `\d timesheet_transaction` → ada 5 kolom `ms_*` | ✅ 2026-07-28 | via psql 5441 |
| P2 | Kode task-level live di Cikupa | `GET /api/ms-project/sow-orders/1/tasks` → 200 | ✅ | dulu 404 |
| P3 | Varian Cikupa = manufacturing | `GET /api/config` → `variant=manufacturing` | ✅ | plant 5100 |
| P4 | SOCKS proxy Tailscale up | `127.0.0.1:1055` listening | — | `tailscale-start.sh` bila mati |
| P5 | Forwarder HTTPS jalan | `pg_socks_tunnel.py … 8443` + `curl -k …/health` → 200 | — | biarkan jendela terbuka |

## A. Setup MS Project VBA (sekali per mesin)

| # | Langkah | Hasil diharapkan | Status | Catatan |
|---|---|---|---|---|
| A1 | Alt+F11 → import **semua** `.bas` `tools/msproject-v2/` (JsonConverter wajib; **ms_auth.bas kini modul WAJIB**; hapus modul v1) | Compile bersih (Debug → Compile VBAProject: tanpa error) | — | import modul wiring (ms_sync/ms_serializer/ms_calendars) **tanpa ms_auth = gagal compile** (`MsCurrentActor`/`gCurrentUser` undefined) |
| A2 | Import **UserForm** `frmLogin` (login) & `frmProjectPicker` (picker Ms_OpenFromServer) | Kedua form muncul di tree VBAProject; compile tetap bersih | — | frmLogin dipakai `Ms_Login`; tanpa form ini macro login gagal |
| A3 | Tak set Tools→References | Late binding — biarkan default | — | |
| A4 | `config.ini` di `%APPDATA%\mps-msproject\`: `base_url=https://127.0.0.1:8443/api/ms-project`, `verify_tls=false`, `tz_suffix=+08:00` | Config kebaca | — | login POST ke **sibling** `/api/auth/login` (base_url tanpa `/ms-project`) |

## B. Konektivitas & lifecycle MS Project (`ms_sync.bas`)

| # | Macro | Hasil diharapkan | Status | Catatan |
|---|---|---|---|---|
| B1 | `Ms_CheckConnection` | Tampil base URL + `service: ms-project / connected` | — | gagal → cek forwarder/URL (`/api`, `https`) |
| B2 | `Ms_OpenFromServer` → pilih nomor | Daftar 30 project → import lolos **tanpa "Automation error"** | — | fix `CustomFieldRename` sudah masuk |
| B3 | `Ms_CheckOut` | Dapat lock; Hub `/ms-project-hub` tampil "Checked Out by …" | — | |
| B4 | edit → `Ms_SaveToServer` | Sukses, `revision_no` naik | — | 409 = revisi stale, 423 = lock hilang |
| B5 | `Ms_PublishCurrentRevision` (opsional) | Revisi ditandai published | — | |
| B6 | `Ms_CheckIn` | Lock lepas (Hub kembali "Available") | — | |

## C. Fitur BARU — web assign task→bay → MS Project

| # | Langkah | Hasil diharapkan | Status | Catatan |
|---|---|---|---|---|
| C1 | Web → Scheduling Area: pilih order → **pilih operasi/task** → taruh ke bay (tanggal mencakup hari ini) | Toast "N task direservasi di <bays>" | — | order harus sudah di-map ke MS Project dulu |
| C2 | MS Project: `Ms_OpenFromServer` project itu → Insert kolom **Text4** & **Text5** | Task ter-assign menampilkan **Area** (Text4) & **Bay** (Text5) | — | rename header opsional via Field Settings |
| C3 | Round-trip: `Ms_CheckOut`→edit→`Ms_SaveToServer`→`Ms_CheckIn`→`Ms_OpenFromServer` | Area/Bay **tidak berubah** (web otoritatif; MSP tak clobber) | — | |
| C4 | Assign ke **Blasting** (AREA-18) lalu ulangi C1–C2 | Reservasi blasting muncul, tak hilang | — | dulu bug: 'BLASTING'≠'AREA-18' |

## D. Check-in operator (web, tablet Cikupa)

| # | Langkah | Hasil diharapkan | Status | Catatan |
|---|---|---|---|---|
| D1 | Select Machine (pilih grup/workcenter) → Select Job (area+bay device) | Task muncul, **terfilter grup** (FAB lihat FAB, dst) | — | |
| D2 | Check-in mode **Single** | Tutup baris terbuka lain → pindah `/login-timesheet` | — | |
| D3 | Check-in mode **Multiple** | Tetap di halaman, menumpuk baris produktif terbuka | — | |
| D4 | Ubah **Device Area/Bay** | Minta **PIN** (`12345`) sebelum berubah | — | client-side gate |

## E. Verifikasi DB (via tunnel `127.0.0.1:5441`)

| # | Query | Hasil diharapkan | Status | Catatan |
|---|---|---|---|---|
| E1 | `SELECT ms_task_id, ms_area_code, ms_bay_schedule_id FROM timesheet_transaction ORDER BY tsnumber DESC LIMIT 5;` | Kolom `ms_*` terisi utk check-in manufaktur | — | |
| E2 | `SELECT status,count(*) FROM ms_project_bay_schedule GROUP BY status;` | Ada `CONFIRMED` setelah check-in | — | flip `RESERVED→CONFIRMED` |

## F. Login & identitas actor (`ms_auth.bas` + `frmLogin`)

| # | Langkah | Hasil diharapkan | Status | Catatan |
|---|---|---|---|---|
| F1 | `Ms_Login` → isi user & password valid | MsgBox **"Berhasil login sebagai: <user>"**; `gCurrentUser` terisi | — | POST `/api/auth/login` (sibling, bukan `/ms-project`) |
| F2 | `Ms_WhoAmI` | Tampil **username** yang sedang login | — | belum login → tampil fallback `ms-project-vba` |
| F3 | `Ms_CheckOut` lalu buka Hub `/ms-project-hub` | Lock tampil **"Checked out by <user>"** (username login, **bukan** `ms-project-vba`) | — | actor = `MsCurrentActor()` = username login |
| F4 | Belum login → langsung `Ms_CheckOut` / save | Jalan **tanpa error**; actor **fallback** `ms-project-vba` | — | login opsional; identitas default aman |
| F5 | `Ms_Login` → password **salah** | `frmLogin` **`lblStatus` merah** (gagal login); `gCurrentUser` tidak berubah | — | actor tetap fallback bila belum pernah login |

## Bug ditemukan saat UAT

| ID | Langkah | Gejala | Err.Number / Description | Severity | Status |
|---|---|---|---|---|---|
| | | | | | |

## Catatan diketahui (bukan bug)
- Header kolom MS Project tampil `Text4`/`Text5` (bukan "MPS Area"/"MPS Bay") — auto-rename via VBA sengaja dibuang (bikin "Automation error"); rename manual di Field Settings.
- Password device-bay `12345` = client-side only (bisa di-bypass devtools) — cukup untuk model tablet LAN; belum PIN server-side.
- Order yang belum di-map ke MS Project → picker task di Scheduling Area kosong (perlu Map SAP Operations dulu).
