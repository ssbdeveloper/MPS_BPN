# Runbook: Rollout & Rollback Timesheet Lintas Workcenter

- **Release Manifest**: `timesheet-20261001` (file: `20261001`, `20261001b`, `20261001c`)
- **Scope**: Operator boleh check-in produktif pada `order_no` + `operation_no` yang sama di
  **workcentercode berbeda** (paralel atau sekuensial). Pada workcenter yang sama, request kedua
  ditolak HTTP 409 `DUPLICATE_ACTIVE_OPERATION`.
- **Target Plant**:
  - Cikupa `5100` (`Asia/Jakarta`), varian manufacturing
  - Balikpapan `5051` (`Asia/Makassar`), varian salvaging
- **Status Dokumen**: SELESAI LOKAL, BELUM RILIS. Diverifikasi hanya di DB lab lokal
  (`mps_timesheet_ckp_test`, `mps_timesheet_bpn_test`, `mps2_test_migrate_manifest`).
  Eksekusi di production memerlukan approval tertulis dan jendela maintenance.
- Label **BELUM DIVERIFIKASI** menandai hal yang tidak dapat dibuktikan dari repo dan harus
  dikonfirmasi oleh operator host sebelum dijalankan. Jangan menebak nilainya.

---

## 0. Kontrak Whitespace Workcenter (Final)

Identitas duplikat aktif: `plant` + `serialnumber` + `ltrim(trim(order_no),'0')` +
`operation_no` + workcentercode ternormalisasi.

Normalisasi workcentercode: NULL menjadi `''`, lalu buang code point berikut **hanya di kedua
ujung**. Casing dan spasi internal dipertahankan.

| Code point | Nama |
|---|---|
| U+0020 | space |
| U+0009 | tab |
| U+000D | carriage return |
| U+000A | line feed |
| U+000B | vertical tab |
| U+000C | form feed |
| U+00A0 | no-break space |
| U+FEFF | BOM / zero width no-break space |

| Lapisan | Implementasi |
|---|---|
| SQL | `btrim(COALESCE(workcentercode, ''), E' \t\r\n\x0B\f\u00A0\uFEFF')` |
| API | `WORKCENTER_STRIP_SQL` + `normalizeWorkcenterCode()` di `apps/api/controllers/timesheet_transactionController.js` |
| ETL | `normalize_workcenter_code()` di `jobs/sap_staging/run_timesheet_etl.py` |
| Test paritas | `database/tests/timesheet/test_workcenter_normalization_parity.js` (SQL literal, index live, JS, Python) |

**Peringatan `\v`**: di PostgreSQL, `E'\v'` **bukan** vertical tab, melainkan huruf `v`
(terbukti di lab: `btrim(E'vMILLv', E' \v')` menjadi `MILL`). Migration `20261001` dan
`20261001b` memakai `\v`, sehingga index yang dibangunnya ikut membuang huruf `v` di ujung
workcentercode. Kedua file itu sengaja tidak diubah karena checksum sudah tercatat di ledger
lab. Migration `20261001c` mengenali definisi index buatan `20261001`/`20261001b`, membangun
ulang index dengan `\x0B`, dan abort bila menemukan definisi asing. **Jangan menulis `\v` di
SQL apa pun untuk rilis ini, termasuk query preflight dan rollback.**

---

## 1. Mekanisme Deployment yang Berlaku

Sumber: `docker-compose.yml`, `scripts/deploy.sh`, `docs/deployment/DEPLOYMENT.md`,
`docs/operations/sap-staging-multiplant-runbook.md`. Nama di bawah adalah nama service compose
dan `container_name` yang tertulis di repo.

