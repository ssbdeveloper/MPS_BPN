import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    target: 99,
    owner: 'IT',
    icon: Wifi,
    tone: 'emerald',
    animated: 'heartbeat',
  },
  {
    key: 'accuracy',
    label: 'Accuracy',
    target: 97,
    owner: 'Foreman',
    icon: ShieldCheck,
    tone: 'cyan',
    animated: 'scan',
  },
  {
    key: 'adoption',
    label: 'Adoption',
    target: 95,
    owner: 'Spv',
    icon: Users,
    tone: 'sky',
    animated: 'rise',
  },
  {
    key: 'oee',
    label: 'OEE',
    target: 80,
    owner: 'PPIC',
    icon: Gauge,
    tone: 'amber',
    animated: 'flicker',
  },
  {
    key: 'ole',
    label: 'OLE',
    target: 85,
    owner: 'Spv',
    icon: Activity,
    tone: 'indigo',
    animated: 'rise',
  },
];

const toneClass = {
  emerald: {
    soft: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  cyan: {
    soft: 'bg-cyan-50 text-[#0077b6] border-cyan-200',
  },
  sky: {
    soft: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  amber: {
    soft: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  indigo: {
    soft: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
};

const statusClass = {
  normal: 'border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]',
  watch: 'border-amber-200 bg-amber-50 text-amber-700',
  critical: 'border-red-200 bg-red-50 text-red-700',
  no_data: 'border-slate-200 bg-slate-50 text-slate-500',
};

const statusDotClass = {
  normal: 'bg-[#0096c7]',
  watch: 'bg-amber-500',
  critical: 'bg-red-600',
  no_data: 'bg-slate-400',
};

const statusBarClass = {
  normal: 'from-[#0096c7] to-[#48cae4]',
  watch: 'from-amber-500 to-amber-300',
  critical: 'from-red-600 to-red-400',
  no_data: 'from-slate-300 to-slate-200',
};

const cardStatusClass = {
  normal: 'border-slate-200 bg-white',
  watch: 'border-amber-200 bg-amber-50/30',
  critical: 'border-red-300 bg-red-50/40 ews-critical-card',
  no_data: 'border-slate-200 bg-white',
};

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'critical' || status === 'error') return 'critical';
  if (status === 'watch' || status === 'stale' || status === 'warning') return 'watch';
  if (status === 'normal' || status === 'fresh' || status === 'live') return 'normal';
  return 'no_data';
}

function formatPercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(1) : '--';
}

function AnimatedPercent({ value }) {
  const numericValue = Number(value);
  const [displayValue, setDisplayValue] = useState(Number.isFinite(numericValue) ? numericValue : null);

  useEffect(() => {
    if (!Number.isFinite(numericValue)) {
      setDisplayValue(null);
      return undefined;
    }

    const from = Number.isFinite(Number(displayValue)) ? Number(displayValue) : numericValue;
    const diff = numericValue - from;
    if (Math.abs(diff) < 0.05) {
      setDisplayValue(numericValue);
      return undefined;
    }

    const startedAt = performance.now();
    const duration = 700;
    let frameId = 0;

    function step(now) {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayValue(from + diff * eased);
      if (t < 1) frameId = requestAnimationFrame(step);
    }

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [numericValue]);

  return <>{formatPercent(displayValue)}</>;
}

function TrendIndicator({ comparison }) {
  const direction = comparison?.direction || 'flat';
  const delta = Number(comparison?.delta);
  const previousValue = Number(comparison?.previous_value);
  const isUp = direction === 'up';
  const isDown = direction === 'down';
  const colorClass = isUp ? 'text-emerald-700' : isDown ? 'text-red-600' : 'text-slate-400';
  const triangleClass = isUp
    ? 'border-x-[5px] border-b-[8px] border-x-transparent border-b-emerald-600'
    : isDown
      ? 'border-x-[5px] border-t-[8px] border-x-transparent border-t-red-600'
      : 'h-1.5 w-2.5 rounded-full bg-slate-300';

  return (
    <div className={`mt-1 flex min-h-[18px] items-center gap-1.5 text-[10px] font-extrabold ${colorClass}`}>
      <span className={triangleClass} />
      <span className="truncate">
        Prev {Number.isFinite(previousValue) ? `${previousValue.toFixed(1)}%` : '--'}
        {Number.isFinite(delta) ? ` (${delta > 0 ? '+' : ''}${delta.toFixed(1)})` : ''}
      </span>
    </div>
  );
}

function KpiTile({ item }) {
  const Icon = item.icon;
  const tone = toneClass[item.tone];
  const numericValue = Number(item.value);
  const hasValue = Number.isFinite(numericValue);
  const width = `${hasValue ? Math.min(Math.max(numericValue, 0), 100) : 0}%`;
  const statusLabel = item.status === 'no_data' ? 'NO DATA' : item.status?.toUpperCase();
  const status = normalizeStatus(item.status);

  return (
    <div
      className={`rounded-xl border p-3 shadow-sm transition-colors duration-500 ${cardStatusClass[status] || cardStatusClass.no_data}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]">
          <Icon size={18} />
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${statusClass[status] || tone.soft}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass[status] || statusDotClass.no_data} ${item.key === 'uptime' ? 'ews-dot-heartbeat' : 'ews-dot-pulse'}`} />
          {statusLabel || 'NO DATA'}
        </span>
      </div>

      <div className="mt-3">
        <p className="text-[11px] font-extrabold uppercase text-slate-500">{item.label}</p>
        <div className="mt-1 flex items-end gap-1">
          <span className="tabular-nums text-2xl font-black leading-none text-slate-900 transition-colors duration-300">
            <AnimatedPercent value={item.value} />
          </span>
          <span className="pb-0.5 text-xs font-extrabold text-slate-500">%</span>
        </div>
        <TrendIndicator comparison={item.comparison} />
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`ews-fill h-full rounded-full bg-gradient-to-r transition-all duration-700 ${statusBarClass[status] || statusBarClass.no_data}`}
          style={{ '--ews-width': width }}
        />
      </div>

      {item.key === 'uptime' && (
        <div className="mt-3 overflow-hidden rounded-lg border border-[#90e0ef] bg-[#caf0f8]/60 px-2 py-1.5">
          <svg className="h-8 w-full" viewBox="0 0 180 32" role="img" aria-label="Uptime heartbeat signal">
            <path
              d="M0 18 H24 L30 18 L35 11 L40 24 L48 5 L56 18 H84 L90 18 L96 13 L102 22 L111 9 L120 18 H180"
              fill="none"
              stroke="#0077b6"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ews-ecg-line"
            />
            <path
              d="M0 18 H24 L30 18 L35 11 L40 24 L48 5 L56 18 H84 L90 18 L96 13 L102 22 L111 9 L120 18 H180"
              fill="none"
              stroke="#48cae4"
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
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectionState, setConnectionState] = useState('connecting');
  const [freshnessState, setFreshnessState] = useState('NO_SNAPSHOT');
  const hasSummaryRef = useRef(false);
  const versionRef = useRef(0);

  useEffect(() => {
    hasSummaryRef.current = Boolean(summary);
  }, [summary]);

  useEffect(() => {
    function updateFreshness() {
      if (!summary?.calculated_at) {
        setFreshnessState('NO_SNAPSHOT');
        return;
      }

      const calculatedMs = new Date(summary.calculated_at).getTime();
      const thresholdSeconds = Number(summary.freshness_threshold_seconds ?? summary.meta?.freshness_threshold_seconds ?? 120);
      if (!Number.isFinite(calculatedMs)) {
        setFreshnessState('NO_SNAPSHOT');
        return;
      }

      const ageSeconds = Math.max(0, Math.floor((Date.now() - calculatedMs) / 1000));
      setFreshnessState(ageSeconds > thresholdSeconds ? 'STALE' : 'FRESH');
    }

    updateFreshness();
    const timer = window.setInterval(updateFreshness, 10000);
    return () => window.clearInterval(timer);
  }, [summary?.calculated_at, summary?.freshness_threshold_seconds, summary?.meta?.freshness_threshold_seconds]);

  useEffect(() => {
    const source = new EventSource('/api/ews/stream?basis=today');

    function applySnapshot(event) {
      try {
        const message = JSON.parse(event.data);
        const version = Number(message.version ?? message.data?.version ?? message.summary?.version ?? 0);
        if (Number.isFinite(version) && version <= versionRef.current) return;

        const nextSummary = message.data || message.summary;
        if (!nextSummary) throw new Error('EWS snapshot payload is empty');

        versionRef.current = Number.isFinite(version) ? version : versionRef.current;
        setSummary(nextSummary);
        setFreshnessState(nextSummary.freshness_status || 'FRESH');
        setError('');
        setConnectionState('live');
        setIsLoading(false);
      } catch (err) {
        setError(err.message || 'Failed to parse EWS snapshot');
        setIsLoading(false);
      }
    }

    source.onopen = () => {
      setConnectionState('live');
      setError('');
    };

    source.onerror = () => {
      setConnectionState('reconnecting');
      if (!hasSummaryRef.current) setError('Waiting for EWS snapshot stream...');
      setIsLoading(false);
    };

    source.addEventListener('snapshot', applySnapshot);
    source.addEventListener('stream-error', (event) => {
      try {
        const message = JSON.parse(event.data);
        setError(message.error || 'EWS stream error');
      } catch (_err) {
        setError('EWS stream error');
      }
      setIsLoading(false);
    });

    return () => {
      source.close();
    };
  }, []);

  const liveKpis = useMemo(() => (
    kpis.map((item) => {
      const apiItem = summary?.kpis?.find((kpi) => kpi.key === item.key);
      return {
        ...item,
        ...apiItem,
        icon: item.icon,
        tone: item.tone,
        animated: item.animated,
        value: apiItem?.value ?? null,
        status: apiItem?.status || 'no_data',
        helper: apiItem?.helper || 'Waiting for EWS data',
      };
    })
  ), [summary]);

  const issues = summary?.issues || [];
  const queue = summary?.correction_queue || {};
  const overallStatus = summary?.overall_status || (error ? 'ERROR' : 'NO_DATA');
  const overallStatusKey = normalizeStatus(overallStatus);
  const overallScore = Number.isFinite(Number(summary?.overall_score))
    ? Number(summary.overall_score).toFixed(2)
    : '--';
  const snapshotVersion = summary?.version ?? summary?.meta?.version ?? '--';

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
          @keyframes ewsCriticalCard {
            0%, 100% { box-shadow: 0 1px 3px rgba(0,0,0,.06); border-color: rgb(252 165 165); }
            50% { box-shadow: 0 0 0 3px rgba(239,68,68,.12); border-color: rgb(220 38 38); }
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
          .ews-critical-card { animation: ewsCriticalCard 1600ms ease-in-out infinite; }
          .ews-fill { width: var(--ews-width); }
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
            <span className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs font-extrabold ${statusClass[overallStatusKey] || statusClass.no_data}`}>
              <CheckCircle2 size={14} />
              SYSTEM {overallStatus}
            </span>
            <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-extrabold text-slate-700">
              <TrendingUp size={14} className="text-[#0077b6]" />
              Score {overallScore}
            </span>
            <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500">
              <Clock3 size={14} />
              {isLoading ? 'Loading' : summary?.basis === 'today' ? 'Today' : `${summary?.grain || '15m'} window`}
            </span>
            <span className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs font-extrabold ${
              connectionState === 'live'
                ? statusClass.normal
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}>
              <RadioTower size={14} />
              {connectionState === 'live' ? 'SSE LIVE' : 'RECONNECTING'}
            </span>
            <span className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs font-extrabold ${
              freshnessState === 'FRESH'
                ? statusClass.normal
                : freshnessState === 'STALE'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-red-200 bg-red-50 text-red-700'
            }`}>
              <Clock3 size={14} />
              {freshnessState} v{snapshotVersion}
            </span>
          </div>
        </div>
      </div>

      <div className="p-4">
        {freshnessState === 'STALE' && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
            Snapshot is stale. The dashboard is showing the latest available EWS snapshot.
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {liveKpis.map((item) => (
            <KpiTile key={item.key} item={item} />
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_320px]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xs font-extrabold uppercase text-slate-600">Top Issues</h3>
              <span className="text-[11px] font-bold text-slate-400">Alert - Detail - Std Action</span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {issues.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 md:col-span-3">
                  No active KPI issue in this window.
                </div>
              )}
              {issues.slice(0, 3).map((issue) => (
                <div key={`${issue.machine}-${issue.kpi}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs font-extrabold text-slate-800">{issue.machine}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${statusClass[normalizeStatus(issue.severity)] || statusClass.watch}`}>
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
                <span className="text-sm font-black text-slate-900">{queue.open_actions ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs font-bold text-slate-600">Critical aging</span>
                <span className="text-sm font-black text-emerald-700">{queue.critical_aging ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs font-bold text-slate-600">Next escalation</span>
                <span className="text-xs font-extrabold text-slate-500">{queue.next_escalation_minutes ?? 15} min</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default EwsControlTower;
