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

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: fn_delete_dup_sow(); Type: FUNCTION; Schema: public; Owner: postgres
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


ALTER FUNCTION public.fn_delete_dup_sow() OWNER TO postgres;

--
-- Name: trg_set_sync_modified(); Type: FUNCTION; Schema: public; Owner: postgres
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


ALTER FUNCTION public.trg_set_sync_modified() OWNER TO postgres;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: components; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.components (
    component_id bigint NOT NULL,
    part_name text NOT NULL,
    model text NOT NULL,
    part_number text NOT NULL
);


ALTER TABLE public.components OWNER TO postgres;

--
-- Name: components_component_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: log_timesheet_sap; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.log_timesheet_sap OWNER TO postgres;

--
-- Name: log_timesheet_sap_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: operations; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.operations OWNER TO postgres;

--
-- Name: operations_operation_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: sow; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.sow OWNER TO postgres;

--
-- Name: order; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
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


ALTER TABLE public."order" OWNER TO postgres;

--
-- Name: parts; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.parts OWNER TO postgres;

--
-- Name: parts_part_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: ph3_order; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.ph3_order OWNER TO postgres;

--
-- Name: ph3_order_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: process_category; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.process_category (
    id_process integer NOT NULL,
    process_name text NOT NULL,
    description text
);


ALTER TABLE public.process_category OWNER TO postgres;

--
-- Name: process_category_id_process_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: process_parameter; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.process_parameter OWNER TO postgres;

--
-- Name: process_parameter_choicebase; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.process_parameter_choicebase (
    id_choice integer NOT NULL,
    choice_name text NOT NULL,
    description text,
    id_parameter integer NOT NULL
);


ALTER TABLE public.process_parameter_choicebase OWNER TO postgres;

--
-- Name: process_parameter_choicebase_id_choice_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: process_parameter_id_parameter_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: processcontroldata; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.processcontroldata OWNER TO postgres;

--
-- Name: processcontroldata_id_processcontroldata_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: processcontroldata_item; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.processcontroldata_item OWNER TO postgres;

--
-- Name: processcontroldata_item_id_processcontroldata_item_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: production_operations; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.production_operations OWNER TO postgres;

--
-- Name: production_operations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: progress_update_history; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.progress_update_history OWNER TO postgres;

--
-- Name: progress_update_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.progress_update_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.progress_update_history_id_seq OWNER TO postgres;

--
-- Name: progress_update_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.progress_update_history_id_seq OWNED BY public.progress_update_history.id;


--
-- Name: qh3_order; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.qh3_order OWNER TO postgres;

--
-- Name: qh3_order_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: sow_idsow_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: sow_standard; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.sow_standard OWNER TO postgres;

--
-- Name: sow_standard_attachments; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.sow_standard_attachments OWNER TO postgres;

--
-- Name: sow_standard_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sow_standard_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.sow_standard_attachments_id_seq OWNER TO postgres;

--
-- Name: sow_standard_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sow_standard_attachments_id_seq OWNED BY public.sow_standard_attachments.id;


--
-- Name: sow_standard_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: sow_template_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sow_template_lines (
    id bigint NOT NULL,
    template_id bigint NOT NULL,
    standard_id bigint NOT NULL
);


ALTER TABLE public.sow_template_lines OWNER TO postgres;

--
-- Name: sow_template_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: sow_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sow_templates (
    template_id bigint NOT NULL,
    component_id bigint NOT NULL,
    template_name text NOT NULL,
    created_by text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.sow_templates OWNER TO postgres;

--
-- Name: sow_templates_template_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: timesheet_transaction; Type: TABLE; Schema: public; Owner: postgres
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
    order_no text
);


ALTER TABLE public.timesheet_transaction OWNER TO postgres;

--
-- Name: timesheet_transaction_tsnumber_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: usernfc; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.usernfc (
    nfcid text NOT NULL,
    full_name text,
    snssb text,
    machineid text,
    machinename text,
    roles text,
    workcenter text,
    idrow integer NOT NULL
);


ALTER TABLE public.usernfc OWNER TO postgres;

--
-- Name: usernfc_idrow_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: vw_sow_orders; Type: VIEW; Schema: public; Owner: postgres
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


