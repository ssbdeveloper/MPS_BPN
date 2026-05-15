# Component Tracking Data Flow

Dokumen ini menjelaskan tabel yang dipakai halaman `ComponentTrackingPage`, dari mana setiap value diambil, dan bagaimana perhitungannya dilakukan.

## File Terkait

- Frontend page: `react-timesheet/src/pages/PPC/ComponentTrackingPage.jsx`
- Frontend buffer page: `react-timesheet/src/pages/PPC/BufferTransactionPage.jsx`
- Frontend hook: `react-timesheet/src/hooks/useMachineTracking.js`
- Frontend service: `react-timesheet/src/services/machineTrackingService.js`
- Backend controller: `API/controllers/componentTrackingController.js`
- Backend route: `API/routes/componentTracking.js`
- Migration buffer: `db/migrations/20260502_component_tracking_buffers.sql`
- Seed buffer sample: `db/migrations/20260503_seed_buffer_transaction_from_sow.sql`
- Migration remove buffer quantity/unit: `db/migrations/20260503_remove_buffer_quantity_unit.sql`
- Migration field operasi buffer: `db/migrations/20260503_buffer_transaction_operation_fields.sql`
- Migration index query: `db/migrations/20260502_component_tracking_query_indexes.sql`

## Endpoint API

Halaman React tidak membaca Postgres langsung. React memanggil Express API:

- `GET /component-tracking/machines`
  - Dipakai untuk daftar card mesin.
  - Dipolling setiap 5 detik oleh `useMachineTracking`.

- `GET /component-tracking/machines/:machineId`
  - Dipakai saat card mesin diklik.
  - Mengambil detail buffer dan total hours per component.
  - Jika modal masih terbuka, detail juga dipolling setiap 5 detik.

- `GET /component-tracking/sow-operations`
  - Dipakai halaman `BufferTransactionPage`.
  - Mengambil daftar operation dari `sow`.
  - UI mengelompokkan data berdasarkan `order_no`.

- `GET /component-tracking/buffers`
  - Dipakai halaman `BufferTransactionPage`.
  - Bisa diberi query `machineId`.
  - Mengambil buffer distinct berdasarkan `order_no`.
  - Jika diberi query `history=true`, API mengembalikan semua record movement tanpa distinct.

- `POST /component-tracking/buffers`
  - Dipakai saat operation di-drag ke `Buffer In`, `Buffer Out`, atau `Moving`.
  - Membuat record baru di `buffer_transaction` agar riwayat movement tetap tersimpan.

- `PATCH /component-tracking/buffers/priorities`
  - Dipakai saat item dalam box yang sama di-reorder.
  - Mengupdate `priority` beberapa record buffer sekaligus.

- `PATCH /component-tracking/buffers/:id/note`
  - Dipakai modal Note untuk menyimpan catatan pada record buffer tertentu.

- `GET /component-tracking/buffer-history`
  - Dipakai modal History.
  - Filter berdasarkan `orderNo + operationNo`.
  - Mengembalikan semua movement operation tersebut di semua mesin.

## Tabel Yang Dipakai

### 1. `workcenter`

Dipakai sebagai master daftar mesin.

Kolom penting:

| Kolom | Fungsi |
| --- | --- |
| `machineid` | ID mesin yang ditampilkan di card. |
| `workcenternew` | Salah satu kode workcenter untuk mencocokkan transaksi timesheet. |
| `workcenterot` | Kode workcenter overtime, juga dipakai untuk matching. |
| `workcenterold` | Kode workcenter lama, juga dipakai untuk matching. |
| `workcenter_description` | Deskripsi mesin/workcenter yang tampil di card. |
| `groupname` | Metadata grouping mesin, tersedia dari API. |
| `condition` | Metadata kondisi mesin, tersedia dari API. |
| `position` | Urutan tampilan mesin. |

Mesin yang tampil hanya row dengan:

```sql
machineid IS NOT NULL AND TRIM(machineid) <> ''
```

### 2. `timesheet_transaction`

