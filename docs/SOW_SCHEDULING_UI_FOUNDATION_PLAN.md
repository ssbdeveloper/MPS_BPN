---
type: plan
status: planning
tags: [domain/sow, domain/msproject]
updated: 2026-09-04
---

# SOW Scheduling UI Foundation — Implementation Plan (Proyek A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun fondasi visual & motion untuk `/sow-scheduling` — design token, sistem motion, transisi antar-page, dan delapan primitif komponen — tanpa mengubah tata letak atau alur kerja mana pun.

**Architecture:** Token didefinisikan global (`index.css` + `tailwind.config.js`) tetapi hanya dipakai oleh halaman `/sow-scheduling`, sehingga halaman lain tidak berubah. Primitif komponen ditaruh di `apps/web/src/components/` dan diekspor lewat barrel yang sudah ada. Transisi route dipasang membungkus `<Outlet/>` di shell yang sudah berbentuk benar (`PageHeader` sudah berada di luar `Outlet`).

**Tech Stack:** React 19, Vite 7, Tailwind CSS 3.4, framer-motion 12 (sudah terpasang), Vitest + Testing Library (ditambahkan di Task 1).

**Spec:** [[SOW_SCHEDULING_UI_FOUNDATION_DESIGN]]

## Global Constraints

- **Copy UI wajib bahasa Inggris.** Komentar kode boleh bahasa Indonesia (mengikuti kode yang ada).
- **Blast radius: hanya `/sow-scheduling`.** Satu-satunya perubahan yang sengaja global adalah font stack (Task 3). Halaman lain tidak boleh berubah tampilannya. Task 14 memverifikasi ini.
- **`prefers-reduced-motion` wajib mematikan gerak**, bukan mempercepatnya.
- **Kanvas bernada hanya untuk latar.** Teks/label beraksen wajib di atas permukaan putih — `#0077b6` di atas `#eef2f6` hanya 4,33:1 (gagal AA). Lihat spec §3.3.
- **Target sentuh ≥ 44px di `/sow-scheduling/area`**, termasuk pada mode `compact`. Tiga halaman lain desktop-only.
- **Teks minimum 12px** (`text-xs`). `text-[11px]` diizinkan **hanya** untuk dua hal: label uppercase kecil (eyebrow, badge status) dan badge angka pendek maksimal 3 digit. Dilonggarkan dari CLAUDE.md atas keputusan owner 2026-09-04 — badge angka `text-[11px]` sudah berjalan di `OrderPanel`, dan menaikkannya ke `text-xs` memperbesar pil sehingga grid tab 2×2 bisa pecah pada label panjang ("No MSP task"). `text-[10px]` ke bawah tetap dilarang.
- **Tidak ada dependensi runtime baru.** Vitest & Testing Library masuk `devDependencies` saja.
- Warna aksi utama `#0077b6`; **dilarang** memakai `#0096c7` untuk teks kecil atau background tombol.
- Semua perintah `npm` dijalankan dari `apps/web/`.
- **JANGAN PERNAH menulis klaim verifikasi yang tidak kamu lakukan** — di pesan commit, laporan, maupun komentar kode. Kalau sebuah langkah verifikasi tak bisa dijalankan (mis. tidak ada tool browser untuk cek visual), tulis apa adanya bahwa langkah itu BELUM dilakukan beserta alasannya. Pesan commit contoh di rencana ini adalah titik awal, bukan naskah yang harus disalin apa pun kenyataannya — kalau isinya jadi tidak benar setelah pekerjaanmu, perbaiki kalimatnya. Riwayat git yang mengklaim verifikasi palsu menyesatkan orang berbulan-bulan kemudian, dan lebih merugikan daripada langkah yang jujur diakui belum dikerjakan.
- **`npm run lint` TIDAK bersih di repo ini dan tidak akan pernah bersih.** Baseline terukur 2026-09-04: **126 problem (105 error, 21 warning) di 37 file**, semuanya sudah ada sebelum pekerjaan ini — artefak PWA `dev-dist/`, `router/index.jsx`, `utils/nfcId.js`, `vite.config.js`, dan lain-lain. Jangan memperbaikinya; itu di luar cakupan dan akan mengaburkan diff.
  Karena itu **jangan pernah merantai `npm run lint && ...`** — lint keluar dengan kode non-nol dan perintah berikutnya tak akan jalan. Verifikasi tiap task memakai tiga perintah **terpisah**:
  1. `npx eslint <daftar file yang kamu buat/ubah>` — ini WAJIB exit 0
  2. `npm test`
  3. `npm run build`
  `npm run build` butuh ~55 detik (precache Workbox) dan `npm test` ~100 detik (bootstrap jsdom) — set timeout yang cukup, jangan simpulkan gagal karena timeout.

---

### Task 1: Test harness (Vitest + Testing Library)

`apps/web` belum punya test runner sama sekali — scripts hanya `dev`, `build`, `lint`, `preview`. Tanpa ini, tidak ada satu pun task berikutnya yang bisa diverifikasi otomatis.

