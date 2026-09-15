# SAP Staging Multi-Plant — Rencana Refaktor

> **Untuk Hermes:** eksekusi task-by-task, urut. Jangan lompat fase.
> **Jalur payroll** — salah = jam kerja operator hilang atau dobel.

**Goal:** 4 plant (5051 Balikpapan, 5071 Kuala Kencana, 5100 Cikupa, 5153 Sebamban)
menulis `timesheet_transaction` + `mch_transaction` ke satu staging SAP terpusat di
AWS RDS, dengan identitas yang tidak pernah bertabrakan antar plant, dan posting ke
SAP dilakukan dari satu poster terpusat dengan jalur manual per-plant sebagai cadangan.

**Arsitektur:** Tidak ada lapisan baru. Staging AWS yang ada sudah benar secara
desain (provenance segmen + guard berlapis + normal/koreksi). Yang kurang: dimensi
`plant` belum konsisten di semua tabel identitas. Rencana ini melengkapinya, lalu
memindahkan poster dari per-plant ke terpusat.

> **✅ STATUS EKSEKUSI (update 2026-09-14) — migrasi DB Fase 1 SUDAH dijalankan; kode BELUM.**
> Detail angka + cara verifikasi + langkah deploy: `docs/log/2026-09-14-migrasi-multiplant-fase1-db.md`.
> - AWS `ssb_dw`: `sap_staging_source` +`plant` (backfill 21.789 → **37.728** termasuk
>   15.939 provenance TIMESHEET baru), index `_multiplant` + `posted_segment`, trigger
>   `trg_sap_staging_mark_segments_posted`; `sap_staging_exclusion` PK →
>   `(source_system, plant, source_row_id)`. Selesai 3,8 s, invarian 0.
> - BPN + CKP: `sap_staging_source` foreign table +`plant`; `sap_staging_exclusion`
>   lokal → **FOREIGN TABLE** ke AWS; trigger MCH lokal plant-scoped. Kedua file tercatat
>   di `schema_migrations` BPN+CKP.
> - **Exclusion 1.299 baris BPN (1.266 TIMESHEET 31-08 + 33 MCH) sudah disalin ke AWS
>   plant='5051'** lalu tabel lokal dikosongkan (verifikasi per-source cocok sebelum hapus).
>   Backup: `%TEMP%\mps2_migration_backup\bpn_exclusion_backup.json` (md5 `ab89d7d9acbe35c48abc740059e7d98f`).
> - ⚠️ **Service SAP BPN + CKP masih MATI** (stop sebelum migrasi): kode lama tidak kompatibel
>   (insert provenance tanpa `plant` → NOT NULL violation; insert exclusion API tanpa `plant` → 500).
>   Urutan: owner commit+push branch `2b` → di server `git pull --ff-only` (user tag, tanpa sudo)
>   → `docker compose build api && docker compose up -d api` → nyalakan stager (BPN: stage-worker,
>   stage-ts-worker, ops-worker; CKP: ops-worker saja) → verifikasi.
> - Task 1.7 **wajib** menyertakan `dashboardController.js` pada deploy itu (kalau tidak,
>   records/exclusion tetap 500 dan halaman mencampur baris 5100).
> - Nomor baris di Task 1.7 (1701/1705/1774/1821/1826/1947/2160/2306/2376/2385/2425/2475/2517)
>   sudah BERGESER: sesi 2026-09-14 menambah kolom rekonsiliasi `end_capped` + `shift`
>   (`docs/log/2026-09-14-rekonsiliasi-end-time-berubah-setelah-posting.md`). Anchor pakai teks
>   SQL, bukan nomor baris; perubahan itu tidak menyentuh satu pun predikat plant.
> - **Cutover CKP = 15 Sep 2026 (keputusan owner, sudah dijalankan 14 Sep malam)**:
>   tombol `post-to-sap` di `TIMESHEET/TimesheetValidationPage.jsx` dipensiunkan (mati permanen),
>   `sap_staging_exclusion` plant 5100 diisi 12.277 tsnumber yang sudah dikonfirmasi SAP,
>   cursor `(TIMESHEET,5100)` → `2026-09-15 00:00:00`, `.env` CKP
>   `SAP_STAGE_INITIAL_FROM_TS=2026-09-15T00:00:00`. CKP masuk Fase 2 dengan lantai waktu itu
>   (bukan 22 Agu). Detail: `docs/log/2026-09-14-forensik-ckp-jalur-posting.md`.
>   Toggle serupa di `MACHINE_H/MachineHoursValidationPage.jsx` BELUM dipensiunkan.

**Keputusan user (2026-09-11):**

| # | Keputusan |
|---|---|
| 1 | Identitas = **kunci komposit `(plant, source_row_id)`**, bukan UUID |
| 2 | Lantai waktu 5071 & 5153 **diisi user sendiri** (Task 2.3) |
| 3 | **Dua endpoint AWS**: satu terpusat + satu per-plant |
| 4 | Posting **terpusat**, dengan **script manual** cadangan: pilih plant + rentang tanggal + source (all / TIMESHEET / MCH_HOURS) |
| 5 | Poster pusat **di server pabrik** dulu (bukan AWS) — jalur AWS→CPI belum diuji |
| 6 | "Pusat" = **server masing-masing plant** — lihat Pembacaan Keputusan #6 |
| 7 | **Salvaging = 5051, 5071, 5153** (MCH_HOURS + TIMESHEET). **5100 Cikupa = manufaktur** |

