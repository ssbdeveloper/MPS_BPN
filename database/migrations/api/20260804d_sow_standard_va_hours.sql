-- VA hours pada master operasi standar (public.sow_standard).
--
-- LATAR BELAKANG
-- sow_standard.std_hours menyimpan TOTAL (VA + NNVA) — lihat jobs/sow/seed_sow.js:
-- insertSowStandard() menulis getTotalStdHours(row), yang mengembalikan kolom `total_std`
-- dari CSV, atau menjumlahkan std_hours + loading + setting + measurement + unloading.
-- NNVA-nya sendiri ada di public.sow_nnva_standard, satu baris per aktivitas.
--
-- Jebakan penamaan yang ikut diperbaiki: kolom `std_hours` DI SPREADSHEET berarti porsi VA,
-- sedangkan kolom `std_hours` DI DATABASE berarti total. Nama sama, arti terbalik.
--
-- MASALAH
-- Tanpa kolom VA, VA hanya bisa diturunkan sebagai (std_hours - SUM(nnva)). Akibatnya
-- mengedit NNVA diam-diam menggeser VA, karena totalnya yang tersimpan tetap. Itu kebalikan
-- dari perilaku yang diminta: hanya VA yang boleh diedit, total mengikuti.
--
-- KEPUTUSAN
-- va_hours disimpan dan menjadi sumber kebenaran; std_hours dihitung ulang di server sebagai
-- va_hours + SUM(nnva) pada setiap penyimpanan operasi standar MAUPUN penyimpanan NNVA.
-- Bentuknya sengaja sejajar dengan public.sow (migrasi 20260804c) supaya satu model berlaku
-- di master dan di order.
--
-- std_hours SENGAJA TIDAK DIUBAH OLEH MIGRASI INI
-- 44 dari 10.982 standar punya SUM(nnva) > std_hours (mis. "Machine ID Seal Seat": std 0 jam,
-- NNVA 3,08 jam). Menghitung ulang std_hours untuk mereka akan menggelembungkan jam standar
-- dan ikut menggeser SOW baru yang dibuat darinya. Backfill hanya menurunkan va_hours dengan
-- clamp GREATEST(...,0), jadi bagi 44 baris itu va_hours = 0 dan invarian
-- va + nnva = std_hours BELUM berlaku sampai PE membuka lalu menyimpan operasinya — saat itu
-- barulah std_hours ikut dikoreksi. Ini disengaja: tidak ada perubahan massal diam-diam pada
-- 10.982 standar. Daftar 44 baris itu ada di laporan review PE.
--
-- Runner (database/migrate.js) UP-ONLY dan membungkus transaksinya sendiri — tanpa
-- BEGIN/COMMIT di sini. Idempoten: ADD COLUMN IF NOT EXISTS, CHECK dijaga cek katalog, dan
-- UPDATE dibatasi `va_hours IS NULL` supaya re-run tidak menimpa angka yang sudah diedit PE.

ALTER TABLE public.sow_standard
  ADD COLUMN IF NOT EXISTS va_hours numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sow_standard_va_hours_non_negative'
      AND conrelid = 'public.sow_standard'::regclass
  ) THEN
    ALTER TABLE public.sow_standard
      ADD CONSTRAINT sow_standard_va_hours_non_negative
      CHECK (va_hours IS NULL OR va_hours >= 0);
  END IF;
END $$;

-- Backfill: VA = total - NNVA, tidak pernah negatif. std_hours dibiarkan apa adanya.
WITH nn AS (
  SELECT sow_standard_id, SUM(COALESCE(standard_hours, 0)) AS nnva_h
  FROM public.sow_nnva_standard
  GROUP BY sow_standard_id
)
UPDATE public.sow_standard ss
   SET va_hours = GREATEST(COALESCE(ss.std_hours, 0) - COALESCE(nn.nnva_h, 0), 0)
  FROM (SELECT id FROM public.sow_standard) s
  LEFT JOIN nn ON nn.sow_standard_id = s.id
 WHERE ss.id = s.id
   AND ss.va_hours IS NULL;

COMMENT ON COLUMN public.sow_standard.va_hours IS
  'Value-added hours operasi standar ini — angka yang DIINPUT PE. std_hours = va_hours + '
  'SUM(sow_nnva_standard.standard_hours) dihitung di server saat operasi atau NNVA-nya disimpan. '
  'Perhatikan: kolom std_hours di template CSV seed_sow.js berarti porsi VA, sedangkan '
  'sow_standard.std_hours di database berarti TOTAL.';

-- ============================================================================================
-- ROLLBACK (MANUAL — runner up-only; JANGAN simpan blok ini sebagai .sql aktif di migrations/api/).
--
--   ALTER TABLE public.sow_standard DROP CONSTRAINT IF EXISTS sow_standard_va_hours_non_negative;
--   ALTER TABLE public.sow_standard DROP COLUMN IF EXISTS va_hours;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260804d_sow_standard_va_hours.sql';
--
-- std_hours tidak pernah disentuh migrasi ini, jadi rollback tidak kehilangan jam standar.
-- ============================================================================================
