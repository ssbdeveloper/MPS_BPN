-- ============================================================
-- MIGRATION: fix_schema_consistency.sql
-- Database: ptssb
-- Generated: 2026-03-04
--
-- PURPOSE:
--   Rename columns in timesheet_transaction to match sow naming,
--   change column types for consistency, drop redundant denormalized
--   columns, and add missing foreign key constraints.
--
-- TABLES AFFECTED:
--   - timesheet_transaction (renames, type changes, drops, FK)
--   - sow                   (add UNIQUE constraint, add FK)
--   - usernfc               (add FK)
--
-- ============================================================
-- HOW TO RUN:
--   psql -h 100.80.101.53 -p 5433 -U tag -d ptssb -f fix_schema_consistency.sql
--
-- TO ROLLBACK (if needed, within same session before COMMIT):
--   ROLLBACK;
-- ============================================================

BEGIN;

-- ============================================================
-- PRE-FLIGHT CHECKS
-- Run these SELECT queries first. If they return rows,
-- fix the data issues BEFORE proceeding with the migration.
-- ============================================================

-- CHECK 1: Verify column names haven't already been renamed
-- (safe to run multiple times - IF EXISTS guards protect against re-runs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'timesheet_transaction'
      AND column_name = 'production_order'
  ) THEN
    RAISE NOTICE 'SKIP: Column production_order already renamed — STEP 1 renames will be skipped';
  ELSE
    RAISE NOTICE 'OK: Column production_order exists — safe to rename';
  END IF;
END $$;

-- CHECK 2: Verify no invalid date values in date_checkin / date_checkout
-- Expected: 0 rows
SELECT 'date_checkin' AS column_name, date_checkin AS bad_value, tsnumber
FROM timesheet_transaction
WHERE date_checkin IS NOT NULL
  AND TRIM(date_checkin) != ''
  AND date_checkin !~ '^\d{2}/\d{2}/\d{4}$'
  AND date_checkin !~ '^\d{4}-\d{2}-\d{2}$'
UNION ALL
SELECT 'date_checkout', date_checkout, tsnumber
FROM timesheet_transaction
WHERE date_checkout IS NOT NULL
  AND TRIM(date_checkout) != ''
  AND date_checkout !~ '^\d{2}/\d{2}/\d{4}$'
  AND date_checkout !~ '^\d{4}-\d{2}-\d{2}$';

-- CHECK 3: Verify no invalid time values in hour_checkin / hour_checkout
-- Expected: 0 rows
SELECT 'hour_checkin' AS column_name, hour_checkin AS bad_value, tsnumber
FROM timesheet_transaction
WHERE hour_checkin IS NOT NULL
  AND TRIM(hour_checkin) != ''
  AND hour_checkin !~ '^\d{2}:\d{2}(:\d{2})?$'
UNION ALL
SELECT 'hour_checkout', hour_checkout, tsnumber
FROM timesheet_transaction
WHERE hour_checkout IS NOT NULL
  AND TRIM(hour_checkout) != ''
  AND hour_checkout !~ '^\d{2}:\d{2}(:\d{2})?$';

-- CHECK 4: Verify no invalid planhours values (non-numeric)
-- Expected: 0 rows
SELECT tsnumber, planhours AS bad_planhours
FROM timesheet_transaction
WHERE planhours IS NOT NULL
  AND TRIM(planhours) != ''
  AND planhours !~ '^-?[0-9]+(\.[0-9]+)?$';

-- CHECK 5: Verify timesheet records can find matching rows in sow
-- (needed before adding FK timesheet_transaction → sow)
-- Expected: 0 rows (all timesheet records should link to a sow entry)
SELECT
    t.tsnumber,
    t.production_order,
    t.seq,
    'No matching sow row' AS issue
FROM timesheet_transaction t
WHERE NOT EXISTS (
    SELECT 1 FROM sow s
    WHERE s.order_no = t.production_order
      AND s.operation_no = t.seq
)
  AND t.production_order IS NOT NULL
  AND t.seq IS NOT NULL;

-- CHECK 6: Verify sow(order_no, operation_no) is unique (required for FK reference)
-- Expected: 0 rows
SELECT order_no, operation_no, COUNT(*) AS cnt
FROM sow
WHERE order_no IS NOT NULL AND operation_no IS NOT NULL
GROUP BY order_no, operation_no
HAVING COUNT(*) > 1
LIMIT 10;

