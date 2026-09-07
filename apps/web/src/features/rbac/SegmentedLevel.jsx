import React from 'react';
import { LEVELS } from '../../rbac/permissionMatrix';

// Three access levels shown as a friendly segmented control (no technical slugs).
// Dipakai bersama oleh editor user (override per-user) & editor role (isi paket).
const LEVEL_SEG = [
  { value: LEVELS.NO_ACCESS, label: 'None', active: 'bg-slate-600 text-white' },
  { value: LEVELS.READ_ONLY, label: 'Read', active: 'bg-amber-500 text-white' },
  { value: LEVELS.FULL_ACCESS, label: 'Full', active: 'bg-emerald-600 text-white' },
];

export default function SegmentedLevel({ value, onChange, disabled, compact }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
      {LEVEL_SEG.map((seg, i) => {
        const active = value === seg.value;
        return (
          <button
            key={seg.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(seg.value)}
            className={`font-bold transition-colors ${i > 0 ? 'border-l border-slate-200' : ''} ${
              compact ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-[11px]'
            } ${active ? seg.active : 'bg-white text-slate-500 hover:bg-slate-50'} ${
              disabled ? 'cursor-not-allowed opacity-60' : ''
            }`}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
