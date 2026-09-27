-- GUARD: file ini membuat dan MENGHAPUS tabel. Tidak boleh pernah berjalan di
-- database production. Di-include oleh setiap test SQL sebelum DDL apa pun.
--
-- Tiga lapis, sengaja berlebihan:
--   1. nama database production ditolak eksplisit;
--   2. keberadaan tabel production nyata ditolak (menangkap nama DB yang disamarkan);
--   3. hanya database ber-prefix tsc_ / mps2_test yang diizinkan (allowlist).
DO $$
DECLARE
  db text := current_database();
  host text := COALESCE(inet_server_addr()::text, 'local');
BEGIN
  IF db IN ('ptssb', 'postgres', 'ssb_dw') THEN
    RAISE EXCEPTION
      'GUARD: test SQL menolak berjalan di database "%" (host %). Test hanya boleh di DB terisolasi.',
      db, host;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('sap_timesheet_staging', 'plant_config', 'usernfc')
  ) THEN
    RAISE EXCEPTION
      'GUARD: database "%" berisi tabel production — menolak menjalankan test yang melakukan DROP TABLE.',
      db;
  END IF;

  IF db NOT LIKE 'tsc\_%' AND db NOT LIKE 'mps2\_test%' THEN
    RAISE EXCEPTION
      'GUARD: database "%" di luar allowlist (tsc_* / mps2_test*). Buat DB test terpisah dulu.',
      db;
  END IF;

  RAISE NOTICE 'GUARD OK: database test terisolasi "%" (host %)', db, host;
END;
$$;
