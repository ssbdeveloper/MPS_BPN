---
title: "Timesheet posting via SAP staging (per-record, tanpa bundling)"
date: 2026-08-20
tags: [sap-staging, timesheet, post-to-sap, payroll]
status: draft
---

# Plan: Timesheet posting via SAP staging (per-record)

## Latar belakang / masalah

Posting SAP timesheet saat ini punya DUA jalur dengan perilaku BERBEDA:

| Aspek | Jalur MANUAL (halaman validasi → `POST /timesheet/post-to-sap`) | Jalur AUTO (staging → poster) |
|---|---|---|
| PERNR outsource (usernfc) | **SN asli** — tidak belok (controller.js:1421, tanpa JOIN usernfc) | **`11009413`** + `pernr_origin` = SN asli (stage_timesheet_transaction.py:143-147) |
| Rules break hours / cap 90 mnt | tidak diterapkan | diterapkan (config `plant_config.sap_rules`) |
| IEDD/IEDZ | jendela asli | sintetis = checkin + durasi efektif |
| ZTIMESHEETID | `ID_TIMESHEET` prefix + tsnumber (formatZTIMESHEETID) | `id::text` (identity kolom staging) |
| Bundling | per record | per record (TIMESHEET) — bundling cuma MCH_HOURS |
| Audit | `log_timesheet_sap` | `sap_response`/`sap_error` di `sap_timesheet_staging` |
| Write-back hasil | langsung set flag 2/3 di controller | **TIDAK ADA** — poster tidak menyentuh timesheet_transaction |

Tujuan: **satu pipeline = satu perilaku**. Data timesheet_transaction yang divalidasi masuk `sap_timesheet_staging` dulu (per record, source_system='TIMESHEET'), baru di-post ke SAP oleh poster — sehingga aturan (outsource → 11009413, break, cap) konsisten dengan jalur auto.

## Fakta pipeline yang sudah ada (temuan, verified source 2026-08-20)

1. **`stage_timesheet_transaction.py` SUDAH per-record** — fetch per `tsnumber`, INSERT ke `sap_timesheet_staging` (`source_system='TIMESHEET'`, `source_key=tsnumber`), lengkap dengan:
   - mapping outsource → `11009413` via LEFT JOIN LATERAL usernfc (regexp_replace whitespace, case-insensitive) + `pernr_origin`;
   - break hours (non-produktif dipotong, produktif penuh) + cap `max_record_minutes` (default 90);
   - IEDD/IEDZ sintetis (checkin + durasi efektif);
   - guard `WHERE effective_seconds > 0`.
   Bisa dipanggil dengan `--tsnumbers` (stage_sap_timesheet.py juga punya mode tsnumbers, tanpa rules).
2. **`sap_timesheet_staging`** (sap_staging_common.py:153-223): `UNIQUE (source_system, source_key)` = guard anti-double-post; status `PENDING/POSTING/POSTED/FAILED/SKIPPED`; payload JSONB; `ztimesheetid = id::text` STORED.
3. **`post_sap_staging.py`**: claim baris PENDING/FAILED (`FOR UPDATE SKIP LOCKED`, `status='POSTING'`), POST ke SAP, `update_result` → POSTED/FAILED + sap_response. Sudah dukung `--ids` (dipakai post_corrections) dan `--source-system` filter. **TIDAK ada write-back ke timesheet_transaction** (grep 0 match).
4. **`ops_worker.py`**: konsumen `sap_ops_request` (UI "Status Kirim SAP") — action: stage_catchup, retry_failed, post_corrections, rebuild_pending. Tambah action baru di sini kalau async.
5. **Topologi DB**: `connect_staging` default = env yang sama dengan `connect_source` (SAP_STAGING_DB_* fallback ke DB_*) → staging table satu DB dengan timesheet_transaction (BPN prod) → write-back dari poster trivial.
6. **`seed_sap_staging_manual.py`**: seeding manual payload (CLI), pola payload build = referensi untuk isi baris staging.

