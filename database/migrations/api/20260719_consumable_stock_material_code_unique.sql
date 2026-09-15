-- Consumable stock identity = material_code.
--
-- material_code is the ONLY key used to decide which stock row to read-for-check,
-- decrement (Phase 3), and Excel-upsert (Phase 4). code_mm stays as a search/display
-- code only — it is not guaranteed unique, so it must never key a mutation.
--
-- Enforce material_code as a real unique key so those mutations target exactly one row.
-- consumable_stock is empty in prod (verified 2026-07-19), so SET NOT NULL cannot fail
-- on existing rows. Runner wraps this in one transaction; do not add BEGIN/COMMIT.

ALTER TABLE public.consumable_stock
  ALTER COLUMN material_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.consumable_stock'::regclass
      AND conname = 'consumable_stock_material_code_key'
  ) THEN
    ALTER TABLE public.consumable_stock
      ADD CONSTRAINT consumable_stock_material_code_key UNIQUE (material_code);
  END IF;
END $$;
