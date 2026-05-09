# Database Tuning Audit
**Generated:** 2026-03-22
**Last reviewed against schema.sql:** 2026-03-24
**Scope:** Post-migration state (after `rename_and_fix_schema.sql` applied)

> **Note:** `schema.sql` is the current database snapshot (post-migration). Status below reflects what is already in the DB vs what still needs to be done.

---

## Status Key
- ✅ **DONE** — already present in schema.sql / already fixed
- ❌ **PENDING** — not yet implemented
- 🆕 **NEW** — discovered during schema.sql review, was not in original audit

---

## Findings Summary

| # | Status | Priority | Category | Finding |
|---|---|---|---|---|
| 1 | ✅ DONE | 🔴 HIGH | Bug | `main.py` still queries `operationtext` — fixed 2026-03-23 |
| 3 | ✅ DONE | 🔴 HIGH | FK | `fk_pcd_timesheet` exists |
| 4 | ✅ DONE | 🔴 HIGH | FK | `fk_puh_sow_operation` exists |
| 5 | ✅ DONE | 🔴 HIGH | FK | `fk_pp_process_category` exists |
| 6 | ✅ DONE | 🟡 MEDIUM | Type | `timesheet_transaction.planhours` already NUMERIC(10,2) in schema |
| 7 | ✅ DONE | 🟡 MEDIUM | Index | `idx_ts_serialnumber` does not exist in schema (already removed) |
| 8 | ✅ DONE | 🟡 MEDIUM | Index | Index is already named `idx_ts_order_wc` in schema |
| 10 | ✅ DONE | 🟡 MEDIUM | Query | `validationStats` merged into single query with window functions — fixed 2026-03-24 |
| 11 | ✅ DONE | 🟡 MEDIUM | Query | `DATE()` wrapper replaced with range predicate in 4 locations — fixed 2026-03-24 |
| 13 | ✅ DONE | 🟡 MEDIUM | Constraint | `chk_sow_progress` CHECK (0–100) already exists in schema |
| 14 | ✅ DONE | 🟢 LOW | Type | `timesheet_transaction.state_flag` already SMALLINT in schema |
| 15 | ✅ DONE | 🟢 LOW | Type | `timesheet_transaction.std_foreman_hours` already NUMERIC(10,2) in schema |
| 18 | ✅ DONE | 🟢 LOW | Constraint | `timesheet_transaction.state_flag` DEFAULT `'1'::smallint` already set in schema |
| 20 | ✅ DONE (partial) | 🟢 LOW | Constraint | `usernfc.nfcid` UNIQUE index (`uq_usernfc_nfcid`) exists — NOT NULL still missing |
| 21 | ✅ DONE | 🟢 LOW | Index | `idx_sow_order_codenumber` not found in schema — already dropped |
| 22 | ✅ DONE | 🟢 LOW | Constraint | `chk_sow_actual_progress` CHECK (0–100) already exists in schema |
| 23 | ✅ DONE | 🟢 LOW | Index | GIN trigram indexes on `timesheet_transaction` already exist (`idx_ts_serialnumber_trgm`, `idx_ts_full_name_trgm`, `idx_ts_order_no_trgm`) |
| 24 | 🆕 ✅ DONE | 🔴 HIGH | Schema | Duplicate FK on `processcontroldata.tsnumber` — only `fk_pcd_timesheet` exists in schema, duplicate already removed |
| 25 | 🆕 ✅ DONE | 🔴 HIGH | Schema | Duplicate FK on `process_parameter.id_process` — only `fk_pp_process_category` exists in schema, duplicate already removed |
| 26 | 🆕 ✅ DONE | ℹ️ INFO | FK | `fk_timesheet_user`: `timesheet_transaction.serialnumber → usernfc(snssb)` exists (not previously documented) |

---

## Detailed Findings

---

### ✅ 1 — FIXED: `main.py` post-migration breakage

Fixed 2026-03-23. `/sow/get-missing` and `/sow/get-new` now query `operation_text`. Response dict keys updated to match.

---

### ✅ 3 — ALREADY EXISTS: FK `processcontroldata.tsnumber → timesheet_transaction`

`fk_pcd_timesheet` exists in schema.

---

### ✅ 4 — ALREADY EXISTS: FK `progress_update_history.operation_id → sow`

`fk_puh_sow_operation FOREIGN KEY (operation_id) REFERENCES sow(idsow) ON DELETE CASCADE` — confirmed in schema.

---

### ✅ 5 — ALREADY EXISTS: FK `process_parameter.id_process → process_category`

`fk_pp_process_category` exists in schema.

---

### 🆕 ✅ 24 — DONE: Duplicate FK on `processcontroldata.tsnumber` already removed

Schema.sql only contains `fk_pcd_timesheet`. The duplicate `fk_processcontroldata_timesheet` is absent — already dropped. No action needed.

---

### 🆕 ✅ 25 — DONE: Duplicate FK on `process_parameter.id_process` already removed

Schema.sql only contains `fk_pp_process_category`. The duplicate `fk_process_parameter_process` is absent — already dropped. No action needed.

---

### 🆕 26 — INFO: Undocumented FK `fk_timesheet_user`

`timesheet_transaction.serialnumber → usernfc(snssb) ON UPDATE CASCADE ON DELETE RESTRICT`

