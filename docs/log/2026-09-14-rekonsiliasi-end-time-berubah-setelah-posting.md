---
title: Rekonsiliasi SAP — "Adjusted End Time" terpotong & jam berubah setelah posting
date: 2026-09-14
tags: [sap-staging, reconciliation, timesheet, dashboard, bugfix]
---

# Rekonsiliasi (SAP Posting Log): end time "kena potong" padahal cap/break = 0

Laporan owner (BPN): di tab **Reconcile** (SAP Posting Log) banyak baris TIMESHEET yang
*Adjusted End Time*-nya lebih awal dari *End Time*, walau **Time Reduction (cap)** dan
**Break Time** = 0 — jadi tampak "jam dipotong" tanpa menabrak threshold max record
duration. Contoh staging ID: 1000193448, 1000196869, 1000203539, 1000205816, 1000211789
(semua operator 002515-I / ISWARDI ARDANA, 03–04 Sep).

## Root cause (terverifikasi di data BPN)

Dua hal terpisah; yang dilaporkan owner adalah yang pertama.

1. **Kolom `end_capped` (Adjusted End Time) mencampur dua versi record.** Untuk TIMESHEET
   rumusnya `checkin SEKARANG + total_seconds SNAPSHOT`
   (`dashboardController.js` `buildRecordsSql.tsSql` / `buildRecordsPageSql.tsHeavy`).
   Begitu baris timesheet di-edit/dibulatkan **setelah** bundel di-stage, checkin
   bergeser → end jadi sebelum end asli, contoh nyata:
   - 1000193448: staged 22:12:28 + 3104s → 23:04:12; row sekarang 22:12:00–23:04:00
     → Adjusted End 23:03:44 (16 s lebih awal), capcut 0, breakcut 0.
   - 1000203539: Adjusted End 01:57:51 vs End 02:00:00 (−2m09s), capcut 0, breakcut 0.
   - 1000211789: Adjusted End 03:41:27 vs End 03:47:00 (−5m33s), capcut 0, breakcut 0.
2. **Selisih snapshot vs record sekarang tidak punya kolom penjelas.** `Recognized Time`
   = `st.total_seconds` (yang benar-benar dikirim), sedangkan `Original Time` (raw)/
   `Time Reduction`/`Break Time` dihitung dari record saat ini. Saat record berubah
   setelah posting, aritmetika barisnya tidak menutup dan tidak ada tanda apa pun.

Ukuran di BPN, TIMESHEET 2026-09-01..09-08 (6.899 bundel):

| kategori | baris | keterangan |
|---|---|---|
| record identik | 2.012 | aman |
| hanya pembulatan ke menit | 820 | delta netral, ±detik |
| geser < 1 menit | 181 | ±detik |
| **berubah ≥ 1 menit setelah staging** | **3.886 (56%)** | net **+234 h** di timesheet vs yang dikirim |

Per status: POSTED 770 bundel (769 berubah, +56,8 h → SAP menerima lebih sedikit),
PENDING 5.996 (3.985 berubah, +194 h), FAILED 133.
Audit terpisah (`bucket_start` hari 09-01..09-08): 2.902 bundel end-nya lebih pendek
(698,8 h) dan 2.236 lebih panjang (462,6 h) — dua arah, jadi jelas bukan potongan rule.

**Bukan bug worker/rules**: rules cap+break di staging sudah diuji konsisten — 2.306/2.319
bundel (03–05 Sep) `total_seconds` = `LEAST(GREATEST(raw − break,0), cap×60)` dihitung dari
snapshot (`source_min_start`/`source_max_end`). Cap per jenis aktivitas di BPN
(`mch` 0:150, 1:300 … 12:10, 13:5; `timesheet` `""`:300, 1510–1680:150) memang memotong
record panjang (mis. Downtime/No Job 15–33 jam → 150 menit) — itu aturan, bukan anomali.

## Perbaikan (belum di-commit)

`apps/api/controllers/dashboardController.js`:
- helper `EFFECTIVE_SECONDS(raw, break, cap)` + `TS_EFFECTIVE_SECONDS` /
  `MCH_EFFECTIVE_SECONDS` — durasi efektif menurut rules **atas record sekarang**
  (identik `effective_seconds` di `stage_timesheet_transaction.py`).
- `tsSql` & `tsHeavy`: `end_capped` = `checkin sekarang + TS_EFFECTIVE_SECONDS` → artinya
  sama dengan MCH ("end setelah aturan diterapkan pada record sekarang"); kalau tanpa
  potongan, nilainya = End Time (tidak ada lagi "potong" palsu).
- kolom baru **`shift`** (UI: *Changed After Posting*, export: *Changed after posting secs*)
  = nilai efektif sekarang − yang benar-benar dikirim (`st.total_seconds` / `src.seconds`).
  Ini yang menjelaskan sisa selisih: positif = SAP menerima lebih sedikit.
  MCH: 58/2.234 baris (03 Sep) — baris mesin yang clamp-nya berubah setelah posting.
- export: kolom baru di sheet *Records* + 2 baris rekap di sheet *Summary*.

`apps/web/src/components/sap/ReconciliationPanel.jsx`: kolom `Changed After Posting`
(setelah Recognized Time), amber kalau ≠ 0, `0` abu-abu kalau tidak ada.

## Verifikasi

- `node --check apps/api/controllers/dashboardController.js` OK.
- Jalankan SQL nyata ke BPN 5434 (skrip sementara `apps/api/scripts/tmp_hermes_cap_debug.js`,
  dibuang setelah selesai; ref kolom `plant` dilepas karena migrasi multi-plant belum ada):
  5 ID laporan owner → `end_capped == end_orig`, `shift` = +16 / +81 / +129 / +18 / +333 s
  (sebelumnya end_capped lebih awal 16 / 81 / 129/ 18 s dan 5m33s).
- Jalur endpoint (paginated `buildRecordsPageSql`) diuji sama, hasil identik.
- `npx eslint src/components/sap/ReconciliationPanel.jsx` bersih; `npm run build` sukses.

## ⚠️ Peringatan deploy (temuan sampingan)

Working tree `apps/api/controllers/dashboardController.js` masih memuat perubahan
multi-plant yang **belum dimigrasi**: `ex2.plant`, `src.plant`, `sap_ops_request.plant`.
Keempat tabel (`sap_staging_exclusion`, `sap_staging_source`, `sap_ops_request`,
`plant_config`) **tidak punya kolom `plant` di BPN maupun CKP** → query records (MCH) dan
exclusion akan error `column ex2.plant does not exist` kalau file ini di-deploy apa adanya.
Kode yang jalan di BPN sekarang versi lebih lama (endpoint records jalan normal).
**Jangan commit/deploy file ini sebelum migrasi kolom plant di-apply ke BPN+CKP** (atau
revert bagian multi-plant itu).

## Langkah lanjut (keputusan owner)

1. Kebijakan posting: 3.886 bundel/8 hari ter-stage sebelum timesheet final. Opsi:
   (a) tunda staging (safety delay lebih besar / tunggu validasi foreman) sehingga
   snapshot = versi final, (b) biarkan + pakai kolom *Changed After Posting* untuk
   daftar koreksi yang perlu di-post ulang, (c) keduanya.
2. Migrasi kolom `plant` (multi-plant) sebelum deploy file ini.
