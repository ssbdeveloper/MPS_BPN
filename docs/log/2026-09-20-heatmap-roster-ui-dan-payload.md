---
tags: [log, domain/ews, domain/ui, domain/perf]
updated: 2026-09-20
---

# Heatmap roster EWS: palet pastel, target sentuh, dan payload yang diciutkan

Sumber rencana: `docs/planning/heatmap ui.md`.

## Apa yang diubah

### 1. Palet lebih tenang, izin dipisah dari absen

`rosterVisuals.jsx` sebelumnya memberi warna merah yang sama untuk Absent, Sick, Leave,
dan Permit. Pada ribuan sel, layar jadi merah merata dan absen tanpa keterangan —
satu-satunya kondisi yang butuh tindakan — tenggelam.

Palet baru:

| Kondisi | Tampilan | Penanda |
|---|---|---|
| Recorded | `bg-emerald-100` | D/N |
| Scheduled | `bg-slate-50` | D/N |
| Absent | `bg-red-100` | D/N |
| Sick / Leave / Permit | `bg-amber-50` | S / L / P |
| Site visit | `bg-sky-100` | V |
| Off | `bg-slate-200` | D/N |
| No schedule | putih | — |

Ini **perubahan makna visual**, bukan sekadar ganti kelas CSS: pengelompokan merah lama
dikunci di `rosterVisuals.test.jsx`, jadi test itu ikut diperbarui menjadi kontrak baru
(`separates SICK/LEAVE/PERMIT from unexplained absence`).

Arti *Recorded* tidak berubah: ada jam tercatat, **bukan** berarti target jam tercapai.

### 2. Shift disederhanakan

Garis warna amber/indigo di atas sel dan garis tambahan di bawah untuk Night dihapus.
Yang tersisa hanya huruf D/N dengan teks gelap, sehingga warna latar (status) menjadi
informasi utama. Ada test yang mengunci ini agar stripe tidak diam-diam kembali.

### 3. Legenda dipecah dan dinaikkan

Legenda sekarang dua kelompok — "Kehadiran" dan "Shift" — dan dipindah dari bawah tabel
ke atasnya, langsung di bawah header.

### 4. Kartu ringkasan diredam

`StatTile` jadi putih, angka rata kiri dengan `tabular-nums`. Hanya nada `bad`
(Absent > 0) yang masih berwarna.

### 5. Penanda hari ini dan pemisah minggu

Kolom hari ini memakai header `bg-[#90e0ef]` + `aria-current="date"` dan outline tipis
pada selnya. Di mode bulanan, setiap hari Minggu mendapat garis pemisah kiri.

### 6. Mode mingguan untuk tablet

Sel bulanan hanya 28×28 px — di bawah target sentuh 44 px. Toggle Month/Week ditambahkan;
mode mingguan memakai sel 44×44 px (`h-11 w-11`) dengan navigasi minggu, dan otomatis
membuka minggu yang memuat hari ini. Mode bulanan tetap ada sebagai ringkasan.

### 7. Akses keyboard dan sentuh

Sel dulu hanya punya `onMouseDown`/`onMouseEnter` — tap dan keyboard tidak pernah memilih
apa pun. Ditambahkan `onClick`, Enter/Space, focus ring, `aria-pressed`, dan `aria-label`
lengkap ("nama, tanggal, night shift, Recorded, half day"). `title` saja tidak cukup untuk
pengguna tablet.

Agar desktop tidak memilih dua kali, `mouseHandled` ref menelan `click` yang menyusul
`mouseup` drag.

### 8. Bug detail sel (nyata)

Halaman menyimpan `rowsByKey` sebagai `Map`, tetapi `BulkPanel.jsx:41` membacanya dengan
`rowsByKey[key]` — selalu `undefined`, sehingga seleksi satu sel tidak pernah menampilkan
detail operator. Diperbaiki lewat helper `lookupRow()` yang menerima Map maupun object
(test BulkPanel memakai object literal). Ada test regresi yang meneruskan `Map` asli.

