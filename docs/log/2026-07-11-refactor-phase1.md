---
tags: [decision-log, domain/ops]
date: 2026-07-11
topic: Eksekusi REFACTOR_PLAN Phase 1 + audit index
---

# 2026-07-11 — Refactor Phase 1: bloat, constraints, secrets

## Konteks
Keluhan awal "DB lemot karena kolom tak terpakai" → diagnosis terukur membuktikan penyebab
sebenarnya: bloat index + tabel time-series mati. Lihat [[operations/INDEX_AUDIT_2026-07-11]].

## Keputusan & eksekusi (produksi, dikonfirmasi per-statement)
1. **Kanban MV 445 MB → 2,2 MB** — drop 4 index tak terpakai + REINDEX CONCURRENTLY.
2. **Drop 12 index lifetime-unused** di `timesheet_transaction`/`sow` — 2 di antaranya
   duplikat literal index terpanas. EXPLAIN membuktikan index trigram search tak akan
   pernah dipakai (query date-anchored / tabel kecil) → drop, bukan rebuild.
3. **D-R3 payroll constraints**: `fk_timesheet_user` VALIDATED; unique index
   `sow_standard(component_id, operation_no)`; baris usernfc idrow=180 (sampah, dikonfirmasi
   user) dihapus; `snssb NOT NULL`.
4. **DROP `public.machine_heartbeat`** (268 MB) — sudah digantikan `ews.machine_heartbeat_daily`,
   0 pembaca. DB total ~1,8 GB → 1.264 MB.
5. **S-R1 env-ify secrets** — password wajib dari env/.env (fail-fast), 7 script + 1 controller;
   docs di-scrub; `.pyc` ber-kredensial di-untrack. **Rotasi password masih tugas user.**
6. **A-R4**: status KPI EWS dievaluasi dari nilai unrounded.
7. **F-R1**: 4 halaman PE fallback `'/api'` (bukan `localhost:3001`).
8. Kode mati dihapus: fitur token (`routes/token.js`, `tokencontroller.js` — tak pernah
   di-mount, path require salah), `apps/web/CLAUDE.md` basi.

## Temuan yang membatalkan asumsi plan
- 431 staging rows PENDING → **sudah kosong** (dibersihkan aktor tak dikenal — konfirmasi via B3).
- D-R4 retention → **tidak perlu**; script heartbeat sudah jadi agregat daily.
- `MASTER_TOKEN` "hilang" → kode mati, bukan kredensial kurang.

## ⚠️ Pending (user action)
- [ ] Restart daemon heartbeat (mati sejak 2026-07-10 00:40) — butuh `OEE_SQLSERVER_PASSWORD`
      + `DB_PASSWORD` di `.env` host itu saat rebuild
- [ ] Rotasi password keluarga `@dmin*` (masih di git history)
- [ ] Rebuild container api agar perubahan `machineHoursSqlServerController` terpakai
- [ ] Jawab pertanyaan terbuka: [[security/AUTH_RBAC_DESIGN]] §7 + §5b, [[salvaging/SALVAGE_FLOW_DESIGN]] §10

## Berikutnya
Phase 2 [[REFACTOR_PLAN]]: A-R1 auth (design siap review), A-R3 satu jalur SAP, D-R1 migration ledger.

**Konsep tersentuh:** [[concepts/ukur-dulu-baru-refactor]] · [[concepts/payroll-data-path]]