| Peran | Service compose | Container | Catatan |
|---|---|---|---|
| Writer API (`timesheet_transaction`) | `api` | `timesheet-api` | Image dibangun dari `./apps/api`; kode **tidak** di-mount, wajib rebuild. |
| Writer ETL timesheet otomatis | `sap-stage-worker` | `sap-stage-worker` | `python -u stage_worker.py --loop`; satu siklus = machine hours + `run_timesheet_etl` (`run_timesheet_cycle`). Interval `SAP_STAGE_INTERVAL` (default 900 detik). `./jobs/sap_staging` di-mount ke `/app`; kode baru aktif setelah container di-restart. Menangani SIGTERM dengan menyelesaikan siklus berjalan. |
| Writer staging TIMESHEET lama | `sap-stage-ts-worker` | `sap-stage-ts-worker` | Pensiun 2026-09-30, hanya jalan dengan `--profile legacy`. Harus tetap mati. |
| ETL manual | (bukan service) | - | `python jobs/sap_staging/run_timesheet_etl.py --env prod ...` dari host operator (lihat `timesheet-etl-production-guide.md`). |
| Frontend | `frontend` | `timesheet-frontend` | Image dibangun dari `./apps/web`. |
| Poster SAP | `sap-post-worker` | `sap-post-worker` | Tidak disentuh rilis ini. Jangan ubah statusnya. |
| Antrian UI SAP | `sap-ops-worker` | `sap-ops-worker` | Hanya `stage_machinehours.py --catchup` dan `post_sap_staging.py --failed-only`; tidak menjalankan ETL timesheet. Tidak disentuh rilis ini. |
| Reverse proxy | `nginx` | `timesheet-nginx` | Tidak disentuh. |

Belum diverifikasi dari repo:
- **BELUM DIVERIFIKASI**: direktori compose dan file `.env` per plant di host production
  (ditulis sebagai `<DIR_COMPOSE_PLANT>`). Semua perintah `docker compose` dijalankan dari
  direktori tersebut agar memakai `.env` plant yang benar.
- **BELUM DIVERIFIKASI**: apakah ada penjadwal di luar compose (cron host, Task Scheduler) yang
  memanggil `run_timesheet_etl.py` atau `stage_worker.py --once`. Repo tidak memuatnya. Operator
  host wajib memeriksa dan mencatat hasilnya di Tahap 0.

---

## 2. Prinsip & Precondition

1. **Dilarang menjalankan ETL lama setelah ada data lintas workcenter.** Validator F2 versi lama
   tidak memperhitungkan workcenter dan akan menolak overlap beda workcenter sebagai
   `DUPLICATE_ACTIVITY_OVERLAP`, sehingga window staging berhenti. ETL baru harus aktif sebelum
   API baru menerima check-in lintas workcenter.
2. **Rilis terkoordinasi dalam satu jendela maintenance**: freeze writer → preflight → backup →
   checkout kode → migration → API → frontend → ETL → unfreeze.
3. Index dibangun tanpa `CONCURRENTLY` di dalam satu transaksi. Writer API harus mati selama
   migration.
4. Plant 5100 dan 5051 dikerjakan terpisah, masing-masing dengan target DB dan `.env` sendiri.

---

## 3. Urutan Rollout

### Tahap 0: Catat Kondisi Awal & Freeze Writer

Jalankan di host plant, dari `<DIR_COMPOSE_PLANT>`.

1. Catat status semua service. Simpan output ini; Tahap 7 hanya mengaktifkan kembali service yang
   memang berjalan di sini.
   ```bash
   docker compose ps --all
   docker compose ps --all --services --status running > pre_release_running_services.txt
   ```
2. Pastikan writer legacy tidak berjalan:
   ```bash
   docker ps --filter name=sap-stage-ts-worker --format '{{.Names}} {{.Status}}'
   ```
   *Expected*: kosong. Bila ada, **STOP** dan eskalasi; jangan lanjut.
3. Periksa ETL manual dan penjadwal di luar compose (lihat Bagian 1):
   ```bash
   ps aux | grep -E "run_timesheet_etl.py|stage_worker.py" | grep -v grep
   crontab -l 2>/dev/null | grep -E "run_timesheet_etl|stage_worker"
   ```
   *Expected*: tidak ada proses di luar container dan tidak ada entri jadwal. Bila ada, hentikan
   lewat pemiliknya dan catat. Jangan membunuh proses ETL yang sedang publish; tunggu sampai
   selesai.
