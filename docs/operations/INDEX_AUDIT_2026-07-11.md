---
tags: [domain/ops]
---

# Index & Bloat Audit — 2026-07-11

> Dijalankan terhadap DB **produksi** `ptssb` (via tunnel Tailscale `100.86.231.55:5433`, PostgreSQL 15).
> Konteks: keluhan "database lemot". Kesimpulan: penyebabnya **bloat + index berlebih**, bukan skema/kolom.

---

## 1. Sudah dieksekusi hari ini (disetujui satu per satu)

| Aksi | Sebelum | Sesudah | Hasil |
|---|---:|---:|---|
| DROP 4 index `mv_kanban_order_board` (idx_scan=0) | — | — | −384 MB |
| `VACUUM (ANALYZE) mch_productiondata` | 75.257 dead | 0 dead | statistik segar |
| `REINDEX INDEX CONCURRENTLY uq_mv_kanban_order_board_order_key` | 59 MB | 120 kB | — |
| **`mv_kanban_order_board` total** | **445 MB** | **2,2 MB** | **−443 MB** |

Backup DDL index yang di-drop: `scratchpad/kanban_mv_dropped_indexes_backup.sql`.

Objek terbesar di DB tadinya adalah materialized view 445 MB yang isinya cuma 2 MB data —
sisanya bloat dari `REFRESH ... CONCURRENTLY` berulang. Ini penyebab utama "lemot", bukan kolom.

---

## 2. Koreksi atas analisis awal

Klaim awal: "index search dibuat salah (ekspresi tak cocok), tinggal diperbaiki jadi `LOWER(...)`".
**Klaim itu keliru**, dibuktikan EXPLAIN:

### Bukti A — search timesheet (`validationStats`, `timesheet_transactionController.js:893`)
```
Bitmap Index Scan on idx_ts_longdate_checkin   (26.326 baris rentang tanggal)
  -> Bitmap Heap Scan, Filter: LOWER(serialnumber/full_name/...) LIKE '%x%'
     Rows Removed by Filter: 24.961  -> sisa 1.318
```
Query **selalu di-anchor rentang tanggal** (`longdate_checkin`). `LOWER(...) LIKE` hanya filter sisa
pada subset kecil yang sudah tersaring index tanggal. **Index trigram `full_name`/`serialnumber`
tidak akan pernah dipilih planner — memperbaiki ekspresinya pun tak akan mengubah ini.**

### Bukti B — search SOW (`sowController.js:533`)
```
Seq Scan on sow, Filter: order_no/ssbr_id/part_number/part_name ILIKE '%x%'
Execution Time: 0.634 ms
```
Tabel `sow` cukup kecil → seq scan **lebih cepat** dari index apa pun. Trigram `part_name` percuma.

**Kesimpulan terkoreksi:** index search ini bukan "salah bangun yang perlu diperbaiki" —
**tidak diperlukan** oleh bentuk query & ukuran tabel. Aksi benar = drop, bukan rebuild.

---

## 3. Temuan tajam: index DUPLIKAT dari index terpanas

Dua index `idx_scan=0` ternyata **duplikat definisi** dari index yang paling sering dipakai:

| Index tak terpakai (idx_scan=0) | Duplikat dari (idx_scan) | Definisi |
|---|---|---|
| `idx_timesheet_transaction_order_operation_checkin` | `idx_timesheet_lookup` (**2.508.630**) | keduanya `btree (order_no, operation_no, longdate_checkin)` — **identik** |
| `idx_ts_component_tracking_active` | `idx_timesheet_transaction_workcenter_active` (5) | sama `(workcentercode, longdate_checkout, longdate_checkin DESC)`, versi tak-terpakai hanya nambah `WHERE longdate_checkin IS NOT NULL` |

Duplikat begini **nol manfaat, tapi tiap INSERT/UPDATE harus menulisnya juga** → memperlambat
tulis di tabel payroll terpanas.

---

## 4. Verdikt per index (idx_scan=0, >1 MB)

Semua di bawah `idx_scan=0` seumur hidup DB (`stats_reset` NULL). Drop **tidak mengubah hasil query**,
hanya kecepatan; reversibel (DDL di-backup). Tabel yang lebih besar sudah punya index pengganti yang aktif.

