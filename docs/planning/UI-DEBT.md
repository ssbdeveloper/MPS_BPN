---
type: plan
status: active
updated: 2026-09-05
tags: [ui, debt, domain/ops]
---

# UI Debt — utang design contract yang sudah ada sebelum gate dipasang

> Gate (`node scripts/gate.mjs`) memeriksa **baris yang diubah diff**, bukan seluruh file.
> Alasannya ada di [[../../CLAUDE|CLAUDE.md]] bagian 11. Dokumen ini adalah tempat utang lama
> dicatat supaya tetap terlihat dan bisa dibayar dengan sengaja — bukan dibayar diam-diam di
> tengah commit yang seharusnya soal lain.

## Aturan pakai

- Menyentuh file legacy lalu melihat temuan yang **bukan** dari baris Anda: **jangan diperbaiki
  di commit itu.** Catat di tabel bawah, lanjutkan pekerjaan.
- Membayar utang adalah pekerjaan tersendiri: satu commit yang isinya hanya membayar utang,
  dengan angka sebelum/sesudah di pesan commit.
- Dilarang menutup temuan dengan `deslop-allow` massal atau menaikkan
  `scripts/lint-baseline.json`. Keduanya ada di STOP list.

## Baseline 2026-09-05

`node scripts/deslop.mjs --all` → **1.722 error, 115 dari 177 file** di `apps/web/src`.

| Rule | Jumlah | Isi |
|---|---:|---|
| C1 | 443 | hex di luar token set |
| C7 | 398 | ukuran teks < 12px |
| C8 | 339 | tombol tanpa `min-h-[44px]` / `focus-visible:` |
| C14 | 338 | `className` panjang yang diulang — kandidat komponen |
| C2 | 190 | `#0096c7` dipakai sebagai background tombol / teks kecil (gagal AA) |
| C13 | 54 | file melewati batas 200/400 baris |
| C4 | 51 | gradient dekoratif |
| C10 | 50 | kolom numerik tanpa `tabular-nums` (warning) |
| C5 | 42 | `backdrop-blur` di luar modal |
| C12 | 25 | emoji di UI |
| C9 | 23 | elemen non-`button` dengan `onClick` |
| C15 | 23 | `console.log`, kode dikomentari, `TODO` tanpa rujukan |
| C6 | 9 | `z-[...]` di luar skala |
| C11 | 2 | URL eksternal — melanggar offline-first |

`node scripts/lint-gate.mjs --all` → **65 error, 29 file**. Rinciannya di
`scripts/lint-baseline.json`.

## File terparah — urutan pengerjaan yang masuk akal

Angka = error deslop pada 2026-09-05.

| File | Error | Catatan |
|---|---:|---|
| `pages/PE/SowCreatePage.jsx` | 123 | |
| `pages/PE/SowStandardListPage.jsx` | 93 | |
| `pages/PPC/salvaging/SowSchedulingPage.jsx` | 72 | |
| `components/sap/ReconciliationPanel.jsx` | 68 | 1.180 baris — batas komponen 200 |
| `pages/EwsDetailPage.jsx` | 60 | |
| `pages/PPC/ReceivingShipmentPage.jsx` | 58 | |
| `pages/PPC/salvaging/SchedulingTimeline.jsx` | 54 | |
| `pages/OperationsHubPage.jsx` | 52 | |
| `templates/travel-card.html` | 47 | template cetak, bukan komponen React |
| `assets/travelcard.html` | 42 | 508 baris; duplikat dari `templates/travel-card.html`? belum diverifikasi |

## Temuan terpisah yang perlu keputusan manusia

- **`apps/web/src/OperationsHubIcon.jsx` tidak bisa di-parse.** File 13 baris berisi potongan
  JSX tanpa `import`, tanpa komponen, tanpa `export` — sisa tempelan yang ter-commit. ESLint
  mencatatnya sebagai `parse-error` di baseline. Menghapus file ada di STOP list, jadi
  keputusannya di manusia. Rekomendasi: hapus.
- **`assets/travelcard.html` vs `templates/travel-card.html`** — dua file HTML travel card.
  Perlu dicek apakah salah satunya mati.
- **Tombol Back `PageHeader` = 30px**, di bawah minimum 44px (C8). Ditemukan saat pilot dashboard
  F2 lewat pengukuran browser di 768×1024 dan 960×600. Komponen dipakai 13 halaman, jadi
  memperbaikinya adalah pekerjaan tersendiri, bukan sisipan di pilot satu halaman.
- **`components/dashboard/KpiCard.jsx` tidak lagi dipakai** sejak DashboardPage memakai
  `ConditionReadout` (pilot F2). Menghapus file ada di STOP list. Rekomendasi: hapus setelah
  archetype command center diterima.
- **4 error deslop warisan di chart dashboard** — `ValidationRateChart.jsx` (3), `WorkloadChart.jsx`
  (1), pada baris yang tidak disentuh pilot F2. Gate `--staged` lulus; dicatat agar tidak hilang.

## Cara membayar

1. Pilih satu file dari tabel di atas.
2. `node scripts/deslop.mjs --files apps/web/src/<path>` — laporan penuh file itu.
3. Perbaiki, jalankan `node scripts/gate.mjs`, commit sendiri dengan angka sebelum/sesudah.
4. Update tabel di dokumen ini dan tulis log di `docs/log/`.
