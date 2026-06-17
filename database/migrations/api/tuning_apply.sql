-- tuning_apply.sql
-- Applies remaining TUNING_PLAN.md constraint items (#12, #19, #20)
-- Generated: 2026-03-24
--
-- Context: Most schema changes (#14, #15, #18, #21, #22, #23) are already in the DB.
-- This file handles ONLY the remaining NOT NULL constraints that require pre-checks.
--
-- ⚠️  RUN PRE-FLIGHT CHECKS BELOW BEFORE EXECUTING
-- ⚠️  All checks must return 0 before proceeding

-- ============================================================
-- PRE-FLIGHT CHECKS
-- ============================================================
-- #12: SELECT COUNT(*) FROM timesheet_transaction WHERE serialnumber IS NULL OR full_name IS NULL;
-- #19: SELECT COUNT(*) FROM sow WHERE order_no IS NULL;
-- #20: SELECT COUNT(*) FROM usernfc WHERE nfcid IS NULL;

BEGIN;

-- ============================================================
-- #19: NOT NULL on sow.order_no
-- Rationale: codenumber GENERATED ALWAYS AS (order_no || operation_no::text)
-- If order_no IS NULL → codenumber IS NULL → UNIQUE constraint silently bypassed.
-- The trigger fn_delete_dup_sow already guards WHERE order_no IS NOT NULL,
-- acknowledging this gap.
-- ============================================================
ALTER TABLE public.sow
    ALTER COLUMN order_no SET NOT NULL;

-- ============================================================
-- #20: NOT NULL on usernfc.nfcid
-- Rationale: uq_usernfc_nfcid UNIQUE index already exists, but NULL values
-- bypass it — multiple NULLs can coexist (PostgreSQL NULL != NULL in unique index).
-- ============================================================
ALTER TABLE public.usernfc
    ALTER COLUMN nfcid SET NOT NULL;

-- ============================================================
-- #12: NOT NULL on timesheet_transaction.serialnumber / full_name
-- Rationale: fk_timesheet_user already ensures serialnumber references usernfc.snssb,
-- but FK alone doesn't block NULLs. Adding NOT NULL makes the constraint explicit.
-- ============================================================
ALTER TABLE public.timesheet_transaction
    ALTER COLUMN serialnumber SET NOT NULL,
    ALTER COLUMN full_name     SET NOT NULL;

COMMIT;
