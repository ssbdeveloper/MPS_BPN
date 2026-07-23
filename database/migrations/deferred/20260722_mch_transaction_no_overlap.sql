-- Lapis 2 — jaring pengaman: satu mesin tidak boleh punya dua interval bersamaan.
-- Konteks: docs/concepts/mch-interval-normalization.md
--
-- Lapis 1a menghitung end_effective, lapis 1b membuat stager SAP memakainya. Keduanya
-- KODE — dan kode bisa dilewati: query baru yang lupa COALESCE, ETL yang gagal di tengah,
-- atau seseorang meng-INSERT manual. Constraint ini memindahkan invariannya ke database,
-- jadi tumpang tindih bukan lagi "semoga tidak terjadi" melainkan tidak bisa terjadi.
--
-- TRADE-OFF YANG HARUS DISADARI. Kalau suatu saat ada baris tumpang tindih yang lolos,
-- ETL akan GAGAL KERAS (bisa jam 2 pagi) alih-alih diam-diam mengirim jam dobel ke SAP.
-- Itu memang yang diinginkan: gagal berisik > salah diam-diam. Tapi artinya kegagalan ETL
-- machine-hours sekarang punya satu penyebab baru yang perlu dikenali —
--   ERROR: conflicting key value violates exclusion constraint "mch_transaction_no_overlap"
-- Penanganannya BUKAN membuang constraint, melainkan cari kenapa end_effective tidak
-- ter-clamp (biasanya recompute_end_effective tidak jalan / gagal di run itu).
--
-- KENAPA PARSIAL (WHERE ...). Dua kelompok baris sengaja TIDAK dijaga:
--   1. end_effective IS NULL (105 baris) — baris yang belum ditutup sumbernya
--      (enddatetime NULL). Tanpa filter ini tsrange(start, NULL) = batas atas tak hingga,
--      dan satu baris terbuka akan "bertabrakan" dengan seluruh baris sesudahnya.
--   2. end_effective <= startdatetime (123 baris, 28-Apr..22-Jun, 17 mesin) — data sumber
--      terbalik: OEE menulis end beberapa detik SEBELUM start (selisih 5-21 detik,
--      duration_seconds = 0). tsrange() akan melempar error "range lower bound must be
--      less than or equal to upper bound" untuk baris begini. Baris ini toh sudah
--      dikecualikan dari SAP oleh filter `enddatetime > startdatetime` di stager, dan
--      tidak ada satu pun yang muncul di Juli — sepertinya sumbernya sudah membaik.
-- Yang dijaga = baris yang benar-benar mewakili rentang waktu, dan itu ~99,95% tabel.
--
-- Diverifikasi SEBELUM dipasang: 0 baris tersisa yang saling tumpang tindih.
--
-- CATATAN OPERASIONAL: membangun indeks GiST-nya mengambil ACCESS EXCLUSIVE lock atas
-- mch_transaction — pembaca (API machine-hours, dashboard) ikut menunggu selama build.
-- Constraint EXCLUDE tidak punya jalur CONCURRENTLY, jadi jalankan saat lalu lintas sepi.

ALTER TABLE public.mch_transaction
  ADD CONSTRAINT mch_transaction_no_overlap
  EXCLUDE USING gist (
    machineno WITH =,
    tsrange(startdatetime, end_effective) WITH &&
  )
  WHERE (end_effective IS NOT NULL AND end_effective > startdatetime);

COMMENT ON CONSTRAINT mch_transaction_no_overlap ON public.mch_transaction IS
  'Satu mesin tidak boleh punya dua interval bersamaan. Menjaga hasil clamp end_effective (lapis 1a/1b). Kalau ini melanggar: cari kenapa recompute_end_effective tidak meng-clamp, JANGAN buang constraint-nya.';