ALTER TABLE public.vw_sow_orders OWNER TO postgres;

--
-- Name: workcenter; Type: TABLE; Schema: public; Owner: postgres
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


ALTER TABLE public.workcenter OWNER TO postgres;

--
-- Name: workcenter_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
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
-- Name: progress_update_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.progress_update_history ALTER COLUMN id SET DEFAULT nextval('public.progress_update_history_id_seq'::regclass);


--
-- Name: sow_standard_attachments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow_standard_attachments ALTER COLUMN id SET DEFAULT nextval('public.sow_standard_attachments_id_seq'::regclass);


--
-- Name: components components_model_part_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_model_part_number_key UNIQUE (model, part_number);


--
-- Name: components components_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_pkey PRIMARY KEY (component_id);


--
-- Name: log_timesheet_sap log_timesheet_sap_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.log_timesheet_sap
    ADD CONSTRAINT log_timesheet_sap_pkey PRIMARY KEY (id);


--
-- Name: operations operations_part_id_operation_no_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_part_id_operation_no_key UNIQUE (part_id, operation_no);


--
-- Name: operations operations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_pkey PRIMARY KEY (operation_id);


--
-- Name: parts parts_partnumber_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_partnumber_key UNIQUE (partnumber);


--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (part_id);


--
-- Name: ph3_order ph3_order_confirmation_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ph3_order
    ADD CONSTRAINT ph3_order_confirmation_number_key UNIQUE (confirmation_number);


--
-- Name: ph3_order ph3_order_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ph3_order
    ADD CONSTRAINT ph3_order_pkey PRIMARY KEY (id);


--
-- Name: process_category process_category_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_category
    ADD CONSTRAINT process_category_pkey PRIMARY KEY (id_process);


--
-- Name: process_parameter_choicebase process_parameter_choicebase_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_parameter_choicebase
    ADD CONSTRAINT process_parameter_choicebase_pkey PRIMARY KEY (id_choice);


--
-- Name: process_parameter process_parameter_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_parameter
    ADD CONSTRAINT process_parameter_pkey PRIMARY KEY (id_parameter);


--
-- Name: processcontroldata_item processcontroldata_item_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT processcontroldata_item_pkey PRIMARY KEY (id_processcontroldata_item);


--
-- Name: processcontroldata processcontroldata_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.processcontroldata
    ADD CONSTRAINT processcontroldata_pkey PRIMARY KEY (id_processcontroldata);


--
-- Name: production_operations production_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.production_operations
    ADD CONSTRAINT production_operations_pkey PRIMARY KEY (id);


--
-- Name: progress_update_history progress_update_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.progress_update_history
    ADD CONSTRAINT progress_update_history_pkey PRIMARY KEY (id);


--
-- Name: qh3_order qh3_order_confirmation_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qh3_order
    ADD CONSTRAINT qh3_order_confirmation_number_key UNIQUE (confirmation_number);


--
-- Name: qh3_order qh3_order_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qh3_order
    ADD CONSTRAINT qh3_order_pkey PRIMARY KEY (id);


--
-- Name: sow sow_codenumber_uniq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_codenumber_uniq UNIQUE (codenumber);


--
-- Name: sow sow_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_pkey PRIMARY KEY (idsow);


--
-- Name: sow_standard_attachments sow_standard_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow_standard_attachments
    ADD CONSTRAINT sow_standard_attachments_pkey PRIMARY KEY (id);


--
-- Name: sow_standard sow_standard_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT sow_standard_pkey PRIMARY KEY (id);


--
-- Name: sow_template_lines sow_template_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_pkey PRIMARY KEY (id);


--
-- Name: sow_templates sow_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT sow_templates_pkey PRIMARY KEY (template_id);


--
-- Name: timesheet_transaction timesheet_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.timesheet_transaction
    ADD CONSTRAINT timesheet_transaction_pkey PRIMARY KEY (tsnumber);


--
-- Name: sow uq_sow_order_operation; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT uq_sow_order_operation UNIQUE (order_no, operation_no);


--
-- Name: usernfc usernfc_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usernfc
    ADD CONSTRAINT usernfc_pkey PRIMARY KEY (idrow);


