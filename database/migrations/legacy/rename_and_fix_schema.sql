-- =============================================================================
-- Migration: Column Rename & Schema Consistency
-- Generated: 2026-03-20
-- Database:  ptssb (PostgreSQL 15)
-- Run with:  psql -h <host> -p 5433 -U tag -d ptssb -f database/migrations/api/rename_and_fix_schema.sql
--
-- PRE-FLIGHT CHECKS (must both return 0 rows before running this file):
--
--   -- Check 1: processcontroldata.operation_no must be all-numeric or NULL
--   SELECT id_processcontroldata, operation_no AS bad_value
--   FROM processcontroldata
--   WHERE operation_no IS NOT NULL
--     AND TRIM(operation_no) != ''
--     AND operation_no !~ '^[0-9]+$';
--
--   -- Check 2: no duplicate (order_no, operation_no) pairs in sow
--   SELECT order_no, operation_no, COUNT(*) AS cnt
--   FROM sow
--   WHERE order_no IS NOT NULL AND operation_no IS NOT NULL
--   GROUP BY order_no, operation_no
--   HAVING COUNT(*) > 1
--   LIMIT 10;
--
-- Both must return 0 rows. Fix data issues first if any rows are returned.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Rename timesheet_transaction.seq → operation_no
-- ---------------------------------------------------------------------------
ALTER TABLE timesheet_transaction RENAME COLUMN seq TO operation_no;

-- ---------------------------------------------------------------------------
-- Step 2: Rename timesheet_transaction.production_order → order_no
-- ---------------------------------------------------------------------------
ALTER TABLE timesheet_transaction RENAME COLUMN production_order TO order_no;

-- ---------------------------------------------------------------------------
-- Step 3: Rename timesheet_transaction.ssbr_ident → ssbr_id
-- ---------------------------------------------------------------------------
ALTER TABLE timesheet_transaction RENAME COLUMN ssbr_ident TO ssbr_id;

-- ---------------------------------------------------------------------------
-- Step 4: Rename the unique constraint to match new column names
-- (PostgreSQL renames constraint column references automatically, but not
--  the constraint name itself)
-- ---------------------------------------------------------------------------
ALTER TABLE timesheet_transaction
    RENAME CONSTRAINT timesheet_po_seq_unique TO timesheet_order_opno_unique;

-- ---------------------------------------------------------------------------
-- Step 5: Rename the index to match new column name
-- ---------------------------------------------------------------------------
ALTER INDEX IF EXISTS idx_ts_production_order RENAME TO idx_ts_order_no;

-- ---------------------------------------------------------------------------
-- Step 6: Rename sow.operationtext → operation_text
-- ---------------------------------------------------------------------------
ALTER TABLE sow RENAME COLUMN operationtext TO operation_text;

-- ---------------------------------------------------------------------------
-- Step 7: Rename operations.opr_no → operation_no
-- ---------------------------------------------------------------------------
ALTER TABLE operations RENAME COLUMN opr_no TO operation_no;

-- ---------------------------------------------------------------------------
-- Step 8: Rename operations.operationtext → operation_text
-- ---------------------------------------------------------------------------
ALTER TABLE operations RENAME COLUMN operationtext TO operation_text;

-- ---------------------------------------------------------------------------
-- Step 9: Rename the unique constraint on operations to match new column name
-- ---------------------------------------------------------------------------
ALTER TABLE operations
    RENAME CONSTRAINT operations_part_id_opr_no_key TO operations_part_id_operation_no_key;

-- ---------------------------------------------------------------------------
-- Step 10: Change processcontroldata.operation_no from TEXT to INTEGER
-- Uses NULLIF to treat blank strings as NULL before casting.
-- Pre-flight Check 1 above ensures no non-numeric values exist.
-- ---------------------------------------------------------------------------
ALTER TABLE processcontroldata
    ALTER COLUMN operation_no TYPE integer
    USING NULLIF(TRIM(operation_no), '')::integer;

-- ---------------------------------------------------------------------------
-- Step 11: Add UNIQUE constraint on sow(order_no, operation_no)
-- Prerequisite for a future FK from timesheet_transaction.
-- Pre-flight Check 2 above ensures no duplicates exist.
-- ---------------------------------------------------------------------------
ALTER TABLE sow
    ADD CONSTRAINT uq_sow_order_operation UNIQUE (order_no, operation_no);

-- ---------------------------------------------------------------------------
-- Step 12: Add index on timesheet_transaction(operation_no)
-- Supports JOINs and WHERE clauses on operation_no after the rename.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ts_operation_no
    ON timesheet_transaction (operation_no);

-- ---------------------------------------------------------------------------
-- Step 13: Add index on processcontroldata(operation_no)
-- Supports lookups after the type change to integer.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pcd_operation_no
    ON processcontroldata (operation_no);

COMMIT;
