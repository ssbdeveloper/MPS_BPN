import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  afterEach(() => vi.restoreAllMocks());

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

  // Regresi: offset basi (stale-offset bug, commit 092e046).
  //
  // Pendekatan yang dideskripsikan awalnya — membaca `style.transform` elemen
  // `motion.div` setelah `rerender` — TIDAK bisa dipakai di jsdom untuk kasus ini:
  // (1) `AnimatePresence initial={false}` membuat child yang sudah ada saat mount
  //     pertama TIDAK PERNAH mendapat style `initial` (langsung ke `animate`, jadi
  //     `transform` selalu "none" walau depth awal bukan 0), dan
  //     (2) `mode="wait"` menahan key baru mount sampai child lama selesai exit,
  //     yang di jsdom tidak pernah selesai tanpa timer/RAF asli — jadi key baru
  //     tidak pernah muncul di DOM lewat `rerender` biasa.
  // Diverifikasi manual dengan probe test terpisah sebelum keputusan ini diambil.
  //
  // Percobaan kedua yang JUGA gagal: spy pada `motionOffset` dan membaca panggilan
  // PERTAMA setelah `rerender`. Ternyata tidak valid untuk pola fix ini — React
  // menjalankan seluruh body komponen (termasuk panggilan `motionOffset` untuk
  // `enter`/`exit`) pada render PERTAMA sebelum sempat membuang hasilnya dan
  // me-render ulang dengan state baru ("adjusting state during render" tetap
  // mengeksekusi body-nya, cuma hasil JSX-nya yang dibuang, bukan side-effect-nya).
  // Jadi panggilan pertama SELALU memakai offset basi baik di kode lama maupun
  // kode yang sudah benar — spy tidak bisa membedakan render yang di-commit dari
  // yang dibuang, karena spy hanya melihat pemanggilan fungsi, bukan JSX yang
  // benar-benar sampai ke DOM.
  //
  // Percobaan ketiga: mock `motion.div` jadi `<div>` polos yang membaca `initial.x`
  // langsung di tiap render. MASIH gagal menangkap bug — `rerender` dari RTL
  // membungkus `act()`, yang memflush efek SEBELUM `rerender` selesai. Jadi meski
  // kode lama commit dua kali (commit pertama basi, lalu commit kedua dari effect
  // dengan offset benar), keduanya sudah selesai saat assertion jalan, dan
  // `initial.x` yang terbaca adalah dari commit KEDUA (benar) — bug tersembunyi.
  //
  // Pendekatan final: `motion.div` tiruan menyimpan `initial.x` lewat initializer
  // lazy `useState(() => ...)`, yang — sama seperti semantik `initial` framer-motion
  // asli — HANYA dievaluasi sekali pada render pertama instance tersebut, dan
  // diabaikan pada render ulang berikutnya untuk instance yang sama. Karena
  // `key={routeKey}` membuat instance baru tiap navigasi, state ini reset persis
  // saat key berganti — meniru "animasi masuk hanya menangkap initial sekali saat
  // mount; re-render dengan `initial` baru pada instance yang SAMA tidak
  // menghidupkan ulang animasi." Pada kode lama, commit pertama (yang membuat
  // instance baru, offset basi) itulah yang tertangkap; commit kedua dari effect
  // merender ulang instance yang sama dan diabaikan — persis bug aslinya. Pada
  // kode yang benar, render yang dibuang ("adjusting state during render") tidak
  // pernah sampai ke rekonsiliasi anak, jadi instance baru hanya benar-benar
  // mount sekali, dengan offset yang sudah benar.
  it('regresi: JSX yang di-commit untuk key baru memakai offset arah BARU (maju=positif, mundur=negatif), bukan offset transisi sebelumnya', async () => {
    vi.resetModules();
    vi.doMock('framer-motion', () => ({
      AnimatePresence: ({ children }) => children,
      motion: {
        // Bukan forwardRef — RouteTransition tidak pernah membaca ref MotionDiv,
        // jadi tak perlu diteruskan (juga menghindari `react-hooks/refs`, yang
        // melarang pola akses ref saat render — proyek ini melarang eslint-disable).
        div: function MockMotionDiv({ children, initial, className }) {
          // Tangkap `initial.x` HANYA pada render pertama instance ini (initializer
          // lazy useState hanya jalan sekali saat mount, diabaikan pada render
          // ulang) — meniru semantik framer-motion asli: animasi masuk menangkap
          // `initial` sekali saat mount; render ulang instance yang sama dengan
          // `initial` baru tidak menghidupkan ulang animasi.
          const [capturedEnterX] = React.useState(() => (initial ? initial.x : undefined));
          return React.createElement(
            'div',
            { className, 'data-enter-x': capturedEnterX },
            children
          );
        },
      },
      useReducedMotion: () => false,
    }));

    const { default: RouteTransitionMocked } = await import('./RouteTransition');

    const { container, rerender } = render(
      React.createElement(RouteTransitionMocked, { routeKey: '/a', depth: 0 }, React.createElement('p', null, 'a'))
    );

    rerender(
      React.createElement(RouteTransitionMocked, { routeKey: '/b', depth: 1 }, React.createElement('p', null, 'b'))
    );
    const forwardEl = container.querySelector('[data-enter-x]');
    expect(forwardEl).not.toBeNull();
    expect(Number(forwardEl.getAttribute('data-enter-x'))).toBeGreaterThan(0);

    rerender(
      React.createElement(RouteTransitionMocked, { routeKey: '/c', depth: 0 }, React.createElement('p', null, 'c'))
    );
    const backwardEl = container.querySelector('[data-enter-x]');
    expect(backwardEl).not.toBeNull();
    expect(Number(backwardEl.getAttribute('data-enter-x'))).toBeLessThan(0);

    vi.doUnmock('framer-motion');
    vi.resetModules();
  });
});
