# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Full-stack timesheet and production order management system for an Indonesian manufacturing environment (PT SSB). Deployed via Docker Compose with multiple services.

## Project Structure
```
d:\website\MPS2\
├── API/                          # Node.js/Express backend (main API)
│   ├── server.js                 # Entry point — registers all routes, DB pool, env
│   ├── controllers/              # Business logic per resource
│   ├── routes/                   # Express route definitions
│   ├── db.js                     # DB connection helper (legacy, global.pool used instead)
│   ├── uploads/                  # Uploaded progress photos (served at /uploads)
│   └── FastAPI/                  # Python FastAPI service (MS Project sync)
│       └── main.py
├── react-timesheet/              # React frontend (Vite + Tailwind CSS)
│   ├── CLAUDE.md                 # Frontend-specific design system & AI context
│   └── src/
│       ├── pages/                # Page components (see Routes section)
│       ├── components/           # auth, forms, layout, tables, ui
│       ├── assets/               # Static assets (images, icons)
│       └── router/               # Route definitions
├── UI/                           # Legacy HTML/JS frontend (dev mode only)
├── database/                     # SQL init & migration scripts
├── pythonscript/                 # Python CSV/TXT export scripts
├── nginx/                        # Nginx reverse proxy config
├── docker-compose.yml            # Orchestrates all services
└── .env                          # Environment variables (not committed)
```

## Technology Stack
- **Main API**: Node.js + Express.js (`API/`)
- **MS Project Sync API**: Python FastAPI (`API/FastAPI/`) — port 8000
- **Frontend**: React 19 + Vite + Tailwind CSS (`react-timesheet/`)
- **Database**: PostgreSQL 15
- **Reverse Proxy**: Nginx
- **Deployment**: Docker Compose

## Docker Services
- `db` — PostgreSQL 15 (port 5433 on host)
- `api` — Node.js/Express API (port 3001 internal)
- `frontend` — React app served by Nginx (port 80 internal)
- `nginx` — Reverse proxy (ports 80/443 on host)
- `fastapi` — FastAPI for MS Project sync (port 8000 internal)
- `sow_exporter` — Python export scripts

## Database Tables

### `timesheet_transaction`
Primary table for employee check-in/check-out records.

| Column | Type | Notes |
|--------|------|-------|
| `tsnumber` | integer (PK, auto) | Primary transaction identifier |
| `serialnumber` | text | Employee NFC/serial number (NOT NULL) |
| `full_name` | text | Employee name (NOT NULL) |
| `order_no` | text | Production order number |
| `ssbr_id` | text | SSBR identifier |
| `operation_no` | integer | Operation number |
| `operation_text` | text | Activity description |
| `workcentercode` | text | Machine / work center code |
| `workcenterdescription` | text | Machine description |
| `part_name` | text | Part name |
| `activitytype` | text | If set → unproductive record (NULL = productive) |
| `planhours` | numeric(10,2) | Planned hours |
| `std_foreman_hours` | numeric(10,2) | Std foreman hours |
| `longdate_checkin` | timestamptz | Check-in timestamp |
| `longdate_checkout` | timestamptz | Check-out timestamp |
| `date_checkin` | text | Formatted `dd/mm/yyyy` |
| `date_checkout` | text | Formatted `dd/mm/yyyy` |
| `hour_checkin` | text | Formatted `hh:mm` |
| `hour_checkout` | text | Formatted `hh:mm` |
| `duration` | numeric(10,2) | Computed duration in hours |
| `state_flag` | smallint (default 1) | Status — see values below |
| `validation_date` | timestamptz | Timestamp when validated |
| `plant` | text | Plant code |
| `confirmationnumber` | text | SAP confirmation number |
| `note` | text | Admin notes |

**`state_flag` values:**
- `1` — Pending / active (default)
- `2` — Validated (bulk validated by admin)
- `3` — SAP Reject (SAP returned STATUS ≠ 'S')
- `5` — Deleted (duration = 0, set atomically in `updateTimesheetadmin`)

### `production_operations`
SAP order operation data — used to build SAP confirmation payloads.

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigint (PK, auto) | |
| `order_number` | text | Production order |
| `operation_number` | integer | Operation number |
| `short_text` | text | Operation description |
| `confirmation` | text | SAP RUECK field |
| `sequence_category` | text | SAP FLGAT field |
| `sequence_number` | text | SAP PLNFL field |
| `branch_operation` | text | SAP VORNR_B field |
| `return_operation` | text | SAP VORNR_R field |
| `estimate_hour` | numeric(10,2) | |
| `work_center` | text | |
| `plant` | text | |

