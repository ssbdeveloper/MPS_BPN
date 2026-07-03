# Analisis: PostgreSQL Connection Exhaustion MPS2

> Status: Investigasi selesai, rekomendasi diperbarui.
> Tanggal awal: 2026-06-27
> Revisi: 2026-07-02
> Database: PostgreSQL 15, `max_connections = 50`
> Aplikasi: MPS2, Node.js + Express + pg.Pool, Docker services, worker jobs

---

## 1. Ringkasan

Masalah utama bukan connection leak tunggal, tetapi kombinasi:

| # | Penyebab | Dampak |
|---|----------|--------|
| 1 | Banyak service/container membuat pool PostgreSQL sendiri | Baseline koneksi langsung ke DB tinggi |
| 2 | `mpsDashboardSocket.js` menjalankan beberapa `pool.query()` secara paralel per WebSocket client | Pool API cepat penuh saat beberapa dashboard aktif |
| 3 | EWS memakai `LISTEN/NOTIFY` dan advisory lock | Membutuhkan session connection yang menetap |
| 4 | Koneksi eksternal seperti DBeaver dan ETL | Mengurangi headroom dari `max_connections = 50` |

Kesimpulan pendek:

- Tidak cukup hanya "menaikkan max_connections".
- Perlu mengurangi fan-out query WebSocket, membatasi pool size, dan memakai PgBouncer secara selektif.
- PgBouncer `transaction` pooling tidak boleh diterapkan membabi-buta ke semua service karena `LISTEN/NOTIFY` dan session-level advisory lock tidak cocok dengan transaction pooling.

---

## 2. Analisis Komponen

### 2.1 Pool Per Service

Setiap service yang memakai PostgreSQL memiliki pool atau koneksi sendiri.

| Service | Estimasi pool/koneksi | Catatan |
|---------|-----------------------|---------|
| `timesheet-api` | `DB_POOL_MAX`, sebelumnya sekitar 10 | Pool utama HTTP/API |
| `ews-snapshot-job` | minimal 4 | Perlu `LISTEN`, advisory lock, dan query KPI |
| `ews-adoption-job` | minimal 3 | Perlu advisory lock dan query adoption |
| `sow-exporter` | default pg.Pool bisa 10 jika tidak dibatasi | Sebaiknya dibatasi jika service hidup lama |
| `machine-ping-worker` | kecil, tetapi tetap pool terpisah | Sebaiknya 1-2 |
| `fastapi` | tergantung SQLAlchemy config | Perlu dicek pool size aktual |
| `tts-worker` | koneksi Python | Biasanya kecil |

Risiko:

- Banyak pool kecil tetap bisa menjumlah menjadi besar.
- Jika semua service diarahkan langsung ke PostgreSQL, `max_connections = 50` cepat habis saat ada external tools.

### 2.2 WebSocket Dashboard

File:

```text
apps/api/websocket/mpsDashboardSocket.js
```

Masalah:

```js
const [a, b, c, d, e] = await Promise.all([
  pool.query(sql1),
  pool.query(sql2),
  pool.query(sql3),
  pool.query(sql4),
  pool.query(sql5),
]);
```

Dampak:

- Satu refresh dashboard bisa meminjam beberapa koneksi pool bersamaan.
- Jika banyak client membuka dashboard, jumlah query paralel naik tajam.
- Ini lebih berbahaya daripada pool idle biasa karena terjadi bersamaan saat interval refresh.

Rekomendasi:

- Gabungkan menjadi satu query CTE jika memungkinkan.
- Jika belum sempat, jalankan serial agar satu request tidak mengambil banyak koneksi sekaligus.
- Lebih baik lagi, migrasikan dashboard berat ke model snapshot/background job seperti EWS.

### 2.3 EWS LISTEN/NOTIFY

File:

```text
apps/api/services/ewsRealtimeHub.js
apps/api/jobs/ewsSnapshotJob.js
```

EWS menggunakan:

