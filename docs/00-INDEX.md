---
tags: [moc, domain/vault]
updated: 2026-07-24
---

# MPS2 — Peta Dokumen (MOC)

> Buka folder `docs/` ini sebagai vault Obsidian. Semua rencana, PRD, dan log keputusan
> hidup di sini, ter-versi git bersama kode. Konvensi: setiap dokumen rencana punya
> frontmatter `status: planning | active | done | parked` (dokumen kerja saja).

## 📌 MULAI DI SINI

**[[PLANNING]]** — papan kerja: sedang dikerjakan / menunggu review / backlog / done.
**[[STATUS]]** — papan status otomatis (Dataview): apa yang active / planning / done / parked.
**[[KONVENSI]]** — aturan main vault ini (4 lapisan, aturan link, cara AI memakainya).

## 🧠 Konsep (memori semantik — pengetahuan yang menetap)

- [[concepts/payroll-data-path]] — jalur data jam kerja → gaji (yang tidak boleh rusak)
- [[concepts/sap-staging-identity]] — kenapa `source_key` rapuh, ZTIMESHEETID menipu, dan segmen adalah jangkar yang benar
- [[concepts/mch-interval-normalization]] — normalisasi interval jam mesin (`end_effective`), guard-hole, constraint anti-overlap — **fitur guard overlapping**
- [[concepts/sap-machine-hours-reconciliation]] — telusuri jam mesin → staging → POSTED, kenapa total UI ≠ CSV SAP, pembulatan SAP tak bisa dipalsukan
- [[concepts/order-no-spine]] — tulang punggung order_no + ssbr_ident, struktur 2 tingkat
- [[concepts/ukur-dulu-baru-refactor]] — pelajaran: diagnosis performa pakai data, bukan asumsi
- [[concepts/ews-roster]] — rotasi 2-kru, roster beku, dan cara `adoption_labour` memakainya
- [[concepts/ews-roster-override]] — lapisan override saat baca: shift-lock, operator nonaktif (`inactive_from`), VIEW `roster_effective`, dan koreksi snapshot beku
- [[concepts/codebase-memory-graph-accuracy]] — batas akurasi graph cbm: handler `exports.X = fn` tak jadi node, CALLS Python cross-file bisa hilang — validasi impact analysis ke sumber

## 🎯 Rencana aktif

> **Status hidup di [[STATUS]]** (board Dataview) — sumber kebenaran. Tabel ini hanya daftar + ringkas.

| Dokumen | Ringkas |
|---|---|
| [[EWS_PLAN]] | **Master plan EWS tunggal** (8 KPI, issue log, drill-through) — 7 dokumen lama dilebur ke sini 2026-07-12 |
| [[REFACTOR_PLAN]] | Refactor besar DB/API/frontend — progres ditandai inline per item |
| [[security/AUTH_RBAC_DESIGN]] | Token auth + RBAC enforcement (A-R1) — menunggu jawaban §7 + §5b |
| [[salvaging/SALVAGE_FLOW_DESIGN]] | Alur salvaging end-to-end: lifecycle 2 tingkat, QC, Quote — menunggu jawaban §10 |

## 📋 PRD

| Dokumen | Ringkas |
|---|---|
| [[prd/manufacturing-variant]] | Varian manufacturing: peta beda vs salvaging, FR-0..8, keputusan terbuka D1–D11 |

## 🗄️ Migration & Database

- [[operations/INDEX_AUDIT_2026-07-11]] — audit index & bloat produksi (bukti + verdikt)
- SQL migration files: `database/migrations/api/` (di luar vault — hanya rencananya yang di sini)
- Rencana migration ledger: [[REFACTOR_PLAN#3.2 Recommendations|D-R1 di REFACTOR_PLAN]]

## 📓 Log keputusan (per sesi kerja)

- **Guard overlapping jam mesin** (baca berurut): [[log/2026-07-22-mch-stuck-blocks]] (detektor blok nyangkut) → [[log/2026-07-22-mch-normalisasi-lapis]] (lapis 1a/1b/2 + hotfix ETL) → [[log/2026-07-23-mch-recompute-scope-guardhole]] (lingkup kandidat + guard-hole) → [[log/2026-07-24-sap-reconciliation-drilldown]] (rekonsiliasi CSV + tab drill-through)
- [[log/2026-07-11-refactor-phase1]] — eksekusi Phase 1+: index drop, D-R3, S-R1, heartbeat
- [[log/2026-07-11-md-cleanup]] — audit .md: 28 dihapus, 20 diisolasi
- [[log/2026-07-12-ews-consolidation]] — 7 dokumen EWS dilebur ke [[EWS_PLAN]]
- [[log/2026-07-14-prd-manufacturing-variant]] — scan 3 lapisan → PRD varian manufacturing
- [[log/2026-08-05-order-pool-due-by-filter]] — pool order reservasi bay: filter "jatuh tempo ≤ akhir minggu ini + belum selesai (tanpa batas bawah)" via param `due_by`
- [[log/2026-08-05-scheduling-area-ux-polish]] — UX: search task di panel reservasi, tab pool jadi segmented control, header (Map date/range/refresh) dirapikan

## 📚 Operasional

- [[operations/cheatsheet]] — cheatsheet operasional
- `Work Instruction/` — instruksi kerja
- `sap/` — dokumentasi SAP aktif

## 🗃️ Arsip & Isolasi

- [[_isolasi/README|_isolasi/]] — 20 file historis kandidat hapus (deadline keputusan: 2026-09-01)
- `archive/` — sisa arsip (VBA .bas lama, dll). Catatan: `archive/mpsobsidian/cheatsheet.md` masih aktif diedit — kandidat merge ke `operations/cheatsheet.md`
