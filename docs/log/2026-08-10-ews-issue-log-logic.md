# EWS Issue Log — Detail Logic Generator

> Ringkasan lengkap logika backend `ews.issue_log` (PT. Sanggar Sarana Baja — Manufacturing).
> Sumber: `apps/api/services/ewsIssueGenerator.js` (590 baris), `apps/api/jobs/ewsSnapshotJob.js` (248),
> `apps/api/services/ewsTtsNotifier.js`, `apps/api/controllers/ewsController.js`,
> `database/schema/schema_prod.sql`.
> Tanggal: 2026-08-10. Semua angka default = nilai source code; bisa dioverride via env.

---

## 1. Konsep Dasar

| Konsep | Penjelasan |
|---|---|
| Definisi issue | **Snapshot satu business day**, BUKAN tiket yang menumpuk antar hari |
| Dedup | `issue_key` UNIQUE = `{kategori}:{business_date}:{entity_type}:{entity_id}` |
| Mekanisme tulis | UPSERT — masalah yang sama hari ini menimpa baris yang sama (kalau masih open) |
| Issue lama | Auto-resolve otomatis saat business day bergeser (`autoResolveStale`) |
| Log selalu = "apa yang salah HARI INI" | `generateAll()` tutup issue kemarin dulu, baru lahirkan issue hari ini |
| Otonom | Generate berjalan di snapshot job (backend), tidak butuh UI dibuka |
| Sumber data | Query langsung ke tabel transaksi ATAU baca ulang `ews.kpi_snapshot` (detail_json) |

Alur lengkap:

```
[Trigger] → ewsSnapshotJob.runSnapshots()
   1. pg_try_advisory_lock(27112026)        ← cegah run ganda antar instance
   2. ewsCalculator.calculateSystemSummary() ← hitung & simpan KPI ke ews.kpi_snapshot
   3. ewsIssueGenerator.generateAll()       ← BEGIN → autoResolveStale → 7 generator → COMMIT
       ├─ autoResolveStale   : tutup issue open dari business_date < hari ini
       ├─ accuracy_machine   : query mch_transaction
       ├─ accuracy_labour    : query timesheet_transaction
       ├─ adoption_machine   : baca detail snapshot
       ├─ adoption_labour    : baca detail snapshot
       ├─ oee                : baca detail snapshot
       ├─ ole                : baca detail snapshot
       └─ uptime_hmi         : baca detail snapshot
   4. tiap issue BARU (was_inserted) → ewsTtsNotifier.enqueueIssueTts (best-effort)
```

Trigger run snapshot job:

| Trigger | Kapan | Catatan |
|---|---|---|
| `startup` | saat job start | sekali |
| `interval` | tiap 60 detik (`EWS_JOB_INTERVAL_MS`) | safety refresh |
| `database_notify` | ada NOTIFY `ews_source_changed` dari DB | debounce 2,5 detik |
| manual | POST issue-log/generate | via controller |

---

## 2. Business Day (Shift-Aware)

```sql
WITH biz AS (
  SELECT date_trunc('day', now() - make_interval(hours => $1::int)) AS day_start
)
SELECT day_start AS window_start,
       LEAST(now(), day_start + interval '1 day') AS window_end,
       day_start::date::text AS business_date
```

| Item | Nilai | Keterangan |
|---|---|---|
| `EWS_DAY_START_HOUR` | **7** (default) | Jam rollover business day. `business_date` = hari kalender minus 7 jam |
| `window_start` | `date_trunc('day', now()-7h)` | awal window data |
| `window_end` | `LEAST(now(), window_start + 1 day)` | ujung window (mengikuti waktu sekarang) |
| `business_date` | text `YYYY-MM-DD` | sengaja text agar issue_key stabil antar caller (hindari beda format JS Date) |
| Timezone | `resolveTimezone()` dari config | dipakai untuk interpretasi `window_start AT TIME ZONE` |

Contoh: jam 06:00 WITA → masih `business_date` kemarin. Jam 07:01 → pindah ke hari ini.

---

## 3. Konfigurasi & Threshold (Semua Env)