4. Hentikan ETL otomatis secara bersih. `stage_worker` menyelesaikan siklus berjalan setelah
   SIGTERM, jadi beri timeout lebih panjang dari durasi siklus terakhir (log:
   `Siklus selesai dalam ...s`):
   ```bash
   docker compose logs --tail 50 sap-stage-worker
   docker compose stop -t <DETIK_LEBIH_DARI_DURASI_SIKLUS> sap-stage-worker
   ```
5. Hentikan writer API. Tablet tidak dapat check-in/check-out selama freeze; umumkan ke shop floor
   sebelumnya.
   ```bash
   docker compose stop api
   ```
6. Bukti freeze (SELECT-only, pada DB plant):
   ```sql
   -- Tidak boleh ada sesi API (application_name default dari apps/api/db.js)
   SELECT count(*) FROM pg_stat_activity
   WHERE datname = current_database() AND application_name = 'mps2-api';

   -- Snapshot writer; jalankan dua kali dengan jeda minimal 2 menit, hasil harus identik
   SELECT (SELECT max(tsnumber) FROM public.timesheet_transaction)                      AS max_tsnumber,
          (SELECT count(*) FROM public.timesheet_transaction WHERE longdate_checkout IS NULL) AS open_rows,
          (SELECT count(*) FROM public.timesheet_etl_run)                              AS etl_runs,
          (SELECT max(started_at) FROM public.timesheet_etl_run)                       AS last_etl_start,
          (SELECT count(*) FROM public.timesheet_etl_run WHERE status = 'PUBLISHING')  AS etl_publishing;
   ```
   *Expected*: 0 sesi `mps2-api`; kedua snapshot identik. `etl_publishing` dicatat dan dievaluasi;
   jangan diubah manual. Bila `DB_APPLICATION_NAME` di `.env` plant diisi, ganti `'mps2-api'`
   dengan nilai itu.
   Catatan: jangan memakai `finished_at IS NULL` sebagai bukti run sedang berjalan. Run berstatus
   `SAP_READY` tidak mengisi `finished_at` (di DB lab CKP terdapat 617 run seperti itu), jadi
   filter tersebut menghasilkan alarm palsu.
   *Stop condition*: writer terbukti masih aktif → jangan lanjut.

### Tahap 1: Preflight Read-only pada DB Target

1. Identitas target:
   ```sql
   SELECT current_database(), current_user, inet_server_addr(), now();
   SELECT plant_code, timezone FROM public.plant_config WHERE id = 1;
   ```
   *Expected*: `5100`/`Asia/Jakarta` atau `5051`/`Asia/Makassar`, sesuai plant yang dituju.
2. Ledger dan index awal:
   ```sql
   SELECT filename, applied_at FROM public.schema_migrations
   WHERE filename LIKE '2026092%' OR filename LIKE '20261001%' ORDER BY filename;
   SELECT to_regclass('public.idx_timesheet_active_productive_op')    AS legacy_idx,
          to_regclass('public.idx_timesheet_active_productive_op_wc') AS wc_idx;
   ```
   *Expected*: ledger ada; `legacy_idx` terisi; `wc_idx` NULL (belum pernah dirilis).
3. Duplikat aktif pada grain baru (kontrak `\x0B`):
   ```sql
   SELECT plant, serialnumber, ltrim(trim(order_no), '0') AS norm_order, operation_no,
          btrim(COALESCE(workcentercode, ''), E' \t\r\n\x0B\f\u00A0\uFEFF') AS norm_wc,
          count(*) AS total_active, array_agg(tsnumber ORDER BY tsnumber) AS tsnumbers
   FROM public.timesheet_transaction
   WHERE longdate_checkout IS NULL
     AND COALESCE(state_flag, 0) <> 5
     AND (activitytype IS NULL OR trim(activitytype) = '')
     AND order_no IS NOT NULL AND trim(order_no) <> ''
     AND operation_no IS NOT NULL
   GROUP BY 1, 2, 3, 4, 5
   HAVING count(*) > 1;
   ```
   *Expected*: **0 baris**. Bila ada baris: **STOP**. Penyelesaian per record adalah keputusan
   owner; jangan menutup record otomatis.

