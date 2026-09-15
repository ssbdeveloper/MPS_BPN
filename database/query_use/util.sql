CREATE TABLE mch_transaction (
	proddataid int4 NULL,
	startdatetime timestamp NULL,
	enddatetime timestamp NULL,
	work_date date NULL,
	start_time text NULL,
	end_time text NULL,
	source_duration int4 NULL,
	duration_seconds int8 NULL,
	duration_hours numeric NULL,
	machineno int4 NULL,
	sitemachineno int4 NULL,
	machinegroupid int4 NULL,
	machine_plantid int4 NULL,
	machinetypeid int4 NULL,
	machineid varchar NULL,
	machinename varchar NULL,
	statusid int2 NULL,
	previoustatusid int2 NULL,
	status_description varchar NULL,
	status_activitytype varchar NULL,
	previous_status_description varchar(100) NULL,
	confirmation_number varchar(20) NULL,
	order_no varchar(20) NULL,
	operation_no varchar(10) NULL,
	operation_short_text text NULL,
	operation_description text NULL,
	sequence_category varchar(5) NULL,
	sequence_number varchar(20) NULL,
	branch_operation_no varchar(10) NULL,
	return_operation_no varchar(10) NULL,
	cost_center varchar(30) NULL,
	material_no varchar(50) NULL,
	material_description text NULL,
	ssbr_id text NULL,
	full_name text NULL,
	sn_employee text NULL,
	workcentercode text NULL,
	tsnumber int4 NULL,
	checkin timestamptz NULL,
	refreshed_at timestamptz NULL
);


  ALTER TABLE public.mch_transaction
      ALTER COLUMN proddataid SET NOT null,
      ADD CONSTRAINT mch_transaction_pkey PRIMARY KEY (proddataid);
  
  
  CREATE SCHEMA tools_management AUTHORIZATION tag;
  
  
  SELECT DISTINCT ON (mt.sn_employee)
    mt.sn_employee,
    mt.full_name,
    mt.proddataid,
    mp.operatorid
FROM mch_transaction mt
JOIN mch_productiondata mp
    ON mt.proddataid = mp.proddataid
ORDER BY mt.sn_employee, mt.proddataid DESC;

CREATE TABLE mch_user AS
SELECT DISTINCT ON (mt.sn_employee)
    mp.operatorid AS operatorid,
    mt.full_name,
    mt.sn_employee
FROM mch_transaction mt
JOIN mch_productiondata mp
    ON mt.proddataid = mp.proddataid
WHERE mp.operatorid IS NOT NULL
ORDER BY mt.sn_employee, mt.startdatetime DESC;

ALTER TABLE mch_user
ADD CONSTRAINT mch_user_pkey
PRIMARY KEY (operatorid);



------ CHEKC POSTGRES YANG JALAN ----------
SELECT pid,
       state,
       wait_event_type,
       wait_event,
       now() - query_start AS duration,
       query
FROM pg_stat_activity
WHERE query ILIKE '%REFRESH MATERIALIZED VIEW%';

---- check komplit ----
SELECT pid,
       now() - query_start AS runtime,
       state,
       wait_event_type,
       wait_event,
       query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY runtime DESC;



----- kill query -----
SELECT pg_terminate_backend(PID);

------ check lock ------
SELECT blocked.pid     AS blocked_pid,
       blocking.pid    AS blocking_pid,
       blocked.query   AS blocked_query,
       blocking.query  AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_locks bl ON blocked.pid = bl.pid
JOIN pg_locks kl
  ON bl.locktype = kl.locktype
 AND bl.database IS NOT DISTINCT FROM kl.database
 AND bl.relation IS NOT DISTINCT FROM kl.relation
 AND kl.granted
JOIN pg_stat_activity blocking ON blocking.pid = kl.pid
WHERE NOT bl.granted;