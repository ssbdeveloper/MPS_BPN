import React from 'react';
import { Moon, Sun } from 'lucide-react';

// Komponen presentasional roster. Tidak menyimpan state: semua data lewat props, sehingga
// halaman tetap satu-satunya pemilik state (month, scope, drag, selection). Ekstraksi ini
// memangkas ukuran halaman tanpa memindahkan state, jadi perilaku drag/selection tidak berubah.


const EXCUSED_STYLE = {
  LEAVE: 'bg-sky-200',
  SICK: 'bg-purple-200',
  PERMIT: 'bg-indigo-200',
  SITE_VISIT: 'bg-teal-200',
  OFF: 'bg-slate-300',
};

import { EXCUSED } from './rosterConstants';

function CellColor({ row, recorded, required }) {
  if (!row) return { bg: 'bg-slate-100', note: 'No schedule' };
  if (EXCUSED.includes(row.status)) return { bg: EXCUSED_STYLE[row.status], note: row.status };
  if (row.attendance === 'PRESENT') {
    const ratio = required > 0 ? recorded / required : 1;
    if (ratio >= 1) return { bg: 'bg-emerald-400/80', note: `Present ${recorded.toFixed(1)}/${required.toFixed(0)}h` };
    if (ratio >= 0.5) return { bg: 'bg-lime-300/90', note: `Partial ${recorded.toFixed(1)}/${required.toFixed(0)}h` };
    return { bg: 'bg-red-300/80', note: `Low ${recorded.toFixed(1)}/${required.toFixed(0)}h` };
  }
  if (row.attendance === 'ABSENT') return { bg: 'bg-red-200', note: 'Absent' };
  if (row.attendance === 'IN_PROGRESS') return { bg: 'bg-amber-100', note: 'In progress' };
  return { bg: 'bg-slate-200', note: row.status };
}

export function StatTile({ label, value, tone = 'neutral' }) {
  // Tone memakai kelas Tailwind + token brand (tanpa hex di luar token set).
  const tones = {
    neutral: 'border-slate-200 bg-slate-50 text-slate-700',
    good: 'border-emerald-200 bg-[#f0fdf4] text-[#047857]',
    bad: 'border-red-200 bg-red-50 text-red-700',
    info: 'border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]',
  };
  const cls = tones[tone] || tones.neutral;
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-center shadow-sm ${cls}`}>
      <div className="text-xs font-bold uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-lg font-black leading-none">{value}</div>
    </div>
  );
}

function HeatmapCell({ row, selected, onStart, onExtend, ri, ci, name, date }) {
  const recorded = Number(row?.recorded_hours || 0);
  const required = Number(row?.scheduled_standard_hours || 0);
  const { bg } = CellColor({ row, recorded, required });
  const strip = row ? (row.scheduled_shift === 'DAY' ? 'border-t-2 border-amber-400' : 'border-t-2 border-indigo-500') : '';
  return (
    <button
      type="button"
      onMouseDown={(e) => onStart(e, ri, ci)}
      onMouseEnter={() => onExtend(ri, ci)}
      title={row
        ? `${name} · ${date} · ${row.scheduled_shift} · ${row.attendance}${row.half_day ? ' · half day' : ''}${row.standard_hours_override ? ` · target ${row.standard_hours_override}h (override)` : ''}${row.shift_override ? ' · shift override' : ''}`
        : `${name} · ${date} · no schedule`}
      className={`relative block h-7 w-7 rounded-md border ${bg} ${strip} ${
        selected ? 'ring-2 ring-[#0077b6]' : 'border-transparent'
      } ${row ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {row?.scheduled_shift === 'NIGHT' && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] rounded-b-md bg-indigo-500" />
      )}
      {row?.half_day && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-xs font-black text-white">½</span>
      )}
      {row && (
        <span className={`pointer-events-none text-xs font-black ${row.scheduled_shift === 'DAY' ? 'text-amber-900' : 'text-indigo-900'}`}>
          {row.scheduled_shift === 'DAY' ? 'D' : 'N'}
        </span>
      )}
    </button>
  );
}

export const MemoHeatmapCell = React.memo(HeatmapCell);

export function RosterLegend() {
  return (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-500">
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-emerald-400/80" /> ≥100%</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-lime-300/90" /> 50–99%</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-red-300/80" /> &lt;50%</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-red-200" /> Absent</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-amber-100" /> In progress</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-sky-200" /> Leave</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-purple-200" /> Sick</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-indigo-200" /> Permit</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-slate-300" /> Off</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-slate-100" /> No schedule</span>
              <span className="flex items-center gap-1"><Sun size={12} className="text-amber-500" /> DAY (garis atas kuning)</span>
              <span className="flex items-center gap-1"><Moon size={12} className="text-indigo-500" /> NIGHT (garis biru atas+bawah)</span>
              <span className="flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-xs font-black text-white">½</span> half day</span>
            </div>
  );
}
