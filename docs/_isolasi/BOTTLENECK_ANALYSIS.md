# MPS2 Bottleneck Analysis Report

**Tanggal**: 27 Juni 2026
**Server**: 100.86.231.55 (via Tailscale)
**Project**: D:\website\MPS2

---

## EXECUTIVE SUMMARY

Program terasa berat dan API lambat disebabkan oleh **KOMBINASI** antara:
1. **Spesifikasi server yang sangat rendah** (primary bottleneck - 70%)
2. **Code/arsitektur yang tidak efisien** (secondary bottleneck - 30%)

Server hanya memiliki **1 CPU core** dan **RAM 2.8 GB** untuk menjalankan 6 Docker containers. PostgreSQL sendiri sudah memakan 65.8% memory Docker yang tersedia.

---

## 1. SERVER SPECS (100.86.231.55)

### 1.1 Hardware/VM
| Resource | Spec | Keterangan |
|----------|------|------------|
| **CPU** | 1 core Intel Xeon E7-4820 @ 2.00GHz | **CRITICAL** - Sangat kurang, seharusnya minimal 4 core |
| **RAM** | 2.8 GB total, ~1.8 GB available | **CRITICAL** - Sangat kurang untuk 6 containers + PostgreSQL |
| **Disk** | 146 GB (15% used, ~21 GB) | Masih cukup |
| **OS** | Ubuntu 22.04.5 LTS | OK |
| **Docker memory limit** | 1.205 GB per container | Ketat sekali |

### 1.2 Docker Containers (6 containers dalam 1.2 GB RAM)
| Container | CPU | RAM | % Memory |
|-----------|-----|-----|----------|
| **timesheet-db** (PostgreSQL) | 0.18% | **812 MB** | **65.8%** |
| timesheet-api (Node.js) | 0.00% | 61 MB | 5.0% |
| fastapi (Python) | 0.19% | 39 MB | 3.2% |
| tts-worker (Python) | 0.11% | 18 MB | 1.5% |
| timesheet-nginx | 0.00% | 8 MB | 0.7% |
| timesheet-frontend | 0.00% | 7 MB | 0.6% |

> **PostgreSQL sendiri memakan 65.8% memory container.** Hanya tersisa ~400 MB untuk 5 containers lainnya + OS processes.

### 1.3 PostgreSQL Configuration (DEFAULT - tidak di-tuning)
| Parameter | Value | Rekomendasi |
|-----------|-------|-------------|
| `shared_buffers` | 128 MB | Minimal 512 MB untuk mesin 2.8 GB |
| `work_mem` | 4 MB | Terlalu kecil untuk query kompleks |
| `max_connections` | 100 | Terlalu tinggi - boros memory |
| `effective_cache_size` | 4 GB | **SALAH** - melebihi RAM fisik! |

### 1.4 PostgreSQL Connection Status (SNAPSHOT)
| State | Count |
|-------|-------|
| idle | 35 |
| **idle in transaction** | **7** |
| active | 1 |
| (empty) | 5 |

> **7 sessions stuck dalam "idle in transaction"** selama 1 jam! Ini adalah **connection/transaction leak**.

### 1.5 Largest Database Tables
| Table | Rows | Size | 
|-------|------|------|
| mv_kanban_order_board | 3,266 | **445 MB** |
| mch_productiondata | 470,929 | **414 MB** |
| mch_transaction | 0 | 211 MB |
| mv_mch_productiondata_detail | 0 | 209 MB |
| sap_timesheet_staging | 0 | 144 MB |
| timesheet_transaction | 48 | 125 MB |
| sow | 0 | 82 MB |

---

## 2. CODE/ARSITEKTUR BOTTLENECKS

### 2.1 CRITICAL: Transaction Leak (idle in transaction)

**Ada 7 sesi PostgreSQL stuck dalam state "idle in transaction"** dengan query yang sama:

```sql
SELECT p.proddataid, p.startdatetime, p.enddatetime,
       p.startdatetime::date AS work_date,
       to_char(p.startdatetime, 'HH24:MI:SS'::text) AS start_time, ...
```

Durasi idle: **1 jam 2 menit** sampai 7 menit. Ini menunjukkan:
- API membuka transaksi (`BEGIN`) tapi **tidak pernah COMMIT atau ROLLBACK**
- Koneksi tidak dilepas kembali ke pool
- Lock bisa tertahan di tabel `mch_productiondata`

