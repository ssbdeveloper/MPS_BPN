-- Lapis 2 (perbaikan) — constraint anti-overlap harus DEFERRABLE.
-- Konteks: docs/concepts/mch-interval-normalization.md
--
-- Versi pertama (20260722_mch_transaction_no_overlap.sql) dipasang non-deferrable, dan itu
-- BOM WAKTU: constraint EXCLUDE diperiksa PER BARIS saat UPDATE, sementara urutan baris
-- dalam satu UPDATE tidak dijamin. recompute_end_effective menyentuh baris lama (dipotong)
-- dan baris baru (diisi) dalam SATU statement, jadi ada keadaan-antara yang tumpang tindih:
--
--   baris lama : 10:00 -> 12:00   (masih panjang, sudah dijaga constraint)
--   baris baru : 11:00 -> NULL    (belum dijaga karena end_effective NULL)
--   recompute  : potong lama ke 11:00, isi baru jadi 11:00->12:00
--
--   Kalau baris BARU diproses lebih dulu, sesaat ada 10:00-12:00 dan 11:00-12:00
--   berbarengan -> constraint melempar error dan ETL gagal.
--
-- Ini BUKAN teori. Diuji langsung di tabel temp dengan bentuk constraint yang sama:
-- update logis yang identik LOLOS bila baris lama kebetulan lebih dulu secara fisik, dan
-- DITOLAK bila baris baru yang lebih dulu. Artinya versi non-deferrable membuat ETL gagal
-- secara acak, tergantung tata letak baris di disk — kegagalan paling menyebalkan yang ada.
--
-- DEFERRABLE INITIALLY IMMEDIATE: perilaku sehari-hari tetap ketat (INSERT/UPDATE nakal
-- langsung ditolak saat itu juga), tapi transaksi yang memang perlu melewati keadaan-antara
-- bisa meminta `SET CONSTRAINTS ALL DEFERRED` sehingga pemeriksaan digeser ke COMMIT —
-- yang dilakukan recompute_end_effective. INITIALLY DEFERRED sengaja TIDAK dipakai: itu
-- melonggarkan semua penulis, termasuk yang tidak butuh.
--
-- Constraint terpaksa DROP lalu ADD ulang: ALTER CONSTRAINT ... DEFERRABLE hanya berlaku
-- untuk foreign key, bukan exclusion constraint. Build GiST-nya mengambil ACCESS EXCLUSIVE
-- lock ~1,5 menit (terukur) — jalankan saat lalu lintas sepi.

ALTER TABLE public.mch_transaction
  DROP CONSTRAINT IF EXISTS mch_transaction_no_overlap;

ALTER TABLE public.mch_transaction
  ADD CONSTRAINT mch_transaction_no_overlap
  EXCLUDE USING gist (
    machineno WITH =,
    tsrange(startdatetime, end_effective) WITH &&
  )
  WHERE (end_effective IS NOT NULL AND end_effective > startdatetime)
  DEFERRABLE INITIALLY IMMEDIATE;

COMMENT ON CONSTRAINT mch_transaction_no_overlap ON public.mch_transaction IS
  'Satu mesin tidak boleh punya dua interval bersamaan. Menjaga hasil clamp end_effective (lapis 1a/1b). DEFERRABLE: recompute_end_effective memakai SET CONSTRAINTS ALL DEFERRED karena melewati keadaan-antara yang sah. Kalau ini melanggar: cari kenapa end_effective tidak ter-clamp, JANGAN buang constraint-nya.';
