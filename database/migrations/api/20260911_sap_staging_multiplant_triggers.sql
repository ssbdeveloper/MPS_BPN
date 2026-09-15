-- Run on EACH plant DB after 20260911_sap_staging_multiplant_fdw.sql.
-- Scope local MCH triggers to this DB's plant_config.plant_code.
BEGIN;

CREATE OR REPLACE FUNCTION public.mch_transaction_freeze_posted()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE posted_ids bigint[];
DECLARE local_plant text;
BEGIN
  SELECT plant_code INTO local_plant FROM public.plant_config WHERE id = 1;
  IF local_plant IS NULL THEN RAISE EXCEPTION 'plant_config.plant_code is required'; END IF;

  SELECT array_agg(DISTINCT s.staging_id) INTO posted_ids
  FROM public.sap_staging_source s
  WHERE s.source_system = 'MCH_HOURS'
    AND s.plant = local_plant
    AND s.source_row_id = NEW.proddataid::text
    AND s.posted_at IS NOT NULL;

  IF posted_ids IS NULL THEN RETURN NEW; END IF;

  IF NEW.order_no IS DISTINCT FROM OLD.order_no THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'order_no', OLD.order_no, NEW.order_no, posted_ids);
    NEW.order_no := OLD.order_no;
  END IF;
  IF NEW.operation_no IS DISTINCT FROM OLD.operation_no THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'operation_no', OLD.operation_no, NEW.operation_no, posted_ids);
    NEW.operation_no := OLD.operation_no;
  END IF;
  IF NEW.sn_employee IS DISTINCT FROM OLD.sn_employee THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'sn_employee', OLD.sn_employee, NEW.sn_employee, posted_ids);
    NEW.sn_employee := OLD.sn_employee;
  END IF;
  IF NEW.confirmation_number IS DISTINCT FROM OLD.confirmation_number THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'confirmation_number', OLD.confirmation_number, NEW.confirmation_number, posted_ids);
    NEW.confirmation_number := OLD.confirmation_number;
  END IF;
  IF NEW.machineid IS DISTINCT FROM OLD.machineid THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'machineid', OLD.machineid, NEW.machineid, posted_ids);
    NEW.machineid := OLD.machineid;
  END IF;
  IF NEW.status_activitytype IS DISTINCT FROM OLD.status_activitytype THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'status_activitytype', OLD.status_activitytype, NEW.status_activitytype, posted_ids);
    NEW.status_activitytype := OLD.status_activitytype;
  END IF;
  IF NEW.startdatetime IS DISTINCT FROM OLD.startdatetime THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'startdatetime', OLD.startdatetime::text, NEW.startdatetime::text, posted_ids);
    NEW.startdatetime := OLD.startdatetime;
  END IF;
  IF NEW.enddatetime IS DISTINCT FROM OLD.enddatetime THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'enddatetime', OLD.enddatetime::text, NEW.enddatetime::text, posted_ids);
    NEW.enddatetime := OLD.enddatetime;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mch_transaction_invalidate_pending_bundles()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stale_ids bigint[];
DECLARE local_plant text;
BEGIN
  IF (NEW.order_no, NEW.operation_no, NEW.sn_employee, NEW.confirmation_number,
      NEW.machineid, NEW.status_activitytype, NEW.status_description,
      NEW.startdatetime, NEW.enddatetime)
     IS NOT DISTINCT FROM
     (OLD.order_no, OLD.operation_no, OLD.sn_employee, OLD.confirmation_number,
      OLD.machineid, OLD.status_activitytype, OLD.status_description,
      OLD.startdatetime, OLD.enddatetime)
  THEN RETURN NEW; END IF;

  SELECT plant_code INTO local_plant FROM public.plant_config WHERE id = 1;
  IF local_plant IS NULL THEN RAISE EXCEPTION 'plant_config.plant_code is required'; END IF;

  SELECT array_agg(DISTINCT s.staging_id) INTO stale_ids
  FROM public.sap_staging_source s
  JOIN public.sap_timesheet_staging t ON t.id = s.staging_id
  WHERE s.source_system = 'MCH_HOURS'
    AND s.plant = local_plant
    AND s.source_row_id = NEW.proddataid::text
    AND s.posted_at IS NULL
    AND t.status IN ('PENDING', 'FAILED', 'SKIPPED');

  IF stale_ids IS NULL THEN RETURN NEW; END IF;
  DELETE FROM public.sap_timesheet_staging WHERE id = ANY(stale_ids);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mch_transaction_freeze_posted
  ON public.mch_transaction;
CREATE TRIGGER trg_mch_transaction_freeze_posted
  BEFORE UPDATE ON public.mch_transaction
  FOR EACH ROW EXECUTE FUNCTION public.mch_transaction_freeze_posted();

DROP TRIGGER IF EXISTS trg_mch_transaction_invalidate_pending
  ON public.mch_transaction;
CREATE TRIGGER trg_mch_transaction_invalidate_pending
  AFTER UPDATE ON public.mch_transaction
  FOR EACH ROW EXECUTE FUNCTION public.mch_transaction_invalidate_pending_bundles();

COMMIT;
