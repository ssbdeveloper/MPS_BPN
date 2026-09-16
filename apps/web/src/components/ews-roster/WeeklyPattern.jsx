import React, { useState } from 'react';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATES = [
  { label: 'Both Shifts', runs_day: true, runs_night: true },
  { label: 'Day Only', runs_day: true, runs_night: false },
  { label: 'Night Only', runs_day: false, runs_night: true },
  { label: 'Off', runs_day: false, runs_night: false },
];
const stateOf = (rule) => STATES.findIndex((state) => state.runs_day === Boolean(rule.runs_day) && state.runs_night === Boolean(rule.runs_night));
const normalized = (rules) => Array.from({ length: 7 }, (_, day_of_week) => rules.find((rule) => Number(rule.day_of_week) === day_of_week) || { day_of_week, runs_day: false, runs_night: false });

export default function WeeklyPattern({ rules, onSave, busy }) {
  const initial = normalized(rules || []);
  const [draft, setDraft] = useState(() => initial);
  const [confirming, setConfirming] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const cycle = (day) => setDraft((current) => current.map((rule) => rule.day_of_week === day ? { day_of_week: day, ...STATES[(stateOf(rule) + 1) % STATES.length] } : rule));
  const save = () => { onSave(draft); setConfirming(false); };

  return <div>
    <h3 className="text-sm font-extrabold text-slate-900">Weekly Pattern</h3>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {draft.map((rule) => {
        const state = STATES[stateOf(rule)];
        return <button key={rule.day_of_week} type="button" onClick={() => cycle(rule.day_of_week)} aria-label={`${DAYS[rule.day_of_week]}: ${state.label}`} className="min-h-[64px] rounded-xl border border-slate-300 bg-white px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
          <span className="block text-xs font-extrabold text-slate-800">{DAYS[rule.day_of_week].slice(0, 3)}</span>
          <span className="block text-xs font-semibold text-slate-500">{state.label}</span>
        </button>;
      })}
    </div>
    <button type="button" disabled={!dirty || busy} onClick={() => setConfirming(true)} className="mt-3 min-h-[44px] rounded-lg bg-[#0077b6] px-4 text-xs font-extrabold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:opacity-50">Save Weekly Pattern</button>
    {confirming && <div role="dialog" aria-label="Confirm weekly pattern" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs font-bold text-amber-900">This changes the recurring schedule.</p>
      <div className="mt-2 flex gap-2"><button type="button" onClick={save} className="min-h-[44px] rounded-lg bg-amber-700 px-3 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]">Confirm Save</button><button type="button" onClick={() => setConfirming(false)} className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]">Cancel</button></div>
    </div>}
  </div>;
}
