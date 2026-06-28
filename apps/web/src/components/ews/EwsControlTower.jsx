import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  RadioTower,
  ShieldCheck,
  TrendingUp,
  Users,
  Wifi,
} from 'lucide-react';

const kpis = [
  {
    key: 'uptime',
    label: 'Uptime',
    value: 99.2,
    target: 99,
    owner: 'IT',
    status: 'normal',
    icon: Wifi,
    helper: 'HMI heartbeat stable',
    tone: 'emerald',
    animated: 'heartbeat',
  },
  {
    key: 'accuracy',
    label: 'Accuracy',
    value: 97.5,
    target: 97,
    owner: 'Foreman',
    status: 'normal',
    icon: ShieldCheck,
    helper: 'Error record low',
    tone: 'cyan',
    animated: 'scan',
  },
  {
    key: 'adoption',
    label: 'Adoption',
    value: 96.1,
    target: 95,
    owner: 'Spv',
    status: 'normal',
    icon: Users,
    helper: 'Input coverage healthy',
    tone: 'sky',
    animated: 'rise',
  },
  {
    key: 'oee',
    label: 'OEE',
    value: 72.3,
    target: 65,
    owner: 'PPIC',
    status: 'watch',
    icon: Gauge,
    helper: 'Watch one cell',
    tone: 'amber',
    animated: 'flicker',
  },
  {
    key: 'ole',
    label: 'OLE',
    value: 88.0,
    target: 85,
    owner: 'Spv',
    status: 'normal',
    icon: Activity,
    helper: 'Labor utilization OK',
    tone: 'indigo',
    animated: 'rise',
  },
];

const issues = [
  { machine: 'HMI-03', kpi: 'OEE', value: '68.4%', severity: 'Watch', action: 'Check micro stop pattern' },
  { machine: 'HMI-07', kpi: 'Adoption', value: '92.8%', severity: 'Watch', action: 'Reminder operator input' },
  { machine: 'HMI-11', kpi: 'Accuracy', value: '96.4%', severity: 'Observe', action: 'Validate outlier records' },
];

