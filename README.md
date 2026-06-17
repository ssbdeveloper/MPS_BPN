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
