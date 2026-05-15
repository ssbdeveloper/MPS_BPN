# SOW Standard Feature — Implementation Plan

> Created: 2026-04-04
> Status: Phase 1 Complete — Awaiting confirmation for Phase 2

---

## Phase 1 — Existing Schema Findings

### Table: `workcenter`

| Column | Type | Notes |
|---|---|---|
| `idrow` | `INTEGER` | PK — GENERATED ALWAYS AS IDENTITY |
| `plant` | `INTEGER` | nullable |
| `workcenterot` | `VARCHAR(50)` | nullable |
| `condition` | `VARCHAR(50)` | nullable |
| `categoryhours` | `VARCHAR(50)` | nullable |
| `groupname` | `VARCHAR(50)` | nullable |
| `machineid` | `VARCHAR(50)` | **NO UNIQUE constraint** ← critical |
| `position` | `INTEGER` | nullable |
| `costcenter` | `INTEGER` | nullable |
| `costcenter_rate` | `INTEGER` | nullable |
| `workcenter_description` | `VARCHAR(50)` | nullable |
| `workcenternew` | `VARCHAR(50)` | UNIQUE |
| `workcenterold` | `VARCHAR(50)` | nullable |

**Constraints:**
- `workcenter_pkey` — PRIMARY KEY (`idrow`)
- `workcenter_workcenternew_unique` — UNIQUE (`workcenternew`)

**Indexes:** none beyond the PK and the unique constraint above.

**⚠️ Critical:** `machineid` has **no UNIQUE constraint and no unique index**.
A UNIQUE constraint must be added before `plant_op_standards` can reference it via FK.

---

### Table: `sow`

| Column | Type | Notes |
|---|---|---|
| `idsow` | `INTEGER` | PK |
| `order_no` | `TEXT NOT NULL` | |
| `operation_no` | `INTEGER NOT NULL` | |
| `ssbr_id` | `TEXT` | nullable |
| `part_number` | `TEXT` | nullable |
| `part_name` | `TEXT` | nullable |
| `model` | `TEXT` | nullable |
| `customer` | `TEXT` | nullable |
| `location` | `TEXT` | nullable |
| `wct_group` | `TEXT` | nullable |
| `workcenter` | `TEXT` | nullable |
| `operation_text` | `TEXT` | nullable |
| `workcenterdescription` | `TEXT` | nullable |
| `planhours` | `NUMERIC(10,2)` | nullable |
| `systemstatus` | `TEXT` | nullable |
| `confirmation` | `TEXT` | nullable |
| `status` | `TEXT` | nullable |
| `finish_date` | `DATE` | nullable |
| `codenumber` | `TEXT` | GENERATED AS `order_no \|\| operation_no` STORED |
| `weight` | `NUMERIC(5,2)` | nullable |
| `created_by` | `TEXT` | nullable |
| `type` | `TEXT` | nullable |
| `group` | `TEXT` | nullable |
| `category` | `TEXT` | nullable |
| `remark` | `TEXT` | nullable |
| `sync` | `TEXT` | DEFAULT `'new'` |
| `plan_start` | `DATE` | nullable |
| `plan_finish` | `DATE` | nullable |
| `actual_start` | `DATE` | nullable |
| `actual_finish` | `DATE` | nullable |
| `actual_progress` | `NUMERIC(5,2)` | CHECK 0–100 |
| `actual_hours` | `NUMERIC(10,2)` | nullable |
| `progress` | `INTEGER` | CHECK 0–100 |

**Constraints:**
- `sow_pkey` — PRIMARY KEY (`idsow`)
- `sow_codenumber_uniq` — UNIQUE (`codenumber`)
- `uq_sow_order_operation` — UNIQUE (`order_no`, `operation_no`)
- `chk_sow_actual_progress` — `actual_progress` BETWEEN 0 AND 100
- `chk_sow_progress` — `progress` BETWEEN 0 AND 100

**Indexes on `sow`:**

| Index Name | Type | Columns |
|---|---|---|
| `idx_sow_codenumber` | btree | `codenumber` |
| `idx_sow_model` | btree | `model` |
| `idx_sow_order_no` | btree | `order_no` |
| `idx_sow_part_name_trgm` | GIN (trigram) | `part_name` |
| `idx_sow_part_number` | btree | `part_number` |
| `idx_sow_ssbr_id` | btree | `ssbr_id` |
| `idx_sow_sync_modified` | btree (partial) | `order_no, operation_no` WHERE `sync = 'modified'` |
| `idx_sow_workcenter` | btree | `workcenter` |

