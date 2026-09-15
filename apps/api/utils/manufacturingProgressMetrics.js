"use strict";

const HEALTH_PRIORITY = Object.freeze({ red: 0, yellow: 1, green: 2, unknown: 3 });
const round = (value) => value == null ? null : Math.round((value + Number.EPSILON) * 100) / 100;
const finiteOrNull = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

function calculateMetrics(input) {
  const plan = finiteOrNull(input.plan_hours);
  const actual = Math.max(0, finiteOrNull(input.actual_hours) ?? 0);
  const suppliedProgress = finiteOrNull(input.progress_pct);
  const progress = suppliedProgress == null ? null : Math.min(100, Math.max(0, suppliedProgress));
  const base = { plan_hours: plan, actual_hours: actual, progress_pct: progress };

  if (!(plan > 0)) return {
    ...base,
    target_progress_pct: null,
    consume_hours_pct: null,
    health_gap_pct_point: null,
    health: "unknown",
    health_note: null,
    eac_hours: null,
    eac_variance_hours: null,
  };

  const consume = actual / plan * 100;
  const gap = progress == null ? null : consume - progress;
  const missingProgress = actual > 0 && !(progress > 0);
  const health = missingProgress ? "red"
    : gap == null ? "unknown"
    : gap >= 3 ? "red"
    : gap > 0 ? "yellow"
    : "green";
  const eac = actual > 0 && progress > 0 ? actual / (progress / 100) : null;

  return {
    ...base,
    target_progress_pct: round(Math.min(consume, 100)),
    consume_hours_pct: round(consume),
    health_gap_pct_point: round(gap),
    health,
    health_note: missingProgress ? "Progress belum di-update" : null,
    eac_hours: round(eac),
    eac_variance_hours: eac == null ? null : round(eac - plan),
  };
}

function rollupMetrics(children) {
  const plan = children.reduce((sum, child) => sum + Math.max(0, finiteOrNull(child.plan_hours) ?? 0), 0);
  const actual = children.reduce((sum, child) => sum + Math.max(0, finiteOrNull(child.actual_hours) ?? 0), 0);
  const weightedProgress = plan > 0
    ? children.reduce((sum, child) => sum + Math.max(0, finiteOrNull(child.plan_hours) ?? 0) * (finiteOrNull(child.progress_pct) ?? 0), 0) / plan
    : null;
  const metrics = calculateMetrics({ plan_hours: plan, actual_hours: actual, progress_pct: weightedProgress });
  const worst = [...children].sort(compareByConcern)[0];
  return {
    ...metrics,
    health: worst?.health ?? "unknown",
    health_basis: "WORST_CHILD",
    worst_gap_pct_point: worst?.health_gap_pct_point ?? null,
    missing_progress_count: children.filter((child) => child.progress_pct == null || (child.progress_pct === 0 && child.actual_hours > 0)).length,
  };
}

function compareByConcern(a, b) {
  return (HEALTH_PRIORITY[a.health] ?? HEALTH_PRIORITY.unknown) - (HEALTH_PRIORITY[b.health] ?? HEALTH_PRIORITY.unknown)
    || (finiteOrNull(b.health_gap_pct_point) ?? -Infinity) - (finiteOrNull(a.health_gap_pct_point) ?? -Infinity)
    || String(a.name ?? a.project_name ?? a.unit_name ?? "").localeCompare(String(b.name ?? b.project_name ?? b.unit_name ?? ""));
}

module.exports = { HEALTH_PRIORITY, calculateMetrics, rollupMetrics, compareByConcern };
