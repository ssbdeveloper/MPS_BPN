-- Naikkan keunikan (order_no, operation_no) dari PER-PROJECT jadi GLOBAL.
--
-- Migrasi 20260804 memasang uq_ms_project_task_project_order_op, yang hanya mencegah satu operasi
-- SAP dipetakan dua kali DI DALAM satu project. Itu menutup bug Map SAP Operation yang dijalankan
-- ulang, tapi TIDAK menutup gejala yang sebenarnya dikeluhkan owner: satu order yang dipetakan ke
-- beberapa project membuat picker reservasi bay menampilkan tiap operasi sekali per project, dan
-- scheduler bisa memilih operasi yang sama dua kali tanpa sadar (terjadi nyata: reservasi
-- 83cbb090, order 1000127752, bay A30, operasi 280 dua kali dari project berbeda).
--
-- Keputusan owner 2026-08-04: satu (order_no, operation_no) = SATU task, apa pun project-nya.
-- public.ph3_order TIDAK BOLEH DISENTUH — dan memang tidak disentuh di sini maupun di pembersihan
-- datanya.
--
-- Index lama di-DROP, bukan dibiarkan: keunikan global sudah mencakup keunikan per-project, jadi
-- menyimpan keduanya hanya menambah biaya tulis tanpa jaminan tambahan.
--
-- PEMBERSIHAN DATA yang menyertai (sudah dijalankan terpisah, sekali-pakai): 610 baris duplikat
-- lintas project di-set is_active=false. Aturan pemilihan yang dipertahankan, berurutan:
--   1. task yang sedang dipakai reservasi bay (jangan pernah membuat reservasi menggantung)
--   2. project "pemenang" order itu (paling banyak dipakai reservasi, lalu paling lengkap)
--   3. created_at tertua
-- Dedupe dilakukan per (order, operasi), BUKAN dengan membuang project kalah bulat-bulat —
-- operasi yang hanya ada di project kalah bukan duplikat dan tetap dipertahankan.
-- Hasil: 897 task aktif, 610 nonaktif, 0 duplikat, 0 reservasi menggantung.
--
-- KONSEKUENSI ALUR KERJA: memetakan order yang sudah dipetakan ke project LAIN kini ditolak
-- 409 ORDER_MAPPED_ELSEWHERE oleh mapSowOrderToProjectTasks, kecuali pemanggil mengirim
-- takeover=true (memindahkan pemetaan beserta reservasinya). Tanpa penanganan itu, pemetaan kedua
-- akan gagal dengan 23505 mentah.
--
-- Runner up-only, membungkus transaksinya sendiri: tanpa BEGIN/COMMIT, tanpa CONCURRENTLY.

DROP INDEX IF EXISTS public.uq_ms_project_task_project_order_op;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ms_project_task_order_op
  ON public.ms_project_task (ltrim(order_no, '0'), operation_no)
  WHERE is_active
    AND NOT is_summary
    AND order_no IS NOT NULL
    AND operation_no IS NOT NULL;

COMMENT ON INDEX public.uq_ms_project_task_order_op IS
  'Satu operasi SAP (order_no, operation_no) hanya boleh punya SATU task aktif di seluruh '
  'database — bukan sekadar satu per project. Menegakkan aturan owner "order + operation unik" '
  'yang sudah berlaku di public.sow (uq_sow_order_operation). Lihat '
  'docs/log/2026-08-04-duplikat-map-sap-operation.md.';

-- ============================================================================================
-- ROLLBACK (MANUAL — runner up-only; JANGAN simpan sebagai .sql aktif di migrations/api).
--
--   DROP INDEX IF EXISTS public.uq_ms_project_task_order_op;
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_ms_project_task_project_order_op
--     ON public.ms_project_task (project_id, ltrim(order_no,'0'), operation_no)
--     WHERE is_active AND NOT is_summary AND order_no IS NOT NULL AND operation_no IS NOT NULL;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260804b_ms_project_task_unique_order_op_global.sql';
--
-- Membalikkan penonaktifan 610 baris (index global HARUS di-drop lebih dulu):
--   UPDATE ms_project_task SET is_active = true
--    WHERE is_active = false AND updated_at::date = DATE '2026-08-04';
-- ============================================================================================