**Triggers on `sow`:**
- `before_update_set_sync` — sets `sync = 'modified'` on UPDATE (via `trg_set_sync_modified()`)
- `trg_delete_dup_sow` — removes duplicate `codenumber` rows on INSERT

---

## Phase 2 — DDL Plan

> **Do not execute until confirmed.**

### Step 0 — Prerequisites Check

`workcenter.machineid` has **no UNIQUE constraint**. The FK from `plant_op_standards.machineid → workcenter.machineid` requires uniqueness. This migration must be run first.

```sql
-- Step 0: Add UNIQUE constraint on workcenter.machineid
ALTER TABLE public.workcenter
  ADD CONSTRAINT workcenter_machineid_unique UNIQUE (machineid);
```

> **Risk:** Will fail if duplicate `machineid` values already exist in the table.
> Before executing, verify with:
> ```sql
> SELECT machineid, COUNT(*) FROM public.workcenter
> GROUP BY machineid HAVING COUNT(*) > 1;
> ```
> If duplicates exist, they must be resolved first.

---

### Step 1 — `components`

Master catalog of physical components (part + model combination).

```sql
CREATE TABLE public.components (
    component_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    part_name     TEXT NOT NULL,
    model         TEXT NOT NULL,
    part_number   TEXT NOT NULL,
    UNIQUE (model, part_number)
);
```

---

### Step 2 — `sow_standard`

Standard repair operations per component. These are plant-agnostic — the "what to do" catalog.

```sql
CREATE TABLE public.sow_standard (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    component_id    INTEGER NOT NULL REFERENCES public.components(component_id),
    operation_no    INTEGER NOT NULL,
    operation_text  TEXT NOT NULL
);
```

---

### Step 3 — `plant_op_standards`

Plant-local standards: which workcenter and how many hours for each operation, per plant.

```sql
CREATE TABLE public.plant_op_standards (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    standard_id   INTEGER NOT NULL REFERENCES public.sow_standard(id),
    machineid     VARCHAR(50) NOT NULL REFERENCES public.workcenter(machineid),
    std_hours     NUMERIC(10,2),
    source_plant  TEXT    -- nullable; filled if adopted from another plant (e.g. 'BPN', 'SBN', 'KK')
);
```

---

### Step 4 — `sow_templates`

Named subsets of standard operations per component, for quick SOW population.

```sql
CREATE TABLE public.sow_templates (
    template_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    component_id   INTEGER NOT NULL REFERENCES public.components(component_id),
    template_name  TEXT NOT NULL,
    created_by     TEXT,
    created_at     TIMESTAMP DEFAULT NOW()
);
```

---

### Step 5 — `sow_template_lines`

Individual operation lines belonging to a template.

```sql
CREATE TABLE public.sow_template_lines (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    template_id  INTEGER NOT NULL REFERENCES public.sow_templates(template_id),
    standard_id  INTEGER NOT NULL REFERENCES public.sow_standard(id)
);
```

---

### Step 6 — Indexes

```sql
-- sow_standard
CREATE INDEX idx_sow_standard_component_id  ON public.sow_standard(component_id);

-- plant_op_standards
CREATE INDEX idx_plant_op_standard_id       ON public.plant_op_standards(standard_id);
CREATE INDEX idx_plant_op_machineid         ON public.plant_op_standards(machineid);

-- sow_template_lines
CREATE INDEX idx_sow_tmpl_lines_template_id ON public.sow_template_lines(template_id);
CREATE INDEX idx_sow_tmpl_lines_standard_id ON public.sow_template_lines(standard_id);
```

---

### Full Execution Order

```
0. ALTER TABLE workcenter ADD CONSTRAINT workcenter_machineid_unique UNIQUE (machineid)
1. CREATE TABLE components
2. CREATE TABLE sow_standard
3. CREATE TABLE plant_op_standards
4. CREATE TABLE sow_templates
5. CREATE TABLE sow_template_lines
6. CREATE INDEX x5
```

---

## Phase 3 — Execute DDL

> **Pending confirmation from Phase 2.**

Execution plan: run each step in order, verify success before proceeding.
Stop immediately and report on any error.

---

## Phase 4 — Seed Data from Excel

> **Pending Phase 3 completion.**

