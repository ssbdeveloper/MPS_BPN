export const APP_VARIANT = String(import.meta.env.VITE_APP_VARIANT || 'salvaging')
  .split('#')[0]
  .trim()
  .split(/\s+/)[0]
  .toLowerCase();

export const isManufacturing = APP_VARIANT === 'manufacturing';
export const isSalvaging = !isManufacturing;
