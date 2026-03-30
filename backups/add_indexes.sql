-- ============================================================
-- ADD RECOMMENDED INDEXES
-- Database: ptssb
-- Generated: 2026-03-04
--
-- All indexes use CREATE INDEX CONCURRENTLY — safe to run on
-- production without locking tables (PostgreSQL 9.1+).
-- Run each statement individually (CONCURRENTLY cannot run in a transaction).
--
-- Priority: HIGH → MEDIUM → LOW
-- ============================================================

-- ============================================================
-- [HIGH PRIORITY] MISSING FK INDEXES
-- FK columns without indexes cause full table scans on every JOIN
-- ============================================================

-- processcontroldata_item.id_processcontroldata
-- Every query fetching QC items for a record does a full scan without this
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_pcdi_id_processcontroldata
    ON processcontroldata_item (id_processcontroldata);

-- processcontroldata.tsnumber
-- FK → timesheet_transaction — joins do full scans without this
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_pcd_tsnumber
    ON processcontroldata (tsnumber);

-- ============================================================
-- [HIGH PRIORITY] LOGIN & LOOKUP INDEXES
-- ============================================================

-- usernfc.nfcid — NFC card lookup on every employee scan/login
-- This is the hottest query path in the system
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
    idx_usernfc_nfcid
    ON usernfc (nfcid);

-- ============================================================
-- [HIGH PRIORITY] QC REPORTING INDEXES
-- ============================================================

-- processcontroldata.validation_status — filter Accept/Reject in reports
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_pcd_validation_status
    ON processcontroldata (validation_status);

-- processcontroldata.production_order — filter/group by order number
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_pcd_production_order
    ON processcontroldata (production_order);

-- processcontroldata.snssb — employee QC history queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_pcd_snssb
    ON processcontroldata (snssb);

-- ============================================================
-- [HIGH PRIORITY] SOW TABLE INDEXES (100K rows — most critical)
-- ============================================================

-- sow.status — filter active vs finished orders
-- Using partial index since most queries filter on active (non-FINISH) orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_sow_status
    ON sow (status);

-- Partial index for active orders only (higher cardinality selectivity)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_sow_status_active
    ON sow (idsow, codenumber, status)
    WHERE status IS DISTINCT FROM 'FINISH';

-- sow.order_no — ERP order number lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_sow_order_no
    ON sow (order_no);

-- sow.workcenter — machine/work center filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_sow_workcenter
    ON sow (workcenter);

-- sow.wct_group — work center group filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_sow_wct_group
    ON sow (wct_group);

-- ============================================================
-- [MEDIUM PRIORITY] TIMESHEET INDEXES
-- ============================================================

-- timesheet_transaction.state_flag — filter by state (active/pending)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_ts_state_flag
    ON timesheet_transaction (state_flag);

-- timesheet_transaction.activitytype — filter by activity type
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_ts_activitytype
    ON timesheet_transaction (activitytype);

-- ============================================================
-- [MEDIUM PRIORITY] COMPOSITE INDEXES FOR COMMON QUERY PATTERNS
-- ============================================================

-- processcontroldata: report by status + date range
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_pcd_status_date
    ON processcontroldata (validation_status, validation_date DESC);

-- processcontroldata: report by production_order + status
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_pcd_order_status
    ON processcontroldata (production_order, validation_status);

-- sow: order + work center combination (common join pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_sow_workcenter_status
    ON sow (workcenter, status);

-- sow: customer + status for customer-facing reports
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_sow_customer
    ON sow (customer);

-- timesheet_transaction: checkout queries (find unchecked-out records)
-- Partial index: only rows where checkout hasn't happened yet
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_ts_no_checkout
    ON timesheet_transaction (serialnumber, longdate_checkin)
    WHERE longdate_checkout IS NULL;

-- ============================================================
-- [LOW PRIORITY] ADDITIONAL SOW INDEXES
-- ============================================================

-- sow.ssbr_id — internal ID lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_sow_ssbr_id
    ON sow (ssbr_id);

-- sow.sync — find modified records for sync operations
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_sow_sync
    ON sow (sync)
    WHERE sync = 'modified';

-- ============================================================
-- VERIFY INDEXES AFTER CREATION
-- ============================================================
/*
Run this to confirm all indexes were created:

SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_indexes
JOIN pg_class ON pg_class.relname = pg_indexes.indexname
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
*/

-- ============================================================
-- DETECT REDUNDANT/DUPLICATE INDEXES
-- (run to check for overlap after creation)
-- ============================================================
/*
SELECT
    a.indexname AS index_1,
    b.indexname AS index_2,
    a.tablename,
    a.indexdef AS def_1,
    b.indexdef AS def_2
FROM pg_indexes a
JOIN pg_indexes b
    ON a.tablename = b.tablename
    AND a.indexname < b.indexname
    AND a.indexdef = b.indexdef
WHERE a.schemaname = 'public';
*/
