# Migration Plan: Column Rename & Schema Consistency
**Generated:** 2026-03-20
**Status:** PENDING — no changes applied yet
**Supersedes:** `fix_schema_consistency.sql` (drafted earlier, never applied)

---

## 1. Overview

This migration standardizes column naming across four database tables and fixes a type mismatch, then updates all backend code to match.

**In plain English:**

- `timesheet_transaction` uses old names (`seq`, `production_order`, `ssbr_ident`) that don't match the equivalent columns in `sow` (`operation_no`, `order_no`, `ssbr_id`). JOINs between these tables are currently written with mixed naming. This migration renames the timesheet columns to match.

- `sow` and `operations` both store operation description text in a column called `operationtext` (no underscore). Every other table uses `operation_text` (with underscore). This migration renames both to `operation_text`.

- `operations` uses `opr_no` for the operation number. This migration renames it to `operation_no` to match `sow.operation_no` and SAP's VORNR concept.

- `processcontroldata.operation_no` stores operation numbers as `text` while `sow.operation_no` is `integer`. This migration fixes the type.

- A composite UNIQUE constraint on `sow(order_no, operation_no)` is added as a prerequisite for a future FK from `timesheet_transaction`.

- Two missing indexes are added for query performance.

- A bug in `processControlDataController.js` (using bare `pool` instead of `db`) is fixed as part of the backend update.

---

## 2. Pre-flight Checklist

Run these queries **before** executing the migration SQL. Both must return **0 rows**. If either returns rows, fix the data first.

### Check 1 — `processcontroldata.operation_no` must be all-numeric or NULL

```sql
SELECT id_processcontroldata, operation_no AS bad_value
FROM processcontroldata
WHERE operation_no IS NOT NULL
  AND TRIM(operation_no) != ''
  AND operation_no !~ '^[0-9]+$';
```

**Expected:** 0 rows
**If rows returned:** Those rows contain non-integer text in `operation_no`. Inspect and correct before proceeding.

---

### Check 2 — No duplicate `(order_no, operation_no)` pairs in `sow`

```sql
SELECT order_no, operation_no, COUNT(*) AS cnt
FROM sow
WHERE order_no IS NOT NULL AND operation_no IS NOT NULL
GROUP BY order_no, operation_no
HAVING COUNT(*) > 1
LIMIT 10;
```

**Expected:** 0 rows
**If rows returned:** The `sow` table has duplicate operation rows per order. These must be resolved before the UNIQUE constraint (Step 5 of the SQL migration) can be added.

---

## 3. Execution Order

Apply changes in this exact order. Do not apply backend code changes before the SQL migration is committed.

### Step 1 — Run the SQL migration file

```bash
psql -h <host> -p 5433 -U tag -d ptssb -f API/migrations/rename_and_fix_schema.sql
```

This single file handles all database changes in one transaction:

1. Rename `timesheet_transaction.seq` → `operation_no`
2. Rename `timesheet_transaction.production_order` → `order_no`
3. Rename `timesheet_transaction.ssbr_ident` → `ssbr_id`
4. Rename `timesheet_transaction` constraint `timesheet_po_seq_unique` → `timesheet_order_opno_unique`
5. Rename index `idx_ts_production_order` → `idx_ts_order_no`
6. Rename `sow.operationtext` → `operation_text`
7. Rename `operations.opr_no` → `operation_no`
8. Rename `operations.operationtext` → `operation_text`
9. Rename constraint `operations_part_id_opr_no_key` → `operations_part_id_operation_no_key`
10. Change `processcontroldata.operation_no` from `TEXT` to `INTEGER`
11. Add `UNIQUE (order_no, operation_no)` constraint on `sow` as `uq_sow_order_operation`
12. Add index `idx_ts_operation_no` on `timesheet_transaction(operation_no)`
13. Add index `idx_pcd_operation_no` on `processcontroldata(operation_no)`

### Step 2 — Update `processControlDataController.js`