--
-- Name: usernfc usernfc_snssb_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usernfc
    ADD CONSTRAINT usernfc_snssb_unique UNIQUE (snssb);


--
-- Name: workcenter workcenter_machineid_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT workcenter_machineid_unique UNIQUE (machineid);


--
-- Name: workcenter workcenter_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT workcenter_pkey PRIMARY KEY (idrow);


--
-- Name: workcenter workcenter_workcenternew_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT workcenter_workcenternew_unique UNIQUE (workcenternew);


--
-- Name: idx_operations_drawing_path; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_operations_drawing_path ON public.operations USING btree (drawing_path);


--
-- Name: idx_operations_part_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_operations_part_id ON public.operations USING btree (part_id);


--
-- Name: idx_parts_model; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_parts_model ON public.parts USING btree (model);


--
-- Name: idx_parts_partname; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_parts_partname ON public.parts USING btree (partname);


--
-- Name: idx_parts_partnumber; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_parts_partnumber ON public.parts USING btree (partnumber);


--
-- Name: idx_pcd_operation_no; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pcd_operation_no ON public.processcontroldata USING btree (operation_no);


--
-- Name: idx_pcd_production_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pcd_production_order ON public.processcontroldata USING btree (production_order);


--
-- Name: idx_pcd_snssb; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pcd_snssb ON public.processcontroldata USING btree (snssb);


--
-- Name: idx_pcd_tsnumber; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pcd_tsnumber ON public.processcontroldata USING btree (tsnumber);


--
-- Name: idx_pcdi_id_parameter; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pcdi_id_parameter ON public.processcontroldata_item USING btree (id_parameter);


--
-- Name: idx_pcdi_id_processcontroldata; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pcdi_id_processcontroldata ON public.processcontroldata_item USING btree (id_processcontroldata);


--
-- Name: idx_pp_id_process; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pp_id_process ON public.process_parameter USING btree (id_process);


--
-- Name: idx_ppcb_id_parameter; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ppcb_id_parameter ON public.process_parameter_choicebase USING btree (id_parameter);


--
-- Name: idx_prodops_order_operation; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_prodops_order_operation ON public.production_operations USING btree (order_number, operation_number);


--
-- Name: idx_puh_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_puh_created_at ON public.progress_update_history USING btree (created_at DESC);


--
-- Name: idx_puh_operation_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_puh_operation_id ON public.progress_update_history USING btree (operation_id);


--
-- Name: idx_sow_codenumber; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_codenumber ON public.sow USING btree (codenumber);


--
-- Name: idx_sow_model; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_model ON public.sow USING btree (model);


--
-- Name: idx_sow_order_no; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_order_no ON public.sow USING btree (order_no);


--
-- Name: idx_sow_part_name_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_part_name_trgm ON public.sow USING gin (part_name public.gin_trgm_ops);


--
-- Name: idx_sow_part_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_part_number ON public.sow USING btree (part_number);


--
-- Name: idx_sow_ssbr_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_ssbr_id ON public.sow USING btree (ssbr_id);


--
-- Name: idx_sow_standard_component_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_standard_component_id ON public.sow_standard USING btree (component_id);


--
-- Name: idx_sow_standard_source_plant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_standard_source_plant ON public.sow_standard USING btree (source_plant);


--
-- Name: idx_sow_std_attach_standard_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_std_attach_standard_id ON public.sow_standard_attachments USING btree (standard_id);


--
-- Name: idx_sow_sync_modified; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_sync_modified ON public.sow USING btree (order_no, operation_no) WHERE (sync = 'modified'::text);


--
-- Name: idx_sow_tmpl_lines_standard_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_tmpl_lines_standard_id ON public.sow_template_lines USING btree (standard_id);


--
-- Name: idx_sow_tmpl_lines_template_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_tmpl_lines_template_id ON public.sow_template_lines USING btree (template_id);


--
-- Name: idx_sow_workcenter; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sow_workcenter ON public.sow USING btree (workcenter);


--
-- Name: idx_ts_full_name_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_full_name_trgm ON public.timesheet_transaction USING gin (full_name public.gin_trgm_ops);


--
-- Name: idx_ts_longdate_checkin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_longdate_checkin ON public.timesheet_transaction USING btree (longdate_checkin);


