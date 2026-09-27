-- Timesheet correction audit ledger + staging freeze guard + per-plant cutoff.
--
-- Plan: docs/planning/2026-09-22-timesheet-interval-allocation-implementation.md (Fase B)
--
-- Rules the application must not be able to bypass:
--
--   1. Once a tsnumber has ever been staged to SAP, its payroll fields are frozen —
--      for EVERY staging status (PENDING, POSTING, POSTED, FAILED, SKIPPED). UPDATE
--      and DELETE are both blocked. The source row is what the posted hours were
--      derived from; rewriting or removing it desynchronises MPS from SAP.
--   2. Every admin pre-staging correction is recorded append-only with actor, reason,
--      and the full before/after row.
--   3. Auto-post stays off and each plant carries its own cutoff date.
--
-- No BEGIN/COMMIT here: database/migrate.js wraps every migration in its own
-- transaction.
--
-- Provenance lives in sap_staging_source, which is a FOREIGN TABLE (postgres_fdw to
-- the central AWS staging cluster) on both plants. A trigger cannot depend on a remote
-- server being reachable: if the FDW link is down every checkout would fail and the
-- shop floor stops. So the split is deliberate:
--
--   * a LOCAL mirror table, timesheet_staging_freeze, is the trigger's source of truth
--     (fast, always available, fail-closed by construction);
--   * staging pusat dan source plant adalah dua database/koneksi berbeda, sehingga
--     tidak boleh diklaim satu transaksi PostgreSQL. Stager commit staging+provenance
--     lebih dulu, lalu memanggil public.timesheet_mark_staged() secara monotonic;
--   * setiap run melakukan reconcile provenance/exclusion sebelum memproses row baru,
--     sehingga crash di antara dua commit dipulihkan sebelum run berikutnya;
--   * migration ini backfill mirror dari provenance/exclusion yang sudah ada.
--
-- Freezing is monotonic: a row is never unfrozen, because deleting a staging row does
-- not undo the fact that hours were already derived from it and sent onward.

-- ---------------------------------------------------------------- audit ledger
CREATE TABLE IF NOT EXISTS public.timesheet_correction_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tsnumber integer NOT NULL,
  plant text,
  actor text NOT NULL,
  reason text NOT NULL,
  channel text,
  request_id text,
  before_row jsonb NOT NULL,
  after_row jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_timesheet_correction_reason_nonempty
    CHECK (BTRIM(reason) <> ''),
  CONSTRAINT ck_timesheet_correction_actor_nonempty
    CHECK (BTRIM(actor) <> '')
);

COMMENT ON TABLE public.timesheet_correction_audit IS
  'Append-only ledger of admin pre-staging timesheet time corrections. Reason and actor are mandatory.';

CREATE INDEX IF NOT EXISTS idx_timesheet_correction_audit_tsnumber
  ON public.timesheet_correction_audit (tsnumber, created_at DESC);

-- Append-only: block UPDATE and DELETE at the database level.
CREATE OR REPLACE FUNCTION public.timesheet_correction_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'timesheet_correction_audit is append-only (attempted %)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_timesheet_correction_audit_append_only
  ON public.timesheet_correction_audit;

CREATE TRIGGER trg_timesheet_correction_audit_append_only
BEFORE UPDATE OR DELETE ON public.timesheet_correction_audit
FOR EACH ROW EXECUTE FUNCTION public.timesheet_correction_audit_append_only();

-- ------------------------------------------------------------- freeze registry
CREATE TABLE IF NOT EXISTS public.timesheet_staging_freeze (
  tsnumber integer PRIMARY KEY,
  plant text,
  first_seen_status text,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  note text,
  -- #17: snapshot alokasi (raw/allocated/cap/final) supaya selisih jam bisa
  -- direkonsiliasi tanpa menjalankan ulang alokasi versi hari ini.
  allocation_snapshot jsonb
);

COMMENT ON TABLE public.timesheet_staging_freeze IS
  'Local monotonic mirror of TIMESHEET staging provenance. A tsnumber present here has been staged at least once and its payroll fields are permanently frozen, regardless of staging status.';

-- ----------------------------------------------------------- staging outbox
CREATE TABLE IF NOT EXISTS public.timesheet_staging_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id text NOT NULL UNIQUE,
  plant text NOT NULL,
  status text NOT NULL DEFAULT 'STAGING_RESERVED',
  source_ref_ids integer[] NOT NULL,
  snapshot jsonb NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  note text,
  error_message text,
  CONSTRAINT ck_timesheet_staging_outbox_status
    CHECK (status IN ('STAGING_RESERVED', 'STAGED', 'FAILED'))
);

