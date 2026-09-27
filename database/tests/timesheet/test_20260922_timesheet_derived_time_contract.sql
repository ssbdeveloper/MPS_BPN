-- Test migration kontrak waktu turunan (Fase A) terhadap Postgres lokal.
-- Menguji: backfill drift, normalisasi write langsung, NULL checkout,
-- kedua timezone plant, dan fail-closed saat timezone invalid.
--
-- BUKAN migration: file ini hidup di database/tests/ dan TIDAK boleh berada di
-- database/migrations/api/ — runner menjalankan setiap .sql di folder itu, dan
-- file ini melakukan DROP TABLE.
--
-- Jalankan HANYA terhadap database test terisolasi, mis.:
--   createdb tsc_test && psql -d tsc_test -f <file>
\set ON_ERROR_STOP on

\i D:/MPS2/database/tests/timesheet/_guard_not_production.sql

-- ---------- fixture minimal ----------
DROP TABLE IF EXISTS public.timesheet_transaction;
DROP TABLE IF EXISTS public.plant_config;

CREATE TABLE public.plant_config (
  id integer PRIMARY KEY DEFAULT 1,
  plant_code text NOT NULL,
  timezone text
);

CREATE TABLE public.timesheet_transaction (
  tsnumber integer PRIMARY KEY,
  serialnumber text,
  plant text,
  activitytype text,
  state_flag smallint,
  order_no text,
  operation_no integer,
  confirmationnumber text,
  date_checkin text,
  hour_checkin text,
  date_checkout text,
  hour_checkout text,
  longdate_checkin timestamptz,
  longdate_checkout timestamptz,
  duration numeric
);

-- Cikupa dulu.
INSERT INTO public.plant_config (id, plant_code, timezone)
VALUES (1, '5100', 'Asia/Jakarta');

-- Row dengan kolom teks SENGAJA melenceng 1 jam (pola drift produksi nyata),
-- plus row tanpa checkout.
INSERT INTO public.timesheet_transaction
  (tsnumber, plant, longdate_checkin, longdate_checkout,
   date_checkin, hour_checkin, date_checkout, hour_checkout)
VALUES
  (1, '5100', '2026-09-18 00:30:00+07', '2026-09-18 08:30:00+07',
   '18/09/2026', '01:30', '18/09/2026', '09:30'),
  (2, '5100', '2026-09-18 23:08:35+07', '2026-09-19 00:30:00+07',
   NULL, NULL, NULL, NULL),
  (3, '5100', '2026-09-18 07:00:00+07', NULL,
   '01/01/1999', '99:99', 'SISA', 'SISA');

\echo '--- sebelum migration: drift sengaja ---'
SELECT tsnumber, hour_checkin, hour_checkout FROM public.timesheet_transaction ORDER BY tsnumber;

\i D:/MPS2/database/migrations/api/20260922_timesheet_derived_time_contract.sql

\echo '--- T1 backfill Cikupa (Asia/Jakarta) ---'
SELECT tsnumber, date_checkin, hour_checkin, date_checkout, hour_checkout
FROM public.timesheet_transaction ORDER BY tsnumber;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.timesheet_transaction WHERE tsnumber = 1;
  IF r.hour_checkin <> '00:30' OR r.hour_checkout <> '08:30' THEN
    RAISE EXCEPTION 'T1 GAGAL: drift tidak diperbaiki (% %)', r.hour_checkin, r.hour_checkout;
  END IF;
  SELECT * INTO r FROM public.timesheet_transaction WHERE tsnumber = 3;
  IF r.date_checkout IS NOT NULL OR r.hour_checkout IS NOT NULL THEN
    RAISE EXCEPTION 'T2 GAGAL: checkout NULL harus mengosongkan kolom turunan';
  END IF;
  IF r.hour_checkin <> '07:00' THEN
    RAISE EXCEPTION 'T2 GAGAL: checkin salah %', r.hour_checkin;
  END IF;
  RAISE NOTICE 'T1/T2 LULUS: backfill + NULL checkout';
END $$;

