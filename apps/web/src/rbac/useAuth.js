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

export function useAuth() {
  const user = readAuthUser();
  return {
    user,
    role: normalizeRole(user?.roles),
    isAuthenticated: isAuthenticated(),
  };
}
