import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { usePermissions } from './usePermissions';
import NoAccessPage from './NoAccessPage';

/**
 * Route/page guard. Blocks BEFORE the page renders:
 *   - not logged in        -> redirect to "/"
 *   - level = no_access    -> NoAccessPage (hard block, not just hidden)
 *   - read_only / full     -> render the page (write is gated inside via <Can>)
 *
 * Level comes from usePermissions (override-aware), NOT resolveLevel(role) alone.
 * Sebelumnya guard ini membaca matrix ROLE saja, jadi izin per-user dari Setting User
 * diam-diam tidak berlaku untuk halaman ber-guard: mis. role `user` + override
 * roster_operator=read_only tetap kena NoAccessPage, padahal menunya muncul (sidebar
 * memang sudah override-aware). Guard dan menu WAJIB memakai resolver yang sama.
 */
export default function RequireFeature({ feature, children }) {
  const { isAuthenticated } = useAuth();
  const { canRead } = usePermissions();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  if (!canRead(feature)) {
    return <NoAccessPage feature={feature} />;
  }
  return children;
}
