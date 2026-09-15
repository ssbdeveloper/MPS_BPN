# 2026-09-07 — RBAC Role sebagai Paket Akses (Manage Users)

## Ringkasan
Manage Users kini punya 2 tab: **Users** (akun + role utama + role paket + override
per-user) dan **Roles** (kelola paket akses: buat/edit/clone/hapus). Role bukan lagi
konstanta kode — disimpan di DB dan bisa ditempelkan ke banyak user sekaligus; edit
role sekali = semua pemakainya ikut.

## Keputusan owner (spec docs/planning/rbac-role-paket.md)
1a user boleh pegang BANYAK role — akses efektif = level tertinggi per fitur.
2a override per-user (rbac.user_permissions) tetap lapisan teratas.
3b 5 role sistem (administrator/supervisor/foreman/warehouse/user) dipindah jadi
   baris DB — bisa diedit & di-clone dari UI.
4a hapus role DIBLOKIR selama masih dipakai ≥1 user (409 + jumlah pemakai).
5a semua di ManageUsersPage yang ada (tab), tanpa route halaman baru.

## Model data (migration 20260907_rbac_roles.sql — applied CKP ptssb)
- rbac.roles (role_key slug, name, description, default_level, is_system, audit)
  — default_level = pengganti `__default__` matrix kode.
- rbac.role_permissions (role_key, feature_id, level) — baris eksplisit paket.
- rbac.user_roles (user_id, role_key) N:M.
- Seed 5 role sistem persis permissionMatrix.js (27 baris permission) + backfill
  user_roles = role legacy tiap user (33/33; 'admin' dinormalisasi → administrator).
  Perilaku akses existing IDENTIK sebelum fitur ini; role baru menumpuk di atas.
- Resolver (apps/api/rbac/effective.js):
  override ?? max-level(role DB user) ?? matrix kode (fallback hanya jika user tanpa
  user_roles). effectiveMap menambah field `base` (level tanpa override) untuk
  baseline "clear override" yang akurat di UI.

## API baru (semua feat manage_users, W di manifest; admin-only via requireAdmin)
- GET  /auth/roles — daftar role + permissions + user_count (listUsers + role_keys)
- POST /auth/roles; PUT /auth/roles/:role_key (replace full-set); DELETE (4a: 409)
- PUT  /auth/users/:id/roles — role utama legacy SELALU dipertahankan server-side
Backend features.js disinkronkan (+config_rules, +roster_foreman_team) — dua fitur
ini sebelumnya tidak ada di katalog backend padahal ada di manifest & FE.

## FE (commit 80a891d)
- apps/web/src/features/rbac/: SegmentedLevel, RolesTab (list+aksi), RoleEditorSheet
  (editor paket: default level + grid fitur per modul, None/Read/Full),
  UserEditorSheet (drawer user pindahan + chips "role packages" multi-pilih).
- ManageUsersPage ramping (~205 baris): header + tab + daftar user; baris user
  menampilkan role utama + paket tambahan ("pkg: ...").
- Grid override per-user memakai `base` dari server, jadi akurat walau role paket
  menaikkan level di atas matrix kode.

## Verifikasi
- Migration: 5 roles, 27 role_permissions, 33 user_roles (0 user tanpa role DB).
- API lokal (PORT 3777, skenario + cleanup, DB kembali bersih):
  create role ppc_test (3 fitur) → assign user baru (legacy 'user' dipertahankan:
  role_keys ['user','ppc_test']) → effective bay_scheduling/msproject_mapping
  full_access walau role user default no_access; dashboard read_only; override
  per-user no_access MENANG di atas role full; lepas override → balik full;
  hapus role terpakai → 409 "masih dipakai 1 user"; setelah dilepas → hapus OK;
  non-admin → 403; listUsers bawa role_keys.
- Resolver langsung: user 8 (supervisor) base == level role DB utk semua fitur;
  config_rules/roster_foreman_team kini ter-resolve (no_access / read_only).
