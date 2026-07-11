# Tahapan EWS Dashboard

## 2026-07-01

### Selesai - Tahap 1A: Layer tabel EWS

- Menambahkan migration `database/migrations/api/20260701_create_ews_layer.sql`.
- Isi migration:
  - `ews.kpi_snapshot` untuk menyimpan hasil KPI per window.
  - `ews.alert_log` untuk stream alert yang benar-benar muncul.
  - `ews.action_table` dan `ews.action_history` untuk correction queue.
  - `ews.kpi_threshold` untuk threshold KPI supaya tidak hardcode penuh di frontend.
- Seed threshold awal:
  - Uptime normal >= 98, warning 95-98, critical < 95.
  - Accuracy normal >= 97, warning 95-97, critical < 95.
  - Adoption normal >= 95, warning 90-95, critical < 90.
  - OEE normal >= 65, warning 50-65, critical < 50.
  - OLE normal >= 85, warning 70-85, critical < 70.

Catatan perhitungan: tahap ini belum menghitung KPI; ini hanya fondasi tabel snapshot, alert, action, dan threshold.

### Selesai - Tahap 1B: API service kalkulasi KPI system-level

- Menambahkan `apps/api/services/ewsCalculator.js`.
- Menambahkan `apps/api/controllers/ewsController.js`.
- Menambahkan `apps/api/routes/ews.js`.
- Mendaftarkan route di `apps/api/server.js` sebagai `/ews`, sehingga dari frontend Vite bisa dipanggil lewat `/api/ews/...`.
- Endpoint yang tersedia:
  - `GET /api/ews/summary?window=15m`
  - `GET /api/ews/issues?window=15m&limit=5`
  - `GET /api/ews/actions?status=Open`
  - `GET /api/ews/kpi/:type/detail`

Ringkasan perhitungan dashboard:

- Uptime:
  - Numerator: `SUM(success_count)` dari `public.mch_machine_ping_log`.
  - Denominator: `SUM(ping_count)`.
  - Formula: `success_count / ping_count * 100`.
- Accuracy:
  - Denominator: record timesheet dalam window + row SAP staging dalam window.
  - Error timesheet: order/operation kosong untuk row produktif, checkin kosong, checkout stale lebih dari 30 menit, duration null/negatif, mismatch duration lebih dari 0.10 jam, SOW tidak match, atau planhours kosong untuk row produktif.
  - Error SAP: hanya `status = FAILED`; `PENDING` dicatat sebagai backlog, bukan error.
  - Formula: `(1 - error_records / total_records) * 100`.
- Adoption:
  - Numerator: `SUM(timesheet_transaction.duration)`.
  - Denominator: `SUM(mch_transaction.duration_hours)` selain status `No Job` dan `Off`.
  - Formula: `recorded_hours / expected_hours * 100`, dicap 0-100.
- OEE:
  - Numerator: machine event productive (`status_activitytype = M1` atau status `Productive`).
  - Denominator: semua machine event berdurasi positif selain `No Job` dan `Off`.
  - Formula: `running_hours / denominator_hours * 100`.
- OLE:
  - Numerator: duration timesheet produktif (`activitytype IS NULL` dan `order_no` terisi).
  - Denominator: total recorded duration timesheet non-deleted.
  - Formula: `working_hours / available_recorded_hours * 100`.
- Overall score:
  - Rata-rata `min(kpi_value / target, 1)` untuk KPI yang punya data.
  - Overall status menjadi `CRITICAL` jika ada KPI critical, `WATCH` jika ada KPI watch, selain itu `NORMAL`.

Catatan kritis:

- Ini masih live calculation di request, lalu mencoba menyimpan snapshot ke `ews.kpi_snapshot`.
- Belum ada job periodik terpisah; itu masih tahap berikutnya kalau beban DB dashboard mulai terasa.
- `shift_id` di migration dibuat `NOT NULL DEFAULT 0` agar unique constraint snapshot bisa dipakai untuk upsert. Jika `NULL`, PostgreSQL akan mengizinkan duplikasi.
- Setelah test awal kena `too many clients already`, kalkulasi API diubah dari paralel menjadi sequential untuk mengurangi tekanan koneksi PostgreSQL.

### Selesai - Tahap 1C: Wiring frontend EWS Control Tower ke API

