-- ETL timesheet berlapis — tabel pipeline (F0).
--
-- Plan: docs/planning/2026-09-23-timesheet-etl-berlapis.md (§4 kontrak tabel, §9 F0)
--
-- Arsitektur: `timesheet_transaction` tetap data mentah. Cleansing, allocation, dan
-- payload SAP TIDAK menulis ulang interval mentah; tiap tahap menulis ke tabel
-- pipeline append-only dengan lineage ke `run_id` dan `tsnumber`.
--
-- Migration ini HANYA membuat struktur. Pada rilis F0/F1 hanya `timesheet_etl_run`
-- dan `timesheet_etl_input` yang diisi program; tiga tabel hilir dibuat sekarang agar
-- lineage FK dapat dikunci sejak awal dan worker Python tidak pernah perlu
-- `CREATE TABLE` saat runtime.
--
-- Idempoten: seluruh objek memakai IF NOT EXISTS / guard katalog sehingga migration
-- dapat dijalankan ulang tanpa merusak data yang sudah ada.
--
-- Tanpa BEGIN/COMMIT: database/migrate.js membungkus tiap migration dalam satu
-- transaksi. Menulisnya lagi akan commit lebih awal dan merusak kontrak itu.

-- pgcrypto untuk gen_random_uuid() pada PostgreSQL < 13; PG16 punya bawaan tetapi
-- extension ini sudah dipakai di schema lain, jadi aman dan idempoten.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. timesheet_etl_run — manifest satu eksekusi manual
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timesheet_etl_run (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant text NOT NULL,
  from_ts timestamptz NOT NULL,
  to_ts timestamptz NOT NULL,
  plant_timezone text NOT NULL,
  allocation_version text NOT NULL,
  status text NOT NULL DEFAULT 'CAPTURED',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_by text NOT NULL,
  -- Jumlah per tahap. F1 hanya mengisi input_count; sisanya tetap NULL sampai
  -- tahap terkait diimplementasikan, sehingga "0" tidak pernah disalahartikan
  -- sebagai "sudah dijalankan dan hasilnya kosong".
  input_count integer,
  cleaned_segment_count integer,
  allocated_segment_count integer,
  sap_ready_count integer,
  input_checksum text,
  output_checksum text,
  error_code text,
  error_detail text,
  CONSTRAINT ck_timesheet_etl_run_window CHECK (from_ts < to_ts),
  CONSTRAINT ck_timesheet_etl_run_status CHECK (status IN (
    'CAPTURED', 'CLEANED', 'ALLOCATED', 'SAP_READY', 'PUBLISHING', 'STAGED', 'POSTED',
    'INVALIDATED',
    'FAILED_CAPTURE', 'FAILED_CLEANING', 'FAILED_ALLOCATION', 'FAILED_PUBLISH'
  ))
);

CREATE INDEX IF NOT EXISTS idx_timesheet_etl_run_plant_window
  ON public.timesheet_etl_run (plant, from_ts, to_ts);
CREATE INDEX IF NOT EXISTS idx_timesheet_etl_run_status
  ON public.timesheet_etl_run (status);
CREATE INDEX IF NOT EXISTS idx_timesheet_etl_run_started_at
  ON public.timesheet_etl_run (started_at);