### Peran plant (keputusan #7, diverifikasi terhadap master `public.plant`)

| Kode | Nama | Jenis | Kirim MCH_HOURS? | Kirim TIMESHEET? | Status staging sekarang |
|---|---|---|---|---|---|
| 5051 | Balikpapan | salvaging | ✅ ya | ✅ ya | aktif (MCH 3.277 + TS 11.459) |
| 5071 | Kuala Kencana | salvaging | ✅ ya | ✅ ya | **belum masuk** |
| 5153 | Sebamban | salvaging | ✅ ya | ✅ ya | **belum masuk** |
| 5100 | Cikupa | manufaktur | ❌ tidak | ✅ ya | aktif (TS 1.975, MCH 0) |

Data staging membenarkan pembagian ini: 5051 (salvaging) punya MCH_HOURS + TIMESHEET,
5100 (manufaktur) **hanya** TIMESHEET — nol MCH_HOURS. Pola yang sama akan berlaku
untuk 5071 dan 5153.

**Konsekuensi teknis:** lubang provenance (LUBANG 1) hanya menyentuh MCH_HOURS →
risikonya terkonsentrasi di **3 plant salvaging**. 5100 tidak terdampak lubang 1,
tapi tetap terdampak lubang 2 (exclusion TIMESHEET).

**Konsekuensi operasional:** `sap-stage-worker` (MCH_HOURS) **tidak perlu**
dijalankan di 5100. Hanya `sap-stage-ts-worker`.

### Pembacaan Keputusan #6 — "pusat" = server masing-masing

Keputusan #4 ("posting terpusat") dan #6 ("server masing-masing") terdengar
bertentangan. Pembacaan yang dipakai rencana ini:

> **Staging terpusat** (satu AWS RDS, 4 plant menulis ke sana) —
> **posting terdistribusi** (tiap plant punya poster sendiri untuk plant-nya).

Artinya Fase 3 **tidak** memindahkan poster ke satu mesin. `sap-post-worker` tetap
di tiap server pabrik dengan `--plant $PLANT_SSB` (default sudah begitu). Yang
"terpusat" adalah antrian dan aturannya, bukan prosesnya.

Alasan ini masuk akal secara operasional: jaringan tiap pabrik ke SAP CPI sudah
terbukti jalan, sedangkan satu poster untuk 4 plant menciptakan single point of
failure baru tanpa keuntungan nyata.

**Yang berubah di Fase 3 dengan pembacaan ini** (jauh lebih ringan dari rencana awal):

| Semula | Jadi |
|---|---|
| Matikan poster 4 plant, nyalakan 1 poster pusat | **Tidak ada migrasi poster.** Tetap per plant |
| `ops_worker --role plant\|central` | **Tidak perlu.** Filter plant yang sudah ada sudah cukup |
| Kunci paralel `(werks, aufnr)` | **Tetap perlu** — lihat Task 3.2 |
| Script manual rentang tanggal | **Tetap perlu** — lihat Task 3.3 |

⚠️ Kalau maksudmu sebenarnya SATU poster untuk 4 plant, bilang — Task 3.4 dan 3.5
versi terpusat masih ada di riwayat git plan ini dan tinggal dikembalikan.

---

## Konteks Nyata (diverifikasi via tunnel Tailscale, 2026-09-11)

Koneksi: `cd ~/tools/tailscale && sh aws.sh start` → `127.0.0.1:5445`, db `ssb_dw`,
user `ssb_admin`, RDS `10.50.97.105` (Aurora PostgreSQL 17.7, 93 tabel).

### Isi staging sekarang (16.691 baris)

| source_system | werks | status | n |
|---|---|---|---|
| MCH_HOURS | 5051 | PENDING | 1.979 |
| MCH_HOURS | 5051 | POSTED | 1.298 |
| TIMESHEET | 5051 | PENDING | 10.610 |
| TIMESHEET | 5051 | POSTED | 742 |
| TIMESHEET | 5051 | FAILED | 87 |
| TIMESHEET | 5100 | PENDING | 26 |
| TIMESHEET | 5100 | POSTED | 1.671 |
| TIMESHEET | 5100 | FAILED | 278 |

`sap_staging_source`: 21.789 baris, **semua MCH_HOURS dari 5051**.

> **Keputusan #5 menaikkan urgensi Fase 1 ke maksimum.** Semula MCH_HOURS hanya
> dari 5051 → lubang provenance belum aktif. Dengan 3 plant salvaging ikut kirim
> MCH_HOURS, `proddataid` dari 4 server berbeda akan bertemu di satu tabel
> provenance yang **tidak tahu plant**. Fase 1 bukan lagi pencegahan — ia syarat mutlak.

### Dimensi plant: yang sudah ada vs yang bolong

