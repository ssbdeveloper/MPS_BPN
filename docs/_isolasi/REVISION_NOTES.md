# Database Schema Revision — Simplification Summary

## Tanggal
2026-04-26

## Tujuan
Menyederhanakan desain schema **Shipping & Receiving** dengan:
1. Menggabungkan `customers` + `customer_sites` → satu tabel `customers`
2. Menghapus `equipment_models` → gunakan `model_code` VARCHAR di `receiving_components`
3. Mengganti `staff` → `users` (dengan dukungan login: username, password_hash, role)
4. Mempertahankan alur utama: receiving_orders, receiving_components, shipping_records

---

## Perubahan Detail

### 1. **Customers Table** (Merged)

#### Sebelumnya:
```sql
CREATE TABLE customers (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE
);

CREATE TABLE customer_sites (
    id          SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    site_name   VARCHAR(200) NOT NULL,
    UNIQUE(customer_id, site_name)
);
```

#### Sesudahnya:
```sql
CREATE TABLE customers (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,          -- "Buma, PT"
    site_name       VARCHAR(200),                   -- "IPR", "CRC Kariangau" (boleh NULL)
    site_location   VARCHAR(300),                   -- Detail lokasi
    contact_person  VARCHAR(100),
    phone           VARCHAR(20),
    email           VARCHAR(100),
    address         TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name, site_name)  -- Kombinasi unik
);
```

#### Impact:
- ✅ Lebih sederhana: satu tabel vs dua tabel
- ✅ Fleksibel: customer bisa punya multiple records untuk site berbeda
- ✅ Backward compatible: `receiving_orders.customer_id` cukup referensi `customers.id`
- ⚠️  Query lama dengan JOIN ke `customer_sites` perlu diubah (simple adjustment)

---

### 2. **Equipment Models Removal**

#### Sebelumnya:
```sql
CREATE TABLE equipment_models (
    id         SERIAL PRIMARY KEY,
    model_code VARCHAR(50) NOT NULL UNIQUE  -- "777", "773", "D9R"
);

-- receiving_components:
CREATE TABLE receiving_components (
    ...
    model_id INTEGER REFERENCES equipment_models(id),
    ...
);
```

#### Sesudahnya:
```sql
-- Tabel equipment_models DIHAPUS

-- receiving_components:
CREATE TABLE receiving_components (
    ...
    model_code VARCHAR(50),  -- Langsung simpan "777", "773", "D9R"
    ...
);
```

#### Opsi Normalisasi Masa Depan:
Jika nanti ingin normalize model codes, bisa buat tabel `equipment_models` dan populate via:
```sql
INSERT INTO equipment_models (model_code)
SELECT DISTINCT model_code FROM receiving_components WHERE model_code IS NOT NULL;

-- Lalu alter receiving_components:
ALTER TABLE receiving_components 
ADD COLUMN model_id INTEGER REFERENCES equipment_models(id);
```

#### Impact:
- ✅ Schema lebih lean (kurang satu master table)
- ✅ Tidak ada constraint FK yang ketat untuk model codes (fleksibel input)
- ❌ Duplikasi model_code text di banyak rows (tapi manageable)
- ✅ Mudah di-normalize nanti tanpa breaking changes

---

### 3. **Staff → Users (Login Support)**

#### Sebelumnya:
```sql
CREATE TABLE staff (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE  -- "Dana", "Tenny"
);
```

#### Sesudahnya:
```sql
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50) NOT NULL UNIQUE,      -- "dana", "tenny"
    password_hash VARCHAR(255) NOT NULL,            -- bcrypt/argon2 hash
    name          VARCHAR(100) NOT NULL,            -- "Dana Penerima"
    role          VARCHAR(50) NOT NULL,             -- "admin", "staff", "viewer"
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

#### Impact:
- ✅ **Mendukung login aplikasi** (username + password_hash)
- ✅ **Role-based access control** (admin, staff, viewer, dll)
- ✅ Audit trail (created_at, updated_at)
- ⚠️  `received_by_id` dan `send_by_id` di receiving_orders & shipping_records perlu FK ke users.id (sudah updated)
- ✅ Backward compat: ambil user.name untuk display, gunakan user.id untuk FK

---

### 4. **Foreign Key Changes**

| Tabel | Kolom Lama | Referensi Lama | Kolom Baru | Referensi Baru |
|---|---|---|---|---|
| `receiving_orders` | `customer_site_id` | `customer_sites.id` | `customer_id` | `customers.id` |
| `receiving_orders` | `received_by_id` | `staff.id` | `received_by_id` | `users.id` |
| `receiving_components` | `model_id` | `equipment_models.id` | `model_code` | (VARCHAR, no FK) |
| `shipping_records` | `send_by_id` | `staff.id` | `send_by_id` | `users.id` |

---

## Tabel yang Tetap (No Change)

| Tabel | Alasan |
|---|---|
| `part_categories` | ✅ Tetap (lookup table, independent) |
| `packing_types` | ✅ Tetap (lookup table, independent) |
| `sow_work_types` | ✅ Tetap (lookup table, independent) |
| `receiving_components` | ✅ Tetap (transaction table, core) |
| `order_sow` | ✅ Tetap (junction, independent) |
| `shipping_records` | ✅ Tetap (transaction table, core) |
| `parts` (existing) | ✅ Tetap (optional FK di receiving_components) |
| `sow` (existing) | ✅ Tetap (upstream, tidak ada FK balik) |
| `ph3_order`, `qh3_order` (existing) | ✅ Tetap (downstream SAP data) |

---

## Diagram Relasi Baru

```
users ─────────┐
               ├─→ receiving_orders