- Mengubah `apps/web/src/components/ews/EwsControlTower.jsx` dari data statis/random menjadi fetch ke `GET /api/ews/summary?window=15m`.
- Refresh otomatis setiap 60 detik.
- KPI tile sekarang memakai value, status, helper, issue list, overall status, overall score, dan correction queue dari API.
- Jika API gagal, UI menampilkan pesan error kecil dan tidak memalsukan angka live.
- Jika KPI tidak punya data dalam window, tile menampilkan `--%` dan status `NO DATA`.

Catatan perhitungan yang tampil:

- Nilai persen yang muncul di tile berasal langsung dari API hasil kalkulasi Tahap 1B.
- Progress bar dicap antara 0-100 hanya untuk display agar layout tidak pecah; detail denominator tetap ada di API.
- Top Issues dibuat dari KPI status `watch` atau `critical`, bukan dari data statis.

### Verifikasi Tahap 1

- `node --check apps/api/services/ewsCalculator.js` berhasil.
- `node --check apps/api/controllers/ewsController.js` berhasil.
- `node --check apps/api/routes/ews.js` berhasil.
- `npm run build` di `apps/web` berhasil.
- Test kalkulasi langsung ke DB belum berhasil karena PostgreSQL mengembalikan `sorry, too many clients already` pada query pertama. Artinya verifikasi runtime endpoint masih tertahan kondisi koneksi DB, bukan syntax/build.

Catatan risiko yang masih terbuka:

- Migration `20260701_create_ews_layer.sql` perlu dijalankan di database target sebelum snapshot/action table dipakai penuh.
- Formula OLE tahap awal memakai denominator total recorded timesheet, sehingga tidak mendeteksi operator yang tidak login sama sekali. Gap login tetap harus dibaca bersama Adoption.
- Endpoint summary saat ini masih live calculation; untuk production sebaiknya dilanjutkan dengan job periodik yang mengisi `ews.kpi_snapshot`.

### Selesai - Tahap 1D: Koreksi formula Adoption menjadi time bucket coverage

Masukan baru:

- Adoption tidak cukup dihitung dari total jam `timesheet_transaction.duration / mch_transaction.duration_hours`.
- Harus bisa mendeteksi range waktu mana operator tidak melakukan transaksi.
- Jika HMI/machine event memiliki `statusid = 5`, itu bukan `No Job`; status ini adalah `Unidentified` dan harus muncul sebagai gap kategori sendiri.

Koreksi yang dibuat:

- Mengubah `calculateAdoption()` di `apps/api/services/ewsCalculator.js`.
- Adoption sekarang dihitung dengan bucket 5 menit dari event `public.mch_transaction`.
- `statusid = 4` / `No Job` tetap dikeluarkan dari denominator.
- `statusid = 5` / `Unidentified` tetap masuk denominator, tetapi diklasifikasikan sebagai `unidentified`, bukan dianggap covered.
- Matching timesheet dilakukan per bucket:
  - match kuat: `mch_transaction.sn_employee = timesheet_transaction.serialnumber`.
  - fallback: `machineid/workcentercode` sama pada bucket waktu yang sama.
- Detail API sekarang membawa:
  - `expected_bucket_count`
  - `covered_bucket_count`
  - `missing_bucket_count`
  - `unidentified_bucket_count`
  - `missing_time_buckets` sample 12 gap terbaru berisi `bucket_start`, `bucket_end`, `machine_key`, `operator_key`, `operator_name`, dan `gap_type`.

Formula baru Adoption:

```text
adoption_pct = covered_bucket_count / expected_bucket_count * 100
```

Definisi bucket:

```text
expected bucket =
  bucket 5 menit yang overlap dengan mch_transaction
  dan status bukan No Job / Off.

covered bucket =
  expected bucket yang punya timesheet pada bucket waktu yang sama,
  match by operator serialnumber atau fallback machine/workcenter,
  dan bukan Unidentified.

missing_timesheet =
  expected bucket tanpa match timesheet.

unidentified =
  expected bucket dengan statusid = 5 atau status_description = Unidentified.
```

Catatan kritis:

- Ini lebih benar untuk EWS karena bisa menunjukkan lubang waktu, bukan cuma total jam.
- Fallback machine/workcenter bisa menutupi missing operator kalau serialnumber HMI kosong. Itu sengaja dipakai sebagai kompromi tahap awal, tapi drilldown berikutnya perlu memisahkan `operator_missing` vs `machine_covered_operator_unknown`.
- Untuk analisis “hari itu” yang benar-benar kalender tanggal/shift, endpoint berikutnya perlu menerima `date=YYYY-MM-DD` atau `shift_id`. Saat ini summary masih berbasis relative window seperti `15m` atau `24h`.

