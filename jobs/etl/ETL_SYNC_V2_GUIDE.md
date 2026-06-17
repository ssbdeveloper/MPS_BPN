# Guide ETL Sync V2

## Ringkasan Perubahan

`etl_sync_v2.py` sekarang menjalankan setiap server distribusi sebagai target yang terisolasi:

- Error pada satu target diberi backoff sendiri, jadi target lain tetap jalan.
- Worker tidak ditumpuk jika target yang sama masih berjalan.
- Koneksi target memakai `connect_timeout`, `statement_timeout`, dan `lock_timeout`.
- Upsert target memakai bulk `execute_values`, bukan banyak statement kecil.
- Status target langsung ditulis sebagai `UPDATED` saat upsert, sehingga tidak perlu query update target tambahan.
- Log ditulis ke console dan file rotating log.

## Cara Menjalankan Lokal

```powershell
cd D:\website\MPS2\jobs
.\venv\Scripts\Activate.ps1
python -m pip install psycopg2-binary python-dotenv
python .\etl_sync_v2.py
```

Default file log:

```powershell
D:\website\MPS2\jobs\\logs\etl_sync_v2.log
```

Lihat log realtime:

```powershell
Get-Content .\logs\etl_sync_v2.log -Tail 100 -Wait
```

Cari error target tertentu:

```powershell
Select-String .\logs\etl_sync_v2.log -Pattern "\[BALIKPAPAN\].*(ERROR|WARNING)"
```

## Cara Menjalankan Dengan Docker

```powershell
cd D:\website\MPS2\jobs
docker compose -f .\docker-compose.etl.yml up -d --build
sudo docker compose -f docker-compose.etl.yml up -d --build
```

Lihat log container:

```powershell
docker logs -f timesheet-sap-etl
```

Lihat file log di dalam container:

```powershell
docker exec -it timesheet-sap-etl sh -lc "tail -f /app/logs/etl_sync_v2.log"
```

Restart ETL:

```powershell
docker restart timesheet-sap-etl
```

## Konfigurasi Penting `.env`

Wajib ada untuk source:

```env
SRC_HOST=
SRC_PORT=5432
SRC_DATABASE=
SRC_USER=
SRC_PASSWORD=
SRC_TABLE=
```

Wajib ada untuk setiap target:

```env
TGT_HOST_BALIKPAPAN=
TGT_PORT_BALIKPAPAN=5432
TGT_DATABASE_BALIKPAPAN=
TGT_USER_BALIKPAPAN=
TGT_PASSWORD_BALIKPAPAN=
TGT_TABLE_BALIKPAPAN=
TGT_PLANT_BALIKPAPAN=
```

Target lain mengikuti suffix yang sama: `_SEBAMBAN`, `_KUALA_KENCANA`, `_CIKUPA`.

Opsional tuning:

```env
POLL_INTERVAL_SECONDS=5
BATCH_LIMIT=1000
BATCH_PAGE_SIZE=500
CONNECT_TIMEOUT_SECONDS=5
TARGET_BACKOFF_SECONDS=10
TARGET_MAX_BACKOFF_SECONDS=300
ETL_STATEMENT_TIMEOUT_MS=120000
ETL_LOCK_TIMEOUT_MS=10000
ETL_LOG_LEVEL=INFO
ETL_LOG_FILE=D:\website\MPS2\jobs\\logs\etl_sync_v2.log
```

## Membaca Pola Log

Target sukses:

```text
[BALIKPAPAN] Processed 250 source row(s), upserted 250 target row(s) in 1.42s.
```

Target error dan diisolasi:

```text
[BALIKPAPAN] Cycle failed at stage 'connect target'.
[BALIKPAPAN] Paused for 10s after failed cycle #1: ...
```

Target pulih:

```text
[BALIKPAPAN] Recovered after 3 failed cycle(s).
```

Batch selalu penuh:

```text
[BALIKPAPAN] Processed 1000 source row(s), upserted 1000 target row(s) in 3.25s (batch full).
```

Artinya backlog masih ada. ETL akan lanjut drain batch berikutnya.

## Resolve Error Umum

### Cannot connect to target

Cek `TGT_HOST_*`, `TGT_PORT_*`, firewall, VPN, dan PostgreSQL target.

```powershell
Test-NetConnection <host-target> -Port <port-target>
```

Jika hanya satu target error, target lain tetap jalan. ETL akan retry otomatis setelah backoff.

### Statement timeout atau lock timeout

Biasanya ada query lama atau lock di target/source. Cek lock di database terkait:

```sql
SELECT pid, state, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY query_start NULLS LAST;
```

Mitigasi cepat:

- Turunkan `BATCH_LIMIT`, misalnya `500`.
- Naikkan `ETL_STATEMENT_TIMEOUT_MS` jika data memang besar.
- Pastikan index source ada untuk filter ETL:

```sql
CREATE INDEX IF NOT EXISTS idx_qh3_order_etl_plant_created
ON qh3_order (plant_code, status_etl, created_at);
```

### Error `ON CONFLICT`

Pastikan constraint/index unik tersedia.

Untuk table order target:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_qh3_order_confirmation
ON qh3_order (confirmation_number);
```

Untuk `sow`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_sow_order_operation
ON sow (order_no, operation_no);
```

### Permission denied

Grant minimal untuk user target:

```sql
GRANT SELECT, INSERT, UPDATE ON qh3_order TO <target_user>;
GRANT SELECT, INSERT, UPDATE ON sow TO <target_user>;
```

Grant minimal untuk user source:

```sql
GRANT SELECT, UPDATE ON qh3_order TO <source_user>;
```

### Data masih `NEW`

Cek backlog per plant:

```sql
SELECT plant_code, status_etl, count(*)
FROM qh3_order
WHERE status_etl = 'NEW'
GROUP BY plant_code, status_etl
ORDER BY plant_code;
```

Jika target sudah benar tetapi source gagal commit, data bisa diproses ulang. Ini aman karena target memakai upsert.

## Menambah Target Baru

1. Tambahkan pasangan target di `_TARGET_DEFS` pada `etl_sync_v2.py`.
2. Tambahkan variable `.env` dengan suffix target baru.
3. Restart ETL.

Contoh:

```python
_TARGET_DEFS = [
    ("BALIKPAPAN", "_BALIKPAPAN"),
    ("TARGET_BARU", "_TARGET_BARU"),
]
```

