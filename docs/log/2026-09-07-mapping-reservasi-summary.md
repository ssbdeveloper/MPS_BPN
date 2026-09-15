---
type: log
date: 2026-09-07
tags: [domain/msproject, domain/sow]
---

# Mapping lanjutan: reservasi boleh nempel di task mana pun (summary/leaf) — jadwal ikut task

Follow-up [[planning/mapping-operasi-sap-tahan-sync]] (revisi 2026-09-07). Gejala user:
op 0070 di-map ulang (drop ke summary FRAME ASSY) tapi jadwal start/finish tidak keambil.

## Akar (diverifikasi ke DB)

Mapping op 70 (remap 2026-09-07 13:58, Tee San) menunjuk task `FAB FRAME ASSY 2.1.2.1.9`
yang DIBUAT sebagai anak virtual dari summary FRAME ASSY (2.1.2.1) — `local_task_uid` NULL
(tidak ada di file .mpp), `plan_start/finish` NULL. Tanggal hanya lahir dari task NYATA di
file yang dijadwalkan MSP; task virtual tidak pernah dapat tanggal. Drop-ke-summary selama
ini diam-diam = "buat anak" (asChild) → anak tanpa tanggal.

## Keputusan owner (1b 2a 3b)

1. **1b**: drop operasi ke node summary → dialog pilihan "Assign to this task" (jadwal ikut
   tanggal rollup summary) vs "Create child task" (tetap ada, eksplisit, tanpa tanggal sampai
   ditambahkan di MSP). Assign ke summary **diizinkan backend** (TARGET_IS_SUMMARY dicabut).
2. **2a**: reservasi task summary ikut tampil di layar operator HANYA jika task punya
   `operation_no` DAN `order_no` (job yang bisa dikonfirmasi ke SAP).
3. **3b**: backfill otomatis — jadwal mengikuti task yang ditempeli op+order.

## Eksekusi

- Backend `msProjectService.js`: (a) `listOrderTasks` READY tanpa kecuali summary (status
  TASK_LOST hanya utk task tidak aktif); (b) dua CTE `msp` (listSowOrders daftar + badge)
  tidak lagi mengecualikan summary — definisi "punya jadwal MSP" = task aktif ber-op
  (leaf/summary); (c) `listBayScheduleTasks` baris task = task aktif dengan order_no +
  operation_no (level apa pun); (d) `mapSowOperationToTask` assign ke summary diizinkan —
  stempel summary HANYA identitas (order/op/ssbr/sow/workcenter), TIDAK menimpa nama WBS &
  planned_work/duration (rollup milik file); delete mapping op tergantikan kini di-guard
  `task_id` (jangan bebaskan mapping op lain yang menunjuk task lain).
- FE `MapSapOperationPage`: `SummaryTargetDialog` (assign vs create-child) saat drop ke node
  ber-anak; drop ke daun langsung assign.
- Migration `database/migrations/api/20260907_sow_operation_task_map_follow_schedule.sql`
  (applied CKP + BPN, ledger dicatat): carrier terbaik per (order,op) = task AKTIF pembawa
  op+order — ber-uid file dulu (leaf, baru summary), orphan hanya kalau tak ada carrier nyata.
  A: mapping sehat (task aktif ber-uid, 1.630) TIDAK disentuh. B: mapping → orphan (35)
  dipindah ke carrier nyata + orphan dinonaktifkan (bila aman). C: TASK_LOST (24) dipindah ke
  carrier aktif nyata. D: op tanpa mapping dgn carrier nyata (98) di-insert.
  Mapping TIDAK pernah dipindah ke orphan (READY tanpa tanggal = masalah sama).
- BPN tidak punya tabel `ms_project_bay_schedule` → statement terakhir migration dibungkus
  DO block + EXECUTE kondisional (`to_regclass`), karena referensi relasi langsung dievaluasi
  saat parse.

## Hasil terukur (CKP, live)

- Op 70 → **FRAME ASSY (2.1.2.1, summary)**: READY, plan 2026-08-18 s/d 2026-09-21 (sebelum:
  task virtual tanpa tanggal). Orphan 2.1.2.1.9 dinonaktifkan.
- Order 1000131015: 114 baris = **24 READY + 0 TASK_LOST + 90 NEEDS_MAPPING** (semua
  TASK_LOST 70/80/150 pulih via carrier summary GENERAL ASSY / INSTALL BODY).
- Global CKP: 1.630 READY-leaf + 120 READY-summary + 33 READY-orphan (tanpa carrier nyata,
  dibiarkan) + 4 TASK_LOST (task mati tanpa carrier aktif — tetap remap manual).
- API lokal: picker/listSowOrders (CTE baru)/listBayScheduleTasks jalan; eslint + build hijau.

## Pending

- Browser 768×1024 / 960×600 + UAT scheduler.
- docs/ & database/ belum ter-commit (blocker penyaringan owner).
