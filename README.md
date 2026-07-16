# MPS2 Repo Map

Repo ini sudah dirapikan berbasis runtime dan domain kerja.

## Where To Edit What

- `apps/web/` - React + Vite frontend.
- `apps/api/` - Express API, controllers, routes, WebSocket, uploads.
- `apps/fastapi-msproject/` - FastAPI service untuk MS Project sync.
- `apps/tts-worker/` - TTS worker/service.
- `jobs/sap_staging/` - staging, manual seed, dan posting payload SAP.
- `jobs/etl/` - ETL lokal plant, SQL Server sync, machine transaction jobs.
- `jobs/export/` - export CSV/TXT helpers.
- `jobs/sow/` - SOW seed helpers dan Docker helper untuk SOW export.
- `database/` - migrations, schema dumps, dan seed database.
- `docs/` - dokumentasi aktif dan archive.
- `samples/` - payload SAP, Excel/CSV contoh, dan media test.
- `infra/` - Nginx dan infrastruktur Docker pendukung.
- `scripts/` - helper command dari root repo.

## Common Commands

```powershell
cd apps\web
npm run dev
npm run build
```

```powershell
cd apps\api
npm start
```

```powershell
cd jobs\sap_staging
python stage_timesheet_transaction.py
python stage_machinehours.py
python post_sap_staging.py --limit 50
python seed_sap_staging_manual.py --payload-file ..\..\samples\sap_payloads\manual_payload.json
```

```powershell
docker compose config
docker compose up -d --build
```

`.env` tetap di root repo dan dibaca oleh app/job dengan pencarian naik ke parent directory.

## SAP staging pipeline (machine hours → SAP)

Four stages, each a different "brain". Do not confuse them.

```
SQL Server → [ETL] → mch_productiondata → [ETL] → mch_transaction
                                                        │
                                        [STAGING: stage_machinehours]  → bundles (daily)
                                                        │
                                        sap_timesheet_staging (PENDING)
                                                        │
                                        [POSTING: post_sap_staging]    → SAP
```

- **ETL** (`jobs/etl/etl_mch_transaction_v3.py`) derives `mch_transaction` (+ applies manual
  overrides from `mch_transaction_override`). Scheduled separately (`docker-compose.etl.yml`).
- **Staging** (`stage_machinehours.py` → `stage_sap_timesheet.py`) bundles **per day** per
  (operator, machine, order, operation, status). Two modes:
  - *normal* — excludes already-posted keys/segments; new work → `PENDING` bundle.
  - *correction* — hours completed **after** their day was posted → separate bundle
    (`is_correction=true`, key marked `KOREKSI`). SAP confirmations are additive, so a
    correction adds hours to the order — no storno needed.
- **Posting** (`post_sap_staging.py`) sends `PENDING` bundles to SAP. A **day-complete
  guard** only posts `bucket_start < today` (a still-growing day must not be locked).
  `is_correction` bundles are **never** auto-posted — admins post them from the UI.

### Automatic vs manual

| Piece | Auto (needs a scheduled service) | Manual (UI button / CLI) |
|---|---|---|
| Derive `mch_transaction` | ETL compose | — |
| Bundling (normal + correction) | `sap-stage-worker` | "Stage edited records" button |
| Post `PENDING` (completed days) | `sap-post-worker` | `post_sap_staging.py` CLI |
| Post **corrections** | never auto | "Post selected" button (admin) |
| Retry `FAILED` | — | "Retry failed" button |

`ops_worker.py` is **not** a scheduler and does **not** bundle on its own. It is a queue
consumer: it watches `sap_ops_request` and runs the mapped script **only when a UI button
enqueues a request** (Node API cannot run Python directly).

### Deploy the pipeline services

```bash
docker compose -f jobs/sap_staging/docker-compose.sap.yml up -d --build
```

- `sap-stage-worker` — loops `stage_machinehours.py --catchup` (auto bundling).
- `sap-post-worker` — loops `post_sap_staging.py` (auto posting, completed days only).
- `sap-ops-worker` — runs `ops_worker.py --loop` (UI buttons: stage edited / post
  corrections / retry failed).

Tunables in `.env` (optional): `SAP_STAGE_INTERVAL` (900s), `SAP_POST_INTERVAL` (1800s),
`SAP_POST_LIMIT` (500), `SAP_POST_WORKERS` (5), `SAP_OPS_INTERVAL` (10s).

### UI flow (SAP-log page, tab "Corrections")

Operator completes a record (Operator Hours tab → pencil → assign Job/Operator) →
**Stage edited records** → the correction shows up → **Post selected** → SAP.

### Manual CLI

```powershell
cd jobs\sap_staging
python stage_machinehours.py --catchup       # bundle (normal + correction)
python post_sap_staging.py --limit 500 --workers 5   # post completed days
python post_sap_staging.py --failed-only     # retry FAILED
python rebuild_machinehours.py --full-reset --from 2026-07-01 --to 2026-07-17  # full re-stage, ID→1
```
