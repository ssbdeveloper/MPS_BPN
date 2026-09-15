# Plan: Staging ter-clean per plant → AWS (ZTIMESHEETID global) + Lambda poster SAP

> **Status:** Analisa + plan (belum eksekusi). Dibuat 2026-08-31 atas permintaan user.
> **For Hermes:** implementasi bertahap per fase; konfirmasi keputusan (pola 1a/2b) dulu.

**Goal:** Setiap server plant (BPN 5051, CKP 5100, + lainnya) mengirim baris staging
yang sudah "clean" (lolos eligibility/bundling) ke tabel staging terpusat di AWS RDS
(ssb_dw), dengan **ZTIMESHEETID terkontrol & berurut global** (ID tidak bertabrakan
antar plant dan tidak terbuang), lalu posting ke SAP dari AWS via **Lambda Python**
dengan kredensial SAP di **AWS Secrets Manager**.

**Architecture:** Plant menjalankan script staging yang SUDAH ADA
(`stage_timesheet_transaction.py` / `stage_machinehours.py`) dengan `source` = DB lokal
(`DB_*`) dan `staging` = AWS RDS (`SAP_STAGING_DB_*` — fondasi `staging_db_config()`
sudah terpasang di `sap_staging_common.py`). AWS `sap_timesheet_staging` menjadi
pemberi identitas global (identity/sequence) → `ztimesheetid = id::text`. Poster lokal
per plant di-stop; Lambda Python (trigger scheduler/SQS) yang klaim & kirim ke SAP.

---

## 1. Analisa kebutuhan (terjemahan permintaan user)

| Kebutuhan user | Arti teknis |
|---|---|
| "Setiap staging table yang sudah di-clean masuk ke staging DB AWS" | Baris staging yang sudah lolos pipeline lokal (eligibility → bundling → status PENDING, bukan source mentah) dikirim ke `sap_timesheet_staging` di ssb_dw. Per plant = 1 collector (script existing + env `SAP_STAGING_DB_*`). |
| "Server BPN, CIKUPA, dan lainnya kirim ke AWS" | Multi-plant: BPN (5051), CKP (5100), + plant lain. Konsekuensi: `source_key` lokal (tsnumber/proddataid) PASTI tabrakan antar plant → wajib ada dimensi plant di kunci global. |
| "ZTIMESHEETID terkontrol dan berurut" | Satu identity global di AWS (bukan sequence lokal per plant) → tidak mungkin duplikat lintas plant. Berurut = monotonic. |
| "Setiap ID yang lahir tidak sia-sia" | ID tidak boleh "terbakar" oleh baris yang di-rebuild/dihapus sebelum pernah dikirim. Identity saat INSERT menghasilkan gap (rollback/delete) → perlu alokasi ZTIMESHEETID saat claim/posting (lihat K2). |
| "Lambda script python untuk posting SAP, kredensial di secret manager" | Ganti poster lokal (`post_sap_staging.py` di server) dengan AWS Lambda Python yang membaca AWS staging → kirim ke `SAP_INBOUND_URL`; user/password SAP di Secrets Manager, diambil saat runtime. |

---

## 2. Fakta saat ini (verified 2026-08-31)

