-- Progress update: simpan snapshot jam aktual + EAC pada saat progress di-update.
--
-- Keputusan owner 2026-09-14 (opsi D): operator bisa merevisi timesheet setelah
-- progress dicatat, jadi jam aktual yang dihitung ulang belakangan TIDAK lagi
-- mencerminkan kondisi saat update dibuat. Dua kolom ini membekukan angka pada
-- saat itu supaya perbandingan antar-update (opsi C) tetap konsisten.
--
--   actual_hours_at_update = SUM(timesheet_transaction.duration) operasi ini
--                            pada saat baris history ditulis (state_flag <> 5, duration > 0)
--   eac_hours_at_update    = actual_hours_at_update / (progress / 100), NULL kalau progress = 0
--
-- Baris lama (tidak ada — tabel kosong di CKP & BPN per 2026-09-14) tetap NULL;
-- konsumen wajib memperlakukan NULL sebagai "tidak ada pembanding".
-- Apply manual ke CKP (5441) & BPN (5434) + catat di schema_migrations.
-- Idempotent: aman dijalankan ulang.

ALTER TABLE public.progress_update_history
  ADD COLUMN IF NOT EXISTS actual_hours_at_update numeric(12,2),
  ADD COLUMN IF NOT EXISTS eac_hours_at_update    numeric(12,2);

-- Dua update terakhir per operasi dibaca di setiap request dashboard.
CREATE INDEX IF NOT EXISTS progress_update_history_operation_recent_idx
  ON public.progress_update_history (operation_id, created_at DESC, id DESC);
