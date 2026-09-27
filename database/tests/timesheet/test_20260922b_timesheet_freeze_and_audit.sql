-- Test Fase B: freeze staging (monotonic) + audit ledger append-only + cutoff.
--
-- BUKAN migration: file ini melakukan DROP TABLE dan hidup di database/tests/.
-- Jangan pernah letakkan di database/migrations/api/ — runner menjalankan setiap
-- .sql di folder itu.
--
-- Freeze TIDAK diisi manual di sini. Test memanggil public.timesheet_mark_staged()
-- — jalur yang sama dengan yang dipakai stager — dan menguji backfill dari
-- sap_staging_source / sap_staging_exclusion. Mengisi tabel freeze dengan tangan
-- hanya akan menguji fixture, bukan mekanismenya.
\set ON_ERROR_STOP on

\i D:/MPS2/database/tests/timesheet/_guard_not_production.sql

-- ---------- fixture ----------
DROP TABLE IF EXISTS public.timesheet_correction_audit;
DROP TABLE IF EXISTS public.timesheet_staging_freeze;
DROP TABLE IF EXISTS public.timesheet_staging_outbox;
DROP TABLE IF EXISTS public.timesheet_transaction;
DROP TABLE IF EXISTS public.plant_config;
DROP TABLE IF EXISTS public.sap_staging_source;
DROP TABLE IF EXISTS public.sap_staging_exclusion;

CREATE TABLE public.plant_config (
  id integer PRIMARY KEY DEFAULT 1,
  plant_code text NOT NULL,
  timezone text
);
INSERT INTO public.plant_config (id, plant_code, timezone)
VALUES (1, '5100', 'Asia/Jakarta');

CREATE TABLE public.timesheet_transaction (
  tsnumber integer PRIMARY KEY,
  serialnumber text,
  plant text,
  activitytype text,
  state_flag smallint,
  order_no text,
  operation_no integer,
  workcentercode text,
  confirmationnumber text,
  note text,
  date_checkin text,
  hour_checkin text,
  date_checkout text,
  hour_checkout text,
  longdate_checkin timestamptz,
  longdate_checkout timestamptz,
  duration numeric
);

-- Provenance palsu (bentuk sama dengan foreign table production).
CREATE TABLE public.sap_staging_source (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staging_id bigint,
  source_system text,
  source_row_id text,
  bucket_start timestamptz,
  seconds bigint,
  posted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  plant text
);
CREATE TABLE public.sap_staging_exclusion (
  source_system text,
  plant text,
  source_row_id text,
  excluded_by text,
  excluded_at timestamptz DEFAULT now(),
  note text
);

INSERT INTO public.timesheet_transaction
  (tsnumber, serialnumber, plant, order_no, longdate_checkin, longdate_checkout, duration)
VALUES
  (201, 'OP1', '5100', 'O1', '2026-09-20 08:00:00+07', '2026-09-20 12:00:00+07', 4.00),
  (203, 'OP2', '5100', 'O2', '2026-09-20 08:00:00+07', '2026-09-20 16:00:00+07', 8.00),
  (204, 'OP3', '5100', 'O3', '2026-09-20 08:00:00+07', '2026-09-20 12:00:00+07', 4.00),
  (205, 'OP4', '5100', 'O4', '2026-09-20 08:00:00+07', '2026-09-20 12:00:00+07', 4.00);

-- Provenance yang sudah ada SEBELUM migration: harus ikut ter-backfill.
INSERT INTO public.sap_staging_source (source_system, source_row_id, plant, seconds)
VALUES
  ('TIMESHEET', '203', '5100', 28800),
  ('TIMESHEET', '201', '5051', 28800); -- tsnumber 201 milik plant 5051 di central, BUKAN plant 5100!

INSERT INTO public.sap_staging_exclusion (source_system, plant, source_row_id, excluded_by)
VALUES
  ('TIMESHEET', '5100', '205', 'admin'),
  ('TIMESHEET', '5051', '204', 'admin'); -- tsnumber 204 milik plant 5051 di central

\i D:/MPS2/database/migrations/api/20260922_timesheet_derived_time_contract.sql
\i D:/MPS2/database/migrations/api/20260922b_timesheet_freeze_and_audit.sql

\echo '--- F0 cross-plant isolation: provenance plant lain TIDAK membekukan record lokal ---'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.timesheet_staging_freeze WHERE tsnumber = 201) THEN
    RAISE EXCEPTION 'F0 GAGAL: tsnumber 201 milik 5051 ikut membekukan record lokal 5100';
  END IF;
  RAISE NOTICE 'F0 LULUS: provenance plant lain diabaikan secara aman';
