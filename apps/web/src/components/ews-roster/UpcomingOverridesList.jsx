import React from 'react';
import { Clock, Trash2 } from 'lucide-react';

const clock = (val) => String(val || '').slice(0, 5);

export default function UpcomingOverridesList({
  upcomingOverrides,
  plantToday,
  onDeleteOverride,
  busy,
  highlightId,
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-700">
          <Clock size={15} className="text-[#0077b6]" />
          Active Temporary Overrides (Today &amp; Upcoming)
        </h4>
        <span className="text-[11px] font-semibold text-slate-400">
          {upcomingOverrides?.length || 0} active
        </span>
      </div>

      {upcomingOverrides && upcomingOverrides.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {upcomingOverrides.map((row) => {
            const isHighlighted = highlightId && Number(highlightId) === Number(row.id);
            const isToday = row.today || row.effective_date === plantToday;
            const isDay = row.shift_code === 'DAY';
            return (
              <li
                key={`${row.id}-${row.shift_code}-${row.effective_date}`}
                className={`flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs font-semibold text-slate-700 transition-colors duration-200 ${isHighlighted ? 'bg-amber-50/80 -mx-2 px-2 rounded-lg' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-extrabold ${isDay ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-indigo-200 bg-indigo-50 text-indigo-800'}`}>
                    {row.shift_code} Shift
                  </span>
                  <span className="font-mono tabular-nums text-slate-800">{row.effective_date}</span>
                  {isToday && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-extrabold tracking-wide text-amber-900">
                      TODAY
                    </span>
                  )}
                  <span className="tabular-nums text-slate-600">
                    {clock(row.start_time)} - {clock(row.end_time)}
                  </span>
                  <span className="text-slate-500 tabular-nums">
                    ({Number(row.standard_hours)}h net)
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onDeleteOverride(row.id, isToday)}
                  disabled={busy}
                  aria-label={`Delete temporary hours for ${row.shift_code} on ${row.effective_date}`}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 active:scale-95 disabled:opacity-50"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-xs font-semibold text-slate-400">
          No temporary overrides are currently active for today or upcoming dates.
        </p>
      )}
    </div>
  );
}