customers ─────┤     │
               │     ├─→ receiving_components (self-ref)
               │     │        └─ parts (optional FK)
               │     │
               └─→ shipping_records
                    └─ users

receiving_orders ←─── sow.ssbr_id (existing table, soft link)
```

---

## Migration Path (Jika dari Schema Lama)

```sql
-- 1. Buat tabel users (dari staff)
CREATE TABLE users (...);

INSERT INTO users (username, password_hash, name, role)
SELECT 
    LOWER(name) AS username,
    '...' AS password_hash,  -- set manual atau generate
    name,
    'staff' AS role
FROM staff;

-- 2. Buat tabel customers baru (dari customers + customer_sites)
CREATE TABLE customers (...);

INSERT INTO customers (name, site_name, created_at)
SELECT 
    c.name,
    cs.site_name,
    COALESCE(c.created_at, NOW())
FROM customers c
LEFT JOIN customer_sites cs ON cs.customer_id = c.id;

-- 3. Update receiving_orders
ALTER TABLE receiving_orders DROP CONSTRAINT receiving_orders_customer_site_id_fkey;
ALTER TABLE receiving_orders DROP COLUMN customer_site_id;
ALTER TABLE receiving_orders ADD COLUMN customer_id INTEGER REFERENCES customers(id);

-- Sesuaikan data receiving_orders.customer_id

-- 4. Update receiving_components (model_code VARCHAR)
ALTER TABLE receiving_components DROP CONSTRAINT receiving_components_model_id_fkey;
ALTER TABLE receiving_components DROP COLUMN model_id;
ALTER TABLE receiving_components ADD COLUMN model_code VARCHAR(50);

-- Populate model_code dari equipment_models (jika ada)
-- UPDATE receiving_components rc SET model_code = em.model_code
-- FROM equipment_models em WHERE rc.model_id = em.id;

-- 5. Update FK di receiving_orders & shipping_records
ALTER TABLE receiving_orders 
RENAME COLUMN received_by_id TO received_by_id;  -- already correct name

ALTER TABLE receiving_orders
ALTER COLUMN received_by_id SET NOT NULL FALSE;  -- allow NULL
ALTER CONSTRAINT receiving_orders_received_by_id_fkey 
REFERENCES users(id);

-- 6. Hapus tabel lama
DROP TABLE order_sow CASCADE;  -- FK ke receiving_orders
DROP TABLE shipping_records CASCADE;
DROP TABLE receiving_components CASCADE;
DROP TABLE receiving_orders CASCADE;
DROP TABLE customer_sites CASCADE;
DROP TABLE customers CASCADE;
DROP TABLE equipment_models CASCADE;
DROP TABLE staff CASCADE;

-- Buat ulang dengan schema baru...
```

> **CATATAN:** Migration ini destructive. Lakukan di environment staging/dev dulu!

---

## File Output

- **`schema_receiving_revised.sql`** — DDL lengkap (CREATE TABLE + indexes + seed data)
- **`REVISION_NOTES.md`** — File ini

---

## Checklist Implementasi

- [ ] Review schema baru dengan stakeholder
- [ ] Uji DDL di development database
- [ ] Update dokumentasi API (endpoint auth, user management)
- [ ] Update aplikasi backend (role-based access, login logic)
- [ ] Update query di existing aplikasi (JOIN ke customers, bukan customer_sites)
- [ ] Seed data awal (users, part_categories, packing_types, sow_work_types)
- [ ] ETL: Import data lama ke schema baru (jika ada data existing)
- [ ] Test: Query verification, FK integrity, audit trail
- [ ] Backup schema lama sebelum migration

---

## Keuntungan Revisi

| Aspek | Keuntungan |
|---|---|
| **Simplicity** | Dari 12 tabel → 10 tabel. Kurang relasi, lebih mudah dipahami |
| **Maintenance** | Master tables berkurang (tidak perlu maintain equipment_models) |
| **Flexibility** | model_code VARCHAR bisa handle format apapun tanpa constraint FK |
| **Security** | Users table untuk login app (vs hanya nama di staff) |
| **Scalability** | Customers dengan multiple sites (no junction table overhead) |
| **Auditability** | created_at/updated_at di users, customers, receiving_orders, dll |

---

## Catatan Penting

1. **Backward Compatibility**: Query existing yang JOIN ke `customer_sites` perlu diubah ke `customers`
2. **Password Management**: Implementasikan bcrypt/argon2 untuk password_hash (jangan plain text)
3. **Role-Based Access**: Implement di aplikasi (middleware / route guard)
4. **Data Integrity**: Tetap maintain FK constraints untuk receiving_orders → customers & users
5. **Normalisasi Model**: Jika model_code sering duplicate, pertimbangkan normalize di masa depan via migration reversible

---

## Pertanyaan?

Hubungi: teesanfajar@gmail.com
