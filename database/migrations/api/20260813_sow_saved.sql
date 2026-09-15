-- 2026-08-13: Saved SOW (snapshot durable, bernama, shared) — "save SOW yang diedit, load ulang kapan pun".
-- Berbeda dari sow_draft (autosave ephemeral per user): sow_saved = snapshot penuh state create
-- (selectedPart/cardInfo/editOps+jam) yang bisa di-rename dan di-load lintas component (keputusan 1a/2a/3a).
-- Template standard (sow_templates) TIDAK disentuh.
CREATE TABLE IF NOT EXISTS sow_saved (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  component_id INTEGER,
  payload      JSONB NOT NULL,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sow_saved_name ON sow_saved (lower(name));
