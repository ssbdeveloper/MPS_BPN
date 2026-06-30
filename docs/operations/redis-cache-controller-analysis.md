# Redis Cache Controller Analysis

Tanggal analisis: 2026-06-29

Dokumen ini menganalisis controller API di `apps/api/controllers` untuk skenario ribuan concurrent users. Fokusnya adalah endpoint `GET` yang mahal, sering dibaca, atau memukul tabel besar. Endpoint mutasi, transaksi stok, checkout, approval, dan data sangat real-time tidak direkomendasikan untuk Redis kecuali sebagai invalidation trigger.

## Ringkasan Prioritas

| Prioritas | Controller | Endpoint/Area | Rekomendasi |
|---|---|---|---|
| High | `dashboardController.js` | `/dashboard/*`, terutama `operations-hub`, `order-progress`, KPI/chart | Cache-aside TTL pendek-menengah |
| High | `mpsDashboardController.js` | `/dashboard/mps-*` | Cache-aside TTL pendek |
| High | `kanbanController.js` | `/kanban/board`, `/summary`, `/lanes/:location` | Cache-aside TTL pendek + invalidasi refresh board |
| High | `machineHoursSqlServerController.js` | machine hours SQL Server validation/list | Cache-aside TTL pendek-menengah |
| High | `sowController.js` | SOW standard, components, customers, order options | Cache-aside TTL menengah-panjang + invalidasi mutasi SOW master |
| Medium | `receivingShipmentController.js` | lookups, component search, SOW component options | Cache-aside TTL pendek-menengah |
| Medium | `sowScheduleController.js` | machines, shifts, manpower, report views, activities | Campuran TTL pendek dan invalidasi ketat |
| Medium | `componentTrackingController.js` | SOW operations, machine detail, board-like reads | TTL sangat pendek untuk live, menengah untuk search SOW |
| Medium | `timesheet_transactionController.js` | validation stats, operator performance, SAP log | TTL pendek untuk agregasi, hindari transaksi live |
| Low | `toolsController.js`, `consumableController.js` | lookup categories/conditions/stock search | Cache selektif; hindari availability/status |
| Low | `usernfcController.js`, `workcenterController.js`, `authController.js` | master data kecil | Cache hanya jika traffic lookup tinggi |
| No | Mutasi dan locking endpoints | create/update/delete/checkout/borrow/approve | Jangan cache response; gunakan untuk invalidasi |

## Strategi Umum

Gunakan pola **cache-aside**:

1. Controller membuat cache key dari route, query yang sudah dinormalisasi, user scope bila perlu, dan versi schema.
2. `GET redis.get(key)`.
3. Jika hit, return payload.
4. Jika miss, query DB, simpan `redis.set(key, JSON.stringify(payload), "EX", ttl)`.
5. Mutasi terkait menghapus key spesifik atau prefix.

Rekomendasi helper key:

```text
mps:v1:<controller>:<endpoint>:<stable-json-query>
```

Contoh:

```text
mps:v1:dashboard:operations-hub
mps:v1:dashboard:order-progress:{"page":1,"limit":50,"status":"all","filter":""}
mps:v1:sow:standard-component:358
mps:v1:kanban:board:{"location":"","aging":"","source":"","state":"","search":"","limit":200}
```

Untuk mencegah cache stampede:

- Pakai TTL jitter 10-20%.
- Pakai lock singkat saat miss: `SET lock:<key> 1 NX EX 10`.
- Untuk endpoint dashboard populer, boleh pakai stale-while-revalidate: return cache lama 30-120 detik saat refresh sedang berjalan.
- Hindari caching response per-user kecuali key memasukkan user/role/plant.

## Analisis Per Controller

### `dashboardController.js`

**Layak Redis: Ya, High.**

Controller ini berisi banyak agregasi dari `timesheet_transaction`, `mch_productiondata`, `sow`, `processcontroldata`, dan materialized view. `getOperationsHub` menjalankan banyak query paralel untuk overview, trend machine, status, validation queue, progress status, order summaries, recent activities, dan top machines. `getOrderProgress` membaca `mv_order_plan_vs_actual` dengan count + data. Chart endpoints seperti KPI, order status, workload, daily hours, efficiency, validation rate, heatmap juga agregasi yang cocok dibagi antar banyak user.