-- ---------------------------------------------------------------------------
-- 2. timesheet_etl_input — snapshot immutable satu versi record mentah
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timesheet_etl_input (
  input_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.timesheet_etl_run (run_id),
  plant text NOT NULL,
  source_tsnumber integer NOT NULL,
  source_updated_at timestamptz,
  source_hash text NOT NULL,
  allocation_version text NOT NULL,

  -- Field payroll yang dibutuhkan transformasi hilir. Disimpan typed (bukan hanya
  -- di dalam jsonb) supaya cleansing/allocation dapat memakai index dan tipe asli.
  serialnumber text,
  activitytype text,
  order_no text,
  operation_no integer,
  workcentercode text,
  confirmationnumber text,
  state_flag smallint,
  longdate_checkin timestamptz NOT NULL,
  longdate_checkout timestamptz NOT NULL,
  raw_seconds bigint NOT NULL,
  local_date_checkin date NOT NULL,

  raw_snapshot jsonb NOT NULL,

  status text NOT NULL DEFAULT 'CAPTURED',
  captured_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  invalidated_reason text,

  CONSTRAINT ck_timesheet_etl_input_interval CHECK (longdate_checkout > longdate_checkin),
  CONSTRAINT ck_timesheet_etl_input_raw_seconds CHECK (raw_seconds > 0),
  CONSTRAINT ck_timesheet_etl_input_status CHECK (status IN (
    'CAPTURED', 'CLEANED', 'ALLOCATED', 'SAP_READY', 'PUBLISHING', 'STAGED', 'POSTED',
    'INVALIDATED', 'FAILED_CLEANING', 'FAILED_ALLOCATION', 'FAILED_PUBLISH'
  )),
  -- INVALIDATED wajib membawa bukti kapan dan kenapa; status lain tidak boleh
  -- membawa jejak invalidasi.
  CONSTRAINT ck_timesheet_etl_input_invalidation CHECK (
    (status = 'INVALIDATED' AND invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL)
    OR (status <> 'INVALIDATED' AND invalidated_at IS NULL AND invalidated_reason IS NULL)
  ),
  -- Kunci idempotensi capture (planning §4.2). Rerun window yang sama tidak boleh
  -- membuat versi input kedua; perubahan field payroll mengubah source_hash dan
  -- karenanya sah membuat versi baru.
  CONSTRAINT uq_timesheet_etl_input_version
    UNIQUE (plant, source_tsnumber, source_hash, allocation_version)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_etl_input_run
  ON public.timesheet_etl_input (run_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_etl_input_tsnumber
  ON public.timesheet_etl_input (source_tsnumber);
CREATE INDEX IF NOT EXISTS idx_timesheet_etl_input_status
  ON public.timesheet_etl_input (status);
CREATE INDEX IF NOT EXISTS idx_timesheet_etl_input_window
  ON public.timesheet_etl_input (plant, longdate_checkin, longdate_checkout);
CREATE INDEX IF NOT EXISTS idx_timesheet_etl_input_operator_day
  ON public.timesheet_etl_input (plant, serialnumber, local_date_checkin);

-- Snapshot immutable: setelah insert, hanya kolom status operasional yang boleh
-- berubah. Ini yang membuat "koreksi membuat versi baru, bukan menimpa" menjadi
-- tidak mungkin dilanggar oleh writer mana pun, bukan sekadar konvensi kode.
CREATE OR REPLACE FUNCTION public.timesheet_etl_input_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.input_id IS DISTINCT FROM OLD.input_id
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.plant IS DISTINCT FROM OLD.plant
     OR NEW.source_tsnumber IS DISTINCT FROM OLD.source_tsnumber
     OR NEW.source_hash IS DISTINCT FROM OLD.source_hash
     OR NEW.allocation_version IS DISTINCT FROM OLD.allocation_version
     OR NEW.source_updated_at IS DISTINCT FROM OLD.source_updated_at
     OR NEW.serialnumber IS DISTINCT FROM OLD.serialnumber
     OR NEW.activitytype IS DISTINCT FROM OLD.activitytype
     OR NEW.order_no IS DISTINCT FROM OLD.order_no
     OR NEW.operation_no IS DISTINCT FROM OLD.operation_no
     OR NEW.workcentercode IS DISTINCT FROM OLD.workcentercode
     OR NEW.confirmationnumber IS DISTINCT FROM OLD.confirmationnumber
     OR NEW.state_flag IS DISTINCT FROM OLD.state_flag
     OR NEW.longdate_checkin IS DISTINCT FROM OLD.longdate_checkin
     OR NEW.longdate_checkout IS DISTINCT FROM OLD.longdate_checkout
     OR NEW.raw_seconds IS DISTINCT FROM OLD.raw_seconds
     OR NEW.local_date_checkin IS DISTINCT FROM OLD.local_date_checkin
     OR NEW.raw_snapshot IS DISTINCT FROM OLD.raw_snapshot
     OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
  THEN
    RAISE EXCEPTION
      'timesheet_etl_input is immutable: only status/invalidated_* may change (input_id=%)',
      OLD.input_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_timesheet_etl_input_immutable ON public.timesheet_etl_input;
CREATE TRIGGER trg_timesheet_etl_input_immutable
  BEFORE UPDATE ON public.timesheet_etl_input
  FOR EACH ROW EXECUTE FUNCTION public.timesheet_etl_input_immutable();

-- ---------------------------------------------------------------------------
-- 2b. timesheet_etl_run_input — lineage eksplisit run -> input version
-- ---------------------------------------------------------------------------
-- Kenapa tabel ini ada, padahal `timesheet_etl_input.run_id` juga ada:
--
-- `timesheet_etl_input.run_id` menunjuk run yang MENCATAT version itu pertama.
-- Saat window yang sama dijalankan ulang, unique constraint menolak menyalin
-- snapshot dan seluruh baris dipakai ulang — sehingga run kedua tidak punya jejak
-- apa pun tentang input yang sebenarnya ia baca. Jumlahnya benar, lineage-nya
-- bohong, dan planning §4.2 hanya mengizinkan pemakaian ulang "bila desain lineage
-- membuktikannya". Tabel ini adalah bukti itu: satu baris per (run, input version).
CREATE TABLE IF NOT EXISTS public.timesheet_etl_run_input (
  run_id uuid NOT NULL REFERENCES public.timesheet_etl_run (run_id),
  input_id uuid NOT NULL REFERENCES public.timesheet_etl_input (input_id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, input_id)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_etl_run_input_input
  ON public.timesheet_etl_run_input (input_id);

-- ---------------------------------------------------------------------------
-- 3. timesheet_cleaned_segment — hasil cleansing (F2, belum diisi program)
-- ---------------------------------------------------------------------------
-- Kontrak Lineage Downstream:
-- `run_id` pada tabel artefak hilir (cleaned, allocated, sap_ready) menunjuk run
-- yang PERTAMA membuat versi segmen/payload tersebut (created_by_run_id).
-- Rerun atau eksekusi downstream berikutnya menelusuri artefak secara lengkap lewat:
--   timesheet_etl_run_input (run_id) -> input_id -> timesheet_cleaned_segment
CREATE TABLE IF NOT EXISTS public.timesheet_cleaned_segment (
  cleaned_segment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.timesheet_etl_run (run_id),
  input_id uuid NOT NULL REFERENCES public.timesheet_etl_input (input_id),
  plant text NOT NULL,
  source_tsnumber integer NOT NULL,
  rule_version text NOT NULL,
  segment_sequence integer NOT NULL,
  segment_start timestamptz NOT NULL,
  segment_end timestamptz NOT NULL,
  local_date date NOT NULL,
  segment_kind text NOT NULL,
  confirmation_type text,
  classification_source text,
  classification_reason text,
  is_productive boolean NOT NULL,
  break_rule text,
  cap_rule text,
  cap_seconds bigint,
  cap_category text,
  raw_seconds bigint NOT NULL,
  deducted_seconds bigint NOT NULL DEFAULT 0,
  remaining_seconds bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_timesheet_cleaned_segment_interval CHECK (segment_end > segment_start),
  CONSTRAINT ck_timesheet_cleaned_segment_seconds CHECK (
    raw_seconds >= 0 AND deducted_seconds >= 0 AND remaining_seconds >= 0
    AND remaining_seconds <= raw_seconds
  ),
  CONSTRAINT ck_timesheet_cleaned_segment_kind CHECK (segment_kind IN ('WORK', 'BREAK')),
  CONSTRAINT ck_timesheet_cleaned_segment_work_break CHECK (
    (segment_kind = 'WORK' AND deducted_seconds = 0 AND remaining_seconds = raw_seconds AND break_rule IS NULL)
    OR (segment_kind = 'BREAK' AND remaining_seconds = 0 AND deducted_seconds = raw_seconds AND break_rule IS NOT NULL)
  ),
  CONSTRAINT ck_timesheet_cleaned_segment_cap_seconds CHECK (cap_seconds IS NULL OR cap_seconds >= 0),
  CONSTRAINT ck_timesheet_cleaned_segment_classification_source CHECK (
    classification_source IS NULL OR classification_source IN ('CANONICAL', 'LEGACY_FALLBACK', 'UNKNOWN', 'NON_PRODUCTIVE')
  ),
  CONSTRAINT ck_timesheet_cleaned_segment_confirmation_type CHECK (
    confirmation_type IS NULL OR confirmation_type IN ('RG', 'OV', 'RW', 'UNKNOWN')
  ),
  CONSTRAINT uq_timesheet_cleaned_segment
    UNIQUE (input_id, rule_version, segment_sequence)
);

ALTER TABLE public.timesheet_cleaned_segment
  ADD COLUMN IF NOT EXISTS classification_source text,
  ADD COLUMN IF NOT EXISTS classification_reason text,
  ADD COLUMN IF NOT EXISTS cap_seconds bigint,
  ADD COLUMN IF NOT EXISTS cap_category text;

ALTER TABLE public.timesheet_cleaned_segment
  DROP CONSTRAINT IF EXISTS ck_timesheet_cleaned_segment_kind,
  DROP CONSTRAINT IF EXISTS ck_timesheet_cleaned_segment_work_break,
  DROP CONSTRAINT IF EXISTS ck_timesheet_cleaned_segment_cap_seconds,
  DROP CONSTRAINT IF EXISTS ck_timesheet_cleaned_segment_classification_source,
  DROP CONSTRAINT IF EXISTS ck_timesheet_cleaned_segment_confirmation_type;

ALTER TABLE public.timesheet_cleaned_segment
  ADD CONSTRAINT ck_timesheet_cleaned_segment_kind
    CHECK (segment_kind IN ('WORK', 'BREAK')),
  ADD CONSTRAINT ck_timesheet_cleaned_segment_work_break
    CHECK (
      (segment_kind = 'WORK' AND deducted_seconds = 0 AND remaining_seconds = raw_seconds AND break_rule IS NULL)
      OR (segment_kind = 'BREAK' AND remaining_seconds = 0 AND deducted_seconds = raw_seconds AND break_rule IS NOT NULL)
    ),
  ADD CONSTRAINT ck_timesheet_cleaned_segment_cap_seconds
    CHECK (cap_seconds IS NULL OR cap_seconds >= 0),
  ADD CONSTRAINT ck_timesheet_cleaned_segment_classification_source
    CHECK (classification_source IS NULL OR classification_source IN ('CANONICAL', 'LEGACY_FALLBACK', 'UNKNOWN', 'NON_PRODUCTIVE')),
  ADD CONSTRAINT ck_timesheet_cleaned_segment_confirmation_type
    CHECK (confirmation_type IS NULL OR confirmation_type IN ('RG', 'OV', 'RW', 'UNKNOWN'));

CREATE INDEX IF NOT EXISTS idx_timesheet_cleaned_segment_run
  ON public.timesheet_cleaned_segment (run_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_cleaned_segment_tsnumber
  ON public.timesheet_cleaned_segment (source_tsnumber);
CREATE INDEX IF NOT EXISTS idx_timesheet_cleaned_segment_window
  ON public.timesheet_cleaned_segment (plant, segment_start, segment_end);

-- ---------------------------------------------------------------------------
-- 4. timesheet_allocated_segment — hasil allocation (F3, belum diisi program)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timesheet_allocated_segment (
  allocated_segment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.timesheet_etl_run (run_id),
  cleaned_segment_id uuid NOT NULL REFERENCES public.timesheet_cleaned_segment (cleaned_segment_id),
  input_id uuid NOT NULL REFERENCES public.timesheet_etl_input (input_id),
  plant text NOT NULL,
  source_tsnumber integer NOT NULL,
  allocation_version text NOT NULL,
  slice_start timestamptz NOT NULL,
  slice_end timestamptz NOT NULL,
  local_date date NOT NULL,
  active_count integer NOT NULL,
  numerator bigint NOT NULL,
  denominator bigint NOT NULL,
  allocated_seconds bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_timesheet_allocated_segment_interval CHECK (slice_end > slice_start),
  CONSTRAINT ck_timesheet_allocated_segment_active CHECK (active_count >= 1),
  CONSTRAINT ck_timesheet_allocated_segment_denominator CHECK (denominator > 0),
  CONSTRAINT ck_timesheet_allocated_segment_seconds CHECK (allocated_seconds >= 0),
  CONSTRAINT uq_timesheet_allocated_segment
    UNIQUE (cleaned_segment_id, allocation_version, slice_start)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_allocated_segment_run
  ON public.timesheet_allocated_segment (run_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_allocated_segment_tsnumber
  ON public.timesheet_allocated_segment (source_tsnumber);
CREATE INDEX IF NOT EXISTS idx_timesheet_allocated_segment_window
  ON public.timesheet_allocated_segment (plant, slice_start, slice_end);

-- ---------------------------------------------------------------------------
-- 5. timesheet_sap_ready — payload final (F4/F5, belum diisi program)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timesheet_sap_ready (
  sap_ready_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.timesheet_etl_run (run_id),
  input_id uuid NOT NULL REFERENCES public.timesheet_etl_input (input_id),
  plant text NOT NULL,
  source_tsnumber integer NOT NULL,
  source_version text NOT NULL,
  allocation_version text NOT NULL,
  ready_rule_version text NOT NULL DEFAULT 'READY-V1',
  local_date date NOT NULL,
  segment_sequence integer NOT NULL,
  source_key text NOT NULL,
  enrichment_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL,
  raw_seconds bigint NOT NULL,
  cleaned_seconds bigint NOT NULL,
  allocated_seconds bigint NOT NULL,
  cap_seconds bigint,
  sap_effective_seconds bigint NOT NULL,
  status text NOT NULL DEFAULT 'SAP_READY',
  published_at timestamptz,
  central_staging_id text,
  central_checksum text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_timesheet_sap_ready_seconds CHECK (
    raw_seconds >= 0 AND cleaned_seconds >= 0 AND allocated_seconds >= 0
    AND sap_effective_seconds >= 0 AND sap_effective_seconds <= allocated_seconds
  ),
  CONSTRAINT ck_timesheet_sap_ready_status CHECK (status IN (
    'SAP_READY', 'PUBLISHING', 'STAGED', 'POSTED', 'INVALIDATED', 'FAILED_PUBLISH'
  )),
  -- Idempotency key planning §4.5.
  CONSTRAINT uq_timesheet_sap_ready_identity
    UNIQUE (plant, source_tsnumber, source_version, allocation_version, ready_rule_version, local_date, segment_sequence),
  CONSTRAINT uq_timesheet_sap_ready_source_key UNIQUE (source_key)
);

ALTER TABLE public.timesheet_sap_ready
  ADD COLUMN IF NOT EXISTS ready_rule_version text NOT NULL DEFAULT 'READY-V1';

ALTER TABLE public.timesheet_sap_ready
  ADD COLUMN IF NOT EXISTS enrichment_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.timesheet_sap_ready
  DROP CONSTRAINT IF EXISTS uq_timesheet_sap_ready_identity;

ALTER TABLE public.timesheet_sap_ready
  ADD CONSTRAINT uq_timesheet_sap_ready_identity
    UNIQUE (plant, source_tsnumber, source_version, allocation_version, ready_rule_version, local_date, segment_sequence);

CREATE INDEX IF NOT EXISTS idx_timesheet_sap_ready_run
  ON public.timesheet_sap_ready (run_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_sap_ready_tsnumber
  ON public.timesheet_sap_ready (source_tsnumber);
CREATE INDEX IF NOT EXISTS idx_timesheet_sap_ready_status
  ON public.timesheet_sap_ready (status);
CREATE INDEX IF NOT EXISTS idx_timesheet_sap_ready_local_date
  ON public.timesheet_sap_ready (plant, local_date);

-- ---------------------------------------------------------------------------
-- 5b. timesheet_etl_run_sap_ready — lineage eksplisit run -> sap_ready artifact
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timesheet_etl_run_sap_ready (
  run_id uuid NOT NULL REFERENCES public.timesheet_etl_run (run_id) ON DELETE CASCADE,
  sap_ready_id uuid NOT NULL REFERENCES public.timesheet_sap_ready (sap_ready_id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, sap_ready_id)
);

ALTER TABLE public.timesheet_etl_run_sap_ready
  DROP CONSTRAINT IF EXISTS timesheet_etl_run_sap_ready_run_id_fkey,
  DROP CONSTRAINT IF EXISTS timesheet_etl_run_sap_ready_sap_ready_id_fkey;

ALTER TABLE public.timesheet_etl_run_sap_ready
  ADD CONSTRAINT timesheet_etl_run_sap_ready_run_id_fkey
    FOREIGN KEY (run_id) REFERENCES public.timesheet_etl_run (run_id) ON DELETE CASCADE,
  ADD CONSTRAINT timesheet_etl_run_sap_ready_sap_ready_id_fkey
    FOREIGN KEY (sap_ready_id) REFERENCES public.timesheet_sap_ready (sap_ready_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_timesheet_etl_run_sap_ready_ready
  ON public.timesheet_etl_run_sap_ready (sap_ready_id);


