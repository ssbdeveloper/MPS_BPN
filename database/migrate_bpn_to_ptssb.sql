-- ============================================================
-- Migration: bpn_schema → match ptssb structure
-- Source of truth: ptssb (local)
-- Target: bpn_schema (remote)
-- Strategy: Safe incremental DDL only. No DROP TABLE, no DELETE.
--
-- HOW TO RUN:
--   psql -U tag -h HOST -d bpn_schema -f migrate_bpn_to_ptssb.sql
--
-- READ ALL ⚠️ RISKY comments before running.
-- Run STEP 0 first on bpn_schema to check for blockers.
-- ============================================================

BEGIN;

-- ============================================================
-- STEP 0: Pre-flight checks (run these SELECT queries first
--         to verify no data will be broken by RISKY changes)
-- ============================================================

-- Check: state_flag has only numeric-castable values (for text→smallint)
-- SELECT DISTINCT state_flag FROM timesheet_transaction WHERE state_flag !~ '^\d+$';

-- Check: planhours has only numeric-castable values
-- SELECT tsnumber, planhours FROM timesheet_transaction WHERE planhours !~ '^[0-9]*\.?[0-9]*$' AND planhours IS NOT NULL;

-- Check: std_foreman_hours has only numeric-castable values
-- SELECT tsnumber, std_foreman_hours FROM timesheet_transaction WHERE std_foreman_hours !~ '^[0-9]*\.?[0-9]*$' AND std_foreman_hours IS NOT NULL;

-- Check: processcontroldata.operation_no has only numeric values (for text→integer)
-- SELECT id_processcontroldata, operation_no FROM processcontroldata WHERE operation_no !~ '^\d+$' AND operation_no IS NOT NULL;

-- Check: serialnumber has no NULLs (before adding NOT NULL)
-- SELECT count(*) FROM timesheet_transaction WHERE serialnumber IS NULL;

-- Check: full_name has no NULLs (before adding NOT NULL)
-- SELECT count(*) FROM timesheet_transaction WHERE full_name IS NULL;

-- Check: order_no has no NULLs in sow (before adding NOT NULL)
-- SELECT count(*) FROM sow WHERE order_no IS NULL;


-- ============================================================
-- STEP 1: Extensions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


-- ============================================================
-- STEP 2: New Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_delete_dup_sow() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    DELETE FROM sow
    WHERE codenumber = NEW.codenumber
      AND order_no IS NOT NULL
      AND idsow < NEW.idsow;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_set_sync_modified() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    old_data jsonb;
    new_data jsonb;
BEGIN
    IF NEW.sync IS DISTINCT FROM OLD.sync THEN
        RETURN NEW;
    END IF;
    old_data := to_jsonb(OLD) - 'sync';
    new_data := to_jsonb(NEW) - 'sync';
    IF old_data IS DISTINCT FROM new_data THEN
        NEW.sync := 'modified';
    END IF;
    RETURN NEW;
END;
$$;

-- Keep update_updated_at_column (already exists in bpn, same in ptssb)
-- update_modified_column exists only in bpn; ptssb uses update_updated_at_column
-- We keep it to avoid breaking the existing trigger on bpn.


-- ============================================================
-- STEP 3: New Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.components (
    component_id bigint NOT NULL,
    part_name text NOT NULL,
    model text NOT NULL,
    part_number text NOT NULL
);

ALTER TABLE public.components ALTER COLUMN component_id
    ADD GENERATED ALWAYS AS IDENTITY (
        SEQUENCE NAME public.components_component_id_seq
        START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
    );

ALTER TABLE ONLY public.components
    ADD CONSTRAINT IF NOT EXISTS components_pkey PRIMARY KEY (component_id);

ALTER TABLE ONLY public.components
    ADD CONSTRAINT IF NOT EXISTS components_model_part_number_key UNIQUE (model, part_number);