Endpoint yang disarankan:

| Endpoint | Cache? | TTL | Alasan |
|---|---:|---:|---|
| `GET /dashboard/operations-hub` | Ya | 30-60 detik | Query paralel banyak tabel; dashboard kemungkinan dibuka banyak user |
| `GET /dashboard/order-progress` | Ya | 60-180 detik | Baca materialized view + count; filter/page stabil |
| `GET /dashboard/order-activity-detail/:orderNo` | Ya | 60-300 detik | Detail per order dari materialized view relatif stabil |
| `GET /dashboard/operation-timesheet-history` | Ya, pendek | 30-60 detik | Agregasi timesheet per operation; bisa berubah saat checkout |
| KPI/chart endpoints | Ya | 60-300 detik | Agregasi chart biasanya toleran stale kecil |
| `GET /dashboard/sap-timesheet-staging-log` | Tidak/Low | 5-10 detik jika perlu | Log staging berubah saat posting SAP; lazy load cursor kurang cocok untuk cache luas |

Strategi:

- Key: `mps:v1:dashboard:<endpoint>:<normalized-query>`.
- Untuk `order-progress`, masukkan `page`, `limit`, `status`, `filter`.
- Untuk detail, key memakai `orderNo`.
- Invalidation: setelah `POST /dashboard/refresh-order-matviews`, hapus `mps:v1:dashboard:order-progress:*` dan `mps:v1:dashboard:order-activity-detail:*`.
- Untuk data timesheet/machine yang berubah dari ETL, lebih aman TTL pendek daripada invalidasi manual.

Risiko:

- Stale dashboard 30-180 detik masih wajar untuk overview.
- Cache stampede tinggi di jam shift change; pakai lock dan jitter.
- Jangan cache endpoint refresh materialized view.

### `mpsDashboardController.js`

**Layak Redis: Ya, High.**

Semua endpoint adalah agregasi dashboard: OEE summary, trend, loss breakdown, pareto loss, lean distribution, dan snapshot. Query membaca `timesheet_transaction`, `processcontroldata`, dan `sow` dengan filter `CURRENT_DATE`, interval 14/30 hari, `GROUP BY`, dan agregasi. Ini kandidat kuat karena banyak user melihat angka yang sama.

Endpoint:

| Endpoint | Cache? | TTL | Alasan |
|---|---:|---:|---|
| `/dashboard/mps-oee-summary` | Ya | 30-60 detik | Agregasi hari ini, sering dibaca |
| `/dashboard/mps-oee-trend` | Ya | 2-5 menit | Trend historis berubah lambat |
| `/dashboard/mps-loss-breakdown` | Ya | 30-90 detik | Agregasi hari ini |
| `/dashboard/mps-pareto-loss` | Ya | 5-10 menit | Window 30 hari, berubah lambat |
| `/dashboard/mps-lean-distribution` | Ya | 2-5 menit | Window 14/30 hari |
| `/dashboard/mps-snapshot` | Ya | 15-30 detik | Endpoint gabungan banyak query, cocok untuk mengurangi fan-out |

Strategi:

- Key: `mps:v1:mps-dashboard:<endpoint>:<workcenter|all>:<days>`.
- Snapshot TTL lebih pendek karena dipakai untuk live dashboard.
- Invalidation TTL-based cukup; mutasi timesheet terlalu banyak untuk invalidasi granular.

Risiko:

- OEE bisa tertunda beberapa detik setelah checkout/validasi.
- Jika ribuan user hit snapshot bersamaan, cache lock wajib.

### `kanbanController.js`

**Layak Redis: Ya, High.**

Controller ini membaca `mv_kanban_order_board`. `getBoard` masih melakukan lateral lookup ke `sow` dan `timesheet_transaction` untuk `actual_hours`/`planhours`, sehingga mahal pada limit besar. `getSummary` menghitung agregasi dari seluruh materialized view. `getLane` mengambil list per lokasi. Ini cocok cache pendek karena board dipantau banyak user.

Endpoint:

