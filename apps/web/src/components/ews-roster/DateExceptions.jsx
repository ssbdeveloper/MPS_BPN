import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { todayLocalISO } from './rosterConstants';

const stateOf = (row) => row.runs_day ? (row.runs_night ? 'Both Shifts' : 'Day Only') : (row.runs_night ? 'Night Only' : 'Off');
const FIELD = 'mt-1 h-11 w-full rounded-lg border border-slate-300 px-2 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]';
const ACTION = 'min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]';

export default function DateExceptions({ exceptions, onAdd, onRemove, busy }) {
  const [range, setRange] = useState(false);
  const [form, setForm] = useState({ from: '', to: '', state: 'OFF', reason: '' });
  const submit = async (event) => {
    event.preventDefault();
    if (!form.from) return;
    await onAdd({ from: form.from, ...(range ? { to: form.to || form.from } : {}), state: form.state, reason: form.reason.trim() || null });
    setForm({ from: '', to: '', state: 'OFF', reason: '' });
  };
  return <div className="border-t border-slate-200 pt-4">
    <h3 className="text-sm font-extrabold text-slate-900">Date Exceptions</h3>
    <div className="mt-2 inline-flex rounded-lg bg-slate-100 p-1">
      <button type="button" onClick={() => setRange(false)} className={`${ACTION} rounded-md px-3 text-xs font-bold ${!range ? 'bg-white text-[#0077b6] shadow-sm' : 'text-slate-600'}`}>Single Date</button>
      <button type="button" onClick={() => setRange(true)} className={`${ACTION} rounded-md px-3 text-xs font-bold ${range ? 'bg-white text-[#0077b6] shadow-sm' : 'text-slate-600'}`}>Date Range</button>
    </div>
    <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      <label className="text-xs font-bold text-slate-600">Date<input aria-label="Date" required type="date" min={todayLocalISO()} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className={FIELD} /></label>
      {range && <label className="text-xs font-bold text-slate-600">End date<input aria-label="End date" type="date" min={form.from || todayLocalISO()} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className={FIELD} /></label>}
      <label className="text-xs font-bold text-slate-600">Schedule<select aria-label="Exception schedule" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className={FIELD}><option value="BOTH">Both Shifts</option><option value="DAY">Day Only</option><option value="NIGHT">Night Only</option><option value="OFF">Off</option></select></label>
      <label className="text-xs font-bold text-slate-600">Reason <span className="font-normal text-slate-400">Optional</span><input aria-label="Reason" maxLength={120} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={FIELD} /></label>
      <button type="submit" disabled={busy || !form.from} className={`${ACTION} self-end rounded-lg bg-[#0077b6] px-4 text-xs font-extrabold text-white disabled:opacity-50`}>Add Exception</button>
    </form>
    <ul className="mt-3 divide-y divide-slate-200">
      {(exceptions || []).map((row) => <li key={row.business_date} className="flex min-h-[52px] items-center gap-3 py-2 text-xs"><span className="font-mono font-bold text-slate-700">{row.business_date}</span><span className="font-bold text-slate-600">{stateOf(row)}</span><span className="min-w-0 flex-1 truncate text-slate-500">{row.reason}</span><button type="button" aria-label={`Remove exception for ${row.business_date}`} onClick={() => onRemove(row.business_date)} className={`${ACTION} inline-flex min-w-[44px] items-center justify-center rounded-lg text-red-600`}><Trash2 size={15} /></button></li>)}
    </ul>
  </div>;
}
