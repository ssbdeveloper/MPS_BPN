---
type: concept
tags: [concept, sap, machine-hours, reconciliation, domain/sap]
updated: 2026-07-24
---

# Rekonsiliasi jam mesin → SAP (mch → staging → POSTED)

> Catatan menetap. Kalau ada yang tanya "kenapa angka jam di UI ≠ angka di SAP" atau "gimana
> menelusuri satu jam mesin sampai ke SAP", jawabannya di sini. Melengkapi
> [[concepts/mch-interval-normalization]] (mekanisme jam-nya) dan [[concepts/sap-staging-identity]]
> (identitas bundel).

## Rantai satu jam mesin

```
mch_transaction (interval mentah, sudah di-clamp end_effective)
      │  di-bundel per (hari-kerja × operator × order/aktivitas)
      ▼
sap_timesheet_staging  ← satu baris = satu "konfirmasi" ke SAP
      │  status: PENDING → POSTING → POSTED / FAILED / SKIPPED
      ▼
SAP (order confirmation ATAU cost-center)
```

Jembatan penelusuran = **`sap_staging_source`** (provenance,
[[log/2026-07-14-sap-staging-provenance]]): tiap baris memetakan `staging_id → source_row_id`
(= `proddataid`) + `bucket_start` + `seconds` + `posted_at`. Dari satu bundel staging kamu
bisa mundur ke rekaman mesin persisnya, dan dari satu rekaman mesin maju ke bundel yang
membawanya. Ini yang bikin drill-through mungkin.

## Dua angka jam yang WAJIB dibedakan

| Istilah (UI) | Dari mana | Arti |
|---|---|---|
| **Jam mesin / sumber** (`source_hrs`) | `sap_staging_source` × `mch_transaction`, di-clamp `end_effective` **sekarang** | Jam aktual mesin, versi terbaru setelah normalisasi |
| **Terkirim** (`sent_hrs`) | `sap_timesheet_staging.total_seconds` | Yang benar-benar tercatat di bundel / dikirim ke SAP |

**Keduanya bisa beda, dan selisihnya bermakna:**

- `sent > source` **dan status POSTED** → bundel di-post SEBELUM clamp lapis 1b ada. SAP
  memegang jam kebesaran (baris nyangkut). Kandidat **STORNO** — clamp TIDAK menariknya balik
  ([[concepts/mch-interval-normalization]] "mencegah yang baru, bukan yang lama").
- `sent > source` **dan status PENDING** → akan **turun** ke `source` saat di-*re-stage*.
  Belum di SAP → aman dikoreksi, tak perlu STORNO.
- `sent == source` → bersih.

Contoh nyata (17-Jul, muncul di UI drill): bundel `74496` sent 9,2 j / source 0,5 j (PENDING,
akan turun); `14051` sent 5,0 j / source 4,0 j (POSTED, +1 j di SAP → kandidat koreksi);
`12526` 6,6 = 6,6 (bersih).

## Kenapa total POSTED di UI ≠ CSV konfirmasi SAP

Pertanyaan yang memicu konsep ini: UI menampilkan **POSTED ±1.698 jam** (1–22 Jul) tapi
`sap_output.csv` hanya **±1.094 jam**. Bukan bug — dua hal yang harus dipisah:

1. **Produktif vs unproduktif.** Sejak aturan kelayakan 2026-07-15, status unproduktif ikut
   di-stage:
   - **Produktif (M1/M2, ada order+operasi)** → di-post sebagai **order confirmation** →
     **muncul di CSV**. ±1.101 jam.
   - **Unproduktif (LSTAR/activity-type, bukan M1/M2)** → di-post ke **cost-center** →
     respons SAP "S" (sukses, nyata di SAP) tapi **TIDAK ada di CSV order-confirmation**.
     ±596 jam.
   - `1.101 + 596 ≈ 1.697 ≈ total POSTED`. Yang sebanding dengan CSV **hanya bagian order**
     (`posted_order_hrs`), bukan total POSTED.