-- CHECK 7: Verify timesheet.workcentercode references exist in workcenter
-- Expected: 0 rows
SELECT DISTINCT t.workcentercode, 'No matching workcenter.workcenternew' AS issue
FROM timesheet_transaction t
WHERE t.workcentercode IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM workcenter w WHERE w.workcenternew = t.workcentercode
  );

-- CHECK 8: Verify usernfc.workcenter values exist in workcenter
-- Expected: 0 rows
SELECT u.snssb, u.workcenter, 'No matching workcenter.workcenternew' AS issue
FROM usernfc u
WHERE u.workcenter IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM workcenter w WHERE w.workcenternew = u.workcenter
  );

-- ============================================================
-- !! STOP HERE — REVIEW THE PRE-FLIGHT RESULTS ABOVE !!
-- !! Only proceed if all checks returned 0 rows         !!
-- ============================================================


-- ============================================================
-- STEP 1: RENAME COLUMNS IN timesheet_transaction
-- Maps old names → sow naming conventions
-- ============================================================

-- production_order → order_no  (matches sow.order_no)
ALTER TABLE timesheet_transaction
    RENAME COLUMN production_order TO order_no;

-- seq → operation_no  (matches sow.operation_no)
ALTER TABLE timesheet_transaction
    RENAME COLUMN seq TO operation_no;

-- ssbr_ident → ssbr_id  (matches sow.ssbr_id)
ALTER TABLE timesheet_transaction
    RENAME COLUMN ssbr_ident TO ssbr_id;

-- operation_text → operationtext  (matches sow.operationtext)
ALTER TABLE timesheet_transaction
    RENAME COLUMN operation_text TO operationtext;

-- NOTE: PostgreSQL automatically updates indexes and constraints
-- that reference these columns when RENAME COLUMN is executed.
-- The timesheet_po_seq_unique constraint will now reference
-- (order_no, operation_no) automatically.

-- Rename constraint to match new column names (cosmetic clarity)
ALTER TABLE timesheet_transaction
    RENAME CONSTRAINT timesheet_po_seq_unique TO timesheet_order_opno_unique;

-- Rename index for clarity (existing index on old production_order column)
ALTER INDEX IF EXISTS idx_ts_production_order RENAME TO idx_ts_order_no;


-- ============================================================
-- STEP 2: FIX DATA TYPES IN timesheet_transaction
-- ============================================================

-- 2A. date_checkin: TEXT (DD/MM/YYYY) → DATE
--     Handles both DD/MM/YYYY and YYYY-MM-DD formats, NULL for empty/invalid
ALTER TABLE timesheet_transaction
    ALTER COLUMN date_checkin TYPE date
    USING CASE
        WHEN TRIM(date_checkin) ~ '^\d{2}/\d{2}/\d{4}$'
            THEN to_date(TRIM(date_checkin), 'DD/MM/YYYY')
        WHEN TRIM(date_checkin) ~ '^\d{4}-\d{2}-\d{2}$'
            THEN TRIM(date_checkin)::date
        ELSE NULL
    END;

-- 2B. date_checkout: TEXT (DD/MM/YYYY) → DATE
ALTER TABLE timesheet_transaction
    ALTER COLUMN date_checkout TYPE date
    USING CASE
        WHEN TRIM(date_checkout) ~ '^\d{2}/\d{2}/\d{4}$'
            THEN to_date(TRIM(date_checkout), 'DD/MM/YYYY')
        WHEN TRIM(date_checkout) ~ '^\d{4}-\d{2}-\d{2}$'
            THEN TRIM(date_checkout)::date
        ELSE NULL
    END;

-- 2C. hour_checkin: TEXT (HH:MI) → TIME(0)
--     TIME(0) = time with 0 fractional seconds (HH:MM:SS format)
ALTER TABLE timesheet_transaction
    ALTER COLUMN hour_checkin TYPE time(0)
    USING NULLIF(TRIM(hour_checkin), '')::time;

-- 2D. hour_checkout: TEXT (HH:MI) → TIME(0)
ALTER TABLE timesheet_transaction
    ALTER COLUMN hour_checkout TYPE time(0)
    USING NULLIF(TRIM(hour_checkout), '')::time;