END $$;


\echo '--- F1 record belum staging: koreksi diizinkan dengan context ---'
DO $$
DECLARE r record;
BEGIN
  PERFORM set_config('mps.correction_actor', 'admin', true);
  PERFORM set_config('mps.correction_reason', 'koreksi pre-staging jam checkout', true);
  UPDATE public.timesheet_transaction
  SET longdate_checkout = '2026-09-20 13:00:00+07'
  WHERE tsnumber = 201;
  SELECT * INTO r FROM public.timesheet_transaction WHERE tsnumber = 201;
  IF r.hour_checkout <> '13:00' THEN
    RAISE EXCEPTION 'F1 GAGAL: koreksi pre-staging tidak tersinkron (%)', r.hour_checkout;
  END IF;
  RAISE NOTICE 'F1 LULUS: koreksi pre-staging berhasil';
END $$;

\echo '--- F1b direct SQL perubahan payroll tanpa context DITOLAK ---'
DO $$
DECLARE blocked boolean := false;
BEGIN
  PERFORM set_config('mps.correction_actor', '', true);
  PERFORM set_config('mps.correction_reason', '', true);
  BEGIN
    UPDATE public.timesheet_transaction
    SET longdate_checkout = '2026-09-20 14:00:00+07'
    WHERE tsnumber = 201;
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'F1b GAGAL: update payroll tanpa context diterima'; END IF;
  RAISE NOTICE 'F1b LULUS: direct SQL perubahan payroll tanpa context ditolak';
END $$;

\echo '--- F2 backfill membekukan row dari sap_staging_source ---'
DO $$
DECLARE blocked boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.timesheet_staging_freeze WHERE tsnumber = 203) THEN
    RAISE EXCEPTION 'F2 GAGAL: backfill provenance tidak membekukan 203';
  END IF;
  BEGIN
    UPDATE public.timesheet_transaction
    SET longdate_checkout = '2026-09-20 18:00:00+07' WHERE tsnumber = 203;
  EXCEPTION WHEN integrity_constraint_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'F2 GAGAL: row hasil backfill masih bisa diubah'; END IF;
  RAISE NOTICE 'F2 LULUS: backfill sap_staging_source membekukan row';
END $$;

\echo '--- F3 backfill membekukan row dari sap_staging_exclusion ---'
DO $$
DECLARE blocked boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.timesheet_staging_freeze WHERE tsnumber = 205) THEN
    RAISE EXCEPTION 'F3 GAGAL: row excluded tidak ikut dibekukan';
  END IF;
  BEGIN
    UPDATE public.timesheet_transaction
    SET longdate_checkout = '2026-09-20 18:00:00+07' WHERE tsnumber = 205;
  EXCEPTION WHEN integrity_constraint_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'F3 GAGAL: row excluded masih bisa diubah'; END IF;
  RAISE NOTICE 'F3 LULUS: exclusion tetap membekukan (exclusion hanya soal emit ke SAP)';
END $$;

\echo '--- F4 timesheet_mark_staged membekukan lewat jalur stager ---'
DO $$
DECLARE blocked boolean := false;
BEGIN
  PERFORM public.timesheet_mark_staged(ARRAY[204]::integer[], '5100', 'PENDING', 'uji stager');
  BEGIN
    UPDATE public.timesheet_transaction
    SET longdate_checkout = '2026-09-20 15:00:00+07' WHERE tsnumber = 204;
  EXCEPTION WHEN integrity_constraint_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'F4 GAGAL: mark_staged tidak membekukan'; END IF;
  RAISE NOTICE 'F4 LULUS: freeze terjadi lewat jalur stager, bukan isian manual';
END $$;

\echo '--- F5 mark_staged monotonic: tidak menimpa freeze yang ada ---'
DO $$
DECLARE t1 timestamptz; t2 timestamptz; st text; st2 text;
BEGIN
  SELECT frozen_at, first_seen_status INTO t1, st
  FROM public.timesheet_staging_freeze WHERE tsnumber = 204;

  PERFORM pg_sleep(0.05);
  PERFORM public.timesheet_mark_staged(ARRAY[204]::integer[], '5100', 'POSTED', 'panggilan kedua');

  SELECT frozen_at, first_seen_status INTO t2, st2
  FROM public.timesheet_staging_freeze WHERE tsnumber = 204;

  IF t2 IS DISTINCT FROM t1 THEN
    RAISE EXCEPTION 'F5 GAGAL: frozen_at tertimpa (% -> %)', t1, t2;
  END IF;
  IF st2 IS DISTINCT FROM st THEN
    RAISE EXCEPTION 'F5 GAGAL: first_seen_status tertimpa (% -> %)', st, st2;
  END IF;
  RAISE NOTICE 'F5 LULUS: freeze monotonic, status pertama dipertahankan';
