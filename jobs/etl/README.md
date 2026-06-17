# ETL Jobs

Domain ini untuk sinkronisasi PostgreSQL lokal, SQL Server machine data, dan transformasi `mch_transaction`.

## Commands

```powershell
python etl_sync_v2.py
python etl_mch_transaction.py --dry-run
python etl_mch_transaction_v2.py --dry-run
python etl_machinehours.py --dry-run
```

Script aktif membaca `.env` dari root repo jika tersedia.