**Source file:** `sample_scope_of_work.xlsx`

### Excel Column Mapping

| Excel Column | Target |
|---|---|
| `part_name` | `components.part_name` |
| `model` | `components.model` |
| `part_number` | `components.part_number` |
| `operation_no` | `sow_standard.operation_no` |
| `operation_text` | `sow_standard.operation_text` |
| `balikpapan_workcenter` | `plant_op_standards.machineid` |
| `balikpapan_hours` | `plant_op_standards.std_hours` |
| `sebamban_workcenter` | `plant_op_standards.machineid` |
| `sebamban_hours` | `plant_op_standards.std_hours` |
| `kuala_kencana_workcenter` | `plant_op_standards.machineid` |
| `kuala_kencana_hours` | `plant_op_standards.std_hours` |

### Plant Code Mapping

| Excel Column Prefix | `source_plant` value |
|---|---|
| `balikpapan_*` | `'BPN'` |
| `sebamban_*` | `'SBN'` |
| `kuala_kencana_*` | `'KK'` |

### Seeding Steps

1. **Read Excel** — load all rows from `sample_scope_of_work.xlsx`

2. **Insert `components`** (upsert on `model, part_number`):
   ```sql
   INSERT INTO public.components (part_name, model, part_number)
   VALUES (...)
   ON CONFLICT (model, part_number) DO NOTHING
   RETURNING component_id, model, part_number;
   ```
   Build a lookup map: `(model, part_number) → component_id`

3. **Insert `sow_standard`** (per unique `component_id + operation_no`):
   ```sql
   INSERT INTO public.sow_standard (component_id, operation_no, operation_text)
   VALUES (...)
   RETURNING id, component_id, operation_no;
   ```
   Build a lookup map: `(component_id, operation_no) → standard_id`

4. **Insert `plant_op_standards`** — for each plant column that is **not empty**:
   - Look up `standard_id` from map in step 3
   - Verify `machineid` exists in `workcenter.machineid`
     - If not found: **skip row, log warning** with row details
   - Insert with appropriate `source_plant` value
   ```sql
   INSERT INTO public.plant_op_standards (standard_id, machineid, std_hours, source_plant)
   VALUES (...);
   ```

5. **Report** after completion:
   - Total rows inserted into each table
   - List of skipped rows: reason + row data (machineid not found in `workcenter`)

### Validation Queries (run after seeding)

```sql
-- Count per table
SELECT 'components'        AS tbl, COUNT(*) FROM public.components
UNION ALL
SELECT 'sow_standard'      AS tbl, COUNT(*) FROM public.sow_standard
UNION ALL
SELECT 'plant_op_standards' AS tbl, COUNT(*) FROM public.plant_op_standards;

-- Verify all plant_op_standards machineid exist in workcenter
SELECT p.machineid
FROM public.plant_op_standards p
LEFT JOIN public.workcenter w ON w.machineid = p.machineid
WHERE w.machineid IS NULL;
-- Should return 0 rows
```

---

## Entity Relationship Diagram

```
workcenter
  └── machineid (UNIQUE) ←─────────────────────────┐
                                                    │
components                                          │
  ├── component_id (PK)                             │
  │     ↑                                           │
  ├── sow_standard                                  │
  │     ├── id (PK)                                 │
  │     ├── component_id (FK → components)          │
  │     └── ← plant_op_standards                    │
  │               ├── standard_id (FK → sow_std)    │
  │               └── machineid (FK → workcenter) ──┘
  │
  └── sow_templates
        ├── template_id (PK)
        ├── component_id (FK → components)
        └── ← sow_template_lines
                  ├── template_id (FK → sow_templates)
                  └── standard_id (FK → sow_standard)
```

---

## Notes & Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | `workcenter.machineid` may have duplicates — UNIQUE alter will fail | Run duplicate check query before Phase 3 |
| 2 | Excel workcenter values may not match `workcenter.machineid` exactly (case, spaces) | Seed script trims + case-insensitive lookup; logs mismatches |
| 3 | `sow` trigger `before_update_set_sync` fires on UPDATE — inserting from template must set `sync = 'new'` explicitly to avoid unintended state | Template-insert API sets `sync = 'new'` |
| 4 | `trg_delete_dup_sow` deletes older rows with same `codenumber` on INSERT — inserting multiple operations for same order must be done one at a time (already the case) | N/A — trigger is compatible with sequential inserts |
