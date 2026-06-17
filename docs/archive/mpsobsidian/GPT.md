# MPS2 Persistent Context

Last analyzed: 2026-04-26. This document is intended as persistent context for future AI assistance on this repository.

## Project Overview

MPS2 is a manufacturing timesheet, SOW, process-control, dashboard, and SAP/MS Project synchronization system.

The active application is split into:

- Frontend: `react-timesheet`, a Vite React PWA served by Nginx.
- Backend API: `API`, an Express.js service that handles timesheets, SOW, process parameters, NFC users, dashboards, file uploads, and SAP posting.
- Secondary API: `API/FastAPI`, a FastAPI service used by Microsoft Project VBA macros for SOW schedule synchronization.
- Database: PostgreSQL 15, database `ptssb`.
- Infra: Docker Compose with Postgres, Express API, React static frontend, reverse proxy Nginx, FastAPI, and a Python SOW/ETL exporter.
- Legacy/support folders: `UI` contains older static HTML/JS screens; `pythonscript` contains ETL/export scripts; `ms project` contains VBA macros; `database` and `backups` contain schema/migration SQL.

## Architecture Diagram

```text
Tablet / Browser / PWA
        |
        | HTTPS
        v
nginx container (:80 -> :443 redirect, :443 TLS)
        |
        +-- /                -> frontend container (React/Vite static build)
        +-- /api/*           -> Express API container, path rewritten without /api
        +-- /fastapi/*       -> FastAPI container, path rewritten without /fastapi
        +-- /uploads/*       -> uploads_data volume served directly by Nginx
        |
        v
PostgreSQL 15 container / local Postgres
        |
        +-- Express API reads/writes app data
        +-- FastAPI reads/writes SOW planning data
        +-- Python ETL syncs SAP order data between source and site databases
        +-- MS Project VBA calls FastAPI for schedule import/export
        +-- SAP CPI endpoint receives validated timesheet payloads from Express
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 7, React Router 7, Tailwind CSS 3, Vite PWA/Workbox |
| UI/data libraries | lucide-react, recharts, sonner, qrcode.react, @zxing/library, html-to-image, jspdf |
| Backend API | Node.js 20, Express 4, CommonJS, pg, multer, exceljs, json2csv |
| Secondary API | Python FastAPI, psycopg2 connection pool |
| Database | PostgreSQL 15, pg_trgm extension present, triggers and FK constraints |
| Reverse proxy | Nginx Alpine with TLS, gzip, upload/static caching, `/api`, `/fastapi`, `/uploads` routing |
| Orchestration | Docker Compose |
| ETL/scripts | Python psycopg2, LISTEN/NOTIFY, ThreadPoolExecutor, XLSX/CSV export/import scripts |
| External systems | SAP CPI inbound timesheet endpoint, Microsoft Project VBA macros, remote/site PostgreSQL databases, network drawing share |

## Folder Structure

```text
D:\website\MPS2
|-- react-timesheet/        React/Vite PWA source and frontend Dockerfile
|-- API/                    Express API, controllers, routes, uploads, FastAPI subservice
|   |-- controllers/        Business logic and SQL queries
|   |-- routes/             Express route bindings
|   |-- FastAPI/            MS Project sync API
|   |-- migrations/         API-specific schema migrations
|   `-- uploads/            Local upload files in dev; Docker uses uploads_data volume
|-- nginx/                  Reverse proxy config and SSL files
|-- database/               Main schema and migration SQL, including SAP/receiving/BPN scripts
|-- backups/                Index/relationship/schema optimization scripts
|-- pythonscript/           ETL, export, seed scripts and ETL Dockerfiles
|-- ms project/             VBA macros for Microsoft Project integration
|-- UI/                     Legacy static HTML/JS UI
|-- docker-compose.yml      Container orchestration
`-- .env                    Shared app config and secrets; do not commit real credentials
```

## Runtime Services

`docker-compose.yml` defines:

- `db`: PostgreSQL 15 Alpine, volume `postgres_data`, initialized from `database/init_database.sql` and `database/migrate_sow_to_parts.sql`, host port `5433` mapped to container port `5432`.
- `api`: Express API built from `API`, exposes `3001` internally, uses env variables from compose, mounts `uploads_data` at `/app/uploads`.
- `frontend`: React production build served by its own Nginx on internal port `80`.
- `nginx`: public reverse proxy on ports `80` and `443`, serves `/uploads` from `uploads_data`.
- `sow_exporter`: Python container for export/ETL style workloads.
- `fastapi`: FastAPI service on internal port `8000`.

## Frontend Routes

Defined in `react-timesheet/src/router/index.jsx`.

| Path | Page | Purpose |
| --- | --- | --- |
| `/`, `/login-timesheet` | `LoginTimesheetPage` | NFC/operator login and timesheet entry start |
| `/timesheet`, `/timesheet-mainmenu` | Timesheet pages | Main timesheet workflows |
| `/view-timesheet` | `TimesheetListPage` | Operator timesheet list and checkout by item |
| `/timesheet-validation` | `TimesheetValidationPage` via `ProtectedRoute` | Admin validation and SAP posting |
| `/timesheet-edit/:tsnumber` | `TimesheetEditPage` | Admin edit of a timesheet row |
| `/process-control` | `ProcessControlPage` | Process control data entry |
| `/edit-parameter` | `EditParameterPage` | Edit/validate process-control values |
| `/select-job` | `SelectJobPage` | Select SOW/order operation |
| `/select-machine` | `SelectMachinePage` | Assign machine/workcenter to NFC user |
| `/dashboard` | `DashboardPage` | KPI and charts |
| `/setting` | `SettingPage` | Settings screen |
| `/component-tracking` | `ComponentTrackingPage` | Component tracking UI |
| `/nfc-users`, `/create-edit-nfc` | NFC user pages | CRUD NFC user/operator records |
| `/unproductive` | `UnproductiveMenuPage` | Unproductive activity start/checkout |
| `/download` | `DownloadPage` | Timesheet CSV/XLSX exports |
| `/sow-orders` | `OrderListPage` | Grouped SOW order list and progress updates |
| `/sow-edit/:id` | `SowEditPage` | Edit single SOW row |
| `/sow-management/list` | `SowStandardListPage` | SOW standard management |
| `/sow-management/create` | `SowCreatePage` | SOW creation UI |
| `/log-timesheet` | `LogTimesheetPage` | SAP post log |
| `/editor-image` | `editorimage` | Image/card editing page |

Frontend API base should be `import.meta.env.VITE_API_URL`, normally `/api` in production. Some pages hard-code fallback `http://localhost:3001`; keep this in mind for Docker builds.