| Tabel / modul | Pembeda plant | Status |
|---|---|---|
| `sap_stage_cursor` | PK `(source_system, plant)` | ✅ benar |
| `sap_ops_request` | kolom `plant` | ✅ benar |
| `sap_staging_eligibility_audit` | kolom `plant` | ✅ benar |
| `ops_worker.py:124-142` | `claim_one()` filter `plant = PLANT_SSB OR plant IS NULL` | ✅ **sudah benar** (Q3 terjawab) |
| `post_sap_staging.py:656` | `--plant` / `--all-plants`, default `PLANT_SSB` | ✅ sudah ada |
| `sap_timesheet_staging` | `werks` + `source_key` prefix (TIMESHEET saja) | ⚠️ MCH_HOURS belum prefix |
| `sap_staging_source` | **tidak ada** | ❌ LUBANG 1 |
| `sap_staging_exclusion` | **tidak ada** (PK 2 kolom) | ❌ LUBANG 2 |

### ZTIMESHEETID — SUDAH AMAN, jangan disentuh

`id bigint GENERATED ALWAYS AS IDENTITY`, satu sequence global di AWS
(`last_value = 1001148030`). Bukti multi-plant sudah bekerja: ID 5051 dan 5100
**berselang** dalam satu rentang —

```
werks=5051 TIMESHEET id 1000003513..1001147936
werks=5100 TIMESHEET id 1000039300..1000073803   <- di dalam rentang 5051
```

Dua plant menarik nomor dari sequence yang sama → mustahil kembar. **Nol pekerjaan.**

---

## Tiga Lubang

### LUBANG 1 — `sap_staging_source` tidak tahu plant (PALING BERBAHAYA)

```
kolom : (staging_id, source_system, source_row_id, bucket_start, seconds, posted_at)
unique: (staging_id, source_system, source_row_id, bucket_start)
index : (source_system, source_row_id, bucket_start)
```

`source_row_id` = `mch_transaction.proddataid`, auto-increment **per server pabrik**.
Balikpapan punya proddataid 599361; Sebamban juga akan punya 599361 — record berbeda total.

Akibat begitu plant ke-2 kirim MCH_HOURS: guard `find_posted_conflicts()`
(`post_sap_staging.py:386`) melihat segmen Sebamban "sudah POSTED" padahal yang POSTED
Balikpapan → bundel Sebamban di-`SKIPPED` → **jam operator hilang, tanpa error apa pun.**

Jalur kode terdampak (semua memfilter `source_row_id` tanpa plant):

| File | Baris | Fungsi |
|---|---|---|
| `post_sap_staging.py` | 165 | guard exclusion saat claim |
| `post_sap_staging.py` | 386-388 | guard anti-double-post |
| `stage_machinehours.py` | 139 | deteksi catch-up |
| `stage_sap_timesheet.py` | 520, 527 | `seg_filter` normal & koreksi |
| `dashboardController.js` | 688, 957 | `POSTED_EXISTS_SQL`, tolak edit ter-post |
| `dashboardController.js` | 500, 1701, 1774, 1821, 1947, 2160, 2306, 2376, 2517 | query dashboard/drilldown |

### LUBANG 2 — `sap_staging_exclusion` PK tanpa plant

```
PRIMARY KEY (source_system, source_row_id)
```

8 baris existing, semuanya MCH_HOURS 5051 (`'jam mati'`, `'lupa tap out'`, dst).
Admin Balikpapan exclude proddataid 599361 → record 599361 Sebamban ikut ter-exclude.

Terdampak: `stage_sap_timesheet.py:302`, `stage_timesheet_transaction.py:155`,
`post_sap_staging.py:166`, `dashboardController.js:2385/2425/2475/1705/1826`.

### LUBANG 3 — `source_key` MCH_HOURS tanpa prefix plant

TIMESHEET sudah benar (`stage_timesheet_transaction.py:175`):
```sql
COALESCE(plant, '') || ':' || tsnumber::text AS source_key   -- "5051:159061"
```

MCH_HOURS belum (`stage_sap_timesheet.py:475`): `md5(concat_ws('|', werks, ...))`.
`werks` kolom **data** yang bisa kosong → dua plant dengan werks kosong + operator
nomor sama + hari sama → md5 identik → `UNIQUE(source_system, source_key)` menolak →
satu plant kalah diam-diam.

---

## FASE 1 — Tutup Lubang (WAJIB, blocker semua fase lain)

Prinsip tunggal:

> **Setiap identitas yang berasal dari server pabrik WAJIB didampingi kolom plant.**

### Task 1.0: Hentikan worker staging sebelum migrasi

```bash
# Di TIAP server pabrik yang aktif (5051, 5100)
docker compose stop sap-stage-worker sap-stage-ts-worker sap-ops-worker
```

Migrasi mengubah unique index yang dipakai `insert_provenance` — kalau worker
menulis di tengah, transaksi gagal separuh jalan.

---

### Task 1.1: Migrasi SQL — plant di `sap_staging_source`

**Files:** Create `database/migrations/aws/20260911_staging_multiplant_identity.sql`

**Step 1: Verifikasi pra-migrasi (harus 0 baris)**

```sql
SELECT s.source_system, s.source_row_id, count(DISTINCT t.werks) AS n_plant
FROM sap_staging_source s
JOIN sap_timesheet_staging t ON t.id = s.staging_id
GROUP BY 1,2 HAVING count(DISTINCT t.werks) > 1;
```

Expected: `0 rows` (diverifikasi 2026-09-11). Kalau ada hasil → **berhenti**, backfill tidak aman.

**Step 2: Isi migrasi**