- `LISTEN ews_snapshot_ready` di API/SSE hub.
- `LISTEN ews_source_changed` di snapshot job.
- PostgreSQL advisory lock di background job.

Ini bukan connection leak. Koneksi `LISTEN` memang harus hidup selama process hidup.

Konsekuensi penting:

- `LISTEN/NOTIFY` membutuhkan session connection.
- `pg_try_advisory_lock()` juga session-level lock.
- Keduanya tidak cocok jika diarahkan ke PgBouncer `transaction` pooling.

Jika PgBouncer dipakai:

- API HTTP biasa boleh lewat PgBouncer transaction pool.
- EWS listener harus direct ke PostgreSQL atau lewat PgBouncer `session` pool khusus.
- Background job dengan session advisory lock sebaiknya direct ke PostgreSQL, kecuali lock diubah menjadi transaction-level `pg_try_advisory_xact_lock()` dengan transaksi eksplisit.

### 2.4 Pool Options Node `pg`

Catatan koreksi:

Opsi berikut memang dikenal oleh driver `pg` versi yang dipakai project:

```js
query_timeout
statement_timeout
idle_in_transaction_session_timeout
```

Jadi jangan dokumentasikan ini sebagai opsi invalid. Tetap perlu dibedakan:

- `statement_timeout` di config client/pool mengirim setting ke connection.
- `options: "-c statement_timeout=..."` juga bisa dipakai.
- Hindari duplikasi yang membingungkan; pilih satu pola yang konsisten.

Rekomendasi praktis:

- Tetapkan timeout penting di connection `options` atau config pool, tetapi dokumentasikan satu sumber kebenaran.
- Untuk database-wide guardrail, `ALTER DATABASE ... SET idle_in_transaction_session_timeout` tetap berguna.

### 2.5 Python ETL dan External Tools

Python jobs yang memakai context manager umumnya aman dari leak:

```py
with psycopg2.connect(**config) as conn:
    ...
```

Tetapi tetap perlu dikontrol:

- Jangan jalankan banyak ETL berat bersamaan tanpa jadwal.
- DBeaver bisa membuka beberapa koneksi per window/editor.
- External idle connection sebaiknya dimonitor dan diberi timeout.

---

## 3. Apakah Ada Connection Leak?

Indikasi utama saat ini lebih mengarah ke connection pressure, bukan leak permanen.

Yang relatif aman:

- Controller yang memakai `pool.query()` karena client otomatis dikembalikan ke pool.
- Pattern `pool.connect()` dengan `client.release()` di `finally`.
- Koneksi `LISTEN` EWS yang hidup lama karena memang desainnya begitu.

Tetap perlu audit jika ada:

- `pool.connect()` tanpa `finally`.
- Transaksi yang tidak `COMMIT`/`ROLLBACK`.
- Worker yang crash sebelum `pool.end()` saat one-shot mode.

---

## 4. Rekomendasi Prioritas

### P0 - Fix WebSocket Query Fan-Out

Ini perbaikan cepat dengan impact tinggi.

Target:

- Satu refresh dashboard tidak boleh mengambil 5 koneksi bersamaan.
- Minimal ubah `Promise.all(pool.query(...))` menjadi serial.
- Idealnya gabungkan ke satu SQL dengan CTE.

Contoh minimal serial:

```js
const a = await pool.query(sql1);
const b = await pool.query(sql2);
const c = await pool.query(sql3);
const d = await pool.query(sql4);
const e = await pool.query(sql5);
```

Contoh lebih baik:

```sql
WITH labor_today AS (...),
     oee_trend AS (...),
     loss_breakdown AS (...),
     pareto_loss AS (...),
     lean_dist AS (...)
SELECT jsonb_build_object(
  'labor_today', (SELECT ... FROM labor_today),
  'oee_trend', (SELECT ... FROM oee_trend),
  'loss_breakdown', (SELECT ... FROM loss_breakdown),
  'pareto_loss', (SELECT ... FROM pareto_loss),
  'lean_dist', (SELECT ... FROM lean_dist)
);
```

