---
title: "AWS terpusat — konsolidasi 4 plant + worker SAP staging di AWS (docker + API Gateway)"
date: 2026-08-20
tags: [aws, sap-staging, multi-plant, rds, ecs, api-gateway, timesheet, mch]
status: draft
---

# Plan: AWS terpusat — konsolidasi 4 plant + worker SAP staging di AWS

## 1. Tujuan

- Worker SAP staging (docker) pindah dari on-prem ke AWS (ECS).
- Konsolidasi data dari **4 plant**: `mch_transaction` (mesin) + `timesheet_transaction` (labour) → **2 tabel** di AWS RDS (dengan dimensi plant).
- Dari tabel AWS → `sap_timesheet_staging` → posting ke SAP, dengan **ZTIMESHEETID terkontrol** (identity global tunggal = tidak mungkin duplicate lintas plant).
- Lapisan API di AWS via **API Gateway**.

## 2. Fakta saat ini (verified 2026-08-20)

| Aspek | Kondisi sekarang |
|---|---|
| Worker | 3 service docker compose: `sap-stage-worker` (stage_machinehours --catchup loop), `sap-post-worker` (post_sap_staging loop), `sap-ops-worker` (ops_worker queue UI). Image `Dockerfile.sap` (python:3.11-slim). Connect DB via pgbouncer :6432 ke DB lokal (BPN). |
| Plant | `PLANT_SSB=5051` sekarang (env tunggal per deploy). Plant lain belum teridentifikasi dari repo (perlu input user). |
| Kode sudah siap split | `sap_staging_common.py` punya `staging_db_config()` dengan env **`SAP_STAGING_DB_HOST/PORT/NAME/USER/PASSWORD`** (fallback ke `DB_*`) → source & staging bisa beda DB. Ini fondasi arsitektur AWS yang sudah terpasang. |
| Docs target | `docs/sap/sap_staging.md` SUDAH mendokumentasikan model "stage per plant lokal → AWS staging": ZTIMESHEETID = `id::text` identity ("Tidak perlu lock sequence per plant"), anti-double `UNIQUE (source_system, source_key)`, `ON CONFLICT DO NOTHING`. |
| Staging | `sap_timesheet_staging`: id identity, ztimesheetid = id::text STORED, status PENDING/POSTING/POSTED/FAILED/SKIPPED, payload jsonb, pernr_origin (audit outsource). |
| Posting | `post_sap_staging.py`: claim PENDING/FAILED (`FOR UPDATE SKIP LOCKED`), POST ke `SAP_INBOUND_URL`, set POSTED/FAILED + sap_response. Sudah dukung `--ids`, `--source-system`, `--workers`. |
| Write-back | **TIDAK ada** write-back hasil posting ke `timesheet_transaction` (grep 0 match) — perlu ditambah (FAILED → state_flag=3 + validation_date=NULL). |
| API | `apps/api` punya Dockerfile sendiri (bisa naik ke AWS). FE per-plant sekarang baca DB lokal masing-masing. |

## 3. Temuan penting (sebelum desain)

1. **tsnumber / proddataid = identity LOKAL per plant** → PASTI bisa tabrakan antar plant begitu disatukan. Konsolidasi WAJIB tambah dimensi `plant` + kunci global (composite atau surrogate id).
2. **Staging SQL JOIN tabel referensi**: `usernfc` (mapping outsource → 11009413) dan `ph3_order`/TGT_TABLE (confirmation_number). Kalau staging jalan di AWS dari tabel konsolidasi, tabel referensi ini **harus ikut dikonsolidasi per plant** — kalau tidak, mapping outsource & RUECK rusak. Konsolidasi minimum pipeline = `timesheet_transaction` + `mch_transaction` + `usernfc` + `ph3_order` (+ `mch_machine`/master machine utk plant MCH).
3. **ZTIMESHEETID identity baru mulai dari 1** — ZTIMESHEETID lama yang sudah terkirim ke SAP dari staging lokal (tiap plant mulai dari 1) bisa bentrok **kalau SAP dedupe by ZTIMESHEETID**. Perlu verifikasi + mitigasi (set identity start > max legacy, atau buktikan SAP tidak dedupe by ZTIMESHEETID).
4. **Konektivitas plant → AWS** belum ada jalur yang pasti: plant di LAN/tailnet (`100.x`), AWS tidak bisa reach `100.x` tanpa join tailnet/VPN. Arah data (push vs pull) menentukan kebutuhan jaringan.
5. **Manual posting (halaman validasi) & pipeline ini menyatu**: kalau posting pindah ke AWS staging, `POST /timesheet/post-to-sap` cukup INSERT ke staging AWS (source_key=tsnumber) → poster yang kirim → write-back. Plan `2026-08-20_125454-timesheet-via-sap-staging.md` otomatis terserap.