### `sow`
Production order operations master data (replaces legacy `sowkk`).

Key fields: `idsow`, `order_no`, `operation_no`, `ssbr_id`, `part_number`, `codenumber` (= order_no + operation_no)

### `parts`
Parts master linked to SOW. Key fields: `part_id`, `partnumber`, `partname`, `model`, `drawing_path`

### Other Tables
- `workcenter` — Work center definitions
- `usernfc` — NFC user registrations
- `process_category`, `process_parameter`, `process_parameter_choicebase` — Process control metadata
- `process_control_data` (`processcontroldata`), `process_control_data_item` (`processcontroldata_item`) — Process control entries
- `progress_update_history` — SOW progress photo & update history
- `mst_job` — Job master data

## Key API Endpoints (Node.js — `API/server.js`)

### Timesheet (`/timesheet`)
- `GET /timesheet/` — Get all records
- `GET /timesheet/search` — Search with filters
- `GET /timesheet/validation-stats` — Stats for validation page (counts per employee)
- `GET /timesheet/validation-group/:serialnumber` — Records for one employee group
- `GET /timesheet/getsn/:snkaryawan` — Records by employee serial number
- `GET /timesheet/getid/:id` — Single record by tsnumber
- `GET /timesheet/nama/:nama` — Records by employee name
- `GET /timesheet/getcsv` — Export to CSV
- `GET /timesheet/getexcel` — Export to Excel
- `POST /timesheet/` — Create check-in
- `POST /timesheet/post-to-sap` — Post validated records to SAP inbound
- `PUT /timesheet/validation` — Bulk validate records (set state_flag=2)
- `PUT /timesheet/updateadmin/:id` — Admin update (includes atomic duration=0→state_flag=5 logic)
- `PUT /timesheet/checkout` — Check-out by serialnumber
- `PUT /timesheet/checkoutid/` — Check-out by tsnumber
- `PATCH /timesheet/:tsnumber` — Partial update
- `DELETE /timesheet/:id` — Delete record

### SOW/Parts (`/sow`)
- `GET /sow/grouped` — Grouped orders view
- `GET /sow/parts` — All parts
- `GET /sow/parts/search` — Search parts
- `GET /sow/parts/:id` — Single part
- `POST /sow/parts` — Create part
- `PUT /sow/parts/:id` — Update part
- `DELETE /sow/parts/:id` — Delete part
- `GET /sow/operations/part/:part_id` — Operations by part
- `GET /sow/operations/:id` — Single operation
- `POST /sow/operations` — Create operation
- `PUT /sow/operations/:id` — Update operation
- `DELETE /sow/operations/:id` — Delete operation
- `POST /sow/sow` — Create part with operations (bulk)
- `PUT /sow/sow/:id` — Update part with operations (bulk)
- `GET /sow/planhours` — Plan hours lookup
- `POST /sow/planhours/multi` — Multi plan hours lookup
- `GET /sow/stats` — Statistics
- `GET /sow/progress-history/:idsow` — Progress update history
- `POST /sow/progress-history` — Add progress update (with photo)

### Production Operations (`/production-operations`)
- `GET /production-operations/` — All records
- `GET /production-operations/lookup` — Lookup for SAP payload
- `GET /production-operations/:id` — Single record

### Other
- `GET /workcenter/` — Work center data
- `GET /usernfc/` — NFC user list
- `/process-category`, `/process-parameter`, `/process-parameter-choicebase` — Process control CRUD
- `/process-control`, `/process-control-item` — Process control data CRUD
- `GET /health` — Health check
- `GET /drawings/*` — Static network share (if DRAWINGS_PATH configured)
- `GET /uploads/*` — Static uploaded photos

### FastAPI (MS Project Sync — port 8000)
- `POST /sow/update-plan` — Update single SOW plan dates
- `POST /sow/update-plan-bulk` — Bulk update plan dates
- `POST /sow/get-actual` — Get actual progress by codenumber keys
- `POST /sow/get-missing` — Get operations not in MS Project
- `POST /sow/get-new` — Get operations with sync='modified'
- `POST /sow/update-sync` — Update sync status for order numbers
- `GET /health` — Health check

## SAP Inbound Integration

Records are posted to SAP via `POST /timesheet/post-to-sap`.

**Request body:**
```json
{ "tsnumbers": [1234, 5678] }
```

**SAP payload fields (per record):**