### Selesai - Tahap 1E: Stabilitas koneksi DB dan summary EWS per hari

Masalah baru:

- `dashboard operations-hub error: sorry, too many clients already`.
- Penyebab paling mungkin: `getOperationsHub()` menjalankan 8 query dashboard secara paralel dengan `pool.query()`. Satu request bisa memakai banyak koneksi pool sekaligus; beberapa tab/user dapat cepat memenuhi PostgreSQL `max_connections`.

Perbaikan Operations Hub:

- Mengubah `apps/api/controllers/dashboardController.js` pada `getOperationsHub()`.
- Sekarang satu request mengambil satu `client = await pool.connect()`, lalu semua query dashboard memakai client yang sama.
- Ini tidak otomatis membuat query lebih ringan, tetapi menurunkan konsumsi koneksi dari kira-kira 8 koneksi/request menjadi 1 koneksi/request.

Perbaikan EWS daily summary:

- Mengubah `calculateSystemSummary()` agar menerima `basis=today`.
- Frontend `EwsControlTower` sekarang memanggil:

```text
GET /api/ews/summary?basis=today
```

- Window current:

```text
today_start = date_trunc('day', now())
today_end   = now()
```

- Window pembanding:

```text
previous_start = today_start - 1 day
previous_end   = now() - 1 day
```

Alasan pembanding ini:

- Jika sekarang jam 10:00, maka current adalah hari ini 00:00-10:00.
- Previous adalah kemarin 00:00-10:00.
- Ini lebih adil daripada membandingkan hari ini parsial dengan full-day kemarin.

UI comparison:

- Setiap KPI tile sekarang menampilkan nilai sebelumnya (`Prev ...`) dan delta.
- Jika KPI naik, tampil segitiga hijau.
- Jika KPI turun, tampil segitiga merah.
- Jika flat/no data, tampil indikator abu-abu.

Catatan kritis:

- Error `too many clients already` bisa tetap muncul jika ada proses lain di luar API yang menahan koneksi PostgreSQL. Perbaikan ini mengurangi konsumsi koneksi dari endpoint dashboard, tetapi bukan pengganti audit koneksi DB.
- Summary EWS sekarang harian untuk UI, tetapi endpoint rolling window tetap dipertahankan lewat `window=15m` untuk kebutuhan lain.

### Selesai - Tahap 1F: Cache pendek untuk endpoint dashboard berat

Temuan verifikasi:

- Runtime test `calculateSystemSummary({ basis: 'today' })` timeout setelah 60 detik.
- Ini menunjukkan summary harian live calculation current + previous terlalu berat jika dihitung langsung di request, terutama karena membaca tabel besar dua kali.

Perbaikan sementara yang dibuat:

- `GET /dashboard/operations-hub` sekarang punya in-memory TTL cache 30 detik.
- `GET /api/ews/summary` sekarang punya in-memory TTL cache 60 detik dengan key berdasarkan `basis/window`.
- Response cache hit menambahkan header:

```text
X-Cache: HIT
```

- Response hasil query baru menambahkan:

```text
X-Cache: MISS
```

Catatan kritis:

- Cache in-memory hanya mengurangi hit berulang setelah request pertama berhasil.
- Ini belum menyelesaikan first-hit latency untuk EWS harian.
- Solusi yang benar untuk ribuan user adalah job periodik yang menghitung `ews.kpi_snapshot`, lalu endpoint summary cukup membaca snapshot terbaru. Dokumen `redis-cache-controller-analysis.md` juga menempatkan dashboard sebagai prioritas tinggi untuk cache-aside TTL pendek.

### Selesai - Tahap 1G: Realtime SSE berbasis snapshot background job

Koreksi arsitektur:

- Kalkulasi KPI tidak boleh dilakukan oleh client, endpoint HTTP dashboard, maupun proses broadcast SSE.
- Kalkulasi dipindahkan ke background job Node.js `apps/api/jobs/ewsSnapshotJob.js`.
- API sekarang berperan sebagai broadcaster ringan:
  - listen `ews_snapshot_ready`
  - baca 1 row terbaru dari `ews.kpi_snapshot`
  - broadcast payload compact ke semua client SSE

