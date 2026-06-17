--
-- PostgreSQL database dump
--

\restrict eC3QZo3I4dbw75aFOzIABkGnCCMF8PbXwY8nNajTqCz4Vl9Lbx0phxiLQBdGb3w

-- Dumped from database version 15.15
-- Dumped by pg_dump version 15.17 (Ubuntu 15.17-1.pgdg22.04+1)

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
-- Name: update_modified_column(); Type: FUNCTION; Schema: public; Owner: tag
--

CREATE FUNCTION public.update_modified_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_modified_column() OWNER TO tag;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: tag
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO tag;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: operations; Type: TABLE; Schema: public; Owner: tag
--

CREATE TABLE public.operations (
    operation_id integer NOT NULL,
    part_id integer NOT NULL,
    opr_no integer NOT NULL,
    operationtext text NOT NULL,
    wct_group character varying(50),
    workcenter character varying(50),
    planhours numeric(5,2),
    drawing_path text,
    remark text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.operations OWNER TO tag;

--
-- Name: operations_operation_id_seq; Type: SEQUENCE; Schema: public; Owner: tag
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
-- Name: parts; Type: TABLE; Schema: public; Owner: tag
--

CREATE TABLE public.parts (
    part_id integer NOT NULL,
    partnumber character varying(50) NOT NULL,
    partname character varying(200) NOT NULL,
    model character varying(100) NOT NULL,
    drawing_path text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.parts OWNER TO tag;

--
-- Name: parts_part_id_seq; Type: SEQUENCE; Schema: public; Owner: tag
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
-- Name: process_category; Type: TABLE; Schema: public; Owner: tag
--

CREATE TABLE public.process_category (
    id_process integer NOT NULL,
    process_name text NOT NULL,
    description text
);


ALTER TABLE public.process_category OWNER TO tag;

--
-- Name: process_category_id_process_seq; Type: SEQUENCE; Schema: public; Owner: tag
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
-- Name: process_parameter; Type: TABLE; Schema: public; Owner: tag
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


ALTER TABLE public.process_parameter OWNER TO tag;

--
-- Name: process_parameter_choicebase; Type: TABLE; Schema: public; Owner: tag
--

CREATE TABLE public.process_parameter_choicebase (
    id_choice integer NOT NULL,
    choice_name text NOT NULL,
    description text,
    id_parameter integer NOT NULL
);


ALTER TABLE public.process_parameter_choicebase OWNER TO tag;

--
-- Name: process_parameter_choicebase_id_choice_seq; Type: SEQUENCE; Schema: public; Owner: tag
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
-- Name: process_parameter_id_parameter_seq; Type: SEQUENCE; Schema: public; Owner: tag
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
-- Name: processcontroldata; Type: TABLE; Schema: public; Owner: tag
--

CREATE TABLE public.processcontroldata (
    id_processcontroldata integer NOT NULL,
    snssb text,
    full_name text,
    production_order text,
    ssbr_id text,
    operation_text text,
    operation_no text,
    machineid text,
    workcenter text,
    validation_status text,
    validation_date timestamp with time zone,
    validation_by text,
    createddate timestamp with time zone DEFAULT now(),
    tsnumber integer
);


ALTER TABLE public.processcontroldata OWNER TO tag;

--
-- Name: processcontroldata_id_processcontroldata_seq; Type: SEQUENCE; Schema: public; Owner: tag
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
-- Name: processcontroldata_item; Type: TABLE; Schema: public; Owner: tag
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


ALTER TABLE public.processcontroldata_item OWNER TO tag;

--
-- Name: processcontroldata_item_id_processcontroldata_item_seq; Type: SEQUENCE; Schema: public; Owner: tag
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
-- Name: sow; Type: TABLE; Schema: public; Owner: tag
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
    operationtext text,
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
    sync text,
    plan_start date,
    plan_finish date,
    actual_start date,
    actual_finish date,
    actual_progress numeric(5,2),
    actual_hours real,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.sow OWNER TO tag;

--
-- Name: sow_idsow_seq; Type: SEQUENCE; Schema: public; Owner: tag
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
-- Name: timesheet_transaction; Type: TABLE; Schema: public; Owner: tag
--

CREATE TABLE public.timesheet_transaction (
    tsnumber integer NOT NULL,
    activitytype text,
    operation_text text,
    confirmationnumber text,
    ssbr_ident text,
    date_checkin text,
    date_checkout text,
    full_name text,
    hour_checkin text,
    hour_checkout text,
    longdate_checkin timestamp with time zone,
    longdate_checkout timestamp with time zone,
    note text,
    seq integer,
    production_order text,
    part_name text,
    planhours text,
    plant text,
    serialnumber text,
    state_flag text,
    std_foreman_hours text,
    validation_date timestamp with time zone,
    workcentercode text,
    workcenterdescription text,
    duration numeric(10,2)
);


ALTER TABLE public.timesheet_transaction OWNER TO tag;

--
-- Name: timesheet_transaction_tsnumber_seq; Type: SEQUENCE; Schema: public; Owner: tag
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
-- Name: usernfc; Type: TABLE; Schema: public; Owner: tag
--

CREATE TABLE public.usernfc (
    idrow integer NOT NULL,
    nfcid text,
    full_name text,
    snssb text,
    machineid text,
    machinename text,
    workcenter text,
    roles text
);


ALTER TABLE public.usernfc OWNER TO tag;

--
-- Name: usernfc_idrow_seq; Type: SEQUENCE; Schema: public; Owner: tag
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
-- Name: vw_actualsummary; Type: VIEW; Schema: public; Owner: tag
--

CREATE VIEW public.vw_actualsummary AS
 SELECT timesheet_transaction.production_order,
    timesheet_transaction.seq,
    (timesheet_transaction.production_order || timesheet_transaction.seq) AS codepo,
    sum(timesheet_transaction.duration) AS total_duration,
    min(timesheet_transaction.longdate_checkin) AS checkin_start,
    max(timesheet_transaction.longdate_checkout) AS checkout_end
   FROM public.timesheet_transaction
  WHERE ((timesheet_transaction.production_order IS NOT NULL) AND (timesheet_transaction.state_flag = '2'::text))
  GROUP BY timesheet_transaction.production_order, timesheet_transaction.seq;


ALTER TABLE public.vw_actualsummary OWNER TO tag;

--
-- Name: workcenter; Type: TABLE; Schema: public; Owner: tag
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


ALTER TABLE public.workcenter OWNER TO tag;

--
-- Name: workcenter_idrow_seq; Type: SEQUENCE; Schema: public; Owner: tag
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
-- Name: operations operations_part_id_opr_no_key; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_part_id_opr_no_key UNIQUE (part_id, opr_no);


--
-- Name: operations operations_pkey; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_pkey PRIMARY KEY (operation_id);


--
-- Name: parts parts_partnumber_key; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_partnumber_key UNIQUE (partnumber);


--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (part_id);


--
-- Name: process_category process_category_pkey; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.process_category
    ADD CONSTRAINT process_category_pkey PRIMARY KEY (id_process);


--
-- Name: process_parameter_choicebase process_parameter_choicebase_pkey; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.process_parameter_choicebase
    ADD CONSTRAINT process_parameter_choicebase_pkey PRIMARY KEY (id_choice);


--
-- Name: process_parameter process_parameter_pkey; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.process_parameter
    ADD CONSTRAINT process_parameter_pkey PRIMARY KEY (id_parameter);


--
-- Name: processcontroldata_item processcontroldata_item_pkey; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT processcontroldata_item_pkey PRIMARY KEY (id_processcontroldata_item);


--
-- Name: processcontroldata processcontroldata_pkey; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.processcontroldata
    ADD CONSTRAINT processcontroldata_pkey PRIMARY KEY (id_processcontroldata);


--
-- Name: sow sow_codenumber_unique; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_codenumber_unique UNIQUE (order_no, operation_no);


--
-- Name: sow sow_pkey; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_pkey PRIMARY KEY (idsow);


--
-- Name: timesheet_transaction timesheet_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.timesheet_transaction
    ADD CONSTRAINT timesheet_transaction_pkey PRIMARY KEY (tsnumber);


--
-- Name: usernfc usernfc_pkey; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.usernfc
    ADD CONSTRAINT usernfc_pkey PRIMARY KEY (idrow);


--
-- Name: workcenter workcenter_pkey; Type: CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT workcenter_pkey PRIMARY KEY (idrow);


--
-- Name: idx_operations_drawing_path; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_operations_drawing_path ON public.operations USING btree (drawing_path);


--
-- Name: idx_operations_part_id; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_operations_part_id ON public.operations USING btree (part_id);


--
-- Name: idx_parts_model; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_parts_model ON public.parts USING btree (model);


--
-- Name: idx_parts_partname; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_parts_partname ON public.parts USING btree (partname);


--
-- Name: idx_parts_partnumber; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_parts_partnumber ON public.parts USING btree (partnumber);


--
-- Name: idx_sow_model; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_sow_model ON public.sow USING btree (model);


--
-- Name: idx_sow_part_number; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_sow_part_number ON public.sow USING btree (part_number);


--
-- Name: idx_ts_longdate_checkin; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_ts_longdate_checkin ON public.timesheet_transaction USING btree (longdate_checkin);


--
-- Name: idx_ts_production_order; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_ts_production_order ON public.timesheet_transaction USING btree (production_order);


--
-- Name: idx_ts_serial_checkin; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_ts_serial_checkin ON public.timesheet_transaction USING btree (serialnumber, longdate_checkin);


--
-- Name: idx_ts_serialnumber; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_ts_serialnumber ON public.timesheet_transaction USING btree (serialnumber);


--
-- Name: idx_ts_validation_date; Type: INDEX; Schema: public; Owner: tag
--

CREATE INDEX idx_ts_validation_date ON public.timesheet_transaction USING btree (validation_date);


--
-- Name: operations update_operations_updated_at; Type: TRIGGER; Schema: public; Owner: tag
--

CREATE TRIGGER update_operations_updated_at BEFORE UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: parts update_parts_updated_at; Type: TRIGGER; Schema: public; Owner: tag
--

CREATE TRIGGER update_parts_updated_at BEFORE UPDATE ON public.parts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: sow update_sow_updated_at; Type: TRIGGER; Schema: public; Owner: tag
--

CREATE TRIGGER update_sow_updated_at BEFORE UPDATE ON public.sow FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- Name: process_parameter_choicebase fk_choice_parameter; Type: FK CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.process_parameter_choicebase
    ADD CONSTRAINT fk_choice_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE CASCADE;


--
-- Name: processcontroldata_item fk_item_parameter; Type: FK CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT fk_item_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE SET NULL;


--
-- Name: processcontroldata_item fk_item_processcontroldata; Type: FK CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT fk_item_processcontroldata FOREIGN KEY (id_processcontroldata) REFERENCES public.processcontroldata(id_processcontroldata) ON DELETE CASCADE;


--
-- Name: operations fk_operations_part; Type: FK CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT fk_operations_part FOREIGN KEY (part_id) REFERENCES public.parts(part_id) ON DELETE CASCADE;


--
-- Name: process_parameter fk_process_parameter_process; Type: FK CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.process_parameter
    ADD CONSTRAINT fk_process_parameter_process FOREIGN KEY (id_process) REFERENCES public.process_category(id_process) ON DELETE CASCADE;


--
-- Name: processcontroldata fk_processcontroldata_timesheet; Type: FK CONSTRAINT; Schema: public; Owner: tag
--

ALTER TABLE ONLY public.processcontroldata
    ADD CONSTRAINT fk_processcontroldata_timesheet FOREIGN KEY (tsnumber) REFERENCES public.timesheet_transaction(tsnumber) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict eC3QZo3I4dbw75aFOzIABkGnCCMF8PbXwY8nNajTqCz4Vl9Lbx0phxiLQBdGb3w