## Backend API Structure

Express entrypoint: `API/server.js`.

Mounted route prefixes:

| Prefix | Route file | Responsibility |
| --- | --- | --- |
| `/health` | `server.js` | Health check |
| `/uploads` | static | Uploaded progress/SOW files |
| `/drawings` | static | Optional network share from `DRAWINGS_PATH` |
| `/sow` | `routes/sow.js` | SOW rows, grouped orders, progress history, parts/operations, SOW standard, attachments, exports |
| `/usernfc` | `routes/usernfc.js` | NFC user/operator CRUD and machine/mode assignment |
| `/workcenter` | `routes/workcenter.js` | Workcenter list |
| `/timesheet` | `routes/timesheet_transaction.js` | Timesheet CRUD, checkout, validation, export, SAP post, SAP log |
| `/production-operations` | `routes/production_operations.js` | Production operation lookup |
| `/process-category` | `routes/processCategoryRoutes.js` | Process categories |
| `/process-parameter` | `routes/processParameterRoutes.js` | Process parameters |
| `/process-parameter-choicebase` | `routes/processParameterChoicebaseRoutes.js` | Choice values for process parameters |
| `/process-control` | `routes/processControlDataRoutes.js` | Process-control header records and validation |
| `/process-control-item` | `routes/processControlDataItemRoutes.js` | Process-control item/value records |
| `/dashboard` | `routes/dashboard.js` | KPI and chart data |

Important Express endpoints:

