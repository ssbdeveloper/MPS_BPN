import React, { useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { STATUS_OPTIONS, todayLocalISO } from './rosterConstants';

// Shared control styles.
const LABEL = 'mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500';
const LABEL_TOP = 'block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1';
const FIELD_INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]';
const NOTE = 'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600';


function ShiftSection({ count, scheduledLabel, currentValue, onPick, disabled }) {
  const scope = count === 1 ? 'this day' : `${count} selected days`;
  return (
    <div>
      <label className={LABEL} htmlFor="cell-shift">Change Shift for {scope}</label>
      <select
        id="cell-shift"
        aria-label="Change Shift"
        value={currentValue}
        disabled={disabled}
        onChange={(e) => onPick(e.target.value)}
        className={FIELD_INPUT}
      >
        <option value="">Follow Schedule{scheduledLabel ? ` (${scheduledLabel})` : ''}</option>
        <option value="DAY">Day Shift</option>
        <option value="NIGHT">Night Shift</option>
      </select>
    </div>
  );
}


// Halaman menyimpan rowsByKey sebagai Map (lookup O(1) untuk ribuan sel), sementara test
// dan pemanggil lain memakai object biasa. Baca lewat satu helper supaya detail operator
// tidak pernah hilang hanya karena bentuk containernya berbeda.
function lookupRow(rowsByKey, key) {
  if (!rowsByKey || !key) return null;
  if (typeof rowsByKey.get === 'function') return rowsByKey.get(key) || null;
  return rowsByKey[key] || null;
}

