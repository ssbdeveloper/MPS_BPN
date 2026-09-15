-- RBAC — roles as ASSIGNABLE ACCESS PACKAGES (Manage Users).
-- ------------------------------------------------------------------
-- Model lama: role = konstanta di kode (permissionMatrix.js, dobel FE/backend),
-- admin hanya bisa override per-user (rbac.user_permissions). Model baru menambah
-- lapisan role DINAMIS di DB supaya admin bisa membuat "paket akses" (mis. `ppc`),
-- menempelkannya ke banyak user, dan mengedit paket sekali untuk semua pemakainya.
--
-- Keputusan owner 2026-09-07 (spec docs/planning/rbac-role-paket.md):
--   1a user boleh pegang BANYAK role, akses efektif = level tertinggi per fitur
--   2a override per-user (rbac.user_permissions) tetap lapisan teratas
--   3b 5 role sistem dari kode dipindah jadi baris DB (bisa diedit & di-clone)
--   4a hapus role diblokir selama masih dipakai user (dicek di controller)
-- Resolver: overrides ?? max-level(role user dari DB) ?? matrix kode utk role legacy.
-- Seed + backfill di bawah membuat SEMUA user yang ada punya user_roles = role
-- legacy-nya, jadi perilaku akses hari ini identik sebelum role kustom ditambahkan.

CREATE TABLE IF NOT EXISTS rbac.roles (
  role_key      text PRIMARY KEY,           -- slug, mis. 'ppc' / 'administrator'
  name          text NOT NULL,              -- nama tampilan, mis. 'PPC'
  description   text NOT NULL DEFAULT '',
  default_level text NOT NULL DEFAULT 'no_access'
                CHECK (default_level IN ('no_access','read_only','full_access')),
  is_system     boolean NOT NULL DEFAULT false,  -- 5 role bawaan dari kode
  is_active     boolean NOT NULL DEFAULT true,
  created_by    integer,                    -- users.id pembuat (audit)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    integer,                    -- users.id pengedit terakhir (audit)
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Isi paket: baris EKSPLISIT per (role, fitur). Fitur yang tidak tercantum
-- jatuh ke roles.default_level (pengganti `__default__` matrix kode).
CREATE TABLE IF NOT EXISTS rbac.role_permissions (
  role_key    text NOT NULL REFERENCES rbac.roles(role_key) ON DELETE CASCADE,
  feature_id  text NOT NULL,                -- id katalog apps/api/rbac/features.js
  level       text NOT NULL CHECK (level IN ('no_access','read_only','full_access')),
  updated_by  integer,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_key, feature_id)
);

-- User <-> role (N:M). Satu user boleh punya banyak paket (1a).
CREATE TABLE IF NOT EXISTS rbac.user_roles (
  user_id     integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_key    text NOT NULL REFERENCES rbac.roles(role_key) ON DELETE CASCADE,
  assigned_by integer,                      -- users.id pemberi (audit)
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_key)
);

CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_role ON rbac.user_roles(role_key);
CREATE INDEX IF NOT EXISTS idx_rbac_role_permissions_feature ON rbac.role_permissions(feature_id);

-- ------------------------------------------------------------------
-- SEED 5 role sistem — cermin persis permissionMatrix.js (backend) supaya
-- perilaku resolver tidak berubah untuk user yang belum disentuh admin.
-- default_level = nilai `__default__` role di matrix.
-- ------------------------------------------------------------------
INSERT INTO rbac.roles (role_key, name, description, default_level, is_system) VALUES
  ('administrator', 'Administrator', 'Role bawaan sistem — akses penuh ke semua fitur.', 'full_access', true),
  ('supervisor',    'Supervisor',    'Role bawaan sistem — pengawas produksi.',          'read_only',   true),
  ('foreman',       'Foreman',       'Role bawaan sistem — mandor lantai produksi.',     'read_only',   true),
  ('warehouse',     'Warehouse',     'Role bawaan sistem — gudang & consumable.',        'no_access',   true),
  ('user',          'User',          'Role bawaan sistem — akses dasar.',                'no_access',   true)
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO rbac.role_permissions (role_key, feature_id, level) VALUES
  -- supervisor (default read_only)
  ('supervisor', 'sow_management',       'full_access'),
  ('supervisor', 'sow_scheduling',       'full_access'),
  ('supervisor', 'sow_verification',     'full_access'),
  ('supervisor', 'timesheet_validation', 'full_access'),
  ('supervisor', 'machine_hours',        'full_access'),
  ('supervisor', 'roster_operator',      'full_access'),
  ('supervisor', 'manage_users',         'no_access'),
  ('supervisor', 'ms_project_admin',     'no_access'),
  ('supervisor', 'config_rules',         'no_access'),
  -- foreman (default read_only)
  ('foreman', 'sow_management',       'full_access'),
  ('foreman', 'sow_verification',     'full_access'),
  ('foreman', 'timesheet_validation', 'full_access'),
  ('foreman', 'machine_hours',        'full_access'),
  ('foreman', 'roster_operator',      'full_access'),
  ('foreman', 'manage_users',         'no_access'),
  ('foreman', 'ms_project_admin',     'no_access'),
  -- warehouse (default no_access)
  ('warehouse', 'operations_hub',      'read_only'),
  ('warehouse', 'dashboard',           'read_only'),
  ('warehouse', 'consumable_control',  'full_access'),
  ('warehouse', 'tools_management',    'full_access'),
  ('warehouse', 'receiving_shipment',  'full_access'),
  ('warehouse', 'component_tracking',  'read_only'),
  ('warehouse', 'sow_management',      'read_only'),
  -- user (default no_access)
  ('user', 'operations_hub', 'read_only'),
  ('user', 'dashboard',      'read_only'),
  ('user', 'ews',            'read_only'),
  ('user', 'sow_management', 'read_only')
ON CONFLICT (role_key, feature_id) DO NOTHING;

-- ------------------------------------------------------------------
-- BACKFILL user_roles dari role legacy (users.role / users.roles).
-- 'admin' (alias lama) dinormalisasi ke 'administrator'. User tanpa role
-- dikenal TIDAK di-backfill (tetap pakai fallback matrix kode di resolver).
-- ------------------------------------------------------------------
INSERT INTO rbac.user_roles (user_id, role_key)
SELECT
  u.id,
  CASE WHEN lower(coalesce(nullif(trim(u.roles), ''), u.role)) = 'admin'
       THEN 'administrator'
       ELSE lower(coalesce(nullif(trim(u.roles), ''), u.role)) END
FROM public.users u
WHERE lower(coalesce(nullif(trim(u.roles), ''), u.role))
      IN ('administrator','supervisor','foreman','warehouse','user','admin')
ON CONFLICT (user_id, role_key) DO NOTHING;

-- ROLLBACK:
--   DROP TABLE rbac.user_roles, rbac.role_permissions, rbac.roles;
--   (tabel rbac.user_permissions yang lama TIDAK ikut dihapus — schema dipertahankan)
