-- 20260707_ms_project_status_lifecycle.sql
-- Lifecycle status sederhana untuk ms_project: DRAFT / ACTIVE / ARCHIVED.
-- Keputusan 2026-07-07: nilai lama 'TRIAL' (konvensi VBA lama) dipetakan ke DRAFT.
-- Idempotent: aman dijalankan ulang.
-- Prasyarat: 20260603_create_ms_project_core.sql (tabel ms_project).

BEGIN;

UPDATE ms_project SET status = 'DRAFT'  WHERE upper(coalesce(status, '')) = 'TRIAL';
UPDATE ms_project SET status = upper(status) WHERE status IS NOT NULL AND status <> upper(status);
UPDATE ms_project SET status = 'ACTIVE' WHERE status IS NULL OR status NOT IN ('DRAFT', 'ACTIVE', 'ARCHIVED');

ALTER TABLE ms_project ALTER COLUMN status SET DEFAULT 'ACTIVE';
ALTER TABLE ms_project ALTER COLUMN status SET NOT NULL;

ALTER TABLE ms_project DROP CONSTRAINT IF EXISTS chk_ms_project_status;
ALTER TABLE ms_project ADD CONSTRAINT chk_ms_project_status
  CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'));

COMMIT;
