-- Run on EACH plant DB after the AWS migration.
-- The AWS foreign server must already be named aws_staging.
BEGIN;

ALTER FOREIGN TABLE public.sap_staging_source
  ADD COLUMN IF NOT EXISTS plant text;

-- Exclusion has one source of truth: AWS. Local tables must be empty before replacement.
DO $$
DECLARE kind "char";
DECLARE n bigint;
BEGIN
  SELECT c.relkind INTO kind
  FROM pg_class c JOIN pg_namespace nsp ON nsp.oid=c.relnamespace
  WHERE nsp.nspname='public' AND c.relname='sap_staging_exclusion';

  IF kind = 'r' THEN
    SELECT count(*) INTO n FROM public.sap_staging_exclusion;
    IF n > 0 THEN
      RAISE EXCEPTION 'Local sap_staging_exclusion has % rows; copy them to AWS with plant before migration', n;
    END IF;
    DROP TABLE public.sap_staging_exclusion;
  ELSIF kind = 'f' THEN
    ALTER FOREIGN TABLE public.sap_staging_exclusion
      ADD COLUMN IF NOT EXISTS plant text;
  ELSIF kind IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported sap_staging_exclusion relkind: %', kind;
  END IF;
END $$;

CREATE FOREIGN TABLE IF NOT EXISTS public.sap_staging_exclusion (
  source_system text NOT NULL,
  plant text NOT NULL,
  source_row_id text NOT NULL,
  excluded_by text,
  excluded_at timestamptz,
  note text
) SERVER aws_staging OPTIONS (schema_name 'public', table_name 'sap_staging_exclusion');

COMMIT;