### 9. Pergantian bulan tidak lagi menampilkan data basi

`load()` sekarang memakai `AbortController` + sequence guard (`reqSeq`), dan mengosongkan
baris saat request dimulai. Sebelumnya header tanggal langsung berganti sementara data
bulan lama masih terpasang, dan respons lambat dari bulan sebelumnya bisa menimpa yang baru.

## Pengukuran: SQL bukan penyebabnya

Dokumen rencana menduga query bulanan yang mahal. Diukur langsung ke produksi
(`EXPLAIN (ANALYZE, BUFFERS)`, Tailscale 100.80.101.53:5433):

| Pengukuran | Hasil |
|---|---:|
| Execution Time query bulanan | **70,3 ms** |
| Planning Time | 8,96 ms |
| Baris | 3.026 (143 operator) |
| Indeks yang dipakai | `idx_ews_shift_roster_date` (Index Scan, bukan Seq Scan) |

Jadi indeks **tidak perlu ditambah** — persis seperti peringatan di dokumen rencana.

Lalu dari mana 4–9 detik itu? Dari transfer baris. Benchmark isolasi pada koneksi yang sama:

| Uji | Hasil |
|---|---:|
| `SELECT 1` | 11–19 ms |
| 3.026 baris, 1 kolom sempit | 221–638 ms |
| 3.026 baris, lebar penuh | 5.339–8.485 ms |
| `SELECT repeat('x', 64KB)` | ~711 KB/s |
| `SELECT repeat('x', 1MB)` | ~85 KB/s |

Waktu berbanding lurus dengan ukuran payload, bukan kompleksitas query. Link Tailscale-nya
yang menjadi leher botol, dan payload gemuk yang membebaninya.

## Perbaikan API

`getRosterMonth` dirampingkan:

- Kolom `operator_name`, `shift_locked`, `fixed_shift`, dan `completed` dihapus dari baris.
  Tidak satu pun dibaca frontend — `completed` bahkan tidak pernah dipakai sama sekali.
  Menghapusnya juga membuang satu JOIN ke `usernfc` dan satu ekspresi waktu per baris.
- Nama operator dikirim **sekali** di `meta.operators` (143 entri), bukan diulang pada
  3.026 baris.
- `ORDER BY u.full_name` diganti `ORDER BY r.serialnumber`; urutan tampilan sekarang
  ditentukan `meta.operators` yang sudah diurutkan di JS (nama dulu, NULL terakhir).

Hasil terukur, memanggil controller asli terhadap produksi:

| | Sebelum | Sesudah |
|---|---:|---:|
| Waktu controller | 4.239 ms (rata 3 run) | 2.758 ms |
| Payload gzip | 33 KB | **23 KB** |
| Baris | 3.026 | 3.026 |

Kompresi sudah aktif di `server.js:135`, jadi angka gzip itulah yang benar-benar melintasi
kabel. Sisa waktu masih didominasi transfer baris Postgres → API; itu properti link, bukan
query, dan tidak diklaim selesai di sini.

Frontend punya fallback: kalau `meta.operators` tidak ada (API lama), daftar operator tetap
diturunkan dari baris seperti dulu.

## Verifikasi

```
apps/api : npm test           → 77 pass, 0 fail
apps/web : npx vitest run     → 137 pass, 0 fail (28 file)
apps/web : npx eslint <3 file> → bersih
apps/web : npx vite build     → sukses
```

Probe produksi bersifat read-only (`SELECT` / `EXPLAIN ANALYZE` saja); tidak ada mutasi DB.

## Yang sengaja belum dikerjakan

Virtualisasi baris. September dengan 143 operator = 4.290 tombol sel, tapi dokumen rencana
sendiri menyaratkan profiling lebih dulu, dan bukti saat ini menunjuk ke transfer jaringan,
bukan waktu render. Mode mingguan sudah memotong jumlah sel yang ter-mount ~4× untuk kasus
tablet. Virtualisasi menunggu profil render yang nyata.
