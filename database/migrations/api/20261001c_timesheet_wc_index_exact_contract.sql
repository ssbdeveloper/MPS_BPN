-- Migration: 20261001c_timesheet_wc_index_exact_contract.sql
-- Supersedes the index verification of 20261001b. 20261001 and 20261001b are already
-- recorded in lab ledgers and stay byte-identical; this file corrects their defect:
-- in PostgreSQL E'\v' is the letter 'v' (not vertical tab), so the index they build
-- strips a leading/trailing letter 'v' and does not match the JS/Python contract.
--
-- Whitespace contract (identical in SQL, JS, Python): strip, at both ends only, the set
--   U+0020 U+0009 U+000D U+000A U+000B U+000C U+00A0 U+FEFF
-- SQL literal: E' \t\r\n\x0B\f\u00A0\uFEFF'. Casing and inner spaces are preserved;
-- NULL becomes ''.
--
-- Verification compares the catalog signature of the live index with reference indexes
-- built on a temp copy of the table (access method, uniqueness, key columns/expressions,
-- opclasses, collations, options, predicate), plus table binding and indisvalid/indisready.
--   expected signature            -> keep
--   signature written by 20261001 or 20261001b -> rebuild under a temp name, swap
--   anything else / invalid / not ready / wrong table -> abort, legacy index untouched
-- The legacy index is dropped only after the new one is verified.
-- The release runner applies every pending file of a manifest in ONE transaction
-- (database/migrate.js applyManifestSelected), so a failure here also rolls back a
-- 20261001/20261001b applied in the same run, together with their ledger rows.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION pg_temp.ts_wc_index_sig(p_index oid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $f$
  SELECT jsonb_build_object(
           'am', a.amname,
           'unique', i.indisunique,
           'natts', i.indnatts,
           'nkeyatts', i.indnkeyatts,
           'cols', (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid, k, true) ORDER BY k)
                    FROM generate_series(1, i.indnatts) k),
           'pred', pg_get_expr(i.indpred, i.indrelid, true),
           'opclass', i.indclass::text,
           'collation', i.indcollation::text,
           'option', i.indoption::text)
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_am a ON a.oid = c.relam
  WHERE i.indexrelid = p_index
$f$;

