-- EWS labour unproductive activity reference
-- ------------------------------------------------------------------
-- Source of truth: operator-facing Unproductive Menu (apps/web/src/pages/
-- TIMESHEET/UnproductiveMenuPage.jsx). This is the LABOUR reference and is
-- intentionally separate from public.mch_statustypes (which is machine status).
-- Used by the EWS OLE detail to label timesheet_transaction.activitytype codes
-- with a human description instead of the raw numeric code — a tiny lookup join
-- so the OLE breakdown never has to DISTINCT-scan timesheet_transaction.

CREATE TABLE IF NOT EXISTS ews.activity_type_ref (
  activitytype    text PRIMARY KEY,
  description     text NOT NULL,
  is_unproductive boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ews.activity_type_ref (activitytype, description, is_unproductive) VALUES
  ('1510', 'Briefing', true),
  ('1520', 'Coffee Breaks', true),
  ('1530', 'Housekeeping', true),
  ('1540', 'Training', true),
  ('1550', 'Waiting for Material', true),
  ('1560', 'Waiting for NCR', true),
  ('1570', 'Waiting for Engineering', true),
  ('1580', 'Waiting for Inspection', true),
  ('1590', 'Waiting for Handling', true),
  ('1610', 'Jigs & Fixtures', true),
  ('1620', 'Tool Preparation', true),
  ('1630', 'Maintenance', true),
  ('1640', 'Labour Necessity', true),
  ('1650', 'Machine / Electricity Breakdown', true),
  ('1660', 'Daily PM', true),
  ('1670', 'Waiting for Job', true),
  ('1680', 'Others', true)
ON CONFLICT (activitytype) DO UPDATE
  SET description = EXCLUDED.description,
      is_unproductive = EXCLUDED.is_unproductive,
      updated_at = now();
