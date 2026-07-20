-- EWS roster override — Phase 1, Step 1: ews.operator_shift_lock (shift-lock STORAGE ONLY).
--
-- Pins an operator to DAY or NIGHT for N weeks, immune to the weekly crew flip. Applied at
-- READ time later by the VIEW ews.roster_effective (NOT created here). shift_roster stays
-- immutable — this table never writes it. VIEW, the 2 reader switches (getRoster / adoption /
-- dispatcher), endpoint, UI, and validation queries are SEPARATE later steps.
-- Design ref: docs/planning/ews-roster-feature.md §11.1.
--
-- Gate findings (2026-07-20), all [READ] against this repo/DB:
--  - operator_shift PK = shift_code (single-column unique) -> FK below is valid; the VIEW join
--    "os ON shift_code = locked_shift" is not a fan-out.
--  - btree_gist available (1.7) but NOT installed (pg_extension has pg_trgm/pgcrypto/plpgsql only).
--    Trusted in PG15 -> installed below. Needs CREATE-on-database (same as existing trusted exts);
--    if the app DB user lacks it, an admin must install btree_gist first.
--  - lock_end MATERIALIZED as a plain stored column (Gate 1 = option a). It is effective_from +
--    lock_weeks*7 snapped to rotation_config.week_start_dow, computed by the ENDPOINT (later step) —
--    single source for the week-snap. A GENERATED column can't reference rotation_config, so it
--    would hardcode week_start_dow and duplicate it; rejected.
--  - No cancelled_at soft-delete exists elsewhere in ews (status enums used instead). cancelled_at
--    here is new and forward-safe (never mutates frozen ews.kpi_snapshot).
--  - Runner (database/migrate.js) is UP-ONLY and wraps its own transaction. No BEGIN/COMMIT written
--    here (per runner header). Rollback is a COMMENTED block at the end for manual use — a separate
--    live .sql in migrations/api/ would be wrongly applied as a forward migration.
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS ews.operator_shift_lock (
  id             bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  serialnumber   text    NOT NULL,
  locked_shift   text    NOT NULL REFERENCES ews.operator_shift(shift_code),  -- FK: only a real shift; stops the VIEW's COALESCE from silently falling back to frozen std
  effective_from date    NOT NULL,
  lock_weeks     integer NOT NULL CHECK (lock_weeks > 0),
  lock_end       date    NOT NULL,                                            -- effective_from + lock_weeks*7, snapped to week_start_dow; set by the endpoint (later step)
  created_by     text    NOT NULL,
  cancelled_at   timestamptz,                                                 -- soft-cancel (forward-safe; NULL = active)
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- Guard the range so daterange() never errors and a lock always spans >= 1 day.
  CONSTRAINT operator_shift_lock_end_after_start CHECK (lock_end > effective_from),

  -- Anti-overlap: no two ACTIVE (non-cancelled) locks for the same operator may cover overlapping
  -- date ranges. Soft-cancel makes overlapping non-cancelled locks trivial to create, and an overlap
  -- fans out the VIEW's range LEFT JOIN -> double-counts the adoption denominator. A plain UNIQUE
  -- cannot catch range overlap. This EXCLUDE's backing GiST index ALSO serves the read-path
  -- containment (serialnumber = ? AND daterange(effective_from, lock_end,'[)') @> business_date),
  -- so no separate btree index is created.
  CONSTRAINT operator_shift_lock_no_overlap
    EXCLUDE USING gist (
      serialnumber                                WITH =,
      daterange(effective_from, lock_end, '[)')   WITH &&
    ) WHERE (cancelled_at IS NULL)
);

-- ============================================================================================
-- ROLLBACK (MANUAL — runner is up-only; DO NOT save this block as a live .sql in migrations/api/).
-- Run by hand to undo this migration:
--
--   DROP TABLE IF EXISTS ews.operator_shift_lock;          -- drops the table + its constraints/index
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260720_ews_operator_shift_lock.sql';
--   -- btree_gist is left installed (harmless, may back future constraints). Drop ONLY if certainly
--   -- unused elsewhere:
--   -- DROP EXTENSION IF EXISTS btree_gist;
-- ============================================================================================
