import React from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * PageHeader — flush full-width app header (desktop-first).
 *
 * 3-kolom seimbang (grid grid-cols-[auto_1fr_auto]) supaya title benar-benar
 * center tanpa spacer hack. Ikuti Corporate Color System (light theme).
 *
 * Props:
 *   title     – string        judul halaman (center, truncate)
 *   eyebrow   – string        label kecil uppercase di atas title (opsional)
 *   onBack    – () => void    handler tombol Back; tombol hanya render bila ada
 *   backLabel – string        teks tombol Back (default: 'Back')
 *   right     – ReactNode     slot aksi kanan (opsional)
 */
export default function PageHeader({
  title,
  eyebrow,
  onBack,
  backLabel = 'Back',
  right,
}) {
  return (
    <header
      className="flex-shrink-0 grid grid-cols-[auto_1fr_auto] items-center gap-3
                 bg-white border-b border-slate-200 shadow-sm px-4 md:px-6 py-2.5"
    >
      {/* Kiri: tombol Back (outline) */}
      <div className="flex items-center justify-start">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 bg-white border border-slate-200
                       text-slate-700 hover:bg-slate-50 hover:border-slate-300
                       px-3 py-1.5 rounded-lg text-xs font-semibold
                       transition-all duration-150 active:scale-95
                       focus-visible:ring-2 focus-visible:ring-[#00b4d8] focus-visible:outline-none
                       motion-reduce:transition-none motion-reduce:transform-none"
          >
            <ArrowLeft size={16} />
            <span>{backLabel}</span>
          </button>
        )}
      </div>

      {/* Tengah: eyebrow + title */}
      <div className="min-w-0 text-center">
        {eyebrow && (
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#0077b6] truncate">
            {eyebrow}
          </div>
        )}
        <h1 className="text-sm md:text-base font-extrabold text-slate-800 truncate">
          {title}
        </h1>
      </div>

      {/* Kanan: slot aksi (kolom auto — kosong bila tak ada, tanpa spacer bohongan) */}
      <div className="flex items-center justify-end gap-2">
        {right}
      </div>
    </header>
  );
}
