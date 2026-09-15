---
type: concept
tags: [lesson, database, metodologi, domain/ops]
updated: 2026-07-11
---

# Pelajaran: Ukur Dulu, Baru Refactor

**Kasus (2026-07-11):** diagnosis awal "DB lemot karena banyak kolom tak terpakai" →
rencana refactor skema besar. Pengukuran nyata membuktikan diagnosis salah total:

- Kolom tak terpakai: **nol** pengaruh ke kecepatan.
- Penyebab nyata: MV kanban **445 MB untuk 2 MB data** (bloat REFRESH CONCURRENTLY),
  ~450 MB index yang lifetime `idx_scan=0` (2 di antaranya duplikat literal index terpanas),
  tabel heartbeat 2,7 jt baris tanpa retention, autovacuum ketinggalan.
- Perbaikan tanpa menyentuh satu kolom pun: **~776 MB kembali** (DB 1,8 GB → 1,26 GB),
  write lebih cepat.

**Prinsip yang menetap:**
1. Keluhan performa → `pg_stat_user_tables/indexes` + `EXPLAIN ANALYZE` dulu, baru rencana.
2. `idx_scan=0` valid hanya bila `stats_reset` tua — cek dulu.
3. Index yang "terlihat berguna" bisa tak pernah dipilih planner (query date-anchored,
   tabel kecil → seq scan menang, ekspresi tak cocok). EXPLAIN adalah hakimnya.
4. Bloat MV: `REFRESH CONCURRENTLY` berulang menggembungkan unique index + TOAST →
   perlu REINDEX periodik.
5. Refactor skema di sistem produksi untuk "kerapihan" = risiko besar, manfaat nol.

**Terhubung:** [[operations/INDEX_AUDIT_2026-07-11]] (bukti lengkap + verdikt per index)

**Asal-usul:** [[log/2026-07-11-refactor-phase1]]