### P1 - Turunkan Pool Size Per Service

Tanpa PgBouncer, batasi pool agar total koneksi tidak mendekati 50.

Rekomendasi awal:

| Service | Rekomendasi |
|---------|-------------|
| `api` | `DB_POOL_MAX=5` sampai `8` |
| `ews-snapshot-job` | tetap minimal `4` |
| `ews-adoption-job` | tetap minimal `3` |
| `machine-ping-worker` | `1` sampai `2` |
| `sow-exporter` | `1` sampai `2` jika long-running |

Catatan:

- Jangan turunkan `ews-snapshot-job` di bawah 4 tanpa refactor, karena job butuh listener, advisory lock, dan spare query connections.
- Jangan turunkan `ews-adoption-job` di bawah 3 tanpa refactor.

### P2 - Tambahkan Pool Metrics

Tambahkan logging periodik di API:

```js
setInterval(() => {
  console.log("[DB Pool]", {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  });
}, 30000);
```

Metrics yang penting:

- `waitingCount > 0` berulang berarti pool API bottleneck.
- `totalCount` tinggi tapi `idleCount` tinggi berarti pool terlalu besar atau workload burst.
- `idleCount` rendah dan query lambat berarti DB/query bottleneck.

### P3 - PgBouncer Selektif

PgBouncer tetap rekomendasi jangka panjang, tetapi harus dipakai selektif.

Gunakan PgBouncer `transaction` pooling untuk:

- API HTTP request biasa.
- Controller CRUD/report yang tidak butuh session state.
- Worker query biasa yang tidak memakai `LISTEN`, cursor session panjang, temp table lintas transaksi, atau session advisory lock.

Jangan gunakan PgBouncer `transaction` pooling untuk:

- `LISTEN/NOTIFY`.
- Session-level advisory lock seperti `pg_try_advisory_lock()`.
- Long-lived session state.
- Transaksi yang mengandalkan prepared statement/session behavior tertentu.

Pilihan aman:

1. `api` punya dua jalur DB:
   - Query HTTP biasa ke PgBouncer.
   - EWS listener direct ke PostgreSQL.
2. EWS job tetap direct ke PostgreSQL.
3. Jika benar-benar ingin lewat PgBouncer, buat pool mode `session` khusus untuk listener/job.

Contoh env yang lebih aman:

```env
# Untuk API query biasa
DB_HOST=pgbouncer
DB_PORT=6432

# Untuk EWS LISTEN/advisory-lock path
EWS_DB_HOST=db
EWS_DB_PORT=5432
```

Implementasi kode perlu mendukung env terpisah ini sebelum deploy PgBouncer selektif.

### P4 - Database-Level Guardrail

Set timeout database:

```sql
ALTER DATABASE ptssb SET idle_in_transaction_session_timeout = '10min';
ALTER DATABASE ptssb SET statement_timeout = '2min';
```

Catatan:

- Ini berlaku untuk koneksi baru.
- Hati-hati dengan query/report yang memang butuh waktu lebih panjang.
- Untuk job berat, lebih baik set timeout spesifik di job.

---

## 5. PgBouncer Draft Yang Aman

Implementasi awal yang aman sudah diarahkan seperti ini:

| Workload | Host DB | Alasan |
|----------|---------|--------|
| `timesheet-api` query HTTP biasa | `pgbouncer:6432` | Cocok untuk transaction pooling |
| EWS SSE listener di dalam API | `db:5432` via `EWS_DB_HOST` / `EWS_DB_PORT` | Butuh session connection untuk `LISTEN` |
| `ews-snapshot-job` | `db:5432` | Butuh `LISTEN` dan session advisory lock |
| `ews-adoption-job` | `db:5432` | Masih memakai session advisory lock |

Compose sekarang memakai PgBouncer hanya untuk `api`:

