import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regresi dari refactor: saat memindahkan JSX ke file komponen baru, ikon lucide yang dipakai
// di badan komponen sempat tertinggal dari daftar import (X di BulkPanel) sehingga halaman
// mati dengan "X is not defined" — lolos eslint dan build karena baru gagal saat render.
const dir = resolve('src/components/ews-roster');
// Halaman roster ikut diperiksa: saat halaman dipecah, import ikon di sana juga pernah dipangkas.
const pageFiles = ['src/pages/EwsRosterPage.jsx', 'src/pages/EwsRosterConfigPage.jsx'].map((f) => resolve(f));

function importedNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  for (const m of source.matchAll(/import\s+([A-Z][A-Za-z0-9_]*)\s+from/g)) names.add(m[1]);
  return names;
}

function localNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/(?:function|const|let|var|class)\s+([A-Z][A-Za-z0-9_]*)\s*[=(]/g)) names.add(m[1]);
  return names;
}

describe('komponen ews-roster: semua tag JSX terdefinisi', () => {
  const targets = [
    ...readdirSync(dir).filter((f) => f.endsWith('.jsx') && !f.includes('.test.')).map((f) => resolve(dir, f)),
    ...pageFiles,
  ];
  for (const target of targets) {
    it(`${target.split(/[\\/]/).pop()} tidak memakai komponen yang belum di-import`, () => {
      const source = readFileSync(target, 'utf8');
      const known = new Set([...importedNames(source), ...localNames(source)]);
      const used = new Set([...source.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]));
      const missing = [...used].filter((name) => !known.has(name));
      expect(missing).toEqual([]);
    });
  }
});
