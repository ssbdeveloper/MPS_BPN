import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = [
  'src/pages/EwsRosterPage.jsx',
  'src/pages/EwsRosterConfigPage.jsx',
  'src/components/ews-roster/BulkPanel.jsx',
  'src/components/ews-roster/rosterVisuals.jsx',
  'src/components/ews-roster/ShiftSettingsCard.jsx',
];
const retired = [
  'Setengah hari', 'Ganti shift', 'Ikut jadwal', 'Pindah ke SHIFT PAGI', 'Pindah ke SHIFT MALAM',
  'Target jam khusus', 'Ikut shift', 'Terapkan ke', 'Tanggal sudah lewat', 'Hapus jadwal hari ini',
  'Belum diatur', 'Selalu pagi', 'Selalu malam', 'Tidak diubah', 'diubah manual', 'baris future',
  'garis atas kuning', 'garis biru atas+bawah', 'yellow top line', 'blue top+bottom line', 'Only for today. Hours follow the selected shift.',
  'Changes apply only to the selected cell.',
];

describe('EWS roster visible copy', () => {
  it.each(files)('%s contains no retired labels or verbose copy', (file) => {
    const source = readFileSync(resolve(file), 'utf8');
    retired.forEach((text) => expect(source, `${file}: ${text}`).not.toContain(text));
  });

  it('removes all temporary-lock UI and visible internal groups', () => {
    const source = readFileSync(resolve('src/pages/EwsRosterConfigPage.jsx'), 'utf8');
    expect(source).not.toMatch(/Temporary Shift Lock|Group A|Group B|loadLocks|lockForm/);
  });
});
