---
tags: [decision-log, domain/sap]
date: 2026-07-24
topic: Rekonsiliasi jam mesin — analisa CSV vs staging + tab drill-through
---

# 2026-07-24 — Rekonsiliasi: kenapa UI 1.698 j ≠ CSV 1.094 j, dan tab drill-through

Konsep menetap hasil sesi ini: [[concepts/sap-machine-hours-reconciliation]]. Log ini =
kronologi + keputusan. Berdiri di atas normalisasi [[concepts/mch-interval-normalization]] dan
provenance [[log/2026-07-14-sap-staging-provenance]].

## Bagian 1 — analisa `sap_output.csv` (1–22 Jul) vs database

Owner membandingkan export SAP dengan angka POSTED di UI dan menemukan selisih besar:
UI **±1.698 jam** vs CSV **±1.094 jam**. Bukan "beda tipis" seperti dugaan awal — perlu dibedah.

**Temuan:**

- **1:1 bundel.** 2.122 baris staging POSTED = 2.122 baris CSV. Tak ada bundel hilang/ganda;
  yang beda hanya jam per bundel.
- **Pemisah utama: produktif vs unproduktif.** POSTED produktif (M1/M2 → order confirmation)
  ±1.101 j **muncul di CSV**; POSTED unproduktif (LSTAR → cost-center) ±596 j **tidak di CSV
  order** walau respons SAP "S". `1.101 + 596 ≈ 1.697 ≈ total POSTED`. Jadi yang sebanding
  dengan CSV **hanya bagian order**, bukan total.
- **Sisa 1.101 vs 1.094** = pembulatan SAP (~0,5% lebih kecil, **variabel per konfirmasi** —
  bukan pembulatan menit/3-desimal, **tidak bisa direplikasi**) + anomali 12753.
- **CSV berubah struktur** (owner update file): jam pindah kolom 16, tanggal posting kolom 10
  (DD.MM.YYYY) — analisa diulang dengan kolom benar.

**Keputusan penting:** owner minta UI **membulatkan seperti SAP** supaya exact sama. Ditolak
dengan alasan — tak ada pola stabil; menebak = mengarang angka. Rekomendasi: impor CSV sebagai
sumber "SAP aktual" + badge toleransi, jangan hitung ulang pembulatan di FE. (Detail di konsep.)

**12753** — Setting 5,13 j, baris nyangkut 518505, POSTED "S saved" tapi absen dari CSV. Owner
sudah STORNO di SAP → ditandai **SKIPPED** di sistem (bukan DELETE; jejak audit dipertahankan).

## Bagian 2 — perombakan tab Rekonsiliasi jadi drill-through

Feedback owner atas versi pertama tab: "terlalu banyak informasi", "istilah membingungkan",
"belum dapat insight — gimana tau record mch_transaction dengan staging dengan posted?".
Minta bahasa awam + drill-through.

**Backend — dua endpoint baca baru** (`dashboardController.js`, route `dashboard.js`):

- `GET /dashboard/sap-reconciliation-day?date=` — konfirmasi satu hari: operator (join
  `usernfc` via `COALESCE(NULLIF(pernr_origin,''), pernr)`), tujuan, `source_hrs` (clamp
  sekarang) vs `sent_hrs`, status, `has_stuck`.
- `GET /dashboard/sap-reconciliation-record?staging_id=` — rekaman `mch_transaction`
  pembentuk satu konfirmasi (via `sap_staging_source`) + respons SAP.

Keduanya read-only, divalidasi langsung ke prod sebelum FE ditulis.

**Frontend — `ReconciliationPanel.jsx` ditulis ulang:**

- **Jargon dibuang** dari UI: clamp, nyangkut, staged, funnel, bundel, cost-center, eligible,
  STORNO → jam mesin, terkirim, masuk SAP, menunggu, dirapikan, sinyal putus, perlu dikoreksi.
- **Atas dipangkas** dari 2 FlowBar + 4 tile + 3 paragraf → **3 kartu alur** (Jam mesin
  tercatat → Sudah masuk SAP → Belum) + satu banner peringatan bersyarat.
- **Drill breadcrumb 3 level** (mengganti view, tidak menumpuk): Ringkasan → klik tanggal →
  daftar konfirmasi (kolom **Jam mesin vs Terkirim** dengan badge selisih) → klik konfirmasi →
  rekaman mesin mentah + respons SAP.

Insight yang tadinya hilang kini eksplisit di kolom `source_hrs` vs `sent_hrs` — persis alat
untuk membedakan "kandidat STORNO" (POSTED, sent>source) dari "cukup re-stage" (PENDING).

## Verifikasi

- `node --check` controller + route OK; `eslint` panel bersih; `npm run build` sukses (20 s).
- Endpoint diuji vs prod: hari 17-Jul + bundel 12526 (6,6=6,6 bersih), 74496 (9,2 vs 0,5
  PENDING), 14051 (5,0 vs 4,0 POSTED +1) — sesuai model.

## Belum di-commit / deploy

Endpoint + panel **belum di-commit dan belum di-deploy**. Untuk aktif perlu rebuild **api**
(endpoint baru) + **frontend**. Menunggu keputusan owner.

## Catatan jujur (tidak disembunyikan di UI)

Kartu alur 3-langkah **bukan aritmetika ketat**: "Masuk SAP" bisa > "Jam mesin" pada tanggal
yang di-post sebelum dirapikan, dan jam yang belum dibuat konfirmasinya juga ada di selisih.
Angka eksak ada di drill, bukan di ringkasan atas — itu memang desainnya.

## Sisa backlog (lintas sesi)

- Report machine-hours + dashboard OEE masih baca `enddatetime` mentah
  ([[concepts/mch-interval-normalization]]).
- STORNO 61,4 jam yang telanjur POSTED (selain 12753 yang sudah ditangani).
- Impor CSV SAP sebagai "SAP aktual" + badge toleransi (kalau owner mau angka exact).
