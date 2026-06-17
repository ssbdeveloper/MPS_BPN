-- ====================================================
-- Migration: progress_update_history + sow.progress
--            + update vw_sow_orders with avg_progress
-- Date: 2026-03-11
-- Run against: ptssb database
-- Safe to run multiple times (idempotent)
-- ====================================================

-- 1. Create progress_update_history table
--    image_path stores a relative file path, e.g.
--    uploads/progress/ORD-00123/OP-10/1711995000000.jpg
CREATE TABLE IF NOT EXISTS progress_update_history (
    id                SERIAL PRIMARY KEY,
    operation_id      INTEGER      NOT NULL,
    order_no          VARCHAR(100),
    progress          INTEGER      NOT NULL CHECK (progress >= 1 AND progress <= 100),
    issue_description TEXT,
    image_path        VARCHAR(500),   -- relative path to uploaded file
    created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
    created_by        VARCHAR(100)
);

-- Handle tables created by previous version that used image_data column
DO $$
BEGIN
    -- Rename image_data → image_path if the old column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'progress_update_history'
           AND column_name = 'image_data'
    ) THEN
        ALTER TABLE progress_update_history
            RENAME COLUMN image_data TO image_path;
        ALTER TABLE progress_update_history
            ALTER COLUMN image_path TYPE VARCHAR(500);
    END IF;

    -- Add image_path if neither column exists yet (shouldn't happen, but safe)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'progress_update_history'
           AND column_name = 'image_path'
    ) THEN
        ALTER TABLE progress_update_history
            ADD COLUMN image_path VARCHAR(500);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_puh_operation_id ON progress_update_history(operation_id);
CREATE INDEX IF NOT EXISTS idx_puh_created_at   ON progress_update_history(created_at DESC);


-- 2. Add progress column to sow table
--    Stores the latest reported progress (0–100) for each operation row.
--    Updated by the API whenever a new progress_update_history record is inserted.
ALTER TABLE sow ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT NULL;


-- 3. Replace vw_sow_orders
--    avg_progress rules:
--      • only operations where planhours IS NOT NULL and planhours != 0
--      • exclude operations where workcenter contains 'OT' (overtime rows)
--      • use sow.progress directly (kept in sync by the API)
CREATE OR REPLACE VIEW public.vw_sow_orders AS
SELECT
    s.order_no,
    (ARRAY_AGG(s.idsow               ORDER BY s.operation_no))[1] AS idsow,
    (ARRAY_AGG(s.ssbr_id             ORDER BY s.operation_no))[1] AS ssbr_id,
    (ARRAY_AGG(s.part_number         ORDER BY s.operation_no))[1] AS part_number,
    (ARRAY_AGG(s.part_name           ORDER BY s.operation_no))[1] AS part_name,
    (ARRAY_AGG(s.model               ORDER BY s.operation_no))[1] AS model,
    (ARRAY_AGG(s.customer            ORDER BY s.operation_no))[1] AS customer,
    (ARRAY_AGG(s.location            ORDER BY s.operation_no))[1] AS location,
    (ARRAY_AGG(s.type                ORDER BY s.operation_no))[1] AS type,
    (ARRAY_AGG(s."group"             ORDER BY s.operation_no))[1] AS "group",
    (ARRAY_AGG(s.category            ORDER BY s.operation_no))[1] AS category,
    (ARRAY_AGG(s.status              ORDER BY s.operation_no))[1] AS status,
    (ARRAY_AGG(s.systemstatus        ORDER BY s.operation_no))[1] AS systemstatus,
    (ARRAY_AGG(s.confirmation        ORDER BY s.operation_no))[1] AS confirmation,
    (ARRAY_AGG(s.created_by          ORDER BY s.operation_no))[1] AS created_by,
    COUNT(*)                                                        AS operation_count,
    COALESCE(SUM(s.planhours), 0)                                  AS total_planhours,
    ROUND(
        AVG(
            CASE
                WHEN s.planhours IS NOT NULL
                 AND s.planhours::NUMERIC != 0
                 AND (s.workcenter IS NULL OR s.workcenter NOT ILIKE '%OT%')
                THEN s.progress
            END
        )::NUMERIC,
    1)                                                              AS avg_progress
FROM public.sow s
GROUP BY s.order_no;
