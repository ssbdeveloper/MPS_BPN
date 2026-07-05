import { useCan } from './usePermissions';

/**
 * Declarative guard for write UI:
 *   <Can feature="sow_management" action="write">
 *     <button>Create</button>
 *   </Can>
 * Renders `fallback` (default null) when not allowed. Children may be a render
 * function if you need the boolean: {(allowed) => ...}.
 */
export default function Can({ feature, action = 'read', fallback = null, children }) {
  const allowed = useCan(feature, action);
  if (typeof children === 'function') return children(allowed);
  return allowed ? children : fallback;
}
