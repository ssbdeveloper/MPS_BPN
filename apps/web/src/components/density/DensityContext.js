import { createContext, useContext } from 'react';

export const STORAGE_KEY = 'mps.density';
export const VALID = new Set(['normal', 'compact']);

export const DensityContext = createContext(null);

export function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return VALID.has(raw) ? raw : 'normal';
  } catch {
    // Safari private mode melempar saat localStorage diakses. Kepadatan adalah
    // preferensi, bukan syarat kerja — jatuh ke default, jangan jatuhkan halaman.
    return 'normal';
  }
}

export function useDensity() {
  const ctx = useContext(DensityContext);
  if (!ctx) {
    throw new Error('useDensity harus dipakai di dalam <DensityProvider>');
  }
  return ctx;
}
