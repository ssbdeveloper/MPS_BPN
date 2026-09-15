---
title: "SAP Log page — perbaikan performa query Fase 0–2 + review"
date: 2026-09-02
tags: [MPS2, SAP, FDW, performa, dashboard, rekonsiliasi]
---

# SAP Log page — perbaikan performa query Fase 0–2 (2026-09-02)

Lanjutan [[log/2026-09-01-reconciliation-export-timeout]]. Plan: [[sap/SAP_LOG_QUERY_PERF_PLAN]].
Commit di branch `2b`: `030901d` (Fase 1) → `c1360a0` (temuan review 1–4) → `3ca20d1` (§8 P1/P2).

## Fase 0 — FDW fetch_size (DB, tanpa kode)
`ALTER SERVER aws_staging OPTIONS (ADD fetch_size '10000')` + `ANALYZE` kedua foreign table,
di BPN & CKP. Base join rekonsiliasi MCH 30 hari (EXPLAIN ANALYZE):
| | Foreign Scan | Total |
|---|---|---|
| fetch_size 100 | 4.189 ms (9.025 baris) | 5,09 s |
| fetch_size 10000 | 147 ms (9.602 baris) | 0,42–0,65 s |

## Fase 1 — kode (030901d)
1. Cast tsnumber dibalik (tsSql/tsBase/tsHeavy): `t.tsnumber::text = split_part(...)` →
   `t.tsnumber = split_part(...)::int` → Index Only Scan `timesheet_transaction_pkey`.
2. List staging-log slim: `payload`/`sap_response` keluar dari SELECT (42 KB → 18 KB utk
   30 baris) + search tanpa `payload::text`/`sap_response::text`; endpoint baru
   `GET /dashboard/sap-timesheet-staging/:id` dipanggil Detail Drawer.
3. Summary: tanggal "hari ini" dihitung JS (`todayInTz`) → range param (push-down) +
   cache 60 s (`stagingSummaryCache`) — terukur call1 1,8 s → call2 0,002 s.

## Review temuan user (c1360a0)
1. DetailDrawer data bundel SEBELUMNYA → `key={detailRow?.id}` (remount per bundel).
2. Cache 60 s tak pernah invalid → `invalidateStagingSummary()` (lihat §8 P2 di bawah) +
   summary honor `?fresh=1` (tombol Refresh bypass).
3. Error fetch detail senyap → error inline + tombol "Coba lagi" (retryNonce).
4. Guard+cast satu AND tak deterministik → awalnya CASE, lalu (§8 P1) disempurnakan ke
   regex di WHERE (di bawah).

## §8 review lanjutan (3ca20d1)
- **P1** — bentuk `CASE` meregresi ke Hash Join + Seq Scan `timesheet_transaction` 156k
  (regex tak lagi predikat satu-relasi → tak ter-push ke AWS). Fix: cast polos di JOIN +
  regex di WHERE (`baserestrictinfo` pada `st`, deterministik, ter-push ke remote):
  tsSql/tsBase dapat WHERE baru; tsHeavy yang belum punya WHERE ditambah.
  **Tes penerimaan LULUS**: EXPLAIN source=timesheet 30 hari = `Index Scan using
  timesheet_transaction_pkey`, TANPA Seq Scan (792 ms, total 2.478).
- **P2** — `invalidateStagingSummary()` dipanggil di enqueueSapOps, postCorrections,
  excludeSapRecord (3 jalur tulis status staging).
- MCH join (Bundles/day) TETAP bentuk CASE: LEFT JOIN — guard di WHERE akan memfilter
  baris source TIMESHEET dan mengubah semantik nrows; CASE deterministik dan terukur
  tanpa regresi (Index Scan `mch_transaction_pkey`).

## Ukur produksi (via nginx, PLANT 5051, setelah deploy 3ca20d1)
| Endpoint | Sebelum | Sesudah |
|---|---|---|
| sap-reconciliation-records 30 hari | 3,5–3,8 s | 1,75–2,5 s |
| sap-timesheet-staging-log limit 30 | 0,72 s, 42 KB | 0,67 s, 18 KB |
| sap-timesheet-staging/:id | (baru) | 0,08 s |
| summary (cache/fresh) | 0,93 s | 1,6 s → 0,02 s (cache) / 0,13 s (fresh) |
| sap-reconciliation 30 hari | 1,04 s | 1,1–1,7 s |

## Sisa (di luar scope)
- Fase 3 (mirror lokal read-model) tidak diperlukan sejauh ini.
- Skrip idempoten setup FDW per plant belum ada di migrations (plan §6).
- `GET /sap-ops/requests` 57 KB di-poll 4 s saat job jalan — kandidat batasi kolom+LIMIT.
- `{1,9}` = silent drop untuk id int4 ≥ 1.000.000.000 (tidak relevan: tsnumber ~156k,
  proddataid ~580k) — dicatat, bukan bug.
- Kalau ada API terpisah di CKP, perlu pull+rebuild di sana juga (deploy hari ini: BPN).
