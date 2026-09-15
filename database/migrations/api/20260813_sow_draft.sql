-- 2026-08-13: Draft autosave untuk Create SOW / Edit SOW history.
-- Satu baris per (user_key, context, ref_key) — autosave = UPSERT overwrite (keputusan 2a).
-- Payload JSONB = snapshot state FE apa adanya (selectedPart/cardInfo/editOps/operationCardImages/...).
-- NOTE: DDL ini juga di-ensure runtime via ensureSowDraftTable() di sowController.js
-- (pola sama dengan sow_revision_history) supaya deploy kode yang mendahului migrasi tetap jalan.
CREATE TABLE IF NOT EXISTS sow_draft (
  id         BIGSERIAL PRIMARY KEY,
  user_key   TEXT NOT NULL,
  context    TEXT NOT NULL,              -- 'create' | 'revision' | 'history-edit'
  ref_key    TEXT NOT NULL DEFAULT '',   -- order_no utk revision/history-edit; '' utk create
  payload    JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_key, context, ref_key)
);

CREATE INDEX IF NOT EXISTS idx_sow_draft_user_updated
  ON sow_draft (user_key, updated_at DESC);
