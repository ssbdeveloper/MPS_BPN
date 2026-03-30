-- ============================================================
-- SCHEMA OPTIMIZATIONS
-- Database: ptssb
-- Generated: 2026-03-04
--
-- INSTRUCTIONS:
--   - ALL DDL is commented out
--   - Run the PRE-FLIGHT CHECKS first
--   - Review carefully before uncommenting and executing
--   - Take a backup before running any ALTER TABLE
--   - Test in a non-production environment first
-- ============================================================

-- ============================================================
-- STEP 1: DATA CLEANUP (Run first — no structural changes)
-- ============================================================

-- 1A. Fix string 'null' values in processcontroldata.ssbr_id
-- PRE-FLIGHT: See how many rows are affected
SELECT COUNT(*) AS rows_with_string_null
FROM processcontroldata
WHERE ssbr_id = 'null';

-- FIX:
/*
UPDATE processcontroldata
SET ssbr_id = NULL
WHERE ssbr_id = 'null';
*/

-- 1B. Fix test data 'asdf' in sow.type and sow.category
-- PRE-FLIGHT:
SELECT id, codenumber, type, category
FROM sow
WHERE type = 'asdf' OR category = 'asdf';

-- FIX (set to NULL or to proper value — review rows first):
/*
UPDATE sow
SET
    type = NULL,
    category = NULL
WHERE type = 'asdf' OR category = 'asdf';
*/

-- 1C. Standardize empty strings to NULL across key columns
-- PRE-FLIGHT — count empty strings in sow:
SELECT
    COUNT(*) FILTER (WHERE status = '')        AS empty_status,
    COUNT(*) FILTER (WHERE type = '')          AS empty_type,
    COUNT(*) FILTER (WHERE category = '')      AS empty_category,
    COUNT(*) FILTER (WHERE sync = '')          AS empty_sync,
    COUNT(*) FILTER (WHERE workcenter = '')    AS empty_workcenter
FROM sow;

-- FIX:
/*
UPDATE sow SET status = NULL WHERE status = '';
UPDATE sow SET type = NULL WHERE type = '';
UPDATE sow SET category = NULL WHERE category = '';
UPDATE sow SET workcenter = NULL WHERE workcenter = '';
*/

-- ============================================================
-- STEP 2: ENUM TYPE CREATION
-- ============================================================
-- ENUMs reduce storage (4 bytes overhead → label lookup) and enforce valid values.
-- PostgreSQL ENUMs require creating the type before using it.
-- Adding new values to ENUM requires ALTER TYPE ... ADD VALUE (safe, non-blocking)
-- REMOVING values requires more complex migration — consider this before using ENUMs

-- 2A. Create ENUM for validation_status
-- PRE-FLIGHT — verify all distinct values:
SELECT DISTINCT validation_status, COUNT(*) FROM processcontroldata GROUP BY validation_status;

/*
CREATE TYPE validation_status_enum AS ENUM ('Accept', 'Reject');

ALTER TABLE processcontroldata
    ALTER COLUMN validation_status TYPE validation_status_enum
    USING validation_status::validation_status_enum;
*/

-- 2B. Create ENUM for usernfc.roles
-- PRE-FLIGHT:
SELECT DISTINCT roles, COUNT(*) FROM usernfc GROUP BY roles;

/*
CREATE TYPE user_role_enum AS ENUM ('ADMINISTRATOR', 'FOREMAN', 'SUPERUSER', 'Supervisor');

ALTER TABLE usernfc
    ALTER COLUMN roles TYPE user_role_enum
    USING roles::user_role_enum;
*/

-- 2C. Create ENUM for sow.sync
-- PRE-FLIGHT:
SELECT DISTINCT sync, COUNT(*) FROM sow GROUP BY sync;