Dipakai untuk menentukan status running/idle, operator aktif, elapsed time, order aktif, part aktif, operation aktif, dan total hours.

Kolom penting:

| Kolom | Fungsi |
| --- | --- |
| `workcentercode` | Dicocokkan ke `workcenter.workcenternew`, `workcenterot`, `workcenterold`, atau `machineid`. |
| `longdate_checkin` | Waktu mulai kerja. |
| `longdate_checkout` | Waktu selesai kerja. Jika `NULL`, sesi dianggap masih aktif/running. |
| `full_name` | Nama operator/karyawan yang tampil di card. |
| `serialnumber` | Nomor operator/karyawan, tersedia dari API. |
| `order_no` | Order aktif di card dan join ke tabel order/SOW. |
| `operation_no` | Join ke `sow` untuk relasi komponen. |
| `part_name` | Nama part fallback jika komponen dari master tidak ketemu. |
| `operation_text` | Fallback label pekerjaan/komponen. |
| `activitytype` | Filter productive. Hanya `activitytype IS NULL` dihitung di total hours. |
| `duration` | Durasi jam tersimpan. Dipakai untuk total hours jika tersedia. |

Untuk daftar card, transaksi aktif **tidak lagi dicocokkan langsung lewat `workcentercode`**, karena satu `workcentercode` bisa dipakai banyak `machineid`. Contoh: welding `M5051WLS` bisa dipakai puluhan mesin welding.

Status running sekarang dicocokkan lewat `usernfc.machineid`.

### 3. `usernfc`

Dipakai untuk menghubungkan transaksi aktif ke mesin unik.

Kolom penting:

| Kolom | Fungsi |
| --- | --- |
| `snssb` | Dicocokkan ke `timesheet_transaction.serialnumber`. |
| `machineid` | Mesin unik operator saat ini, dicocokkan ke `workcenter.machineid`. |
| `workcenter` | Workcenter operator, hanya metadata/fallback di flow lain. |
| `machinename` | Nama mesin dari assignment operator. |

Matching transaksi aktif ke card mesin:

```sql
timesheet_transaction.serialnumber = usernfc.snssb
AND usernfc.machineid = workcenter.machineid
```

Alasan:

- `workcentercode` tidak unik terhadap mesin.
- `machineid` adalah identitas card.
- Dengan referensi `machineid`, satu transaksi aktif hanya membuat satu card mesin menjadi running.

Untuk agregasi detail/histori per mesin, query juga dibatasi dengan `usernfc.machineid = workcenter.machineid` agar konsisten dengan card.

### 4. Matching Workcenter Legacy

Beberapa query histori masih memakai kondisi workcenter sebagai pembatas tambahan:

```sql
t.workcentercode = w.workcenternew
OR t.workcentercode = w.workcenterot
OR t.workcentercode = w.workcenterold
OR t.workcentercode = w.machineid
```

Namun kondisi ini bukan lagi penentu utama running card. Penentu uniknya adalah `usernfc.machineid`.

### 5. `buffer_transaction`

Tabel baru untuk Buffer In / Buffer Out.

Dibuat oleh migration:

```text
db/migrations/20260502_component_tracking_buffers.sql
```

Kolom penting:

| Kolom | Fungsi |
| --- | --- |
| `id` | Primary key transaksi buffer. |
| `machine_id` | ID mesin, dicocokkan ke `workcenter.machineid`. |
| `type` | Jenis buffer: `in`, `out`, atau `moving`. |
| `component_id` | Optional FK ke `components.component_id`. |
| `component_label` | Nama komponen manual. Tidak digabung dengan order/SSBR/operation. |
| `order_no` | Production order dari SOW/operation yang masuk buffer. |
| `ssbr_id` | SSBR Ident dari SOW. |
| `operation_no` | Nomor operation dari SOW. |
| `operation_text` | Nama/teks operation dari SOW. |
| `priority` | Prioritas item dalam box. Angka kecil tampil lebih atas. Default `0`. |
| `timestamp` | Waktu transaksi buffer. |
| `reference_no` | Nomor referensi optional. |
| `note` | Catatan optional. |
| `created_at` | Waktu record dibuat/diupdate untuk sorting terbaru. |
| `updated_at` | Waktu update terakhir, terutama saat note/priority berubah. |

