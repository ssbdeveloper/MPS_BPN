---
tags: [decision-log, domain/ews]
date: 2026-07-12
topic: Konsolidasi dokumen EWS + perbaikan encoding
---

# 2026-07-12 — Konsolidasi 7 dokumen EWS → [[EWS_PLAN]]

## Konteks
Dokumentasi EWS terpecah di 7 file yang saling drift (semua masih bilang "5 KPI" padahal
kode sudah 8; menyebut tabel `connectivity_log`/`data_validation_log` yang tak pernah
dibangun; issue log digambarkan FE-generated padahal sudah backend-generated).

## Dikerjakan
1. **Mojibake EWS_DETAIL.md diperbaiki dulu** (183 baris, 2 pass: CP1252 reversal + BOM +
   emoji 4-byte) supaya merge-nya bersih.
2. Digest 6 dokumen (agent) + baca penuh EWS_REVISION_PLAN + verifikasi endpoint/komponen
   nyata di kode.
3. **[[EWS_PLAN]] dibuat** — satu dokumen: arsitektur as-built, 8 KPI terverifikasi,
   keputusan terkunci (D1–D3, shift, dedup contract), pipeline issue log + gate per KPI,
   inventaris permukaan sistem, done (kronologis), to-do berurut (Phase 6 drill-through →
   uptime_tablet → IL-last → register isu kecil), risiko.
4. **7 file dihapus** (git history menyimpan): EWS_DETAIL, EWS_REVISION_PLAN,
   EWS_ANALISA_PERHITUNGAN, EWS_DETAIL_IMPROVEMENT, EWS_ISSUE_LOG_ACTION_CONCEPT,
   ews-dashboard-data-strategy, ews-realtime-sse-architecture.
5. Yang TIDAK dilebur: EWS_PANDUAN_PENGGUNA (panduan end-user, audiens beda);
   F5_TIMELINE_TESTGUIDE (terverifikasi BUKAN EWS — itu Fase F5 SOW Scheduling).

## Keputusan konten (yang dibuang karena tidak relevan)
- Framing 5 KPI, skema `ews.connectivity_log` + `ews.data_validation_log` (tak pernah
  dibangun), `event_data_hmi`/Power Query, weighted Alert_Score 0.30/0.25/… (overall_score
  pensiun → status-only), worksheet ✏️ kosong di ACTION_CONCEPT, SQL remediasi one-off,
  threshold usang di data-strategy (OEE 65/50 vs live 80/65), nomor baris kode literal.

## Berikutnya
EWS Phase 6 drill-through ([[EWS_PLAN]] §7.1) — mulai accuracy_labour, uji rekonsiliasi vs kartu.
