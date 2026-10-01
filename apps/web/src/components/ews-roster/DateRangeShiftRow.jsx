import React from 'react';

const clock = (val) => String(val || '').slice(0, 5);
const LABEL_CLS = 'block text-xs font-bold text-slate-600';
const INPUT_CLS = 'mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold tabular-nums text-slate-800 focus:border-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]';

export default function DateRangeShiftRow({
  code,
  label,
  defaultShift,
  included,
  onToggle,
  draft,
  onChange,
}) {
  const isDay = code === 'DAY';
  const cardBorder = included
    ? isDay ? 'border-amber-300 bg-amber-50/40' : 'border-indigo-300 bg-indigo-50/40'
    : 'border-slate-200 bg-slate-50/60';

  return (
    <div className={`rounded-xl border p-3.5 transition-colors ${cardBorder}`}>
      <label className="flex min-h-[44px] cursor-pointer items-center justify-between text-xs font-bold text-slate-800">
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={included}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#0077b6] focus:ring-[#00b4d8]"
          />
          <span>{label}</span>
        </span>
        <span className="text-xs font-medium tabular-nums text-slate-500">
          Default: {clock(defaultShift?.start_time)}-{clock(defaultShift?.end_time)} ({Number(defaultShift?.standard_hours || 8)}h)
        </span>
      </label>

      {included && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-200/70 pt-3 md:grid-cols-4">
          <div>
            <label className={LABEL_CLS}>Start Time</label>
            <input
              type="time"
              value={draft.start_time}
              onChange={(e) => onChange({ start_time: e.target.value })}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>End Time</label>
            <input
              type="time"
              value={draft.end_time}
              onChange={(e) => onChange({ end_time: e.target.value })}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Net Working Hours</label>
            <input
              type="number"
              step="0.25"
              min="0.5"
              max="24"
              value={draft.standard_hours}
              onChange={(e) => onChange({ standard_hours: Number(e.target.value) })}
              className={INPUT_CLS}
            />
          </div>
          <label className="flex items-center gap-2 pt-6 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={draft.crosses_midnight}
              onChange={(e) => onChange({ crosses_midnight: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-[#0077b6] focus:ring-[#00b4d8]"
            />
            <span>Ends Next Day</span>
          </label>
        </div>
      )}
    </div>
  );
}
