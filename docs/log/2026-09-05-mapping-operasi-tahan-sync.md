---
type: log
date: 2026-09-05
tags: [domain/msproject, domain/sow]
---

# Mapping operasi SAP tahan sync — implementasi (spec → kode)

Menjalankan [[planning/mapping-operasi-sap-tahan-sync]] (revisi 2026-09-05, keputusan owner
1a 2a 3b 4a). Bug: operasi SAP yang di-map ke task MS Project hilang diam-diam dari picker
reservasi saat sync menonaktifkan task (kasus order 1000131015 op 0070 — `FAB FRAME ASSY`
mati oleh restrukturisasi 3–4 Sep).

## Yang dikerjakan

1. **Tabel `sow_operation_task_map`** (PK `(order_key, operation_key)`, milik PPC, tanpa FK
   task supaya mapping hidup saat task mati). Migration `database/migrations/api/20260905_
   sow_operation_task_map.sql` — **applied manual** ke CKP (1.689 baris backfill) & BPN
   (0 baris, ms_project_task kosong), ledger `schema_migrations` dicatat. Backfill dua
   populasi: sow_id (428 aktif + 40 mati) DAN by-operation_no impor .mpp (1.236 aktif + 21
   mati) — spec asli hanya menghitung populasi sow_id (kontradiksi §6.1 vs §7 dikoreksi:
   backfill sow_id-only akan memangkas picker order kasus dari 19 → 4 baris).
2. **`listOrderTasks`** ganti sumber: daftar operasi dari `sow` (read-only, cermin ETL),
   LEFT JOIN mapping + task aktif, tiap baris ber-`mapping_status` (`READY` | `TASK_LOST` |
   `NEEDS_MAPPING`). Order kasus terverifikasi live: **114 baris = 19 READY + 3 TASK_LOST
   (70/80/150) + 92 NEEDS_MAPPING** — persis target spec.
3. **`mapSowOperationToTask`**: kunci operasi dinormalisasi ke integer (`parseOperationKey`,
   tolak non-integer 400), lookup existing lewat tabel mapping, upsert mapping + stempel
   task dalam satu transaksi. `ORDER_MAPPED_ELSEWHERE` hanya ketika mapping di project lain
   masih menunjuk task AKTIF — task mati bebas dipetakan ulang tanpa takeover. Takeover
   operasi lain di task yang sama membebaskan mapping operasi itu (delete baris).
4. **`syncProject`**: `applyExplicitDeactivate` mengembalikan `deactivated_task_ids`; sync
   melaporkan `orphaned_mappings` (mapping yang task-nya mati) di summary respons + audit.
5. **FE**: ReservationPanel render 3 status — `READY` dicentang (TaskRow), `TASK_LOST` &
   `NEEDS_MAPPING` = BlockedTaskRow (tanpa checkbox, info + tautan map; D2 tidak bocor),
   toggle "Show N unmapped" dengan penghitung. MapSapOperationPage: guard `project_id` null
   (baris unmapped tak dihitung "mapped"), chip amber "Task lost — remap" saat mapping task
   sumbernya mati.

## Keputusan penting

- Mapping = entitas global 1:1 `(order, op)`; kolom task (`order_no`/`operation_no`/`sow_id`)
  tetap di-stempel untuk MSP tapi bukan lagi sumber kebenaran picker.
- 32 task aktif ber-op yang op-nya TIDAK ada di sow hilang dari picker — diinginkan (tak bisa
  write-back headcount ke SAP).
- 147 task summary ber-op dibiarkan (keputusan 4a); index parsial lama
  `uq_ms_project_task_order_op` dibiarkan (hapus di migrasi terpisah setelah terbukti di
  produksi). Komentar basi "index unik hanya per-project" (baris ~1704) hilang bersama
  rewrite `listOrderTasks`.

## Verifikasi

- API lokal (port 3777, DB CKP via tunnel 5441): `GET /ms-project/sow-orders/1000131015/
  tasks` → 114 baris; status 19/3/92; op 70/80/150 TASK_LOST dengan task_id task mati.
- Semantik upsert/delete/status diuji dalam transaksi ROLLBACK (state asli utuh).
- `node --check` msProjectService.js OK; eslint 2 file FE 0 error; `vite build` OK.
- `check_rbac_manifest.js` MASIH GAGAL — 2 write dashboard (DELETE /dashboard/sap-staging-
  exclusion dkk) unmapped, **pra-ada** (bukan dari perubahan ini; tidak ada route baru).
- Gate T0 penuh dijalankan per commit (pre-commit hook terpasang).

## Pending / catatan

- docs/log, docs/planning, database/, scripts/ masih **untracked** di repo (blocker owner
  PLANNING line ~22 — penyaringan sebelum push). Spec, migration, log ini ikut commit
  owner nanti.
- Deploy prod (klon D:/website/MPS) mengikuti proses rilis owner; migrasi sudah di CKP & BPN.
- Uji browser 768×1024 / ±960×600 + UAT scheduler menyusul (spec §7 checklist).