### Tahap 2: Backup

- Ambil backup DB plant dan lakukan latihan restore ke DB terpisah, lalu ulangi Tahap 1 pada
  hasil restore. `scripts/deploy.sh backup` memakai kredensial bawaan yang mungkin bukan milik
  plant target. Prosedur dan lokasi backup production: **BELUM DIVERIFIKASI**; ikuti prosedur
  operasi DB yang berlaku.
- *Stop condition*: backup atau restore gagal.

### Tahap 3: Checkout Kode Rilis di Host

1. Di `<DIR_COMPOSE_PLANT>`, checkout commit rilis yang memuat runbook ini. Mekanisme sinkronisasi
   kode host (git pull, salin artefak): **BELUM DIVERIFIKASI**.
2. Karena `./jobs/sap_staging` di-mount ke container, langkah ini sekaligus menaruh ETL baru.
   Kode baru baru aktif ketika `sap-stage-worker` dinyalakan di Tahap 6.
3. Regression ETL di host (bila Python dan dependency tersedia):
   ```bash
   python -m unittest jobs/sap_staging/test_stage_mode.py
   python database/tests/timesheet/test_etl_f2_cleansing.py
   ```
   *Expected*: 10/10 dan 24/24 lulus (hasil lab).

### Tahap 4: Migration via Ledger Runner

`database/migrate.js` membaca `.env` root untuk `DB_*` yang belum diset di shell, dan `.env`
itu bisa menunjuk plant lain. **Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` eksplisit** dari
konfigurasi resmi plant target. Di compose, service `db` dipetakan ke port host `5433`. Runner
memverifikasi `plant_config.plant_code` dan timezone terhadap `--plant`.

1. Dry-run:
   ```bash
   # Cikupa
   node database/migrate.js --release=timesheet-20261001 --dry-run
   # Balikpapan
   node database/migrate.js --release=timesheet-20261001 --plant=5051 --dry-run
   ```
   *Expected*: pending = `20261001_timesheet_unique_active_productive_op_wc.sql`,
   `20261001b_timesheet_harden_unique_index.sql`, `20261001c_timesheet_wc_index_exact_contract.sql`;
   tidak ada drift; tidak ada DDL dijalankan.
2. Apply:
   ```bash
   # Cikupa
   node database/migrate.js --release=timesheet-20261001 --confirm-release=timesheet-20261001
   # Balikpapan
   node database/migrate.js --release=timesheet-20261001 --plant=5051 --confirm-release=timesheet-20261001
   ```
   Ketiga file dan tiga baris ledger dijalankan dalam **satu transaksi**. Bila satu file gagal,
   seluruh rilis di-ROLLBACK: ledger tidak bertambah, index legacy tetap ada, dan tidak ada index
   baru yang tertinggal. Ini terbukti di `mps2_test_migrate_manifest` dengan kegagalan sengaja di
   file ketiga; setelah penyebab dihapus, apply sukses dan run ulang idempoten.
3. Verifikasi index. `pg_get_indexdef` mencetak karakter kontrol mentah, jadi jangan dibandingkan
   secara visual; pakai query ini:
   ```sql
   SELECT i.indisunique, i.indisvalid, i.indisready,
          strpos(pg_get_indexdef(i.indexrelid),
                 E'btrim(COALESCE(workcentercode, \'\'::text), \' \t\r\n\x0B\f\u00A0\uFEFF\'::text)') > 0
            AS wc_contract_exact,
          strpos(pg_get_indexdef(i.indexrelid), E'\' \t\r\nv\f') > 0 AS legacy_v_literal_present
   FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.idx_timesheet_active_productive_op_wc');

   SELECT to_regclass('public.idx_timesheet_active_productive_op');  -- harus NULL
   SELECT count(*) FROM public.schema_migrations WHERE filename LIKE '20261001%';  -- harus 3
   ```
   *Expected*: `t | t | t | t | f`; index legacy NULL; ledger 3. Hasil lab CKP dan BPN:
   `wc_contract_exact = t`, `legacy_v_literal_present = f`. Kontrol negatif (index gaya
   `20261001b` pada temp table): `f | t`.
   *Stop condition*: hasil berbeda → jangan nyalakan API; masuk Bagian 5.

### Tahap 5: Deploy API dan Frontend

1. API (sama dengan `scripts/deploy.sh update-api`):
   ```bash
   docker compose build --no-cache api
   docker compose up -d api
   docker compose logs --tail 100 api
   ```
2. Frontend (sama dengan `scripts/deploy.sh update-frontend`):
   ```bash
   docker compose build --no-cache frontend
   docker compose up -d frontend
   ```
   `VITE_APP_VARIANT` dibaca saat build. Pastikan `.env` plant berisi varian yang benar
   (5100 manufacturing, 5051 salvaging).
3. Smoke test dengan operator dan order uji yang disetujui owner (**BELUM DIVERIFIKASI**: akun
   uji production):
   - Check-in order/op yang sama di WC A lalu WC B → keduanya 200.
   - Check-in ulang di WC A → 409 `DUPLICATE_ACTIVE_OPERATION`; meal break tidak ditutup.
   - Halaman View Timesheet menampilkan badge `#tsnumber` dan kolom workcenter.
   - Stop per TS hanya menutup TS yang dipilih; Stop All/NFC menutup semua yang aktif.
   - Tutup semua record uji setelah selesai.
   *Stop condition*: smoke gagal → Bagian 5.

