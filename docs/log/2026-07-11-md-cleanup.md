---
tags: [decision-log]
date: 2026-07-11
topic: Audit & pembersihan file .md
---

# 2026-07-11 — Pembersihan dokumen .md

Audit 100 file .md tracked (analisis isi ~45 file meragukan). Keputusan user:
Tingkat 1 dihapus, Tingkat 2 diisolasi.

## Dihapus (28) — menyesatkan / superseded
- `docs/frontend/`: 10 laporan era demo (React 18/Router v6/path lama)
- `docs/archive/`: MIGRASI-SELESAI, MIGRATION-SUMMARY, ms_requirement 1+2 (merged ke
  ms_planning), manualbook end-user lama
- `docs/archive/mpsobsidian/`: CLIsheet (duplikat byte-identik), Welcome, GPT, output,
  COMPONENT_TRACKING_DATA_FLOW, MPS_DASHBOARD_TODO, refactor, benerin
- `docs/operations/`: DEV-GUIDE, QUICK-START (app demo lama; QUICKSTART.md Juli TETAP ada)
- `docs/timesheet/EARLY_WARNING_SYSTEM_PLAN.md` (superseded EWS_DETAIL) — 2 referensi diperbaiki
- `database/schema/SCHEMA.md` (snapshot Feb, 11 tabel vs realitas 92 — berbahaya)
- `apps/web/CLAUDE.md` (dihapus lebih awal hari ini — untracked, stale)

## Diselamatkan sebelum hapus
- `mpsobsidian/Untitled.md` → [[timesheet/UAT_SAP_POSTING]] (12 skenario UAT SAP-posting
  masih valid; referensi halaman "V2" diperbaiki)

## Diisolasi (20) → `docs/_isolasi/` (hapus final ≥ 2026-09-01 bila tak dicari)
BOTTLENECK_ANALYSIS, api-db-performance-actions, connectiontail, ms_planning,
ms_project_PRD, VBA_SUMMARY, SOW_STANDARD_PLAN, MPS_DASHBOARD_SPEC,
MPS_Dashboard_Task_Spec, sow nnva to do, sow_history_todo, TTS task,
scheduling system, scheduling refactor, DEPLOY_ANALYSIS, REVISION_NOTES,
bpn_migration_report, task_etl, etl_sync_v2_analysis, tahapan-ews-build-journal
(dari root repo).

## Tetap dipertahankan (anomali yang dicatat)
- `docs/archive/mpsobsidian/cheatsheet.md` — di arsip tapi AKTIF diedit user; kandidat
  merge dengan `docs/operations/cheatsheet.md` (juga sedang diedit) → satu cheatsheet.

## Struktur manajemen baru
- [[PLANNING]] — papan todo/review/backlog/done (satu baris per rencana)
- [[00-INDEX]] — MOC vault
- `docs/log/` — log keputusan per sesi

## Audit SQL — EKSEKUSI 2026-07-11 (user setuju rekomendasi 1, 2, 4)
- **#1 DONE**: `schema_prod.sql` di-regenerate dari prod (86 tabel, exclude schema backup).
- **#2 DONE**: 7 dump drift dihapus (schema, local_schema, bpn_schema, init_database,
  BEGIN;, db, schema_prod_20260707) — referensi CLAUDE.md + DEPLOYMENT.md diperbaiki.
- **#4 DONE**: ledger `public.schema_migrations` dibuat + backfill 46 file (1 SKIPPED:
  20260513 cache, N3) + runner `database/migrate.js` (dry-run: 0 pending).
- **#3 SEBAGIAN**: legacy destruktif `migrate_bpn_to_ptssb.sql` DIHAPUS (satu-satunya
  yang DROP/TRUNCATE); file nyasar `migrations/api/ssh guide.55 via tailscal` BELUM
  dipindah (belum disetujui).
- **#5 DONE**: baris `mst_job` dihapus dari CLAUDE.md + section "Dokumentasi & Second
  Brain" ditambahkan (menunjuk [[KONVENSI]], concepts/, log/, PLANNING).

### Temuan audit awal (arsip)
Dibandingkan langsung vs prod (62 public + 16 ews + 7 tools_mgmt + 1 rbac + 7 backup):
- **Kanonik:** `schema_prod_20260707.sql` (92 tabel) — satu-satunya dump yang benar;
  kini sedikit basi (machine_heartbeat di-drop, index berubah 2026-07-11) → regenerate.
- **Menyesatkan:** `schema.sql` (20 tabel, punya ghost `mst_job` yang TIDAK ada di prod,
  bolong 43 tabel), `local_schema.sql` (37, bolong 25+), `bpn_schema.sql`,
  `init_database.sql`, `BEGIN;.sql`, `db.sql` — semua snapshot era lama.
- **Berbahaya bila dijalankan:** `migrations/legacy/migrate_bpn_to_ptssb.sql` (DROP TABLE),
  `migrations/api/20260705_sow_verification_layer.sql` (DROP+recreate, hanya aman di tabel kosong).
- **Belum pernah diterapkan di prod (menyesatkan by omission):**
  `migrations/api/20260513_create_mch_productiondata_detail_cache.sql` (objek tak ada di prod — N3).
- **Nyasar:** file non-SQL `migrations/api/ssh guide.55 via tailscal`.
- **Catatan CLAUDE.md:** masih mencantumkan `mst_job` sebagai tabel kunci — tabel itu tidak ada di prod.
