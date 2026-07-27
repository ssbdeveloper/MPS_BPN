---
tags: [domain/msproject]
---

# Runbook — MS Project Hub & Integrasi VBA v2

Tanggal: 2026-07-07. Pasangan dokumen: `docs/MSPROJECT_PWA_LITE_PLAN.md` (rencana)
dan `tools/msproject-v2/README.md` (sisi MS Project/VBA).

## Komponen

| Komponen | Lokasi | Fungsi |
|---|---|---|
| Hub web | `/ms-project-hub` (alias lama: `/ms-project-admin`) | Daftar semua project, status, lock, file, riwayat revisi, ubah status, force check-in (admin) |
| API | `/api/ms-project/*` (Express) | Simpan/muat project, lock, revisi, file `.mpp` |
| Editor | MS Project + VBA `tools/msproject-v2/` | Publish / open / checkout / save / checkin |
| File `.mpp` | `apps/api/uploads/ms-project-mpp/{project_id}.mpp` | Satu file per project, overwrite tiap save |

## ⚠️ SEBELUM DIPAKAI DI PRODUKSI — terapkan migrasi

Per 2026-07-07 database produksi `ptssb` baru punya migrasi dasar (tabel
`ms_project*` tanpa lock/file/revision — terverifikasi langsung). Terapkan
berurutan (semua di `database/migrations/api/`):

```text
1. 20260603_create_ms_project_integration.sql      (sudah terpasang di prod)
2. 20260604_dedupe_ms_project_dependencies.sql
3. 20260610_ms_project_calendar_scheduling.sql
4. 20260610_ms_project_lock_publish_audit.sql
5. 20260616_ms_project_file_storage.sql
6. 20260618_ms_project_bay_schedule.sql
7. 20260707_ms_project_status_lifecycle.sql        (baru — status DRAFT/ACTIVE/ARCHIVED)
```

Tanpa langkah 4 dan 5, checkout/checkin/upload/download akan gagal (tabel/kolom belum ada).

## Alur pengguna (planner)

1. Buka MS Project → `Ms_OpenFromServer` → pilih nomor project.
2. `Ms_CheckOut` — project terkunci atas nama kamu (terlihat di Hub).
3. Edit di MS Project.
4. `Ms_SaveToServer` — metadata tersimpan (revisi naik) + `.mpp` ter-upload.
5. `Ms_CheckIn` — lock dilepas.

Project baru: `Ms_PublishNewProject`. Salinan file: `Ms_CloneAsNewProject` dulu.

## Alur admin (Hub web)

- **Lock nyangkut** (badge merah "Lock > 24 jam"): baris project → tombol force
  check-in (ikon perisai, hanya muncul untuk role administrator) → isi alasan.
  Catatan: perubahan yang belum di-`Ms_SaveToServer` oleh pemilik lock hilang.
- **Download `.mpp`**: ikon unduh pada baris project (nama file `{nama}-rev{N}.mpp`).
- **Riwayat**: ikon jam — daftar revisi (CREATE/SYNC/PUBLISH/FORCE_CHECKIN, oleh siapa, kapan).
- **Ubah status**: dropdown DRAFT / ACTIVE / ARCHIVED per baris.
  ARCHIVED hanya menandai; tidak menghapus data ataupun file.

## Keputusan desain (2026-07-07)

| Topik | Keputusan |
|---|---|
| Lifecycle status | `DRAFT / ACTIVE / ARCHIVED`; nilai lama `TRIAL` dipetakan ke `DRAFT` |
| Lock TTL | Non-expiring; pelepasan paksa hanya via force check-in |
| TLS VBA | `verify_tls` di config.ini, default `false`; aktifkan saat pindah IP lokal + sertifikat |
| Akses Hub | PIN (`ProtectedRoute`); RBAC menyusul saat backend RBAC di-redevelop |
| File `.mpp` | Overwrite satu file per project (tidak menumpuk); riwayat metadata di `ms_project_revision` |

## Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `409 PROJECT_REVISION_CONFLICT` saat save | File lokal memakai revisi lama (orang lain sudah save) | `Ms_OpenFromServer` ulang, edit ulang di atas revisi terbaru |
| `423 PROJECT_LOCK_*` | Lock dilepas/diambil sesi lain (mis. force check-in) | `Ms_CheckOut` ulang |
| `409 PROJECT_LOCKED` saat checkout | Project dipegang user lain | Koordinasi, atau admin force check-in di Hub |
| Upload `.mpp` gagal setelah save sukses | Koneksi/file belum pernah Save As lokal | Save As `.mpp` lokal → `Ms_UploadCurrentProjectFile` (modul ms_debug) |
| Hub: "Belum ada file" | Project pernah di-save sebelum migrasi file storage, atau upload gagal | Jalankan `Ms_UploadCurrentProjectFile` dari MS Project |
| Ganti IP server | — | Edit `base_url` di `%APPDATA%\mps-msproject\config.ini` → `Ms_ReloadConfig` |
