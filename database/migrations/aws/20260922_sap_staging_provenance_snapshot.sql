-- Central AWS SAP Staging (ssb_dw) migration.
-- Adds provenance_snapshot to public.sap_timesheet_staging.
--
-- This migration stores the detailed allocation reconciliation snapshot:
-- raw_seconds, allocated_seconds, cap_seconds, sap_effective_seconds, and allocation_version.
--
-- SAFETY: Do NOT apply automatically. Must be executed by DBA on central AWS staging RDS.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE public.sap_timesheet_staging
  ADD COLUMN IF NOT EXISTS provenance_snapshot jsonb;

COMMENT ON COLUMN public.sap_timesheet_staging.provenance_snapshot IS
  'Reconciliation snapshot storing raw_seconds, allocated_seconds, cap_seconds, sap_effective_seconds, and allocation_version for timesheet interval allocation.';

COMMIT;
