---
title: Diff schema ckp vs balikpapan (ptssb) + rencana sinkronisasi
date: 2026-07-27
tags: [domain/ops, domain/timesheet]
---

# Diff schema vm-linux-ckp vs svr-balikpapan (ptssb)

Tujuan user: **samakan schema `ptssb` di vm-linux-ckp (Cikupa) dengan svr-balikpapan**,
sadar ada beberapa objek yang balikpapan belum punya (ternyata = subsistem ms_project di ckp).
Keputusan arah: **diff dulu, putuskan per-objek** (jangan auto-apply).

## Akses (via Tailscale SOCKS5)

- **svr-balikpapan** = `100.101.215.16:5433` (BUKAN .17, bukan port 5432). Host Windows.
- **vm-linux-ckp** = `100.80.101.53:5433` (Ubuntu). Flapping — sempat offline saat sesi.
- Kedua app DB: database `ptssb`, user `tag` + **password prod** (`.env` `DB_PASSWORD`).
- Tunnel lokal saat analisis: balikpapan→5439, ckp→5441, prod→5434.
- **ckp: `tag` = SUPERUSER**; DB **live** (86.884 timesheet, 70.280 sow, 224 usernfc, 3 ms_project).
- Catatan: **prod (vm-linux-bpn) == balikpapan** identik di level jumlah objek — balikpapan tidak
  ketinggalan dari prod.

## Ringkasan divergensi (bidireksional)

| Jenis | balikpapan | ckp |
|---|---|---|
| TABLE | 101 | 63 |
| VIEW | 20 | 13 |
| MATVIEW | 6 | 0 |
| FUNCTION (total) | 269 | 37 |
| FUNCTION (user, non-extension) | 14 | 1 |
| SEQUENCE | 68 | 45 |
| INDEX | 359 | 247 |
| CONSTRAINT | 268 | 194 |
| Extensions | btree_gist, pg_trgm, pgcrypto, plpgsql | pgcrypto, plpgsql |

Gap function 269→37 **menyesatkan**: ~232 di antaranya milik extension `btree_gist`/`pg_trgm`
(gbt_*, *_dist, dll). User-function riil hanya beda 13.

## A. ckp KURANG (perlu ditambahkan dari balikpapan)

**Extensions (pasang duluan — `tag` superuser, aman):** `btree_gist`, `pg_trgm`.

**Modul/tabel utuh yang hilang di ckp (42 tabel riil, di luar 7 `backup.*`):**
- **EWS** (schema `ews.*`, ~18 tabel + 9 sequence + 1 view): action_table/history, kpi_snapshot,
  kpi_threshold, adoption_*, shift_roster, operator_shift*, rotation_config, tts_notification,
  alert_log, issue_log, activity_type_ref, machine_heartbeat_daily, device_heartbeat_daily,
  roster_workday_rule, operator_rotation_group.
- **Machine hours** (`public.mch_*`): mch_productiondata, mch_transaction, mch_transaction_override,
  mch_machines, mch_statustypes, mch_machine_ping_log.
- **SAP staging** (`public.sap_*`): sap_timesheet_staging, sap_staging_source, sap_stage_cursor,
  sap_ops_request, sap_source_change_blocked, sap_staging_eligibility_audit.
- **tools_management** (schema, 7 tabel + 4 view + 7 sequence): tools, reservations, handover_logs,
  transactions, tool_categories, tool_conditions, tool_status_logs.
- **RBAC**: `rbac.user_permissions`.
- **Lain**: `public.schema_migrations` (ckp TIDAK di sistem migrasi!), `device_status`,
  `sow_operation_status`, `sow_verification_log`.

**Matview (6):** mv_kanban_order_board, mv_order_activity_detail, mv_order_plan_vs_actual,
mv_order_remaining_hours, mv_mch_productiondata_detail, `order`.