Jika tabel ini kosong, modal akan menampilkan pesan bahwa belum ada transaksi buffer.

Catatan schema:

- `quantity` dan `unit` sudah dihapus.
- Setiap row `buffer_transaction` merepresentasikan 1 komponen.
- UI tidak menampilkan jumlah/unit.
- Tidak ada unique index pada `order_no`, karena setiap perpindahan buffer harus menjadi record history baru.
- Data UI tetap di-dedupe dengan `Map` berdasarkan `order_no` untuk tampilan box, tetapi history memakai semua record.

Data contoh buffer dapat di-seed dari `sow` lewat:

```text
db/migrations/20260503_seed_buffer_transaction_from_sow.sql
```

Seed ini:

- mengambil row `sow` berdasarkan `sow.workcenter = workcenter.workcenternew`;
- membuat maksimal 4 transaksi buffer per `machineid`;
- mengisi `type` bergantian `in` dan `out`;
- mengisi `component_label` hanya dengan nama component/part;
- mengisi `order_no`, `ssbr_id`, `operation_no`, dan `operation_text` dari SOW;
- mengisi `reference_no` dengan format `SEED-SOW-{idsow}`;
- aman dijalankan ulang karena tidak insert lagi jika `reference_no` seed sudah ada.

### 6. `component_hours`

Tabel baru untuk menyimpan total hours manual/cache, dibuat oleh migration yang sama dengan `buffer_transaction`.

Namun untuk aturan terbaru, halaman ini **tidak memakai `component_hours` sebagai sumber utama total hours**. Total hours selalu dihitung ulang dari `timesheet_transaction` di sisi database supaya filter productive dan exclude TECO selalu akurat.

Tabel ini tetap ada untuk kebutuhan masa depan jika ingin menyimpan hasil kalkulasi periodik.

### 7. `sow`

Dipakai untuk mencari relasi order/operation ke komponen.

Join:

```sql
s.order_no = t.order_no
AND s.operation_no = t.operation_no
```

Kolom penting:

| Kolom | Fungsi |
| --- | --- |
| `order_no` | Dicocokkan ke `timesheet_transaction.order_no`. |
| `operation_no` | Dicocokkan ke `timesheet_transaction.operation_no`. |
| `part_number` | Dipakai untuk join ke `components`. |
| `part_name` | Nama part dari SOW, fallback label komponen. |
| `model` | Dipakai saat join ke `components`. |

### 8. `components`

Dipakai sebagai master komponen.

Join:

```sql
c.part_number = s.part_number
AND (c.model = s.model OR s.model IS NULL OR c.model IS NULL)
```

Kolom penting:

| Kolom | Fungsi |
| --- | --- |
| `component_id` | ID komponen master. |
| `part_name` | Nama komponen master. |
| `part_number` | Nomor part untuk join dari `sow`. |
| `model` | Model untuk mempersempit join. |

Jika master komponen tidak ketemu, label total hours fallback ke `sow.part_name`, lalu `timesheet_transaction.part_name`, lalu `order_no`, lalu `operation_text`.

### 9. `ph3_order`

Dipakai untuk exclude order dengan status/description `TECO`.

Join/filter:

```sql
NOT EXISTS (
  SELECT 1
  FROM ph3_order po
  WHERE LTRIM(po.order_no, '0') = LTRIM(t.order_no, '0')
    AND UPPER(TRIM(COALESCE(po.order_description, ''))) = 'TECO'
)
```

Catatan:

- `LTRIM(order_no, '0')` dipakai karena order di SAP sering punya leading zero.
- Jika tidak ada row `ph3_order` yang match, transaksi tetap dihitung.
- Jika ada row match dan `order_description = TECO`, transaksi tidak dihitung di total hours.

## Value Di Card Mesin

### Machine ID

Sumber:

```sql
workcenter.machineid
```

