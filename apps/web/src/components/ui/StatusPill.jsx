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
