import React from 'react';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function RosterPreviewCard({ rows, loading, error, onLoad }) {
  return <div>
    <button type="button" onClick={onLoad} disabled={loading} className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 text-xs font-extrabold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:opacity-50">{loading ? 'Loading…' : 'Load Preview'}</button>
    {error && <p role="alert" className="mt-2 text-xs font-bold text-red-700">{error}</p>}
    {rows?.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs font-black uppercase text-slate-500"><th className="p-2">Date</th><th className="p-2 text-center">Day Shift</th><th className="p-2 text-center">Night Shift</th><th className="p-2 text-center">Total</th><th className="p-2">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.date}><td className="p-2 font-semibold">{DAY_NAMES[new Date(`${row.date}T00:00:00`).getDay()]} {row.date.slice(5)}</td><td className="p-2 text-center font-bold text-amber-700">{row.day}</td><td className="p-2 text-center font-bold text-indigo-700">{row.night}</td><td className="p-2 text-center">{row.total}</td><td className="p-2 text-xs text-slate-500">{row.total ? 'Scheduled' : 'Off'}</td></tr>)}</tbody></table></div>}
  </div>;
}