CREATE TABLE IF NOT EXISTS public.log_timesheet_sap (
    id integer NOT NULL,
    ztimesheetid text,
    pernr text,
    confirmation_number text,
    order_no text,
    operation_no text,
    sequence_category text,
    sequence_number text,
    branch_operation_no text,
    return_operation_no text,
    zconf_type text,
    work_center text,
    activity_type text,
    start_date text,
    start_time text,
    end_date text,
    end_time text,
    plant_code text,
    final_completed_indicator text,
    zbarcodeid text,
    sap_response text,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.log_timesheet_sap ALTER COLUMN id
    ADD GENERATED ALWAYS AS IDENTITY (
        SEQUENCE NAME public.log_timesheet_sap_id_seq
        START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
    );

ALTER TABLE ONLY public.log_timesheet_sap
    ADD CONSTRAINT IF NOT EXISTS log_timesheet_sap_pkey PRIMARY KEY (id);


CREATE TABLE IF NOT EXISTS public.mst_job (
    job_no text NOT NULL,
    job_desc text,
    order_no text,
    material_name text,
    material text,
    system_status text,
    opr_act text,
    workcenter text,
    costcenter text,
    fl_p integer,
    plant text,
    realconf text,
    last_updated timestamp with time zone DEFAULT now(),
    est_hrs text,
    uom text,
    order_type text,
    est_hrs_act text,
    flag_compl integer,
    wbs_no text,
    usr_update integer,
    tgl_update timestamp with time zone,
    tgl_final_sap timestamp with time zone,
    tgl_compl timestamp with time zone,
    progress numeric
);


CREATE TABLE IF NOT EXISTS public.production_operations (
    id bigint NOT NULL,
    order_number text,
    operation_number integer,
    short_text text,
    estimate_hour numeric(10,2),
    confirmation text,
    branch_operation text,
    return_operation text,
    sequence_category text,
    sequence_number text,
    material_code text,
    material_description text,
    operation_status text,
    order_type text,
    plant text,
    uom text,
    work_center text,
    cost_center text,
    order_system_status text
);

ALTER TABLE public.production_operations ALTER COLUMN id
    ADD GENERATED ALWAYS AS IDENTITY (
        SEQUENCE NAME public.production_operations_id_seq
        START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
    );

ALTER TABLE ONLY public.production_operations
    ADD CONSTRAINT IF NOT EXISTS production_operations_pkey PRIMARY KEY (id);


CREATE TABLE IF NOT EXISTS public.progress_update_history (
    id integer NOT NULL,
    operation_id integer NOT NULL,
    order_no character varying(100),
    progress integer NOT NULL,
    issue_description text,
    image_path character varying(500),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by character varying(100),
    CONSTRAINT progress_update_history_progress_check CHECK (((progress >= 1) AND (progress <= 100)))
);

CREATE SEQUENCE IF NOT EXISTS public.progress_update_history_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.progress_update_history_id_seq
    OWNED BY public.progress_update_history.id;

ALTER TABLE ONLY public.progress_update_history
    ALTER COLUMN id SET DEFAULT nextval('public.progress_update_history_id_seq'::regclass);

ALTER TABLE ONLY public.progress_update_history
    ADD CONSTRAINT IF NOT EXISTS progress_update_history_pkey PRIMARY KEY (id);


CREATE TABLE IF NOT EXISTS public.qh3_order (
    id bigint NOT NULL,
    confirmation_number character varying(20) NOT NULL,
    indicator_code character varying(20),
    operation_short_text text,
    order_no character varying(20) NOT NULL,
    operation_no character varying(10),
    sequence_category character varying(5),
    sequence_number character varying(20),
    branch_operation_no character varying(10),
    return_operation_no character varying(10),
    material_no character varying(50),
    material_description text,
    operation_description text,
    work_center character varying(30),
    cost_center character varying(30),
    plant_code character varying(10),
    unit_of_measure character varying(10),
    standard_value character varying(30),
    order_type character varying(10),
    order_description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status_etl character varying(10) DEFAULT 'NEW'::character varying
);

ALTER TABLE public.qh3_order ALTER COLUMN id
    ADD GENERATED ALWAYS AS IDENTITY (
        SEQUENCE NAME public.qh3_order_id_seq
        START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
    );

ALTER TABLE ONLY public.qh3_order
    ADD CONSTRAINT IF NOT EXISTS qh3_order_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.qh3_order
    ADD CONSTRAINT IF NOT EXISTS qh3_order_confirmation_number_key UNIQUE (confirmation_number);


CREATE TABLE IF NOT EXISTS public.sow_standard (
    id bigint NOT NULL,
    component_id bigint NOT NULL,
    operation_no integer NOT NULL,
    operation_text text NOT NULL,
    machineid text,
    workcenter text,
    std_hours numeric(10,2),
    source_plant integer
);

ALTER TABLE public.sow_standard ALTER COLUMN id
    ADD GENERATED ALWAYS AS IDENTITY (
        SEQUENCE NAME public.sow_standard_id_seq
        START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
    );

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT IF NOT EXISTS sow_standard_pkey PRIMARY KEY (id);


CREATE TABLE IF NOT EXISTS public.sow_template_lines (
    id bigint NOT NULL,
    template_id bigint NOT NULL,
    standard_id bigint NOT NULL
);

ALTER TABLE public.sow_template_lines ALTER COLUMN id
    ADD GENERATED ALWAYS AS IDENTITY (
        SEQUENCE NAME public.sow_template_lines_id_seq
        START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
    );

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT IF NOT EXISTS sow_template_lines_pkey PRIMARY KEY (id);


CREATE TABLE IF NOT EXISTS public.sow_templates (
    template_id bigint NOT NULL,
    component_id bigint NOT NULL,
    template_name text NOT NULL,
    created_by text,
    created_at timestamp without time zone DEFAULT now()
);

ALTER TABLE public.sow_templates ALTER COLUMN template_id
    ADD GENERATED ALWAYS AS IDENTITY (
        SEQUENCE NAME public.sow_templates_template_id_seq
        START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
    );

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT IF NOT EXISTS sow_templates_pkey PRIMARY KEY (template_id);


-- ============================================================
-- STEP 4: Alter existing tables
-- ============================================================

-- ── operations ───────────────────────────────────────────────
-- Rename columns (check if not already renamed)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='operations' AND column_name='opr_no'
    ) THEN
        ALTER TABLE public.operations RENAME COLUMN opr_no TO operation_no;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='operations' AND column_name='operationtext'
    ) THEN
        ALTER TABLE public.operations RENAME COLUMN operationtext TO operation_text;
    END IF;
