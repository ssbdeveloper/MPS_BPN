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
  });

  it('keys the legend with the same D/N letters printed inside the cells', () => {
    // Ikon Sun/Moon diganti huruf D/N pada 2026-09-19: legenda hanya berguna kalau
    // penandanya sama persis dengan yang tercetak di sel.
    const visuals = readPart('rosterVisuals.jsx');
    expect(visuals).toMatch(/Day Shift/);
    expect(visuals).toMatch(/Night Shift/);
    expect(visuals).not.toMatch(/\bSun\b|\bMoon\b/);
    expect(visuals).toMatch(/letter="D"/);
    expect(visuals).toMatch(/letter="N"/);
  });

  it('colours cells by recorded/not-recorded without computing hour ratios', () => {
    // Persentase jam dihapus 2026-09-19: heatmap sebulan penuh menghitungnya ribuan kali
    // per render untuk memilih satu dari tiga warna. Tidak ada jam = absent, dan itu
    // sudah ditentukan API.
    const visuals = readPart('rosterVisuals.jsx');
    expect(visuals).not.toMatch(/toFixed/);
    expect(visuals).not.toMatch(/ratio/);
    expect(visuals).not.toMatch(/scheduled_standard_hours/);
    expect(visuals).not.toMatch(/IN_PROGRESS|In progress/);
    expect(visuals).toMatch(/Scheduled/);
    expect(visuals).toMatch(/recorded_hours/);
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

  it('lets the heatmap table fill its container instead of leaving dead space', () => {
    // Root cause: a table without w-full plus fixed-width cells left 656 px empty
    // on the right in Week mode at a 1264 px viewport.
    const page = readPage('EwsRosterPage.jsx');
    expect(page).toMatch(/w-full table-fixed/);
    expect(page).toMatch(/<colgroup>/);
    expect(page).toMatch(/minWidth: OPERATOR_COL_PX/);
  });

  it('draws the week divider on header and body with the same rule', () => {
    // The week divider must align through header and body instead of offsetting buttons.
    const page = readPage('EwsRosterPage.jsx');
    expect(page).toMatch(/function weekDivider/);
    expect(page.match(/\$\{weekDivider\(d, view\)/g) || []).toHaveLength(2);
    expect(page).not.toMatch(/weekStart=/);
  });

  it('gives month/week and scope toggles a pressed state', () => {
    const page = readPage('EwsRosterPage.jsx');
    expect(page).toMatch(/aria-pressed=\{view === o\.key\}/);
    expect(page).toMatch(/aria-pressed=\{scope === o\.key\}/);
  });

  it('keeps the detail panel out of the heatmap width on tablets', () => {
    // A 320 px side panel at 768 px leaves less than the Week table minimum width.
    const panel = readPart('BulkPanel.jsx');
    expect(panel).toMatch(/fixed inset-x-0 bottom-0/);
    expect(panel).toMatch(/lg:static/);
    expect(panel).not.toMatch(/md:w-80/);
  });
});
