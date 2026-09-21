/**
 * Exception derivation for the dashboard command center.
 *
 * Pure: every row comes from data the page already fetched, so the panel adds no request and the
 * rules stay unit-testable without rendering.
 */

const SEVERITY_RANK = { high: 0, medium: 1 };

/** Validation pass rate at or above this is on target. */
const VALIDATION_TARGET_PCT = 80;
/** Below this the workcenter is treated as failing, not merely drifting. */
const VALIDATION_CRITICAL_PCT = 50;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return NaN;
  return Number(value);
}

/**
 * @param {object}   input
 * @param {{overdue_orders?: number}|null} input.kpi  dashboard KPI payload
 * @param {{workcenter: string, pass_rate: number}[]} input.validation  validation-rate rows
 * @param {{workcenter: string, total_planhours: number, total_actual_hours: number}[]} input.workload
 * @returns {{id: string, severity: 'high'|'medium', weight: number, subject: string,
 *            detail: string, action: string, href: string}[]} severity desc, then magnitude desc
 */
export default function deriveExceptions({ kpi, validation = [], workload = [] }) {
  const rows = [];

  const overdue = toNumber(kpi?.overdue_orders) || 0;
  if (overdue > 0) {
    rows.push({
      id: 'overdue-orders',
      severity: 'high',
      weight: overdue,
      subject: `${overdue.toLocaleString()} overdue orders`,
      detail: 'Past plan finish and still below 100%',
      action: 'Open order list',
      href: '/sow-orders',
    });
  }

  for (const row of validation) {
    const rate = toNumber(row.pass_rate);
    if (!Number.isFinite(rate) || rate >= VALIDATION_TARGET_PCT) continue;
    rows.push({
      id: `validation-${row.workcenter}`,
      severity: rate < VALIDATION_CRITICAL_PCT ? 'high' : 'medium',
      weight: VALIDATION_TARGET_PCT - rate,
      subject: `${row.workcenter} validation ${rate}%`,
      detail: `Process control pass rate below the ${VALIDATION_TARGET_PCT}% target`,
      action: 'Open process control',
      href: '/process-control',
    });
  }

  for (const row of workload) {
    const plan = toNumber(row.total_planhours);
    const actual = toNumber(row.total_actual_hours);
    if (!Number.isFinite(plan) || !Number.isFinite(actual) || plan <= 0 || actual <= plan) continue;
    const over = actual - plan;
    rows.push({
      id: `workload-${row.workcenter}`,
      severity: 'medium',
      weight: over,
      subject: `${row.workcenter} over plan by ${over.toFixed(1)} hrs`,
      detail: `${actual.toFixed(1)} actual against ${plan.toFixed(1)} planned`,
      action: 'Open order list',
      href: '/sow-orders',
    });
  }

  return rows.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.weight - a.weight
  );
}
