import { describe, it, expect } from 'vitest';

const TOKENS = {
  late:    '#b45309',
  running: '#0077b6',
  ok:      '#047857',
};

function luminance(hex) {
  const channel = (v) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(hex.slice(1, 3));
  const g = channel(hex.slice(3, 5));
  const b = channel(hex.slice(5, 7));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('token aksen semantik', () => {
  it('lolos AA (>= 4.5:1) di atas permukaan putih', () => {
    Object.entries(TOKENS).forEach(([name, hex]) => {
      expect(contrast(hex, '#ffffff'), name).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('GAGAL AA di atas kanvas — inilah alasan aturan "kanvas hanya untuk latar"', () => {
    expect(contrast(TOKENS.running, '#eef2f6')).toBeLessThan(4.5);
    expect(contrast(TOKENS.late, '#eef2f6')).toBeLessThan(4.5);
  });
});
