# API and DB Performance Actions

Tanggal cek: 2026-06-28

Fokus masalah saat ini:

- Ada session `idle in transaction` dari `192.168.100.1` dengan `application_name` kosong. Ini terlihat seperti client/tool eksternal atau koneksi lama, bukan API baru setelah `application_name=mps2-api`.
- `mv_kanban_order_board` hanya sekitar 3 ribu row, tetapi total 445 MB. Table size hanya sekitar 2 MB, index size sekitar 443 MB.
- `mch_transaction`, `mv_mch_productiondata_detail`, dan `sap_timesheet_staging` terlihat kosong tetapi masih memakai ratusan MB. Ini bloat dan perlu maintenance terjadwal.
- PostgreSQL masih default-ish: `max_connections=100`, `statement_timeout=0`, `idle_in_transaction_session_timeout=0`, `shared_buffers=128MB`.

## 1. Cek koneksi berat

Jalankan dari server Docker:

```bash
sudo docker exec -it timesheet-db psql -U tag -d ptssb
```

Lalu:

```sql
SELECT
  pid,
  application_name,
  client_addr,
  state,
  now() - xact_start AS xact_age,
  now() - query_start AS query_age,
  left(regexp_replace(query, '\s+', ' ', 'g'), 220) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND state <> 'idle'
ORDER BY xact_start NULLS LAST, query_start NULLS LAST;
```

Kill hanya session yang benar-benar menggantung dan bukan session sendiri:

```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND state = 'idle in transaction'
  AND pid <> pg_backend_pid()
  AND now() - xact_start > interval '5 minutes';
```

## 2. Tuning aman untuk production kecil

Butuh user superuser. Setelah `ALTER SYSTEM`, restart container DB.

```sql
ALTER SYSTEM SET max_connections = '30';
ALTER SYSTEM SET shared_buffers = '512MB';
ALTER SYSTEM SET effective_cache_size = '2GB';
ALTER SYSTEM SET work_mem = '8MB';
ALTER SYSTEM SET statement_timeout = '60s';
ALTER SYSTEM SET idle_in_transaction_session_timeout = '60s';
ALTER SYSTEM SET log_min_duration_statement = '1000';
ALTER SYSTEM SET track_io_timing = 'on';
```

Restart:

```bash
sudo docker restart timesheet-db
```

Verifikasi:

```sql
SELECT name, setting, unit
FROM pg_settings
WHERE name IN (
  'max_connections',
  'shared_buffers',
  'effective_cache_size',
  'work_mem',
  'statement_timeout',
  'idle_in_transaction_session_timeout',
  'log_min_duration_statement',
  'track_io_timing'
);
```

## 3. Maintenance bloat

Jalankan di jam sepi. `REINDEX` dan `VACUUM FULL` bisa berat dan dapat mengunci objek.

```sql
REINDEX TABLE CONCURRENTLY public.mv_kanban_order_board;
REINDEX TABLE CONCURRENTLY public.timesheet_transaction;
REINDEX TABLE CONCURRENTLY public.sow;

VACUUM (ANALYZE) public.mch_productiondata;
VACUUM (ANALYZE) public.timesheet_transaction;
VACUUM (ANALYZE) public.sow;
VACUUM (ANALYZE) public.ph3_order;
```

Untuk tabel/materialized view yang kosong tetapi masih besar, gunakan hanya saat tidak dipakai:

```sql
VACUUM FULL public.mch_transaction;
VACUUM FULL public.mv_mch_productiondata_detail;
VACUUM FULL public.sap_timesheet_staging;
```

Jika `mv_kanban_order_board` tetap membesar setelah `REINDEX`, refresh ulang lalu reindex lagi:

```sql
SELECT public.refresh_mv_kanban_order_board();
REINDEX TABLE CONCURRENTLY public.mv_kanban_order_board;
ANALYZE public.mv_kanban_order_board;
```

## 4. Monitoring slow query

Install `pg_stat_statements` perlu superuser dan biasanya perlu `shared_preload_libraries`, jadi butuh restart DB. Cek nilai lama dulu supaya tidak menimpa library lain.

```sql
SHOW shared_preload_libraries;
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
```

Restart DB, lalu:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SELECT
  calls,
  round(total_exec_time::numeric, 2) AS total_ms,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  rows,
  left(regexp_replace(query, '\s+', ' ', 'g'), 240) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

## 5. Env API yang disarankan

Tambahkan di environment Docker API, bukan wajib di `.env` lokal:

```env
DB_POOL_MAX=10
DB_CONNECTION_TIMEOUT_MS=5000
DB_IDLE_TIMEOUT_MS=30000
DB_QUERY_TIMEOUT_MS=45000
DB_STATEMENT_TIMEOUT_MS=45000
DB_IDLE_IN_TX_TIMEOUT_MS=30000
DB_APPLICATION_NAME=mps2-api
KANBAN_REFRESH_INTERVAL_MS=300000
```

Kalau server masih 1 CPU, pertimbangkan:

```env
KANBAN_REFRESH_ENABLED=false
```

Aktifkan lagi setelah maintenance DB selesai atau server dinaikkan.
