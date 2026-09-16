-- Unified roster overrides: permanent operator shift plus per-day shift/hours.
-- Historical rows are not rewritten; application guards writes to today/future.

ALTER TABLE ews.operator_rotation_group
  ADD COLUMN IF NOT EXISTS fixed_shift text
  CHECK (fixed_shift IS NULL OR fixed_shift IN ('DAY', 'NIGHT')),
  ADD COLUMN IF NOT EXISTS fixed_shift_effective_from date;

ALTER TABLE ews.shift_roster
  ADD COLUMN IF NOT EXISTS shift_override text
  CHECK (shift_override IS NULL OR shift_override IN ('DAY', 'NIGHT')),
  ADD COLUMN IF NOT EXISTS standard_hours_override numeric
  CHECK (standard_hours_override IS NULL OR (standard_hours_override > 0 AND standard_hours_override <= 24));

CREATE OR REPLACE VIEW ews.roster_effective AS
SELECT
  r.serialnumber,
  r.business_date,
  r.status,
  r.source,
  r.updated_by,
  COALESCE(
    r.shift_override,
    lk.locked_shift,
    CASE WHEN org.fixed_shift_effective_from <= r.business_date THEN org.fixed_shift END,
    r.scheduled_shift
  ) AS eff_shift,
  COALESCE(
    r.standard_hours_override,
    CASE WHEN COALESCE(r.half_day, false)
      THEN COALESCE(os_eff.standard_hours, r.scheduled_standard_hours) / 2.0
      ELSE COALESCE(os_eff.standard_hours, r.scheduled_standard_hours)
    END
  ) AS eff_std,
  COALESCE(r.half_day, false) AS half_day,
  (lk.id IS NOT NULL) AS shift_locked,
  r.shift_override,
  r.standard_hours_override,
  CASE WHEN org.fixed_shift_effective_from <= r.business_date THEN org.fixed_shift END AS fixed_shift
FROM ews.shift_roster r
LEFT JOIN ews.operator_rotation_group org ON org.serialnumber = r.serialnumber
LEFT JOIN ews.operator_shift_lock lk
       ON lk.serialnumber = r.serialnumber
      AND lk.cancelled_at IS NULL
      AND daterange(lk.effective_from, lk.lock_end, '[)') @> r.business_date
LEFT JOIN ews.operator_shift os_eff
       ON os_eff.shift_code = COALESCE(
         r.shift_override,
         lk.locked_shift,
         CASE WHEN org.fixed_shift_effective_from <= r.business_date THEN org.fixed_shift END,
         r.scheduled_shift
       )
LEFT JOIN public.usernfc u
       ON NULLIF(BTRIM(u.snssb), '') = r.serialnumber
WHERE u.inactive_from IS NULL OR r.business_date < u.inactive_from;

COMMENT ON COLUMN ews.operator_rotation_group.fixed_shift IS
  'Permanent DAY/NIGHT assignment; NULL follows A/B rotation.';
COMMENT ON COLUMN ews.operator_rotation_group.fixed_shift_effective_from IS
  'Forward-only date from which fixed_shift overrides rotation; protects historical roster.';
COMMENT ON COLUMN ews.shift_roster.shift_override IS
  'Per-operator per-day effective shift override.';
COMMENT ON COLUMN ews.shift_roster.standard_hours_override IS
  'Per-operator per-day exact target hours; takes precedence over half-day.';
