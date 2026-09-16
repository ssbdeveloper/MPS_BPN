import React, { useState } from 'react';
import { Search } from 'lucide-react';

const SEGMENTS = [['', 'Follow Rotation'], ['DAY', 'Always Day'], ['NIGHT', 'Always Night']];

export default function OperatorShiftCard({ operators, weekContext, onWeekChange, onAssign, onFixedShift }) {
  const [filter, setFilter] = useState('unassigned');
  const [search, setSearch] = useState('');
  const dayGroup = weekContext?.day_group;
  const nightGroup = weekContext?.night_group;
  const group = (operator) => operator.rotation_group || null;
  const effectiveShift = (operator) => operator.fixed_shift || (group(operator) === dayGroup ? 'DAY' : group(operator) === nightGroup ? 'NIGHT' : null);
  const counts = {
    unassigned: operators.filter((operator) => !group(operator)).length,
    day: operators.filter((operator) => effectiveShift(operator) === 'DAY').length,
    night: operators.filter((operator) => effectiveShift(operator) === 'NIGHT').length,
    all: operators.length,
  };
  const rows = operators.filter((operator) => {
    const current = group(operator);
    if (filter === 'unassigned' && current) return false;
    if (filter === 'day' && effectiveShift(operator) !== 'DAY') return false;
    if (filter === 'night' && effectiveShift(operator) !== 'NIGHT') return false;
    return `${operator.full_name || ''} ${operator.snssb}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  const filters = [['unassigned', 'Unassigned'], ['day', 'Day Shift'], ['night', 'Night Shift'], ['all', 'All']];

  return <div>
    <label className="text-xs font-bold text-slate-600">Week of<input aria-label="Week of" type="date" value={weekContext?.week_start || ''} onChange={(e) => onWeekChange(e.target.value)} className="ml-2 h-11 rounded-lg border border-slate-300 px-2" /></label>
    <div className="mt-3 flex flex-wrap gap-2">{filters.map(([key, label]) => <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} className={`min-h-[44px] rounded-lg border px-3 text-xs font-extrabold ${filter === key ? 'border-cyan-600 bg-cyan-50 text-[#0077b6]' : 'border-slate-300 text-slate-600'}`}>{label} {counts[key]}</button>)}</div>
    <label className="relative mt-3 block"><Search size={15} className="absolute left-3 top-3.5 text-slate-400" /><span className="sr-only">Search operators</span><input aria-label="Search operators" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or serial number" className="h-11 w-full rounded-lg border border-slate-300 pl-10 pr-3 text-sm" /></label>
    <div className="mt-3 max-h-[32rem] divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 bg-white">
      {rows.length === 0 && <p className="p-4 text-xs font-semibold text-slate-500">No operators match this filter.</p>}
      {rows.map((operator) => {
        const current = group(operator);
        return <div key={operator.snssb} className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-extrabold text-slate-900">{operator.full_name}</p><p className="font-mono text-xs text-slate-400">{operator.snssb}</p></div>{operator.fixed_shift && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-extrabold text-amber-800">Fixed</span>}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" aria-label={`Assign ${operator.full_name} to Day Shift`} disabled={current === dayGroup} onClick={() => onAssign(operator.snssb, dayGroup)} className="min-h-[44px] rounded-lg border border-amber-300 px-3 text-xs font-bold text-amber-800 disabled:bg-amber-50">Assign to Day Shift</button>
            <button type="button" aria-label={`Assign ${operator.full_name} to Night Shift`} disabled={current === nightGroup} onClick={() => onAssign(operator.snssb, nightGroup)} className="min-h-[44px] rounded-lg border border-indigo-300 px-3 text-xs font-bold text-indigo-800 disabled:bg-indigo-50">Assign to Night Shift</button>
          </div>
          <div className="mt-2 inline-flex max-w-full flex-wrap rounded-lg bg-slate-100 p-1">{SEGMENTS.map(([value, label]) => <button key={label} type="button" aria-label={`${operator.full_name}: ${label}`} aria-pressed={(operator.fixed_shift || '') === value} disabled={!current} onClick={() => onFixedShift(operator.snssb, value)} className={`min-h-[44px] rounded-md px-2 text-xs font-bold disabled:opacity-40 ${(operator.fixed_shift || '') === value ? 'bg-white text-[#0077b6] shadow-sm' : 'text-slate-600'}`}>{label}</button>)}</div>
        </div>;
      })}
    </div>
  </div>;
}