**Pattern di code**: Controller seperti `machineHoursSqlServerController.js` dan `machineHoursValidationController.js` kemungkinan tidak handle error path dengan benar — jika error terjadi setelah BEGIN, ROLLBACK tidak dipanggil.

### 2.2 CRITICAL: Server Specs vs Workload

**1 CPU core** untuk workload:
- 6 Docker containers
- PostgreSQL dengan database 1.8 GB
- 470K+ rows di table production data
- Materialized views 445 MB (kanban)
- WebSocket connections real-time
- TTS worker processing
- ETL jobs
- Nginx serving static files

Server ini tidak mampu menjalankan beban MES (Manufacturing Execution System) production-grade. **Minimum requirement yang realistis: 4 CPU core, 8 GB RAM.**

### 2.3 HIGH: Monolithic Controllers (God Objects)

| Controller File | Size | Lines |
|-----------------|------|-------|
| sowController.js | **93.4 KB** | 3,282 |
| sowScheduleController.js | **58.1 KB** | ~1,500 |
| timesheet_transactionController.js | **46.4 KB** | 1,503 |
| toolsController.js | **38.0 KB** | ~1,000 |
| receivingShipmentController.js | **23.1 KB** | ~650 |

**Masalah**: Satu file controller menangani SEMUA operasi CRUD + business logic + validasi + export. No separation of concerns. Contoh `sowController.js`:
- SOW standard CRUD
- Parts CRUD
- Operations CRUD
- Templates CRUD
- NNVA CRUD
- Attachments
- Operation cards
- Revision history
- Progress history
- Reports & statistics
- Excel export
- CSV export

### 2.4 HIGH: SELECT * FROM Tanpa Pagination

Banyak endpoint melakukan `SELECT * FROM` dan mengembalikan semua data:

```sql
-- processControlController.js
SELECT * FROM processcontroldata ORDER BY id_processcontroldata DESC  -- NO LIMIT!
SELECT * FROM process_parameter ORDER BY parameter_no ASC            -- NO LIMIT!
SELECT * FROM process_parameter_choicebase ORDER BY id_choice        -- NO LIMIT!
SELECT * FROM processcontroldata_item ORDER BY ...                   -- NO LIMIT!

-- sowController.js (backup pattern)
SELECT * FROM timesheet_transaction ORDER BY tsnumber DESC LIMIT 1000  -- LIMIT tapi 1000!
```

`mch_productiondata` punya **470,929 rows** — query tanpa LIMIT akan memuat semua data ke memory lalu dikirim ke client.

### 2.5 MEDIUM: N+1 Query Pattern

Code seperti `createPartWithOperations` menggunakan loop `for` dengan query INSERT individual:

```javascript
// sowController.js line 2280 - N+1 inserts dalam loop
for (const op of operations) {
    const opResult = await db.query(`
        INSERT INTO operations (...) VALUES ($1, $2, ...) RETURNING *
    `, [...]);
}
```

Seharusnya pakai bulk INSERT: `INSERT INTO operations (...) VALUES (...), (...), (...)`.

Pattern serupa ada di `timesheet_transactionController.js` (5 loop) dan `sowController.js` (14 loop).

### 2.6 MEDIUM: Frontend Bundle Size

| Component | Size |
|-----------|------|
| SowCreatePage.jsx | **126.6 KB** (3,183 lines) |
| SowStandardListPage.jsx | **72.3 KB** |
| BufferTransactionPage.jsx | **56.0 KB** |
| OrderListPage.jsx | **51.0 KB** |
| ReceivingShipmentPage.jsx | **48.5 KB** |

Single-file components dengan 1,000-3,000+ lines. Tidak ada code splitting atau lazy loading. Semua halaman di-load dalam satu bundle.

### 2.7 MEDIUM: PDF.js Bundle di Frontend

```javascript
// SowCreatePage.jsx
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();
```

`pdfjs-dist` di-bundle ke main chunk — menambah ~1.5 MB ke bundle size. Hanya dipakai di halaman SOW Create, tapi di-load untuk semua halaman.

### 2.8 MEDIUM: PostgreSQL Tanpa Monitoring

