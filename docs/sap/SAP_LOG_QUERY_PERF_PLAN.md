---
title: "SAP Log page — diagnosa lambat & rencana perbaikan query"
type: plan
status: active
date: 2026-09-02
tags: [domain/sap]
---

# SAP Log page — diagnosa lambat & rencana perbaikan query

Lanjutan [[log/2026-09-01-reconciliation-export-timeout]] dan
[[log/2026-08-31-plant-scope-fdw-per-plant]]. Semua angka di bawah **diukur langsung**
(prod BPN via tunnel 5434 + API prod via tunnel 8443, PLANT 5051, 2026-09-02), bukan dugaan.

## 1. Peta jalur data (penting sebelum menyalahkan JOIN)

| Jalur | Dipakai endpoint | Sifat |
|---|---|---|
| `sapPool` → **langsung** ke AWS RDS (SSL) | `sap-timesheet-staging-log`, `-summary`, `sap-corrections`, `stgByDate`, `excludeSapRecord` | 1 round-trip WAN per query; ORDER BY/LIMIT/agregat jalan di AWS |
| `pool` (DB plant) → **postgres_fdw** `aws_staging` | semua query rekonsiliasi yang men-JOIN staging dengan tabel lokal (`records`, `day`, `export`, `actions`) | tabel staging = FOREIGN TABLE; baris ditarik ke plant lalu di-JOIN lokal |

`sap_timesheet_staging` + `sap_staging_source` di DB plant adalah **foreign table**, bukan
tabel nyata (`relkind='f'`, server `aws_staging` → `ssb-dw-dev…ap-southeast-1`).

## 2. Hasil ukur end-to-end (via nginx prod)

| Endpoint | Waktu | Catatan |
|---|---|---|
| `/api/config` (baseline overhead tunnel) | 0,63 s | angka di bawah dikurangi ini |
| `sap-timesheet-staging-log` (limit 30) | 0,72 s | **tab default SAP Posting — sudah cepat** |
| `sap-timesheet-staging-summary` | 0,93 s | |
| `sap-reconciliation` (30 hari) | 1,04 s | |
| `sap-corrections` | 0,56 s | |
| `sap-ops/requests` | 0,85 s | balikan 57 KB, dipoll 4 dtk saat job jalan |
| **`sap-reconciliation-records`** | **3,5–3,8 s** | **satu-satunya yang benar-benar lambat** |

Waktu `records` **tidak berubah** antara `pageSize` 25 vs 100 dan rentang 7 vs 30 hari →
biayanya bukan volume halaman, tapi ongkos tetap per request.

## 3. Sebab yang terbukti (EXPLAIN ANALYZE)

### 3.1 `fetch_size` FDW = 100 (default) — biaya dominan
Server `aws_staging` dibuat tanpa opsi apa pun. Setiap 100 baris = 1 round-trip ke Singapore
(±50 ms).

Uji A/B (foreign table identik, hanya beda `fetch_size`), 2.478 baris TIMESHEET:

| | Foreign Scan | Query total |
|---|---|---|
| `fetch_size` 100 (sekarang) | **1.161 ms** | 1.354 ms |
| `fetch_size` 20000 (uji) | **180 ms** | 393 ms |

Base join rekonsiliasi MCH 30 hari: Foreign Scan 9.025 baris = **4,19 s** (≈90 round-trip).
Tambahan: setiap backend baru bayar **±0,7–0,9 s** untuk membuka koneksi FDW pertama (TLS ke RDS).

### 3.2 Cast mematikan index di sisi lokal
`t.tsnumber::text = split_part(st.source_key, ':', 2)` (di `tsSql`, `tsBase`, `tsHeavy`)
memaksa **Seq Scan `timesheet_transaction` 155.984 baris** tiap request.
Dibalik jadi `t.tsnumber = split_part(st.source_key, ':', 2)::int` → Index Only Scan
(393 ms → 308 ms sekarang, dan tidak ikut membengkak saat tabel timesheet tumbuh).

### 3.3 Query list menyeret jsonb yang tidak dipakai
`getSapTimesheetStagingLog` SELECT `payload` + `sap_response` untuk 30 baris (respons 42 KB),
padahal keduanya hanya dipakai di Detail Drawer setelah baris diklik.

