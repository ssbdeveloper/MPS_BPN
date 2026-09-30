# jobs/sap_staging/legacy

Script di folder ini BUKAN jalur produksi. Disimpan hanya sebagai arsip/referensi.

Jalur timesheet produksi sejak 2026-09-30: `run_timesheet_etl.py` (ETL berlapis
capture -> cleaned -> allocated -> sap_ready -> publish) + `post_sap_staging.py`.

| Script | Status |
|---|---|
| stage_timesheet_transaction.py, stage_batching.py, stage_cutoff.py | Stager cursor lama (sap-stage-ts-worker). Diganti run_timesheet_etl. |
| rebuild_pending.py | Aksi UI rebuild_pending (memanggil stager lama). Dinonaktifkan di ops_worker. |
| preview_allocation_invariant.py, verify_fetch_rows_readonly.py | Alat verifikasi stager lama. |
| backfill_*.py, repair_*.py, remedy_missing_ztimesheetid.py | Perbaikan data sekali pakai (Sep 2026). Sudah dijalankan. |
| seed_sap_staging_manual.py | Seed manual lama. |
| test_*.py | Test untuk script di atas. |

Modul bersama (sap_staging_common, timesheet_*) ada di folder induk. Jalankan dengan
`PYTHONPATH=..`, mis. `cd jobs/sap_staging/legacy && PYTHONPATH=.. python -m unittest test_stage_batching`.
