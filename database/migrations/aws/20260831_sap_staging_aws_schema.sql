-- AWS RDS (ssb_dw) — reset & setup ulang schema pipeline SAP staging.
-- Konteks: tabel staging AWS berisi snapshot dummy (Jul-Agu, tanpa constraint).
-- Keputusan user 2026-08-31: hapus & reset isi; ZTIMESHEETID identity GLOBAL
-- mulai dari 2.000.000.000 (di atas max legacy log_timesheet_sap BPN 1.000.147.452;
-- SAP menolak ZTIMESHEETID duplikat → tidak boleh reuse ID yang pernah dikirim).
-- DDL sumber: jobs/sap_staging/sap_staging_common.py (ensure_staging_schema) +
-- migrations api/20260714_sap_staging_provenance.sql, 20260715_sap_ops_request.sql,
-- 20260827_sap_staging_exclusion.sql, legacy/migration_log_timesheet_sap.sql.

-- 1) Buang tabel pipeline lama (dummy, tanpa dependensi terverifikasi 2026-08-31)
DROP TABLE IF EXISTS public.sap_timesheet_staging CASCADE;
DROP TABLE IF EXISTS public.sap_staging_source CASCADE;
DROP TABLE IF EXISTS public.sap_stage_cursor CASCADE;
DROP TABLE IF EXISTS public.sap_staging_eligibility_audit CASCADE;
DROP TABLE IF EXISTS public.sap_source_change_blocked CASCADE;
DROP TABLE IF EXISTS public.sap_ops_request CASCADE;
DROP TABLE IF EXISTS public.sap_staging_exclusion CASCADE;
DROP TABLE IF EXISTS public.log_timesheet_sap CASCADE;

-- 2) Antrian payload — ZTIMESHEETID GLOBAL (identity mulai 2.000.000.000)
CREATE TABLE IF NOT EXISTS public.sap_timesheet_staging (
  id bigint GENERATED ALWAYS AS IDENTITY (START WITH 2000000000) PRIMARY KEY,
  ztimesheetid text GENERATED ALWAYS AS (id::text) STORED,

  source_system text NOT NULL,
  source_key text NOT NULL,
  is_correction boolean NOT NULL DEFAULT false,
  source_ref_id text,

  werks text NOT NULL DEFAULT '',
  pernr text NOT NULL DEFAULT '',
  pernr_origin text NOT NULL DEFAULT '',
  rueck text NOT NULL DEFAULT '',
  aufnr text NOT NULL DEFAULT '',
  vornr text NOT NULL DEFAULT '',
  flgat text NOT NULL DEFAULT '',
  plnfl text NOT NULL DEFAULT '',
  vornr_b text NOT NULL DEFAULT '',
  vornr_r text NOT NULL DEFAULT '',
  zconf_type text NOT NULL DEFAULT '',
  arbpl text NOT NULL DEFAULT '',
  lstar text NOT NULL DEFAULT '',
  isdd text NOT NULL DEFAULT '',
  isdz text NOT NULL DEFAULT '',
  iedd text NOT NULL DEFAULT '',
  iedz text NOT NULL DEFAULT '',
  aueru text NOT NULL DEFAULT '',
  zbarcodeid text NOT NULL DEFAULT '',

  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  bucket_start timestamp without time zone,
  synthetic_start timestamp without time zone,
  synthetic_end timestamp without time zone,
  total_seconds bigint,

  source_row_count integer NOT NULL DEFAULT 1,
  source_min_start timestamp without time zone,
  source_max_end timestamp without time zone,

  status text NOT NULL DEFAULT 'PENDING',
  sap_response jsonb,
  sap_response_text text,
  sap_error text,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_productive boolean GENERATED ALWAYS AS (zconf_type = ANY (ARRAY['M1'::text, 'M2'::text])) STORED,

  CONSTRAINT sap_timesheet_staging_source_uk UNIQUE (source_system, source_key),
  CONSTRAINT sap_timesheet_staging_status_ck CHECK (
    status IN ('PENDING', 'POSTING', 'POSTED', 'FAILED', 'SKIPPED')
  ),
  CONSTRAINT sap_timesheet_staging_source_system_ck CHECK (
    source_system IN ('TIMESHEET', 'MCH_HOURS')
  )
);

CREATE INDEX IF NOT EXISTS sap_timesheet_staging_status_idx
  ON public.sap_timesheet_staging (status, created_at);
CREATE INDEX IF NOT EXISTS sap_timesheet_staging_source_idx
  ON public.sap_timesheet_staging (source_system, source_ref_id);
CREATE INDEX IF NOT EXISTS sap_timesheet_staging_bucket_idx
  ON public.sap_timesheet_staging (source_system, bucket_start);

