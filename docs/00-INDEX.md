---
tags: [moc]
updated: 2026-07-11
---

# MPS2 — Peta Dokumen (MOC)

> Buka folder `docs/` ini sebagai vault Obsidian. Semua rencana, PRD, dan log keputusan
> hidup di sini, ter-versi git bersama kode. Konvensi: setiap dokumen rencana punya
> frontmatter `status: draft | review | approved | executing | done | superseded`.

## 📌 MULAI DI SINI

**[[PLANNING]]** — papan kerja: sedang dikerjakan / menunggu review / backlog / done.
**[[KONVENSI]]** — aturan main vault ini (4 lapisan, aturan link, cara AI memakainya).

## 🧠 Konsep (memori semantik — pengetahuan yang menetap)

- [[concepts/payroll-data-path]] — jalur data jam kerja → gaji (yang tidak boleh rusak)
- [[concepts/order-no-spine]] — tulang punggung order_no + ssbr_ident, struktur 2 tingkat
- [[concepts/ukur-dulu-baru-refactor]] — pelajaran: diagnosis performa pakai data, bukan asumsi

## 🎯 Rencana aktif

| Dokumen | Status | Ringkas |
|---|---|---|
| [[REFACTOR_PLAN]] | executing | Refactor besar DB/API/frontend — progres ditandai inline per item |
| [[security/AUTH_RBAC_DESIGN]] | review | Token auth + RBAC enforcement (A-R1) — menunggu jawaban §7 + §5b |
| [[salvaging/SALVAGE_FLOW_DESIGN]] | review | Alur salvaging end-to-end: lifecycle 2 tingkat, QC, Quote — menunggu jawaban §10 |

## 📋 PRD

*(belum ada — PRD fitur baru masuk `prd/`)*

## 🗄️ Migration & Database

- [[operations/INDEX_AUDIT_2026-07-11]] — audit index & bloat produksi (bukti + verdikt)
- SQL migration files: `database/migrations/api/` (di luar vault — hanya rencananya yang di sini)
- Rencana migration ledger: [[REFACTOR_PLAN#3.2 Recommendations|D-R1 di REFACTOR_PLAN]]

## 📓 Log keputusan (per sesi kerja)

- [[log/2026-07-11-refactor-phase1]] — eksekusi Phase 1+: index drop, D-R3, S-R1, heartbeat
- [[log/2026-07-11-md-cleanup]] — audit .md: 28 dihapus, 20 diisolasi

## 📚 Operasional

- [[operations/cheatsheet]] — cheatsheet operasional
- `Work Instruction/` — instruksi kerja
- `sap/` — dokumentasi SAP aktif

## 🗃️ Arsip & Isolasi

- [[_isolasi/README|_isolasi/]] — 20 file historis kandidat hapus (deadline keputusan: 2026-09-01)
- `archive/` — sisa arsip (VBA .bas lama, dll). Catatan: `archive/mpsobsidian/cheatsheet.md` masih aktif diedit — kandidat merge ke `operations/cheatsheet.md`
