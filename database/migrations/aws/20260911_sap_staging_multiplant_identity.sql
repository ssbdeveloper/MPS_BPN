-- Shared AWS SAP staging: source identity is (source_system, plant, source_row_id).
-- Stop sap-stage-worker/sap-stage-ts-worker/sap-post-worker/sap-ops-worker before applying.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE public.sap_staging_source
  ADD COLUMN IF NOT EXISTS plant text;

UPDATE public.sap_staging_source s
   SET plant = t.werks
  FROM public.sap_timesheet_staging t
 WHERE t.id = s.staging_id
   AND s.plant IS DISTINCT FROM t.werks;

-- TIMESHEET lama belum punya provenance. source_min_start adalah timestamp stabil.
INSERT INTO public.sap_staging_source
  (staging_id, source_system, plant, source_row_id, bucket_start, seconds, posted_at)
SELECT t.id, 'TIMESHEET', t.werks, t.source_ref_id, t.source_min_start,
       t.total_seconds,
       CASE WHEN t.status = 'POSTED' THEN COALESCE(t.posted_at, now()) END
FROM public.sap_timesheet_staging t
WHERE t.source_system = 'TIMESHEET'
  AND NULLIF(t.werks, '') IS NOT NULL
  AND NULLIF(t.source_ref_id, '') IS NOT NULL
  AND t.source_min_start IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.sap_staging_source s
    WHERE s.staging_id=t.id AND s.source_system='TIMESHEET'
      AND s.plant=t.werks AND s.source_row_id=t.source_ref_id
  );

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM public.sap_staging_source s
  JOIN public.sap_timesheet_staging t ON t.id=s.staging_id
  WHERE NULLIF(s.plant, '') IS NULL OR s.plant IS DISTINCT FROM t.werks;
  IF n > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % provenance rows have missing/mismatched plant', n;
  END IF;
END $$;

ALTER TABLE public.sap_staging_source ALTER COLUMN plant SET NOT NULL;

-- Keep the legacy 4-column index during rollout so old workers do not fail.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sap_staging_source_segment_per_bundle_multiplant
  ON public.sap_staging_source
  (staging_id, source_system, plant, source_row_id, bucket_start);

DROP INDEX IF EXISTS public.idx_sap_staging_source_segment;
CREATE INDEX idx_sap_staging_source_segment
  ON public.sap_staging_source
  (source_system, plant, source_row_id, bucket_start);

-- AWS schema lama tidak memasang trigger posted_at. Backfill 6.924 provenance
-- terverifikasi aman (nol segmen POSTED duplikat pada 2026-09-11).
UPDATE public.sap_staging_source s
   SET posted_at = COALESCE(t.posted_at, now())
  FROM public.sap_timesheet_staging t
 WHERE t.id = s.staging_id
   AND t.status = 'POSTED'
   AND s.posted_at IS NULL;

DROP INDEX IF EXISTS public.uq_sap_staging_source_posted_once;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sap_staging_source_posted_segment
  ON public.sap_staging_source
  (source_system, plant, source_row_id, bucket_start)
  WHERE posted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sap_staging_mark_segments_posted()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'POSTED' AND OLD.status IS DISTINCT FROM 'POSTED' THEN
    UPDATE public.sap_staging_source
       SET posted_at = COALESCE(NEW.posted_at, now())
     WHERE staging_id = NEW.id AND posted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sap_staging_mark_segments_posted
  ON public.sap_timesheet_staging;
CREATE TRIGGER trg_sap_staging_mark_segments_posted
  AFTER UPDATE OF status ON public.sap_timesheet_staging
  FOR EACH ROW EXECUTE FUNCTION public.sap_staging_mark_segments_posted();

ALTER TABLE public.sap_staging_exclusion
  ADD COLUMN IF NOT EXISTS plant text;

-- Exclusion legacy berasal dari rollout 5051. Tolak jika provenance membuktikan
-- source ID yang sama pernah dimiliki plant lain.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sap_staging_exclusion ex
    JOIN public.sap_staging_source s
      ON s.source_system=ex.source_system AND s.source_row_id=ex.source_row_id
    WHERE NULLIF(ex.plant, '') IS NULL AND s.plant <> '5051'
  ) THEN
    RAISE EXCEPTION 'Cannot safely assign legacy exclusions to plant 5051';
  END IF;
END $$;

UPDATE public.sap_staging_exclusion SET plant='5051'
WHERE NULLIF(plant, '') IS NULL;
ALTER TABLE public.sap_staging_exclusion ALTER COLUMN plant SET NOT NULL;

ALTER TABLE public.sap_staging_exclusion
  DROP CONSTRAINT IF EXISTS sap_staging_exclusion_pkey;

ALTER TABLE public.sap_staging_exclusion
  ADD PRIMARY KEY (source_system, plant, source_row_id);

COMMIT;