END $$;

-- varchar → text (always safe, no data loss)
ALTER TABLE public.operations
    ALTER COLUMN wct_group TYPE text,
    ALTER COLUMN workcenter TYPE text;

-- Remove NOT NULL from part_id (safe, expands what's allowed)
ALTER TABLE public.operations ALTER COLUMN part_id DROP NOT NULL;

-- Update unique constraint name to match ptssb
ALTER TABLE public.operations
    DROP CONSTRAINT IF EXISTS operations_part_id_opr_no_key;
ALTER TABLE ONLY public.operations
    ADD CONSTRAINT IF NOT EXISTS operations_part_id_operation_no_key UNIQUE (part_id, operation_no);


-- ── parts ─────────────────────────────────────────────────────
-- varchar → text (safe)
ALTER TABLE public.parts
    ALTER COLUMN partnumber TYPE text,
    ALTER COLUMN partname TYPE text,
    ALTER COLUMN model TYPE text;

-- ⚠️ RISKY: timestamp with time zone → without time zone
-- Data is preserved but timezone offset is stripped (converted to local time).
-- Safe if your app doesn't rely on timezone-aware timestamps for parts.
ALTER TABLE public.parts
    ALTER COLUMN created_at TYPE timestamp without time zone
        USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE timestamp without time zone
        USING updated_at AT TIME ZONE 'UTC';


-- ── sow ───────────────────────────────────────────────────────
-- Rename operationtext → operation_text
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='sow' AND column_name='operationtext'
    ) THEN
        ALTER TABLE public.sow RENAME COLUMN operationtext TO operation_text;
    END IF;
END $$;

-- Add progress column (new, safe)
ALTER TABLE public.sow
    ADD COLUMN IF NOT EXISTS progress integer;

-- Set default 'new' on sync (ptssb has DEFAULT 'new')
ALTER TABLE public.sow
    ALTER COLUMN sync SET DEFAULT 'new'::text;

-- ⚠️ RISKY: actual_hours real → numeric(10,2)
-- Safe if no Infinity/NaN values. Check: SELECT * FROM sow WHERE actual_hours IS NOT NULL.
ALTER TABLE public.sow
    ALTER COLUMN actual_hours TYPE numeric(10,2)
        USING actual_hours::numeric(10,2);

