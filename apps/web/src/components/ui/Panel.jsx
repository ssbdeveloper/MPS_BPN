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
