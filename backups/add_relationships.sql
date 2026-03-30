-- ============================================================
-- ADD MISSING FOREIGN KEY RELATIONSHIPS
-- Database: ptssb
-- Generated: 2026-03-04
--
-- INSTRUCTIONS:
--   1. Run each PRE-FLIGHT CHECK first
--   2. Review the output — zero rows means it is SAFE to add the constraint
--   3. If rows are returned, fix the data inconsistencies before adding the FK
--   4. Then run the ALTER TABLE statement
--
-- ALL DDL IS COMMENTED OUT — uncomment after confirming pre-flight checks
-- ============================================================

-- ============================================================
-- RELATIONSHIP 1: timesheet_transaction.workcentercode → workcenter.workcenternew
-- ============================================================

-- PRE-FLIGHT CHECK: Find timesheet_transaction rows where workcentercode
-- does NOT exist in workcenter.workcenternew
-- Expected: 0 rows (safe to proceed)
-- If rows found: these orphan values must be fixed before adding the FK

SELECT
    ts.tsnumber,
    ts.workcentercode,
    ts.workcenterdescription,
    'No matching workcenter.workcenternew' AS issue
FROM timesheet_transaction ts
WHERE ts.workcentercode IS NOT NULL
  AND ts.workcentercode NOT IN (SELECT workcenternew FROM workcenter WHERE workcenternew IS NOT NULL);

-- ALSO check for NULLs (NULLs pass FK checks by default):
SELECT COUNT(*) AS null_workcentercode FROM timesheet_transaction WHERE workcentercode IS NULL;

-- If pre-flight returns 0 rows, uncomment and run:
/*
ALTER TABLE timesheet_transaction
    ADD CONSTRAINT fk_ts_workcentercode
    FOREIGN KEY (workcentercode)
    REFERENCES workcenter(workcenternew)
    ON UPDATE CASCADE
    ON DELETE SET NULL;
*/

-- ============================================================
-- RELATIONSHIP 2: processcontroldata.workcenter → workcenter.workcenternew
-- ============================================================

-- PRE-FLIGHT CHECK:
SELECT
    pcd.id_processcontroldata,
    pcd.workcenter,
    'No matching workcenter.workcenternew' AS issue
FROM processcontroldata pcd
WHERE pcd.workcenter IS NOT NULL
  AND pcd.workcenter NOT IN (SELECT workcenternew FROM workcenter WHERE workcenternew IS NOT NULL);

-- If pre-flight returns 0 rows, uncomment and run:
/*
ALTER TABLE processcontroldata
    ADD CONSTRAINT fk_pcd_workcenter
    FOREIGN KEY (workcenter)
    REFERENCES workcenter(workcenternew)
    ON UPDATE CASCADE
    ON DELETE SET NULL;
*/

-- ============================================================
-- RELATIONSHIP 3: processcontroldata.snssb → usernfc.snssb
-- ============================================================

-- PRE-FLIGHT CHECK:
SELECT
    pcd.id_processcontroldata,
    pcd.snssb,
    pcd.full_name,
    'No matching usernfc.snssb' AS issue
FROM processcontroldata pcd
WHERE pcd.snssb IS NOT NULL
  AND pcd.snssb NOT IN (SELECT snssb FROM usernfc WHERE snssb IS NOT NULL);

-- If pre-flight returns 0 rows, uncomment and run:
/*
ALTER TABLE processcontroldata
    ADD CONSTRAINT fk_pcd_snssb
    FOREIGN KEY (snssb)
    REFERENCES usernfc(snssb)
    ON UPDATE CASCADE
    ON DELETE SET NULL;
*/

-- ============================================================
-- RELATIONSHIP 4: sow.workcenter → workcenter.workcenternew
-- NOTE: This is HIGH RISK — sow has 100K rows and many may have
--       workcenter values not in the workcenter master table
--       (ERP-synced data may use different codes)
-- ============================================================

-- PRE-FLIGHT CHECK (count only — full output would be huge):
SELECT
    COUNT(*) AS orphan_count,
    COUNT(DISTINCT sow.workcenter) AS distinct_orphan_codes
FROM sow
WHERE sow.workcenter IS NOT NULL
  AND sow.workcenter != ''
  AND sow.workcenter NOT IN (SELECT workcenternew FROM workcenter WHERE workcenternew IS NOT NULL);

-- Show distinct orphan codes:
SELECT DISTINCT sow.workcenter AS orphan_workcenter_code
FROM sow
WHERE sow.workcenter IS NOT NULL
  AND sow.workcenter != ''
  AND sow.workcenter NOT IN (SELECT workcenternew FROM workcenter WHERE workcenternew IS NOT NULL)
ORDER BY 1;

-- *** Only add this FK if orphan_count = 0 ***
-- This FK is likely NOT safe to add yet due to ERP data containing
-- work center codes not yet in the local workcenter table.
-- Consider a SOFT reference (no FK) or add missing work centers first.

/*
-- ONLY RUN IF orphan_count = 0:
ALTER TABLE sow
    ADD CONSTRAINT fk_sow_workcenter
    FOREIGN KEY (workcenter)
    REFERENCES workcenter(workcenternew)
    ON UPDATE CASCADE
    ON DELETE SET NULL;
*/

-- ============================================================
-- RELATIONSHIP 5: timesheet_transaction.production_order → sow.codenumber
-- NOTE: HIGH RISK — verify data consistency carefully
--       timesheet_transaction.production_order must exist in sow.codenumber
-- ============================================================

-- PRE-FLIGHT CHECK:
SELECT
    ts.tsnumber,
    ts.production_order,
    ts.full_name,
    'No matching sow.codenumber' AS issue
FROM timesheet_transaction ts
WHERE ts.production_order IS NOT NULL
  AND ts.production_order NOT IN (SELECT codenumber FROM sow WHERE codenumber IS NOT NULL);

-- If pre-flight returns 0 rows, uncomment and run:
/*
ALTER TABLE timesheet_transaction
    ADD CONSTRAINT fk_ts_production_order
    FOREIGN KEY (production_order)
    REFERENCES sow(codenumber)
    ON UPDATE CASCADE
    ON DELETE RESTRICT;
*/

-- ============================================================
-- UNIQUE CONSTRAINT: usernfc.nfcid should be UNIQUE
-- (Each NFC card belongs to one employee)
-- ============================================================

-- PRE-FLIGHT CHECK for duplicate nfcid values:
SELECT nfcid, COUNT(*) AS cnt
FROM usernfc
WHERE nfcid IS NOT NULL
GROUP BY nfcid
HAVING COUNT(*) > 1;

-- If 0 rows returned (no duplicates), safe to add:
/*
ALTER TABLE usernfc
    ADD CONSTRAINT uq_usernfc_nfcid UNIQUE (nfcid);
*/

-- ============================================================
-- SUMMARY OF RELATIONSHIPS TO ADD (after data cleanup)
-- ============================================================
/*
Priority 1 (likely safe — small tables, stable data):
  - fk_ts_workcentercode  (timesheet_transaction → workcenter)
  - fk_pcd_workcenter     (processcontroldata → workcenter)
  - fk_pcd_snssb          (processcontroldata → usernfc)
  - uq_usernfc_nfcid      (unique NFC card)

Priority 2 (verify data first):
  - fk_ts_production_order (timesheet_transaction → sow)

Priority 3 (high risk — run orphan check on 100K rows first):
  - fk_sow_workcenter      (sow → workcenter)
*/
