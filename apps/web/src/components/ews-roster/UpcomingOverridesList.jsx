import React from 'react';
import { Clock, Trash2 } from 'lucide-react';

const clock = (val) => String(val || '').slice(0, 5);

export default function UpcomingOverridesList({
  upcomingOverrides,
  plantToday,
  onDeleteOverride,
  busy,
}) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4">
      <h4 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-700">
        <Clock size={15} className="text-[#0077b6]" />
        Daftar Jam Khusus Aktif (Mendatang & Hari Ini)
      </h4>

      {upcomingOverrides && upcomingOverrides.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {upcomingOverrides.map((row) => (
            <li
              key={`${row.id}-${row.shift_code}-${row.effective_date}`}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs font-semibold text-slate-700"
            >
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-extrabold ${row.shift_code === 'DAY' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>
                  {row.shift_code}
                </span>
                <span className="font-mono text-slate-800">{row.effective_date}</span>
                {row.today && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-extrabold text-amber-800">
                    HARI INI
                  </span>
                )}
                <span className="text-slate-600">
                  {clock(row.start_time)} - {clock(row.end_time)}
                </span>
                <span className="text-slate-500">
                  ({Number(row.standard_hours)}h)
                </span>
              </div>

              <button
                type="button"
                onClick={() => onDeleteOverride(row.id, row.effective_date === plantToday)}
                disabled={busy}
                aria-label={`Hapus jam khusus ${row.shift_code} tanggal ${row.effective_date}`}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 active:scale-95 disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs font-semibold text-slate-400">
          Belum ada jam khusus yang aktif untuk hari ini dan tanggal mendatang.
        </p>
      )}
    </div>
  );
}
