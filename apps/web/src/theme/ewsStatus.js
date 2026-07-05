// ------------------------------------------------------------------
// EWS status (traffic-light) + brand tokens — single source of truth.
//
// STATUS colors express health and are the ONLY thing that should carry
// green/amber/red meaning:
//   normal   -> soft green (muted, not neon)
//   watch    -> amber
//   critical -> red
//   no_data  -> neutral slate
//
// BRAND blue is reserved for logo / data only. It must never indicate status.
// ------------------------------------------------------------------

export const STATUS_TOKENS = {
  normal:   { bg: '#ECFDF5', text: '#047857', solid: '#059669', border: '#A7F3D0' },
  watch:    { bg: '#FEF3C7', text: '#B45309', solid: '#F59E0B', border: '#FDE68A' },
  critical: { bg: '#FCEBEB', text: '#A32D2D', solid: '#E24B4A', border: '#F4C9C9' },
  no_data:  { bg: '#F1F5F9', text: '#64748B', solid: '#94A3B8', border: '#E2E8F0' },
};

export const BRAND = {
  blue: '#378ADD',
  blueStrong: '#185FA5',
};

// Normalize any status/severity string to a token key.
export function statusKey(value) {
  const s = String(value || '').toLowerCase();
  if (s === 'critical' || s === 'error') return 'critical';
  if (s === 'watch' || s === 'warning' || s === 'stale') return 'watch';
  if (s === 'normal' || s === 'fresh' || s === 'live' || s === 'closed') return 'normal';
  return 'no_data';
}

export function statusToken(value) {
  return STATUS_TOKENS[statusKey(value)] || STATUS_TOKENS.no_data;
}

// Badge: *-bg background, *-text text, *-border border (rule 2).
export function badgeStyle(value) {
  const t = statusToken(value);
  return { backgroundColor: t.bg, color: t.text, borderColor: t.border };
}

// Badge dot uses the *-text token (rule 2).
export function dotStyle(value) {
  const t = statusToken(value);
  return { backgroundColor: t.text };
}

// Progress bars / sparklines / any solid status fill use the *-solid token.
export function solidColor(value) {
  return statusToken(value).solid;
}
