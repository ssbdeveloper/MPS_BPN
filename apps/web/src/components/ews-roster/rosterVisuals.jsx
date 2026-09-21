import React from 'react';

// Komponen presentasional roster. Tidak menyimpan state: semua data lewat props, sehingga
// halaman tetap satu-satunya pemilik state (month, scope, view, drag, selection). Ekstraksi ini
// memangkas ukuran halaman tanpa memindahkan state, jadi perilaku drag/selection tidak berubah.

import { EXCUSED } from './rosterConstants';

// Heatmap sebulan penuh berisi ribuan sel (≈143 operator × 31 hari). Warna sel karena itu
// ditentukan lewat lookup tabel, bukan hitungan per sel.
//
// Aturannya biner: ada jam tercatat atau tidak. Tidak ada jam sama sekali berarti absent,
// dan itu sudah ditentukan API (attendance = ABSENT saat recorded = 0).
//
// Palet 2026-09-20: pastel. Absen tanpa keterangan (merah) dipisahkan dari izin/sakit/cuti
// (amber + kode huruf) supaya mata hanya tertarik ke hal yang benar-benar perlu tindakan.

const STATUS_STYLE = {
  // Ketidakhadiran berketerangan: dibedakan dari absen, ditandai kode huruf.
  SICK: { bg: 'bg-amber-50', text: 'text-amber-800', note: 'Sick', code: 'S' },
  LEAVE: { bg: 'bg-amber-50', text: 'text-amber-800', note: 'Leave', code: 'L' },
  PERMIT: { bg: 'bg-amber-50', text: 'text-amber-800', note: 'Permit', code: 'P' },
  // Libur terjadwal bukan pengecualian — netral, jangan menarik mata.
  OFF: { bg: 'bg-slate-200', text: 'text-slate-500', note: 'Off' },
  SITE_VISIT: { bg: 'bg-sky-100', text: 'text-sky-800', note: 'Site visit', code: 'V' },
};

// Scheduled and No schedule are both nearly white. Distinguish them by border shape
// (dashed means no schedule) rather than introducing another attention-grabbing colour.
const NO_SCHEDULE = {
  bg: 'bg-white', text: 'text-slate-400', note: 'No schedule', code: '—', border: 'border-dashed border-slate-300',
};
const ACTIVITY = { bg: 'bg-emerald-100', text: 'text-emerald-900', note: 'Recorded' };
const ABSENT = { bg: 'bg-red-100', text: 'text-red-800', note: 'Absent' };
const SCHEDULED = { bg: 'bg-slate-50', text: 'text-slate-600', note: 'Scheduled' };

function cellStyle(row) {
  if (!row) return NO_SCHEDULE;
  // Overtime on a date with no roster row: the day exists only because work was logged,
  // so it is shown as activity without pretending a schedule existed.
  if (row.has_roster === false) return NO_SCHEDULE;
  const excused = EXCUSED.includes(row.status) ? STATUS_STYLE[row.status] : null;
  if (excused) return excused;
  // Jam tercatat menang atas status shift: aktivitas nyata lebih berarti daripada
  // apakah shift-nya sudah lewat atau masih berjalan.
  if (Number(row.recorded_hours) > 0) return ACTIVITY;
  if (row.attendance === 'ABSENT') return ABSENT;
  return SCHEDULED;
}

// Overtime is reported by the API from the confirmation number alone. It is never inferred
// here from hours above target, and an absent OV marker is not proof that no overtime exists.
function overtimeOf(row) {
  if (!row) return { has: false, pending: false };
  const counted = Number(row.overtime_record_count) > 0 || Number(row.overtime_hours) > 0;
  const pending = Number(row.overtime_pending_count) > 0;
  return { has: counted || pending, pending: pending && !counted };
}

export function StatTile({ label, value, tone = 'neutral' }) {
  // Kartu ringkasan sengaja tenang: heatmap yang harus dibaca lebih dulu. Hanya nada
  // "bad" (Absent > 0) yang boleh menarik perhatian.
  const tones = {
    neutral: 'border-slate-200 bg-white text-slate-800',
    good: 'border-slate-200 bg-white text-slate-800',
    bad: 'border-red-200 bg-red-50 text-red-700',
    info: 'border-slate-200 bg-white text-slate-800',
  };
  const cls = tones[tone] || tones.neutral;
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-left ${cls}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-extrabold leading-none tabular-nums">{value}</div>
    </div>
  );
}

function describeCell({ name, date, row, note, overtime }) {
  if (!row) return `${name}, ${date}, no schedule`;
  // A roster-less day has no scheduled shift; saying "day shift" there would invent one,
  // and calling it "Off" would misreport a day the roster never covered.
  const base = row.has_roster === false
    ? `${name}, ${date}, no schedule`
    : `${name}, ${date}, ${row.scheduled_shift === 'DAY' ? 'day shift' : 'night shift'}, ${note}`;
  const ot = overtime && overtime.has
    ? (overtime.pending ? ', overtime hours not yet available' : ', includes overtime')
    : '';
  return `${base}${ot}${row.half_day ? ', half day' : ''}`;
}