```yaml
pgbouncer:
  image: bitnami/pgbouncer:latest
  container_name: pgbouncer
  environment:
    - PGBOUNCER_DATABASE=ptssb
    - PGBOUNCER_PORT=6432
    - PGBOUNCER_POOL_MODE=transaction
    - PGBOUNCER_DEFAULT_POOL_SIZE=15
    - PGBOUNCER_RESERVE_POOL_SIZE=5
    - PGBOUNCER_MAX_CLIENT_CONN=200
    - POSTGRESQL_HOST=db
    - POSTGRESQL_PORT=5432
    - POSTGRESQL_USERNAME=${DB_USER}
    - POSTGRESQL_PASSWORD=${DB_PASSWORD}
  depends_on:
    db:
      condition: service_healthy
  networks:
    - timesheet-network
```

Bagian penting di `api`:

```yaml
api:
  environment:
    - DB_HOST=pgbouncer
    - DB_PORT=6432
    - EWS_DB_HOST=db
    - EWS_DB_PORT=5432
```

Jangan mengubah `ews-snapshot-job` dan `ews-adoption-job` ke PgBouncer transaction mode sebelum lock/listener-nya direfactor.

Deploy service terkait:

```bash
docker compose up -d --build pgbouncer api
```

Jika deploy bersamaan dengan perubahan EWS/frontend:

```bash
docker compose up -d --build pgbouncer api frontend ews-snapshot-job ews-adoption-job
```

---

## 6. Monitoring Query Koneksi

Query cepat untuk melihat koneksi aktif:

```sql
SELECT
  application_name,
  state,
  wait_event_type,
  wait_event,
  COUNT(*) AS connections
FROM pg_stat_activity
WHERE datname = 'ptssb'
GROUP BY application_name, state, wait_event_type, wait_event
ORDER BY connections DESC;
```

Cari query lama:

```sql
SELECT
  pid,
  application_name,
  state,
  now() - query_start AS age,
  left(query, 200) AS query
FROM pg_stat_activity
WHERE datname = 'ptssb'
  AND state <> 'idle'
ORDER BY age DESC;
```

Cari transaksi idle:

```sql
SELECT
  pid,
  application_name,
  now() - xact_start AS xact_age,
  left(query, 200) AS query
FROM pg_stat_activity
WHERE datname = 'ptssb'
  AND state = 'idle in transaction'
ORDER BY xact_age DESC;
```

---

## 7. Kesimpulan

Diagnosis inti tetap valid: koneksi habis karena connection pressure dari banyak pool, dashboard query paralel, dan koneksi eksternal.

Rekomendasi yang sudah dikoreksi:

- Fix WebSocket query fan-out dulu.
- Kurangi pool size dengan hati-hati.
- Tambahkan metrics.
- Pakai PgBouncer secara selektif, bukan untuk semua koneksi.
- EWS `LISTEN/NOTIFY` dan session advisory lock harus tetap direct ke PostgreSQL atau memakai session pooling khusus.

PgBouncer penting, tetapi bukan solusi yang boleh diterapkan rata ke semua service tanpa memisahkan workload session-sensitive.

---

## 8. Referensi File

| File | Temuan |
|------|--------|
| `apps/api/server.js` | Pool utama API, kandidat metrics dan pool-size tuning |
| `apps/api/websocket/mpsDashboardSocket.js` | Query dashboard paralel, prioritas refactor |
| `apps/api/services/ewsRealtimeHub.js` | `LISTEN/NOTIFY`, butuh session connection |
| `apps/api/jobs/ewsSnapshotJob.js` | `LISTEN/NOTIFY` + advisory lock, jangan lewat transaction pooling |
| `apps/api/jobs/ewsAdoptionBucketJob.js` | Advisory lock, hati-hati dengan transaction pooling |
| `docker-compose.yml` | Banyak service DB client |
| `scripts/ping_m5051_machines.js` | Worker dengan pool sendiri |
| `jobs/sow/seed_sow.js` | Pool perlu dibatasi jika long-running |
