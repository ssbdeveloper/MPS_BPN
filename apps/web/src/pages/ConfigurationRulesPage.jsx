import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { authHeaders } from '../rbac';
import { sidebarItems, HUB_HIDDEN_MENUS_KEY, getHiddenHubMenus } from '../config/hubSidebarItems';

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

// ── Config palsu (hanya tampilan, TIDAK berpengaruh ke sistem apa pun) ──────
const FAKE_SETTINGS_KEY = 'mps2.configRulesFakeSettings';
const FAKE_DEFAULTS = {
  max_shift_hours: 8,
  grace_minutes: 5,
  auto_refresh_seconds: 60,
  notify_on_post: true,
  notify_on_failed: true,
  dark_chart: false,
  language: 'id',
};

function timeToMinutes(t) {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
}

function loadFakeSettings() {
  try {
    return { ...FAKE_DEFAULTS, ...(JSON.parse(localStorage.getItem(FAKE_SETTINGS_KEY) || '{}')) };
  } catch {
    return { ...FAKE_DEFAULTS };
  }
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 flex-shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]/30 ${
        checked ? 'border-[#0077b6] bg-[#0077b6]' : 'border-slate-400 bg-slate-200'
      }`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function SectionCard({ icon: Icon, title, subtitle, children, accent = '#0077b6' }) {
  const IconComponent = Icon;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-400/60 bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-slate-300 bg-slate-50/60 px-5 py-3.5">
        <span
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
          style={{ background: accent }}
        >
          {IconComponent && <IconComponent size={17} />}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-slate-900">{title}</h2>
          {subtitle && <p className="truncate text-[11px] font-semibold text-slate-500">{subtitle}</p>}
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function ConfigurationRulesPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [maxMinutes, setMaxMinutes] = useState(90);
  const [windows, setWindows] = useState([]);
  const [rebuildDate, setRebuildDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hiddenMenus, setHiddenMenus] = useState(() => getHiddenHubMenus());
  const [fake, setFake] = useState(() => loadFakeSettings());

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

  // ── break windows ──────────────────────────────────────────────────────────
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

  // ── hide from hub (visual only, per browser) ───────────────────────────────
  const toggleMenuHidden = (path) => {
    setHiddenMenus((prev) => {
      const next = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
      localStorage.setItem(HUB_HIDDEN_MENUS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const menuGroups = useMemo(() => {
    const map = new Map();
    for (const item of sidebarItems) {
      const key = item.group || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()];
  }, []);

  // ── config palsu (tidak berpengaruh apa pun) ───────────────────────────────
  const updateFake = (key, value) => {
    setFake((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(FAKE_SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
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
    <div className="flex min-h-dvh flex-col bg-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-20 flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-300 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/operations-hub')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-400 bg-white text-slate-600 shadow-sm transition hover:border-[#90e0ef] hover:bg-cyan-50 hover:text-[#0077b6]"
            title="Back to Operations Hub"
            aria-label="Back to Operations Hub"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-extrabold text-slate-900">Configuration Rules</h1>
            <p className="truncate text-[11px] font-semibold text-slate-500">
              Break hours · max record duration · hub navigation
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-400 bg-white px-3 text-xs font-extrabold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || invalidWindows.length > 0}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-[#0077b6] px-3.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-[#023e8a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Rules
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 md:px-6">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-sm font-semibold text-slate-400">
            <Loader2 size={16} className="mr-2 animate-spin" /> Loading rules…
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
            {/* ── Kolom utama (kiri) ─────────────────────────────────────── */}
            <div className="space-y-5 xl:col-span-8">
              {/* Break hours */}
              <SectionCard
                icon={Clock}
                title="Break Hours"
                subtitle="Non-productive activity inside these windows is not counted. Productive activity is always counted in full."
              >
                <div className="space-y-3">
                  {windows.map((w, index) => (
                    <div key={index} className="rounded-xl border border-slate-300 bg-slate-50/70 p-3.5 transition hover:border-slate-400">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="time"
                            value={w.start}
                            onChange={(e) => updateWindow(index, { start: e.target.value })}
                            className="h-9 rounded-lg border border-slate-400 bg-white px-2.5 text-xs font-bold text-slate-700 focus:border-[#00b4d8] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]/20"
                          />
                          <span className="text-xs font-bold text-slate-400">to</span>
                          <input
                            type="time"
                            value={w.end}
                            onChange={(e) => updateWindow(index, { end: e.target.value })}
                            className="h-9 rounded-lg border border-slate-400 bg-white px-2.5 text-xs font-bold text-slate-700 focus:border-[#00b4d8] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]/20"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {DAY_OPTIONS.map((d) => {
                            const active = w.days.includes(d.value);
                            return (
                              <button
                                key={d.value}
                                type="button"
                                onClick={() => toggleDay(index, d.value)}
                                className={`min-h-[28px] rounded-lg border px-2.5 text-[11px] font-extrabold transition ${
                                  active
                                    ? 'border-[#0077b6] bg-[#0077b6] text-white shadow-sm'
                                    : 'border-slate-400 bg-white text-slate-500 hover:border-[#0077b6] hover:text-[#0077b6]'
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
                          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                          title="Remove"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {w.days.length === 0 && (
                        <p className="mt-2 text-[11px] font-semibold text-red-600">Select at least one day</p>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setWindows((prev) => [...prev, { ...EMPTY_WINDOW }])}
                  className="mt-3 flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-slate-400 px-3.5 text-xs font-extrabold text-slate-500 transition hover:border-[#0077b6] hover:text-[#0077b6]"
                >
                  <Plus size={14} /> Add break window
                </button>
              </SectionCard>

              {/* General Settings (config palsu — tidak berpengaruh apa pun) */}
              <SectionCard
                icon={Settings2}
                title="General Settings"
                subtitle="Informational preferences — these do not affect the system."
                accent="#64748b"
              >
                <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-700">Max shift hours</p>
                      <p className="text-[10px] font-semibold text-slate-400">Display preference</p>
                    </div>
                    <input
                      type="number"
                      min={1}
                      value={fake.max_shift_hours}
                      onChange={(e) => updateFake('max_shift_hours', Number(e.target.value) || 0)}
                      className="h-9 w-20 rounded-lg border border-slate-400 bg-white px-2 text-xs font-bold text-slate-700"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-700">Check-in grace period</p>
                      <p className="text-[10px] font-semibold text-slate-400">minutes</p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={fake.grace_minutes}
                      onChange={(e) => updateFake('grace_minutes', Number(e.target.value) || 0)}
                      className="h-9 w-20 rounded-lg border border-slate-400 bg-white px-2 text-xs font-bold text-slate-700"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-700">Auto refresh</p>
                      <p className="text-[10px] font-semibold text-slate-400">seconds</p>
                    </div>
                    <input
                      type="number"
                      min={5}
                      value={fake.auto_refresh_seconds}
                      onChange={(e) => updateFake('auto_refresh_seconds', Number(e.target.value) || 0)}
                      className="h-9 w-20 rounded-lg border border-slate-400 bg-white px-2 text-xs font-bold text-slate-700"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-700">Language</p>
                      <p className="text-[10px] font-semibold text-slate-400">Interface</p>
                    </div>
                    <select
                      value={fake.language}
                      onChange={(e) => updateFake('language', e.target.value)}
                      className="h-9 rounded-lg border border-slate-400 bg-white px-2 text-xs font-bold text-slate-700"
                    >
                      <option value="id">Bahasa Indonesia</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-700">Notify on SAP post</p>
                      <p className="text-[10px] font-semibold text-slate-400">Notification</p>
                    </div>
                    <Toggle
                      checked={fake.notify_on_post}
                      onChange={(v) => updateFake('notify_on_post', v)}
                      label="Notify on SAP post"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-700">Notify on failed post</p>
                      <p className="text-[10px] font-semibold text-slate-400">Notification</p>
                    </div>
                    <Toggle
                      checked={fake.notify_on_failed}
                      onChange={(v) => updateFake('notify_on_failed', v)}
                      label="Notify on failed post"
                    />
                  </div>
                </div>
              </SectionCard>
            </div>

            {/* ── Kolom kanan (rail) ─────────────────────────────────────── */}
            <div className="space-y-5 xl:col-span-4">
              {/* Max record duration */}
              <SectionCard
                icon={SlidersHorizontal}
                title="Max Record Duration"
                subtitle="One timesheet/machine record may not exceed this — longer records are cut, the rest is ignored."
              >
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    value={maxMinutes}
                    onChange={(e) => setMaxMinutes(Number(e.target.value) || 0)}
                    className="h-10 w-28 rounded-xl border border-slate-400 bg-white px-3 text-sm font-extrabold text-slate-800 focus:border-[#00b4d8] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]/20"
                  />
                  <span className="text-sm font-bold text-slate-700">minutes</span>
                  <span className="mt-1 w-full rounded-full bg-slate-100 px-2.5 py-1 text-center text-[11px] font-bold text-slate-500">
                    applied in SAP staging
                  </span>
                </div>
              </SectionCard>

              {/* Rebuild pending */}
              <SectionCard
                icon={RefreshCw}
                title="Rebuild Pending Queue"
                subtitle="Re-stage PENDING bundles from a start date with the current rules. Posted rows are never touched."
                accent="#059669"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="date"
                    value={rebuildDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setRebuildDate(e.target.value)}
                    className="h-9 flex-1 rounded-lg border border-slate-400 bg-white px-2.5 text-xs font-bold text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={handleRebuild}
                    disabled={rebuilding}
                    className="flex h-9 items-center gap-1.5 rounded-xl bg-[#0077b6] px-3.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-[#023e8a] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {rebuilding ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Rebuild pending
                  </button>
                  <span className="w-full rounded-full bg-emerald-50 px-2.5 py-1 text-center text-[11px] font-bold text-emerald-700">
                    runs via sap-ops-worker
                  </span>
                </div>
              </SectionCard>
            </div>

            {/* ── Full width (paling akhir): Hub navigation visibility ──── */}
            <div className="xl:col-span-12">
              <SectionCard
                icon={Eye}
                title="Operations Hub Navigation"
                subtitle="Hide menu items from the Operations Hub sidebar. Visual only — access & permissions are unchanged."
              >
                <div className="space-y-4">
                  {menuGroups.map(([group, items]) => (
                    <div key={group}>
                      <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                        {group}
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {items.map((item) => {
                          const hidden = hiddenMenus.includes(item.path);
                          const IconComponent = item.icon;
                          return (
                            <div
                              key={item.path}
                              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                                hidden
                                  ? 'border-slate-300 bg-slate-50 opacity-55'
                                  : 'border-slate-300 bg-white hover:border-slate-400'
                              }`}
                            >
                              <span
                                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                                  hidden ? 'bg-slate-200 text-slate-400' : 'bg-slate-100 text-[#0077b6]'
                                }`}
                              >
                                {IconComponent && <IconComponent size={15} />}
                              </span>
                              <span
                                className={`min-w-0 flex-1 truncate text-xs font-bold ${
                                  hidden ? 'text-slate-400 line-through' : 'text-slate-700'
                                }`}
                              >
                                {item.title}
                              </span>
                              <span className="flex items-center gap-1.5">
                                {hidden && (
                                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-slate-500">
                                    Hidden
                                  </span>
                                )}
                                <Toggle
                                  checked={!hidden}
                                  onChange={() => toggleMenuHidden(item.path)}
                                  label={`Show ${item.title} in hub`}
                                />
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                  <p className="text-[11px] font-bold text-amber-700">
                    Hidden items stay hidden only in this browser (per user). Nothing is deleted or disabled.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setHiddenMenus([]); localStorage.setItem(HUB_HIDDEN_MENUS_KEY, '[]'); }}
                    className="flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 text-[11px] font-extrabold text-amber-700 shadow-sm transition hover:bg-amber-100"
                  >
                    <EyeOff size={13} /> Show all
                  </button>
                </div>
              </SectionCard>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
