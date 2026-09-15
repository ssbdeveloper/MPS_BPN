-- 20260709_sap_staging_pernr_origin.sql
-- Tambah kolom pernr_origin di sap_timesheet_staging.
--
-- Konteks: pada payload SAP, PERNR (SN karyawan) diganti menjadi '11009413' bila
-- usernfc.employee_category = 'Outsource'. Kolom pernr_origin menyimpan SN ASLI
-- (sebelum substitusi) supaya admin tetap bisa melihat karyawan sebenarnya.
-- pernr_origin TIDAK ikut dikirim ke SAP (hanya untuk audit lokal).
--
-- Target DB: SAP staging (SAP_STAGING_DB_* -> localhost:5434/ptssb).
-- Catatan: script staging juga self-migrate lewat ensure_staging_schema()
-- (ALTER ... ADD COLUMN IF NOT EXISTS), jadi menjalankan `stage_sap_timesheet.py init-db`
-- akan menerapkan perubahan yang sama. File ini untuk arsip / penerapan manual.

BEGIN;

ALTER TABLE sap_timesheet_staging
  ADD COLUMN IF NOT EXISTS pernr_origin text NOT NULL DEFAULT '';

COMMENT ON COLUMN sap_timesheet_staging.pernr_origin IS
  'SN karyawan asli sebelum substitusi Outsource (pernr dipaksa 11009413 untuk Outsource). Audit-only, tidak dikirim ke SAP.';

-- Backfill aman untuk baris lama: baris yang JELAS tidak tersubstitusi
-- (pernr <> 11009413) => pernr_origin = pernr. Baris Outsource lama yang sudah
-- terlanjur jadi 11009413 tidak bisa dipulihkan SN aslinya, dibiarkan '' (unknown).
-- Baris PENDING akan terisi benar otomatis saat re-stage berikutnya.
UPDATE sap_timesheet_staging
SET pernr_origin = pernr
WHERE pernr_origin = ''
  AND pernr <> '11009413';

COMMIT;
