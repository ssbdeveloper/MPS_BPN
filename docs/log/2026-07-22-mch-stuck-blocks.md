---
tags: [decision-log]
date: 2026-07-22
topic: Overlap jam mesin — mekanismenya "blok nyangkut", plus detektor read-only
---

# 2026-07-22 — Overlap mch_productiondata: bukan duplikasi sync, tapi baris yang tak pernah ditutup

Lanjutan [[mch-productiondata-duplication]] (2026-07-20). Waktu itu kesimpulannya "overlap
sejati kecil, perlu lihat kasus per kasus". Sekarang mekanismenya ketemu dan bisa dideteksi
otomatis.

## Bentuk normal vs anomali

Stream OEE normalnya **tiling**: `enddatetime` baris N == `startdatetime` baris N+1 pada mesin
yang sama. Juli: 24.402 dari 25.054 baris (97,4%). Menjumlahkan durasinya BENAR.

Anomalinya: baris yang **tidak pernah ditutup oleh transisi status**. Saat HMI restart/putus,
baris yang sedang terbuka menggantung; belakangan ada proses lain menutupnya dengan stempel
`now()`. Hasilnya blok panjang yang berjalan PARALEL dengan stream nyata yang sudah lanjut.

Contoh kanonik — `proddataid 518505`, mesin 48 (M5051BL3), order 1000129044-170:

```
14:45:53  Setting ──────────────────────────────────► 19:43:24.450   4,96 jam, duration=0
15:32:27    519502 Productive 14 mnt ┐
16:03:59    519532 Productive 47 mnt │  stream NYATA jalan di bawahnya
16:51:00    519631 Productive 62 mnt ┘
```

**Tanda tangan** (diverifikasi, bukan dugaan):

| Penanda | Normal | Nyangkut |
|---|---|---|
| `duration` (counter sumber) | > 0 | **0** |
| milidetik `enddatetime` | `.000` | **≠ .000** (ditutup program) |
| relasi ke baris berikutnya | `end = next_start` | `end > next_start` |

Juli: **516 baris** ber-milidetik ≠ .000, dan **100%** di antaranya `duration = 0`. Korelasi
sempurna itu yang membuktikan penutupnya bukan state machine. Tapi kriteria PUTUSAN tetap
`end > next_start` — penanda ms/duration menjelaskan sebab, tidak dipakai sebagai syarat
(banyak baris pendek tak berbahaya juga punya ms ≠ .000).

## Skala

| Bulan | Baris overlap | Jam overlap (semua status) | Jam M1/M2 |
|---|---|---|---|
| Mei | 1.075 | 9.369 | 553,7 |
| Juni | 3.589 | 3.832 | 328,6 |
| Juli | 372 | 423 | 9,32 |

Tren membaik drastis, **tapi belum berhenti** — masih muncul hampir tiap hari. 7 hari terakhir
(15–22 Jul): 140 blok, 344,43 jam dobel wall-clock; **64 blok ter-stage (74,23 jam), 61 sudah
POSTED (61,38 jam terkirim ke SAP)**.

Koreksi penting atas asumsi lama: **bukan cuma M1/M2 yang bocor ke SAP.** Sejak aturan
kelayakan 2026-07-15, status unproductive ikut di-stage (cost center) — hanya statusid 0/3/4
(Off/Downtime/No Job) yang dikecualikan. Contoh terburuk minggu ini: `513614` = "Coffee Break /
Lunch" **146 jam** (6 hari) di M5051SW1, melahirkan 2 bundel: staging 45451 PENDING 12,10 jam
dan 45617 **POSTED 14,08 jam** (14 jam coffee break dalam sehari untuk satu operator).

## Yang dikerjakan

`scripts/detect_mch_stuck_blocks.js` — **READ-ONLY**, tidak menyentuh data:

```bash
node scripts/detect_mch_stuck_blocks.js --days 7
node scripts/detect_mch_stuck_blocks.js --from 2026-07-17 --to 2026-07-17
node scripts/detect_mch_stuck_blocks.js --json --strict     # cron: exit 1 bila ada yang ter-stage
```

Melaporkan per blok: mesin, status, panjang blok, jam overlap, dan **jam persis yang
ter-stage/ter-POST** (dari `sap_staging_source.seconds`, provenance 2026-07-14 — bukan taksiran).

Dua jebakan yang sudah ditangani di skrip (dan wajib diikuti kalau logikanya dipakai ulang):

1. `LEAD` dihitung atas **seluruh** baris mesin, bukan hasil filter kelayakan SAP. Kalau
   difilter dulu, "baris berikutnya" jadi lebih jauh dan overlap terbaca lebih kecil.
2. Join ke `sap_staging_source` pakai **LATERAL beragregat**. Satu baris sumber bisa masuk
   beberapa bundel harian (blok 6 hari pasti begitu); join polos menggandakan bloknya di
   laporan dan menggelembungkan hitungan "sudah POSTED" (terbukti: 65 → 64 setelah diperbaiki).

## Belum dikerjakan — keputusan owner

**Clamp di stager** (`fetch_machine_hour_rows`): potong `enddatetime` ke start baris berikutnya,
`LEAST(enddatetime, next_start)`. Clamp, BUKAN drop — bagian awal blok (mis. 518505: 14:45:53 →
15:32:27, 46 menit) tidak ditentang baris mana pun, jadi itu waktu nyata; membuang seluruh baris
menghapus jam yang sah. Clamp memulihkan invarian tiling → dobel jadi mustahil secara struktural.

Juga belum: clamp yang sama di query laporan/OEE (tanpa itu No Job 248 jam & Coffee Break 149 jam
Juli tetap meracuni OEE), dan STORNO untuk yang sudah ter-POST (lihat backlog).

**JANGAN perbaiki `mch_productiondata` langsung** — itu cermin SSB_OEE (`etl_machine_conf.py`
upsert `ON CONFLICT (proddataid)`), koreksi manual akan ditimpa sync berikutnya. Akar masalahnya
di aplikasi OEE (baris menggantung saat HMI putus) — itu ranah vendor.