| Env / Konstanta | Default | Fungsi |
|---|---|---|
| `EWS_DAY_START_HOUR` | 7 | Jam rollover business day |
| `EWS_ACC_MACHINE_MIN_MISSING` | 5 | Floor issue accuracy_machine: minimal jumlah record tidak lengkap per mesin per hari (anti-noise) |
| `EWS_ACC_MACHINE_CRITICAL_PCT` | 50 | accuracy_machine critical bila % tidak lengkap ≥ 50, else warning |
| `EWS_ACC_LABOUR_MIN_BAD` | 3 | Floor issue accuracy_labour: minimal record produktif invalid per operator |
| `EWS_ACC_LABOUR_CRITICAL_PCT` | 30 | accuracy_labour critical bila % invalid ≥ 30, else warning |
| `TGT_TABLE` | `ph3_order` | Tabel master SAP order (regex aman `^[a-z_][a-z0-9_]*$`, selain itu fallback ph3_order) |
| `EWS_ADOPTION_MACHINE_MIN_GAP_MIN` | 15 | Floor adoption_machine: minimal gap menit mesin tanpa operator |
| `EWS_ADOPTION_MACHINE_CRITICAL_COVER_PCT` | 50 | critical bila coverage ≤ 50%, else warning |
| `EWS_ADOPTION_LABOUR_MIN_GAP_H` | 1 | Floor adoption_labour: minimal selisih jam tercatat vs target |
| `EWS_ADOPTION_LABOUR_CRITICAL_PCT` | 50 | critical bila operator log ≤ 50% target, else warning |
| `EXCUSED_STATUSES` | `LEAVE, SICK, PERMIT, OFF` | Status roster yang membebaskan operator dari kewajiban log jam |
| `EWS_OEE_MACHINE_MIN_HOURS` | 2 | OEE baru jadi issue bila denominator ≥ 2 jam (hindari noise mesin jarang jalan) |
| `EWS_OEE_MACHINE_CRITICAL_PCT` | 65 | OEE **critical-only**: issue hanya bila OEE < 65 (warning band tidak jadi issue) |
| `EWS_OLE_OPERATOR_MIN_HOURS` | 2 | OLE baru jadi issue bila available hours ≥ 2 |
| `EWS_OLE_OPERATOR_CRITICAL_PCT` | 70 | OLE **critical-only**: issue hanya bila OLE < 70 |
| `EWS_UPTIME_HMI_DOWN_STREAK` | 3 | HMI jadi issue setelah gagal ping beruntun ≥ 3 siklus (~3 menit, ping tiap 60 dtk) |

Snapshot job env:

| Env | Default | Fungsi |
|---|---|---|
| `EWS_JOB_DEBOUNCE_MS` | 2500 | Debounce NOTIFY sebelum run |
| `EWS_JOB_INTERVAL_MS` | 60000 | Interval safety refresh (0 = mati) |
| `EWS_JOB_RUN_ONCE` | 0 | 1 = sekali jalan lalu exit |
| `EWS_JOB_ADVISORY_LOCK_KEY` | 27112026 | Kunci advisory lock antar instance |
| `EWS_JOB_PROGRESS_LOG_MS` | 15000 | Log progress "still running" |
| `EWS_JOB_QUERY_TIMEOUT_MS` | 120000 (fallback `DB_QUERY_TIMEOUT_MS`) | query_timeout pool |
| `EWS_JOB_STATEMENT_TIMEOUT_MS` | 120000 (fallback `DB_STATEMENT_TIMEOUT_MS`) | statement_timeout (juga `-c statement_timeout`) |
| `EWS_JOB_DB_POOL_MAX` | 4 (min 4) | Ukuran pool (dibutuhkan utk LISTEN + lock + kalkulasi) |
| `EWS_JOB_APPLICATION_NAME` | mps2-ews-snapshot-job | application_name koneksi |
| `EWS_SNAPSHOT_TARGETS` | `today` | Target snapshot; bisa `today` atau `rolling:{window}` (koma untuk multi) |

---

## 4. Tabel `ews.issue_log` (Schema)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | bigint (identity) | PK |
| `issue_key` | text UNIQUE | Kunci dedup `kategori:date:entity_type:entity_id` |
| `category` | text | Nama generator/KPI (7 kategori, lihat §5) |
| `business_date` | date | Business day issue (shift-aware) |
| `scope_type` | text | `machine` / `operator` / `device` |
| `entity_id` | text | ID entitas (machineno, operator_key, IP HMI) |
| `entity_name` | text | Nama tampilan entitas |
| `severity` | text | `warning` / `critical` (CHECK constraint) |
| `title` | text | Judul singkat (Indonesia) |
| `description` | text | Deskripsi lengkap + instruksi tindakan |
| `metric_value` | numeric | Nilai metrik (badPct, OEE%, coverPct, dst) |
| `detail` | jsonb | Breakdown terstruktur per kategori (lihat §5) |
| `status` | text | `open` / `resolved` (CHECK constraint) |
| `created_at` | timestamptz | Saat pertama dibuat |
| `updated_at` | timestamptz | Saat terakhir di-upsert |
| `resolved_at` | timestamptz | Saat ditutup (manual/auto) |
| `resolution_note` | text | Wajib non-empty bila status = resolved (CHECK) |
| `resolved_by` | text | `system` (auto) atau nama user (manual) |

