-- Kolom pembeda produktif vs unproductive, supaya posting bisa difilter
-- (mis. kirim massal yang produktif dulu, tunda unproductive yang masih ditolak SAP
--  dengan "Enter activity type only in conjunction with cost center").
--
-- GENERATED, bukan kolom biasa: nilainya selalu turun dari zconf_type, jadi tidak
-- mungkin drift. M1 = produktif (value-added), M2 = produktif (setup), sisanya
-- unproductive (LSTAR terisi, RUECK/ZCONF_TYPE/AUFNR/VORNR kosong).

ALTER TABLE public.sap_timesheet_staging
  ADD COLUMN IF NOT EXISTS is_productive boolean
  GENERATED ALWAYS AS (zconf_type IN ('M1', 'M2')) STORED;

COMMENT ON COLUMN public.sap_timesheet_staging.is_productive IS
  'TRUE bila zconf_type M1/M2 (konfirmasi order). FALSE = alokasi aktivitas (LSTAR).';

CREATE INDEX IF NOT EXISTS idx_sap_staging_productive_status
  ON public.sap_timesheet_staging (is_productive, status);
