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

const NO_SCHEDULE = { bg: 'bg-white', text: 'text-slate-300', note: 'No schedule', code: '—' };
const ACTIVITY = { bg: 'bg-emerald-100', text: 'text-emerald-900', note: 'Recorded' };
const ABSENT = { bg: 'bg-red-100', text: 'text-red-800', note: 'Absent' };
const SCHEDULED = { bg: 'bg-slate-50', text: 'text-slate-600', note: 'Scheduled' };

function cellStyle(row) {
  if (!row) return NO_SCHEDULE;
  const excused = EXCUSED.includes(row.status) ? STATUS_STYLE[row.status] : null;
  if (excused) return excused;
  // Jam tercatat menang atas status shift: aktivitas nyata lebih berarti daripada
  // apakah shift-nya sudah lewat atau masih berjalan.
  if (Number(row.recorded_hours) > 0) return ACTIVITY;
  if (row.attendance === 'ABSENT') return ABSENT;
  return SCHEDULED;
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
    <div className={`rounded-xl border px-3 py-2.5 text-left shadow-sm ${cls}`}>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-black leading-none tabular-nums">{value}</div>
    </div>
  );
}

function describeCell({ name, date, row, note }) {
  if (!row) return `${name}, ${date}, no schedule`;
  const shift = row.scheduled_shift === 'DAY' ? 'day shift' : 'night shift';
  return `${name}, ${date}, ${shift}, ${note}${row.half_day ? ', half day' : ''}`;
}

function HeatmapCell({
  row, selected, onStart, onExtend, onActivate, ri, ci, name, date,
  size = 'sm', today = false, weekStart = false,
}) {
  const { bg, text, note, code } = cellStyle(row);
  const day = row?.scheduled_shift === 'DAY';
  // Penanda shift kini hanya huruf: garis warna atas/bawah dihapus supaya status
  // (warna latar) menjadi informasi utama.
  const glyph = row ? (code || (day ? 'D' : 'N')) : code;
  const box = size === 'lg' ? 'h-11 w-11 text-sm' : 'h-7 w-7 text-xs';
  const label = describeCell({ name, date, row, note });
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onMouseDown={(e) => onStart(e, ri, ci)}
      onMouseEnter={() => onExtend(ri, ci)}
      onClick={() => onActivate && onActivate(ri, ci)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onActivate) onActivate(ri, ci);
        }
      }}
      title={label}
      className={`relative block rounded-md border ${box} ${bg} ${
        selected ? 'ring-2 ring-[#0077b6] border-transparent' : 'border-slate-200'
      } ${today ? 'outline outline-1 outline-[#0077b6]' : ''} ${
        weekStart ? 'ml-1' : ''
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
        row ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      {row?.half_day && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black text-amber-900">½</span>
      )}
      <span className={`pointer-events-none font-black ${text}`}>{glyph}</span>
    </button>
  );
}

export const MemoHeatmapCell = React.memo(HeatmapCell);

// Penanda shift memakai huruf yang sama persis dengan yang tercetak di dalam sel, supaya
// legenda dibaca sebagai kunci — bukan ikon yang harus diterjemahkan sendiri oleh pembaca.
function ShiftKey({ letter, className }) {
  return (
    <span className={`inline-flex h-4 w-4 items-center justify-center rounded text-xs font-black ${className}`}>
      {letter}
    </span>
  );
}

function Swatch({ className }) {
  return <span className={`inline-block h-3 w-3 rounded border border-slate-200 ${className}`} />;
}

export function RosterLegend() {
  // Dua kelompok terpisah: warna menjawab "hadir atau tidak", huruf menjawab "shift apa".
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-500">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Kehadiran</span>
        <span className="flex items-center gap-1"><Swatch className="bg-emerald-100" /> Recorded</span>
        <span className="flex items-center gap-1"><Swatch className="bg-slate-50" /> Scheduled</span>
        <span className="flex items-center gap-1"><Swatch className="bg-red-100" /> Absent</span>
        <span className="flex items-center gap-1"><Swatch className="bg-amber-50" /> Sick (S) · Leave (L) · Permit (P)</span>
        <span className="flex items-center gap-1"><Swatch className="bg-sky-100" /> Site visit (V)</span>
        <span className="flex items-center gap-1"><Swatch className="bg-slate-200" /> Off</span>
        <span className="flex items-center gap-1"><Swatch className="bg-white" /> No schedule (—)</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Shift</span>
        <span className="flex items-center gap-1"><ShiftKey letter="D" className="bg-slate-100 text-slate-700" /> Day Shift</span>
        <span className="flex items-center gap-1"><ShiftKey letter="N" className="bg-slate-100 text-slate-700" /> Night Shift</span>
        <span className="flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black text-amber-900">½</span> Half Day</span>
      </div>
    </div>
  );
}
