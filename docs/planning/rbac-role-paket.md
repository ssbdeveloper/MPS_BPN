# RBAC — Role sebagai Paket Akses (Manage Users)

Status: IMPLEMENTASI (keputusan owner 2026-09-07: 1a 2a 3b 4a 5a)
Lingkup: ManageUsersPage (tab Users + tab Roles) — fitur baru, bukan rombak UI.
DB: rbac schema (CKP ptssb). Branch: 2b.

## Masalah
Hari ini role itu STATIS di kode (5 role: administrator/supervisor/foreman/warehouse/user;
permissionMatrix.js dobel FE/backend). Admin hanya bisa override PER-USER per fitur
(rbac.user_permissions). Tidak ada "paket akses" bernama yang bisa dibuat, diedit, dan
ditempelkan ke banyak user sekaligus.

## Keputusan owner
- 1a: Satu user boleh pegang BANYAK role; akses efektif = level TERTINGGI per fitur
  dari semua role yang dipegang.
- 2a: Override per-user (rbac.user_permissions) PERTAHAN sebagai lapisan teratas.
- 3b: 5 role sistem dipindah jadi BARIS DB (rbac.roles) agar bisa diedit & di-clone.
- 4a: Hapus role DIBLOKIR selama masih dipakai ≥1 user (409 + jumlah pemakai).
- 5a: Dikerjakan di dalam ManageUsersPage yang ada (tab Users | Roles), tanpa route baru.

## Model
- rbac.roles(role_key PK slug, name, description, default_level, is_system, audit).
  default_level = level untuk fitur yang TIDAK tercantum di role_permissions
  (pengganti `__default__` matrix kode).
- rbac.role_permissions(role_key, feature_id, level) — isi paket (baris eksplisit).
- rbac.user_roles(user_id, role_key) — user "ditempeli" role (N:M).
- Resolver efektif (backend & /auth/me/permissions):
  overrides[user] ?? max-level(role user dari DB) ?? matrix kode utk legacy role.
  Jika user punya ≥1 user_roles → hasil DB dipakai (matrix kode hanya fallback utk user
  tanpa user_roles sama sekali). Backfill seed membuat semua user punya user_roles =
  role legacy-nya → perilaku lama identik, role baru menumpuk.
- role sistem utk role utama (kolom users.role/roles, header x-user-role) TETAP — dipakai
  badge, requireAdmin, dan gate admin controller. Role paket = lapisan tambahan.

## API (feat manage_users, W terdaftar di manifest)
- GET  /auth/roles                     → roles + permissions eksplisit + user_count
- POST /auth/roles                     → buat role + isi paket (slug ^[a-z][a-z0-9_]{0,31}$)
- PUT  /auth/roles/:role_key           → edit meta + replace isi paket (full-set)
- DELETE /auth/roles/:role_key         → 409 kalau masih dipakai (4a); else hapus
- PUT  /auth/users/:id/roles           → ganti assignment { role_keys: [] } PERSIS pilihan
                                         admin (boleh kosong); tidak ada role yang dipaksa-pertahankan
- GET  /auth/users (listUsers)         → + role_keys (array) per user
Semua admin-gated (requireAdmin, sama seperti endpoint manage-users lain).

## FE
- ManageUsersPage: tab bar Users | Roles. RolesTab = daftar role (badge sistem, nama,
  akses count, pemakai count) + aksi Edit / Clone / Hapus. RoleEditorDrawer = form
  nama+deskripsi+default level + grid fitur per module (level None/Read/Full) —
  komponen di apps/web/src/features/rbac/ supaya ManageUsersPage tetap ramping.
- UserEditDrawer: select Role utama (legacy) TETAP + chips "Role paket (tambahan)"
  multi-pilih; simpan via PUT /auth/users/:id/roles.
- Katalog fitur editor = backend features.js (disinkronkan: +config_rules,
  +roster_foreman_team) via GET /auth/roles (permissions memakai id katalog ini);
  label/module dari featureRegistry FE bila ada, fallback title-case.

## Perilaku yang dipastikan
- Edit role → semua pemakainya ikut (tanpa sentuh per-user).
- Clone role sistem (mis. supervisor) → titik awal paket kustom.
- Role yang mengubah akses user lain berlaku setelah user itu login ulang
  (authPermissions dimuat saat login, perilaku lama yang sama).
- RBAC_ENFORCE masih 0 (log-only) — data & UI siap; enforcement menyusul terpisah.

## Non-goals
- Tidak menyentuh enforcement mode, requireAdmin, kolom legacy users.role/roles.
- Tidak memperbaiki 2 anomali dashboard pra-ada di check_rbac_manifest.
- Tidak menghapus endpoint override per-user (2a).

## Rollback
DROP TABLE rbac.user_roles, rbac.role_permissions, rbac.roles (urutan FK);
hapus baris manifest/route/controller; revert file.
