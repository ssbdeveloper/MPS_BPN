"use strict";

/**
 * Compare the two most recent progress updates of one operation.
 *
 * Hours and EAC are read from the snapshot frozen when each update was written
 * (progress_update_history.actual_hours_at_update / eac_hours_at_update), not
 * recomputed from timesheets — a later timesheet revision must not rewrite what
 * an earlier update reported. Rows written before that snapshot existed carry
 * NULL and simply produce no trend.
 *
 * Owner decision 2026-09-14: flag both "hours grew while progress stood still"
 * and "EAC jumped >= 10% versus the previous update".
 */

const EAC_JUMP_PCT = 10;
const HOURS_EPSILON = 0.01;

const finite = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
const round = (value) => (value == null ? null : Math.round((value + Number.EPSILON) * 100) / 100);

function buildUpdateTrend(row = {}) {
  const lastProgress = finite(row.last_progress_pct);
  const prevProgress = finite(row.prev_progress_pct);
  const lastHours = finite(row.last_actual_hours);
  const prevHours = finite(row.prev_actual_hours);
  const lastEac = finite(row.last_eac_hours);
  const prevEac = finite(row.prev_eac_hours);

  const trend = {
    last_update_at: row.last_update_at ?? null,
    prev_update_at: row.prev_update_at ?? null,
    last_progress_pct: lastProgress,
    prev_progress_pct: prevProgress,
    last_actual_hours: round(lastHours),
    prev_actual_hours: round(prevHours),
    last_eac_hours: round(lastEac),
    prev_eac_hours: round(prevEac),
    actual_hours_delta: null,
    progress_delta_pct_point: null,
    eac_delta_hours: null,
    eac_delta_pct: null,
    progress_stalled: false,
    eac_jumped: false,
    flags: [],
  };

  const comparable = row.prev_update_at != null && prevHours != null && lastHours != null;
  if (!comparable) return trend;

  const hoursDelta = lastHours - prevHours;
  const progressDelta = lastProgress == null || prevProgress == null ? null : lastProgress - prevProgress;
  trend.actual_hours_delta = round(hoursDelta);
  trend.progress_delta_pct_point = round(progressDelta);

  if (lastEac != null && prevEac != null && prevEac > 0) {
    trend.eac_delta_hours = round(lastEac - prevEac);
    trend.eac_delta_pct = round((lastEac - prevEac) / prevEac * 100);
  }

  trend.progress_stalled = hoursDelta > HOURS_EPSILON && progressDelta != null && progressDelta <= 0;
  trend.eac_jumped = trend.eac_delta_pct != null && trend.eac_delta_pct >= EAC_JUMP_PCT;

  if (trend.progress_stalled) trend.flags.push("PROGRESS_STALLED");
  if (trend.eac_jumped) trend.flags.push("EAC_JUMP");
  return trend;
}

module.exports = { EAC_JUMP_PCT, buildUpdateTrend };
