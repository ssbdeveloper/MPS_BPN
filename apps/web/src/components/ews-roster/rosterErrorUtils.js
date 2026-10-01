// Error mapping utility for EWS roster configuration.
// Translates backend error codes and SQL/technical messages to clear operational English.

const ERROR_MAP = {
  SOW_REFERENCE_CONFLICT: 'Changes are blocked because this shift is referenced by active machine schedules, capacity allocations, or overtime requests. Please review shop-floor schedules before modifying.',
  P0409: 'Operation blocked: active machine schedules or capacity allocations depend on this shift.',
  PREVIEW_STALE: 'Schedule conditions on the server have changed. The preview has been refreshed. Please review and re-confirm.',
  PREVIEW_REQUIRED: 'A fresh preview verification token is required for same-day schedule modifications. Please refresh the preview.',
  SHIFT_OVERLAP: 'Shift hours conflict with an adjacent shift schedule. Shift time windows must not overlap.',
  OVERLAP_CONFLICT: 'Removing this override would restore default hours that conflict with an adjacent shift schedule.',
  DEFAULT_PROTECTED: 'Default master shifts cannot be deleted directly.',
  PAST_DATE_LOCKED: 'Past dates are locked and cannot be modified.',
  RANGE_TOO_LONG: 'The requested date range exceeds the maximum allowed limit of 62 days.',
  RANGE_INVALID: 'The end date cannot be earlier than the start date.',
  REASON_REQUIRED: 'An operational explanation of at least 10 characters is required for same-day modifications.',
  REASON_TOO_LONG: 'The operational reason cannot exceed 200 characters.',
  DEFAULT_SHIFT_MISSING: 'Default master shifts (DAY/NIGHT) are not properly configured in the system database.',
  RETRYABLE_CONFLICT: 'A concurrent update occurred. Please try again in a few moments.',
  TODAY_CONFIRMATION_REQUIRED: 'Explicit confirmation of today\'s impact is required before applying.',
  INVALID_PAYLOAD: 'The submitted schedule data is invalid.',
  INVALID_DATE: 'Invalid date format provided. Expected YYYY-MM-DD.',
  INVALID_SHIFTS: 'Please select valid shift configurations (DAY and/or NIGHT).',
  INVALID_TIME: 'Invalid shift time format. Expected HH:MM (24-hour clock).',
  INVALID_SPAN: 'Shift duration is invalid. Start and end times cannot be identical.',
  STANDARD_EXCEEDS_SPAN: 'Net working hours cannot exceed the total shift duration span.',
};

export function translateRosterError(err, fallback = 'An unexpected error occurred while updating the schedule') {
  if (!err) return '';
  if (typeof err === 'string') {
    if (err.includes('SOW_REFERENCE_CONFLICT') || err.includes('P0409')) {
      return ERROR_MAP.SOW_REFERENCE_CONFLICT;
    }
    if (err.includes('PREVIEW_STALE')) return ERROR_MAP.PREVIEW_STALE;
    if (err.includes('OVERLAP_CONFLICT') || err.includes('bertumpuk')) return ERROR_MAP.OVERLAP_CONFLICT;
    if (err.includes('SHIFT_OVERLAP') || err.includes('overlap')) return ERROR_MAP.SHIFT_OVERLAP;
    return err;
  }

  const code = err.code || err.statusText;
  if (code && ERROR_MAP[code]) {
    return ERROR_MAP[code];
  }

  const msg = err.message || '';
  if (msg.includes('SOW_REFERENCE_CONFLICT') || msg.includes('P0409') || msg.includes('referensi SOW')) {
    return ERROR_MAP.SOW_REFERENCE_CONFLICT;
  }
  if (msg.includes('PREVIEW_STALE') || msg.includes('kedaluwarsa') || msg.includes('telah berubah')) {
    return ERROR_MAP.PREVIEW_STALE;
  }
  if (msg.includes('OVERLAP_CONFLICT') || msg.includes('menimbulkan overlap')) {
    return ERROR_MAP.OVERLAP_CONFLICT;
  }
  if (msg.includes('SHIFT_OVERLAP') || msg.includes('bertabrakan')) {
    return ERROR_MAP.SHIFT_OVERLAP;
  }

  return msg || fallback;
}
