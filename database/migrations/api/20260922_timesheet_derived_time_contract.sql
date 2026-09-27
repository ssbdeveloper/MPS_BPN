-- Timesheet time contract: derived date/hour columns always follow longdate_*.
--
-- Plan: docs/planning/2026-09-22-timesheet-interval-allocation-implementation.md (Fase A)
--
-- The four text columns date_checkin / hour_checkin / date_checkout / hour_checkout
-- are projections of the canonical timestamps longdate_checkin / longdate_checkout,
-- rendered in the plant timezone. They must never be written independently: 86 rows
-- in Cikupa drifted by exactly one hour because PATCH /timesheet/:tsnumber wrote the
-- text columns without touching the timestamps.
--
-- A generated column cannot be used: the timezone comes from plant_config at runtime
-- and differs per deployment (Asia/Jakarta vs Asia/Makassar), so the expression is not
-- IMMUTABLE. A CHECK constraint would only reject bad writes; this trigger normalises
-- every writer instead, which is what makes drift impossible rather than merely noisy.
--
-- Fail closed: if plant_config is missing or its timezone is empty/invalid the write
-- raises. Never fall back to the PostgreSQL session TimeZone — that is precisely the
-- silent-wrong-answer mode this migration exists to remove.
--
-- No BEGIN/COMMIT here: database/migrate.js wraps every migration in its own
-- transaction. Writing them again would commit early and break that contract.

CREATE OR REPLACE FUNCTION public.timesheet_sync_derived_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tz text;
BEGIN
  SELECT NULLIF(BTRIM(timezone), '') INTO tz
  FROM public.plant_config
  WHERE id = 1;

  IF tz IS NULL THEN
    RAISE EXCEPTION
      'timesheet_sync_derived_time: plant_config.timezone is missing or empty; refusing write for tsnumber=%',
      NEW.tsnumber
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NULLIF(BTRIM(COALESCE(NEW.plant, '')), '') IS DISTINCT FROM
     NULLIF(BTRIM((SELECT plant_code FROM public.plant_config WHERE id = 1)), '') THEN
    RAISE EXCEPTION
      'timesheet_sync_derived_time: record plant % does not match plant_config.plant_code; refusing write for tsnumber=%',
      NEW.plant, NEW.tsnumber
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Validate the timezone name explicitly. An unknown name would otherwise raise a
  -- generic error deep inside to_char and be harder to diagnose on the shop floor.
  BEGIN
    PERFORM now() AT TIME ZONE tz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'timesheet_sync_derived_time: invalid timezone % in plant_config; refusing write for tsnumber=%',
      tz, NEW.tsnumber
      USING ERRCODE = 'invalid_parameter_value';
  END;

  IF NEW.longdate_checkin IS NULL THEN
    NEW.date_checkin := NULL;
    NEW.hour_checkin := NULL;
  ELSE
    NEW.date_checkin := to_char(NEW.longdate_checkin AT TIME ZONE tz, 'DD/MM/YYYY');
    NEW.hour_checkin := to_char(NEW.longdate_checkin AT TIME ZONE tz, 'HH24:MI');
  END IF;

  IF NEW.longdate_checkout IS NULL THEN
    NEW.date_checkout := NULL;
    NEW.hour_checkout := NULL;
  ELSE
    NEW.date_checkout := to_char(NEW.longdate_checkout AT TIME ZONE tz, 'DD/MM/YYYY');
    NEW.hour_checkout := to_char(NEW.longdate_checkout AT TIME ZONE tz, 'HH24:MI');
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.timesheet_sync_derived_time() IS
  'Derives date_checkin/hour_checkin/date_checkout/hour_checkout from longdate_* in the plant timezone. Fails closed when plant_config.timezone is missing or invalid.';

DROP TRIGGER IF EXISTS trg_timesheet_sync_derived_time ON public.timesheet_transaction;

CREATE TRIGGER trg_timesheet_sync_derived_time
BEFORE INSERT OR UPDATE OF longdate_checkin, longdate_checkout,
                           date_checkin, hour_checkin, date_checkout, hour_checkout, plant
ON public.timesheet_transaction
FOR EACH ROW
EXECUTE FUNCTION public.timesheet_sync_derived_time();

-- Backfill only rows whose text projection disagrees with longdate_*. Touching
-- longdate_checkin fires the trigger, which rewrites the four columns. Rows already in
-- sync are left alone so the migration does not rewrite (and, where a modified_at
-- trigger exists, re-timestamp) the whole table; the validation below still checks
-- every row.
UPDATE public.timesheet_transaction t
SET longdate_checkin = t.longdate_checkin
FROM public.plant_config pc
WHERE pc.id = 1
  AND (
    (t.longdate_checkin IS NOT NULL AND (
       t.date_checkin IS DISTINCT FROM to_char(t.longdate_checkin AT TIME ZONE pc.timezone, 'DD/MM/YYYY')
       OR t.hour_checkin IS DISTINCT FROM to_char(t.longdate_checkin AT TIME ZONE pc.timezone, 'HH24:MI')))
    OR (t.longdate_checkin IS NULL AND (t.date_checkin IS NOT NULL OR t.hour_checkin IS NOT NULL))
    OR (t.longdate_checkout IS NOT NULL AND (
       t.date_checkout IS DISTINCT FROM to_char(t.longdate_checkout AT TIME ZONE pc.timezone, 'DD/MM/YYYY')
       OR t.hour_checkout IS DISTINCT FROM to_char(t.longdate_checkout AT TIME ZONE pc.timezone, 'HH24:MI')))
    OR (t.longdate_checkout IS NULL AND (t.date_checkout IS NOT NULL OR t.hour_checkout IS NOT NULL))
  );

-- Post-migration validation: abort the whole migration if any row still drifts.
DO $$
DECLARE
  tz text;
  drift_count bigint;
BEGIN
  SELECT NULLIF(BTRIM(timezone), '') INTO tz FROM public.plant_config WHERE id = 1;
  IF tz IS NULL THEN
    RAISE EXCEPTION 'plant_config.timezone missing; cannot validate backfill';
  END IF;

  SELECT count(*) INTO drift_count
  FROM public.timesheet_transaction
  WHERE (
    longdate_checkin IS NOT NULL AND (
      date_checkin IS DISTINCT FROM to_char(longdate_checkin AT TIME ZONE tz, 'DD/MM/YYYY')
      OR hour_checkin IS DISTINCT FROM to_char(longdate_checkin AT TIME ZONE tz, 'HH24:MI')
    )
  ) OR (
    longdate_checkin IS NULL AND (
      date_checkin IS NOT NULL OR hour_checkin IS NOT NULL
    )
  ) OR (
    longdate_checkout IS NOT NULL AND (
      date_checkout IS DISTINCT FROM to_char(longdate_checkout AT TIME ZONE tz, 'DD/MM/YYYY')
      OR hour_checkout IS DISTINCT FROM to_char(longdate_checkout AT TIME ZONE tz, 'HH24:MI')
    )
  ) OR (
    longdate_checkout IS NULL AND (
      date_checkout IS NOT NULL OR hour_checkout IS NOT NULL
    )
  );

  IF drift_count > 0 THEN
    RAISE EXCEPTION 'derived time drift remains on % row(s) after backfill', drift_count;
  END IF;

  RAISE NOTICE 'timesheet derived time contract installed; 0 drift';
END;
$$;