2. **Sisa selisih order (±1.101 vs 1.094)** = pembulatan SAP + anomali 12753 (lihat bawah).

Karena itu endpoint `getSapReconciliation` **memecah POSTED** jadi `posted_order_hrs`
(= sebanding CSV) vs `posted_cc_hrs`. Membandingkan total POSTED dengan CSV order = salah
kaprah; selalu bandingkan `posted_order_hrs`.

Rekonsiliasi jumlah bundel: 2.122 bundel staging = 2.122 baris CSV (1:1). Yang beda hanya jam
per bundel, bukan keberadaannya.

## Pembulatan SAP TIDAK bisa direplikasi (jangan dipalsukan di UI)

Owner minta UI membulatkan persis seperti SAP supaya angkanya sama. **Tidak bisa, dan jangan.**
SAP sistematis ~0,5% LEBIH KECIL dari jam kita, tapi **variabel per konfirmasi** — bukan
pembulatan 3-desimal, bukan pembulatan ke menit. Kemungkinan potongan kalender/istirahat di
sisi SAP yang tak kita punya inputnya. Menebak rumusnya = mengarang angka yang kebetulan
mirip, dan itu lebih berbahaya daripada selisih yang jujur.

**Rekomendasi yang berlaku:** kalau butuh angka exact SAP, **impor CSV SAP** sebagai sumber
kebenaran untuk kolom "SAP aktual", lalu tampilkan **badge toleransi** (mis. selisih < 1%
hijau). Jangan hitung ulang pembulatan SAP di frontend.

## Anomali kanonik: staging 12753

Setting 5,13 jam, baris nyangkut `518505` (17-Jul), status POSTED dengan respons "S saved" —
tapi **absen dari CSV SAP**. Di-STORNO manual oleh owner di SAP; di sistem kita ditandai
**SKIPPED** agar sinkron (bukan DELETE — jejak audit dipertahankan). Ini contoh nyata "sent >
source pada baris POSTED" yang jadi kandidat koreksi.

## Permukaan baca (endpoint + UI)

Tab **Rekonsiliasi** di `SapLogPage` (`components/sap/ReconciliationPanel.jsx`), tiga level
drill-through breadcrumb — **Ringkasan → Tanggal → Konfirmasi → Rekaman mesin**:

| Endpoint (`/dashboard/...`) | Level | Isi |
|---|---|---|
| `sap-reconciliation?from&to` | 1 | funnel agregat (jam mesin, posted split order/cc, pending/failed) + per-tanggal + action items |
| `sap-reconciliation-day?date=` | 2 | konfirmasi satu hari: operator, tujuan, `source_hrs` vs `sent_hrs`, status, `has_stuck` |
| `sap-reconciliation-record?staging_id=` | 3 | rekaman `mch_transaction` pembentuk satu konfirmasi + respons SAP |

Semua **read-only** (SELECT). Tak ada tulis. Detail desain UI + istilah awam:
[[log/2026-07-24-sap-reconciliation-drilldown]].

## Prinsip yang menetap

1. **Bandingkan `posted_order_hrs` dengan CSV, bukan total POSTED.** Cost-center nyata di SAP
   tapi tak pernah di CSV order.
2. **`source_hrs` vs `sent_hrs` adalah alat diagnosa, bukan noise.** Selisihnya menunjuk
   persis mana bundel yang perlu STORNO vs cukup re-stage.
3. **Jangan palsukan pembulatan SAP.** Impor CSV + toleransi, bukan tebak rumus.
4. **SKIPPED ≠ error.** Itu keputusan manusia (mis. sudah di-STORNO), sengaja di luar hitungan
   "perlu diperbaiki".

## Terhubung

[[concepts/mch-interval-normalization]] · [[concepts/sap-staging-identity]] ·
[[concepts/payroll-data-path]] · [[log/2026-07-24-sap-reconciliation-drilldown]]