Ditampilkan sebagai teks utama card.

### Status Running / Idle

Sumber:

```sql
timesheet_transaction.longdate_checkout IS NULL
AND timesheet_transaction.longdate_checkin IS NOT NULL
AND usernfc.machineid = workcenter.machineid
```

Logika:

- Running: ada transaksi aktif untuk mesin tersebut.
- Idle: tidak ada transaksi aktif.

Jika ada lebih dari satu transaksi aktif untuk mesin yang sama, backend mengambil yang `longdate_checkin` paling baru.

Jika ada satu transaksi aktif di workcenter yang dipakai banyak mesin, hanya mesin dengan `machineid` sesuai assignment operator di `usernfc` yang menjadi running.

### Operator

Sumber:

```sql
timesheet_transaction.full_name
```

Operator diambil dari transaksi aktif terbaru. Jika mesin idle, operator kosong dan frontend menampilkan `-`.

### Operation Aktif

Sumber:

```sql
timesheet_transaction.operation_text
```

Operation aktif ditampilkan di bawah operator pada card.

### Workcenter Description

Sumber:

```sql
workcenter.workcenter_description
```

Deskripsi workcenter/mesin ditampilkan di bagian atas card, tepat di atas label `Machine ID`.

### Order Aktif

Sumber:

```sql
timesheet_transaction.order_no
```

Diambil dari transaksi aktif terbaru.

### Part Aktif

Sumber:

```sql
timesheet_transaction.part_name
```

Diambil dari transaksi aktif terbaru.

### Waktu Berjalan / Elapsed Time

Backend masih mengirim `elapsed_seconds` sebagai fallback:

```sql
EXTRACT(EPOCH FROM (NOW() - t.longdate_checkin))::bigint AS elapsed_seconds
```

Namun tampilan utama **tidak lagi bergantung pada `elapsed_seconds` dari polling**. Frontend menggunakan `longdate_checkin` sebagai `checkinTime`, lalu card menghitung elapsed time secara lokal setiap 1 detik:

```text
elapsedSeconds = Date.now() - longdate_checkin
```

Format tampilan:

```text
HH:MM:SS
```

Contoh:

```text
02:15:23
```

Jika checkout terjadi, polling 5 detik berikutnya mengambil data baru. Mesin akan berubah menjadi idle dan elapsed time kembali ke `00:00:00`.

Catatan smooth update:

- Polling tidak mereset timer elapsed jika `longdate_checkin` tidak berubah.
- `elapsed_seconds` dari server tidak dipakai sebagai dependency visual utama, supaya card tidak berkedip setiap polling.
- Timer berjalan lokal di komponen card, bukan di state global halaman.

## Value Di Modal Detail

### Buffer In / Buffer Out

Sumber:

```sql
buffer_transaction
LEFT JOIN components ON components.component_id = buffer_transaction.component_id
```

Filter:

```sql
buffer_transaction.machine_id = :machineId
```

Urutan:

```sql
ORDER BY buffer_transaction.created_at DESC
LIMIT 50
```

Label komponen:

```sql
COALESCE(NULLIF(buffer_transaction.component_label, ''), buffer_transaction.component_id::text, '-')
```

Tampilan modal:

- `Buffer In` selalu ditampilkan di bagian atas.
- `Buffer Out` ditampilkan di bawah `Buffer In`.
- Ada garis pembatas antara section `Buffer In` dan `Buffer Out`.
- Tidak ada quantity/unit karena 1 row = 1 component.
- Label `Buffer In`: `Rencana Aktivitas : {operation_text} - {operation_no}`.
- Label `Buffer Out`: `Aktivitas Terakhir : {operation_text} - {operation_no}`.
- Metadata `ssbr_id` dan `order_no` ditampilkan terpisah dari nama komponen.

Query backend juga memakai `ROW_NUMBER()` agar buffer distinct berdasarkan:

```sql
order_no
```

Jika ada data lama yang duplikat, yang dipakai adalah record terbaru berdasarkan `created_at DESC, id DESC`.

### Total Hours Per Component

