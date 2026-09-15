-- RBAC — per-user permission overrides (interim x-role enforcement).
-- ------------------------------------------------------------------
-- Role defaults live in the permission matrix (apps/api/rbac/permissionMatrix.js,
-- mirrored from apps/web/src/rbac/permissionMatrix.js). This table stores ONLY
-- per-user overrides: no row for (user, feature) => inherit the role default.
--   effectiveLevel = user_permissions[user][feature] ?? roleMatrix[role][feature]
-- Empty table => everyone keeps their role default (nothing locked on rollout).

CREATE SCHEMA IF NOT EXISTS rbac;

CREATE TABLE IF NOT EXISTS rbac.user_permissions (
  user_id     integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature_id  text    NOT NULL,          -- matches featureRegistry ids
  level       text    NOT NULL CHECK (level IN ('no_access','read_only','full_access')),
  updated_by  integer,                   -- users.id of the admin who set it (audit)
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature_id)
);

-- Fast lookup of all overrides for one user (the resolver's hot path).
CREATE INDEX IF NOT EXISTS idx_rbac_user_permissions_user ON rbac.user_permissions(user_id);

-- ROLLBACK: DROP TABLE rbac.user_permissions;  (schema kept — harmless if empty)
