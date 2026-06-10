# Database Schema — `ptssb`

> **Host:** 100.80.101.53:5433
> **Database:** ptssb
> **Generated:** 2026-02-18
> **Tables:** 11 | **Schema:** public

---

## Daftar Tabel

| # | Tabel | Estimasi Rows | Keterangan |
|---|-------|------------:|------------|
| 1 | [`sow`](#1-sow) | ~100.292 | Statement of Work — data order produksi |
| 2 | [`processcontroldata_item`](#6-processcontroldata_item) | ~4.570 | Item hasil pengisian process control |
| 3 | [`processcontroldata`](#5-processcontroldata) | ~408 | Header sesi process control |
| 4 | [`process_parameter_choicebase`](#4-process_parameter_choicebase) | ~179 | Pilihan nilai untuk parameter bertipe choice |
| 5 | [`process_parameter`](#3-process_parameter) | ~175 | Parameter master process control |
| 6 | [`timesheet_transaction`](#7-timesheet_transaction) | ~38 | Transaksi check-in/check-out operator |
| 7 | [`workcenter`](#8-workcenter) | — | Master data workcenter / mesin |
| 8 | [`usernfc`](#9-usernfc) | — | Master user dengan NFC tag |
| 9 | [`parts`](#10-parts) | — | Master part/komponen |
| 10 | [`operations`](#11-operations) | — | Operasi per part (routing) |
| 11 | [`process_category`](#2-process_category) | — | Kategori process control |

---

## Relasi Antar Tabel

```
parts ──────────────────────────► operations
                                   (part_id)

process_category ───────────────► process_parameter
                                   (id_process)

process_parameter ──────────────► process_parameter_choicebase
                                   (id_parameter)
                  ──────────────► processcontroldata_item
                                   (id_parameter)

timesheet_transaction ──────────► processcontroldata
                                   (tsnumber)

processcontroldata ─────────────► processcontroldata_item
                                   (id_processcontroldata)

── Standalone (tanpa FK) ────────  sow
                                   usernfc
                                   workcenter
```

---

## Detail Tabel

### 1. `sow`

Statement of Work — menyimpan data order produksi dari SAP.

| Kolom | Tipe | Nullable | Default | Keterangan |
|-------|------|:--------:|---------|------------|
| `idsow` 🔑 | integer | NOT NULL | — | Primary key |
| `order_no` | text | YES | — | Nomor order produksi |
| `operation_no` | integer | NOT NULL | — | Nomor operasi |
| `ssbr_id` | text | YES | — | ID serial/batch unit |
| `part_number` | text | YES | — | Nomor part |
| `part_name` | text | YES | — | Nama part |
| `model` | text | YES | — | Model produk |
| `customer` | text | YES | — | Nama customer |
| `location` | text | YES | — | Lokasi produksi |
| `wct_group` | text | YES | — | Workcenter group |
| `workcenter` | text | YES | — | Kode workcenter |
| `operationtext` | text | YES | — | Deskripsi operasi |
| `workcenterdescription` | text | YES | — | Deskripsi workcenter |
| `planhours` | numeric(10,2) | YES | — | Plan jam kerja |
| `systemstatus` | text | YES | — | Status sistem SAP |
| `confirmation` | text | YES | — | Nomor konfirmasi SAP |
| `status` | text | YES | — | Status internal |
| `finish_date` | date | YES | — | Target selesai |
| `codenumber` | text | YES | — | Kode identifikasi |
| `weight` | numeric(5,2) | YES | — | Berat unit |
| `created_by` | text | YES | — | Dibuat oleh |
| `type` | text | YES | — | Tipe order |
| `group` | text | YES | — | Group |
| `category` | text | YES | — | Kategori |
| `remark` | text | YES | — | Catatan tambahan |
| `sync` | text | YES | `'new'` | Status sinkronisasi (`new`/`synced`) |
| `plan_start` | date | YES | — | Tanggal rencana mulai |
| `plan_finish` | date | YES | — | Tanggal rencana selesai |
| `actual_start` | date | YES | — | Tanggal aktual mulai |
| `actual_finish` | date | YES | — | Tanggal aktual selesai |
| `actual_progress` | numeric(5,2) | YES | — | Progress aktual (%) |
| `actual_hours` | real | YES | — | Jam aktual terpakai |

**Index:**

| Index | Kolom | Unique |
|-------|-------|:------:|
| `sow_pkey` | `idsow` | ✓ |
| `idx_sow_part_number` | `part_number` | — |
| `idx_sow_model` | `model` | — |
| `idx_sow_codenumber` | `codenumber` | — |

---

### 2. `process_category`

Kategori master untuk process control (misal: Welding, Painting, Assembly).

| Kolom | Tipe | Nullable | Default | Keterangan |
|-------|------|:--------:|---------|------------|
| `id_process` 🔑 | integer | NOT NULL | — | Primary key |
| `process_name` | text | NOT NULL | — | Nama kategori process |
| `description` | text | YES | — | Deskripsi |

**Index:** `process_category_pkey` → `id_process` (PK)

---

### 3. `process_parameter`

Parameter yang diukur/dicatat dalam suatu kategori process.

| Kolom | Tipe | Nullable | Default | Keterangan |
|-------|------|:--------:|---------|------------|
| `id_parameter` 🔑 | integer | NOT NULL | — | Primary key |
| `id_process` 🔗 | integer | NOT NULL | — | FK → `process_category.id_process` |
| `parameter_name` | text | NOT NULL | — | Nama parameter |
| `description` | text | YES | — | Deskripsi |
| `parameter_no` | integer | YES | — | Urutan tampil |
| `uom` | text | YES | — | Satuan ukur |
| `ischoice` | boolean | YES | `false` | Nilai berupa pilihan |
| `isnumber` | boolean | YES | `false` | Nilai berupa angka |

**Index:** `process_parameter_pkey` → `id_parameter` (PK)

**Foreign Keys:**
- `id_process` → `process_category.id_process`

---

### 4. `process_parameter_choicebase`

Daftar pilihan nilai untuk parameter bertipe `ischoice = true`.

| Kolom | Tipe | Nullable | Default | Keterangan |
|-------|------|:--------:|---------|------------|
| `id_choice` 🔑 | integer | NOT NULL | — | Primary key |
| `id_parameter` 🔗 | integer | NOT NULL | — | FK → `process_parameter.id_parameter` |
| `choice_name` | text | NOT NULL | — | Teks pilihan |
| `description` | text | YES | — | Deskripsi |

**Index:** `process_parameter_choicebase_pkey` → `id_choice` (PK)

**Foreign Keys:**
- `id_parameter` → `process_parameter.id_parameter`

---

### 5. `processcontroldata`

Header sesi pengisian process control oleh operator untuk satu unit produksi.

| Kolom | Tipe | Nullable | Default | Keterangan |
|-------|------|:--------:|---------|------------|
| `id_processcontroldata` 🔑 | integer | NOT NULL | — | Primary key |
| `tsnumber` 🔗 | integer | YES | — | FK → `timesheet_transaction.tsnumber` |
| `snssb` | text | YES | — | Serial number unit |
| `full_name` | text | YES | — | Nama operator |
| `production_order` | text | YES | — | Nomor order produksi |
| `ssbr_id` | text | YES | — | ID serial/batch |
| `operation_text` | text | YES | — | Deskripsi operasi |
| `operation_no` | text | YES | — | Nomor operasi |
| `machineid` | text | YES | — | ID mesin |
| `workcenter` | text | YES | — | Workcenter |
| `validation_status` | text | YES | — | Status validasi |
| `validation_date` | timestamptz | YES | — | Tanggal divalidasi |
| `validation_by` | text | YES | — | Validator |
| `createddate` | timestamptz | YES | `now()` | Tanggal dibuat |

**Index:** `processcontroldata_pkey` → `id_processcontroldata` (PK)

**Foreign Keys:**
- `tsnumber` → `timesheet_transaction.tsnumber`

---

### 6. `processcontroldata_item`

Detail item/parameter yang diisi dalam satu sesi process control.

| Kolom | Tipe | Nullable | Default | Keterangan |
|-------|------|:--------:|---------|------------|
| `id_processcontroldata_item` 🔑 | integer | NOT NULL | — | Primary key |
| `id_processcontroldata` 🔗 | integer | NOT NULL | — | FK → `processcontroldata.id_processcontroldata` |
| `id_parameter` 🔗 | integer | YES | — | FK → `process_parameter.id_parameter` |
| `category_name` | text | YES | — | Snapshot nama kategori |
| `parameter_name` | text | YES | — | Snapshot nama parameter |
| `value` | text | YES | — | Nilai yang diisi operator |
| `uom` | text | YES | — | Satuan ukur |
| `ischoice` | boolean | YES | — | Tipe pilihan |
| `isnumber` | boolean | YES | — | Tipe angka |
| `status` | text | YES | — | Status item (OK/NG/dll) |
| `note` | text | YES | — | Catatan |
| `createddate` | timestamptz | YES | `now()` | Tanggal dibuat |

**Index:** `processcontroldata_item_pkey` → `id_processcontroldata_item` (PK)

**Foreign Keys:**
- `id_processcontroldata` → `processcontroldata.id_processcontroldata`
- `id_parameter` → `process_parameter.id_parameter`

---

### 7. `timesheet_transaction`

Transaksi check-in / check-out operator di suatu operasi/mesin.

| Kolom | Tipe | Nullable | Default | Keterangan |
|-------|------|:--------:|---------|------------|
| `tsnumber` 🔑 | integer | NOT NULL | — | Primary key |
| `activitytype` | text | YES | — | Tipe aktivitas |
| `operation_text` | text | YES | — | Deskripsi operasi |
| `confirmationnumber` | text | YES | — | Nomor konfirmasi SAP |
| `ssbr_ident` | text | YES | — | ID serial/batch |
| `date_checkin` | text | YES | — | Tanggal check-in (string) |
| `date_checkout` | text | YES | — | Tanggal check-out (string) |
| `full_name` | text | YES | — | Nama operator |
| `hour_checkin` | text | YES | — | Jam check-in (string) |
| `hour_checkout` | text | YES | — | Jam check-out (string) |
| `longdate_checkin` | timestamptz | YES | — | Timestamp check-in |
| `longdate_checkout` | timestamptz | YES | — | Timestamp check-out |
| `note` | text | YES | — | Catatan |
| `seq` | integer | YES | — | Urutan |
| `production_order` | text | YES | — | Nomor order produksi |
| `part_name` | text | YES | — | Nama part |
| `planhours` | text | YES | — | Plan jam (string) |
| `plant` | text | YES | — | Plant kode |
| `serialnumber` | text | YES | — | Serial number unit |
| `state_flag` | text | YES | — | Status (`open`/`closed`/dll) |
| `std_foreman_hours` | text | YES | — | Standar jam foreman |
| `validation_date` | timestamptz | YES | — | Tanggal validasi |
| `workcentercode` | text | YES | — | Kode workcenter |
| `workcenterdescription` | text | YES | — | Deskripsi workcenter |
| `duration` | numeric(10,2) | YES | — | Durasi kerja (jam) |

**Index:**

| Index | Kolom | Unique |
|-------|-------|:------:|
| `timesheet_transaction_pkey` | `tsnumber` | ✓ |
| `idx_ts_serialnumber` | `serialnumber` | — |
| `idx_ts_production_order` | `production_order` | — |
| `idx_ts_longdate_checkin` | `longdate_checkin` | — |
| `idx_ts_serial_checkin` | `serialnumber, longdate_checkin` | — |
| `idx_ts_validation_date` | `validation_date` | — |

---

### 8. `workcenter`

Master data workcenter / mesin produksi.

| Kolom | Tipe | Nullable | Default | Keterangan |
|-------|------|:--------:|---------|------------|
| `idrow` 🔑 | integer | NOT NULL | — | Primary key |
| `plant` | integer | YES | — | Kode plant |
| `workcenterot` | varchar(50) | YES | — | Kode workcenter OT |
| `condition` | varchar(50) | YES | — | Kondisi |
| `categoryhours` | varchar(50) | YES | — | Kategori jam (regular/lembur) |
| `groupname` | varchar(50) | YES | — | Nama group |
| `machineid` | varchar(50) | YES | — | ID mesin |
| `position` | integer | YES | — | Urutan tampil |
| `costcenter` | integer | YES | — | Kode cost center |
| `costcenter_rate` | integer | YES | — | Rate cost center |
| `workcenter_description` | varchar(50) | YES | — | Deskripsi workcenter |
| `workcenternew` | varchar(50) | YES | — | Kode workcenter baru |
| `workcenterold` | varchar(50) | YES | — | Kode workcenter lama |

**Index:** `workcenter_pkey` → `idrow` (PK)

---

### 9. `usernfc`

Master data user dengan NFC tag untuk login mesin.

| Kolom | Tipe | Nullable | Default | Keterangan |
|-------|------|:--------:|---------|------------|
| `idrow` 🔑 | integer | NOT NULL | — | Primary key |
| `nfcid` | text | YES | — | ID tag NFC |
| `full_name` | text | YES | — | Nama lengkap |
| `snssb` | text | YES | — | Employee ID / nomor karyawan |
| `machineid` | text | YES | — | ID mesin yang dikaitkan |
| `machinename` | text | YES | — | Nama mesin |
| `workcenter` | text | YES | — | Workcenter |
| `roles` | text | YES | — | Role (`operator`/`foreman`/dll) |

**Index:** `usernfc_pkey` → `idrow` (PK)

---

### 10. `parts`

Master data part / komponen produk.

| Kolom | Tipe | Nullable | Default | Keterangan |
|-------|------|:--------:|---------|------------|
| `part_id` 🔑 | integer | NOT NULL | — | Primary key |
| `partnumber` | varchar(50) | NOT NULL | — | Nomor part (unique) |
| `partname` | varchar(200) | NOT NULL | — | Nama part |
| `model` | varchar(100) | NOT NULL | — | Model produk |
| `drawing_path` | text | YES | — | Path file drawing |
| `created_at` | timestamptz | YES | `now()` | Dibuat pada |
| `updated_at` | timestamptz | YES | `now()` | Diupdate pada |

**Index:**

| Index | Kolom | Unique |
|-------|-------|:------:|
| `parts_pkey` | `part_id` | ✓ |
| `parts_partnumber_key` | `partnumber` | ✓ |
| `idx_parts_partnumber` | `partnumber` | — |
| `idx_parts_partname` | `partname` | — |
| `idx_parts_model` | `model` | — |

---

### 11. `operations`

Routing operasi per part — urutan langkah produksi.

| Kolom | Tipe | Nullable | Default | Keterangan |
|-------|------|:--------:|---------|------------|
| `operation_id` 🔑 | integer | NOT NULL | — | Primary key |
| `part_id` 🔗 | integer | NOT NULL | — | FK → `parts.part_id` |
| `opr_no` | integer | NOT NULL | — | Nomor operasi |
| `operationtext` | text | NOT NULL | — | Deskripsi operasi |
| `wct_group` | varchar(50) | YES | — | Workcenter group |
| `workcenter` | varchar(50) | YES | — | Kode workcenter |
| `planhours` | numeric(5,2) | YES | — | Plan jam operasi |
| `drawing_path` | text | YES | — | Path file drawing |
| `remark` | text | YES | — | Catatan |
| `created_at` | timestamptz | YES | `now()` | Dibuat pada |
| `updated_at` | timestamptz | YES | `now()` | Diupdate pada |

**Index:**

| Index | Kolom | Unique |
|-------|-------|:------:|
| `operations_pkey` | `operation_id` | ✓ |
| `operations_part_id_opr_no_key` | `part_id, opr_no` | ✓ |
| `idx_operations_part_id` | `part_id` | — |
| `idx_operations_drawing_path` | `drawing_path` | — |

**Foreign Keys:**
- `part_id` → `parts.part_id`

---

## Catatan & Temuan

### Duplicate Foreign Key Constraints
Beberapa tabel memiliki 2 FK constraint yang menunjuk ke relasi yang sama (kemungkinan akibat migrasi bertahap):

| Tabel | Kolom | Constraint 1 | Constraint 2 |
|-------|-------|-------------|-------------|
| `process_parameter` | `id_process` | `process_parameter_id_process_fkey` | `fk_process_parameter_process` |
| `process_parameter_choicebase` | `id_parameter` | `process_parameter_choicebase_id_parameter_fkey` | `fk_choice_parameter` |
| `processcontroldata` | `tsnumber` | `processcontroldata_tsnumber_fkey` | `fk_processcontroldata_timesheet` |
| `processcontroldata_item` | `id_processcontroldata` | `processcontroldata_item_processcontroldata_id_fkey` | `fk_item_processcontroldata` |
| `processcontroldata_item` | `id_parameter` | `processcontroldata_item_id_parameter_fkey` | `fk_item_parameter` |

> Salah satu dari tiap pasangan duplikat bisa di-drop tanpa efek fungsional.

### Kolom Tanggal Campuran di `timesheet_transaction`
Kolom `date_checkin`, `date_checkout`, `hour_checkin`, `hour_checkout` bertipe `text`, sedangkan `longdate_checkin` / `longdate_checkout` sudah bertipe `timestamptz`. Kolom string tersebut mungkin legacy dan bisa dipertimbangkan untuk dihapus jika sudah tidak digunakan.
