---
tags: [concept]
status: active
updated: 2026-07-22
---

# Normalisasi interval jam mesin (`end_effective`)

> Catatan menetap. Kalau kamu menyentuh jam mesin — staging SAP, report machine-hours,
> OEE, atau ETL-nya — baca ini dulu.

## Aturan satu kalimat

**Durasi jam mesin dihitung dari `end_effective`, TIDAK PERNAH dari `enddatetime`.**

## Kenapa ada dua kolom

Stream status OEE normalnya **tiling**: `enddatetime` baris N == `startdatetime` baris N+1
pada mesin yang sama. Juli 2026: 24.402 dari 25.054 baris (97,4%) memenuhi ini. Selama
tiling, menjumlahkan durasi = merekonstruksi detik nyata, dan itu benar.

Yang merusak: **baris "nyangkut"**. Saat HMI restart/putus, baris yang sedang terbuka tidak
pernah ditutup oleh transisi status. Belakangan ada proses lain yang menutupnya dengan
stempel `now()`. Blok panjang itu lalu berjalan **paralel** dengan stream nyata yang sudah
lanjut di bawahnya — jamnya terhitung dua kali, dan ikut terkirim ke SAP.

```
proddataid 518505, mesin 48 (M5051BL3), 17-Jul-2026
14:45:53  Setting ──────────────────────────────────► 19:43:24.450   4,96 jam, duration=0
15:32:27    519502 Productive 14 mnt ┐
16:03:59    519532 Productive 47 mnt │  ini yang benar-benar terjadi
16:51:00    519631 Productive 62 mnt ┘
```

Tanda tangan baris nyangkut (Juli 2026: 516 baris ber-milidetik ≠ .000, **100%** di
antaranya `duration = 0` — korelasi sempurna, jadi penutupnya jelas bukan state machine):

| Penanda | Baris sehat | Baris nyangkut |
|---|---|---|
| `duration` (counter sumber) | > 0 | 0 |
| milidetik `enddatetime` | `.000` | ≠ `.000` |
| relasi ke baris berikutnya | `end = next_start` | `end > next_start` |

Kriteria **putusan** tetap `end > next_start`. Dua penanda lain hanya menjelaskan sebab —
banyak baris pendek tak berbahaya juga punya milidetik ≠ .000.

## Kolom di `public.mch_transaction`

| Kolom | Arti |
|---|---|
| `enddatetime` | Nilai ASLI dari sumber. Jangan diubah — ini jejak anomali. |
| `end_effective` | `LEAST(enddatetime, start baris berikutnya di mesin yang sama)`. **Ini yang dibaca konsumen.** |
| `overlap_seconds` | Detik yang terpotong clamp. 0 = sehat. |
| `is_stuck` | `overlap_seconds > 0`. Untuk laporan/alert. |

## Kenapa clamp, bukan buang barisnya

Bagian **awal** blok sering waktu nyata. `518505` buka 14:45:53 sementara baris berikutnya
baru mulai 15:32:27 — 46 menit itu tidak ditentang siapa pun. Membuang seluruh baris
menghapus jam yang sah; memotong ujungnya menghapus tepat bagian yang dobel.

## Kenapa di `mch_transaction`, bukan di sumbernya

`public.mch_productiondata` adalah **cermin SSB_OEE** (`etl_machine_conf.py`, upsert
`ON CONFLICT (proddataid)`). UPDATE apa pun di sana akan ditimpa sync berikutnya.
`mch_transaction` lapis turunan milik kita, jadi normalisasi tinggal di situ.

Akar masalahnya tetap di aplikasi OEE (baris menggantung saat HMI putus) — itu ranah vendor.
Semua di dokumen ini bersifat menambal, bukan menyembuhkan.

## Cara nilainya dijaga tetap benar

`recompute_end_effective()` di `jobs/etl/etl_mch_transaction_v3.py`, dijalankan di akhir
setiap run ETL (setelah semua upsert + `apply_overrides`).

Tiga hal yang bikin salah kalau tidak disadari:

1. **Wajib ikut menghitung ulang PENDAHULU, bukan cuma baris kandidat.** ETL ini
   inkremental. Kalau baris N+1 baru datang di batch berikutnya, `end_effective` baris N
   (dihitung waktu N+1 belum ada) SALAH dan tak akan pernah dikoreksi. Justru di situlah
   blok nyangkut lahir. Jangkarnya dicari lewat LATERAL (satu seek per mesin).
2. **Jangan ganti jangkar dengan margin waktu tetap.** Pada run nyata 22-Jul, jangkar
   terjauh ada di **13-Jul — 9 hari ke belakang**. Margin berapa pun bisa meleset.
