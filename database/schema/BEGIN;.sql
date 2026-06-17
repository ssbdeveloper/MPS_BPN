BEGIN;

-- =====================
-- SOW
-- =====================
CREATE TABLE IF NOT EXISTS public.sow (
    idsow int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_no text,
    operation_no int4 NOT NULL,
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
    codenumber text GENERATED ALWAYS AS (order_no || operation_no::text) STORED,
    weight numeric(5,2),
    created_by text,
    type text,
    "group" text,
    category text,
    remark text
);

-- =====================
-- TIMESHEET
-- =====================
CREATE TABLE IF NOT EXISTS public.timesheet_transaction (
    tsnumber int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activitytype text,
    operation_text text,
    confirmationnumber text,
    ssbr_ident text,
    date_checkin text,
    date_checkout text,
    full_name text,
    hour_checkin text,
    hour_checkout text,
    longdate_checkin timestamptz,
    longdate_checkout timestamptz,
    note text,
    seq int4,
    production_order text,
    part_name text,
    planhours text,
    plant text,
    serialnumber text,
    state_flag text,
    std_foreman_hours text,
    validation_date timestamptz,
    workcentercode text,
    workcenterdescription text,
    duration numeric(10,2)
);

-- =====================
-- USER NFC
-- =====================
CREATE TABLE IF NOT EXISTS public.usernfc (
    idrow int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nfcid text,
    full_name text,
    snssb text,
    machineid text,
    machinename text,
    workcenter text,
    roles text
);

-- =====================
-- WORKCENTER
-- =====================
CREATE TABLE IF NOT EXISTS public.workcenter (
    idrow int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant int4,
    workcenterot varchar(50),
    condition varchar(50),
    categoryhours varchar(50),
    groupname varchar(50),
    machineid varchar(50),
    position int4,
    costcenter int4,
    costcenter_rate int4,
    workcenter_description varchar(50),
    workcenternew varchar(50),
    workcenterold varchar(50)
);

-- =====================
-- PROCESS CATEGORY
-- =====================
CREATE TABLE IF NOT EXISTS public.process_category (
    id_process int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    process_name text NOT NULL,
    description text
);

-- =====================
-- PROCESS PARAMETER
-- =====================
CREATE TABLE IF NOT EXISTS public.process_parameter (
    id_parameter int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parameter_name text NOT NULL,
    description text,
    parameter_no int4,
    uom text,
    ischoice boolean DEFAULT false,
    isnumber boolean DEFAULT false,
    id_process int4 NOT NULL
);

-- =====================
-- PARAMETER CHOICE
-- =====================
CREATE TABLE IF NOT EXISTS public.process_parameter_choicebase (
    id_choice int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    choice_name text NOT NULL,
    description text,
    id_parameter int4 NOT NULL
);

-- =====================
-- PROCESS CONTROL DATA
-- =====================
CREATE TABLE IF NOT EXISTS public.processcontroldata (
    id_processcontroldata int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    snssb text,
    full_name text,
    production_order text,
    ssbr_id text,
    operation_text text,
    operation_no text,
    machineid text,
    workcenter text,
    validation_status text,
    validation_date timestamptz,
    validation_by text,
    createddate timestamptz DEFAULT now(),
    tsnumber int4
);

-- =====================
-- PROCESS CONTROL DATA ITEM
-- =====================
CREATE TABLE IF NOT EXISTS public.processcontroldata_item (
    id_processcontroldata_item int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_name text,
    parameter_name text,
    value text,
    uom text,
    ischoice boolean,
    isnumber boolean,
    status text,
    note text,
    id_parameter int4,
    id_processcontroldata int4 NOT NULL,
    createddate timestamptz DEFAULT now()
);

CREATE TABLE production_operations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_number TEXT,
    operation_number TEXT,
    short_text TEXT,
    estimate_hour TEXT,
    confirmation TEXT,
    branch_operation TEXT,
    return_operation TEXT,
    sequence_category TEXT,
    sequence_number TEXT,
    material_code TEXT,
    material_description TEXT,
    operation_status TEXT,
    order_type TEXT,
    plant TEXT,
    uom TEXT,
    work_center TEXT,
    cost_center TEXT,
    order_system_status TEXT
);
COMMIT;
