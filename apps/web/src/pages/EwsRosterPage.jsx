import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Loader2,
  RefreshCw, Search, Settings, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { authHeaders, readAuthUser } from '../rbac/useAuth';

import BulkPanel from '../components/ews-roster/BulkPanel';
import { EXCUSED, todayLocalISO } from '../components/ews-roster/rosterConstants';
import { MemoHeatmapCell, RosterLegend, StatTile } from '../components/ews-roster/rosterVisuals';
const API_BASE = import.meta.env.VITE_API_URL || '/api';
const DOW_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

function daysOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(y, m - 1, i + 1);
    const off = d.getTimezoneOffset() * 60000;
    const iso = new Date(d.getTime() - off).toISOString().slice(0, 10);
    return { date: iso, day: i + 1, dow: d.getDay() };
  });
}

function cellKey(sn, date) {
  return `${sn}|${date}`;
}
function EwsRosterPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(monthOf(todayLocalISO()));
  const [scope, setScope] = useState(() => {
    const u = readAuthUser();
    return String(u?.roles || '').toLowerCase().includes('foreman') ? 'team' : 'all';
  });
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const dragSel = useRef(null);
  const dragging = useRef(false);

  const days = useMemo(() => daysOfMonth(month), [month]);

  const load = useCallback(async (m, sc) => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/ews/roster/month?month=${encodeURIComponent(m)}&scope=${sc}`, { headers: authHeaders() });
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

  useEffect(() => { load(month, scope); }, [month, scope, load]);

  const operators = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.serialnumber)) map.set(r.serialnumber, r.operator_name || r.serialnumber);
    }
    const q = search.trim().toLowerCase();
    const list = [...map.entries()];
    return q ? list.filter(([, name]) => name.toLowerCase().includes(q)) : list;
  }, [rows, search]);

  const rowsByKey = useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(cellKey(r.serialnumber, r.business_date), r);
    return m;
  }, [rows]);

  const counts = useMemo(() => {
    const c = { scheduled: 0, present: 0, absent: 0, excused: 0, in_progress: 0, half_day: 0 };
    for (const r of rows) {
      if (r.half_day) c.half_day += 1;
      if (EXCUSED.includes(r.status)) c.excused += 1;
      else {
        c.scheduled += 1;
        if (r.attendance === 'PRESENT') c.present += 1;
        else if (r.attendance === 'ABSENT') c.absent += 1;
        else if (r.attendance === 'IN_PROGRESS') c.in_progress += 1;
      }
    }
    return c;
  }, [rows]);

  const changeMonth = (delta) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const startDrag = useCallback((e, ri, ci) => {
    e.preventDefault();
    dragging.current = true;
    dragSel.current = { r1: ri, c1: ci, r2: ri, c2: ci };
  }, []);
  const extendDrag = useCallback((ri, ci) => {
    if (dragging.current && dragSel.current) {
      dragSel.current.r2 = ri;
      dragSel.current.c2 = ci;
    }
  }, []);
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const s = dragSel.current;
    dragSel.current = null;
    if (!s) return;
    const rMin = Math.min(s.r1, s.r2);
    const rMax = Math.max(s.r1, s.r2);
    const cMin = Math.min(s.c1, s.c2);
    const cMax = Math.max(s.c1, s.c2);
    const next = new Set();
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const op = operators[r];
        const d = days[c];
        if (op && d) next.add(cellKey(op[0], d.date));
      }
    }
    if (next.size === 1) {
      const k = [...next][0];
      if (selected.has(k)) {
        next.clear();
        setPanelOpen(false);
      } else {
        setPanelOpen(true);
      }
    } else if (next.size > 1) {
      setPanelOpen(true);
    }
    setSelected(next);
  };

  useEffect(() => {
    const up = (e) => {
      if (dragging.current) {
        e.preventDefault();
        endDrag(e);
      }
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, operators, days]);

  const applyBulk = useCallback(async (payload) => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const j = await res.json();
      toast.success(`${j.data.rows_updated} row${j.data.rows_updated === 1 ? '' : 's'} updated`);
      setSelected(new Set());
      setPanelOpen(false);
      await load(month, scope);
    } catch (err) {
      toast.error(err.message || 'Failed to update roster');
    }
  }, [month, scope, load]);

  const deleteDay = useCallback(async (businessDate) => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_date: businessDate, updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const j = await res.json();
      toast.success(`${j.data.rows_deleted} rows deleted`);
      setSelected(new Set());
      setPanelOpen(false);
      await load(month, scope);
    } catch (err) {
      toast.error(err.message || 'Failed to delete day');
    }
  }, [month, scope, load]);

  const selectedKeys = useMemo(() => [...selected], [selected]);

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
              <h1 className="truncate text-base font-extrabold text-slate-900 md:text-lg">Attendance Heatmap</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
              <button type="button" onClick={() => changeMonth(-1)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" aria-label="Previous month">
                <ChevronLeft size={15} />
              </button>
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="w-36 bg-transparent px-1 text-sm font-bold text-slate-800 focus:outline-none"
              />
              <button type="button" onClick={() => changeMonth(1)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" aria-label="Next month">
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {[
                { key: 'team', label: 'My team' },
                { key: 'all', label: 'All operators' },
              ].map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setScope(o.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-extrabold transition ${scope === o.key ? 'bg-white text-[#0077b6] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => load(month, scope)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate('/ews/foreman-team')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition hover:border-[#90e0ef] hover:text-[#0077b6]"
            >
              <Users size={14} />
              Foreman Team
            </button>
            <button
              type="button"
              onClick={() => navigate('/ews/roster/config')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition hover:border-[#90e0ef] hover:text-[#0077b6]"
            >
              <Settings size={14} />
              Config
            </button>
          </div>
        </div>
      </header>

      <main className="flex gap-4 px-4 py-4 md:px-6">
        <div className="min-w-0 flex-1 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
          )}

          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile label="Scheduled days" value={counts.scheduled} tone="info" />
            <StatTile label="Present" value={counts.present} tone="good" />
            <StatTile label="Absent" value={counts.absent} tone={counts.absent > 0 ? 'bad' : 'good'} />
            <StatTile label="In Progress" value={counts.in_progress} tone="neutral" />
            <StatTile label="Excused" value={counts.excused} tone="neutral" />
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold text-slate-900">
                  {new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">
                  {operators.length} operators
                </span>
                {counts.half_day > 0 && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                    {counts.half_day} half days
                  </span>
                )}
              </div>
              <label className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search operator…"
                  className="h-8 w-52 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                />
              </label>
            </div>

            <div className="overflow-auto" style={{ maxHeight: '62vh' }}>
              {isLoading && operators.length === 0 ? (
                <div className="p-3" aria-hidden="true">
                  <div className="flex gap-1.5 pb-3">
                    <div className="h-4 w-44 rounded bg-slate-100 animate-pulse" />
                    {days.map((d) => (
                      <div key={d.date} className="h-4 flex-1 rounded bg-slate-100 animate-pulse" />
                    ))}
                  </div>
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="flex items-center gap-1.5 py-0.5">
                      <div className="h-5 w-44 rounded bg-slate-100 animate-pulse" />
                      {days.map((d) => (
                        <div key={d.date} className="h-7 w-7 flex-none rounded-md bg-slate-100 animate-pulse" />
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
              <table key={`${month}|${scope}`} className="border-separate border-spacing-0 text-left text-sm" style={{ animation: 'hm-fade 0.35s ease-out' }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 w-44 min-w-44 border-b border-r border-[#90e0ef] bg-[#caf0f8] px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-600">Operator</th>
                    {days.map((d) => (
                      <th key={d.date} className={`sticky top-0 z-10 border-b border-[#90e0ef] px-0.5 py-1 text-center ${d.dow === 0 || d.dow === 6 ? 'bg-amber-50' : 'bg-[#caf0f8]'}`}>
                        <div className="text-[9px] font-black uppercase text-slate-400">{DOW_LETTERS[d.dow]}</div>
                        <div className={`text-xs font-black tabular-nums ${d.dow === 0 || d.dow === 6 ? 'text-amber-700' : 'text-slate-700'}`}>{d.day}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!isLoading && operators.length === 0 && (
                    <tr><td colSpan={days.length + 1} className="px-3 py-8 text-center text-xs font-bold text-slate-500">
                      {search ? 'No operator matches the search.' : 'No roster for this month (maybe not generated yet).'}
                    </td></tr>
                  )}
                  {operators.map(([sn, name], ri) => (
                    <tr key={sn} className="group">
                      <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-2 py-1">
                        <div className="truncate text-xs font-bold text-slate-800 group-hover:text-[#0077b6]">{name}</div>
                        <div className="font-mono text-[10px] text-slate-400">{sn}</div>
                      </td>
                      {days.map((d, ci) => {
                        const key = cellKey(sn, d.date);
                        const row = rowsByKey.get(key);
                        const isSel = selected.has(key);
                        return (
                          <td key={d.date} className="p-0.5">
                            <MemoHeatmapCell
                              row={row}
                              selected={isSel}

                              onStart={startDrag}
                              onExtend={extendDrag}
                              ri={ri}
                              ci={ci}
                              name={name}
                              date={d.date}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
            <RosterLegend />
          </section>
        </div>

        {panelOpen && selectedKeys.length > 0 && (
          <BulkPanel
            selectedKeys={selectedKeys}
            rowsByKey={rowsByKey}
            onClose={() => { setPanelOpen(false); setSelected(new Set()); }}
            onClear={() => { setSelected(new Set()); setPanelOpen(false); }}
            onApply={applyBulk}
            onDeleteDay={deleteDay}
          />
        )}
      </main>
    </div>
  );
}

export default EwsRosterPage;