| Endpoint | Cache? | TTL | Alasan |
|---|---:|---:|---|
| `GET /kanban/board` | Ya | 10-30 detik | Board banyak dibaca, query lateral mahal |
| `GET /kanban/summary` | Ya | 15-60 detik | Agregasi dari MV; stabil sampai refresh |
| `GET /kanban/lanes/:location` | Ya | 10-30 detik | Data lane sering sama antar user |
| `GET /kanban/cards/detail` | Medium | 30-60 detik | Detail per kartu; cache jika traffic tinggi |
| `POST /kanban/refresh` | Tidak | - | Mutasi/refresh MV; gunakan invalidasi |

Strategi:

- Key: `mps:v1:kanban:<board|summary|lane|detail>:<normalized-query>`.
- Setelah `refreshBoard`, delete prefix `mps:v1:kanban:*`.
- TTL pendek karena board bersifat operasional.

Risiko:

- Stale board dapat membuat lokasi/status terlihat tertunda. Batasi TTL max 30 detik untuk board/lane.
- Jika refresh MV sudah mahal, jangan jadikan Redis alasan untuk refresh terlalu sering.

### `machineHoursSqlServerController.js`

**Layak Redis: Ya, High.**

Controller ini membaca SQL Server (`dbo.ProductionData`, `Machines`, `StatusTypes`) dan lalu melakukan lookup tambahan ke PostgreSQL untuk PH3 operation text. Query memakai group besar, TOP limit, date filter, dan transform SAP payload. SQL Server biasanya lebih sensitif terhadap ribuan concurrent request daripada PostgreSQL lokal.

Endpoint:

| Endpoint | Cache? | TTL | Alasan |
|---|---:|---:|---|
| `GET /machine-hours-sqlserver` | Ya | 30-120 detik | Query remote SQL Server + group |
| `GET /machine-hours-sqlserver/validation-stats` | Ya | 30-120 detik | Grouping per machine, mahal |
| `GET /machine-hours-sqlserver/validation-group/:machineno` | Ya | 30-90 detik | Detail per machine; cache per filter |
| `GET /health` | Tidak/Low | 5-10 detik jika monitored | Query ringan, manfaat kecil |

Strategi:

- Key: `mps:v1:mch-sql:<endpoint>:<machineno?>:<normalized-query>`.
- TTL lebih panjang untuk range historis yang `end` < hari ini, misalnya 10-30 menit.
- TTL pendek untuk range hari ini atau event terbuka.
- Cache `_bulkLookupOperationText(jobids)` terpisah: `mps:v1:ph3:optext:<jobid>` TTL 6-24 jam karena PH3 relatif master/reference.

Risiko:

- Open event machine dapat berubah cepat. Untuk query tanpa `end` atau range hari ini, TTL jangan panjang.
- Cache stampede ke SQL Server harus dicegah dengan lock.

### `sowController.js`

**Layak Redis: Ya untuk master/standard/history tertentu, High. Tidak untuk mutasi.**

Controller ini sangat besar. Ada endpoint master data (`components`, `customers`), SOW standard (`sow_standard`, `sow_templates`, attachments), SOW history, revision, planhours lookup, dan banyak mutasi. Data standard dan components relatif jarang berubah dibanding traffic create/revision. Ini kandidat bagus untuk mengurangi beban join dan count.

Endpoint sangat cocok:

| Endpoint | Cache? | TTL | Alasan |
|---|---:|---:|---|
| `GET /sow/components` | Ya | 10-60 menit | Master component dipakai picker/revision; jarang berubah |
| `GET /sow/customers` | Ya | 10-30 menit | Distinct customer dari SOW |
| `GET /sow/standard` | Ya | 5-15 menit | Join `sow_standard` + `components` + count |
| `GET /sow/standard/grouped` | Ya | 5-15 menit | Count distinct + group + templates |
| `GET /sow/standard/component/:component_id` | Ya | 10-30 menit | Dipakai SOW Create; operasi standard jarang berubah |
| `GET /sow/standard/component/:component_id/templates` | Ya | 10-30 menit | Template package jarang berubah |
| `GET /sow/planhours` dan `planhours-multi` | Ya | 5-15 menit | Lookup kecil tapi bisa sangat sering dari timesheet |
| `GET /sow/documentnos` | Ya | 30-60 menit | Master kecil |

