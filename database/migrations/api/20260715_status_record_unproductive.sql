-- Redefinisi status_record: unproductive TIDAK butuh confirmation_number.
--
-- LATAR: definisi lama menandai record layak HANYA bila order+operasi+operator+
-- confirmation SEMUA ada (atau statusid 0/3/4). Itu salah untuk record UNPRODUCTIVE
-- (LSTAR / activity type seperti Coffee Break, Idle, Setting non-order): mereka dibukukan
-- ke cost center / activity type, BUKAN ke order — jadi tak perlu confirmation. Keputusan
-- owner 2026-07-15: unproductive layak cukup dengan operator + activity type.
--
-- ATURAN BARU (satu sumber kebenaran; gerbang staging & dashboard ikut ini):
--   status_record = TRUE bila:
--     • statusid IN (0,3,4)  (Off/Downtime/NoJob — sah tanpa job), ATAU
--     • PRODUCTIVE (status_activitytype M1/M2): order+operasi+operator+confirmation ada, ATAU
--     • UNPRODUCTIVE (punya activity type, bukan M1/M2): operator ada (TANPA confirmation).
--
-- Ini juga MEMPERBAIKI EWS accuracy_machine: record unproductive dengan operator yang
-- dulu salah dihitung "incomplete" (karena tak ada confirmation) kini benar = complete.
--
-- Catatan: nuansa promosi idle->M2 (statusid 2 + prev 1 + <=300s) TIDAK dimasukkan ke
-- kolom completeness ini — itu transformasi khusus staging, ditangani di gerbang
-- stage_sap_timesheet.py, bukan di sini.
--
-- Generated STORED -> rewrite tabel sekali (lock). Jalankan off-peak.
-- Runner membungkus transaksi — jangan tulis BEGIN/COMMIT.

-- DROP kolom lama (index dependennya ikut terhapus otomatis).
ALTER TABLE public.mch_transaction DROP COLUMN IF EXISTS status_record;

ALTER TABLE public.mch_transaction
  ADD COLUMN status_record boolean
  GENERATED ALWAYS AS (
    statusid IN (0, 3, 4)
    OR (
      -- PRODUCTIVE: butuh order + operasi + operator + confirmation
      status_activitytype IN ('M1', 'M2')
      AND NULLIF(btrim(order_no), '')            IS NOT NULL
      AND NULLIF(btrim(operation_no), '')        IS NOT NULL
      AND NULLIF(btrim(sn_employee), '')         IS NOT NULL
      AND NULLIF(btrim(confirmation_number), '') IS NOT NULL
    )
    OR (
      -- UNPRODUCTIVE: punya activity type (LSTAR) + operator; TANPA confirmation
      NULLIF(btrim(status_activitytype), '') IS NOT NULL
      AND status_activitytype NOT IN ('M1', 'M2')
      AND NULLIF(btrim(sn_employee), '') IS NOT NULL
    )
  ) STORED;

COMMENT ON COLUMN public.mch_transaction.status_record IS
  'TRUE = record layak. statusid 0/3/4 (sah tanpa job), ATAU productive (M1/M2) dgn '
  'order+operasi+operator+confirmation, ATAU unproductive (activity type) dgn operator '
  '(tanpa confirmation). Basis accuracy_machine + kelayakan SAP (kecuali 0/3/4 dikecualikan staging).';

CREATE INDEX IF NOT EXISTS idx_mch_transaction_status_record_false
  ON public.mch_transaction (machineno) WHERE status_record = false;
