---
tags: [board]
updated: 2026-07-11
---

# 📌 Planning Board

> Satu papan untuk semua rencana. Aturan: setiap rencana adalah SATU dokumen dengan
> frontmatter `status:`. Papan ini hanya daftar link — sumber kebenaran ada di
> dokumennya. Selesai → pindahkan barisnya ke ✅ dan set `status: done`.

## 🏗️ Sedang dikerjakan (executing)

- [[REFACTOR_PLAN]] — refactor besar DB/API/frontend. Phase 1 ✅ · Phase 2 berikutnya: A-R1 auth, A-R3 satu jalur SAP, D-R1 migration ledger

## 👀 Menunggu review / keputusan

- [[security/AUTH_RBAC_DESIGN]] — token auth + RBAC enforce. **Blocker: jawaban §7 (expiry, library, cutoff, CORS) + §5b (3 write shopfloor)**
- [[salvaging/SALVAGE_FLOW_DESIGN]] — alur salvaging end-to-end. **Blocker: jawaban §10 (rate labour, harga parts, checklist QC, approval quote, breakdown, RBAC)**
- [[prd/manufacturing-variant]] — PRD varian manufacturing (beda vs salvaging). **Blocker: jawaban §7 (D1–D11: plant/WERKS, ZCONF_TYPE, sumber jam standar insentif, dll.)**

## 🔜 Backlog (belum dimulai)

- 🔴 **SAP: mekanisme STORNO** — guard sekarang hanya *mendeteksi* konflik (data sumber dikoreksi setelah ter-post); pembatalan kiriman salah di SAP masih **manual**. Lihat [[concepts/sap-staging-identity]]
- **SAP: baris non-M1/M2 ditolak** ("activity type only in conjunction with cost center") — perbaikan di sisi SAP (user). Uji: retry staging id 163444
- **SAP: 153 PENDING data 1 Juli** — cek posting period SAP sebelum posting massal

- 🔴 **URGENT — Aktifkan KPI `uptime_tablet` SEGERA** ([[EWS_PLAN]] §7.2): per 2026-07-13 kartunya **DIPALSUKAN kosmetik 100% di frontend** (`theme/ewsCosmetic.js`) atas keputusan owner. Angka di dashboard BUKAN data nyata sampai KPI asli hidup — pasang app heartbeat di armada tablet, hitung dari `ews.device_heartbeat_daily`, lalu HAPUS file kosmetiknya

- [[timesheet/PLANHOURS_GUARD_IMPLEMENTATION_PLAN]] — guard planhours (terverifikasi belum ada di kode)
- [[timesheet/Fitur Block Timesheet Tapping]] — spec block tapping (fitur yang sama, sisi user)
- [[MSPROJECT_PWA_LITE_PLAN]] — MS Project PWA lite
- Salvage Flow Fase 1 (backbone lifecycle) — menunggu design approved
- Rotasi password `@dmin*` — **user action**, masih di git history
- Restart daemon heartbeat — **user action**, mati sejak 2026-07-10

## ✅ Done

- 2026-07-14 — **SAP staging provenance + guard anti-double-post** ([[log/2026-07-14-sap-staging-provenance]]): `sap_staging_source` (backfill 156/156), unique index parsial (double-post mustahil di level DB), trigger pembekuan `mch_transaction`, guard konflik di poster
- 2026-07-12 — **EWS IL-last**: action_table pensiun; TTS pindah ke generator (otonom); correction queue → issue_log; manifest RBAC issue-log ditambal ([[EWS_PLAN]] §7.3)
- 2026-07-12 — **EWS Phase 6 drill-through** ([[EWS_PLAN]] §7.1): 6/6 kategori, semua teruji rekonsiliasi vs prod; halaman `/ews/issue/:issueKey` + 🔍 di Issue Log
- 2026-07-12 — **Device heartbeat**: app Android `apps/mobile` + endpoint + tabel + CI APK ([[EWS_PLAN]] §7.2 menunggu armada)
- 2026-07-12 — [[log/2026-07-12-ews-consolidation|Konsolidasi 7 dokumen EWS → EWS_PLAN]]
- 2026-07-11 — **D-R1 migration ledger** (`schema_migrations` + `database/migrate.js`) & **D-R2 schema kanonik** (`schema_prod.sql`, 7 dump drift dihapus)
- 2026-07-11 — [[log/2026-07-11-refactor-phase1|Refactor Phase 1]]: index bloat −443 MB, D-R3 constraints, S-R1 secrets, A-R4 rounding, F-R1 API base, drop machine_heartbeat
- 2026-07-11 — [[log/2026-07-11-md-cleanup|Audit & bersih-bersih dokumen .md]]: 28 dihapus, 20 diisolasi
- 2026-07-07 — [[REFACTOR_PLAN|Analisis refactor menyeluruh]] + verifikasi produksi (§8)
