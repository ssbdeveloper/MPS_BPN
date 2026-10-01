-- Migration: 20261001_timesheet_unique_active_productive_op_wc.sql
-- Enforce single active productive timesheet per operator, plant, normalized order_no,
-- operation_no, and normalized workcentercode.
-- Same operator/order/operation with DIFFERENT workcenter is allowed concurrently.
-- Same operator/order/operation with SAME workcenter is rejected as duplicate active.
-- Definition of active is strictly longdate_checkout IS NULL.
-- Normalization of workcentercode uses btrim(COALESCE(workcentercode, ''), E' \t\r\n\v\f')
-- to ensure identical handling of spaces, tabs, and newlines across SQL, JS, and Python.

-- 1. Create the new scoped unique index first (fails closed if duplicate exists)
CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheet_active_productive_op_wc
ON public.timesheet_transaction (
  plant,
  serialnumber,
  ltrim(trim(order_no), '0'),
  operation_no,
  btrim(COALESCE(workcentercode, ''), E' \t\r\n\v\f')
)
WHERE longdate_checkout IS NULL
  AND COALESCE(state_flag, 0) <> 5
  AND (activitytype IS NULL OR trim(activitytype) = '')
  AND order_no IS NOT NULL AND trim(order_no) <> ''
  AND operation_no IS NOT NULL;

-- 2. Drop the legacy index without workcenter once the new index is verified
DROP INDEX IF EXISTS idx_timesheet_active_productive_op;