### 3.4 Summary: 1 dari 3 query tidak bisa di-push-down
Query `MIN/MAX(bucket_start) + COUNT(*) FILTER (… ::date = now()::date)` → agregat gagal
push-down (lewat FDW: 2,7 s / 4.399 baris ditarik). Lewat `sapPool` langsung dampaknya kecil,
tapi bentuknya tetap salah dan mahal di sisi RDS.

### 3.5 Search menarik seluruh tabel di RDS
`payload::text ILIKE` + `sap_response::text ILIKE` = seq scan + detoast semua baris, tak
terindeks. Kolom lain (`aufnr`, `pernr`, …) juga tanpa index trigram di sisi AWS.

## 4. Soal usul "perkaya kolom staging biar tak perlu JOIN"

**Ditolak sebagai perbaikan utama**, dengan alasan terukur:

1. Tab yang lambat (`records`) menghabiskan **1.161 ms dari 1.354 ms** di transfer baris FDW,
   bukan di JOIN-nya. Menambah kolom = **lebih banyak byte per baris lewat link yang sama** →
   memperburuk biaya dominan.
2. Tab SAP Posting (default page) **tidak punya JOIN sama sekali** dan sudah 0,7 s.
   Denormalisasi tak menyentuhnya.
3. Merusak fungsi rekonsiliasi: gunanya membandingkan **sumber hidup** (`mch_transaction`,
   `end_effective` yang di-recompute ETL tiap 5 menit, aturan `plant_config`) vs **yang
   terkirim** (staging). Kalau nilai sumber dibekukan ke staging, halaman itu
   membandingkan staging dengan dirinya sendiri — drift jadi tak terdeteksi.
4. Skema staging = kontrak payload SAP + dipakai 3 worker Python multi-plant; menambah kolom
   display ke sana menaikkan biaya perubahan jauh di atas manfaatnya.

Versi yang **masuk akal** dari ide ini (opsional, Fase 3): bukan menggemukkan tabel remote,
tapi **mirror lokal** — tabel nyata di DB plant yang disinkronkan inkremental
(watermark `id`/`updated_at`) dari AWS. Semua query rekonsiliasi jadi 100% lokal, bisa
diindeks, push-down tak relevan lagi. Trade-off: job sync + staleness detik-an.

⚠️ **Tapi cek arah besarnya dulu.** `.hermes/plans/2026-08-20_130804-aws-centralized-sap-staging.md`
D4 menimbang memindahkan **API + FE ke AWS (ECS, di samping RDS)**, bukan cuma tabel pipeline.
Kalau opsi itu yang diambil, hop WAN hilang dengan sendirinya dan mirror lokal jadi kerja
terbuang. Jadi Fase 3 **hanya** relevan bila diputuskan API tetap on-prem jangka panjang.

## 5. Rencana (urut ROI)

### Fase 0 — nol kode, menit (lakukan & ukur dulu)
```sql
-- di DB SETIAP plant (BPN 5433, CKP, …)
ALTER SERVER aws_staging OPTIONS (ADD fetch_size '10000');
ANALYZE public.sap_timesheet_staging;   -- foreign table butuh statistik lokal
ANALYZE public.sap_staging_source;
-- rollback: ALTER SERVER aws_staging OPTIONS (DROP fetch_size);
```
Perkiraan: `records` 3,5 s → ±1 s. Pertimbangkan juga `use_remote_estimate 'true'` **setelah**
ANALYZE (dan ukur ulang; tanpa statistik remote, planner bisa salah pilih rencana JOIN).

### Fase 1 — perbaikan query (kecil, aman)
1. `dashboardController.js`: ganti 3 kemunculan `t.tsnumber::text = split_part(...)` →
   `t.tsnumber = split_part(...)::int`, dengan guard `split_part(st.source_key,':',2) ~ '^[0-9]+$'`
   (pola sama dengan fix Bundles `d108396`).
2. Buang `payload`, `sap_response` dari SELECT list `getSapTimesheetStagingLog`; tambah
   endpoint detail `GET /dashboard/sap-timesheet-staging/:id` yang dipanggil Detail Drawer.
