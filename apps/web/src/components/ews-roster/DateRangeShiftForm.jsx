import React, { useState } from 'react';
import { AlertCircle, Calendar, Check, Plus } from 'lucide-react';
import TodayImpactDialog from './TodayImpactDialog';
import DateRangeShiftRow from './DateRangeShiftRow';
import UpcomingOverridesList from './UpcomingOverridesList';

const clock = (val) => String(val || '').slice(0, 5);

export default function DateRangeShiftForm({
  plantToday, defaultShifts, upcomingOverrides, onApplyOverride, onDeleteOverride, onPreviewOverride, busy,
}) {
  const [from, setFrom] = useState(plantToday || new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(plantToday || new Date().toISOString().slice(0, 10));
  const [includeDay, setIncludeDay] = useState(true);
  const [includeNight, setIncludeNight] = useState(false);

  const defaultDay = (defaultShifts || []).find((s) => s.shift_code === 'DAY') || {
    start_time: '07:25:00', end_time: '16:30:00', crosses_midnight: false, standard_hours: 8,
  };
  const defaultNight = (defaultShifts || []).find((s) => s.shift_code === 'NIGHT') || {
    start_time: '16:30:00', end_time: '00:30:00', crosses_midnight: true, standard_hours: 7,
  };

  const [dayDraft, setDayDraft] = useState({
    start_time: clock(defaultDay.start_time), end_time: clock(defaultDay.end_time),
    crosses_midnight: Boolean(defaultDay.crosses_midnight), standard_hours: Number(defaultDay.standard_hours) || 8,
  });
  const [nightDraft, setNightDraft] = useState({
    start_time: clock(defaultNight.start_time), end_time: clock(defaultNight.end_time),
    crosses_midnight: Boolean(defaultNight.crosses_midnight), standard_hours: Number(defaultNight.standard_hours) || 7,
  });

  const [previewResult, setPreviewResult] = useState(null);
  const [blockingError, setBlockingError] = useState(null);
  const [showTodayDialog, setShowTodayDialog] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const buildPayload = () => ({
    from, to,
    shifts: [
      includeDay && { shift_code: 'DAY', start_time: dayDraft.start_time, end_time: dayDraft.end_time, crosses_midnight: dayDraft.crosses_midnight, standard_hours: Number(dayDraft.standard_hours) },
      includeNight && { shift_code: 'NIGHT', start_time: nightDraft.start_time, end_time: nightDraft.end_time, crosses_midnight: nightDraft.crosses_midnight, standard_hours: Number(nightDraft.standard_hours) },
    ].filter(Boolean),
  });

  const handlePreview = async (e) => {
    e?.preventDefault();
    setBlockingError(null); setSuccessMsg(''); setPreviewResult(null);
    if (!includeDay && !includeNight) return setBlockingError('Pilih minimal satu shift (DAY atau NIGHT)');
    try {
      const payload = buildPayload();
      const data = await onPreviewOverride(payload);
      setPreviewResult(data);
      if (data.blocking?.length > 0) return setBlockingError({ title: 'Perubahan diblokir oleh dependensi SOW', counts: data.blocking[0].counts });
      if (data.affects_today) setShowTodayDialog(true);
      else {
        await onApplyOverride(payload);
        setSuccessMsg(`Berhasil menerapkan jadwal khusus untuk rentang ${from} s.d. ${to}`);
      }
    } catch (err) { setBlockingError(err.message || 'Gagal memproses pratinjau'); }
  };

  const handleConfirmToday = async (todayConfirmation) => {
    try {
      await onApplyOverride({ ...buildPayload(), ...todayConfirmation });
      setShowTodayDialog(false);
      setSuccessMsg(`Berhasil menerapkan jadwal khusus termasuk hari ini (${plantToday})`);
    } catch (err) {
      setShowTodayDialog(false);
      setBlockingError(err.message || 'Gagal menyimpan perubahan');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-slate-300 bg-white p-4">
        <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-700">
          <Calendar size={15} className="text-[#0077b6]" />
          Atur Jam Khusus Rentang Tanggal
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Berlaku 1 s.d. 62 hari. Menghormati integritas kapasitas SOW dan absensi.
        </p>

        {successMsg && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
            <Check size={16} /> {successMsg}
          </div>
        )}

        {blockingError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <div className="flex items-center gap-1.5 font-bold text-red-900">
              <AlertCircle size={15} />
              <span>{typeof blockingError === 'string' ? blockingError : blockingError.title}</span>
            </div>
            {blockingError.counts && (
              <ul className="mt-2 list-disc pl-5 font-semibold text-red-700">
                {Object.entries(blockingError.counts).map(([k, v]) => Number(v) > 0 && (
                  <li key={k}>{k}: {v} referensi aktif</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <form onSubmit={handlePreview} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="override-from" className="block text-xs font-bold text-slate-700">Mulai (From)</label>
              <input
                id="override-from" type="date" value={from} min={plantToday} onChange={(e) => setFrom(e.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-800 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
              />
            </div>
            <div>
              <label htmlFor="override-to" className="block text-xs font-bold text-slate-700">Selesai (To)</label>
              <input
                id="override-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-800 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
              />
            </div>
          </div>

          <div className="space-y-3">
            <DateRangeShiftRow
              code="DAY" label="Shift DAY (Siang)" defaultShift={defaultDay} included={includeDay}
              onToggle={setIncludeDay} draft={dayDraft} onChange={(p) => setDayDraft((d) => ({ ...d, ...p }))}
            />
            <DateRangeShiftRow
              code="NIGHT" label="Shift NIGHT (Malam)" defaultShift={defaultNight} included={includeNight}
              onToggle={setIncludeNight} draft={nightDraft} onChange={(p) => setNightDraft((d) => ({ ...d, ...p }))}
            />
          </div>

          <button
            type="submit" disabled={busy || (!includeDay && !includeNight)}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#0077b6] px-4 text-xs font-extrabold text-white shadow-xs hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} />
            {busy ? 'Memproses...' : 'Terapkan Jam Khusus'}
          </button>
        </form>
      </div>

      <UpcomingOverridesList upcomingOverrides={upcomingOverrides} plantToday={plantToday} onDeleteOverride={onDeleteOverride} busy={busy} />
      <TodayImpactDialog isOpen={showTodayDialog} onClose={() => setShowTodayDialog(false)} onConfirm={handleConfirmToday} previewData={previewResult} busy={busy} />
    </div>
  );
}
