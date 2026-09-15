-- Bootstrap ews.operator_rotation_group from the observed shift pattern in the anchor week
-- (Sunday-week starting 2026-06-28). Group A = operators whose modal shift that week was Day;
-- Group B = Night. This matches rotation_config (anchor_group_a_shift = 'DAY').
-- Deviations / new hires are set manually later (foreman UI). Idempotent: only fills operators
-- not already assigned (does NOT overwrite manual corrections).

INSERT INTO ews.operator_rotation_group (serialnumber, rotation_group, source, effective_from)
SELECT x.op,
       CASE WHEN x.modal_shift = 1 THEN 'A' ELSE 'B' END AS rotation_group,
       'auto',
       DATE '2026-06-28'
FROM (
  SELECT NULLIF(BTRIM(t.serialnumber), '') AS op,
         mode() WITHIN GROUP (ORDER BY
           CASE WHEN (t.longdate_checkin AT TIME ZONE 'Asia/Makassar')::time >= TIME '07:00'
                 AND (t.longdate_checkin AT TIME ZONE 'Asia/Makassar')::time <  TIME '18:00'
                THEN 1 ELSE 2 END
         ) AS modal_shift
  FROM public.timesheet_transaction t
  WHERE (t.longdate_checkin AT TIME ZONE 'Asia/Makassar')::date >= DATE '2026-06-28'
    AND (t.longdate_checkin AT TIME ZONE 'Asia/Makassar')::date <  DATE '2026-07-05'
    AND COALESCE(t.state_flag, 0) <> 5
    AND COALESCE(t.duration, 0) > 0
    AND NULLIF(BTRIM(t.serialnumber), '') IS NOT NULL
  GROUP BY 1
) x
ON CONFLICT (serialnumber) DO NOTHING;
