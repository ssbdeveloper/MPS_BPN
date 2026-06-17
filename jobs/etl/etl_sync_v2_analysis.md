# ETL Sync v2 — Code Analysis & Improvements

## Ringkasan Perubahan

File `etl_sync_v2.py` telah di-refactor. Dokumen ini menjelaskan setiap masalah yang ditemukan, dampaknya, dan solusi yang diterapkan.

---

## 1. `execute_batch` → `execute_values` (Performance: HIGH)

### Masalah
```python
# Sebelum
extras.execute_batch(tgt_cur, upsert_sql, row_tuples)
```
`execute_batch` mengirim **N statement terpisah** ke database — satu per baris. Dengan 1000 baris (BATCH_LIMIT), artinya 1000 round-trip SQL per cycle.

### Solusi
```python
# Sesudah
extras.execute_values(tgt_cur, upsert_sql, row_tuples)
```
`execute_values` mengirim **satu statement** dengan semua baris sekaligus:
```sql
INSERT INTO table (...) VALUES (row1), (row2), ..., (rowN)
ON CONFLICT ... DO UPDATE SET ...
```

Perubahan ini juga memerlukan `build_upsert_query` mengembalikan format `VALUES %s` (bukan `VALUES (%s, %s, ...)`).

**Estimasi speedup:** 5–20× lebih cepat untuk batch besar.

---

## 2. Redundant Round-Trip: UPDATE `status_etl` di Target (Performance: MEDIUM)

### Masalah
```python
# Sebelum — dua operasi ke target DB
extras.execute_batch(tgt_cur, upsert_sql, row_tuples)          # upsert data
tgt_cur.execute(f"UPDATE {tgt_table} SET status_etl = 'UPDATED' "
                f"WHERE confirmation_number = ANY(%s)", ...)   # update status
```
Setelah upsert, ada UPDATE terpisah ke target untuk set `status_etl = 'UPDATED'`. Ini satu round-trip ekstra yang tidak diperlukan.

### Solusi
Override nilai `status_etl` langsung saat membangun `row_tuples` sebelum insert:
```python
_STATUS_ETL_IDX = UPSERT_COLS.index("status_etl")

row_tuples = [
    tuple('UPDATED' if i == _STATUS_ETL_IDX else r[c]
          for i, c in enumerate(UPSERT_COLS))
    for r in rows
]
```
Target langsung menerima `status_etl = 'UPDATED'` via upsert — tanpa UPDATE terpisah.

**Dampak:** -1 query ke target DB per cycle. Mengurangi lock contention dan latency.

---

## 3. `SELECT FOR UPDATE SKIP LOCKED` (Stability: HIGH)

### Masalah
```python
# Sebelum — plain SELECT tanpa lock
src_cur.execute(
    f"SELECT ... FROM {SRC_TABLE} WHERE plant_code = %s AND status_etl = 'NEW' ...",
    (plant_filter,),
)
```
Jika dua worker memproses plant yang sama (atau plant_filter overlap), keduanya bisa membaca baris yang sama sebelum salah satunya commit UPDATE ke `status_etl = 'UPDATED'`. Hasilnya: **double-processing** atau conflict error.

### Solusi
```python
src_cur.execute(
    f"SELECT ... FROM {SRC_TABLE} WHERE plant_code = %s AND status_etl = 'NEW' "
    f"ORDER BY created_at ASC LIMIT {BATCH_LIMIT} FOR UPDATE SKIP LOCKED",
    (plant_filter,),
)
```
- `FOR UPDATE`: row-level lock dipegang sampai `src_conn.commit()`
- `SKIP LOCKED`: worker lain yang coba baca baris yang sudah di-lock akan **skip** (bukan block/wait)

**Dampak:** Eliminasi double-processing jika plant filter pernah overlap. Juga aman jika instance ETL dijalankan di dua server sekaligus (multi-instance deployment).

---

## 4. Connection Keepalives & Options (Stability: HIGH)

### Masalah
Koneksi PostgreSQL yang idle terlalu lama (> timeout NAT/firewall) akan **di-drop diam-diam** oleh jaringan. Ketika koneksi dari pool dipakai lagi, operasi gagal dengan error `connection closed` atau `broken pipe` yang hanya terdeteksi saat query sudah dijalankan.

Selain itu, tidak ada `connect_timeout` — jika DB tidak bisa dijangkau, koneksi bisa **hang selamanya**.