Sumber utama:

```sql
timesheet_transaction
```

Join tambahan:

```sql
timesheet_transaction -> sow -> components
timesheet_transaction -> ph3_order untuk exclude TECO
```

Filter wajib:

```sql
t.longdate_checkin IS NOT NULL
AND t.activitytype IS NULL
AND order_description bukan TECO
AND transaksi match ke mesin tersebut
```

Rumus total hours:

```sql
SUM(
  COALESCE(
    t.duration,
    EXTRACT(EPOCH FROM (COALESCE(t.longdate_checkout, NOW()) - t.longdate_checkin)) / 3600
  )
)
```

Artinya:

- Jika `timesheet_transaction.duration` ada, pakai nilai itu.
- Jika `duration` kosong, hitung dari timestamp:
  - checkout sudah ada: `longdate_checkout - longdate_checkin`
  - checkout masih kosong: `NOW() - longdate_checkin`
- Hasil dibagi 3600 agar menjadi jam.
- Hasil dibulatkan 2 desimal.

Output tambahan untuk review:

```sql
STRING_AGG(DISTINCT ssbr_id, ', ') AS ssbr_ids
STRING_AGG(DISTINCT order_no, ', ') AS order_nos
```

Kedua field ini ditampilkan di sub-card total hours:

- `SSBR: {ssbr_ids}`
- `Order: {order_nos}`

Grouping:

```sql
GROUP BY order_no, component_id, component_name
```

Dengan aturan ini, total hours dijumlahkan **per production order**. Nama component tetap ditampilkan sebagai label, tetapi sum tidak digabung lintas `order_no`.

Component name dihitung dengan fallback:

```sql
COALESCE(
  components.part_name,
  sow.part_name,
  timesheet_transaction.part_name,
  timesheet_transaction.order_no,
  timesheet_transaction.operation_text,
  'Unknown component'
)
```

Urutan:

```sql
ORDER BY total_hours DESC NULLS LAST, component_name ASC
LIMIT 25
```

## Productive Only

Unproductive activity tidak dihitung dalam total hours.

Definisi productive:

```sql
timesheet_transaction.activitytype IS NULL
```

Jika `activitytype` berisi nilai tertentu, transaksi dianggap unproductive dan dikeluarkan dari total hours per component.

## Exclude TECO

Transaksi tidak dihitung jika order terkait memiliki:

```sql
ph3_order.order_description = 'TECO'
```

Perbandingan dibuat case-insensitive dan trim whitespace:

```sql
UPPER(TRIM(COALESCE(po.order_description, ''))) = 'TECO'
```

## Realtime / Polling

Frontend menggunakan polling, bukan WebSocket/SSE.

Interval:

```text
5 detik
```

Yang dipolling:

1. Daftar mesin:
   - status running/idle
   - operator aktif
   - order aktif
   - part aktif
   - check-in aktif (`longdate_checkin`)
   - status checkout/running

2. Detail mesin, hanya saat modal terbuka:
   - buffer in/out
   - total hours per component

Timer elapsed tetap berdetak setiap 1 detik di frontend agar tampilan waktu berjalan halus tanpa menunggu polling.

### Smooth Update / Anti Flicker

Halaman menggunakan beberapa guard agar polling 5 detik tidak membuat card berkedip atau layout terasa kaku:

1. Stable key:

```jsx
key={machine.machineid}
```

Setiap card memakai `machineid` sebagai key tetap.

2. Deep comparison sebelum update state:

Hook `useMachineTracking` membandingkan field penting mesin sebelum memanggil update state. Jika hasil polling sama dengan state sebelumnya, object lama dipertahankan dan array state tidak diganti.

Field yang dibandingkan:

```text
idrow, machineid, workcenternew, workcenterot, workcenterold,
workcenter_description, groupname, condition, operator_name,
serialnumber, order_no, part_name, operation_text,
longdate_checkin, is_running
```

`elapsed_seconds` sengaja tidak dipakai sebagai pembeda utama karena nilainya berubah setiap polling dan dapat menyebabkan re-render visual yang tidak perlu.

