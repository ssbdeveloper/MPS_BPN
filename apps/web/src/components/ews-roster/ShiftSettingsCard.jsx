import React, { useState } from 'react';
import { AlertTriangle, Moon, RefreshCw, Save, Sun } from 'lucide-react';

// Master shift tunggal (public.shift_definition). Kartu ini hanya memegang draft form lokal;
// data dan aksi tetap milik halaman supaya tidak ada dua sumber state.

const clock = (value) => String(value || '').slice(0, 5);

// Kelas yang dipakai berulang di kartu ini (satu definisi, tanpa duplikasi literal).
const FIELD = 'flex flex-col gap-1 text-xs font-bold text-slate-600';
const INPUT = 'h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-800 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]';
const NOTE = 'mt-2 text-xs font-semibold text-slate-500';

function duration(minutes) {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total <= 0) return '—';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}j ${String(m).padStart(2, '0')}m` : `${h}j`;
}

function ShiftRow({ shift, draft, onChange, onSave, busy }) {
  // draft hanya terisi setelah user mengubah sesuatu, jadi WAJIB optional-chained: kalau tidak,
  // render pertama (draft undefined) langsung mati dengan "reading 'standard_hours'".
  const value = (field) => (draft?.[field] !== undefined ? draft[field] : shift[field]);
  const isDay = shift.shift_code === 'DAY';
  const span = Number(shift.span_minutes || 0);
  const std = Number(value('standard_hours') || 0) * 60;
  const rest = span - std;
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-extrabold ${isDay ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-indigo-300 bg-indigo-50 text-indigo-800'}`}>
            {isDay ? <Sun size={13} /> : <Moon size={13} />}
            {shift.shift_code}
          </span>
          <span className="text-xs font-semibold text-slate-500">{shift.shift_name} · {shift.sow_shift_code}</span>
        </div>
        <button
          type="button"
          onClick={() => onSave(shift.shift_code, draft)}
          disabled={busy || !draft || Object.keys(draft).length === 0}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-4 text-xs font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save size={14} /> Simpan
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className={FIELD}>
          Jam masuk
          <input
            type="time"
            value={clock(value('start_time'))}
            onChange={(e) => onChange(shift.shift_code, { start_time: e.target.value })}
            className={INPUT}
          />
        </label>
        <label className={FIELD}>
          Jam selesai
          <input
            type="time"
            value={clock(value('end_time'))}
            onChange={(e) => onChange(shift.shift_code, { end_time: e.target.value })}
            className={INPUT}
          />
        </label>
        <label className={FIELD}>
          Jam kerja bersih
          <input
            type="number" min="0.25" max="24" step="0.25"
            value={value('standard_hours')}
            onChange={(e) => onChange(shift.shift_code, { standard_hours: e.target.value })}
            className={INPUT}
          />
        </label>
        <label className="flex items-center gap-2 pt-5 text-xs font-bold text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(value('crosses_midnight'))}
            onChange={(e) => onChange(shift.shift_code, { crosses_midnight: e.target.checked })}
            className="h-4 w-4 rounded border-slate-400"
          />
          Lewat tengah malam
        </label>
      </div>

      <p className={NOTE}>
        Rentang kehadiran {duration(span)} · jam kerja bersih {duration(std)} · istirahat {rest > 0 ? duration(rest) : '—'}
      </p>
    </div>
  );
}

export default function ShiftSettingsCard({ shifts, overrides, impact, onSave, onPreview, onResync, busy }) {
  const [drafts, setDrafts] = useState({});
  const change = (code, patch) => setDrafts((d) => ({ ...d, [code]: { ...(d[code] || {}), ...patch } }));

  const differing = Number(impact?.differing_rows ?? 0);
  const resyncable = Number(impact?.resyncable_rows ?? 0);

  if (!shifts?.length) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
        <AlertTriangle size={14} className="mr-1 inline" />
        Belum ada shift yang dipetakan ke roster. Jalankan migration master shift lebih dulu.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {shifts.map((shift) => (
        <ShiftRow
          key={shift.shift_code}
          shift={shift}
          draft={drafts[shift.shift_code]}
          onChange={change}
          onSave={onSave}
          busy={busy}
        />
      ))}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Dampak ke roster future</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onPreview}
              disabled={busy}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:opacity-50"
            >
              <RefreshCw size={14} /> Cek dampak
            </button>
            <button
              type="button"
              onClick={onResync}
              disabled={busy || resyncable === 0}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-3 text-xs font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Terapkan ke {resyncable} baris
            </button>
          </div>
        </div>
        {impact ? (
          <p className="mt-2 text-xs font-semibold text-slate-600">
            {impact.future_rows} baris future · {differing} berbeda dari master · {resyncable} aman disinkronkan ·{' '}
            {impact.skipped_rows} dilewati (manual, lock, half day, atau override operator).
          </p>
        ) : (
          <p className={NOTE}>
            Klik "Cek dampak" untuk melihat berapa baris future yang berbeda dari master. Baris dengan override operator,
            half day, atau lock tidak pernah ditimpa.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Override tanggal</div>
        {overrides?.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {overrides.map((row) => (
              <li key={`${row.shift_code}-${row.effective_date}`} className="flex flex-wrap items-center gap-2 py-2 text-xs font-semibold text-slate-700">
                <span className="font-mono text-slate-500">{row.effective_date}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-extrabold ${row.shift_code === 'DAY' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>
                  {row.shift_code}
                </span>
                <span>{clock(row.start_time)} - {clock(row.end_time)}</span>
                <span className="text-slate-500">bersih {Number(row.standard_hours)}j</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={NOTE}>Belum ada override tanggal.</p>
        )}
        <p className="mt-2 text-xs font-semibold text-slate-400">
          Override berlaku hanya pada tanggalnya (dipakai bersama oleh roster, heatmap, dan adoption).
        </p>
      </div>
    </div>
  );
}
