import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart2,
  BookOpen,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Factory,
  Gauge,
  Hammer,
  LayoutDashboard,
  Loader2,
  LogOut,
  ClipboardList,
  Settings,
  ShieldCheck,
  TimerReset,
  Truck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import sapLogo from '../assets/sap.svg';

const API_BASE = import.meta.env.VITE_API_URL || '';
const SAP_LINKS = {
  PH3: 'https://fiori.abm-investama.co.id/',
  QH3: 'https://fioriqa-rise.abm-investama.co.id:44380/fiori',
};
const SAP_ENV_STORAGE_KEY = 'operationsHubSapEnv';

const sidebarItems = [
  { title: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { title: 'SOW Management', icon: BookOpen, path: '/sow-management/list' },
  { title: 'SOW Scheduling', icon: CalendarClock, path: '/sow-scheduling' },
  { title: 'Component Tracking', icon: Boxes, path: '/component-tracking' },
  { title: 'Receiving & Shipping', icon: Truck, path: '/receiving-shipment' },
  { title: 'Consumable Control', icon: ClipboardList, path: '/consumable-control' },
  { title: 'Tools Management', icon: Hammer, path: '/tools-management' },
  { title: 'Manage User', icon: UserCog, path: '/manage-user' },
  { title: 'TimeSheet', icon: ShieldCheck, path: '/timesheet-validation' },
  { title: 'Machine Hours', icon: Gauge, path: '/machine-hours-sqlserver' },
];

const emptyHubData = {
  kpi: {
    active_orders: 0,
    overdue_orders: 0,
    latest_labor_hours: 0,
    latest_machine_hours: 0,
    avg_progress: 0,
    validation_pending: 0,
    validation_total: 0,
    machine_productive_pct: 0,
  },
  basis_dates: {
    machine_date: null,
    labor_date: null,
  },
  machine_trend: [],
  machine_status: [],
  validation_queue: [],
  progress_status: [],
  order_summaries: [],
  recent_activities: [],
  top_machines: [],
};

const progressTones = ['bg-emerald-500', 'bg-sky-500', 'bg-indigo-500', 'bg-amber-500', 'bg-cyan-500', 'bg-slate-500'];

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(number);
}

