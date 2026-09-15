-- Izinkan action 'post_corrections' di antrian sap_ops_request.
-- UI mem-post bundel koreksi (is_correction) manual -> endpoint menitip permintaan
-- dengan params.ids -> ops_worker menjalankan post_sap_staging.py --ids <ids>.
--
-- Runner membungkus transaksi — jangan tulis BEGIN/COMMIT.

ALTER TABLE public.sap_ops_request DROP CONSTRAINT IF EXISTS sap_ops_request_action_ck;
ALTER TABLE public.sap_ops_request
  ADD CONSTRAINT sap_ops_request_action_ck
  CHECK (action IN ('stage_catchup', 'retry_failed', 'post_corrections'));
