-- Rollback: 20261001_timesheet_unique_active_productive_op_wc_rollback.sql
-- Rollback unique index per workcenter kembali ke unique index lama tanpa workcenter.
-- PERINGATAN: Rollback GAGAL secara fail-closed jika terdapat dua aktivitas aktif
-- pada operator/order/operation yang sama di workcenter berbeda!
-- Jangan hapus atau checkout data otomatis untuk memaksakan rollback.

DO $$
DECLARE
  v_dup_count integer;
BEGIN
  -- 1. Preflight check: periksa apakah ada duplikat aktif pada grain lama
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT plant, serialnumber, ltrim(trim(order_no), '0'), operation_no
    FROM public.timesheet_transaction
    WHERE longdate_checkout IS NULL
      AND COALESCE(state_flag, 0) <> 5
      AND (activitytype IS NULL OR trim(activitytype) = '')
      AND order_no IS NOT NULL AND trim(order_no) <> ''
      AND operation_no IS NOT NULL
    GROUP BY plant, serialnumber, ltrim(trim(order_no), '0'), operation_no
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Rollback DIBATALKAN: Terdapat % grup transaksi aktif dengan operator/order/op sama di workcenter berbeda. Transaksi tersebut harus diselesaikan terlebih dahulu sebelum mengembalikan index unik lama.', v_dup_count;
  END IF;

  -- 2. Buat kembali index unik lama
  CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheet_active_productive_op
  ON public.timesheet_transaction (
    plant,
    serialnumber,
    ltrim(trim(order_no), '0'),
    operation_no
  )
  WHERE longdate_checkout IS NULL
    AND COALESCE(state_flag, 0) <> 5
    AND (activitytype IS NULL OR trim(activitytype) = '')
    AND order_no IS NOT NULL AND trim(order_no) <> ''
    AND operation_no IS NOT NULL;

  -- 3. Hapus index scoped workcenter
  DROP INDEX IF EXISTS idx_timesheet_active_productive_op_wc;

  -- 4. Hapus catatan migrasi dari ledger (20261001, 20261001b, 20261001c)
  DELETE FROM public.schema_migrations
  WHERE filename IN (
    '20261001_timesheet_unique_active_productive_op_wc.sql',
    '20261001b_timesheet_harden_unique_index.sql',
    '20261001c_timesheet_wc_index_exact_contract.sql'
  );

  RAISE NOTICE 'Rollback migrasi 20261001, 20261001b, dan 20261001c berhasil diselesaikan.';
END $$;