This FK already provides referential integrity for the NFC lookup. It means:
- A `timesheet_transaction` row can only be created if `serialnumber` exists in `usernfc.snssb`
- `ON DELETE RESTRICT` prevents deleting a user who has timesheet records
- This strengthens the case for Finding #12 (NOT NULL on serialnumber) — column is already constrained as a FK, adding NOT NULL makes the model explicit

No action required, informational only.

---

### ✅ 6 — DONE: `timesheet_transaction.planhours` already `NUMERIC(10,2)`

Confirmed in schema.sql: `planhours numeric(10,2)`. Migration already applied. No action needed.

---

### ✅ 14 — DONE: `timesheet_transaction.state_flag` already SMALLINT

Confirmed in schema.sql: `state_flag smallint DEFAULT '1'::smallint`. Both the type change (#14) and the DEFAULT (#18) are already applied. No action needed.

---

### ✅ 18 — DONE: `timesheet_transaction.state_flag` DEFAULT already set

Confirmed: `state_flag smallint DEFAULT '1'::smallint` in schema.sql. No action needed.

---

### ✅ 22 — DONE: `sow.actual_progress` CHECK constraint already exists

Confirmed in schema.sql: `CONSTRAINT chk_sow_actual_progress CHECK (((actual_progress IS NULL) OR ((actual_progress >= (0)::numeric) AND (actual_progress <= (100)::numeric))))`. No action needed.

---

### ✅ 23 — DONE: GIN trigram indexes on `timesheet_transaction` already exist

Confirmed in schema.sql:
- `idx_ts_serialnumber_trgm` — `gin (serialnumber gin_trgm_ops)`
- `idx_ts_full_name_trgm` — `gin (full_name gin_trgm_ops)`
- `idx_ts_order_no_trgm` — `gin (order_no gin_trgm_ops)`

No action needed.

---

### ✅ 21 — DONE: `idx_sow_order_codenumber` already dropped

No `idx_sow_order_codenumber` found in schema.sql. Index already removed. No action needed.

---

### ✅ 20 (partial) — UNIQUE exists, NOT NULL still missing

`uq_usernfc_nfcid UNIQUE INDEX` confirmed in schema.sql (line 1153). Uniqueness is enforced. However, `nfcid` column still has no `NOT NULL` constraint — NULL values can still be inserted and bypass the unique index.

**Remaining migration:**
```sql
-- Pre-check
SELECT COUNT(*) FROM usernfc WHERE nfcid IS NULL;

-- Apply only if 0 nulls
ALTER TABLE usernfc ALTER COLUMN nfcid SET NOT NULL;
```

---

### ✅ 10 — DONE: `validationStats` merged into single query

Fixed 2026-03-24. `statsQuery` + `groupsQuery` replaced with one query using window functions (`SUM(COUNT(*)) OVER ()`, `SUM(SUM(duration)) OVER ()`, etc.). Global stats read from `g_*` fields of first row. Eliminates one full table scan per request.

---

### ✅ 11 — DONE: `DATE()` wrapper replaced with range predicate

Fixed 2026-03-24. All four locations in `timesheet_transactionController.js` updated:
- `search` — `longdate_checkin` case uses range predicate
- `generateExport` — `longdate_checkin` / `longdate_checkout` use range predicate
- `validationStats` — range predicate in WHERE clause
- `validationGroupRecords` — range predicate in WHERE clause

Index `idx_ts_longdate_checkin` can now be used for range scans.

---


### ✅ 15 — DONE: `timesheet_transaction.std_foreman_hours` already NUMERIC(10,2)

Confirmed in schema.sql: `std_foreman_hours numeric(10,2)`. Migration already applied. No action needed.

---



---

## What Is NOT Changing (confirmed out of scope)

| Item | Reason |
|---|---|
| PK naming (`idsow`, `idrow`, `id_process`, etc.) | High risk / low value — deferred indefinitely |
| `timesheet_transaction.date_checkin / date_checkout TEXT` | Frontend-dependent format; separate migration needed |
| `sow` → `workcenter` FK | SAP may push codes not in master table; would cause insert failures |
| `production_operations` — all findings | Static/import table — no tuning applied |
| `mst_job` — all findings | Static SAP mirror table — no tuning applied |
| Materialized view `"order"` | Never queried by API; already superseded by `vw_sow_orders` |
| `processcontroldata.production_order TEXT` column | NOT renamed in migration — different concept from `timesheet.order_no` |

---

## Execution Order (pending only)

### Phase 1 — Indexes
*(All previously pending indexes are now DONE — no action needed)*

### Phase 2 — Constraints (require pre-checks → run `tuning_apply.sql`)
1. **#19** NOT NULL on `sow.order_no`
2. **#20** NOT NULL on `usernfc.nfcid` (UNIQUE already done)
3. **#12** NOT NULL on `timesheet_transaction.serialnumber` / `full_name`

### Phase 3 — Query rewrites
*(#10 and #11 fixed in `timesheet_transactionController.js` — 2026-03-24)*

---

## Pre-flight Checks

```sql
-- #12: NULL serialnumber or full_name in timesheet
SELECT COUNT(*) FROM timesheet_transaction WHERE serialnumber IS NULL OR full_name IS NULL;

-- #19: NULL order_no in sow
SELECT COUNT(*) FROM sow WHERE order_no IS NULL;

-- #20: null nfcid in usernfc (unique index already handles duplicates)
SELECT COUNT(*) FROM usernfc WHERE nfcid IS NULL;
```