- Gate: FE (deslop 0 error, eslint 0, vitest 43 pass, build PWA precache 185);
  backend gate 2 step pass; check_rbac_manifest tetap gagal 2 anomali dashboard
  PRA-ADA (sap-staging-exclusion) — bukan dari perubahan ini.

## Commit
- 80a891d feat(web): Manage Users — tab Roles + multi-role per user
- 8702ee5 feat(api): RBAC role packages — CRUD roles + assign user, resolver roles-aware
- 06c716e feat(web): Manage Users — UI modern full-width + animasi (rombak tampilan)
- fa943ee feat(api): role key izinkan titik + PUT users/:id/roles full-set persis
- 5393589 feat(web): Manage Users — murni role packages, key otomatis, UI professional
- 58c9341 feat(web): drawer setengah layar; Add User nama->username otomatis; list modern
(Spec, log, migration tetap untracked di repo — konsisten blocker PLANNING.md.)

## Catatan & lanjutan
- Perubahan akses user lain berlaku setelah user tsb LOGIN ULANG (authPermissions
  dimuat saat login — perilaku lama, tidak berubah).
- RBAC_ENFORCE masih 0 (log-only). Data role & UI siap; enforcement + pemakaian
  nyata role kustom menyusul terpisah (guard, requireAdmin, FE read).
- Role sistem bisa diedit (3b): hati-hati mengubah administrator/`__default__` —
  berpengaruh ke semua pemegangnya; hapus tetap aman (4a).

## Revisi UI (06c716e, sesi sama)
- Layout full-width desktop (max-w 1600px) — permintaan owner; stat cards, tabel
  grid Users (User/Role/Packages/Created) + kartu grid Roles; mobile tanpa scroll.
- Animasi framer-motion: tab pill (layoutId spring), transisi tab, drawer slide
  (Drawer.jsx shared), stagger list, exit saat hapus — semua hormati reduced-motion.
- Aksesibilitas/gate: tombol >=44px + focus ring; skeleton loading + error/retry +
  empty state; satu bahasa (EN); token design system.

## Revisi UI v2 (5393589, sesi sama) — umpan balik owner
- Role key otomatis dari NAMA (slug lowercase, karakter aneh -> titik, akhiran .2/.3
  otomatis saat bentrok) & TIDAK ditampilkan di UI; regex key backend + izin titik.
- Konsep "role utama/main role" DIHAPUS dari UI — user murni role packages
  (multi-pilih). Kolom users.role/roles legacy tersembunyi: seed 'user' saat buat,
  dipertahankan saat edit (dipakai header x-user-role & fallback resolver).
- PUT /auth/users/:id/roles kini full-set PERSIS (boleh kosong), tanpa paksa-merge
  legacy — server diverifikasi: [] mengosongkan assignment user.
- Picker paket di drawer user = container VERTIKAL sendiri (max-h + scroll) + search,
  tinggi drawer tetap; menampilkan 'N selected'; dot warna + nama (bukan key).
- Copy AI dihapus (caption "Effective access = ...", "(extra, can stack)", hint
  default level, dst).
- Pengelompokan modul fitur (featureRegistry): manage_users -> Core,
  machine_hours -> PPC, bay_scheduling & sow_verification -> PE, sow_subcont -> PPC.
- Baris fitur pakai GRID dua kolom (label + kontrol) supaya selalu rata; badge
  Override inline di kolom label (tidak menggeser segmented).
- Badge pelangi -> dot warna kecil + teks (roleTone util); font/komposisi netral.

## Revisi UI v3 (58c9341, sesi sama)
- Drawer edit user & role melebar ke ~setengah layar (w-full -> md:w-1/2, cap 54rem).
- Add User: field Name (auto Title Case per kata saat diketik); Username disable &
  otomatis dari nama (lowercase, spasi/karakter aneh -> titik, mis. 'Budi Setiawan' ->
  'budi.setiawan'); bentrok username -> akhiran .2/.3 otomatis saat create.
- Daftar user: stat cards ber-ikon, avatar ring, chip paket putih ber-border, chevron
  hover; Roles tab stat ikon seragam.