| Field | Source | Notes |
|-------|--------|-------|
| `ZTIMESHEETID` | `tsnumber` | |
| `PERNR` | `serialnumber` | Padded to 8 digits |
| `ARBPL` | `workcentercode` | |
| `LSTAR` | `activitytype` | Activity type code |
| `ISDD` / `IEDD` | `longdate_checkin/out` | Format `YYYYMMDD` |
| `ISDZ` / `IEDZ` | `longdate_checkin/out` | Format `HHmmss` |
| `WERKS` | `plant` | |
| `ZBARCODEID` | `ssbr_id` | |
| `AUFNR` | `order_no` | Padded to 12 digits — **empty for unproductive** |
| `VORNR` | `operation_no` | Padded to 4 digits — **empty for unproductive** |
| `RUECK` | `production_operations.confirmation` | **empty for unproductive** |
| `FLGAT` | `production_operations.sequence_category` | **empty for unproductive** |
| `PLNFL` | `production_operations.sequence_number` | **empty for unproductive** |
| `VORNR_B` | `production_operations.branch_operation` | **empty for unproductive** |
| `VORNR_R` | `production_operations.return_operation` | **empty for unproductive** |
| `ZCONF_TYPE` | Derived | `'OV'` if workcentercode ends with 'OT', `'RW'` if operation_no > 5000, else `'RG'` — **empty for unproductive** |

**Unproductive detection:** `isUnprod = !!row.activitytype`

**SAP response format:**
```json
{
  "n0:ABM_CPP_223_MT_Timesheet_Res": {
    "STATUS": "S",
    "MESSAGE": "Confirmation of order ... saved"
  }
}
```
- `STATUS === 'S'` → success (set `state_flag = 2`)
- Otherwise → SAP Reject (set `state_flag = 3`, clear `validation_date`)
- SAP-rejected records can be re-pushed (retry button shown in UI)

## Development Commands
```bash
# Start API (from API/)
node server.js
# or
npm run dev   # uses nodemon

# Start React frontend (from react-timesheet/)
npm run dev
npm run build

# Docker (from project root)
docker compose up -d
docker compose up -d --build
docker compose logs -f api
```

## Environment Configuration
`.env` at project root (loaded by `API/server.js` via `path.join(__dirname, '../.env')`):

| Variable | Description |
|----------|-------------|
| `DB_HOST` | PostgreSQL host |
| `DB_PORT` | PostgreSQL port (5433 in prod) |
| `DB_NAME` | Database name (`ptssb`) |
| `DB_USER` | DB user |
| `DB_PASSWORD` | DB password |
| `PORT` | API port (default 3001) |
| `NODE_ENV` | `development` / `production` |
| `PLANT_SSB` | Plant identifier |
| `TIMEZONE` | e.g. `Asia/Makassar` |
| `CORS_ORIGIN` | Allowed CORS origin |
| `DRAWINGS_PATH` | Optional network share for drawings |
| `SAP_INBOUND_URL` | SAP CPI inbound endpoint URL |
| `SAP_INBOUND_USERNAME` | SAP Basic Auth username |
| `SAP_INBOUND_PASSWORD` | SAP Basic Auth password |

## Code Patterns

### Backend
- All DB operations use parameterized queries — never string interpolation
- `global.pool` is the shared `pg.Pool` instance (set in `server.js`)
- `types.setTypeParser(1114/1184, str => str)` — prevents pg from converting timestamps via Node.js TZ
- Date/time stored as both `timestamptz` and formatted text strings (`dd/mm/yyyy`, `hh:mm`)
- Error responses in Indonesian: `"Terjadi error saat ambil data"`
- `tsnumbers` from frontend are strings — cast with `.map(Number)` before DB query
- DB comparison: `WHERE tsnumber = ANY($1::int[])` for integer array params
- `production_operations.operation_number` is `integer` — do NOT cast to text when joining with `timesheet_transaction.operation_no` (also integer)
- `updateTimesheetadmin` atomically sets `state_flag='5'` and clears `validation_date` when computed duration = 0, via `CASE` expression in SQL

### Frontend
- Uses `@zxing/library` for barcode/QR scanning
- Auth via NFC card scan + password prompt pattern
- `react-timesheet/CLAUDE.md` contains the full corporate color design system (approved 2026-03-19) — **read before touching any UI**
- Toast notifications via `sonner`
- SAP pending state tracked with `sapPendingTsnumbers` Set (avoids jarring reload)
- Silent refresh: `loadGroupRecords(sn, true)` skips loading spinner when `silent=true`
- Progress photos stored as file paths (not base64) — served via `/uploads/`