3. Summary: hitung tanggal "hari ini" di JS, kirim sebagai parameter range
   (`bucket_start >= $1 AND < $2`) supaya bisa push-down; cache respons 60 detik
   (pola `operationsHubCache` yang sudah ada).
4. Search: keluarkan `payload::text` / `sap_response::text` dari pencarian default
   (sediakan toggle "cari isi payload" bila memang perlu).

### Fase 2 — index di sisi AWS (verifikasi dulu apa yang sudah ada di `ssb_dw`)
`(werks, status, id DESC)` · `(werks, source_system, source_min_start)` ·
`(werks, source_system, bucket_start)` · trigram `aufnr`/`pernr` bila search dipertahankan.
Catatan: index di `database/schema/schema_prod.sql` menggambarkan tabel **lokal `_legacy`**,
bukan tabel di RDS.

### Fase 3 — hanya bila Fase 0–2 belum cukup DAN diputuskan API tetap on-prem
Mirror lokal read-model (lihat §4 + peringatannya). Bukan denormalisasi kolom di tabel remote.

## 6. Utang infrastruktur yang ikut ketahuan
Setup FDW (`CREATE EXTENSION` / `SERVER` / `USER MAPPING` / `CREATE FOREIGN TABLE`) dibuat
**manual per plant** dan tidak ada di `database/migrations/` — kalau DB plant dibangun ulang,
tabel diam-diam kembali ke `_legacy` yang stale. Perlu skrip idempoten + dicatat di ops doc.

## 7. EKSEKUSI 2026-09-02 — DONE & TERVERIFIKASI (commit 030901d, branch 2b)

### Fase 0 — diterapkan di BPN (5433) & CKP (tunnel 5441)
```sql
ALTER SERVER aws_staging OPTIONS (ADD fetch_size '10000');
ANALYZE public.sap_timesheet_staging;
ANALYZE public.sap_staging_source;
```
Ukur BPN (base join rekonsiliasi MCH 30 hari, EXPLAIN ANALYZE):
| | Foreign Scan | Total |
|---|---|---|
| fetch_size 100 (before) | 4.189 ms (9.025 baris) | 5,09 s |
| fetch_size 10000 (after) | 147 ms (9.602 baris) | 0,42–0,65 s |

Catatan: ANALYZE sempat gagal sekali karena DNS EAI_AGAIN host BPN ke RDS (flake yang sama
dengan §5 rekonsiliasi) — retry sukses. Stats lokal: staging 6.386, source 9.602.

### Fase 1 — kode (030901d)
1. **Cast tsnumber** (3x: tsSql/tsBase/tsHeavy): `t.tsnumber::text = split_part(...)` →
   `t.tsnumber = split_part(...)::int AND split_part(...) ~ '^[0-9]+$'` (pola d108396;
   data TIMESHEET source_key = `5051:<tsnumber>` — 0 non-numerik).
2. **List staging-log slim**: buang `payload` + `sap_response` dari SELECT (respons 42 KB →
   18 KB utk 30 baris); search tak lagi `payload::text`/`sap_response::text` ILIKE.
   Endpoint baru `GET /dashboard/sap-timesheet-staging/:id` (baris lengkap) dipanggil
   Detail Drawer (FE fetch per id + loading state).
3. **Summary**: tanggal "hari ini" dihitung di JS (`todayInTz`, en-CA) dan dikirim sebagai
   range (`bucket_start >= $1 AND < $1+1`, `posted_at` sama) → bisa push-down ke AWS;
   cache 60 s (`stagingSummaryCache`) — terukur call1 1,77 s → call2 0,002 s.
4. **Search**: `payload::text`/`sap_response::text` dikeluarkan dari pencarian default.

