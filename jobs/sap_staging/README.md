# SAP Staging Jobs

Domain ini berisi script untuk mengisi staging table SAP, seed payload manual, dan post row staging ke SAP.

## Commands

```powershell
python stage_timesheet_transaction.py
python stage_machinehours.py
python post_sap_staging.py --limit 50
python post_sap_staging.py --ids 123
python seed_sap_staging_manual.py --payload-file ..\..\samples\sap_payloads\manual_payload.json
```

Semua script membaca `.env` dari root repo. Payload contoh ada di `samples/sap_payloads/`.
