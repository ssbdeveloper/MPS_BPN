---
title: Rekonsiliasi ledger migrasi + regenerasi schema_prod dari Cikupa
date: 2026-08-04
tags: [domain/ops, domain/msproject]
---

# Rekonsiliasi ledger migrasi Cikupa + regenerasi schema_prod

Dikerjakan saat menutup [[MFG_PLAN_AREA_PLAN]] Fase 0–6. Terkait
[[2026-07-27-schema-diff-ckp-vs-balikpapan]].

## Yang terjadi

Setelah menerapkan dua migrasi Fase 2/6 ke prod Cikupa, `node database/migrate.js --dry-run`
melaporkan **66 migrasi pending** padahal hampir semua objeknya sudah lama ada di database.
Ledger `public.schema_migrations` hanya berisi **3 entri** untuk **69 file**.

Menjalankan runner apa adanya berbahaya: ia menerapkan semua yang tidak tercatat, berurutan.
Karena itu dua migrasi Fase 2/6 diterapkan lewat runner terbatas (hanya file yang disebut,
perilaku per-file identik: `BEGIN → sql → INSERT ledger → COMMIT`).

## Cara rekonsiliasi

Untuk tiap file pending, objek DDL yang dibuatnya diekstrak (tabel, index, view, matview,
function, kolom, constraint, schema, trigger) lalu dicek keberadaannya di `pg_class`,
`pg_indexes`, `information_schema.columns`, `pg_constraint`, `pg_proc`, `pg_namespace`,
`pg_trigger`. Komentar dibuang lebih dulu supaya DDL di dalam blok ROLLBACK manual tidak
ikut terdeteksi.

Hanya file yang **seluruh** objeknya terverifikasi ada yang dicatat sebagai applied.

**Hasil: ledger 3 → 57 tercatat, pending 66 → 12.** Setiap sisa yang pending sekarang berarti
sesuatu.

## Drift produksi yang tersingkap (12 pending)

Ini temuan nyata, bukan artefak deteksi — masing-masing diverifikasi langsung ke katalog.

### Objek hilang (7 file diterapkan sebagian)

| File | Yang hilang | Dampak |
|---|---|---|
| `20260603_create_ms_project_integration.sql` | 5 trigger `updated_at`: `trg_ms_project_updated_at`, `..._task_`, `..._resource_`, `..._assignment_`, `..._dependency_` | Kolom `updated_at` di tabel inti MS Project **tidak pernah otomatis diperbarui**. Prod punya 16 trigger; yang ada hanya generasi baru (bay_schedule, calendar*, lock, resource_availability) |
| `20260701_create_ews_layer.sql` | `ews.notify_source_changed`, `ews.notify_snapshot_ready` + 2 trigger | Skema `ews` punya **nol function**. Mekanisme NOTIFY realtime EWS tidak jalan |
| `20260510_sow_scheduling.sql` | 5 trigger `updated_at` (shift_definition, sow_schedule, sow_schedule_batch, sow_machine_capacity, sow_overtime_request) | Sama: `updated_at` tidak otomatis |
| `20260515_kanban_order_board_mv.sql` | 4 index matview (`idx_mv_kanban_order_board_*`) | Matview ada tanpa index → query papan Kanban full scan |
| `20260513_create_mch_productiondata_detail_cache.sql` | tabel `mch_productiondata_detail` + 5 index | Tabel cache tidak ada (mungkin sengaja, digantikan matview `mv_mch_productiondata_detail`) |
| `20260525_sow_templates_packages.sql` | kolom `sow_templates.line_order` | Urutan baris template tidak tersimpan |
| `20260503_buffer_transaction_operation_fields.sql` | index `uq_buffer_transaction_machine_order_operation` | Tidak ada penjaga duplikat buffer per (mesin, order, operasi) |

### Belum diterapkan sama sekali (1 file)

- `20260707_ms_project_status_lifecycle.sql` → constraint `chk_ms_project_status` tidak ada.
  Status project MS Project tidak divalidasi di level database.

### Migrasi data — butuh keputusan manusia (4 file)

Keempatnya **terguard/idempoten**, jadi menjalankan ulang tidak menggandakan data:

| File | Bentuk | Catatan |
|---|---|---|
| `20260503_seed_buffer_transaction_from_sow.sql` | `INSERT ... WHERE NOT EXISTS` | Aman diulang |
| `20260503_seed_timesheet_transaction_component_tracking.sql` | `INSERT ... WHERE NOT EXISTS` ×3 | Aman diulang |
| `20260702_update_ews_thresholds_from_detail_spec.sql` | `INSERT ... ON CONFLICT DO UPDATE` | **`ews.kpi_threshold` = 0 baris** → belum pernah jalan. Ambang EWS kosong |
| `20260714_usernfc_normalize_nfcid.sql` | `UPDATE ... WHERE idrow=N AND nfcid='<lama>'` | Terguard nilai lama, no-op setelah diterapkan |

Sengaja **tidak** dicatat sebagai applied: efeknya tidak bisa diverifikasi secara struktural, dan
untuk threshold EWS justru terbukti belum jalan.

## Regenerasi `database/schema/schema_prod.sql`

File lama adalah dump dari **BPN (PostgreSQL 15.15, 69 tabel)** yang lalu ditambal tangan
(+97 baris untuk `sow_sub_operation`). Diregenerasi dari **Cikupa (15.18, 83 tabel)** dengan
`pg_dump --schema-only --no-owner --no-privileges`.

Aman karena Cikupa superset penuh: **0 tabel yang hanya ada di BPN**. Yang bertambah 14, semuanya
generasi baru — `ms_project_*` (11), `sow_sub_operation*` (2), `sow_subcont_mark` (1).

Hasil: 9.442 → 10.306 baris.

## Yang masih pending untuk owner

1. **Jangan jalankan `node database/migrate.js` polos** sampai 12 sisa itu ditinjau — 8 di
   antaranya akan mencoba membuat ulang objek yang sebagian sudah ada.
2. Trigger `updated_at` yang hilang (10 buah lintas MS Project + SOW scheduling) layak dibuat
   ulang lewat migrasi baru yang khusus, bukan dengan menjalankan ulang migrasi lama.
3. Function NOTIFY EWS hilang → cek apakah fitur realtime EWS memang sedang mati.
4. `ews.kpi_threshold` kosong → EWS tidak punya ambang sama sekali.
5. Index matview Kanban hilang → kandidat cepat untuk perbaikan performa.

## Alat

Dua skrip sekali-pakai ditulis di scratchpad sesi (tidak masuk repo): runner migrasi terbatas
dan pemverifikasi ledger. Kalau pola ini mau dipakai lagi, keduanya layak dipindahkan ke
`apps/api/scripts/` — terutama karena `migrate.js` bawaan tidak punya pengaman terhadap ledger
yang drift.
