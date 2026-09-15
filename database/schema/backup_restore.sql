-- =====================================================
-- BACKUP SCRIPT
-- Jalankan sebelum rebuild/deploy
-- =====================================================

BEGIN;

-- Create backup schema if not exists
CREATE SCHEMA IF NOT EXISTS backup;

-- Backup with timestamp
DO $$
DECLARE
    backup_suffix TEXT := to_char(now(), 'YYYYMMDD_HH24MISS');
BEGIN
    -- Backup SOW
    EXECUTE format('DROP TABLE IF EXISTS backup.sow_%s', backup_suffix);
    EXECUTE format('CREATE TABLE backup.sow_%s AS SELECT * FROM public.sow', backup_suffix);
    
    -- Backup Parts
    EXECUTE format('DROP TABLE IF EXISTS backup.parts_%s', backup_suffix);
    EXECUTE format('CREATE TABLE backup.parts_%s AS SELECT * FROM public.parts', backup_suffix);
    
    -- Backup Operations
    EXECUTE format('DROP TABLE IF EXISTS backup.operations_%s', backup_suffix);
    EXECUTE format('CREATE TABLE backup.operations_%s AS SELECT * FROM public.operations', backup_suffix);
    
    -- Backup Timesheet
    EXECUTE format('DROP TABLE IF EXISTS backup.timesheet_transaction_%s', backup_suffix);
    EXECUTE format('CREATE TABLE backup.timesheet_transaction_%s AS SELECT * FROM public.timesheet_transaction', backup_suffix);
    
    -- Backup User NFC
    EXECUTE format('DROP TABLE IF EXISTS backup.usernfc_%s', backup_suffix);
    EXECUTE format('CREATE TABLE backup.usernfc_%s AS SELECT * FROM public.usernfc', backup_suffix);
    
    -- Backup Process Control Data
    EXECUTE format('DROP TABLE IF EXISTS backup.processcontroldata_%s', backup_suffix);
    EXECUTE format('CREATE TABLE backup.processcontroldata_%s AS SELECT * FROM public.processcontroldata', backup_suffix);
    
    EXECUTE format('DROP TABLE IF EXISTS backup.processcontroldata_item_%s', backup_suffix);
    EXECUTE format('CREATE TABLE backup.processcontroldata_item_%s AS SELECT * FROM public.processcontroldata_item', backup_suffix);
    
    RAISE NOTICE 'Backup completed with suffix: %', backup_suffix;
END $$;

COMMIT;

-- =====================================================
-- RESTORE SCRIPT
-- Gunakan untuk restore dari backup tertentu
-- Ganti 'YYYYMMDD_HH24MISS' dengan timestamp backup yang mau di-restore
-- =====================================================

-- BEGIN;
-- 
-- -- Restore SOW
-- TRUNCATE public.sow CASCADE;
-- INSERT INTO public.sow SELECT * FROM backup.sow_20241223_150000;
-- 
-- -- Restore Parts
-- TRUNCATE public.parts CASCADE;
-- INSERT INTO public.parts SELECT * FROM backup.parts_20241223_150000;
-- 
-- -- Restore Operations (akan ke-cascade karena FK)
-- INSERT INTO public.operations SELECT * FROM backup.operations_20241223_150000;
-- 
-- -- Restore Timesheet
-- TRUNCATE public.timesheet_transaction CASCADE;
-- INSERT INTO public.timesheet_transaction SELECT * FROM backup.timesheet_transaction_20241223_150000;
-- 
-- -- Dan seterusnya...
-- 
-- COMMIT;

-- =====================================================
-- LIST BACKUPS
-- =====================================================
SELECT 
    table_name,
    pg_size_pretty(pg_total_relation_size('backup.' || table_name)) as size,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'backup' AND table_name = t.table_name) as columns
FROM information_schema.tables t
WHERE table_schema = 'backup'
ORDER BY table_name DESC;

-- =====================================================
-- CLEANUP OLD BACKUPS (older than 30 days)
-- =====================================================
-- DO $$
-- DECLARE
--     r RECORD;
-- BEGIN
--     FOR r IN 
--         SELECT table_name 
--         FROM information_schema.tables 
--         WHERE table_schema = 'backup'
--         AND table_name ~ '^\w+_\d{8}_\d{6}$'
--     LOOP
--         -- Extract date from table name and check if older than 30 days
--         IF to_date(substring(r.table_name from '\d{8}'), 'YYYYMMDD') < CURRENT_DATE - INTERVAL '30 days' THEN
--             EXECUTE format('DROP TABLE IF EXISTS backup.%I', r.table_name);
--             RAISE NOTICE 'Dropped old backup: %', r.table_name;
--         END IF;
--     END LOOP;
-- END $$;