- Timesheet: `GET /timesheet`, `GET /timesheet/getsn/:snkaryawan`, `GET /timesheet/getid/:id`, `POST /timesheet`, `PUT /timesheet/checkout`, `PUT /timesheet/checkout-unprod`, `PUT /timesheet/checkoutid`, `PUT /timesheet/validation`, `PATCH /timesheet/:tsnumber`, `GET /timesheet/getcsv`, `GET /timesheet/getexcel`.
- SAP: `POST /timesheet/post-to-sap`, `GET /timesheet/log-sap`.
- Validation optimization: `GET /timesheet/validation-stats`, `GET /timesheet/validation-group/:serialnumber`.
- SOW grouped/order: `GET /sow/grouped`, `GET /sow/:order`, `GET /sow/getrow/:id`, `POST /sow/upsert`, `PUT /sow/finish`.
- SOW progress: `GET /sow/progress-history/:idsow`, `POST /sow/progress-history`.
- SOW standard: `GET /sow/standard/grouped`, `GET /sow/standard/component/:component_id`, CRUD under `/sow/standard/operation`, attachments under `/sow/standard/operation/:id/attachments`.
- Parts/operations: CRUD under `/sow/parts` and `/sow/operations`.
- Dashboard: `/dashboard/kpi`, `/dashboard/order-status`, `/dashboard/workload`, `/dashboard/daily-hours`, `/dashboard/operator-efficiency`, `/dashboard/ontime-monthly`, `/dashboard/progress-distribution`, `/dashboard/validation-rate`, `/dashboard/operator-heatmap`, `/dashboard/workcenter-list`.

FastAPI endpoints under Nginx `/fastapi`:

- `GET /fastapi/health`
- `POST /fastapi/sow/update-plan`
- `POST /fastapi/sow/update-plan-bulk`
- `POST /fastapi/sow/get-actual`
- `POST /fastapi/sow/get-missing`
- `POST /fastapi/sow/get-new`
- `POST /fastapi/sow/update-sync`

## Main Business Flow

### Operator Timesheet

1. Operator scans NFC or enters NFC ID on the login/timesheet UI.
2. Frontend calls `/api/usernfc/nfcid/:nfcid` to resolve operator profile, `snssb`, role, assigned machine, and mode.
3. Operator selects job/order from SOW via `/api/sow/datajson`, `/api/sow/:order`, or related endpoints.
4. Frontend posts check-in to `/api/timesheet` with operator, order, operation, workcenter, and planhours.
5. Express inserts into `timesheet_transaction`; timestamps are generated in PostgreSQL with `NOW()`.
6. Checkout calls `/api/timesheet/checkout`, `/api/timesheet/checkout-unprod`, or `/api/timesheet/checkoutid`; duration is calculated in SQL.
7. Admin validates checked-out rows via `/api/timesheet/validation`; validated rows receive `state_flag = 2` and `validation_date`.
8. Admin posts validated rows to SAP via `/api/timesheet/post-to-sap`.
9. SAP response is logged into `log_timesheet_sap`; failures/rejections set `state_flag = 3` and clear validation date.

### SOW / Progress

1. SOW data can originate from SAP/ETL, Excel seed scripts, API upsert, or manual UI.
2. SOW operations live mainly in `sow`; standard templates live in `components`, `sow_standard`, and attachments.
3. `OrderListPage` uses grouped SOW view data from `/api/sow/grouped`.
4. Progress updates call `/api/sow/progress-history`; API validates progress is 1-100 and cannot regress from the latest progress history.
5. Optional base64 progress images are written under `/uploads/progress/{order}/{operation}/...jpg`, and `sow.progress` is updated.

### Process Control

1. Categories and parameter definitions are stored in `process_category`, `process_parameter`, and `process_parameter_choicebase`.
2. `ProcessControlPage` loads categories and parameters, then creates a `processcontroldata` header.
3. Each measured/checked parameter becomes a `processcontroldata_item`.
4. `EditParameterPage` can update item values/status/note and validate the header record.

### MS Project Sync

1. VBA macros in `ms project` call FastAPI endpoints on `/fastapi/sow/*`.
2. MS Project can send plan start/finish/workcenter changes using `update-plan-bulk`.
3. MS Project can request actual progress/hours (`get-actual`), missing operations (`get-missing`), and new/modified operations (`get-new`).
4. The PostgreSQL trigger `trg_set_sync_modified` marks changed SOW rows as `sync = 'modified'`, unless the update changes only the `sync` field.