-- Nama status reservation harus IDENTIK dengan first_seen_status pada
-- timesheet_staging_freeze ('STAGING_RESERVED'). Versi awal memakai 'RESERVED'
-- di outbox namun 'STAGING_RESERVED' di freeze; assertion "tidak ada reservation
-- tertinggal" lalu mencari status yang tidak pernah ada dan SELALU lolos secara
-- vacuous. Blok di bawah menyelaraskan tabel yang sudah terlanjur dibuat
-- (CREATE TABLE IF NOT EXISTS tidak akan memperbarui constraint lama).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'timesheet_staging_outbox'
  ) THEN
    ALTER TABLE public.timesheet_staging_outbox
      DROP CONSTRAINT IF EXISTS ck_timesheet_staging_outbox_status;

    UPDATE public.timesheet_staging_outbox
      SET status = 'STAGING_RESERVED'
      WHERE status = 'RESERVED';

    ALTER TABLE public.timesheet_staging_outbox
      ALTER COLUMN status SET DEFAULT 'STAGING_RESERVED';

    ALTER TABLE public.timesheet_staging_outbox
      ADD CONSTRAINT ck_timesheet_staging_outbox_status
      CHECK (status IN ('STAGING_RESERVED', 'STAGED', 'FAILED'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_timesheet_staging_outbox_status
  ON public.timesheet_staging_outbox (status, created_at);

COMMENT ON TABLE public.timesheet_staging_outbox IS
  'Source database staging reservation and outbox. Ensures tsnumbers are frozen in source before sending payload to central staging, allowing safe retry.';

-- Monotonic writer. The stager calls this inside its own staging transaction, so a
-- row becomes frozen immediately after its staging+provenance commit. Reconciliation
-- at the start of every stager run repairs a crash between the two database commits.
-- ON CONFLICT DO NOTHING is what makes it monotonic: an existing freeze is never
-- overwritten, downgraded, or re-timestamped.
CREATE OR REPLACE FUNCTION public.timesheet_mark_staged(
  p_tsnumbers integer[],
  p_plant text,
  p_status text DEFAULT 'PENDING',
  p_note text DEFAULT NULL,
  p_snapshot jsonb DEFAULT NULL
) RETURNS bigint
LANGUAGE sql
AS $$
  WITH inserted AS (
    INSERT INTO public.timesheet_staging_freeze
      (tsnumber, plant, first_seen_status, note, allocation_snapshot)
    SELECT DISTINCT ON (ts)
      ts,
      p_plant,
      p_status,
      p_note,
      CASE WHEN p_snapshot IS NULL THEN NULL ELSE p_snapshot -> ts::text END
    FROM unnest(COALESCE(p_tsnumbers, ARRAY[]::integer[])) AS ts
    WHERE ts IS NOT NULL
    ORDER BY ts
    ON CONFLICT (tsnumber) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::bigint FROM inserted;
$$;

COMMENT ON FUNCTION public.timesheet_mark_staged(integer[], text, text, text, jsonb) IS
  'Monotonically marks tsnumbers as staged, with an allocation snapshot (raw/allocated/cap/final). Called by the stager after the staging+provenance commit. Never unfreezes.';

-- Backfill from existing provenance so rows staged before this migration are frozen
-- too. sap_staging_source is a foreign table; if the FDW link is unavailable the
-- migration fails loudly rather than installing a guard with an empty registry.
DO $$
DECLARE
  v_plant text;
  n bigint;
BEGIN
  SELECT plant_code INTO v_plant FROM public.plant_config WHERE id = 1;
  IF v_plant IS NULL OR BTRIM(v_plant) = '' THEN
    RAISE EXCEPTION 'plant_config.plant_code is missing or empty; cannot determine plant for freeze backfill';
  END IF;

  INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, note)
  SELECT DISTINCT
         NULLIF(regexp_replace(ss.source_row_id, '\D', '', 'g'), '')::integer,
         ss.plant,
         'BACKFILL',
         'backfilled from sap_staging_source'
  FROM public.sap_staging_source ss
  WHERE ss.source_system = 'TIMESHEET'
    AND ss.plant = v_plant
    AND NULLIF(regexp_replace(ss.source_row_id, '\D', '', 'g'), '') IS NOT NULL
  ON CONFLICT (tsnumber) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'freeze backfill from sap_staging_source for plant %: % row(s)', v_plant, n;

  -- Excluded rows were staged at some point too (exclusion is a post-staging soft
  -- delete), so they must be frozen as well. Exclusion controls SAP emission, not
  -- whether the hours were already derived from the row.
  INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, note)
  SELECT DISTINCT
         NULLIF(regexp_replace(ex.source_row_id, '\D', '', 'g'), '')::integer,
         ex.plant,
         'EXCLUDED',
         'backfilled from sap_staging_exclusion'
  FROM public.sap_staging_exclusion ex
  WHERE ex.source_system = 'TIMESHEET'
    AND ex.plant = v_plant
    AND NULLIF(regexp_replace(ex.source_row_id, '\D', '', 'g'), '') IS NOT NULL
  ON CONFLICT (tsnumber) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'freeze backfill from sap_staging_exclusion for plant %: % row(s)', v_plant, n;
END;
$$;

-- ------------------------------------------------------------- freeze enforcement
CREATE OR REPLACE FUNCTION public.timesheet_guard_frozen_payroll()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  is_frozen boolean;
  correction_actor text;
  correction_reason text;
  correction_channel text;
  correction_request_id text;
  payroll_changed boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.timesheet_staging_freeze f
    WHERE f.tsnumber = OLD.tsnumber
  ) INTO is_frozen;

  -- 1. A staged row may NEVER be deleted or have its payroll/staging fields updated.
  IF is_frozen THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION
        'tsnumber=% has been staged to SAP; the record cannot be deleted. Use a storno/delta correction instead.',
        OLD.tsnumber
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF NEW.serialnumber          IS DISTINCT FROM OLD.serialnumber
       OR NEW.plant              IS DISTINCT FROM OLD.plant
       OR NEW.order_no           IS DISTINCT FROM OLD.order_no
       OR NEW.operation_no       IS DISTINCT FROM OLD.operation_no
       OR NEW.workcentercode     IS DISTINCT FROM OLD.workcentercode
       OR NEW.activitytype       IS DISTINCT FROM OLD.activitytype
       OR NEW.confirmationnumber IS DISTINCT FROM OLD.confirmationnumber
       OR NEW.state_flag         IS DISTINCT FROM OLD.state_flag
       OR NEW.longdate_checkin   IS DISTINCT FROM OLD.longdate_checkin
       OR NEW.longdate_checkout  IS DISTINCT FROM OLD.longdate_checkout
       OR NEW.date_checkin       IS DISTINCT FROM OLD.date_checkin
       OR NEW.hour_checkin       IS DISTINCT FROM OLD.hour_checkin
       OR NEW.date_checkout      IS DISTINCT FROM OLD.date_checkout
       OR NEW.hour_checkout      IS DISTINCT FROM OLD.hour_checkout
       OR NEW.duration           IS DISTINCT FROM OLD.duration
    THEN
      RAISE EXCEPTION
        'tsnumber=% has been staged to SAP; payroll/staging fields are frozen. Use a storno/delta correction instead.',
        OLD.tsnumber
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    RETURN NEW;
  END IF;

  -- 2. Non-staged row: check if operation affects payroll, eligibility, or SAP payload fields.
  IF TG_OP = 'DELETE' THEN
    payroll_changed := true;
  ELSE
    IF NEW.serialnumber          IS DISTINCT FROM OLD.serialnumber
       OR NEW.plant              IS DISTINCT FROM OLD.plant
       OR NEW.order_no           IS DISTINCT FROM OLD.order_no
       OR NEW.operation_no       IS DISTINCT FROM OLD.operation_no
       OR NEW.workcentercode     IS DISTINCT FROM OLD.workcentercode
       OR NEW.activitytype       IS DISTINCT FROM OLD.activitytype
       OR NEW.confirmationnumber IS DISTINCT FROM OLD.confirmationnumber
       OR NEW.state_flag         IS DISTINCT FROM OLD.state_flag
       OR NEW.longdate_checkin   IS DISTINCT FROM OLD.longdate_checkin
       OR NEW.longdate_checkout  IS DISTINCT FROM OLD.longdate_checkout
       OR NEW.duration           IS DISTINCT FROM OLD.duration
    THEN
      payroll_changed := true;
    END IF;
  END IF;

  -- Non-payroll update (e.g. note, workcenterdescription): allowed without correction context.
  IF NOT payroll_changed THEN
    RETURN NEW;
  END IF;

  -- Normal checkout closing: only when closing an open record (initial checkout)
  IF TG_OP = 'UPDATE'
     AND OLD.longdate_checkout IS NULL
     AND NEW.longdate_checkout IS NOT NULL
     AND NEW.serialnumber IS NOT DISTINCT FROM OLD.serialnumber
     AND NEW.plant IS NOT DISTINCT FROM OLD.plant
     AND NEW.order_no IS NOT DISTINCT FROM OLD.order_no
     AND NEW.operation_no IS NOT DISTINCT FROM OLD.operation_no
     AND NEW.workcentercode IS NOT DISTINCT FROM OLD.workcentercode
     AND NEW.activitytype IS NOT DISTINCT FROM OLD.activitytype
     AND NEW.state_flag IS NOT DISTINCT FROM OLD.state_flag
     AND NEW.longdate_checkin IS NOT DISTINCT FROM OLD.longdate_checkin
  THEN
    RETURN NEW;
  END IF;

  -- Direct SQL / Admin correction without context must fail-closed:
  correction_actor := NULLIF(TRIM(current_setting('mps.correction_actor', true)), '');
  correction_reason := NULLIF(TRIM(current_setting('mps.correction_reason', true)), '');
  correction_channel := COALESCE(NULLIF(TRIM(current_setting('mps.correction_channel', true)), ''), 'direct_sql');
  correction_request_id := NULLIF(TRIM(current_setting('mps.correction_request_id', true)), '');

  IF correction_actor IS NULL OR correction_reason IS NULL THEN
    RAISE EXCEPTION
      'Perubahan payroll / delete pada tsnumber=% tanpa correction context ditolak (actor dan reason wajib diset via session context mps.correction_actor dan mps.correction_reason).',
      OLD.tsnumber
      USING ERRCODE = 'check_violation';
  END IF;

  -- Catat entri audit atomik di tingkat database untuk setiap koreksi yang diizinkan
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'timesheet_correction_audit') THEN
    INSERT INTO public.timesheet_correction_audit (
      tsnumber,
      plant,
      actor,
      reason,
      channel,
      request_id,
      before_row,
      after_row
    ) VALUES (
      OLD.tsnumber,
      OLD.plant,
      correction_actor,
      correction_reason,
      correction_channel,
      correction_request_id,
      to_jsonb(OLD),
      CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END
    );
  END IF;

  -- Invalidasi artefak pipeline pre-publish jika tabel pipeline tersedia
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'timesheet_etl_input') THEN
    UPDATE public.timesheet_etl_input
    SET status = 'INVALIDATED',
        invalidated_at = now(),
        invalidated_reason = 'Pre-publish admin correction: ' || correction_reason
    WHERE source_tsnumber = OLD.tsnumber
      AND status IN ('CAPTURED', 'CLEANED', 'ALLOCATED', 'SAP_READY');
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'timesheet_sap_ready') THEN
    UPDATE public.timesheet_sap_ready
    SET status = 'INVALIDATED'
    WHERE source_tsnumber = OLD.tsnumber
      AND status = 'SAP_READY';
  END IF;

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

