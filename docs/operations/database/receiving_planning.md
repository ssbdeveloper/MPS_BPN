---
tags: [domain/sow]
---

# Receiving, Component Breakdown, SOW, and Shipping Schema Plan

Source of truth for this plan: `database/schema_receiving_revised.sql`.

This document reviews and documents the revised schema for shipping and receiving. The revised version is preferred over the earlier normalized design.

## Summary

The revised schema is broadly suitable for the current MPS2 flow:

```text
receiving_orders
  -> receiving_components
      -> optional components.component_id soft reference
      -> optional production_order text reference
  -> shipping_records

receiving_orders.ssbr_ident <-> sow.ssbr_id
sow.order_no <-> ph3_order/qh3_order/prod order data
```

Overall verdict: **OK as a practical first implementation**, with a few important caveats.

The simplification is good:

- `customers` and `customer_sites` merged into one `customers` table.
- `equipment_models` removed; `model_code` is stored as a receiving snapshot and references `components.model` when matched.
- `staff` replaced by `users`, which can support future login/audit.
- `part_categories` and `packing_types` remain lookup tables, which is still reasonable.
- No direct FK to `sow`, which is correct because `sow.ssbr_id` is not unique and has many operation rows per SSBR.

## Compatibility With Existing Local Schema

Checked against local PostgreSQL via MCP.

Existing tables relevant to this design:

- `sow`
- `components`
- `ph3_order`
- `qh3_order`
- `production_operations`
- `workcenter`
- `usernfc`

No existing local tables currently conflict with:

- `users`
- `customers`
- `part_categories`
- `packing_types`
- `receiving_orders`
- `receiving_components`
- `shipping_records`

Important existing column compatibility:

| Revised schema | Existing target | Compatibility |
| --- | --- | --- |
| `receiving_orders.ssbr_ident varchar(50)` | `sow.ssbr_id text` | OK as soft join. No FK recommended. |
| `receiving_components.component_id bigint` | `components.component_id bigint` | OK as soft reference only. Join to `components`, but do not enforce FK. |
| `receiving_components.production_order varchar(100)` | `ph3_order.order_no`, `qh3_order.order_no`, `production_operations.order_number` | OK as soft reference; formats may differ. |
| `receiving_components.model_code varchar(50)` | `components.model text`, `sow.model text` | OK as snapshot/reference value. |
| `users` | `usernfc` | No table conflict, but concept overlap must be clear. `users` is app/staff login; `usernfc` is operator/NFC master. |

## Table Review

### `users`

Purpose: app/staff login and audit identity for `received_by_id` and `send_by_id`.

This is acceptable if receiving/shipping will have authenticated users. It is more useful than a simple `staff` lookup if future screens need login roles.

Notes:

- `password_hash` implies a real auth flow. Do not store sample hashes in production.
- Add role constraints later only after roles stabilize. A free-text `role` is fine for now.
- This table does not replace `usernfc`; keep them separate.

### `customers`

Purpose: customer plus site/location in one table.

This simplification is good. It avoids over-normalizing `customer_sites` before the receiving data is proven stable.

Ambiguity:

- `UNIQUE(name, site_name)` in PostgreSQL allows multiple rows where `site_name IS NULL` for the same `name`.
- If a customer without site should be unique, add a unique expression index:

```sql
CREATE UNIQUE INDEX uq_customers_name_site_normalized
ON customers (name, COALESCE(site_name, ''));
```

Do not keep both the table constraint and this index unless you intentionally want both. Prefer the expression index if `site_name` can be null.

### `part_categories` and `packing_types`

Purpose: small lookups.

These are reasonable and not over-engineered. They are stable enough to model as lookup tables.

### `receiving_orders`

Purpose: one receiving header per `ssbr_ident`.

This is logical. `ssbr_ident` is the upstream key that links to `sow.ssbr_id`.

Good choices:

- `ssbr_ident` is unique.
- `customer_id` is required.
- `received_date` is required.
- `raw_sow_text` keeps original CSV/SOW scope text for audit.
- No FK to `sow`, avoiding circular dependency and many-row ambiguity.

Missing or ambiguous:

- No `status`. If receiving is always a historical import, this is fine. If this becomes an operational screen, add status.
- No `created_by` / `updated_by`. You have `received_by_id`, but audit actor and receiving actor may differ.
- `reff_number` should probably be renamed to `ref_number` or `reference_number` for consistency.

Recommended minimal optional additions:

```sql
ALTER TABLE receiving_orders
ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'received',
ADD COLUMN created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN updated_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
```

Possible statuses:

```text
draft, partial, received, in_progress, completed, cancelled
```

### `receiving_components`

Purpose: component breakdown under each receiving order, including parent-child hierarchy.