## 4. Arsitektur target

```text
Plant 1..4 (on-prem: LAN/tailnet, DB lokal masing-masing)
  timesheet_transaction, mch_transaction, usernfc, ph3_order
        │  D1: push collector / replikasi / FDW-pull
        ▼
AWS VPC (private subnet)
  RDS PostgreSQL (1 instance, multi-AZ optional)
    ├─ timesheet_transaction  (labour, + kolom plant, UNIQUE global)
    ├─ mch_transaction        (mesin,  + kolom plant, UNIQUE global)
    ├─ usernfc, ph3_order     (referensi per plant)
    ├─ sap_timesheet_staging  (identity GLOBAL → ZTIMESHEETID unik)
    ├─ sap_ops_request / sap_stage_cursor / sap_staging_source
    └─ log_timesheet_sap
        ▲
  ECS Fargate — docker worker (image Dockerfile.sap)
    ├─ stage: TIMESHEET per-record (no bundle) + MCH bundle — baca tabel AWS
    ├─ post_sap_staging.py → SAP (SAP_INBOUND_URL dari Secrets Manager)
    ├─ ops_worker (queue UI: retry_failed / post_corrections / rebuild_pending)
    └─ write-back hasil → timesheet_transaction (FAILED → flag 3)
        ▲
  API Gateway (REST/HTTP) ── VPC Link/ALB ──> Node API (apps/api, docker di ECS)
        ▲
  FE web (per plant atau terpusat — D4)
```

## 5. Poin keputusan (pola 1a/2a — rekomendasi ditandai)

**D1 — Jalur data plant → AWS:**
- (a) **Push collector per plant** (script kecil reuse `sap_staging_common` + insert/COPY, scheduler lokal; kirim batch via HTTPS ke API Gateway+Lambda ATAU langsung ke RDS via TLS) — rekomendasi kalau plant bisa outbound internet.
- (b) postgres_fdw di AWS pull dari plant (butuh plant reachable dari AWS: tailscale/VPN).
- (c) AWS DMS CDC (sama butuh konektivitas).
- (d) Tailscale mesh: EC2 join tailnet, relay ke RDS (reuse infra tailscale yang sudah ada).
- **INPUT USER WAJIB**: endpoint DB 4 plant + apakah tiap server plant bisa outbound internet.

**D2 — Kunci global tabel konsolidasi:**
- (a) Kolom `plant` + pertahankan id lokal; `UNIQUE (plant, tsnumber)` / `(plant, proddataid)`; staging `source_key = plant || ':' || source_key_lokal` — rekomendasi (jejak asal tetap terlihat).
- (b) Surrogate id identity AWS baru per tabel, staging source_key = surrogate id.

**D3 — ZTIMESHEETID:**
- (a) **Identity global di AWS** (= keinginan user) + set identity start > max legacy ZTIMESHEETID yang pernah dikirim (cek `log_timesheet_sap` / staging lama per plant) — rekomendasi.
- (b) Pertahankan format lama (WERKS + seq) — menyalahi desain docs yang sudah diganti.
- Verifikasi wajib: apakah SAP dedupe by ZTIMESHEETID (tanya tim SAP / test kirim duplikat).

**D4 — API Gateway & cakupan:**
- (a) API Gateway → proxy ke Node API (`apps/api` Dockerfile) di ECS — reuse kode, rekomendasi.
- (b) API Gateway + Lambda per endpoint (porting, mahal).
- Cakupan DB AWS: (i) hanya tabel pipeline (2 transaksi + referensi) — API/FE tetap on-prem; (ii) **full DB** — API/FE pindah, bisa validation lintas plant. Rekomendasi: (ii) kalau tujuan akhirnya dashboard lintas plant; (i) kalau cuma pipeline SAP.
- FE: tetap per-plant (VITE_API_URL → gateway) atau satu FE terpusat.

**D5 — Write-back & retry:** di `post_sap_staging.py` (source_system='TIMESHEET' → update timesheet_transaction AWS + insert log_timesheet_sap). retry_failed/post_corrections/rebuild_pending tetap jalan via ops_worker. — rekomendasi.

**D6 — Keamanan:** RDS private subnet + SG; kredensial (DB, SAP_INBOUND_*) di AWS Secrets Manager; IAM role ECS; API Gateway auth pakai header `x-user-*` existing + (opsional) WAF. Plant → AWS pakai TLS; jangan expose RDS public.

## 6. Step yang harus dilakukan (fase)

