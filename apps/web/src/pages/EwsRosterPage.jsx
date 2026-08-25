import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, RefreshCw, Search, Settings, Users } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const STATUS_OPTIONS = ['SCHEDULED', 'LEAVE', 'SICK', 'PERMIT', 'OFF'];

const ATTEND_STYLE = {
  PRESENT: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ABSENT: 'bg-red-100 text-red-700 border-red-200',
  IN_PROGRESS: 'bg-amber-100 text-amber-700 border-amber-200',
  LEAVE: 'bg-sky-100 text-sky-700 border-sky-200',
  SICK: 'bg-purple-100 text-purple-700 border-purple-200',
  PERMIT: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  OFF: 'bg-slate-100 text-slate-600 border-slate-200',
};

function todayLocalISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function ShiftBadge({ shift }) {
  const isDay = shift === 'DAY';
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[10px] font-extrabold"
      style={isDay
        ? { background: '#fffbeb', borderColor: '#fde68a', color: '#b45309' }
        : { background: '#eef2ff', borderColor: '#c7d2fe', color: '#4338ca' }}
    >
      {isDay ? 'DAY' : 'NIGHT'}
    </span>
  );
}

function StatTile({ label, value, tone = 'neutral' }) {
  const tones = {
    neutral: { bg: '#f8fafc', border: '#e2e8f0', text: '#334155' },
    good: { bg: '#f0fdf4', border: '#bbf7d0', text: '#047857' },
    bad: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
    info: { bg: '#caf0f8', border: '#90e0ef', text: '#0077b6' },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div className="rounded-xl border px-3 py-2.5 text-center shadow-sm" style={{ background: t.bg, borderColor: t.border }}>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: t.text }}>{label}</div>
      <div className="mt-1 text-lg font-black leading-none" style={{ color: t.text }}>{value}</div>
    </div>
  );
}

function EwsRosterPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayLocalISO());
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async (d) => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/ews/roster?date=${encodeURIComponent(d)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const payload = await res.json();
      setRows(Array.isArray(payload?.data) ? payload.data : []);
    } catch (err) {
      setError(err.message || 'Failed to load roster');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.operator_name || '').toLowerCase().includes(q) ||
      String(r.serialnumber || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const counts = useMemo(() => {
    const c = { scheduled: 0, present: 0, absent: 0, excused: 0, in_progress: 0, half_day: 0 };
    for (const r of filtered) {
      if (r.half_day) c.half_day += 1;
      if (['LEAVE', 'SICK', 'PERMIT', 'OFF'].includes(r.status)) c.excused += 1;
      else {
        c.scheduled += 1;
        if (r.attendance === 'PRESENT') c.present += 1;
        else if (r.attendance === 'ABSENT') c.absent += 1;
        else if (r.attendance === 'IN_PROGRESS') c.in_progress += 1;
      }
    }
    return c;
  }, [filtered]);

  const changeStatus = useCallback(async (serialnumber, status) => {
    const key = `${serialnumber}`;
    setSavingKey(key);
    try {
      const res = await fetch(`${API_BASE}/ews/roster/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialnumber, business_date: date, status, updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      toast.success(`${serialnumber} → ${status}`);
      await load(date);
    } catch (err) {
      toast.error(err.message || 'Failed to save status');
    } finally {
      setSavingKey('');
    }
  }, [date, load]);

  const toggleHalfDay = useCallback(async (serialnumber, halfDay) => {
    setSavingKey(`half-${serialnumber}`);
    try {
      const res = await fetch(`${API_BASE}/ews/roster/half-day`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialnumber, business_date: date, half_day: halfDay, updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      toast.success(`${serialnumber} → ${halfDay ? 'half day' : 'full day'}`);
      await load(date);
    } catch (err) {
      toast.error(err.message || 'Failed to save half day');
    } finally {
      setSavingKey('');
    }
  }, [date, load]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-300 bg-white/95 backdrop-blur">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-400 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
              aria-label="Back"
            >
              <ArrowLeft size={17} />
            </button>
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#caf0f8] text-[#0077b6] shadow-sm">
              <Users size={19} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#0077b6]">EWS Roster</p>
              <h1 className="truncate text-base font-extrabold text-slate-900 md:text-lg">Operator Attendance &amp; Shift</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm">
              <CalendarDays size={15} className="text-[#0077b6]" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-slate-800 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => load(date)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate('/ews/roster/config')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition hover:border-[#90e0ef] hover:text-[#0077b6] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            >
              <Settings size={14} />
              Config
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4 md:px-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="Scheduled" value={counts.scheduled} tone="info" />
          <StatTile label="Present" value={counts.present} tone="good" />
          <StatTile label="Absent" value={counts.absent} tone={counts.absent > 0 ? 'bad' : 'good'} />
          <StatTile label="In Progress" value={counts.in_progress} tone="neutral" />
          <StatTile label="Excused" value={counts.excused} tone="neutral" />
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-slate-900">Roster · {date}</h2>
              {counts.half_day > 0 && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  {counts.half_day} half day
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setSearch(searchInput.trim()); }}
                  placeholder="Search operator…"
                  className="h-9 w-56 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                />
              </label>
              <button
                type="button"
                onClick={() => { setSearch(searchInput.trim()); }}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95"
              >
                Search
              </button>
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setSearchInput(''); }}
                  className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-500 transition hover:bg-slate-50"
                  title="Clear search"
                >
                  Clear
                </button>
              )}
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                {filtered.length} operator
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-[#90e0ef]" style={{ background: '#caf0f8' }}>
                <tr className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                  <th className="px-3 py-2">Operator</th>
                  <th className="px-3 py-2">Shift</th>
                  <th className="px-3 py-2 text-right">Hours</th>
                  <th className="px-3 py-2 text-center">Attendance</th>
                  <th className="px-3 py-2 text-center">Half day</th>
                  <th className="px-3 py-2">Status (foreman)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs font-bold text-slate-400">Loading…</td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs font-bold text-slate-500">
                    {search ? 'No operator matches the search.' : 'No roster for this date (maybe Sunday or not generated yet).'}
                  </td></tr>
                )}
                {filtered.map((r) => {
                  const required = Number(r.scheduled_standard_hours) || 0;
                  const recorded = Number(r.recorded_hours) || 0;
                  const over = recorded > required + 0.05;
                  return (
                    <tr key={r.serialnumber} className={`align-middle transition hover:bg-[#caf0f8]/25 ${r.half_day ? 'bg-amber-50/50' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="font-bold text-slate-800">{r.operator_name || r.serialnumber}</div>
                        <div className="font-mono text-[11px] text-slate-400">{r.serialnumber}</div>
                      </td>
                      <td className="px-3 py-2"><ShiftBadge shift={r.scheduled_shift} /></td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-slate-700">
                        {recorded.toFixed(1)} / {required.toFixed(0)}h
                        {over && <span className="ml-1 text-[10px] font-bold text-emerald-600">✓</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${ATTEND_STYLE[r.attendance] || ATTEND_STYLE.OFF}`}>
                          {r.attendance}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(r.half_day)}
                          disabled={savingKey === `half-${r.serialnumber}`}
                          onClick={() => toggleHalfDay(r.serialnumber, !r.half_day)}
                          title={r.half_day ? 'Required hours are halved (half day)' : 'Mark as half day — required hours halved'}
                          className={`relative inline-flex h-6 w-10 flex-shrink-0 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-[#00b4d8]/30 disabled:opacity-50 ${
                            r.half_day ? 'border-amber-500 bg-amber-400' : 'border-slate-400 bg-slate-200'
                          }`}
                        >
                          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${r.half_day ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={STATUS_OPTIONS.includes(r.status) ? r.status : 'SCHEDULED'}
                          disabled={savingKey === r.serialnumber}
                          onChange={(e) => changeStatus(r.serialnumber, e.target.value)}
                          className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] disabled:opacity-50"
                        >
                          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-[11px] font-semibold text-slate-400">
          Scheduled operators with no logs count as <b>Absent</b> (0) in the adoption KPI. Mark{' '}
          <b>Leave/Sick/Permit/Off</b> to exclude them from the calculation. <b>Half day</b> requires
          only half of the shift's standard hours.
        </p>
      </main>
    </div>
  );
}

export default EwsRosterPage;