function formatDateLabel(value) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTodayClock(value) {
  return value.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDateTimeLabel(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function progressTone(index) {
  return progressTones[index % progressTones.length];
}

function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

function readSapEnv() {
  try {
    const savedEnv = localStorage.getItem(SAP_ENV_STORAGE_KEY);
    return savedEnv === 'QH3' ? 'QH3' : 'PH3';
  } catch {
    return 'PH3';
  }
}

function DashboardCard({ children, className = '' }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

function StatCard({ title, value, helper, icon, tone }) {
  const IconComponent = icon;

  return (
    <DashboardCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-950">{value}</p>
        </div>
        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${tone}`}>
          {React.createElement(IconComponent, { size: 18 })}
        </div>
      </div>
      <p className="mt-2 truncate text-xs font-medium text-slate-500">{helper}</p>
    </DashboardCard>
  );
}

function Sidebar({ onNavigate, onLogout }) {
  return (
    <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-[260px] lg:flex-shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-100 px-4 py-4">
          <button
            type="button"
            onClick={() => onNavigate('/operations-hub')}
            className="flex w-full items-center gap-3 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0096c7] text-white shadow-sm">
              <Factory size={20} />
            </div>
            <div>
              <p className="text-sm font-extrabold text-slate-900">MPS</p>
              <p className="text-xs font-medium text-slate-500">Operations</p>
            </div>
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-3">
          {sidebarItems.map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => onNavigate(item.path)}
              className="flex min-h-[42px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-[#0077b6]">
                <item.icon size={18} />
              </span>
              {item.title}
            </button>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <button
            type="button"
            onClick={onLogout}
            className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <LogOut size={17} />
            Lock
          </button>
        </div>
      </div>
    </aside>
  );
}

function ChangePasswordPanel({ user, onClose }) {
  const [form, setForm] = useState({
    oldPassword: '',
    newPassword: '',
    retypeNewPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const canConfirm = Boolean(
    user?.username &&
    form.oldPassword &&
    form.newPassword &&
    form.retypeNewPassword &&
    form.newPassword === form.retypeNewPassword &&
    form.newPassword.length >= 5
  );

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canConfirm || loading) return;

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username,
          oldPassword: form.oldPassword,
          newPassword: form.newPassword,
          retypeNewPassword: form.retypeNewPassword,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Gagal ubah password');
      }

      setForm({ oldPassword: '', newPassword: '', retypeNewPassword: '' });
      setMessage({ type: 'success', text: 'Password berhasil diubah' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close change password panel"
      />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e8f7fb] text-[#0077b6]">
              <Settings size={22} />
            </div>
            <h2 className="mt-4 text-lg font-extrabold text-slate-950">Ubah Password</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Konfirmasi old password sebelum menyimpan password baru.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Username</p>
            <p className="mt-1 truncate text-sm font-extrabold text-slate-900">{user?.username || '-'}</p>
          </div>

          {!user?.username && (
            <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              Login melalui welcome page diperlukan untuk ubah password.
            </div>
          )}

          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Old Password
            </span>
            <input
              type="password"
              value={form.oldPassword}
              onChange={(event) => updateField('oldPassword', event.target.value)}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#00b4d8] focus:ring-4 focus:ring-cyan-100"
              autoComplete="current-password"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase tracking-wide text-slate-500">
              New Password
            </span>
            <input
              type="password"
              value={form.newPassword}
              onChange={(event) => updateField('newPassword', event.target.value)}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#00b4d8] focus:ring-4 focus:ring-cyan-100"
              autoComplete="new-password"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Retype New Password
            </span>
            <input
              type="password"
              value={form.retypeNewPassword}
              onChange={(event) => updateField('retypeNewPassword', event.target.value)}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#00b4d8] focus:ring-4 focus:ring-cyan-100"
              autoComplete="new-password"
            />
          </label>

          {form.retypeNewPassword && form.newPassword !== form.retypeNewPassword && (
            <p className="text-xs font-bold text-red-600">Retype new password belum sama.</p>
          )}

          {message && (
            <div className={`flex gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
              message.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}>
              {message.type === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!canConfirm || loading}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0077b6] px-4 text-sm font-extrabold text-white transition hover:bg-[#023e8a] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Confirm
          </button>
        </form>
      </aside>
    </div>
  );
}

function TrendChart({ data }) {
  const maxHours = Math.max(1, ...data.map((item) => Number(item.total_hours || 0)));

  return (
    <DashboardCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">Machine Activity</h2>
        </div>
        <span className="text-xs font-bold text-slate-400">7 days</span>
      </div>

      {data.length === 0 ? (
        <p className="py-16 text-center text-sm font-semibold text-slate-400">No machine activity data</p>
      ) : (
        <div className="mt-5 flex h-48 items-end gap-3 border-b border-slate-200 pb-3">
          {data.map((item) => {
            const productiveHeight = Math.max(4, (Number(item.productive_hours || 0) / maxHours) * 100);
            const supportHeight = Math.max(4, (Number(item.support_loss_hours || 0) / maxHours) * 100);
            return (
              <div key={item.day || item.label} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-36 w-full items-end justify-center gap-1.5">
                  <div
                    className="w-3 rounded-t-full bg-slate-200"
                    style={{ height: `${supportHeight}%` }}
                    title={`Support/loss ${formatNumber(item.support_loss_hours)} hrs`}
                  />
                  <div
                    className="w-3 rounded-t-full bg-[#0096c7]"
                    style={{ height: `${productiveHeight}%` }}
                    title={`Productive ${formatNumber(item.productive_hours)} hrs`}
                  />
                </div>
                <span className="text-[11px] font-bold text-slate-400">{item.label}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center gap-5 text-xs font-semibold text-slate-500">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
          Support
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#0096c7]" />
          Productive
        </span>
      </div>
    </DashboardCard>
  );
}

function ActivityList({ items }) {
  return (
    <DashboardCard className="p-5">
      <h2 className="text-sm font-extrabold text-slate-900">Activity</h2>
      <div className="mt-5 space-y-4">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm font-semibold text-slate-400">No recent activity</p>
        ) : items.map((item) => {
          const tone = item.type === 'machine'
            ? 'bg-sky-50 text-sky-700'
            : item.type === 'validation'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-indigo-50 text-indigo-700';
          return (
            <div key={`${item.title}-${item.event_ts}-${item.meta}`} className="flex gap-3">
              <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${tone}`}>
                <Activity size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800">{item.title}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{item.meta || '-'}</p>
              </div>
              <span className="text-[11px] font-semibold text-slate-400">{formatDateTimeLabel(item.event_ts)}</span>
            </div>
          );
        })}
      </div>
    </DashboardCard>
  );
}

function ValidationQueue({ items, onReview }) {
  return (
    <DashboardCard className="overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-extrabold text-slate-900">Validation Queue</h2>
          <button
            type="button"
            onClick={onReview}
            className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            Open
          </button>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm font-semibold text-slate-400">No pending validation</p>
        ) : items.map((item) => (
          <div key={`${item.operator}-${item.workcenter}-${item.latest_at}`} className="grid grid-cols-[1fr_auto] gap-3 px-5 py-4 sm:grid-cols-[1fr_82px_80px_auto] sm:items-center">
            <div>
              <p className="text-sm font-bold text-slate-800">{item.operator}</p>
              <p className="mt-0.5 text-xs text-slate-500">{item.workcenter}</p>
            </div>
            <p className="hidden text-sm font-bold text-slate-700 sm:block">{formatNumber(item.item_count)} item</p>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-center text-[11px] font-bold text-amber-700">
              {item.status}
            </span>
            <ChevronRight size={16} className="hidden text-slate-300 sm:block" />
          </div>
        ))}
      </div>
    </DashboardCard>
  );
}

function ProgressStatusCards({ items }) {
  return (
    <DashboardCard className="p-5">
      <h2 className="text-sm font-extrabold text-slate-900">Workcenter Progress</h2>
      <div className="mt-5 space-y-4">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm font-semibold text-slate-400">No SOW progress data</p>
        ) : items.map((item, index) => (
          <div key={item.label}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800">{item.label}</p>
                <p className="text-xs text-slate-500">{formatNumber(item.operation_count)} ops | {formatNumber(item.plan_hours)} plan hrs</p>
              </div>
              <p className="text-sm font-extrabold text-slate-900">{item.value}%</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${progressTone(index)}`} style={{ width: `${Math.min(Math.max(Number(item.value || 0), 0), 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </DashboardCard>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Order Progress Dashboard — plan vs actual with weight-based progress
// ══════════════════════════════════════════════════════════════════════
function OrderProgressDashboard() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [activityDetail, setActivityDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [filter, setFilter] = useState('all');
  const [tsHistory, setTsHistory] = useState(null);
  const [tsLoading, setTsLoading] = useState(false);
  const LIMIT = 20;

  const fetchOrders = useCallback(async (p = 1, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const status = (filter === 'ongoing') ? 'ongoing' : 'all';
      const filterParam = (filter === 'red' || filter === 'yellow') ? `&filter=${filter}` : '';
      const res = await fetch(`${API_BASE}/dashboard/order-progress?limit=${isExpanded ? LIMIT : 5}&page=${p}&status=${status}${filterParam}`);
      const json = await res.json();
      setOrders(json.data || []);
      setTotal(json.pagination?.total || 0);
    } catch { if (!silent) setOrders([]); }
    finally { if (!silent) setLoading(false); }
  }, [isExpanded, filter]);

  useEffect(() => {
    (async () => {
      try { await fetch(`${API_BASE}/dashboard/refresh-order-matviews`, { method: 'POST' }); } catch {}
      fetchOrders(1);
    })();
  }, [fetchOrders]);

  // Auto-refresh every 5 seconds (silent — no flicker)
  useEffect(() => {
    let active = true;
    const timer = setInterval(async () => {
      if (!active) return;
      try {
        await fetch(`${API_BASE}/dashboard/refresh-order-matviews`, { method: 'POST' });
      } catch {}
      if (active) fetchOrders(page, true);
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [fetchOrders, page]);

  const fetchDetail = async (orderNo) => {
    if (expandedOrder === orderNo) { setExpandedOrder(null); return; }
    setExpandedOrder(orderNo);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/order-activity-detail/${encodeURIComponent(orderNo)}`);
      const json = await res.json();
      setActivityDetail(json.data || []);
    } catch { setActivityDetail([]); }
    finally { setDetailLoading(false); }
  };

  // Sort: collapsed = by actual hours desc, expanded = already sorted by API
  const sortedOrders = isExpanded
    ? orders
    : [...orders].sort((a, b) => (b.total_actual_hours || 0) - (a.total_actual_hours || 0));

  const totalPlan = sortedOrders.reduce((s, o) => s + (o.total_planhours || 0), 0);
  const totalActual = sortedOrders.reduce((s, o) => s + (o.total_actual_hours || 0), 0);

  return (
    <DashboardCard className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-3">
          <button onClick={() => { setIsExpanded(v => !v); if (!isExpanded) setPage(1); }}>
            <ChevronRight size={16} className={`text-slate-400 transition ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">Order Progress</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Plan {formatNumber(totalPlan)}h / Actual {formatNumber(totalActual)}h
              {total > 0 && <span className="ml-2">· {total} orders</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isExpanded && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 mr-1">
              {[
                ['all', 'All'],
                ['ongoing', 'Ongoing'],
                ['red', 'Red'],
                ['yellow', 'Yellow'],
              ].map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-extrabold uppercase transition ${
                    filter === key
                      ? 'bg-[#0096c7] text-white'
                      : key === 'red' ? 'text-red-500 hover:bg-red-50'
                      : key === 'yellow' ? 'text-amber-500 hover:bg-amber-50'
                      : key === 'ongoing' ? 'text-emerald-500 hover:bg-emerald-50'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => fetchOrders(page)} disabled={loading} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <span className="text-[10px] text-slate-400">auto 5s</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3 font-bold w-8"></th>
              <th className="px-2 py-3 font-bold">SSBR ID</th>
              <th className="px-2 py-3 font-bold">Order No</th>
              <th className="px-2 py-3 font-bold">Part / Customer</th>
              <th className="px-2 py-3 font-bold w-[180px] text-center">Plan vs Actual</th>
              <th className="px-2 py-3 font-bold w-[140px] text-center">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && sortedOrders.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">Loading...</td></tr>
            ) : sortedOrders.map((o) => {
              const actualPct = Math.min(200, o.actual_pct || 0);
              const progPct = o.weighted_progress || 0;
              const isExpandedRow = expandedOrder === o.order_no;
              const barColor = o.is_exceeded ? 'bg-red-500' : actualPct >= 90 ? 'bg-amber-500' : 'bg-[#0096c7]';
              return (
                <React.Fragment key={o.order_no}>
                  <tr className={`hover:bg-slate-50 cursor-pointer ${isExpandedRow ? 'bg-[#caf0f8]/30' : ''}`}
                    onClick={() => fetchDetail(o.order_no)}>
                    <td className="px-3 py-2.5 text-center">
                      <ChevronRight size={14} className={`inline text-slate-400 transition ${isExpandedRow ? 'rotate-90' : ''}`} />
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="text-[10px] font-bold text-slate-500 truncate max-w-[80px] block">{o.ssbr_id || '-'}</span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="font-mono text-xs font-bold text-slate-700">{o.order_no}</span>
                      <span className="ml-1.5 text-[10px] text-slate-400">{o.operation_count} ops</span>
                    </td>
                    <td className="px-2 py-2.5">
                      <p className="text-xs font-semibold text-slate-800 truncate max-w-[200px]">{o.part_name || '-'}</p>
                      <p className="text-[10px] text-slate-400 truncate max-w-[200px]">{o.customer || '-'}</p>
                    </td>
                    <td className="px-2 py-2.5">
                      {/* Merged: bar + hours + icon in one container */}
                      <div className="flex flex-col gap-1">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                            style={{ width: `${Math.min(100, actualPct)}%` }} />
                        </div>
                        <div className="flex items-center justify-center whitespace-nowrap">
                          <span className={`text-[11px] w-12 text-center font-semibold ${o.is_exceeded ? 'text-red-600' : actualPct >= 90 ? 'text-amber-600' : 'text-[#0096c7]'}`}>
                            {formatNumber(o.total_actual_hours)}
                          </span>
                          <span className="text-[10px] text-slate-300 w-2 text-center">/</span>
                          <span className="text-[11px] w-12 text-center font-semibold text-slate-800">{formatNumber(o.total_planhours)}</span>
                          <span className="text-[10px] text-slate-400 w-3 ml-0.5">h</span>
                          
                          <span className="relative inline-flex items-center justify-center ml-0.5" style={{width:14,height:14}}>
                            <span key={`alert-${o.is_exceeded ? 'red' : actualPct >= 90 ? 'yellow' : 'none'}`}
                              className={`absolute inset-0 flex items-center justify-center transition-all duration-500 ease-out ${
                                o.is_exceeded || actualPct >= 90 ? 'opacity-100 scale-100' : 'opacity-0 scale-0'
                              }`}>
                              {o.is_exceeded
                                ? <AlertCircle size={14} className="text-red-500 animate-pulse" />
                                : actualPct >= 90
                                ? <AlertTriangle size={14} className="text-amber-500 animate-pulse" />
                                : <span className="w-3 h-3" />
                              }
                            </span>
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      {/* Merged: progress bar + percentage */}
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                            style={{ width: `${Math.min(100, progPct)}%` }} />
                        </div>
                        <span className="text-[10px] font-bold text-slate-600 w-10 text-right">{progPct}%</span>
                      </div>
                    </td>
                  </tr>
                  {isExpandedRow && (
                    <tr>
                      <td colSpan={6} className="bg-slate-50 px-4 py-2">
                        {detailLoading ? (
                          <div className="flex items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-[#0096c7]" /></div>
                        ) : activityDetail && activityDetail.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead><tr className="text-slate-500">
                                <th className="px-2 py-1.5 text-left">Op.No</th>
                                <th className="px-2 py-1.5 text-left">Operation Text</th>
                                <th className="px-2 py-1.5 text-left">WC</th>
                                <th className="px-2 py-1.5 text-right">Actual Hrs</th>
                                <th className="px-2 py-1.5 text-right">Plan Hrs</th>
                                <th className="px-2 py-1.5 text-right">Weight</th>
                                <th className="px-2 py-1.5 text-right">Progress</th>
                              </tr></thead>
                              <tbody className="divide-y divide-slate-200">
                                {activityDetail.map(a => {
                                  const tsHrs = a.actual_hours || 0;
                                  const pHrs = a.planhours || 0;
                                  const actColor = tsHrs > pHrs ? 'text-red-600' : tsHrs >= pHrs * 0.9 ? 'text-amber-600' : 'text-[#0096c7]';
                                  const histKey = `${a.order_no}-${a.operation_no}`;
                                  const showHist = tsHistory?.key === histKey;
                                  return (
                                    <React.Fragment key={histKey}>
                                      <tr className={`cursor-pointer hover:bg-sky-50 ${showHist ? 'bg-sky-50' : ''}`}
                                        onClick={async () => {
                                          if (showHist) { setTsHistory(null); return; }
                                          setTsHistory({ key: histKey, data: [] });
                                          setTsLoading(true);
                                          try {
                                            const res = await fetch(`${API_BASE}/dashboard/operation-timesheet-history?orderNo=${encodeURIComponent(a.order_no)}&operationNo=${encodeURIComponent(a.operation_no)}`);
                                            const json = await res.json();
                                            setTsHistory({ key: histKey, data: json.data || [] });
                                          } catch { setTsHistory({ key: histKey, data: [] }); }
                                          finally { setTsLoading(false); }
                                        }}>
                                        <td className="px-2 py-1 font-mono font-bold">{a.operation_no}</td>
                                        <td className="px-2 py-1 truncate max-w-[300px]" title={a.operation_text}>{a.operation_text || '-'}</td>
                                        <td className="px-2 py-1">{a.workcenter || '-'}</td>
                                        <td className={`px-2 py-1 text-right font-bold ${actColor}`}>{formatNumber(tsHrs)}</td>
                                        <td className="px-2 py-1 text-right font-semibold">{a.planhours > 0 ? formatNumber(a.planhours) : '-'}</td>
                                        <td className="px-2 py-1 text-right">{a.weight != null ? `${Math.round((a.weight || 0) * 100)}%` : '-'}</td>
                                        <td className="px-2 py-1 text-right font-bold">{a.progress != null ? `${(a.progress || 0) * 100}%` : '-'}</td>
                                      </tr>
                                      {showHist && (
                                        <tr>
                                          <td colSpan={7} className="bg-white px-4 py-2 border-t border-slate-100">
                                            {tsLoading ? (
                                              <Loader2 className="h-4 w-4 mx-auto animate-spin text-[#0096c7]" />
                                            ) : tsHistory.data.length > 0 ? (
                                              <table className="w-full text-[10px]">
                                                <thead><tr className="text-slate-400 uppercase">
                                                  <th className="px-2 py-1 text-left">Date</th>
                                                  <th className="px-2 py-1 text-left">Serial No</th>
                                                  <th className="px-2 py-1 text-left">Operator</th>
                                                  <th className="px-2 py-1 text-right">Hours</th>
                                                  <th className="px-2 py-1 text-right">Entries</th>
                                                </tr></thead>
                                                <tbody className="divide-y divide-slate-100">{tsHistory.data.map((r, i) => (
                                                  <tr key={i} className="text-slate-600">
                                                    <td className="px-2 py-1">{r.work_date}</td>
                                                    <td className="px-2 py-1 font-mono">{r.serialnumber || '-'}</td>
                                                    <td className="px-2 py-1 font-semibold">{r.full_name || '-'}</td>
                                                    <td className="px-2 py-1 text-right font-bold text-[#0096c7]">{formatNumber(r.total_hours)}</td>
                                                    <td className="px-2 py-1 text-right">{r.entry_count}</td>
                                                  </tr>
                                                ))}</tbody>
                                              </table>
                                            ) : (
                                              <p className="text-center text-slate-400 py-2">No timesheet records</p>
                                            )}
                                          </td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="py-2 text-center text-xs text-slate-400">No activity data</p>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {isExpanded && total > LIMIT && (
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <button disabled={page <= 1} onClick={() => { setPage(p => Math.max(1, p - 1)); fetchOrders(page - 1); }}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40">Prev</button>
          <span className="text-xs text-slate-400">Page {page} / {Math.ceil(total / LIMIT)}</span>
          <button disabled={page >= Math.ceil(total / LIMIT)} onClick={() => { setPage(p => p + 1); fetchOrders(page + 1); }}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40">Next</button>
        </div>
      )}
    </DashboardCard>
  );
}

function OrderSummaryTable({ items, onView }) {
  return (
    <DashboardCard className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">Orders</h2>
        </div>
        <button
          type="button"
          onClick={onView}
          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
        >
          View
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-bold">Order</th>
              <th className="px-4 py-3 font-bold">Part</th>
              <th className="px-4 py-3 font-bold">Owner</th>
              <th className="px-4 py-3 font-bold">Progress</th>
              <th className="px-5 py-3 font-bold">ETA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm font-semibold text-slate-400">No open order data</td>
              </tr>
            ) : items.map((item) => (
              <tr key={item.order_no} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs font-bold text-slate-700">{item.order_no}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{item.part_name || '-'}</td>
                <td className="px-4 py-3 text-slate-500">{item.owner || item.customer || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-[#0096c7]" style={{ width: `${item.progress}%` }} />
                    </div>
                    <span className="text-xs font-bold text-slate-600">{item.progress}%</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-xs font-bold text-slate-500">{formatDateLabel(item.eta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  );
}

function MachineStatusPanel({ statuses, machines }) {
  const totalStatusHours = statuses.reduce((sum, item) => sum + Number(item.hours || 0), 0);

  return (
    <DashboardCard className="p-5">
      <h2 className="text-sm font-extrabold text-slate-900">Machine Status</h2>

      <div className="mt-5 space-y-3">
        {statuses.length === 0 ? (
          <p className="py-5 text-center text-sm font-semibold text-slate-400">No status data</p>
        ) : statuses.slice(0, 5).map((item, index) => {
          const pct = totalStatusHours > 0 ? (Number(item.hours || 0) / totalStatusHours) * 100 : 0;
          return (
            <div key={item.status}>
              <div className="flex items-center justify-between gap-3 text-xs font-bold">
                <span className="truncate text-slate-700">{item.status}</span>
                <span className="text-slate-500">{formatNumber(item.hours)}h</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${progressTone(index)}`} style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="text-xs font-extrabold uppercase text-slate-500">Top Machines</h3>
        <div className="mt-3 space-y-2">
          {machines.length === 0 ? (
            <p className="py-3 text-center text-sm font-semibold text-slate-400">No machine data</p>
          ) : machines.slice(0, 4).map((item) => (
            <div key={`${item.machineno}-${item.machineid}`} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-extrabold text-slate-800">{item.machineid}</p>
                <p className="truncate text-[11px] text-slate-500">{item.machinename}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-extrabold text-slate-900">{formatNumber(item.total_hours)}h</p>
                <p className="text-[11px] text-slate-500">{formatNumber(item.productive_pct)}% prod</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardCard>
  );
}

function OperationsHubPage() {
  const navigate = useNavigate();
  const [isVerified, setIsVerified] = useState(() => sessionStorage.getItem('isVerified') === 'true');
  const [hubData, setHubData] = useState(emptyHubData);
  const [authUser, setAuthUser] = useState(readAuthUser);
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [sapEnv, setSapEnv] = useState(readSapEnv);
  const [kpiStatus, setKpiStatus] = useState(() => (
    sessionStorage.getItem('isVerified') === 'true' ? 'loading' : 'idle'
  ));

  useEffect(() => {
    if (!isVerified) {
      navigate('/welcome?login=admin', { replace: true });
    }
  }, [isVerified, navigate]);

  useEffect(() => {
    if (!isVerified) return undefined;
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [isVerified]);

  useEffect(() => {
    try {
      localStorage.setItem(SAP_ENV_STORAGE_KEY, sapEnv);
    } catch {
      // Ignore storage failures so the button still works.
    }
  }, [sapEnv]);

  useEffect(() => {
    if (!isVerified) return;

    const controller = new AbortController();

    fetch(`${API_BASE}/dashboard/operations-hub`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load dashboard');
        return response.json();
      })
      .then((payload) => {
        setHubData({ ...emptyHubData, ...(payload?.data || {}) });
        setKpiStatus('ready');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setHubData(emptyHubData);
        setKpiStatus('error');
      });

    return () => controller.abort();
  }, [isVerified]);

  const kpi = hubData.kpi;
  const summaryCards = useMemo(() => [
    {
      title: 'Active Orders',
      value: formatNumber(kpi.active_orders),
      helper: 'In progress',
      icon: Factory,
      tone: 'bg-sky-50 text-sky-700',
    },
    {
      title: 'Overdue Orders',
      value: formatNumber(kpi.overdue_orders),
      helper: 'Past due',
      icon: TimerReset,
      tone: 'bg-amber-50 text-amber-700',
    },
    {
      title: 'Latest Labor Hours',
      value: formatNumber(kpi.latest_labor_hours),
      helper: hubData.basis_dates.labor_date ? formatDateLabel(hubData.basis_dates.labor_date) : 'No date',
      icon: Activity,
      tone: 'bg-emerald-50 text-emerald-700',
    },
    {
      title: 'Machine Productive',
      value: `${formatNumber(kpi.machine_productive_pct)}%`,
      helper: hubData.basis_dates.machine_date ? formatDateLabel(hubData.basis_dates.machine_date) : 'No date',
      icon: BarChart2,
      tone: 'bg-indigo-50 text-indigo-700',
    },
  ], [hubData.basis_dates.labor_date, hubData.basis_dates.machine_date, kpi]);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem('isVerified');
    sessionStorage.removeItem('authUser');
    setAuthUser(null);
    setShowPasswordPanel(false);
    setIsVerified(false);
    setKpiStatus('idle');
  }, []);

  const handleReviewValidation = useCallback(() => {
    navigate('/timesheet-validation');
  }, [navigate]);

  const handleViewOrders = useCallback(() => {
    navigate('/sow-orders');
  }, [navigate]);

  const handleOpenSap = useCallback(() => {
    window.open(SAP_LINKS[sapEnv], '_blank', 'noopener,noreferrer');
  }, [sapEnv]);

  const handleToggleSapEnv = useCallback(() => {
    setSapEnv((current) => (current === 'PH3' ? 'QH3' : 'PH3'));
  }, []);

  const statusLabel = kpiStatus === 'ready'
    ? 'Live'
    : kpiStatus === 'error'
      ? 'Offline'
      : 'Loading';

  if (!isVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-semibold text-slate-500">
        Mengarahkan ke login...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-800 lg:flex">
      <Sidebar onNavigate={navigate} onLogout={handleLogout} />

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex flex-col gap-3 px-4 py-3 md:px-6 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-xl font-extrabold text-slate-950">Operations Hub</h1>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">
                {formatTodayClock(currentTime)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleOpenSap}
                className="flex h-[34px] w-[52px] items-center justify-center rounded-md border border-slate-200 bg-white transition hover:bg-slate-50"
                title={`Open SAP ${sapEnv}`}
                aria-label={`Open SAP ${sapEnv}`}
              >
                <img src={sapLogo} alt="" className="h-4 w-auto" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleToggleSapEnv}
                role="switch"
                aria-checked={sapEnv === 'QH3'}
                aria-label={`Switch SAP environment, current ${sapEnv}`}
                title={`Current SAP ${sapEnv}. Click to switch to ${sapEnv === 'PH3' ? 'QH3' : 'PH3'}`}
                className={`relative flex h-[34px] w-[84px] items-center rounded-full border px-3 text-[11px] font-extrabold transition ${
                  sapEnv === 'PH3'
                    ? 'border-cyan-200 bg-cyan-50 text-[#0077b6]'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-2 top-1/2 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${
                    sapEnv === 'PH3'
                      ? '-translate-y-1/2 translate-x-0'
                      : '-translate-y-1/2 translate-x-[50px]'
                  }`}
                />
                <span className="relative z-10 w-full text-center">{sapEnv}</span>
              </button>
              <span className={`rounded-md border px-2.5 py-2 text-xs font-bold ${
                kpiStatus === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}>
                {statusLabel}
              </span>
              <span className="inline-flex min-h-[34px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8f7fb] text-[#0077b6]">
                  <Users size={14} />
                </span>
                {authUser?.username || 'admin'}
              </span>
              <button
                type="button"
                onClick={() => setShowPasswordPanel(true)}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-[#90e0ef] hover:bg-cyan-50 hover:text-[#0077b6]"
                title="Ubah password"
                aria-label="Ubah password"
              >
                <Settings size={16} />
              </button>
            </div>
          </div>
        </header>

        {showPasswordPanel && (
          <ChangePasswordPanel
            user={authUser}
            onClose={() => setShowPasswordPanel(false)}
          />
        )}

        <div className="space-y-4 px-4 py-4 md:px-6">
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {summaryCards.map((card) => (
              <StatCard key={card.title} {...card} />
            ))}
          </section>

          <OrderProgressDashboard />

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <TrendChart data={hubData.machine_trend} />
            </div>
            <div className="xl:col-span-4">
              <ValidationQueue items={hubData.validation_queue} onReview={handleReviewValidation} />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-7">
              <OrderSummaryTable items={hubData.order_summaries} onView={handleViewOrders} />
            </div>
            <div className="xl:col-span-5">
              <MachineStatusPanel statuses={hubData.machine_status} machines={hubData.top_machines} />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-5">
              <ProgressStatusCards items={hubData.progress_status} />
            </div>
            <div className="xl:col-span-7">
              <ActivityList items={hubData.recent_activities} />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default OperationsHubPage;
