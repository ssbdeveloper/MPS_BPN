# MS Project VBA v2 — Integrasi MPS2 ("PWA Lite")

Modul VBA untuk MS Project desktop sebagai **editor**, dengan server MPS2 sebagai
**source of truth** (metadata + file `.mpp`), plus Hub web di `/ms-project-hub`.

Versi lama ada di `docs/archive/additional/ms project/` — **jangan dipakai lagi**;
folder ini (`tools/msproject-v2/`) adalah versi aktif.

## Perubahan v2 dibanding v1

| Area | v1 | v2 |
|---|---|---|
| Base URL, timeout, TLS, timezone | Hard-coded `Const` di `ms_config.bas` | File `%APPDATA%\mps-msproject\config.ini` (lihat `config.ini.example`), fallback ke default |
| Verifikasi TLS | Selalu dimatikan (`Option(4)=13056`) | Opsi `verify_tls` (default `false` — samakan dulu dengan perilaku lama; aktifkan saat sertifikat sudah dipasang) |
| Timezone tanggal | `+07:00` (WIB — **salah**, server = WITA) | `tz_suffix` config, default `+08:00` |
| Macro pengguna | ±16 macro campur debug | 8 macro alur kerja (di `ms_sync.bas`) + debug terpisah (`ms_debug.bas`) |
| Pilih project | Ketik UUID manual (`Ms_ImportProjectById`) | `Ms_OpenFromServer` — daftar bernomor, pilih nomor |
| Status `TRIAL` | Konvensi VBA, tidak dikenal server | Dihapus; lifecycle resmi server: `DRAFT / ACTIVE / ARCHIVED` |

## Cara pasang

1. Buka MS Project → Alt+F11 (VBE) → import semua `.bas` di folder ini
   (`JsonConverter.bas` wajib; hapus dulu modul v1 kalau ada).
2. Salin `config.ini.example` ke `%APPDATA%\mps-msproject\config.ini`, sesuaikan `base_url`.
3. Jalankan `Ms_CheckConnection` untuk tes.

## Alur harian planner

```text
Buka project lama : Ms_OpenFromServer  (pilih nomor dari daftar)
Mulai edit        : Ms_CheckOut        (ambil lock)
Simpan            : Ms_SaveToServer    (sync metadata + upload .mpp, revisi naik)
Selesai           : Ms_CheckIn         (lepas lock)

Project baru      : Ms_PublishNewProject
File copy         : Ms_CloneAsNewProject lalu Ms_PublishNewProject
Tandai published  : Ms_PublishCurrentRevision (setelah SaveToServer)
```

> **File "dianggap baru" saat checkout?** Identitas project ada di `Text30` (project_id) di dalam `.mpp`.
> Tombol **Download .mpp** di web = salinan arsip; kalau blob-nya kehilangan id (file lama), `Ms_CheckOut`
> mengira ini project baru. Untuk edit yang andal pakai **`Ms_OpenFromServer`** (bangun ulang + cap id).
> Punya file lokal yang kehilangan id -> **`Ms_LinkToServerProject`** (ms_ui): pilih project server, id
> di-set ulang (+ revision_no), lalu `Ms_CheckOut` jalan normal (bukan Publish New). Simpan file (Ctrl+S)
> agar tautan menetap.

Lock tidak kedaluwarsa (keputusan 2026-07-07). Lock nyangkut dilepas admin
lewat Hub web (`/ms-project-hub` → Force Check-In).

## Macro

### `ms_sync.bas` (alur utama)
| Macro | Fungsi |
|---|---|
| `Ms_CheckConnection` | Tes koneksi API + tampilkan base URL aktif |
| `Ms_OpenFromServer` | Daftar 30 project terbaru → pilih nomor → import ke file aktif |
| `Ms_CheckOut` | Ambil lock edit; deteksi lock lama yang masih valid |
| `Ms_SaveToServer` | Sync metadata (409 bila revisi stale, 423 bila lock hilang) + upload `.mpp` |
| `Ms_CheckIn` | Konfirmasi "sudah save?", lalu lepas lock |
| `Ms_PublishNewProject` | Simpan file aktif sebagai project baru + upload `.mpp` |
| `Ms_PublishCurrentRevision` | Tandai revisi DB sekarang sebagai published |
| `Ms_CloneAsNewProject` | Hapus UUID agar file bisa dipublish sebagai project baru |
| `Ms_LoadProjectTeam` | Muat resource project ke Resource Sheet |

