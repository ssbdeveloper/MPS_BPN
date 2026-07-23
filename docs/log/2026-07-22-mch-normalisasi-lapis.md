---
tags: [decision-log]
date: 2026-07-22
topic: Normalisasi interval jam mesin (end_effective) — lapis 1a, 1b, 2 + hotfix ETL
---

# 2026-07-22 — Jam mesin: dari "blok nyangkut" ke interval yang mustahil tumpang tindih

Konsep lengkap ada di [[concepts/mch-interval-normalization]]. Log ini = kronologi
keputusan + apa yang ketemu di jalan. Lanjutan [[log/2026-07-22-mch-stuck-blocks]] (detektor).

## Masalah

Baris "nyangkut": HMI putus → baris terbuka tak pernah ditutup state machine → ditutup
proses lain dengan stempel `now()` → blok panjang berjalan paralel dengan stream nyata →
jam dobel, ikut ke SAP. 15–22 Jul: 61,4 jam sudah POSTED.

Keputusan owner: kerjakan lapis 1 bertahap ke lapis 2, tiap lapis ditulis catatannya.

## Yang dikerjakan

**Lapis 1a — lapisan data** (`68bc2ba`). Kolom `end_effective` = `LEAST(enddatetime,
start baris berikutnya)`, `overlap_seconds`, `is_stuck` di `mch_transaction` (BUKAN
`mch_productiondata` — itu cermin SSB_OEE, UPDATE-nya ketimpa sync). Clamp, bukan buang:
awal blok sering waktu nyata. Backfill 489k baris. ETL v3 menjaganya lewat
`recompute_end_effective()` di akhir tiap run — dengan tiga kehati-hatian yang bukan
formalitas (ikut hitung ulang PENDAHULU, jangkar via LATERAL bukan margin tetap, LEAD atas
semua baris). Dua trik perf terukur: literal min-jangkar (1,6s→42ms), temp table + ANALYZE
(seq scan→nested loop 9ms).

**Lapis 1b — konsumen SAP** (`30b27a1`). `fetch_machine_hour_rows` baca
`COALESCE(end_effective, enddatetime)`. Alias tetap `enddatetime` supaya CTE di bawahnya
ikut. Tiga jebakan: WHERE ulang COALESCE (bukan alias), klasifikasi tak ikut clamp, tak
ada risiko dobel-post (provenance sudah exclude posted). Dampak Juli belum-post:
434,10→432,95 jam (kecil karena kerusakan besar sudah telanjur POSTED; kalau ada sejak
awal Juli: 165,59 jam dari 21.425 baris).

**Lapis 2 — constraint** (`b417a2a`). `EXCLUDE ... tsrange(startdatetime, end_effective)
&&` per mesin. **WAJIB DEFERRABLE** — ini pelajaran termahal sesi ini (lihat bawah).

## Keputusan & pelajaran

1. **Non-deferrable EXCLUDE + UPDATE multi-baris = gagal ACAK.** Versi pertama lapis 2
   non-deferrable. `recompute` memotong baris lama & mengisi baris baru dalam satu UPDATE →
   keadaan-antara tumpang tindih. Constraint EXCLUDE cek per baris, urutan baris tak
   dijamin → update identik LOLOS/DITOLAK tergantung tata letak disk. Diuji langsung di
   tabel temp (dua urutan insert, hasil beda). Perbaikan: `DEFERRABLE INITIALLY IMMEDIATE`
   + `SET CONSTRAINTS ALL DEFERRED` di recompute. **Aturan umum: constraint EXCLUDE yang
   disentuh UPDATE batch multi-baris HARUS deferrable.**

2. **Migration tak diedit di tempat.** File pertama sudah masuk ledger `schema_migrations`,
   jadi perbaikan = file kedua (DROP + ADD ulang). `ALTER CONSTRAINT ... DEFERRABLE` cuma
   untuk FK, bukan exclusion. Jejak "salah lalu benar" sengaja tertinggal di dua file.

3. **BUG TERPISAH ketemu: ETL machine-hours MATI TOTAL 7 jam** (`ad5cff0`). Saat mau uji
   lapis 1a, `python etl_mch_transaction_v3.py` crash:
   `"..." is not a valid hexadecimal digit`. Bukan kodeku — produksi sudah mati sejak
   ~09:47 hari itu. Sebab: tiga baris `mch_productiondata` dengan `operatorid` NFC korup
   ('3sÄCÍÌÄCf&', dua string 2 karakter). Lookup nfcid menulis `guard AND cast` dalam satu
   kondisi JOIN; Postgres tak jamin urutan evaluasi → cast `::bit(32)` jalan sebelum guard
   regex → satu baris sampah mematikan seluruh pipeline. Fix: pisah konversi ke CTE
   `MATERIALIZED` tersaring. **Pelajaran: guard-lalu-cast dalam satu ekspresi SQL TIDAK
   aman; pemfilteran harus di batas evaluasi yang dijamin (CTE MATERIALIZED).** Commit
   dipisah dari lapis 1a supaya hotfix bisa cherry-pick/deploy sendiri.

## Verifikasi

- Backfill 518505: `19:43:24.450` → `15:32:27` (start baris berikutnya). Baris normal
  tak tersentuh.
- Constraint menolak INSERT tumpang tindih (`-999999` vs 519532) ✅
- ETL nyata `--from 2026-07-22` lolos dengan constraint aktif (2.125 baris di-recompute),
  run kedua idempoten (0 baris) ✅
- Invarian pasca-backfill: 0 `end_effective > enddatetime`, 0 `is_stuck` tanpa overlap ✅

## Belum dikerjakan (sadar)

- Report machine-hours + dashboard OEE masih baca `enddatetime` mentah.
- STORNO untuk 61,4 jam yang telanjur POSTED. Lapis ini mencegah yang baru, tidak menarik
  balik yang lama.

## Deploy note

4 migration baru (semua idempoten di ledger). Rebuild `api` tak wajib (perubahan hanya di
job ETL + SQL stager, bukan Express). Jadwalkan `no_overlap*` saat lalu lintas sepi (ACCESS
EXCLUSIVE lock ~1,5 mnt saat build GiST). Deploy hotfix ETL `ad5cff0` DULUAN kalau belum —
prod ETL machine-hours masih rawan mati oleh operatorid korup berikutnya sampai itu naik.
