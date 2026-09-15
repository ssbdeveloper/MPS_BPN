---
title: Manufacturing progress — rombak UI + flag progress mandek & lonjakan EAC
date: 2026-09-14
tags: [manufacturing, ui, eac, progress, dashboard]
---

# Ringkasan

Dua pekerjaan dalam satu sesi atas `/dashboard/manufacturing-order-progress`:

1. **Rombak UI** (murni frontend) — border tegas, progress bar, ikon, tipografi
   lebih nyaman, animasi expand/collapse.
2. **Fitur flag** (keputusan owner: **opsi C ambang 10% + opsi D**) — deteksi
   "Act Hours naik tapi Progress tetap" DAN "EAC melonjak ≥10% dibanding update
   sebelumnya", dengan snapshot jam dibekukan saat update ditulis.

# Keputusan owner

- **C (ambang 10%)**: flag bukan hanya progress mandek, tapi juga lonjakan EAC
  ≥10% versus update sebelumnya.
- **D**: simpan snapshot jam aktual + EAC di `progress_update_history`, alasan
  owner: *"kemungkinan ada user merevisi timesheet, supaya histori konsisten"*.
  Menghitung ulang jam dari timesheet belakangan akan diam-diam menulis ulang
  angka yang dilaporkan update lama.

# Perubahan

## Database

`database/migrations/api/20260914_progress_update_hours_snapshot.sql`
- `progress_update_history` + `actual_hours_at_update numeric(12,2)`,
  `eac_hours_at_update numeric(12,2)`.
- Index `progress_update_history_operation_recent_idx (operation_id, created_at DESC, id DESC)`.
- Di-apply manual ke **CKP (5441) dan BPN (5434)** + dicatat di `schema_migrations`. Idempotent.

## Backend

- `apps/api/controllers/sowController.js` — `addProgressUpdate` menghitung
  `SUM(timesheet_transaction.duration)` operasi tersebut saat itu juga dan
  menyimpannya bersama EAC (`actual / (progress/100)`, NULL kalau progress 0).
- `apps/api/utils/progressUpdateTrend.js` (baru) — `buildUpdateTrend(row)`:
  delta jam/progress/EAC, `progress_stalled`, `eac_jumped` (EAC_JUMP_PCT = 10),
  `flags[]`. Baris tanpa pembanding → tidak ada flag (bukan false positive).
- `apps/api/controllers/manufacturingOrderProgressController.js` — CTE
  `recent_updates` + `update_trend` (2 update terakhir per operasi, dibaca dari
  kolom snapshot), `update_trend` per operasi, dan `progress_stalled_count` /
  `eac_jump_count` di level unit & project.

## Frontend (`apps/web/src/features/manufacturingProgress/`)

- `ManufacturingProgressOutline.jsx` — dirombak jadi shell tipis; header
  project/unit, expand beranimasi (AnimatePresence), border 2px + border-l-4
  berwarna health, chip hitungan flag.
- `OperationCard.jsx` (baru) — kartu operasi + sub-task, ikon, tabel
  "Last two updates" (Act hours / Progress / EAC previous vs latest).
- `ProgressVisuals.jsx` (baru) — ProgressBar (bar = progress dilaporkan, garis
  penanda = % jam terpakai di track yang sama), HealthBadge, Metric, StallFlag.
- `progressFormat.js` (baru) — formatter, HEALTH_META, `stallSignal()` yang
  memakai `update_trend` kalau ada, fallback ke perbandingan snapshot saat ini.
- `EvidenceHistoryModal.jsx` — `z-[60]`/`z-50` → `z-40`/`z-50` (deslop C6).

# Verifikasi

- `node --test utils/progressUpdateTrend.test.js` → 6/6, termasuk contoh owner
  (70h@40% → 90h@40%, EAC 175 → 225 = +28,57%) dan batas 10% (9,71% diam, 10% flag).
- `node --test controllers/manufacturingOrderProgress.test.js utils/*.test.js` → 23/23.
- SQL dieksekusi ke **CKP live**: 2.185 baris, 1,0 s (tanpa regresi).
- E2E di CKP dalam transaksi **ROLLBACK** (baris `ZZTEST-hermes`): flag
  PROGRESS_STALLED + EAC_JUMP terdeteksi dari SQL sungguhan; kasus di bawah
  ambang (+8,57%) tetap diam; `progress_update_history` kembali 0 baris.
- FE: eslint 0 error, vitest 4/4 (termasuk test flag baru), `npm run build` sukses.
- deslop `--staged` 0 error (2 warning C14 pra-ada di OrderProgressDashboardPage).

# Catatan / utang

- `progress_update_history` **kosong (0 baris) di CKP maupun BPN** per hari ini,
  jadi tidak ada backfill yang perlu dilakukan — kolom snapshot mulai terisi
  dari update pertama setelah deploy. Sebelum ada 2 update, flag memakai
  fallback snapshot (jam terpakai vs progress).
- `check_rbac_manifest.js` GAGAL dengan 2 write `sap-staging-exclusion` yang
  **pra-ada** (bukan dari sesi ini); tidak ada route baru ditambahkan.
