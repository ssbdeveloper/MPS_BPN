-- 20260819_sap_config_rules.sql
-- SAP rules yang diatur dari halaman Configuration Rules:
--   • break_windows  = jam istirahat yang TIDAK dihitung (per hari, hanya record produktif)
--   • max_record_minutes = batas durasi satu record source; lebih dari itu dipotong
-- Disimpan di plant_config.sap_rules (keputusan user 1b). Python staging membaca kolom ini.
-- DOW Postgres: 0=Sunday .. 6=Saturday. Senin=1.

UPDATE public.plant_config
SET sap_rules = jsonb_build_object(
  'break_windows', jsonb_build_array(
    jsonb_build_object('start', '12:00', 'end', '13:00', 'days', jsonb_build_array(1, 2, 3, 4, 5, 6, 0)),
    jsonb_build_object('start', '00:00', 'end', '01:00', 'days', jsonb_build_array(1, 2, 3, 4, 5)),
    jsonb_build_object('start', '18:30', 'end', '19:00', 'days', jsonb_build_array(6, 0)),
    jsonb_build_object('start', '22:00', 'end', '22:30', 'days', jsonb_build_array(6, 0))
  ),
  'max_record_minutes', 90
),
updated_by = 'migration-20260819',
updated_at = now()
WHERE id = 1;

-- Izin aksi rebuild_pending (rebuild antrian PENDING dari tanggal pilihan) di antrian ops worker.
ALTER TABLE public.sap_ops_request
  DROP CONSTRAINT IF EXISTS sap_ops_request_action_ck,
  ADD CONSTRAINT sap_ops_request_action_ck CHECK (
    action IN ('stage_catchup', 'retry_failed', 'post_corrections', 'rebuild_pending')
  );