**Files:**
- Create: `apps/web/vitest.config.js`
- Create: `apps/web/src/test/setup.js`
- Create: `apps/web/src/test/smoke.test.jsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: —
- Produces: perintah `npm test` (sekali jalan) dan `npm run test:watch`. Semua task berikutnya memakainya.

- [ ] **Step 1: Pasang devDependencies**

```bash
cd apps/web
npm install -D vitest@^2 jsdom@^25 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14
```

- [ ] **Step 2: Tambah script test ke `apps/web/package.json`**

Di dalam objek `"scripts"`, tambahkan dua baris ini setelah `"lint"`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 3: Buat `apps/web/vitest.config.js`**

Konfigurasi terpisah dari `vite.config.js` dengan sengaja: `vite.config.js` memuat plugin PWA (Workbox) yang tidak boleh ikut jalan saat test.

```js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // globals SENGAJA tidak dinyalakan. eslint.config.js hanya memuat globals.browser —
    // tidak ada dict vitest/jest — jadi test yang memakai describe/it/expect tanpa import
    // akan lolos vitest tapi GAGAL eslint no-undef. Import eksplisit dari 'vitest'
    // membuat kedua alat sepakat.
    setupFiles: ['./src/test/setup.js'],
    css: false,
    include: ['src/**/*.test.{js,jsx}'],
  },
});
```

- [ ] **Step 4: Buat `apps/web/src/test/setup.js`**

```js
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
```

- [ ] **Step 5: Buat smoke test `apps/web/src/test/smoke.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('merender komponen React dan memuat matcher jest-dom', () => {
    render(<button type="button">Save</button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Jalankan test**

Run: `npm test`
Expected: PASS — 1 file, 1 test lulus.

- [ ] **Step 7: Pastikan lint & build masih bersih**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/vitest.config.js apps/web/src/test/
git commit -m "test(web): pasang Vitest + Testing Library

apps/web belum punya test runner sama sekali (scripts hanya dev/build/lint/preview),
sehingga perilaku komponen tak pernah bisa diverifikasi otomatis. devDependencies saja,
tidak masuk bundle produksi. Konfigurasi dipisah dari vite.config.js karena plugin PWA
(Workbox) tidak boleh ikut jalan saat test.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 2: Design token (additive, nol perubahan visual)

Menambahkan token yang CLAUDE.md sudah tetapkan tapi belum pernah dikerjakan, plus token baru dari spec §3. **Tidak ada satu pun komponen yang memakainya di task ini** — karena itu tidak ada perubahan visual di mana pun. Itu disengaja: token dan pemakaian dipisah supaya regresi mudah dilacak.

**Files:**
- Modify: `apps/web/src/index.css`
- Modify: `apps/web/tailwind.config.js`

**Interfaces:**
- Consumes: —
- Produces: CSS vars `--deep-twilight`…`--light-cyan`, `--canvas`, `--status-late`, `--status-running`, `--status-ok`, `--shadow-card`, `--dur-*`, `--ease-enter`, `--ease-exit`. Kelas Tailwind `bg-brand-*`, `text-brand-*`, `bg-canvas`, `shadow-card`, `text-status-*`.

- [ ] **Step 1: Tambahkan blok `:root` di `apps/web/src/index.css`**

Sisipkan **tepat setelah** tiga baris `@tailwind` dan **sebelum** `@keyframes hm-fade`:

```css
:root {
  /* Corporate Blue Palette — CLAUDE.md, sebelumnya belum pernah ada di sini */
  --deep-twilight:    #03045e;
  --french-blue:      #023e8a;
  --bright-teal-blue: #0077b6;   /* primary action */
  --blue-green:       #0096c7;
  --turquoise-surf:   #00b4d8;   /* focus ring */
  --sky-aqua:         #48cae4;
  --frosted-blue:     #90e0ef;
  --frosted-blue-2:   #ade8f4;
  --light-cyan:       #caf0f8;

  /* Kanvas bernada — dasar kartu mengambang. HANYA untuk latar:
     #0077b6 di atas #eef2f6 = 4,33:1, gagal AA. Lihat spec §3.3. */
  --canvas:           #eef2f6;

  /* Aksen semantik. Angka = kontras terhadap PUTIH. */
  --status-late:      #b45309;   /* 5,02:1 */
  --status-running:   #0077b6;   /* 4,87:1 */
  --status-ok:        #047857;   /* 5,48:1 */

  /* Elevation. Kanvas vs putih hanya 1,12:1, jadi pemisahan kartu bergantung
     pada shadow + border — border tetap wajib walau shadow dimatikan OS. */
  --shadow-card:      0 1px 2px rgba(15,23,42,.05), 0 4px 12px rgba(15,23,42,.06);
  --shadow-panel:     0 4px 12px rgba(0,0,0,.08);
  --shadow-modal:     0 8px 32px rgba(0,0,0,.12);

  /* Motion */
  --dur-press:  150ms;
  --dur-panel:  200ms;
  --dur-route:  250ms;
  --dur-modal:  300ms;
  --ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-exit:  cubic-bezier(0.7, 0, 0.84, 0);
}
```

- [ ] **Step 2: Perluas `apps/web/tailwind.config.js`**

Di dalam `theme.extend.colors`, tambahkan **setelah** blok `secondary` (jangan hapus token lama — masih dipakai komponen warisan):

```js
        brand: {
          'deep-twilight':    '#03045e',
          'french-blue':      '#023e8a',
          'bright-teal-blue': '#0077b6',
          'blue-green':       '#0096c7',
          'turquoise-surf':   '#00b4d8',
          'sky-aqua':         '#48cae4',
          'frosted-blue':     '#90e0ef',
          'frosted-blue-2':   '#ade8f4',
          'light-cyan':       '#caf0f8',
        },
        canvas: '#eef2f6',
        status: {
          late:    '#b45309',
          running: '#0077b6',
          ok:      '#047857',
        },
```

Di dalam `theme.extend.boxShadow`, tambahkan **setelah** blok `3d-secondary-active`:

```js
        card: '0 1px 2px rgba(15,23,42,.05), 0 4px 12px rgba(15,23,42,.06)',
```

- [ ] **Step 3: Buat test token `apps/web/src/test/tokens.test.jsx`**

Menguji yang bisa diuji: konstanta warna tidak boleh bergeser diam-diam, dan kontrasnya harus lolos AA di atas putih.

```jsx
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
```

- [ ] **Step 4: Jalankan test**

Run: `npm test`
Expected: PASS — 2 file, 3 test lulus.

- [ ] **Step 5: Verifikasi nol perubahan visual**

Run: `npm run dev`, buka `/sow-scheduling` dan `/timesheet`.
Expected: tidak ada perbedaan visual apa pun. Token sudah ada tapi belum dipakai siapa pun.

- [ ] **Step 6: Lint + build**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/index.css apps/web/tailwind.config.js apps/web/src/test/tokens.test.jsx
git commit -m "feat(web): design token fondasi sow-scheduling

Menuntaskan tiga hal yang CLAUDE.md sudah tetapkan tapi belum pernah dikerjakan
(blok :root, palet brand di tailwind.config), plus token baru dari spec: kanvas
bernada, tiga aksen semantik, elevation kartu, dan token motion.

ADDITIVE — belum ada komponen yang memakainya, jadi nol perubahan visual. Token dan
pemakaian sengaja dipisah supaya regresi mudah dilacak.

Test mengunci kontras: ketiga aksen >= 4,5:1 di atas putih, dan SENGAJA menegaskan
#0077b6 serta #b45309 GAGAL di atas kanvas (4,33 dan 4,46) — itu dasar aturan
'kanvas hanya untuk latar' di spec §3.3.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 3: Font stack (satu-satunya perubahan global yang disengaja)

CLAUDE.md §3 memerintahkan mengganti `Arial` dengan system stack "saat menyentuh file itu". Ini **mengubah rendering setiap halaman**, bukan hanya `/sow-scheduling` — karena itu dipisah jadi task sendiri supaya bisa ditolak tanpa membatalkan yang lain.

**Files:**
- Modify: `apps/web/src/index.css`

**Interfaces:**
- Consumes: —
- Produces: —

- [ ] **Step 1: Ganti font-family**

Di `apps/web/src/index.css`, di dalam `@layer base`, pada aturan `html, body, #root`, ganti:

```css
    font-family: Arial, sans-serif;
```

menjadi:

```css
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

- [ ] **Step 2: Verifikasi lintas halaman**

Run: `npm run dev`, buka **empat** halaman: `/sow-scheduling`, `/timesheet`, `/dashboard`, `/operations-hub`.
Expected: teks terbaca di semua halaman; tidak ada tata letak yang pecah karena metrik font berubah. Perhatikan khusus tabel dengan kolom sempit dan tombol berteks panjang — Segoe UI sedikit lebih lebar dari Arial pada beberapa glyph.

- [ ] **Step 3: Lint + build**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/index.css
git commit -m "style(web): system font stack menggantikan Arial

Diperintahkan CLAUDE.md UI Engineering Standards §3. Dipisah jadi commit sendiri karena
ini SATU-SATUNYA perubahan Proyek A yang sengaja global — mengubah rendering setiap
halaman, bukan hanya /sow-scheduling.

<TULIS SALAH SATU — JANGAN MENGARANG:>
Kalau cek visual BENAR-BENAR dilakukan: sebutkan halaman mana yang dilihat dan apa yang
diperiksa (kolom tabel sempit, tombol berteks panjang).
Kalau TIDAK: tulis "BELUM DIVERIFIKASI SECARA VISUAL" beserta alasannya, risiko yang
belum tertutup (metrik glyph berbeda -> tabel membungkus, label tombol tak muat), dan
halaman yang wajib dicek manual sebelum rilis.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 4: DensityProvider + useDensity

**Files:**
- Create: `apps/web/src/components/density/DensityProvider.jsx`
- Create: `apps/web/src/components/density/DensityProvider.test.jsx`
- Modify: `apps/web/src/components/index.js`

**Interfaces:**
- Consumes: —
- Produces:
  - `<DensityProvider>{children}</DensityProvider>`
  - `useDensity()` → `{ density: 'normal' | 'compact', setDensity: (value) => void, toggle: () => void }`
  - Kunci localStorage: `mps.density`

- [ ] **Step 1: Tulis test yang gagal — `apps/web/src/components/density/DensityProvider.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { DensityProvider, useDensity } from './DensityProvider';

function Probe() {
  const { density, toggle } = useDensity();
  return <button type="button" onClick={toggle}>{density}</button>;
}

describe('DensityProvider', () => {
  it('default ke normal saat localStorage kosong', () => {
    render(<DensityProvider><Probe /></DensityProvider>);
    expect(screen.getByRole('button')).toHaveTextContent('normal');
  });

  it('toggle berganti ke compact dan menyimpannya', async () => {
    const user = userEvent.setup();
    render(<DensityProvider><Probe /></DensityProvider>);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('compact');
    expect(window.localStorage.getItem('mps.density')).toBe('compact');
  });

  it('memulihkan nilai tersimpan saat mount', () => {
    window.localStorage.setItem('mps.density', 'compact');
    render(<DensityProvider><Probe /></DensityProvider>);
    expect(screen.getByRole('button')).toHaveTextContent('compact');
  });

  it('mengabaikan nilai tersimpan yang tidak sah', () => {
    window.localStorage.setItem('mps.density', 'gigantic');
    render(<DensityProvider><Probe /></DensityProvider>);
    expect(screen.getByRole('button')).toHaveTextContent('normal');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm test -- DensityProvider`
Expected: FAIL — `Failed to resolve import "./DensityProvider"`.

- [ ] **Step 3: Implementasi — `apps/web/src/components/density/DensityProvider.jsx`**

```jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'mps.density';
const VALID = new Set(['normal', 'compact']);

const DensityContext = createContext(null);

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return VALID.has(raw) ? raw : 'normal';
  } catch {
    // Safari private mode melempar saat localStorage diakses. Kepadatan adalah
    // preferensi, bukan syarat kerja — jatuh ke default, jangan jatuhkan halaman.
    return 'normal';
  }
}

export function DensityProvider({ children }) {
  const [density, setDensityState] = useState(readStored);

  const setDensity = useCallback((value) => {
    if (!VALID.has(value)) return;
    setDensityState(value);
  }, []);

  const toggle = useCallback(() => {
    setDensityState((prev) => (prev === 'normal' ? 'compact' : 'normal'));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, density);
    } catch {
      // sama seperti readStored — kegagalan menyimpan tidak boleh merusak UI
    }
  }, [density]);

  const value = useMemo(() => ({ density, setDensity, toggle }), [density, setDensity, toggle]);

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity() {
  const ctx = useContext(DensityContext);
  if (!ctx) {
    throw new Error('useDensity harus dipakai di dalam <DensityProvider>');
  }
  return ctx;
}

export default DensityProvider;
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm test -- DensityProvider`
Expected: PASS — 4 test.

- [ ] **Step 5: Ekspor lewat barrel**

Di `apps/web/src/components/index.js`, tambahkan di bawah baris `export { default as Skeleton, ... }`:

```js
export { default as DensityProvider, useDensity } from './density/DensityProvider';
```

- [ ] **Step 6: Lint + build + seluruh test**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/density/ apps/web/src/components/index.js
git commit -m "feat(web): DensityProvider + useDensity

Mode kepadatan normal/compact, disimpan per-user di localStorage. Bentuk paling murah
dari 'panel bisa diatur ukurannya' yang diminta owner. Akses localStorage dibungkus
try/catch: kepadatan adalah preferensi, bukan syarat kerja, jadi Safari private mode
tidak boleh menjatuhkan halaman.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 5: StatusPill

Badge status saat ini ditulis inline di lebih dari tiga tempat (`OrderPanel`, `MapSapOperationPage`, `ReservationDetailModal`).

**Files:**
- Create: `apps/web/src/components/ui/StatusPill.jsx`
- Create: `apps/web/src/components/ui/StatusPill.test.jsx`
- Modify: `apps/web/src/components/index.js`

**Interfaces:**
- Consumes: —
- Produces: `<StatusPill tone="neutral|running|late|ok|warn" children title />` — `tone` default `'neutral'`.

- [ ] **Step 1: Tulis test yang gagal — `apps/web/src/components/ui/StatusPill.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusPill from './StatusPill';

describe('StatusPill', () => {
  it('menampilkan isinya', () => {
    render(<StatusPill>REL</StatusPill>);
    expect(screen.getByText('REL')).toBeInTheDocument();
  });

  it('memakai warna aksen late untuk tone late', () => {
    render(<StatusPill tone="late">LATE</StatusPill>);
    expect(screen.getByText('LATE').className).toContain('text-status-late');
  });

  it('jatuh ke neutral untuk tone yang tidak dikenal', () => {
    render(<StatusPill tone="banana">X</StatusPill>);
    expect(screen.getByText('X').className).toContain('text-slate-600');
  });

  // Penjaga regresi untuk bug nyata: `TONES[tone] || TONES.neutral` membaca rantai
  // prototype, sehingga nama-nama ini mengembalikan fungsi Object.prototype yang truthy
  // dan bocor ke atribut class sebagai "function ... { [native code] }".
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'jatuh ke neutral untuk tone "%s" (nama milik Object.prototype)',
    (tone) => {
      render(<StatusPill tone={tone}>X</StatusPill>);
      const cls = screen.getByText('X').className;
      expect(cls).toContain('text-slate-600');
      expect(cls).not.toContain('native code');
    },
  );

  it('meneruskan title untuk tooltip', () => {
    render(<StatusPill title="Order masih terbuka di SAP">REL</StatusPill>);
    expect(screen.getByText('REL')).toHaveAttribute('title', 'Order masih terbuka di SAP');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm test -- StatusPill`
Expected: FAIL — modul tidak ditemukan.

- [ ] **Step 3: Implementasi — `apps/web/src/components/ui/StatusPill.jsx`**

```jsx
import React from 'react';

// Semua tone berlatar PUTIH atau tint terang, tidak pernah langsung di atas --canvas:
// #0077b6 dan #b45309 gagal AA di atas #eef2f6 (4,33 dan 4,46). Lihat spec §3.3.
const TONES = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
  running: 'border-[#90e0ef] bg-[#caf0f8] text-status-running',
  late:    'border-amber-200 bg-amber-50 text-status-late',
  ok:      'border-emerald-200 bg-emerald-50 text-status-ok',
};

export default function StatusPill({ tone = 'neutral', title, children }) {
  // Object.hasOwn, BUKAN `TONES[tone] || TONES.neutral`. Bentuk `||` membaca rantai
  // prototype: tone="constructor" / "toString" / "valueOf" / "hasOwnProperty" mengembalikan
  // fungsi Object.prototype yang TRUTHY, sehingga lolos fallback dan ter-stringify jadi
  // "function Object() { [native code] }" di dalam atribut class. Terbukti saat review
  // Task 5 — 4 dari 9 masukan uji bocor.
  const cls = Object.hasOwn(TONES, tone) ? TONES[tone] : TONES.neutral;
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm test -- StatusPill`
Expected: PASS — 4 test.

- [ ] **Step 5: Ekspor lewat barrel**

Di `apps/web/src/components/index.js`, di bawah baris `EmptyState`:

```js
export { default as StatusPill } from './ui/StatusPill';
```

- [ ] **Step 6: Lint + test + build**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/StatusPill.jsx apps/web/src/components/ui/StatusPill.test.jsx apps/web/src/components/index.js
git commit -m "feat(web): komponen StatusPill

Badge status ditulis inline di 3+ tempat (OrderPanel, MapSapOperationPage,
ReservationDetailModal). CLAUDE.md §1 mewajibkan ekstraksi pada duplikasi >= 2x.

Setiap tone berlatar putih atau tint terang, tidak pernah langsung di atas --canvas —
#0077b6 dan #b45309 gagal AA di atas #eef2f6.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 6: SegmentedControl + hapus dua duplikat

Segmented control sudah ada **dua** implementasi: tab di `OrderPanel.jsx:305-334` dan chip filter mapped/unmapped di `MapSapOperationPage.jsx` (ditambahkan 2026-09-04). Keduanya diganti dengan satu komponen.

**Files:**
- Create: `apps/web/src/components/ui/SegmentedControl.jsx`
- Create: `apps/web/src/components/ui/SegmentedControl.test.jsx`
- Modify: `apps/web/src/components/index.js`
- Modify: `apps/web/src/features/bayScheduling/OrderPanel.jsx:303-334`
- Modify: `apps/web/src/pages/PPC/manufacturing/MapSapOperationPage.jsx` (blok segmented control filter `mapped`)

**Interfaces:**
- Consumes: —
- Produces: `<SegmentedControl items={[{ key, label, count? }]} value onChange ariaLabel columns? />` — `columns` default = jumlah item.

- [ ] **Step 1: Tulis test yang gagal — `apps/web/src/components/ui/SegmentedControl.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import SegmentedControl from './SegmentedControl';

const ITEMS = [
  { key: 'all', label: 'All' },
  { key: 'mapped', label: 'Mapped', count: 66 },
  { key: 'unmapped', label: 'Unmapped', count: 0 },
];

describe('SegmentedControl', () => {
  it('merender satu tombol per item', () => {
    render(<SegmentedControl items={ITEMS} value="all" onChange={() => {}} ariaLabel="Filter" />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('menandai item aktif dengan aria-pressed', () => {
    render(<SegmentedControl items={ITEMS} value="mapped" onChange={() => {}} ariaLabel="Filter" />);
    expect(screen.getByRole('button', { name: /Mapped/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('memanggil onChange dengan key item', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SegmentedControl items={ITEMS} value="all" onChange={onChange} ariaLabel="Filter" />);
    await user.click(screen.getByRole('button', { name: /Mapped/ }));
    expect(onChange).toHaveBeenCalledWith('mapped');
  });

  it('menampilkan badge hanya saat count > 0', () => {
    render(<SegmentedControl items={ITEMS} value="all" onChange={() => {}} ariaLabel="Filter" />);
    expect(screen.getByText('66')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm test -- SegmentedControl`
Expected: FAIL — modul tidak ditemukan.

- [ ] **Step 3: Implementasi — `apps/web/src/components/ui/SegmentedControl.jsx`**

```jsx
import React from 'react';

// Grid kolom TETAP (bukan flex): badge yang muncul/hilang tidak boleh menggeser
// tombol lain. Pola ini diambil dari OrderPanel yang sudah terbukti dipakai.
export default function SegmentedControl({ items = [], value, onChange, ariaLabel, columns }) {
  const cols = columns || items.length || 1;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="grid gap-1 rounded-lg bg-slate-100 p-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const active = item.key === value;
        const count = Number(item.count);
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange?.(item.key)}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none ${
              active ? 'bg-white text-[#0077b6] shadow-sm' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
            }`}
          >
            {item.label}
            {Number.isFinite(count) && count > 0 && (
              <span
                className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                  active ? 'bg-[#caf0f8] text-[#0077b6]' : 'bg-slate-200/70 text-slate-600'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm test -- SegmentedControl`
Expected: PASS — 4 test.

- [ ] **Step 5: Ekspor lewat barrel**

```js
export { default as SegmentedControl } from './ui/SegmentedControl';
```

- [ ] **Step 6: Ganti duplikat di `OrderPanel.jsx`**

Hapus seluruh blok `<div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" ...>` sampai `</div>` penutupnya (baris ~303–334), ganti dengan:

```jsx
        <div className="mt-3">
          <SegmentedControl
            items={tabItems}
            value={tab}
            onChange={onTabChange}
            ariaLabel="Order status filter"
            columns={2}
          />
        </div>
```

Tambahkan `SegmentedControl` ke import dari `'../../components'` di bagian atas file.

- [ ] **Step 7: Ganti duplikat di `MapSapOperationPage.jsx`**

Hapus blok `<div role="group" aria-label="MS Project mapping filter" ...>` beserta isinya, ganti dengan:

```jsx
                <div className="mt-3">
                  <SegmentedControl
                    items={MAPPED_FILTERS.map((item) => ({ key: item.key, label: item.label }))}
                    value={sowMappedFilter}
                    onChange={setSowMappedFilter}
                    ariaLabel="MS Project mapping filter"
                  />
                </div>
```

Tambahkan `SegmentedControl` ke import dari `'../../../components'`.

- [ ] **Step 8: Verifikasi manual kedua halaman**

Run: `npm run dev`
- `/sow-scheduling/area` — empat tab masih berfungsi, badge angka masih muncul, tata letak 2×2 tidak berubah.
- `/sow-scheduling/map` — chip All/Mapped/Unmapped masih memfilter daftar order.

- [ ] **Step 9: Lint + test + build**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/ui/SegmentedControl.jsx apps/web/src/components/ui/SegmentedControl.test.jsx apps/web/src/components/index.js apps/web/src/features/bayScheduling/OrderPanel.jsx apps/web/src/pages/PPC/manufacturing/MapSapOperationPage.jsx
git commit -m "refactor(web): SegmentedControl menggantikan dua implementasi duplikat

Pola ini sudah ditulis dua kali: tab OrderPanel dan chip filter mapped/unmapped di
MapSapOperationPage. CLAUDE.md §1 mewajibkan ekstraksi pada duplikasi kedua.

Grid kolom TETAP dipertahankan dari OrderPanel: badge yang muncul/hilang tidak boleh
menggeser tombol lain. min-h-[44px] ditambahkan supaya kontrol ini aman dipakai di
/area yang kini wajib tablet-ready.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 7: Panel + Toolbar

**Files:**
- Create: `apps/web/src/components/ui/Panel.jsx`
- Create: `apps/web/src/components/ui/Panel.test.jsx`
- Create: `apps/web/src/components/ui/Toolbar.jsx`
- Create: `apps/web/src/components/ui/Toolbar.test.jsx`
- Modify: `apps/web/src/components/index.js`

**Interfaces:**
- Consumes: —
- Produces:
  - `<Panel title? eyebrow? right? footer? elevated? className? children />`
  - `<Toolbar children className? />`

- [ ] **Step 1: Tulis test yang gagal**

`apps/web/src/components/ui/Panel.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Panel from './Panel';

describe('Panel', () => {
  it('merender judul, eyebrow, dan isi', () => {
    render(<Panel eyebrow="Source" title="SOW orders"><p>body</p></Panel>);
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('SOW orders')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('menghilangkan header sepenuhnya saat tidak ada title/eyebrow/right', () => {
    const { container } = render(<Panel><p>body</p></Panel>);
    expect(container.querySelector('header')).toBeNull();
  });

  it('memakai shadow-card saat elevated, TAPI border tetap ada', () => {
    const { container } = render(<Panel elevated><p>body</p></Panel>);
    expect(container.firstChild.className).toContain('shadow-card');
    // Ini invarian utama komponen ini, bukan detail. Kanvas vs putih hanya 1,12:1, jadi
    // kalau OS mematikan shadow (mode kontras tinggi), border satu-satunya yang memisahkan
    // kartu dari latar. Tanpa assertion ini, seseorang bisa memindahkan border ke dalam
    // ternary `elevated` dan seluruh test tetap hijau.
    expect(container.firstChild.className).toContain('border-slate-200');
  });

  it('memakai border tanpa shadow saat tidak elevated', () => {
    const { container } = render(<Panel><p>body</p></Panel>);
    expect(container.firstChild.className).toContain('border-slate-200');
    expect(container.firstChild.className).not.toContain('shadow-card');
  });
});
```

`apps/web/src/components/ui/Toolbar.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Toolbar from './Toolbar';

describe('Toolbar', () => {
  it('merender anak-anaknya', () => {
    render(<Toolbar><button type="button">Refresh</button></Toolbar>);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('menerima className tambahan untuk layout', () => {
    const { container } = render(<Toolbar className="mt-4"><span>x</span></Toolbar>);
    expect(container.firstChild.className).toContain('mt-4');
  });

  it('meneruskan atribut lain (a11y, data-*) ke elemen', () => {
    render(<Toolbar role="toolbar" aria-label="Order filters"><span>x</span></Toolbar>);
    expect(screen.getByRole('toolbar')).toHaveAttribute('aria-label', 'Order filters');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm test -- Panel Toolbar`
Expected: FAIL — kedua modul tidak ditemukan.

- [ ] **Step 3: Implementasi `apps/web/src/components/ui/Panel.jsx`**

```jsx
import React from 'react';

// Border SELALU ada, bahkan saat elevated. Kanvas bernada vs putih hanya 1,12:1,
// jadi pemisahan kartu tidak boleh bergantung pada shadow saja — kalau OS
// mematikan shadow (mode kontras tinggi), border yang menyelamatkan. Spec §3.3.
export default function Panel({ eyebrow, title, right, footer, elevated = false, className = '', children }) {
  const hasHeader = Boolean(eyebrow || title || right);
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white ${
        elevated ? 'shadow-card' : ''
      } ${className}`}
    >
      {hasHeader && (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#0077b6]">{eyebrow}</p>
            )}
            {title && <h3 className="truncate text-sm font-extrabold text-slate-800">{title}</h3>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {footer && (
        <footer className="shrink-0 border-t border-slate-200 px-3 py-2 text-xs text-slate-500">{footer}</footer>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Implementasi `apps/web/src/components/ui/Toolbar.jsx`**

```jsx
import React from 'react';

// `...rest` BUKAN kelengkapan berlebihan. Tanpa itu pemanggil tidak bisa memasang
// role="toolbar", aria-label, onScroll, atau data-testid — hanya className yang tembus —
// dan primitif setipis ini akan dipaksa di-fork ("Toolbar2") begitu satu pemanggil butuh
// atribut a11y. Ditemukan saat review Task 7.
export default function Toolbar({ className = '', children, ...rest }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `npm test -- Panel Toolbar`
Expected: PASS — 6 test.

- [ ] **Step 6: Ekspor lewat barrel**

```js
export { default as Panel } from './ui/Panel';
export { default as Toolbar } from './ui/Toolbar';
```

- [ ] **Step 7: Lint + test + build**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/ui/Panel.jsx apps/web/src/components/ui/Panel.test.jsx apps/web/src/components/ui/Toolbar.jsx apps/web/src/components/ui/Toolbar.test.jsx apps/web/src/components/index.js
git commit -m "feat(web): primitif Panel + Toolbar

Panel selalu memasang border walau elevated: kanvas vs putih hanya 1,12:1, jadi
pemisahan permukaan tidak boleh bergantung pada shadow saja.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 8: FilterChip

**Files:**
- Create: `apps/web/src/components/ui/FilterChip.jsx`
- Create: `apps/web/src/components/ui/FilterChip.test.jsx`
- Modify: `apps/web/src/components/index.js`

**Interfaces:**
- Consumes: —
- Produces: `<FilterChip label value onRemove? />` — tanpa `onRemove`, chip tampil tanpa tombol hapus.

- [ ] **Step 1: Tulis test yang gagal — `apps/web/src/components/ui/FilterChip.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import FilterChip from './FilterChip';

describe('FilterChip', () => {
  it('menampilkan label dan value', () => {
    render(<FilterChip label="Workcenter" value="C5100FAB" />);
    expect(screen.getByText('Workcenter')).toBeInTheDocument();
    expect(screen.getByText('C5100FAB')).toBeInTheDocument();
  });

  it('tidak menampilkan tombol hapus tanpa onRemove', () => {
    render(<FilterChip label="Workcenter" value="C5100FAB" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('memanggil onRemove saat tombol hapus diklik', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<FilterChip label="Workcenter" value="C5100FAB" onRemove={onRemove} />);
    await user.click(screen.getByRole('button', { name: 'Remove Workcenter filter' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm test -- FilterChip`
Expected: FAIL — modul tidak ditemukan.

- [ ] **Step 3: Implementasi — `apps/web/src/components/ui/FilterChip.jsx`**

```jsx
import React from 'react';
import { X } from 'lucide-react';

export default function FilterChip({ label, value, onRemove }) {
  return (
    // `min-w-0` di chip LUAR, bukan hanya di span nilai. Sebagai flex item, chip punya
    // `min-width: auto` yang menahannya menyusut di bawah lebar konten. Review Task 8
    // menilai truncation tak akan pernah aktif karena itu; analisis tandingan: `truncate`
    // memuat `overflow:hidden`, yang menurut spec flexbox membuat automatic minimum size
    // jadi nol. KEDUANYA masuk akal dan hanya bisa diputus dengan render di browser —
    // yang tak bisa dilakukan di sesi ini. `min-w-0` ditambahkan karena tak merugikan
    // apa pun dan menghapus ketidakpastiannya. Nilai nyata di app ini menembus 45 karakter
    // ("MPS - 21 Units ISO TANK - ORICA - (PO 02.04.26)").
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[#90e0ef] bg-[#caf0f8] py-0.5 pl-2.5 pr-1 text-xs font-semibold text-[#023e8a]">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide opacity-70">{label}</span>
      <span className="min-w-0 truncate">{value}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} filter`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#0077b6] transition-colors duration-150 hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm test -- FilterChip`
Expected: PASS — 3 test.

- [ ] **Step 5: Ekspor lewat barrel**

```js
export { default as FilterChip } from './ui/FilterChip';
```

- [ ] **Step 6: Lint + test + build**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/FilterChip.jsx apps/web/src/components/ui/FilterChip.test.jsx apps/web/src/components/index.js
git commit -m "feat(web): komponen FilterChip

Chip filter aktif yang bisa dilepas satu per satu. Dibangun di Proyek A supaya Proyek B
dan C tidak melahirkan versinya masing-masing.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 9: SplitPane

**Files:**
- Create: `apps/web/src/components/ui/SplitPane.jsx`
- Create: `apps/web/src/components/ui/SplitPane.test.jsx`
- Modify: `apps/web/src/components/index.js`

**Interfaces:**
- Consumes: —
- Produces: `<SplitPane storageKey left right minLeft? maxLeft? defaultLeft? />` — lebar kiri dalam piksel, disimpan di `localStorage` pada kunci `mps.split.<storageKey>`.

- [ ] **Step 1: Tulis test yang gagal — `apps/web/src/components/ui/SplitPane.test.jsx`**

```jsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SplitPane from './SplitPane';

const props = {
  storageKey: 'test',
  left: <p>LEFT</p>,
  right: <p>RIGHT</p>,
};

describe('SplitPane', () => {
  it('merender kedua sisi', () => {
    render(<SplitPane {...props} />);
    expect(screen.getByText('LEFT')).toBeInTheDocument();
    expect(screen.getByText('RIGHT')).toBeInTheDocument();
  });

  it('memakai defaultLeft saat localStorage kosong', () => {
    render(<SplitPane {...props} defaultLeft={380} />);
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '380px' });
  });

  it('memulihkan lebar tersimpan', () => {
    window.localStorage.setItem('mps.split.test', '420');
    render(<SplitPane {...props} defaultLeft={380} />);
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '420px' });
  });

  it('menjepit lebar tersimpan ke rentang min/max', () => {
    window.localStorage.setItem('mps.split.test', '9999');
    render(<SplitPane {...props} defaultLeft={380} minLeft={280} maxLeft={520} />);
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '520px' });
  });

  it('separatornya punya peran dan label yang benar', () => {
    render(<SplitPane {...props} />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });

  // Ketiga test di bawah menguji PERILAKU INTERAKTIF — alasan komponen ini ada. Versi
  // pertama rencana ini hanya menguji turunan state awal, sehingga drag dan keyboard
  // sama sekali tak terverifikasi. jsdom mendukung keduanya lewat fireEvent; tidak ada
  // alasan lingkungan untuk melewatkannya.

  it('menggeser lebar saat divider ditarik', () => {
    render(<SplitPane {...props} defaultLeft={380} minLeft={280} maxLeft={520} />);
    fireEvent.pointerDown(screen.getByRole('separator'));
    // getBoundingClientRect di jsdom selalu nol, jadi clientX = lebar kiri yang diminta.
    fireEvent.pointerMove(window, { clientX: 420 });
    fireEvent.pointerUp(window);
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '420px' });
  });

  it('panah kanan/kiri menggeser lebar dan menjepit di batas', () => {
    render(<SplitPane {...props} defaultLeft={512} minLeft={280} maxLeft={520} />);
    const sep = screen.getByRole('separator');
    fireEvent.keyDown(sep, { key: 'ArrowRight' });   // 512+16=528 -> dijepit ke 520
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '520px' });
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });    // 520-16=504
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '504px' });
  });

  it('memulihkan gaya global saat unmount di TENGAH drag', () => {
    const { unmount } = render(<SplitPane {...props} />);
    fireEvent.pointerDown(screen.getByRole('separator'));
    expect(document.body.style.cursor).toBe('col-resize');
    unmount();
    // Tanpa stopDrag() di cleanup, kedua nilai ini tertinggal di SELURUH aplikasi.
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm test -- SplitPane`
Expected: FAIL — modul tidak ditemukan.

- [ ] **Step 3: Implementasi — `apps/web/src/components/ui/SplitPane.jsx`**

```jsx
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
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm test -- SplitPane`
Expected: PASS — 5 test.

- [ ] **Step 5: Ekspor lewat barrel**

```js
export { default as SplitPane } from './ui/SplitPane';
```

- [ ] **Step 6: Lint + test + build**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/SplitPane.jsx apps/web/src/components/ui/SplitPane.test.jsx apps/web/src/components/index.js
git commit -m "feat(web): komponen SplitPane

Dua kolom dengan pemisah yang bisa digeser, lebar disimpan per-user di localStorage.
Separator punya role=separator, tabIndex, dan navigasi panah kiri/kanan — menggeser
panel tidak boleh mengharuskan mouse.

Dibangun di Proyek A supaya Proyek B dan C memakai satu implementasi.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 10: RouteTransition

**Files:**
- Create: `apps/web/src/components/motion/RouteTransition.jsx`
- Create: `apps/web/src/components/motion/RouteTransition.test.jsx`
- Modify: `apps/web/src/components/index.js`

**Interfaces:**
- Consumes: —
- Produces: `<RouteTransition routeKey depth>{children}</RouteTransition>` — `depth` menentukan arah; naik = maju (masuk dari kanan), turun = mundur (masuk dari kiri).

- [ ] **Step 1: Tulis test yang gagal — `apps/web/src/components/motion/RouteTransition.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import RouteTransition from './RouteTransition';

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

  it('offset masuk positif saat maju, negatif saat mundur', async () => {
    const { directionOffset } = await import('./RouteTransition');
    expect(directionOffset(0, 1)).toBeGreaterThan(0);
    expect(directionOffset(1, 0)).toBeLessThan(0);
    expect(directionOffset(1, 1)).toBe(0);
  });

  it('offset menjadi 0 saat reduced-motion, apa pun arahnya', async () => {
    const { motionOffset } = await import('./RouteTransition');
    expect(motionOffset(24, true)).toBe(0);
    expect(motionOffset(24, false)).toBe(24);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm test -- RouteTransition`
Expected: FAIL — modul tidak ditemukan.

- [ ] **Step 3: Implementasi — `apps/web/src/components/motion/RouteTransition.jsx`**

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

const ENTER_PX = 24;

// Diekspor terpisah supaya bisa diuji tanpa merender animasi.
export function directionOffset(prevDepth, nextDepth) {
  if (nextDepth > prevDepth) return ENTER_PX;   // maju: masuk dari kanan
  if (nextDepth < prevDepth) return -ENTER_PX;  // mundur: masuk dari kiri
  return 0;
}

export function motionOffset(offset, reduced) {
  return reduced ? 0 : offset;
}

export default function RouteTransition({ routeKey, depth = 0, children }) {
  const reduced = useReducedMotion();
  const prevDepthRef = useRef(depth);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    setOffset(directionOffset(prevDepthRef.current, depth));
    prevDepthRef.current = depth;
  }, [depth]);

  const enter = motionOffset(offset, reduced);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        initial={{ opacity: 0, x: enter }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: motionOffset(-enter, reduced) }}
        transition={reduced
          ? { duration: 0 }
          : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm test -- RouteTransition`
Expected: PASS — 4 test.

- [ ] **Step 5: Ekspor lewat barrel**

```js
export { default as RouteTransition } from './motion/RouteTransition';
```

- [ ] **Step 6: Lint + test + build**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/motion/ apps/web/src/components/index.js
git commit -m "feat(web): RouteTransition dengan arah dari kedalaman rute

Maju = masuk dari kanan, mundur = masuk dari kiri, sehingga arah gerak memetakan
kedalaman navigasi. directionOffset dan motionOffset diekspor terpisah supaya logika
arah bisa diuji tanpa merender animasi.

prefers-reduced-motion memaksa offset 0 DAN durasi 0 — gerak HILANG, bukan dipercepat.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 11: Pasang RouteTransition + toggle kepadatan di shell

**Files:**
- Modify: `apps/web/src/pages/PPC/manufacturing/SowSchedulingPage.jsx`

**Interfaces:**
- Consumes: `RouteTransition`, `DensityProvider`, `useDensity`, `SegmentedControl` dari `'../../../components'`
- Produces: — (integrasi)

- [ ] **Step 1: Tulis ulang shell**

Ganti seluruh isi `apps/web/src/pages/PPC/manufacturing/SowSchedulingPage.jsx` dengan:

```jsx
import React, { useState } from 'react';
import { useLocation, useMatches, useNavigate, useOutlet } from 'react-router-dom';
import { DensityProvider, PageHeader, RouteTransition, SegmentedControl, useDensity } from '../../../components';

const DENSITY_ITEMS = [
  { key: 'normal', label: 'Normal' },
  { key: 'compact', label: 'Compact' },
];

function DensityToggle() {
  const { density, setDensity } = useDensity();
  return (
    <SegmentedControl
      items={DENSITY_ITEMS}
      value={density}
      onChange={setDensity}
      ariaLabel="Row density"
    />
  );
}

/**
 * FrozenRoute — WAJIB, bukan gaya-gayaan.
 *
 * <Outlet/> membaca konteks rute SAAT INI. Kalau ia dipakai langsung sebagai anak
 * AnimatePresence mode="wait", halaman yang sedang keluar ikut me-render konten BARU
 * sambil beranimasi keluar — yang terlihat: konten baru menggeser dirinya sendiri,
 * bukan transisi antar halaman.
 *
 * useState menangkap elemen outlet SEKALI saat mount. Karena komponen ini di-key oleh
 * pathname, tiap rute mendapat instance baru yang membekukan kontennya sendiri, dan
 * halaman yang keluar tetap menampilkan konten lamanya sampai animasi selesai.
 */
function FrozenRoute({ context }) {
  const outlet = useOutlet(context);
  const [frozen] = useState(outlet);
  return frozen;
}

/**
 * ManufacturingSchedulingLayout — shell rute BERSARANG untuk SOW Scheduling
 * (varian manufaktur). Menyediakan SATU <PageHeader> + <Outlet/> untuk sub-route.
 *
 * - Judul & eyebrow dibaca dari `handle` rute aktif (via useMatches).
 * - Back DETERMINISTIK: index -> /operations-hub, sub-route -> /sow-scheduling.
 * - PageHeader berada DI LUAR RouteTransition dengan sengaja: header harus diam
 *   saat konten bertransisi, kalau ikut bergerak seluruh layar terasa melompat.
 */
function SchedulingShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();

  const [headerRight, setHeaderRight] = useState(null);

  const isIndex = location.pathname.replace(/\/+$/, '') === '/sow-scheduling';
  const depth = isIndex ? 0 : 1;

  const active = [...matches].reverse().find((match) => match.handle?.title);
  const title = active?.handle?.title || 'SOW Scheduling';
  const eyebrow = active?.handle?.eyebrow || 'Manufacturing';

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-canvas">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        backLabel={isIndex ? 'Operations Hub' : 'Menu'}
        onBack={isIndex ? () => navigate('/operations-hub') : () => navigate('/sow-scheduling')}
        right={(
          <div className="flex items-center gap-2">
            <DensityToggle />
            {headerRight}
          </div>
        )}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <RouteTransition routeKey={location.pathname} depth={depth}>
          <FrozenRoute key={location.pathname} context={{ setHeaderRight }} />
        </RouteTransition>
      </div>
    </div>
  );
}

export default function ManufacturingSchedulingLayout() {
  return (
    <DensityProvider>
      <SchedulingShell />
    </DensityProvider>
  );
}
```

- [ ] **Step 2: Verifikasi manual transisi**

Run: `npm run dev`
- **Pertama, buktikan `FrozenRoute` bekerja:** navigasi Menu → Area dan amati halaman yang KELUAR. Ia harus menampilkan konten **menu** sampai animasi selesai. Kalau yang terlihat konten Area menggeser dirinya sendiri, pembekuan gagal — jangan lanjut, perbaiki dulu.
- Buka `/sow-scheduling`, klik tile "Scheduling Area" → konten masuk dari **kanan**.
- Klik "Menu" di header → konten masuk dari **kiri**.
- `PageHeader` **tidak boleh** ikut bergerak.
- Toggle Normal/Compact muncul di kanan header dan bertahan setelah reload halaman.

- [ ] **Step 3: Verifikasi reduced-motion**

Di Chrome DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion" → `reduce`.
Expected: perpindahan halaman **potong langsung**, tanpa geser dan tanpa fade.

- [ ] **Step 4: Lint + test + build**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/PPC/manufacturing/SowSchedulingPage.jsx
git commit -m "feat(web): pasang RouteTransition + toggle kepadatan di shell scheduling

PageHeader sengaja tetap DI LUAR RouteTransition — header harus diam saat konten
bertransisi, kalau ikut bergerak seluruh layar terasa melompat. Struktur shell yang ada
sudah benar untuk ini, jadi tidak perlu diubah.

Latar shell memakai bg-canvas; kartu putih di atasnya dipisahkan border + shadow-card,
bukan beda warna (kanvas vs putih hanya 1,12:1).

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 12: Tile menu memuai jadi halaman

**Files:**
- Modify: `apps/web/src/pages/PPC/manufacturing/SchedulingMenuPage.jsx`

**Interfaces:**
- Consumes: `motion` dari `framer-motion`
- Produces: `layoutId` bernama `scheduling-tile-<key>` pada tiap tile fitur.

- [ ] **Step 1: Ubah tile fitur jadi `motion.button` ber-`layoutId`**

Di `apps/web/src/pages/PPC/manufacturing/SchedulingMenuPage.jsx`:

Tambahkan import di bagian atas:

```jsx
import { motion, useReducedMotion } from 'framer-motion';
```

Di dalam `SchedulingMenuPage`, tambahkan tepat setelah `const navigate = useNavigate();`:

```jsx
  const reduced = useReducedMotion();
```

Ganti pembuka `<button` tile fitur (yang punya `className="group flex h-full flex-col gap-3 ..."`) menjadi:

```jsx
              <motion.button
                layoutId={reduced ? undefined : `scheduling-tile-${tile.key}`}
                transition={reduced ? { duration: 0 } : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
```

dan penutupnya `</button>` menjadi `</motion.button>`.

**Tile Super Admin TIDAK diubah** — ia keluar dari fitur (`/ms-project-admin`), jadi tidak ada halaman tujuan di dalam shell ini yang bisa menerima `layoutId`-nya.

- [ ] **Step 2: Verifikasi manual**

Run: `npm run dev`, buka `/sow-scheduling`, klik tile "Map SAP Operations".
Expected: tile membesar ke arah halaman tujuan, tidak melompat. Klik "Menu" — kembali mengecil.

- [ ] **Step 3: Verifikasi reduced-motion**

Aktifkan `prefers-reduced-motion: reduce`.
Expected: tidak ada efek memuai sama sekali — `layoutId` menjadi `undefined` sehingga framer-motion melewatinya.

- [ ] **Step 4: Lint + test + build**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/PPC/manufacturing/SchedulingMenuPage.jsx
git commit -m "feat(web): tile menu memuai jadi halaman tujuan

layoutId framer-motion pada tiga tile in-feature. Tile Super Admin sengaja TIDAK diubah:
ia menuju /ms-project-admin di luar shell ini, jadi tidak ada tujuan yang bisa menerima
layoutId-nya.

Saat prefers-reduced-motion aktif, layoutId di-set undefined sehingga framer-motion
melewati animasi layout sepenuhnya.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 13: Terapkan permukaan berlapis + tepi status ke tiga halaman

Ini task visual murni: markup panel inline ditukar `Panel`, badge inline ditukar `StatusPill`, dan kartu order mendapat tepi status kiri. **Tata letak tidak diubah.**

**Files:**
- Modify: `apps/web/src/features/bayScheduling/OrderPanel.jsx` (kartu order + pembungkus panel)
- Modify: `apps/web/src/pages/PPC/manufacturing/MapSapOperationPage.jsx` (dua `<section>` pembungkus)
- Modify: `apps/web/src/pages/PPC/manufacturing/ProjectBrowserPage.jsx` (kartu project)

**Interfaces:**
- Consumes: `Panel`, `StatusPill` dari barrel; token `bg-canvas`, `shadow-card`, `text-status-*`
- Produces: —

- [ ] **Step 1: Tepi status pada kartu order di `OrderPanel.jsx`**

Pada `OrderCard`, tambahkan derivasi tone tepat setelah `const hasTask = Boolean(order.has_msp_task);`:

```jsx
  // Tepi kiri membawa status tanpa menambah teks. 'late' memakai latest_plan_finish
  // karena itu satu-satunya tanggal yang tersedia per-order di baris ini.
  const finish = order.latest_plan_finish;
  const today = new Date().toISOString().slice(0, 10);
  const isLate = Boolean(order.is_unfinished && finish && finish < today);
  const edgeClass = isLate ? 'before:bg-status-late' : 'before:bg-status-running';
```

Pada `<button>` kartu (yang ber-`className="w-full rounded-xl border bg-white p-3 ..."`), ganti `shadow-sm` menjadi `shadow-card` dan tambahkan kelas tepi:

```
relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] ${edgeClass}
```

Tambahkan `pl-4` menggantikan `p-3` di sisi kiri agar teks tidak menabrak tepi: gunakan `py-3 pr-3 pl-4`.

- [ ] **Step 2: Ganti badge SAP inline dengan `StatusPill`**

Di `OrderCard`, ganti elemen `<span title={sap.hint} className="shrink-0 rounded-full border ...">{order.sap_status || 'N/A'}</span>` menjadi:

```jsx
        <StatusPill tone={isLate ? 'late' : 'running'} title={sap.hint}>
          {order.sap_status || 'N/A'}
        </StatusPill>
```

Tambahkan `StatusPill` ke import dari `'../../components'`.

- [ ] **Step 3: Panel pembungkus di `MapSapOperationPage.jsx`**

Ganti kedua `<section className="flex min-h-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0">` menjadi:

```jsx
        <Panel elevated className="min-h-[540px] lg:min-h-0">
```

dan `</section>` penutupnya menjadi `</Panel>`. Tambahkan `Panel` ke import dari `'../../../components'`.

Ganti latar `<main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:px-6">` menjadi `... bg-canvas ...` pada pembungkus terluar halaman.

- [ ] **Step 3b: Pakai `Toolbar` untuk baris search + filter**

Di panel SOW orders, blok `<div className="border-b border-slate-200 p-3">` yang memuat `SearchInput` dan `SegmentedControl` **adalah** toolbar — pola yang sama juga ada di `OrderPanel`. Ganti menjadi:

```jsx
              <Toolbar className="flex-col items-stretch gap-3">
                <SearchInput value={sowSearch} onChange={setSowSearch} placeholder="Search order or part" />
                <SegmentedControl
                  items={MAPPED_FILTERS.map((item) => ({ key: item.key, label: item.label }))}
                  value={sowMappedFilter}
                  onChange={setSowMappedFilter}
                  ariaLabel="MS Project mapping filter"
                />
              </Toolbar>
```

Tambahkan `Toolbar` ke import dari `'../../../components'`. Ini menggantikan blok yang dibuat di Task 6 Step 7 — jadi `SegmentedControl` berpindah ke dalam `Toolbar`, bukan diduplikasi.

- [ ] **Step 4: Kartu project di `ProjectBrowserPage.jsx`**

Ganti `shadow-sm` pada kartu project menjadi `shadow-card`, dan latar halaman menjadi `bg-canvas`.

- [ ] **Step 5: Verifikasi kontras §3.3 — WAJIB**

Run: `npm run dev`, buka ketiga halaman dan periksa dengan mata **dan** DevTools:
- Tidak boleh ada teks berwarna aksen (`text-status-*`, `text-[#0077b6]`) yang latarnya langsung `--canvas`. Semua harus di atas kartu/panel putih.
- Matikan `box-shadow` di DevTools (`* { box-shadow: none !important }`) — kartu harus **tetap** terbaca terpisah dari latar lewat border.

- [ ] **Step 6: Verifikasi regresi lintas halaman**

Buka `/timesheet`, `/dashboard`, `/kanban-board`.
Expected: **tidak ada perubahan visual sama sekali** selain font (dari Task 3).

- [ ] **Step 7: Lint + test + build**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/bayScheduling/OrderPanel.jsx apps/web/src/pages/PPC/manufacturing/MapSapOperationPage.jsx apps/web/src/pages/PPC/manufacturing/ProjectBrowserPage.jsx
git commit -m "feat(web): permukaan berlapis + tepi status di halaman sow-scheduling

Kartu putih mengambang di atas kanvas bernada, dipisahkan border + shadow-card. Tepi
kiri berwarna membawa status tanpa menambah teks.

Tepi 'late' menutup lubang nyata: audit 2026-09-04 menemukan order terbuka yang lewat
jadwal (1000128544 telat 74 hari, 1000128545 telat 4 hari, 1000129387 telat 1 hari)
tidak punya penanda visual apa pun di UI.

Tata letak TIDAK diubah — restrukturisasi adalah Proyek B dan C.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

### Task 14: Revisi CLAUDE.md + verifikasi akhir

Arah visual yang dipilih melanggar tiga aturan CLAUDE.md yang berlaku. Direvisi di sini supaya tidak tertinggal sebagai pelanggaran diam-diam.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/PLANNING.md`
- Modify: `docs/SOW_SCHEDULING_UI_FOUNDATION_DESIGN.md` (frontmatter `status`)

**Interfaces:**
- Consumes: —
- Produces: —

- [ ] **Step 1: Revisi aturan Shadow di `CLAUDE.md`**

Pada tabel "Shadow & Elevation Scale", ganti baris `| Card / list item | shadow-sm | Container konten di atas bg-slate-50 |` menjadi dua baris:

```markdown
| Card di atas `bg-slate-50` | `shadow-sm` | Permukaan datar, latar netral |
| Card di atas `bg-canvas` (`#eef2f6`) | `shadow-card` | Kartu mengambang. Border WAJIB tetap ada — kanvas vs putih hanya 1,12:1, jadi pemisahan tidak boleh bergantung pada shadow saja |
```

- [ ] **Step 2: Catat penambahan palet di `CLAUDE.md`**

Pada bagian "Color Palette", tambahkan setelah tabel token biru:

```markdown
**Penambahan 2026-09-04 (berlaku di `/sow-scheduling`):**

| Token | HEX | Keterangan |
|---|---|---|
| `--canvas` | `#eef2f6` | Latar berlapis. **Hanya untuk latar** — `#0077b6` di atasnya hanya 4,33:1, gagal AA |
| `--status-late` | `#b45309` | 5,02:1 di atas putih |
| `--status-running` | `#0077b6` | 4,87:1 di atas putih |
| `--status-ok` | `#047857` | 5,48:1 di atas putih |

Aturan mengikat: teks/label beraksen **wajib** di atas permukaan putih, tidak pernah langsung di atas `--canvas`.
```

- [ ] **Step 2b: Rekonsiliasi blok `:root` di `CLAUDE.md` dengan yang benar-benar ter-ship**

Ditemukan saat review Task 2. `CLAUDE.md` baris ~403 memuat blok `:root` **aspiratif** yang tidak pernah diimplementasikan, dan nilainya berbeda dari yang kini benar-benar ada di `index.css`:

```
CLAUDE.md (lama, tak pernah ter-ship): --shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
index.css (ter-ship Task 2):           --shadow-card: 0 1px 2px rgba(15,23,42,.05), 0 4px 12px rgba(15,23,42,.06);
```

Nilai baru yang benar — shadow lebih tebal adalah konsekuensi arah visual "layered" yang dipilih owner. Ganti baris `--shadow-card` di blok `:root` CLAUDE.md agar sama persis dengan `index.css`, lalu hapus catatan "**Status: BELUM ada di `index.css`**" di atas blok itu dan ganti dengan "Status: ✅ ada sejak 2026-09-04 (Proyek A Task 2)".

Selagi di sana, tambahkan `--canvas`, ketiga `--status-*`, keempat `--dur-*`, dan kedua `--ease-*` ke blok itu supaya CLAUDE.md mencerminkan isi `index.css` yang sebenarnya, bukan versi lama yang tertinggal.

- [ ] **Step 3: Perbarui tabel status implementasi di `CLAUDE.md`**

Pada tabel "Status Implementasi Design System", ubah baris CSS vars, palet Tailwind, dan Font dari ❌ menjadi ✅ dengan catatan "selesai 2026-09-04 (Proyek A)".

- [ ] **Step 4: Set status spec ke `done`**

Di `docs/SOW_SCHEDULING_UI_FOUNDATION_DESIGN.md`, ubah frontmatter `status: planning` menjadi `status: done`.

- [ ] **Step 5: Pindahkan baris di `docs/PLANNING.md`**

Pindahkan baris `[[SOW_SCHEDULING_UI_FOUNDATION_DESIGN]]` dari "👀 Menunggu review / keputusan" ke "✅ Done", dan tambahkan catatan bahwa Proyek B, C, D belum dimulai.

- [ ] **Step 6: Verifikasi akhir menyeluruh**

Jalankan **terpisah** (lihat Global Constraints — jangan dirantai `&&`):
1. `npx eslint <file yang kamu buat/ubah di task ini>` → exit 0
2. `npm test` → seluruh test lulus
3. `npm run build` → sukses

Catatan: `npx eslint` hanya atas file yang disentuh Proyek A. 126 problem baseline di 37 file lain memang ada sebelum pekerjaan ini dan TIDAK boleh diperbaiki di sini.

Verifikasi manual terakhir:
- Keempat halaman `/sow-scheduling*` memakai gaya baru dan transisi berfungsi
- `prefers-reduced-motion` mematikan seluruh gerak
- Halaman di luar `/sow-scheduling` tidak berubah selain font
- Target sentuh di `/sow-scheduling/area` ≥ 44px pada mode `compact`

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/PLANNING.md docs/SOW_SCHEDULING_UI_FOUNDATION_DESIGN.md
git commit -m "docs: revisi CLAUDE.md untuk fondasi visual sow-scheduling

Arah visual berlapis melanggar tiga aturan yang berlaku; direvisi eksplisit, bukan
dibiarkan sebagai pelanggaran diam-diam:
 1. Shadow — dipecah jadi shadow-sm (di atas slate-50) vs shadow-card (di atas canvas),
    dengan border tetap WAJIB karena kanvas vs putih hanya 1,12:1.
 2. Palet — menambah --canvas dan tiga aksen semantik, lengkap dengan angka kontras dan
    aturan 'kanvas hanya untuk latar'.
 3. Status implementasi — CSS vars, palet Tailwind, dan font stack kini benar-benar ada.

Co-Authored-By: Javanian <teesanfajar@gmail.com>"
```

---

## Catatan untuk pelaksana

**Yang TIDAK boleh dikerjakan di rencana ini:** mode tampilan (peta/timeline/tabel), logika filter, alur non-linear, restrukturisasi tata letak, pemecahan `ReservationPanel` (1.120 baris) dan `MapSapOperationPage` (1.029 baris). Semuanya Proyek B dan C.

**`SplitPane` dan `FilterChip` dibangun tapi belum dipakai** di Proyek A. Itu disengaja — keduanya milik Proyek B dan C, dibangun di sini supaya kedua proyek tidak melahirkan versinya masing-masing. Jangan memaksakan pemakaiannya ke halaman yang tata letaknya belum dirancang ulang.

Enam primitif lainnya **wajib benar-benar terpakai** sebelum Proyek A dianggap selesai: `Panel` dan `Toolbar` di Task 13, `SegmentedControl` di Task 6 dan 11, `StatusPill` di Task 13, `DensityProvider` dan `RouteTransition` di Task 11. Kalau ada yang berakhir tanpa pemakai, itu kode mati — hapus atau pakai, jangan biarkan.

**Jangan menyentuh backend.** Rencana ini murni lapisan React.