export default function BulkPanel({ selectedKeys, rowsByKey, operatorNames, onClose, onApply, onDeleteDay, onClear }) {
  const [status, setStatus] = useState('');
  const [half, setHalf] = useState('');
  const [shift, setShift] = useState('');
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const single = selectedKeys.length === 1 ? lookupRow(rowsByKey, selectedKeys[0]) : null;

  const cellsOf = (keys) => keys.map((key) => {
    const [serialnumber, business_date] = key.split('|');
    return { serialnumber, business_date };
  });
  const today = todayLocalISO();
  const dates = selectedKeys.map((k) => k.split('|')[1]);
  const pastCount = dates.filter((d) => d < today).length;
  const editable = pastCount === 0;

  const doApply = async () => {
    if (!status && half === '' && shift === '' && hours === '') return;
    setBusy(true);
    try {
      await onApply({
        cells: cellsOf(selectedKeys),
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
  const applyShiftNow = (value) => {
    if (!single) { setShift(value); return; }
    onApply({
      cells: [{ serialnumber: single.serialnumber, business_date: single.business_date }],
      shift_override: value || null,
    });
  };

  return (
    <div className="flex w-full flex-col border-l border-slate-300 bg-white md:w-80">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-extrabold text-slate-900">
          {single ? 'Operator Details' : `${selectedKeys.length} cells selected`}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={onClear} className="min-h-[44px] rounded-lg px-2 text-xs font-bold text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]" title="Clear selection">Clear</button>
          <button onClick={onClose} aria-label="Close panel" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"><X size={15} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!editable && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            {pastCount === selectedKeys.length
              ? 'Past dates are locked.'
              : `${pastCount} of ${selectedKeys.length} cells are in the past. Select today or a future date.`}
          </div>
        )}

        {single ? (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-extrabold text-slate-800">
                {single.operator_name
                  || (operatorNames && operatorNames.get(single.serialnumber))
                  || single.serialnumber}
              </div>
              <div className="font-mono text-xs text-slate-400">{single.serialnumber} · {single.business_date}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs font-extrabold ${single.scheduled_shift === 'DAY' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>
                {single.scheduled_shift}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-extrabold text-slate-600">{single.attendance}</span>
              {single.half_day && <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-extrabold text-amber-700">½ Half Day</span>}
              {single.shift_override && <span className="rounded-full border border-[#0077b6] bg-[#caf0f8] px-2 py-0.5 text-xs font-extrabold text-[#023e8a]">Changed</span>}
            </div>
            <div className={NOTE}>
              Hours <b className="tabular-nums">{Number(single.recorded_hours || 0).toFixed(1)}</b> / <b className="tabular-nums">{Number(single.scheduled_standard_hours || 0).toFixed(0)}h</b> target
            </div>
            <div>
              <label className={LABEL_TOP}>Status</label>
              <select
                value={single.status}
                disabled={!editable}
                onChange={(e) => onApply({ cells: [{ serialnumber: single.serialnumber, business_date: single.business_date }], status: e.target.value })}
                className={FIELD_INPUT}
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_TOP}>Half Day</label>
              <button
                type="button"
                disabled={!editable}
                onClick={() => onApply({ cells: [{ serialnumber: single.serialnumber, business_date: single.business_date }], half_day: !single.half_day })}
                className={`relative inline-flex h-6 w-10 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-[#00b4d8]/30 disabled:opacity-50 ${single.half_day ? 'border-amber-500 bg-amber-400' : 'border-slate-400 bg-slate-200'}`}
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${single.half_day ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>

            </div>
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <ShiftSection
                count={1}
                scheduledLabel={single.scheduled_shift}
                currentValue={single.shift_override || ''}
                onPick={applyShiftNow}
                disabled={!editable}
              />
              <div>
                <label className={LABEL}>Target Hours</label>
                <div className="flex gap-2">
                  <input
                    type="number" min="0.01" max="24" step="0.25"
                    aria-label="Target Hours"
                    disabled={!editable}
                    defaultValue={single.standard_hours_override ?? ''}
                    placeholder={`${Number(single.scheduled_standard_hours || 0)}h (shift default)`}
                    onBlur={(e) => e.target.value && onApply({ cells: [{ serialnumber: single.serialnumber, business_date: single.business_date }], standard_hours_override: Number(e.target.value) })}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800 disabled:opacity-50"
                  />
                  <button type="button" disabled={!editable} onClick={() => onApply({ cells: [{ serialnumber: single.serialnumber, business_date: single.business_date }], standard_hours_override: null })} className="min-h-[44px] rounded-lg border border-slate-300 px-2 text-xs font-bold text-slate-600 disabled:opacity-50">Shift Default</button>
                </div>
              </div>
            </div>
            {editable && (
              <div className="border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmDelete) { setConfirmDelete(true); return; }
                    onDeleteDay(single.business_date);
                  }}
                  className={`flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-extrabold transition active:scale-95 ${confirmDelete ? 'border-red-600 bg-red-600 text-white' : 'border-red-200 bg-white text-red-600 hover:bg-red-50'}`}
                >
                  <Trash2 size={13} />
                  {confirmDelete ? 'Confirm Delete Day' : 'Delete Day'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">

            <div>
              <label className={LABEL_TOP}>Status</label>
              <select value={status} disabled={!editable} onChange={(e) => setStatus(e.target.value)} className={FIELD_INPUT}>
                <option value="">No Change</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_TOP}>Half Day</label>
              <select value={half} disabled={!editable} onChange={(e) => setHalf(e.target.value)} className={FIELD_INPUT}>
                <option value="">No Change</option>
                <option value="half">Set Half Day</option>
                <option value="full">Set Full Day</option>
              </select>
            </div>
            <ShiftSection
              count={selectedKeys.length}
              scheduledLabel=""
              currentValue={shift}
              onPick={setShift}
              disabled={!editable}
            />
            <div>
              <label className={LABEL}>Target Hours</label>
              <input type="number" aria-label="Target Hours" min="0.01" max="24" step="0.25" disabled={!editable} value={hours === 'DEFAULT' ? '' : hours} onChange={(e) => setHours(e.target.value)} placeholder="No Change" className={FIELD_INPUT} />
              <button type="button" disabled={!editable} onClick={() => setHours('DEFAULT')} className="mt-1 min-h-[44px] text-xs font-bold text-[#0077b6] disabled:opacity-50">Use Shift Default</button>
            </div>
            <button
              type="button"
              onClick={doApply}
              disabled={busy || !editable || (!status && half === '' && shift === '' && hours === '')}
              className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-[#0077b6] px-3 text-xs font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              Apply to {selectedKeys.length} Cells
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