3. Skeleton hanya initial load:

Skeleton loading hanya muncul saat load pertama atau saat user membuka modal pertama kali. Polling silent tidak mengaktifkan skeleton ulang.

4. Detail modal juga dibandingkan:

Payload detail mesin disimpan dengan signature JSON. Jika buffer dan total hours tidak berubah, state detail tidak diganti.

5. Transisi status:

Card menggunakan CSS transition dan `framer-motion layout` agar perubahan running ke idle, atau idle ke running, bergerak lebih halus.

6. Elapsed time lokal:

Elapsed time dihitung dari `longdate_checkin` di masing-masing card. Polling hanya mengecek apakah checkout sudah terjadi, operator berubah, atau check-in baru dimulai.

## Index Yang Ditambahkan

Migration:

```text
db/migrations/20260502_component_tracking_query_indexes.sql
```

Index:

```sql
CREATE INDEX IF NOT EXISTS idx_ts_component_tracking_active
  ON public.timesheet_transaction (workcentercode, longdate_checkout, longdate_checkin DESC)
  WHERE longdate_checkin IS NOT NULL;
```

Untuk mempercepat pencarian transaksi aktif/running.

```sql
CREATE INDEX IF NOT EXISTS idx_ts_component_tracking_productive
  ON public.timesheet_transaction (workcentercode, order_no, operation_no, longdate_checkin)
  WHERE activitytype IS NULL AND longdate_checkin IS NOT NULL;
```

Untuk mempercepat agregasi total hours productive.

```sql
CREATE INDEX IF NOT EXISTS idx_ph3_order_order_description
  ON public.ph3_order (order_no, order_description);
```

Untuk mempercepat filter exclude TECO.

## Ringkasan Alur

1. React load halaman `ComponentTrackingPage`.
2. Hook `useMachineTracking` memanggil `GET /component-tracking/machines`.
3. Backend membaca `workcenter`, lalu mencari transaksi aktif terbaru dari `timesheet_transaction` lewat `usernfc.machineid`.
4. Frontend memisahkan mesin menjadi `Running` dan `Idle`.
5. Frontend menjalankan timer lokal per-card setiap 1 detik untuk elapsed time.
6. Setiap 5 detik frontend polling ulang daftar mesin, lalu melakukan diff sebelum update state.
7. Jika user klik card mesin, frontend memanggil `GET /component-tracking/machines/:machineId`.
8. Backend membaca buffer dari `buffer_transaction`.
9. Backend menghitung total hours productive dari `timesheet_transaction`, join ke `sow`, `components`, dan exclude `ph3_order.order_description = TECO`.
10. Modal menampilkan buffer in/out dan total hours per component, lalu polling detail silent selama modal terbuka.

## Halaman Buffer Transaction

Route frontend:

```text
/buffer-transaction
```

Navigasi:

- Tombol `Set Buffer` ada di header `ComponentTrackingPage`, di samping tombol `Refresh`.
- Tombol mengarahkan user ke `/buffer-transaction`.

Dependency drag-and-drop:

```text
@dnd-kit/core
@dnd-kit/sortable
@dnd-kit/modifiers
```

Panel kiri:

- Membaca operation dari `GET /component-tracking/sow-operations`.
- Endpoint SOW memakai pagination order (`page` dan `limit`) agar panel kiri tidak memuat ribuan data sekaligus.
- Data dikelompokkan di frontend berdasarkan `order_no`.
- Header order menampilkan `order_no`, `ssbr_id`, `part_name`, `model`, dan `total_planhours`.
- Header order juga menampilkan badge last buffer status dari latest `buffer_transaction` untuk order tersebut:
  - `in`: hijau dan menampilkan machine tujuan.
  - `out`: kuning dan menampilkan machine terkait.
  - `moving`: biru dan menampilkan machine terkait.
  - tidak ada buffer: abu-abu `Belum diproses`.