This is the core table and is mostly correct.

Good choices:

- `receiving_order_id` cascades on delete.
- `parent_component_id` supports level 1 / level 2 breakdown.
- `part_level` follows the workshop breakdown pattern:
  - `part_level = 1` is the parent component.
  - Subsequent `part_level = 2` rows are children of the latest level 1 row.
  - A new `part_level = 1` starts a new parent group.
- `component_id` optional soft reference to existing `components`.
- `part_number`, `part_description`, and `model_code` remain available as document snapshots even when no `components` record exists.
- `model_code` as text is simpler than an `equipment_models` table.
- `production_order` remains a soft reference, which is safer because production order formats may differ.

Ambiguity:

- No quantity fields. If each row means one component only, this is fine. If one CSV row can represent multiple items, add quantity fields.
- No component receiving status/condition. If partial receiving or damaged/hold status matters, add it here.
- `part_level` and `parent_component_id` can conflict if import/business logic is wrong. Example: `part_level = 2` with `parent_component_id IS NULL`. This is handled by import logic using the latest level 1 row as parent, and should be checked with verification queries.

Recommended minimal optional additions for real receiving:

```sql
ALTER TABLE receiving_components
ADD COLUMN qty_expected NUMERIC(12,2) NOT NULL DEFAULT 1,
ADD COLUMN qty_received NUMERIC(12,2) NOT NULL DEFAULT 1,
ADD COLUMN component_status VARCHAR(30) NOT NULL DEFAULT 'received',
ADD COLUMN condition_note TEXT;
```

Possible component statuses:

```text
expected, partial, received, hold, damaged, returned, scrapped
```

### `shipping_records`

Purpose: outbound shipping/return records.

This is useful, and the current revised schema matches the confirmed business rule.

Current design:

```sql
receiving_order_id INTEGER NOT NULL UNIQUE REFERENCES receiving_orders(id)
```

This means one receiving order can only have one shipping record.

Confirmed business rule:

```text
One SSBR-ID is unique.
Workshop may break components down during work.
Before delivery, components are assembled again under the same SSBR-ID.
Therefore one shipment record per SSBR-ID is acceptable.
```

If the business later needs more flexible shipment history, a single SSBR may need:

- partial shipment
- re-shipping
- return-to-stock
- split delivery
- shipping only one component while other components remain open

Only use this if partial shipping or re-shipping becomes a real requirement:

```sql
-- Use only if table has not been deployed yet:
-- remove UNIQUE from receiving_order_id

-- Add optional component-level link:
component_id INTEGER
```

Recommended practical DDL shape:

```sql
CREATE TABLE shipping_records (
    id                      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receiving_order_id      INTEGER NOT NULL REFERENCES receiving_orders(id) ON DELETE RESTRICT,
    component_id            INTEGER,
    delivery_note_number    VARCHAR(100),
    send_by_id              INTEGER REFERENCES users(id) ON DELETE SET NULL,
    destination             VARCHAR(200),
    consignment_notes       VARCHAR(200),
    shipping_list           VARCHAR(200),
    freight_cost_bill       VARCHAR(100),
    shipment_type           VARCHAR(30) NOT NULL DEFAULT 'return_to_customer',
    shipment_status         VARCHAR(30) NOT NULL DEFAULT 'draft',
    qty_shipped             NUMERIC(12,2) NOT NULL DEFAULT 1,
    delivery_date           DATE,
    return_to_stock_date    DATE,
    dn_received_by_customer DATE,
    dn_received_by_ssb      DATE,
    dn_submit_date          DATE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);
```

Possible shipment types:

```text
return_to_customer, partial_return, re_shipping, return_to_stock
```

Possible shipment statuses:

```text
draft, shipped, delivered, received_by_customer, closed, cancelled
```

For the current receiving flow, keep the current `UNIQUE`.

## Relationship Review

### Receiving to SOW

Use soft join:

```sql
receiving_orders.ssbr_ident = sow.ssbr_id
```

Do not add FK to `sow.ssbr_id` because:

- `sow.ssbr_id` is not unique.
- One SSBR can map to many SOW operation rows.
- Receiving is upstream; SOW may be generated/imported later.

Recommended query:

```sql
SELECT
  ro.ssbr_ident,
  s.order_no,
  s.operation_no,
  s.part_number,
  s.part_name,
  s.workcenter,
  s.progress
FROM receiving_orders ro
LEFT JOIN sow s ON s.ssbr_id = ro.ssbr_ident;
```

### Component Parent-Child

The self-reference is correct:

```sql
receiving_components.parent_component_id -> receiving_components.id
```

Keep `part_level` for easy reporting, but validate import rules:

