-- 20260916b_shift_definition_single_master.sql
-- Satu master shift: public.shift_definition menjadi satu-satunya sumber jadwal EWS
-- (roster generator, heatmap, dan kalkulator adoption).
--
-- Yang ditambahkan:
--   * roster_shift_code  -> memetakan baris shift ke kode roster DAY / NIGHT.
--   * standard_hours     -> jam kerja bersih (target kehadiran). default_capacity_hours
--                           tetap dipakai Scheduling sebagai kapasitas SOW; nilainya boleh
--                           sama, tetapi artinya berbeda sehingga dipisah.
--   * public.resolve_shift_definition(date) -> satu titik resolusi tanggal, memakai aturan
--                           identik dengan resolvedShiftSql() di sowScheduleController:
--                           baris override hanya berlaku bila effective_date = tanggal itu,
--                           selain itu baris default.
--
-- View ews.roster_effective diambil ulang: eff_std dan jam shift mengikuti master
-- (termasuk override tanggal), sedangkan scheduled_* tetap snapshot hasil generate.

ALTER TABLE public.shift_definition
  ADD COLUMN IF NOT EXISTS roster_shift_code text
    CHECK (roster_shift_code IS NULL OR roster_shift_code IN ('DAY', 'NIGHT')),
  ADD COLUMN IF NOT EXISTS standard_hours numeric
    CHECK (standard_hours IS NULL OR (standard_hours > 0 AND standard_hours <= 24));

-- Backfill mapping yang sudah terverifikasi di CKP dan BPN: SHIFT-1 = DAY, SHIFT-2 = NIGHT.
UPDATE public.shift_definition
   SET roster_shift_code = 'DAY'
 WHERE roster_shift_code IS NULL
   AND upper(btrim(shift_code)) IN ('SHIFT-1', 'SHIFT1', 'DAY', 'SIANG');

UPDATE public.shift_definition
   SET roster_shift_code = 'NIGHT'
 WHERE roster_shift_code IS NULL
   AND upper(btrim(shift_code)) IN ('SHIFT-2', 'SHIFT2', 'NIGHT', 'MALAM');

UPDATE public.shift_definition
   SET standard_hours = default_capacity_hours
 WHERE standard_hours IS NULL;

-- Resolusi harus tunggal per (kode roster, tanggal): satu baris default + paling banyak
-- satu override per tanggal. Baris lama tetap aman karena kuncinya menyertakan tanggal.
CREATE UNIQUE INDEX IF NOT EXISTS shift_definition_roster_uniq
  ON public.shift_definition (roster_shift_code, COALESCE(effective_date, DATE '1900-01-01'))
  WHERE roster_shift_code IS NOT NULL;

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

COMMENT ON COLUMN public.shift_definition.roster_shift_code IS
  'Kode shift pada roster EWS (DAY/NIGHT). NULL = shift ini tidak dipakai roster.';
COMMENT ON COLUMN public.shift_definition.standard_hours IS
  'Jam kerja bersih (target kehadiran EWS). Terpisah dari default_capacity_hours (kapasitas SOW).';
COMMENT ON FUNCTION public.resolve_shift_definition(date) IS
  'Resolusi shift untuk satu tanggal: override (effective_date = tanggal) menang atas baris default.';

DROP VIEW IF EXISTS ews.roster_effective;

CREATE VIEW ews.roster_effective AS
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
  (lk.id IS NOT NULL) AS shift_locked,
  r.shift_override,
  r.standard_hours_override,
  CASE WHEN org.fixed_shift_effective_from <= r.business_date THEN org.fixed_shift END AS fixed_shift,
  sd.start_time,
  sd.end_time,
  COALESCE(sd.crosses_midnight, false) AS crosses_midnight,
  sd.roster_shift_code AS master_shift_code,
  sd.standard_hours AS master_standard_hours
FROM ews.shift_roster r
LEFT JOIN ews.operator_rotation_group org ON org.serialnumber = r.serialnumber
LEFT JOIN ews.operator_shift_lock lk
       ON lk.serialnumber = r.serialnumber
      AND lk.cancelled_at IS NULL
      AND daterange(lk.effective_from, lk.lock_end, '[)') @> r.business_date
LEFT JOIN LATERAL (
  SELECT COALESCE(
           r.shift_override,
           lk.locked_shift,
           CASE WHEN org.fixed_shift_effective_from <= r.business_date THEN org.fixed_shift END,
           r.scheduled_shift
         ) AS code
) eff ON true
LEFT JOIN public.resolve_shift_definition(r.business_date) sd
       ON sd.roster_shift_code = eff.code
LEFT JOIN public.usernfc u
       ON NULLIF(BTRIM(u.snssb), '') = r.serialnumber
WHERE u.inactive_from IS NULL OR r.business_date < u.inactive_from;

COMMENT ON VIEW ews.roster_effective IS
  'Roster efektif per operator/tanggal. eff_shift dan eff_std mengikuti master shift_definition '
  '(termasuk override tanggal); scheduled_* tetap snapshot hasil generate; override operator menang.';