## Database Schema Summary

Current MCP connection: PostgreSQL 15, database `ptssb`, schema `public`.

Important row counts observed:

- `sow`: about 98k rows.
- `timesheet_transaction`: about 18k rows.
- `operations`: about 2.7k rows.
- `sow_standard`: about 6.2k rows.
- `components`: about 139 rows.
- `workcenter`: about 43 rows.
- `usernfc`: about 7 rows.

Key tables:

| Table | Purpose |
| --- | --- |
| `usernfc` | NFC/operator master data; includes `nfcid`, `snssb`, role, machine, workcenter, and single/multiple mode |
| `workcenter` | Workcenter/machine master data |
| `timesheet_transaction` | Main operator activity records; check-in/out timestamps, duration, validation state, order/operation/workcenter |
| `log_timesheet_sap` | Audit log for each SAP post attempt and response |
| `sow` | Main SOW/operation/order table; plan, actuals, progress, SAP confirmation, sync status |
| `vw_sow_orders` | Grouped SOW order view used by order list/dashboard |
| `progress_update_history` | SOW progress history with optional image path |
| `components` | Component master for SOW standard |
| `sow_standard` | Standard operations per component |
| `sow_standard_attachments` | Uploaded files for standard operations |
| `parts`, `operations` | Newer normalized part/operation model |
| `ph3_order`, `qh3_order` | SAP order staging/lookup tables |
| `production_operations` | Production operation lookup table |
| `process_category` | Process-control category master |
| `process_parameter` | Process-control parameter definitions |
| `process_parameter_choicebase` | Choice options for choice-based parameters |
| `processcontroldata` | Process-control header/inspection record |
| `processcontroldata_item` | Process-control item/value records |
| `sow_templates`, `sow_template_lines` | SOW template structures |

Foreign key relationships:

- `timesheet_transaction.serialnumber -> usernfc.snssb`
- `process_parameter.id_process -> process_category.id_process`
- `process_parameter_choicebase.id_parameter -> process_parameter.id_parameter`
- `processcontroldata.tsnumber -> timesheet_transaction.tsnumber`
- `processcontroldata_item.id_processcontroldata -> processcontroldata.id_processcontroldata`
- `processcontroldata_item.id_parameter -> process_parameter.id_parameter`
- `progress_update_history.operation_id -> sow.idsow`
- `sow_standard.component_id -> components.component_id`
- `sow_standard_attachments.standard_id -> sow_standard.id`
- `sow_templates.component_id -> components.component_id`
- `sow_template_lines.template_id -> sow_templates.template_id`
- `sow_template_lines.standard_id -> sow_standard.id`
- `operations.part_id -> parts.part_id`

Important triggers/functions:

- `timesheet_transaction`: `trg_set_modified_at` updates `modified_at` before update.
- `sow`: `before_update_set_sync` marks changed rows as `sync = 'modified'`.
- `sow`: `trg_delete_dup_sow` deletes older duplicate SOW rows by `codenumber` after insert.
- `parts` and `operations`: update timestamp trigger.

Important indexes:

- `sow`: unique `(order_no, operation_no)`, unique `codenumber`, indexes on `order_no`, `ssbr_id`, `workcenter`, `model`, `part_number`, trigram `part_name`, partial index for `sync = 'modified'`.
- `timesheet_transaction`: indexes on `longdate_checkin`, `longdate_checkout`, `serialnumber + longdate_checkin`, `order_no`, `workcentercode`, `state_flag`, `validation_date`, trigram `serialnumber`, `full_name`, `order_no`.
- `processcontroldata` and item tables have indexes on key FK/search columns.
- `ph3_order` and `qh3_order` have unique `confirmation_number`.

## Environment Variables

Do not copy real secret values into documentation, code, or prompts. `.env` currently contains live database and SAP credentials and should be treated as sensitive.

Important variables:

| Variable | Used by | Meaning |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Express, FastAPI, Python scripts | Main PostgreSQL connection |
| `PORT` | Express | API port, default `3001` |
| `NODE_ENV` | Express/Docker | Runtime mode |
| `CORS_ORIGIN` | Express | CORS allowlist; currently supports `*` |
| `VITE_API_URL` | Frontend build | Frontend API base path, normally `/api` |
| `PLANT_SSB` | Express | Plant code inserted into timesheet rows |
| `ID_TIMESHEET` | Express SAP post | Prefix for generated `ZTIMESHEETID` |
| `TIMEZONE`, `TZ`, `PGTZ` | Node/Postgres/containers | Timezone control |
| `DRAWINGS_PATH` | Express static route | Optional network drawing share |
| `SAP_INBOUND_URL`, `SAP_INBOUND_USERNAME`, `SAP_INBOUND_PASSWORD` | Express SAP post | SAP CPI Basic Auth endpoint |
| `TGT_TABLE` | Express SAP post | Order lookup table, e.g. `ph3_order` |
| `SRC_*`, `SRC_TABLE` | Python ETL | Source SAP-pushed database/table |
| `TGT_*` and site-specific `TGT_*_BALIKPAPAN`, `TGT_*_SEBAMBAN`, etc. | Python ETL | Target site databases |
| `POLL_INTERVAL_SECONDS`, `BATCH_LIMIT`, `PLANT_FILTER` | Python ETL | ETL polling/batch behavior |
| `MASTER_TOKEN` | Token controller | Intended token verification secret; currently not wired correctly |

## External Integrations

- SAP CPI inbound timesheet endpoint: Express builds SAP payloads in `timesheet_transactionController.postToSap` and posts with Basic Auth.
- SAP order/staging data: `ph3_order`, `qh3_order`, and ETL scripts process confirmation/order/operation records.
- Microsoft Project: VBA macros in `ms project` call FastAPI endpoints for plan dates, missing operations, actual progress/hours, and sync status.
- Multi-site PostgreSQL sync: `pythonscript/etl_sync_v2.py` listens on `etl_new_row`, polls source rows with `status_etl = 'NEW'`, strips leading zeroes, upserts to site target DBs, and syncs `sow`.
- Network drawings share: Express can serve `DRAWINGS_PATH` via `/drawings`.
- File uploads: SOW standard attachments and progress images are stored on filesystem/volume and served by Nginx `/uploads`.
- No Kafka integration was found.

## Performance and Scaling Notes

- Nginx is already configured for gzip, keepalive upstreams, upload limits, static asset caching, and direct `/uploads` serving.
- Express uses a `pg` pool with max 20 connections; FastAPI uses a psycopg2 `SimpleConnectionPool(1, 10)`.
- Several high-volume endpoints are paginated (`/timesheet`, `/sow/grouped`, SOW standard grouped, SAP log).
- Validation endpoints were optimized server-side with grouped stats and date-range predicates.
- Database has useful btree and trigram indexes for common search patterns.
- Potential bottlenecks remain in endpoints that return all rows, especially `GET /sow` (`SELECT * FROM sow`) and broad export endpoints.
- SAP posting is sequential with a 100 ms delay per row; this is operationally simple but slow for large batches. Consider queue/background job semantics if posting volume grows.
- Progress image upload decodes base64 in Express, which is memory-heavy. Multipart upload would scale better for larger/more frequent images.
- Python ETL uses LISTEN/NOTIFY plus polling fallback and per-target thread pools; this should scale moderately, but target DB connectivity and source transaction contention should be monitored.
- For larger datasets, prefer keyset pagination for timesheet/SOW lists and avoid `COUNT(*)` on every request unless cached or needed.

## Potential Issues and Inconsistencies

