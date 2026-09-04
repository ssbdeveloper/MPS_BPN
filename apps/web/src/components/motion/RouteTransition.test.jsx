import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import RouteTransition from './RouteTransition';
import { directionOffset, motionOffset } from './routeDirection';

function mockReducedMotion(matches) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('prefers-reduced-motion') ? matches : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe('RouteTransition', () => {
  beforeEach(() => mockReducedMotion(false));

  it('merender anaknya', () => {
    render(<RouteTransition routeKey="/a" depth={1}><p>content</p></RouteTransition>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('tetap merender anaknya saat reduced-motion aktif', () => {
    mockReducedMotion(true);
    render(<RouteTransition routeKey="/a" depth={1}><p>content</p></RouteTransition>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('offset masuk positif saat maju, negatif saat mundur', () => {
    expect(directionOffset(0, 1)).toBeGreaterThan(0);
    expect(directionOffset(1, 0)).toBeLessThan(0);
    expect(directionOffset(1, 1)).toBe(0);
  });

  it('offset menjadi 0 saat reduced-motion, apa pun arahnya', () => {
    expect(motionOffset(24, true)).toBe(0);
    expect(motionOffset(24, false)).toBe(24);
  });
});
