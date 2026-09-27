-- Migration: 20260925_timesheet_unique_active_productive_op.sql
-- Enforce single active productive timesheet per operator, plant, normalized order_no, and operation_no.
-- Definition of active is strictly longdate_checkout IS NULL.

DROP INDEX IF EXISTS idx_timesheet_active_productive_op;

CREATE UNIQUE INDEX idx_timesheet_active_productive_op
ON public.timesheet_transaction (
  plant,
  serialnumber,
  ltrim(trim(order_no), '0'),
  operation_no
)
WHERE longdate_checkout IS NULL
  AND COALESCE(state_flag, 0) <> 5
  AND (activitytype IS NULL OR trim(activitytype) = '')
  AND order_no IS NOT NULL AND trim(order_no) <> ''
  AND operation_no IS NOT NULL;
