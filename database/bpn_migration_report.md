# Schema Migration Report
**Source of Truth:** `local_schema.sql` (ptssb local)
**Target:** `bpn_schema.sql` (production BPN)
**Generated:** 2026-04-10

---

## 1. Differences Summary

### 1.1 New Tables (10 tables — must CREATE)

| Table | Description |
|---|---|
| `components` | Master part/component catalog |
| `log_timesheet_sap` | SAP posting log per timesheet |
| `ph3_order` | Phase 3 order staging table |
| `production_operations` | SAP production operation detail |
| `progress_update_history` | SOW operation progress history with image |
| `qh3_order` | QH3 order staging table |
| `sow_standard` | Standard operation library linked to components |
| `sow_standard_attachments` | File attachments for sow_standard entries |
| `sow_template_lines` | Lines within a SOW template |
| `sow_templates` | SOW template header linked to components |

---

### 1.2 Column Changes in Existing Tables

#### `operations`
| Column | BPN (current) | Local (target) | Action | Risk |
|---|---|---|---|---|
| `opr_no` | `integer NOT NULL` | renamed → `operation_no` | RENAME | 🟡 Medium — rename breaks any app using `opr_no` |
| `operationtext` | `text NOT NULL` | renamed → `operation_text` | RENAME | 🟡 Medium |
| `wct_group` | `varchar(50)` | `text` | ALTER TYPE | 🟢 Safe — text is superset of varchar |
| `workcenter` | `varchar(50)` | `text` | ALTER TYPE | 🟢 Safe |
| `part_id` | `NOT NULL` | nullable | DROP NOT NULL | 🟢 Safe — expands allowed values |

#### `parts`
| Column | BPN (current) | Local (target) | Action | Risk |
|---|---|---|---|---|
| `partnumber` | `varchar(50)` | `text` | ALTER TYPE | 🟢 Safe |
| `partname` | `varchar(200)` | `text` | ALTER TYPE | 🟢 Safe |
| `model` | `varchar(100)` | `text` | ALTER TYPE | 🟢 Safe |
| `created_at` | `timestamp with time zone` | `timestamp without time zone` | ALTER TYPE | 🟠 Risky — timezone stripped |
| `updated_at` | `timestamp with time zone` | `timestamp without time zone` | ALTER TYPE | 🟠 Risky — timezone stripped |

#### `sow`
| Column | BPN (current) | Local (target) | Action | Risk |
|---|---|---|---|---|
| `operationtext` | `text` | renamed → `operation_text` | RENAME | 🟡 Medium |
| `order_no` | nullable | `NOT NULL` | SET NOT NULL | 🔴 High — fails if NULLs exist |
| `actual_hours` | `real` | `numeric(10,2)` | ALTER TYPE | 🟡 Medium — float rounding |
| `progress` | missing | `integer` | ADD COLUMN | 🟢 Safe |
| `sync` | no default | `DEFAULT 'new'` | SET DEFAULT | 🟢 Safe |
| `created_at` | exists | not in local | ⚠️ KEEP | Do not drop — data preservation |
| `updated_at` | exists | not in local | ⚠️ KEEP | Do not drop — data preservation |

#### `timesheet_transaction`
| Column | BPN (current) | Local (target) | Action | Risk |
|---|---|---|---|---|
| `ssbr_ident` | `text` | renamed → `ssbr_id` | RENAME | 🟡 Medium |
| `full_name` | nullable | `NOT NULL` | SET NOT NULL | 🔴 High — check for NULLs |
| `serialnumber` | nullable | `NOT NULL` | SET NOT NULL | 🔴 High — check for NULLs |
| `planhours` | `text` | `numeric(10,2)` | ALTER TYPE | 🔴 High — fails on non-numeric data |
| `std_foreman_hours` | `text` | `numeric(10,2)` | ALTER TYPE | 🔴 High — fails on non-numeric data |
| `state_flag` | `text` | `smallint DEFAULT 1` | ALTER TYPE | 🔴 High — fails on non-integer data |
| `duration` | `numeric(10,2)` | `numeric` | ALTER TYPE | 🟢 Safe — relaxing precision |
| `operation_no` | missing | `integer` | ADD COLUMN | 🟢 Safe |
| `order_no` | missing | `text` | ADD COLUMN | 🟢 Safe |
| `seq` | exists | not in local | ⚠️ KEEP | Do not drop |
| `production_order` | exists | not in local | ⚠️ KEEP | Do not drop |

