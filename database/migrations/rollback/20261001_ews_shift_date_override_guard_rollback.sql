-- 20261001_ews_shift_date_override_guard_rollback.sql
-- Rollback untuk 20261001_ews_shift_date_override_guard.sql
-- PERINGATAN: Tabel audit TIDAK di-drop secara destruktif agar riwayat audit tetap terjaga jika diperlukan,
-- melainkan triggers dan fungsi pengaman yang dilepas.

DROP TRIGGER IF EXISTS trg_shift_definition_assert_sow_guard ON public.shift_definition;
DROP FUNCTION IF EXISTS public.shift_definition_assert_sow_guard();

DROP TRIGGER IF EXISTS trg_sow_assert_resolved_shift ON public.sow_overtime_request;
DROP TRIGGER IF EXISTS trg_sow_assert_resolved_shift ON public.sow_schedule_batch;
DROP TRIGGER IF EXISTS trg_sow_assert_resolved_shift ON public.sow_schedule;
DROP TRIGGER IF EXISTS trg_sow_assert_resolved_shift ON public.sow_machine_capacity;
DROP FUNCTION IF EXISTS public.sow_assert_resolved_shift();

DROP FUNCTION IF EXISTS public.ews_sow_blocking_refs(date, bigint[]);

-- Uncomment jika ingin drop tabel audit saat penghapusan total fitur di DB lokal/lab:
-- DROP TABLE IF EXISTS ews.shift_definition_audit;
