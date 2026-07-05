Saya ingin membuat **AWS Lambda Function menggunakan Node.js** untuk menerima data dari **SAP CPI** melalui **AWS API Gateway**, lalu menyimpan data tersebut ke database **PostgreSQL AWS** pada tabel:

```sql
public.ph3_order
```

## 1. Konteks Arsitektur

Flow sistem yang diinginkan:

```text
SAP CPI
→ AWS API Gateway
→ AWS Lambda Node.js
→ PostgreSQL AWS
→ public.ph3_order
```

Lambda ini akan menerima payload JSON dari SAP CPI, melakukan validasi payload, validasi token, mapping field SAP ke PostgreSQL, lalu melakukan proses **insert, upsert/update, atau marking delete** berdasarkan nilai `indicator_code`.

---

## 2. Payload JSON dari SAP CPI

Payload yang diterima dari SAP CPI berbentuk seperti ini:

```json
{
  "AUTH": {
    "TOKEN": "string"
  },
  "DATA": {
    "RUECK": "string",
    "ZINDICATOR": "string",
    "LTXA1": "string",
    "AUFNR": "string",
    "VORNR": "string",
    "FLGAT": "string",
    "PLNFL": "string",
    "VORNR_B": "string",
    "VORNR_R": "string",
    "MATNR": "string",
    "MAKTX": "string",
    "ZTXT04_VORNR": "string",
    "ARBPL": "string",
    "KOSTL": "string",
    "WERKS": "string",
    "VGE01": "string",
    "VGW01": "string",
    "AUART": "string",
    "ZTXT04_AUFNR": "string"
  }
}
```

---

## 3. Mapping Field SAP ke PostgreSQL

Mapping dari payload SAP ke tabel `public.ph3_order` adalah sebagai berikut:

| SAP Field           | PostgreSQL Column       |
| ------------------- | ----------------------- |
| `DATA.AUFNR`        | `order_no`              |
| `DATA.RUECK`        | `confirmation_number`   |
| `DATA.ZINDICATOR`   | `indicator_code`        |
| `DATA.LTXA1`        | `operation_short_text`  |
| `DATA.VORNR`        | `operation_no`          |
| `DATA.FLGAT`        | `sequence_category`     |
| `DATA.PLNFL`        | `sequence_number`       |
| `DATA.VORNR_B`      | `branch_operation_no`   |
| `DATA.VORNR_R`      | `return_operation_no`   |
| `DATA.MATNR`        | `material_no`           |
| `DATA.MAKTX`        | `material_description`  |
| `DATA.ZTXT04_VORNR` | `operation_description` |
| `DATA.ARBPL`        | `work_center`           |
| `DATA.KOSTL`        | `cost_center`           |
| `DATA.WERKS`        | `plant_code`            |
| `DATA.VGE01`        | `unit_of_measure`       |
| `DATA.VGW01`        | `standard_value`        |
| `DATA.AUART`        | `order_type`            |
| `DATA.ZTXT04_AUFNR` | `order_description`     |

---

## 4. Runtime dan Library

Buat Lambda Function dengan ketentuan berikut:

* Runtime: **Node.js 20.x**
* Library PostgreSQL: `pg`
* Format handler AWS Lambda boleh menggunakan **CommonJS**
* Gunakan PostgreSQL connection pool yang aman untuk AWS Lambda
* Gunakan parameterized query untuk mencegah SQL injection
* Jangan hardcode credential di source code

---

## 5. Environment Variables

Gunakan environment variables berikut:

```env
DB_HOST=
DB_PORT=5432
DB_NAME=
DB_USER=
DB_PASSWORD=
SAP_TOKEN=
```

Credential database dan token SAP wajib dibaca dari environment variables.

---

## 6. API Gateway Body Handling

Pastikan Lambda handler bisa membaca body dari AWS API Gateway.

Handle beberapa kemungkinan berikut:

### Jika `event.body` berupa string JSON

```js
const body = JSON.parse(event.body);
```

### Jika `event.body` sudah berupa object

Tetap bisa diproses tanpa error.

### Jika body kosong atau invalid JSON

Return HTTP status code `400`.

Contoh response:

```json
{
  "success": false,
  "message": "Invalid JSON body"
}
```

---

## 7. Autentikasi Token

Validasi token dari payload:

```js
body.AUTH.TOKEN
```

Bandingkan dengan:

```js
process.env.SAP_TOKEN
```

Jika token tidak ada atau tidak sesuai, return HTTP status code `401`.

Response:

```json
{
  "success": false,
  "message": "Unauthorized"
}
```

Jangan log token ke CloudWatch.

---

## 8. Validasi Payload Wajib

Validasi minimal field berikut wajib ada:

```text
AUTH.TOKEN
DATA.AUFNR
DATA.RUECK
DATA.VORNR
DATA.ZINDICATOR
```

Mapping field wajib tersebut:

