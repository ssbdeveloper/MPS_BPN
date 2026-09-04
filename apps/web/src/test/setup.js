import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// matchMedia tidak ada di jsdom. Beberapa komponen (RouteTransition) membacanya
// untuk prefers-reduced-motion, jadi disediakan default yang bisa ditimpa per test.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom (25.x) belum mengimplementasikan PointerEvent. Tanpa ini, @testing-library/dom
// diam-diam jatuh balik ke Event dasar untuk fireEvent.pointerDown/Move/Up, sehingga
// properti seperti clientX hilang dan komponen berbasis drag (mis. SplitPane) tak bisa
// diuji secara realistis. MouseEvent di jsdom sudah punya clientX/clientY, jadi cukup
// dijadikan basis subclass.
if (!window.PointerEvent) {
  class PointerEvent extends window.MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEvent;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