### Tahap 6: Aktifkan Kembali ETL

1. Nyalakan kembali hanya service yang tercatat berjalan di Tahap 0:
   ```bash
   grep -x sap-stage-worker pre_release_running_services.txt && docker compose up -d sap-stage-worker
   ```
   `api` dan `frontend` sudah dinyalakan di Tahap 5. Jangan menyalakan `sap-stage-ts-worker`
   atau service lain yang tidak berjalan sebelum freeze.
2. Bila Tahap 0 mencatat penjadwal di luar compose, aktifkan kembali lewat pemiliknya, dari kode
   rilis yang sama.

### Tahap 7: Verifikasi Pasca-Unfreeze

1. Bandingkan status service dengan kondisi awal:
   ```bash
   docker compose ps --services --status running | sort > post_release_running_services.txt
   sort pre_release_running_services.txt | diff - post_release_running_services.txt
   ```
   *Expected*: tidak ada perbedaan.
2. Pantau siklus ETL pertama:
   ```bash
   docker compose logs -f --tail 100 sap-stage-worker
   ```
   *Expected*: `stage_worker siap: plant=<plant> ...`, lalu siklus selesai tanpa
   `[TS] Siklus timesheet ETL gagal` dan tanpa `DUPLICATE_ACTIVITY_OVERLAP` untuk overlap beda
   workcenter.

---

## 4. Matriks Stop Condition

| Tahap | Sinyal | Tindakan |
|---|---|---|
| 0 | `sap-stage-ts-worker` berjalan, proses ETL di luar compose tidak dapat dihentikan, atau sesi `mps2-api`/`tsnumber` masih bergerak | STOP. Jangan migration. Nyalakan kembali service sesuai Tahap 0 bila rilis dibatalkan. |
| 1 | Plant/timezone tidak cocok | STOP. Target DB salah; periksa `DB_*` dan `.env`. |
| 1 | Duplikat aktif ditemukan | STOP. Keputusan owner per record, lalu ulangi preflight. |
| 2 | Backup/restore gagal | STOP. |
| 4 | Runner gagal (`MIGRATION_ABORTED` atau error lain) | Rilis sudah di-ROLLBACK otomatis dan index legacy masih aktif. Cari penyebab, lalu ulangi Tahap 4. Bila jendela habis: nyalakan API **lama** (image belum di-rebuild) dan `sap-stage-worker`. Kode ETL baru kompatibel dengan index lama. |
| 4 | Verifikasi index tidak sesuai | Jangan nyalakan API. Bagian 5. |
| 5 | API gagal start / smoke gagal | Hentikan `api`, kembalikan image sebelumnya. Index baru lebih longgar dari API lama, jadi API lama tetap aman di atasnya. ETL tetap versi baru. |
| 5 | UI blank / asset error | Kembalikan image `frontend` sebelumnya. |

