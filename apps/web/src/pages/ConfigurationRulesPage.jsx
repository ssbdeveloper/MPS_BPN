import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Clock, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { authHeaders } from '../rbac';

const API_BASE = import.meta.env.VITE_API_URL || '';

// DOW Postgres: 0=Sunday..6=Saturday (sama dengan EXTRACT(DOW) di staging SQL).
const DAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const EMPTY_WINDOW = { start: '12:00', end: '13:00', days: [] };

function timeToMinutes(t) {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
}

export default function ConfigurationRulesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [maxMinutes, setMaxMinutes] = useState(90);
  const [windows, setWindows] = useState([]);
  const [rebuildDate, setRebuildDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/config/rules`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      const rules = payload?.data || {};
      setWindows(Array.isArray(rules.break_windows) ? rules.break_windows : []);
      setMaxMinutes(Number(rules.max_record_minutes) || 90);
    } catch (err) {
      toast.error(`Failed to load rules: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const invalidWindows = useMemo(() => windows.filter((w) => {
    const validTime = timeToMinutes(w.start) < timeToMinutes(w.end);
    return !validTime || w.days.length === 0;
  }), [windows]);

  const updateWindow = (index, patch) => {
    setWindows((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  };

  const toggleDay = (index, day) => {
    setWindows((prev) => prev.map((w, i) => {
      if (i !== index) return w;
      const days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day];
      return { ...w, days };
    }));
  };

  const handleSave = async () => {
    if (invalidWindows.length > 0) {
      toast.error('Each break window needs start < end and at least one day.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/config/rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ break_windows: windows, max_record_minutes: maxMinutes }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      toast.success('Rules saved. Applies to the next staging run.');
    } catch (err) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRebuild = async () => {
    if (!rebuildDate) {
      toast.error('Pick a rebuild start date.');
      return;
    }
    setRebuilding(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-ops/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'rebuild_pending', params: { from_date: rebuildDate } }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      toast.success('Pending queue rebuild queued from the selected date.');
    } catch (err) {
      toast.error(`Failed to queue rebuild: ${err.message}`);
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-300 bg-white px-4 py-3 md:px-6">
        <div>
          <h1 className="text-sm font-extrabold text-slate-900">Configuration Rules</h1>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">Break hours &amp; max record duration — SAP staging</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || invalidWindows.length > 0}
            className="flex min-h-[34px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-3 text-xs font-extrabold text-white shadow-sm transition hover:bg-[#023e8a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Rules
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-4 md:px-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm font-semibold text-slate-400">
            <Loader2 size={16} className="mr-2 animate-spin" /> Loading rules…
          </div>
        ) : (
          <>
            {/* Break hours */}
            <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-[#0077b6]" />
                <h2 className="text-sm font-extrabold text-slate-900">Break Hours</h2>
                <span className="text-xs font-semibold text-slate-500">— not counted from productive records</span>
              </div>

              <div className="mt-4 space-y-3">
                {windows.map((w, index) => (
                  <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="time"
                        value={w.start}
                        onChange={(e) => updateWindow(index, { start: e.target.value })}
                        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700"
                      />
                      <span className="text-xs font-bold text-slate-400">to</span>
                      <input
                        type="time"
                        value={w.end}
                        onChange={(e) => updateWindow(index, { end: e.target.value })}
                        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700"
                      />
                      <div className="flex flex-wrap items-center gap-1">
                        {DAY_OPTIONS.map((d) => {
                          const active = w.days.includes(d.value);
                          return (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => toggleDay(index, d.value)}
                              className={`min-h-[26px] rounded-md px-2 text-[11px] font-extrabold transition ${
                                active
                                  ? 'bg-[#0077b6] text-white shadow-sm'
                                  : 'border border-slate-300 bg-white text-slate-500 hover:bg-slate-100'
                              }`}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => setWindows((prev) => prev.filter((_, i) => i !== index))}
                        className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {w.days.length === 0 && (
                      <p className="mt-1.5 text-[11px] font-semibold text-red-600">Select at least one day</p>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setWindows((prev) => [...prev, { ...EMPTY_WINDOW }])}
                className="mt-3 flex min-h-[32px] items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 text-xs font-extrabold text-slate-500 transition hover:border-[#0077b6] hover:text-[#0077b6]"
              >
                <Plus size={14} /> Add break window
              </button>
            </section>

            {/* Max record duration */}
            <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-extrabold text-slate-900">Max Record Duration</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={maxMinutes}
                  onChange={(e) => setMaxMinutes(Number(e.target.value) || 0)}
                  className="h-8 w-24 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700"
                />
                <span className="text-xs font-semibold text-slate-500">minutes per record — longer records are cut, the rest is ignored</span>
              </div>
            </section>

            {/* Rebuild pending */}
            <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-extrabold text-slate-900">Rebuild Pending Queue</h2>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">
                Re-stage PENDING bundles from a start date with the current rules (posted rows untouched).
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={rebuildDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setRebuildDate(e.target.value)}
                  className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700"
                />
                <button
                  type="button"
                  onClick={handleRebuild}
                  disabled={rebuilding}
                  className="flex min-h-[32px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-3 text-xs font-extrabold text-white shadow-sm transition hover:bg-[#023e8a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rebuilding ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Rebuild pending
                </button>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