-- NOTE: planhours type change (text → numeric) is skipped here
-- because planhours is being DROPPED in Step 3 (see below).
-- It would be type-changed only if you decide NOT to drop it.
-- Uncomment if keeping planhours:
-- ALTER TABLE timesheet_transaction
--     ALTER COLUMN planhours TYPE numeric(10,2)
--     USING NULLIF(TRIM(planhours), '')::numeric;


-- ============================================================
-- STEP 3: DROP REDUNDANT / DENORMALIZED COLUMNS
-- These columns are available via JOIN to other tables:
--   full_name          → JOIN usernfc ON usernfc.snssb = serialnumber
--   part_name          → JOIN sow ON sow.order_no = order_no AND sow.operation_no = operation_no
--   workcenterdescription → same JOIN sow (or JOIN workcenter)
--   planhours          → same JOIN sow
-- ============================================================

ALTER TABLE timesheet_transaction DROP COLUMN IF EXISTS full_name;
ALTER TABLE timesheet_transaction DROP COLUMN IF EXISTS part_name;
ALTER TABLE timesheet_transaction DROP COLUMN IF EXISTS workcenterdescription;
ALTER TABLE timesheet_transaction DROP COLUMN IF EXISTS planhours;


-- ============================================================
-- STEP 4: ADD UNIQUE CONSTRAINT TO sow (prerequisite for FK)
-- ============================================================

-- sow(order_no, operation_no) must be UNIQUE to be referenced by FK
-- PRE-REQUISITE: CHECK 6 above must return 0 rows (no duplicates)
ALTER TABLE sow
    ADD CONSTRAINT uq_sow_order_operation UNIQUE (order_no, operation_no);


-- ============================================================
-- STEP 5: ADD FOREIGN KEY CONSTRAINTS
-- ============================================================

-- 5A. timesheet_transaction(order_no, operation_no) → sow(order_no, operation_no)
--     ON UPDATE CASCADE: if sow order/operation changes, timesheet follows
--     ON DELETE RESTRICT: cannot delete sow row while timesheet records exist
ALTER TABLE timesheet_transaction
    ADD CONSTRAINT fk_ts_sow
    FOREIGN KEY (order_no, operation_no)
    REFERENCES sow (order_no, operation_no)
    ON UPDATE CASCADE
    ON DELETE RESTRICT;

-- 5B. timesheet_transaction.workcentercode → workcenter.workcenternew
--     ON UPDATE CASCADE: if workcenter code changes, timesheet follows
--     ON DELETE SET NULL: if workcenter deleted, timesheet keeps record
ALTER TABLE timesheet_transaction
    ADD CONSTRAINT fk_ts_workcenter
    FOREIGN KEY (workcentercode)
    REFERENCES workcenter (workcenternew)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

-- 5C. usernfc.workcenter → workcenter.workcenternew
ALTER TABLE usernfc
    ADD CONSTRAINT fk_usernfc_workcenter
    FOREIGN KEY (workcenter)
    REFERENCES workcenter (workcenternew)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

-- 5D. sow.workcenter → workcenter.workcenternew
--     HIGH RISK: Many sow rows (100K) may have workcenter values
--     not present in the workcenter table (ERP data may have more codes).
--     Run CHECK 9 below before uncommenting this FK.
--
-- CHECK 9 (run separately before this FK):
--   SELECT COUNT(*), COUNT(DISTINCT workcenter) AS orphan_codes
--   FROM sow
--   WHERE workcenter IS NOT NULL AND workcenter != ''
--     AND workcenter NOT IN (SELECT workcenternew FROM workcenter WHERE workcenternew IS NOT NULL);
--
-- ALTER TABLE sow
--     ADD CONSTRAINT fk_sow_workcenter
--     FOREIGN KEY (workcenter)
--     REFERENCES workcenter (workcenternew)
--     ON UPDATE CASCADE
--     ON DELETE SET NULL;


-- ============================================================
-- STEP 6: VERIFY FINAL STATE
-- ============================================================

-- Verify column renames applied
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'timesheet_transaction'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- Verify constraints
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'timesheet_transaction'::regclass
ORDER BY contype, conname;

COMMIT;

-- ============================================================
-- POST-MIGRATION: Restart the API server
-- The API code has been updated to use new column names.
-- After running this migration, restart Node.js:
--   pm2 restart all   OR   node server.js
-- ============================================================
