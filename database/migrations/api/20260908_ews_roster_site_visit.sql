-- EWS roster: tambah status SITE_VISIT (site visit = absence yang dibolehkan,
-- setara PERMIT — operator sedang bekerja di luar site, tidak akan clock-in).
--
-- Keputusan user 2026-09-08: 3a (masuk grup excused).
-- Di-apply manual ke CKP (5441) & BPN (5434) + dicatat di schema_migrations.
-- Idempotent: aman dijalankan ulang.

ALTER TABLE ews.shift_roster
  DROP CONSTRAINT IF EXISTS shift_roster_status_check,
  ADD CONSTRAINT shift_roster_status_check
    CHECK (status = ANY (ARRAY['SCHEDULED'::text, 'OFF'::text, 'LEAVE'::text,
                            'SICK'::text, 'PERMIT'::text, 'SITE_VISIT'::text]));