/*
CREATE TYPE sync_status_enum AS ENUM ('modified', 'update');

-- Handle NULLs and empty strings first (run data cleanup step 1C before this)
ALTER TABLE sow
    ALTER COLUMN sync TYPE sync_status_enum
    USING CASE WHEN sync IN ('modified', 'update') THEN sync::sync_status_enum ELSE NULL END;
*/

-- 2D. Create ENUM for timesheet_transaction.activitytype
-- PRE-FLIGHT:
SELECT DISTINCT activitytype, COUNT(*) FROM timesheet_transaction GROUP BY activitytype;

/*
CREATE TYPE activity_type_enum AS ENUM ('1510', '1520', '1550', '1560');

ALTER TABLE timesheet_transaction
    ALTER COLUMN activitytype TYPE activity_type_enum
    USING activitytype::activity_type_enum;
*/

-- ============================================================
-- STEP 3: TYPE CHANGES FOR EFFICIENCY
-- ============================================================

-- 3A. Change timesheet_transaction.state_flag from VARCHAR to SMALLINT
-- PRE-FLIGHT — verify all values are numeric:
SELECT DISTINCT state_flag FROM timesheet_transaction;

/*
ALTER TABLE timesheet_transaction
    ALTER COLUMN state_flag TYPE SMALLINT
    USING state_flag::SMALLINT;

-- Add check constraint to document valid values:
ALTER TABLE timesheet_transaction
    ADD CONSTRAINT chk_ts_state_flag CHECK (state_flag IN (2, 5));
*/

-- 3B. Change sow.group from VARCHAR to SMALLINT (values are 1-13)
-- PRE-FLIGHT:
SELECT DISTINCT "group" FROM sow WHERE "group" IS NOT NULL ORDER BY 1;

/*
-- Only if all values are numeric:
ALTER TABLE sow
    ALTER COLUMN "group" TYPE SMALLINT
    USING CASE WHEN "group" ~ '^\d+$' THEN "group"::SMALLINT ELSE NULL END;
*/

-- ============================================================
-- STEP 4: DATE COLUMN TYPE MIGRATION (HIGH IMPACT — TEST FIRST)
-- ============================================================
-- Converting VARCHAR date columns in sow to proper DATE type.
-- This enables date arithmetic, proper range queries, and index efficiency.
-- RISK: If any values don't parse as valid dates, the ALTER will fail.

-- PRE-FLIGHT — check for invalid date values in sow:
SELECT
    'finish_date'  AS col, COUNT(*) AS invalid FROM sow WHERE finish_date  IS NOT NULL AND finish_date  != '' AND finish_date  !~ '^\d{4}-\d{2}-\d{2}$'
UNION ALL
SELECT 'plan_start',   COUNT(*) FROM sow WHERE plan_start   IS NOT NULL AND plan_start   != '' AND plan_start   !~ '^\d{4}-\d{2}-\d{2}$'
UNION ALL
SELECT 'plan_finish',  COUNT(*) FROM sow WHERE plan_finish  IS NOT NULL AND plan_finish  != '' AND plan_finish  !~ '^\d{4}-\d{2}-\d{2}$'
UNION ALL
SELECT 'actual_start', COUNT(*) FROM sow WHERE actual_start IS NOT NULL AND actual_start != '' AND actual_start !~ '^\d{4}-\d{2}-\d{2}$'
UNION ALL
SELECT 'actual_finish',COUNT(*) FROM sow WHERE actual_finish IS NOT NULL AND actual_finish != '' AND actual_finish !~ '^\d{4}-\d{2}-\d{2}$';

-- Also check distinct date formats used:
SELECT DISTINCT LEFT(finish_date, 4) AS format_sample, COUNT(*)
FROM sow
WHERE finish_date IS NOT NULL AND finish_date != ''
GROUP BY LEFT(finish_date, 4)
ORDER BY 1;