### Fase 2 — index AWS (ssb_dw, via tunnel 2-hop 5445)
Sudah ada: pkey(id), (source_system, bucket_start), (source_system, source_ref_id),
(source_system, source_key) UK, (status, created_at), (source_system, source_row_id,
bucket_start), (staging_id, source_row_id) UK.
Dibuat: `idx_staging_werks_status_id (werks, status, id DESC)` — 0,2 s (staging log
ORDER BY id DESC).
**Skip dengan alasan terukur**: `(werks, source_system, source_min_start)` &
`(werks, source_system, bucket_start)` & trigram — predikat pakai cast `::date` sehingga
index tidak terpakai; tabel kecil (6,4k/9,6k baris, seq scan remote ~50 ms); staging
ditulis terus-menerus (index berlebih = write overhead). Rollback Fase 2: DROP INDEX.

### Ukur end-to-end (test API lokal → BPN, PLANT 5051)
| Endpoint | Sebelum (plan §2) | Sesudah |
|---|---|---|
| records 30 hari | 3,5–3,8 s | query 1,1 s / endpoint ~2,7 s (FDW transfer 4,19 s → 0,2 s) |
| staging-log limit 30 | 0,72 s | 1,4 s via FDW lokal (prod sapPool direct tetap ~0,7 s) + payload 2,3× lebih kecil |
| summary call1 / call2 | 0,93 s | 1,77 s / 0,002 s (cache) |
| reconciliation 30 hari | 1,04 s | 1,4–1,7 s |
| export 2 hari | 13 s | 7,3 s |
| day | 1,3 s | 1,1 s |

Deploy prod: git pull 2b → build api + frontend → container restart. Verifikasi di server
setelah deploy: `sap-reconciliation-records` + `sap-timesheet-staging/:id`.

### Sisa (di luar scope hari ini)
- Fase 3 (mirror lokal read-model) hanya jika Fase 0–2 belum cukup — sejauh ini tidak.
- Skrip idempoten FDW per plant (§6) masih utang.

### Review lanjutan (temuan user, 2026-09-02) — DONE (commit c1360a0)
1. DetailDrawer menampilkan data bundel SEBELUMNYA (di-mount permanen, state tidak reset) →
   `key={detailRow?.id}` — remount per bundel.
2. Cache 60 s tidak pernah di-invalidate → `stagingSummaryCache = null` di enqueueSapOps +
   summary honor `?fresh=1` (tombol Refresh pakai fresh=1).
3. Error fetch detail ditelan → error inline + tombol "Coba lagi" (retry via retryNonce).
4. Guard+cast dalam satu AND (urutan evaluasi tidak dijamin) → bentuk deterministik
   `t.tsnumber = CASE WHEN split_part(...) ~ '^[0-9]{1,9}$' THEN ...::int END` — 3x ts join
   + 2x mch join (Bundles/day, pola sama dari d108396); {1,9} sekalian menutup overflow int4
   (tsnumber max saat ini 6 digit, proddataid 6 digit). Verifikasi: total records 30 hari
   tetap 11.503, source=timesheet tetap 2.478 (TIDAK ada baris hilang).

## 8. Sisa perbaikan — hasil review `c1360a0` (2026-09-02)

Commit `c1360a0` menutup 4 temuan review atas `030901d`. Tiga benar; satu (guard determinstik)
memperbaiki determinisme **tapi membatalkan optimasi Fase 1.1**. Verifikasi ulang lewat
EXPLAIN ANALYZE di BPN, warm, satu sesi, 2.478 baris TIMESHEET.

### 8.1 🔴 P1 — Bentuk guard `tsnumber` (WAJIB sebelum deploy)

`t.tsnumber = (CASE WHEN … ~ '^[0-9]{1,9}$' THEN …::int END)` membuat planner kembali memilih
**Hash Join + Seq Scan `timesheet_transaction` (156.076 baris)** — regresi persis ke kondisi
pra-Fase 1. Sebabnya regex tak lagi jadi predikat satu-relasi, jadi tidak ter-push-down ke AWS
dan estimasi baris foreign scan berubah, cukup untuk membalik rencana.

| Bentuk | Rencana | Waktu |
|---|---|---|
| `= …::int AND regex` (030901d) | Nested Loop + Index Only Scan | 292 ms |
| `CASE …` (c1360a0, sekarang) | **Hash Join + Seq Scan 156k** | 320 ms |
| **regex di `WHERE`, cast polos di `JOIN`** | Nested Loop + Index Only Scan, regex ter-push ke AWS | **289 ms** |

