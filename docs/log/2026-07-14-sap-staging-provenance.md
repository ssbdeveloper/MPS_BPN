---
tags: [decision-log]
date: 2026-07-14
topic: Provenance + guard anti-double-post jalur SAP staging
---

# 2026-07-14 — SAP staging: provenance, guard, pembekuan

## Konteks
User bertanya soal mekanisme bundling `stage_machinehours`. Penelusuran mengungkap
**lubang payroll**: `ZTIMESHEETID = id::text` (nomor baris staging), bukan turunan data.
Jadi dedup SAP **tidak melindungi** dari double-post begitu `source_key` (md5) berubah —
baik karena kode diubah maupun **data sumber dikoreksi**.

## Koreksi yang kubuat atas diriku sendiri (dicatat karena penting)
1. Klaim awal *"kalau SAP dedup ZTIMESHEETID, risiko runtuh"* → **SALAH**. ztimesheetid
   ikut berubah saat baris baru lahir.
2. Klaim *"antrian idle, belum pernah posting"* → **BASI**. Nyatanya 2 POSTED, 1 FAILED,
   153 PENDING.
3. Usul *"bawa cost_center"* → **salah arah**, ditolak user dengan benar. Fakta: payload
   tidak punya field KOSTL sama sekali (mengubahnya = ubah kontrak SAP), dan
   `cost_center` cuma terisi **14%** (222/1585). Perbaikan memang di sisi SAP.
4. Usul guard berbasis `proddataid` saja → **bug**. Bundling memotong record per jam;
   satu proddataid sah muncul di banyak bundel (contoh: 501272 → 5 segmen).
   Kunci benar = **(proddataid, bucket_start)**.

## Dikerjakan (migration 20260714_sap_staging_provenance.sql)
- `sap_staging_source` — provenance per segmen + backfill **156/156 cocok persis**
  (diverifikasi vs `source_row_count`/`total_seconds` SEBELUM migration ditulis)
- **Unique index parsial** `WHERE posted_at IS NOT NULL` → satu segmen mustahil ter-POST
  dua kali. **Diuji: DB menolak** (`uq_sap_staging_source_posted_once`)
- Trigger propagasi `posted_at` saat bundel POSTED
- **Trigger pembekuan `mch_transaction`** — field kunci beku untuk record yang sudah
  terkirim; percobaan dicatat ke `sap_source_change_blocked`. **Diuji: `UPDATE 1` sukses
  (ETL tidak putus) tapi order_no TIDAK berubah, dan percobaan tercatat**
- Bundling memancarkan `segments`; `insert_staging_rows` menulis provenance (idempoten)
- **Guard di `post_sap_staging`**: `source_key` sama → skip; **beda → KONFLIK → SKIPPED**
  dengan pesan "butuh storno di SAP sebelum koreksi dikirim". Diuji live: bundel koreksi
  terdeteksi konflik dengan bundel POSTED 163449.

## ⚠️ Masih terbuka
- **Storno**: tidak ada mekanisme membatalkan kiriman salah di SAP. Konflik hanya
  terdeteksi; penyelesaian manual.
- **Non-M1/M2 ditolak SAP** ("Enter activity type only in conjunction with cost center") —
  53+ baris PENDING pakai pernr Outsource. User sedang perbaiki di sisi SAP.
  **Uji definitif: retry baris 163444 setelah fix.**
- 153 PENDING semuanya data **1 Juli** (13 hari lalu) — cek posting period SAP sebelum
  posting massal.
- Rebuild bundling boleh dilakukan **setelah** ini terpasang (sudah aman).

**Konsep tersentuh:** [[concepts/sap-staging-identity]] · [[concepts/payroll-data-path]]
