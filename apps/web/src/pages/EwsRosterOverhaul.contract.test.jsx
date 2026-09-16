import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readPage = (name) => readFileSync(resolve('src/pages', name), 'utf8');

describe('EWS roster UX overhaul contracts', () => {
  it('shows the full assignment directory and permanent shift controls', () => {
    const source = readPage('EwsRosterConfigPage.jsx');
    expect(source).toMatch(/Unassigned/);
    expect(source).toMatch(/Group A/);
    expect(source).toMatch(/Group B/);
    expect(source).toMatch(/All/);
    expect(source).toMatch(/fixed_shift/);
    expect(source).toMatch(/Follow Rotation/);
    expect(source).toMatch(/Always Day/);
    expect(source).toMatch(/Always Night/);
  });

  it('supports exact heatmap cells with shift and hours overrides', () => {
    const source = readPage('EwsRosterPage.jsx');
    expect(source).toMatch(/cells/);
    expect(source).toMatch(/shift_override/);
    expect(source).toMatch(/standard_hours_override/);
    expect(source).toMatch(/Sun/);
    expect(source).toMatch(/Moon/);
  });
});
