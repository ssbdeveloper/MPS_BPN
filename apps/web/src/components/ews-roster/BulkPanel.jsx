import React, { useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { STATUS_OPTIONS, todayLocalISO } from './rosterConstants';

// Kelas label dipakai berulang di panel ini; didefinisikan sekali agar tidak duplikat.
const LABEL = 'mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500';
const LABEL_TOP = 'block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1';
const FIELD_INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]';

// Panel override heatmap. State di sini lokal pada panel (pilihan override + status kirim);
// selection cell tetap milik halaman lewat props selectedKeys.
export default function BulkPanel({ selectedKeys, rowsByKey, onClose, onApply, onDeleteDay, onClear }) {
  const [status, setStatus] = useState('');
  const [half, setHalf] = useState('');
  const [shift, setShift] = useState('');
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const single = selectedKeys.length === 1 ? rowsByKey[selectedKeys[0]] : null;

  const doApply = async () => {
    if (!status && half === '' && shift === '' && hours === '') return;
    const cells = selectedKeys.map((key) => {
      const [serialnumber, business_date] = key.split('|');
      return { serialnumber, business_date };
    });
    setBusy(true);
    try {
      await onApply({
        cells,
        status: status || undefined,
        half_day: half === '' ? undefined : half === 'half',
        shift_override: shift === '' ? undefined : shift === 'ROTATION' ? null : shift,
        standard_hours_override: hours === '' ? undefined : hours === 'DEFAULT' ? null : Number(hours),
      });
      setStatus('');
      setHalf('');
      setShift('');
      setHours('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col border-l border-slate-300 bg-white md:w-80">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-extrabold text-slate-900">
          {single ? 'Operator detail' : `${selectedKeys.length} selected`}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={onClear} className="min-h-[44px] rounded-lg px-2 text-xs font-bold text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]" title="Clear selection">Clear</button>
          <button onClick={onClose} aria-label="Tutup panel" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"><X size={15} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {single ? (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-extrabold text-slate-800">{single.operator_name || single.serialnumber}</div>
              <div className="font-mono text-xs text-slate-400">{single.serialnumber} · {single.business_date}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs font-extrabold ${single.scheduled_shift === 'DAY' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>
                {single.scheduled_shift}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-extrabold text-slate-600">{single.attendance}</span>
              {single.half_day && <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-extrabold text-amber-700">½ half day</span>}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Hours <b className="tabular-nums">{Number(single.recorded_hours || 0).toFixed(1)}</b> / <b className="tabular-nums">{Number(single.scheduled_standard_hours || 0).toFixed(0)}h</b> required
            </div>
            <div>
              <label className={LABEL_TOP}>Status</label>
              <select
                value={single.status}
                onChange={(e) => onApply({ serialnumbers: [single.serialnumber], business_dates: [single.business_date], status: e.target.value })}
                className={FIELD_INPUT}
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_TOP}>Half day</label>
              <button
                type="button"
                onClick={() => onApply({ serialnumbers: [single.serialnumber], business_dates: [single.business_date], half_day: !single.half_day })}
                className={`relative inline-flex h-6 w-10 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-[#00b4d8]/30 ${single.half_day ? 'border-amber-500 bg-amber-400' : 'border-slate-400 bg-slate-200'}`}
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${single.half_day ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <p className="mt-1 text-xs text-slate-400">Required hours are halved.</p>
            </div>
            {single.business_date >= todayLocalISO() && (
              <div className="space-y-3 border-t border-slate-100 pt-3">
                <div>
                  <label className={LABEL}>Shift for this day</label>
                  <select
                    value={single.shift_override || ''}
                    onChange={(e) => onApply({ cells: [{ serialnumber: single.serialnumber, business_date: single.business_date }], shift_override: e.target.value || null })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800"
                  >
                    <option value="">Scheduled ({single.scheduled_shift})</option>
                    <option value="DAY">DAY</option>
                    <option value="NIGHT">NIGHT</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Exact target hours</label>
                  <div className="flex gap-2">
                    <input
                      type="number" min="0.01" max="24" step="0.25"
                      defaultValue={single.standard_hours_override ?? ''}
                      placeholder={`${Number(single.scheduled_standard_hours || 0)}h default`}
                      onBlur={(e) => e.target.value && onApply({ cells: [{ serialnumber: single.serialnumber, business_date: single.business_date }], standard_hours_override: Number(e.target.value) })}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800"
                    />
                    <button type="button" onClick={() => onApply({ cells: [{ serialnumber: single.serialnumber, business_date: single.business_date }], standard_hours_override: null })} className="rounded-lg border border-slate-300 px-2 text-xs font-bold text-slate-600">Default</button>
                  </div>
                </div>
              </div>
            )}
            {single.business_date >= todayLocalISO() && (
              <div className="border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmDelete) { setConfirmDelete(true); return; }
                    onDeleteDay(single.business_date);
                  }}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-extrabold transition active:scale-95 ${confirmDelete ? 'border-red-600 bg-red-600 text-white' : 'border-red-200 bg-white text-red-600 hover:bg-red-50'}`}
                >
                  <Trash2 size={13} />
                  {confirmDelete ? 'Confirm delete this day?' : 'Delete this day'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-[#90e0ef] bg-[#caf0f8]/60 px-3 py-2 text-xs text-slate-700">
              Apply status or half-day to all {selectedKeys.length} selected cells.
            </div>
            <div>
              <label className={LABEL_TOP}>Apply status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={FIELD_INPUT}>
                <option value="">No change</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_TOP}>Half day</label>
              <select value={half} onChange={(e) => setHalf(e.target.value)} className={FIELD_INPUT}>
                <option value="">No change</option>
                <option value="half">Set half day</option>
                <option value="full">Set full day</option>
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="bulk-shift">Shift override</label>
              <select id="bulk-shift" aria-label="Shift override" value={shift} onChange={(e) => setShift(e.target.value)} className={FIELD_INPUT}>
                <option value="">No change</option>
                <option value="ROTATION">Use scheduled shift</option>
                <option value="DAY">Always DAY for selected dates</option>
                <option value="NIGHT">Always NIGHT for selected dates</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Target hours override</label>
              <input type="number" aria-label="Target hours override" min="0.01" max="24" step="0.25" value={hours === 'DEFAULT' ? '' : hours} onChange={(e) => setHours(e.target.value)} placeholder="No change" className={FIELD_INPUT} />
              <button type="button" onClick={() => setHours('DEFAULT')} className="mt-1 text-xs font-bold text-[#0077b6]">Use shift default</button>
            </div>
            <button
              type="button"
              onClick={doApply}
              disabled={busy || (!status && half === '' && shift === '' && hours === '')}
              className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-[#0077b6] px-3 text-xs font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              Apply to {selectedKeys.length} cells
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
