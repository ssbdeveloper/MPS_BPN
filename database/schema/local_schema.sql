--
-- PostgreSQL database dump
--

-- Dumped from database version 15.0
-- Dumped by pg_dump version 15.0

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.sow_templates DROP CONSTRAINT IF EXISTS sow_templates_component_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sow_template_lines DROP CONSTRAINT IF EXISTS sow_template_lines_template_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sow_template_lines DROP CONSTRAINT IF EXISTS sow_template_lines_standard_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sow_standard DROP CONSTRAINT IF EXISTS sow_standard_component_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sow_standard_attachments DROP CONSTRAINT IF EXISTS sow_standard_attachments_standard_id_fkey;
ALTER TABLE IF EXISTS ONLY public.shipping_records DROP CONSTRAINT IF EXISTS shipping_records_send_by_id_fkey;
ALTER TABLE IF EXISTS ONLY public.shipping_records DROP CONSTRAINT IF EXISTS shipping_records_receiving_order_id_fkey;
ALTER TABLE IF EXISTS ONLY public.receiving_orders DROP CONSTRAINT IF EXISTS receiving_orders_received_by_id_fkey;
ALTER TABLE IF EXISTS ONLY public.receiving_orders DROP CONSTRAINT IF EXISTS receiving_orders_packing_type_id_fkey;
ALTER TABLE IF EXISTS ONLY public.receiving_orders DROP CONSTRAINT IF EXISTS receiving_orders_customer_id_fkey;
ALTER TABLE IF EXISTS ONLY public.receiving_components DROP CONSTRAINT IF EXISTS receiving_components_receiving_order_id_fkey;
ALTER TABLE IF EXISTS ONLY public.receiving_components DROP CONSTRAINT IF EXISTS receiving_components_part_category_id_fkey;
ALTER TABLE IF EXISTS ONLY public.receiving_components DROP CONSTRAINT IF EXISTS receiving_components_parent_component_id_fkey;
ALTER TABLE IF EXISTS ONLY public.timesheet_transaction DROP CONSTRAINT IF EXISTS fk_timesheet_user;
ALTER TABLE IF EXISTS ONLY public.progress_update_history DROP CONSTRAINT IF EXISTS fk_puh_sow_operation;
ALTER TABLE IF EXISTS ONLY public.process_parameter DROP CONSTRAINT IF EXISTS fk_pp_process_category;
ALTER TABLE IF EXISTS ONLY public.processcontroldata DROP CONSTRAINT IF EXISTS fk_pcd_timesheet;
ALTER TABLE IF EXISTS ONLY public.operations DROP CONSTRAINT IF EXISTS fk_operations_part;
ALTER TABLE IF EXISTS ONLY public.processcontroldata_item DROP CONSTRAINT IF EXISTS fk_item_processcontroldata;
ALTER TABLE IF EXISTS ONLY public.processcontroldata_item DROP CONSTRAINT IF EXISTS fk_item_parameter;
ALTER TABLE IF EXISTS ONLY public.consumable_ticket DROP CONSTRAINT IF EXISTS fk_consumable_ticket_user;
ALTER TABLE IF EXISTS ONLY public.consumable_item DROP CONSTRAINT IF EXISTS fk_consumable_item_ticket;
ALTER TABLE IF EXISTS ONLY public.process_parameter_choicebase DROP CONSTRAINT IF EXISTS fk_choice_parameter;
ALTER TABLE IF EXISTS ONLY public.component_hours DROP CONSTRAINT IF EXISTS component_hours_component_id_fkey;
ALTER TABLE IF EXISTS ONLY public.buffer_transaction DROP CONSTRAINT IF EXISTS buffer_transaction_component_id_fkey;
DROP TRIGGER IF EXISTS update_parts_updated_at ON public.parts;
DROP TRIGGER IF EXISTS update_operations_updated_at ON public.operations;
DROP TRIGGER IF EXISTS trg_set_modified_at ON public.timesheet_transaction;
DROP TRIGGER IF EXISTS trg_delete_dup_sow ON public.sow;
DROP TRIGGER IF EXISTS before_update_set_sync ON public.sow;
DROP INDEX IF EXISTS public.uq_usernfc_nfcid;
DROP INDEX IF EXISTS public.idx_users_username;
DROP INDEX IF EXISTS public.idx_users_role;
DROP INDEX IF EXISTS public.idx_ts_workcentercode;
DROP INDEX IF EXISTS public.idx_ts_validation_date;
DROP INDEX IF EXISTS public.idx_ts_state_flag;
DROP INDEX IF EXISTS public.idx_ts_serialnumber_trgm;
DROP INDEX IF EXISTS public.idx_ts_serial_checkin;
DROP INDEX IF EXISTS public.idx_ts_order_wc;
DROP INDEX IF EXISTS public.idx_ts_order_no_trgm;
DROP INDEX IF EXISTS public.idx_ts_order_no;
DROP INDEX IF EXISTS public.idx_ts_operation_no;
DROP INDEX IF EXISTS public.idx_ts_longdate_checkout;
DROP INDEX IF EXISTS public.idx_ts_longdate_checkin;
DROP INDEX IF EXISTS public.idx_ts_full_name_trgm;
DROP INDEX IF EXISTS public.idx_ts_component_tracking_productive;
DROP INDEX IF EXISTS public.idx_ts_component_tracking_active;
DROP INDEX IF EXISTS public.idx_timesheet_modified;
DROP INDEX IF EXISTS public.idx_sr_send_by;
DROP INDEX IF EXISTS public.idx_sr_order;
DROP INDEX IF EXISTS public.idx_sr_delivery_date;
DROP INDEX IF EXISTS public.idx_sow_workcenter;
DROP INDEX IF EXISTS public.idx_sow_tmpl_lines_template_id;
DROP INDEX IF EXISTS public.idx_sow_tmpl_lines_standard_id;
DROP INDEX IF EXISTS public.idx_sow_sync_modified;
DROP INDEX IF EXISTS public.idx_sow_std_attach_standard_id;
DROP INDEX IF EXISTS public.idx_sow_standard_source_plant;
DROP INDEX IF EXISTS public.idx_sow_standard_component_id;
DROP INDEX IF EXISTS public.idx_sow_ssbr_id;
DROP INDEX IF EXISTS public.idx_sow_revision_history_order_created;
DROP INDEX IF EXISTS public.idx_sow_part_number;
DROP INDEX IF EXISTS public.idx_sow_part_name_trgm;
DROP INDEX IF EXISTS public.idx_sow_order_no;
DROP INDEX IF EXISTS public.idx_sow_model;
DROP INDEX IF EXISTS public.idx_sow_codenumber;
DROP INDEX IF EXISTS public.idx_ro_ssbr;
DROP INDEX IF EXISTS public.idx_ro_received_date;
DROP INDEX IF EXISTS public.idx_ro_received_by;
DROP INDEX IF EXISTS public.idx_ro_customer_id;
DROP INDEX IF EXISTS public.idx_rc_prod_order;
DROP INDEX IF EXISTS public.idx_rc_parent;
DROP INDEX IF EXISTS public.idx_rc_order;
DROP INDEX IF EXISTS public.idx_rc_model_code;
DROP INDEX IF EXISTS public.idx_rc_component_id;
DROP INDEX IF EXISTS public.idx_puh_operation_id;
DROP INDEX IF EXISTS public.idx_puh_created_at;
DROP INDEX IF EXISTS public.idx_prodops_order_operation;
DROP INDEX IF EXISTS public.idx_ppcb_id_parameter;
DROP INDEX IF EXISTS public.idx_pp_id_process;
DROP INDEX IF EXISTS public.idx_ph3_order_order_description;
DROP INDEX IF EXISTS public.idx_pcdi_id_processcontroldata;
DROP INDEX IF EXISTS public.idx_pcdi_id_parameter;
DROP INDEX IF EXISTS public.idx_pcd_tsnumber;
DROP INDEX IF EXISTS public.idx_pcd_snssb;
DROP INDEX IF EXISTS public.idx_pcd_production_order;
DROP INDEX IF EXISTS public.idx_pcd_operation_no;
DROP INDEX IF EXISTS public.idx_parts_partnumber;
DROP INDEX IF EXISTS public.idx_parts_partname;
DROP INDEX IF EXISTS public.idx_parts_model;
DROP INDEX IF EXISTS public.idx_operations_part_id;
DROP INDEX IF EXISTS public.idx_operations_drawing_path;
DROP INDEX IF EXISTS public.idx_customers_site;
DROP INDEX IF EXISTS public.idx_customers_name;
DROP INDEX IF EXISTS public.idx_consumable_ticket_sn_created;
DROP INDEX IF EXISTS public.idx_consumable_stock_material_code;
DROP INDEX IF EXISTS public.idx_consumable_stock_description_trgm;
DROP INDEX IF EXISTS public.idx_consumable_stock_code_mm;
DROP INDEX IF EXISTS public.idx_consumable_item_status;
DROP INDEX IF EXISTS public.idx_consumable_item_cis_no;
DROP INDEX IF EXISTS public.idx_component_hours_machine;
DROP INDEX IF EXISTS public.idx_buffer_transaction_order_operation;
DROP INDEX IF EXISTS public.idx_buffer_transaction_machine_time;
DROP INDEX IF EXISTS public.idx_buffer_transaction_latest;
DROP INDEX IF EXISTS public.idx_buffer_transaction_history;
DROP INDEX IF EXISTS public.idx_buffer_transaction_component;
DROP INDEX IF EXISTS public.idx_buffer_transaction_box_priority;
ALTER TABLE IF EXISTS ONLY public.workcenter DROP CONSTRAINT IF EXISTS workcenter_pkey;
ALTER TABLE IF EXISTS ONLY public.workcenter DROP CONSTRAINT IF EXISTS workcenter_machineid_unique;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_username_key;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.usernfc DROP CONSTRAINT IF EXISTS usernfc_snssb_unique;
ALTER TABLE IF EXISTS ONLY public.usernfc DROP CONSTRAINT IF EXISTS usernfc_pkey;
ALTER TABLE IF EXISTS ONLY public.sow DROP CONSTRAINT IF EXISTS uq_sow_order_operation;
ALTER TABLE IF EXISTS ONLY public.timesheet_transaction DROP CONSTRAINT IF EXISTS timesheet_transaction_pkey;
ALTER TABLE IF EXISTS ONLY public.sow_templates DROP CONSTRAINT IF EXISTS sow_templates_pkey;
ALTER TABLE IF EXISTS ONLY public.sow_template_lines DROP CONSTRAINT IF EXISTS sow_template_lines_pkey;
ALTER TABLE IF EXISTS ONLY public.sow_standard DROP CONSTRAINT IF EXISTS sow_standard_pkey;
ALTER TABLE IF EXISTS ONLY public.sow_standard_attachments DROP CONSTRAINT IF EXISTS sow_standard_attachments_pkey;
ALTER TABLE IF EXISTS ONLY public.sow_revision_history DROP CONSTRAINT IF EXISTS sow_revision_history_pkey;
ALTER TABLE IF EXISTS ONLY public.sow_revision_history DROP CONSTRAINT IF EXISTS sow_revision_history_order_no_revision_no_key;
ALTER TABLE IF EXISTS ONLY public.sow DROP CONSTRAINT IF EXISTS sow_pkey;
ALTER TABLE IF EXISTS ONLY public.sow DROP CONSTRAINT IF EXISTS sow_codenumber_uniq;
ALTER TABLE IF EXISTS ONLY public.shipping_records DROP CONSTRAINT IF EXISTS shipping_records_receiving_order_id_key;
ALTER TABLE IF EXISTS ONLY public.shipping_records DROP CONSTRAINT IF EXISTS shipping_records_pkey;
ALTER TABLE IF EXISTS ONLY public.receiving_orders DROP CONSTRAINT IF EXISTS receiving_orders_ssbr_ident_key;
ALTER TABLE IF EXISTS ONLY public.receiving_orders DROP CONSTRAINT IF EXISTS receiving_orders_pkey;
ALTER TABLE IF EXISTS ONLY public.receiving_components DROP CONSTRAINT IF EXISTS receiving_components_pkey;
ALTER TABLE IF EXISTS ONLY public.qh3_order DROP CONSTRAINT IF EXISTS qh3_order_pkey;
ALTER TABLE IF EXISTS ONLY public.qh3_order DROP CONSTRAINT IF EXISTS qh3_order_confirmation_number_key;
ALTER TABLE IF EXISTS ONLY public.progress_update_history DROP CONSTRAINT IF EXISTS progress_update_history_pkey;
ALTER TABLE IF EXISTS ONLY public.production_operations DROP CONSTRAINT IF EXISTS production_operations_pkey;
ALTER TABLE IF EXISTS ONLY public.processcontroldata DROP CONSTRAINT IF EXISTS processcontroldata_pkey;
ALTER TABLE IF EXISTS ONLY public.processcontroldata_item DROP CONSTRAINT IF EXISTS processcontroldata_item_pkey;
ALTER TABLE IF EXISTS ONLY public.process_parameter DROP CONSTRAINT IF EXISTS process_parameter_pkey;
ALTER TABLE IF EXISTS ONLY public.process_parameter_choicebase DROP CONSTRAINT IF EXISTS process_parameter_choicebase_pkey;
ALTER TABLE IF EXISTS ONLY public.process_category DROP CONSTRAINT IF EXISTS process_category_pkey;
ALTER TABLE IF EXISTS ONLY public.ph3_order DROP CONSTRAINT IF EXISTS ph3_order_pkey;
ALTER TABLE IF EXISTS ONLY public.ph3_order DROP CONSTRAINT IF EXISTS ph3_order_confirmation_number_key;
ALTER TABLE IF EXISTS ONLY public.parts DROP CONSTRAINT IF EXISTS parts_pkey;
ALTER TABLE IF EXISTS ONLY public.parts DROP CONSTRAINT IF EXISTS parts_partnumber_key;
ALTER TABLE IF EXISTS ONLY public.part_categories DROP CONSTRAINT IF EXISTS part_categories_pkey;
ALTER TABLE IF EXISTS ONLY public.part_categories DROP CONSTRAINT IF EXISTS part_categories_name_key;
ALTER TABLE IF EXISTS ONLY public.packing_types DROP CONSTRAINT IF EXISTS packing_types_pkey;
ALTER TABLE IF EXISTS ONLY public.packing_types DROP CONSTRAINT IF EXISTS packing_types_name_key;
ALTER TABLE IF EXISTS ONLY public.operations DROP CONSTRAINT IF EXISTS operations_pkey;
ALTER TABLE IF EXISTS ONLY public.operations DROP CONSTRAINT IF EXISTS operations_part_id_operation_no_key;
ALTER TABLE IF EXISTS ONLY public.mch_statustypes DROP CONSTRAINT IF EXISTS mch_statustypes_pkey;
ALTER TABLE IF EXISTS ONLY public.mch_machines DROP CONSTRAINT IF EXISTS mch_machines_pkey;
ALTER TABLE IF EXISTS ONLY public.log_timesheet_sap DROP CONSTRAINT IF EXISTS log_timesheet_sap_pkey;
ALTER TABLE IF EXISTS ONLY public.customers DROP CONSTRAINT IF EXISTS customers_pkey;
ALTER TABLE IF EXISTS ONLY public.customers DROP CONSTRAINT IF EXISTS customers_name_site_name_key;
ALTER TABLE IF EXISTS ONLY public.consumable_ticket DROP CONSTRAINT IF EXISTS consumable_ticket_pkey;
ALTER TABLE IF EXISTS ONLY public.consumable_ticket DROP CONSTRAINT IF EXISTS consumable_ticket_cis_no_key;
ALTER TABLE IF EXISTS ONLY public.consumable_stock DROP CONSTRAINT IF EXISTS consumable_stock_pkey;
ALTER TABLE IF EXISTS ONLY public.consumable_item DROP CONSTRAINT IF EXISTS consumable_item_pkey;
ALTER TABLE IF EXISTS ONLY public.components DROP CONSTRAINT IF EXISTS components_pkey;
ALTER TABLE IF EXISTS ONLY public.components DROP CONSTRAINT IF EXISTS components_model_part_number_key;
ALTER TABLE IF EXISTS ONLY public.component_hours DROP CONSTRAINT IF EXISTS component_hours_pkey;
ALTER TABLE IF EXISTS ONLY public.component_hours DROP CONSTRAINT IF EXISTS component_hours_machine_id_component_id_component_label_key;
ALTER TABLE IF EXISTS ONLY public.buffer_transaction DROP CONSTRAINT IF EXISTS buffer_transaction_pkey;
ALTER TABLE IF EXISTS public.sow_standard_attachments ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.sow_revision_history ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.progress_update_history ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.component_hours ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.buffer_transaction ALTER COLUMN id DROP DEFAULT;
DROP TABLE IF EXISTS public.workcenter;
DROP VIEW IF EXISTS public.vw_sow_orders;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.usernfc;
DROP TABLE IF EXISTS public.timesheet_transaction;
DROP TABLE IF EXISTS public.sow_templates;
DROP TABLE IF EXISTS public.sow_template_lines;
DROP SEQUENCE IF EXISTS public.sow_standard_attachments_id_seq;
DROP TABLE IF EXISTS public.sow_standard_attachments;
DROP TABLE IF EXISTS public.sow_standard;
DROP SEQUENCE IF EXISTS public.sow_revision_history_id_seq;
DROP TABLE IF EXISTS public.sow_revision_history;
DROP TABLE IF EXISTS public.shipping_records;
DROP TABLE IF EXISTS public.receiving_orders;
DROP TABLE IF EXISTS public.receiving_components;
DROP TABLE IF EXISTS public.qh3_order;
DROP SEQUENCE IF EXISTS public.progress_update_history_id_seq;
DROP TABLE IF EXISTS public.progress_update_history;
DROP TABLE IF EXISTS public.production_operations;
DROP TABLE IF EXISTS public.processcontroldata_item;
DROP TABLE IF EXISTS public.processcontroldata;
DROP TABLE IF EXISTS public.process_parameter_choicebase;
DROP TABLE IF EXISTS public.process_parameter;
DROP TABLE IF EXISTS public.process_category;
DROP TABLE IF EXISTS public.ph3_order;
DROP TABLE IF EXISTS public.parts;
DROP TABLE IF EXISTS public.part_categories;
DROP TABLE IF EXISTS public.packing_types;
DROP MATERIALIZED VIEW IF EXISTS public."order";
DROP TABLE IF EXISTS public.sow;
DROP TABLE IF EXISTS public.operations;
DROP TABLE IF EXISTS public.mch_statustypes;
DROP TABLE IF EXISTS public.mch_productiondata;
DROP TABLE IF EXISTS public.mch_machines;
DROP TABLE IF EXISTS public.log_timesheet_sap;
DROP TABLE IF EXISTS public.customers;
DROP TABLE IF EXISTS public.consumable_ticket;
DROP TABLE IF EXISTS public.consumable_stock;
DROP TABLE IF EXISTS public.consumable_item;
DROP TABLE IF EXISTS public.components;
DROP SEQUENCE IF EXISTS public.component_hours_id_seq;
DROP TABLE IF EXISTS public.component_hours;
DROP SEQUENCE IF EXISTS public.buffer_transaction_id_seq;
DROP TABLE IF EXISTS public.buffer_transaction;
DROP FUNCTION IF EXISTS public.update_updated_at_column();
DROP FUNCTION IF EXISTS public.trg_set_sync_modified();
DROP FUNCTION IF EXISTS public.set_modified_at();
DROP FUNCTION IF EXISTS public.fn_delete_dup_sow();
DROP SCHEMA IF EXISTS public;
--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: fn_delete_dup_sow(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_delete_dup_sow() RETURNS trigger
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


--
-- Name: set_modified_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_modified_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.modified_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: trg_set_sync_modified(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_set_sync_modified() RETURNS trigger
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


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: buffer_transaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buffer_transaction (
    id bigint NOT NULL,
    machine_id text NOT NULL,
    type text NOT NULL,
    component_id bigint,
    component_label text,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    reference_no text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    order_no text,
    ssbr_id text,
    operation_no integer,
    operation_text text,
    priority integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT buffer_transaction_type_check CHECK ((type = ANY (ARRAY['in'::text, 'out'::text, 'moving'::text])))
);


--
-- Name: buffer_transaction_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.buffer_transaction_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: buffer_transaction_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.buffer_transaction_id_seq OWNED BY public.buffer_transaction.id;


--
-- Name: component_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.component_hours (
    id bigint NOT NULL,
    machine_id text NOT NULL,
    component_id bigint,
    component_label text,
    total_hours numeric(12,2) DEFAULT 0 NOT NULL,
    last_calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    note text
);


--
-- Name: component_hours_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.component_hours_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: component_hours_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.component_hours_id_seq OWNED BY public.component_hours.id;


--
-- Name: components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.components (
    component_id bigint NOT NULL,
    part_name text NOT NULL,
    model text NOT NULL,
    part_number text NOT NULL
);


--
-- Name: components_component_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.components ALTER COLUMN component_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.components_component_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: consumable_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumable_item (
    id integer NOT NULL,
    materialcode text NOT NULL,
    materialdescription text NOT NULL,
    quanitty numeric NOT NULL,
    uom text,
    created timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    cost_center text,
    cis_no text NOT NULL,
    gl_account text NOT NULL,
    code_mm text,
    status text DEFAULT 'active'::text NOT NULL,
    rejected_by text,
    rejected_reason text,
    rejected_at timestamp without time zone,
    adjusted_by text,
    adjusted_at timestamp without time zone,
    CONSTRAINT consumable_item_quanitty_check CHECK ((quanitty > (0)::numeric))
);


--
-- Name: consumable_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.consumable_item ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.consumable_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: consumable_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumable_stock (
    material_code text,
    code_mm text,
    material_description text,
    mrp_type text,
    plant text,
    quantity numeric DEFAULT 0 NOT NULL,
    type text,
    uom text,
    id integer NOT NULL
);


--
-- Name: consumable_stock_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.consumable_stock ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.consumable_stock_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: consumable_ticket; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumable_ticket (
    cis_no text NOT NULL,
    sn_karyawan text NOT NULL,
    nama_karyawan text NOT NULL,
    workcenter text,
    machineid text,
    comment text,
    status text DEFAULT 'waiting leader'::text NOT NULL,
    person_image text,
    closedate timestamp without time zone,
    created timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    id integer NOT NULL,
    image_person text,
    picked_by_sn text,
    picked_by_name text,
    picked_by_workcenter text,
    picked_by_machineid text,
    picked_by_nfcid text,
    picked_by_role text,
    picked_at timestamp without time zone
);


--
-- Name: consumable_ticket_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.consumable_ticket ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.consumable_ticket_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    site_name character varying(200),
    site_location character varying(300),
    contact_person character varying(100),
    phone character varying(20),
    email character varying(100),
    address text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.customers ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.customers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: log_timesheet_sap; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.log_timesheet_sap (
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


--
-- Name: log_timesheet_sap_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.log_timesheet_sap ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.log_timesheet_sap_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: mch_machines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mch_machines (
    machineno integer NOT NULL,
    sitemachineno integer,
    machinegroupid integer,
    plantid integer,
    machinetypeid integer,
    machineid character varying(50),
    machinename character varying(255),
    ipaddress character varying(50),
    description text,
    brand character varying(100),
    modelnumber character varying(100),
    serialnumber character varying(100),
    buildyear integer,
    mqtt_topic character varying(255),
    mqtt_topic_param character varying(255)
);


--
-- Name: mch_productiondata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mch_productiondata (
    proddataid integer NOT NULL,
    startdatetime timestamp without time zone NOT NULL,
    enddatetime timestamp without time zone,
    machineno integer NOT NULL,
    statusid smallint NOT NULL,
    previoustatusid smallint,
    duration integer,
    "Notes" character varying(100),
    operatorid character varying(100),
    jobid character varying(100),
    "JobComplete" boolean
);


--
-- Name: mch_statustypes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mch_statustypes (
    statusid integer NOT NULL,
    mainstatusid integer,
    description character varying(100),
    activitytype character varying(10)
);


--
-- Name: operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operations (
    operation_id integer NOT NULL,
    part_id integer,
    operation_no integer NOT NULL,
    operation_text text NOT NULL,
    wct_group text,
    workcenter text,
    planhours numeric(5,2),
    drawing_path text,
    remark text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: operations_operation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.operations ALTER COLUMN operation_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.operations_operation_id_seq
    START WITH 6850
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sow (
    idsow integer NOT NULL,
    order_no text NOT NULL,
    operation_no integer NOT NULL,
    ssbr_id text,
    part_number text,
    part_name text,
    model text,
    customer text,
    location text,
    wct_group text,
    workcenter text,
    operation_text text,
    workcenterdescription text,
    planhours numeric(10,2),
    systemstatus text,
    confirmation text,
    status text,
    finish_date date,
    weight numeric(5,2),
    created_by text,
    type text,
    "group" text,
    category text,
    remark text,
    codenumber text GENERATED ALWAYS AS ((order_no || (operation_no)::text)) STORED,
    sync text DEFAULT 'new'::text,
    plan_start date,
    plan_finish date,
    actual_start date,
    actual_finish date,
    actual_progress numeric(5,2),
    actual_hours numeric(10,2),
    progress integer,
    CONSTRAINT chk_sow_actual_progress CHECK (((actual_progress IS NULL) OR ((actual_progress >= (0)::numeric) AND (actual_progress <= (100)::numeric)))),
    CONSTRAINT chk_sow_progress CHECK (((progress IS NULL) OR ((progress >= 0) AND (progress <= 100))))
);


--
-- Name: order; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public."order" AS
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


--
-- Name: packing_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.packing_types (
    id integer NOT NULL,
    name character varying(100) NOT NULL
);


--
-- Name: packing_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.packing_types ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.packing_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: part_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_categories (
    id integer NOT NULL,
    name character varying(100) NOT NULL
);


--
-- Name: part_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.part_categories ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.part_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parts (
    part_id integer NOT NULL,
    partnumber text NOT NULL,
    partname text NOT NULL,
    model text NOT NULL,
    drawing_path text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: parts_part_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.parts ALTER COLUMN part_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.parts_part_id_seq
    START WITH 700
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ph3_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ph3_order (
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


--
-- Name: ph3_order_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ph3_order ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ph3_order_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: process_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_category (
    id_process integer NOT NULL,
    process_name text NOT NULL,
    description text
);


--
-- Name: process_category_id_process_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.process_category ALTER COLUMN id_process ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.process_category_id_process_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: process_parameter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_parameter (
    id_parameter integer NOT NULL,
    parameter_name text NOT NULL,
    description text,
    parameter_no integer,
    uom text,
    ischoice boolean DEFAULT false,
    isnumber boolean DEFAULT false,
    id_process integer NOT NULL
);


--
-- Name: process_parameter_choicebase; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_parameter_choicebase (
    id_choice integer NOT NULL,
    choice_name text NOT NULL,
    description text,
    id_parameter integer NOT NULL
);


--
-- Name: process_parameter_choicebase_id_choice_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.process_parameter_choicebase ALTER COLUMN id_choice ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.process_parameter_choicebase_id_choice_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: process_parameter_id_parameter_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.process_parameter ALTER COLUMN id_parameter ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.process_parameter_id_parameter_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: processcontroldata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processcontroldata (
    id_processcontroldata integer NOT NULL,
    snssb text,
    full_name text,
    production_order text,
    ssbr_id text,
    operation_text text,
    operation_no integer,
    machineid text,
    workcenter text,
    validation_status text,
    validation_date timestamp with time zone,
    validation_by text,
    createddate timestamp with time zone DEFAULT now(),
    tsnumber integer
);


--
-- Name: processcontroldata_id_processcontroldata_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.processcontroldata ALTER COLUMN id_processcontroldata ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.processcontroldata_id_processcontroldata_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: processcontroldata_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processcontroldata_item (
    id_processcontroldata_item integer NOT NULL,
    category_name text,
    parameter_name text,
    value text,
    uom text,
    ischoice boolean,
    isnumber boolean,
    status text,
    note text,
    id_parameter integer,
    id_processcontroldata integer NOT NULL,
    createddate timestamp with time zone DEFAULT now()
);


--
-- Name: processcontroldata_item_id_processcontroldata_item_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.processcontroldata_item ALTER COLUMN id_processcontroldata_item ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.processcontroldata_item_id_processcontroldata_item_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: production_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_operations (
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


--
-- Name: production_operations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.production_operations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.production_operations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: progress_update_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.progress_update_history (
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


--
-- Name: progress_update_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.progress_update_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: progress_update_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.progress_update_history_id_seq OWNED BY public.progress_update_history.id;


--
-- Name: qh3_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qh3_order (
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


--
-- Name: qh3_order_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.qh3_order ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.qh3_order_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: receiving_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receiving_components (
    id integer NOT NULL,
    receiving_order_id integer NOT NULL,
    parent_component_id integer,
    part_level smallint NOT NULL,
    part_number character varying(100),
    part_description character varying(300) NOT NULL,
    model_code character varying(50),
    part_type character varying(10),
    part_category_id integer,
    production_order character varying(100),
    actual_component character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    component_id bigint,
    CONSTRAINT receiving_components_part_level_check CHECK ((part_level = ANY (ARRAY[1, 2]))),
    CONSTRAINT receiving_components_part_type_check CHECK (((part_type)::text = ANY ((ARRAY['Single'::character varying, 'Group'::character varying])::text[])))
);


--
-- Name: receiving_components_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.receiving_components ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.receiving_components_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: receiving_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receiving_orders (
    id integer NOT NULL,
    ssbr_ident character varying(50) NOT NULL,
    customer_id integer NOT NULL,
    received_date date NOT NULL,
    tagging_time timestamp with time zone,
    received_by_id integer,
    reff_number character varying(200),
    ex_unit character varying(100),
    packing_list character varying(200),
    da_ckb_received character varying(200),
    packing_type_id integer,
    raw_sow_text text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: receiving_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.receiving_orders ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.receiving_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: shipping_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_records (
    id integer NOT NULL,
    receiving_order_id integer NOT NULL,
    delivery_note_number character varying(100),
    send_by_id integer,
    destination character varying(200),
    consignment_notes character varying(200),
    shipping_list character varying(200),
    freight_cost_bill character varying(100),
    delivery_date date,
    return_to_stock_date date,
    dn_received_by_customer date,
    dn_received_by_ssb date,
    dn_submit_date date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: shipping_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.shipping_records ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.shipping_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sow_idsow_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sow ALTER COLUMN idsow ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_idsow_seq
    START WITH 99100
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sow_revision_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sow_revision_history (
    id bigint NOT NULL,
    order_no text NOT NULL,
    revision_no integer NOT NULL,
    action text DEFAULT 'edit'::text NOT NULL,
    before_data jsonb,
    after_data jsonb,
    changed_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sow_revision_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sow_revision_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sow_revision_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sow_revision_history_id_seq OWNED BY public.sow_revision_history.id;


--
-- Name: sow_standard; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sow_standard (
    id bigint NOT NULL,
    component_id bigint NOT NULL,
    operation_no integer NOT NULL,
    operation_text text NOT NULL,
    machineid text,
    workcenter text,
    std_hours numeric(10,2),
    source_plant integer
);


--
-- Name: sow_standard_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sow_standard_attachments (
    id bigint NOT NULL,
    standard_id bigint NOT NULL,
    filename text NOT NULL,
    original_name text NOT NULL,
    file_path text NOT NULL,
    file_size integer,
    uploaded_at timestamp with time zone DEFAULT now()
);


--
-- Name: sow_standard_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sow_standard_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sow_standard_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sow_standard_attachments_id_seq OWNED BY public.sow_standard_attachments.id;


--
-- Name: sow_standard_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sow_standard ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_standard_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sow_template_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sow_template_lines (
    id bigint NOT NULL,
    template_id bigint NOT NULL,
    standard_id bigint NOT NULL
);


--
-- Name: sow_template_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sow_template_lines ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_template_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sow_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sow_templates (
    template_id bigint NOT NULL,
    component_id bigint NOT NULL,
    template_name text NOT NULL,
    created_by text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: sow_templates_template_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sow_templates ALTER COLUMN template_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_templates_template_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: timesheet_transaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timesheet_transaction (
    tsnumber integer NOT NULL,
    activitytype text,
    operation_text text,
    confirmationnumber text,
    ssbr_id text,
    date_checkin text,
    date_checkout text,
    full_name text NOT NULL,
    hour_checkin text,
    hour_checkout text,
    longdate_checkin timestamp with time zone,
    longdate_checkout timestamp with time zone,
    note text,
    part_name text,
    planhours numeric(10,2),
    plant text,
    serialnumber text NOT NULL,
    state_flag smallint DEFAULT '1'::smallint,
    std_foreman_hours numeric(10,2),
    validation_date timestamp with time zone,
    workcentercode text,
    workcenterdescription text,
    duration numeric,
    operation_no integer,
    order_no text,
    modified_at timestamp without time zone DEFAULT now()
);


--
-- Name: timesheet_transaction_tsnumber_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.timesheet_transaction ALTER COLUMN tsnumber ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.timesheet_transaction_tsnumber_seq
    START WITH 18300
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: usernfc; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usernfc (
    nfcid text NOT NULL,
    full_name text,
    snssb text,
    machineid text,
    machinename text,
    roles text,
    workcenter text,
    idrow integer NOT NULL,
    mode character varying(20) DEFAULT 'single'::character varying
);


--
-- Name: usernfc_idrow_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.usernfc ALTER COLUMN idrow ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.usernfc_idrow_seq
    START WITH 8
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    role character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    roles character varying(50)
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: vw_sow_orders; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_sow_orders AS
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
    COALESCE(sum(s.planhours), (0)::numeric) AS total_planhours,
    round(avg(
        CASE
            WHEN ((s.planhours IS NOT NULL) AND ((s.planhours)::numeric <> (0)::numeric) AND ((s.workcenter IS NULL) OR (s.workcenter !~~* '%OT%'::text))) THEN s.progress
            ELSE NULL::integer
        END), 1) AS avg_progress
   FROM public.sow s
  GROUP BY s.order_no;


--
-- Name: workcenter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workcenter (
    plant integer,
    workcenterot character varying(50),
    condition character varying(50),
    categoryhours character varying(50),
    groupname character varying(50),
    machineid character varying(50),
    "position" integer,
    costcenter integer,
    costcenter_rate integer,
    workcenter_description character varying(50),
    workcenternew character varying(50),
    workcenterold character varying(50),
    idrow integer NOT NULL
);


--
-- Name: workcenter_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.workcenter ALTER COLUMN idrow ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.workcenter_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buffer_transaction id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buffer_transaction ALTER COLUMN id SET DEFAULT nextval('public.buffer_transaction_id_seq'::regclass);


--
-- Name: component_hours id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_hours ALTER COLUMN id SET DEFAULT nextval('public.component_hours_id_seq'::regclass);


--
-- Name: progress_update_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_update_history ALTER COLUMN id SET DEFAULT nextval('public.progress_update_history_id_seq'::regclass);


--
-- Name: sow_revision_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_revision_history ALTER COLUMN id SET DEFAULT nextval('public.sow_revision_history_id_seq'::regclass);


--
-- Name: sow_standard_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_standard_attachments ALTER COLUMN id SET DEFAULT nextval('public.sow_standard_attachments_id_seq'::regclass);


--
-- Name: buffer_transaction buffer_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buffer_transaction
    ADD CONSTRAINT buffer_transaction_pkey PRIMARY KEY (id);


--
-- Name: component_hours component_hours_machine_id_component_id_component_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_hours
    ADD CONSTRAINT component_hours_machine_id_component_id_component_label_key UNIQUE (machine_id, component_id, component_label);


--
-- Name: component_hours component_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_hours
    ADD CONSTRAINT component_hours_pkey PRIMARY KEY (id);


--
-- Name: components components_model_part_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_model_part_number_key UNIQUE (model, part_number);


--
-- Name: components components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_pkey PRIMARY KEY (component_id);


--
-- Name: consumable_item consumable_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_item
    ADD CONSTRAINT consumable_item_pkey PRIMARY KEY (id);


--
-- Name: consumable_stock consumable_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_stock
    ADD CONSTRAINT consumable_stock_pkey PRIMARY KEY (id);


--
-- Name: consumable_ticket consumable_ticket_cis_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_ticket
    ADD CONSTRAINT consumable_ticket_cis_no_key UNIQUE (cis_no);


--
-- Name: consumable_ticket consumable_ticket_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_ticket
    ADD CONSTRAINT consumable_ticket_pkey PRIMARY KEY (id);


--
-- Name: customers customers_name_site_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_name_site_name_key UNIQUE (name, site_name);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: log_timesheet_sap log_timesheet_sap_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.log_timesheet_sap
    ADD CONSTRAINT log_timesheet_sap_pkey PRIMARY KEY (id);


--
-- Name: mch_machines mch_machines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mch_machines
    ADD CONSTRAINT mch_machines_pkey PRIMARY KEY (machineno);


--
-- Name: mch_statustypes mch_statustypes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mch_statustypes
    ADD CONSTRAINT mch_statustypes_pkey PRIMARY KEY (statusid);


--
-- Name: operations operations_part_id_operation_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_part_id_operation_no_key UNIQUE (part_id, operation_no);


--
-- Name: operations operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_pkey PRIMARY KEY (operation_id);


--
-- Name: packing_types packing_types_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_types
    ADD CONSTRAINT packing_types_name_key UNIQUE (name);


--
-- Name: packing_types packing_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_types
    ADD CONSTRAINT packing_types_pkey PRIMARY KEY (id);


--
-- Name: part_categories part_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_categories
    ADD CONSTRAINT part_categories_name_key UNIQUE (name);


--
-- Name: part_categories part_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_categories
    ADD CONSTRAINT part_categories_pkey PRIMARY KEY (id);


--
-- Name: parts parts_partnumber_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_partnumber_key UNIQUE (partnumber);


--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (part_id);


--
-- Name: ph3_order ph3_order_confirmation_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ph3_order
    ADD CONSTRAINT ph3_order_confirmation_number_key UNIQUE (confirmation_number);


--
-- Name: ph3_order ph3_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ph3_order
    ADD CONSTRAINT ph3_order_pkey PRIMARY KEY (id);


--
-- Name: process_category process_category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_category
    ADD CONSTRAINT process_category_pkey PRIMARY KEY (id_process);


--
-- Name: process_parameter_choicebase process_parameter_choicebase_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_parameter_choicebase
    ADD CONSTRAINT process_parameter_choicebase_pkey PRIMARY KEY (id_choice);


--
-- Name: process_parameter process_parameter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_parameter
    ADD CONSTRAINT process_parameter_pkey PRIMARY KEY (id_parameter);


--
-- Name: processcontroldata_item processcontroldata_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT processcontroldata_item_pkey PRIMARY KEY (id_processcontroldata_item);


--
-- Name: processcontroldata processcontroldata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processcontroldata
    ADD CONSTRAINT processcontroldata_pkey PRIMARY KEY (id_processcontroldata);


--
-- Name: production_operations production_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_operations
    ADD CONSTRAINT production_operations_pkey PRIMARY KEY (id);


--
-- Name: progress_update_history progress_update_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_update_history
    ADD CONSTRAINT progress_update_history_pkey PRIMARY KEY (id);


--
-- Name: qh3_order qh3_order_confirmation_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qh3_order
    ADD CONSTRAINT qh3_order_confirmation_number_key UNIQUE (confirmation_number);


--
-- Name: qh3_order qh3_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qh3_order
    ADD CONSTRAINT qh3_order_pkey PRIMARY KEY (id);


--
-- Name: receiving_components receiving_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_pkey PRIMARY KEY (id);


--
-- Name: receiving_orders receiving_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_pkey PRIMARY KEY (id);


--
-- Name: receiving_orders receiving_orders_ssbr_ident_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_ssbr_ident_key UNIQUE (ssbr_ident);


--
-- Name: shipping_records shipping_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_pkey PRIMARY KEY (id);


--
-- Name: shipping_records shipping_records_receiving_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_receiving_order_id_key UNIQUE (receiving_order_id);


--
-- Name: sow sow_codenumber_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_codenumber_uniq UNIQUE (codenumber);


--
-- Name: sow sow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_pkey PRIMARY KEY (idsow);


--
-- Name: sow_revision_history sow_revision_history_order_no_revision_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_revision_history
    ADD CONSTRAINT sow_revision_history_order_no_revision_no_key UNIQUE (order_no, revision_no);


--
-- Name: sow_revision_history sow_revision_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_revision_history
    ADD CONSTRAINT sow_revision_history_pkey PRIMARY KEY (id);


--
-- Name: sow_standard_attachments sow_standard_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_standard_attachments
    ADD CONSTRAINT sow_standard_attachments_pkey PRIMARY KEY (id);


--
-- Name: sow_standard sow_standard_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT sow_standard_pkey PRIMARY KEY (id);


--
-- Name: sow_template_lines sow_template_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_pkey PRIMARY KEY (id);


--
-- Name: sow_templates sow_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT sow_templates_pkey PRIMARY KEY (template_id);


--
-- Name: timesheet_transaction timesheet_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timesheet_transaction
    ADD CONSTRAINT timesheet_transaction_pkey PRIMARY KEY (tsnumber);


--
-- Name: sow uq_sow_order_operation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT uq_sow_order_operation UNIQUE (order_no, operation_no);


--
-- Name: usernfc usernfc_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usernfc
    ADD CONSTRAINT usernfc_pkey PRIMARY KEY (idrow);


--
-- Name: usernfc usernfc_snssb_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usernfc
    ADD CONSTRAINT usernfc_snssb_unique UNIQUE (snssb);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: workcenter workcenter_machineid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT workcenter_machineid_unique UNIQUE (machineid);


--
-- Name: workcenter workcenter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT workcenter_pkey PRIMARY KEY (idrow);


--
-- Name: idx_buffer_transaction_box_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_box_priority ON public.buffer_transaction USING btree (machine_id, type, priority, created_at DESC);


--
-- Name: idx_buffer_transaction_component; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_component ON public.buffer_transaction USING btree (component_id);


--
-- Name: idx_buffer_transaction_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_history ON public.buffer_transaction USING btree (order_no, operation_no, created_at DESC);


--
-- Name: idx_buffer_transaction_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_latest ON public.buffer_transaction USING btree (machine_id, order_no, operation_no, created_at DESC, id DESC);


--
-- Name: idx_buffer_transaction_machine_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_machine_time ON public.buffer_transaction USING btree (machine_id, "timestamp" DESC);


--
-- Name: idx_buffer_transaction_order_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_order_operation ON public.buffer_transaction USING btree (machine_id, order_no, operation_no, created_at DESC);


--
-- Name: idx_component_hours_machine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_component_hours_machine ON public.component_hours USING btree (machine_id, total_hours DESC);


--
-- Name: idx_consumable_item_cis_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_item_cis_no ON public.consumable_item USING btree (cis_no);


--
-- Name: idx_consumable_item_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_item_status ON public.consumable_item USING btree (status);


--
-- Name: idx_consumable_stock_code_mm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_stock_code_mm ON public.consumable_stock USING btree (code_mm);


--
-- Name: idx_consumable_stock_description_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_stock_description_trgm ON public.consumable_stock USING gin (material_description public.gin_trgm_ops);


--
-- Name: idx_consumable_stock_material_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_stock_material_code ON public.consumable_stock USING btree (material_code);


--
-- Name: idx_consumable_ticket_sn_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_ticket_sn_created ON public.consumable_ticket USING btree (sn_karyawan, created DESC);


--
-- Name: idx_customers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_name ON public.customers USING btree (name);


--
-- Name: idx_customers_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_site ON public.customers USING btree (site_name);


--
-- Name: idx_operations_drawing_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operations_drawing_path ON public.operations USING btree (drawing_path);


--
-- Name: idx_operations_part_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operations_part_id ON public.operations USING btree (part_id);


--
-- Name: idx_parts_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_model ON public.parts USING btree (model);


--
-- Name: idx_parts_partname; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_partname ON public.parts USING btree (partname);


--
-- Name: idx_parts_partnumber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_partnumber ON public.parts USING btree (partnumber);


--
-- Name: idx_pcd_operation_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcd_operation_no ON public.processcontroldata USING btree (operation_no);


--
-- Name: idx_pcd_production_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcd_production_order ON public.processcontroldata USING btree (production_order);


--
-- Name: idx_pcd_snssb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcd_snssb ON public.processcontroldata USING btree (snssb);


--
-- Name: idx_pcd_tsnumber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcd_tsnumber ON public.processcontroldata USING btree (tsnumber);


--
-- Name: idx_pcdi_id_parameter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcdi_id_parameter ON public.processcontroldata_item USING btree (id_parameter);


--
-- Name: idx_pcdi_id_processcontroldata; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcdi_id_processcontroldata ON public.processcontroldata_item USING btree (id_processcontroldata);


--
-- Name: idx_ph3_order_order_description; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ph3_order_order_description ON public.ph3_order USING btree (order_no, order_description);


--
-- Name: idx_pp_id_process; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_id_process ON public.process_parameter USING btree (id_process);


--
-- Name: idx_ppcb_id_parameter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppcb_id_parameter ON public.process_parameter_choicebase USING btree (id_parameter);


--
-- Name: idx_prodops_order_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prodops_order_operation ON public.production_operations USING btree (order_number, operation_number);


--
-- Name: idx_puh_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_puh_created_at ON public.progress_update_history USING btree (created_at DESC);


--
-- Name: idx_puh_operation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_puh_operation_id ON public.progress_update_history USING btree (operation_id);


--
-- Name: idx_rc_component_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_component_id ON public.receiving_components USING btree (component_id);


--
-- Name: idx_rc_model_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_model_code ON public.receiving_components USING btree (model_code);


--
-- Name: idx_rc_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_order ON public.receiving_components USING btree (receiving_order_id);


--
-- Name: idx_rc_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_parent ON public.receiving_components USING btree (parent_component_id);


--
-- Name: idx_rc_prod_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_prod_order ON public.receiving_components USING btree (production_order);


--
-- Name: idx_ro_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ro_customer_id ON public.receiving_orders USING btree (customer_id);


--
-- Name: idx_ro_received_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ro_received_by ON public.receiving_orders USING btree (received_by_id);


--
-- Name: idx_ro_received_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ro_received_date ON public.receiving_orders USING btree (received_date);


--
-- Name: idx_ro_ssbr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ro_ssbr ON public.receiving_orders USING btree (ssbr_ident);


--
-- Name: idx_sow_codenumber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_codenumber ON public.sow USING btree (codenumber);


--
-- Name: idx_sow_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_model ON public.sow USING btree (model);


--
-- Name: idx_sow_order_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_order_no ON public.sow USING btree (order_no);


--
-- Name: idx_sow_part_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_part_name_trgm ON public.sow USING gin (part_name public.gin_trgm_ops);


--
-- Name: idx_sow_part_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_part_number ON public.sow USING btree (part_number);


--
-- Name: idx_sow_revision_history_order_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_revision_history_order_created ON public.sow_revision_history USING btree (order_no, created_at DESC);


--
-- Name: idx_sow_ssbr_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_ssbr_id ON public.sow USING btree (ssbr_id);


--
-- Name: idx_sow_standard_component_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_standard_component_id ON public.sow_standard USING btree (component_id);


--
-- Name: idx_sow_standard_source_plant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_standard_source_plant ON public.sow_standard USING btree (source_plant);


--
-- Name: idx_sow_std_attach_standard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_std_attach_standard_id ON public.sow_standard_attachments USING btree (standard_id);


--
-- Name: idx_sow_sync_modified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_sync_modified ON public.sow USING btree (order_no, operation_no) WHERE (sync = 'modified'::text);


--
-- Name: idx_sow_tmpl_lines_standard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_tmpl_lines_standard_id ON public.sow_template_lines USING btree (standard_id);


--
-- Name: idx_sow_tmpl_lines_template_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_tmpl_lines_template_id ON public.sow_template_lines USING btree (template_id);


--
-- Name: idx_sow_workcenter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_workcenter ON public.sow USING btree (workcenter);


--
-- Name: idx_sr_delivery_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_delivery_date ON public.shipping_records USING btree (delivery_date);


--
-- Name: idx_sr_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_order ON public.shipping_records USING btree (receiving_order_id);


--
-- Name: idx_sr_send_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_send_by ON public.shipping_records USING btree (send_by_id);


--
-- Name: idx_timesheet_modified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_timesheet_modified ON public.timesheet_transaction USING btree (modified_at);


--
-- Name: idx_ts_component_tracking_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_component_tracking_active ON public.timesheet_transaction USING btree (workcentercode, longdate_checkout, longdate_checkin DESC) WHERE (longdate_checkin IS NOT NULL);


--
-- Name: idx_ts_component_tracking_productive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_component_tracking_productive ON public.timesheet_transaction USING btree (workcentercode, order_no, operation_no, longdate_checkin) WHERE ((activitytype IS NULL) AND (longdate_checkin IS NOT NULL));


--
-- Name: idx_ts_full_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_full_name_trgm ON public.timesheet_transaction USING gin (full_name public.gin_trgm_ops);


--
-- Name: idx_ts_longdate_checkin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_longdate_checkin ON public.timesheet_transaction USING btree (longdate_checkin);


--
-- Name: idx_ts_longdate_checkout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_longdate_checkout ON public.timesheet_transaction USING btree (longdate_checkout);


--
-- Name: idx_ts_operation_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_operation_no ON public.timesheet_transaction USING btree (operation_no);


--
-- Name: idx_ts_order_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_order_no ON public.timesheet_transaction USING btree (order_no);


--
-- Name: idx_ts_order_no_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_order_no_trgm ON public.timesheet_transaction USING gin (order_no public.gin_trgm_ops);


--
-- Name: idx_ts_order_wc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_order_wc ON public.timesheet_transaction USING btree (order_no, workcentercode);


--
-- Name: idx_ts_serial_checkin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_serial_checkin ON public.timesheet_transaction USING btree (serialnumber, longdate_checkin);


--
-- Name: idx_ts_serialnumber_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_serialnumber_trgm ON public.timesheet_transaction USING gin (serialnumber public.gin_trgm_ops);


--
-- Name: idx_ts_state_flag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_state_flag ON public.timesheet_transaction USING btree (state_flag);


--
-- Name: idx_ts_validation_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_validation_date ON public.timesheet_transaction USING btree (validation_date);


--
-- Name: idx_ts_workcentercode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_workcentercode ON public.timesheet_transaction USING btree (workcentercode);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: uq_usernfc_nfcid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_usernfc_nfcid ON public.usernfc USING btree (nfcid);


--
-- Name: sow before_update_set_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER before_update_set_sync BEFORE UPDATE ON public.sow FOR EACH ROW EXECUTE FUNCTION public.trg_set_sync_modified();


--
-- Name: sow trg_delete_dup_sow; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_delete_dup_sow AFTER INSERT ON public.sow FOR EACH ROW EXECUTE FUNCTION public.fn_delete_dup_sow();


--
-- Name: timesheet_transaction trg_set_modified_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_modified_at BEFORE UPDATE ON public.timesheet_transaction FOR EACH ROW EXECUTE FUNCTION public.set_modified_at();


--
-- Name: operations update_operations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_operations_updated_at BEFORE UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: parts update_parts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_parts_updated_at BEFORE UPDATE ON public.parts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: buffer_transaction buffer_transaction_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buffer_transaction
    ADD CONSTRAINT buffer_transaction_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id) ON DELETE SET NULL;


--
-- Name: component_hours component_hours_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_hours
    ADD CONSTRAINT component_hours_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id) ON DELETE SET NULL;


--
-- Name: process_parameter_choicebase fk_choice_parameter; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_parameter_choicebase
    ADD CONSTRAINT fk_choice_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE CASCADE;


--
-- Name: consumable_item fk_consumable_item_ticket; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_item
    ADD CONSTRAINT fk_consumable_item_ticket FOREIGN KEY (cis_no) REFERENCES public.consumable_ticket(cis_no) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: consumable_ticket fk_consumable_ticket_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_ticket
    ADD CONSTRAINT fk_consumable_ticket_user FOREIGN KEY (sn_karyawan) REFERENCES public.usernfc(snssb) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: processcontroldata_item fk_item_parameter; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT fk_item_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE SET NULL;


--
-- Name: processcontroldata_item fk_item_processcontroldata; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT fk_item_processcontroldata FOREIGN KEY (id_processcontroldata) REFERENCES public.processcontroldata(id_processcontroldata) ON DELETE CASCADE;


--
-- Name: operations fk_operations_part; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT fk_operations_part FOREIGN KEY (part_id) REFERENCES public.parts(part_id) ON DELETE CASCADE;


--
-- Name: processcontroldata fk_pcd_timesheet; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processcontroldata
    ADD CONSTRAINT fk_pcd_timesheet FOREIGN KEY (tsnumber) REFERENCES public.timesheet_transaction(tsnumber) ON DELETE SET NULL;


--
-- Name: process_parameter fk_pp_process_category; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_parameter
    ADD CONSTRAINT fk_pp_process_category FOREIGN KEY (id_process) REFERENCES public.process_category(id_process) ON DELETE CASCADE;


--
-- Name: progress_update_history fk_puh_sow_operation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_update_history
    ADD CONSTRAINT fk_puh_sow_operation FOREIGN KEY (operation_id) REFERENCES public.sow(idsow) ON DELETE CASCADE;


--
-- Name: timesheet_transaction fk_timesheet_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timesheet_transaction
    ADD CONSTRAINT fk_timesheet_user FOREIGN KEY (serialnumber) REFERENCES public.usernfc(snssb) ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;


--
-- Name: receiving_components receiving_components_parent_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_parent_component_id_fkey FOREIGN KEY (parent_component_id) REFERENCES public.receiving_components(id) ON DELETE SET NULL;


--
-- Name: receiving_components receiving_components_part_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_part_category_id_fkey FOREIGN KEY (part_category_id) REFERENCES public.part_categories(id) ON DELETE SET NULL;


--
-- Name: receiving_components receiving_components_receiving_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_receiving_order_id_fkey FOREIGN KEY (receiving_order_id) REFERENCES public.receiving_orders(id) ON DELETE CASCADE;


--
-- Name: receiving_orders receiving_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;


--
-- Name: receiving_orders receiving_orders_packing_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_packing_type_id_fkey FOREIGN KEY (packing_type_id) REFERENCES public.packing_types(id) ON DELETE SET NULL;


--
-- Name: receiving_orders receiving_orders_received_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_received_by_id_fkey FOREIGN KEY (received_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: shipping_records shipping_records_receiving_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_receiving_order_id_fkey FOREIGN KEY (receiving_order_id) REFERENCES public.receiving_orders(id) ON DELETE RESTRICT;


--
-- Name: shipping_records shipping_records_send_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_send_by_id_fkey FOREIGN KEY (send_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sow_standard_attachments sow_standard_attachments_standard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_standard_attachments
    ADD CONSTRAINT sow_standard_attachments_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id) ON DELETE CASCADE;


--
-- Name: sow_standard sow_standard_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT sow_standard_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id);


--
-- Name: sow_template_lines sow_template_lines_standard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id);


--
-- Name: sow_template_lines sow_template_lines_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.sow_templates(template_id);


--
-- Name: sow_templates sow_templates_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT sow_templates_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id);


--
-- PostgreSQL database dump complete
--

