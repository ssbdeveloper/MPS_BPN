# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Full-stack timesheet and production order management system for an Indonesian manufacturing environment. Deployed via Docker Compose with multiple services.

## Project Structure
```
d:\MPS2\
├── API/                    # Node.js/Express backend (main API)
│   ├── server.js           # Entry point
│   ├── controllers/        # Business logic per resource
│   ├── routes/             # Express route definitions
│   ├── db.js               # DB connection helper
│   └── FastAPI/            # Python FastAPI service (MS Project sync)
│       └── main.py
├── react-timesheet/        # React frontend (Vite + Tailwind CSS)
│   └── src/
│       ├── pages/          # Page components
│       ├── components/     # auth, forms, layout, tables, ui
│       └── router/
├── UI/                     # Legacy HTML/JS frontend (served in dev mode)
├── database/               # SQL init & migration scripts
├── pythonscript/           # Python CSV/TXT export scripts
├── nginx/                  # Nginx reverse proxy config
├── docker-compose.yml      # Orchestrates all services
└── .env                    # Environment variables (not committed)
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
- `sow` — Production order operations (parts + operations, replaces old `sowkk`)
- `workcenter` — Work center definitions
- `timesheet_transaction` — Check-in/check-out records
- `usernfc` — NFC user registrations
- `process_category`, `process_parameter`, `process_parameter_choicebase` — Process control metadata
- `process_control_data`, `process_control_data_item` — Process control entries

Key fields in `timesheet_transaction`:
- `tsnumber` — Primary transaction identifier
- `production_order`, `serialnumber`, `full_name` — Employee/order info
- `seq`, `operation_text` — Activity details
- `workcentercode`, `workcenterdescription` — Machine/work center
- `longdate_checkin`/`longdate_checkout` — Timestamp fields
- `date_checkin`/`date_checkout` — Formatted date strings (dd/mm/yyyy)
- `hour_checkin`/`hour_checkout` — Time strings (hh:mm)

## Key API Endpoints (Node.js — `/API/routes/`)

### Timesheet (`/timesheet`)
- `GET /timesheet/` — Get all records
- `GET /timesheet/search` — Search records
- `GET /timesheet/getsn/:snkaryawan` — Get by serial number
- `GET /timesheet/getexcel` — Export to Excel
- `POST /timesheet/` — Create check-in
- `PUT /timesheet/checkout` — Check-out by serialnumber
- `PUT /timesheet/checkoutid/` — Check-out by tsnumber
- `PUT /timesheet/validation` — Bulk validate records
- `PUT /timesheet/updateadmin/:id` — Admin update
- `PATCH /timesheet/:tsnumber` — Partial update
- `DELETE /timesheet/:id` — Delete record

### SOW/Parts (`/sow`)
- `GET /sow/parts` — All parts
- `GET /sow/parts/search` — Search parts
- `POST /sow/sow` — Create part with operations
- `PUT /sow/sow/:id` — Update part with operations
- `GET /sow/planhours` — Plan hours lookup
- `POST /sow/planhours/multi` — Multi plan hours lookup

### Other
- `GET /workcenter/` — Work center data
- `GET /usernfc/` — NFC user list
- `/process-category`, `/process-parameter`, `/process-control`, `/process-control-item` — Process control CRUD

### FastAPI (MS Project Sync — port 8000)
- `POST /sow/update-plan` — Update single SOW plan dates
- `POST /sow/update-plan-bulk` — Bulk update plan dates
- `POST /sow/get-actual` — Get actual progress by codenumber keys
- `POST /sow/get-missing` — Get operations not in MS Project
- `POST /sow/get-new` — Get operations with sync='modified'
- `POST /sow/update-sync` — Update sync status for order numbers
- `GET /health` — Health check

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
`.env` file at project root with:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `PORT` — API port (default 3001)
- `NODE_ENV` — development/production
- `PLANT_SSB` — Plant identifier
- `TIMEZONE` — e.g. `Asia/Makassar`
- `CORS_ORIGIN` — Allowed CORS origin
- `DRAWINGS_PATH` — Optional network share for drawings

## Code Patterns
- All DB operations use parameterized queries (security)
- `global.pool` is the shared pg Pool instance
- `types.setTypeParser` prevents pg from converting timestamps via Node.js TZ
- Date/time: both raw timestamp and formatted `dd/mm/yyyy` + `hh:mm` strings
- Error responses in Indonesian ("Terjadi error saat ambil data")
- React frontend uses `@zxing/library` for barcode/QR scanning
- Frontend auth uses NFC + password prompt pattern