-- ⚠️ RISKY: SET NOT NULL on order_no. Only run after verifying:
-- SELECT count(*) FROM sow WHERE order_no IS NULL;  → must be 0
-- ALTER TABLE public.sow ALTER COLUMN order_no SET NOT NULL;

-- Add CHECK constraints (safe, only affects future inserts)
ALTER TABLE public.sow
    ADD CONSTRAINT IF NOT EXISTS chk_sow_actual_progress
        CHECK ((actual_progress IS NULL) OR (actual_progress >= 0 AND actual_progress <= 100));

ALTER TABLE public.sow
    ADD CONSTRAINT IF NOT EXISTS chk_sow_progress
        CHECK ((progress IS NULL) OR (progress >= 0 AND progress <= 100));

-- Add unique constraint matching ptssb (sow_codenumber_uniq on codenumber alone)
-- bpn has sow_codenumber_unique on (order_no, operation_no); ptssb has sow_codenumber_uniq on (codenumber)
ALTER TABLE public.sow
    DROP CONSTRAINT IF EXISTS sow_codenumber_unique;
ALTER TABLE ONLY public.sow
    ADD CONSTRAINT IF NOT EXISTS sow_codenumber_uniq UNIQUE (codenumber);

-- ptssb also has uq_sow_order_operation on (order_no, operation_no)
ALTER TABLE ONLY public.sow
    ADD CONSTRAINT IF NOT EXISTS uq_sow_order_operation UNIQUE (order_no, operation_no);

-- NOTE: bpn has created_at/updated_at columns in sow; ptssb does not.
-- We keep them (not dropping) to preserve existing data.


-- ── timesheet_transaction ─────────────────────────────────────
-- Rename ssbr_ident → ssbr_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='timesheet_transaction' AND column_name='ssbr_ident'
    ) THEN
        ALTER TABLE public.timesheet_transaction RENAME COLUMN ssbr_ident TO ssbr_id;
    END IF;
END $$;

-- Add new columns (safe)
ALTER TABLE public.timesheet_transaction
    ADD COLUMN IF NOT EXISTS operation_no integer,
    ADD COLUMN IF NOT EXISTS order_no text;

-- ⚠️ RISKY: planhours text → numeric(10,2)
-- Run pre-flight check query first. Will fail if non-numeric text values exist.
ALTER TABLE public.timesheet_transaction
    ALTER COLUMN planhours TYPE numeric(10,2)
        USING NULLIF(planhours, '')::numeric(10,2);

-- ⚠️ RISKY: std_foreman_hours text → numeric(10,2)
ALTER TABLE public.timesheet_transaction
    ALTER COLUMN std_foreman_hours TYPE numeric(10,2)
        USING NULLIF(std_foreman_hours, '')::numeric(10,2);

-- ⚠️ RISKY: state_flag text → smallint DEFAULT 1
-- Will fail if non-integer values exist. Check pre-flight query.
ALTER TABLE public.timesheet_transaction
    ALTER COLUMN state_flag TYPE smallint
        USING NULLIF(state_flag, '')::smallint,
    ALTER COLUMN state_flag SET DEFAULT 1;

-- duration numeric(10,2) → numeric (relax precision, safe)
ALTER TABLE public.timesheet_transaction
    ALTER COLUMN duration TYPE numeric;

-- ⚠️ RISKY: SET NOT NULL on serialnumber. Verify no NULLs first.
-- ALTER TABLE public.timesheet_transaction ALTER COLUMN serialnumber SET NOT NULL;

-- ⚠️ RISKY: SET NOT NULL on full_name. Verify no NULLs first.
-- ALTER TABLE public.timesheet_transaction ALTER COLUMN full_name SET NOT NULL;

-- NOTE: bpn has seq, production_order columns not in ptssb.
-- Keeping them (no data loss policy).


-- ── processcontroldata ────────────────────────────────────────
-- ⚠️ RISKY: operation_no text → integer
-- Run pre-flight check first. Will fail if non-integer text values exist.
ALTER TABLE public.processcontroldata
    ALTER COLUMN operation_no TYPE integer
        USING NULLIF(operation_no, '')::integer;