**User function (13, semua trigger/util):** set_modified_at, update_updated_at_column,
update_modified_column, refresh_mv_kanban_order_board, mch_transaction_freeze_posted,
mch_transaction_invalidate_pending_bundles, sap_staging_mark_segments_posted,
generate_remaining_hours_notifications, fn_delete_dup_sow, trg_set_sync_modified,
set_sow_scheduling_updated_at, update_nnva_updated_at, tools_management.set_updated_at.

**Kolom yang hilang di tabel bersama:**
- `sow.source_op_id` (bigint)
- `sow_documentno.revision_date` (date), `sow_documentno.revision_no` (varchar)
- `usernfc.inactive_from` (date)

**Nullability lebih ketat di balikpapan (butuh data bersih dulu sebelum di-enforce):**
- `consumable_stock.material_code` NOT NULL (ckp nullable)
- `mch_user.operatorid`, `mch_user.sn_employee` NOT NULL (ckp nullable)
- `usernfc.snssb` NOT NULL (ckp nullable)

## B. ckp PUNYA, balikpapan TIDAK ("beberapa yang balikpapan belum punya")

Subsistem **ms_project calendar/scheduling** (11 tabel + 48 index + 51 constraint):
ms_project_calendar(+exception/weekday/working_time/exception_time), ms_project_resource_availability,
ms_project_revision, ms_project_publish, ms_project_lock, ms_project_bay_schedule,
ms_project_audit_log. Plus kolom tambahan di tabel bersama: `ms_project.*` (calendar_id, file_*,
project_status, checked_out_*, dll — 14 kolom), `ms_project_task` (calendar_id, calendar_name,
ignore_resource_calendar), `ms_resource` (calendar_id, calendar_name). Plus index performa ekstra
di tabel bersama (idx_sow_model, idx_timesheet_modified, idx_ts_*, dll).

**Default: dipertahankan** (balikpapan/prod belum punya; ini fitur lokal ckp). Risiko: kalau nanti
repo menambah subsistem ms_project calendar versi berbeda, bisa bentrok.

## Rencana eksekusi (usulan — belum dieksekusi)

1. **Konfirmasi lingkup per modul** — belum tentu Cikupa butuh semua (EWS? machine-hours SQL Server?).
2. **Extensions dulu**: `CREATE EXTENSION btree_gist; CREATE EXTENSION pg_trgm;` di ckp.
3. **Ekstrak DDL per modul dari balikpapan** (`pg_dump --schema-only` terfilter per schema/tabel),
   review, apply berurutan (schema → sequence → table → index → constraint → function → view → matview).
   Bukan repo-migrations mentah karena ckp tak pernah di ledger & sudah diverge.
4. **Kolom bersama**: `ALTER TABLE ADD COLUMN` aditif. Nullability NOT NULL hanya setelah data bersih.
5. **Pertahankan** subsistem ms_project ckp kecuali user minta lain.
6. Opsional: pasang `schema_migrations` + backfill supaya ckp masuk ledger.
7. **Semua write ke ckp (DB live) butuh konfirmasi eksplisit per statement.**

## HASIL EKSEKUSI 2026-07-27 (DONE — applied ke ckp)

Lingkup dipilih user: **EWS + SAP staging + tools/RBAC/matview/kolom**. Machine-hours (`mch_*`)
**di-skip** (tak relevan Cikupa). Semua apply pakai `psql --single-transaction -v ON_ERROR_STOP=1`
(atomik per modul, rollback bila gagal). ckp DB live — perubahan aditif.

Terpasang di ckp:
- **Extensions**: btree_gist, pg_trgm.
- **Kolom bersama** (aditif nullable): sow.source_op_id, sow_documentno.revision_date/revision_no,
  usernfc.inactive_from. (Harus dulu — view `ews.roster_effective` butuh usernfc.inactive_from.)
