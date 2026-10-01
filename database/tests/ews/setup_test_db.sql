-- database/tests/ews/setup_test_db.sql
-- Setup skema dan seed untuk pengujian lokal integrasi shift override.

-- Lapis proteksi wajib
\ir ../timesheet/_guard_not_production.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS ews;

-- 1. Users untuk uji aktor
CREATE TABLE IF NOT EXISTS public.users (
  id serial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  name text,
  role text,
  roles text,
  password_hash text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.users (id, username, name, role)
VALUES
  (1, 'admin', 'Administrator System', 'administrator'),
  (2, 'operator1', 'Budi Santoso', 'operator')
ON CONFLICT (id) DO NOTHING;

-- 2. Master shift_definition
CREATE TABLE IF NOT EXISTS public.shift_definition (
  id bigserial PRIMARY KEY,
  shift_code text NOT NULL,
  shift_name text,
  roster_shift_code text CHECK (roster_shift_code IS NULL OR roster_shift_code IN ('DAY', 'NIGHT')),
  start_time time NOT NULL,
  end_time time NOT NULL,
  crosses_midnight boolean NOT NULL DEFAULT false,
  default_capacity_hours numeric(6,2) DEFAULT 8.00,
  standard_hours numeric(6,2) CHECK (standard_hours IS NULL OR (standard_hours > 0 AND standard_hours <= 24)),
  is_default boolean NOT NULL DEFAULT false,
  effective_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_definition_default_code
  ON public.shift_definition (lower(shift_code)) WHERE (is_default = true);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_definition_effective_date_code
  ON public.shift_definition (lower(shift_code), effective_date) WHERE (is_default = false AND effective_date IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS shift_definition_roster_uniq
  ON public.shift_definition (roster_shift_code, COALESCE(effective_date, DATE '1900-01-01'))
  WHERE roster_shift_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shift_definition_effective_date_active
  ON public.shift_definition (effective_date, is_active);

-- Seed default shifts
INSERT INTO public.shift_definition
  (id, shift_code, shift_name, roster_shift_code, start_time, end_time, crosses_midnight, default_capacity_hours, standard_hours, is_default, is_active)
VALUES
  (1, 'SHIFT-1', 'Shift Pagi', 'DAY', '07:25:00', '16:30:00', false, 8.00, 8.00, true, true),
  (2, 'SHIFT-2', 'Shift Malam', 'NIGHT', '16:30:00', '00:30:00', true, 7.00, 7.00, true, true)
ON CONFLICT (id) DO NOTHING;

SELECT setval('public.shift_definition_id_seq', 10);

-- 3. Resolver function
CREATE OR REPLACE FUNCTION public.resolve_shift_definition(p_date date)
RETURNS TABLE (
  id bigint,
  shift_code text,
  shift_name text,
  roster_shift_code text,
  effective_date date,
  is_default boolean,
  start_time time,
  end_time time,
  crosses_midnight boolean,
  default_capacity_hours numeric,
  standard_hours numeric,
  is_active boolean
)
LANGUAGE sql
STABLE
AS $$
  SELECT id, shift_code, shift_name, roster_shift_code, effective_date, is_default,
         start_time, end_time, crosses_midnight, default_capacity_hours, standard_hours, is_active
  FROM (
    SELECT sd.id, sd.shift_code, sd.shift_name, sd.roster_shift_code, sd.effective_date,
           sd.is_default, sd.start_time, sd.end_time, sd.crosses_midnight,
           sd.default_capacity_hours, sd.standard_hours, sd.is_active,
           ROW_NUMBER() OVER (
             PARTITION BY sd.shift_code
             ORDER BY CASE
                        WHEN sd.is_default = false AND sd.effective_date = p_date THEN 0
                        WHEN sd.is_default = true THEN 1
                        ELSE 2
                      END,
                      sd.id
           ) AS rn
    FROM public.shift_definition sd
    WHERE sd.is_active = true
      AND (sd.is_default = true OR sd.effective_date = p_date)
  ) resolved
  WHERE rn = 1;
$$;

-- 4. Keempat tabel SOW
CREATE TABLE IF NOT EXISTS public.sow_machine_capacity (
  id bigserial PRIMARY KEY,
  machine_code text NOT NULL,
  schedule_date date NOT NULL,
  shift_id bigint REFERENCES public.shift_definition(id) ON DELETE RESTRICT,
  capacity_hours numeric(6,2) NOT NULL DEFAULT 8.00,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sow_schedule (
  id bigserial PRIMARY KEY,
  schedule_date date NOT NULL,
  machine_code text NOT NULL,
  shift_id bigint REFERENCES public.shift_definition(id) ON DELETE SET NULL,
  schedule_status text NOT NULL CHECK (schedule_status IN ('PLANNED', 'UNPLANNED', 'PARTIAL', 'COMPLETED', 'CANCELLED')),
  planned_start_datetime timestamptz,
  planned_end_datetime timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sow_schedule_batch (
  id bigserial PRIMARY KEY,
  batch_name text NOT NULL,
  schedule_date date NOT NULL,
  machine_code text NOT NULL,
  shift_id bigint REFERENCES public.shift_definition(id) ON DELETE SET NULL,
  batch_status text NOT NULL CHECK (batch_status IN ('OPEN', 'PLANNED', 'RUNNING', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sow_overtime_request (
  id bigserial PRIMARY KEY,
  overtime_date date NOT NULL,
  shift_id bigint REFERENCES public.shift_definition(id) ON DELETE SET NULL,
  request_status text NOT NULL CHECK (request_status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  hours numeric(6,2) NOT NULL DEFAULT 2.00,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 5. Tabel dan View EWS
CREATE TABLE IF NOT EXISTS ews.shift_roster (
  id bigserial PRIMARY KEY,
  serialnumber text NOT NULL,
  business_date date NOT NULL,
  scheduled_shift text NOT NULL,
  scheduled_standard_hours numeric(6,2) NOT NULL DEFAULT 8.00,
  status text NOT NULL DEFAULT 'SCHEDULED',
  source text NOT NULL DEFAULT 'auto',
  shift_override text,
  standard_hours_override numeric(6,2),
  half_day boolean DEFAULT false,
  updated_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE OR REPLACE VIEW ews.roster_effective AS
SELECT
  r.serialnumber,
  r.business_date,
  r.status,
  r.source,
  r.updated_by,
  eff.code AS eff_shift,
  COALESCE(
    r.standard_hours_override,
    CASE WHEN COALESCE(r.half_day, false)
      THEN COALESCE(sd.standard_hours, r.scheduled_standard_hours) / 2.0
      ELSE COALESCE(sd.standard_hours, r.scheduled_standard_hours)
    END
  ) AS eff_std,
  COALESCE(r.half_day, false) AS half_day,
  false AS shift_locked,
  r.shift_override,
  r.standard_hours_override,
  NULL::text AS fixed_shift,
  sd.start_time,
  sd.end_time,
  COALESCE(sd.crosses_midnight, false) AS crosses_midnight,
  sd.roster_shift_code AS master_shift_code,
  sd.standard_hours AS master_standard_hours
FROM ews.shift_roster r
LEFT JOIN LATERAL (
  SELECT COALESCE(r.shift_override, r.scheduled_shift) AS code
) eff ON true
LEFT JOIN public.resolve_shift_definition(r.business_date) sd
       ON sd.roster_shift_code = eff.code;
