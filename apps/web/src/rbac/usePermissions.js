import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { resolveLevel, actionAllowed, canRead, canWrite } from './permissionMatrix';

/**
 * Primary hook for action-level RBAC.
 *   const { can, canWrite, levelOf } = usePermissions();
 *   can('sow_management', 'write')  // hide/disable write buttons when read_only
 */
export function usePermissions() {
  const { role } = useAuth();
  return useMemo(() => ({
    role,
    levelOf: (feature) => resolveLevel(role, feature),
    can: (feature, action = 'read') => actionAllowed(resolveLevel(role, feature), action),
    canRead: (feature) => canRead(resolveLevel(role, feature)),
    canWrite: (feature) => canWrite(resolveLevel(role, feature)),
  }), [role]);
}

/** Convenience hook: `const canEdit = useCan('sow_management', 'write')`. */
export function useCan(feature, action = 'read') {
  const { can } = usePermissions();
  return can(feature, action);
}