\echo '--- T3 write langsung ke kolom teks tidak boleh menghasilkan drift ---'
UPDATE public.timesheet_transaction
SET hour_checkin = '13:37', date_checkin = '01/01/2000'
WHERE tsnumber = 1;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.timesheet_transaction WHERE tsnumber = 1;
  IF r.hour_checkin <> '00:30' OR r.date_checkin <> '18/09/2026' THEN
    RAISE EXCEPTION 'T3 GAGAL: kolom teks bisa ditulis liar (% %)', r.date_checkin, r.hour_checkin;
  END IF;
  RAISE NOTICE 'T3 LULUS: write liar dinormalisasi kembali';
END $$;

\echo '--- T4 update timestamp memperbarui kolom turunan ---'
UPDATE public.timesheet_transaction
SET longdate_checkout = '2026-09-18 16:30:00+07'
WHERE tsnumber = 1;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.timesheet_transaction WHERE tsnumber = 1;
  IF r.hour_checkout <> '16:30' THEN
    RAISE EXCEPTION 'T4 GAGAL: hour_checkout = %', r.hour_checkout;
  END IF;
  RAISE NOTICE 'T4 LULUS: timestamp -> teks';
END $$;

\echo '--- T5 INSERT baru langsung konsisten ---'
INSERT INTO public.timesheet_transaction (tsnumber, plant, longdate_checkin, longdate_checkout)
VALUES (4, '5100', '2026-09-20 22:00:00+07', '2026-09-21 02:00:00+07');

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.timesheet_transaction WHERE tsnumber = 4;
  IF r.hour_checkin <> '22:00' OR r.date_checkin <> '20/09/2026'
     OR r.hour_checkout <> '02:00' OR r.date_checkout <> '21/09/2026' THEN
    RAISE EXCEPTION 'T5 GAGAL: % % % %', r.date_checkin, r.hour_checkin, r.date_checkout, r.hour_checkout;
  END IF;
  RAISE NOTICE 'T5 LULUS: insert lintas tengah malam';
END $$;

\echo '--- T6 timezone BPN (Asia/Makassar) menghasilkan jam berbeda ---'
UPDATE public.plant_config SET timezone = 'Asia/Makassar', plant_code = '5051' WHERE id = 1;
UPDATE public.timesheet_transaction SET plant = '5051', longdate_checkin = longdate_checkin WHERE tsnumber = 4;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.timesheet_transaction WHERE tsnumber = 4;
  -- 22:00 WIB = 23:00 WITA
  IF r.hour_checkin <> '23:00' THEN
    RAISE EXCEPTION 'T6 GAGAL: timezone plant tidak dipakai, hour_checkin = %', r.hour_checkin;
  END IF;
  RAISE NOTICE 'T6 LULUS: timezone plant dihormati (WITA)';
END $$;

\echo '--- T7 fail closed: timezone kosong menolak write ---'
UPDATE public.plant_config SET timezone = NULL WHERE id = 1;
DO $$
BEGIN
  BEGIN
    UPDATE public.timesheet_transaction SET longdate_checkin = longdate_checkin WHERE tsnumber = 4;
    RAISE EXCEPTION 'T7 GAGAL: write diterima padahal timezone NULL';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'T7 LULUS: write ditolak saat timezone NULL';
  END;
END $$;

\echo '--- T8 fail closed: timezone tidak valid ditolak ---'
UPDATE public.plant_config SET timezone = 'Mars/Olympus' WHERE id = 1;
DO $$
BEGIN
  BEGIN
    UPDATE public.timesheet_transaction SET longdate_checkin = longdate_checkin WHERE tsnumber = 4;
    RAISE EXCEPTION 'T8 GAGAL: timezone ngawur diterima';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'T8 LULUS: timezone invalid ditolak';
  END;
END $$;

UPDATE public.plant_config SET timezone = 'Asia/Jakarta', plant_code = '5100' WHERE id = 1;

\echo '--- T9 plant record harus cocok dengan plant_config (bukan hanya timezone) ---'
DO $$
BEGIN
  BEGIN
    UPDATE public.timesheet_transaction SET longdate_checkin = longdate_checkin WHERE tsnumber = 4;
    RAISE EXCEPTION 'T9 GAGAL: row plant=5051 diterima saat plant_config=5100';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'T9 LULUS: plant tidak cocok ditolak';
  END;
END $$;

-- Row plant benar tetap boleh lewat.
UPDATE public.timesheet_transaction SET longdate_checkin = longdate_checkin WHERE tsnumber = 1;

\echo '=== SEMUA TEST MIGRATION FASE A LULUS ==='
