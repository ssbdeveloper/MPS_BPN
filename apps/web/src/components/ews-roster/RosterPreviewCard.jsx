import React from 'react';
import { Eye, Info, RefreshCw } from 'lucide-react';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function RosterPreviewCard({ rows, loading, error, onLoad }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">
          Weekly outlook of scheduled headcounts based on saved roster assignments.
        </p>
        <button
          type="button"
          onClick={onLoad}
          disabled={loading}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-extrabold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Refreshing…' : 'Load 7-Day Preview'}
        </button>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2.5 text-[11px] text-slate-600">
        <Info size={14} className="mt-0.5 shrink-0 text-[#0077b6]" />
        <span>Reflects saved roster and schedule records. Unsaved form drafts are not shown until applied.</span>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
          {error}
        </div>
      )}

      {rows?.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-black uppercase tracking-wider text-slate-500">
                <th className="p-3">Date</th>
                <th className="p-3 text-center tabular-nums">Day Shift</th>
                <th className="p-3 text-center tabular-nums">Night Shift</th>
                <th className="p-3 text-center tabular-nums">Total Operators</th>
                <th className="p-3 text-right">Day Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.date} className="hover:bg-slate-50/60">
                  <td className="p-3 font-semibold text-slate-800">
                    <span className="font-bold">{DAY_NAMES[new Date(`${row.date}T00:00:00`).getDay()]}</span>{' '}
                    <span className="font-mono text-slate-500 tabular-nums">{row.date}</span>
                  </td>
                  <td className="p-3 text-center font-bold tabular-nums text-amber-700">{row.day}</td>
                  <td className="p-3 text-center font-bold tabular-nums text-indigo-700">{row.night}</td>
                  <td className="p-3 text-center font-black tabular-nums text-slate-800">{row.total}</td>
                  <td className="p-3 text-right">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-extrabold ${row.total ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                      {row.total ? 'Operating' : 'Off'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !loading && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center">
            <Eye size={22} className="text-slate-400" />
            <p className="mt-2 text-xs font-bold text-slate-700">No preview loaded yet</p>
            <p className="mt-0.5 text-[11px] text-slate-500">Click &quot;Load 7-Day Preview&quot; above to inspect the upcoming week.</p>
          </div>
        )
      )}
    </div>
  );
}