Mekanisme mengembalikan image sebelumnya (tag, registry, atau rebuild dari commit lama):
**BELUM DIVERIFIKASI**. Repo hanya memuat `docker compose build`. Catat ID image `api` dan
`frontend` (`docker compose images`) di Tahap 0 sebelum rebuild.

---

## 5. Rollback

### Batasan Kritis

1. **Rollback DB gagal tertutup bila ada aktivitas aktif paralel lintas workcenter.**
   `database/migrations/rollback/20261001_timesheet_unique_active_productive_op_wc_rollback.sql`
   melakukan `RAISE EXCEPTION 'Rollback DIBATALKAN: ...'` bila ada grup aktif dengan
   operator/order/op sama di workcenter berbeda. Semua record itu harus di-checkout dulu sesuai
   keputusan owner.
2. **Data historis tertutup lintas workcenter tidak dapat diproses ETL lama.** Bila sudah ada
   record tertutup yang overlap beda workcenter, ETL **harus tetap versi baru**, atau data
   terkait di-quarantine dulu dengan keputusan owner. Checkout semua record aktif tidak
   menyelesaikan masalah ini.

### Langkah

1. Freeze ulang sesuai Tahap 0 (catat status, hentikan `sap-stage-worker` lalu `api`, buktikan
   freeze).
2. Pastikan batasan 1 terpenuhi (query Tahap 1 langkah 3 tanpa `workcentercode` di GROUP BY
   harus 0 baris).
3. Backup DB (Tahap 2).
4. Jalankan rollback dengan target eksplisit:
   ```bash
   psql -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d <DB_NAME> -v ON_ERROR_STOP=1 \
     -f database/migrations/rollback/20261001_timesheet_unique_active_productive_op_wc_rollback.sql
   ```
   Script ini menghapus tiga baris ledger (`20261001`, `20261001b`, `20261001c`) dan
   mengembalikan index legacy `idx_timesheet_active_productive_op`.
5. Verifikasi:
   ```sql
   SELECT to_regclass('public.idx_timesheet_active_productive_op'),     -- terisi
          to_regclass('public.idx_timesheet_active_productive_op_wc');  -- NULL
   SELECT count(*) FROM public.schema_migrations WHERE filename LIKE '20261001%';  -- 0
   ```
6. Kembalikan image `api` dan `frontend` ke versi sebelumnya, lalu `docker compose up -d api frontend`.
7. ETL: biarkan versi baru (lihat batasan 2). Nyalakan `sap-stage-worker` hanya bila tercatat
   berjalan di Tahap 0, lalu lakukan verifikasi Tahap 7.

---

## 6. Bukti Lab (Lokal, Bukan Production)

| Bukti | Hasil |
|---|---|
| `database/migrate.test.js` (termasuk rilis multi-file atomik) | 36/36 |
| Runner nyata, kegagalan sengaja di tengah (`mps2_test_migrate_manifest`) | ROLLBACK penuh; ledger 83 tetap; index legacy utuh; apply ulang sukses dan idempoten |
| `test_migration_exact_contract_scenarios.js` | 12/12 CKP, 12/12 BPN |
| `test_workcenter_normalization_parity.js` | lulus CKP dan BPN |
| `test_timesheet_tapin_duplicate_gate.js` | 13/13 |
| `test_stage_mode.py` / `test_etl_f2_cleansing.py` | 10/10 / 24/24 |
| `npm --prefix apps/api test` | 187/187 |
| `npm --prefix apps/web test` | 281/281 (40 file) |
| `node scripts/gate.mjs` | lulus |
| Query verifikasi index Tahap 4 | CKP dan BPN: `wc_contract_exact = t`, `legacy_v_literal_present = f` |
