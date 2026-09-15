---
title: "EWS Issue Log — analisa & saran spesifikasi issue (BELUM dikerjakan)"
date: 2026-08-10
tags: [EWS, issue-log, planning]
---

# EWS Issue Log: buat issue lebih spesifik (kolom salah, PIC, cara perbaiki)

Status: **ANALISA + SARAN — menunggu keputusan user (1a 2a 3a 4a), JANGAN coding dulu.**

## Masalah

Issue log EWS saat ini terlalu general: kolom `title`/`description`/`metric_value`/`detail(jsonb)`
tidak menyebutkan (a) kolom data mana yang salah, (b) siapa PIC, (c) cara memperbaiki.
User minta: kolom salah + PIC penanggung jawab + note perbaikan singkat per issue.

## Temuan (bukti data CKP, 2026-08-10)

1. **`ews.issue_log` KOSONG di produksi (0 baris)** — generator EWS belum pernah
   menghasilkan issue di CKP. Job `apps/api/jobs/ewsSnapshotJob.js` kemungkinan belum
   berjalan di server (perlu dicek: cron / pm2 / docker / manual). Semua perbaikan struktur
   tidak akan terlihat sebelum generator benar-benar jalan.
2. Kolom issue_log saat ini: `id, issue_key, category, business_date, scope_type, entity_id,
   entity_name, severity, title, description, metric_value, detail(jsonb), status,
   created_at, updated_at, resolved_at, resolution_note, resolved_by` — TIDAK ada kolom PIC
   atau remediation note.
3. **Tidak ada master PIC di DB**: `mch_machines` (master mesin) tidak punya kolom
   penanggung jawab; `ms_project.project_owner` hanya untuk project. Kolom mirip PIC
   hanya ada di `consumable_ticket` (picked_by_* — bukan penanggung jawab).
4. Sumber data per kategori sudah jelas dari generator (`apps/api/services/ewsIssueGenerator.js`):
   - accuracy_machine → `public.mch_transaction` (`status_record = false`)
   - adoption_* → operator_shift / timesheet vs standar shift
   - oee / ole → breakdown dari `ews.kpi_snapshot.detail_json`
   - uptime_hmi → `ews.device_heartbeat_daily`

## Saran desain

Issue = **diagnosis spesifik** dengan 3 elemen baru:

| Elemen | Isi | Contoh (accuracy_machine) |
|---|---|---|
| `pic` (kolom baru) | Penanggung jawab per kategori (configurable via env) | `PE / Planner` |
| `remediation_note` (kolom baru) | Langkah perbaikan + data spesifik | "Mesin A-12: 12/40 transaksi status_record=false (08-08). Lengkapi operator/job sebelum close." |
| `detail.culprit` (jsonb) | Kolom yang salah + predicate + count (+ sample rows opsional) | `{table:"mch_transaction", column:"status_record", predicate:"= false", count:12, sample:[{ssbr_id, full_name, startdatetime}]}` |

Pola implementasi: sama seperti threshold sekarang (const + env override `EWS_*`), tiap
generator mengisi mapping-nya sendiri.

## Keputusan yang menunggu user

1. **Mapping PIC default** (env-overridable):
   - accuracy_machine / accuracy_labour → PE/Planner
   - adoption_machine / adoption_labour → Foreman
   - oee → Maintenance
   - ole → Foreman
   - uptime_hmi → IT
2. **Culprit**: ringkasan saja (`table.column + predicate + count`) atau **+ sample rows**
   (LIMIT 5: order_no/ssbr_id/full_name) untuk drill di UI?
3. **PIC per-entity** (mesin/operator spesifik): butuh master baru — **disarankan TUNDA**,
   mulai PIC per-kategori dulu.
4. **Cek kenapa job EWS tidak jalan di server** (cron/pm2/docker?) supaya issue beneran lahir.

## File terkait

- Generator: `apps/api/services/ewsIssueGenerator.js` (590 baris; UPSERT_SQL L102, upsertIssue L123,
  autoResolveStale L147, generateAll L564)
- Job: `apps/api/jobs/ewsSnapshotJob.js` (LISTEN `ews_source_changed`, interval 60s, advisory lock)
- Controller: `apps/api/controllers/ewsController.js` (getIssueLog L1309, resolveIssueLog L1355,
  generateIssueLog L1415) — routes `apps/api/routes/ews.js`
- FE: `apps/web/src/pages/EwsDetailPage.jsx` AutoIssueLogCard L1853, `EwsIssueDrillPage.jsx`
- TTS: `apps/api/services/ewsTtsNotifier.js` (enqueueIssueTts dipanggil upsertIssue saat was_inserted)