END $$;

\echo '--- F6 semua status staging mengunci, bukan hanya POSTED ---'
DO $$
DECLARE
  st text; ts_id integer; idx integer := 0; blocked boolean;
BEGIN
  FOREACH st IN ARRAY ARRAY['PENDING','FAILED','SKIPPED','POSTED'] LOOP
    idx := idx + 1;
    ts_id := 300 + idx;
    INSERT INTO public.timesheet_transaction
      (tsnumber, serialnumber, plant, order_no, longdate_checkin, longdate_checkout)
    VALUES (ts_id, 'OPX', '5100', 'OX', '2026-09-20 08:00:00+07', '2026-09-20 09:00:00+07');

    PERFORM public.timesheet_mark_staged(ARRAY[ts_id]::integer[], '5100', st, NULL);

    blocked := false;
    BEGIN
      UPDATE public.timesheet_transaction
      SET longdate_checkout = '2026-09-20 10:00:00+07' WHERE tsnumber = ts_id;
    EXCEPTION WHEN integrity_constraint_violation THEN blocked := true;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'F6 GAGAL: status % tidak mengunci', st; END IF;
    RAISE NOTICE 'F6 LULUS: status % mengunci sumber', st;
  END LOOP;
END $$;

\echo '--- F7 DELETE record yang pernah staging ditolak ---'
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    DELETE FROM public.timesheet_transaction WHERE tsnumber = 203;
  EXCEPTION WHEN integrity_constraint_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'F7 GAGAL: record staged bisa dihapus'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.timesheet_transaction WHERE tsnumber = 203) THEN
    RAISE EXCEPTION 'F7 GAGAL: record hilang';
  END IF;
  RAISE NOTICE 'F7 LULUS: DELETE record staged ditolak';
END $$;

\echo '--- F8 DELETE record belum staging boleh dengan context ---'
DO $$
BEGIN
  PERFORM set_config('mps.correction_actor', 'admin', true);
  PERFORM set_config('mps.correction_reason', 'hapus record uji coba', true);
  INSERT INTO public.timesheet_transaction
    (tsnumber, serialnumber, plant, order_no, longdate_checkin, longdate_checkout)
  VALUES (399, 'OPZ', '5100', 'OZ', '2026-09-20 08:00:00+07', '2026-09-20 09:00:00+07');
  DELETE FROM public.timesheet_transaction WHERE tsnumber = 399;
  RAISE NOTICE 'F8 LULUS: record belum staging bisa dihapus dengan context';
END $$;

\echo '--- F8b DELETE record belum staging tanpa context DITOLAK ---'
DO $$
DECLARE blocked boolean := false;
BEGIN
  PERFORM set_config('mps.correction_actor', '', true);
  PERFORM set_config('mps.correction_reason', '', true);
  INSERT INTO public.timesheet_transaction
    (tsnumber, serialnumber, plant, order_no, longdate_checkin, longdate_checkout)
  VALUES (398, 'OPZ', '5100', 'OZ', '2026-09-20 08:00:00+07', '2026-09-20 09:00:00+07');
  BEGIN
    DELETE FROM public.timesheet_transaction WHERE tsnumber = 398;
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'F8b GAGAL: DELETE tanpa context diterima'; END IF;
  RAISE NOTICE 'F8b LULUS: DELETE tanpa context ditolak';
END $$;

\echo '--- F9 direct SQL pada record frozen tidak mengubah nilai ---'
DO $$
DECLARE before_val text; after_val text; blocked boolean := false;
BEGIN
  SELECT hour_checkout INTO before_val FROM public.timesheet_transaction WHERE tsnumber = 204;

  -- (a) kolom teks: dinormalisasi ulang oleh trigger sync -> no-op, nilai tetap benar
  UPDATE public.timesheet_transaction SET hour_checkout = '23:59' WHERE tsnumber = 204;
  SELECT hour_checkout INTO after_val FROM public.timesheet_transaction WHERE tsnumber = 204;
  IF after_val IS DISTINCT FROM before_val THEN
    RAISE EXCEPTION 'F9a GAGAL: kolom teks berubah (% -> %)', before_val, after_val;
  END IF;
  RAISE NOTICE 'F9a LULUS: tulisan kolom teks dinormalisasi (no-op), tetap %', after_val;

  -- (b) timestamp kanonik: perubahan payroll nyata -> DITOLAK
  BEGIN
    UPDATE public.timesheet_transaction
    SET longdate_checkout = '2026-09-20 18:00:00+07' WHERE tsnumber = 204;
  EXCEPTION WHEN integrity_constraint_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'F9b GAGAL: longdate berubah pada record frozen'; END IF;
  RAISE NOTICE 'F9b LULUS: perubahan longdate ditolak';