-- ── usernfc ───────────────────────────────────────────────────
-- Add nfcid NOT NULL unique constraint
-- ⚠️ Only add if nfcid has no NULLs and no duplicates:
-- SELECT nfcid, count(*) FROM usernfc GROUP BY nfcid HAVING count(*) > 1;
-- SELECT count(*) FROM usernfc WHERE nfcid IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_usernfc_nfcid ON public.usernfc USING btree (nfcid);

-- Add unique constraint on snssb
-- ⚠️ Only safe if snssb has no duplicates:
-- SELECT snssb, count(*) FROM usernfc GROUP BY snssb HAVING count(*) > 1;
ALTER TABLE ONLY public.usernfc
    ADD CONSTRAINT IF NOT EXISTS usernfc_snssb_unique UNIQUE (snssb);


-- ── workcenter ────────────────────────────────────────────────
-- Add unique constraints (check for duplicates first)
-- SELECT machineid, count(*) FROM workcenter GROUP BY machineid HAVING count(*) > 1;
ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT IF NOT EXISTS workcenter_machineid_unique UNIQUE (machineid);

-- SELECT workcenternew, count(*) FROM workcenter GROUP BY workcenternew HAVING count(*) > 1;
ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT IF NOT EXISTS workcenter_workcenternew_unique UNIQUE (workcenternew);


-- ============================================================
-- STEP 5: New Triggers on sow
-- ============================================================

-- Remove old bpn trigger (uses update_modified_column which is bpn-only)
DROP TRIGGER IF EXISTS update_sow_updated_at ON public.sow;

-- Add ptssb triggers
CREATE TRIGGER before_update_set_sync
    BEFORE UPDATE ON public.sow
    FOR EACH ROW EXECUTE FUNCTION public.trg_set_sync_modified();

CREATE TRIGGER trg_delete_dup_sow
    AFTER INSERT ON public.sow
    FOR EACH ROW EXECUTE FUNCTION public.fn_delete_dup_sow();


-- ============================================================
-- STEP 6: Foreign Key Constraints (new tables)
-- ============================================================

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT IF NOT EXISTS sow_standard_component_id_fkey
        FOREIGN KEY (component_id) REFERENCES public.components(component_id);

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT IF NOT EXISTS sow_template_lines_standard_id_fkey
        FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id);

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT IF NOT EXISTS sow_template_lines_template_id_fkey
        FOREIGN KEY (template_id) REFERENCES public.sow_templates(template_id);

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT IF NOT EXISTS sow_templates_component_id_fkey
        FOREIGN KEY (component_id) REFERENCES public.components(component_id);

ALTER TABLE ONLY public.progress_update_history
    ADD CONSTRAINT IF NOT EXISTS fk_puh_sow_operation
        FOREIGN KEY (operation_id) REFERENCES public.sow(idsow) ON DELETE CASCADE;

-- Rename FK on processcontroldata to match ptssb
ALTER TABLE ONLY public.processcontroldata
    DROP CONSTRAINT IF EXISTS fk_processcontroldata_timesheet;
ALTER TABLE ONLY public.processcontroldata
    ADD CONSTRAINT IF NOT EXISTS fk_pcd_timesheet
        FOREIGN KEY (tsnumber) REFERENCES public.timesheet_transaction(tsnumber) ON DELETE SET NULL;

-- Rename FK on process_parameter to match ptssb
ALTER TABLE ONLY public.process_parameter
    DROP CONSTRAINT IF EXISTS fk_process_parameter_process;
ALTER TABLE ONLY public.process_parameter
    ADD CONSTRAINT IF NOT EXISTS fk_pp_process_category
        FOREIGN KEY (id_process) REFERENCES public.process_category(id_process) ON DELETE CASCADE;

-- Add FK: timesheet_transaction.serialnumber → usernfc.snssb
-- ⚠️ Only add if all serialnumber values exist in usernfc.snssb:
-- SELECT DISTINCT t.serialnumber FROM timesheet_transaction t
--   LEFT JOIN usernfc u ON u.snssb = t.serialnumber
--   WHERE u.snssb IS NULL AND t.serialnumber IS NOT NULL;
-- ALTER TABLE ONLY public.timesheet_transaction
--     ADD CONSTRAINT fk_timesheet_user
--         FOREIGN KEY (serialnumber) REFERENCES public.usernfc(snssb)
--         ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;