| Aspek | Kondisi sekarang |
|---|---|
| Pipeline staging | `jobs/sap_staging/`: stage (bundling MCH + TIMESHEET) → `sap_timesheet_staging` → `post_sap_staging.py` → SAP. Berjalan di BPN (docker: sap-stage-worker, sap-post-worker, sap-ops-worker). |
| ZTIMESHEETID (BPN) | `sap_timesheet_staging.id` serial lokal → `ztimesheetid = id::text` (dokumen `docs/sap/sap_staging.md`). BPN max id **2.626.168**, 19.772 baris, 6.158 PENDING. |
| `log_timesheet_sap` (BPN) | 13.777 baris; **max ztimesheetid numeric = 1.000.147.452** (era lama format WERKS+seq). Data ini penting untuk menentukan start identity global (hindari reuse ID yang pernah diterima SAP). |
| AWS ssb_dw | PostgreSQL 17.7 (tunnel 2-hop 127.0.0.1:5445). SUDAH punya `sap_timesheet_staging`, `sap_staging_source`, `sap_ops_request`, `sap_stage_cursor`, `sap_staging_eligibility_audit` + 91 tabel DW. |
| Isi staging AWS | 11.136 baris, created 2026-07-16 → **2026-08-18** (snapshot sekali jalan, BUKAN sync live; BPN sekarang sudah 2.6M id), `werks` cuma **5051**. |
| Struktur staging AWS | `id bigint` **tanpa default/sequence** (bukan identity!), `ztimesheetid text` biasa (bukan generated). **TIDAK ADA constraint sama sekali** (tanpa PK, tanpa UNIQUE(source_system, source_key)) → anti-double mati di AWS. |
| Fondasi kode | `sap_staging_common.py` punya `staging_db_config()` (env `SAP_STAGING_DB_HOST/PORT/NAME/USER/PASSWORD`, fallback ke `DB_*`) — model "source lokal → staging AWS" SUDAH didukung kode. |
| Dokumen | `docs/sap/sap_staging.md` (baris 679-744) sudah menulis model ini: stage script baca DB lokal plant → insert AWS staging; cursor `sap_stage_cursor` per `(source_system, plant)`; `--limit 5000` untuk backlog. |
| Plan lama | `.hermes/plans/2026-08-20_130804-aws-centralized-sap-staging.md` (draft): ECS Fargate + API Gateway. User sekarang memilih **Lambda** untuk posting. |
| Lambda existing | `MPS\MPS2\aws\sap-ph3-order-lambda\` (Node 20, CPI → ph3_order, env `DB_*` + `SAP_TOKEN`) = pola referensi (VPC + RDS + Secrets Manager, sudah dicatat di README-nya). |
| Sumber lain | `docs/log/2026-08-30-*` + memory: "Arah AWS: worker SAP staging → ECS+API Gateway; konsolidasi 4 plant ke RDS, ZTIMESHEETID global anti-double." |

---

## 3. Gap (yang belum ada / harus dibuat)

| # | Gap | Detail |
|---|---|---|
| G1 | Identity global belum ada | `sap_timesheet_staging.id` di AWS bukan `GENERATED ALWAYS AS IDENTITY` dan tidak ada sequence → ZTIMESHEETID belum terkontrol global. |
| G2 | Anti-double mati di AWS | Tidak ada `UNIQUE (source_system, source_key)` / PK → `ON CONFLICT DO NOTHING` (inti pipeline) tidak berfungsi. |
| G3 | source_key tabrakan antar plant | `source_key` = tsnumber / md5(werks+bucket...) → TIMESHEET tsnumber PASTI bentrok antar plant. Wajib prefix plant (`5051:123456`). |
| G4 | Belum ada collector yang jalan | Snapshot AWS = manual sekali (Jul 16–Aug 18). Tidak ada agent per plant yang push live. |
| G5 | ID "terbuang" | ztimesheetid dikunci saat INSERT; rebuild/delete baris PENDING = ID terbakar (gap). Perlu alokasi saat claim (K2). |
| G6 | Belum ada Lambda poster | Posting masih `post_sap_staging.py` di BPN. Tidak ada Lambda Python + Secrets Manager untuk SAP creds. |
| G7 | Cutover belum dirancang | Selama BPN masih post lokal dan AWS menerima baris dengan id global, terjadi DUA sumber ZTIMESHEETID → tabrakan. Urutan stop/pindah wajib jelas. |
| G8 | Referensi per plant | Staging SQL JOIN `usernfc` (outsource→11009413) & `ph3_order` (confirmation_number). Kalau staging jalan di AWS, referensi ini harus ikut tersedia per plant (atau di-resolve di sisi plant sebelum push). |
| G9 | Write-back | `post_sap_staging.py` (dokumen) menulis `timesheet_transaction.state_flag=3` saat FAILED + `log_timesheet_sap`. Lambda harus mempertahankan ini — artinya Lambda butuh akses ke tabel source plant ATAU write-back lewat collector (arah sebaliknya). |

---

## 4. Arsitektur target

```text
Plant BPN (5051) / CKP (5100) / plant lain — on-prem, DB lokal
  stage_timesheet_transaction.py / stage_machinehours.py  (kode EXISTING, reuse)
    source = DB lokal (DB_*)      staging = AWS RDS (SAP_STAGING_DB_*)
    + source_key = "<plant>:<source_key_lokal>"  → UNIQUE(source_system, source_key) global
        │  push via TLS (RDS private subnet; plant perlu outbound → NAT/VPN — keputusan K1)
        ▼
