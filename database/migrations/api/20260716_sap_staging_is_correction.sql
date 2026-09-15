-- Bundel KOREKSI: segmen yang datang SETELAH hari-kuncinya sudah ter-POST ke SAP.
--
-- MASALAH (bundling harian): satu bundel = total satu hari per kunci. Kalau user melengkapi
-- record yang tadinya tak-layak di hari yang SUDAH ter-post, kuncinya menabrak bundel POSTED
-- yang beku (ON CONFLICT WHERE status='PENDING' melewatinya) -> jam-nya nyangkut, tak dobel
-- tapi juga tak terkirim.
--
-- SOLUSI: segmen baru itu TIDAK dipaksa masuk bundel beku. Dia jadi bundel KOREKSI terpisah
-- (source_key beda: memuat penanda 'KOREKSI' + hash proddataid). Karena konfirmasi SAP ADITIF,
-- posting koreksi = menambah jam ke order yang sama -> total benar, tanpa storno, tanpa tabrak.
--
-- is_correction = TRUE menandai bundel ini. Auto-poster MELEWATINYA (post_sap_staging
-- claim_rows filter is_correction=false); koreksi di-post MANUAL dari UI oleh admin.
--
-- Runner membungkus transaksi — jangan tulis BEGIN/COMMIT.

ALTER TABLE public.sap_timesheet_staging
  ADD COLUMN IF NOT EXISTS is_correction boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sap_timesheet_staging.is_correction IS
  'TRUE = bundel koreksi (segmen yang datang setelah hari-kuncinya ter-POST). Di-post MANUAL '
  'dari UI, tidak oleh auto-poster. SAP aditif -> menambah jam ke order tanpa storno.';

-- Auto-poster memfilter is_correction=false; UI koreksi memfilter is_correction=true.
CREATE INDEX IF NOT EXISTS idx_sap_staging_is_correction
  ON public.sap_timesheet_staging (is_correction, status, bucket_start);
