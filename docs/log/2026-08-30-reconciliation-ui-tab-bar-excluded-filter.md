title: Reconciliation UI — bar tab hemat tempat + filter & search Excluded
date: 2026-08-30
tags: [sap-reconciliation, web-ui, sap-staging-exclusion]
---

# Reconciliation UI: icon rumah dihapus, kontrol pindah ke bar tab, Excluded bisa difilter & dicari

Lanjutan overhaul `ReconciliationPanel.jsx` (setelah tab Excluded terpisah + status dot).

## Perubahan

1. **Icon rumah dihapus** dari breadcrumb. Breadcrumb kini hanya muncul saat drill
   (day/rec) dan tombolnya berupa teks `‹ All dates` (ArrowLeft) — di level summary
   tidak ada breadcrumb sama sekali, halaman lebih rapat.
2. **Export + From/To + Apply dipindah ke dalam container tab** — satu baris sejajar:
   tab kiri (Records | Overview | Excluded), kontrol kanan (ml-auto). Form header
   terpisah di atas dihapus. Input date dibuat kompak inline (label samping input).
   Saat drill (day/rec) bar ini tidak tampil — kembali dulu ke summary untuk ganti
   rentang.
3. **Filter tanggal kini berfungsi di tab Excluded**:
   - Backend `listSapExclusions` (GET /dashboard/sap-staging-exclusion) menerima
     `from`, `to` (filter `m.startdatetime::date BETWEEN`) dan `q` (ILIKE di pernr,
     nama, machinename, activity, source_row_id, note). Tambah kolom `record_date`.
   - Frontend `loadExclusions` mengirim from/to/q; search di-debounce 350ms.
4. **Search box ditambahkan** di header tab Excluded (pernr / name / machine /
   activity), plus label `excluded <waktu>` dan tanggal record pada tiap baris.

## Verifikasi

- `npx eslint` 0 error, `npm run build` SUCCESS (dev).
- Endpoint dites live (server lokal :3001): tanpa filter 8 record; `from=2026-08-01
  &to=2026-08-15` → 2 record (semua 12-08); `q=Shibaura` → 4; `q=24696` → 2;
  kombinasi from/to+q → 2.
- Port ke prod: komentar `//` di-strip (pola lama), kode identik dengan dev
  (diverifikasi `diff` setelah strip), node --check OK, eslint-disable dipertahankan.
- Commit: dev `09a00eb` (Javanian), prod `bc9c0f5` (SSB).