### Fase 0 — Inventori & konektivitas (1–2 hari)
1. Daftar 4 plant: kode plant (5051, dst), host/port DB, jalur akses (LAN/tailnet/public), **outbound internet tersedia atau tidak**.
2. Test `SAP_INBOUND_URL` reachable dari AWS region tujuan (curl dari EC2 test / Lambda).
3. Kumpulkan nilai legacy: max ZTIMESHEETID yang pernah terkirim ke SAP per plant (untuk D3).
4. Cek versi PostgreSQL tiap plant (untuk kompatibilitas dump/FDW).

### Fase 1 — Fondasi AWS (2–3 hari)
5. VPC (2 AZ, private subnet) + RDS PostgreSQL (versi ≥ plant tertua, backup otomatis) + parameter group.
6. Secrets Manager: DB master, SAP_INBOUND_USERNAME/PASSWORD, kredensial plant.
7. ECR repo + ECS cluster Fargate + task definitions (stage / post / ops_worker) — image dari `jobs/sap_staging` (Dockerfile.sap + requirements).
8. API Gateway (REST/HTTP) + ALB/VPC Link (kalau D4a), atau Lambda (D4b).

### Fase 2 — Konsolidasi data (2–4 hari)
9. Skema AWS: buat tabel konsolidasi (kolom plant + kunci global D2) + backfill history via pg_dump per plant.
10. Implementasi D1 (push collector / replikasi) + idempotensi (upsert by kunci global).
11. Salin referensi: usernfc, ph3_order, master machine per plant (dengan kolom plant).
12. **Verifikasi mapping outsource**: record outsource dari tiap plant → pernr 11009413 benar di staging.

### Fase 3 — Staging + posting di AWS (2–3 hari)
13. Sesuaikan `stage_timesheet_transaction.py` / `stage_machinehours.py` baca dari tabel AWS (source=staging= AWS → bisa satu koneksi; env SAP_STAGING_DB_* = RDS lokal).
14. Tambah **write-back** di `post_sap_staging.py` (D5) + log_timesheet_sap.
15. Test end-to-end 1 plant: stage → post → SAP → status POSTED/FAILED → write-back flag.
16. Anti-double test: jalankan ulang stage → `ON CONFLICT DO NOTHING`, tidak ada duplikat; ZTIMESHEETID unik lintas plant (query `SELECT count(*) FROM sap_timesheet_staging GROUP BY ztimesheetid HAVING count(*)>1` = 0).

### Fase 4 — API Gateway + FE (2–3 hari)
17. Deploy Node API (apps/api Dockerfile) ke ECS; API Gateway → ALB/VPC Link.
18. Update `.env` FE `VITE_API_URL` → endpoint gateway.
19. (Opsional) FE terpusat / validation page lintas plant (kalau D4-ii).

### Fase 5 — Cutover & monitoring (1 hari)
20. Freeze: stop worker lama per plant (post-worker dulu), drain PENDING yang tersisa, pastikan staging lama kosong.
21. Aktifkan worker AWS; verifikasi 24 jam pertama (jam posting, reject rate, anti-double).
22. Rollback plan: worker lama tetap hidup 1 minggu (read-only) — tinggal aktifkan kembali kalau ada masalah.

## 7. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| tsnumber/proddataid tabrakan antar plant | kolom plant + kunci global (D2) |
| ZTIMESHEETID bentrok dgn legacy yang sudah terkirim | identity start > max legacy; verifikasi dedupe SAP (D3) |
| Double posting saat cutover | source_key idempoten + drain PENDING + stop worker lama dulu |
| Plant tidak bisa outbound internet | tailscale/VPN (D1d), atau push via gateway bukan DB langsung |
| SAP endpoint tidak reachable dari AWS | test Fase 0; VPN/VPC endpoint |
| Mapping outsource rusak tanpa usernfc | usernfc ikut dikonsolidasi (temuan #2) |
| Latensi/long-posting | `--workers` paralel, RDS cukup besar, index status_idx |
| Biaya membengkak | Fargate jadwal (schedule 24/7 dulu), RDS small instance dulu, stop kalau idle |

## 8. Deliverable bertahap

- Fase 0–1: dokumen konektivitas + akun AWS terprovisi
- Fase 2: tabel konsolidasi live terisi (4 plant) + verifikasi outsource
- Fase 3: posting SAP dari AWS (worker docker) + write-back
- Fase 4: API Gateway live, FE terhubung
- Fase 5: cutover + monitoring 1 minggu + rollback siap

## 9. Catatan integrasi

Plan ini MENYERAP `2026-08-20_125454-timesheet-via-sap-staging.md`: post-to-sap manual → cukup INSERT staging AWS (per record, source_key=tsnumber) → poster → write-back. Tidak perlu dua mekanisme posting.
