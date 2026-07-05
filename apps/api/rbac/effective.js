// RBAC — effective permission resolver (role default + per-user override).
// ------------------------------------------------------------------
//   effectiveLevel = user_permissions[user][feature] ?? roleMatrix[role][feature]
// Overrides come from rbac.user_permissions; no row => inherit the role default.

const db = require('../db');
const { resolveLevel, actionAllowed } = require('./permissionMatrix');

// All overrides for one user as { feature_id: level }. Empty if none / no user id.
async function getUserOverrides(userId) {
  const id = parseInt(userId, 10);
  if (!Number.isInteger(id)) return {};
  const r = await db.query(
    'SELECT feature_id, level FROM rbac.user_permissions WHERE user_id = $1',
    [id],
  );
  const map = {};
  for (const row of r.rows) map[row.feature_id] = row.level;
  return map;
}

// Effective level for one (user, role, feature).
async function effectiveLevel(userId, role, feature) {
  const overrides = await getUserOverrides(userId);
  return overrides[feature] ?? resolveLevel(role, feature);
}

// Is (user, role) allowed to do `action` on `feature`?
async function isAllowed(userId, role, feature, action) {
  return actionAllowed(await effectiveLevel(userId, role, feature), action);
}

// Per-feature breakdown for the admin UI: role default vs override vs effective.
async function effectiveMap(userId, role, featureIds) {
  const overrides = await getUserOverrides(userId);
  const out = {};
  for (const f of featureIds) {
    const roleLevel = resolveLevel(role, f);
    const override = overrides[f] ?? null;
    out[f] = { role: roleLevel, override, effective: override ?? roleLevel };
  }
  return out;
}

module.exports = { getUserOverrides, effectiveLevel, isAllowed, effectiveMap };
