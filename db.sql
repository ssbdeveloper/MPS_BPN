-- Tabel 1: Parts (Master Part)
CREATE TABLE parts (
    part_id SERIAL PRIMARY KEY,
    partnumber VARCHAR(50) UNIQUE NOT NULL,
    partname VARCHAR(200) NOT NULL,
    model VARCHAR(100) NOT NULL,
    drawing_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel 2: Operations (Detail Operasi per Part)
CREATE TABLE operations (
    operation_id SERIAL PRIMARY KEY,
    part_id INT REFERENCES parts(part_id) ON DELETE CASCADE,
    opr_no INT NOT NULL,
    operationtext TEXT NOT NULL,
    wct_group VARCHAR(50),
    workcenter VARCHAR(50),
    planhours DECIMAL(5,2),
    drawing_path TEXT,
    remark TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(part_id, opr_no)
);

-- Index untuk performa search
CREATE INDEX idx_parts_partnumber ON parts(partnumber);
CREATE INDEX idx_parts_partname ON parts(partname);
CREATE INDEX idx_parts_model ON parts(model);
CREATE INDEX idx_operations_part_id ON operations(part_id);
CREATE INDEX idx_operations_drawing_path ON operations(drawing_path);

-- Trigger untuk auto update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_parts_updated_at BEFORE UPDATE ON parts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_operations_updated_at BEFORE UPDATE ON operations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();





-- 1. Search by partnumber
SELECT 
    p.*,
    COUNT(o.operation_id) as total_operations,
    SUM(o.planhours) as total_hours
FROM parts p
LEFT JOIN operations o ON p.part_id = o.part_id
WHERE p.partnumber ILIKE '%PN-001%'
GROUP BY p.part_id;

-- 2. Search by partname atau model
SELECT 
    p.*,
    COUNT(o.operation_id) as total_operations
FROM parts p
LEFT JOIN operations o ON p.part_id = o.part_id
WHERE p.partname ILIKE '%cylinder%' OR p.model ILIKE '%cat%'
GROUP BY p.part_id;

-- 3. Get detail part dengan semua operasinya
SELECT 
    p.partnumber,
    p.partname,
    p.model,
    p.drawing_path as part_drawing,
    o.opr_no,
    o.operationtext,
    o.wct_group,
    o.workcenter,
    o.planhours,
    o.drawing_path as operation_drawing,
    o.remark
FROM parts p
JOIN operations o ON p.part_id = o.part_id
WHERE p.partnumber = 'PN-001'
ORDER BY o.opr_no;

-- 4. Cek drawing mana yang dipakai di multiple operasi
SELECT 
    p.partnumber,
    p.partname,
    o.drawing_path,
    COUNT(*) as usage_count,
    STRING_AGG(o.opr_no::TEXT || '-' || o.operationtext, ' | ' ORDER BY o.opr_no) as operations
FROM operations o
JOIN parts p ON o.part_id = p.part_id
WHERE o.drawing_path IS NOT NULL
GROUP BY p.partnumber, p.partname, o.drawing_path
HAVING COUNT(*) > 1
ORDER BY p.partnumber, usage_count DESC;

-- 5. Summary per workcenter
SELECT 
    o.workcenter,
    COUNT(*) as total_operations,
    SUM(o.planhours) as total_hours,
    AVG(o.planhours) as avg_hours
FROM operations o
GROUP BY o.workcenter
ORDER BY total_hours DESC;

-- 6. Get operations by part_id (untuk API)
SELECT * FROM operations 
WHERE part_id = 1 
ORDER BY opr_no;


--- itung weight ---
UPDATE sow s
SET weight = sub.weight
FROM (
    SELECT 
        idsow,
        (planhours / NULLIF(SUM(planhours) OVER (PARTITION BY order_no), 0)) AS weight
    FROM sow
) sub
WHERE s.idsow = sub.idsow;



--masukin data sow ke database sow baru
BEGIN;

-- Clear existing data (optional, kalau mau fresh start)
-- TRUNCATE operations CASCADE;
-- TRUNCATE parts CASCADE;

-- Migrate parts
INSERT INTO parts (partnumber, partname, model)
SELECT DISTINCT 
    s.part_number,
    s.part_name,
    s.model
FROM sow s
WHERE s.part_number <> '' 
  AND s.part_number IS NOT NULL
  AND s.model <> '' 
  AND s.model IS NOT NULL
ON CONFLICT (partnumber) DO NOTHING;

-- Migrate operations
INSERT INTO operations (part_id, opr_no, operationtext, workcenter, planhours, remark)
SELECT 
    p.part_id,
    s.operation_no,
    COALESCE(s.operationtext, ''),
    s.workcenter,
    s.planhours,
    NULLIF(s.remark, '[NULL]')
FROM sow s
JOIN parts p ON s.part_number = p.partnumber
WHERE s.part_number <> '' 
  AND s.part_number IS NOT NULL
  AND s.model <> '' 
  AND s.model IS NOT NULL
ON CONFLICT (part_id, opr_no) DO NOTHING;

-- Check hasil
SELECT 'Migration completed' as status,
       (SELECT COUNT(*) FROM parts) as total_parts,
       (SELECT COUNT(*) FROM operations) as total_operations;

COMMIT;
-- Kalau ada error, otomatis ROLLBACK




-- update group ---
UPDATE sow s
SET "group" = sub.grp
FROM (
    SELECT 
        idsow,
        ssbr_id,
        order_no,
        DENSE_RANK() OVER (
            PARTITION BY ssbr_id 
            ORDER BY order_no
        ) AS grp
    FROM sow
) sub
WHERE s.idsow = sub.idsow;
