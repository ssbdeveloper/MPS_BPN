# Kanban Order Board

## Objective

Provide one canonical kanban card per normalized production order for operational monitoring. The API reads from `public.mv_kanban_order_board`, not from live joins across source tables.

## Source Tables

- `timesheet_transaction`
- `buffer_transaction`
- `sow`
- `ph3_order`
- `workcenter`

## Canonical Key

- `order_key = LTRIM(order_no, '0')`
- Leading-zero variants across source tables collapse into one row.

## Card Resolution Rule

One row per `order_key` is resolved with strict source precedence:

1. `running`
2. `queue`
3. `sow`

When multiple candidates exist inside the same source, the winner is selected by:

1. Most downstream lane
2. Latest event timestamp
3. Higher queue priority
4. Higher operation number

Parallel work does not create duplicate cards. The winning row carries:

- `parallel_count`
- `parallel_locations`
- `has_running_parallel`
- `has_queue_parallel`

## TECO Exclusion

- Any normalized order found in `ph3_order` with `order_description ILIKE '%TECO%'` is excluded from all helper views and from the materialized view.

## Aging Rule

Aging means time spent in the current effective kanban state.

- `running`
  - `state_entered_at = longdate_checkin`
  - `runtime_minutes = now - longdate_checkin`
- `queue`
  - `state_entered_at = buffer_transaction.timestamp`
  - `runtime_minutes = null`
- `sow`
  - `state_entered_at = latest known upstream movement timestamp from timesheet/buffer history when available`
  - `runtime_minutes = null`

Default aging bands:

- `running`: green `< 4h`, amber `< 8h`, red `>= 8h`
- `queue`: green `< 8h`, amber `< 24h`, red `>= 24h`
- `sow`: green `< 24h`, amber `< 72h`, red `>= 72h`

## Lane Order

1. Incoming / Pre-Process
2. Cutting / Weld Repair
3. Rough Machining
4. Precision Machining
5. Surface Treatment / Coating
6. Inspection / Test
7. Packing / Ready Dispatch
8. Support

## Database Objects

- `v_kanban_teco_orders`
- `v_kanban_running_candidates`
- `v_kanban_queue_candidates`
- `v_kanban_next_sow_candidates`
- `v_kanban_order_candidates`
- `v_kanban_order_resolved`
- `mv_kanban_order_board`
- `refresh_mv_kanban_order_board()`

## Refresh Strategy

- Main API source: `REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_kanban_order_board`
- Interval target: every `30-60` seconds
- The refresh function falls back to a non-concurrent refresh for the first population.

Suggested scheduler:

- application cron/job runner every `30-60` seconds
- or database-side scheduler if available in the deployment

## API Dependency

Endpoints should query only `mv_kanban_order_board`:

- `GET /kanban/board`
- `GET /kanban/summary`
- `GET /kanban/lanes/:location`

Optional manual refresh:

- `POST /kanban/refresh`

## Known Limitations

- `sow` fallback aging is derived from the latest known movement history for the order, not a guaranteed operation-to-operation handoff timestamp.
- Workcenter resolution depends on `workcenter.location` being populated and on code matching through `workcenternew`, `workcenterold`, `workcenterot`, or `machineid`.
- If a source row has no resolvable workcenter mapping, the location falls back to `Unassigned`.