### `timesheet_transaction` (8 index, ~44 MB)
| Index | Size | Verdikt |
|---|---:|---|
| `idx_timesheet_transaction_order_operation_checkin` | 5,3 MB | **Duplikat** `idx_timesheet_lookup` → drop |
| `idx_ts_component_tracking_active` | 11 MB | Duplikat-partial dari `..._workcenter_active` → drop |
| `idx_ts_full_name_trgm` | 9,8 MB | Search date-anchored, tak terpakai → drop |
| `idx_ts_serialnumber_trgm` | 6 MB | Lookup serial pakai btree `idx_ts_serial_checkin` → drop |
| `idx_timesheet_modified` | 5,8 MB | Tak ada query pakai `modified_at` → drop |
| `idx_ts_order_wc` | 2,2 MB | `order_no` sudah dicover composite aktif → drop |
| `idx_ts_state_flag` | 1,7 MB | Selektivitas rendah, planner abaikan → drop |
| `idx_ts_workcentercode` | 1,6 MB | Dicover composite lead-`workcentercode` → drop |

Index aktif yang **dipertahankan** (bukti sudah dipakai): `idx_timesheet_lookup` (2,5jt),
`idx_ts_serial_checkin` (319rb), `idx_ts_longdate_checkin` (824rb),
`idx_timesheet_transaction_order_key_operation_checkin` (456jt), dll.

### `sow` (4 index, ~22 MB)
| Index | Size | Verdikt |
|---|---:|---|
| `idx_sow_part_name_trgm` | 13 MB | Seq scan menang (tabel kecil) → drop |
| `idx_sow_sync_modified` | 5 MB | Partial `sync='modified'` tak terpakai → drop |
| `idx_sow_model` | 2,1 MB | Tak terpakai → drop |
| `idx_sow_part_number` | 1,9 MB | Tak terpakai → drop |

Dipertahankan: `idx_sow_order_key_operation_idsow` (8,9jt), `idx_sow_order_operation_progress` (1,1jt),
`idx_sow_codenumber` (954rb), `uq_sow_order_operation` (689rb), dll.

---

## 5. Rekomendasi

**Drop 12 index (~66 MB) di atas.** Justifikasi kuat: 2 di antaranya duplikat literal index terpanas,
sisanya terbukti tak pernah dipilih planner dengan alasan struktural (query anchored/tabel kecil).
Manfaat: kurangi write-amplification di 2 tabel terpanas (timesheet, sow), bukan sekadar hemat disk.

**Jangan** buat ulang versi "LOWER()" dari trigram — EXPLAIN membuktikan search tak akan memakainya.

SQL (backup DDL sudah tersimpan di `scratchpad/timesheet_sow_dropped_indexes_backup.sql`):
```sql
DROP INDEX IF EXISTS public.idx_timesheet_transaction_order_operation_checkin,
  public.idx_ts_component_tracking_active, public.idx_ts_full_name_trgm,
  public.idx_ts_serialnumber_trgm, public.idx_timesheet_modified,
  public.idx_ts_order_wc, public.idx_ts_state_flag, public.idx_ts_workcentercode;

DROP INDEX IF EXISTS public.idx_sow_part_name_trgm, public.idx_sow_sync_modified,
  public.idx_sow_model, public.idx_sow_part_number;
```

Caveat: `idx_scan=0` = lifetime; kalau ada job periodik yang belum pernah jalan sejak DB hidup,
teoretis bisa butuh salah satunya. Karena drop reversibel & hanya pengaruh kecepatan, risikonya rendah.

---

## 6. Belum dikerjakan (butuh keputusan terpisah)

- **Retention `machine_heartbeat`** — 2,7 juta baris, tumbuh ~20 MB/hari, tanpa penghapusan.
  Butuh tambah `DELETE ... WHERE createddate < now() - interval '90 days'` ke loop
  `jobs/etl/sync_machine_heartbeat.py` (ubah kode + deploy, bukan one-off SQL).
- Sisa temуан besar di [REFACTOR_PLAN.md](../REFACTOR_PLAN.md): secrets di git, auth,
  migration ledger, schema drift. Itu "refactor jadi profesional" yang sebenarnya.
