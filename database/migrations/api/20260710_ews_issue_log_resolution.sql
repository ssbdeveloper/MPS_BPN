-- 20260710_ews_issue_log_resolution.sql
-- Closing an EWS issue must record WHY. Until now resolve() only flipped `status`, so a resolved
-- issue carried no justification and a human close was indistinguishable from a system close.
--
-- resolution_note is REQUIRED for any resolved row, enforced by a CHECK rather than only in the
-- API — otherwise a direct UPDATE (or a future endpoint) can still close an issue silently.
-- The auto-resolver supplies its own note, so it satisfies the same rule.
--
-- Existing resolved rows predate the column, so they are backfilled BEFORE the constraint is
-- added; adding it first would fail on them.

BEGIN;

ALTER TABLE ews.issue_log
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolved_by     text;

COMMENT ON COLUMN ews.issue_log.resolution_note IS
  'Free-text justification / corrective action. Mandatory for any resolved row (see CHECK).';
COMMENT ON COLUMN ews.issue_log.resolved_by IS
  'Who closed it: a user id, or ''system'' when the business day rolled over.';

-- Backfill: distinguish the rows the auto-resolver closed from the ones closed before this rule.
UPDATE ews.issue_log
SET resolution_note = CASE
      WHEN COALESCE(detail ->> 'auto_resolved', 'false') = 'true'
        THEN 'Auto-resolved: business day rolled over.'
      ELSE 'Backfilled: closed before a justification was required.'
    END,
    resolved_by = CASE
      WHEN COALESCE(detail ->> 'auto_resolved', 'false') = 'true' THEN 'system'
      ELSE 'unknown'
    END
WHERE status = 'resolved'
  AND NULLIF(BTRIM(COALESCE(resolution_note, '')), '') IS NULL;

ALTER TABLE ews.issue_log
  DROP CONSTRAINT IF EXISTS issue_log_resolution_note_required;

ALTER TABLE ews.issue_log
  ADD CONSTRAINT issue_log_resolution_note_required
  CHECK (status <> 'resolved' OR NULLIF(BTRIM(resolution_note), '') IS NOT NULL);

COMMIT;