| Field SAP         | Kegunaan              |
| ----------------- | --------------------- |
| `AUTH.TOKEN`      | Autentikasi request   |
| `DATA.AUFNR`      | `order_no`            |
| `DATA.RUECK`      | `confirmation_number` |
| `DATA.VORNR`      | `operation_no`        |
| `DATA.ZINDICATOR` | `indicator_code`      |

Jika salah satu field wajib tidak ada atau kosong, return HTTP status code `400`.

Contoh response:

```json
{
  "success": false,
  "message": "Missing required field: DATA.AUFNR"
}
```

---

## 9. Key Utama untuk Identifikasi Data

Untuk seluruh proses `INST`, `UPDT`, dan `DEL`, gunakan kombinasi key berikut:

```sql
order_no,
confirmation_number,
operation_no
```

Mapping dari SAP payload:

```js
order_no = body.DATA.AUFNR
confirmation_number = body.DATA.RUECK
operation_no = body.DATA.VORNR
```

Jangan hanya menggunakan `order_no` dan `operation_no`, karena `confirmation_number` juga digunakan untuk memastikan record lebih spesifik.

---

## 10. Logic Berdasarkan `indicator_code`

Field `indicator_code` berasal dari:

```js
body.DATA.ZINDICATOR
```

Nilai yang valid hanya:

```text
INST
UPDT
DEL
```

Jika nilai selain itu dikirim, return HTTP status code `400`.

Response:

```json
{
  "success": false,
  "message": "Invalid indicator_code. Allowed values: INST, UPDT, DEL"
}
```

---

# 10.1 Jika `indicator_code = "INST"`

Lakukan **insert data baru** ke tabel:

```sql
public.ph3_order
```

Gunakan key unik:

```sql
order_no,
confirmation_number,
operation_no
```

Jika data dengan kombinasi key tersebut belum ada, lakukan insert.

Jika data dengan kombinasi key tersebut sudah ada, jangan insert duplicate.

Return HTTP status code `409`.

Response:

```json
{
  "success": false,
  "message": "Data already exists for this order_no, confirmation_number, and operation_no"
}
```

Untuk `INST`, jangan gunakan `ON CONFLICT DO UPDATE`, karena jika SAP mengirim instruction `INST`, artinya seharusnya membuat data baru. Jika sudah ada, anggap conflict.

---

# 10.2 Jika `indicator_code = "UPDT"`

Lakukan **update atau upsert** berdasarkan kombinasi key:

```sql
order_no,
confirmation_number,
operation_no
```

Artinya:

* Jika record dengan kombinasi key tersebut sudah ada, lakukan `UPDATE`
* Jika record belum ada, lakukan `INSERT`
* Gunakan:

```sql
ON CONFLICT (order_no, confirmation_number, operation_no)
DO UPDATE
```

Saat update, update semua field yang relevan dari payload SAP.

Pastikan kolom `note` di-reset menjadi `NULL`, karena data yang sebelumnya pernah ditandai `DELETE` bisa menjadi aktif kembali jika SAP mengirim `UPDT`.

Contoh conflict strategy:

```sql
ON CONFLICT (order_no, confirmation_number, operation_no)
DO UPDATE SET
  indicator_code = EXCLUDED.indicator_code,
  operation_short_text = EXCLUDED.operation_short_text,
  sequence_category = EXCLUDED.sequence_category,
  sequence_number = EXCLUDED.sequence_number,
  branch_operation_no = EXCLUDED.branch_operation_no,
  return_operation_no = EXCLUDED.return_operation_no,
  material_no = EXCLUDED.material_no,
  material_description = EXCLUDED.material_description,
  operation_description = EXCLUDED.operation_description,
  work_center = EXCLUDED.work_center,
  cost_center = EXCLUDED.cost_center,
  plant_code = EXCLUDED.plant_code,
  unit_of_measure = EXCLUDED.unit_of_measure,
  standard_value = EXCLUDED.standard_value,
  order_type = EXCLUDED.order_type,
  order_description = EXCLUDED.order_description,
  note = NULL,
  updated_at = NOW()
```

---

# 10.3 Jika `indicator_code = "DEL"`

Jangan hapus data secara fisik dari database.

Lakukan **soft delete / marking delete** dengan cara update kolom:

```sql
note = 'DELETE'
```

Berdasarkan kombinasi key:

```sql
order_no,
confirmation_number,
operation_no
```

Jika record ditemukan, update:

```sql
indicator_code = 'DEL',
note = 'DELETE',
updated_at = NOW()
```

Jika record tidak ditemukan, return HTTP status code `404`.

Response:

```json
{
  "success": false,
  "message": "Data not found for delete marking"
}
```

Jangan melakukan `DELETE FROM public.ph3_order`.

---

## 11. PostgreSQL Unique Constraint

Buatkan SQL untuk membuat unique constraint berikut:

```sql
ALTER TABLE public.ph3_order
ADD CONSTRAINT ph3_order_unique_order_confirmation_operation
UNIQUE (order_no, confirmation_number, operation_no);
```