Endpoint cache selektif:

| Endpoint | Cache? | TTL | Catatan |
|---|---:|---:|---|
| `GET /sow/history` | Medium | 30-120 detik | Data berubah saat create/revision/progress; cache page/search pendek |
| `GET /sow/history-order/:orderNo` | Medium | 30-120 detik | Cocok untuk revision read; invalidasi saat `PUT` revision |
| `GET /sow/order-options` | Medium | 60-180 detik | Search options bisa cache per query |
| Export endpoints | Tidak | - | Streaming file, memory besar, tidak ideal |
| Operation card image metadata | Low | 5-30 menit | Boleh cache metadata, bukan file/blob besar |

Strategi:

- Key standard: `mps:v1:sow:standard-component:<component_id>`, `mps:v1:sow:templates:<component_id>`.
- Key list: `mps:v1:sow:standard-grouped:<query>`, `mps:v1:sow:components`.
- Invalidate prefix setelah mutasi:
  - `createSowStandardOperation`, `updateSowStandardOperation`, `deleteSowStandardOperation`, `createTemplate`, `updateTemplate`, `deleteTemplate`, attachment upload/delete: delete `mps:v1:sow:standard*`, `mps:v1:sow:templates*`.
  - `createFromBuilder`, `update`, `finish`, `remove`, `saveSowOrderRevision`: delete `mps:v1:sow:history*`, `mps:v1:sow:order-options*`, `mps:v1:sow:planhours*`.
  - Component create/update/delete: delete `mps:v1:sow:components*` dan standard grouped.

Risiko:

- Salah invalidasi bisa membuat SOW Create menampilkan standard lama.
- `planhours` stale bisa mempengaruhi guard/validasi; TTL jangan terlalu panjang jika planhours sering diedit.
- Cache object operation card besar bisa menekan memory Redis jika menyimpan image data; cache metadata saja.

### `receivingShipmentController.js`

**Layak Redis: Medium.**

Endpoint `getSowComponentOptions` melakukan join `receiving_components`, `receiving_orders`, `customers`, lateral match ke `components`, lateral SOW existence, dan join `sow_standard`. Ini berat dan dipakai saat SOW Create memilih component. `getLookups` dan `searchComponents` juga cocok untuk cache. Namun shipment create/update/delete mengubah data receiving, jadi list/detail harus hati-hati.

Endpoint:

| Endpoint | Cache? | TTL | Alasan |
|---|---:|---:|---|
| `GET /receiving-shipment/sow-components` | Ya | 30-120 detik | Query join/lateral berat; cocok per search/page |
| `GET /receiving-shipment/lookups` | Ya | 10-30 menit | Master data dropdown |
| `GET /receiving-shipment/components` | Ya | 5-30 menit | Master component search |
| `GET /receiving-shipment` list | Medium | 30-60 detik | List bisa sering berubah saat receiving input |
| `GET /receiving-shipment/:id` | Low/Medium | 30-60 detik | Detail berubah saat edit |

Strategi:

- Key: `mps:v1:receiving:sow-components:<query>`, `mps:v1:receiving:lookups`, `mps:v1:receiving:components:<search>`.
- Invalidate `mps:v1:receiving:*` setelah create/update/delete receiving.
- Invalidate component search juga setelah component master update dari `sowController`.

Risiko:

- Stale receiving component bisa membuat user memilih order yang baru diedit.
- Search cardinality tinggi; batasi cache hanya search dengan panjang query >= 2 dan TTL pendek.

### `sowScheduleController.js`

**Layak Redis: Medium, selektif.**

Controller scheduling mengandung data kapasitas dan planned schedule yang operasional serta sering berubah. Beberapa endpoint sangat cocok: machines, shifts, manpower, report views. Endpoint capacity/schedules/activities query berat, tapi stale data bisa menyebabkan overbooking jika dipakai untuk keputusan scheduling.

Endpoint:

