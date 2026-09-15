-- NFC workforce roles: legacy USER/ADMINISTRATOR become SSB/OUTSOURCE.
-- Idempotent and intentionally leaves FOREMAN, SUBCONT, NULL, and empty values unchanged.
UPDATE public.usernfc
SET roles = CASE upper(trim(roles))
  WHEN 'USER' THEN 'SSB'
  WHEN 'ADMINISTRATOR' THEN 'OUTSOURCE'
  ELSE roles
END
WHERE upper(trim(roles)) IN ('USER', 'ADMINISTRATOR');
