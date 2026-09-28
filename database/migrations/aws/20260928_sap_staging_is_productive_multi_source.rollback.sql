-- Rollback AWS RDS: Kembalikan formula is_productive hanya untuk M1/M2 (Machine Hours)
ALTER TABLE public.sap_timesheet_staging
  DROP COLUMN IF EXISTS is_productive;

ALTER TABLE public.sap_timesheet_staging
  ADD COLUMN is_productive boolean GENERATED ALWAYS AS (zconf_type = ANY (ARRAY['M1'::text, 'M2'::text])) STORED;

COMMENT ON COLUMN public.sap_timesheet_staging.is_productive IS
  'TRUE bila zconf_type M1/M2 (konfirmasi order). FALSE = alokasi aktivitas (LSTAR).';

CREATE INDEX IF NOT EXISTS idx_sap_staging_productive_status
  ON public.sap_timesheet_staging (is_productive, status);
