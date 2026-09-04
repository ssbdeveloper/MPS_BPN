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