#### `processcontroldata`
| Column | BPN (current) | Local (target) | Action | Risk |
|---|---|---|---|---|
| `operation_no` | `text` | `integer` | ALTER TYPE | 🔴 High — fails on non-integer values |

---

### 1.3 New / Changed Constraints

| Table | Constraint | Change |
|---|---|---|
| `operations` | `operations_part_id_opr_no_key` → `operations_part_id_operation_no_key` | RENAME (drop old, add new) |
| `sow` | `sow_codenumber_unique(order_no, operation_no)` | DROP — replaced by two new constraints |
| `sow` | `sow_codenumber_uniq(codenumber)` | ADD NEW |
| `sow` | `uq_sow_order_operation(order_no, operation_no)` | ADD NEW |
| `sow` | `chk_sow_actual_progress` | ADD CHECK constraint |
| `sow` | `chk_sow_progress` | ADD CHECK constraint |
| `usernfc` | `usernfc_snssb_unique` | ADD UNIQUE |
| `workcenter` | `workcenter_machineid_unique` | ADD UNIQUE |
| `workcenter` | `workcenter_workcenternew_unique` | ADD UNIQUE |

---

### 1.4 New Functions

| Function | Purpose |
|---|---|
| `fn_delete_dup_sow()` | Trigger: auto-delete older duplicate SOW rows on INSERT |
| `trg_set_sync_modified()` | Trigger: auto-set sync='modified' when non-sync fields change |

---

### 1.5 Trigger Changes

| Table | Trigger | Change |
|---|---|---|
| `sow` | `update_sow_updated_at` | REMOVE (bpn-only, uses deprecated `update_modified_column`) |
| `sow` | `before_update_set_sync` | ADD NEW |
| `sow` | `trg_delete_dup_sow` | ADD NEW |

---

### 1.6 New Views

| View | Type | Note |
|---|---|---|
| `vw_sow_orders` | Regular view | Aggregated SOW per order with progress |
| `order` | Materialized view | Lightweight order summary, refreshed manually |

> `vw_actualsummary` exists only in bpn — **kept as-is** (not in local, but harmless).

---

### 1.7 New Indexes (27 new indexes)

| Index | Table | Type |
|---|---|---|
| `idx_pcd_operation_no` | `processcontroldata` | btree |
| `idx_pcd_production_order` | `processcontroldata` | btree |
| `idx_pcd_snssb` | `processcontroldata` | btree |
| `idx_pcd_tsnumber` | `processcontroldata` | btree |
| `idx_pcdi_id_parameter` | `processcontroldata_item` | btree |
| `idx_pcdi_id_processcontroldata` | `processcontroldata_item` | btree |
| `idx_pp_id_process` | `process_parameter` | btree |
| `idx_ppcb_id_parameter` | `process_parameter_choicebase` | btree |
| `idx_prodops_order_operation` | `production_operations` | btree |
| `idx_puh_created_at` | `progress_update_history` | btree DESC |
| `idx_puh_operation_id` | `progress_update_history` | btree |
| `idx_sow_codenumber` | `sow` | btree |
| `idx_sow_order_no` | `sow` | btree |
| `idx_sow_part_name_trgm` | `sow` | GIN trgm |
| `idx_sow_ssbr_id` | `sow` | btree |
| `idx_sow_std_attach_standard_id` | `sow_standard_attachments` | btree |
| `idx_sow_sync_modified` | `sow` | partial btree |
| `idx_sow_tmpl_lines_standard_id` | `sow_template_lines` | btree |
| `idx_sow_tmpl_lines_template_id` | `sow_template_lines` | btree |
| `idx_sow_workcenter` | `sow` | btree |
| `idx_ts_full_name_trgm` | `timesheet_transaction` | GIN trgm |
| `idx_ts_longdate_checkout` | `timesheet_transaction` | btree |
| `idx_ts_operation_no` | `timesheet_transaction` | btree |
| `idx_ts_order_no` | `timesheet_transaction` | btree |
| `idx_ts_order_no_trgm` | `timesheet_transaction` | GIN trgm |
| `idx_ts_order_wc` | `timesheet_transaction` | btree |
| `idx_ts_serialnumber_trgm` | `timesheet_transaction` | GIN trgm |
| `idx_ts_state_flag` | `timesheet_transaction` | btree |
| `idx_ts_workcentercode` | `timesheet_transaction` | btree |
| `uq_usernfc_nfcid` | `usernfc` | UNIQUE btree |