- `total_planhours` dihitung dari penjumlahan `sow.planhours` semua operation dalam order yang sedang tampil.
- Search mencakup `order_no`, `ssbr_id`, `part_name`, `model`, `operation_text`, dan `operation_no`.
- Klik card order membuka daftar operation.
- Tombol `Back` di panel kiri menutup detail operation dan kembali ke daftar order.
- Field `is_finished` dikirim API dari status SOW. Operation finished dibuat disabled, tidak bisa di-drag, dan diberi opacity 50%.
- Scroll panel kiri hanya ada di area list. Container panel dibuat `overflow-hidden` untuk menghindari scroll ganda.

Panel kanan:

- Membaca mesin dari `GET /component-tracking/machines`.
- Membaca buffer dari `GET /component-tracking/buffers`.
- Search mesin mencakup `machineid` dan `operator_name`.
- Klik card mesin membuat panel kanan fokus ke satu mesin.
- Saat fokus, panel kanan berubah menjadi tiga drop zone vertikal:
  - `Buffer In`
  - `Buffer Out`
  - `Moving`
- Tombol `Pilih Mesin Lain` mengembalikan tampilan ke daftar semua mesin.

Aturan drop:

- Operation dari panel kiri dapat di-drag setelah order dibuka.
- Drop hanya efektif saat ada mesin yang sedang fokus.
- Drop ke `Buffer In` mengirim `type = 'in'`.
- Drop ke `Buffer Out` mengirim `type = 'out'`.
- Drop ke `Moving` membuka popup pilih mesin.
- Setelah popup dikonfirmasi dari drop ke `Moving`, sistem membuat record baru `type = 'moving'` pada mesin tujuan yang dipilih, dan fokus panel kanan tidak berpindah.
- Setelah confirm arrive, fokus panel kanan pindah ke mesin tujuan agar item hasil confirm langsung terlihat.
- Backend membuat record movement baru dan menyimpan field:

```text
machine_id, type, component_label, order_no, ssbr_id, operation_no, operation_text, priority, note
```

- Item yang sudah ada di panel kanan juga draggable.
- Drop item dari satu box ke box lain membuat record movement baru, bukan update record lama.
- Drag item di dalam box yang sama melakukan reorder priority.
- Item di box `Moving` tidak bisa di-drag lagi.
- Item di box `Moving` memiliki tombol `Arrive` untuk langsung membuat record `in` pada mesin item tersebut, tanpa popup pilih mesin.
- Urutan item di box adalah `priority ASC`, lalu fallback `created_at DESC`.
- Tampilan box memakai snapshot latest per `order_no`.
- Modal History memakai semua record movement untuk `order_no` di semua mesin.

Warna item:

- `Buffer In`: hijau muda.
- `Buffer Out`: kuning muda.
- `Moving`: biru muda.

Drag performance:

- Halaman memakai `DragOverlay` dari `@dnd-kit/core`, sehingga elemen asli tetap di posisi awal saat drag.
- Overlay dibatasi dengan `restrictToWindowEdges`.
- Container utama dan panel kiri diberi `overflow-x-hidden` supaya drag tidak memicu horizontal scroll.
- Drop yang tidak berada pada `DropZone` panel kanan (`zone-*`) dibatalkan.
- DropZone memberi efek pop-up `scale(1.02)`, ring, dan shadow saat pointer drag berada di atasnya.
- Tablet 768-1024 px memakai CSS khusus untuk mengecilkan font, padding, gap, machine card, dan jumlah kolom machine list.
- Tablet 768-1024 px tetap memakai dua panel horizontal dengan rasio kira-kira 40/60 (`1fr / 1.5fr`).
- Popup pilih mesin memiliki search dan footer tombol sticky, sehingga tombol Confirm selalu terlihat tanpa scroll sampai bawah.

Note dan history:

- Setiap item buffer memiliki tombol Note.
- Tombol Note membuka modal fixed dengan backdrop blur.
- Modal berisi textarea note, tombol Save, dan tombol History.
- History ditampilkan seperti timeline vertikal.
- Setiap entry history menampilkan `type`, `machine_id`, `priority`, `note`, dan `created_at`.
