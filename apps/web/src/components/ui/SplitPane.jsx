import React, { useCallback, useEffect, useRef, useState } from 'react';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function SplitPane({
  storageKey,
  left,
  right,
  minLeft = 280,
  maxLeft = 640,
  defaultLeft = 380,
}) {
  const key = `mps.split.${storageKey}`;

  const [width, setWidth] = useState(() => {
    try {
      const raw = Number(window.localStorage.getItem(key));
      return Number.isFinite(raw) && raw > 0 ? clamp(raw, minLeft, maxLeft) : defaultLeft;
    } catch {
      return defaultLeft;
    }
  });

  const draggingRef = useRef(false);
  const containerRef = useRef(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(width));
    } catch {
      // preferensi, bukan syarat kerja
    }
  }, [key, width]);

  const onPointerMove = useCallback((event) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setWidth(clamp(event.clientX - rect.left, minLeft, maxLeft));
  }, [minLeft, maxLeft]);

  const stopDrag = useCallback(() => {
    draggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDrag);
      // stopDrag() WAJIB dipanggil di cleanup, bukan hanya melepas listener. Kalau komponen
      // unmount di tengah drag (pindah route saat divider sedang ditarik), body tertinggal
      // dengan cursor:'col-resize' dan userSelect:'none' SELAMANYA — di SELURUH aplikasi,
      // bukan hanya halaman ini, karena gayanya dipasang di document.body. Kerusakannya
      // muncul jauh dari komponen ini dan hampir mustahil dilacak balik.
      stopDrag();
    };
  }, [onPointerMove, stopDrag]);

  const startDrag = () => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // Keyboard: separator harus bisa digeser tanpa mouse.
  const onKeyDown = (event) => {
    if (event.key === 'ArrowLeft') setWidth((w) => clamp(w - 16, minLeft, maxLeft));
    else if (event.key === 'ArrowRight') setWidth((w) => clamp(w + 16, minLeft, maxLeft));
    else return;
    event.preventDefault();
  };

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
      <div data-testid="splitpane-left" style={{ width: `${width}px` }} className="flex min-h-0 shrink-0 flex-col overflow-hidden">
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={onKeyDown}
        className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
      >
        <span className="h-full w-px bg-slate-200 transition-colors duration-150 group-hover:bg-[#90e0ef] motion-reduce:transition-none" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{right}</div>
    </div>
  );
}
