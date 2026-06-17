# SAP Manual Staging And Posting Test

## Seed Manual Payload

Seed satu payload manual ke `sap_timesheet_staging`.

```powershell
python seed_sap_staging_manual.py `
  --source-system TIMESHEET `
  --pernr 00016502 `
  --rueck 0006799014 `
  --aufnr 001000131548 `
  --vornr 0005 `
  --zconf-type RG `
  --arbpl M5051GD1 `
  --isdd 20260615 `
  --isdz 080000 `
  --iedd 20260615 `
  --iedz 083000 `
  --werks 5051
```

Output log akan memberi `id` staging.

## Seed Machine Hours Manual Payload

```powershell
python seed_sap_staging_manual.py `
  --source-system MCH_HOURS `
  --pernr 11009413 `
  --rueck 0006951399 `
  --aufnr 001000126495 `
  --vornr 1570 `
  --zconf-type M1 `
  --arbpl M5051BL2 `
  --isdd 20260615 `
  --isdz 080000 `
  --iedd 20260615 `
  --iedz 083000 `
  --werks 5051
```

## Seed From JSON File

Contoh file `samples/sap_payloads/manual_payload.json`:

```json
{
  "PERNR": "00016502",
  "RUECK": "0006799014",
  "AUFNR": "001000131548",
  "VORNR": "0005",
  "FLGAT": "",
  "PLNFL": "",
  "VORNR_B": "",
  "VORNR_R": "",
  "ZCONF_TYPE": "RG",
  "ARBPL": "M5051GD1",
  "LSTAR": "",
  "ISDD": "20260615",
  "ISDZ": "080000",
  "IEDD": "20260615",
  "IEDZ": "083000",
  "WERKS": "5051",
  "AUERU": "",
  "ZBARCODEID": ""
}
```

Command:

```powershell
python seed_sap_staging_manual.py --source-system TIMESHEET --payload-file ..\..\samples\sap_payloads\manual_payload.json
```

`ZTIMESHEETID` tidak perlu diisi. Script akan memakai `id` staging sebagai `ZTIMESHEETID`.

## Dry Run

```powershell
python seed_sap_staging_manual.py --source-system TIMESHEET --payload-file ..\..\samples\sap_payloads\manual_payload.json --dry-run
```

## Post Row Test Tertentu Ke SAP

Kirim berdasarkan staging `id`:

```powershell
python post_sap_staging.py --ids 151400
```

Kirim beberapa id:

```powershell
python post_sap_staging.py --ids 151400,151401
```

Kirim berdasarkan `ZTIMESHEETID`:

```powershell
python post_sap_staging.py --ztimesheetids 151400
```

By default, row yang sudah `POSTED` tidak dikirim ulang. Kalau memang mau test repost:

```powershell
python post_sap_staging.py --ids 151400 --allow-posted
```

## Cek Payload Manual

```sql
SELECT
  id,
  ztimesheetid,
  source_system,
  source_key,
  status,
  jsonb_pretty(payload) AS payload
FROM sap_timesheet_staging
WHERE source_key LIKE 'MANUAL:%'
ORDER BY id DESC
LIMIT 20;
```
