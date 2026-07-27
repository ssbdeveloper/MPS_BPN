---
tags: [decision-log, domain/sap]
date: 2026-07-23
topic: Recompute end_effective — lingkup kandidat (bukan --from) + guard-hole foreground
---

# 2026-07-23 — Recompute jam mesin: dari "scan 493k tiap 5 menit" ke lingkup kandidat, plus guard-hole

Lanjutan langsung [[log/2026-07-22-mch-normalisasi-lapis]]. Konsep induk:
[[concepts/mch-interval-normalization]]. Sesi ini menutup dua lubang yang tersisa setelah
lapis 1a/1b/2 dipasang: recompute yang terlalu lebar, dan asumsi clamp yang bisa memakan
kerja nyata.

## Masalah 1 — cron recompute memindai 493k baris tiap run

`recompute_end_effective()` dipanggil di akhir tiap run ETL. Cron jalan **tanpa `--from`**,
jadi `from_dt` jatuh ke default `2026-01-01`. Fragmen "touched" versi awal memungut baris dari
window `startdatetime >= from_dt` → seluruh tabel sejak Januari (~493k) di-recompute **tiap 5
menit**. Benar hasilnya, tapi boros: jangkar LATERAL + build temp jalan atas skala penuh terus.

Keputusan owner: **patch lingkupnya, jangan ubah cron.** Cron tetap tanpa `--from` (itu
memang mode operasi normal); yang salah adalah recompute tak membedakan "baris yang run ini
sentuh" dari "semua baris sejak Januari".

### Patch — lingkup dari kandidat run itu (`70dfa06`)

Recompute inkremental kini mengambil "touched" dari `CANDIDATE_TABLE` — baris yang
benar-benar di-upsert run itu — bukan dari window tanggal:

```sql
-- _TOUCHED_FROM_CANDIDATES (mode inkremental)
SELECT t.machineno, MIN(t.startdatetime) AS min_start
FROM   mch_transaction t
JOIN   <candidate> c ON c.proddataid = t.proddataid
WHERE  t.enddatetime IS NOT NULL
GROUP  BY t.machineno
```

Jebakan "pendahulu inkremental" (baris N+1 datang belakangan, `end_effective` baris N
telanjur salah) **tetap tertutup**: jangkar LATERAL menarik satu baris SEBELUM kandidat
paling awal per mesin, jadi pendahulu ikut ter-recompute walau bukan kandidat.

`--full-rebuild` tetap pakai `_TOUCHED_FROM_WINDOW` (mode manual, CANDIDATE_TABLE tak dibuat).

### Kenapa `WHERE enddatetime IS NOT NULL` KRUSIAL (bukan kosmetik)

Baris **open** (`enddatetime` NULL) ikut jadi kandidat tiap run (di-reprocess). Ada baris open
yang **menggantung sejak Januari** — HMI tak pernah kirim event tutup. Tanpa filter ini, satu
baris open Januari menyeret `MIN(startdatetime)` → jangkar mundur ke Januari → lingkup kembali
membengkak ~493k. Filter menutupnya, dan **aman**: baris open toh di-skip recompute
(`end_effective` NULL). Saat baris open AKHIRNYA ditutup, ia jadi kandidat CLOSED run itu →
ikut ter-recompute + jangkar menariknya. Itu run mahal sekali-sekali, benar adanya.

Efek terukur: lingkup run normal turun dari ~493.682 → **198 baris**.

## Masalah 2 — clamp bisa memotong kerja NYATA (guard-hole)

Clamp `end_effective = LEAST(enddatetime, next_start)` mengasumsikan baris PENUTUP-lah yang
nyangkut dan stream sesudahnya yang nyata. Untuk data Juli itu selalu benar. Tapi ada mode
gagal simetris: **blip pendek spurious di TENGAH kerja foreground nyata** → `next_start`
jatuh di dalam interval kerja yang sah → clamp memotong kerja nyata dan **kurang-kirim** ke
SAP. Under-report ke payroll sama buruknya dengan over-report.

### Patch — guard-hole untuk overlap foreground (`89a066e`)

Untuk overlap **FOREGROUND** (`status_activitytype IN ('M1','M2')` → dibukukan ke order SAP),
cek dulu apakah ekor yang akan dibuang `[next_start, enddatetime]` benar-benar **tergantikan**
stream sesudahnya (`stream_reach` = sejauh mana baris berikutnya di mesin yang sama menile):

- **Ekor penuh tergantikan** (`stream_reach >= enddatetime`) → clamp seperti biasa (dobel sejati).
- **Ada hole** (`stream_reach < enddatetime` atau NULL) → **JANGAN clamp.** Pertahankan baris
  utuh, tapi tandai `is_stuck = true` dengan `overlap_seconds = 0` → masuk antrean review,
  bukan diam-diam terpotong.

Baris terbalik (`end < start`, data sumber rusak) dikecualikan dari `stream_reach` — bukan
"cakupan" yang sah. Subquery hanya jalan untuk overlap foreground (sedikit, span pendek) → murah.

### Definisi `is_stuck` disesuaikan

`is_stuck` sekarang = baris MATERIAL overlap (≥1 dtk), **lepas dari apakah di-clamp**. Identik
definisi backfill lama (`overlap_seconds > 0`) untuk baris ter-clamp, tapi tetap `true` untuk
baris flag yang overlap besar namun sengaja tak di-clamp. **Baris review = `is_stuck AND
overlap_seconds = 0`.**

### Bukti guard-hole tidak mengubah apa pun untuk Juli

Diuji pada seluruh 493k baris prod: guard-hole == clamp polos untuk **SELURUH data Juli**
(nol beda, nol jam hilang — stream Juli selalu menile mencapai akhir baris penutup). Hanya
**8 baris trial Mei–Jun** (foreground bertetangga baris terbalik) yang ditahan + ditandai —
tak menyentuh SAP. Jadi ini murni pertahanan terhadap pola yang BELUM muncul, bukan koreksi
angka berjalan.

## Perbaikan pendukung

- **`fa82a9a` — recompute aman-urutan.** Skip diam-diam kalau kolom `end_effective` belum ada
  (mis. ETL jalan di DB yang migration lapis 1a-nya belum naik) alih-alih crash. Urutan
  deploy jadi tak rapuh: job baru + skema lama = no-op, bukan pipeline mati.
- **`9b0bea6` — dua file constraint lapis 2 ditahan di `deferred/`.** Migration
  `..._no_overlap.sql` + `..._no_overlap_deferrable.sql` sengaja tidak dijalankan otomatis
  (build GiST ACCESS EXCLUSIVE ~1,5 mnt); dijalankan manual saat lalu lintas sepi.

## Verifikasi

- Log ETL nyata: jangkar run normal jatuh di hari yang sama (bukan 2026-01-01), lingkup ~198
  baris, run kedua idempoten ("dilewati").
- Guard-hole vs clamp polos: nol beda di Juli, 8 baris tertahan di Mei–Jun (sesuai prediksi).

## Belum dikerjakan (tetap sadar)

- Report machine-hours + dashboard OEE masih baca `enddatetime` mentah (lihat konsep).
- STORNO 61,4 jam yang telanjur POSTED — dilanjut di jalur rekonsiliasi
  ([[concepts/sap-machine-hours-reconciliation]]).

## Deploy note

Perubahan murni di job ETL (`jobs/etl/etl_mch_transaction_v3.py`). Rebuild `api` tak wajib.
Deploy = redeploy container ETL. Constraint `deferred/` dijalankan manual terpisah.