## Desain usulan

Flow target (per klik Validate di halaman validasi):

```
PUT /timesheet/validation (flag=2, validation_date=NOW)   ← sudah ada
        │
        ▼
Seed sap_timesheet_staging (per record, source_system='TIMESHEET')
        │   pernr outsource → 11009413, pernr_origin = SN asli
        │   rules break/cap diterapkan (kalau reuse stage script)
        ▼
Post ke SAP (post_sap_staging.py, filter tsnumbers tsb)
        │
        ▼
Write-back + audit:
  POSTED  → timesheet_transaction tetap flag=2 (validated)
  FAILED  → state_flag='3', validation_date=NULL  (perilaku sama dgn postToSap sekarang)
  keduanya → insert log_timesheet_sap (audit history, dari sap_response)
```

## Poin keputusan (pola 1a/2a/…)

1. **Sumber insert staging**:
   - (a) Reuse `stage_timesheet_transaction.py --tsnumbers` via subprocess (rules + outsource otomatis konsisten, nol duplikasi logika) — **REKOMENDASI**
   - (b) SQL identik di Node API (duplikasi rules di JS — justru yang mau dihindari)
   - (c) Seed manual payload via `seed_sap_staging_manual.py` pattern (payload sudah jadi, tanpa rules)

2. **Trigger posting**:
   - (a) **Synchronous dari API** — post-to-sap panggil stage + poster utk tsnumbers tsb, tunggu hasil, balas per-record seperti sekarang (UX halaman validasi TIDAK berubah: spinner per record tetap jalan) — **REKOMENDASI** (volume per klik kecil)
   - (b) Async via ops_worker action baru + UI polling status staging

3. **ZTIMESHEETID** (beda skema antar jalur — risiko idempotency kalau record lewat dua jalur):
   - Verifikasi dulu apakah SAP memakai ZTIMESHEETID utk dedupe.
   - (a) Samakan semua ke skema staging `id::text` — **REKOMENDASI kalau SAP tidak dedupe by ZTIMESHEETID**
   - (b) Pertahankan format `ID_TIMESHEET+tsnumber` → perlu payload override / kolom ztimesheetid jd editable

4. **Lokasi write-back**: di `post_sap_staging.py` (source_system='TIMESHEET' → update timesheet_transaction + insert log_timesheet_sap) — **REKOMENDASI** (satu tempat utk semua jalur TIMESHEET, termasuk retry_failed yang sudah ada)

5. **Re-validate tsnumber yang sudah pernah POSTED di staging** (UNIQUE source_key):
   - (a) Skip + pesan "record sudah terkirim ke SAP" — **REKOMENDASI**
   - (b) Kirim sebagai koreksi (`is_correction`, pattern MCH post_corrections)

6. **Nasib `log_timesheet_sap`**: tetap diisi dari poster (dia punya sap_response) — **REKOMENDASI**; kolom pernr = payload.PERNR (11009413 utk outsource), konsisten dgn migration 20260709 pernr_origin.

## Non-goals

- Tidak mengubah bundling MCH_HOURS.
- Tidak mengubah rules config (break/cap) — tetap di `plant_config.sap_rules`.
- Tidak mengubah halaman validasi secara visual (kalau keputusan 2a).

## Verifikasi

1. Stage tsnumber outsource → `pernr='11009413'`, `pernr_origin=SN asli` di sap_timesheet_staging (query DB BPN).
2. Poster sukses → status POSTED + timesheet_transaction tetap flag 2 (validation_date terisi).
3. Poster gagal (payload invalid) → status FAILED + timesheet_transaction state_flag='3', validation_date=NULL.
4. log_timesheet_sap terisi per attempt (pernr ter-substitusi).
5. UI: validate single/group → spinner → banner SAP sukses/gagal, perilaku identik dgn sekarang.
6. Anti-double-post: tsnumber yang sudah POSTED tidak bisa di-stage ulang tanpa keputusan 5.