AWS VPC — RDS PostgreSQL ssb_dw
  sap_timesheet_staging
    id bigint GENERATED ALWAYS AS IDENTITY (start > max legacy ZTIMESHEETID SAP)
    ztimesheetid text GENERATED ALWAYS AS (id::text) STORED   [atau alokasi saat claim — K2]
    UNIQUE(source_system, source_key), PK(id), index (status), index (werks)
  sap_staging_source / sap_stage_cursor (per plant) / sap_ops_request / log_timesheet_sap
        ▲  trigger: EventBridge (schedule) atau SQS
  Lambda Python "sap-poster"
    - claim PENDING/FAILED (FOR UPDATE SKIP LOCKED), urutan per plant
    - baca SAP creds dari Secrets Manager (SAP_INBOUND_URL/USERNAME/PASSWORD)
    - kirim payload → SAP; update status POSTED/FAILED + sap_response
    - write-back: log_timesheet_sap + (FAILED → state_flag=3 di source plant via collector balik — G9)
```

---

## 5. Poin keputusan (KEPUTUSAN USER 2026-08-31 — terkunci)

| # | Keputusan | Pilihan user |
|---|---|---|
| K1 | Jalur plant → AWS | **(a) Push langsung ke RDS via TLS** — semua server plant bisa outbound internet |
| K2 | ZTIMESHEETID | **(a) Identity saat INSERT** — insert otomatis generate id global (gap boleh, yang penting tidak double); user menegaskan "setiap insert selalu generate id otomatis" |
| K3 | Mesin poster | **(a) Lambda Python** + Secrets Manager |
| K4 | Cakupan onboarding | **(b) Semua plant sekaligus** (BPN + CKP + lainnya) |
| K5 | Transisi | **BPN sudah di-stop manual oleh user** (post lokal mati) → Lambda jadi satu-satunya poster |
| K6 | SAP dedupe | **SAP MENOLAK ZTIMESHEETID duplikat** → identity global wajib start > max legacy (terpasang: 2.000.000.000 > 1.000.147.452) |

**STATUS EKSEKUSI (2026-08-31):**
- ✅ Fase 1 (fondasi schema AWS) SELESAI: `database/migrations/aws/20260831_sap_staging_aws_schema.sql` di-apply ke ssb_dw (commit + ledger `schema_migrations` dibuat). Tabel pipeline di-drop & dibuat ulang bersih: `sap_timesheet_staging` (identity START 2.000.000.000, ztimesheetid generated, UNIQUE(source_system,source_key), status/source CHECK, 3 index), `sap_stage_cursor`, `sap_staging_eligibility_audit`, `sap_staging_source` (FK cascade + unique segment), `sap_source_change_blocked`, `sap_ops_request`, `sap_staging_exclusion`, `log_timesheet_sap`. Isi 0 (dummy lama dibuang).
- ⏳ Berikutnya: Fase 2 (collector per plant — config `SAP_STAGING_DB_*` di BPN & CKP + prefix plant di source_key), Fase 3 (Lambda poster Python), Fase 4-5 (cutover & monitoring).

## 5b. Keputusan desain lanjutan (open saat eksekusi)

- Prefix plant di `source_key`: `f"{plant}:{tsnumber}"` (TIMESHEET) — wajib sebelum collector aktif (G3).
- Baris BPN yang status POSTED (sudah terkirim ke SAP dengan id lokal) → TIDAK di-push ulang (atau push sebagai arsip berstatus POSTED, skip di Lambda) — hindari kirim ulang = ditolak SAP (dedupe aktif).
- `sap_ops_request.action` CHECK hanya berisi `stage_catchup`/`retry_failed` — aksi baru (post_date, post_bundles, recalc_date, post_operator, rebuild_pending) dari sesi 2026-08-27 BELUM ada di DDL AWS; perlu di-update kalau ops worker jalan dari AWS.
- `SAP_INBOUND_URL` reachable dari AWS region — perlu tes (Fase 0.2 belum jalan).

---

## 6. Langkah implementasi (fase, bite-size)

### Fase 0 — Inventori & verifikasi (0.5–1 hari, read-only)
1. Daftar plant: kode (5051, 5100, …), host/port DB, jalur akses (LAN/tailnet), outbound internet tersedia? — **input user**
2. Cek `SAP_INBOUND_URL` reachable dari AWS region (curl dari test EC2/Lambda).
3. Kumpulkan max ZTIMESHEETID yang pernah terkirim ke SAP per plant (`log_timesheet_sap` BPN: 1.000.147.452; cek CKP & lainnya).
4. Verifikasi perilaku SAP terhadap ZTIMESHEETID duplikat (tes aman / tanya tim SAP).
5. Snapshot skema staging AWS (constraint, index, sequence) → catat baseline.

### Fase 1 — Fondasi AWS schema (0.5–1 hari)
6. `sap_timesheet_staging` di AWS: tambah `id bigint GENERATED ALWAYS AS IDENTITY` (atau sequence) + `ztimesheetid` generated/claim (K2) + `UNIQUE (source_system, source_key)` + PK + index status/werks/plant.
7. Set identity start > max legacy ZTIMESHEETID SAP (Fase 0.3) — mis. 2.000.000.000 bila legacy 1.000.147.452.
8. Pastikan `sap_staging_source` / `sap_stage_cursor` / `sap_ops_request` di AWS punya PK + index yang sama dengan BPN (verifikasi diff skema).
9. Migration SQL versioned di `database/migrations/aws/` + ledger `schema_migrations` (pola dual-DB yang sudah ada).

### Fase 2 — Collector per plant (1–2 hari)
10. BPN: set `.env` `SAP_STAGING_DB_*` → AWS RDS; test `python stage_timesheet_transaction.py --dry-run` dari BPN.
11. Tambah prefix plant di `source_key` (TIMESHEET: `f"{plant}:{tsnumber}"`; MCH_HOURS: md5 tetap + werks) — patch `sap_staging_common.py`/stage scripts; pastikan idempoten (`ON CONFLICT DO NOTHING`).
12. Backfill: push snapshot lama (data Jul–Agu di AWS di-rebuild dengan kunci baru) — `--from-ts/--to-ts` existing.
13. Verifikasi: `SELECT count(*) FROM sap_timesheet_staging GROUP BY werks`; anti-double test (jalankan ulang → 0 duplikat); ZTIMESHEETID unik (`GROUP BY ztimesheetid HAVING count(*)>1` = 0).
14. CKP: ulangi 10–13 (pastikan katalog/referensi CKP sudah lengkap — lihat log 2026-08-31 seed CKP).

### Fase 3 — Lambda poster Python (2–3 hari)
15. Scaffold `aws/sap-poster-lambda/` (pola dari `aws/sap-ph3-order-lambda`): Python 3.12, psycopg (RDS), `boto3` Secrets Manager.
16. Secrets Manager: `sap/inbound` berisi `SAP_INBOUND_URL`, `SAP_INBOUND_USERNAME`, `SAP_INBOUND_PASSWORD`, `DB_*` staging.
17. Lambda claim flow (K2): `SELECT ... FOR UPDATE SKIP LOCKED` → alokasi ztimesheetid (kalau K2b) → build/refresh payload → POST → update status + sap_response → insert `log_timesheet_sap`.
18. Retry semantics (bawaan `post_sap_staging.py`): `--max-retries` (3), retry jaringan & kunci order, bukan penolakan bisnis; throttle per worker (SAP ~7 dtk/kiriman, target 1,7 dtk/baris seperti lokal).
19. Trigger: EventBridge schedule (mis. tiap 5 menit) + batch `--limit`; atau SQS per batch dari collector.
20. Test end-to-end 1 plant di sandbox: stage → Lambda → SAP → status POSTED/FAILED + log.
21. IAM: role Lambda (Secrets Manager read, RDS connect via VPC/SG), no public RDS.

### Fase 4 — Cutover BPN (1 hari)
22. Drain: pastikan semua PENDING lokal BPN ter-push ke AWS (id global).
23. Stop `sap-post-worker` BPN (docker compose stop) — posting kini dari AWS.
24. Aktifkan Lambda schedule; verifikasi 24 jam pertama (jam posting, reject rate, anti-double query).
25. Rollback siap: post-worker lokal tetap ada (read-only) 1 minggu.

### Fase 5 — CKP + plant lain & monitoring (1–2 hari)
26. Onboard CKP (Fase 2.14) + aktifkan posting via Lambda (werks=5100).
27. Dashboard/alert: CloudWatch (Lambda errors, SAP reject rate), query anti-double harian.
28. Write-back loop (K6) jika disetujui.

---

## 7. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| ZTIMESHEETID bentrok dgn legacy yang sudah terkirim SAP | identity start > max `log_timesheet_sap` per plant (Fase 0.3); verifikasi dedupe SAP |
| Double posting saat cutover | urutan wajib: push dulu → stop post-worker lokal → aktifkan Lambda (K5a); `UNIQUE(source_system, source_key)` global |
| source_key tabrakan antar plant | prefix plant di source_key (G3) — jangan lupa source_key lama di AWS di-rebuild |
| Plant tidak bisa outbound internet | K1c (tailscale) atau push via gateway; uji di Fase 0 |
| Mapping outsource rusak (usernfc, ph3_order) | resolve referensi di sisi plant sebelum push ATAU konsolidasi referensi per plant (G8) |
| Lambda timeout / SAP lambat | batch kecil (limit 100–500), concurrency terkontrol, timeout 5–15 mnt, paralel antar-order |
| ID "terbuang" tidak terselesaikan | K2b (alokasi saat claim) — keputusan user |
| Biaya RDS/Lambda | RDS small dulu, Lambda schedule 5 menit (bukan 24/7 container), stop kalau idle |
| Posting saat BPN mati/offline | collector catch-up via cursor (`sap_stage_cursor` per plant) — sudah didesain |

---

## 8. Open questions untuk user

1. **Daftar plant**: kode plant, host/port DB, jalur akses, outbound internet? (BPN=5051, CKP=5100, sisanya?)
2. **SAP dedupe by ZTIMESHEETID?** — menentukan aturan start identity & apakah reuse aman.
3. **K2**: identity saat insert (gap boleh) vs alokasi saat claim (ID tidak terbuang)?
4. **K5**: cutover BPN dulu (post lokal stop) — OK?
5. **K1**: plant → AWS lewat TLS langsung (butuh outbound) atau tailscale mesh?
6. CKP juga langsung ikut posting dari AWS, atau BPN pilot dulu?

---

## 9. Referensi

- `docs/sap/sap_staging.md` (model plant→AWS staging + cursor, baris 679-744)
- `.hermes/plans/2026-08-20_130804-aws-centralized-sap-staging.md` (plan lama ECS)
- `MPS\MPS2\aws\sap-ph3-order-lambda\` (pola Lambda + RDS + Secrets Manager)
- `jobs/sap_staging/sap_staging_common.py` (`staging_db_config()`, baris 53-60)
- `jobs/sap_staging/README.md` (pengaman pipeline, ZTIMESHEETID, batas berbahaya)