Perubahan database:

- Migration `database/migrations/api/20260701_create_ews_layer.sql` ditambah function/trigger:
  - `ews.notify_source_changed()` mengirim `pg_notify('ews_source_changed', ...)`.
  - Trigger source table dibuat statement-level untuk:
    - `public.timesheet_transaction`
    - `public.mch_transaction`
    - `public.mch_machine_ping_log`
    - `public.sap_timesheet_staging`
    - `public.processcontroldata`
    - `ews.action_table`
    - `ews.kpi_threshold`
  - `ews.notify_snapshot_ready()` mengirim `pg_notify('ews_snapshot_ready', ...)` saat `ews.kpi_snapshot` insert/update.

Perubahan backend:

- Menambahkan `apps/api/services/ewsRealtimeHub.js`.
  - Endpoint SSE: `GET /api/ews/stream?basis=today`.
  - Heartbeat default 25 detik.
  - Max client default 1500.
  - Broadcast memakai event `snapshot` untuk initial state dan `patch` untuk update incremental.
- Menambahkan script package API:

```text
npm run ews:snapshot
```

- Job bersifat event-driven dari `ews_source_changed`, tetapi juga punya safety interval default 60 detik (`EWS_JOB_INTERVAL_MS=60000`) karena KPI berbasis waktu bisa berubah walau tidak ada transaksi baru.
- Safety interval bisa dimatikan dengan `EWS_JOB_INTERVAL_MS=0`.
- `GET /api/ews/summary` sekarang default membaca snapshot, bukan live calculation.
- Live calculation masih bisa dipaksa dengan `?live=1`, tetapi itu bukan mode dashboard production.

Perubahan frontend:

- `apps/web/src/components/ews/EwsControlTower.jsx` tidak lagi memakai `setInterval` dan `fetch` berkala.
- Frontend memakai `EventSource('/api/ews/stream?basis=today')`.
- Auto reconnect mengikuti mekanisme browser `EventSource` + retry server 3 detik.
- UI menampilkan status `SSE LIVE` / `RECONNECTING`.
- PWA Workbox mengecualikan `/api/ews/stream` dari cache API.

Dokumentasi:

- Menambahkan `docs/operations/ews-realtime-sse-architecture.md`.
- Isi dokumen:
  - runtime flow PostgreSQL -> background job -> snapshot -> API SSE -> React.
  - best practice connection management, heartbeat, payload kecil, horizontal scaling, Redis Pub/Sub opsional, dan optimasi PostgreSQL.

Catatan kritis:

- Ini menghilangkan polling dan per-client query ke tabel transaksi.
- Beban database sekarang terutama ada di background job. Jika kalkulasi masih lambat, perbaikan berikutnya harus pada SQL/index/pre-aggregation job, bukan mengembalikan kalkulasi ke request API.

### Selesai - Tahap 1H: Resilience EWS realtime

Perbaikan SSE versioning:

- Event SSE `snapshot` sekarang memakai `id` dari `ews.kpi_snapshot.id`.
- Payload membawa `version` yang sama dengan snapshot id.
- Client menyimpan version terakhir dan mengabaikan event dengan `version <= currentVersion`.
- Saat client connect/reconnect, server mengirim full compact snapshot terbaru.
- Patch granular tidak dipakai sebagai default tahap ini; seluruh update dashboard memakai event `snapshot` compact.

Perbaikan freshness/stale data:

- Payload snapshot membawa:
  - `calculated_at`
  - `snapshot_age_seconds`
  - `freshness_status`: `FRESH`, `STALE`, atau `NO_SNAPSHOT`
  - `freshness_threshold_seconds`
- Rule stale:

```text
now - calculated_at > 2 * EWS_JOB_INTERVAL_MS
```

- UI EWS menampilkan badge freshness dan warning jika snapshot stale.
- UI memakai timer lokal ringan untuk mendeteksi stale jika job berhenti total; ini bukan polling API/database.

Health endpoint:

- Menambahkan:

```text
GET /api/ews/health
```

- Isi health:
  - `snapshot_available`
  - `last_snapshot_at`
  - `snapshot_age_seconds`
  - `freshness_status`
  - `latest_version`
  - `sse_clients`
  - `listener_connected`
  - `job_expected_interval_ms`

Advisory lock background job:

- `apps/api/jobs/ewsSnapshotJob.js` sekarang memakai PostgreSQL advisory lock sebelum kalkulasi.
- Default lock key:

```text
EWS_JOB_ADVISORY_LOCK_KEY=27112026
```

- Jika lock sudah dipegang proses lain, job skip kalkulasi dan log bahwa instance lain sedang aktif.
- Lock dilepas di `finally`, termasuk saat kalkulasi error.

Catatan kritis:

- PostgreSQL `LISTEN/NOTIFY` diperlakukan sebagai realtime hint, bukan durable queue.
- Controlled safety interval `EWS_JOB_INTERVAL_MS` harus tetap ada karena NOTIFY bisa terlewat saat listener/job mati.
- Kalkulasi KPI tetap tidak dilakukan di trigger PostgreSQL, handler HTTP API, atau SSE hub.

### Selesai - Tahap 1I: Fix pool starvation pada EWS snapshot job

Temuan runtime:

```text
[EWS job] snapshot run failed: Error: timeout exceeded when trying to connect
No EWS snapshot available for grain today
```

Penyebab:

- Job memakai 1 koneksi permanen untuk `LISTEN ews_source_changed`.
- Job memakai 1 koneksi lagi untuk session-level advisory lock.
- Default `EWS_JOB_DB_POOL_MAX=2` membuat kalkulator KPI tidak punya koneksi tersisa untuk query `ewsCalculator`.

Perbaikan:

- Default pool job dinaikkan menjadi 4.
- Jika env `EWS_JOB_DB_POOL_MAX` diset di bawah 4, job otomatis menaikkan ke 4 dan menulis warning.
- Logging akhir job diubah dari `run completed` menjadi `run finished` dengan field:
  - `succeeded`
  - `skipped`
  - `duration_ms`
- Job sekarang menulis progress log:
  - `run started`
  - `target started`
  - `still running` setiap `EWS_JOB_PROGRESS_LOG_MS` (default 15 detik)
- Batas pembatalan query tetap memakai PostgreSQL/pg timeout:
  - `EWS_JOB_QUERY_TIMEOUT_MS`
  - `EWS_JOB_STATEMENT_TIMEOUT_MS`

Catatan:

- Minimum 4 koneksi tetap ringan untuk job background, tetapi cukup untuk kombinasi `LISTEN`, advisory lock, dan kalkulasi snapshot.
- Jika setelah `target started` log `still running` terus muncul sampai timeout, bottleneck ada di SQL kalkulasi KPI, bukan di SSE atau LISTEN/NOTIFY.

### Selesai - Tahap 1J: Adoption dikeluarkan dari realtime critical path

Temuan runtime:

- Snapshot job gagal pada `calculateAdoption()` dengan `Query read timeout`.
- `GET /api/ews/health` menunjukkan snapshot tersedia tetapi `STALE`, artinya SSE/API sehat tetapi job gagal memperbarui snapshot.

Keputusan:

- Adoption adalah KPI paling mahal karena menghitung coverage bucket 5 menit antara `mch_transaction` dan `timesheet_transaction`.
- Adoption tidak perlu realtime per menit; near-realtime 10 menit masih dapat diterima.

Perubahan:

- Main EWS snapshot tidak menghitung Adoption secara default.
- Env untuk memaksa perilaku lama:

```text
EWS_CALCULATE_ADOPTION_IN_MAIN=1
```

- Jika ada nilai Adoption dari snapshot sebelumnya, main snapshot memakai nilai cached tersebut.
- Jika belum ada cache, Adoption tampil `NO DATA`, tetapi KPI lain tetap tersimpan dan dashboard tetap update.
- Kalkulasi KPI lain dibungkus safe calculation supaya satu KPI error tidak menggagalkan seluruh snapshot.

Rencana berikutnya:

- Menambahkan table/job agregasi khusus Adoption:
  - `ews.adoption_bucket_snapshot`
  - `ews.adoption_summary_snapshot`
  - `apps/api/jobs/ewsAdoptionBucketJob.js`
- Script:

```text
npm run ews:adoption
```

- Job Adoption berjalan tiap 10 menit (`EWS_ADOPTION_JOB_INTERVAL_MS=600000`).
- Dashboard tetap membaca compact snapshot dari `ews.kpi_snapshot`; detail bucket/missing time hanya lewat drilldown on-demand.
