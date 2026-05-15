Saya ingin menambahkan fitur database notification berdasarkan remaining plan hours.

Sebelum membuat kode:
1. Inspect struktur project existing.
2. Inspect schema database PostgreSQL/migration/ORM yang dipakai.
3. Cari tabel:
   - sow
   - ph3_order
   - timesheet_transaction
   - notif atau notification table yang sudah ada
4. Jangan langsung ubah project existing sebelum memahami struktur.
5. Kalau belum ada tabel notif yang cocok, buat migration baru.
6. Ikuti pola migration/ORM yang sudah dipakai project.
7. Buat folder baru pada MPS2 ini namanya TTS Service

Business logic:


Buat materialized view yang menghitung remaining hours per order_no.

Sumber plan hours:
- Ambil dari table sow.
- Group by order_no.
- Sum kolom planhours.
- Ambil juga ssbr_id dan part_name dari table sow.

Filter order:
- Exclude order yang ada di table ph3_order dengan order_description TIDAK mengandung "TECO".
- Artinya hanya order yang order_description yang tidak mengandung "TECO" yang boleh dihitung.
- Gunakan ILIKE '%TECO%' agar case-insensitive.

Sumber actual hours:
- Ambil dari table timesheet_transaction.
- Group by order_no.
- Actual hours dihitung dari total durasi:
  longdate_checkout - longdate_checkin
- Convert duration menjadi hours.
- Abaikan row yang longdate_checkin atau longdate_checkout null.

Remaining hours:
- remaining_hours = total_planhours - total_actual_hours

Jika remaining_hours <= 0:
- Generate record ke table notif.
- Data notif mengambil:
  - order_no
  - ssbr_id dari sow
  - part_name dari sow
  - total_planhours
  - total_actual_hours
  - remaining_hours
  - status default pending
  - created_at current timestamp

Requirement SQL:

1. Buat materialized view, contoh nama:
   mv_order_remaining_hours

Kolom minimal:
- order_no
- ssbr_id
- part_name
- total_planhours
- total_actual_hours
- remaining_hours
- is_exceeded

2. Buat unique index pada materialized view:
   order_no

3. Buat query refresh:
   REFRESH MATERIALIZED VIEW CONCURRENTLY mv_order_remaining_hours;

4. Buat function/procedure untuk generate notif:
   generate_remaining_hours_notifications()

Function ini:
- Insert ke table notif dari mv_order_remaining_hours
- Hanya insert row yang remaining_hours <= 0
- Jangan duplicate notif untuk order_no yang sama
- Gunakan ON CONFLICT atau NOT EXISTS sesuai struktur table notif

5. Buat migration SQL lengkap.

6. Buat command/service/job untuk:
   - refresh materialized view
   - run generate notif
   - bisa dipanggil manual
   - bisa dijalankan scheduler/cron

Important:
- Pastikan query aman kalau actual hours belum ada. Gunakan COALESCE actual_hours = 0.
- Pastikan planhours numeric.
- Jika ada multiple row sow untuk order_no yang sama, sum planhours tapi ssbr_id dan part_name harus diambil secara deterministik. Jika tidak unik, gunakan MIN atau STRING_AGG, lalu jelaskan pilihan.
- Jika nama kolom berbeda dari asumsi, sesuaikan dengan schema existing.
- Jangan hardcode kalau project sudah punya naming convention berbeda.

Catatan penting untuk implementasi:

Pada table ph3_order, kolom order_no memiliki prefix "00" di depan nilai order number.

Contoh:
ph3_order.order_no = '00012345'
sedangkan di table lain bisa menjadi:
sow.order_no = '12345'

Saat melakukan JOIN, comparison, grouping, atau filtering berdasarkan order_no:
- Abaikan leading zero di depan order_no.
- Gunakan normalisasi:
  LTRIM(order_no, '0')
- Jangan gunakan CAST ke integer/bigint.
- Jangan gunakan TRIM biasa.
- Pastikan logic tetap aman jika order_no bertipe text/varchar.

Contoh implementasi yang diharapkan:

ON LTRIM(p.order_no, '0') = LTRIM(s.order_no, '0')

atau jika table lain sudah bersih:

ON LTRIM(p.order_no, '0') = s.order_no

Jika query besar dan join ini sering dipakai:
- Pertimbangkan generated column atau expression index:
  CREATE INDEX ... ON ph3_order (LTRIM(order_no, '0'));

Gunakan pendekatan ini di seluruh query/materialized view/function yang berhubungan dengan order_no.


Deliverables:
1. Migration SQL.
2. Materialized view.
3. Index untuk concurrent refresh.
4. Function/procedure insert notif.
5. Job/command untuk refresh dan generate notif.
6. Unit/integration test query jika project mendukung testing.
7. README singkat cara menjalankan refresh dan generate notif.