END $$;

\echo '--- F10 field non-payroll tetap editable pada record frozen ---'
DO $$
DECLARE r record;
BEGIN
  UPDATE public.timesheet_transaction SET note = 'divalidasi foreman' WHERE tsnumber = 204;
  SELECT * INTO r FROM public.timesheet_transaction WHERE tsnumber = 204;
  IF r.note <> 'divalidasi foreman' THEN RAISE EXCEPTION 'F10 GAGAL: note tidak tersimpan'; END IF;
  RAISE NOTICE 'F10 LULUS: non-payroll tetap editable';
END $$;

\echo '--- F11 audit ledger menolak reason kosong ---'
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.timesheet_correction_audit
      (tsnumber, plant, actor, reason, before_row, after_row)
    VALUES (201, '5100', 'admin', '   ', '{}'::jsonb, '{}'::jsonb);
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'F11 GAGAL: reason kosong diterima'; END IF;
  RAISE NOTICE 'F11 LULUS: reason kosong ditolak';
END $$;

\echo '--- F12 audit ledger append-only ---'
DO $$
DECLARE blocked boolean := false;
BEGIN
  INSERT INTO public.timesheet_correction_audit
    (tsnumber, plant, actor, reason, channel, before_row, after_row)
  VALUES (201, '5100', 'admin', 'salah tap mesin', 'updateadmin',
          '{"hour_checkout":"12:00"}'::jsonb, '{"hour_checkout":"13:00"}'::jsonb);

  BEGIN
    UPDATE public.timesheet_correction_audit SET reason = 'diubah' WHERE tsnumber = 201;
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'F12 GAGAL: ledger bisa di-UPDATE'; END IF;

  blocked := false;
  BEGIN
    DELETE FROM public.timesheet_correction_audit WHERE tsnumber = 201;
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'F12 GAGAL: ledger bisa di-DELETE'; END IF;
  RAISE NOTICE 'F12 LULUS: ledger append-only';
END $$;

\echo '--- F13 cutoff per plant + auto_post_enabled mati ---'
DO $$
BEGIN
  IF (SELECT auto_post_enabled FROM public.plant_config WHERE id = 1) THEN
    RAISE EXCEPTION 'F13 GAGAL: auto_post_enabled aktif';
  END IF;
  UPDATE public.plant_config SET timesheet_allocation_cutoff_date = '2026-09-01' WHERE id = 1;
  IF (SELECT timesheet_allocation_cutoff_date FROM public.plant_config WHERE id = 1)
     <> '2026-09-01'::date THEN
    RAISE EXCEPTION 'F13 GAGAL: cutoff tidak tersimpan';
  END IF;
  RAISE NOTICE 'F13 LULUS: auto-post mati, cutoff per plant tersedia';
END $$;

\echo '--- F14 multitasking tidak dihalangi ---'
DO $$
DECLARE n integer;
BEGIN
  INSERT INTO public.timesheet_transaction
    (tsnumber, serialnumber, plant, order_no, longdate_checkin)
  VALUES (401, 'OP9', '5100', 'OA', '2026-09-21 08:00:00+07'),
         (402, 'OP9', '5100', 'OB', '2026-09-21 08:00:00+07');
  UPDATE public.timesheet_transaction SET longdate_checkout = '2026-09-21 14:00:00+07'
  WHERE tsnumber IN (401, 402);

  SELECT count(*) INTO n FROM public.timesheet_transaction
  WHERE tsnumber IN (401,402) AND hour_checkout = '14:00';
  IF n <> 2 THEN RAISE EXCEPTION 'F14 GAGAL: overlap checkout terhalang (n=%)', n; END IF;
  RAISE NOTICE 'F14 LULUS: dua job paralel operator sama tetap diterima';
END $$;

\echo '=== SEMUA TEST FASE B LULUS ==='
