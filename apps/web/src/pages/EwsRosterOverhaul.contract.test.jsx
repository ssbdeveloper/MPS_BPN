import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Halaman sudah dipecah: heatmap memakai komponen presentasional di
// src/components/ews-roster/. Test kontrak membaca halaman + komponennya sebagai satu unit.
const readPage = (name) => readFileSync(resolve('src/pages', name), 'utf8');
const readPart = (name) => readFileSync(resolve('src/components/ews-roster', name), 'utf8');
const heatmapBundle = () =>
  [readPage('EwsRosterPage.jsx'), readPart('rosterVisuals.jsx'), readPart('BulkPanel.jsx')].join('\n');

describe('EWS roster UX overhaul contracts', () => {
  it('shows the full assignment directory and permanent shift controls', () => {
    const source = [readPage('EwsRosterConfigPage.jsx'), readPart('OperatorShiftCard.jsx')].join('\n');
    expect(source).toMatch(/Unassigned/);
    expect(source).toMatch(/Day Shift/);
    expect(source).toMatch(/Night Shift/);
    expect(source).not.toMatch(/Group A|Group B/);
    expect(source).toMatch(/All/);
    expect(source).toMatch(/fixed_shift/);
    expect(source).toMatch(/Follow Rotation/);
    expect(source).toMatch(/Always Day/);
    expect(source).toMatch(/Always Night/);
  });

  it('lets the EWS config page edit shift times and standard hours', () => {
    const source = [readPage('EwsRosterConfigPage.jsx'), readPart('ShiftSettingsCard.jsx')].join('\n');
    expect(source).toMatch(/Shift Hours/);
    expect(source).toMatch(/standard_hours/);
    expect(source).toMatch(/\/ews\/roster\/shift/);
    expect(source).toMatch(/resync-future/);
    expect(source).toMatch(/shift_overrides/);
  });

  it('supports exact heatmap cells with shift and hours overrides', () => {
    const source = heatmapBundle();
    expect(source).toMatch(/cells/);
    expect(source).toMatch(/shift_override/);
    expect(source).toMatch(/standard_hours_override/);
    expect(source).toMatch(/Sun/);
    expect(source).toMatch(/Moon/);
  });

  it('keeps roster state in the page while the heatmap parts stay presentational', () => {
    const visuals = readPart('rosterVisuals.jsx');
    const panel = readPart('BulkPanel.jsx');
    // Komponen presentasional tidak boleh memegang state halaman (month/scope/selection).
    expect(visuals).not.toMatch(/useState/);
    expect(panel).not.toMatch(/useEffect/);
    expect(visuals).toMatch(/export const MemoHeatmapCell/);
    expect(readPage('EwsRosterPage.jsx')).toMatch(/from '\.\.\/components\/ews-roster\/rosterVisuals'/);
  });
});
