# EWS Realtime SSE Architecture

Status: Implemented  
Date: 2026-07-01

## Decision

Dashboard EWS uses Server-Sent Events because the client only needs one-way realtime updates. KPI calculation is not done in the HTTP request path and not done in the SSE API process.

Critical distinction:

- Operational transactions only emit lightweight PostgreSQL notifications.
- A background Node.js job calculates KPI snapshots.
- The API only reads the latest `ews.kpi_snapshot` row and broadcasts it to connected SSE clients.

This avoids the bad pattern where 1000 dashboards each poll or each trigger its own database query.

## Runtime Flow

1. PostgreSQL remains the source of truth.
2. Statement-level triggers on source tables send `pg_notify('ews_source_changed', small_json)`.
3. `npm run ews:snapshot` listens to `ews_source_changed`.
4. The job debounces bursts, calculates KPI once, and upserts `ews.kpi_snapshot`.
   It also has one controlled safety interval because time-window KPIs can change even when no new transaction arrives.
5. A trigger on `ews.kpi_snapshot` sends `pg_notify('ews_snapshot_ready', small_json)`.
6. The API listens to `ews_snapshot_ready`, reads the latest snapshot once per API instance, and broadcasts SSE to all matching clients.
7. React uses `EventSource('/api/ews/stream?basis=today')` and accepts only newer full compact snapshots by `version`.

## Commands

Run migration first:

```powershell
"C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -d ptssb -f database/migrations/api/20260701_create_ews_layer.sql
```

Run API:

```powershell
cd apps/api
npm run start
```

Run background snapshot job in a separate process/container:

```powershell
cd apps/api
npm run ews:snapshot
```

Useful environment variables:

```text
EWS_SNAPSHOT_TARGETS=today
EWS_JOB_DEBOUNCE_MS=2500
EWS_JOB_INTERVAL_MS=60000
EWS_JOB_RUN_ONCE=0
EWS_JOB_ADVISORY_LOCK_KEY=27112026
EWS_JOB_DB_POOL_MAX=4
EWS_JOB_PROGRESS_LOG_MS=15000
EWS_JOB_QUERY_TIMEOUT_MS=120000
EWS_JOB_STATEMENT_TIMEOUT_MS=120000
EWS_CALCULATE_ADOPTION_IN_MAIN=0
EWS_ADOPTION_SOURCE=machine
EWS_ADOPTION_JOB_INTERVAL_MS=600000
EWS_ADOPTION_JOB_RUN_ONCE=0
EWS_SSE_HEARTBEAT_MS=25000
EWS_SSE_SNAPSHOT_POLL_MS=15000
EWS_REFRESH_DEBOUNCE_MS=1500
EWS_SSE_MAX_CLIENTS=1500
EWS_SNAPSHOT_STALE_MS=120000
```

## Connection Management

