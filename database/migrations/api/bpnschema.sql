--
-- PostgreSQL database dump
--

-- Dumped from database version 15.15
-- Dumped by pg_dump version 15.0

-- Started on 2026-05-11 03:30:58

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

--
-- TOC entry 2 (class 3079 OID 42310)
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- TOC entry 3942 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- TOC entry 336 (class 1255 OID 42391)
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
-- TOC entry 338 (class 1255 OID 42677)
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
-- TOC entry 337 (class 1255 OID 42392)
-- Name: trg_set_sync_modified(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_set_sync_modified() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    old_data jsonb;
    new_data jsonb;
BEGIN
    IF NEW.sync IS DISTINCT FROM OLD.sync THEN RETURN NEW; END IF;
    old_data := to_jsonb(OLD) - 'sync';
    new_data := to_jsonb(NEW) - 'sync';
    IF old_data IS DISTINCT FROM new_data THEN
        NEW.sync := 'modified';
    END IF;
    RETURN NEW;
END;
$$;


--
-- TOC entry 293 (class 1255 OID 16802)
-- Name: update_modified_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_modified_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$;


--
-- TOC entry 339 (class 1255 OID 59414)
-- Name: update_nnva_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_nnva_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- TOC entry 292 (class 1255 OID 16521)
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
-- TOC entry 268 (class 1259 OID 50961)
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
-- TOC entry 271 (class 1259 OID 50979)
-- Name: buffer_transaction_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.buffer_transaction_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3943 (class 0 OID 0)
-- Dependencies: 271
-- Name: buffer_transaction_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.buffer_transaction_id_seq OWNED BY public.buffer_transaction.id;


--
-- TOC entry 269 (class 1259 OID 50971)
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
-- TOC entry 270 (class 1259 OID 50978)
-- Name: component_hours_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.component_hours_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3944 (class 0 OID 0)
-- Dependencies: 270
-- Name: component_hours_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.component_hours_id_seq OWNED BY public.component_hours.id;


--
-- TOC entry 237 (class 1259 OID 42393)
-- Name: components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.components (
    component_id bigint NOT NULL,
    part_name text NOT NULL,
    model text NOT NULL,
    part_number text NOT NULL
);


--
-- TOC entry 238 (class 1259 OID 42398)
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
-- TOC entry 272 (class 1259 OID 50980)
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
-- TOC entry 273 (class 1259 OID 50988)
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
-- TOC entry 274 (class 1259 OID 50989)
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
-- TOC entry 275 (class 1259 OID 50995)
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
-- TOC entry 276 (class 1259 OID 50996)
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
-- TOC entry 277 (class 1259 OID 51003)
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
-- TOC entry 265 (class 1259 OID 50928)
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    name character varying(200),
    site_name character varying(200),
    site_location character varying(300),
    contact_person character varying(100),
    phone character varying(20),
    email character varying(100),
    address text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- TOC entry 278 (class 1259 OID 51004)
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
-- TOC entry 239 (class 1259 OID 42403)
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
-- TOC entry 240 (class 1259 OID 42409)
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
-- TOC entry 261 (class 1259 OID 50906)
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
-- TOC entry 260 (class 1259 OID 50903)
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
-- TOC entry 259 (class 1259 OID 50898)
-- Name: mch_statustypes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mch_statustypes (
    statusid integer NOT NULL,
    mainstatusid integer,
    description character varying(100),
    activitytype character varying(10)
);


--
-- TOC entry 220 (class 1259 OID 16407)
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
-- TOC entry 219 (class 1259 OID 16406)
-- Name: operations_operation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.operations ALTER COLUMN operation_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.operations_operation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 216 (class 1259 OID 16386)
-- Name: sow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sow (
    idsow integer NOT NULL,
    order_no text,
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
    codenumber text GENERATED ALWAYS AS ((order_no || (operation_no)::text)) STORED,
    weight numeric(5,2),
    created_by text,
    type text,
    "group" text,
    category text,
    remark text,
    sync text DEFAULT 'new'::text,
    plan_start date,
    plan_finish date,
    actual_start date,
    actual_finish date,
    actual_progress numeric(5,2),
    actual_hours numeric(10,2),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    progress integer,
    CONSTRAINT chk_sow_actual_progress CHECK (((actual_progress IS NULL) OR ((actual_progress >= (0)::numeric) AND (actual_progress <= (100)::numeric)))),
    CONSTRAINT chk_sow_progress CHECK (((progress IS NULL) OR ((progress >= 0) AND (progress <= 100))))
);


--
-- TOC entry 258 (class 1259 OID 42653)
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
-- TOC entry 266 (class 1259 OID 50933)
-- Name: packing_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.packing_types (
    id integer NOT NULL,
    name character varying(100)
);


--
-- TOC entry 279 (class 1259 OID 51005)
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
-- TOC entry 267 (class 1259 OID 50936)
-- Name: part_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_categories (
    id integer NOT NULL,
    name character varying(100)
);


--
-- TOC entry 280 (class 1259 OID 51006)
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
-- TOC entry 218 (class 1259 OID 16395)
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
-- TOC entry 217 (class 1259 OID 16394)
-- Name: parts_part_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.parts ALTER COLUMN part_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.parts_part_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 241 (class 1259 OID 42412)
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
-- TOC entry 242 (class 1259 OID 42419)
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
-- TOC entry 228 (class 1259 OID 16441)
-- Name: process_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_category (
    id_process integer NOT NULL,
    process_name text NOT NULL,
    description text
);


--
-- TOC entry 227 (class 1259 OID 16440)
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
-- TOC entry 230 (class 1259 OID 16449)
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
-- TOC entry 232 (class 1259 OID 16459)
-- Name: process_parameter_choicebase; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_parameter_choicebase (
    id_choice integer NOT NULL,
    choice_name text NOT NULL,
    description text,
    id_parameter integer NOT NULL
);


--
-- TOC entry 231 (class 1259 OID 16458)
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
-- TOC entry 229 (class 1259 OID 16448)
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
-- TOC entry 234 (class 1259 OID 16467)
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
-- TOC entry 233 (class 1259 OID 16466)
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
-- TOC entry 236 (class 1259 OID 16476)
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
-- TOC entry 235 (class 1259 OID 16475)
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
-- TOC entry 243 (class 1259 OID 42424)
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
-- TOC entry 244 (class 1259 OID 42429)
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
-- TOC entry 245 (class 1259 OID 42432)
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
-- TOC entry 246 (class 1259 OID 42439)
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
-- TOC entry 3945 (class 0 OID 0)
-- Dependencies: 246
-- Name: progress_update_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.progress_update_history_id_seq OWNED BY public.progress_update_history.id;


--
-- TOC entry 247 (class 1259 OID 42443)
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
-- TOC entry 248 (class 1259 OID 42450)
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
-- TOC entry 262 (class 1259 OID 50913)
-- Name: receiving_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receiving_components (
    id integer NOT NULL,
    receiving_order_id integer NOT NULL,
    parent_component_id integer,
    part_level smallint NOT NULL,
    part_number character varying(100),
    part_description character varying(300),
    model_code character varying(50),
    part_type character varying(10),
    part_category_id integer,
    production_order character varying(100),
    actual_component character varying(100),
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    component_id bigint
);


--
-- TOC entry 281 (class 1259 OID 51007)
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
-- TOC entry 263 (class 1259 OID 50918)
-- Name: receiving_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receiving_orders (
    id integer NOT NULL,
    ssbr_ident character varying(50),
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
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- TOC entry 282 (class 1259 OID 51008)
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
-- TOC entry 264 (class 1259 OID 50923)
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
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- TOC entry 283 (class 1259 OID 51009)
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
-- TOC entry 215 (class 1259 OID 16385)
-- Name: sow_idsow_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sow ALTER COLUMN idsow ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_idsow_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 289 (class 1259 OID 59380)
-- Name: sow_nnva_base; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sow_nnva_base (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- TOC entry 288 (class 1259 OID 59379)
-- Name: sow_nnva_base_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sow_nnva_base_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3946 (class 0 OID 0)
-- Dependencies: 288
-- Name: sow_nnva_base_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sow_nnva_base_id_seq OWNED BY public.sow_nnva_base.id;


--
-- TOC entry 291 (class 1259 OID 59391)
-- Name: sow_nnva_standard; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sow_nnva_standard (
    id integer NOT NULL,
    sow_standard_id integer NOT NULL,
    nnva_base_id integer NOT NULL,
    standard_hours numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- TOC entry 290 (class 1259 OID 59390)
-- Name: sow_nnva_standard_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sow_nnva_standard_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3947 (class 0 OID 0)
-- Dependencies: 290
-- Name: sow_nnva_standard_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sow_nnva_standard_id_seq OWNED BY public.sow_nnva_standard.id;


--
-- TOC entry 284 (class 1259 OID 51011)
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
-- TOC entry 285 (class 1259 OID 51018)
-- Name: sow_revision_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sow_revision_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3948 (class 0 OID 0)
-- Dependencies: 285
-- Name: sow_revision_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sow_revision_history_id_seq OWNED BY public.sow_revision_history.id;


--
-- TOC entry 249 (class 1259 OID 42455)
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
-- TOC entry 251 (class 1259 OID 42463)
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
-- TOC entry 252 (class 1259 OID 42469)
-- Name: sow_standard_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sow_standard_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3949 (class 0 OID 0)
-- Dependencies: 252
-- Name: sow_standard_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sow_standard_attachments_id_seq OWNED BY public.sow_standard_attachments.id;


--
-- TOC entry 250 (class 1259 OID 42460)
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
-- TOC entry 253 (class 1259 OID 42473)
-- Name: sow_template_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sow_template_lines (
    id bigint NOT NULL,
    template_id bigint NOT NULL,
    standard_id bigint NOT NULL
);


--
-- TOC entry 254 (class 1259 OID 42476)
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
-- TOC entry 255 (class 1259 OID 42479)
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
-- TOC entry 256 (class 1259 OID 42485)
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
-- TOC entry 222 (class 1259 OID 16419)
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
    full_name text,
    hour_checkin text,
    hour_checkout text,
    longdate_checkin timestamp with time zone,
    longdate_checkout timestamp with time zone,
    note text,
    part_name text,
    planhours numeric(10,2),
    plant text,
    serialnumber text,
    state_flag smallint DEFAULT 1,
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
-- TOC entry 221 (class 1259 OID 16418)
-- Name: timesheet_transaction_tsnumber_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.timesheet_transaction ALTER COLUMN tsnumber ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.timesheet_transaction_tsnumber_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 224 (class 1259 OID 16427)
-- Name: usernfc; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usernfc (
    idrow integer NOT NULL,
    nfcid text,
    full_name text,
    snssb text,
    machineid text,
    machinename text,
    workcenter text,
    roles text,
    mode character varying(10) DEFAULT 'single'::character varying
);


--
-- TOC entry 223 (class 1259 OID 16426)
-- Name: usernfc_idrow_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.usernfc ALTER COLUMN idrow ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.usernfc_idrow_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 286 (class 1259 OID 51019)
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
-- TOC entry 287 (class 1259 OID 51026)
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
-- TOC entry 257 (class 1259 OID 42648)
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
-- TOC entry 226 (class 1259 OID 16435)
-- Name: workcenter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workcenter (
    idrow integer NOT NULL,
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
    workcenterold character varying(50)
);


--
-- TOC entry 225 (class 1259 OID 16434)
-- Name: workcenter_idrow_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.workcenter ALTER COLUMN idrow ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.workcenter_idrow_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 3535 (class 2604 OID 51028)
-- Name: buffer_transaction id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buffer_transaction ALTER COLUMN id SET DEFAULT nextval('public.buffer_transaction_id_seq'::regclass);


--
-- TOC entry 3540 (class 2604 OID 51029)
-- Name: component_hours id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_hours ALTER COLUMN id SET DEFAULT nextval('public.component_hours_id_seq'::regclass);


--
-- TOC entry 3528 (class 2604 OID 51030)
-- Name: progress_update_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_update_history ALTER COLUMN id SET DEFAULT nextval('public.progress_update_history_id_seq'::regclass);


--
-- TOC entry 3553 (class 2604 OID 59383)
-- Name: sow_nnva_base id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_nnva_base ALTER COLUMN id SET DEFAULT nextval('public.sow_nnva_base_id_seq'::regclass);


--
-- TOC entry 3556 (class 2604 OID 59394)
-- Name: sow_nnva_standard id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_nnva_standard ALTER COLUMN id SET DEFAULT nextval('public.sow_nnva_standard_id_seq'::regclass);


--
-- TOC entry 3548 (class 2604 OID 51031)
-- Name: sow_revision_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_revision_history ALTER COLUMN id SET DEFAULT nextval('public.sow_revision_history_id_seq'::regclass);


--
-- TOC entry 3532 (class 2604 OID 51032)
-- Name: sow_standard_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_standard_attachments ALTER COLUMN id SET DEFAULT nextval('public.sow_standard_attachments_id_seq'::regclass);


--
-- TOC entry 3714 (class 2606 OID 51034)
-- Name: buffer_transaction buffer_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buffer_transaction
    ADD CONSTRAINT buffer_transaction_pkey PRIMARY KEY (id);


--
-- TOC entry 3722 (class 2606 OID 51036)
-- Name: component_hours component_hours_machine_id_component_id_component_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_hours
    ADD CONSTRAINT component_hours_machine_id_component_id_component_label_key UNIQUE (machine_id, component_id, component_label);


--
-- TOC entry 3724 (class 2606 OID 51038)
-- Name: component_hours component_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_hours
    ADD CONSTRAINT component_hours_pkey PRIMARY KEY (id);


--
-- TOC entry 3638 (class 2606 OID 42402)
-- Name: components components_model_part_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_model_part_number_key UNIQUE (model, part_number);


--
-- TOC entry 3640 (class 2606 OID 42400)
-- Name: components components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_pkey PRIMARY KEY (component_id);


--
-- TOC entry 3727 (class 2606 OID 51040)
-- Name: consumable_item consumable_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_item
    ADD CONSTRAINT consumable_item_pkey PRIMARY KEY (id);


--
-- TOC entry 3731 (class 2606 OID 51042)
-- Name: consumable_stock consumable_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_stock
    ADD CONSTRAINT consumable_stock_pkey PRIMARY KEY (id);


--
-- TOC entry 3736 (class 2606 OID 51044)
-- Name: consumable_ticket consumable_ticket_cis_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_ticket
    ADD CONSTRAINT consumable_ticket_cis_no_key UNIQUE (cis_no);


--
-- TOC entry 3738 (class 2606 OID 51046)
-- Name: consumable_ticket consumable_ticket_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_ticket
    ADD CONSTRAINT consumable_ticket_pkey PRIMARY KEY (id);


--
-- TOC entry 3700 (class 2606 OID 51048)
-- Name: customers customers_name_site_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_name_site_name_key UNIQUE (name, site_name);


--
-- TOC entry 3702 (class 2606 OID 51050)
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- TOC entry 3642 (class 2606 OID 42411)
-- Name: log_timesheet_sap log_timesheet_sap_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.log_timesheet_sap
    ADD CONSTRAINT log_timesheet_sap_pkey PRIMARY KEY (id);


--
-- TOC entry 3676 (class 2606 OID 50912)
-- Name: mch_machines mch_machines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mch_machines
    ADD CONSTRAINT mch_machines_pkey PRIMARY KEY (machineno);


--
-- TOC entry 3674 (class 2606 OID 50902)
-- Name: mch_statustypes mch_statustypes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mch_statustypes
    ADD CONSTRAINT mch_statustypes_pkey PRIMARY KEY (statusid);


--
-- TOC entry 3589 (class 2606 OID 42489)
-- Name: operations operations_part_id_operation_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_part_id_operation_no_key UNIQUE (part_id, operation_no);


--
-- TOC entry 3591 (class 2606 OID 16415)
-- Name: operations operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_pkey PRIMARY KEY (operation_id);


--
-- TOC entry 3706 (class 2606 OID 51052)
-- Name: packing_types packing_types_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_types
    ADD CONSTRAINT packing_types_name_key UNIQUE (name);


--
-- TOC entry 3708 (class 2606 OID 51054)
-- Name: packing_types packing_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_types
    ADD CONSTRAINT packing_types_pkey PRIMARY KEY (id);


--
-- TOC entry 3710 (class 2606 OID 51056)
-- Name: part_categories part_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_categories
    ADD CONSTRAINT part_categories_name_key UNIQUE (name);


--
-- TOC entry 3712 (class 2606 OID 51058)
-- Name: part_categories part_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_categories
    ADD CONSTRAINT part_categories_pkey PRIMARY KEY (id);


--
-- TOC entry 3583 (class 2606 OID 42491)
-- Name: parts parts_partnumber_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_partnumber_key UNIQUE (partnumber);


--
-- TOC entry 3585 (class 2606 OID 16403)
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (part_id);


--
-- TOC entry 3646 (class 2606 OID 42423)
-- Name: ph3_order ph3_order_confirmation_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ph3_order
    ADD CONSTRAINT ph3_order_confirmation_number_key UNIQUE (confirmation_number);


--
-- TOC entry 3648 (class 2606 OID 42421)
-- Name: ph3_order ph3_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ph3_order
    ADD CONSTRAINT ph3_order_pkey PRIMARY KEY (id);


--
-- TOC entry 3620 (class 2606 OID 16447)
-- Name: process_category process_category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_category
    ADD CONSTRAINT process_category_pkey PRIMARY KEY (id_process);


--
-- TOC entry 3626 (class 2606 OID 16465)
-- Name: process_parameter_choicebase process_parameter_choicebase_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_parameter_choicebase
    ADD CONSTRAINT process_parameter_choicebase_pkey PRIMARY KEY (id_choice);


--
-- TOC entry 3623 (class 2606 OID 16457)
-- Name: process_parameter process_parameter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_parameter
    ADD CONSTRAINT process_parameter_pkey PRIMARY KEY (id_parameter);


--
-- TOC entry 3636 (class 2606 OID 16483)
-- Name: processcontroldata_item processcontroldata_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT processcontroldata_item_pkey PRIMARY KEY (id_processcontroldata_item);


--
-- TOC entry 3632 (class 2606 OID 16474)
-- Name: processcontroldata processcontroldata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processcontroldata
    ADD CONSTRAINT processcontroldata_pkey PRIMARY KEY (id_processcontroldata);


--
-- TOC entry 3651 (class 2606 OID 42431)
-- Name: production_operations production_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_operations
    ADD CONSTRAINT production_operations_pkey PRIMARY KEY (id);


--
-- TOC entry 3655 (class 2606 OID 42442)
-- Name: progress_update_history progress_update_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_update_history
    ADD CONSTRAINT progress_update_history_pkey PRIMARY KEY (id);


--
-- TOC entry 3657 (class 2606 OID 42454)
-- Name: qh3_order qh3_order_confirmation_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qh3_order
    ADD CONSTRAINT qh3_order_confirmation_number_key UNIQUE (confirmation_number);


--
-- TOC entry 3659 (class 2606 OID 42452)
-- Name: qh3_order qh3_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qh3_order
    ADD CONSTRAINT qh3_order_pkey PRIMARY KEY (id);


--
-- TOC entry 3683 (class 2606 OID 51060)
-- Name: receiving_components receiving_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_pkey PRIMARY KEY (id);


--
-- TOC entry 3689 (class 2606 OID 51062)
-- Name: receiving_orders receiving_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_pkey PRIMARY KEY (id);


--
-- TOC entry 3691 (class 2606 OID 51064)
-- Name: receiving_orders receiving_orders_ssbr_ident_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_ssbr_ident_key UNIQUE (ssbr_ident);


--
-- TOC entry 3696 (class 2606 OID 51066)
-- Name: shipping_records shipping_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_pkey PRIMARY KEY (id);


--
-- TOC entry 3698 (class 2606 OID 51068)
-- Name: shipping_records shipping_records_receiving_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_receiving_order_id_key UNIQUE (receiving_order_id);


--
-- TOC entry 3574 (class 2606 OID 42520)
-- Name: sow sow_codenumber_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_codenumber_uniq UNIQUE (codenumber);


--
-- TOC entry 3752 (class 2606 OID 59389)
-- Name: sow_nnva_base sow_nnva_base_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_nnva_base
    ADD CONSTRAINT sow_nnva_base_name_key UNIQUE (name);


--
-- TOC entry 3754 (class 2606 OID 59387)
-- Name: sow_nnva_base sow_nnva_base_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_nnva_base
    ADD CONSTRAINT sow_nnva_base_pkey PRIMARY KEY (id);


--
-- TOC entry 3758 (class 2606 OID 59399)
-- Name: sow_nnva_standard sow_nnva_standard_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_pkey PRIMARY KEY (id);


--
-- TOC entry 3760 (class 2606 OID 59401)
-- Name: sow_nnva_standard sow_nnva_standard_sow_standard_id_nnva_base_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_sow_standard_id_nnva_base_id_key UNIQUE (sow_standard_id, nnva_base_id);


--
-- TOC entry 3576 (class 2606 OID 16393)
-- Name: sow sow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_pkey PRIMARY KEY (idsow);


--
-- TOC entry 3742 (class 2606 OID 51070)
-- Name: sow_revision_history sow_revision_history_order_no_revision_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_revision_history
    ADD CONSTRAINT sow_revision_history_order_no_revision_no_key UNIQUE (order_no, revision_no);


--
-- TOC entry 3744 (class 2606 OID 51072)
-- Name: sow_revision_history sow_revision_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_revision_history
    ADD CONSTRAINT sow_revision_history_pkey PRIMARY KEY (id);


--
-- TOC entry 3666 (class 2606 OID 42472)
-- Name: sow_standard_attachments sow_standard_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_standard_attachments
    ADD CONSTRAINT sow_standard_attachments_pkey PRIMARY KEY (id);


--
-- TOC entry 3663 (class 2606 OID 42462)
-- Name: sow_standard sow_standard_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT sow_standard_pkey PRIMARY KEY (id);


--
-- TOC entry 3670 (class 2606 OID 42478)
-- Name: sow_template_lines sow_template_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_pkey PRIMARY KEY (id);


--
-- TOC entry 3672 (class 2606 OID 42487)
-- Name: sow_templates sow_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT sow_templates_pkey PRIMARY KEY (template_id);


--
-- TOC entry 3609 (class 2606 OID 16425)
-- Name: timesheet_transaction timesheet_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timesheet_transaction
    ADD CONSTRAINT timesheet_transaction_pkey PRIMARY KEY (tsnumber);


--
-- TOC entry 3578 (class 2606 OID 42522)
-- Name: sow uq_sow_order_operation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT uq_sow_order_operation UNIQUE (order_no, operation_no);


--
-- TOC entry 3612 (class 2606 OID 16433)
-- Name: usernfc usernfc_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usernfc
    ADD CONSTRAINT usernfc_pkey PRIMARY KEY (idrow);


--
-- TOC entry 3614 (class 2606 OID 42564)
-- Name: usernfc usernfc_snssb_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usernfc
    ADD CONSTRAINT usernfc_snssb_unique UNIQUE (snssb);


--
-- TOC entry 3748 (class 2606 OID 51074)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 3750 (class 2606 OID 51076)
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- TOC entry 3616 (class 2606 OID 42567)
-- Name: workcenter workcenter_machineid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT workcenter_machineid_unique UNIQUE (machineid);


--
-- TOC entry 3618 (class 2606 OID 16439)
-- Name: workcenter workcenter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT workcenter_pkey PRIMARY KEY (idrow);


--
-- TOC entry 3715 (class 1259 OID 51077)
-- Name: idx_buffer_transaction_box_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_box_priority ON public.buffer_transaction USING btree (machine_id, type, priority, created_at DESC);


--
-- TOC entry 3716 (class 1259 OID 51078)
-- Name: idx_buffer_transaction_component; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_component ON public.buffer_transaction USING btree (component_id);


--
-- TOC entry 3717 (class 1259 OID 51079)
-- Name: idx_buffer_transaction_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_history ON public.buffer_transaction USING btree (order_no, operation_no, created_at DESC);


--
-- TOC entry 3718 (class 1259 OID 51080)
-- Name: idx_buffer_transaction_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_latest ON public.buffer_transaction USING btree (machine_id, order_no, operation_no, created_at DESC, id DESC);


--
-- TOC entry 3719 (class 1259 OID 51081)
-- Name: idx_buffer_transaction_machine_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_machine_time ON public.buffer_transaction USING btree (machine_id, "timestamp" DESC);


--
-- TOC entry 3720 (class 1259 OID 51082)
-- Name: idx_buffer_transaction_order_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buffer_transaction_order_operation ON public.buffer_transaction USING btree (machine_id, order_no, operation_no, created_at DESC);


--
-- TOC entry 3725 (class 1259 OID 51083)
-- Name: idx_component_hours_machine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_component_hours_machine ON public.component_hours USING btree (machine_id, total_hours DESC);


--
-- TOC entry 3728 (class 1259 OID 51084)
-- Name: idx_consumable_item_cis_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_item_cis_no ON public.consumable_item USING btree (cis_no);


--
-- TOC entry 3729 (class 1259 OID 51085)
-- Name: idx_consumable_item_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_item_status ON public.consumable_item USING btree (status);


--
-- TOC entry 3732 (class 1259 OID 51086)
-- Name: idx_consumable_stock_code_mm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_stock_code_mm ON public.consumable_stock USING btree (code_mm);


--
-- TOC entry 3733 (class 1259 OID 51087)
-- Name: idx_consumable_stock_description_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_stock_description_trgm ON public.consumable_stock USING gin (material_description public.gin_trgm_ops);


--
-- TOC entry 3734 (class 1259 OID 51088)
-- Name: idx_consumable_stock_material_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_stock_material_code ON public.consumable_stock USING btree (material_code);


--
-- TOC entry 3739 (class 1259 OID 51089)
-- Name: idx_consumable_ticket_sn_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_ticket_sn_created ON public.consumable_ticket USING btree (sn_karyawan, created DESC);


--
-- TOC entry 3703 (class 1259 OID 51090)
-- Name: idx_customers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_name ON public.customers USING btree (name);


--
-- TOC entry 3704 (class 1259 OID 51091)
-- Name: idx_customers_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_site ON public.customers USING btree (site_name);


--
-- TOC entry 3755 (class 1259 OID 59413)
-- Name: idx_nnva_std_nnva_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nnva_std_nnva_id ON public.sow_nnva_standard USING btree (nnva_base_id);


--
-- TOC entry 3756 (class 1259 OID 59412)
-- Name: idx_nnva_std_sow_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nnva_std_sow_id ON public.sow_nnva_standard USING btree (sow_standard_id);


--
-- TOC entry 3586 (class 1259 OID 16518)
-- Name: idx_operations_drawing_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operations_drawing_path ON public.operations USING btree (drawing_path);


--
-- TOC entry 3587 (class 1259 OID 16517)
-- Name: idx_operations_part_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operations_part_id ON public.operations USING btree (part_id);


--
-- TOC entry 3579 (class 1259 OID 42494)
-- Name: idx_parts_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_model ON public.parts USING btree (model);


--
-- TOC entry 3580 (class 1259 OID 42493)
-- Name: idx_parts_partname; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_partname ON public.parts USING btree (partname);


--
-- TOC entry 3581 (class 1259 OID 42492)
-- Name: idx_parts_partnumber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_partnumber ON public.parts USING btree (partnumber);


--
-- TOC entry 3627 (class 1259 OID 42617)
-- Name: idx_pcd_operation_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcd_operation_no ON public.processcontroldata USING btree (operation_no);


--
-- TOC entry 3628 (class 1259 OID 42618)
-- Name: idx_pcd_production_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcd_production_order ON public.processcontroldata USING btree (production_order);


--
-- TOC entry 3629 (class 1259 OID 42619)
-- Name: idx_pcd_snssb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcd_snssb ON public.processcontroldata USING btree (snssb);


--
-- TOC entry 3630 (class 1259 OID 42620)
-- Name: idx_pcd_tsnumber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcd_tsnumber ON public.processcontroldata USING btree (tsnumber);


--
-- TOC entry 3633 (class 1259 OID 42621)
-- Name: idx_pcdi_id_parameter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcdi_id_parameter ON public.processcontroldata_item USING btree (id_parameter);


--
-- TOC entry 3634 (class 1259 OID 42622)
-- Name: idx_pcdi_id_processcontroldata; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcdi_id_processcontroldata ON public.processcontroldata_item USING btree (id_processcontroldata);


--
-- TOC entry 3643 (class 1259 OID 51092)
-- Name: idx_ph3_order_order_description; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ph3_order_order_description ON public.ph3_order USING btree (order_no, order_description);


--
-- TOC entry 3621 (class 1259 OID 42623)
-- Name: idx_pp_id_process; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_id_process ON public.process_parameter USING btree (id_process);


--
-- TOC entry 3624 (class 1259 OID 42624)
-- Name: idx_ppcb_id_parameter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppcb_id_parameter ON public.process_parameter_choicebase USING btree (id_parameter);


--
-- TOC entry 3649 (class 1259 OID 42625)
-- Name: idx_prodops_order_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prodops_order_operation ON public.production_operations USING btree (order_number, operation_number);


--
-- TOC entry 3652 (class 1259 OID 42626)
-- Name: idx_puh_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_puh_created_at ON public.progress_update_history USING btree (created_at DESC);


--
-- TOC entry 3653 (class 1259 OID 42627)
-- Name: idx_puh_operation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_puh_operation_id ON public.progress_update_history USING btree (operation_id);


--
-- TOC entry 3677 (class 1259 OID 51093)
-- Name: idx_rc_component_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_component_id ON public.receiving_components USING btree (component_id);


--
-- TOC entry 3678 (class 1259 OID 51094)
-- Name: idx_rc_model_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_model_code ON public.receiving_components USING btree (model_code);


--
-- TOC entry 3679 (class 1259 OID 51095)
-- Name: idx_rc_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_order ON public.receiving_components USING btree (receiving_order_id);


--
-- TOC entry 3680 (class 1259 OID 51096)
-- Name: idx_rc_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_parent ON public.receiving_components USING btree (parent_component_id);


--
-- TOC entry 3681 (class 1259 OID 51097)
-- Name: idx_rc_prod_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_prod_order ON public.receiving_components USING btree (production_order);


--
-- TOC entry 3684 (class 1259 OID 51098)
-- Name: idx_ro_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ro_customer_id ON public.receiving_orders USING btree (customer_id);


--
-- TOC entry 3685 (class 1259 OID 51099)
-- Name: idx_ro_received_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ro_received_by ON public.receiving_orders USING btree (received_by_id);


--
-- TOC entry 3686 (class 1259 OID 51100)
-- Name: idx_ro_received_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ro_received_date ON public.receiving_orders USING btree (received_date);


--
-- TOC entry 3687 (class 1259 OID 51101)
-- Name: idx_ro_ssbr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ro_ssbr ON public.receiving_orders USING btree (ssbr_ident);


--
-- TOC entry 3565 (class 1259 OID 42628)
-- Name: idx_sow_codenumber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_codenumber ON public.sow USING btree (codenumber);


--
-- TOC entry 3566 (class 1259 OID 16520)
-- Name: idx_sow_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_model ON public.sow USING btree (model);


--
-- TOC entry 3567 (class 1259 OID 42629)
-- Name: idx_sow_order_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_order_no ON public.sow USING btree (order_no);


--
-- TOC entry 3568 (class 1259 OID 42633)
-- Name: idx_sow_part_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_part_name_trgm ON public.sow USING gin (part_name public.gin_trgm_ops);


--
-- TOC entry 3569 (class 1259 OID 16519)
-- Name: idx_sow_part_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_part_number ON public.sow USING btree (part_number);


--
-- TOC entry 3740 (class 1259 OID 51102)
-- Name: idx_sow_revision_history_order_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_revision_history_order_created ON public.sow_revision_history USING btree (order_no, created_at DESC);


--
-- TOC entry 3570 (class 1259 OID 42630)
-- Name: idx_sow_ssbr_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_ssbr_id ON public.sow USING btree (ssbr_id);


--
-- TOC entry 3660 (class 1259 OID 42635)
-- Name: idx_sow_standard_component_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_standard_component_id ON public.sow_standard USING btree (component_id);


--
-- TOC entry 3661 (class 1259 OID 42636)
-- Name: idx_sow_standard_source_plant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_standard_source_plant ON public.sow_standard USING btree (source_plant);


--
-- TOC entry 3664 (class 1259 OID 42634)
-- Name: idx_sow_std_attach_standard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_std_attach_standard_id ON public.sow_standard_attachments USING btree (standard_id);


--
-- TOC entry 3571 (class 1259 OID 42632)
-- Name: idx_sow_sync_modified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_sync_modified ON public.sow USING btree (order_no, operation_no) WHERE (sync = 'modified'::text);


--
-- TOC entry 3667 (class 1259 OID 42637)
-- Name: idx_sow_tmpl_lines_standard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_tmpl_lines_standard_id ON public.sow_template_lines USING btree (standard_id);


--
-- TOC entry 3668 (class 1259 OID 42638)
-- Name: idx_sow_tmpl_lines_template_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_tmpl_lines_template_id ON public.sow_template_lines USING btree (template_id);


--
-- TOC entry 3572 (class 1259 OID 42631)
-- Name: idx_sow_workcenter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sow_workcenter ON public.sow USING btree (workcenter);


--
-- TOC entry 3692 (class 1259 OID 51103)
-- Name: idx_sr_delivery_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_delivery_date ON public.shipping_records USING btree (delivery_date);


--
-- TOC entry 3693 (class 1259 OID 51104)
-- Name: idx_sr_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_order ON public.shipping_records USING btree (receiving_order_id);


--
-- TOC entry 3694 (class 1259 OID 51105)
-- Name: idx_sr_send_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_send_by ON public.shipping_records USING btree (send_by_id);


--
-- TOC entry 3644 (class 1259 OID 42679)
-- Name: idx_src_etl_plant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_src_etl_plant ON public.ph3_order USING btree (plant_code, status_etl);


--
-- TOC entry 3592 (class 1259 OID 42676)
-- Name: idx_timesheet_modified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_timesheet_modified ON public.timesheet_transaction USING btree (modified_at);


--
-- TOC entry 3593 (class 1259 OID 51106)
-- Name: idx_ts_component_tracking_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_component_tracking_active ON public.timesheet_transaction USING btree (workcentercode, longdate_checkout, longdate_checkin DESC) WHERE (longdate_checkin IS NOT NULL);


--
-- TOC entry 3594 (class 1259 OID 51107)
-- Name: idx_ts_component_tracking_productive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_component_tracking_productive ON public.timesheet_transaction USING btree (workcentercode, order_no, operation_no, longdate_checkin) WHERE ((activitytype IS NULL) AND (longdate_checkin IS NOT NULL));


--
-- TOC entry 3595 (class 1259 OID 42645)
-- Name: idx_ts_full_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_full_name_trgm ON public.timesheet_transaction USING gin (full_name public.gin_trgm_ops);


--
-- TOC entry 3596 (class 1259 OID 16690)
-- Name: idx_ts_longdate_checkin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_longdate_checkin ON public.timesheet_transaction USING btree (longdate_checkin);


--
-- TOC entry 3597 (class 1259 OID 42639)
-- Name: idx_ts_longdate_checkout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_longdate_checkout ON public.timesheet_transaction USING btree (longdate_checkout);


--
-- TOC entry 3598 (class 1259 OID 42640)
-- Name: idx_ts_operation_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_operation_no ON public.timesheet_transaction USING btree (operation_no);


--
-- TOC entry 3599 (class 1259 OID 42641)
-- Name: idx_ts_order_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_order_no ON public.timesheet_transaction USING btree (order_no);


--
-- TOC entry 3600 (class 1259 OID 42646)
-- Name: idx_ts_order_no_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_order_no_trgm ON public.timesheet_transaction USING gin (order_no public.gin_trgm_ops);


--
-- TOC entry 3601 (class 1259 OID 42642)
-- Name: idx_ts_order_wc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_order_wc ON public.timesheet_transaction USING btree (order_no, workcentercode);


--
-- TOC entry 3602 (class 1259 OID 16694)
-- Name: idx_ts_serial_checkin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_serial_checkin ON public.timesheet_transaction USING btree (serialnumber, longdate_checkin);


--
-- TOC entry 3603 (class 1259 OID 16691)
-- Name: idx_ts_serialnumber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_serialnumber ON public.timesheet_transaction USING btree (serialnumber);


--
-- TOC entry 3604 (class 1259 OID 42647)
-- Name: idx_ts_serialnumber_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_serialnumber_trgm ON public.timesheet_transaction USING gin (serialnumber public.gin_trgm_ops);


--
-- TOC entry 3605 (class 1259 OID 42643)
-- Name: idx_ts_state_flag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_state_flag ON public.timesheet_transaction USING btree (state_flag);


--
-- TOC entry 3606 (class 1259 OID 16692)
-- Name: idx_ts_validation_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_validation_date ON public.timesheet_transaction USING btree (validation_date);


--
-- TOC entry 3607 (class 1259 OID 42644)
-- Name: idx_ts_workcentercode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ts_workcentercode ON public.timesheet_transaction USING btree (workcentercode);


--
-- TOC entry 3745 (class 1259 OID 51108)
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- TOC entry 3746 (class 1259 OID 51109)
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- TOC entry 3610 (class 1259 OID 42565)
-- Name: uq_usernfc_nfcid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_usernfc_nfcid ON public.usernfc USING btree (nfcid);


--
-- TOC entry 3786 (class 2620 OID 42570)
-- Name: sow before_update_set_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER before_update_set_sync BEFORE UPDATE ON public.sow FOR EACH ROW EXECUTE FUNCTION public.trg_set_sync_modified();


--
-- TOC entry 3787 (class 2620 OID 42571)
-- Name: sow trg_delete_dup_sow; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_delete_dup_sow AFTER INSERT ON public.sow FOR EACH ROW EXECUTE FUNCTION public.fn_delete_dup_sow();


--
-- TOC entry 3791 (class 2620 OID 59415)
-- Name: sow_nnva_base trg_nnva_base_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_nnva_base_updated_at BEFORE UPDATE ON public.sow_nnva_base FOR EACH ROW EXECUTE FUNCTION public.update_nnva_updated_at();


--
-- TOC entry 3792 (class 2620 OID 59416)
-- Name: sow_nnva_standard trg_nnva_standard_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_nnva_standard_updated_at BEFORE UPDATE ON public.sow_nnva_standard FOR EACH ROW EXECUTE FUNCTION public.update_nnva_updated_at();


--
-- TOC entry 3790 (class 2620 OID 42678)
-- Name: timesheet_transaction trg_set_modified_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_modified_at BEFORE UPDATE ON public.timesheet_transaction FOR EACH ROW EXECUTE FUNCTION public.set_modified_at();


--
-- TOC entry 3789 (class 2620 OID 16523)
-- Name: operations update_operations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_operations_updated_at BEFORE UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 3788 (class 2620 OID 16522)
-- Name: parts update_parts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_parts_updated_at BEFORE UPDATE ON public.parts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 3780 (class 2606 OID 51110)
-- Name: buffer_transaction buffer_transaction_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buffer_transaction
    ADD CONSTRAINT buffer_transaction_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id) ON DELETE SET NULL;


--
-- TOC entry 3781 (class 2606 OID 51115)
-- Name: component_hours component_hours_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_hours
    ADD CONSTRAINT component_hours_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id) ON DELETE SET NULL;


--
-- TOC entry 3764 (class 2606 OID 16494)
-- Name: process_parameter_choicebase fk_choice_parameter; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_parameter_choicebase
    ADD CONSTRAINT fk_choice_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE CASCADE;


--
-- TOC entry 3782 (class 2606 OID 51120)
-- Name: consumable_item fk_consumable_item_ticket; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_item
    ADD CONSTRAINT fk_consumable_item_ticket FOREIGN KEY (cis_no) REFERENCES public.consumable_ticket(cis_no) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 3783 (class 2606 OID 51125)
-- Name: consumable_ticket fk_consumable_ticket_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_ticket
    ADD CONSTRAINT fk_consumable_ticket_user FOREIGN KEY (sn_karyawan) REFERENCES public.usernfc(snssb) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- TOC entry 3766 (class 2606 OID 16504)
-- Name: processcontroldata_item fk_item_parameter; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT fk_item_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE SET NULL;


--
-- TOC entry 3767 (class 2606 OID 16509)
-- Name: processcontroldata_item fk_item_processcontroldata; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT fk_item_processcontroldata FOREIGN KEY (id_processcontroldata) REFERENCES public.processcontroldata(id_processcontroldata) ON DELETE CASCADE;


--
-- TOC entry 3761 (class 2606 OID 16484)
-- Name: operations fk_operations_part; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT fk_operations_part FOREIGN KEY (part_id) REFERENCES public.parts(part_id) ON DELETE CASCADE;


--
-- TOC entry 3765 (class 2606 OID 42572)
-- Name: processcontroldata fk_pcd_timesheet; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processcontroldata
    ADD CONSTRAINT fk_pcd_timesheet FOREIGN KEY (tsnumber) REFERENCES public.timesheet_transaction(tsnumber) ON DELETE SET NULL;


--
-- TOC entry 3763 (class 2606 OID 42577)
-- Name: process_parameter fk_pp_process_category; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_parameter
    ADD CONSTRAINT fk_pp_process_category FOREIGN KEY (id_process) REFERENCES public.process_category(id_process) ON DELETE CASCADE;


--
-- TOC entry 3768 (class 2606 OID 42607)
-- Name: progress_update_history fk_puh_sow_operation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_update_history
    ADD CONSTRAINT fk_puh_sow_operation FOREIGN KEY (operation_id) REFERENCES public.sow(idsow) ON DELETE CASCADE;


--
-- TOC entry 3762 (class 2606 OID 42612)
-- Name: timesheet_transaction fk_timesheet_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timesheet_transaction
    ADD CONSTRAINT fk_timesheet_user FOREIGN KEY (serialnumber) REFERENCES public.usernfc(snssb) ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;


--
-- TOC entry 3774 (class 2606 OID 51130)
-- Name: receiving_components receiving_components_parent_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_parent_component_id_fkey FOREIGN KEY (parent_component_id) REFERENCES public.receiving_components(id) ON DELETE SET NULL;


--
-- TOC entry 3775 (class 2606 OID 51135)
-- Name: receiving_components receiving_components_part_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_part_category_id_fkey FOREIGN KEY (part_category_id) REFERENCES public.part_categories(id) ON DELETE SET NULL;


--
-- TOC entry 3776 (class 2606 OID 51140)
-- Name: receiving_components receiving_components_receiving_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_receiving_order_id_fkey FOREIGN KEY (receiving_order_id) REFERENCES public.receiving_orders(id) ON DELETE CASCADE;


--
-- TOC entry 3777 (class 2606 OID 51145)
-- Name: receiving_orders receiving_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;


--
-- TOC entry 3778 (class 2606 OID 51150)
-- Name: receiving_orders receiving_orders_packing_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_packing_type_id_fkey FOREIGN KEY (packing_type_id) REFERENCES public.packing_types(id) ON DELETE SET NULL;


--
-- TOC entry 3779 (class 2606 OID 51160)
-- Name: shipping_records shipping_records_receiving_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_receiving_order_id_fkey FOREIGN KEY (receiving_order_id) REFERENCES public.receiving_orders(id) ON DELETE RESTRICT;


--
-- TOC entry 3784 (class 2606 OID 59407)
-- Name: sow_nnva_standard sow_nnva_standard_nnva_base_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_nnva_base_id_fkey FOREIGN KEY (nnva_base_id) REFERENCES public.sow_nnva_base(id) ON DELETE RESTRICT;


--
-- TOC entry 3785 (class 2606 OID 59402)
-- Name: sow_nnva_standard sow_nnva_standard_sow_standard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_sow_standard_id_fkey FOREIGN KEY (sow_standard_id) REFERENCES public.sow_standard(id) ON DELETE CASCADE;


--
-- TOC entry 3770 (class 2606 OID 42587)
-- Name: sow_standard_attachments sow_standard_attachments_standard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_standard_attachments
    ADD CONSTRAINT sow_standard_attachments_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id) ON DELETE CASCADE;


--
-- TOC entry 3769 (class 2606 OID 42582)
-- Name: sow_standard sow_standard_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT sow_standard_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id);


--
-- TOC entry 3771 (class 2606 OID 42592)
-- Name: sow_template_lines sow_template_lines_standard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id);


--
-- TOC entry 3772 (class 2606 OID 42597)
-- Name: sow_template_lines sow_template_lines_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.sow_templates(template_id);


--
-- TOC entry 3773 (class 2606 OID 42602)
-- Name: sow_templates sow_templates_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT sow_templates_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id);


-- Completed on 2026-05-11 03:31:17

--
-- PostgreSQL database dump complete
--