```sql
BEGIN;

ALTER TABLE public.sap_staging_source
  ADD COLUMN IF NOT EXISTS plant text NOT NULL DEFAULT '';

UPDATE public.sap_staging_source s
   SET plant = t.werks
  FROM public.sap_timesheet_staging t
 WHERE t.id = s.staging_id AND s.plant = '';

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.sap_staging_source WHERE plant = '';
  IF n > 0 THEN
    RAISE EXCEPTION 'Backfill gagal: % baris sap_staging_source masih plant kosong', n;
  END IF;
END $$;

DROP INDEX IF EXISTS public.uq_sap_staging_source_segment_per_bundle;
CREATE UNIQUE INDEX uq_sap_staging_source_segment_per_bundle
  ON public.sap_staging_source (staging_id, source_system, plant, source_row_id, bucket_start);

DROP INDEX IF EXISTS public.idx_sap_staging_source_segment;
CREATE INDEX idx_sap_staging_source_segment
  ON public.sap_staging_source (source_system, plant, source_row_id, bucket_start);

COMMIT;
```

**Step 3: Verifikasi**

```sql
SELECT plant, count(*) FROM sap_staging_source GROUP BY 1;
-- Expected: 5051 | 21789   (satu baris)
SELECT indexdef FROM pg_indexes WHERE tablename='sap_staging_source' AND indexname LIKE '%segment%';
-- Expected: kedua index memuat 'plant'
```

---

### Task 1.2: Migrasi SQL — plant masuk PK `sap_staging_exclusion`

Lanjutan file migrasi yang sama.

```sql
BEGIN;

ALTER TABLE public.sap_staging_exclusion
  ADD COLUMN IF NOT EXISTS plant text NOT NULL DEFAULT '5051';

ALTER TABLE public.sap_staging_exclusion
  ALTER COLUMN plant DROP DEFAULT;   -- baris baru WAJIB isi eksplisit

ALTER TABLE public.sap_staging_exclusion
  DROP CONSTRAINT IF EXISTS sap_staging_exclusion_pkey;

ALTER TABLE public.sap_staging_exclusion
  ADD PRIMARY KEY (source_system, plant, source_row_id);

COMMIT;
```

**Verifikasi:** `SELECT source_system, plant, count(*) FROM sap_staging_exclusion GROUP BY 1,2;`
→ `MCH_HOURS | 5051 | 8`

`DROP DEFAULT` disengaja: insert tanpa plant harus **gagal keras**, bukan diam-diam jadi 5051.

---

### Task 1.3: `stage_sap_timesheet.py` — prefix plant + seg_filter + exclusion

**Files:** Modify `jobs/sap_staging/stage_sap_timesheet.py`

**Step 1: norm_key (baris ~475)**

```python
# SEBELUM
md5(concat_ws('|', ...)) AS norm_key

# SESUDAH — prefix plant dari env PLANT_SSB (nilai pasti), BUKAN kolom werks (bisa kosong)
%(plant_ssb)s || ':' || md5(concat_ws('|', ...)) AS norm_key
```

**Step 2: seg_filter normal (~527) & koreksi (~520)** — tambah `AND ss.plant = %(plant_ssb)s`

```python
seg_filter = ("AND NOT EXISTS (SELECT 1 FROM public.sap_staging_source ss "
              "WHERE ss.source_system = 'MCH_HOURS' "
              "AND ss.plant = %(plant_ssb)s "
              "AND ss.source_row_id = mch_transaction.proddataid::text "
              "AND ss.posted_at IS NOT NULL)")
```

**Step 3: exclusion filter (~302)** — tambah `AND ex.plant = %(plant_ssb)s`

> ⚠️ **Batas Berbahaya #1 di README:** mengubah resep `source_key` = seluruh riwayat
> berganti kunci. Disengaja dan aman karena (a) baris POSTED tidak disentuh,
> (b) guard segmen Task 1.1 menangkap konflik, (c) wajib `--dry-run` (Task 1.8).

---

### Task 1.4: `stage_machinehours.py` — plant di deteksi catch-up

**Files:** Modify `jobs/sap_staging/stage_machinehours.py:139`

```sql
AND NOT EXISTS (
  SELECT 1 FROM sap_staging_source s
  WHERE s.source_system = 'MCH_HOURS'
    AND s.plant = %s                       -- <-- BARU (PLANT_SSB)
    AND s.source_row_id = m.proddataid::text
)
```

Tanpa ini catch-up Sebamban mengira record-nya sudah punya provenance (milik
Balikpapan) → **tidak pernah di-stage.**

---

### Task 1.5: `stage_timesheet_transaction.py` — plant di exclusion

**Files:** Modify baris 155 — tambah `AND ex.plant = %s`.
`source_key` TIMESHEET (baris 175) sudah benar, tidak diubah.

---

### Task 1.6: `post_sap_staging.py` — plant di dua guard

**Step 1: guard exclusion (~165)**

```sql
JOIN public.sap_staging_exclusion ex
  ON  ex.source_system = ss.source_system
  AND ex.plant         = ss.plant            -- <-- BARU
  AND ex.source_row_id = ss.source_row_id
```

**Step 2: `find_posted_conflicts()` (~386) — GUARD INTI**

```sql
JOIN sap_staging_source prev
  ON  prev.source_system = s.source_system
  AND prev.plant         = s.plant             -- <-- BARU, KRITIS
  AND prev.source_row_id = s.source_row_id
  AND prev.bucket_start  = s.bucket_start
  AND prev.posted_at IS NOT NULL
  AND prev.staging_id <> s.staging_id
```