### Solusi
```python
_CONN_OPTIONS = {
    "connect_timeout": 10,      # gagal setelah 10 detik jika tidak bisa connect
    "keepalives": 1,            # aktifkan TCP keepalive
    "keepalives_idle": 60,      # kirim probe setelah 60 detik idle
    "keepalives_interval": 10,  # interval antar probe
    "keepalives_count": 5,      # putuskan koneksi setelah 5 probe gagal
    "options": "-c statement_timeout=30000",  # query > 30 detik akan dibatalkan
}
```
Diterapkan ke semua DSN: `SRC_DSN` dan setiap target DSN via `**_CONN_OPTIONS`.

**Dampak:** Koneksi idle tidak akan mati diam-diam. Operasi yang hang akan timeout. Process tidak akan stuck selamanya.

---

## 5. Perbaikan Minor: `sync_sow` Logic Clarity

### Masalah
Loop `order_material` pertama memiliki logika merge yang agak implisit dan membingungkan:
```python
# Sebelum
if order not in order_material:
    order_material[order] = (row.get("material_no"), row.get("material_description"))
else:
    existing_mat, existing_desc = order_material[order]
    mat  = existing_mat  or row.get("material_no")
    desc = existing_desc or row.get("material_description")
    order_material[order] = (mat, desc)
```

### Solusi
Disederhanakan menjadi:
```python
for row in rows:
    order = row["order_no"]
    mat   = row.get("material_no")
    desc  = row.get("material_description")
    if order not in order_material:
        order_material[order] = (mat, desc)
    else:
        prev_mat, prev_desc = order_material[order]
        order_material[order] = (prev_mat or mat, prev_desc or desc)
```
Logika identik, lebih mudah dibaca.

---

## Yang TIDAK Diubah (dan Alasannya)

| Item | Alasan Dibiarkan |
|------|-----------------|
| `ThreadPoolExecutor(max_workers=len(TARGETS))` | Sudah tepat — 1 worker per target |
| `pool.ThreadedConnectionPool(1, len(TARGETS)*2)` | Adequate untuk 4 concurrent workers |
| Double-checked locking di `_get_tgt_pool` | Benar secara teknis (GIL Python menjamin keamanan) |
| `_drain_target_safe` dengan `Lock.acquire(blocking=False)` | Pattern yang benar untuk skip-if-busy |
| Fallback polling setiap `POLL_INTERVAL` | Diperlukan sebagai safety net jika NOTIFY miss |

---

## Rekomendasi Lanjutan (Tidak Diimplementasi)

### A. Index di Source Table (Prioritas: HIGH)
Pastikan index berikut ada di source DB:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_src_plant_status_created
    ON qh3_order (plant_code, status_etl, created_at)
    WHERE status_etl = 'NEW';
