-- Cegah pemetaan ganda operasi SAP ke satu project MS Project.
--
-- MASALAH YANG DIPERBAIKI (terverifikasi di prod Cikupa 2026-08-04):
-- Order 1000127752 punya 294 operasi di public.sow (dijaga uq_sow_order_operation), tapi
-- 1.176 baris di ms_project_task — SETIAP operasi punya 4 salinan. Rinciannya:
--   contoh project      588 baris = 294 operasi x 2  <-- Map SAP Operation dijalankan DUA KALI
--   Project_Rizka_31.07 294 baris = 294 operasi x 1
--   Test                294 baris = 294 operasi x 1
-- Jarak dua run di 'contoh project' hanya 34 detik (16:08:50 dan 16:09:24).
--
-- AKAR MASALAH: mapSowOrderToProjectTasks (apps/api/services/msProjectService.js) mencari task
-- placeholder yang masih kosong di project target; kalau habis, ia meng-INSERT task baru. Ia
-- TIDAK pernah memeriksa apakah (project_id, order_no, operation_no) itu sudah pernah dipetakan,
-- dan tabelnya tidak punya constraint apa pun untuk itu — satu-satunya UNIQUE yang ada adalah
-- (project_id, task_id) dan PK task_id, yang tidak menghalangi baris kedua.
-- Akibatnya menjalankan ulang mapping = menggandakan seluruh set operasi, dan picker reservasi
-- bay (listOrderTasks) menampilkan tiap operasi berkali-kali.
--
-- PERBAIKAN DATA yang menyertai migrasi ini (sudah dijalankan terpisah, TIDAK di file ini karena
-- bersifat sekali-pakai): 308 baris duplikat DI DALAM project yang sama di-set is_active=false
-- (BUKAN DELETE — ms_project_dependency menunjuk 27 di antaranya, dan seluruh query aplikasi
-- sudah memfilter is_active). Baris yang dipertahankan dipilih dengan urutan: yang dipakai
-- reservasi bay dulu, lalu created_at terlama.
--
-- CATATAN CAKUPAN: index ini hanya mencegah duplikat DI DALAM SATU project. Satu order yang
-- sengaja dipetakan ke BEBERAPA project tetap diizinkan (di prod hari ini 1000127752 ada di 3
-- project, semuanya bernama seperti project uji coba). Membatasi itu adalah keputusan proses,
-- bukan integritas data, jadi tidak dipaksakan di sini — backend hanya memperingatkan.
--
-- ltrim(order_no,'0') dipakai karena SELURUH kodebase mencocokkan order_no dengan cara itu.
-- ltrim(text,text) IMMUTABLE (pg_proc.provolatile='i'), jadi sah sebagai kunci index ekspresional.
-- Partial index: baris non-aktif dan summary sengaja di luar cakupan supaya penonaktifan tetap
-- bisa dipakai sebagai jalur pembersihan.
--
-- Runner (database/migrate.js) UP-ONLY dan membungkus transaksinya sendiri — tanpa BEGIN/COMMIT
-- di sini, dan tanpa CONCURRENTLY (tidak boleh dalam transaksi).

CREATE UNIQUE INDEX IF NOT EXISTS uq_ms_project_task_project_order_op
  ON public.ms_project_task (project_id, ltrim(order_no, '0'), operation_no)
  WHERE is_active
    AND NOT is_summary
    AND order_no IS NOT NULL
    AND operation_no IS NOT NULL;

COMMENT ON INDEX public.uq_ms_project_task_project_order_op IS
  'Satu operasi SAP (order_no, operation_no) hanya boleh dipetakan sekali per project. '
  'Mencegah Map SAP Operation yang dijalankan berulang menggandakan task — lihat migrasi '
  '20260804 dan docs/log/2026-08-04-duplikat-map-sap-operation.md.';

-- ============================================================================================
-- ROLLBACK (MANUAL — runner up-only; JANGAN simpan blok ini sebagai .sql aktif di migrations/api).
--
--   DROP INDEX IF EXISTS public.uq_ms_project_task_project_order_op;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260804_ms_project_task_unique_order_op.sql';
--
-- Membalikkan penonaktifan 308 baris duplikat (kalau memang diinginkan):
--   UPDATE ms_project_task SET is_active = true
--    WHERE is_active = false AND updated_at::date = DATE '2026-08-04';
--   -- PERHATIAN: index unik di atas HARUS di-drop lebih dulu, kalau tidak update ini gagal.
-- ============================================================================================