function HeatmapCell({
  row, selected, onStart, onExtend, onActivate, ri, ci, name, date,
  size = 'sm',
}) {
  const { bg, text, note, code, border } = cellStyle(row);
  const day = row?.scheduled_shift === 'DAY';
  const overtime = overtimeOf(row);
  // A day with no roster row cannot be edited: there is nothing to apply a status to, and
  // bulk actions address roster cells. It stays visible and readable, but inert.
  const readOnly = !row || row.has_roster === false;
  // Penanda shift kini hanya huruf: garis warna atas/bawah dihapus supaya status
  // (warna latar) menjadi informasi utama.
  const glyph = row ? (row.has_roster === false ? code || '—' : code || (day ? 'D' : 'N')) : code;
  // The button fills its table-fixed column and may be rectangular. Only height is fixed:
  // 44 px in Week for touch, and 28 px in Month for the dense desktop overview.
  const box = size === 'lg' ? 'h-11 w-full text-sm' : 'h-7 w-full text-xs';
  const label = describeCell({ name, date, row, note, overtime });
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      aria-disabled={readOnly ? 'true' : undefined}
      onMouseDown={(e) => !readOnly && onStart(e, ri, ci)}
      onMouseEnter={() => !readOnly && onExtend(ri, ci)}
      onClick={() => !readOnly && onActivate && onActivate(ri, ci, 'pointer')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!readOnly && onActivate) onActivate(ri, ci, 'keyboard');
        }
      }}
      title={label}
      className={`relative block rounded-md border ${box} ${bg} ${
        selected ? 'ring-2 ring-[#0077b6] border-transparent' : border || 'border-slate-200'
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
        readOnly ? 'cursor-default' : 'cursor-pointer'
      }`}
    >
      {row?.half_day && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[11px] font-bold leading-none text-amber-900">½</span>
      )}
      <span className={`pointer-events-none font-bold ${text} ${
        overtime.has && size === 'lg' ? 'inline-block -translate-y-[5px]' : ''
      }`}>{glyph}</span>
      {overtime.has && (
        // Overtime marker. In Week (44 px) there is room to print "OV"; in the 28 px Month
        // cell the text would collide with the shift letter, so the same information is
        // carried by a bar in the same violet, explained in the legend. Either way the
        // aria-label states the overtime, so screen readers never depend on the glyph.
        <span
          data-ov={overtime.pending ? 'pending' : 'yes'}
          aria-hidden="true"
          className={`pointer-events-none absolute flex items-center justify-center font-extrabold leading-none tracking-tight ${
            size === 'lg'
              ? 'inset-x-0 bottom-0 h-3.5 rounded-b-md text-[11px]'
              : 'bottom-0.5 left-0.5 h-2 w-2 rounded-full'
          } ${
            overtime.pending
              ? 'border border-dashed border-violet-500 bg-white text-violet-500'
              : 'bg-violet-500/90 text-white'
          }`}
        >
          {size === 'lg' ? 'OV' : ''}
        </span>
      )}
    </button>
  );
}

export const MemoHeatmapCell = React.memo(HeatmapCell);

// Penanda shift memakai huruf yang sama persis dengan yang tercetak di dalam sel, supaya
// legenda dibaca sebagai kunci — bukan ikon yang harus diterjemahkan sendiri oleh pembaca.
function ShiftKey({ letter, className }) {
  return (
    <span className={`inline-flex h-4 w-4 items-center justify-center rounded text-[11px] font-bold leading-none ${className}`}>
      {letter}
    </span>
  );
}

function Swatch({ className }) {
  return <span className={`inline-block h-3 w-3 rounded border border-slate-200 ${className}`} />;
}

export function RosterLegend() {
  // Dua kelompok terpisah: warna menjawab "hadir atau tidak", huruf menjawab "shift apa".
  // Tight spacing keeps the legend to one or two lines on tablets so the heatmap retains
  // the available vertical space.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-200 px-4 py-2 text-[11px] font-semibold text-slate-600">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Kehadiran</span>
        <span className="flex items-center gap-1"><Swatch className="bg-emerald-100" /> Recorded</span>
        <span className="flex items-center gap-1"><Swatch className="bg-slate-50" /> Scheduled</span>
        <span className="flex items-center gap-1"><Swatch className="bg-red-100" /> Absent</span>
        <span className="flex items-center gap-1"><Swatch className="bg-amber-50" /> Sick (S) · Leave (L) · Permit (P)</span>
        <span className="flex items-center gap-1"><Swatch className="bg-sky-100" /> Site visit (V)</span>
        <span className="flex items-center gap-1"><Swatch className="bg-slate-200" /> Off</span>
        <span className="flex items-center gap-1"><Swatch className="border-dashed border-slate-300 bg-white" /> No schedule (—)</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-violet-500/90" />
          OV: confirmation number contains OV
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Shift</span>
        <span className="flex items-center gap-1"><ShiftKey letter="D" className="bg-slate-100 text-slate-700" /> Day Shift</span>
        <span className="flex items-center gap-1"><ShiftKey letter="N" className="bg-slate-100 text-slate-700" /> Night Shift</span>
        <span className="flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[11px] font-bold leading-none text-amber-900">½</span> Half Day</span>
      </div>
    </div>
  );
}
