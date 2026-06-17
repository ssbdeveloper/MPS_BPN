-- ============================================================================
-- REVISED DATABASE SCHEMA: Shipping & Receiving (Simplified)
-- ============================================================================
-- Perubahan dari versi sebelumnya:
-- 1. customers & customer_sites → satu tabel customers (dengan location/site)
-- 2. equipment_models → dihapus, gunakan model_code dari master components
-- 3. staff → users (untuk login app: username, password_hash, role)
-- 4. Relasi utama tetap: receiving_orders → receiving_components → shipping_records
-- ============================================================================

-- ============================================================================
-- MASTER LOOKUP TABLES
-- ============================================================================

-- 1. Users (Login) — menggantikan staff
CREATE TABLE users (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username    VARCHAR(50)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name        VARCHAR(100) NOT NULL,
    role        VARCHAR(50)  NOT NULL,  -- 'admin', 'staff', 'viewer', dll
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- 2. Customers — merged dari customers + customer_sites (satu tabel saja)
CREATE TABLE customers (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,  -- "Buma, PT", "Trakindo Utama, PT"
    site_name       VARCHAR(200),           -- "IPR", "CRC Kariangau", "Sangatta" (NULL jika umum)
    site_location   VARCHAR(300),           -- Detail lokasi jika ada
    contact_person  VARCHAR(100),
    phone           VARCHAR(20),
    email           VARCHAR(100),
    address         TEXT,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE(name, site_name)  -- Kombinasi name + site_name harus unik
);

-- 3. Part Categories
CREATE TABLE part_categories (
    id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
    -- Contoh: Suspension, Undercarriage, Final Drive, Hydraulic, Engine,
    -- Rim Tyre, Torque Converter, Other
);

-- 4. Packing Types
CREATE TABLE packing_types (
    id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
    -- Contoh: Loose, Stand Steel, Wooden Pallet
);


-- ============================================================================
-- TRANSACTION TABLES
-- ============================================================================

-- 6. Receiving Orders
--    Satu record per ssbr_ident (penghubung ke sow.ssbr_id)
CREATE TABLE receiving_orders (
    id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ssbr_ident       VARCHAR(50)  NOT NULL UNIQUE,  -- "BHSG-4033", "BWRP-5692"
    customer_id      INTEGER      NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    received_date    DATE         NOT NULL,
    tagging_time     TIMESTAMPTZ,                   -- waktu tagging barang
    received_by_id   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    reff_number      VARCHAR(200),                  -- PO/WO dari customer
    ex_unit          VARCHAR(100),                  -- serial unit asal komponen
    packing_list     VARCHAR(200),
    da_ckb_received  VARCHAR(200),                  -- dokumen penerimaan
    packing_type_id  INTEGER      REFERENCES packing_types(id) ON DELETE SET NULL,
    raw_sow_text     TEXT,                          -- scope_of_work asli (audit trail)
    created_at       TIMESTAMPTZ  DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  DEFAULT NOW()
);
-- Catatan: sow.ssbr_id mengarah ke receiving_orders.ssbr_ident
-- Tidak ada FK balik ke sow (menghindari circular dependency)

-- 7. Receiving Components
--    Semua part (level 1 & 2), hierarki self-reference
--    PERUBAHAN: Tidak ada FK ke equipment_models lagi, gunakan model_code VARCHAR
CREATE TABLE receiving_components (
    id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receiving_order_id  INTEGER      NOT NULL REFERENCES receiving_orders(id) ON DELETE CASCADE,
    parent_component_id INTEGER      REFERENCES receiving_components(id) ON DELETE SET NULL,
    --   NULL      = level 1 (parent/root)
    --   IS NOT NULL = level 2 (child, FK ke parent-nya)
    part_level          SMALLINT     NOT NULL CHECK (part_level IN (1, 2)),
    component_id        BIGINT,                      -- soft reference ke components.component_id (join only, no FK)
    part_number         VARCHAR(100),                -- snapshot CAT part number dari dokumen/master components
    part_description    VARCHAR(300) NOT NULL,
    model_code          VARCHAR(50),                 -- snapshot model dari dokumen/master components. Contoh: "777", "773", "D9R"
    part_type           VARCHAR(10)  CHECK (part_type IN ('Single', 'Group')),
    part_category_id    INTEGER      REFERENCES part_categories(id) ON DELETE SET NULL,
    production_order    VARCHAR(100),                -- internal prod order "1-106277"
    actual_component    VARCHAR(100),                -- ref ke ssbr_ident lama (swap/exchange)
    created_at          TIMESTAMPTZ  DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  DEFAULT NOW()
);

-- 8. Shipping Records
--    Per receiving_order (per ssbr_ident) — when & how komponen dikirim kembali ke customer
CREATE TABLE shipping_records (
    id                      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receiving_order_id      INTEGER      NOT NULL UNIQUE REFERENCES receiving_orders(id) ON DELETE RESTRICT,
    delivery_note_number    VARCHAR(100),            -- "BPN62101"
    send_by_id              INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    destination             VARCHAR(200),            -- "Buma Somber", "CRC Kariangau"
    consignment_notes       VARCHAR(200),            -- no. AWB / surat jalan ekspedisi
    shipping_list           VARCHAR(200),            -- shipping list SSB internal
    freight_cost_bill       VARCHAR(100),
    delivery_date           DATE,
    return_to_stock_date    DATE,
    dn_received_by_customer DATE,
    dn_received_by_ssb      DATE,
    dn_submit_date          DATE,
    created_at              TIMESTAMPTZ  DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Users
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);

-- Customers
CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_site ON customers(site_name);

-- Receiving Orders
CREATE INDEX idx_ro_customer_id    ON receiving_orders(customer_id);
CREATE INDEX idx_ro_received_date  ON receiving_orders(received_date);
CREATE INDEX idx_ro_ssbr           ON receiving_orders(ssbr_ident);  -- join ke sow.ssbr_id
CREATE INDEX idx_ro_received_by    ON receiving_orders(received_by_id);

-- Receiving Components
CREATE INDEX idx_rc_order          ON receiving_components(receiving_order_id);
CREATE INDEX idx_rc_parent         ON receiving_components(parent_component_id);
CREATE INDEX idx_rc_prod_order     ON receiving_components(production_order);
CREATE INDEX idx_rc_model_code     ON receiving_components(model_code);
CREATE INDEX idx_rc_component_id   ON receiving_components(component_id);

-- Shipping Records
CREATE INDEX idx_sr_order          ON shipping_records(receiving_order_id);
CREATE INDEX idx_sr_delivery_date  ON shipping_records(delivery_date);
CREATE INDEX idx_sr_send_by        ON shipping_records(send_by_id);

-- ============================================================================
-- SEED DATA (Optional)
-- ============================================================================

-- Part Categories
INSERT INTO part_categories (name) VALUES
('Suspension'),
('Undercarriage'),
('Final Drive'),
('Hydraulic'),
('Engine'),
('Rim Tyre'),
('Torque Converter'),
('Other')
ON CONFLICT (name) DO NOTHING;

-- Packing Types
INSERT INTO packing_types (name) VALUES
('Loose'),
('Stand Steel'),
('Wooden Pallet')
ON CONFLICT (name) DO NOTHING;

-- Sample Users (replace password_hash with actual bcrypt/argon2 hash in production)
INSERT INTO users (username, password_hash, name, role) VALUES
('admin', '$2b$10$example_hash', 'Administrator', 'admin'),
('dana', '$2b$10$example_hash', 'Dana Penerima', 'staff'),
('tenny', '$2b$10$example_hash', 'Tenny Pengirim', 'staff')
ON CONFLICT (username) DO NOTHING;

-- ============================================================================
-- RELATIONSHIP SUMMARY (dengan tabel existing)
-- ============================================================================
-- receiving_orders.ssbr_ident ←→ sow.ssbr_id (EXISTING TABLE)
--   │
--   ├─→ receiving_components (self-ref via parent_component_id)
--   │        └─ components.component_id (soft reference / join only)
--   │        └─ model_code (VARCHAR)
--   │
--   └─→ shipping_records
--        └─ users.id (send_by)
--
-- customers (merged dari old customers + customer_sites)
--   └─→ receiving_orders.customer_id
-- ============================================================================