- **EWS** (`ews.*`): 18 tabel, 1 view, 9 sequence. Cocok balikpapan.
- **tools_management**: 7 tabel + 4 view + function set_updated_at.
- **rbac.user_permissions** (FK public.users — sudah ada di ckp, 29 baris).
- **SAP staging**: 6 tabel + trigger function public.sap_staging_mark_segments_posted.
- **misc public**: schema_migrations, device_status, sow_operation_status, sow_verification_log.
- **9 function public** (trigger/util): set_modified_at, update_updated_at_column, update_modified_column,
  refresh_mv_kanban_order_board, generate_remaining_hours_notifications, fn_delete_dup_sow,
  trg_set_sync_modified, set_sow_scheduling_updated_at, update_nnva_updated_at.
- **2 view public**: v_sow_order_progress, vw_sow_operation_actual.
- **5 matview** (WITH NO DATA lalu REFRESH sukses): mv_kanban_order_board, mv_order_activity_detail,
  mv_order_plan_vs_actual, mv_order_remaining_hours, `order`.
- **7 index/constraint tabel bersama** (index `CONCURRENTLY`, non-blocking): idx_consumable_stock_description_trgm,
  idx_sow_schedule_batch_id, idx_sow_schedule_date, idx_sow_source_op_id, idx_ts_order_no_trgm,
  ix_usernfc_inactive_from, unique consumable_stock_material_code_key (tabel kosong).

State akhir ckp: 99 tabel, 5 matview, 20 view, 67 sequence. Schemas: public, ews, rbac, tools_management.
Diff sisa = HANYA objek yang sengaja di-skip (mch_* + backup.*) + 1 item terblokir data (di bawah).

## Update 2026-07-27 (lanjutan — data Cikupa dummy, aman dedup)

- **`uq_sow_standard_component_operation` DONE** — user konfirmasi data ckp masih dummy. Dedup
  sow_standard: 735→653 baris (hapus 82 non-keeper, simpan min(id) per grup; 3 tabel anak
  sow_nnva_standard/sow_standard_attachments/sow_template_lines tak refer ke non-keeper — aman),
  lalu UNIQUE index dibuat. Lingkup terpilih kini 100% sinkron (diff non-mch/non-backup = kosong).

## Update 2026-07-27 (final — PARITY PENUH tercapai)

User minta schema identik penuh; konfirmasi **tambah mch juga**, **backup.* TIDAK**. Data ckp dummy.

Terpasang tambahan:
- **mch** (full): 6 tabel (mch_productiondata, mch_transaction, mch_transaction_override, mch_machines,
  mch_statustypes, mch_machine_ping_log) + 2 function trigger + mv_mch_productiondata_detail (refresh) + index.
  mch tabel kosong (belum ada ETL SQL Server Cikupa).
- **Unique index tabel bersama** (dedup data dummy dulu): mch_user dedup by operatorid 80→53 baris
  (hapus 27 non-keeper via ctid; tak ada FK masuk), lalu `uq_mch_user_operatorid`; `uq_mch_user_sn_employee`.
- **Enforce NOT NULL** cocok balikpapan: consumable_stock.material_code, mch_user.operatorid,
  mch_user.sn_employee (null ikut terhapus saat dedup), usernfc.snssb (hapus 1 baris null-snssb; delete
  sukses = tak dirujuk timesheet/consumable_ticket).

**HASIL: diff objek & diff NOT NULL vs balikpapan = KOSONG** (di luar backup.*). ckp = 105 tabel, 6 matview,
20 view, 68 sequence. Satu-satunya beda tersisa (by design):
- **ms_project** (11 tabel calendar) — extras ckp, DIPERTAHANKAN (balikpapan/prod tak punya).
- **backup.* (7 tabel snapshot)** — sengaja tak direplikasi.

## Catatan lanjutan (bukan blocker)
- ckp punya `schema_migrations` (dari misc) tapi **belum di-backfill** — belum benar-benar masuk sistem
  migrasi. Keputusan terpisah kalau mau ckp ikut `node database/migrate.js`.
- mch tabel di ckp kosong; butuh ETL/sumber SQL Server per-plant kalau Cikupa benar-benar pakai machine-hours.
