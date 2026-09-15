-- VA / NNVA hours snapshot per operation on public.sow.
--
-- LATAR BELAKANG
-- Sebelum ini `planhours` adalah SATU angka tanpa rincian, dan NNVA hanya ada di
-- public.sow_nnva_standard yang menempel ke public.sow_standard (master operasi standar),
-- BUKAN ke baris order. Travel card memecah VA/NNVA secara visual saja, dengan rumus turunan
-- `Math.max(planhours - nnva, 0)` di apps/web/src/pages/PE/SowCreatePage.jsx.
--
-- Rumus turunan itu tidak pernah benar. Pengukuran di produksi (88.996 baris sow):
--   * 3.967 baris tersambung NNVA lewat source_op_id -> 98 di antaranya planhours < nnva
--     (terburuk: idsow 1297474 "Repair Deffect", planhours 0,70 vs nnva 17,33 -> VA -16,63)
--   * clamp Math.max(..., 0) menyembunyikan ini, jadi travel card SUDAH mencetak pemecahan
--     yang tidak menjumlah benar untuk baris-baris tersebut.
--
-- KEPUTUSAN
-- VA dan NNVA di-SNAPSHOT ke baris sow. `planhours` TETAP kolom tersimpan dan dihitung
-- sebagai va_hours + nnva_hours pada setiap write (dihitung di server, bukan dipercaya dari
-- klien). Konsekuensi yang disengaja:
--   * 281 kemunculan planhours di 43 file downstream (scheduling, MS Project, efisiensi
--     timesheet, kanban, dashboard) TIDAK perlu berubah — planhours tetap kolom biasa.
--   * Mengedit NNVA di master standar TIDAK lagi mengubah order lama secara retroaktif,
--     karena angkanya sudah dibekukan di baris order.
--
-- CAKUPAN BACKFILL — hanya lewat source_op_id
-- Jalur pencocokan fuzzy (SOW_STANDARD_MATCH_JOIN di sowController.js) sengaja TIDAK dipakai:
--   * cakupannya cuma 5.617 dari 83.365 baris tanpa source_op_id (6,7%)
--   * 1.115 dari 3.436 hasilnya (32,5%) menghasilkan VA negatif, versus hanya 2,5% pada jalur
--     source_op_id — bukti join itu mencocokkan ke standar yang SALAH.
-- Baris tanpa link andal diberi nnva_hours = 0, va_hours = planhours.
--
-- PERLAKUAN 722 BARIS TIDAK KONSISTEN
-- nnva_hours dipotong LEAST(nnva_std, planhours) sehingga planhours TIDAK berubah satu angka
-- pun. Jadwal dan baseline efisiensi tidak bergeser sama sekali. Yang dikorbankan: NNVA pada
-- 98 baris itu terpotong dari nilai standarnya — angka standarnya sendiri memang meragukan.
--
-- CATATAN
-- 31 baris ber-planhours NULL sengaja dibiarkan va_hours/nnva_hours NULL — tidak mengarang data.
-- TIDAK ada CHECK untuk identitas planhours = va + nnva: ada beberapa jalur INSERT lain ke sow
-- (sinkronisasi) yang mengisi planhours tanpa rincian, dan CHECK ketat akan mematikannya.
-- Identitas itu ditegakkan di controller pada jalur tulis SOW create/revision.
--
-- Runner (database/migrate.js) UP-ONLY dan membungkus transaksinya sendiri — tidak ada
-- BEGIN/COMMIT di sini. Idempoten: ADD COLUMN pakai IF NOT EXISTS, CHECK dijaga cek katalog,
-- dan UPDATE dibatasi `va_hours IS NULL` supaya re-run tidak menimpa nilai yang sudah diedit PE.

ALTER TABLE public.sow
  ADD COLUMN IF NOT EXISTS va_hours   numeric,
  ADD COLUMN IF NOT EXISTS nnva_hours numeric;

-- ADD CONSTRAINT tidak punya IF NOT EXISTS untuk CHECK; jaga supaya re-run jadi no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sow_va_hours_non_negative'
      AND conrelid = 'public.sow'::regclass
  ) THEN
    ALTER TABLE public.sow
      ADD CONSTRAINT sow_va_hours_non_negative
      CHECK (va_hours IS NULL OR va_hours >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sow_nnva_hours_non_negative'
      AND conrelid = 'public.sow'::regclass
  ) THEN
    ALTER TABLE public.sow
      ADD CONSTRAINT sow_nnva_hours_non_negative
      CHECK (nnva_hours IS NULL OR nnva_hours >= 0);
  END IF;
END $$;

-- Backfill 1/2 — baris dengan link andal ke standar (source_op_id).
-- LEAST(...) menjaga planhours tidak berubah dan va_hours tidak pernah negatif.
WITH nn AS (
  SELECT sow_standard_id, SUM(COALESCE(standard_hours, 0)) AS nnva_h
  FROM public.sow_nnva_standard
  GROUP BY sow_standard_id
)
UPDATE public.sow s
   SET nnva_hours = LEAST(nn.nnva_h, s.planhours),
       va_hours   = s.planhours - LEAST(nn.nnva_h, s.planhours)
  FROM nn
 WHERE nn.sow_standard_id = s.source_op_id
   AND s.planhours IS NOT NULL
   AND s.va_hours IS NULL;

-- Backfill 2/2 — sisanya: tanpa source_op_id, atau punya source_op_id tapi standarnya tidak
-- memiliki baris NNVA sama sekali. Keduanya: seluruh planhours dianggap VA.
UPDATE public.sow
   SET nnva_hours = 0,
       va_hours   = planhours
 WHERE va_hours IS NULL
   AND planhours IS NOT NULL;

COMMENT ON COLUMN public.sow.va_hours IS
  'Value-added hours untuk operasi ini. Angka yang DIINPUT PE. planhours = va_hours + nnva_hours '
  'dihitung di server saat write. Snapshot per order — tidak ikut berubah bila NNVA di master '
  'standar diedit.';

COMMENT ON COLUMN public.sow.nnva_hours IS
  'Non-value-added hours untuk operasi ini, di-snapshot dari sow_nnva_standard saat operasi '
  'dipilih dari standar. 0 untuk operasi yang ditambah manual atau tanpa link standar yang andal.';

-- ============================================================================================
-- ROLLBACK (MANUAL — runner up-only; JANGAN simpan blok ini sebagai .sql aktif di migrations/api/).
--
--   ALTER TABLE public.sow DROP CONSTRAINT IF EXISTS sow_va_hours_non_negative;
--   ALTER TABLE public.sow DROP CONSTRAINT IF EXISTS sow_nnva_hours_non_negative;
--   ALTER TABLE public.sow DROP COLUMN IF EXISTS va_hours;
--   ALTER TABLE public.sow DROP COLUMN IF EXISTS nnva_hours;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260804c_sow_va_nnva_hours.sql';
--
-- planhours TIDAK pernah disentuh migrasi ini, jadi rollback tidak kehilangan data jadwal.
-- ============================================================================================
