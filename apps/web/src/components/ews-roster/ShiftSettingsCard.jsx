import React, { useState } from 'react';
import { AlertTriangle, Clock3, Moon, RefreshCw, Save, Sun } from 'lucide-react';

const clock = (value) => String(value || '').slice(0, 5);

const FIELD = 'flex flex-col gap-1 text-xs font-bold text-slate-600';
const INPUT = 'h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold tabular-nums text-slate-800 focus:border-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]';

export default function ShiftSettingsCard({
  shifts = [],
  todayShiftSource = null,
  impact = null,
  onSave,
  onPreview,
  onResync,
  busy = false,
}) {
  const [drafts, setDrafts] = useState({});

  const update = (code, field, val) => {
    setDrafts((prev) => ({
      ...prev,
      [code]: { ...prev[code], [field]: val },
    }));
  };

  const isChanged = (code, field, orig) => {
    const d = drafts[code];
    if (!d || d[field] === undefined) return false;
    return d[field] !== orig;
  };

  const handleSave = (code) => {
    const d = drafts[code];
    if (!d) return;
    const patch = {};
    if (d.start_time !== undefined) patch.start_time = d.start_time;
    if (d.end_time !== undefined) patch.end_time = d.end_time;
    if (d.standard_hours !== undefined) patch.standard_hours = d.standard_hours;
    if (d.crosses_midnight !== undefined) patch.crosses_midnight = d.crosses_midnight;
    onSave?.(code, patch);
  };

  const hasDraft = (code) => {
    const d = drafts[code];
    return d && Object.keys(d).length > 0;
  };

  const isTodayTemporary = todayShiftSource === 'override' || todayShiftSource === 'temporary';

  return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-xs text-slate-600">
        <p className="font-semibold text-slate-800">
          Default hours serve as the permanent baseline for shop-floor scheduling.
        </p>
        <p className="mt-0.5 text-slate-500">
          Temporary hours (configured below) will override this default window for specified dates.
        </p>
      </div>

      {isTodayTemporary && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle size={15} className="shrink-0 text-amber-600" />
          <span>
            <strong>Notice:</strong> Today&apos;s shift uses temporary hours override. Default values apply once the temporary window concludes.
          </span>
        </div>
      )}

      {shifts.map((s) => {
        const d = drafts[s.shift_code] || {};
        const st = d.start_time !== undefined ? d.start_time : clock(s.start_time);
        const et = d.end_time !== undefined ? d.end_time : clock(s.end_time);
        const sh = d.standard_hours !== undefined ? d.standard_hours : (s.standard_hours ?? '');
        const cm = d.crosses_midnight !== undefined ? d.crosses_midnight : Boolean(s.crosses_midnight);
        const changed = hasDraft(s.shift_code);

        return (
          <div
            key={s.shift_code}
            className="rounded-xl border border-slate-200 bg-white p-3.5 transition-shadow hover:shadow-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-extrabold ${
                    s.shift_code === 'DAY'
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-indigo-300 bg-indigo-50 text-indigo-800'
                  }`}
                >
                  {s.shift_code === 'DAY' ? <Sun size={13} /> : <Moon size={13} />}
                  {s.shift_code} Shift
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {s.shift_name} ({s.sow_shift_code})
                </span>
              </div>
              <button
                type="button"
                disabled={!changed || busy}
                onClick={() => handleSave(s.shift_code)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-4 text-xs font-extrabold text-white transition-all hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={14} /> Save
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <label className={FIELD}>
                Start Time
                <input
                  type="time"
                  value={st}
                  onChange={(e) => update(s.shift_code, 'start_time', e.target.value)}
                  className={`${INPUT} ${isChanged(s.shift_code, 'start_time', clock(s.start_time)) ? 'border-amber-400 bg-amber-50/40' : ''}`}
                />
              </label>
              <label className={FIELD}>
                End Time
                <input
                  type="time"
                  value={et}
                  onChange={(e) => update(s.shift_code, 'end_time', e.target.value)}
                  className={`${INPUT} ${isChanged(s.shift_code, 'end_time', clock(s.end_time)) ? 'border-amber-400 bg-amber-50/40' : ''}`}
                />
              </label>
              <label className={FIELD}>
                Net Working Hours
                <input
                  type="number"
                  aria-label="Net Working Hours"
                  step="0.25"
                  min="0.25"
                  max="24"
                  value={sh}
                  onChange={(e) => update(s.shift_code, 'standard_hours', e.target.value)}
                  className={`${INPUT} ${isChanged(s.shift_code, 'standard_hours', s.standard_hours) ? 'border-amber-400 bg-amber-50/40' : ''}`}
                />
                <span className="text-[11px] font-normal text-slate-500">Target net working time</span>
              </label>
              <label className="flex items-center gap-2 pt-5 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={cm}
                  onChange={(e) => update(s.shift_code, 'crosses_midnight', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-400 text-[#0077b6] focus:ring-[#00b4d8]"
                />
                Ends Next Day
              </label>
            </div>
          </div>
        );
      })}

      <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-extrabold text-slate-800">Advanced: Synchronize Future Roster Entries</h4>
            <p className="mt-0.5 text-xs text-slate-500">
              Push updated default hours to generated upcoming roster rows. Requires saved default changes.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => onPreview?.()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:opacity-50"
          >
            <Clock3 size={14} /> Preview Sync Impact
          </button>
        </div>

        {impact && (
          <div className="mt-3 border-t border-slate-200 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                {impact.differing_rows ?? 0} of {impact.future_rows ?? 0} future rows differ from defaults.
              </span>
              <button
                type="button"
                disabled={busy || !impact.resyncable_rows}
                onClick={() => onResync?.()}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-4 text-xs font-extrabold text-white transition-all hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
                Apply to {impact.resyncable_rows ?? 0} Rows
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