---

### 1.8 New Foreign Keys

| FK Name | From | To |
|---|---|---|
| `sow_standard_component_id_fkey` | `sow_standard.component_id` | `components.component_id` |
| `sow_standard_attachments_standard_id_fkey` | `sow_standard_attachments.standard_id` | `sow_standard.id` |
| `sow_template_lines_standard_id_fkey` | `sow_template_lines.standard_id` | `sow_standard.id` |
| `sow_template_lines_template_id_fkey` | `sow_template_lines.template_id` | `sow_templates.template_id` |
| `sow_templates_component_id_fkey` | `sow_templates.component_id` | `components.component_id` |
| `fk_puh_sow_operation` | `progress_update_history.operation_id` | `sow.idsow` |
| `fk_timesheet_user` | `timesheet_transaction.serialnumber` | `usernfc.snssb` |
| `fk_pcd_timesheet` (renamed) | `processcontroldata.tsnumber` | `timesheet_transaction.tsnumber` |
| `fk_pp_process_category` (renamed) | `process_parameter.id_process` | `process_category.id_process` |

---

## 2. Pre-Flight Checklist (Run BEFORE migration)

Run these on bpn_schema to check for data blockers:

```sql
-- [CHECK-1] state_flag must be integer-castable
SELECT tsnumber, state_flag
FROM timesheet_transaction
WHERE state_flag IS NOT NULL AND state_flag !~ '^-?[0-9]+$';
-- Expected: 0 rows

-- [CHECK-2] planhours must be numeric-castable
SELECT tsnumber, planhours
FROM timesheet_transaction
WHERE planhours IS NOT NULL AND planhours !~ '^-?[0-9]*\.?[0-9]+$';
-- Expected: 0 rows

-- [CHECK-3] std_foreman_hours must be numeric-castable
SELECT tsnumber, std_foreman_hours
FROM timesheet_transaction
WHERE std_foreman_hours IS NOT NULL AND std_foreman_hours !~ '^-?[0-9]*\.?[0-9]+$';
-- Expected: 0 rows

-- [CHECK-4] processcontroldata.operation_no must be integer-castable
SELECT id_processcontroldata, operation_no
FROM processcontroldata
WHERE operation_no IS NOT NULL AND operation_no !~ '^[0-9]+$';
-- Expected: 0 rows

-- [CHECK-5] sow.order_no must have no NULLs (before SET NOT NULL)
SELECT count(*) AS null_count FROM sow WHERE order_no IS NULL;
-- Expected: 0

-- [CHECK-6] timesheet_transaction.serialnumber must have no NULLs
SELECT count(*) AS null_count FROM timesheet_transaction WHERE serialnumber IS NULL;
-- Expected: 0

-- [CHECK-7] timesheet_transaction.full_name must have no NULLs
SELECT count(*) AS null_count FROM timesheet_transaction WHERE full_name IS NULL;
-- Expected: 0

-- [CHECK-8] usernfc.snssb must have no duplicates (before UNIQUE constraint)
SELECT snssb, count(*) FROM usernfc
GROUP BY snssb HAVING count(*) > 1;
-- Expected: 0 rows

-- [CHECK-9] usernfc.nfcid must have no duplicates (before UNIQUE index)
SELECT nfcid, count(*) FROM usernfc
GROUP BY nfcid HAVING count(*) > 1;
-- Expected: 0 rows

-- [CHECK-10] workcenter.machineid must have no duplicates
SELECT machineid, count(*) FROM workcenter
GROUP BY machineid HAVING count(*) > 1;
-- Expected: 0 rows

-- [CHECK-11] workcenter.workcenternew must have no duplicates
SELECT workcenternew, count(*) FROM workcenter
GROUP BY workcenternew HAVING count(*) > 1;
-- Expected: 0 rows

-- [CHECK-12] timesheet_transaction.serialnumber all exist in usernfc.snssb
SELECT DISTINCT t.serialnumber
FROM timesheet_transaction t
LEFT JOIN usernfc u ON u.snssb = t.serialnumber
WHERE u.snssb IS NULL AND t.serialnumber IS NOT NULL;
-- Expected: 0 rows
```

