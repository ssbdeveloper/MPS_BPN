# Architecture Reference — MPS

> Factual reference: stack, layout, routes, data, services, conventions.
> Load this when you need a specific fact; do not read it end to end for a UI task.
>
> **Provenance:** translated and condensed from the previous Indonesian context file on
> 2026-09-05. The facts were carried over, not re-verified against the running code. Anything
> here is a starting point, not proof — **verify against the code before relying on it**, and
> fix this file when you find it wrong.

---

## 1. Stack and layout

### Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend Framework | React 19.2 + Vite 7 | ESM (`"type": "module"`) |
| Language | JavaScript (JSX) | No TypeScript |
| Styling | Tailwind CSS v3.4 | + inline `bg-[#xxx]` for dynamic brand colors |
| Router | React Router v7.13 | `createBrowserRouter` |
| State Management | useState + useCallback | No Redux/Zustand/MobX — logic stays in components |
| Notifications | sonner v2 | `Toaster` in `App.jsx` with `richColors` |
| PWA | vite-plugin-pwa + Workbox v7 | Runtime caching /api/* (NetworkFirst 5min). The `google-fonts-cache` entry in vite.config is dead legacy config (unused SW rule, safe to delete). `src/templates/backuptc.html` STILL has a Google Fonts `<link>` — an offline-first violation, remove it |
| Charts | ECharts v6 + Recharts v3 | Both used across dashboard |
| Drag & Drop | @dnd-kit (core, sortable, modifiers) | |
| Icons | lucide-react v1 | |
| Animations | framer-motion v12 | |
| Backend API | Express.js 4 (Node 20, CommonJS) | In `apps/api/server.js` |
| Backend Python | FastAPI (Python 3.11, uvicorn) | In `apps/fastapi-msproject/main.py` — SOW plan-sync + TTS queue (the actual MS Project .mpp sync lives in Express `/ms-project`) |
| Database | PostgreSQL 15 | + Microsoft SQL Server (SSB_OEE for machine hours) |
| Reverse Proxy | Nginx (Alpine) | SSL/TLS 1.2-1.3, HTTP→HTTPS redirect, routes `/api/`, `/fastapi/`, `/tts/`, `/uploads/`, SPA fallback |
| Containerization | Docker Compose | 16 services in the main compose file — see the Docker table below |
| API Client | fetch (native) | No Axios |
| Dev port (frontend) | 5173 | Proxied `/api` → `http://localhost:3001` |
| API port | 3001 | |

### Folder ownership


- Frontend changes go in `apps/web`; run npm commands from that folder.
- Express API changes go in `apps/api`; route/controller imports must stay relative inside that app.
- FastAPI MS Project changes go in `apps/fastapi-msproject`.
- TTS worker changes go in `apps/tts-worker`; generated upload output belongs under `apps/api/uploads` or the Docker `/uploads` mount.
- Android heartbeat app ("MPS Heartbeat", Gradle/Kotlin) changes go in `apps/mobile`; kirim device heartbeat ke `POST /device-heartbeat`.
- SAP staging/posting code goes in `jobs/sap_staging`; shared staging helpers stay in `sap_staging_common.py` only when used by more than one SAP script.
- ETL sync jobs go in `jobs/etl`; export-only helpers go in `jobs/export`; SOW seed/export container files go in `jobs/sow`.
- SQL migrations and schema references go under `database`; do not put new migration files in app folders.
- Operational docs go in `docs`; current SAP docs go in `docs/sap`; old/historical docs go in `docs/archive`.
- Example payloads and manual test JSON go in `samples/sap_payloads`; do not keep test payloads inside runtime app folders.


### Monorepo

```text
MPS2/
├─ apps/
│  ├─ web/                 React 19 + Vite 7 frontend (PWA)
│  ├─ api/                 Express API: controllers, routes, rbac, jobs, uploads
│  ├─ fastapi-msproject/   FastAPI helper: SOW plan-sync + TTS queue
│  ├─ tts-worker/          Piper / Edge TTS worker for EWS announcements
│  └─ mobile/              Android (Kotlin) "MPS Heartbeat" → POST /device-heartbeat
├─ jobs/
│  ├─ sap_staging/         Stage / post / seed SAP payload rows
│  ├─ etl/                 SQL Server → Postgres ETL (machine hours, heartbeat, order sync)
│  ├─ export/              CSV / TXT export helpers
│  ├─ sow/                 SOW seed and export container files
│  └─ machine_ping/        Dockerfile for machine-ping-worker
├─ database/
│  ├─ migrations/          api/ (timestamped) + legacy/ + deferred/
│  ├─ seeds/               Seed data and helpers
│  ├─ schema/              schema_prod.sql — the only canonical dump
│  ├─ machinehours/        CSV data + import scripts
│  └─ toolsmanagement/     Tools-management SQL
├─ docs/                   Obsidian vault: standards/, reference/, concepts/, log/, planning/, …
├─ samples/                sap_payloads/, excel/, media/
├─ infra/                  docker/ and nginx/ (config + SSL material)
├─ aws/                    sap-ph3-order-lambda — inbound SAP order feed → ph3_order
├─ backups/                pg_dump output (gitignored)
├─ export/                 Mount target for sow_exporter (/data/export)
├─ tools/msproject-v2/     Active MS Project VBA client (config.ini, checkout/checkin)
└─ scripts/                Operational helpers, deslop/gate, git hooks
```

### Commands

| Command | Purpose |
|---|---|
| `node scripts/gate.mjs` | All T0 checks: deslop, lint, build |
| `node scripts/deslop.mjs --staged\|--all\|--track-a` | Design-contract check |
| `npm --prefix apps/web run dev` | Frontend on :5173, `/api` proxied to :3001 |
| `npm --prefix apps/web run build` | Production build into `dist/` |
| `npm --prefix apps/web run lint` | ESLint |
| `node apps/api/server.js` | Express API on :3001 (`npx nodemon server.js` in dev) |
| `node database/migrate.js` | Apply migrations via the `schema_migrations` ledger |
| `scripts/deploy.sh build\|start\|stop\|restart\|status\|logs api` | Docker lifecycle |

---

## 2. Frontend routes

> Guard types: **PIN** = `ProtectedRoute` (sessionStorage `isVerified`); **RBAC:x** = `RequireFeature(x)` (permission from sessionStorage `authPermissions`). Both are client-side only.

| Path | Component | Guard | Module |
|------|-----------|-------|--------|
| `/` , `/welcome` | `WelcomePage` | — | Core |
| `/LandingPage` , `/operations-hub` | `OperationsHubPage` | — | Core |
| `/ews/:type/detail` | `EwsDetailPage` | — | EWS |
| `/ews/notifications` | `EwsNotificationsPage` | — | EWS |
| `/ews/roster` | `EwsRosterPage` | RBAC:roster_operator | EWS |
| `/ews/roster/config` | `EwsRosterConfigPage` | RBAC:roster_operator | EWS |
| `/ews/issue/:issueKey` | `EwsIssueDrillPage` | — | EWS |
| `/sap-log` | `SapLogPage` | — | Core |
| `/order-progress-dashboard` | `OrderProgressDashboardPage` | — | Core |
| `/login-timesheet` | `LoginTimesheetPage` | — | TIMESHEET |
| `/timesheet` | `TimesheetPage` | — | TIMESHEET |
| `/timesheet-mainmenu` | `TimesheetMainMenuPage` (variant dispatcher) | — | TIMESHEET |
| `/view-timesheet` | `TimesheetListPage` | — | TIMESHEET |
| `/timesheet-validation` | `TimesheetValidationPage` | PIN | TIMESHEET |
| `/operator-performance` | `OperatorPerformancePage` | PIN | TIMESHEET |
| `/timesheet-edit/:tsnumber` | `TimesheetEditPage` | — | TIMESHEET |
| `/log-timesheet` | `LogTimesheetPage` | — | TIMESHEET |
| `/select-job` | `SelectJobPage` (variant dispatcher) | — | TIMESHEET |
| `/select-machine` | `SelectMachinePage` | — | TIMESHEET |
| `/tts-audio-test` | `TtsAudioTestPage` | — | TIMESHEET |
| `/nfc-users` | `NfcUserListPage` | RBAC:nfc_users | TIMESHEET |
| `/create-edit-nfc` | `CreateEditNfcPage` | RBAC:nfc_users | TIMESHEET |
| `/unproductive` | `UnproductiveMenuPage` | — | TIMESHEET |
| `/dashboard` | `DashboardPage` | — | Core |
| `/setting` | `SettingPage` | — | Core |
| `/download` | `DownloadPage` | — | Core |
| `/editor-image` | `EditorImage` | — | Core |
| `/process-control` | `ProcessControlPage` | — | MACHINE_H |
| `/edit-parameter` | `EditParameterPage` | — | MACHINE_H |
| `/machine-hours-sqlserver` | `MachineHoursSqlServerPage` | — | MACHINE_H |
| `/machine-hours-validation` | `MachineHoursValidationPage` | PIN | MACHINE_H |
| `/component-tracking` | `ComponentTrackingPage` | — | PPC |
| `/kanban-board` | `KanbanLevelOnePage` | — | PPC |
| `/buffer-transaction` | `BufferTransactionPage` | — | PPC |
| `/sow-scheduling` | `SowSchedulingPage` (variant dispatcher) | — | PPC |
| `/sow-verification` | `SowVerificationPage` | — | PPC |
| `/shift-definition` | `ShiftDefinitionPage` | PIN | PPC |
| `/ms-project-hub` | `MsProjectHubPage` | PIN | PPC |
| `/ms-project-admin` | `MsProjectHubPage` (legacy alias) | PIN | PPC |
| `/receiving-shipment` | `ReceivingShipmentPage` | — | PPC |
| `/manage-user` | `ManageUserPage` (menu hub) | RBAC:manage_users | PPC |
| `/manage-users` | `ManageUsersPage` (user CRUD) | RBAC:manage_users | PPC |
| `/sow-orders` | `OrderListPage` | RBAC:sow_management | PE |
| `/sow-edit/revision/:orderNo` | `SowRevisionEditPage` | RBAC:sow_management | PE |
| `/sow-edit/:id` | `SowEditPage` | RBAC:sow_management | PE |
| `/sow-management` (parent) | `SowManagementPage` | RBAC:sow_management | PE |
| `/sow-management/list` | `SowStandardListPage` | — (under parent) | PE |
| `/sow-management/create` | `SowCreatePage` | — (under parent) | PE |
| `/sow-management/history` | `SowHistoryPage` | — (under parent) | PE |
| `/consumable-request` | `ConsumableRequestPage` | — | WAREHOUSE |
| `/tools-consumable-request` | `ToolsRequestHubPage` | — | WAREHOUSE |
| `/tools-request` | `ToolsRequestPage` | — | WAREHOUSE |
| `/consumable-control` | `ConsumableControlPage` | PIN | WAREHOUSE |
| `/tools-management` | `ToolsManagementPage` | PIN | WAREHOUSE |
| `*` | `NotFoundPage` (links to /operations-hub) | — | — |


All routes are lazy-loaded. Some TIMESHEET and PPC pages have `salvaging/` and `manufacturing/`
variants; a dispatcher picks one through `isManufacturing()` in `apps/web/src/config/appVariant.js`.

**The variant is database-driven, not a build flag.** `getVariant()` reads the runtime config
from `GET /config`, loaded by `loadConfig()` at boot in `apps/web/src/main.jsx` and cached in
`localStorage` for offline use. The source of truth is the single row `public.plant_config`
(`id=1`). `getVariant()` does not read `VITE_APP_VARIANT` at runtime (hard-coded default
`'salvaging'`). `APP_VARIANT` / `VITE_APP_VARIANT` now only serve as (a) the backend
`buildConfigFromEnv` fallback when the row is missing or the DB is down, and (b) input to
`apps/api/scripts/seed_plant_config.js`. Switching a plant's variant is an `UPDATE` on
`plant_config` followed by `reloadPlantConfig` — not an image rebuild.

**Timezone does not follow that mechanism** (revised 2026-09-02). `resolveTimezone()` in
`apps/api/config/timezone.js` is **env-first**: `.env TIMEZONE` wins, `plant_config.timezone` is
only a fallback, then the default `Asia/Makassar`. The reason: the Cikupa row was seeded
`Asia/Makassar` although Cikupa is WIB, while the Python stager already read the env — two
conflicting sources of truth. So: **identity and variant come from the DB row; timezone comes
from the env, with the row as fallback.** Changing a plant's timezone means editing `TIMEZONE`
in `.env` and restarting the container. `GET /config` publishes `resolveTimezone()` so the
frontend and the API never disagree, and `loadPlantConfig` writes a boot WARNING when the env
and the row differ. Design and rollout: `docs/deployment/PLANT_CONFIG_VARIANT_DESIGN.md`.

---

## 3. Backend

### Mounted routers

> 20 routers mounted in `server.js`. Endpoint counts per router are not tracked here — read the route file.

| Base Path | Description |
|-----------|-------------|
| `/timesheet` | CRUD, search, validation stats, bulk validation, SAP posting, CSV/Excel export, checkout |
| `/sow` | Standard CRUD, grouped orders, parts/operations, history, reports, planhours |
| `/sow-schedule` | SOW scheduling, shift rules, overtime, capacity |
| `/process-control` | Categories, parameters, choices, items, controls CRUD + validation |
| `/dashboard` | KPI, order status, workload, daily hours, operator efficiency, on-time, progress, heatmap |
| `/component-tracking` | Machines, SOW operations, buffer transactions |
| `/kanban` | Kanban order board (materialized view + refresh job) |
| `/machine-hours-sqlserver` | Machine hours from SQL Server, validation stats, health + WebSocket |
| `/machine-hours-validation` | Validation stats, group records |
| `/receiving-shipment` | Lookups, components, CRUD |
| `/consumable` | History, stock search, control tickets, approve/close/adjust/reject |
| `/tools` | Tool reservations/handovers |
| `/auth` | Login, change password, user CRUD, permissions |
| `/usernfc` | NFC user CRUD, search by NFC ID/SN/name |
| `/workcenter` | List all workcenters |
| `/production-operations` | List all, lookup, get by ID |
| `/ms-project` | MS Project sync (.mpp upload/import; consumed by the VBA client) |
| `/ews` | EWS KPI summary/detail/trend/actions/roster/notifications + SSE `/ews/stream` |
| `/config` | `GET /` — public subset of the plant profile (`plant_code`, `plant_name`, `variant`, `timezone`, `feature_flags`) from `plant_config`; fetched by the frontend at boot. `Cache-Control: max-age=60`, 503 while config is not ready |
| `/device-heartbeat` | Device/tablet heartbeat — `POST /` from the Android app (`X-Device-Token`), `GET /fleet` for fleet monitoring |

### Important details

- **PostgreSQL pool:** `.env` from the repo root. In Docker the API connects through
  **pgbouncer:6432** (transaction pooling) with `DB_POOL_MAX` defaulting to 5; the in-code
  default is 10. The pool lives on `global.pool`, and a **second pool exists in `db.js`**
  (fallback `require("../db")`) — two distinct instances, handle with care.
- **Timezone:** `TIMEZONE` is currently `Asia/Makassar` (WITA), not `Asia/Jakarta`.
- **RBAC guard:** a global `rbacGuard` on every write (POST/PUT/PATCH/DELETE); identity from the
  `x-user-id` / `x-user-role` headers; **log-only unless `RBAC_ENFORCE=1`**.
- **Timestamps:** OIDs 1082/1114/1184 are forced to string — no JS `Date` conversion.
- **Realtime:** WebSocket at `/machine-hours-sqlserver/ws`; optional `mpsDashboardSocket` via
  `ENABLE_MPS_DASHBOARD_WS=1`; SSE at `/ews/stream`.
- **EWS jobs:** `apps/api/jobs/` (ewsSnapshotJob, ewsAdoptionBucketJob, ewsRosterGenerateJob),
  run as the `ews-*-job` compose services (`npm run ews:*`).
- **Uploads:** multer diskStorage into `apps/api/uploads/` (`sow-pdf/`, `ms-project-mpp/`,
  `operation-card/`, `announcement/`). The `consumable` upload uses `memoryStorage` and never
  hits disk.
- **SAP:** POST to the SAP CPI inbound URL (`SAP_INBOUND_URL`).
- **CORS:** all origins allowed.

### Environment variables

Single `.env` at the repo root, read by the backend (`apps/api/server.js`) and by the frontend
(`vite.config.js` sets `envDir` to the repo root).

Core: `DB_HOST`, `DB_NAME` (`ptssb`), `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `PORT` (3001),
`PLANT_SSB` (per plant, e.g. `5051` Balikpapan, `5100` Cikupa — identity also resolves through
the `plant_config` row; there is no hard-coded default), `TIMEZONE` (`Asia/Makassar`).

Groups: `SAP_INBOUND_*`, `SAP_STAGING_DB_*`, `SAP_STAGE_*`, `SQLSERVER_*`, `SRC_*` / `TGT_*`
(with `_BALIKPAPAN` / `_CIKUPA` / `_KUALA_KENCANA` / `_SEBAMBAN` variants), `EWS_*`, `AWS_PG*`,
`VITE_API_URL`, `VITE_API_PROXY_TARGET`, `VITE_APP_VARIANT`, `VITE_TTS_PROXY_TARGET`,
`CORS_ORIGIN`, `DRAWINGS_PATH`, `clientid_ph3` / `qh3`, `clientsecret_ph3` / `qh3`, `tokenurl`,
`url_ph3` / `qh3`.

---

## 4. Database (PostgreSQL 15, key tables)

| Table | Description |
|---|---|
| `timesheet_transaction` | Core timesheet: `tsnumber` PK, check-in/out, validation, SAP status |
| `sow`, `sow_standard` | Scope-of-work orders and operation templates |
| `order` | Materialized view aggregating SOW by `order_no` |
| `usernfc`, `workcenter`, `parts`, `operations`, `components` | Master data |
| `process_category`, `process_parameter`, `process_parameter_choicebase` | Process parameter definitions |
| `processcontroldata`, `processcontroldata_item` | Process control records linked to timesheets |
| `production_operations` | Production operations from SAP / ETL |
| `buffer_transaction` | Buffer and component movements (PPC component tracking, kanban) |
| `log_timesheet_sap`, `progress_update_history` | SAP posting audit, progress tracking |
| `ph3_order` / `qh3_order` | Order and operation master from SAP (AWS Lambda + ETL) — the SAP eligibility reference |
| `sap_timesheet_staging` + `sap_staging_source`, `sap_ops_request`, `sap_stage_cursor`, `sap_staging_eligibility_audit` | SAP posting queue, unique on `(source_system, source_key)`, status PENDING/POSTED/FAILED |
| `mch_productiondata`, `mch_transaction`, `mch_machines`, `mch_statustypes` | Machine hours from SQL Server SSB_OEE via ETL |
| `ews.machine_heartbeat_daily` | Daily machine heartbeat aggregate, one row per day per machine, PK `(work_date, machineno)`. Deliberately no raw-beat table |
| `mch_machine_ping_log` | Machine network ping log (machine-ping-worker) |
| `ews.*` | kpi_snapshot, kpi_threshold, adoption_bucket/summary_snapshot, shift_roster, operator_shift, rotation_config, action_table/history, alert_log, tts_notification, activity_type_ref |
| `ms_project_*` | MS Project sync: task, assignment, resource, calendar, revision, lock, audit_log |
| `sow_schedule*`, `sow_verification_log`, `sow_revision_history`, `sow_templates`, `sow_template_lines` | SOW scheduling, verification, revision, templates |
| `consumable_item/stock/ticket`, tools tables | Warehouse consumables and tools |
| `users`, `rbac.user_permissions` | Login users and per-user RBAC overrides |
| `shift_definition`, `device_status`, `tts_notification_order` | Shifts; tablet fleet monitoring (plus the daily counter `ews.device_heartbeat_daily`, fed by `POST /device-heartbeat`); TTS queue |
| `plant_config` | **Single row (`id=1`)**: plant identity + `variant` + `timezone` + `order_master_table` + `feature_flags` / `sap_rules` (jsonb). Runtime source of the variant via `GET /config`; seeded by `apps/api/scripts/seed_plant_config.js`; migration `20260727_plant_config.sql` |

- **Trigram (`gin_trgm_ops`) indexes exist on exactly two columns:**
  `timesheet_transaction.order_no` and `consumable_stock.material_description`.
  `serialnumber` is **btree**, and `full_name` / `part_name` have **no index at all**
  (verified 2026-07-28). This is the first thing to check for slow search endpoints.
- **Foreign keys:** process control → timesheet; SOW ↔ parts/operations;
  `fk_timesheet_user`: `timesheet_transaction.serialnumber → usernfc.snssb`
  (ON UPDATE CASCADE, ON DELETE RESTRICT), **validated**, not `NOT VALID`.
- **Canonical schema:** `database/schema/schema_prod.sql`, regenerated from production after
  each migration batch. Ledger: table `schema_migrations` plus `node database/migrate.js`.

---

## 5. Docker Compose services

| Service | Image / build | Port | Notes |
|---|---|---|---|
| `db` | postgres:15-alpine | 5433→5432 | Healthcheck, volume `postgres_data`, `./backups` mount, `shm_size: 1gb` |
| `pgbouncer` | bitnamilegacy/pgbouncer | 6432 (internal) | Transaction pooling; the API connects here, never to `db` directly |
| `api` | Node 20 Alpine (`./apps/api`) | 3001 (internal) | `DB_HOST=pgbouncer`, `DB_PORT=6432`, `DB_POOL_MAX=5` |
| `ews-snapshot-job`, `ews-adoption-job`, `ews-roster-job` | api image | — | `npm run ews:snapshot` / `:adoption` / `:roster` |
| `sap-stage-worker` | `./jobs/sap_staging` (Dockerfile.sap) | — | Loops `stage_machinehours.py --catchup` |
| `sap-post-worker` | sap_staging image | — | Loops `post_sap_staging.py` — posts complete days to SAP |
| `sap-ops-worker` | sap_staging image | — | `ops_worker.py --loop` — consumes the UI button queue |
| `frontend` | nginx:alpine (built React) | 80 (internal) | Build args `VITE_API_URL=/api`, `VITE_TTS_API_URL=""`. `APP_VARIANT` is an **api** service env, not a frontend one |
| `nginx` | nginx:alpine | 80, 443 | Reverse proxy + SSL; routes `/api/`, `/fastapi/`, `/tts/`, `/uploads/` |
| `sow_exporter` | Python (`./jobs` + `sow/Dockerfile`) | — | SOW export to `./export`; cron `*/10` via `docker compose run` |
| `machine-ping-worker` | `jobs/machine_ping/Dockerfile` | — | Pings M5051 machines, `cap_add: NET_RAW` |
| `fastapi` | Python 3.11 slim | 8000 (internal) | FastAPI SOW/TTS helper |
| `tts-worker`, `ews-tts-worker` | `./apps/tts-worker` | — | Piper TTS; `generate_ews_audio.py` with Edge TTS `id-ID-GadisNeural` |

Separate compose files: `jobs/etl/docker-compose.etl.yml` (`timesheet_sap_etl`) and
`jobs/etl/docker-compose.heartbeat.yml` (`machine_heartbeat_sync`).

---

## 6. Documentation vault

`docs/` is an Obsidian vault and the project's second brain. **Read `docs/KONVENSI.md` before
writing any document.**

- **Before designing or answering a systems question:** check `docs/concepts/` (durable
  knowledge) and `docs/log/` (per-session decisions). Do not relitigate settled decisions.
- **After a substantial session:** write `docs/log/YYYY-MM-DD-topic.md`, update the row in
  `docs/PLANNING.md`, and update any `docs/concepts/` note you touched.
- **Capture work requests immediately.** When the user asks for a plan, a to-do, or a recorded
  decision, write it to the right layer and report the path — do not ask for approval first, the
  user can revert. This applies to real work requests, not to every question.
  - Plan / design / PRD / new feature → a new doc in the matching folder, with frontmatter
    `type: plan|prd|design|feature`, `status:`, `tags: [domain/<x>]`, plus a row in
    `docs/PLANNING.md`.
  - Short to-do → a backlog row in `docs/PLANNING.md`. Session decision → `docs/log/`.
    Durable knowledge → `docs/concepts/`.
- **Status lifecycle** (frontmatter, work docs only): `planning` → `active` (some phases
  shipped) → `done` (all phases shipped) → `parked`. Reference docs carry no status. Live board:
  `docs/STATUS.md`.
- **Domain tag required** (nested `tags:`): `domain/ews|sow|timesheet|sap|msproject|security|ops|vault`
  — one primary, two maximum.
- **Verify status against the code, never guess.** "Has phase X shipped?" is answered by
  checking the migration, the endpoint, or `schema_prod`.

Boards: `docs/PLANNING.md` (work board), `docs/00-INDEX.md` (document map).

---

## 7. Code navigation

**codebase-memory-mcp** (`search_graph`, `trace_path`, `query_graph`, `get_architecture`),
project `D-website-MPS2`:

- **Discovery** — symbols, routes, structure, architecture, clusters — is reliable; use freely.
- **Callers, impact, dead code** — `trace_path` inbound, "who calls X", "is X used?" — the graph
  **under-reports**. Treat it as a hint. Cross-checking with grep is **mandatory** before any
  negative claim ("no callers", "dead code", "safe to change").
- **When delegating to a subagent**, restate that cross-check requirement in the subagent's
  prompt. It does not inherit it.

Limits and reproduction: `docs/concepts/codebase-memory-graph-accuracy.md`.

**graphify** (complementary, auto-refreshing): two stored graphs, `graphify-out/` (whole repo)
and `docs/graphify-out/` (vault), both gitignored.

- **Query first, never rebuild.** Architecture and file-relationship questions read the existing
  graph (`graphify query "..."` or `graph.json`) — instant, no extra tokens.
- **Code auto-refresh:** a post-commit hook (`graphify hook`) rebuilds the graph on every commit,
  AST only. Check with `graphify hook status`. **This is why husky must not be installed** — it
  repoints `core.hooksPath` and silently disables this hook.
- **Doc changes:** the hook does not touch document semantics. After significant docs edits, run
  `/graphify docs --update`.
