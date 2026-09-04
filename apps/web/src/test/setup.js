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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