DO $$
DECLARE
  c_strip     CONSTANT text := E' \t\r\n\x0B\f\u00A0\uFEFF';
  c_strip_v   CONSTANT text := E' \t\r\nv\f';                -- as written by 20261001
  c_strip_vb  CONSTANT text := E' \t\r\nv\f\u00A0\uFEFF';    -- as written by 20261001b
  c_name      CONSTANT text := 'idx_timesheet_active_productive_op_wc';
  c_next      CONSTANT text := 'idx_timesheet_active_productive_op_wc_next';
  c_ddl       CONSTANT text :=
    'CREATE UNIQUE INDEX %I ON %s (plant, serialnumber, ltrim(trim(order_no), ''0''), operation_no, '
    'btrim(COALESCE(workcentercode, ''''), %L)) '
    'WHERE longdate_checkout IS NULL AND COALESCE(state_flag, 0) <> 5 '
    'AND (activitytype IS NULL OR trim(activitytype) = '''') '
    'AND order_no IS NOT NULL AND trim(order_no) <> '''' AND operation_no IS NOT NULL';
  v_tbl       oid := to_regclass('public.timesheet_transaction');
  v_dups      integer;
  v_expected  jsonb;
  v_known_v   jsonb;
  v_known_vb  jsonb;
  v_live      jsonb;
  v_idx       record;
BEGIN
  IF v_tbl IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_ABORTED: tabel public.timesheet_transaction tidak ditemukan.';
  END IF;

  -- 1. Active productive duplicates on the target grain make the index impossible.
  SELECT COUNT(*) INTO v_dups FROM (
    SELECT 1
    FROM public.timesheet_transaction
    WHERE longdate_checkout IS NULL
      AND COALESCE(state_flag, 0) <> 5
      AND (activitytype IS NULL OR trim(activitytype) = '')
      AND order_no IS NOT NULL AND trim(order_no) <> ''
      AND operation_no IS NOT NULL
    GROUP BY plant, serialnumber, ltrim(trim(order_no), '0'), operation_no,
             btrim(COALESCE(workcentercode, ''), c_strip)
    HAVING COUNT(*) > 1
  ) d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'MIGRATION_ABORTED: % grup duplikat aktif produktif pada grain workcenter; index lama dipertahankan.', v_dups;
  END IF;

  -- 2. Reference signatures from real indexes on a temp copy (no hand-written catalog text).
  CREATE TEMP TABLE _ts_wc_ref (LIKE public.timesheet_transaction) ON COMMIT DROP;
  EXECUTE format(c_ddl, '_ts_wc_ref_expected', '_ts_wc_ref', c_strip);
  EXECUTE format(c_ddl, '_ts_wc_ref_known_v',  '_ts_wc_ref', c_strip_v);
  EXECUTE format(c_ddl, '_ts_wc_ref_known_vb', '_ts_wc_ref', c_strip_vb);
  v_expected := pg_temp.ts_wc_index_sig('_ts_wc_ref_expected'::regclass);
  v_known_v  := pg_temp.ts_wc_index_sig('_ts_wc_ref_known_v'::regclass);
  v_known_vb := pg_temp.ts_wc_index_sig('_ts_wc_ref_known_vb'::regclass);
  IF v_expected IS NULL OR v_known_v IS NULL OR v_known_vb IS NULL
     OR v_expected IN (v_known_v, v_known_vb) THEN
    RAISE EXCEPTION 'MIGRATION_ABORTED: gagal membangun signature referensi index.';
  END IF;

  -- 3. Inspect whatever currently owns the target name in schema public.
  SELECT c.oid, c.relkind, i.indrelid, i.indisvalid, i.indisready
    INTO v_idx
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_index i ON i.indexrelid = c.oid
  WHERE n.nspname = 'public' AND c.relname = c_name;

  IF FOUND THEN
    IF v_idx.relkind <> 'i' OR v_idx.indrelid IS DISTINCT FROM v_tbl THEN
      RAISE EXCEPTION 'MIGRATION_ABORTED: objek public.% ada tetapi bukan index pada public.timesheet_transaction; index lama dipertahankan.', c_name;
    END IF;
    IF NOT v_idx.indisvalid OR NOT v_idx.indisready THEN
      RAISE EXCEPTION 'MIGRATION_ABORTED: index public.% INVALID/NOT READY (valid=%, ready=%); index lama dipertahankan.',
        c_name, v_idx.indisvalid, v_idx.indisready;
    END IF;

    v_live := pg_temp.ts_wc_index_sig(v_idx.oid);
    IF v_live = v_expected THEN
      RAISE NOTICE 'index public.% sudah sesuai kontrak; dipertahankan.', c_name;
    ELSIF v_live IN (v_known_v, v_known_vb) THEN
      IF to_regclass('public.' || c_next) IS NOT NULL THEN
        RAISE EXCEPTION 'MIGRATION_ABORTED: nama sementara public.% sudah dipakai; periksa manual.', c_next;
      END IF;
      -- Build the replacement first; the old one keeps protecting until the swap.
      EXECUTE format(c_ddl, c_next, 'public.timesheet_transaction', c_strip);
      EXECUTE format('DROP INDEX public.%I', c_name);
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', c_next, c_name);
      RAISE NOTICE 'index public.% (definisi 20261001/20261001b, strip huruf v) diganti dengan kontrak eksak.', c_name;
    ELSE
      RAISE EXCEPTION 'MIGRATION_ABORTED: index public.% punya definisi tidak dikenal; index lama dipertahankan. Definisi: %',
        c_name, pg_get_indexdef(v_idx.oid);
    END IF;
  ELSE
    EXECUTE format(c_ddl, c_name, 'public.timesheet_transaction', c_strip);
  END IF;

  -- 4. Final verification of the live index by name before touching legacy protection.
  SELECT c.oid, i.indrelid, i.indisvalid, i.indisready
    INTO v_idx
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_index i ON i.indexrelid = c.oid
  WHERE n.nspname = 'public' AND c.relname = c_name;
  IF NOT FOUND OR v_idx.indrelid <> v_tbl OR NOT v_idx.indisvalid OR NOT v_idx.indisready
     OR pg_temp.ts_wc_index_sig(v_idx.oid) IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'MIGRATION_ABORTED: verifikasi akhir public.% gagal; index lama dipertahankan.', c_name;
  END IF;

  -- 5. Only now remove the legacy grain (no workcenter).
  IF to_regclass('public.idx_timesheet_active_productive_op') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_index
      WHERE indexrelid = to_regclass('public.idx_timesheet_active_productive_op') AND indrelid = v_tbl
    ) THEN
      RAISE EXCEPTION 'MIGRATION_ABORTED: public.idx_timesheet_active_productive_op bukan index pada timesheet_transaction.';
    END IF;
    DROP INDEX public.idx_timesheet_active_productive_op;
  END IF;

  DROP TABLE _ts_wc_ref;
END $$;

DROP FUNCTION pg_temp.ts_wc_index_sig(oid);
