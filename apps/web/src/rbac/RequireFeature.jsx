import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { resolveLevel, canRead } from './permissionMatrix';
import NoAccessPage from './NoAccessPage';

/**
 * Route/page guard. Blocks BEFORE the page renders:
 *   - not logged in        -> redirect to "/"
 *   - level = no_access    -> NoAccessPage (hard block, not just hidden)
 *   - read_only / full     -> render the page (write is gated inside via <Can>)
 */
export default function RequireFeature({ feature, children }) {
  const { isAuthenticated, role } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  if (!canRead(resolveLevel(role, feature))) {
    return <NoAccessPage feature={feature} />;
  }
  return children;
}