| Endpoint | Cache? | TTL | Catatan |
|---|---:|---:|---|
| `GET /sow-schedule/machines` | Ya | 30-60 menit | Master workcenter jarang berubah |
| `GET /sow-schedule/shifts`, `shift-rules` | Ya | 5-30 menit | Invalidate saat shift rule berubah |
| `GET /sow-schedule/manpower` | Ya | 10-30 menit | User NFC relatif master |
| `GET /sow-schedule/activities` | Medium | 30-120 detik | Query join SOW + schedule totals + overtime totals; berat |
| `GET /sow-schedule/capacity` | Medium | 5-20 detik | Berat, tapi stale berisiko overbooking |
| `GET /sow-schedule/schedules` | Medium | 10-30 detik | List operasional sering berubah |
| Report views | Ya | 1-5 menit | Report read-heavy, toleran stale |
| Mutasi schedule/capacity/overtime | Tidak | - | Harus invalidasi |

Strategi:

- Key: `mps:v1:sow-schedule:<endpoint>:<date|range|machine|shift|page>`.
- Invalidate prefix granular:
  - schedule create/update/delete: delete capacity/schedules/activities/report untuk tanggal+machine terkait.
  - capacity update: delete capacity untuk date+machine+shift.
  - shift rule mutation: delete shifts/capacity.

Risiko:

- Capacity stale adalah risiko paling besar. Untuk UI display boleh cache 5-20 detik, tapi validasi create schedule tetap harus query DB/transaction seperti kode sekarang.
- Jangan cache helper internal yang memakai `FOR UPDATE` atau menghitung sequence queue.

### `componentTrackingController.js`

**Layak Redis: Medium.**

`getMachines` membaca workcenter + active timesheet; ini live-ish. `getMachineDetail` menghitung component hours dari timesheet, SOW, components, dan buffer. `getSowOperations` paginasi SOW operations dengan count distinct; ini search-heavy dan cocok. Buffer endpoints berubah saat setBuffer/update priority/note.

Endpoint:

| Endpoint | Cache? | TTL | Catatan |
|---|---:|---:|---|
| `GET /component-tracking/sow-operations` | Ya | 60-180 detik | Search SOW operations berat; banyak user bisa share |
| `GET /component-tracking/machines` | Medium | 5-15 detik | Active operator berubah cepat |
| `GET /component-tracking/machines/:machineId` | Medium | 10-30 detik | Detail query cukup berat tapi live |
| `GET /component-tracking/buffers` | Low/Medium | 5-15 detik | Buffer status berubah karena user action |
| `GET /component-tracking/buffer-history` | Medium | 30-120 detik | History lebih stabil |
| Mutasi buffer | Tidak | - | Invalidate buffer keys |

Strategi:

- Key: `mps:v1:component-tracking:<endpoint>:<query>`.
- Setelah `setBuffer`, `updateBufferPriorities`, `updateBufferNote`, delete `buffers`, `machine-detail:<machineId>`, `kanban:*` bila board memakai buffer.

Risiko:

- Active machine/operator stale bisa menyesatkan display real-time. TTL sangat pendek.

### `timesheet_transactionController.js`

**Layak Redis: Medium untuk agregasi; tidak untuk transaksi utama.**

Controller ini berisi operasi check-in/out, admin update, validation, SAP post, export, dan beberapa agregasi. Endpoint mutasi timesheet tidak boleh cache. Endpoint list raw timesheet juga berubah cepat dan bisa besar. Yang cocok adalah agregasi validation/operator performance dan lookup/report yang dibaca banyak user.

Endpoint:

| Endpoint | Cache? | TTL | Catatan |
|---|---:|---:|---|
| `validationStats` | Ya | 15-60 detik | Agregasi pending/validated, group by serialnumber |
| `validationGroupRecords` | Medium | 15-60 detik | Detail per group, berubah saat validasi |
| `operatorPerformanceWorkcenters/Orders/Operations/Transactions` | Ya | 1-5 menit | Reporting by date/workcenter/order |
| `getLogSap` | Medium | 10-30 detik | Log list read-only-ish tapi bertambah cepat |
| `getAll`, `search`, `getbysn`, `getbyid` | Low | 5-30 detik hanya jika read-heavy | Raw transaksi sering berubah |
| `create`, `checkout`, `bulkValidation`, `postToSap`, update/delete | Tidak | - | Mutasi/side effect |
| Export CSV/XLSX | Tidak | - | Streaming/generated file |

Strategi:

