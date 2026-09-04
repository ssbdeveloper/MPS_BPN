import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'mps.density';
const VALID = new Set(['normal', 'compact']);

const DensityContext = createContext(null);

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return VALID.has(raw) ? raw : 'normal';
  } catch {
    // Safari private mode melempar saat localStorage diakses. Kepadatan adalah
    // preferensi, bukan syarat kerja — jatuh ke default, jangan jatuhkan halaman.
    return 'normal';
  }
}

export function DensityProvider({ children }) {
  const [density, setDensityState] = useState(readStored);

  const setDensity = useCallback((value) => {
    if (!VALID.has(value)) return;
    setDensityState(value);
  }, []);

  const toggle = useCallback(() => {
    setDensityState((prev) => (prev === 'normal' ? 'compact' : 'normal'));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, density);
    } catch {
      // sama seperti readStored — kegagalan menyimpan tidak boleh merusak UI
    }
  }, [density]);

  const value = useMemo(() => ({ density, setDensity, toggle }), [density, setDensity, toggle]);

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

// useDensity harus hidup di file yang sama dengan DensityProvider agar konsumen impor
// satu modul; ini file pertama di codebase dengan pola Context+hook, jadi belum ada
// precedent lain untuk diikuti.
// eslint-disable-next-line react-refresh/only-export-components
export function useDensity() {
  const ctx = useContext(DensityContext);
  if (!ctx) {
    throw new Error('useDensity harus dipakai di dalam <DensityProvider>');
  }
  return ctx;
}

export default DensityProvider;
