-- Migration: 20261001b_timesheet_harden_unique_index.sql
-- Hardening and verification of workcenter-scoped unique active productive index.
-- Guarantees atomic verification of index table, uniqueness, expression, predicate,
-- validity, and ready status before dropping legacy protection.
-- Unified whitespace contract: E' \t\r\n\v\f\u00a0\ufeff' (handles ASCII whitespace,
-- vertical tab, form feed, non-breaking space NBSP, and byte order mark BOM).

DO $$
DECLARE
  v_dup_count integer;
  v_idx_record RECORD;
BEGIN
  -- 1. Preflight duplicate check on the workcenter-scoped grain
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT plant, serialnumber, ltrim(trim(order_no), '0'), operation_no,
           btrim(COALESCE(workcentercode, ''), E' \t\r\n\v\f\u00a0\ufeff')
    FROM public.timesheet_transaction
    WHERE longdate_checkout IS NULL
      AND COALESCE(state_flag, 0) <> 5
      AND (activitytype IS NULL OR trim(activitytype) = '')
      AND order_no IS NOT NULL AND trim(order_no) <> ''
      AND operation_no IS NOT NULL
    GROUP BY plant, serialnumber, ltrim(trim(order_no), '0'), operation_no,
             btrim(COALESCE(workcentercode, ''), E' \t\r\n\v\f\u00a0\ufeff')
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION_ABORTED: Ditemukan % grup data duplikat aktif produktif pada grain workcenter. Migrasi dihentikan dan index lama dipertahankan.', v_dup_count;
  END IF;

  -- 2. Inspect existing index idx_timesheet_active_productive_op_wc
  SELECT 
    i.indisunique,
    i.indisvalid,
    i.indisready,
    c.relname AS index_name,
    t.relname AS table_name,
    pg_get_indexdef(i.indexrelid) AS indexdef
  INTO v_idx_record
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'idx_timesheet_active_productive_op_wc';

  IF FOUND THEN
    -- Verify table binding
    IF v_idx_record.table_name <> 'timesheet_transaction' THEN
      RAISE EXCEPTION 'MIGRATION_ABORTED: Index idx_timesheet_active_productive_op_wc terikat pada tabel salah: %', v_idx_record.table_name;
    END IF;

    -- Verify uniqueness
    IF NOT v_idx_record.indisunique THEN
      RAISE EXCEPTION 'MIGRATION_ABORTED: Index idx_timesheet_active_productive_op_wc sudah ada tetapi BUKAN UNIQUE index. Hentikan migrasi; perlindungan lama dipertahankan.';
    END IF;

    -- Verify valid and ready
    IF NOT v_idx_record.indisvalid OR NOT v_idx_record.indisready THEN
      RAISE EXCEPTION 'MIGRATION_ABORTED: Index idx_timesheet_active_productive_op_wc dalam status INVALID atau NOT READY. Hentikan migrasi; perlindungan lama dipertahankan.';
    END IF;

    -- Verify structural columns and predicates
    IF v_idx_record.indexdef NOT LIKE '%ltrim(TRIM(BOTH FROM order_no), ''0''::text)%'
       OR v_idx_record.indexdef NOT LIKE '%operation_no%'
       OR v_idx_record.indexdef NOT LIKE '%btrim(COALESCE(workcentercode%'
       OR v_idx_record.indexdef NOT LIKE '%longdate_checkout IS NULL%' THEN
      RAISE EXCEPTION 'MIGRATION_ABORTED: Index idx_timesheet_active_productive_op_wc memiliki definisi kolom/predikat yang tidak sesuai spesifikasi: %', v_idx_record.indexdef;
    END IF;

    -- If existing definition lacks full NBSP / BOM whitespace set, replace atomically
    IF v_idx_record.indexdef NOT LIKE '% %' THEN
      DROP INDEX public.idx_timesheet_active_productive_op_wc;
      CREATE UNIQUE INDEX idx_timesheet_active_productive_op_wc
      ON public.timesheet_transaction (
        plant,
        serialnumber,
        ltrim(trim(order_no), '0'),
        operation_no,
        btrim(COALESCE(workcentercode, ''), E' \t\r\n\v\f\u00a0\ufeff')
      )
      WHERE longdate_checkout IS NULL
        AND COALESCE(state_flag, 0) <> 5
        AND (activitytype IS NULL OR trim(activitytype) = '')
        AND order_no IS NOT NULL AND trim(order_no) <> ''
        AND operation_no IS NOT NULL;
    END IF;
  ELSE
    -- Index does not exist: create it cleanly
    CREATE UNIQUE INDEX idx_timesheet_active_productive_op_wc
    ON public.timesheet_transaction (
      plant,
      serialnumber,
      ltrim(trim(order_no), '0'),
      operation_no,
      btrim(COALESCE(workcentercode, ''), E' \t\r\n\v\f\u00a0\ufeff')
    )
    WHERE longdate_checkout IS NULL
      AND COALESCE(state_flag, 0) <> 5
      AND (activitytype IS NULL OR trim(activitytype) = '')
      AND order_no IS NOT NULL AND trim(order_no) <> ''
      AND operation_no IS NOT NULL;
  END IF;

  -- 3. Final verification of new index state
  SELECT 
    i.indisunique,
    i.indisvalid,
    i.indisready,
    t.relname AS table_name
  INTO v_idx_record
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'idx_timesheet_active_productive_op_wc';

  IF NOT FOUND OR NOT v_idx_record.indisunique OR NOT v_idx_record.indisvalid OR NOT v_idx_record.indisready THEN
    RAISE EXCEPTION 'MIGRATION_ABORTED: Verifikasi akhir index baru idx_timesheet_active_productive_op_wc gagal (unique=%, valid=%, ready=%).',
      v_idx_record.indisunique, v_idx_record.indisvalid, v_idx_record.indisready;
  END IF;

  -- 4. Only drop legacy index if new index is completely verified
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'idx_timesheet_active_productive_op'
  ) THEN
    DROP INDEX public.idx_timesheet_active_productive_op;
  END IF;
END $$;