```
Query `WHERE plant_code = %s AND status_etl = 'NEW' ORDER BY created_at` membutuhkan index ini untuk tidak full-scan setiap cycle.

### B. Retry dengan Exponential Backoff (Prioritas: MEDIUM)
Saat ini jika cycle gagal, langsung return False dan menunggu POLL_INTERVAL. Pertimbangkan retry 1–2× dengan delay pendek untuk transient errors (connection blip, deadlock).

### C. Metrics / Health Endpoint (Prioritas: LOW)
Tambahkan counter sederhana (rows processed, cycles failed, last success time) yang bisa di-query via HTTP endpoint kecil (`http.server` atau `prometheus_client`) untuk monitoring tanpa masuk ke log.

### D. Dead Letter Queue untuk Row Bermasalah (Prioritas: LOW)
Jika satu row selalu menyebabkan cycle gagal (data corrupt, type mismatch), ia akan terus di-pick up dan menghambat row lain. Pertimbangkan kolom `retry_count` di source table — setelah N retry, set `status_etl = 'ERROR'` dan skip.

---

## Ringkasan Dampak

| Perubahan | Kategori | Dampak Estimasi |
|-----------|----------|-----------------|
| `execute_values` untuk main upsert | Performance | **5–20× faster** per cycle pada batch besar |
| Hapus redundant UPDATE di target | Performance | -1 DB round-trip per cycle |
| `FOR UPDATE SKIP LOCKED` | Stability | Eliminasi double-processing race condition |
| Keepalives + connect_timeout | Stability | Koneksi tidak drop diam-diam, tidak hang |
| `statement_timeout=30000` | Stability | Query stuck tidak memblok worker selamanya |

---

## Refactor Pass 2 (Readability + Safe Perf)

Pass berikutnya fokus ke struktur kode dan beberapa optimasi aman.

### Struktur
- **`Target` dataclass** menggantikan `dict` — memisahkan config immutable (name/dsn/table/plant/upsert_sql) dari state runtime (pool, pool_lock, drain_lock). `upsert_sql` di-precompute di `Target.from_env(...)`, tidak lagi dimutasi di `main()`.
- **Sections bernomor** di file (Logging, Config, Schema, Target, Pool, Transforms, Cycle, Loop, Main).
- **`run_cycle` dipecah** menjadi `_claim_pending`, `_build_target_tuples`, `_upsert_target`, `_upsert_sow` — fungsi utama kini ±25 baris yang dibaca linear.
- **`_STATUS_ETL_IDX` dihapus** — diganti dengan copy-and-mutate (`cleaned["status_etl"] = "UPDATED"`) yang self-explanatory.
- **Dead code dibersihkan**: `_pool_lock` global tidak pernah dipakai (pool source dibuat sekali di import).
- **Rename**: `_drain_target_safe` → `_drain_if_idle` (nama sesuai behavior).
- **`threading.Event` stop flag** pada `listen_and_process` — shutdown path tersedia untuk testing/integration masa depan (nilai default tetap run-forever).

### Safe Perf — DITERAPKAN

| # | Perubahan | Dampak |
|---|-----------|--------|
| A | `execute_values(..., page_size=len(tuples))` untuk dua call ke target (main upsert + sow upsert) | Default page_size=100 berarti batch 1000-row = 10 statement. Dengan page_size=len(rows), jadi **1 statement**. Ini mengurangi round-trip ~10× per cycle. |
| B | SELECT + UPDATE di source digabung jadi **satu CTE** (`CLAIM_AND_RETURN_SQL` dengan `WITH claimed AS (... FOR UPDATE SKIP LOCKED) UPDATE ... RETURNING`) | Menghilangkan 1 round-trip ke source per cycle. Semantik identik — row baru "released" sebagai UPDATED ke worker lain setelah `src_conn.commit()` yang tetap dijalankan terakhir. |
| C | Pada `InterfaceError`/`OperationalError`, `putconn(conn, close=True)` via `borrow()` context manager | Connection yang sudah rusak tidak dikembalikan ke pool — mencegah cascade "server closed the connection unexpectedly" ke cycle berikutnya. |
| D | **Connection-leak fix** — `borrow()` context manager menggantikan pola `getconn()` + bare `try/finally` | Sebelumnya, kalau `tgt_pool.getconn()` gagal setelah `src_pool.getconn()` sukses, `src_conn` bocor. Dengan `with borrow(src_pool), borrow(tgt_pool)` setiap resource selalu dilepas. Di bawah target outage intermiten, pool source tidak lagi terkuras. |

### Safe Perf — TIDAK DITERAPKAN (didokumentasikan)

Prioritas dari tinggi ke rendah:

1. **Partial index di source table** (prioritas A di dokumen sebelumnya) — butuh aksi DBA.
   ```sql
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_src_plant_status_created
       ON ph3_order (plant_code, created_at)
       WHERE status_etl = 'NEW';
   ```
   Tanpa index ini, CTE baru tetap melakukan scan pada row `NEW` — akseptabel saat backlog kecil tapi degradasi linear terhadap jumlah row.

2. **Retry dengan exponential backoff** untuk transient error (connection blip, deadlock) — pertimbangkan 1–2× retry dengan delay pendek sebelum return `False`.

3. **Metrics / health endpoint** — counter sederhana (rows_processed, cycles_failed, last_success_ts) via `http.server` atau `prometheus_client`.

4. **Dead-letter queue** — kolom `retry_count` di source; setelah N retry, set `status_etl = 'ERROR'` agar tidak menghalangi row lain.

5. **Parallel commit** source dan target — win wall-clock kecil, complexity bertambah (dua executor, error handling bercabang). Skip.

### Ringkasan Dampak Pass 2

| Perubahan | Kategori | Dampak |
|-----------|----------|--------|
| `execute_values(page_size=len(rows))` | Performance | Batch 1000-row: 10 statement → 1 statement (~10×) |
| CTE claim+update gabungan di source | Performance | -1 round-trip per cycle |
| `borrow()` context manager | Stability | Eliminasi connection leak saat target outage |
| `close=True` untuk conn rusak | Stability | Tidak ada lagi poisoned conn beredar di pool |
| `Target` dataclass + sectioned layout | Maintainability | File lebih mudah dibaca & dimodifikasi; test-hook (stop event) tersedia |
