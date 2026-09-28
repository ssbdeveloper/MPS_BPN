-- Migration AWS RDS: Multi-source is_productive generation
-- Author: cutover-20260927-hermes
-- Target: AWS RDS ssb_dw (PostgreSQL 17)
-- Blast Radius: Table public.sap_timesheet_staging (size ~53 MB, 41,418 rows).
--
-- Latar Belakang:
-- Sebelumnya is_productive didefinisikan sebagai:
--   GENERATED ALWAYS AS (zconf_type = ANY (ARRAY['M1'::text, 'M2'::text])) STORED
-- Ini hanya mengakomodasi MCH_HOURS. Untuk TIMESHEET, zconf_type bernilai RG, OV, RW
-- (produktif) atau kosong (non-produktif). Akibatnya seluruh 37.151 baris TIMESHEET bernilai false,
-- dan runner baru yang mencoba mengirimkan is_productive eksplisit ditolak Postgres 17.
--
-- Solusi:
-- Tetap menggunakan GENERATED ALWAYS AS STORED agar seluruh writer (MCH_HOURS lama, ETL timesheet,
-- script rebuild) tidak dapat menduplikasi atau mendriftsi nilai, serta tidak menghasilkan NULL.

ALTER TABLE public.sap_timesheet_staging
  DROP COLUMN IF EXISTS is_productive;

ALTER TABLE public.sap_timesheet_staging
  ADD COLUMN is_productive boolean GENERATED ALWAYS AS (
    CASE
      WHEN source_system = 'MCH_HOURS' THEN (zconf_type = ANY (ARRAY['M1'::text, 'M2'::text]))
      WHEN source_system = 'TIMESHEET' THEN (zconf_type = ANY (ARRAY['RG'::text, 'OV'::text, 'RW'::text]))
      ELSE false
    END
  ) STORED;

COMMENT ON COLUMN public.sap_timesheet_staging.is_productive IS
  'True jika MCH_HOURS M1/M2 atau TIMESHEET RG/OV/RW (konfirmasi order SAP). False jika aktivitas umum/cost-center.';

CREATE INDEX IF NOT EXISTS idx_sap_staging_productive_status
  ON public.sap_timesheet_staging (is_productive, status);
