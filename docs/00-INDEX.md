---
tags: [moc, domain/vault]
updated: 2026-07-24
---

# MPS2 — Peta Dokumen (MOC)

> Buka folder `docs/` ini sebagai vault Obsidian. Semua rencana, PRD, dan log keputusan
> hidup di sini, ter-versi git bersama kode. Konvensi: setiap dokumen rencana punya
> frontmatter `status: planning | active | done | parked` (dokumen kerja saja).

## 📌 MULAI DI SINI

**[[PLANNING]]** — papan kerja: sedang dikerjakan / menunggu review / backlog / done.
**[[STATUS]]** — papan status otomatis (Dataview): apa yang active / planning / done / parked.
**[[KONVENSI]]** — aturan main vault ini (4 lapisan, aturan link, cara AI memakainya).

## 🧠 Konsep (memori semantik — pengetahuan yang menetap)

- [[concepts/payroll-data-path]] — jalur data jam kerja → gaji (yang tidak boleh rusak)
- [[concepts/sap-staging-identity]] — kenapa `source_key` rapuh, ZTIMESHEETID menipu, dan segmen adalah jangkar yang benar
- [[concepts/mch-interval-normalization]] — normalisasi interval jam mesin (`end_effective`), guard-hole, constraint anti-overlap — **fitur guard overlapping**
- [[concepts/sap-machine-hours-reconciliation]] — telusuri jam mesin → staging → POSTED, kenapa total UI ≠ CSV SAP, pembulatan SAP tak bisa dipalsukan
- [[concepts/order-no-spine]] — tulang punggung order_no + ssbr_ident, struktur 2 tingkat
- [[concepts/ukur-dulu-baru-refactor]] — pelajaran: diagnosis performa pakai data, bukan asumsi
- [[concepts/ews-roster]] — rotasi 2-kru, roster beku, dan cara `adoption_labour` memakainya
- [[concepts/ews-roster-override]] — lapisan override saat baca: shift-lock, operator nonaktif (`inactive_from`), VIEW `roster_effective`, dan koreksi snapshot beku
- [[concepts/codebase-memory-graph-accuracy]] — batas akurasi graph cbm: handler `exports.X = fn` tak jadi node, CALLS Python cross-file bisa hilang — validasi impact analysis ke sumber

## 🎯 Rencana aktif

> **Status hidup di [[STATUS]]** (board Dataview) — sumber kebenaran. Tabel ini hanya daftar + ringkas.

| Dokumen | Ringkas |
|---|---|
| [[EWS_PLAN]] | **Master plan EWS tunggal** (8 KPI, issue log, drill-through) — 7 dokumen lama dilebur ke sini 2026-07-12 |
| [[REFACTOR_PLAN]] | Refactor besar DB/API/frontend — progres ditandai inline per item |
| [[planning/UI-DEBT]] | Utang design contract yang ada sebelum gate dipasang — gate memeriksa baris yang diubah, bukan file utuh |
| [[planning/API-PERF-BACKLOG]] | Track B — temuan performa backend ditulis di sini, tidak diperbaiki di commit UI |
| [[security/AUTH_RBAC_DESIGN]] | Token auth + RBAC enforcement (A-R1) — menunggu jawaban §7 + §5b |
| [[salvaging/SALVAGE_FLOW_DESIGN]] | Alur salvaging end-to-end: lifecycle 2 tingkat, QC, Quote — menunggu jawaban §10 |

## 📋 PRD

| Dokumen | Ringkas |
|---|---|
| [[prd/manufacturing-variant]] | Varian manufacturing: peta beda vs salvaging, FR-0..8, keputusan terbuka D1–D11 |

## 🗄️ Migration & Database

