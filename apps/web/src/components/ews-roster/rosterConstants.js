// Shared constants and helpers for EWS roster configuration.

export const STATUS_OPTIONS = ['SCHEDULED', 'LEAVE', 'SICK', 'PERMIT', 'SITE_VISIT', 'OFF'];
export const EXCUSED = ['LEAVE', 'SICK', 'PERMIT', 'SITE_VISIT', 'OFF'];
export const EMPTY_DELETE_DIALOG = { isOpen: false, preview: null, overrideId: null, error: null, stale: false };
export const STALE_REFRESHED_MSG = 'Schedule conditions on the server have changed. The preview has been refreshed. Please review and re-confirm.';
export const REFRESH_FAILED_MSG = 'The preview expired and could not be reloaded. Submission is disabled until refreshed successfully.';

export function todayLocalISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}