### `ms_config.bas`
`Ms_ReloadConfig` — muat ulang config.ini tanpa restart MS Project.

### `ms_debug.bas` (diagnostik / recovery)
`Ms_UploadCurrentProjectFile` (retry upload), `Ms_HeartbeatCurrentProject`,
`Ms_CheckResourceConflicts`, `Ms_DebugCurrentMppPath`,
`Ms_DebugSaveCurrentProjectForUpload`, `Ms_DebugUploadCurrentProjectFileOnly`,
`Ms_DebugBuildPayload`.

## Field mapping MS Project

| Data | Field |
|---|---|
| `project_id` | `ProjectSummaryTask.Text30` |
| `revision_no` | `ProjectSummaryTask.Text29` |
| `mode` | `ProjectSummaryTask.Text28` |
| `lock_token` | `ProjectSummaryTask.Text27` |
| `project calendar_id` | `ProjectSummaryTask.Text26` |
| `task_id` / `task project_id` / `parent_task_id` / `task calendar_id` | `Task.Text10/11/12/13` |
| `order_no` / `operation_no` / `ssbr_id` | `Task.Text1/2/3` |
| **`area_code` (MPS Area)** / **`bay_codes` (MPS Bay)** | **`Task.Text4/5` — read-only (lihat catatan)** |
| `resource_id` / `resource calendar_id` | `Resource.Text9/8` |
| `assignment_id` | `Assignment.Text10` |

### Kolom `MPS Area` / `MPS Bay` (Task.Text4 / Text5) — web-authoritative, read-only

Kolom task `Text4` (**MPS Area** = `area_code`, mis. `AREA-05`) dan `Text5`
(**MPS Bay** = daftar `bay_codes` gabungan koma, mis. `A22, A21`) diisi dari
package server saat **import/Open** (`ms_import.bas`), berasal dari reservasi
`ms_project_bay_schedule` per-task di web. Fungsinya: scheduler desktop bisa
melihat Area/Bay tiap task langsung di MS Project.

- **Sumber kebenaran = WEB.** Kolom ini **display-only**: `ms_serializer.bas` hanya
  mengirim `Text1/2/3` untuk task, jadi `Text4/Text5` **tidak pernah** dikirim balik
  saat `Ms_SaveToServer`/sync. Mengedit kolom ini di MS Project **tidak** mengubah
  Area/Bay di server — akan ditimpa ulang pada import berikutnya.
- Header kolom default tetap `Text4` / `Text5`. Rename jadi `MPS Area` / `MPS Bay`
  **manual** di MS Project (klik kanan kolom → Field Settings → Title). Rename via VBA
  (`CustomFieldRename`) SENGAJA tak dipakai: dengan `Option Explicit` aktif, konstanta
  `pjCustomTaskText*` yang tak dikenal library membuat modul gagal compile → "Automation error"
  saat import (versi stabil di `docs/archive` juga tak pernah memakainya).
- `Text4/Text5` **tidak** dibersihkan oleh `MsClearAllDatabaseIds` (bukan ID DB;
  di-refresh tiap import).
- ⚠️ Jangan menambahkan `Text4/Text5` ke `ms_serializer.bas` — akan meng-clobber
  Area/Bay yang di-set web (lihat komentar peringatan di `MsTaskJson`).

## Endpoint yang dipakai (base: `<base_url>` dari config)

Sama dengan v1 (`/health`, `/projects`, `/projects/:id/package|checkout|heartbeat|sync|publish|checkin|file`,
`/resources*`, `/calendars*`) — ditambah dukungan server baru untuk Hub:
`GET /projects/:id/file` (download), `GET /projects/:id/revisions`, `PUT /projects/:id/status`.

## Catatan

- Sync existing wajib `project_id` + `revision_no` + `lock_token` (checkout dulu).
- Task baru wajib `local_task_uid` dari `Task.UniqueID`.
- File `.mpp` server selalu **overwrite** satu file per project (keputusan 2026-07-07);
  riwayat metadata tetap tersimpan per revisi di `ms_project_revision`.
- Untuk upload `.mpp`, file aktif harus sudah pernah Save As `.mpp` lokal.
