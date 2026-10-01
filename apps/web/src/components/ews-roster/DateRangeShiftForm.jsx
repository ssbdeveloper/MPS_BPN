import React, { useEffect, useState } from 'react';
import { AlertCircle, Calendar, Check } from 'lucide-react';
import TodayImpactDialog from './TodayImpactDialog';
import UpcomingOverridesList from './UpcomingOverridesList';
import DateRangeShiftFormInputs from './DateRangeShiftFormInputs';
import { translateRosterError } from './rosterErrorUtils';
import { EMPTY_DELETE_DIALOG, STALE_REFRESHED_MSG, REFRESH_FAILED_MSG } from './rosterConstants';

const clock = (val) => String(val || '').slice(0, 5);
const isPreviewStale = (err) => err?.code === 'PREVIEW_STALE';

export default function DateRangeShiftForm({
  plantToday, defaultShifts, upcomingOverrides, onApplyOverride, onDeleteOverride, onPreviewOverride, onPreviewDeleteOverride, busy,
}) {
  const [isDirty, setIsDirty] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeDay, setIncludeDay] = useState(true);
  const [includeNight, setIncludeNight] = useState(false);
  const defaultDay = (defaultShifts || []).find((s) => s.shift_code === 'DAY');
  const defaultNight = (defaultShifts || []).find((s) => s.shift_code === 'NIGHT');
  const [dayDraft, setDayDraft] = useState({ start_time: '', end_time: '', crosses_midnight: false, standard_hours: 8 });
  const [nightDraft, setNightDraft] = useState({ start_time: '', end_time: '', crosses_midnight: true, standard_hours: 7 });

  useEffect(() => {
    if (!plantToday || !defaultShifts?.length || isDirty) return;
    setFrom(plantToday); setTo(plantToday);
    if (defaultDay) setDayDraft({ start_time: clock(defaultDay.start_time), end_time: clock(defaultDay.end_time), crosses_midnight: Boolean(defaultDay.crosses_midnight), standard_hours: Number(defaultDay.standard_hours) || 8 });
    if (defaultNight) setNightDraft({ start_time: clock(defaultNight.start_time), end_time: clock(defaultNight.end_time), crosses_midnight: Boolean(defaultNight.crosses_midnight), standard_hours: Number(defaultNight.standard_hours) || 7 });
  }, [plantToday, defaultShifts, isDirty, defaultDay, defaultNight]);

  const [previewResult, setPreviewResult] = useState(null);
  const [blockingError, setBlockingError] = useState(null);
  const [showTodayDialog, setShowTodayDialog] = useState(false);
  const [todayDialogError, setTodayDialogError] = useState(null);
  const [todayDialogStale, setTodayDialogStale] = useState(false);
  const [deleteDialogData, setDeleteDialogData] = useState(EMPTY_DELETE_DIALOG);
  const [successMsg, setSuccessMsg] = useState('');
  const [highlightId, setHighlightId] = useState(null);

  if (!plantToday || !defaultShifts?.length) {
    return (
      <div data-testid="date-range-loading" className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center gap-3 text-slate-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          <p className="text-xs font-semibold">Loading plant shift configuration...</p>
        </div>
      </div>
    );
  }

  const buildPayload = () => ({
    from, to,
    shifts: [
      includeDay && { shift_code: 'DAY', start_time: dayDraft.start_time, end_time: dayDraft.end_time, crosses_midnight: dayDraft.crosses_midnight, standard_hours: Number(dayDraft.standard_hours) },
      includeNight && { shift_code: 'NIGHT', start_time: nightDraft.start_time, end_time: nightDraft.end_time, crosses_midnight: nightDraft.crosses_midnight, standard_hours: Number(nightDraft.standard_hours) },
    ].filter(Boolean),
  });

  const handlePreview = async (e) => {
    e?.preventDefault();
    setBlockingError(null); setSuccessMsg(''); setPreviewResult(null); setTodayDialogError(null);
    if (!includeDay && !includeNight) return setBlockingError('Select at least one shift (DAY or NIGHT)');
    try {
      const payload = buildPayload();
      const data = await onPreviewOverride(payload);
      setPreviewResult(data);
      if (data.blocking?.length > 0) return setBlockingError({ title: 'Modifications blocked by active shop-floor dependencies', counts: data.blocking[0].counts });
      if (data.affects_today) setShowTodayDialog(true);
      else {
        const res = await onApplyOverride(payload);
        setIsDirty(false); setSuccessMsg(`Successfully applied temporary hours for ${from} to ${to}`);
        if (res?.items?.[0]?.id) setHighlightId(res.items[0].id);
      }
    } catch (err) { setBlockingError(translateRosterError(err)); }
  };

  const refreshApplyPreview = async () => {
    try {
      const refreshed = await onPreviewOverride(buildPayload());
      if (refreshed?.blocking?.length > 0) {
        setTodayDialogStale(true); setTodayDialogError('The latest preview is blocked by shop-floor schedule dependencies.');
        return;
      }
      setPreviewResult(refreshed); setTodayDialogStale(false); setTodayDialogError(STALE_REFRESHED_MSG);
    } catch (refErr) {
      setTodayDialogStale(true); setTodayDialogError(`${REFRESH_FAILED_MSG} (${refErr?.message || 'error'})`);
    }
  };

  const handleConfirmToday = async (todayConfirmation) => {
    setTodayDialogError(null);
    try {
      const res = await onApplyOverride({ ...buildPayload(), ...todayConfirmation });
      setShowTodayDialog(false); setTodayDialogStale(false); setIsDirty(false);
      setSuccessMsg(`Successfully applied temporary hours including today (${plantToday})`);
      if (res?.items?.[0]?.id) setHighlightId(res.items[0].id);
    } catch (err) {
      if (isPreviewStale(err)) { setTodayDialogStale(true); await refreshApplyPreview(); }
      else { setTodayDialogError(translateRosterError(err)); }
    }
  };

  const handleDeleteTrigger = async (id, isToday) => {
    setBlockingError(null); setSuccessMsg('');
    if (isToday) {
      if (typeof onPreviewDeleteOverride !== 'function') return setBlockingError('Delete preview service is unavailable');
      try {
        const preview = await onPreviewDeleteOverride(id);
        if (preview.sow_blocking) return setBlockingError({ title: 'Deletion blocked by active shop-floor schedule dependencies', counts: preview.sow_refs });
        if (preview.overlap_conflict) return setBlockingError(translateRosterError(preview.overlap_conflict));
        setDeleteDialogData({ isOpen: true, preview: { ...preview, mode: 'delete' }, overrideId: id, error: null, stale: false });
      } catch (err) { setBlockingError(translateRosterError(err)); }
    } else {
      if (!window.confirm('Are you sure you want to delete this temporary shift override?')) return;
      try {
        await onDeleteOverride(id, {});
        setSuccessMsg('Temporary shift override deleted successfully');
      } catch (err) { setBlockingError(translateRosterError(err)); }
    }
  };

  const refreshDeletePreview = async (id = deleteDialogData.overrideId) => {
    if (!id) return;
    try {
      const refreshed = await onPreviewDeleteOverride(id);
      if (refreshed?.sow_blocking || refreshed?.overlap_conflict) {
        setDeleteDialogData((p) => ({ ...p, stale: true, error: 'Latest preview blocks deletion due to shop-floor schedule dependencies.' }));
        return;
      }
      setDeleteDialogData((p) => ({ ...p, preview: { ...refreshed, mode: 'delete' }, stale: false, error: STALE_REFRESHED_MSG }));
    } catch (refErr) {
      setDeleteDialogData((p) => ({ ...p, stale: true, error: `${REFRESH_FAILED_MSG} (${refErr?.message || 'error'})` }));
    }
  };

  const handleConfirmDeleteToday = async (confirmation) => {
    const id = deleteDialogData.overrideId;
    if (!id) return;
    try {
      await onDeleteOverride(id, confirmation);
      setDeleteDialogData(EMPTY_DELETE_DIALOG);
      setSuccessMsg('Today\'s temporary shift override deleted successfully');
    } catch (err) {
      if (isPreviewStale(err)) { setDeleteDialogData((p) => ({ ...p, stale: true })); await refreshDeletePreview(id); }
      else { setDeleteDialogData((p) => ({ ...p, error: translateRosterError(err) })); }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
        <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-700">
          <Calendar size={15} className="text-[#0077b6]" /> Set Temporary Hours (Date Range)
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Valid for 1 to 62 days. Overrides default hours while preserving machine capacity and attendance integrity.
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
                  <li key={k}>{k.replace(/_/g, ' ')}: {v} active references</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DateRangeShiftFormInputs
          from={from} to={to} plantToday={plantToday}
          onFromChange={(v) => { setFrom(v); setIsDirty(true); }} onToChange={(v) => { setTo(v); setIsDirty(true); }}
          includeDay={includeDay} includeNight={includeNight}
          onToggleDay={(v) => { setIncludeDay(v); setIsDirty(true); }} onToggleNight={(v) => { setIncludeNight(v); setIsDirty(true); }}
          defaultDay={defaultDay} defaultNight={defaultNight} dayDraft={dayDraft} nightDraft={nightDraft}
          onDayDraftChange={(p) => { setDayDraft((d) => ({ ...d, ...p })); setIsDirty(true); }}
          onNightDraftChange={(p) => { setNightDraft((d) => ({ ...d, ...p })); setIsDirty(true); }}
          onSubmit={handlePreview} busy={busy}
        />
      </div>

      <UpcomingOverridesList upcomingOverrides={upcomingOverrides} plantToday={plantToday} onDeleteOverride={handleDeleteTrigger} busy={busy} highlightId={highlightId} />
      <TodayImpactDialog isOpen={showTodayDialog} onClose={() => { setShowTodayDialog(false); setTodayDialogError(null); setTodayDialogStale(false); }} onConfirm={handleConfirmToday} previewData={previewResult} busy={busy} errorMessage={todayDialogError} isStale={todayDialogStale} onRefreshPreview={refreshApplyPreview} />
      <TodayImpactDialog isOpen={deleteDialogData.isOpen} onClose={() => setDeleteDialogData(EMPTY_DELETE_DIALOG)} onConfirm={handleConfirmDeleteToday} previewData={deleteDialogData.preview} busy={busy} errorMessage={deleteDialogData.error} isStale={deleteDialogData.stale} onRefreshPreview={() => refreshDeletePreview()} />
    </div>
  );
}
