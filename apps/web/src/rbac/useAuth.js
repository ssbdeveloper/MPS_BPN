// Single place that reads the logged-in user + role from sessionStorage.
// (No auth context exists in the app; everything funnels through here so a
// real store can replace it later without changing callers.)
import { normalizeRole } from './permissionMatrix';

export function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

export function getRole() {
  return normalizeRole(readAuthUser()?.roles);
}

// Effective permissions for the logged-in user (feature -> level), loaded at login
// from /auth/me/permissions. null if not loaded (callers fall back to the role matrix).
export function readAuthPermissions() {
  try {
    return JSON.parse(sessionStorage.getItem('authPermissions') || 'null');
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return sessionStorage.getItem('isVerified') === 'true';
}

// Identity headers for API calls that the backend gates by role (x-user-role) or
// user (x-user-id). Same shape the RBAC guard reads. Empty object when logged out.
export function authHeaders() {
  const user = readAuthUser();
  if (!user) return {};
  return {
    'x-user-id': user.id != null ? String(user.id) : '',
    'x-user-name': user.name || user.username || '',
    'x-user-role': user.roles || user.role || '',
  };
}

export function useAuth() {
  const user = readAuthUser();
  return {
    user,
    role: normalizeRole(user?.roles),
    isAuthenticated: isAuthenticated(),
  };
}
