title: Migrasi 1:1 staging BPN → AWS — POSTED identik, posting pindah jalur AWS
date: 2026-08-31
tags: [aws, sap-staging, migration, ztimesheetid, multi-plant]
---

# Migrasi BPN → AWS (sap_timesheet_staging dkk)

Keputusan user 2026-08-31: posting ke depan lewat jalur AWS DB; BPN di-copy
DULUAN supaya baris yang sudah POSTED identik (ZTIMESHEETID sama dengan yang
pernah diterima SAP). Fase 2 (collector) dikerjakan user; Fase 3 (Lambda) nanti.

## Yang dilakukan

1. Reset schema AWS (migration `database/migrations/aws/20260831_sap_staging_aws_schema.sql`):
   8 tabel pipeline di-drop & dibuat ulang — `sap_timesheet_staging` identity
   GLOBAL `START WITH 2000000000` (> max legacy BPN 1.000.147.452, SAP tolak
   duplikat), ztimesheetid generated, UNIQUE(source_system, source_key), dst.
2. Perbaikan DDL yang ketemu saat eksekusi:
   - `is_productive boolean GENERATED ALWAYS AS (zconf_type IN ('M1','M2')) STORED`
     TIDAK ada di DDL awal (kolom ini ada di BPN) → ditambahkan.
   - `sap_ops_request.action_ck` hanya `stage_catchup`/`retry_failed` → BPN punya
     8 aksi (tambah post_corrections, rebuild_pending, post_bundles, post_date,
     post_operator, recalc_date) → constraint di-ALTER sesuai BPN.
3. Copy 1:1 BPN → AWS (script temp, satu transaksi atomik, `OVERRIDING SYSTEM
   VALUE` mempertahankan id → ztimesheetid IDENTIK; kolom generated tidak
   di-insert; jsonb via text + ::jsonb):
   - sap_timesheet_staging 19.794 · sap_staging_source 73.416 · sap_stage_cursor 1
   - sap_staging_eligibility_audit 5.035 · sap_ops_request 80 · sap_staging_exclusion 8
   - log_timesheet_sap 13.777 · sap_source_change_blocked 0

## Verifikasi (read-back)

- Status distribution IDENTIK: POSTED 13.534, PENDING 6.180, FAILED 78, SKIPPED 2.
- Perbandingan SELURUH 19.794 baris (id, status, source_system, source_key,
  total_seconds, posted_at epoch, is_correction, pernr_origin): **0 beda**.
- log_timesheet_sap 13.777 baris: **0 beda** (guard ZTIMESHEETID terbakar utuh).
- min/max id sama (1..2.628.518); sequence AWS tetap `(2000000000, is_called
  false)` → baris BARU dari collector mulai 2.000.000.000, tidak bentrok dgn
  riwayat. is_productive generated jalan (10.099 true / 9.695 false).
- Catatan: posted_at tampil beda jam saat dibandingkan karena TZ sesi
  (+08 Makassar vs +07 Jakarta) — instant sama (epoch terverifikasi).

## Konsekuensi & catatan

- BPN sudah stop posting → AWS sekarang sumber kebenaran; PENDING 6.180 di AWS
  menunggu poster (Fase 3 Lambda).
- Cursor AWS: MCH_HOURS/5051 last_processed 2026-08-29 00:00 — collector
  lanjut dari posisi itu.
- Baris POSTED TIDAK boleh di-push ulang (SAP tolak duplikat) — collector
  idempoten via UNIQUE(source_system, source_key).
- **PREFIX PLANT source_key TIMESHEET (2026-08-31, commit dev+prod)**: script
  `stage_timesheet_transaction.py` kini source_key = `plant:tsnumber` (fetch_rows
  + fetch_blocked_today_rows). Data AWS yang sudah ada di-update ikut pola
  (`werks || ':' || source_key` — 5.000 staging + 5.009 audit → `5051:*`),
  SEBELUM collector dinyalakan, supaya tidak dobel. ZTIMESHEETID TETAP integer
  polos dari identity AWS (kode pabrik hanya di source_key/werks). MCH aman
  (md5 menyertakan werks).