1. `.env` contains live plaintext DB and SAP credentials. Move secrets out of committed files and rotate exposed credentials if this repo has been shared.
2. `.env` has duplicated `TGT_HOST`, `TGT_PORT`, `TGT_DATABASE`, `TGT_USER`, `TGT_PASSWORD`, and `TGT_TABLE` blocks. The later duplicate wins during dotenv parsing.
3. `docker-compose.yml` maps Postgres host port `5433:5432`, but `.env` has `DB_PORT=5432`. This is okay inside Docker because compose overrides API DB port to `5432`, but local host access may need `5432` or `5433` depending which Postgres instance is used.
4. `API/routes/token.js` requires `../controller/tokencontroller`, but the folder is `controllers`. This route is also not mounted in `server.js`.
5. `API/routes/consumable.js` exists but is not mounted in `server.js`.
6. Several process controllers define `const db = ...` but call `pool.query(...)`. It may work because `global.pool` is exposed, but it is inconsistent and fragile; prefer `db.query(...)`.
7. `react-timesheet/package.json` includes dependency `"18": "^0.0.0"`, which looks accidental.
8. Existing `CLAUDE.md` says React 18, React Router 6, and TanStack Query, but the current `react-timesheet/package.json` shows React 19, React Router 7, and no TanStack Query dependency.
9. `SowCreatePage.jsx` calls `${API_BASE}/sow/create`, but Express route `POST /sow/create` was not found. Existing create endpoints are `POST /sow`, `POST /sow/createex/`, `POST /sow/upsert`, and `POST /sow/sow`.
10. Some frontend pages use fallback `http://localhost:3001`; in Docker/prod the safe default should be `/api`.
11. `ProtectedRoute` only checks `sessionStorage.isVerified`, while `PasswordPrompt` uses `sessionStorage.nfcAdminAuth`; authentication conventions are inconsistent.
12. `tokencontroller` expects `MASTER_TOKEN`, but `.env` inspected did not show `MASTER_TOKEN`.
13. `sowController.update` updates columns `name` and `id`, but the current `sow` schema uses `idsow` and does not show a `name` column. This generic `PUT /sow/:id` may be broken.
14. The frontend PWA manifest references `pwa-192x192.png` and `pwa-512x512.png`; verify these assets exist in `public`.
15. Nginx config comments contain mojibake characters, likely from encoding mismatch. Functional config is readable enough, but comments should be normalized to UTF-8/ASCII.

## Naming and Code Patterns

- Backend uses CommonJS modules and controller exports.
- Route files should stay thin and delegate to controllers.
- SQL is mostly direct parameterized SQL with `pg`; keep using parameter placeholders, not string interpolation for user input.
- Existing DB naming is mixed: snake-like lowercase (`order_no`), legacy names (`snssb`, `nfcid`), quoted/reserved columns (`"group"`), and inconsistent operation naming (`operation_no`, `operation_number`). Follow existing table-specific names unless doing a migration.
- Timestamps are intentionally generated in PostgreSQL for timesheet check-in/out. Preserve this pattern to avoid Node timezone drift.
- Timesheet state conventions observed:
  - `state_flag = 1`: default/new.
  - `state_flag = 2`: validated/SAP-ready or accepted flow.
  - `state_flag = 3`: SAP rejected/error.
  - `state_flag = 5`: deleted/zero-duration/admin invalid style state.
- Productive timesheets have empty/null `activitytype`; unproductive entries use `activitytype`.
- `order_no + operation_no` is commonly treated as `codenumber` for SOW joins/lookups.
- File uploads should write under `API/uploads` locally or the Docker `uploads_data` volume; URLs should be stored as `/uploads/...`.

## AI Assistance Rules

- Always read current files before editing; this repo has active uncommitted changes.
- Never revert user changes or generated artifacts unless explicitly asked.
- Do not expose `.env` secret values in responses or docs.
- Prefer MCP Postgres for schema checks and safe read queries.
- For frontend changes, update `react-timesheet/src/router/index.jsx` when adding a page.
- Use `VITE_API_URL` or relative `/api`; avoid new hard-coded localhost API URLs.
- For backend routes, add route binding in `API/routes/*` and mount it in `API/server.js` if it is a new route group.
- For SQL performance, check existing indexes before adding new ones; `sow` and `timesheet_transaction` already have several targeted indexes.
- Keep Docker path behavior in mind: Nginx strips `/api/` before Express, and strips `/fastapi/` before FastAPI.
- Test at least the touched layer: `npm run build` for frontend, start/health check for API, or targeted SQL/API call for backend work.