-- 3) Cursor per (source_system, plant) — multi-plant
CREATE TABLE IF NOT EXISTS public.sap_stage_cursor (
  source_system text NOT NULL,
  plant text NOT NULL,
  last_processed_at timestamp without time zone NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, plant),
  CONSTRAINT sap_stage_cursor_source_system_ck CHECK (
    source_system IN ('TIMESHEET', 'MCH_HOURS')
  )
);

-- 4) Audit kelayakan
CREATE TABLE IF NOT EXISTS public.sap_staging_eligibility_audit (
  source_system text NOT NULL,
  source_key text NOT NULL,
  source_ref_id text,
  source_date date,
  plant text NOT NULL DEFAULT '',
  eligibility_status text NOT NULL,
  block_reason text,
  block_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, source_key)
);

CREATE INDEX IF NOT EXISTS sap_staging_eligibility_audit_date_idx
  ON public.sap_staging_eligibility_audit (source_system, source_date, eligibility_status);

-- 5) Provenance segmen (anti-double-post)
CREATE TABLE IF NOT EXISTS public.sap_staging_source (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staging_id    bigint      NOT NULL REFERENCES public.sap_timesheet_staging(id) ON DELETE CASCADE,
  source_system text        NOT NULL,
  plant         text        NOT NULL,
  source_row_id text        NOT NULL,
  bucket_start  timestamptz NOT NULL,
  seconds       bigint      NOT NULL DEFAULT 0,
  posted_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sap_staging_source_segment_per_bundle
  ON public.sap_staging_source (staging_id, source_system, plant, source_row_id, bucket_start);
CREATE INDEX IF NOT EXISTS idx_sap_staging_source_segment
  ON public.sap_staging_source (source_system, plant, source_row_id, bucket_start);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sap_staging_source_posted_segment
  ON public.sap_staging_source (source_system, plant, source_row_id, bucket_start)
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
CREATE TRIGGER trg_sap_staging_mark_segments_posted
  AFTER UPDATE OF status ON public.sap_timesheet_staging
  FOR EACH ROW EXECUTE FUNCTION public.sap_staging_mark_segments_posted();

-- 6) Log perubahan record yang dibekukan karena sudah terkirim
CREATE TABLE IF NOT EXISTS public.sap_source_change_blocked (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_system text        NOT NULL,
  source_row_id text        NOT NULL,
  blocked_at    timestamptz NOT NULL DEFAULT now(),
  changed_field text        NOT NULL,
  old_value     text,
  new_value     text,
  staging_ids   bigint[]
);

-- 7) Antrian aksi UI
CREATE TABLE IF NOT EXISTS public.sap_ops_request (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action       text        NOT NULL,
  params       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status       text        NOT NULL DEFAULT 'QUEUED',
  requested_by text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  result       text,
  error        text,
  CONSTRAINT sap_ops_request_action_ck
    CHECK (action IN ('stage_catchup', 'retry_failed', 'post_corrections',
                      'rebuild_pending', 'post_bundles', 'post_date',
                      'post_operator', 'recalc_date')),
  CONSTRAINT sap_ops_request_status_ck
    CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'ERROR'))
);

CREATE INDEX IF NOT EXISTS idx_sap_ops_request_status
  ON public.sap_ops_request (status, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sap_ops_request_active
  ON public.sap_ops_request (action)
  WHERE status IN ('QUEUED', 'RUNNING');

-- 8) Exclusion record (soft delete per source row)
CREATE TABLE IF NOT EXISTS public.sap_staging_exclusion (
  source_system text NOT NULL,
  plant         text NOT NULL,
  source_row_id text NOT NULL,
  excluded_by   text,
  excluded_at   timestamptz NOT NULL DEFAULT now(),
  note          text,
  PRIMARY KEY (source_system, plant, source_row_id)
);

-- 9) Log tiap kiriman ke SAP (guard ZTIMESHEETID terbakar)
CREATE TABLE IF NOT EXISTS public.log_timesheet_sap (
  id                        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ztimesheetid              TEXT,
  pernr                     TEXT,
  confirmation_number       TEXT,
  order_no                  TEXT,
  operation_no              TEXT,
  sequence_category         TEXT,
  sequence_number           TEXT,
  branch_operation_no       TEXT,
  return_operation_no       TEXT,
  zconf_type                TEXT,
  work_center               TEXT,
  activity_type             TEXT,
  start_date                TEXT,
  start_time                TEXT,
  end_date                  TEXT,
  end_time                  TEXT,
  plant_code                TEXT,
  final_completed_indicator TEXT,
  zbarcodeid                TEXT,
  sap_response              TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);
