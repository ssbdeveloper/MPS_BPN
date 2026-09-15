-- 20260710_mch_transaction_status_record.sql
-- Accuracy-machine redesign: mch_transaction now mirrors ALL mch_productiondata rows
-- (the ETL no longer filters out non-V3-matched rows) and flags completeness per row
-- via status_record instead of dropping them. This lets the EWS accuracy_machine metric
-- show WHICH records are incomplete rather than only counting what was matched.
--
-- status_record = TRUE when the record is OK:
--   - statusid IN (0,3,4)  -> Off / Downtime / No Job: legitimately have no job/operator, or
--   - order_no, operation_no, sn_employee, confirmation_number are ALL present.
-- FALSE otherwise (a productive-ish record missing job/operator/confirmation).
--
-- Generated STORED column -> always consistent, no ETL logic needed, indexable.
-- NOTE: adding a STORED generated column rewrites the table once (locks it). Run off-peak.

BEGIN;

ALTER TABLE public.mch_transaction
  ADD COLUMN IF NOT EXISTS status_record boolean
  GENERATED ALWAYS AS (
    statusid IN (0, 3, 4)
    OR (
         NULLIF(btrim(order_no), '')            IS NOT NULL
     AND NULLIF(btrim(operation_no), '')        IS NOT NULL
     AND NULLIF(btrim(sn_employee), '')         IS NOT NULL
     AND NULLIF(btrim(confirmation_number), '') IS NOT NULL
    )
  ) STORED;

COMMENT ON COLUMN public.mch_transaction.status_record IS
  'TRUE = record OK (statusid 0/3/4 Off/Downtime/NoJob, OR order_no+operation_no+sn_employee+confirmation_number all present). FALSE = incomplete. Basis for EWS accuracy_machine.';

-- Partial index for the FALSE (issue) side + status filtering.
CREATE INDEX IF NOT EXISTS idx_mch_transaction_status_record_false
  ON public.mch_transaction (machineno) WHERE status_record = false;

COMMIT;