- SSE endpoint: `GET /api/ews/stream?basis=today`.
- API sends `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, and `X-Accel-Buffering: no`.
- Heartbeat is sent every 25 seconds by default.
- Browser `EventSource` handles automatic reconnect. Server also sends `retry: 3000`.
- Client receives `snapshot` events as full compact dashboard state.
- Each `snapshot` event includes an SSE `id` and payload `version` based on `ews.kpi_snapshot.id`.
- On reconnect, the server sends the latest full compact snapshot. No replay buffer is required for this phase.
- The client ignores snapshot events whose `version` is less than or equal to the latest version already applied.

## Payload Rules

SSE payload intentionally excludes raw KPI detail such as bucket samples and diagnostic arrays. It sends a full compact snapshot:

- overall status and score
- window metadata
- compact KPI cards
- top issues
- correction queue counters
- calculation metadata
- freshness metadata: `snapshot_age_seconds`, `freshness_status`, and threshold

Example:

```text
id: 174
event: snapshot
data: {"version":174,"basis":"today","window_end":"2026-07-01T08:00:00Z","calculated_at":"2026-07-01T08:00:03Z","snapshot_age_seconds":12,"freshness_status":"FRESH","data":{}}
```

Drilldown endpoints can fetch heavier detail on demand. Do not push heavy detail to every dashboard viewer.

## Health Check

Troubleshooting endpoint:

```text
GET /api/ews/health
```

Typical response:

```json
{
  "snapshot_available": true,
  "last_snapshot_at": "2026-07-01T08:00:03Z",
  "snapshot_age_seconds": 12,
  "freshness_status": "FRESH",
  "latest_version": 174,
  "sse_clients": 283,
  "listener_connected": true,
  "job_expected_interval_ms": 60000
}
```

This endpoint is for troubleshooting and monitoring. It must not be used by dashboard clients as a polling replacement.

## Horizontal Scaling

PostgreSQL `LISTEN/NOTIFY` is acceptable for a small number of API and job instances. Every API instance receives `ews_snapshot_ready` and performs one lightweight snapshot read, then broadcasts to its own connected clients.

For multiple API containers:

- Use sticky sessions if the load balancer has aggressive connection rebalancing.
- Disable proxy buffering for SSE.
- Raise file descriptor limits for 1000+ open connections.
- Keep Node process count reasonable; each SSE connection is mostly idle but still consumes memory/socket descriptors.

For multiple job containers, do not let all of them calculate the same snapshot. The current job uses PostgreSQL advisory lock:

```sql
SELECT pg_try_advisory_lock(<fixed_lock_key>);
```

If the lock is already held, the process skips calculation and logs that another job is active. The lock is released after calculation, including failure paths.

The job pool needs at least 4 connections: one long-lived `LISTEN` client, one advisory-lock client, and spare connections for KPI SQL. Setting `EWS_JOB_DB_POOL_MAX` below 4 is unsafe and the job will raise it to 4.

Additional options:

- Run exactly one `ews:snapshot` replica.
- Use Redis Pub/Sub or a queue as an event bus/leader coordination layer if deployment already has Redis.

Redis should be an event bus here, not the primary source of truth and not required as the main KPI cache. The durable dashboard state remains `ews.kpi_snapshot`.

## PostgreSQL Optimization

- Source-table triggers are statement-level, not row-level, to avoid notify storms on bulk operations.
- Trigger payload is small and contains only table/op/timestamp.
- PostgreSQL `LISTEN/NOTIFY` is a realtime hint, not a durable queue. Notifications can be missed while a listener is down.
- KPI calculation is debounced in the background job.
- The controlled safety interval must remain enabled so missed notifications are eventually corrected.
- Keep `ews.kpi_snapshot` indexed by `(grain, scope_type, scope_key, window_end DESC)`.
- Add or validate indexes on source-table time columns before enabling high-frequency recalculation:
  - `timesheet_transaction(longdate_checkin, workcentercode, activitytype)`
  - `mch_transaction(startdatetime, machineid, statusid)`
  - `mch_machine_ping_log(checked_at DESC)`
  - `sap_timesheet_staging(status, created_at)`
- Do not calculate KPI inside transaction triggers.
- Do not make dashboard clients fetch after notification.

## Adoption Cadence

Adoption has two supported sources:

- `machine`: lightweight machine-only KPI from `public.mch_productiondata`. It calculates gap duration from `statusid = 5` plus `statusid = 2` records whose `enddatetime - startdatetime` is more than 5 minutes, then publishes `adoption_pct = 100 - gap_pct`, because dashboard thresholds treat higher values as better.
- `all`: older full coverage logic from 5-minute buckets across `mch_transaction` and `timesheet_transaction`.

The current default is `machine`.

Current rule:

- Main EWS snapshot does not calculate Adoption by default.
- `EWS_CALCULATE_ADOPTION_IN_MAIN=1` can force old behavior for testing only.
- Main snapshot reuses the latest cached Adoption value from `ews.adoption_summary_snapshot` for `EWS_ADOPTION_SOURCE`, then falls back to `ews.kpi_snapshot` if available.

Switch source:

```text
EWS_ADOPTION_SOURCE=machine
```

or:

```text
EWS_ADOPTION_SOURCE=all
```

Recommended next step:

- Dedicated tables now exist:
  - `ews.adoption_bucket_snapshot`
  - `ews.adoption_summary_snapshot`
- Fill the selected source from `npm run ews:adoption` every 10 minutes.
- For one-shot local verification, run `EWS_ADOPTION_JOB_RUN_ONCE=1 node jobs/ewsAdoptionBucketJob.js`.
- Keep dashboard SSE reading only the compact `ews.kpi_snapshot`.
- Use drilldown endpoints for bucket samples and missing-time detail on demand.

## Nginx Notes

For production reverse proxy, SSE locations need buffering disabled:

```nginx
location /api/ews/stream {
  proxy_pass http://api/ews/stream;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 1h;
  add_header X-Accel-Buffering no;
}
```

## Known Limitation

This implementation removes polling and prevents per-client database work. It does not make the KPI SQL itself cheap. If KPI calculation still takes too long, the next objective is to optimize the background job queries or pre-aggregate source facts, not to move calculation back into the API request path.

## Resilience Rules

- Every SSE event must include a monotonically increasing `version` or snapshot id.
- New or reconnected clients should receive the latest full compact snapshot.
- Client must ignore any event with `version` less than or equal to its current version.
- If snapshot age exceeds the configured freshness threshold, dashboard must show a stale-data warning.
- PostgreSQL NOTIFY is treated only as a realtime hint, not a durable queue.
- The controlled safety interval must remain enabled.
- Background snapshot job must use PostgreSQL advisory lock to prevent duplicate KPI calculation.
- Do not calculate KPI inside PostgreSQL triggers, API HTTP request handlers, or SSE broadcast code.