COMMENT ON FUNCTION public.timesheet_guard_frozen_payroll() IS
  'Blocks payroll-field UPDATE and any DELETE on rows that have ever been staged to SAP. For un-staged rows, direct SQL payroll changes or DELETE without correction context are rejected (fail-closed).';

DROP TRIGGER IF EXISTS trg_timesheet_guard_frozen_payroll ON public.timesheet_transaction;
DROP TRIGGER IF EXISTS trg_z_timesheet_guard_frozen_payroll ON public.timesheet_transaction;

-- Ordering matters: this trigger must run AFTER the derived-time normaliser, so it
-- compares final values. Trigger execution order is alphabetical by name within the
-- same timing, so the guard carries a 'z' prefix to force it last.
CREATE TRIGGER trg_z_timesheet_guard_frozen_payroll
BEFORE UPDATE OR DELETE ON public.timesheet_transaction
FOR EACH ROW EXECUTE FUNCTION public.timesheet_guard_frozen_payroll();

-- ------------------------------------------------------------- per-plant cutoff
-- cutoff_date: allocation/staging never touches work dated before this. Each plant
-- switches over on its own date, so hours already posted under the old formula are
-- not recomputed.
-- auto_post_enabled: stays FALSE. Posting to SAP remains a manual, reviewed action.
ALTER TABLE public.plant_config
  ADD COLUMN IF NOT EXISTS timesheet_allocation_cutoff_date date,
  ADD COLUMN IF NOT EXISTS auto_post_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.plant_config.timesheet_allocation_cutoff_date IS
  'Interval allocation applies only to work dated on/after this date. NULL = allocation disabled for this plant.';
COMMENT ON COLUMN public.plant_config.auto_post_enabled IS
  'Master switch for automatic SAP posting. Stays false: posting is manual and reviewed.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.plant_config WHERE auto_post_enabled) THEN
    RAISE EXCEPTION 'auto_post_enabled must remain false on every plant';
  END IF;
  RAISE NOTICE 'timesheet freeze + audit + cutoff installed; auto-post disabled';
END;
$$;
