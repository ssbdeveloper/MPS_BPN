// ------------------------------------------------------------------
// RBAC — single source of truth for "who can do what".
//
// Model: each user has ONE role (string). Access to a feature is one of
// three levels. `resolveLevel(role, featureId)` is the ONLY function the
// rest of the app calls, so the backing store can later move from this
// static map to an API/DB without touching any component.
// ------------------------------------------------------------------

export const LEVELS = {
  NO_ACCESS: 'no_access',
  READ_ONLY: 'read_only',
  FULL_ACCESS: 'full_access',
};

// Numeric rank for comparisons (higher = more access).
const RANK = {
  [LEVELS.NO_ACCESS]: 0,
  [LEVELS.READ_ONLY]: 1,
  [LEVELS.FULL_ACCESS]: 2,
};

export function rankOf(level) {
  return RANK[level] ?? 0;
}

// Known roles. `admin` is an alias for `administrator` (data inconsistency
// in the users table). Add new roles here + a row in PERMISSION_MATRIX.
export const ROLES = ['administrator', 'supervisor', 'foreman', 'warehouse', 'user'];

export function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'admin') return 'administrator';
  return r;
}

// Special key: per-role fallback level for any feature not listed explicitly.
const DEFAULT_KEY = '__default__';

// role -> { featureId: level, __default__: level }
// NOTE: These are sensible defaults — tune per business rules. `administrator`
// gets full access to everything via its __default__.
export const PERMISSION_MATRIX = {
  administrator: {
    [DEFAULT_KEY]: LEVELS.FULL_ACCESS,
  },

  supervisor: {
    [DEFAULT_KEY]: LEVELS.READ_ONLY,
    sow_management: LEVELS.FULL_ACCESS,
    sow_scheduling: LEVELS.FULL_ACCESS,
    timesheet_validation: LEVELS.FULL_ACCESS,
    machine_hours: LEVELS.FULL_ACCESS,
    manage_users: LEVELS.NO_ACCESS,
    ms_project_admin: LEVELS.NO_ACCESS,
  },

  foreman: {
    [DEFAULT_KEY]: LEVELS.READ_ONLY,
    sow_management: LEVELS.FULL_ACCESS,
    timesheet_validation: LEVELS.FULL_ACCESS,
    machine_hours: LEVELS.FULL_ACCESS,
    manage_users: LEVELS.NO_ACCESS,
    ms_project_admin: LEVELS.NO_ACCESS,
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

// Fallback for an unknown role (not administrator, not in matrix): treat as the
// most restrictive so access is never granted by accident.
const UNKNOWN_ROLE_LEVEL = LEVELS.NO_ACCESS;

/**
 * The ONE resolver. Returns the access LEVEL for a role on a feature.
 * Swap the body for an API/DB lookup later — signature stays the same.
 */
export function resolveLevel(role, featureId) {
  const normalized = normalizeRole(role);
  const roleMatrix = PERMISSION_MATRIX[normalized];
  if (!roleMatrix) return UNKNOWN_ROLE_LEVEL;
  return roleMatrix[featureId] ?? roleMatrix[DEFAULT_KEY] ?? LEVELS.NO_ACCESS;
}

// Convenience predicates used across the app.
export function canRead(level) {
  return rankOf(level) >= RANK[LEVELS.READ_ONLY];
}

export function canWrite(level) {
  return rankOf(level) >= RANK[LEVELS.FULL_ACCESS];
}

// Map an action verb to the level it requires.
const WRITE_ACTIONS = new Set(['write', 'create', 'edit', 'update', 'delete', 'submit', 'save', 'approve']);

export function actionAllowed(level, action) {
  if (WRITE_ACTIONS.has(String(action || '').toLowerCase())) return canWrite(level);
  return canRead(level); // 'read' | 'view' | anything else
}
