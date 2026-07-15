-- Seragamkan usernfc.nfcid ke bentuk KANONIK: desimal little-endian.
--
-- ── MASALAH ──────────────────────────────────────────────────────────────────
-- Dua reader membaca kartu yang SAMA dengan dialek berbeda:
--   • Tablet (Web NFC)              -> hex titik-dua  "52:ee:d9:69"
--   • Reader eksternal (keyboard)   -> desimal        1775890002
-- Itu KARTU FISIK YANG SAMA (diuji langsung, 2026-07-14):
--   "52:ee:d9:69" -> balik byte -> 0x69D9EE52 = 1775890002
--
-- Akibatnya satu operator bisa punya dua identitas, tergantung reader mana yang
-- dipakai saat mendaftar vs saat absen.
--
-- ── KENAPA UPDATE-nya EKSPLISIT PER-BARIS ────────────────────────────────────
-- Nilai baru DIHITUNG di apps/api/utils/nfcId.js (sudah diuji terhadap kartu fisik),
-- bukan oleh logika pembalikan byte yang ditulis ulang di SQL. Satu byte salah balik =
-- operator itu tidak bisa absen sama sekali. Nilai lama ikut di WHERE, jadi migrasi ini
-- aman dijalankan ulang (no-op kalau sudah diterapkan) dan tidak akan menimpa
-- perubahan yang dilakukan orang lain.
--
-- ── YANG SENGAJA TIDAK DISENTUH ──────────────────────────────────────────────
--   • 4 record hex-polos (C5D01205, 8D2D1405, 7E041805, 55F60E05)
--     Hasil baliknya ~85 juta, dan TIDAK ADA satu pun dari 196 record desimal yang
--     bekerja berada di rentang itu. Tanpa preseden = urutan byte-nya belum terbukti.
--     Pencocokan toleran (nfcIdVariants) sudah membuatnya tetap cocok tanpa diubah.
--   • 16 record desimal ber-nol-depan, 2 record sampah ("1385-D", "3489-P"),
--     196 record desimal. Semua tetap cocok dengan dirinya sendiri.
--
-- Runner membungkus transaksi — jangan tulis BEGIN/COMMIT.

-- ── 1. KARTU GANDA ───────────────────────────────────────────────────────────
-- '02:c0:52:69' (Bagus P, idrow 16) dan '1767030786' (Dika Eka Lestara, idrow 260)
-- adalah SATU kartu fisik yang sama (0x6952C002 = 1767030786). Selama ini kartu itu
-- login sebagai orang yang BERBEDA tergantung reader — jam kerja bisa masuk ke orang
-- yang salah.
--
-- Keputusan pemilik sistem: kartu milik DIKA. nfcid Bagus dikosongkan (record-nya
-- TETAP ADA — 3 timesheet miliknya tidak boleh hilang; dia tinggal didaftarkan
-- kartu baru).
--
-- WAJIB dijalankan SEBELUM langkah 2. Kalau tidak, '02:c0:52:69' ikut dikonversi
-- menjadi '1767030786' dan bertabrakan langsung dengan record Dika.
UPDATE public.usernfc
   SET nfcid = NULL
 WHERE idrow = 16
   AND nfcid = '02:c0:52:69';

-- ── 2. HEX TITIK-DUA -> DESIMAL LITTLE-ENDIAN ────────────────────────────────
UPDATE public.usernfc SET nfcid = '3765072081' WHERE idrow =   1 AND nfcid = 'd1:70:6a:e0'; -- Zazuli
UPDATE public.usernfc SET nfcid = '2750541963' WHERE idrow =   2 AND nfcid = '8b:f0:f1:a3'; -- Adi
UPDATE public.usernfc SET nfcid = '1776006978' WHERE idrow =   3 AND nfcid = '42:b7:db:69'; -- Roni Kurniawan
UPDATE public.usernfc SET nfcid = '3766393889' WHERE idrow =   4 AND nfcid = '21:9c:7e:e0'; -- HARI WAHYUDI
UPDATE public.usernfc SET nfcid = '3765862961' WHERE idrow =   5 AND nfcid = '31:82:76:e0'; -- SUJARI
UPDATE public.usernfc SET nfcid = '3766671361' WHERE idrow =   6 AND nfcid = '01:d8:82:e0'; -- Teguh Mulyono
UPDATE public.usernfc SET nfcid = '3765902849' WHERE idrow =   7 AND nfcid = '01:1e:77:e0'; -- Arifin
UPDATE public.usernfc SET nfcid = '1775338402' WHERE idrow =  11 AND nfcid = 'a2:83:d1:69'; -- Tegar adhitya sokhfadi
UPDATE public.usernfc SET nfcid =  '939770433' WHERE idrow =  51 AND nfcid = '41:c2:03:38'; -- FAIZAL AMRI
UPDATE public.usernfc SET nfcid = '1765694418' WHERE idrow =  80 AND nfcid = 'd2:5b:3e:69'; -- MUHAMMAD RAMADAN
UPDATE public.usernfc SET nfcid =  '939764033' WHERE idrow =  92 AND nfcid = '41:a9:03:38'; -- MUHAMAD ILHAM
UPDATE public.usernfc SET nfcid = '1759782898' WHERE idrow = 271 AND nfcid = 'f2:27:e4:68'; -- ANGGI SUPARMAN

-- ── 3. JARING PENGAMAN ───────────────────────────────────────────────────────
-- Kalau langkah 1 gagal (mis. kartu Bagus sudah diubah orang lain), langkah 2 bisa
-- melahirkan kartu ganda baru. Gagalkan migrasi daripada meninggalkan DB dalam
-- keadaan satu kartu = dua orang.
DO $$
DECLARE
  n int;
  detail text;
BEGIN
  SELECT count(*), string_agg(nfcid || ' (' || owners || ')', '; ')
    INTO n, detail
    FROM (
      SELECT nfcid, string_agg(full_name, ' + ') AS owners
        FROM public.usernfc
       WHERE NULLIF(btrim(nfcid), '') IS NOT NULL
       GROUP BY nfcid
      HAVING count(*) > 1
    ) d;

  IF n > 0 THEN
    RAISE EXCEPTION 'Kartu ganda tersisa setelah normalisasi (% kartu): %', n, detail;
  END IF;
END $$;