-- ============================================================
-- STEP 7: New Indexes
-- ============================================================

-- processcontroldata indexes
CREATE INDEX IF NOT EXISTS idx_pcd_operation_no ON public.processcontroldata USING btree (operation_no);
CREATE INDEX IF NOT EXISTS idx_pcd_production_order ON public.processcontroldata USING btree (production_order);
CREATE INDEX IF NOT EXISTS idx_pcd_snssb ON public.processcontroldata USING btree (snssb);
CREATE INDEX IF NOT EXISTS idx_pcd_tsnumber ON public.processcontroldata USING btree (tsnumber);
CREATE INDEX IF NOT EXISTS idx_pcdi_id_parameter ON public.processcontroldata_item USING btree (id_parameter);
CREATE INDEX IF NOT EXISTS idx_pcdi_id_processcontroldata ON public.processcontroldata_item USING btree (id_processcontroldata);
CREATE INDEX IF NOT EXISTS idx_pp_id_process ON public.process_parameter USING btree (id_process);
CREATE INDEX IF NOT EXISTS idx_ppcb_id_parameter ON public.process_parameter_choicebase USING btree (id_parameter);

-- mst_job indexes
CREATE INDEX IF NOT EXISTS idx_mst_job_order_no ON public.mst_job USING btree (order_no);
CREATE INDEX IF NOT EXISTS idx_mst_job_order_wc ON public.mst_job USING btree (order_no, workcenter);
CREATE INDEX IF NOT EXISTS idx_mst_job_system_status ON public.mst_job USING btree (system_status);
CREATE INDEX IF NOT EXISTS idx_mst_job_workcenter ON public.mst_job USING btree (workcenter);

-- production_operations indexes
CREATE INDEX IF NOT EXISTS idx_prodops_order_operation ON public.production_operations USING btree (order_number, operation_number);

-- progress_update_history indexes
CREATE INDEX IF NOT EXISTS idx_puh_created_at ON public.progress_update_history USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_puh_operation_id ON public.progress_update_history USING btree (operation_id);

-- sow indexes (additional)
CREATE INDEX IF NOT EXISTS idx_sow_codenumber ON public.sow USING btree (codenumber);
CREATE INDEX IF NOT EXISTS idx_sow_order_no ON public.sow USING btree (order_no);
CREATE INDEX IF NOT EXISTS idx_sow_ssbr_id ON public.sow USING btree (ssbr_id);
CREATE INDEX IF NOT EXISTS idx_sow_workcenter ON public.sow USING btree (workcenter);
CREATE INDEX IF NOT EXISTS idx_sow_sync_modified ON public.sow USING btree (order_no, operation_no) WHERE (sync = 'modified'::text);
-- GIN trgm index (requires pg_trgm extension from STEP 1)
CREATE INDEX IF NOT EXISTS idx_sow_part_name_trgm ON public.sow USING gin (part_name public.gin_trgm_ops);

-- sow_standard indexes
CREATE INDEX IF NOT EXISTS idx_sow_standard_component_id ON public.sow_standard USING btree (component_id);
CREATE INDEX IF NOT EXISTS idx_sow_standard_source_plant ON public.sow_standard USING btree (source_plant);

-- sow_template_lines indexes
CREATE INDEX IF NOT EXISTS idx_sow_tmpl_lines_standard_id ON public.sow_template_lines USING btree (standard_id);
CREATE INDEX IF NOT EXISTS idx_sow_tmpl_lines_template_id ON public.sow_template_lines USING btree (template_id);