--
-- Name: idx_ts_longdate_checkout; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_longdate_checkout ON public.timesheet_transaction USING btree (longdate_checkout);


--
-- Name: idx_ts_operation_no; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_operation_no ON public.timesheet_transaction USING btree (operation_no);


--
-- Name: idx_ts_order_no; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_order_no ON public.timesheet_transaction USING btree (order_no);


--
-- Name: idx_ts_order_no_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_order_no_trgm ON public.timesheet_transaction USING gin (order_no public.gin_trgm_ops);


--
-- Name: idx_ts_order_wc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_order_wc ON public.timesheet_transaction USING btree (order_no, workcentercode);


--
-- Name: idx_ts_serial_checkin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_serial_checkin ON public.timesheet_transaction USING btree (serialnumber, longdate_checkin);


--
-- Name: idx_ts_serialnumber_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_serialnumber_trgm ON public.timesheet_transaction USING gin (serialnumber public.gin_trgm_ops);


--
-- Name: idx_ts_state_flag; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_state_flag ON public.timesheet_transaction USING btree (state_flag);


--
-- Name: idx_ts_validation_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_validation_date ON public.timesheet_transaction USING btree (validation_date);


--
-- Name: idx_ts_workcentercode; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ts_workcentercode ON public.timesheet_transaction USING btree (workcentercode);


--
-- Name: uq_usernfc_nfcid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_usernfc_nfcid ON public.usernfc USING btree (nfcid);


--
-- Name: sow before_update_set_sync; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER before_update_set_sync BEFORE UPDATE ON public.sow FOR EACH ROW EXECUTE FUNCTION public.trg_set_sync_modified();


--
-- Name: sow trg_delete_dup_sow; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_delete_dup_sow AFTER INSERT ON public.sow FOR EACH ROW EXECUTE FUNCTION public.fn_delete_dup_sow();


--
-- Name: operations update_operations_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_operations_updated_at BEFORE UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: parts update_parts_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_parts_updated_at BEFORE UPDATE ON public.parts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: process_parameter_choicebase fk_choice_parameter; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_parameter_choicebase
    ADD CONSTRAINT fk_choice_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE CASCADE;


--
-- Name: processcontroldata_item fk_item_parameter; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT fk_item_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE SET NULL;


--
-- Name: processcontroldata_item fk_item_processcontroldata; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT fk_item_processcontroldata FOREIGN KEY (id_processcontroldata) REFERENCES public.processcontroldata(id_processcontroldata) ON DELETE CASCADE;


--
-- Name: operations fk_operations_part; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT fk_operations_part FOREIGN KEY (part_id) REFERENCES public.parts(part_id) ON DELETE CASCADE;


--
-- Name: processcontroldata fk_pcd_timesheet; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.processcontroldata
    ADD CONSTRAINT fk_pcd_timesheet FOREIGN KEY (tsnumber) REFERENCES public.timesheet_transaction(tsnumber) ON DELETE SET NULL;


--
-- Name: process_parameter fk_pp_process_category; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_parameter
    ADD CONSTRAINT fk_pp_process_category FOREIGN KEY (id_process) REFERENCES public.process_category(id_process) ON DELETE CASCADE;


--
-- Name: progress_update_history fk_puh_sow_operation; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.progress_update_history
    ADD CONSTRAINT fk_puh_sow_operation FOREIGN KEY (operation_id) REFERENCES public.sow(idsow) ON DELETE CASCADE;


--
-- Name: timesheet_transaction fk_timesheet_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.timesheet_transaction
    ADD CONSTRAINT fk_timesheet_user FOREIGN KEY (serialnumber) REFERENCES public.usernfc(snssb) ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;


--
-- Name: sow_standard_attachments sow_standard_attachments_standard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow_standard_attachments
    ADD CONSTRAINT sow_standard_attachments_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id) ON DELETE CASCADE;


--
-- Name: sow_standard sow_standard_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT sow_standard_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id);


--
-- Name: sow_template_lines sow_template_lines_standard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id);


--
-- Name: sow_template_lines sow_template_lines_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.sow_templates(template_id);


--
-- Name: sow_templates sow_templates_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT sow_templates_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id);


--
-- PostgreSQL database dump complete
--

