import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart2,
  BookOpen,
  CheckCircle,
  ChevronRight,
  Eye,
  EyeOff,
  Factory,
  LayoutDashboard,
  Lock,
  LogOut,
  Package,
  ShieldCheck,
  TimerReset,
  Truck,
  Users,
} from 'lucide-react';

const ADMIN_PASSWORD = 'adminssbuye';
const API_BASE = import.meta.env.VITE_API_URL || '';

const demoKpi = {
  active_orders: 128,
  overdue_orders: 9,
  today_hours: 386.5,
  avg_progress: 74.2,
};

const sidebarItems = [
  { title: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { title: 'SOW Management', icon: BookOpen, path: '/sow-management/list' },
  { title: 'Component Tracking', icon: Package, path: '/component-tracking' },
  { title: 'Receiving & Shipping', icon: Truck, path: '/receiving-shipment' },
  { title: 'Manage User', icon: Users, path: '/nfc-users' },
  { title: 'Validation', icon: ShieldCheck, path: '/timesheet-validation' },
];

const trendData = [
  { label: 'Mon', plan: 72, actual: 64 },
  { label: 'Tue', plan: 80, actual: 76 },
  { label: 'Wed', plan: 68, actual: 71 },
  { label: 'Thu', plan: 92, actual: 84 },
  { label: 'Fri', plan: 88, actual: 91 },
  { label: 'Sat', plan: 70, actual: 66 },
  { label: 'Sun', plan: 62, actual: 58 },
];

const recentActivities = [
  { title: 'SOW operation updated', meta: 'Order 70013821 - OP 0030', time: '12 min ago', tone: 'bg-sky-50 text-sky-700' },
  { title: 'Timesheet validated', meta: '24 rows approved by foreman', time: '28 min ago', tone: 'bg-emerald-50 text-emerald-700' },
  { title: 'Progress photo uploaded', meta: 'Component line boring - 85%', time: '44 min ago', tone: 'bg-indigo-50 text-indigo-700' },
  { title: 'SAP posting requires review', meta: '3 records returned warning status', time: '1 hr ago', tone: 'bg-amber-50 text-amber-700' },
];

const validationQueue = [
  { operator: 'Rizky Firmansyah', workcenter: 'WELD-02', hours: 8.0, status: 'Ready' },
  { operator: 'Andi Pratama', workcenter: 'MACH-05', hours: 6.5, status: 'Pending' },
  { operator: 'Dewi Kartika', workcenter: 'ASSY-01', hours: 7.5, status: 'Ready' },
  { operator: 'Budi Santoso', workcenter: 'QC-03', hours: 5.0, status: 'Review' },
];

const progressCards = [
  { label: 'Fabrication', value: 82, helper: 'On schedule', tone: 'bg-emerald-500' },
  { label: 'Machining', value: 68, helper: 'Capacity tight', tone: 'bg-sky-500' },
  { label: 'Assembly', value: 74, helper: 'Stable progress', tone: 'bg-indigo-500' },
  { label: 'Quality Check', value: 57, helper: 'Needs follow-up', tone: 'bg-amber-500' },
];

const orderSummaries = [
  { order: '70013821', part: 'Bucket Assembly', owner: 'Fabrication', progress: 82, eta: 'Today' },
  { order: '70014110', part: 'Boom Structure', owner: 'Machining', progress: 68, eta: 'Tomorrow' },
  { order: '70014208', part: 'Frame Rebuild', owner: 'Assembly', progress: 74, eta: 'Apr 29' },
  { order: '70014432', part: 'Cylinder Guard', owner: 'Quality', progress: 57, eta: 'May 02' },
];

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(number);
}

function DashboardCard({ children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
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
          <p className="text-xs font-semibold text-slate-500">{title}</p>
          <p className="mt-1.5 text-2xl font-extrabold text-slate-950">{value}</p>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}>
          {React.createElement(IconComponent, { size: 20 })}
        </div>
      </div>
      <p className="mt-2 text-xs font-medium text-slate-500">{helper}</p>
    </DashboardCard>
  );
}

function Sidebar({ onNavigate, onLogout }) {
  return (
    <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-[280px] lg:flex-shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-100 px-5 py-5">
          <button
            type="button"
            onClick={() => onNavigate('/operations-hub')}
            className="flex w-full items-center gap-3 rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0096c7] text-white shadow-sm">
              <Factory size={22} />
            </div>
            <div>
              <p className="text-base font-extrabold text-slate-900">MPS Main</p>
              <p className="text-xs font-medium text-slate-500">Manufacturing Performance System</p>
            </div>
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {sidebarItems.map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => onNavigate(item.path)}
              className="flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-[#0077b6]">
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
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <LogOut size={17} />
            Lock Session
          </button>
        </div>
      </div>
    </aside>
  );
}