const toneClass = {
  emerald: {
    icon: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bar: 'from-emerald-500 to-emerald-400',
    soft: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  cyan: {
    icon: 'bg-cyan-50 text-[#0077b6] border-cyan-200',
    bar: 'from-[#0096c7] to-[#48cae4]',
    soft: 'bg-cyan-50 text-[#0077b6] border-cyan-200',
    dot: 'bg-[#0096c7]',
  },
  sky: {
    icon: 'bg-sky-50 text-sky-700 border-sky-200',
    bar: 'from-sky-500 to-sky-400',
    soft: 'bg-sky-50 text-sky-700 border-sky-200',
    dot: 'bg-sky-500',
  },
  amber: {
    icon: 'bg-amber-50 text-amber-700 border-amber-200',
    bar: 'from-amber-500 to-amber-300',
    soft: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
  },
  indigo: {
    icon: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    bar: 'from-indigo-500 to-indigo-400',
    soft: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    dot: 'bg-indigo-500',
  },
};

function KpiTile({ item, index }) {
  const Icon = item.icon;
  const tone = toneClass[item.tone];
  const width = `${Math.min(Math.max(item.value, 0), 100)}%`;

  return (
    <div
      className={`ews-tile ews-${item.animated} rounded-xl border border-slate-200 bg-white p-3 shadow-sm`}
      style={{ animationDelay: `${index * 120}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${tone.icon}`}>
          <Icon size={18} />
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${tone.soft}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${item.key === 'uptime' ? 'ews-dot-heartbeat' : 'ews-dot-pulse'}`} />
          {item.status === 'normal' ? 'NORMAL' : 'WATCH'}
        </span>
      </div>

      <div className="mt-3">
        <p className="text-[11px] font-extrabold uppercase text-slate-500">{item.label}</p>
        <div className="mt-1 flex items-end gap-1">
          <span className="text-2xl font-black leading-none text-slate-900">{item.value.toFixed(1)}</span>
          <span className="pb-0.5 text-xs font-extrabold text-slate-500">%</span>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`ews-fill h-full rounded-full bg-gradient-to-r ${tone.bar}`}
          style={{ '--ews-width': width }}
        />
      </div>

      {item.key === 'uptime' && (
        <div className="mt-3 overflow-hidden rounded-lg border border-emerald-100 bg-emerald-50/60 px-2 py-1.5">
          <svg className="h-8 w-full" viewBox="0 0 180 32" role="img" aria-label="Uptime heartbeat signal">
            <path
              d="M0 18 H24 L30 18 L35 11 L40 24 L48 5 L56 18 H84 L90 18 L96 13 L102 22 L111 9 L120 18 H180"
              fill="none"
              stroke="#059669"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ews-ecg-line"
            />
            <path
              d="M0 18 H24 L30 18 L35 11 L40 24 L48 5 L56 18 H84 L90 18 L96 13 L102 22 L111 9 L120 18 H180"
              fill="none"
              stroke="#10b981"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ews-ecg-glow"
            />
          </svg>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-bold">
        <span className="truncate text-slate-500">{item.helper}</span>
        <span className="whitespace-nowrap text-slate-400">Tgt {item.target}%</span>
      </div>
    </div>
  );
}

function EwsControlTower() {
  const [uptimeValue, setUptimeValue] = useState(99.2);

  useEffect(() => {
    const timer = setInterval(() => {
      setUptimeValue((current) => {
        const drift = (Math.random() - 0.46) * 0.34;
        const next = current + drift;
        return Math.min(99.9, Math.max(98.0, Number(next.toFixed(1))));
      });
    }, 1100);

    return () => clearInterval(timer);
  }, []);

  const liveKpis = useMemo(() => (
    kpis.map((item) => (
      item.key === 'uptime'
        ? { ...item, value: uptimeValue, helper: `Live heartbeat ${uptimeValue.toFixed(1)}%` }
        : item
    ))
  ), [uptimeValue]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <style>
        {`
          @keyframes ewsHeartbeat {
            0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.30); }
            18% { transform: scale(1.10); box-shadow: 0 0 0 7px rgba(16, 185, 129, 0.12); }
            32% { transform: scale(0.98); box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.18); }
            48% { transform: scale(1.06); box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
          }
          @keyframes ewsPulseSoft {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.22); opacity: 0.72; }
          }
          @keyframes ewsFill {
            from { width: 0%; }
            to { width: var(--ews-width); }
          }
          @keyframes ewsTileIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes ewsScan {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
          }
          @keyframes ewsFlicker {
            0%, 100% { border-color: rgb(226 232 240); }
            50% { border-color: rgb(253 230 138); }
          }
          @keyframes ewsEcgDash {
            0% { stroke-dashoffset: 220; opacity: 0.35; }
            18% { opacity: 1; }
            100% { stroke-dashoffset: -220; opacity: 0.35; }
          }
          @keyframes ewsEcgGlow {
            0%, 100% { opacity: 0.10; transform: translateY(0); }
            35% { opacity: 0.35; transform: translateY(-1px); }
            55% { opacity: 0.20; transform: translateY(1px); }
          }
          .ews-tile { animation: ewsTileIn 520ms ease both; }
          .ews-fill { width: var(--ews-width); animation: ewsFill 1100ms cubic-bezier(.2,.8,.2,1) both; }
          .ews-dot-heartbeat { animation: ewsHeartbeat 1500ms ease-in-out infinite; }
          .ews-dot-pulse { animation: ewsPulseSoft 1800ms ease-in-out infinite; }
          .ews-heartbeat { animation-name: ewsTileIn, ewsFlicker; animation-duration: 520ms, 2400ms; animation-timing-function: ease, ease-in-out; animation-iteration-count: 1, infinite; }
          .ews-scan .ews-fill { background-size: 180% 180%; animation: ewsFill 1100ms cubic-bezier(.2,.8,.2,1) both, ewsScan 2600ms ease-in-out infinite; }
          .ews-flicker { animation-name: ewsTileIn, ewsFlicker; animation-duration: 520ms, 2200ms; animation-timing-function: ease, ease-in-out; animation-iteration-count: 1, infinite; }
          .ews-ecg-line { stroke-dasharray: 90 130; animation: ewsEcgDash 1650ms linear infinite; filter: drop-shadow(0 0 4px rgba(16,185,129,.35)); }
          .ews-ecg-glow { opacity: .18; animation: ewsEcgGlow 1500ms ease-in-out infinite; }
        `}
      </style>

      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50 text-[#0077b6]">
              <RadioTower size={22} />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 ews-dot-heartbeat" />
            </div>
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#0077b6]">EWS Control Tower</p>
              <h2 className="text-base font-black text-slate-900">Early Warning System</h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-extrabold text-emerald-700">
              <CheckCircle2 size={14} />
              SYSTEM NORMAL
            </span>
            <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-extrabold text-slate-700">
              <TrendingUp size={14} className="text-[#0077b6]" />
              Score 0.85
            </span>
            <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500">
              <Clock3 size={14} />
              Live preview
            </span>
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {liveKpis.map((item, index) => (
            <KpiTile key={item.key} item={item} index={index} />
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_320px]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xs font-extrabold uppercase text-slate-600">Top Issues</h3>
              <span className="text-[11px] font-bold text-slate-400">Alert - Detail - Std Action</span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {issues.map((issue) => (
                <div key={`${issue.machine}-${issue.kpi}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs font-extrabold text-slate-800">{issue.machine}</p>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">
                      {issue.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-slate-600">{issue.kpi} {issue.value}</p>
                  <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">{issue.action}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-600" />
              <h3 className="text-xs font-extrabold uppercase text-slate-600">Correction Queue</h3>
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs font-bold text-slate-600">Open actions</span>
                <span className="text-sm font-black text-slate-900">3</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs font-bold text-slate-600">Critical aging</span>
                <span className="text-sm font-black text-emerald-700">0</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs font-bold text-slate-600">Next escalation</span>
                <span className="text-xs font-extrabold text-slate-500">15 min</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default EwsControlTower;