Selisih kecil hari ini (tabel 156k, panas di cache) tapi Seq Scan tumbuh linear tiap hari;
index lookup tidak. Bentuk yang dipakai:

```sql
FROM public.sap_timesheet_staging st
JOIN public.timesheet_transaction t ON t.tsnumber = split_part(st.source_key, ':', 2)::int
WHERE st.source_system = 'TIMESHEET'
  AND split_part(st.source_key, ':', 2) ~ '^[0-9]{1,9}$'
  AND …
```

Ini **lebih** deterministik daripada `AND` di dalam `ON`: predikat satu-relasi di `WHERE`
menjadi *baserestrictinfo* pada `st` dan selalu dieksekusi di scan relasi itu, sebelum qual
join mana pun — tidak bergantung urutan evaluasi dalam satu `AND` maupun bentuk rencana.
(Aturan proyek yang sama dari `ad5cff0`: guard-lalu-cast dalam satu ekspresi TIDAK aman.)

- Tempat: `tsSql` (~1734), `tsBase` (~1780), `tsHeavy` (~1848 — blok ini belum punya `WHERE`,
  tambahkan).
- **Tes penerimaan:** `EXPLAIN` query records menunjukkan `Index Only Scan using
  timesheet_transaction_pkey`, BUKAN `Seq Scan on timesheet_transaction`.

### 8.2 🟠 P2 — Invalidasi cache belum lengkap
`stagingSummaryCache = null` baru ada di `enqueueSapOps` (~1127). Dua jalur tulis lain
menyentuh status staging tanpa lewat sana:
- `postCorrections` (~1172) — INSERT `sap_ops_request` sendiri.
- `excludeSapRecord` (~2361) — exclude + antri recalc.

Dampak kecil (aksi asinkron, tombol Refresh sudah `?fresh=1`), tapi rapikan jadi satu helper
`invalidateStagingSummary()` dan panggil di ketiganya.

### 8.3 🟡 P3 — Konsistensi & catatan
- Dua join MCH (`exportSapReconciliation` ~2153, `getSapReconciliationDay` ~2299) **tidak**
  regresi dengan bentuk `CASE` (terukur `Index Scan using mch_transaction_pkey` di kedua
  bentuk, 695 vs 601 ms = noise). Samakan bentuknya dengan §8.1 hanya demi konsistensi baca.
- `{1,9}` menolak nilai int4 sah di 1.000.000.000–2.147.483.647. Tidak relevan sekarang
  (`tsnumber` ~156k, `proddataid` ~580k) dan lebih aman daripada error overflow, tapi
  perilakunya *silent drop* — sadari kalau id pernah melompat.
- `GET /dashboard/sap-ops/requests` mengembalikan **57 KB** dan dipoll tiap 4 detik selama job
  `stage_catchup` jalan (`ReconciliationPanel.pollOps`). Belum disentuh; kandidat perbaikan:
  batasi kolom + `LIMIT`.

### 8.4 Deploy & verifikasi — DONE (2026-09-02, commit 3ca20d1)
§8.1 (WHERE-guard tsnumber) + §8.2 (invalidateStagingSummary di 3 jalur) masuk di `3ca20d1`
dan sudah deploy BPN (pull 2b → build api). Verifikasi prod via nginx:
list 17,9 KB (dari 42,3 KB) · `sap-timesheet-staging/:id` 200 (0,08 s) ·
`sap-reconciliation-records` 200 (2,5 s) · summary 200 · tes penerimaan EXPLAIN
source=timesheet = Index Only Scan `timesheet_transaction_pkey`, tanpa Seq Scan (LULUS).
MCH join Bundles/day sengaja tetap bentuk CASE (LEFT JOIN — guard di WHERE mengubah
semantik nrows); terukur tanpa regresi. Catatan CKP: ALTER SERVER/ANALYZE sudah, kode API
deploy di BPN — kalau ada API terpisah di CKP perlu pull+rebuild di sana.

Selesai: [[log/2026-09-02-sap-log-perf-fase0-1]] ditulis, PLANNING dipindah ke ✅.