Tabel pendukung `ews.tts_notification`:

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | bigint identity | PK |
| `issue_key` | text UNIQUE | 1 audio per issue (idempoten) |
| `kpi_type` / `severity` | text | Salinan dari issue |
| `title` / `message` | text | Teks notifikasi & kalimat yang diucapkan |
| `path_mp3` | text | Hasil generate Piper |
| `generation_status` | text | `queued` → … → done/error |
| `attempts`, `error_message` | int/text | Retry & error |
| `played` | boolean | Sudah diputar? |
| `log_audio` | jsonb | Metadata audio |
| `created_at` … `generated_at` | timestamptz | Timeline |

---

## 5. Detail Logic per Kategori Generator

### 5.1 accuracy_machine — Data mesin tidak lengkap

| Aspek | Detail |
|---|---|
| Sumber | Query langsung `public.mch_transaction` |
| Filter window | `startdatetime >= window_start AND < window_end` |
| Kelompok | `GROUP BY machineno` |
| Syarat jadi issue | `HAVING COUNT(*) FILTER (WHERE NOT status_record) >= 5` (ACC_MACHINE_MIN_MISSING) |
| Severity | `badPct >= 50` → critical, else warning. `badPct = round(bad*1000/total)/10` |
| issue_key | `accuracy_machine:{bizDate}:machine:{machineno}` |
| Title | `Data mesin tidak lengkap: {nama}` |
| Description | `{bad} dari {total} record belum lengkap (order/operasi/operator/confirmation) — {badPct}%. Lengkapi input & pastikan jobid benar.` |
| detail jsonb | `{ machineno, machineid, total, bad, bad_pct }` |
| Predikat status_record | Persis sama dengan KPI accuracy_machine |

### 5.2 accuracy_labour — Input timesheet tidak valid

| Aspek | Detail |
|---|---|
| Sumber | Query langsung `public.timesheet_transaction` |
| Filter dasar | `longdate_checkin` di window; `state_flag <> 5` |
| Produktif vs non-produktif | Produktif = `activitytype` kosong (NULL/BTRIM=''). Non-produktif **dikecualikan** |
| Kriteria "bad" | Produktif DAN (order kosong ATAU operation NULL ATAU workcenter kosong ATAU serialnumber kosong ATAU order+operation tidak match `ph3_order`) |
| Match master SAP | `LTRIM(order_no,'0')` kedua sisi + `operation_no` (LTRIM '0' di master) |
| Kelompok | `GROUP BY operator_key` (= serialnumber, fallback 'UNKNOWN') |
| Syarat jadi issue | `HAVING COUNT(bad) >= 3` (ACC_LABOUR_MIN_BAD) |
| Severity | `badPct >= 30` → critical, else warning |
| issue_key | `accuracy_labour:{bizDate}:operator:{operator_key}` |
| Title | `Input timesheet tidak valid: {nama}` |
| detail jsonb | `{ operator_key, total, bad, bad_pct }` |

### 5.3 adoption_machine — Mesin beroperasi tanpa operator (gap)

| Aspek | Detail |
|---|---|
| Sumber | **Baca ulang** detail `kpi_snapshot` → `adoption_machine.detail.per_machine` (TIDAK hitung ulang — mahal) |
| Syarat jadi issue | `gap_minutes >= 15` (ADOPTION_MACHINE_MIN_GAP_MIN) |
| Severity | `cover_pct <= 50` → critical, else warning (cover_pct null → warning) |
| unidentified | `unidentified_minutes` (duration model) atau `unidentified_buckets * 5` (bucket model); ≥ 1 menit disebut di description |
| issue_key | `adoption_machine:{bizDate}:machine:{machine_key}` |
| Description | `{gapH} jam mesin beroperasi tanpa operator teridentifikasi / idle panjang (termasuk {N} menit operator unidentified) — adoption {cover}%. Pastikan operator login timesheet saat mesin berjalan.` |
| detail jsonb | `{ machine_key, gap_minutes, unidentified_minutes, cover_pct }` |
| Catatan | Mendukung 2 model KPI (duration default `EWS_ADOPTION_SOURCE=machine`, atau bucket) |

