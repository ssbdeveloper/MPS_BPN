import React from 'react';
import { Plus } from 'lucide-react';
import DateRangeShiftRow from './DateRangeShiftRow';

export default function DateRangeShiftFormInputs({
  from,
  to,
  plantToday,
  onFromChange,
  onToChange,
  includeDay,
  includeNight,
  onToggleDay,
  onToggleNight,
  defaultDay,
  defaultNight,
  dayDraft,
  nightDraft,
  onDayDraftChange,
  onNightDraftChange,
  onSubmit,
  busy,
}) {
  const canSubmit = !busy && (includeDay || includeNight);

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="override-from" className="block text-xs font-bold text-slate-700">Start Date (From)</label>
          <input
            id="override-from"
            type="date"
            value={from}
            min={plantToday}
            onChange={(e) => onFromChange(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-xs font-semibold tabular-nums text-slate-800 focus:border-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          />
        </div>
        <div>
          <label htmlFor="override-to" className="block text-xs font-bold text-slate-700">End Date (To)</label>
          <input
            id="override-to"
            type="date"
            value={to}
            min={from || plantToday}
            onChange={(e) => onToChange(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-xs font-semibold tabular-nums text-slate-800 focus:border-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          />
        </div>
      </div>

      <div className="space-y-3">
        <DateRangeShiftRow
          code="DAY"
          label="DAY Shift (Daytime)"
          defaultShift={defaultDay}
          included={includeDay}
          onToggle={onToggleDay}
          draft={dayDraft}
          onChange={onDayDraftChange}
        />
        <DateRangeShiftRow
          code="NIGHT"
          label="NIGHT Shift (Overnight)"
          defaultShift={defaultNight}
          included={includeNight}
          onToggle={onToggleNight}
          draft={nightDraft}
          onChange={onNightDraftChange}
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#0077b6] px-4 text-xs font-extrabold text-white shadow-xs transition-all hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={15} />
        {busy ? 'Processing...' : 'Apply Temporary Hours'}
      </button>
    </form>
  );
}
