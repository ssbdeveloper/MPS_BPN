BEGIN;

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

CREATE TABLE IF NOT EXISTS public.parts (
    part_id int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    partnumber varchar(50) UNIQUE NOT NULL,
    partname varchar(200) NOT NULL,
    model varchar(100) NOT NULL,
    drawing_path text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.operations (
    operation_id int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    part_id int4 NOT NULL,
    opr_no int4 NOT NULL,
    operationtext text NOT NULL,
    wct_group varchar(50),
    workcenter varchar(50),
    planhours numeric(5,2),
    drawing_path text,
    remark text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(part_id, opr_no)
);

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

CREATE TABLE IF NOT EXISTS public.process_category (
    id_process int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    process_name text NOT NULL,
    description text
);

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

CREATE TABLE IF NOT EXISTS public.process_parameter_choicebase (
    id_choice int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    choice_name text NOT NULL,
    description text,
    id_parameter int4 NOT NULL
);

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

ALTER TABLE public.operations DROP CONSTRAINT IF EXISTS fk_operations_part;
ALTER TABLE public.operations ADD CONSTRAINT fk_operations_part FOREIGN KEY (part_id) REFERENCES public.parts(part_id) ON DELETE CASCADE;

ALTER TABLE public.process_parameter DROP CONSTRAINT IF EXISTS fk_process_parameter_process;
ALTER TABLE public.process_parameter ADD CONSTRAINT fk_process_parameter_process FOREIGN KEY (id_process) REFERENCES public.process_category(id_process) ON DELETE CASCADE;

ALTER TABLE public.process_parameter_choicebase DROP CONSTRAINT IF EXISTS fk_choice_parameter;
ALTER TABLE public.process_parameter_choicebase ADD CONSTRAINT fk_choice_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE CASCADE;

ALTER TABLE public.processcontroldata DROP CONSTRAINT IF EXISTS fk_processcontroldata_timesheet;
ALTER TABLE public.processcontroldata ADD CONSTRAINT fk_processcontroldata_timesheet FOREIGN KEY (tsnumber) REFERENCES public.timesheet_transaction(tsnumber) ON DELETE SET NULL;

ALTER TABLE public.processcontroldata_item DROP CONSTRAINT IF EXISTS fk_item_parameter;
ALTER TABLE public.processcontroldata_item ADD CONSTRAINT fk_item_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE SET NULL;

ALTER TABLE public.processcontroldata_item DROP CONSTRAINT IF EXISTS fk_item_processcontroldata;
ALTER TABLE public.processcontroldata_item ADD CONSTRAINT fk_item_processcontroldata FOREIGN KEY (id_processcontroldata) REFERENCES public.processcontroldata(id_processcontroldata) ON DELETE CASCADE;

-- Timesheet transaction indexes for validation page performance
CREATE INDEX IF NOT EXISTS idx_ts_longdate_checkin ON timesheet_transaction(longdate_checkin);
CREATE INDEX IF NOT EXISTS idx_ts_serialnumber ON timesheet_transaction(serialnumber);
CREATE INDEX IF NOT EXISTS idx_ts_validation_date ON timesheet_transaction(validation_date);
CREATE INDEX IF NOT EXISTS idx_ts_production_order ON timesheet_transaction(production_order);
CREATE INDEX IF NOT EXISTS idx_ts_serial_checkin ON timesheet_transaction(serialnumber, longdate_checkin);
-- SOW codenumber index for planhours join
CREATE INDEX IF NOT EXISTS idx_sow_codenumber ON sow(codenumber);

CREATE INDEX IF NOT EXISTS idx_parts_partnumber ON parts(partnumber);
CREATE INDEX IF NOT EXISTS idx_parts_partname ON parts(partname);
CREATE INDEX IF NOT EXISTS idx_parts_model ON parts(model);
CREATE INDEX IF NOT EXISTS idx_operations_part_id ON operations(part_id);
CREATE INDEX IF NOT EXISTS idx_operations_drawing_path ON operations(drawing_path);
CREATE INDEX IF NOT EXISTS idx_sow_part_number ON sow(part_number);
CREATE INDEX IF NOT EXISTS idx_sow_model ON sow(model);

CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_parts_updated_at ON parts;
CREATE TRIGGER update_parts_updated_at BEFORE UPDATE ON parts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_operations_updated_at ON operations;
CREATE TRIGGER update_operations_updated_at BEFORE UPDATE ON operations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;