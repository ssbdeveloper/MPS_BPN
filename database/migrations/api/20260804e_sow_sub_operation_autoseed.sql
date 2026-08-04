-- Terapkan standar sub-task OTOMATIS saat baris sow baru masuk (jalur SAP).
--
-- KENAPA TRIGGER, BUKAN MENAMBAL ETL
-- Order masuk lewat jobs/etl/etl_sync_v2.py (Python, deployment terpisah). Trigger di sini
-- berlaku untuk SEMUA jalur yang membuat baris sow — ETL SAP, endpoint createFromBuilder,
-- upsert Excel, maupun INSERT manual — jadi tidak ada pintu belakang yang melewatkan seeding.
--
-- KENAPA HANYA AFTER INSERT
-- ETL memakai INSERT ... ON CONFLICT (order_no, operation_no) DO UPDATE. Untuk baris yang
-- sudah ada, Postgres menjalankan UPDATE — trigger INSERT TIDAK ikut menyala. Itu memang yang
-- diinginkan: sinkronisasi ulang order lama tidak boleh menyemai ulang sub-task yang progresnya
-- sudah diisi operator.
--
-- PENCOCOKAN memakai (part_number, operation_text) dan BUKAN operation_no — lihat alasan
-- lengkapnya di 20260804d_sow_sub_operation_standard.sql (nomor operasi bergeser antar order,
-- teksnya stabil).
--
-- IDEMPOTEN: menolak menyemai bila operasi itu SUDAH punya sub-task aktif. Jadi aman dijalankan
-- ulang, dan tidak akan pernah menimpa sub-task yang sudah diedit orang.

CREATE OR REPLACE FUNCTION public.seed_sow_sub_operation_from_standard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Keluar secepatnya untuk baris yang tidak mungkin cocok. ETL menyisipkan ribuan baris per
  -- batch, jadi jalur gagal harus murah.
  IF NEW.part_number IS NULL OR btrim(NEW.part_number) = ''
     OR NEW.operation_text IS NULL OR btrim(NEW.operation_text) = '' THEN
    RETURN NULL;
  END IF;

  -- Jangan sentuh operasi yang sudah punya sub-task: progres yang sudah diisi operator lebih
  -- berharga daripada standar.
  IF EXISTS (SELECT 1 FROM public.sow_sub_operation
              WHERE operation_id = NEW.idsow AND is_active = true) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.sow_sub_operation
        (operation_id, order_no, title, sort_order, weight, progress, status, is_active, created_by)
  SELECT NEW.idsow, NEW.order_no, std.title, std.sort_order, std.weight, 0, 'NOT_STARTED', true, 'sap-auto'
    FROM public.sow_sub_operation_standard std
   WHERE std.is_active = true
     AND upper(btrim(std.part_number))    = upper(btrim(NEW.part_number))
     AND upper(btrim(std.operation_text)) = upper(btrim(NEW.operation_text))
   ORDER BY std.sort_order, std.id;

  RETURN NULL;  -- AFTER trigger: nilai balik diabaikan
END;
$$;

DROP TRIGGER IF EXISTS trg_sow_seed_sub_operation ON public.sow;
CREATE TRIGGER trg_sow_seed_sub_operation
  AFTER INSERT ON public.sow
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_sow_sub_operation_from_standard();

COMMENT ON FUNCTION public.seed_sow_sub_operation_from_standard() IS
  'Menyemai sow_sub_operation dari sow_sub_operation_standard saat baris sow baru dibuat. '
  'Cocok lewat (part_number, operation_text). Idempoten: dilewati bila operasi sudah punya '
  'sub-task aktif. Backfill order yang sudah terlanjur ada: POST /sow/subtask-standards/backfill.';

-- ============================================================================================
-- ROLLBACK (MANUAL — runner up-only; JANGAN simpan sebagai .sql aktif di migrations/api).
--
--   DROP TRIGGER IF EXISTS trg_sow_seed_sub_operation ON public.sow;
--   DROP FUNCTION IF EXISTS public.seed_sow_sub_operation_from_standard();
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260804e_sow_sub_operation_autoseed.sql';
--
-- Membuang sub-task hasil semai otomatis (yang belum disentuh siapa pun):
--   DELETE FROM public.sow_sub_operation WHERE created_by = 'sap-auto' AND progress = 0;
-- ============================================================================================