Sebelum membuat constraint, berikan juga query pengecekan duplicate agar constraint tidak gagal dibuat.

Contoh query pengecekan duplicate:

```sql
SELECT
  order_no,
  confirmation_number,
  operation_no,
  COUNT(*) AS total
FROM public.ph3_order
GROUP BY
  order_no,
  confirmation_number,
  operation_no
HAVING COUNT(*) > 1;
```

Jika ada duplicate, berikan contoh strategi cleanup sederhana sebelum constraint dibuat.

---

## 12. Audit Column

Tambahkan handling audit column jika tersedia di tabel:

```text
created_at
updated_at
```

Saat insert:

```sql
created_at = NOW()
updated_at = NOW()
```

Saat update:

```sql
updated_at = NOW()
```

Buatkan juga SQL untuk menambah kolom audit jika belum ada:

```sql
ALTER TABLE public.ph3_order
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.ph3_order
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```

---

## 13. Kolom `note`

Kolom `note` digunakan untuk marking delete dari SAP.

Jika belum ada, buatkan SQL:

```sql
ALTER TABLE public.ph3_order
ADD COLUMN IF NOT EXISTS note TEXT;
```

Logic kolom `note`:

| Kondisi | Value `note` |
| ------- | ------------ |
| `INST`  | `NULL`       |
| `UPDT`  | `NULL`       |
| `DEL`   | `DELETE`     |

---

## 14. Response Lambda

### Jika `INST` berhasil

Return HTTP status code `201`.

```json
{
  "success": true,
  "message": "Data inserted successfully",
  "action": "INST",
  "data": {
    "order_no": "...",
    "confirmation_number": "...",
    "operation_no": "..."
  }
}
```

### Jika `UPDT` berhasil

Return HTTP status code `200`.

```json
{
  "success": true,
  "message": "Data upserted successfully",
  "action": "UPDT",
  "data": {
    "order_no": "...",
    "confirmation_number": "...",
    "operation_no": "..."
  }
}
```

### Jika `DEL` berhasil

Return HTTP status code `200`.

```json
{
  "success": true,
  "message": "Data marked as deleted successfully",
  "action": "DEL",
  "data": {
    "order_no": "...",
    "confirmation_number": "...",
    "operation_no": "..."
  }
}
```

### Jika duplicate saat `INST`

Return HTTP status code `409`.

```json
{
  "success": false,
  "message": "Data already exists for this order_no, confirmation_number, and operation_no"
}
```

### Jika data tidak ditemukan saat `DEL`

Return HTTP status code `404`.

```json
{
  "success": false,
  "message": "Data not found for delete marking"
}
```

### Jika database error

Return HTTP status code `500`.

```json
{
  "success": false,
  "message": "Internal server error"
}
```

Jangan expose password, connection string, stack trace lengkap, atau detail sensitif di response API.

---

## 15. Logging

Tambahkan logging sederhana ke CloudWatch:

Log ketika request diterima:

```text
SAP order payload received
```

Log key utama:

```text
order_no
confirmation_number
operation_no
indicator_code
```

Jangan log:

```text
AUTH.TOKEN
DB_PASSWORD
connection string
```

Log error secara aman.

---

## 16. Struktur File yang Saya Mau

Buat project Lambda sederhana dengan struktur:

```text
sap-ph3-order-lambda/
├── index.js
├── package.json
├── .env.example
└── sql/
    ├── 001_alter_table.sql
    └── 002_unique_constraint.sql
```

---

## 17. Output yang Saya Mau dari Jawaban

Tolong berikan:

1. Struktur folder project
2. Isi file `package.json`
3. Isi file `index.js`
4. Isi file `.env.example`
5. SQL untuk menambah kolom:

   * `created_at`
   * `updated_at`
   * `note`
6. SQL untuk cek duplicate
7. SQL untuk membuat unique constraint
8. Contoh request JSON untuk:

   * `INST`
   * `UPDT`
   * `DEL`
9. Contoh response sukses untuk:

   * `INST`
   * `UPDT`
   * `DEL`
10. Contoh response error:

* unauthorized
* missing field
* duplicate insert
* delete data not found
* invalid indicator_code
* database error

11. Catatan singkat deployment ke AWS Lambda dan API Gateway
12. Catatan singkat setting environment variables di AWS Lambda
13. Catatan singkat dependency deployment untuk package `pg`

---

## 18. Catatan Teknis Penting

Pastikan kode:

* Siap digunakan di AWS Lambda
* Aman dari SQL injection
* Menggunakan parameterized query
* Tidak hardcode credential
* Bisa handle `event.body` string maupun object
* Menggunakan PostgreSQL connection pool dengan benar
* Tidak melakukan physical delete untuk `DEL`
* Menggunakan key utama:

```sql
order_no,
confirmation_number,
operation_no
```

* Menggunakan `indicator_code` sebagai penentu action:

  * `INST` = insert only
  * `UPDT` = update/upsert
  * `DEL` = marking delete ke kolom `note`
