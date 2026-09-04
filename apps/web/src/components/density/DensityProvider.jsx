import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DensityContext, STORAGE_KEY, VALID, readStored } from './DensityContext';

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

export default DensityProvider;
