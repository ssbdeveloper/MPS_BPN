import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarCog, Save, Users, Wand2, Lock, ShieldCheck, Search, X, Eye } from 'lucide-react';
import { toast } from 'sonner';
import ShiftSettingsCard from '../components/ews-roster/ShiftSettingsCard';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function todayLocalISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function Card({ title, subtitle, icon: Icon, accent = '#0077b6', children }) {
  const IconComponent = Icon;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-slate-300 bg-slate-50/60 px-5 py-3">
        {IconComponent && (
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: accent }}>
            <IconComponent size={16} />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-slate-900">{title}</h2>
          {subtitle && <p className="truncate text-xs font-semibold text-slate-500">{subtitle}</p>}
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function EwsRosterConfigPage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [workdays, setWorkdays] = useState([]);
  const [error, setError] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState('unassigned');
  const [genFrom, setGenFrom] = useState(todayLocalISO());
  const [genTo, setGenTo] = useState(todayLocalISO(14));
  const [lockForm, setLockForm] = useState({ serial: '', shift: 'DAY', weeks: 2, from: todayLocalISO() });
  const [locks, setLocks] = useState([]);
  const [lockError, setLockError] = useState('');
  const [lockBusy, setLockBusy] = useState(false);
  const [lastLock, setLastLock] = useState(null);
  const [preview, setPreview] = useState({ open: false, loading: false, error: '', rows: [] });
  const [shiftImpact, setShiftImpact] = useState(null);
  const [shiftBusy, setShiftBusy] = useState(false);

  const rc = config?.rotation_config;
  const groupMembers = useMemo(() => config?.group_members || [], [config]);
  const operators = useMemo(() => config?.operators || [], [config]);
  const groupBySn = useMemo(
    () => new Map(groupMembers.map((m) => [m.serialnumber, m.rotation_group])),
    [groupMembers],
  );
  const assignmentRows = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    return operators.filter((operator) => {
      const current = operator.rotation_group || groupBySn.get(operator.snssb);
      if (assignmentFilter === 'unassigned' && current) return false;
      if (assignmentFilter === 'A' && current !== 'A') return false;
      if (assignmentFilter === 'B' && current !== 'B') return false;
      return !q || `${operator.full_name || ''} ${operator.snssb}`.toLowerCase().includes(q);
    });
  }, [assignmentFilter, groupBySn, groupSearch, operators]);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`${API_BASE}/ews/roster/config`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const payload = await res.json();
      setConfig(payload.data);
      setWorkdays(payload.data.workday_rules || []);
    } catch (err) {
      setError(err.message || 'Failed to load config');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveWorkday = useCallback(async (rule) => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster/config/workday`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      toast.success(`${DOW[rule.day_of_week]} saved`);
    } catch (err) {
      toast.error(err.message);
      load();
    }
  }, [load]);

  const toggle = (dow, field) => {
    setWorkdays((prev) => {
      const next = prev.map((r) => (r.day_of_week === dow ? { ...r, [field]: !r[field] } : r));
      const rule = next.find((r) => r.day_of_week === dow);
      saveWorkday({ day_of_week: dow, runs_day: rule.runs_day, runs_night: rule.runs_night });
      return next;
    });
  };

  const assignGroup = useCallback(async (sn, target) => {
    if (!sn || !target) { toast.error('Select an operator and a group'); return; }
    const prevMembers = config?.group_members || [];
    const operatorName = (operators.find((o) => o.snssb === sn) || {}).full_name || sn;
    // Optimistic: pindahkan operator ke group target di state lokal.
    setConfig((c) => (c ? {
      ...c,
      group_members: prevMembers
        .filter((m) => m.serialnumber !== sn)
        .concat([{ serialnumber: sn, rotation_group: target, full_name: operatorName, source: 'manual' }]),
    } : c));
    try {
      const res = await fetch(`${API_BASE}/ews/roster/group`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialnumber: sn, rotation_group: target, updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      toast.success(`${operatorName} → ${target === 'A' ? 'Dayshift' : 'Nightshift'}`);
      setGroupSearch('');
      load();
    } catch (err) {
      setConfig((c) => (c ? { ...c, group_members: prevMembers } : c));
      toast.error(err.message);
    }
  }, [config, operators, load]);

  // Unassign: rotation_group kosong dihapus dari operator_rotation_group.
  const unassignMember = useCallback(async (sn) => {
    const prevMembers = config?.group_members || [];
    setConfig((c) => (c ? { ...c, group_members: prevMembers.filter((m) => m.serialnumber !== sn) } : c));
    try {
      const res = await fetch(`${API_BASE}/ews/roster/group`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialnumber: sn, rotation_group: '', updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      toast.success('Operator removed from group');
      load();
    } catch (err) {
      setConfig((c) => (c ? { ...c, group_members: prevMembers } : c));
      toast.error(err.message);
    }
  }, [config, load]);

  const setPermanentShift = useCallback(async (sn, fixedShift) => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster/permanent-shift`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialnumber: sn, fixed_shift: fixedShift || null, updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      toast.success(fixedShift ? `${sn} always ${fixedShift} mulai hari ini` : `${sn} follows rotation`);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }, [load]);

  const fetchShiftImpact = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster/shift/impact`);
      if (!res.ok) return null;
      return (await res.json()).data;
    } catch {
      return null;
    }
  }, []);

  // Master shift = public.shift_definition: satu tempat untuk jam shift dan jam kerja bersih.
  const saveShiftMaster = useCallback(async (shiftCode, draft) => {
    if (!draft || Object.keys(draft).length === 0) return;
    setShiftBusy(true);
    try {
      const payload = { shift_code: shiftCode, updated_by: 'ews-roster-ui' };
      if (draft.start_time !== undefined) payload.start_time = draft.start_time;
      if (draft.end_time !== undefined) payload.end_time = draft.end_time;
      if (draft.crosses_midnight !== undefined) payload.crosses_midnight = draft.crosses_midnight;
      if (draft.standard_hours !== undefined) payload.standard_hours = Number(draft.standard_hours);
      const res = await fetch(`${API_BASE}/ews/roster/shift`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      toast.success(`${shiftCode} tersimpan — roster, heatmap, dan adoption ikut memakai nilai baru`);
      await load();
      setShiftImpact(await fetchShiftImpact());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setShiftBusy(false);
    }
  }, [load, fetchShiftImpact]);

  const previewShiftImpact = useCallback(async () => {
    setShiftBusy(true);
    try {
      setShiftImpact(await fetchShiftImpact());
    } finally {
      setShiftBusy(false);
    }
  }, [fetchShiftImpact]);

  const resyncFutureShifts = useCallback(async () => {
    setShiftBusy(true);
    try {
      const res = await fetch(`${API_BASE}/ews/roster/shift/resync-future`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const j = await res.json();
      toast.success(`${j.data.rows_updated} baris future disinkronkan ke master`);
      await load();
      setShiftImpact(await fetchShiftImpact());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setShiftBusy(false);
    }
  }, [load, fetchShiftImpact]);

  const runGenerate = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: genFrom, to: genTo }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const payload = await res.json();
      toast.success(`Generate: ${payload.data.rows_inserted} new rows`);
    } catch (err) {
      toast.error(err.message);
    }
  }, [genFrom, genTo]);

  const loadLocks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster/locks`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const payload = await res.json();
      setLocks(Array.isArray(payload.data) ? payload.data : []);
    } catch (err) {
      setLockError(err.message || 'Failed to load locks');
    }
  }, []);

  useEffect(() => { loadLocks(); }, [loadLocks]);

  const saveLock = useCallback(async () => {
    setLockError('');
    const serialnumber = lockForm.serial.trim();
    const weeks = Number.parseInt(lockForm.weeks, 10);
    if (!serialnumber) { setLockError('Enter the operator serial number'); return; }
    if (!Number.isInteger(weeks) || weeks < 1) { setLockError('Duration must be at least 1 week'); return; }
    setLockBusy(true);
    try {
      const res = await fetch(`${API_BASE}/ews/roster/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialnumber, locked_shift: lockForm.shift, effective_from: lockForm.from, lock_weeks: weeks, created_by: 'ews-roster-ui' }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) { setLockError(payload?.error || `Failed (${res.status})`); return; }
      setLastLock(payload.data);
      toast.success(`Lock ${serialnumber} → ${lockForm.shift} saved`);
      setLockForm((f) => ({ ...f, serial: '' }));
      loadLocks();
    } catch (err) {
      setLockError(err.message || 'Failed to save lock');
    } finally {
      setLockBusy(false);
    }
  }, [lockForm, loadLocks]);

  const cancelLock = useCallback(async (id) => {
    setLockError('');
    try {
      const res = await fetch(`${API_BASE}/ews/roster/lock/${id}/cancel`, { method: 'POST' });
      const payload = await res.json().catch(() => null);
      if (!res.ok) { setLockError(payload?.error || `Failed to cancel (${res.status})`); return; }
      toast.success('Lock cancelled');
      setLastLock((prev) => (prev?.id === id ? null : prev));
      loadLocks();
    } catch (err) {
      setLockError(err.message || 'Failed to cancel lock');
    }
  }, [loadLocks]);

  const loadPreview = useCallback(async () => {
    setPreview((p) => ({ ...p, open: true, loading: true, error: '' }));
    try {
      const dates = Array.from({ length: 7 }, (_, i) => todayLocalISO(i));
      const rows = await Promise.all(dates.map(async (d) => {
        const res = await fetch(`${API_BASE}/ews/roster?date=${d}`);
        if (!res.ok) throw new Error(`Roster ${d} failed (${res.status})`);
        const payload = await res.json();
        const sched = (Array.isArray(payload.data) ? payload.data : []).filter((r) => r.status === 'SCHEDULED');
        const hasLock = locks.some((lk) => !lk.cancelled_at && d >= lk.effective_from && d < lk.lock_end);
        return {
          date: d,
          day: sched.filter((r) => r.scheduled_shift === 'DAY').length,
          night: sched.filter((r) => r.scheduled_shift === 'NIGHT').length,
          total: sched.length,
          hasLock,
        };
      }));
      setPreview({ open: true, loading: false, error: '', rows });
    } catch (err) {
      setPreview({ open: true, loading: false, error: err.message || 'Failed to load preview', rows: [] });
    }
  }, [locks]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-300 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => navigate('/ews/roster')}
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-400 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            aria-label="Back"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#caf0f8] text-[#0077b6] shadow-sm">
            <CalendarCog size={19} />
          </div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#0077b6]">EWS Roster</p>
            <h1 className="text-base font-extrabold text-slate-900 md:text-lg">Rotation &amp; Shift Configuration</h1>
          </div>
        </div>
      </header>

      <main className="w-full space-y-5 px-4 py-5 md:px-6">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          <Card title="Workdays per Shift" icon={CalendarCog}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1 text-left">Day</th>
                    <th className="px-2 py-1 text-center">DAY shift</th>
                    <th className="px-2 py-1 text-center">NIGHT shift</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workdays.map((r) => (
                    <tr key={r.day_of_week}>
                      <td className="px-2 py-2 font-bold text-slate-700">{DOW[r.day_of_week]}</td>
                      {['runs_day', 'runs_night'].map((f) => (
                        <td key={f} className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => toggle(r.day_of_week, f)}
                            className={`inline-flex min-h-[40px] min-w-[64px] items-center justify-center rounded-lg border px-3 text-xs font-extrabold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
                              r[f] ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-400 bg-slate-50 text-slate-400'
                            }`}
                          >
                            {r[f] ? 'ON' : 'OFF'}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-400">
              Changes save automatically. Applies to rosters generated afterwards (forward-only).
            </p>
          </Card>

          <Card title="Generate Roster" icon={Wand2} accent="#059669">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs font-bold text-slate-600">From
                <input type="date" value={genFrom} onChange={(e) => setGenFrom(e.target.value)} className="ml-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
              </label>
              <label className="text-xs font-bold text-slate-600">To
                <input type="date" value={genTo} onChange={(e) => setGenTo(e.target.value)} className="ml-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
              </label>
              <button type="button" onClick={runGenerate} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95">
                <Wand2 size={15} /> Generate
              </button>
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-400">
              Forward-only: existing rows (including manual foreman statuses) are never overwritten.
            </p>
          </Card>

          <Card title="Operator Group Assignment" icon={Users} accent="#7c3aed">
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
                <div className="flex flex-wrap gap-1.5" aria-label="Filter operator assignment">
                  {[
                    ['unassigned', 'Unassigned', operators.filter((o) => !(o.rotation_group || groupBySn.get(o.snssb))).length],
                    ['A', 'Group A', operators.filter((o) => (o.rotation_group || groupBySn.get(o.snssb)) === 'A').length],
                    ['B', 'Group B', operators.filter((o) => (o.rotation_group || groupBySn.get(o.snssb)) === 'B').length],
                    ['all', 'All', operators.length],
                  ].map(([key, label, count]) => (
                    <button key={key} type="button" onClick={() => setAssignmentFilter(key)} className={`min-h-[40px] rounded-lg border px-3 text-xs font-extrabold ${assignmentFilter === key ? 'border-[#0096c7] bg-[#caf0f8] text-[#0077b6]' : 'border-slate-300 bg-white text-slate-600'}`}>
                      {label} <span className="font-mono">{count}</span>
                    </button>
                  ))}
                </div>
                <div className="relative mt-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Cari nama atau SN…" className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800" />
                </div>
                <div className="mt-2 max-h-72 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {assignmentRows.length === 0 ? <p className="p-4 text-xs font-semibold text-slate-400">Tidak ada operator pada filter ini.</p> : assignmentRows.map((operator) => {
                    const current = operator.rotation_group || groupBySn.get(operator.snssb);
                    return (
                      <div key={operator.snssb} className="grid grid-cols-[minmax(0,1fr)_110px_150px] items-center gap-2 p-2">
                        <div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800">{operator.full_name}</p><p className="font-mono text-xs text-slate-400">{operator.snssb}</p></div>
                        <select value={current || ''} onChange={(e) => e.target.value ? assignGroup(operator.snssb, e.target.value) : unassignMember(operator.snssb)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700" aria-label={`Rotation group for ${operator.full_name}`}>
                          <option value="">Unassigned</option><option value="A">Group A</option><option value="B">Group B</option>
                        </select>
                        <select value={operator.fixed_shift || ''} disabled={!current} onChange={(e) => setPermanentShift(operator.snssb, e.target.value)} className={`h-9 rounded-lg border px-2 text-xs font-bold ${operator.fixed_shift === 'DAY' ? 'border-amber-300 bg-amber-50 text-amber-800' : operator.fixed_shift === 'NIGHT' ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-300 bg-white text-slate-700'}`} aria-label={`Permanent shift for ${operator.full_name}`}>
                          <option value="">Follow Rotation</option><option value="DAY">Always Day</option><option value="NIGHT">Always Night</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-500">Always Day/Night berlaku mulai hari ini dan tidak mengubah histori. Untuk mengubah <strong>satu atau beberapa hari saja</strong>, klik selnya langsung di heatmap halaman Roster.</p>
              </div>
            </div>
          </Card>

          <Card title="Advanced · Temporary Shift Lock" icon={Lock} accent="#b45309">
            <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              Untuk operator yang <strong>selalu</strong> Day atau Night, pakai kolom <strong>Always Day / Always Night</strong> di kartu Operator Group Assignment di atas. Shift Lock hanya untuk pengecualian sementara yang punya tanggal mulai dan berakhir di batas minggu.
            </p>
            <details className="rounded-xl border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer select-none text-xs font-extrabold text-[#0077b6]">Buka form lock sementara (jarang dipakai)</summary>
              <div className="mt-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-[200px] flex-1 flex-col gap-1">
                <label htmlFor="lock-serial" className="text-xs font-bold text-slate-600">Operator</label>
                <select
                  id="lock-serial"
                  value={lockForm.serial}
                  onChange={(e) => setLockForm((f) => ({ ...f, serial: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
                >
                  <option value="">Select operator (must be in a group)…</option>
                  {groupMembers
                    .filter((m) => !m.inactive_from || m.inactive_from > todayLocalISO())
                    .map((m) => (
                      <option key={m.serialnumber} value={m.serialnumber}>{m.full_name || m.serialnumber} ({m.serialnumber})</option>
                    ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="lock-shift" className="text-xs font-bold text-slate-600">Shift</label>
                <select id="lock-shift" value={lockForm.shift} onChange={(e) => setLockForm((f) => ({ ...f, shift: e.target.value }))}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#00b4d8]">
                  <option value="DAY">DAY</option>
                  <option value="NIGHT">NIGHT</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="lock-from" className="text-xs font-bold text-slate-600">Start</label>
                <input id="lock-from" type="date" value={lockForm.from} min={todayLocalISO()} onChange={(e) => setLockForm((f) => ({ ...f, from: e.target.value }))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="lock-weeks" className="text-xs font-bold text-slate-600">Duration (weeks)</label>
                <input id="lock-weeks" type="number" min={1} value={lockForm.weeks} onChange={(e) => setLockForm((f) => ({ ...f, weeks: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
              </div>
              <button type="button" onClick={saveLock} disabled={lockBusy}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                <Save size={15} /> {lockBusy ? 'Saving…' : 'Lock'}
              </button>
            </div>

            {lockError && (
              <div className="mt-2 rounded-lg border border-red-400 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600" role="alert">{lockError}</div>
            )}
            {lastLock && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
                <ShieldCheck size={14} /> {lastLock.serialnumber} locked to {lastLock.locked_shift} until {lastLock.lock_end}
              </div>
            )}
              </div>
            </details>

            <div className="mt-3">
              <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Active Locks</div>
              {locks.length === 0 ? (
                <div className="text-xs text-slate-400">No active locks.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {locks.map((lk) => {
                    const started = lk.effective_from < todayLocalISO();
                    return (
                      <li key={lk.id} className="flex items-center justify-between gap-2 py-2">
                        <div className="text-xs">
                          {lk.full_name ? (
                            <>
                              <span className="font-bold text-slate-800">{lk.full_name}</span>
                              <span className="ml-1.5 font-mono text-xs text-slate-400">({lk.serialnumber})</span>
                            </>
                          ) : (
                            <span className="font-mono font-bold text-slate-800">{lk.serialnumber}</span>
                          )}
                          <span className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${lk.locked_shift === 'DAY' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>{lk.locked_shift}</span>
                          <span className="ml-2 tabular-nums text-slate-500">{lk.effective_from} → {lk.lock_end}</span>
                          {started && <span className="ml-2 text-[10px] font-bold text-slate-400">(active)</span>}
                        </div>
                        <button type="button" onClick={() => cancelLock(lk.id)} disabled={started}
                          title={started ? 'Already in effect — cannot cancel (forward-only)' : 'Cancel lock'}
                          aria-label={`Cancel lock ${lk.serialnumber}`}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-red-50 hover:border-red-300 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-slate-300 disabled:hover:text-slate-600">
                          <X size={16} strokeWidth={2.5} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-400">
              Locks are forward-only (start ≥ today) and must not overlap. They end on a week boundary
              (consistent with the crew flip). Effect on schedule &amp; adoption is active after the backend is deployed.
            </p>
          </Card>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          <Card title="Shift Composition Preview (7 days)" icon={Eye} accent="#0ea5e9">
            <button type="button" onClick={loadPreview} disabled={preview.loading}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
              <Eye size={15} /> {preview.loading ? 'Loading…' : 'Load preview'}
            </button>
            {preview.error && <div className="mt-2 rounded-lg border border-red-400 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600" role="alert">{preview.error}</div>}
            {preview.open && !preview.loading && !preview.error && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-1 text-left">Date</th>
                      <th className="px-2 py-1 text-center">DAY</th>
                      <th className="px-2 py-1 text-center">NIGHT</th>
                      <th className="px-2 py-1 text-center">Total</th>
                      <th className="px-2 py-1 text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.map((r) => (
                      <tr key={r.date} className={r.hasLock ? 'bg-amber-50/40' : ''}>
                        <td className="px-2 py-2 font-semibold text-slate-700">{DOW[new Date(`${r.date}T00:00:00`).getDay()]} {r.date.slice(5)}</td>
                        <td className="px-2 py-2 text-center tabular-nums font-bold text-amber-700">{r.day}</td>
                        <td className="px-2 py-2 text-center tabular-nums font-bold text-indigo-700">{r.night}</td>
                        <td className="px-2 py-2 text-center tabular-nums text-slate-600">{r.total}</td>
                        <td className="px-2 py-2 text-left">
                          {r.total === 0
                            ? <span className="text-xs text-slate-400">off</span>
                            : r.hasLock
                              ? <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">mixed crew (lock active)</span>
                              : <span className="text-xs text-slate-400">normal</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs font-semibold text-slate-400">
                  Split is computed from the effective roster. "Mixed crew" = a lock is active that day
                  (operator pinned off their crew's shift). Lock effects appear after the backend is deployed.
                </p>
              </div>
            )}
          </Card>

          <Card title="Shift & Standard Hours" icon={CalendarCog} accent="#0077b6">
            <ShiftSettingsCard
              shifts={config?.shifts || []}
              overrides={config?.shift_overrides || []}
              impact={shiftImpact}
              onSave={saveShiftMaster}
              onPreview={previewShiftImpact}
              onResync={resyncFutureShifts}
              busy={shiftBusy}
            />
            <p className="mt-3 text-xs font-semibold text-slate-500">
              Sumber tunggal: public.shift_definition. Jam dan jam kerja bersih di sini dipakai roster,
              heatmap, dan adoption; override tanggal hanya berlaku pada tanggalnya.
            </p>
          </Card>

          <Card title="Rotation" icon={CalendarCog} accent="#94a3b8">
            {rc ? (
              <div className="text-sm text-slate-700">
                Anchor <b>{rc.anchor_week_start}</b> (Dayshift = {rc.anchor_group_a_shift}) · flip every {rc.rotation_period_weeks} week{rc.rotation_period_weeks > 1 ? 's' : ''}
              </div>
            ) : <div className="text-sm text-slate-400">—</div>}
          </Card>
        </div>
      </main>
    </div>
  );
}

export default EwsRosterConfigPage;