function TrendChart() {
  return (
    <DashboardCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-900">Production Trend</h2>
          <p className="mt-1 text-xs text-slate-500">Planned vs actual output this week.</p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          +8.4%
        </span>
      </div>

      <div className="mt-5 flex h-48 items-end gap-3 border-b border-slate-200 pb-3">
        {trendData.map((item) => (
          <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-36 w-full items-end justify-center gap-1.5">
              <div
                className="w-3 rounded-t-full bg-slate-200"
                style={{ height: `${item.plan}%` }}
                title={`Plan ${item.plan}%`}
              />
              <div
                className="w-3 rounded-t-full bg-[#0096c7]"
                style={{ height: `${item.actual}%` }}
                title={`Actual ${item.actual}%`}
              />
            </div>
            <span className="text-[11px] font-bold text-slate-400">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-5 text-xs font-semibold text-slate-500">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
          Plan
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#0096c7]" />
          Actual
        </span>
      </div>
    </DashboardCard>
  );
}

function ActivityList() {
  return (
    <DashboardCard className="p-5">
      <h2 className="text-base font-extrabold text-slate-900">Recent Activity</h2>
      <div className="mt-5 space-y-4">
        {recentActivities.map((item) => (
          <div key={`${item.title}-${item.time}`} className="flex gap-3">
            <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${item.tone}`}>
              <Activity size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800">{item.title}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">{item.meta}</p>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">{item.time}</span>
          </div>
        ))}
      </div>
    </DashboardCard>
  );
}

function ValidationQueue() {
  return (
    <DashboardCard className="overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-base font-extrabold text-slate-900">Validation Queue</h2>
        <p className="mt-1 text-xs text-slate-500">Timesheets waiting for foreman review.</p>
      </div>
      <div className="divide-y divide-slate-100">
        {validationQueue.map((item) => (
          <div key={`${item.operator}-${item.workcenter}`} className="grid grid-cols-[1fr_auto] gap-3 px-5 py-4 sm:grid-cols-[1fr_90px_80px_auto] sm:items-center">
            <div>
              <p className="text-sm font-bold text-slate-800">{item.operator}</p>
              <p className="mt-0.5 text-xs text-slate-500">{item.workcenter}</p>
            </div>
            <p className="hidden text-sm font-bold text-slate-700 sm:block">{item.hours}h</p>
            <span
              className={`rounded-full px-2.5 py-1 text-center text-[11px] font-bold ${
                item.status === 'Ready'
                  ? 'bg-emerald-50 text-emerald-700'
                  : item.status === 'Review'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-100 text-slate-600'
              }`}
            >
              {item.status}
            </span>
            <button className="hidden h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 sm:inline-flex">
              Review
              <ChevronRight size={14} />
            </button>
          </div>
        ))}
      </div>
    </DashboardCard>
  );
}

function ProgressStatusCards() {
  return (
    <DashboardCard className="p-5">
      <h2 className="text-base font-extrabold text-slate-900">Progress Status</h2>
      <div className="mt-5 space-y-4">
        {progressCards.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800">{item.label}</p>
                <p className="text-xs text-slate-500">{item.helper}</p>
              </div>
              <p className="text-sm font-extrabold text-slate-900">{item.value}%</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${item.tone}`} style={{ width: `${item.value}%` }} />
            </div>
          </div>
        ))}
      </div>
    </DashboardCard>
  );
}

function OrderSummaryTable() {
  return (
    <DashboardCard className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-900">Order Summary</h2>
          <p className="mt-1 text-xs text-slate-500">Selected production orders by workstream.</p>
        </div>
        <button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
          View all
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
            {orderSummaries.map((item) => (
              <tr key={item.order} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs font-bold text-slate-700">{item.order}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{item.part}</td>
                <td className="px-4 py-3 text-slate-500">{item.owner}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-[#0096c7]" style={{ width: `${item.progress}%` }} />
                    </div>
                    <span className="text-xs font-bold text-slate-600">{item.progress}%</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-xs font-bold text-slate-500">{item.eta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  );
}

function OperationsHubPage() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [isVerified, setIsVerified] = useState(() => sessionStorage.getItem('isVerified') === 'true');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [kpi, setKpi] = useState(demoKpi);
  const [kpiStatus, setKpiStatus] = useState(() => (
    sessionStorage.getItem('isVerified') === 'true' ? 'loading' : 'idle'
  ));

  useEffect(() => {
    if (!isVerified && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isVerified]);

  useEffect(() => {
    if (!isVerified) return;

    const controller = new AbortController();

    fetch(`${API_BASE}/dashboard/kpi`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load KPI');
        return response.json();
      })
      .then((payload) => {
        setKpi({ ...demoKpi, ...(payload?.data || {}) });
        setKpiStatus('ready');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setKpi(demoKpi);
        setKpiStatus('demo');
      });

    return () => controller.abort();
  }, [isVerified]);

  const summaryCards = [
    {
      title: 'Active Orders',
      value: formatNumber(kpi.active_orders),
      helper: 'Open production orders in progress',
      icon: Factory,
      tone: 'bg-sky-50 text-sky-700',
    },
    {
      title: 'Overdue Orders',
      value: formatNumber(kpi.overdue_orders),
      helper: 'Orders that need attention',
      icon: TimerReset,
      tone: 'bg-amber-50 text-amber-700',
    },
    {
      title: 'Today Hours',
      value: formatNumber(kpi.today_hours),
      helper: 'Recorded manufacturing hours',
      icon: Activity,
      tone: 'bg-emerald-50 text-emerald-700',
    },
    {
      title: 'Avg Progress',
      value: `${formatNumber(kpi.avg_progress)}%`,
      helper: 'Average active order completion',
      icon: BarChart2,
      tone: 'bg-indigo-50 text-indigo-700',
    },
  ];

  const handleVerify = (event) => {
    event.preventDefault();

    if (!password.trim()) {
      navigate('/login-timesheet');
      return;
    }

    if (password === ADMIN_PASSWORD) {
      sessionStorage.setItem('isVerified', 'true');
      setKpiStatus('loading');
      setIsVerified(true);
      setError('');
      return;
    }

    setError('Password salah. Anda akan diarahkan ke Timesheet.');
    setPassword('');
    setTimeout(() => navigate('/login-timesheet'), 1000);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('isVerified');
    setIsVerified(false);
    setKpiStatus('idle');
    setPassword('');
  };

  if (!isVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-cyan-50 px-4 py-8">
        <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-200 bg-white px-6 py-6">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#0096c7] text-white">
              <Lock size={24} />
            </div>
            <h1 className="text-xl font-extrabold text-slate-900">MPS Main</h1>
            <p className="mt-1 text-sm text-slate-500">
              Manufacturing Performance System. Masukkan password admin, atau kosongkan untuk masuk ke Timesheet.
            </p>
          </div>

          <form onSubmit={handleVerify} className="space-y-4 px-6 py-6">
            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-600">
                Password Admin
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError('');
                  }}
                  placeholder="Masukkan password"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 pr-12 text-sm text-slate-800 placeholder-slate-400 transition-all focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="h-12 w-full rounded-xl bg-[#0096c7] text-sm font-bold text-white transition-all hover:bg-[#0077b6] active:scale-[0.98]"
            >
              Masuk
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-800 lg:flex">
      <Sidebar onNavigate={navigate} onLogout={handleLogout} />

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex flex-col gap-4 px-4 py-4 md:px-6 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0096c7]">MPS Main</p>
              <h1 className="mt-1 text-2xl font-extrabold text-slate-950">
                Manufacturing Performance System
              </h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                Control production visibility, SOW standards, component tracking, user access, and validation from one clean dashboard.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
                System healthy
              </span>
              <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700">
                {kpiStatus === 'ready' ? 'Live KPI' : 'Demo fallback'}
              </span>
            </div>
          </div>
        </header>

        <div className="space-y-4 px-4 py-4 md:px-6">
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <DashboardCard className="overflow-hidden p-5 xl:col-span-8">
              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[1fr_300px] 2xl:items-center">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[#0096c7]">Executive dashboard</p>
                  <h2 className="mt-2 max-w-2xl text-2xl font-extrabold leading-tight text-slate-950 md:text-3xl">
                    A focused control room for manufacturing performance.
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
                    Monitor order health, validate work logs, and keep production teams aligned with fast access to the most important MPS workflows.
                  </p>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => navigate('/dashboard')}
                      className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-[#0096c7] px-4 text-sm font-bold text-white transition-all hover:bg-[#0077b6] active:scale-[0.98]"
                    >
                      Open Dashboard
                      <ChevronRight size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/timesheet-validation')}
                      className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50"
                    >
                      Review Validation
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500">Today overview</p>
                    <CheckCircle size={18} className="text-emerald-600" />
                  </div>
                  <div className="mt-4 space-y-3">
                    {progressCards.slice(0, 3).map((item) => (
                      <div key={item.label} className="rounded-lg bg-white p-3 shadow-sm">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className="text-slate-600">{item.label}</span>
                          <span className="text-slate-900">{item.value}%</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${item.tone}`} style={{ width: `${item.value}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </DashboardCard>

            <DashboardCard className="p-5 xl:col-span-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                  <TimerReset size={21} />
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">Risk Snapshot</h2>
                  <p className="text-xs text-slate-500">High-priority operating signals.</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-bold text-amber-700">Overdue workload</p>
                  <p className="mt-2 text-2xl font-extrabold text-slate-950">{formatNumber(kpi.overdue_orders)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-bold text-slate-500">Validation queue</p>
                  <p className="mt-2 text-2xl font-extrabold text-slate-950">37</p>
                </div>
              </div>
            </DashboardCard>
          </section>

          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {summaryCards.map((card) => (
              <StatCard key={card.title} {...card} />
            ))}
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-7">
              <TrendChart />
            </div>
            <div className="xl:col-span-5">
              <ValidationQueue />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-5">
              <OrderSummaryTable />
            </div>
            <div className="xl:col-span-3">
              <ProgressStatusCards />
            </div>
            <div className="xl:col-span-4">
              <ActivityList />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default OperationsHubPage;
