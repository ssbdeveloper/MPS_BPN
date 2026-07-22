-- Lapis 1a (pendukung) — indeks (machineno, startdatetime, proddataid).
--
-- Dibutuhkan oleh recompute_end_effective di etl_mch_transaction_v3.py: mencari "satu
-- baris sebelum baris tersentuh paling awal" per mesin (LATERAL ... ORDER BY startdatetime
-- DESC LIMIT 1) dan memindai lingkup per mesin. Tanpa indeks ini keduanya jadi seq scan
-- atas ~489k baris SETIAP run ETL.
--
-- Indeks yang sudah ada tidak menutupi kebutuhan ini: pkey hanya (proddataid), dua indeks
-- SAP di-partial dan diurut startdatetime saja (tanpa machineno), dan idx_..._status_record_false
-- hanya (machineno) untuk baris status_record = false.
--
-- proddataid ikut di kolom ketiga karena urutan baku kita adalah (startdatetime, proddataid)
-- — dua baris bisa mulai pada detik yang sama, dan tanpa pemecah seri yang stabil hasil
-- LEAD bisa berbeda antar-run.

CREATE INDEX IF NOT EXISTS idx_mch_transaction_machine_time
  ON public.mch_transaction (machineno, startdatetime, proddataid);
