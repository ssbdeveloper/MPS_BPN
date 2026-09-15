const FORMATTER = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

export const HEALTH_META = {
  red: { label: 'Critical', bar: 'bg-rose-500', dot: 'bg-rose-500', text: 'text-rose-700', rail: 'bg-rose-400' },
  yellow: { label: 'At risk', bar: 'bg-amber-500', dot: 'bg-amber-500', text: 'text-amber-700', rail: 'bg-amber-400' },
  green: { label: 'On track', bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-700', rail: 'bg-emerald-400' },
  unknown: { label: 'No data', bar: 'bg-slate-300', dot: 'bg-slate-400', text: 'text-slate-500', rail: 'bg-slate-300' },
};

/**
 * Depth is carried by colour temperature, not by nested borders: project reads
 * as a white sheet, unit as a tinted band inside it, operation as a plain row.
 */
export const LEVEL_STYLE = {
  project: { surface: 'bg-white', title: 'text-lg font-extrabold text-slate-900', icon: 'text-[#0077b6]' },
  unit: { surface: 'bg-[#caf0f8]/40', title: 'text-sm font-extrabold text-slate-800', icon: 'text-[#0077b6]' },
};

export const healthMeta = (health) => HEALTH_META[health] || HEALTH_META.unknown;

export function number(value, suffix = '') {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${FORMATTER.format(parsed)}${suffix}` : '—';
}

export const clampPct = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
};

export function shortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

/**
 * Progress-vs-hours warning.
 *
 * When the API returns `update_trend` (two most recent progress updates, hours
 * frozen at update time) the message names the actual change between updates.
 * Otherwise it falls back to the current snapshot: hours consumed vs progress.
 */
export function stallSignal(item) {
  const trend = item.update_trend;
  if (trend?.progress_stalled) {
    const since = shortDate(trend.prev_update_at);
    const jump = trend.eac_jumped ? ` Forecast rose to ${number(trend.last_eac_hours, ' h')}.` : '';
    return {
      level: 'high',
      title: 'Progress likely not updated',
      text: `${since ? `Since ${since}, ` : ''}${number(trend.actual_hours_delta, ' h')} booked with progress still at ${number(trend.last_progress_pct, '%')}.${jump}`,
    };
  }
  if (trend?.eac_jumped) {
    return {
      level: 'medium',
      title: 'Forecast jumped',
      text: `${number(trend.prev_eac_hours, ' h')} → ${number(trend.last_eac_hours, ' h')} since the previous update.`,
    };
  }

  const actual = Number(item.actual_hours);
  const progress = Number(item.progress_pct);
  const gap = Number(item.health_gap_pct_point);
  if (actual > 0 && !(progress > 0)) {
    return { level: 'high', title: 'No progress reported', text: `${number(actual, ' h')} booked, progress still 0%.` };
  }
  if (Number.isFinite(gap) && gap >= 10) {
    return { level: 'high', title: 'Progress lagging hours', text: `${number(gap, ' pts')} behind what the hours have earned.` };
  }
  if (Number.isFinite(gap) && gap >= 3) {
    return { level: 'medium', title: 'Slipping', text: `${number(gap, ' pts')} behind what the hours have earned.` };
  }
  return null;
}
