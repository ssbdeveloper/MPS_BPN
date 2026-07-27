import { getConfig } from './loadConfig';

// Varian kini runtime (dari /config), bukan build-time VITE_APP_VARIANT.
export function getVariant() {
  const v = String(getConfig()?.variant || 'salvaging').toLowerCase();
  return v === 'manufacturing' ? 'manufacturing' : 'salvaging';
}

export function isManufacturing() {
  return getVariant() === 'manufacturing';
}

export function isSalvaging() {
  return !isManufacturing();
}

export function getFeatureFlags() {
  return getConfig()?.feature_flags || {};
}
