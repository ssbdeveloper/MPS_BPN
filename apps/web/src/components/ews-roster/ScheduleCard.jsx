import React, { useState } from 'react';
import { CalendarRange, Info, Loader2 } from 'lucide-react';
import WeeklyPattern from './WeeklyPattern';
import DateExceptions from './DateExceptions';
import { todayLocalISO } from './rosterConstants';

const count = (result, key) => Number(result?.[key] ?? result?.[key.replace('rows_', '')] ?? 0);
const DATE_INPUT = 'ml-2 h-11 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold tabular-nums text-slate-800 focus:border-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]';
const ACTION = 'min-h-[44px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95';

export default function ScheduleCard({ rules, exceptions, onSavePattern, onAddException, onRemoveException, onPreview, onApply, busy }) {
  const [range, setRange] = useState({ from: todayLocalISO(), to: todayLocalISO() });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  const changeRange = (field, value) => {
    setRange((current) => ({ ...current, [field]: value }));
    setPreview(null);
  };

  const runPreview = async () => {
    setLoading(true);
    try { setPreview(await onPreview(range)); }
    finally { setLoading(false); }
  };

  const apply = async () => {
    await onApply(range);
    setPreview(null);
  };

  const stats = [
    ['Rows to add', 'rows_added'], ['Rows to update', 'rows_updated'],
    ['Rows to remove', 'rows_removed'], ['Protected rows', 'rows_protected'],
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2.5 text-[11px] text-slate-600">
        <Info size={14} className="mt-0.5 shrink-0 text-[#0077b6]" />
        <span>Work Calendar determines which calendar days and shifts operate across the plant.</span>
      </div>

      <WeeklyPattern key={JSON.stringify(rules)} rules={rules} onSave={onSavePattern} busy={busy} />
      <DateExceptions exceptions={exceptions} onAdd={onAddException} onRemove={onRemoveException} busy={busy} />

      <div className="border-t border-slate-200 pt-4">
        <div className="flex items-center gap-1.5">
          <CalendarRange size={16} className="text-[#0077b6]" />
          <h3 className="text-sm font-extrabold text-slate-900">Roster Generation Range</h3>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Generate or refresh scheduled roster shifts across the selected operational date window.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2.5">
          <label className="text-xs font-bold text-slate-700">
            From
            <input aria-label="From" type="date" value={range.from} onChange={(e) => changeRange('from', e.target.value)} className={DATE_INPUT} />
          </label>
          <label className="text-xs font-bold text-slate-700">
            To
            <input aria-label="To" type="date" min={range.from} value={range.to} onChange={(e) => changeRange('to', e.target.value)} className={DATE_INPUT} />
          </label>
          <button
            type="button"
            disabled={loading || busy}
            onClick={runPreview}
            className={`${ACTION} inline-flex items-center gap-1.5 rounded-lg border border-[#0077b6] bg-white px-4 text-xs font-extrabold text-[#0077b6] hover:bg-slate-50 disabled:opacity-50`}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Preview Changes
          </button>
          <button
            type="button"
            disabled={!preview || busy}
            onClick={apply}
            className={`${ACTION} rounded-lg bg-[#0077b6] px-4 text-xs font-extrabold text-white shadow-2xs hover:bg-[#023e8a] disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Apply Schedule
          </button>
        </div>

        {preview && (
          <div className="mt-3.5 space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stats.map(([label, key]) => (
                <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="block text-lg font-black tabular-nums text-slate-900">{count(preview, key)}</span>
                  <span className="text-[11px] font-semibold text-slate-500">{label}</span>
                </div>
              ))}
            </div>
            {count(preview, 'rows_protected') > 0 && (
              <p className="text-xs font-bold text-amber-700">
                {count(preview, 'rows_protected')} protected row{count(preview, 'rows_protected') === 1 ? '' : 's'} will not change.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