---

## 3. Post-Migration Verification Checklist

Run these on bpn_schema AFTER migration to confirm everything applied correctly:

```sql
-- ── TABLES ──────────────────────────────────────────────────

-- [V-01] All 10 new tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'components','log_timesheet_sap','ph3_order',
    'production_operations','progress_update_history',
    'qh3_order','sow_standard','sow_standard_attachments',
    'sow_template_lines','sow_templates'
  )
ORDER BY table_name;
-- Expected: 10 rows

-- ── COLUMNS ─────────────────────────────────────────────────

-- [V-02] operations has operation_no (not opr_no)
SELECT column_name FROM information_schema.columns
WHERE table_name='operations' AND column_name IN ('operation_no','opr_no');
-- Expected: only 'operation_no'

-- [V-03] operations has operation_text (not operationtext)
SELECT column_name FROM information_schema.columns
WHERE table_name='operations' AND column_name IN ('operation_text','operationtext');
-- Expected: only 'operation_text'

-- [V-04] sow has operation_text (not operationtext)
SELECT column_name FROM information_schema.columns
WHERE table_name='sow' AND column_name IN ('operation_text','operationtext');
-- Expected: only 'operation_text'

-- [V-05] sow has progress column
SELECT column_name FROM information_schema.columns
WHERE table_name='sow' AND column_name='progress';
-- Expected: 1 row

-- [V-06] timesheet_transaction has ssbr_id (not ssbr_ident)
SELECT column_name FROM information_schema.columns
WHERE table_name='timesheet_transaction' AND column_name IN ('ssbr_id','ssbr_ident');
-- Expected: only 'ssbr_id'

-- [V-07] timesheet_transaction has operation_no and order_no
SELECT column_name FROM information_schema.columns
WHERE table_name='timesheet_transaction' AND column_name IN ('operation_no','order_no');
-- Expected: 2 rows

-- [V-08] timesheet_transaction.state_flag is smallint
SELECT data_type FROM information_schema.columns
WHERE table_name='timesheet_transaction' AND column_name='state_flag';
-- Expected: 'smallint'

-- [V-09] timesheet_transaction.planhours is numeric
SELECT data_type FROM information_schema.columns
WHERE table_name='timesheet_transaction' AND column_name='planhours';
-- Expected: 'numeric'

-- [V-10] processcontroldata.operation_no is integer
SELECT data_type FROM information_schema.columns
WHERE table_name='processcontroldata' AND column_name='operation_no';
-- Expected: 'integer'

-- ── CONSTRAINTS ─────────────────────────────────────────────

-- [V-11] All expected constraints exist
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_schema='public'
  AND constraint_name IN (
    'operations_part_id_operation_no_key',
    'sow_codenumber_uniq',
    'uq_sow_order_operation',
    'chk_sow_actual_progress',
    'chk_sow_progress',
    'usernfc_snssb_unique',
    'workcenter_machineid_unique',
    'workcenter_workcenternew_unique'
  )
ORDER BY constraint_name;
-- Expected: 8 rows

-- [V-12] Old constraints removed
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_schema='public'
  AND constraint_name IN (
    'operations_part_id_opr_no_key',
    'sow_codenumber_unique'
  );
-- Expected: 0 rows

-- ── INDEXES ─────────────────────────────────────────────────

-- [V-13] Key new indexes exist
SELECT indexname FROM pg_indexes
WHERE schemaname='public'
  AND indexname IN (
    'idx_ts_state_flag','idx_ts_order_no','idx_ts_operation_no',
    'idx_sow_codenumber','idx_sow_sync_modified',
    'idx_pcd_tsnumber','uq_usernfc_nfcid',
    'idx_sow_part_name_trgm','idx_ts_full_name_trgm'
  )
ORDER BY indexname;
-- Expected: 9 rows

-- ── FUNCTIONS & TRIGGERS ────────────────────────────────────

-- [V-14] New functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema='public'
  AND routine_name IN ('fn_delete_dup_sow','trg_set_sync_modified');
-- Expected: 2 rows

-- [V-15] New triggers on sow exist, old one removed
SELECT trigger_name FROM information_schema.triggers
WHERE event_object_table='sow'
  AND trigger_schema='public'
ORDER BY trigger_name;
-- Expected: before_update_set_sync, trg_delete_dup_sow (NOT update_sow_updated_at)

-- ── VIEWS ───────────────────────────────────────────────────

-- [V-16] New views exist
SELECT table_name FROM information_schema.views
WHERE table_schema='public' AND table_name='vw_sow_orders';
-- Expected: 1 row

SELECT matviewname FROM pg_matviews
WHERE schemaname='public' AND matviewname='order';
-- Expected: 1 row

-- ── FOREIGN KEYS ────────────────────────────────────────────

-- [V-17] New FKs exist
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_schema='public'
  AND constraint_type='FOREIGN KEY'
  AND constraint_name IN (
    'fk_pcd_timesheet','fk_pp_process_category',
    'fk_puh_sow_operation','fk_timesheet_user',
    'sow_standard_component_id_fkey',
    'sow_standard_attachments_standard_id_fkey'
  )
ORDER BY constraint_name;
-- Expected: 6 rows

-- ── DATA INTEGRITY ──────────────────────────────────────────

-- [V-18] No data was lost in timesheet_transaction
SELECT count(*) FROM timesheet_transaction;
-- Compare with pre-migration count

-- [V-19] No data was lost in sow
SELECT count(*) FROM sow;
-- Compare with pre-migration count

-- [V-20] sow_standard_attachments table is empty (new table, expected)
SELECT count(*) FROM sow_standard_attachments;
-- Expected: 0 (new table)
```

---

## 4. Rollback Plan

If something goes wrong during migration:

```sql
-- The dry-run file ends with ROLLBACK — run that first to test
-- psql -U tag -h BPN_HOST -d bpn_schema -f bpn_migration_dryrun.sql

-- If actual migration was applied and you need to rollback specific items,
-- the safest rollbacks are:
--   1. DROP the new tables (they are empty)
--   2. Re-add old constraints with DROP CONSTRAINT + ADD CONSTRAINT
--   3. Column renames can be reversed: RENAME COLUMN back

-- ⚠️ Type changes (text→numeric, text→smallint) CANNOT be easily rolled back
-- if data was written in the new format. Always test dry-run first.
```
