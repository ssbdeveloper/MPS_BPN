# SAP PH3 Order Lambda

AWS Lambda Node.js 20 endpoint for SAP CPI payloads that writes to `public.ph3_order` in PostgreSQL.

## Structure

```text
aws/sap-ph3-order-lambda/
+- index.js
+- package.json
+- .env.example
+- sql/
   +- 001_alter_table.sql
   +- 002_unique_constraint.sql
```

## Required Environment Variables

```env
DB_HOST=
DB_PORT=5432
DB_NAME=
DB_USER=
DB_PASSWORD=
SAP_TOKEN=
```

Optional:

```env
DB_SSL=false
```

## SQL Setup

Run these before deploying the Lambda against the AWS PostgreSQL target:

```sql
ALTER TABLE public.ph3_order
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.ph3_order
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.ph3_order
ADD COLUMN IF NOT EXISTS note TEXT;
```

Duplicate check:

```sql
SELECT
  order_no,
  confirmation_number,
  operation_no,
  COUNT(*) AS total,
  ARRAY_AGG(id ORDER BY id) AS row_ids
FROM public.ph3_order
GROUP BY order_no, confirmation_number, operation_no
HAVING COUNT(*) > 1;
```

Unique constraint:

```sql
ALTER TABLE public.ph3_order
ADD CONSTRAINT ph3_order_unique_order_confirmation_operation
UNIQUE (order_no, confirmation_number, operation_no);
```

Important: if the target database still has `ph3_order_confirmation_number_key UNIQUE (confirmation_number)`, it can conflict with this new composite-key design. Drop it only after confirming no legacy job still depends on `ON CONFLICT (confirmation_number)`.

## Example Requests

`INST`

```json
{
  "AUTH": { "TOKEN": "your-token" },
  "DATA": {
    "RUECK": "0004727824",
    "ZINDICATOR": "INST",
    "LTXA1": "Operation short text",
    "AUFNR": "001000073558",
    "VORNR": "0020",
    "FLGAT": "",
    "PLNFL": "",
    "VORNR_B": "",
    "VORNR_R": "",
    "MATNR": "MAT-001",
    "MAKTX": "Material description",
    "ZTXT04_VORNR": "Operation description",
    "ARBPL": "M5051GD1",
    "KOSTL": "COST001",
    "WERKS": "5051",
    "VGE01": "H",
    "VGW01": "1.5",
    "AUART": "PP01",
    "ZTXT04_AUFNR": "Order description"
  }
}
```

`UPDT`: same payload shape with `"ZINDICATOR": "UPDT"`.

`DEL`: minimum payload:

```json
{
  "AUTH": { "TOKEN": "your-token" },
  "DATA": {
    "RUECK": "0004727824",
    "ZINDICATOR": "DEL",
    "AUFNR": "001000073558",
    "VORNR": "0020"
  }
}
```

## Success Responses

`INST` returns `201`.

```json
{
  "success": true,
  "message": "Data inserted successfully",
  "action": "INST",
  "data": {
    "order_no": "001000073558",
    "confirmation_number": "0004727824",
    "operation_no": "0020"
  }
}
```

`UPDT` returns `200` with `"message": "Data upserted successfully"`.

`DEL` returns `200` with `"message": "Data marked as deleted successfully"`.

## Error Responses

Unauthorized, `401`:

```json
{ "success": false, "message": "Unauthorized" }
```

Missing field, `400`:

```json
{ "success": false, "message": "Missing required field: DATA.AUFNR" }
```

Duplicate insert, `409`:

```json
{
  "success": false,
  "message": "Data already exists for this order_no, confirmation_number, and operation_no"
}
```

Delete target not found, `404`:

```json
{ "success": false, "message": "Data not found for delete marking" }
```

Invalid indicator, `400`:

```json
{
  "success": false,
  "message": "Invalid indicator_code. Allowed values: INST, UPDT, DEL"
}
```

Database error, `500`:

```json
{ "success": false, "message": "Internal server error" }
```

## Deployment Notes

1. Run `npm install --omit=dev` from `aws/sap-ph3-order-lambda`.
2. Zip `index.js`, `package.json`, `package-lock.json`, and `node_modules`.
3. Create an AWS Lambda function with runtime Node.js 20.x.
4. Set the handler to `index.handler`.
5. Configure environment variables in Lambda, preferably with database password and SAP token managed through AWS Secrets Manager or encrypted Lambda environment variables.
6. Connect API Gateway `POST` route to the Lambda integration.
7. Ensure the Lambda network can reach PostgreSQL AWS. For RDS in a VPC, attach Lambda to the right VPC subnets and security group.
8. If RDS requires TLS, set `DB_SSL=true`.

The Lambda uses parameterized queries and does not log `AUTH.TOKEN`, `DB_PASSWORD`, or connection strings.