Tanpa baris ini seluruh Task 1.1 sia-sia — schema benar, query tetap buta plant.

**Step 3: `insert_provenance()` di `sap_staging_common.py:591`**

```sql
INSERT INTO sap_staging_source (staging_id, source_system, plant, source_row_id, bucket_start, seconds)
VALUES %s
ON CONFLICT (staging_id, source_system, plant, source_row_id, bucket_start) DO UPDATE
  SET seconds = EXCLUDED.seconds
  WHERE sap_staging_source.posted_at IS NULL
```

plant diambil dari `werks` bundel (sudah ada di `row`).

**Step 4: DDL di `sap_staging_common.py:406-415`** — samakan dengan migrasi, supaya
`ensure_staging_schema()` tidak membuat tabel versi lama di environment baru.

---

### Task 1.7: `dashboardController.js` — plant di 16 query

**Files:** Modify `apps/api/controllers/dashboardController.js`

Baris: 500, 688, 957, 1701, 1705, 1774, 1821, 1826, 1947, 2160, 2306, 2376,
2385, 2425, 2475, 2517.

Pola seragam — setiap `source_row_id` dapat pasangan `plant`:

```js
// SEBELUM
`SELECT 1 FROM public.sap_staging_source
  WHERE source_system='MCH_HOURS' AND source_row_id=$1::text AND posted_at IS NOT NULL`
// SESUDAH
`SELECT 1 FROM public.sap_staging_source
  WHERE source_system='MCH_HOURS' AND plant=$2 AND source_row_id=$1::text AND posted_at IS NOT NULL`
```

Sumber nilai plant di API: `plant_config` / session user — **bukan hardcode**.

**Baris 2385 (insert exclusion):**
```js
`INSERT INTO public.sap_staging_exclusion (source_system, plant, source_row_id, excluded_by, note)
 VALUES ('MCH_HOURS', $4, $1, $2, $3)
 ON CONFLICT (source_system, plant, source_row_id) DO UPDATE SET note = EXCLUDED.note`
```

**Baris 2425 (delete exclusion):** tambah `AND plant = $2`.

**Verifikasi:** halaman SAP-log → exclude 1 record → cek plant benar → un-exclude.

---

### Task 1.8: Validasi Fase 1

**Step 1: snapshot SEBELUM**

```sql
SELECT source_system, werks, status, count(*), sum(total_seconds)
FROM sap_timesheet_staging GROUP BY 1,2,3 ORDER BY 1,2,3;
```

**Step 2: dry-run**

```bash
cd jobs/sap_staging && python stage_machinehours.py --dry-run --catchup
```

Expected: jumlah bundel kandidat **sama** dengan sebelum perubahan.

**Step 3: snapshot SESUDAH** — baris POSTED harus **identik persis**. Berubah → rollback.

**Step 4: invarian guard**

```sql
SELECT plant, source_system, source_row_id, bucket_start, count(*)
FROM sap_staging_source WHERE posted_at IS NOT NULL
GROUP BY 1,2,3,4 HAVING count(*) > 1;
-- HARUS 0 selamanya
```

**Step 5: nyalakan worker lagi + commit**

```bash
docker compose start sap-stage-worker sap-stage-ts-worker sap-ops-worker

git add database/migrations/aws/20260911_staging_multiplant_identity.sql \
        jobs/sap_staging/{stage_sap_timesheet,stage_machinehours,stage_timesheet_transaction,post_sap_staging,sap_staging_common}.py \
        apps/api/controllers/dashboardController.js
git commit -m "fix(sap-staging): plant masuk kunci identitas provenance & exclusion"
```

---

## FASE 2 — Onboarding 5071 & 5153 (TIMESHEET + MCH_HOURS)

Cursor sudah per-plant sejak awal. Kode baru hanya advisory lock.

### Task 2.1: Advisory lock anti double-worker

**Files:** Modify `jobs/sap_staging/sap_staging_common.py`

```python
def acquire_stage_lock(conn, source_system: str, plant: str) -> bool:
    """False = worker lain sedang jalan untuk (source_system, plant) ini."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT pg_try_advisory_lock(hashtext(%s), hashtext(%s))",
            (f"sap_stage:{source_system}", plant),
        )
        return cur.fetchone()[0]
```

Dipanggil di awal `run_once()` pada `stage_machinehours.py` dan
`stage_timesheet_transaction.py`. `False` → log + exit 0 (bukan error).
Lock session-level → lepas otomatis saat koneksi tutup, termasuk kalau proses mati.

### Task 2.2: `.env` per server pabrik

```env
PLANT_SSB=5153                    # atau 5071 — WAJIB benar, ini kunci identitas
TIMEZONE=Asia/Makassar

# source = DB pabrik setempat
DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASSWORD=...

# staging = AWS RDS terpusat (SAMA untuk 4 plant)
AWS_PGhost=ssb-dw-dev.cluster-chao6oi4wiuz.ap-southeast-1.rds.amazonaws.com
AWS_PGport=5432
AWS_PGDb=ssb_dw
AWS_PGuser=ssb_admin
AWS_PGpass=...

# LANTAI WAKTU — kritis, lihat Task 2.3
SAP_STAGE_INITIAL_FROM_TS=<diisi user>
```