- [[operations/INDEX_AUDIT_2026-07-11]] — audit index & bloat produksi (bukti + verdikt)
- SQL migration files: `database/migrations/api/` (di luar vault — hanya rencananya yang di sini)
- Rencana migration ledger: [[REFACTOR_PLAN#3.2 Recommendations|D-R1 di REFACTOR_PLAN]]

## 📓 Log keputusan (per sesi kerja)

- **Guard overlapping jam mesin** (baca berurut): [[log/2026-07-22-mch-stuck-blocks]] (detektor blok nyangkut) → [[log/2026-07-22-mch-normalisasi-lapis]] (lapis 1a/1b/2 + hotfix ETL) → [[log/2026-07-23-mch-recompute-scope-guardhole]] (lingkup kandidat + guard-hole) → [[log/2026-07-24-sap-reconciliation-drilldown]] (rekonsiliasi CSV + tab drill-through)
- [[log/2026-07-11-refactor-phase1]] — eksekusi Phase 1+: index drop, D-R3, S-R1, heartbeat
- [[log/2026-07-11-md-cleanup]] — audit .md: 28 dihapus, 20 diisolasi
- [[log/2026-07-12-ews-consolidation]] — 7 dokumen EWS dilebur ke [[EWS_PLAN]]
- [[log/2026-07-14-prd-manufacturing-variant]] — scan 3 lapisan → PRD varian manufacturing
- [[log/2026-08-05-order-pool-due-by-filter]] — pool order reservasi bay: filter "jatuh tempo ≤ akhir minggu ini + belum selesai (tanpa batas bawah)" via param `due_by`
- [[log/2026-08-05-scheduling-area-ux-polish]] — UX: search task di panel reservasi, tab pool jadi segmented control, header (Map date/range/refresh) dirapikan
- [[log/2026-08-05-project-browser-crud]] — CRUD project & task di ProjectBrowserPage: rename project, edit task, delete project (dengan blokir reservasi aktif)
- [[log/2026-08-06-subtask-standard-hours]] — sub-task: bobot dihitung otomatis dari `standard_hours` (share jam per operasi) + cap jam operasi + fix error 42P18 (param beda tipe di recompute)
- [[log/2026-08-06-msproject-hub-rename-delete]] — MS Project Hub: rename project + delete (Delete biasa vs Force Delete yang menghapus reservasi dari area layout + file .mpp fisik)
- [[log/2026-08-06-manufacturing-english-ui]] — full English UI kluster manufaktur (Update Progress, Order List, panel sub-task) + label info berlebihan diringkas/dihapus
- [[log/2026-08-06-msproject-vba-dependency-fix]] — VBA: import dependency predecessor gagal (CallByName + object COM) → panggil .Add langsung; mapping SS/SF sesuai pjTaskLinkType
- [[log/2026-08-06-subtask-upload-template-download]] — tombol download template upload sub-task di modal import (progress-update); template dipindah ke public/templates
- [[log/2026-08-06-project-portfolio-gantt]] — View All Projects dirombak jadi Portfolio Gantt (semua project + expand task tree + badge booking area, klik → map area); CRUD dipindah ke MS Project Hub
- [[log/2026-08-07-msproject-workcenter-resource-names]] — workcenter task = kolom Resource Names MS Project (bukan Notes); resource M5051 Balikpapan tidak dipakai; workcenter Cikupa dari tabel `workcenter` (C5100XX)
- [[log/2026-08-10-ews-issue-log-spesifik]] — analisa & saran issue log EWS lebih spesifik (kolom salah, PIC, cara perbaiki) — **menunggu keputusan user**, jangan coding dulu
- [[log/2026-08-10-ews-issue-log-logic]] — detail lengkap logic EWS issue log dalam tabel: konsep, business day, semua threshold/env, schema, 7 generator, lifecycle upsert/auto-resolve, TTS notifier, API, temuan probe BPN/CKP
- [[log/2026-08-12-bay-schedule-edit]] — edit reservasi bay: tombol Edit di modal detail → ReservationPanel mode EDIT (seed dari detail, exclude diri di occupants, fallback task list) → `PUT /bay-schedules/group/:id`
- [[log/2026-08-19-operations-hub-kpi-cards]] — KPI cards hub diganti: Active vs Total + TECO (dari ph3_order, bukan sow.systemstatus), Machine Productive = status 1+2, Validation Pending = timesheet_transaction hari ini; StatCard modern + animasi count-up
- [[log/2026-08-19-config-rules-break-hours]] — halaman Configuration Rules (`/config-rules`): break hours (4 window, hanya record produktif) + max record duration (90 mnt) di `plant_config.sap_rules`; diterapkan di Python staging (MCH bundling + TIMESHEET IEDZ sintetis); tombol rebuild pending dari tanggal pilihan (aksi ops `rebuild_pending`)
- [[log/2026-08-25-max-record-duration-per-kategori]] — max record duration dipecah jadi 3 rules per kategori (VA/NNVA/NVA), berlaku untuk MCH + TIMESHEET; klasifikasi M1→VA, M2→NNVA, kode numerik→NVA (timesheet: kosong→VA, numerik→NVA); legacy angka tetap diterima
- [[log/2026-08-25-ews-roster-half-day-search-english]] — EWS roster: toggle half-day (eff_std /2 via ews.roster_effective, otomatis ke denominator adoption), search, UI full English, config page full width modern
- [[log/2026-08-25-ews-roster-heatmap-foreman-team]] — EWS roster jadi HEATMAP bulanan (month filter, drag-select bulk edit, warna intensitas jam) + page Foreman Team (drag-drop bawahan ke foreman users-role-foreman, scope My team/All, migration ews.foreman_team)
- [[log/2026-08-13-unknown-order-fix]] — fix false-positive badge "Unknown order": FE beralih ke `order_known` dari backend (EXISTS ke sow/ph3_order), konsolidasi `isUnknownOrder` di constants.js; task area tanpa sow_id tidak lagi salah-positif
- [[log/2026-08-13-scheduling-area-back-fix]] — fix tombol Back detail area tidak kembali ke overview: efek deep-link `?area=` re-fire tiap Back; level diinisialisasi sekali di useState
- [[log/2026-08-13-task-reservation-status]] — panel select tasks menampilkan status reservasi bay per task (area + bay + tanggal) untuk task yang sudah/belum punya reservasi
- [[log/2026-08-13-offline-lan-hardening]] — audit offline (0 dependensi internet runtime setelah TTS pindah ke Piper) + analisa performa LAN (payload 1,1 MB tanpa gzip → gzip 15,7×; DB 9,6 ms bukan bottleneck)
- [[UAT_MANUFACTURING_FULL_CHECKLIST]] — daftar UAT full manufacturing (Cikupa, tanpa machine hours): setup server → API/auth → order pool → bay scheduling → portfolio Gantt → MS Project Hub/VBA → progress sub-task → timesheet tapping → EWS → UAT per role
- [[log/2026-09-01-reconciliation-export-timeout]] — diagnosa + FIX export rekonsiliasi & timesheet validation timeout: query Bundles/day (dashboardController) dari 7 correlated subquery per bundel atas FDW AWS → CTE MATERIALIZED 1 pass (2 hari 300s+ → 2,8s; 30 hari 6,2s; export penuh 13-22s); cap rentang export 62 hari (getexcel + rekonsiliasi); getexcel auto-size di-skip >10rb baris; FE tampilkan pesan error server. Verified end-to-end via API lokal → BPN
- [[log/2026-09-02-sap-log-perf-fase0-1]] — performa SAP Log page: FDW fetch_size 10000+ANALYZE BPN/CKP (5s→0,65s); cast tsnumber dibalik + guard regex di WHERE (Index Only Scan, deterministik); list slim + endpoint detail :id; summary push-down+cache+invalidate; index (werks,status,id DESC) di ssb_dw; DetailDrawer key+error inline. Commit 030901d/c1360a0/3ca20d1
- [[log/2026-09-02-sap-stage-timesheet-worker]] — auto staging TIMESHEET BPN (service sap-stage-ts-worker, cursor mode tiap 15 mnt; backlog 28-08..02-09 bersih, cursor 27-08→02-09, POSTED tetap); backfill 26-08 dibatalkan (seluruh baris excluded reset-1b "posted 26-08"); investigasi CKP (tanpa scheduler TIMESHEET) + anomali 686 (exclusion reset-1b, bukan rebuild). Commit 9b34504
- [[log/2026-09-02-timezone-ckp-env-first]] — timezone CKP: plant_config salah (Makassar utk Cikupa) → resolveTimezone env-first (commit 7eecff8) + UPDATE plant_config CKP ke Asia/Jakarta; deploy BPN (Makassar, tak berubah) + CKP (resolve→Jakarta)
- [[log/2026-09-08-timesheet-unprod1730-header-roster-sitevisit]] — unproductive menu +1730 ADMINISTRATION REPORTING (sebelum OTHERS); header Manufacturing Job Selection menampilkan chip Area/bay (kiri) + Workcenter (kanan) permanen; EWS roster +status SITE_VISIT (excused, setara PERMIT) — FE/API/migration 20260908 (applied CKP+BPN, uji insert rollback)
- [[log/2026-09-14-manufacturing-progress-ui-eac-flag]] — Manufacturing Order Progress: rombak UI (border tegas, progress bar progress-vs-jam, ikon, animasi expand) + flag "Act Hours naik tapi Progress tetap" & lonjakan EAC ≥10% vs update sebelumnya (keputusan owner C+D); migration 20260914 snapshot actual_hours/eac_hours_at_update di progress_update_history (applied CKP+BPN) supaya revisi timesheet tidak menulis ulang histori
- [[log/2026-09-14-rekonsiliasi-end-time-berubah-setelah-posting]] — Rekonsiliasi SAP (SAP Posting Log): "Adjusted End Time" TIMESHEET terpotong padahal cap/break = 0 — sebabnya rumus lama mencampur checkin SEKARANG dengan durasi snapshot; fix end_capped = rules atas record sekarang + kolom baru "Changed After Posting" (BPN 01–08 Sep: 3.886/6.899 bundel berubah ≥1 menit setelah staging, net +234 h); ⚠️ file dashboardController masih memuat ref kolom plant multi-plant yang belum dimigrasi — jangan deploy sebelum migrasi
- [[log/2026-09-14-migrasi-multiplant-fase1-db]] — Migrasi Fase 1 multi-plant DIJALANKAN di AWS (`sap_staging_source` +`plant`, 21.789→37.728 baris, PK exclusion jadi (source_system, plant, source_row_id), trigger posted_at) + BPN/CKP (foreign table +plant, exclusion jadi FOREIGN TABLE, trigger MCH plant-scoped, tercatat di `schema_migrations`); 1.299 exclusion lokal BPN disalin dulu ke AWS plant 5051 sebelum ditabel dibuang; ⚠️ service SAP BPN/CKP MASIH MATI sampai owner deploy kode (jobs + dashboardController.js) via pull + rebuild; backup + angka verifikasi ada di log
- [[log/2026-09-14-forensik-ckp-jalur-posting]] — CKP: jam operator SUDAH masuk SAP lewat jalur langsung `POST /timesheet/post-to-sap` (TimesheetValidationPage, ZTIMESHEETID = ID_TIMESHEET+tsnumber; log_timesheet_sap 15.545 baris s/d 14 Sep, 12.546 cocok dengan timesheet CKP); **cutover 15 Sep dijalankan**: tombol post-to-sap dipensiunkan di UI (default mati, tidak bisa diubah), 12.277 exclusion plant 5100 diisi, cursor TIMESHEET/5100 → 2026-09-15 00:00, `.env` CKP SAP_STAGE_INITIAL_FROM_TS=2026-09-15
- [[log/2026-09-17-mapping-drift-cleanup-dan-optimasi-map]] — Cleanup mapping drift se-DB + optimasi `/sow-scheduling/map`: klasifikasi 62 selisih membuktikan hanya 22 order-drift yang pasti unsafe (40 operation-only adalah mapping legacy valid ke task tanpa operation_no); script fail-closed + backup JSON melepas 22 dalam satu transaksi, verifikasi 0 order drift/2110 mapping tersisa. Exact SAP order kini memakai expression index (median 82 ms, EXPLAIN SOW scan 0.212 ms), broad search dipertahankan, FE meng-abort request lama + sequence guard agar response stale tidak menimpa hasil terbaru; API 77/77, web 104/104, build pass
- [[log/2026-09-17-analisa-unit-tidak-muncul-rock-bucket]] — UNIT tidak muncul di `/sow-scheduling/map` (Rock Bucket): pohon & DB BENAR, yang salah `sow_operation_task_map` — operasi order UNIT 1 dipetakan ke subtree UNIT 2 lewat drop ke daun kosong yang dulu tanpa dialog sama sekali; dua order kembar (part SB10115AC, part_name & 48 ops identik) mustahil dibedakan planner. Fix: `listProjectTasks` mengembalikan `unit_name`/`unit_order_no`, kolom Unit + peringatan beda-unit di semua jalur drop (order dinormalkan zero-pad), dan sync VBA kini melaporkan `mapping_drift` — `upsertTasks` menimpa `order_no` dari Task.Text1 tanpa melihat mapping, sementara `orphaned_mappings` hanya melihat task nonaktif. Guard penolak sengaja TIDAK ditambah: `TARGET_TASK_OCCUPIED` sudah menyala dan tetap di-override. Cleanup lanjutan selesai: 22 order-drift dilepas se-DB; 40 operation-only legacy sengaja dipertahankan (lihat log cleanup berikutnya)
- [[log/2026-09-17-subtask-progress-500-sap-auto]] — Sub-task progress update 500 (22P02 `invalid input syntax for type integer: "sap-auto"`): resolver nama di `getSubtasks` mengecast `created_by::int` dengan penjaga regex di JOIN yang sama, planner mengevaluasi cast lebih dulu → SEMUA panel sub-task kosong; fix bandingkan sebagai teks (`cu.id::text = s.created_by`), panel tidak lagi dikosongkan saat refresh gagal (banner "showing last known data"), `progress_pct` dari payload hierarki dinormalkan ke `progress`; +contract test anti-regresi
- [[log/2026-09-20-heatmap-roster-ui-dan-payload]] — Heatmap EWS roster: palet pastel (izin/sakit/cuti amber + kode S/L/P dipisah dari Absent merah), stripe shift dibuang, legenda dipecah Kehadiran/Shift dan dinaikkan, mode mingguan sel 44px untuk tablet, penanda hari ini + pemisah minggu, aktivasi tap/Enter/Space + `aria-label` penuh; FIX `BulkPanel` membaca `rowsByKey[key]` padahal halaman mengirim `Map` (detail operator tak pernah tampil) dan pergantian bulan kini abort + sequence guard. Pengukuran produksi membantah dugaan SQL lambat: `EXPLAIN ANALYZE` 70,3 ms dengan Index Scan — 4-9 detik itu transfer baris (link ~85 KB/s pada payload 1 MB), jadi endpoint dirampingkan: `operator_name`/`shift_locked`/`fixed_shift`/`completed` dibuang dari baris (tak satu pun dibaca FE), nama dikirim sekali di `meta.operators`; 4.239 ms → 2.758 ms, gzip 33 KB → 23 KB. API 77/77, web 137/137, eslint + build pass

## 📚 Operasional

- [[operations/cheatsheet]] — cheatsheet operasional
- `Work Instruction/` — instruksi kerja
- `sap/` — dokumentasi SAP aktif

## 🗃️ Arsip & Isolasi

- [[_isolasi/README|_isolasi/]] — 20 file historis kandidat hapus (deadline keputusan: 2026-09-01)
- `archive/` — sisa arsip (VBA .bas lama, dll). Catatan: `archive/mpsobsidian/cheatsheet.md` masih aktif diedit — kandidat merge ke `operations/cheatsheet.md`
