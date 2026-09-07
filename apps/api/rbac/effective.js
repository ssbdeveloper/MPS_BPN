// RBAC — effective permission resolver (per-user override + role packages + role default).
// ------------------------------------------------------------------
// Precedence (keputusan owner 2026-09-07, docs/planning/rbac-role-paket.md):
//   effectiveLevel = user_permissions[user][feature]            (1) override per-user (2a)
//                 ?? max-level atas role packages user (rbac.user_roles)  (1a)
//                 ?? matrix kode utk role legacy (fallback HANYA jika user
//                    tidak punya user_roles sama sekali)
//
// rbac.roles/role_permissions/user_roles di-seed & di-backfill oleh migration
// 20260907_rbac_roles.sql sehingga SEMUA user hari ini punya user_roles = role
// legacy-nya — perilaku akses identik dengan sebelum fitur ini, dan role paket
// baru (mis. `ppc`) tinggal menumpuk. Override per-user tetap lapisan teratas.

const db = require("../db");
const { resolveLevel, rankOf, LEVELS, actionAllowed } = require("./permissionMatrix");

const RANK_TO_LEVEL = {
  [rankOf(LEVELS.NO_ACCESS)]: LEVELS.NO_ACCESS,
  [rankOf(LEVELS.READ_ONLY)]: LEVELS.READ_ONLY,
  [rankOf(LEVELS.FULL_ACCESS)]: LEVELS.FULL_ACCESS,
};

// All overrides for one user as { feature_id: level }. Empty if none / no user id.
async function getUserOverrides(userId) {
  const id = parseInt(userId, 10);
  if (!Number.isInteger(id)) return {};
  const r = await db.query(
    "SELECT feature_id, level FROM rbac.user_permissions WHERE user_id = $1",
    [id],
  );
  const map = {};
  for (const row of r.rows) map[row.feature_id] = row.level;
  return map;
}

// Assigned role packages for one user: [{ default_level, perms: { feature_id: level } }].
// Empty array => user punya 0 role DB (caller memakai matrix kode role legacy).
async function getUserRoles(userId) {
  const id = parseInt(userId, 10);
  if (!Number.isInteger(id)) return [];
  const r = await db.query(
    `SELECT r.role_key, r.default_level,
            COALESCE(rp.feature_id, '') AS feature_id,
            COALESCE(rp.level, '') AS level
       FROM rbac.user_roles ur
       JOIN rbac.roles r ON r.role_key = ur.role_key AND r.is_active
       LEFT JOIN rbac.role_permissions rp ON rp.role_key = r.role_key
      WHERE ur.user_id = $1
      ORDER BY r.role_key`,
    [id],
  );
  const byKey = new Map();
  for (const row of r.rows) {
    if (!byKey.has(row.role_key)) {
      byKey.set(row.role_key, { role_key: row.role_key, default_level: row.default_level, perms: {} });
    }
    if (row.feature_id) byKey.get(row.role_key).perms[row.feature_id] = row.level;
  }
  return [...byKey.values()];
}

// Aggregated level per feature across ALL role packages user (1a: level tertinggi).
// Returns null when user has no DB roles (caller pakai matrix kode).
async function getDbLevelMap(userId, featureIds) {
  const roles = await getUserRoles(userId);
  if (roles.length === 0) return null;
  const levels = {};
  for (const f of featureIds) {
    let best = 0;
    for (const role of roles) {
      // Fitur yang tidak eksplisit di role_permissions jatuh ke default_level role itu.
      const r = rankOf(role.perms[f] ?? role.default_level);
      if (r > best) best = r;
    }
    levels[f] = RANK_TO_LEVEL[best];
  }
  return levels;
}

// Effective level for one (user, role, feature).
async function effectiveLevel(userId, role, feature) {
  const overrides = await getUserOverrides(userId);
  if (overrides[feature]) return overrides[feature];
  const dbMap = await getDbLevelMap(userId, [feature]);
  return dbMap ? dbMap[feature] : resolveLevel(role, feature);
}

// Is (user, role) allowed to do `action` on `feature`?
async function isAllowed(userId, role, feature, action) {
  return actionAllowed(await effectiveLevel(userId, role, feature), action);
}

// Per-feature breakdown for the admin UI: role default vs override vs effective.
// base = level tanpa override (role paket DB, atau matrix kode bila user tanpa role);
// FE memakainya sebagai baseline "clear override" yang akurat.
async function effectiveMap(userId, role, featureIds) {
  const overrides = await getUserOverrides(userId);
  const dbMap = await getDbLevelMap(userId, featureIds);
  const out = {};
  for (const f of featureIds) {
    const roleLevel = resolveLevel(role, f);
    const override = overrides[f] ?? null;
    const base = dbMap ? dbMap[f] : roleLevel;
    out[f] = {
      role: roleLevel,                       // baseline matrix kode (utk tampilan)
      base,                                  // level efektif tanpa override
      override,                              // lapisan (1) — null kalau tidak ada
      effective: override ?? base,
    };
  }
  return out;
}

module.exports = { getUserOverrides, getUserRoles, getDbLevelMap, effectiveLevel, isAllowed, effectiveMap };
