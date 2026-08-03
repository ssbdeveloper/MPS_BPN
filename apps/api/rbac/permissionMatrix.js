// RBAC — backend mirror of apps/web/src/rbac/permissionMatrix.js (CommonJS).
// ------------------------------------------------------------------
// INTERIM: this is a hand-kept COPY of the frontend matrix data. The two MUST
// stay identical — see docs/security/RBAC_BACKEND_ENFORCEMENT_PLAN.md §3. The
// proper fix is a single shared JSON both sides read; until then, any change to
// the FE matrix must be mirrored here (and vice-versa).
//
// Difference from FE today: adds `sow_verification` (daily verification writes,
// which the FE registry still needs too — added in a later phase).

const LEVELS = { NO_ACCESS: 'no_access', READ_ONLY: 'read_only', FULL_ACCESS: 'full_access' };
const RANK = { no_access: 0, read_only: 1, full_access: 2 };
const DEFAULT_KEY = '__default__';

const ROLES = ['administrator', 'supervisor', 'foreman', 'warehouse', 'user'];

function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  return r === 'admin' ? 'administrator' : r;
}

// role -> { featureId: level, __default__: level }  (mirror of FE + sow_verification)
//
// CATATAN Fase 0 / D1 — pemecahan `ms_project_admin`:
// `bay_scheduling`, `msproject_mapping`, dan `msproject_collab` SENGAJA tidak
// didaftarkan di role mana pun. Ketiganya jatuh ke `__default__` masing-masing role:
// administrator FULL_ACCESS, supervisor/foreman READ_ONLY (write butuh full_access →
// tetap ditolak), warehouse/user NO_ACCESS. Owner meng-assign per orang lewat
// `rbac.user_permissions`. JANGAN memberi FULL_ACCESS ke role mana pun di sini.
const PERMISSION_MATRIX = {
  administrator: { [DEFAULT_KEY]: LEVELS.FULL_ACCESS },

  supervisor: {
    [DEFAULT_KEY]: LEVELS.READ_ONLY,
    sow_management: LEVELS.FULL_ACCESS,
    sow_scheduling: LEVELS.FULL_ACCESS,
    sow_verification: LEVELS.FULL_ACCESS,
    timesheet_validation: LEVELS.FULL_ACCESS,
    machine_hours: LEVELS.FULL_ACCESS,
    roster_operator: LEVELS.FULL_ACCESS,
    manage_users: LEVELS.NO_ACCESS,
    ms_project_admin: LEVELS.NO_ACCESS, // dipersempit: force-checkin/kalender/resource saja
  },

  foreman: {
    [DEFAULT_KEY]: LEVELS.READ_ONLY,
    sow_management: LEVELS.FULL_ACCESS,
    sow_verification: LEVELS.FULL_ACCESS,
    timesheet_validation: LEVELS.FULL_ACCESS,
    machine_hours: LEVELS.FULL_ACCESS,
    roster_operator: LEVELS.FULL_ACCESS,
    manage_users: LEVELS.NO_ACCESS,
    ms_project_admin: LEVELS.NO_ACCESS, // dipersempit: force-checkin/kalender/resource saja
  },

  warehouse: {
    [DEFAULT_KEY]: LEVELS.NO_ACCESS,
    operations_hub: LEVELS.READ_ONLY,
    dashboard: LEVELS.READ_ONLY,
    consumable_control: LEVELS.FULL_ACCESS,
    tools_management: LEVELS.FULL_ACCESS,
    receiving_shipment: LEVELS.FULL_ACCESS,
    component_tracking: LEVELS.READ_ONLY,
    sow_management: LEVELS.READ_ONLY,
  },

  user: {
    [DEFAULT_KEY]: LEVELS.NO_ACCESS,
    operations_hub: LEVELS.READ_ONLY,
    dashboard: LEVELS.READ_ONLY,
    ews: LEVELS.READ_ONLY,
    sow_management: LEVELS.READ_ONLY,
  },
};

const UNKNOWN_ROLE_LEVEL = LEVELS.NO_ACCESS;

// The ONE resolver (role default only — per-user overrides live in ./effective.js).
function resolveLevel(role, featureId) {
  const roleMatrix = PERMISSION_MATRIX[normalizeRole(role)];
  if (!roleMatrix) return UNKNOWN_ROLE_LEVEL;
  return roleMatrix[featureId] ?? roleMatrix[DEFAULT_KEY] ?? LEVELS.NO_ACCESS;
}

const rankOf = (level) => RANK[level] ?? 0;
const canRead = (level) => rankOf(level) >= RANK.read_only;
const canWrite = (level) => rankOf(level) >= RANK.full_access;

const WRITE_ACTIONS = new Set(['write', 'create', 'edit', 'update', 'delete', 'submit', 'save', 'approve']);
function actionAllowed(level, action) {
  return WRITE_ACTIONS.has(String(action || '').toLowerCase()) ? canWrite(level) : canRead(level);
}

module.exports = {
  LEVELS, ROLES, DEFAULT_KEY, PERMISSION_MATRIX,
  normalizeRole, resolveLevel, rankOf, canRead, canWrite, actionAllowed,
};