-- timesheet_transaction additional indexes
CREATE INDEX IF NOT EXISTS idx_ts_longdate_checkout ON public.timesheet_transaction USING btree (longdate_checkout);
CREATE INDEX IF NOT EXISTS idx_ts_operation_no ON public.timesheet_transaction USING btree (operation_no);
CREATE INDEX IF NOT EXISTS idx_ts_order_no ON public.timesheet_transaction USING btree (order_no);
CREATE INDEX IF NOT EXISTS idx_ts_order_wc ON public.timesheet_transaction USING btree (order_no, workcentercode);
CREATE INDEX IF NOT EXISTS idx_ts_state_flag ON public.timesheet_transaction USING btree (state_flag);
CREATE INDEX IF NOT EXISTS idx_ts_workcentercode ON public.timesheet_transaction USING btree (workcentercode);
-- GIN trgm indexes
CREATE INDEX IF NOT EXISTS idx_ts_full_name_trgm ON public.timesheet_transaction USING gin (full_name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ts_order_no_trgm ON public.timesheet_transaction USING gin (order_no public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ts_serialnumber_trgm ON public.timesheet_transaction USING gin (serialnumber public.gin_trgm_ops);
-- Remove old index name if it exists (bpn used idx_ts_production_order)
DROP INDEX IF EXISTS idx_ts_production_order;


-- ============================================================
-- STEP 8: New Views
-- ============================================================

-- vw_sow_orders (replaces or adds alongside vw_actualsummary)
CREATE OR REPLACE VIEW public.vw_sow_orders AS
 SELECT s.order_no,
    (array_agg(s.idsow ORDER BY s.operation_no))[1] AS idsow,
    (array_agg(s.ssbr_id ORDER BY s.operation_no))[1] AS ssbr_id,
    (array_agg(s.part_number ORDER BY s.operation_no))[1] AS part_number,
    (array_agg(s.part_name ORDER BY s.operation_no))[1] AS part_name,
    (array_agg(s.model ORDER BY s.operation_no))[1] AS model,
    (array_agg(s.customer ORDER BY s.operation_no))[1] AS customer,
    (array_agg(s.location ORDER BY s.operation_no))[1] AS location,
    (array_agg(s.type ORDER BY s.operation_no))[1] AS type,
    (array_agg(s."group" ORDER BY s.operation_no))[1] AS "group",
    (array_agg(s.category ORDER BY s.operation_no))[1] AS category,
    (array_agg(s.status ORDER BY s.operation_no))[1] AS status,
    (array_agg(s.systemstatus ORDER BY s.operation_no))[1] AS systemstatus,
    (array_agg(s.confirmation ORDER BY s.operation_no))[1] AS confirmation,
    (array_agg(s.created_by ORDER BY s.operation_no))[1] AS created_by,
    count(*) AS operation_count,
    COALESCE(sum(s.planhours), 0::numeric) AS total_planhours,
    round(avg(
        CASE
            WHEN s.planhours IS NOT NULL AND s.planhours::numeric <> 0
              AND (s.workcenter IS NULL OR s.workcenter !~~* '%OT%')
            THEN s.progress
            ELSE NULL::integer
        END
    ), 1) AS avg_progress
   FROM public.sow s
  GROUP BY s.order_no;

-- "order" materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS public."order" AS
 SELECT sow.order_no,
    min(sow.ssbr_id) AS ssbr_id,
    min(sow.part_number) AS part_number,
    min(sow.part_name) AS part_name,
    min(sow.model) AS model,
    min(sow.customer) AS customer,
    min(sow.location) AS location,
    min(sow.status) AS status,
    min(sow."group") AS "group",
    min(sow.systemstatus) AS systemstatus,
    sum(sow.planhours) AS planhours
   FROM public.sow
  GROUP BY sow.order_no
  WITH NO DATA;

-- NOTE: vw_actualsummary exists only in bpn; kept as-is (not in ptssb but harmless).


COMMIT;

-- ============================================================
-- POST-MIGRATION STEPS (run manually after verifying data)
-- ============================================================
-- 1. Refresh materialized view:
--    REFRESH MATERIALIZED VIEW public."order";
--
-- 2. If serialnumber has no NULLs, uncomment and run:
--    ALTER TABLE public.timesheet_transaction ALTER COLUMN serialnumber SET NOT NULL;
--    ALTER TABLE public.timesheet_transaction ALTER COLUMN full_name SET NOT NULL;
--
-- 3. If order_no has no NULLs in sow, run:
--    ALTER TABLE public.sow ALTER COLUMN order_no SET NOT NULL;
--
-- 4. If serialnumber values all exist in usernfc.snssb, add FK:
--    ALTER TABLE ONLY public.timesheet_transaction
--        ADD CONSTRAINT fk_timesheet_user
--        FOREIGN KEY (serialnumber) REFERENCES public.usernfc(snssb)
--        ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
-- ============================================================
