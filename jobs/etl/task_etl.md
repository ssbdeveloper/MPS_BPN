Buatkan saya Python script untuk update data SQL Server berdasarkan lookup dari PostgreSQL.

Koneksi SQL Server:
- Host: 10.169.2.76
- Port: 61142
- Username: tag
- Password: @dminta9
- Database: SSB_OEE

Koneksi PostgreSQL:
- Host: 10.169.1.12
- Port: 5433
- Username: tag
- Password: @dminta9
- Database: ptssb

Requirement:
1. Ambil data dari SQL Server table ProductionData.
2. Filter data:
   - JobID <> ''
   - JobID diawali angka 1 atau 3
3. Untuk setiap row ProductionData:
   - Lookup ke PostgreSQL table timesheet_transaction
   - Kondisi:
     - timesheet_transaction.order_no = ProductionData.JobID
   - Cocokkan waktu:
     - ProductionData.StartDateTime
     - timesheet_transaction.longdate_checkin
   - Pilih row timesheet_transaction dengan longdate_checkin paling mendekati StartDateTime.
4. Dari hasil lookup timesheet_transaction, ambil:
   - order_no
   - operation_no
5. Lookup ke PostgreSQL table ph3_order dengan kondisi:
   - ph3_order.order_no = timesheet_transaction.order_no
   - ph3_order.operation_no = timesheet_transaction.operation_no
6. Ambil nilai:
   - ph3_order.confirmation_number
7. Update SQL Server table ProductionData:
   - SET JobID = confirmation_number
   - WHERE ProdDataID = row ProductionData yang sedang diproses
8. Script harus aman:
   - Menggunakan parameterized query
   - Ada logging jumlah row diproses, berhasil update, gagal update, dan skipped
   - Ada error handling
   - Tidak update jika confirmation_number tidak ditemukan
   - Ada mode dry-run agar bisa cek hasil tanpa update
   - Bisa dijalankan via `python etl_machine_conf.py`
9. Sertakan contoh instalasi package Python yang dibutuhkan.
10. Gunakan file hardcoded untuk credential.

Gunakan package:
- pyodbc untuk SQL Server
- psycopg2-binary untuk PostgreSQL
- menggunakan venv

Tolong buatkan struktur file:
- requirements.txt
- etl_machine_conf.py


# Aktivasi venv & install (kalau belum)
D:\website\MPS2\jobs\\.venv\Scripts\activate
. venv/bin/activate
pip install -r requirements.txt
# Dry-run — lihat hasil tanpa update
python etl_machine_conf.py --dry-run
# Live run — eksekusi update
python etl_machine_conf.py