**File:** `API/controllers/processControlDataController.js`
Replace all 7 occurrences of `pool.query(` with `db.query(`.
Functions affected: `getAll`, `getBySN`, `getByWCT`, `create`, `validate`, `update`, `remove`.

### Step 3 — Update `timesheet_transactionController.js`

**File:** `API/controllers/timesheet_transactionController.js`

| Function | Changes |
|---|---|
| `create` | Destructure `production_order`→`order_no`, `ssbr_ident`→`ssbr_id`; SQL INSERT `seq`→`operation_no`, `production_order`→`order_no`, `ssbr_ident`→`ssbr_id` |
| `updateTimesheetadmin` | Destructure + SQL UPDATE: `production_order`→`order_no`, `ssbr_ident`→`ssbr_id`, `seq`→`operation_no` |
| `validationStats` | Search clause: `LOWER(production_order)` → `LOWER(order_no)` |
| `validationGroupRecords` | Search clause `t.ssbr_ident`→`t.ssbr_id`; SELECT list `t.production_order`→`t.order_no`, `t.ssbr_ident`→`t.ssbr_id`, `t.seq`→`t.operation_no`; JOIN expression `t.production_order \|\| t.seq::text` → `t.order_no \|\| t.operation_no::text` |
| `postToSap` | SQL SELECT `t.production_order`→`t.order_no`, `t.seq`→`t.operation_no`; JOIN condition updated; payload `row.production_order`→`row.order_no`, `row.seq`→`row.operation_no` (3 occurrences) |

### Step 4 — Update `sowController.js`

**File:** `API/controllers/sowController.js`

| Function | Changes |
|---|---|
| `create` | Destructure + INSERT SQL + values: `operationtext` → `operation_text` |
| `finish` | Destructure from `selectedactivity`: `production_order` → `order_no`; update values array |
| `createexcel` | Destructure + INSERT SQL + values: `operationtext` → `operation_text` |
| `updateexcel` | Destructure + UPDATE SQL + values: `operationtext` → `operation_text` |
| `upsert` | UPDATE query column + INSERT query column + both value arrays: `operationtext` → `operation_text` |
| `getBySSBRAndGroup` | SELECT list + response `.map()`: `operationtext` → `operation_text`, `row.operationtext` → `row.operation_text` |
| `getOperationsByPartId` | `ORDER BY opr_no` → `ORDER BY operation_no` |
| `createOperation` | Destructure, validation check, error message, INSERT SQL, values: `opr_no`→`operation_no`, `operationtext`→`operation_text` |
| `updateOperation` | Destructure, validation check, error message, UPDATE SQL, values: `opr_no`→`operation_no`, `operationtext`→`operation_text` |
| `createPartWithOperations` | INSERT SQL + values: `opr_no`→`operation_no`, `operationtext`→`operation_text` |
| `updatePartWithOperations` | INSERT SQL + values: `opr_no`→`operation_no`, `operationtext`→`operation_text` |
| `getCompleteSOW` | `ORDER BY opr_no` → `ORDER BY operation_no` |
| `getDrawingUsageReport` | `STRING_AGG` expression: `o.opr_no`→`o.operation_no`, `o.operationtext`→`o.operation_text` |
| `getPlanhours` | Query params: `production_order`→`order_no`, `seq`→`operation_no`; error message updated; codenumber concatenation updated |

### Step 5 — Restart the API server

```bash
# Docker:
docker compose restart api

# Or with pm2:
pm2 restart all

# Or direct:
node server.js
```

---

## 4. File Change Summary

| File | Type | What Changes |
|---|---|---|
| `API/migrations/rename_and_fix_schema.sql` | **NEW** | Full SQL migration (13 sub-steps in one transaction) |
| `API/controllers/processControlDataController.js` | **Modified** | Bug fix: 7× `pool.query` → `db.query` |
| `API/controllers/timesheet_transactionController.js` | **Modified** | Column renames in `create`, `updateTimesheetadmin`, `validationStats`, `validationGroupRecords`, `postToSap` |
| `API/controllers/sowController.js` | **Modified** | `operationtext`→`operation_text` and `opr_no`→`operation_no` across 13 functions; query param rename in `getPlanhours`; body var rename in `finish` |

