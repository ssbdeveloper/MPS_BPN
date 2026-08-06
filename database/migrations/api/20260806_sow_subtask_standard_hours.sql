-- Sub-task: standard_hours jadi SUMBER bobot (weight = share jam), bukan input manual.
-- Keputusan sesi 2026-08-06: 1a 2a 3a 4a.
--   1a master standar ikut punya standard_hours (autoseed menyalin jam)
--   2a sub-task jam 0 → bobot 0 → dikeluarkan dari roll-up
--   3a bobot ditampilkan sebagai persen
--   4a kolom template Excel 'weight' diganti 'standard_hours' (weight jadi turunan)
-- Cap: SUM(standard_hours sub-task aktif) <= sow.planhours (ditegakkan controller-side,
--     hanya saat planhours > 0; cross-row SUM tidak bisa jadi CHECK constraint).

-- 1) Kolom baru di tabel sub-task (sumber kebenaran jam).
ALTER TABLE public.sow_sub_operation
  ADD COLUMN IF NOT EXISTS standard_hours numeric(10,2) NOT NULL DEFAULT 1;

-- 2) Kolom baru di master standar (template menyimpan jam; autoseed menyalinnya).
ALTER TABLE public.sow_sub_operation_standard
  ADD COLUMN IF NOT EXISTS standard_hours numeric(10,2) NOT NULL DEFAULT 1;

-- 3) Backfill: data lama yang weight-nya != 1 dianggap jam (rasio antar sub-task terjaga;
--    yang weight = 1 default jam = 1). Tabel masih nyaris kosong (1 baris) saat migrasi ditulis.
UPDATE public.sow_sub_operation s
   SET standard_hours = s.weight
 WHERE s.weight <> 1;

UPDATE public.sow_sub_operation_standard s
   SET standard_hours = s.weight
 WHERE s.weight <> 1;

-- 4) Weight derived = standard_hours / SUM(standard_hours) per operasi (aktif saja).
UPDATE public.sow_sub_operation s
   SET weight = round(s.standard_hours / t.total, 4)
  FROM (SELECT operation_id, SUM(standard_hours) AS total
          FROM public.sow_sub_operation
         WHERE is_active = true
         GROUP BY operation_id) t
 WHERE s.operation_id = t.operation_id AND s.is_active = true AND t.total > 0;

-- 5) Constraint: jam tidak boleh negatif.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_sow_sub_op_hours_nonneg'
       AND conrelid = 'public.sow_sub_operation'::regclass
  ) THEN
    ALTER TABLE public.sow_sub_operation
      ADD CONSTRAINT chk_sow_sub_op_hours_nonneg CHECK (standard_hours >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_sow_sub_op_std_hours_nonneg'
       AND conrelid = 'public.sow_sub_operation_standard'::regclass
  ) THEN
    ALTER TABLE public.sow_sub_operation_standard
      ADD CONSTRAINT chk_sow_sub_op_std_hours_nonneg CHECK (standard_hours >= 0);
  END IF;
END $$;

-- 6) Trigger autoseed: salin standard_hours dari master (bukan weight), lalu hitung weight
--    = share jam di antara sub-task aktif operasi itu (hasil semai = satu-satunya isi operasi,
--    jadi share = rasio jam; idempoten seperti sebelumnya — dilewati bila sudah ada sub-task).
CREATE OR REPLACE FUNCTION public.seed_sow_sub_operation_from_standard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_total numeric;
BEGIN
  IF NEW.part_number IS NULL OR btrim(NEW.part_number) = ''
     OR NEW.operation_text IS NULL OR btrim(NEW.operation_text) = '' THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.sow_sub_operation
              WHERE operation_id = NEW.idsow AND is_active = true) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.sow_sub_operation
        (operation_id, order_no, title, sort_order, standard_hours, progress, status, is_active, created_by)
  SELECT NEW.idsow, NEW.order_no, std.title, std.sort_order, std.standard_hours, 0, 'NOT_STARTED', true, 'sap-auto'
    FROM public.sow_sub_operation_standard std
   WHERE std.is_active = true
     AND upper(btrim(std.part_number))    = upper(btrim(NEW.part_number))
     AND upper(btrim(std.operation_text)) = upper(btrim(NEW.operation_text))
   ORDER BY std.sort_order, std.id;

  SELECT SUM(standard_hours) INTO v_total
    FROM public.sow_sub_operation
   WHERE operation_id = NEW.idsow AND is_active = true;

  IF v_total IS NOT NULL AND v_total > 0 THEN
    UPDATE public.sow_sub_operation
       SET weight = round(standard_hours / v_total, 4)
     WHERE operation_id = NEW.idsow AND is_active = true;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON COLUMN public.sow_sub_operation.standard_hours IS
  'Jam standar sub-task (sumber kebenaran). Bobot = standard_hours / SUM(standard_hours) atas sub-task AKTIF operasi itu. 0 = dikeluarkan dari roll-up.';
COMMENT ON COLUMN public.sow_sub_operation_standard.standard_hours IS
  'Jam standar template sub-task; disalin ke sow_sub_operation.standard_hours saat autoseed.';
COMMENT ON COLUMN public.sow_sub_operation.weight IS
  'TURUNAN: share jam (standard_hours / total). Dihitung ulang controller-side; JANGAN diedit manual.';

-- ============================================================================================
-- ROLLBACK (MANUAL — runner up-only; JANGAN simpan sebagai .sql aktif di migrations/api).
--
--   ALTER TABLE public.sow_sub_operation DROP CONSTRAINT IF EXISTS chk_sow_sub_op_hours_nonneg;
--   ALTER TABLE public.sow_sub_operation_standard DROP CONSTRAINT IF EXISTS chk_sow_sub_op_std_hours_nonneg;
--   ALTER TABLE public.sow_sub_operation DROP COLUMN IF EXISTS standard_hours;
--   ALTER TABLE public.sow_sub_operation_standard DROP COLUMN IF EXISTS standard_hours;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260806_sow_subtask_standard_hours.sql';
-- ============================================================================================
