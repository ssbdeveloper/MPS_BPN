import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarCog, Clock3, Eye, Users } from 'lucide-react';
import { toast } from 'sonner';
import ScheduleCard from '../components/ews-roster/ScheduleCard';
import OperatorShiftCard from '../components/ews-roster/OperatorShiftCard';
import RosterPreviewCard from '../components/ews-roster/RosterPreviewCard';
import ShiftSettingsCard from '../components/ews-roster/ShiftSettingsCard';
import { todayLocalISO } from '../components/ews-roster/rosterConstants';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const weekOf = (value = todayLocalISO()) => value;
const request = async (path, options) => { const response = await fetch(`${API_BASE}${path}`, options); const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || `Failed (${response.status})`); return payload?.data ?? payload; };

function Card({ title, icon, children }) {
  return <section className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm"><header className="flex items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0077b6] text-white">{React.createElement(icon, { size: 17 })}</span><h2 className="text-sm font-extrabold text-slate-900">{title}</h2></header><div className="p-5">{children}</div></section>;
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
    catch (err) { setError(err.message || 'Failed to load configuration'); }
  }, [weekStart]);
  useEffect(() => { load(weekStart); }, [load, weekStart]);

  const mutate = useCallback(async (path, options, success) => {
    setBusy(true);
    try { const data = await request(path, options); if (success) toast.success(success); return data; }
    catch (err) { toast.error(err.message); throw err; }
    finally { setBusy(false); }
  }, []);
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const savePattern = async (rules) => { await mutate('/ews/roster/config/workday', json('PUT', { weekly_pattern: rules }), 'Weekly pattern saved'); await load(); };
  const addException = async (exception) => { await mutate('/ews/roster/config/exceptions', json('PUT', { ...exception, updated_by: 'ews-roster-ui' }), 'Exception added'); await load(); };
  const removeException = async (date) => { await mutate(`/ews/roster/config/exceptions/${encodeURIComponent(date)}`, { method: 'DELETE' }, 'Exception removed'); await load(); };
  const previewSchedule = (range) => mutate('/ews/roster/generate/preview', json('POST', range));
  const applySchedule = async (range) => { const result = await mutate('/ews/roster/generate/apply', json('POST', range)); toast.success(`${Number(result?.rows_added || 0)} rows added`); };
  const assign = async (serialnumber, rotation_group) => { await mutate('/ews/roster/group', json('PUT', { serialnumber, rotation_group, updated_by: 'ews-roster-ui' }), 'Assignment saved'); await load(); };
  const fixedShift = async (serialnumber, fixed_shift) => {
    const previous = config;
    setConfig((current) => ({ ...current, operators: (current?.operators || []).map((operator) => operator.snssb === serialnumber ? { ...operator, fixed_shift: fixed_shift || null } : operator) }));
    try { await mutate('/ews/roster/permanent-shift', json('PUT', { serialnumber, fixed_shift: fixed_shift || null, updated_by: 'ews-roster-ui' }), 'Permanent shift saved'); }
    catch { setConfig(previous); }
  };
  const fetchShiftImpact = async () => { const value = await request('/ews/roster/shift/impact'); setShiftImpact(value); return value; };
  const saveShift = async (shift_code, draft) => { await mutate('/ews/roster/shift', json('PUT', { shift_code, ...draft, standard_hours: draft.standard_hours === undefined ? undefined : Number(draft.standard_hours), updated_by: 'ews-roster-ui' }), 'Shift hours saved'); await load(); await fetchShiftImpact(); };
  const resyncShifts = async () => { const result = await mutate('/ews/roster/shift/resync-future', json('PUT', { updated_by: 'ews-roster-ui' })); toast.success(`${result.rows_updated} future rows synchronized`); await fetchShiftImpact(); };
  const loadRosterPreview = async () => {
    setRosterPreview({ loading: true, error: '', rows: [] });
    try { const dates = Array.from({ length: 7 }, (_, offset) => { const date = new Date(`${todayLocalISO()}T00:00:00`); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); }); const rows = await Promise.all(dates.map(async (date) => { const data = await request(`/ews/roster?date=${date}`); const scheduled = (Array.isArray(data) ? data : []).filter((row) => row.status === 'SCHEDULED'); return { date, day: scheduled.filter((row) => row.scheduled_shift === 'DAY').length, night: scheduled.filter((row) => row.scheduled_shift === 'NIGHT').length, total: scheduled.length }; })); setRosterPreview({ loading: false, error: '', rows }); }
    catch (err) { setRosterPreview({ loading: false, error: err.message, rows: [] }); }
  };

  const rules = config?.weekly_pattern || config?.workday_rules || [];
  const operators = useMemo(() => { const membership = new Map((config?.group_members || []).map((row) => [row.serialnumber, row.rotation_group])); return (config?.operators || []).map((operator) => ({ ...operator, rotation_group: operator.rotation_group || membership.get(operator.snssb) || null })); }, [config]);
  const weekContext = config?.week_context || { week_start: weekStart, day_group: null, night_group: null };

  return <div className="min-h-screen bg-slate-50 text-slate-800">
    <header className="sticky top-0 z-20 border-b border-slate-300 bg-white"><div className="flex items-center gap-3 px-4 py-3 md:px-6"><button type="button" onClick={() => navigate('/ews/roster')} aria-label="Back" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"><ArrowLeft size={17} /></button><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-[#0077b6]"><CalendarCog size={19} /></span><div><p className="text-xs font-extrabold uppercase tracking-widest text-[#0077b6]">EWS Roster</p><h1 className="text-lg font-extrabold text-slate-900">Roster Configuration</h1></div></div></header>
    <main className="space-y-5 px-4 py-5 md:px-6">{error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Card title="Schedule" icon={CalendarCog}><ScheduleCard rules={rules} exceptions={config?.calendar_exceptions || []} onSavePattern={savePattern} onAddException={addException} onRemoveException={removeException} onPreview={previewSchedule} onApply={applySchedule} busy={busy} /></Card>
        <Card title="Operators" icon={Users}><OperatorShiftCard operators={operators} weekContext={weekContext} onWeekChange={setWeekStart} onAssign={assign} onFixedShift={fixedShift} /></Card>
        <Card title="Shift Hours" icon={Clock3}><ShiftSettingsCard shifts={config?.shifts || []} overrides={config?.shift_overrides || []} impact={shiftImpact} onSave={saveShift} onPreview={fetchShiftImpact} onResync={resyncShifts} busy={busy} /></Card>
        <Card title="7-Day Preview" icon={Eye}><RosterPreviewCard {...rosterPreview} onLoad={loadRosterPreview} /></Card>
      </div>
    </main>
  </div>;
}