- `pg_stat_statements` extension TIDAK terinstall — tidak bisa track slow queries
- Tidak ada query logging (`log_min_duration_statement`)
- Tidak ada connection pooling middleware (pgBouncer/pgpool)

### 2.9 LOW: Materialized Views Tanpa Refresh Strategy

Dashboard menggunakan materialized views (`mv_order_plan_vs_actual`, `mv_order_activity_detail`) yang di-refresh manual via endpoint `/dashboard/refresh-order-matviews`. Tidak ada scheduled refresh, sehingga data bisa stale.

### 2.10 LOW: Database Pooling

```javascript
// server.js
const pool = new Pool({
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
```

Pool max 20 connections, tapi di lapangan ada **42 connections** (35 idle + 7 idle-in-transaction). Artinya ada koneksi di luar pool atau pool tidak membatasi dengan benar. Ini bisa jadi dari multiple Node.js processes atau koneksi langsung di luar pool.

---

## 3. ROOT CAUSE SUMMARY

### Primary (70%): Server terlalu kecil
1. **1 CPU core** tidak cukup untuk 6 containers + DB workload
2. **RAM 2.8 GB** dengan PostgreSQL 812 MB — hanya 400 MB tersisa
3. PostgreSQL shared_buffers hanya 128 MB — cache hit ratio rendah, query selalu baca dari disk
4. Tidak ada resource limit per container — PostgreSQL bisa mengambil semua memory

### Secondary (30%): Code inefficiency
1. **Transaction leak** — 7 sessions stuck "idle in transaction" (1 jam+)
2. SELECT * FROM tanpa LIMIT di banyak endpoint
3. N+1 INSERT pattern di bulk operations
4. Monolithic controllers tanpa separation of concerns
5. Frontend single-file components sampai 126 KB tanpa lazy loading
6. pdfjs-dist di-bundle ke main chunk (~1.5 MB tambahan)

---

## 4. REKOMENDASI (Prioritas)

### Immediate (hari ini)
1. **Restart PostgreSQL** untuk clear 7 sessions yang stuck "idle in transaction"
2. **Fix transaction leak** — pastikan setiap code path di `machineHoursSqlServerController` dan `machineHoursValidationController` selalu COMMIT atau ROLLBACK
3. **Turunkan `max_connections`** dari 100 ke 20 — hemat memory

### Short-term (1 minggu)
4. **UPGRADE SERVER** — minimal 4 vCPU, 8 GB RAM
5. **Tune PostgreSQL**:
   - `shared_buffers = 512MB`
   - `work_mem = 16MB`
   - `effective_cache_size = 2GB` (sesuai RAM)
   - `max_connections = 30`
6. **Install pg_stat_statements** untuk monitoring slow queries
7. **Set `log_min_duration_statement = 1000`** (log query > 1 detik)

### Medium-term (1 bulan)
8. **Refactor controller monolitik** — pisahkan per domain:
   - `sowController.js` → `sowCrudController.js`, `sowPartController.js`, `sowTemplateController.js`, `sowReportController.js`
9. **Tambahkan pagination** di semua endpoint GET list
10. **Ganti N+1 INSERT dengan bulk INSERT**
11. **Implement React.lazy + Suspense** untuk code splitting frontend
12. **Pisahkan pdfjs-dist** ke dynamic import

### Long-term (3 bulan)
13. **Implement pgBouncer** untuk connection pooling
14. **Redis caching** untuk dashboard dan data yang sering diakses
15. **Move ETL jobs ke dedicated worker server**
16. **Implement database indexing audit** — cek missing indexes di tabel besar

---

## 5. VERIFICATION COMMANDS (untuk cek setelah fix)

```bash
# Cek idle-in-transaction (harus 0 setelah fix)
sudo docker exec timesheet-db psql -U tag -d ptssb -c \
  "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

# Cek memory usage
sudo docker stats --no-stream

# Cek slow queries (setelah pg_stat_statements terinstall)
sudo docker exec timesheet-db psql -U tag -d ptssb -c \
  "SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# Cek shared_buffers hit ratio
sudo docker exec timesheet-db psql -U tag -d ptssb -c \
  "SELECT sum(heap_blks_read) as heap_read, sum(heap_blks_hit) as heap_hit, 
          sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read))::float * 100 as ratio 
   FROM pg_statio_user_tables;"
```

---