/*
-- Only run after confirming all values are valid YYYY-MM-DD format:
ALTER TABLE sow ALTER COLUMN finish_date  TYPE DATE USING NULLIF(finish_date,  '')::DATE;
ALTER TABLE sow ALTER COLUMN plan_start   TYPE DATE USING NULLIF(plan_start,   '')::DATE;
ALTER TABLE sow ALTER COLUMN plan_finish  TYPE DATE USING NULLIF(plan_finish,  '')::DATE;
ALTER TABLE sow ALTER COLUMN actual_start TYPE DATE USING NULLIF(actual_start, '')::DATE;
ALTER TABLE sow ALTER COLUMN actual_finish TYPE DATE USING NULLIF(actual_finish,'')::DATE;
*/

-- ============================================================
-- STEP 5: REMOVE REDUNDANT COLUMNS (OPTIONAL — CAREFUL)
-- ============================================================

-- 5A. workcenter table: remove always-same-value columns
-- PRE-FLIGHT — verify these are truly single-value:
SELECT DISTINCT condition FROM workcenter;
SELECT DISTINCT categoryhours FROM workcenter;

/*
-- Only if values confirmed always 'Good' and 'Man Hour':
ALTER TABLE workcenter DROP COLUMN condition;
ALTER TABLE workcenter DROP COLUMN categoryhours;
*/

-- 5B. timesheet_transaction: remove redundant date/time text columns
--     (data is already in longdate_checkin / longdate_checkout)
-- PRE-FLIGHT — verify longdate columns are always populated when text columns are:
SELECT COUNT(*) AS mismatch
FROM timesheet_transaction
WHERE (date_checkin IS NOT NULL AND longdate_checkin IS NULL)
   OR (date_checkout IS NOT NULL AND longdate_checkout IS NULL);

-- Also verify consistency:
SELECT
    tsnumber,
    date_checkin,
    TO_CHAR(longdate_checkin, 'DD/MM/YYYY') AS derived_date,
    hour_checkin,
    TO_CHAR(longdate_checkin, 'HH24:MI') AS derived_hour
FROM timesheet_transaction
WHERE longdate_checkin IS NOT NULL
LIMIT 10;

/*
-- Only if application code is updated to use longdate_* columns:
ALTER TABLE timesheet_transaction
    DROP COLUMN date_checkin,
    DROP COLUMN hour_checkin,
    DROP COLUMN date_checkout,
    DROP COLUMN hour_checkout;
*/

-- ============================================================
-- STEP 6: ADD CHECK CONSTRAINTS FOR DATA INTEGRITY
-- ============================================================

-- sow.status: only allow known values
-- PRE-FLIGHT:
SELECT DISTINCT status FROM sow;

/*
ALTER TABLE sow
    ADD CONSTRAINT chk_sow_status
    CHECK (status IS NULL OR status IN ('', 'FINISH'));
*/

-- processcontroldata.validation_status (if not converting to ENUM):
/*
ALTER TABLE processcontroldata
    ADD CONSTRAINT chk_pcd_validation_status
    CHECK (validation_status IS NULL OR validation_status IN ('Accept', 'Reject'));
*/

-- ============================================================
-- STEP 7: SEQUENCE / IDENTITY COLUMN AUDIT
-- ============================================================

-- Check current sequence values to ensure no overflow risk:
SELECT
    seq.relname AS sequence_name,
    pg_sequence.seqmax,
    pg_sequence.seqlast AS last_value,
    ROUND(100.0 * pg_sequence.seqlast / pg_sequence.seqmax, 2) AS pct_used
FROM pg_sequence
JOIN pg_class seq ON seq.oid = pg_sequence.seqrelid
ORDER BY pct_used DESC;

-- ============================================================
-- MIGRATION ORDER (if running all steps)
-- ============================================================
/*
1. BACKUP the database first
2. Run Step 1 (data cleanup) — safe UPDATE statements
3. Run Step 6 (add check constraints) — validate data
4. Run Step 2 (ENUM types) — after data is clean
5. Run Step 3 (type changes) — smallint conversions
6. Run Step 4 (date migration) — after validating formats
7. Run Step 5 (drop redundant columns) — after app code updated
*/
