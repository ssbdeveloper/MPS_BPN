import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { clampPct, healthMeta, number } from './progressFormat';

const MotionDiv = motion.div;

export function HealthDot({ health }) {
  const meta = healthMeta(health);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold ${meta.text}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

/** Blue is completed; the clearly contrasting grey segment is still unfinished. */
export function ProgressCell({ progress, target }) {
  const reduce = useReducedMotion();
  const actual = clampPct(progress);
  const expected = clampPct(target);
  const comparable = Number.isFinite(Number(progress)) && Number.isFinite(Number(target));
  const gap = comparable ? actual - expected : null;
  const behind = gap != null && gap < -0.5;
  const ahead = gap != null && gap > 0.5;

  return (
    <div className="min-w-0">
      <div className="relative" aria-label={`${number(progress, '%')} complete${comparable ? `, target ${number(target, '%')}` : ''}`}>
        <div className="flex h-2.5 overflow-hidden rounded-full border border-slate-300 bg-slate-300">
          <MotionDiv
            className="h-full bg-[#0077b6]"
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${actual}%` }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 140, damping: 22 }}
          />
        </div>
        {comparable && <span aria-hidden="true" className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full bg-amber-500 ring-2 ring-white" style={{ left: `${expected}%` }} />}
      </div>
      <div className="mt-1 flex items-center justify-between gap-1 text-[11px] tabular-nums">
        <span className="font-bold text-slate-800">{number(progress, '%')}</span>
        {gap != null && (
          <span className={`whitespace-nowrap font-bold ${behind ? 'text-rose-700' : 'text-emerald-700'}`}>
            {behind ? `${number(Math.abs(gap), '%')} behind` : ahead ? `${number(gap, '%')} ahead` : 'on target'}
          </span>
        )}
      </div>
    </div>
  );
}

export function MetricCell({ label, value, tone = 'default' }) {
  const valueTone = tone === 'bad' ? 'text-rose-700' : 'text-slate-800';
  return (
    <div className="min-w-0 text-center">
      <span className="block text-[11px] font-medium text-slate-400 lg:hidden">{label}</span>
      <span className={`block truncate text-xs font-bold tabular-nums ${valueTone}`} title={String(value)}>{value}</span>
    </div>
  );
}

export function TrendFlag({ trend }) {
  if (!trend?.progress_stalled && !trend?.eac_jumped) return null;
  const stalled = trend.progress_stalled;
  const Icon = stalled ? AlertTriangle : TrendingUp;
  const text = stalled ? `Unchanged · +${number(trend.actual_hours_delta)}` : `EAC +${number(trend.eac_delta_pct, '%')}`;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold ${stalled ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
      <Icon size={11} aria-hidden="true" />{text}
    </span>
  );
}

export function DataCells({ item }) {
  return (
    <>
      <MetricCell label="Plan" value={number(item.plan_hours)} />
      <MetricCell label="Act" value={number(item.actual_hours)} />
      <ProgressCell progress={item.progress_pct} target={item.target_progress_pct} />
      <MetricCell label="Target" value={number(item.target_progress_pct, '%')} />
      <div className="min-w-0 text-center"><span className="block text-[11px] font-medium text-slate-400 lg:hidden">Health</span><span className="inline-flex justify-center"><HealthDot health={item.health} /></span></div>
      <MetricCell label="EAC" value={number(item.eac_hours)} tone={Number(item.eac_variance_hours) > 0.05 ? 'bad' : 'default'} />
    </>
  );
}

export function GridHeading() {
  return (
    <div className="hidden grid-cols-[minmax(240px,1fr)_64px_64px_minmax(190px,0.9fr)_68px_82px_76px_104px] gap-x-3 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 lg:grid">
      <span className="text-left">Scope</span><span>Plan</span><span>Act</span><span className="text-left">Progress</span><span>Target</span><span>Health</span><span>EAC</span><span>Action</span>
    </div>
  );
}

export const ROW_GRID = 'grid gap-x-3 gap-y-2 lg:grid-cols-[minmax(240px,1fr)_64px_64px_minmax(190px,0.9fr)_68px_82px_76px_104px] lg:items-center';
