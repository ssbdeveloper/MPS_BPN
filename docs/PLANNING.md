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

## 🔜 Backlog (belum dimulai)

- [[timesheet/PLANHOURS_GUARD_IMPLEMENTATION_PLAN]] — guard planhours (terverifikasi belum ada di kode)
- [[timesheet/Fitur Block Timesheet Tapping]] — spec block tapping (fitur yang sama, sisi user)
- [[MSPROJECT_PWA_LITE_PLAN]] — MS Project PWA lite
- Salvage Flow Fase 1 (backbone lifecycle) — menunggu design approved
- Rotasi password `@dmin*` — **user action**, masih di git history
- Restart daemon heartbeat — **user action**, mati sejak 2026-07-10

## ✅ Done

- 2026-07-11 — **D-R1 migration ledger** (`schema_migrations` + `database/migrate.js`) & **D-R2 schema kanonik** (`schema_prod.sql`, 7 dump drift dihapus)
- 2026-07-11 — [[log/2026-07-11-refactor-phase1|Refactor Phase 1]]: index bloat −443 MB, D-R3 constraints, S-R1 secrets, A-R4 rounding, F-R1 API base, drop machine_heartbeat
- 2026-07-11 — [[log/2026-07-11-md-cleanup|Audit & bersih-bersih dokumen .md]]: 28 dihapus, 20 diisolasi
- 2026-07-07 — [[REFACTOR_PLAN|Analisis refactor menyeluruh]] + verifikasi produksi (§8)
