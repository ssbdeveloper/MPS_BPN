import React from 'react';

/**
 * Skeleton — blok placeholder loading (animate-pulse) seukuran konten.
 *
 * Pola State Standar (UI Engineering §4): loading konten pakai skeleton,
 * BUKAN spinner satu layar. Hormati prefers-reduced-motion.
 *
 * Props:
 *   className – string  ukuran/layout (mis. "h-8 w-40"); default kosong
 */
export default function Skeleton({ className = '' }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none ${className}`}
      aria-hidden="true"
    />
  );
}

/**
 * SkeletonText — beberapa baris teks skeleton.
 *
 * Props:
 *   lines     – number  jumlah baris (default 3)
 *   className – string  layout wrapper (opsional)
 */
export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`h-3 animate-pulse rounded bg-slate-200 motion-reduce:animate-none ${
            i === lines - 1 ? 'w-2/3' : 'w-full'
          }`}
        />
      ))}
    </div>
  );
}

/**
 * SkeletonRow — satu baris tabel skeleton (grid kolom sederajat).
 *
 * Props:
 *   cols      – number  jumlah kolom (default 4)
 *   className – string  layout wrapper (opsional)
 */
export function SkeletonRow({ cols = 4, className = '' }) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: cols }).map((_, i) => (
        <div
          key={i}
          className="h-4 flex-1 animate-pulse rounded bg-slate-200 motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