### Task 2.3: Lantai waktu per plant — **DIISI USER**

Query bantu (jalankan di DB plant bersangkutan):

```sql
SELECT min(longdate_checkin), max(longdate_checkin), count(*) FROM timesheet_transaction;
SELECT min(startdatetime),   max(startdatetime),   count(*) FROM mch_transaction;
```

| Plant | Sudah di SAP s/d | `SAP_STAGE_INITIAL_FROM_TS` | Diputuskan oleh |
|---|---|---|---|
| 5071 | _(user isi)_ | _(user isi)_ | _(user isi)_ |
| 5153 | _(user isi)_ | _(user isi)_ | _(user isi)_ |

Kalau tidak ada yang tahu pasti → pakai tanggal go-live ke depan, jangan backfill.
Salah di sini = **jam dobel di SAP, tanpa storno.**

### Task 2.4: Nyalakan worker staging (BUKAN poster)

```bash
docker compose up -d --build sap-stage-worker sap-stage-ts-worker sap-ops-worker
docker logs sap-stage-ts-worker --tail 30
```

`sap-post-worker` **sengaja tidak dinyalakan** di plant — posting terpusat (Fase 3).

### Task 2.5: Verifikasi 5153 dulu, 48 jam

```sql
SELECT source_system, werks, status, count(*)
FROM sap_timesheet_staging WHERE werks = '5153' GROUP BY 1,2,3;
-- Expected: MUNCUL dua source_system (TIMESHEET & MCH_HOURS)

SELECT * FROM sap_stage_cursor WHERE plant = '5153';

-- Tabrakan identitas? HARUS 0.
SELECT source_system, plant, source_row_id, bucket_start, count(*)
FROM sap_staging_source GROUP BY 1,2,3,4 HAVING count(*) > 1;

-- Bukti lubang 1 tertutup: proddataid kembar antar plant, TERPISAH rapi
SELECT source_row_id, array_agg(DISTINCT plant), count(*)
FROM sap_staging_source GROUP BY 1 HAVING count(DISTINCT plant) > 1 LIMIT 10;
```

Query terakhir **boleh ada isinya** — itu justru buktinya berhasil.

**Baru setelah 5153 bersih 48 jam → nyalakan 5071.**

---

## FASE 3 — Poster Per-Plant + Jalur Manual Cadangan

> **Revisi setelah keputusan #6.** Poster TIDAK dipindah ke satu mesin.
> Tetap di tiap server pabrik. Yang terpusat adalah staging + aturannya.
> Fase ini jadi jauh lebih ringan: 3 task, tanpa migrasi service.

### Task 3.1: Konfigurasi poster per plant

Tiap server pabrik menjalankan `sap-post-worker`-nya sendiri. Default
`post_sap_staging.py` sudah benar — `plant = args.plant or plant_code()`
(baris 546), jadi tanpa flag pun ia hanya mengirim plant-nya sendiri.

| Plant | `sap-stage-ts-worker` | `sap-stage-worker` (MCH) | `sap-post-worker` | `sap-ops-worker` |
|---|---|---|---|---|
| 5051 salvaging | ✅ | ✅ | ✅ | ✅ |
| 5071 salvaging | ✅ | ✅ | ✅ | ✅ |
| 5153 salvaging | ✅ | ✅ | ✅ | ✅ |
| 5100 manufaktur | ✅ | ❌ **tidak perlu** | ✅ | ✅ |

`.env` tiap plant butuh `SAP_INBOUND_URL/USERNAME/PASSWORD` (jalur ke CPI) —
ini yang membuat poster bisa tetap di pabrik tanpa jalur AWS→CPI.

**Verifikasi tidak ada poster yang menyeberang plant:**

```sql
-- Setelah 24 jam: tiap plant hanya mem-POST werks-nya sendiri.
-- Bandingkan dengan log container masing-masing.
SELECT werks, status, count(*), max(posted_at)
FROM sap_timesheet_staging WHERE posted_at > now() - interval '24 hours'
GROUP BY 1,2 ORDER BY 1,2;
```

### Task 3.2: Kunci paralel `(werks, aufnr)` — tetap perlu

Walau poster per plant, guard ini tetap wajib. Alasannya bukan antar-plant di satu
proses, tapi **antar-proses**: 3 poster salvaging berjalan bersamaan, dan `aufnr`
yang sama bisa muncul di dua plant. SAP mengunci per order → dua poster menabrak
lock yang sama.

**Files:** Modify `post_sap_staging.py`, fungsi pembagi worker — kunci grup jadi
`(werks, aufnr)`.

Ini tidak menghilangkan tabrakan antar-plant (butuh koordinasi lintas proses yang
tidak sepadan biayanya), tapi menghilangkan tabrakan **di dalam** satu poster dan
membuat retry lebih jarang.

**Verifikasi berapa besar risikonya:**
```sql
SELECT aufnr, array_agg(DISTINCT werks), count(*)
FROM sap_timesheet_staging WHERE aufnr <> ''
GROUP BY 1 HAVING count(DISTINCT werks) > 1 LIMIT 20;
```

Kalau hasilnya 0 → order memang tidak pernah lintas plant, risikonya nol dan
`--max-retries 3` yang sudah ada sudah cukup.

