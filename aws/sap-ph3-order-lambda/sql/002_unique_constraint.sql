-- Check duplicate rows before adding the unique constraint.
-- Also inspect existing unique constraints. If ph3_order_confirmation_number_key
-- exists, it can conflict with the new composite-key behavior.
SELECT
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.ph3_order'::regclass
  AND contype = 'u'
ORDER BY conname;

SELECT
  order_no,
  confirmation_number,
  operation_no,
  COUNT(*) AS total,
  ARRAY_AGG(id ORDER BY id) AS row_ids
FROM public.ph3_order
GROUP BY
  order_no,
  confirmation_number,
  operation_no
HAVING COUNT(*) > 1;

-- Simple cleanup option:
-- Keep the newest row by id, back up older duplicates, then physically remove
-- only those duplicate rows so the unique constraint can be created.
-- Review the duplicate query result before running this block.
CREATE TABLE IF NOT EXISTS public.ph3_order_duplicate_cleanup_backup
(LIKE public.ph3_order INCLUDING ALL);

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY order_no, confirmation_number, operation_no
      ORDER BY id DESC
    ) AS rn
  FROM public.ph3_order
)
INSERT INTO public.ph3_order_duplicate_cleanup_backup
SELECT p.*
FROM ranked r
JOIN public.ph3_order p ON p.id = r.id
WHERE r.rn > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY order_no, confirmation_number, operation_no
      ORDER BY id DESC
    ) AS rn
  FROM public.ph3_order
)
DELETE FROM public.ph3_order p
USING ranked r
WHERE p.id = r.id
  AND r.rn > 1;

-- Re-run the duplicate check after cleanup. This constraint will fail if any
-- duplicate key still remains.
ALTER TABLE public.ph3_order
ADD CONSTRAINT ph3_order_unique_order_confirmation_operation
UNIQUE (order_no, confirmation_number, operation_no);

-- Optional only if approved for the AWS target database:
-- Drop the old confirmation_number-only unique constraint when SAP may send the
-- same confirmation_number across different order/operation keys. Do not run
-- this on a database that still uses legacy ON CONFLICT (confirmation_number)
-- jobs without updating those jobs first.
--
-- ALTER TABLE public.ph3_order
-- DROP CONSTRAINT IF EXISTS ph3_order_confirmation_number_key;