3. **`LEAD` dihitung atas SELURUH baris mesin**, jangan disaring kelayakan SAP dulu.
   Kalau disaring, "baris berikutnya" letaknya lebih jauh dan clamp-nya kurang memotong.

Dua trik performa yang WAJIB dipertahankan (terukur di prod, 489k baris):

| Tanpa | Dengan | Kenapa |
|---|---|---|
| 1.627 ms, seq scan 489k | **42 ms** | Batas bawah `startdatetime >= <literal min jangkar>`. Nilai dari CTE tak bisa ditaksir planner → seq scan. Literal → index `(machineno, startdatetime)` terpakai. |
| seq scan 489k lagi | **9 ms** | Tulis balik lewat TEMP TABLE + `ANALYZE`. Tanpa statistik, planner mem-hash seluruh tabel; dengan statistik benar ia pakai nested loop via PK. |

Indeks pendukung: `idx_mch_transaction_machine_time (machineno, startdatetime, proddataid)`.
`proddataid` ikut karena urutan baku kita `(startdatetime, proddataid)` — dua baris bisa
mulai di detik yang sama, tanpa pemecah seri hasil `LEAD` bisa beda antar-run.

## Cara membacanya di konsumen

```sql
-- BENAR
COALESCE(end_effective, enddatetime) AS end_dipakai
```

`COALESCE` bukan basa-basi: baris yang baru di-upsert punya `end_effective` NULL sampai
recompute di akhir run selesai. Fallback ke `enddatetime` membuat perilaku di jendela
sempit itu sama dengan sebelum lapis ini ada — tidak pernah lebih buruk.

### Konsumen yang SUDAH pindah (lapis 1b)

| Konsumen | Status |
|---|---|
| `jobs/sap_staging/stage_sap_timesheet.py` → `fetch_machine_hour_rows` | ✅ pindah 2026-07-22 |
| `apps/api/controllers/machineHoursValidationController.js` (report) | ❌ belum |
| Dashboard OEE | ❌ belum |

Di stager, clamp dipasang di CTE `source_rows` dengan **alias tetap `enddatetime`**, jadi
seluruh CTE di bawahnya (split per hari, `segments`, bundling) ikut memakai nilai terpotong
tanpa perlu disentuh satu per satu.

Tiga hal yang harus diingat kalau menyentuh query itu lagi:

1. **`WHERE` membaca kolom tabel, bukan alias `SELECT`** (aturan SQL). Jadi `COALESCE`-nya
   ditulis ULANG di klausa `WHERE` — kalau tidak, baris yang habis terpotong
   (`end_effective = startdatetime`) tetap lolos ke bundling lalu mati diam-diam di filter
   `segment_end > segment_start`.
2. **Aturan klasifikasi TIDAK ikut di-clamp.** "Idle ≤300 dtk dipromosikan ke M2" dan
   "Unidentified ≤60 dtk boleh masuk" tetap memakai `duration_seconds` mentah: itu penilaian
   tentang SIFAT baris, bukan akuntansi jam. Blok nyangkut berjam-jam tidak lolos ambang itu
   dengan cara apa pun.
3. **Tidak ada risiko dobel-post.** Filter provenance (`sap_staging_source ... posted_at IS
   NOT NULL`) mengecualikan baris yang sudah ter-post, jadi clamp hanya berlaku untuk yang
   belum terkirim. Jam yang sudah telanjur di SAP TIDAK tertarik balik oleh lapis ini —
   itu hanya bisa lewat STORNO.

Dampak terukur saat dipasang (Juli 2026, baris layak SAP yang belum ter-post):
**434,10 jam → 432,95 jam (−1,16 jam)**, 82 baris nyangkut, 1 baris habis terpotong.
Angkanya kecil justru karena kerusakan besarnya sudah telanjur ter-post lebih dulu:
kalau clamp ini ada sejak awal Juli, selisihnya **165,59 jam** dari 21.425 baris layak.

## Riwayat & lapis berikutnya

- Migration: `20260722_mch_transaction_end_effective.sql` (kolom + backfill),
  `20260722_mch_transaction_machine_time_idx.sql` (indeks).
- Backfill sekali jalan: 489.306 baris, 4.955 nyangkut, 23.310 jam terpotong
  (didominasi data trial Mei–Juni; Juli sendiri 423 jam).
- Deteksi ad-hoc: `node scripts/detect_mch_stuck_blocks.js --days 7`.
- Log sesi: [[log/2026-07-22-mch-stuck-blocks]], [[log/2026-07-22-mch-normalisasi-lapis1]].
- **Lapis 1b** (konsumen pindah ke `end_effective`) dan **Lapis 2** (constraint anti-overlap):
  lihat log lapis-1.