### Task 3.3: Script posting manual — rentang tanggal (keputusan #4)

**Yang SUDAH ada di `post_sap_staging.py`:**

| Flag | Baris | Guna |
|---|---|---|
| `--plant` | 656 | satu plant (default `PLANT_SSB`) |
| `--all-plants` | 657 | abaikan filter plant |
| `--source-system` | 633 | `TIMESHEET` \| `MCH_HOURS` |
| `--date` | 661 | **satu tanggal saja** |
| `--limit`, `--workers`, `--include-today` | | |

**Yang KURANG: rentang tanggal.** Kebutuhan user: "plant berapa, dari tanggal
berapa, source all atau timesheet saja".

**Perubahan minimal — tambah 2 flag, pola SAMA dengan `--date` yang sudah ada:**

```python
parser.add_argument("--date-from", help="Awal rentang tanggal (YYYY-MM-DD), inklusif")
parser.add_argument("--date-to",   help="Akhir rentang tanggal (YYYY-MM-DD), inklusif")
```

Di `claim_rows()`, di sebelah filter `date_filter` (~baris 152):

```python
# Rentang tanggal (posting manual cadangan). JEBAKAN: TIMESHEET tidak punya
# bucket_start (NULL — satu baris per tsnumber, bukan per jam kerja), jadi
# tanggalnya HARUS dari payload->>'ISDD'. Tanpa cabang kedua, semua baris
# TIMESHEET diam-diam tidak pernah match.
if date_from or date_to:
    lo = date_from or '1900-01-01'
    hi = date_to   or '2999-12-31'
    filters.append(
        "(   (bucket_start::date BETWEEN %s AND %s)"
        " OR (source_system = 'TIMESHEET'"
        "     AND payload->>'ISDD' BETWEEN %s AND %s))"
    )
    params.extend([lo, hi, lo.replace('-',''), hi.replace('-','')])
```

`--date` lama dipertahankan (dipakai tombol UI `post_date`) — tanpa breaking change.

**Cara pakai:**

```bash
# Semua source, plant 5153, 1-7 September
python post_sap_staging.py --plant 5153 \
  --date-from 2026-09-01 --date-to 2026-09-07 --limit 2000 --workers 4

# Timesheet saja, plant 5071, dari 1 Sept sampai hari ini
python post_sap_staging.py --plant 5071 --source-system TIMESHEET \
  --date-from 2026-09-01 --limit 2000 --workers 4

# MCH_HOURS saja (hanya relevan untuk salvaging)
python post_sap_staging.py --plant 5051 --source-system MCH_HOURS \
  --date-from 2026-09-01 --date-to 2026-09-05 --limit 5000 --workers 4
```

**Semua guard tetap berlaku** di jalur manual: anti-double-post, exclusion,
ZTIMESHEETID terbakar, hari-selesai. Manual = memilih *apa* yang dikirim,
**bukan** melewati pengaman.

**Pengaman tambahan wajib:**

```python
if args.all_plants and not args.date_to and (args.date_from or args.limit > 1000):
    log.warning("Rentang terbuka + semua plant + limit %s. Lanjut? (--yes untuk lewati)", args.limit)
    if not args.yes:
        sys.exit("Batal. Tambahkan --date-to atau --yes.")
```

`--all-plants` di jalur manual sekarang jadi lebih berbahaya dari sebelumnya:
dengan 4 plant aktif, satu perintah bisa menyapu 4 pabrik sekaligus.

### Task 3.4: `ops_worker` — tidak ada perubahan

`claim_one()` (baris 124-142) sudah memfilter `plant = PLANT_SSB OR plant IS NULL`,
dengan komentar tertanggal 2026-08-31 yang menjelaskan persis kasus ini.
Dengan poster per-plant, pemisahan `--role plant|central` **tidak diperlukan**.

Satu hal yang tetap perlu dipantau: `plant IS NULL` (legacy). Kalau ada request
lama tanpa plant, worker plant mana pun bisa mengambilnya. Cek apakah masih ada:

```sql
SELECT count(*) FROM sap_ops_request WHERE plant IS NULL AND status = 'QUEUED';
```

Kalau 0 dan API selalu mengisi plant → pertimbangkan `ALTER COLUMN plant SET NOT NULL`.

---

## File yang Berubah

**Migrasi (baru)**
- `database/migrations/aws/20260911_staging_multiplant_identity.sql`

**Jobs**
- `sap_staging_common.py` — `insert_provenance`, `acquire_stage_lock`, DDL
- `stage_sap_timesheet.py` — norm_key, seg_filter ×2, exclusion
- `stage_machinehours.py` — deteksi catch-up
- `stage_timesheet_transaction.py` — exclusion
- `post_sap_staging.py` — 2 guard, kunci paralel `(werks,aufnr)`, `--date-from/--date-to`, `--yes`
- `README.md` — dimensi plant, peran plant (salvaging vs manufaktur), jalur manual
- ~~`ops_worker.py`~~ — **tidak berubah** (sudah filter plant sejak 2026-08-31)

**API**
- `apps/api/controllers/dashboardController.js` — 16 query

**Compose / env**
- `.env` tiap plant — `PLANT_SSB`, `SAP_STAGE_INITIAL_FROM_TS`, `SAP_INBOUND_*`
- `docker-compose.yml` — tidak ada perubahan struktur; 5100 **tidak menjalankan**
  `sap-stage-worker` (MCH_HOURS)