**Total functions modified in JS:** 19
**Total SQL column renames:** 7 (across 3 tables)
**Total new DB objects:** 1 constraint + 2 indexes

---

## 5. Rollback Steps

The SQL migration runs inside a single `BEGIN`/`COMMIT` block. If it fails mid-way, PostgreSQL will automatically roll back the entire transaction — no partial state.

If the migration commits successfully but a problem is found afterward, reverse as follows:

### 5a — Revert SQL (run in psql)

```sql
BEGIN;

-- Reverse Step 13: drop added indexes
DROP INDEX IF EXISTS idx_pcd_operation_no;
DROP INDEX IF EXISTS idx_ts_operation_no;

-- Reverse Step 11: drop added unique constraint on sow
ALTER TABLE sow DROP CONSTRAINT IF EXISTS uq_sow_order_operation;

-- Reverse Step 10: revert processcontroldata.operation_no back to TEXT
ALTER TABLE processcontroldata
    ALTER COLUMN operation_no TYPE text
    USING operation_no::text;

-- Reverse Steps 8-9: revert operations renames
ALTER TABLE operations RENAME CONSTRAINT operations_part_id_operation_no_key
    TO operations_part_id_opr_no_key;
ALTER TABLE operations RENAME COLUMN operation_text TO operationtext;
ALTER TABLE operations RENAME COLUMN operation_no TO opr_no;

-- Reverse Step 6: revert sow rename
ALTER TABLE sow RENAME COLUMN operation_text TO operationtext;

-- Reverse Steps 1-5: revert timesheet_transaction renames
ALTER INDEX IF EXISTS idx_ts_order_no RENAME TO idx_ts_production_order;
ALTER TABLE timesheet_transaction
    RENAME CONSTRAINT timesheet_order_opno_unique TO timesheet_po_seq_unique;
ALTER TABLE timesheet_transaction RENAME COLUMN ssbr_id TO ssbr_ident;
ALTER TABLE timesheet_transaction RENAME COLUMN order_no TO production_order;
ALTER TABLE timesheet_transaction RENAME COLUMN operation_no TO seq;

COMMIT;
```

### 5b — Revert backend code

Restore the three controller files from git:

```bash
git checkout API/controllers/processControlDataController.js
git checkout API/controllers/timesheet_transactionController.js
git checkout API/controllers/sowController.js
```

Then restart the API server.

---

## 6. What Is NOT Changing

| Item | Reason |
|---|---|
| `API/routes/` files (all) | Route URLs are unaffected by column renames |
| `API/FastAPI/main.py` | Already uses `operation_no` correctly in SQL; does not SELECT `operationtext` so unaffected by that rename |
| `API/migrations/fix_schema_consistency.sql` | Superseded by this plan; kept as historical reference only — **do not run it** |
| `schema.sql` (root) | This is a pg_dump snapshot, not a live file; it will reflect reality the next time you run pg_dump |
| `react-timesheet/` frontend | Frontend changes (body field names sent in requests) are a separate, follow-up task |
| PK naming (`idsow`, `idrow`, `id_process`, etc.) | High risk / low value; deferred indefinitely |
| `sow.operationtext` in `vw_sow_orders` view | The view does not SELECT `operationtext`, only aggregates other columns — no change needed |
| `timesheet_transaction.planhours` type (TEXT) | Deferred — the migration file comments note it; type change requires separate decision |
| `timesheet_transaction.date_checkin/checkout` types | Deferred — covered in `fix_schema_consistency.sql` Step 2; not included here |
| `operations.update` broken transaction (`client` variable) | Out of scope — noted but not part of this migration |