- Key: `mps:v1:timesheet:<endpoint>:<query>`.
- Invalidate validation keys setelah `bulkValidation` dan admin update.
- Invalidate raw/search keys setelah create/checkout/update/delete, tetapi lebih sederhana memakai TTL pendek.

Risiko:

- Stale validation bisa membuat user melihat row yang sudah divalidasi. TTL pendek dan refresh manual di UI.
- Jangan cache `postToSap`; ada side effect eksternal.

### `machineHoursValidationController.js`

**Layak Redis: Medium.**

Mirip machine hours validation tetapi sumbernya PostgreSQL/local. Endpoint `validationStats` dan `validationGroupRecords` melakukan grouping dan detail record. Cocok untuk TTL pendek karena data machine hours bisa masuk dari ETL.

Strategi:

- Key: `mps:v1:mch-validation:stats:<query>`, `mps:v1:mch-validation:records:<machineno>:<query>`.
- TTL 30-120 detik untuk range historis; 15-30 detik untuk hari ini.
- Invalidation TTL-based cukup kecuali ETL bisa mem-publish event invalidation.

Risiko:

- ETL baru masuk tidak langsung terlihat.

### `msProjectController.js`

**Layak Redis: Medium untuk list/package read-only; tidak untuk checkout/sync/publish.**

Controller ini memakai service layer MS Project. Endpoint list projects/tasks/SOW orders/package kemungkinan read-heavy dan query package bisa besar. Namun checkout, heartbeat, sync, publish adalah stateful workflow.

Endpoint cocok:

- `listProjects`, `listProjectTasks`, `listSowOrders`, `getSowOrderOperations`, `listBaySchedules`, `listBayScheduleTasks`, `getProjectPackage`, `searchResources`, `getProjectResources`.

TTL:

- 1-5 menit untuk list.
- 30-120 detik untuk package/tasks bila sering diedit.

Invalidation:

- `bulkLoadProjects`, `mapSowOrderToProjectTasks`, `createBaySchedule`, `cancelBaySchedule`, `publishProject`, `syncProject`, resource add/deactivate harus delete prefix `mps:v1:ms-project:*`.

Risiko:

- Project checkout state tidak boleh stale. Jangan cache `checkoutProject`, `heartbeatProject`, `checkinProject`, `forceCheckinProject`.

### `toolsController.js`

**Layak Redis: Low-Medium, selektif.**

Tools availability berubah oleh borrow/return/reservation/handover. `listTools` join beberapa master dan user, tetapi status availability harus segar. Master categories/conditions sangat cocok.

Endpoint:

| Endpoint | Cache? | TTL |
|---|---:|---:|
| `getCategories`, `getConditions` | Ya | 30-120 menit |
| `listTools` | Medium | 10-30 detik |
| `getToolById` | Low | 10-30 detik |
| Transactions/handovers/reservations/logs | Low | 5-30 detik jika dashboard-heavy |
| borrow/return/reservation/handover mutasi | Tidak | - |

Invalidation:

- Semua mutasi tool harus delete `mps:v1:tools:list*`, `mps:v1:tools:detail:<id>`, dan related transaction/reservation keys.

Risiko:

- Stale availability bisa membuat user mencoba borrow tool yang sudah dipinjam. Validasi DB dengan `FOR UPDATE` tetap wajib seperti kode sekarang.

### `consumableController.js`

**Layak Redis: Low-Medium.**

Consumable stock dan ticket control berhubungan dengan approval/quantity. `searchStock` bisa cache pendek karena search master stock sering dipakai, tetapi quantity bisa berubah saat request/adjust/reject. Ticket history per user bisa cache pendek.

Endpoint:

| Endpoint | Cache? | TTL |
|---|---:|---:|
| `searchStock` | Medium | 30-120 detik |
| `getHistory(sn)` | Medium | 30-60 detik |
| `getControlTickets` | Low/Medium | 10-30 detik |
| approve/close/adjust/reject/create | Tidak | - |

Risiko:

- Stale stock quantity bisa mengganggu request. Mutasi harus tetap validasi DB transaction, bukan percaya cache.

### `receiving`, `usernfc`, `workcenter`, `auth`, `production_operations`, `processControl`

Ringkas:

| Controller | Cache? | Prioritas | Catatan |
|---|---:|---|---|
| `usernfcController.js` | Ya selektif | Low | `getAll` bisa cache 5-15 menit jika dipakai dropdown; invalidate create/update/delete. Single NFC lookup boleh TTL 1-5 menit tetapi hati-hati login/identity changes. |
| `workcenterController.js` | Ya | Low-Medium | `SELECT * FROM workcenter` master data; TTL 30-120 menit, invalidate saat admin edit. |
| `authController.js` | Tidak untuk login/change password | Low | `listUsers` bisa cache 1-5 menit untuk admin page; invalidate user CRUD. Jangan cache login/password. |
| `production_operationsController.js` | Medium | Low-Medium | Lookup/list PH3/order operations bisa cache 5-30 menit jika read-only; invalidate mengikuti ETL PH3 bila ada. |
| `processControlController.js` | Low | Low | Banyak data validation/control yang kemungkinan berubah saat QC; cache master categories/choices saja, bukan controls/items dinamis. |
| `tokencontroller.js` | Tidak | Low | Token/credential flow sebaiknya tidak dicache di Redis app response kecuali token provider dengan expiry yang aman. |

## Endpoint Yang Tidak Disarankan Redis

Jangan cache response untuk:

- Timesheet `create`, `checkout`, `checkoutUnprod`, `checkoutid`, `bulkValidation`, `partialUpdate`, `postToSap`.
- SOW create/update/delete/finish/revision/template/attachment mutations.
- Tools borrow/return/reservation/handover mutations.
- Consumable approve/close/adjust/reject/create.
- SOW schedule create/update/delete/capacity upsert/overtime approval.
- Auth login/change password.
- Export file endpoints CSV/XLSX.

Alasan: endpoint tersebut punya side effect, locking, transaksi DB, atau harus membaca state terbaru untuk mencegah double booking, double checkout, salah stok, dan race condition.

## Rekomendasi Implementasi Bertahap

### Phase 1 - Dampak Terbesar

1. `dashboardController.js` semua dashboard GET dengan TTL 30-300 detik.
2. `mpsDashboardController.js` dengan TTL 15 detik sampai 10 menit sesuai endpoint.
3. `kanbanController.js` board/summary/lane dengan TTL 10-60 detik dan invalidasi saat refresh.
4. `machineHoursSqlServerController.js` dengan TTL 30-120 detik, plus lock untuk mencegah stampede ke SQL Server.

### Phase 2 - Master dan SOW Standard

1. `sowController.js`: components, customers, standard grouped, standard by component, templates by component.
2. `receivingShipmentController.js`: lookups, component search, SOW component options.
3. `sowScheduleController.js`: machines, shifts, manpower, report views.

### Phase 3 - Operasional Dengan TTL Pendek

1. `componentTrackingController.js`: machines/detail/buffers TTL 5-30 detik.
2. `timesheet_transactionController.js`: validation/operator performance TTL 15-300 detik.
3. `toolsController.js` dan `consumableController.js` untuk lookup/list pendek.

## Contoh TTL Default

| Kategori Data | TTL |
|---|---:|
| Live board / active machine | 5-30 detik |
| Dashboard today / OEE snapshot | 15-60 detik |
| Dashboard trend historis | 2-10 menit |
| SOW standard/templates/components | 10-60 menit |
| Workcenter/user/master lookup | 30-120 menit |
| SQL Server machine hours current window | 30-120 detik |
| SQL Server historical range | 10-30 menit |

## Catatan Implementasi Teknis

- Tambahkan wrapper Redis di `apps/api`, misalnya `utils/cache.js`, agar controller cukup memanggil `cachedJson(key, ttl, loader, { tags })`.
- Normalisasi query sebelum menjadi key: sort key, hapus param kosong, clamp limit/page sesuai controller.
- Simpan response final JSON, bukan row mentah bila transform controller mahal.
- Gunakan prefix version `mps:v1` agar mudah flush saat struktur response berubah.
- Untuk invalidasi prefix di Redis production, hindari `KEYS`; gunakan tag set atau `SCAN`.
- Tambahkan header debug opsional: `X-Cache: HIT|MISS|STALE` untuk observability.