---

## Validasi

**Invarian yang harus SELALU 0 baris** (jadikan cron harian + alert):

```sql
-- 1. Satu segmen tidak boleh ter-POST dua kali
SELECT plant, source_system, source_row_id, bucket_start, count(*)
FROM sap_staging_source WHERE posted_at IS NOT NULL
GROUP BY 1,2,3,4 HAVING count(*) > 1;

-- 2. Provenance tanpa plant
SELECT count(*) FROM sap_staging_source WHERE plant = '';

-- 3. Plant provenance harus sama dengan werks bundelnya
SELECT s.id FROM sap_staging_source s
JOIN sap_timesheet_staging t ON t.id = s.staging_id
WHERE s.plant <> t.werks LIMIT 10;

-- 4. ZTIMESHEETID kembar (sanity)
SELECT ztimesheetid, count(*) FROM sap_timesheet_staging GROUP BY 1 HAVING count(*) > 1;

-- 5. Plant manufaktur tidak boleh punya MCH_HOURS (5100 Cikupa)
SELECT werks, count(*) FROM sap_timesheet_staging
WHERE source_system = 'MCH_HOURS' AND werks = '5100' GROUP BY 1;
```

**Regresi:** `cd jobs/sap_staging && python test_normalize_max_record.py`

**Uji `--date-from/--date-to` tanpa kirim ke SAP:** jalankan `claim_rows` dalam
transaksi yang di-rollback, bandingkan jumlah baris vs query manual rentang sama.
**Wajib menguji baris TIMESHEET** — cabang `payload->>'ISDD'` adalah yang paling
mudah salah (bucket_start NULL).

---

## Risiko & Trade-off

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| 1 | Task 1.3 mengubah resep `source_key` MCH_HOURS | Riwayat berganti kunci → PENDING lama di-stage ulang | POSTED tidak disentuh; guard segmen Task 1.1; `--dry-run` + bandingkan snapshot |
| 2 | Lantai waktu plant baru salah | **Jam dobel di SAP, tanpa storno** | Task 2.3 diisi user + tanda tangan admin plant sebelum worker nyala |
| 3 | Migrasi jalan saat worker aktif | Insert provenance gagal separuh | Task 1.0: stop worker dulu |
| 4 | 16 query `dashboardController.js` terlewat satu | UI salah tampil / salah tolak edit | Grep `source_row_id` di `apps/api/` — 0 hasil tanpa `plant` di dekatnya |
| 5 | Order lintas plant, 3 poster salvaging paralel | `already being processed by SAPCI` naik | Task 3.2 kunci `(werks,aufnr)` + `--max-retries 3` yang sudah ada |
| 6 | Satu poster plant mati | Hanya plant itu berhenti kirim; 3 lain jalan | `PENDING` menumpuk aman + jalur manual Task 3.3. **Keuntungan poster per-plant: tidak ada single point of failure** |
| 7 | Script manual `--all-plants` + rentang terbuka | Kiriman massal 4 pabrik tak disengaja | Task 3.3: konfirmasi `--yes`; guard anti-double tetap jalan |
| 8 | 3 plant salvaging kirim MCH_HOURS bersamaan | Volume provenance naik ~3x (21.789 → ~65.000) | Index Task 1.1 mencakup plant; pantau ukuran `sap_staging_source` |
| 9 | `sap-stage-worker` (MCH) tidak sengaja jalan di 5100 | Bundel MCH_HOURS manufaktur yang tidak semestinya | Invarian validasi #5; jangan deploy service itu di 5100 |

## Yang SENGAJA Tidak Diubah

| Komponen | Alasan |
|---|---|
| `ZTIMESHEETID = id::text` | Identity global AWS, terbukti tidak bentrok antar plant |
| Struktur provenance segmen | Desain tepat, hanya kurang dimensi plant |
| Normal vs Koreksi | Tidak terkait multi-plant |
| Bundling per hari + komposisi md5 | Hanya ditambah prefix |
| 6 lapis guard | Tetap, ditambah dimensi plant |
| `ops_worker.py` seluruhnya | `claim_one()` sudah filter plant sejak 2026-08-31 |
| `--plant` / `--all-plants` di poster | Sudah ada (baris 656-657) |
| Flag `--date` (satu hari) | Dipakai tombol UI `post_date` — dipertahankan |
| Topologi poster (per plant) | Keputusan #6; tidak ada single point of failure |
| UUID | **Ditolak** — `(plant, source_row_id)` sama uniknya, bisa ditelusuri manusia |

## Pertanyaan Terbuka

Semua pertanyaan blocker sudah terjawab. Sisa yang bisa diputuskan sambil jalan:

1. **Lantai waktu 5071 & 5153** — diisi user di Task 2.3. Blocker Fase 2 saja,
   Fase 1 bisa jalan sekarang.
2. **Jalur AWS → SAP CPI** — tidak mendesak. Keputusan #5 menetapkan poster tetap
   di server pabrik, jadi jalur ini baru relevan kalau suatu saat mau pindah ke AWS.
3. **`plant IS NULL` legacy di `sap_ops_request`** — kalau sudah 0, pertimbangkan
   `SET NOT NULL` (Task 3.4).