### 5.4 adoption_labour — Operator kurang jam (progressive target)

| Aspek | Detail |
|---|---|
| Sumber | Baca ulang `adoption_labour.detail.breakdown` dari snapshot |
| Skip | Status roster ∈ `{LEAVE, SICK, PERMIT, OFF}` — bukan gap adopsi |
| Target | **`expected_hours` (progresif "seharusnya sudah tercatat SAMPAI SEKARANG")**, bukan 8 jam penuh. Fallback `standard_hours` hanya bila shift `completed` |
| Guard | `expected_hours` ada tapi ≤ 0 → skip (shift belum mulai, belum ada kewajiban). `expected_hours` tidak ada & belum completed → skip (nilai shift setelah selesai) |
| Syarat jadi issue | `gap = target - recorded >= 1` jam (ADOPTION_LABOUR_MIN_GAP_H) |
| Severity | `pct = recorded/target <= 50` → critical, else warning |
| Shift | `shift` 1/DAY → "shift 1", selain itu "shift 2" |
| issue_key | `adoption_labour:{bizDate}:operator:{key}:s{shift}` |
| Description | `{recorded} jam tercatat dari {target} jam ({expected so far|shift standard}, {shiftLabel}) — kurang {gap} jam ({pct}%). Pastikan operator input timesheet selama shift.` |
| detail jsonb | `{ operator_key, shift, recorded_hours, expected_hours, standard_hours, target_hours, gap_hours, shift_completed }` |
| Catatan desain | Dulu gate `completed` → issue baru lahir 17:00/04:00 (post-mortem, tidak bisa intervensi). Sekarang progresif agar early-warning; MIN_GAP_H=1 jam menekan noise jam awal shift |

### 5.5 oee — OEE rendah (CRITICAL-ONLY)

| Aspek | Detail |
|---|---|
| Sumber | Baca ulang `oee.detail.per_machine` dari snapshot |
| Syarat jadi issue | `oee_pct < 65` (OEE_MACHINE_CRITICAL_PCT) DAN `denominator_hours >= 2` (MIN_HOURS) |
| Severity | **Selalu `critical`** — warning band tidak jadi issue (anti banjir log) |
| Note downtime | Bila `downtime_hours >= 0.5` → description tambah `Terutama Downtime {X} jam.` |
| issue_key | `oee:{bizDate}:machine:{machine_key}` |
| Description | `OEE {oee}% — running {r} jam dari {d} jam terhitung, loss {l} jam. Cek downtime/idle/setup mesin.` |
| detail jsonb | `{ machine_key, oee_pct, running_hours, denominator_hours, loss_hours, downtime_hours }` |

### 5.6 ole — OLE rendah (CRITICAL-ONLY)

| Aspek | Detail |
|---|---|
| Sumber | Baca ulang `ole.detail.per_operator` dari snapshot |
| Syarat jadi issue | `ole_pct < 70` (OLE_OPERATOR_CRITICAL_PCT) DAN `available_hours >= 2` (MIN_HOURS) |
| Severity | **Selalu `critical`** |
| issue_key | `ole:{bizDate}:operator:{operator_key}` |
| Description | `OLE {ole}% — produktif {w} jam dari {a} jam tercatat, non-produktif {n} jam. Kurangi waktu non-produktif / pastikan input order benar.` |
| detail jsonb | `{ operator_key, ole_pct, working_hours, available_hours, nva_hours }` |

### 5.7 uptime_hmi — HMI offline SEKARANG

| Aspek | Detail |
|---|---|
| Sumber | Baca ulang `uptime_hmi.detail.devices` dari snapshot (tanpa query tambahan) |
| Syarat jadi issue | `is_up = false` DAN `down_streak >= 3` (UPTIME_HMI_DOWN_STREAK) |
| Severity | **Selalu `critical`** |
| entity_id | IP device (fallback machineid, fallback 'UNKNOWN') |
| issue_key | `uptime_hmi:{bizDate}:device:{ip}` |
| Description | `Tidak menjawab ping {streak} siklus beruntun — {N} mesin kehilangan HMI ({daftar ≤5 mesin, dll}). Cek power dan jalur jaringan HMI.` |
| detail jsonb | `{ ip, machineids, machine_count, down_streak }` |
| Semantik | Issue = "HMI mati SEKARANG" (dari ping terakhir), bukan rekap sepanjang hari; anti-blip 1 siklus |

Ringkasan cepat:

| Kategori | Entity | Floor | Severity | Critical band | Sumber |
|---|---|---|---|---|---|
| accuracy_machine | machine | ≥5 bad/hari | warn/crit | badPct ≥ 50% | mch_transaction |
| accuracy_labour | operator | ≥3 bad/hari | warn/crit | badPct ≥ 30% | timesheet_transaction |
| adoption_machine | machine | gap ≥ 15 mnt | warn/crit | cover ≤ 50% | snapshot |
| adoption_labour | operator | gap ≥ 1 jam | warn/crit | ≤ 50% target | snapshot |
| oee | machine | ≥ 2 jam denom | **critical** | OEE < 65% | snapshot |
| ole | operator | ≥ 2 jam avail | **critical** | OLE < 70% | snapshot |
| uptime_hmi | device | streak ≥ 3 | **critical** | — | snapshot |

---

## 6. Lifecycle Issue (Upsert → Auto-Resolve → Resolve Manual)

### 6.1 Upsert (UPSERT_SQL)

```sql
INSERT INTO ews.issue_log (issue_key, category, business_date, scope_type, entity_id,
  entity_name, severity, title, description, metric_value, detail, status, updated_at)
VALUES ($1..$11, 'open', now())
ON CONFLICT (issue_key) DO UPDATE SET
  entity_name=EXCLUDED.entity_name, severity=EXCLUDED.severity, title=EXCLUDED.title,
  description=EXCLUDED.description, metric_value=EXCLUDED.metric_value,
  detail=EXCLUDED.detail, updated_at=now()
WHERE ews.issue_log.status = 'open'
RETURNING *, (xmax = 0) AS was_inserted
```

| Perilaku | Keterangan |
|---|---|
| Baris baru | INSERT → `was_inserted = true` → enqueue TTS |
| Masalah masih ada hari ini (baris open) | UPDATE field, `updated_at` refresh, **tidak** enqueue TTS lagi |
| Masalah sudah di-resolve manual tapi masih terdeteksi | `WHERE status='open'` gagal → **tidak** menimpa resolve user; baris resolved tetap, issue besok pakai issue_key baru |

### 6.2 Auto-resolve stale (autoResolveStale)

| Aspek | Detail |
|---|---|
| Kondisi | `status='open' AND business_date < today` |
| Aksi | `status='resolved'`, `resolved_at=COALESCE(resolved_at, now())`, `resolution_note` default `'Auto-resolved: business day rolled over.'` (wajib karena CHECK), `resolved_by='system'`, `detail += {auto_resolved: true, auto_resolved_reason: 'business day rolled over'}` |
| Alasan | Issue = snapshot 1 hari; kalau masih relevan, generator hari ini akan re-raise dengan issue_key baru. `auto_resolved` membedakan close system vs close user (✓) |

### 6.3 Resolve manual (POST resolve)

| Aspek | Detail |
|---|---|
| Syarat | `resolution_note` wajib, min **5** karakter, max **1000** |
| resolved_by | `body.resolved_by` → header `x-user-id` → `'unknown'` (truncate 120) |
| Guard | `WHERE id=$1 AND status='open'` — klik kedua → 409 "already resolved"; id tak ada → 404 |
| Alasan | Endpoint lama cuma flip status tanpa alasan → tidak bisa bedakan close manual vs system |

### 6.4 Read (GET issue-log)

| Param | Default | Perilaku |
|---|---|---|
| `category` | (semua) | filter kolom category |
| `status` | `open` | `all` = tanpa filter status |
| `business_date` | (semua) | `today`/`current` → business day shift-aware (`date_trunc('day', now()-7h)::date`); `YYYY-MM-DD` → tanggal eksplisit |
| Sort | — | open dulu → critical dulu → business_date desc → created_at desc |
| Limit | 300 | batas baris |

---

## 7. TTS Notifier (ewsTtsNotifier.js)

| Aspek | Detail |
|---|---|
| Pemicu | `upsertIssue` → `was_inserted = true` → `enqueueIssueTts` (best-effort, error tidak menggagalkan generate) |
| Filter severity | `ANNOUNCE_SEVERITIES = {'Critical'}` — hanya issue critical yang diumumkan (Watch senyap) |
| Idempoten | `INSERT ... ON CONFLICT (issue_key) DO NOTHING` → 1 audio per issue unik |
| Mode teks | `USE_FULL_ISSUE_TEXT=false` (default) → template; `true` → baca description apa adanya |
| Template kalimat | `Perhatian. Indikator {KPI id} berstatus kritis. {description}. Mohon ditindaklanjuti oleh {pic}.` |
| KPI label ID | uptime_tablet→Uptime Tablet, uptime_hmi→Uptime HMI, accuracy_labour→Akurasi Labour, accuracy_machine→Akurasi Mesin, adoption_labour→Adopsi Labour, adoption_machine→Adopsi Mesin, oee→O E E, ole→O L E |
| Worker | `apps/tts-worker/generate_ews_audio.py` (Piper) mengubah `message` → MP3, `generation_status` queued → … |
| Lokasi edit teks | `makeTemplateSpeech()` di file ini (ditandai `>>> DI SINI TEMPAT MENGUBAH TEKS <<<`) |