- level 1 should have `parent_component_id IS NULL`
- level 2 should have `parent_component_id IS NOT NULL`

### Component Master

The optional soft reference is correct:

```sql
receiving_components.component_id -> components.component_id
```

Use `components` as the master reference for:

- `components.model`
- `components.part_name`
- `components.part_number`

Keep `part_number`, `part_description`, and `model_code` in `receiving_components` as snapshots. This preserves the original receiving document and handles CSV values that do not exist in `components`.

Do not add a foreign key here. Receiving data can come from CSV/SAP/customer documents before the component master is complete, so this should remain a join-only reference.

### Production Order

Keep as soft reference:

```sql
receiving_components.production_order
```

Do not FK to `ph3_order`, `qh3_order`, or `production_operations` yet because order formats and source systems can differ.

### Shipping

Current revised design links shipping at order level:

```sql
shipping_records.receiving_order_id -> receiving_orders.id
```

That is enough for simple one-time return shipping. Add `component_id` only if you need partial component shipping.

## Recommended Indexes

The revised index list is mostly good.

Keep:

```sql
CREATE INDEX idx_ro_customer_id    ON receiving_orders(customer_id);
CREATE INDEX idx_ro_received_date  ON receiving_orders(received_date);
CREATE INDEX idx_ro_ssbr           ON receiving_orders(ssbr_ident);
CREATE INDEX idx_ro_received_by    ON receiving_orders(received_by_id);

CREATE INDEX idx_rc_order          ON receiving_components(receiving_order_id);
CREATE INDEX idx_rc_parent         ON receiving_components(parent_component_id);
CREATE INDEX idx_rc_prod_order     ON receiving_components(production_order);
CREATE INDEX idx_rc_model_code     ON receiving_components(model_code);
CREATE INDEX idx_rc_component_id   ON receiving_components(component_id);

CREATE INDEX idx_sr_order          ON shipping_records(receiving_order_id);
CREATE INDEX idx_sr_delivery_date  ON shipping_records(delivery_date);
CREATE INDEX idx_sr_send_by        ON shipping_records(send_by_id);
```

Add if search by part number will be common:

```sql
CREATE INDEX idx_rc_part_number ON receiving_components(part_number);
```

Add if customer site lookups will use both name and site:

```sql
CREATE INDEX idx_customers_name_site ON customers(name, site_name);
```

## Ambiguities To Decide

1. **Can receiving be partial or component quantity > 1?**  
   If yes, add `qty_expected`, `qty_received`, and `component_status` to `receiving_components`.

2. **Should `customers.site_name` be nullable?**  
   If yes, use an expression unique index with `COALESCE(site_name, '')` if duplicates should be prevented.

## Confirmed Decisions

- `ssbr_ident` / SSBR-ID is unique.
- `shipping_records.receiving_order_id` should stay `UNIQUE` because shipping is tracked once per assembled SSBR-ID.
- `users` is the login table.
- Component hierarchy uses the sequential level rule: level 1 is parent, level 2 belongs to the latest level 1, next level 1 starts a new parent group.

## Current Recommendation

Use `database/schema_receiving_revised.sql` as the base schema.

Before applying it to production, decide only these two things:

1. Whether to add component-level quantity/status fields for partial receiving.
2. Whether to normalize nullable customer site uniqueness with `COALESCE(site_name, '')`.

Everything else can evolve later without over-engineering.

## Verification Queries

```sql
-- 1. Check receiving to SOW coverage
SELECT
  ro.ssbr_ident,
  COUNT(s.idsow) AS sow_operation_count
FROM receiving_orders ro
LEFT JOIN sow s ON s.ssbr_id = ro.ssbr_ident
GROUP BY ro.ssbr_ident
ORDER BY sow_operation_count DESC;

-- 2. Level-2 components without parent
SELECT COUNT(*) AS invalid_child_components
FROM receiving_components
WHERE part_level = 2
  AND parent_component_id IS NULL;

-- 3. Level-1 components with parent
SELECT COUNT(*) AS invalid_parent_components
FROM receiving_components
WHERE part_level = 1
  AND parent_component_id IS NOT NULL;

-- 4. Components that do not match components master
SELECT rc.part_number, rc.part_description, rc.model_code
FROM receiving_components rc
LEFT JOIN components c ON c.component_id = rc.component_id
WHERE rc.component_id IS NULL
ORDER BY rc.part_number
LIMIT 50;

-- 5. Shipping records per receiving order
SELECT
  ro.ssbr_ident,
  COUNT(sr.id) AS shipment_count
FROM receiving_orders ro
LEFT JOIN shipping_records sr ON sr.receiving_order_id = ro.id
GROUP BY ro.ssbr_ident
ORDER BY shipment_count DESC;
```
