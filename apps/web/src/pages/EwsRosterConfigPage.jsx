import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarCog, Clock3, Eye, Users } from 'lucide-react';
import { toast } from 'sonner';
import ScheduleCard from '../components/ews-roster/ScheduleCard';
import OperatorShiftCard from '../components/ews-roster/OperatorShiftCard';
import RosterPreviewCard from '../components/ews-roster/RosterPreviewCard';
import ShiftSettingsCard from '../components/ews-roster/ShiftSettingsCard';
import DateRangeShiftForm from '../components/ews-roster/DateRangeShiftForm';
import { todayLocalISO } from '../components/ews-roster/rosterConstants';
import { authHeaders } from '../rbac/useAuth';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const weekOf = (value = todayLocalISO()) => value;
const request = async (path, options = {}) => {
  const headers = { ...authHeaders(), ...(options.headers || {}) };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(payload?.error || `Failed (${response.status})`);
    err.status = response.status;
    err.code = payload?.code;
    err.details = payload?.details;
    throw err;
  }
  return payload?.data ?? payload;
};

function SectionContainer({ title, subtitle, icon, children }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0077b6] text-white shadow-2xs">
          {icon}
        </span>
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">{title}</h2>
          {subtitle && <p className="text-[11px] font-medium text-slate-500">{subtitle}</p>}
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function EwsRosterConfigPage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [weekStart, setWeekStart] = useState(weekOf());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shiftImpact, setShiftImpact] = useState(null);
  const [rosterPreview, setRosterPreview] = useState({ loading: false, error: '', rows: [] });

  const load = useCallback(async (week = weekStart) => {
    setError('');
    try { setConfig(await request(`/ews/roster/config?week_start=${encodeURIComponent(week)}`)); }
    catch (err) { setError(err.message || 'Failed to load roster configuration'); }
  }, [weekStart]);
  useEffect(() => { load(weekStart); }, [load, weekStart]);

  const mutate = useCallback(async (path, options, success) => {
    setBusy(true);
    try { const data = await request(path, options); if (success) toast.success(success); return data; }
    catch (err) { toast.error(err.message); throw err; }
    finally { setBusy(false); }
  }, []);
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const savePattern = async (rules) => { await mutate('/ews/roster/config/workday', json('PUT', { weekly_pattern: rules }), 'Weekly pattern saved successfully'); await load(); };
  const addException = async (exception) => { await mutate('/ews/roster/config/exceptions', json('PUT', { ...exception, updated_by: 'ews-roster-ui' }), 'Calendar exception added'); await load(); };
  const removeException = async (date) => { await mutate(`/ews/roster/config/exceptions/${encodeURIComponent(date)}`, { method: 'DELETE' }, 'Calendar exception removed'); await load(); };
  const previewSchedule = (range) => mutate('/ews/roster/generate/preview', json('POST', range));
  const applySchedule = async (range) => { const result = await mutate('/ews/roster/generate/apply', json('POST', range)); toast.success(`${Number(result?.rows_added || 0)} schedule rows applied`); };
  const assign = async (serialnumber, rotation_group) => { await mutate('/ews/roster/group', json('PUT', { serialnumber, rotation_group, updated_by: 'ews-roster-ui' }), 'Operator group assignment saved'); await load(); };
  const fixedShift = async (serialnumber, fixed_shift) => {
    const previous = config;
    setConfig((current) => ({ ...current, operators: (current?.operators || []).map((operator) => operator.snssb === serialnumber ? { ...operator, fixed_shift: fixed_shift || null } : operator) }));
    try { await mutate('/ews/roster/permanent-shift', json('PUT', { serialnumber, fixed_shift: fixed_shift || null, updated_by: 'ews-roster-ui' }), 'Fixed shift assignment saved'); }
    catch { setConfig(previous); }
  };
  const fetchShiftImpact = async () => { const value = await request('/ews/roster/shift/impact'); setShiftImpact(value); return value; };
  const saveShift = async (shift_code, draft) => { await mutate('/ews/roster/shift', json('PUT', { shift_code, ...draft, standard_hours: draft.standard_hours === undefined ? undefined : Number(draft.standard_hours), updated_by: 'ews-roster-ui' }), 'Default shift hours saved'); await load(); await fetchShiftImpact(); };
  const resyncShifts = async () => { const result = await mutate('/ews/roster/shift/resync-future', json('PUT', { updated_by: 'ews-roster-ui' })); toast.success(`${result.rows_updated} future roster rows synchronized`); await fetchShiftImpact(); };

  // Handlers Date-Range Shift Hours
  const previewDateRangeShift = async (payload) => {
    return await request('/ews/roster/shift/date-range/preview', json('POST', payload));
  };
  const applyDateRangeShift = async (payload) => {
    const res = await mutate('/ews/roster/shift/date-range', json('PUT', payload), 'Temporary shift hours applied successfully');
    await load();
    return res;
  };
  const deleteOverrideShift = async (id, payload = {}) => {
    const res = await mutate(`/ews/roster/shift/override/${id}`, json('DELETE', payload), 'Temporary shift override deleted successfully');
    await load();
    return res;
  };
  const previewDeleteOverride = async (id) => {
    return await request(`/ews/roster/shift/override/${id}/preview`, json('POST', {}));
  };

  const loadRosterPreview = async () => {
    setRosterPreview({ loading: true, error: '', rows: [] });
    try {
      const dates = Array.from({ length: 7 }, (_, offset) => {
        const date = new Date(`${todayLocalISO()}T00:00:00`);
        date.setDate(date.getDate() + offset);
        return date.toISOString().slice(0, 10);
      });
      const rows = await Promise.all(dates.map(async (date) => {
        const data = await request(`/ews/roster?date=${date}`);
        const scheduled = (Array.isArray(data) ? data : []).filter((row) => row.status === 'SCHEDULED');
        return {
          date,
          day: scheduled.filter((row) => row.scheduled_shift === 'DAY').length,
          night: scheduled.filter((row) => row.scheduled_shift === 'NIGHT').length,
          total: scheduled.length,
        };
      }));
      setRosterPreview({ loading: false, error: '', rows });
    } catch (err) {
      setRosterPreview({ loading: false, error: err.message || 'Failed to load preview', rows: [] });
    }
  };

  const rules = config?.weekly_pattern || config?.workday_rules || [];
  const operators = useMemo(() => {
    const membership = new Map((config?.group_members || []).map((row) => [row.serialnumber, row.rotation_group]));
    return (config?.operators || []).map((operator) => ({
      ...operator,
      rotation_group: operator.rotation_group || membership.get(operator.snssb) || null,
    }));
  }, [config]);
  const weekContext = config?.week_context || { week_start: weekStart, day_group: null, night_group: null };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => navigate('/ews/roster')}
            aria-label="Back to roster"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            <ArrowLeft size={17} />
          </button>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-[#0077b6]">
            <CalendarCog size={19} />
          </span>
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-[#0077b6]">EWS Roster</p>
            <h1 className="text-base font-extrabold text-slate-900 md:text-lg">Roster Configuration</h1>
          </div>
        </div>
      </header>

      <main className="space-y-6 px-4 py-6 md:px-6">
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-700">
            {error}
          </div>
        )}

        <div className="grid items-start gap-6 xl:grid-cols-2">
          {/* Section 1: Work Calendar */}
          <SectionContainer title="Work Calendar" subtitle="Operating schedule pattern, plant date exceptions, and generation range" icon={<CalendarCog size={17} />}>
            <ScheduleCard
              rules={rules}
              exceptions={config?.calendar_exceptions || []}
              onSavePattern={savePattern}
              onAddException={addException}
              onRemoveException={removeException}
              onPreview={previewSchedule}
              onApply={applySchedule}
              busy={busy}
            />
          </SectionContainer>

          {/* Section 2: Shift Hours */}
          <SectionContainer title="Shift Hours" subtitle="Permanent master defaults and temporary date-range overrides" icon={<Clock3 size={17} />}>
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-700">
                  Default Hours (Permanent Base)
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Standard shift hours applied automatically unless a temporary date-range override is active.
                </p>
                <div className="mt-3">
                  <ShiftSettingsCard
                    shifts={config?.default_shifts || config?.shifts || []}
                    overrides={config?.shift_overrides || []}
                    todayShiftSource={config?.today_shift_source}
                    plantToday={config?.plant_today}
                    impact={shiftImpact}
                    onSave={saveShift}
                    onPreview={fetchShiftImpact}
                    onResync={resyncShifts}
                    busy={busy}
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-700">
                  Temporary Hours (Date Range Overrides)
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Temporary exceptions for Ramadan, seasonal shifts, or operational adjustments.
                </p>
                <div className="mt-3">
                  <DateRangeShiftForm
                    plantToday={config?.plant_today}
                    defaultShifts={config?.default_shifts || config?.shifts || []}
                    upcomingOverrides={config?.upcoming_shift_overrides || []}
                    onApplyOverride={applyDateRangeShift}
                    onDeleteOverride={deleteOverrideShift}
                    onPreviewOverride={previewDateRangeShift}
                    onPreviewDeleteOverride={previewDeleteOverride}
                    busy={busy}
                  />
                </div>
              </div>
            </div>
          </SectionContainer>

          {/* Section 3: Operator Assignments */}
          <SectionContainer title="Operator Assignments" subtitle="Rotation group memberships and pinned fixed shifts" icon={<Users size={17} />}>
            <OperatorShiftCard
              operators={operators}
              weekContext={weekContext}
              onWeekChange={setWeekStart}
              onAssign={assign}
              onFixedShift={fixedShift}
            />
          </SectionContainer>

          {/* Section 4: 7-Day Preview */}
          <SectionContainer title="Roster Preview (7-Day Overview)" subtitle="Projected scheduled headcount across upcoming dates" icon={<Eye size={17} />}>
            <RosterPreviewCard {...rosterPreview} onLoad={loadRosterPreview} />
          </SectionContainer>
        </div>
      </main>
    </div>
  );
}