Alur: issue baru → insert `ews.tts_notification` (queued) → worker Piper generate MP3 → `played` ditandai saat diputar → UI memutar playlist.

---

## 8. API Endpoints Terkait

| Endpoint | Handler | Fungsi |
|---|---|---|
| `GET .../ews/issue-log` | getIssueLog | List issue (filter category/status/business_date, limit 300) |
| `POST .../ews/issue-log/:id/resolve` | resolveIssueLog | Tutup issue manual (wajib note ≥5 char) |
| `POST .../ews/issue-log/generate` | generateIssueLog | Generate manual (BEGIN→generateAll→COMMIT) |
| `GET .../ews/issue/:issueKey/records` | getIssueRecords | Drill-through culprit rows (READ-ONLY, `ewsIssueDrill.js`, predikat = persis KPI) |
| TTS | getTtsNotifications / markTtsNotificationPlayed / getTtsPlaylist | Daftar & putar audio issue critical hari ini |

---

## 9. Temuan Operasional (Probe 2026-08-10)

| Temuan | Detail |
|---|---|
| Job jalan di BPN | `issue_log` 2.355 baris (2.312 resolved, 43 open); snapshot terbaru 13:57; job interval aktif |
| Job TIDAK jalan di CKP | `ews.issue_log` **0 baris** — generator belum pernah menghasilkan (bedakan dari "tidak ada masalah": tabel kosong = job mati) |
| Kenapa accuracy_machine tidak muncul padahal "ada data critical" | Issue accuracy = per hari (`HAVING bad >= 5`/hari/mesin). Bad akumulasi (mis. M5051CL2 32% = 14.966 dari Jan–Ags) **tersebar**; dalam 7 hari terakhir tidak ada mesin ≥ 5 bad/hari → 0 issue. Terakhir issue accuracy lahir 2026-08-05 (machine 50, warning, auto-resolved) |
| Data transaksi harian BPN | 08-03: 1.953 · 08-04: 2.911 · 08-05: 3.125 · 08-06: 3.582 · 08-07: 3.244 · 08-08: 1.159 · 08-09: 0 · 08-10: 30 (jam 13:57) |
| Open hari ini (08-10) | 43 issue: adoption_labour + ole (critical) — data timesheet/operator, bukan mesin |
| Severity critical nyaris mustahil utk accuracy | Butuh badPct ≥ 50% (machine) / 30% (labour) — selama mayoritas record valid, selalu warning |

---

## 10. Catatan Desain & Pitfall

- **Issue ≠ ticket**: jangan gunakan issue_log sebagai akumulasi temuan lintas hari — itu `autoResolveStale` akan tutup. Untuk tiket permanen gunakan tabel lain.
- **`resolution_note` CHECK**: resolved wajib punya note — auto-resolve harus set `'Auto-resolved: business day rolled over.'` atau UPDATE gagal.
- **`business_date` sebagai text**: sengaja `::text` agar issue_key konsisten; jangan ubah ke date di sisi JS.
- **Kategori critical-only (oee/ole/uptime_hmi)**: warning band sengaja tidak dibuat issue untuk menghindari banjir — kalau mau warning ikut, turunkan/ubah logika `severity = "critical"`.
- **adoption_labour**: jangan kembali ke gate `completed` — itu mengubah early-warning jadi post-mortem (issue baru muncul setelah shift selesai).
- **Threshold sensitifitas**: semua floor (`MIN_MISSING=5`, `MIN_GAP=15mnt/1jam`, `DOWN_STREAK=3`) adalah anti-noise; turunkan bila ingin lebih agresif, naikkan bila log terlalu ramai.
- **Generator baru**: cukup tambah fungsi `generateXxx(exec, bounds)` di `ewsIssueGenerator.js` + daftarkan di `generateAll()`; dedup & lifecycle otomatis menyesuaikan issue_key.
