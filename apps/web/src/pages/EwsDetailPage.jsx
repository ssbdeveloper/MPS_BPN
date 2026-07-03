import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Users,
  Wifi,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const DETAIL_TABLE_PAGE_SIZE = 6;

const KPI_CONFIG = {
  uptime: {
    label: 'Uptime',
    title: 'System Uptime Detail',
    target: 99,
    icon: Wifi,
    pic: 'IT',
    errorType: 'Machine Offline',
    action: 'Check HMI network path and repeated DOWN ping.',
  },
  accuracy: {
    label: 'Accuracy',
    title: 'Data Accuracy Detail',
    target: 97,
    icon: ShieldCheck,
    pic: 'Foreman',
    errorType: 'Invalid Timesheet Data',
    action: 'Review invalid rows, SAP failed staging, and operator input discipline.',
  },
  adoption: {
    label: 'Adoption',
    title: 'Timesheet Adoption Detail',
    target: 95,
    icon: Users,
    pic: 'Supervisor',
    errorType: 'Missing Time',
    action: 'Training ulang operator dan validasi input per machine bucket.',
  },
  oee: {
    label: 'OEE',
    title: 'Machine OEE Detail',
    target: 80,
    icon: Gauge,
    pic: 'PPIC',
    errorType: 'Machine Loss',
    action: 'Review downtime, setup, and counted machine time.',
  },
  ole: {
    label: 'OLE',
    title: 'Labor OLE Detail',
    target: 85,
    icon: Activity,
    pic: 'Supervisor',
    errorType: 'Labor Efficiency Loss',
    action: 'Review productive labor rows against total recorded time.',
  },
};

const statusClass = {
  normal: 'border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]',
  watch: 'border-amber-200 bg-amber-50 text-amber-700',
  critical: 'border-red-200 bg-red-50 text-red-700',
  no_data: 'border-slate-200 bg-slate-50 text-slate-500',
  closed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const severityColor = {
  Critical: '#dc2626',
  Watch: '#f59e0b',
  Normal: '#0096c7',
  Closed: '#059669',
  'No Data': '#94a3b8',
};

const severityDotClass = {
  Critical: 'border-red-200 bg-red-600 shadow-[0_0_0_4px_rgba(220,38,38,0.12),0_0_14px_rgba(220,38,38,0.45)]',
  Watch: 'border-amber-200 bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.12),0_0_14px_rgba(245,158,11,0.35)]',
  Normal: 'border-[#90e0ef] bg-[#0096c7] shadow-[0_0_0_4px_rgba(0,150,199,0.12),0_0_14px_rgba(0,150,199,0.3)]',
  Closed: 'border-emerald-200 bg-emerald-600 shadow-[0_0_0_4px_rgba(5,150,105,0.12),0_0_14px_rgba(5,150,105,0.3)]',
  'No Data': 'border-slate-200 bg-slate-400 shadow-[0_0_0_4px_rgba(148,163,184,0.12)]',
};

const waterfallColors = {
  baseline: '#2563eb',
  negative: '#dc2626',
  positive: '#16a34a',
  final: '#16a34a',
};

const machineMixColors = {
  VA: '#16a34a',
  NNVA: '#ef4444',
  NVA: '#991b1b',
  NoJob: '#f97316',
};

const errorLabels = {
  missing_order: 'Missing Order',
  missing_operation: 'Missing Operation',
  stale_open_checkout: 'Open Checkout > 30 min',
  invalid_duration: 'Invalid Duration',
  duration_mismatch: 'Duration Mismatch',
  sow_no_match: 'SOW No Match',
  missing_planhours: 'Missing Plan Hours',
};

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'critical' || status === 'error') return 'critical';
  if (status === 'watch' || status === 'warning' || status === 'stale') return 'watch';
  if (status === 'normal' || status === 'fresh' || status === 'live') return 'normal';
  return 'no_data';
}

function formatNumber(value, fallback = '-') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(parsed);
}

function formatFixed2(value, fallback = '-') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed.toFixed(2);
}

function formatFixedPercent(value, fallback = '-') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return `${parsed.toFixed(2)}%`;
}

function formatPercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)}%` : '--';
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function sendJson(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pageCount(items, pageSize = DETAIL_TABLE_PAGE_SIZE) {
  return Math.max(1, Math.ceil((items?.length || 0) / pageSize));
}

function pageSlice(items, page, pageSize = DETAIL_TABLE_PAGE_SIZE) {
  const start = Math.max(0, page - 1) * pageSize;
  return (items || []).slice(start, start + pageSize);
}

function buildOeeWaterfallChartData(sourceDetail = {}) {
  const rows = Array.isArray(sourceDetail.waterfall) ? sourceDetail.waterfall : [];
  return rows.map((row) => {
    const delta = numeric(row.delta_hours, 0);
    const end = numeric(row.end_hours, 0);
    const start = row.start_hours !== undefined
      ? numeric(row.start_hours, 0)
      : delta < 0
        ? end + Math.abs(delta)
        : 0;
    const displayName = row.step_type === 'final' || row.label === 'VA'
      ? 'Running'
      : row.label || 'Step';
    return {
      name: displayName,
      startValue: Math.max(0, start),
      endValue: Math.max(0, end),
      value: Math.abs(delta),
      displayValue: delta,
      stepType: row.step_type || 'segment',
      fill: row.step_type === 'total'
        ? waterfallColors.baseline
        : row.step_type === 'final'
          ? waterfallColors.final
          : delta < 0
            ? waterfallColors.negative
            : waterfallColors.positive,
    };
  });
}

function buildOeeDistributionChartData(sourceDetail = {}) {
  const rows = Array.isArray(sourceDetail.distribution_by_machine) ? sourceDetail.distribution_by_machine : [];
  return rows.slice(0, 12).map((row) => {
    const va = numeric(row.va_hours, 0);
    const nnva = numeric(row.nnva_hours, 0);
    const nva = numeric(row.nva_hours, 0);
    const nojob = numeric(row.nojob_hours, 0);
    const total = Math.max(va + nnva + nva + nojob, 0);
    const pct = (value) => (total > 0 ? Number(((value / total) * 100).toFixed(2)) : 0);
    const name = row.machinename || row.machineid || 'UNKNOWN';
    return {
      name: String(name).length > 18 ? `${String(name).slice(0, 18)}...` : String(name),
      machineid: row.machineid,
      totalHours: total,
      vaHours: va,
      nnvaHours: nnva,
      nvaHours: nva,
      nojobHours: nojob,
      VA: pct(va),
      NNVA: pct(nnva),
      NVA: pct(nva),
      NoJob: pct(nojob),
    };
  });
}

function rowSeverity(impact, kpiStatus) {
  if (kpiStatus === 'critical') return 'Critical';
  if (impact > 0 || kpiStatus === 'watch') return 'Watch';
  if (kpiStatus === 'no_data') return 'No Data';
  return 'Normal';
}

function makeRow({ id, area, condition, current, target, impact, status, bottleneck, pic, action, errorType, sourceTable, sourceId }, config, kpiStatus) {
  const severity = rowSeverity(impact, kpiStatus);
  return {
    id,
    area,
    condition,
    current,
    target,
    impact: numeric(impact, 0),
    status,
    severity,
    bottleneck,
    pic: pic || config.pic,
    action: action || config.action,
    errorType: errorType || config.errorType,
    sourceTable: sourceTable || '-',
    sourceId: sourceId || '-',
  };
}

function buildRowsFromSourceDetail(kpi, config, kpiStatus) {
  const sourceDetail = kpi?.source_detail || {};
  const sampleRows = Array.isArray(sourceDetail.sample_rows) ? sourceDetail.sample_rows : [];
  if (!sampleRows.length) return [];

  return sampleRows.slice(0, 80).map((row, index) => {
    const area = row.machine_id || row.machineid || row.machine_key || row.operator_id || row.operator_key || row.activity_bucket || row.error_type || 'SYSTEM';
    const condition = row.issue_description || row.error_code || row.gap_type || row.loss_type || row.activity_bucket || 'Source row needs review';
    const impact = numeric(row.failed_count, null)
      ?? numeric(row.missing_minutes, null)
      ?? numeric(row.duration_hours, null)
      ?? numeric(row.loss_hours, null)
      ?? numeric(row.error_records, 1);

    return makeRow({
      id: `source_${row.source_table || 'source'}_${row.source_id || index}`,
      area,
      condition,
      current: row.failed_count !== undefined
        ? `${formatNumber(row.failed_count)} fail`
        : row.duration_hours !== undefined
          ? `${formatNumber(row.duration_hours)}h`
          : row.gap_type
            ? row.gap_type
            : row.error_type || row.loss_type || row.activity_bucket || 'Issue',
      target: row.error_type ? '0 error' : row.duration_hours !== undefined ? '0h loss' : 'Normal',
      impact,
      status: 'Need Review',
      bottleneck: `${row.source_table || 'source'} row ${row.source_id || '-'} perlu dicek.`,
      pic: config.pic,
      action: row.error_type === 'Missing'
        ? 'Lengkapi field kosong dan validasi ulang record sumber.'
        : row.error_type === 'Invalid'
          ? 'Koreksi nilai tidak valid, cek QR/order/master data, lalu validasi ulang.'
          : row.loss_type
            ? 'Investigasi stop/loss pada machine event dan update action owner.'
            : row.activity_bucket
              ? 'Review aktivitas operator dan penyebab NVA.'
              : config.action,
      errorType: row.error_type || row.error_code || row.gap_type || row.loss_type || row.activity_bucket || config.errorType,
      sourceTable: row.source_table,
      sourceId: row.source_id,
    }, config, kpiStatus);
  });
}

function buildAccuracyRows(kpi, config, kpiStatus) {
  const detail = kpi?.detail || {};
  const breakdown = detail.error_breakdown || {};
  const rows = Object.entries(errorLabels).map(([key, label]) => {
    const count = numeric(breakdown[key], 0);
    return makeRow({
      id: key,
      area: label,
      condition: count > 0 ? `${count} records need validation` : 'No error found in this category',
      current: formatNumber(count),
      target: '0',
      impact: count,
      status: count > 0 ? 'Need Review' : 'Clear',
      bottleneck: count > 0 ? 'Data cannot be trusted before correction.' : 'No visible bottleneck.',
      errorType: label,
      action: count > 0 ? 'Validate source row, correct master/order data, then re-post if required.' : 'Continue monitoring.',
    }, config, kpiStatus);
  });

  if (numeric(detail.sap_failed, 0) > 0 || numeric(detail.sap_pending_backlog, 0) > 0) {
    rows.push(makeRow({
      id: 'sap_staging',
      area: 'SAP Staging',
      condition: `${formatNumber(detail.sap_failed, '0')} failed, ${formatNumber(detail.sap_pending_backlog, '0')} pending`,
      current: formatNumber(numeric(detail.sap_failed, 0) + numeric(detail.sap_pending_backlog, 0)),
      target: '0',
      impact: numeric(detail.sap_failed, 0) + numeric(detail.sap_pending_backlog, 0),
      status: 'Need Review',
      bottleneck: 'Posting backlog can hide confirmed production time.',
      pic: 'SAP Admin',
      errorType: 'SAP Posting Error',
      action: 'Check staging error message and retry posting after correction.',
    }, config, kpiStatus));
  }

  return rows;
}

function buildAdoptionRows(kpi, config, kpiStatus) {
  const detail = kpi?.detail || {};
  const bucketMinutes = numeric(detail.bucket_minutes, 5);
  const gaps = Array.isArray(detail.missing_time_buckets) ? detail.missing_time_buckets : [];
  const rows = gaps.map((gap, index) => makeRow({
    id: `gap_${index}_${gap.bucket_start || 'bucket'}`,
    area: gap.machine_key || gap.machineid || 'UNKNOWN',
    condition: `${gap.gap_type || 'missing_timesheet'} ${gap.operator_name ? `- ${gap.operator_name}` : ''}`,
    current: `${bucketMinutes} min`,
    target: '0 min',
    impact: bucketMinutes,
    status: 'Open Gap',
    bottleneck: `${formatDateTime(gap.bucket_start)} - machine activity has no reliable timesheet match.`,
    errorType: gap.gap_type === 'unidentified' ? 'Unidentified Operator' : 'Missing Time',
    action: 'Confirm operator assignment and complete missing timesheet input.',
  }, config, kpiStatus));

  if (!rows.length) {
    rows.push(
      makeRow({
        id: 'missing_bucket_count',
        area: 'Missing Buckets',
        condition: `${formatNumber(detail.missing_bucket_count, '0')} buckets without timesheet coverage`,
        current: `${formatNumber(detail.missing_minutes, '0')} min`,
        target: '0 min',
        impact: numeric(detail.missing_minutes, 0),
        status: numeric(detail.missing_bucket_count, 0) > 0 ? 'Need Review' : 'Clear',
        bottleneck: 'Machine time is not represented in operator timesheet.',
      }, config, kpiStatus),
      makeRow({
        id: 'unidentified_bucket_count',
        area: 'Unidentified Buckets',
        condition: `${formatNumber(detail.unidentified_bucket_count, '0')} buckets with unidentified status`,
        current: formatNumber(detail.unidentified_bucket_count, '0'),
        target: '0',
        impact: numeric(detail.unidentified_bucket_count, 0) * bucketMinutes,
        status: numeric(detail.unidentified_bucket_count, 0) > 0 ? 'Need Review' : 'Clear',
        bottleneck: 'Operator or machine assignment is unclear.',
        errorType: 'Unidentified Operator',
      }, config, kpiStatus),
    );
  }

  return rows;
}

function buildUptimeRows(kpi, config, kpiStatus) {
  const detail = kpi?.detail || {};
  return [
    makeRow({
      id: 'failed_ping',
      area: 'Failed Ping',
      condition: `${formatNumber(detail.failed_count, '0')} failed of ${formatNumber(detail.ping_count, '0')} ping checks`,
      current: formatNumber(detail.failed_count, '0'),
      target: '0',
      impact: numeric(detail.failed_count, 0),
      status: numeric(detail.failed_count, 0) > 0 ? 'Need Review' : 'Clear',
      bottleneck: 'Machine telemetry may be delayed or unavailable.',
    }, config, kpiStatus),
    makeRow({
      id: 'down_samples',
      area: 'DOWN Samples',
      condition: `${formatNumber(detail.down_samples, '0')} samples marked DOWN`,
      current: formatNumber(detail.down_samples, '0'),
      target: '0',
      impact: numeric(detail.down_samples, 0),
      status: numeric(detail.down_samples, 0) > 0 ? 'Need Review' : 'Clear',
      bottleneck: 'Repeated DOWN samples indicate connectivity or device issue.',
    }, config, kpiStatus),
    makeRow({
      id: 'packet_loss',
      area: 'Packet Loss',
      condition: `Max packet loss ${formatNumber(detail.max_packet_loss_percent, '0')}%`,
      current: `${formatNumber(detail.max_packet_loss_percent, '0')}%`,
      target: '0%',
      impact: numeric(detail.max_packet_loss_percent, 0),
      status: numeric(detail.max_packet_loss_percent, 0) > 0 ? 'Watch' : 'Clear',
      bottleneck: 'High packet loss can create false machine downtime.',
    }, config, kpiStatus),
  ];
}

function buildOeeRows(kpi, config, kpiStatus) {
  const detail = kpi?.detail || {};
  const denominator = numeric(detail.denominator_hours, 0);
  const running = numeric(detail.running_hours, 0);
  const nonProductive = Math.max(0, denominator - running);
  return [
    makeRow({
      id: 'downtime_hours',
      area: 'Downtime',
      condition: `${formatNumber(detail.downtime_hours, '0')} hours classified as downtime or breakdown`,
      current: `${formatNumber(detail.downtime_hours, '0')}h`,
      target: '0h',
      impact: numeric(detail.downtime_hours, 0),
      status: numeric(detail.downtime_hours, 0) > 0 ? 'Need Review' : 'Clear',
      bottleneck: 'Downtime directly reduces productive machine availability.',
      errorType: 'Downtime',
    }, config, kpiStatus),
    makeRow({
      id: 'setup_hours',
      area: 'Setup M2',
      condition: `${formatNumber(detail.setup_hours, '0')} setup hours counted`,
      current: `${formatNumber(detail.setup_hours, '0')}h`,
      target: 'As planned',
      impact: numeric(detail.setup_hours, 0),
      status: numeric(detail.setup_hours, 0) > 0 ? 'Watch' : 'Clear',
      bottleneck: 'Setup time may be normal, but long setup can become a flow bottleneck.',
      errorType: 'Setup Loss',
    }, config, kpiStatus),
    makeRow({
      id: 'non_productive_hours',
      area: 'Non Productive Mix',
      condition: `${formatNumber(nonProductive, '0')} of ${formatNumber(denominator, '0')} counted hours are not productive`,
      current: `${formatNumber(nonProductive, '0')}h`,
      target: 'Min',
      impact: nonProductive,
      status: nonProductive > 0 ? 'Need Review' : 'Clear',
      bottleneck: 'Large non-productive mix hides the real production constraint.',
      errorType: 'Availability Loss',
    }, config, kpiStatus),
  ];
}

function buildOleRows(kpi, config, kpiStatus) {
  const detail = kpi?.detail || {};
  const recorded = numeric(detail.available_recorded_hours, 0);
  const productive = numeric(detail.working_hours, 0);
  const gap = Math.max(0, recorded - productive);
  return [
    makeRow({
      id: 'labor_gap',
      area: 'Recorded vs Productive',
      condition: `${formatNumber(gap, '0')} recorded hours are not productive order time`,
      current: `${formatNumber(gap, '0')}h`,
      target: '0h',
      impact: gap,
      status: gap > 0 ? 'Need Review' : 'Clear',
      bottleneck: 'Recorded labor is not converting into productive order time.',
      errorType: 'Non Productive Labor',
    }, config, kpiStatus),
    makeRow({
      id: 'operator_count',
      area: 'Operator Coverage',
      condition: `${formatNumber(detail.operator_count, '0')} operators found in the window`,
      current: formatNumber(detail.operator_count, '0'),
      target: 'Planned manning',
      impact: kpiStatus === 'critical' ? 1 : 0,
      status: kpiStatus === 'critical' ? 'Need Review' : 'Monitor',
      bottleneck: 'OLE cannot be interpreted safely without checking planned vs actual manning.',
      errorType: 'Manning Review',
    }, config, kpiStatus),
  ];
}

function buildActionRows(kpi, config) {
  const kpiStatus = normalizeStatus(kpi?.status);
  const sourceRows = buildRowsFromSourceDetail(kpi, config, kpiStatus);
  if (sourceRows.length) return sourceRows;

  if (!kpi?.detail) {
    return [
      makeRow({
        id: 'no_detail',
        area: config.label,
        condition: kpi?.helper || 'Detail data is not available from the snapshot.',
        current: formatPercent(kpi?.value),
        target: `${config.target}%`,
        impact: kpiStatus === 'normal' ? 0 : 1,
        status: kpiStatus === 'normal' ? 'Monitor' : 'Need Review',
        bottleneck: 'Run live EWS calculation or verify the snapshot detail_json payload.',
      }, config, kpiStatus),
    ];
  }

  if (kpi.key === 'accuracy') return buildAccuracyRows(kpi, config, kpiStatus);
  if (kpi.key === 'adoption') return buildAdoptionRows(kpi, config, kpiStatus);
  if (kpi.key === 'uptime') return buildUptimeRows(kpi, config, kpiStatus);
  if (kpi.key === 'oee') return buildOeeRows(kpi, config, kpiStatus);
  if (kpi.key === 'ole') return buildOleRows(kpi, config, kpiStatus);
  return [];
}

function escalationLevel(issue, now = new Date()) {
  if (issue.status === 'Closed') return 'Closed';
  if (issue.severity !== 'Critical') return 'PIC Monitor';

  const createdMs = new Date(issue.createdDate).getTime();
  if (!Number.isFinite(createdMs)) return 'PIC Monitor';
  const ageHours = (now.getTime() - createdMs) / 36e5;
  if (ageHours > 3) return 'Plant Manager';
  if (ageHours > 1) return 'Supervisor/Foreman';
  return 'PIC Monitor';
}

function buildGeneratedIssuePayloads({ actionRows, config, kpi, meta }) {
  const createdDate = meta?.window_end || meta?.generated_at || new Date().toISOString();
  const scopeKey = `${config.label}:${createdDate}`;

  return actionRows
    .filter((row) => row.impact > 0 || row.severity === 'Critical')
    .slice(0, 8)
    .map((row) => ({
      issue_key: `${kpi?.key || config.label}:${createdDate}:${row.id}`,
      scope_type: 'system',
      scope_key: scopeKey,
      machine_id: row.area && !row.area.includes(' ') ? row.area : null,
      issue_description: `${row.area}: ${row.condition}`,
      error_type: row.errorType,
      pic: row.pic,
      action_taken: row.action,
      severity: row.severity === 'No Data' ? 'Watch' : row.severity,
      status: 'Open',
      created_date: createdDate,
      detail_json: {
        area: row.area,
        current: row.current,
        target: row.target,
        impact: row.impact,
        bottleneck: row.bottleneck,
        source_table: row.sourceTable,
        source_id: row.sourceId,
        kpi_value: kpi?.value ?? null,
        kpi_status: kpi?.status || 'no_data',
      },
    }));
}

function buildIssueRows({ actions, config, kpi, meta }) {
  const createdDate = meta?.window_end || meta?.generated_at || new Date().toISOString();

  return actions.map((action) => {
    const status = action.action_status === 'Closed' ? 'Closed' : 'Open';
    const solvedDate = action.solved_date || (status === 'Closed' ? action.last_updated : null);
    const nextIssue = {
      id: `action_${action.action_id}`,
      actionId: action.action_id,
      issueDescription: action.issue_description || action.status_reason || `${config.label} correction action for ${action.scope_key || action.machine_id || 'system'}`,
      errorType: action.error_type || config.errorType,
      pic: action.pic || config.pic,
      action: action.action_taken || config.action,
      severity: action.severity || (normalizeStatus(kpi?.status) === 'critical' ? 'Critical' : 'Watch'),
      status,
      createdDate: action.action_date || createdDate,
      solvedDate,
      source: 'Database',
    };
    return {
      ...nextIssue,
      escalation: action.escalation_level || escalationLevel(nextIssue),
    };
  });
}

function StatusBadge({ status }) {
  const key = status === 'Closed' ? 'closed' : normalizeStatus(status);
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${statusClass[key] || statusClass.no_data}`}>
      {status}
    </span>
  );
}

function SeverityDot({ severity }) {
  const label = severity || 'No Data';
  return (
    <span className="inline-flex items-center justify-center" title={label} aria-label={`Severity ${label}`}>
      <span className={`h-3.5 w-3.5 rounded-full border ${severityDotClass[label] || severityDotClass['No Data']}`} />
    </span>
  );
}

function PageCard({ children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

function TablePager({ page, totalPages, totalRows, onPageChange }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
      <span className="text-[11px] font-bold text-slate-500">
        Page {page} / {totalPages} - {totalRows} rows
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function EmptyChart({ text }) {
  return (
    <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-xs font-bold text-slate-500">
      {text}
    </div>
  );
}

function OeeWaterfallSvg({ data, width = 760, height = 320 }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const safeWidth = Math.max(Number(width) || 760, 320);
  const safeHeight = Math.max(Number(height) || 320, 260);
  const compact = safeWidth < 560;
  const margin = {
    top: 30,
    right: compact ? 10 : 18,
    bottom: compact ? 68 : 58,
    left: compact ? 42 : 56,
  };
  const widthValue = safeWidth;
  const heightValue = safeHeight;
  const chartWidth = widthValue - margin.left - margin.right;
  const chartHeight = heightValue - margin.top - margin.bottom;
  const maxValue = Math.max(
    1,
    ...data.flatMap((row) => [numeric(row.startValue, 0), numeric(row.endValue, 0)]),
  );
  const roundedMax = Math.ceil(maxValue / 5) * 5 || maxValue;
  const stepWidth = chartWidth / Math.max(data.length, 1);
  const barWidth = Math.max(20, Math.min(compact ? 42 : 70, stepWidth * 0.54));
  const yFor = (value) => margin.top + chartHeight - (numeric(value, 0) / roundedMax) * chartHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => roundedMax * ratio);
  const active = activeIndex !== null ? data[activeIndex] : null;

  return (
    <div className="relative h-full w-full">
      <svg width={widthValue} height={heightValue} role="img" aria-label="OEE waterfall chart">
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={margin.left} x2={widthValue - margin.right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />
              <text x={margin.left - 8} y={y + 4} textAnchor="end" className="fill-slate-500 text-[10px] font-semibold">
                {formatFixed2(tick)}h
              </text>
            </g>
          );
        })}
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + chartHeight} stroke="#94a3b8" />
        <line x1={margin.left} x2={widthValue - margin.right} y1={margin.top + chartHeight} y2={margin.top + chartHeight} stroke="#94a3b8" />

        {data.slice(0, -1).map((row, index) => {
          const x = margin.left + index * stepWidth + (stepWidth + barWidth) / 2;
          const nextX = margin.left + (index + 1) * stepWidth + (stepWidth - barWidth) / 2;
          const y = yFor(row.endValue);
          return (
            <line
              key={`connector-${row.name}-${index}`}
              x1={x}
              x2={nextX}
              y1={y}
              y2={y}
              stroke="#64748b"
              strokeDasharray="5 4"
              strokeWidth={1.4}
            />
          );
        })}

        {data.map((row, index) => {
          const x = margin.left + index * stepWidth + (stepWidth - barWidth) / 2;
          const topValue = Math.max(row.startValue, row.endValue);
          const bottomValue = Math.min(row.startValue, row.endValue);
          const y = yFor(topValue);
          const barHeight = Math.max(3, yFor(bottomValue) - y);
          const labelY = Math.max(14, y - 8);
          const deltaPrefix = row.displayValue < 0 ? '-' : row.stepType === 'total' || row.stepType === 'final' ? '' : '+';
          const showValueLabel = !compact || index === 0 || index === data.length - 1;

          return (
            <g
              key={`${row.name}-${index}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              tabIndex={0}
            >
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={5}
                fill={row.fill}
                stroke={activeIndex === index ? '#0f172a' : 'transparent'}
                strokeWidth={activeIndex === index ? 2 : 0}
              />
              {showValueLabel && (
                <text x={x + barWidth / 2} y={labelY} textAnchor="middle" className="fill-slate-700 text-[10px] font-extrabold">
                  {deltaPrefix}{formatFixed2(Math.abs(row.displayValue))}h
                </text>
              )}
              <text
                x={x + barWidth / 2}
                y={margin.top + chartHeight + (compact ? 18 : 20)}
                textAnchor="middle"
                className="fill-slate-700 text-[10px] font-bold"
              >
                {compact && row.name === 'Total Time' ? 'Total' : row.name}
              </text>
              {!compact && (
                <text x={x + barWidth / 2} y={margin.top + chartHeight + 36} textAnchor="middle" className="fill-slate-400 text-[10px] font-semibold">
                  {formatFixed2(row.endValue)}h
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {active && (
        <div className="pointer-events-none absolute right-2 top-2 z-50 max-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
          <div className="font-extrabold text-slate-900">{active.name}</div>
          <div className="mt-1 font-semibold text-slate-600">Start: {formatFixed2(active.startValue)}h</div>
          <div className="font-semibold text-slate-600">Delta: {active.displayValue < 0 ? '-' : ''}{formatFixed2(Math.abs(active.displayValue))}h</div>
          <div className="font-semibold text-slate-600">End: {formatFixed2(active.endValue)}h</div>
        </div>
      )}
    </div>
  );
}

function OeeWaterfallChart({ data }) {
  const [chartSize, setChartSize] = useState({ width: 760, height: 330 });

  return (
    <ResponsiveContainer
      width="100%"
      height={330}
      onResize={(width, height) => {
        setChartSize({
          width: Math.max(Math.round(width || 760), 320),
          height: Math.max(Math.round(height || 330), 260),
        });
      }}
    >
      <OeeWaterfallSvg data={data} width={chartSize.width} height={chartSize.height} />
    </ResponsiveContainer>
  );
}

function EwsDetailPage() {
  const navigate = useNavigate();
  const { type } = useParams();
  const [searchParams] = useSearchParams();
  const kpiType = String(type || '').toLowerCase();
  const config = KPI_CONFIG[kpiType];
  const [kpi, setKpi] = useState(null);
  const [meta, setMeta] = useState(null);
  const [actions, setActions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionPage, setActionPage] = useState(1);
  const [issuePage, setIssuePage] = useState(1);

  const manualDate = searchParams.get('date') || '';
  const usesManualDate = searchParams.get('basis') === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(manualDate);
  const ewsQuery = usesManualDate
    ? `basis=date&date=${encodeURIComponent(manualDate)}&live=1`
    : 'basis=today&live=1';
  const ewsSummaryQuery = usesManualDate
    ? ewsQuery
    : 'basis=today';

  const loadData = useCallback(async () => {
    if (!config) return;
    setIsLoading(true);
    setError('');

    try {
      const detailPromise = fetchJson(`${API_BASE}/ews/kpi/${kpiType}/detail?${ewsQuery}`)
        .catch((err) => {
          if (usesManualDate) throw err;
          return fetchJson(`${API_BASE}/ews/kpi/${kpiType}/detail?basis=today`);
        });
      const [detailResult, summaryResult] = await Promise.allSettled([
        detailPromise,
        fetchJson(`${API_BASE}/ews/summary?${ewsSummaryQuery}`),
      ]);

      const detailPayload = detailResult.status === 'fulfilled' ? detailResult.value : null;
      const summaryPayload = summaryResult.status === 'fulfilled' ? summaryResult.value : null;
      const fallbackKpi = summaryPayload?.kpis?.find((item) => item.key === kpiType);

      if (!detailPayload?.data && !fallbackKpi) {
        throw new Error(detailResult.reason?.message || 'EWS detail data is not available.');
      }

      const nextKpi = { key: kpiType, ...fallbackKpi, ...detailPayload?.data };
      const nextMeta = {
        ...(summaryPayload || {}),
        ...(detailPayload?.meta || {}),
      };
      const rowsForSync = buildActionRows(nextKpi, config);
      const issuesForSync = buildGeneratedIssuePayloads({
        actionRows: rowsForSync,
        config,
        kpi: nextKpi,
        meta: nextMeta,
      });

      if (issuesForSync.length) {
        await sendJson(`${API_BASE}/ews/actions/sync`, 'POST', {
          kpi_type: kpiType,
          issues: issuesForSync,
          updated_by: 'ews-detail-page',
        });
      }

      const actionsPayload = await fetchJson(`${API_BASE}/ews/actions?status=all&kpi_type=${encodeURIComponent(kpiType)}`);

      setKpi(nextKpi);
      setMeta(nextMeta);
      setSummary(summaryPayload);
      setActions(Array.isArray(actionsPayload?.data) ? actionsPayload.data : []);
    } catch (err) {
      setError(err.message || 'Failed to load EWS detail.');
    } finally {
      setIsLoading(false);
    }
  }, [config, ewsQuery, ewsSummaryQuery, kpiType, usesManualDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const relevantActions = useMemo(() => (
    actions.filter((action) => String(action.kpi_type || '').toLowerCase() === kpiType)
  ), [actions, kpiType]);

  const actionRows = useMemo(() => buildActionRows(kpi, config || KPI_CONFIG.accuracy), [config, kpi]);

  const issueRows = useMemo(() => buildIssueRows({
    actions: relevantActions,
    config: config || KPI_CONFIG.accuracy,
    kpi,
    meta,
  }), [config, kpi, meta, relevantActions]);

  const actionTotalPages = useMemo(() => pageCount(actionRows), [actionRows]);
  const issueTotalPages = useMemo(() => pageCount(issueRows), [issueRows]);
  const pagedActionRows = useMemo(() => pageSlice(actionRows, actionPage), [actionPage, actionRows]);
  const pagedIssueRows = useMemo(() => pageSlice(issueRows, issuePage), [issuePage, issueRows]);

  useEffect(() => {
    setActionPage(1);
    setIssuePage(1);
  }, [kpiType, kpi?.value, meta?.window_end]);

  useEffect(() => {
    if (actionPage > actionTotalPages) setActionPage(actionTotalPages);
  }, [actionPage, actionTotalPages]);

  useEffect(() => {
    if (issuePage > issueTotalPages) setIssuePage(issueTotalPages);
  }, [issuePage, issueTotalPages]);

  const bottleneckData = useMemo(() => (
    actionRows
      .filter((row) => row.impact > 0)
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 8)
      .map((row) => ({
        name: row.area.length > 18 ? `${row.area.slice(0, 18)}...` : row.area,
        impact: Number(row.impact.toFixed(1)),
        severity: row.severity,
      }))
  ), [actionRows]);

  const issueInsightData = useMemo(() => {
    const groups = issueRows.reduce((acc, issue) => {
      const key = issue.escalation || 'PIC Monitor';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(groups).map(([name, value]) => ({ name, value }));
  }, [issueRows]);

  const oeeWaterfallData = useMemo(
    () => buildOeeWaterfallChartData(kpi?.source_detail || {}),
    [kpi],
  );

  const oeeDistributionData = useMemo(
    () => buildOeeDistributionChartData(kpi?.source_detail || {}),
    [kpi],
  );

  const kpiStatus = normalizeStatus(kpi?.status);
  const Icon = config?.icon || AlertTriangle;

  const handleResolve = useCallback(async (issue) => {
    if (!issue.actionId) return;
    try {
      await sendJson(`${API_BASE}/ews/actions/${issue.actionId}/resolve`, 'PUT', {
        updated_by: 'ews-detail-page',
      });
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to resolve EWS issue.');
    }
  }, [loadData]);

  if (!config) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-6">
        <PageCard className="mx-auto max-w-xl p-6 text-center">
          <AlertTriangle className="mx-auto h-9 w-9 text-amber-600" />
          <h1 className="mt-3 text-base font-extrabold text-slate-900">Unknown EWS category</h1>
          <button
            type="button"
            onClick={() => navigate('/operations-hub')}
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[#0096c7] px-4 text-sm font-extrabold text-white hover:bg-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          >
            Back to Operations Hub
          </button>
        </PageCard>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95"
              aria-label="Back to Operations Hub"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]">
              <Icon size={21} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#0077b6]">EWS Detail</p>
              <h1 className="truncate text-base font-black text-slate-900 md:text-lg">{config.title}</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={kpiStatus === 'no_data' ? 'No Data' : kpiStatus.toUpperCase()} />
            <span className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700">
              <BarChart3 size={14} className="text-[#0077b6]" />
              {formatPercent(kpi?.value)}
            </span>
            <span className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500">
              <Clock3 size={14} />
              {formatDateTime(meta?.window_end || summary?.window_end)}
            </span>
            <button
              type="button"
              onClick={loadData}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4 md:px-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <PageCard className="p-6 text-sm font-bold text-slate-500">Loading EWS detail...</PageCard>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <PageCard className="p-4">
                <p className="text-[11px] font-bold uppercase text-slate-500">Current KPI</p>
                <p className="mt-2 text-2xl font-black text-slate-950">{formatPercent(kpi?.value)}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">Target {config.target}%</p>
              </PageCard>
              <PageCard className="p-4">
                <p className="text-[11px] font-bold uppercase text-slate-500">Open Issues</p>
                <p className="mt-2 text-2xl font-black text-slate-950">{issueRows.filter((item) => item.status !== 'Closed').length}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">With PIC and action</p>
              </PageCard>
              <PageCard className="p-4">
                <p className="text-[11px] font-bold uppercase text-slate-500">Critical Escalation</p>
                <p className="mt-2 text-2xl font-black text-red-600">{issueRows.filter((item) => item.escalation === 'Plant Manager').length}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">Critical open over 3h</p>
              </PageCard>
              <PageCard className="p-4">
                <p className="text-[11px] font-bold uppercase text-slate-500">Main Owner</p>
                <p className="mt-2 text-2xl font-black text-slate-950">{config.pic}</p>
                <p className="mt-1 truncate text-xs font-semibold text-slate-500">{kpi?.helper || config.action}</p>
              </PageCard>
            </section>

            {kpiType === 'oee' ? (
              <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <PageCard className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <BarChart3 size={17} className="text-[#0077b6]" />
                    <h2 className="text-sm font-extrabold text-slate-900">OEE Time Waterfall</h2>
                  </div>
                  {oeeWaterfallData.length ? (
                    <OeeWaterfallChart data={oeeWaterfallData} />
                  ) : (
                    <EmptyChart text="No machine time waterfall data available for this window." />
                  )}
                </PageCard>

                <PageCard className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <BarChart3 size={17} className="text-[#0077b6]" />
                    <h2 className="text-sm font-extrabold text-slate-900">Machine Time Mix by Machine (100%)</h2>
                  </div>
                  {oeeDistributionData.length ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={oeeDistributionData} layout="vertical" margin={{ top: 4, right: 20, left: 84, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                        <XAxis
                          type="number"
                          domain={[0, 100]}
                          ticks={[0, 25, 50, 75, 100]}
                          tick={{ fontSize: 11 }}
                          tickFormatter={formatFixedPercent}
                        />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={92} />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            const row = payload[0]?.payload;
                            return (
                              <div className="z-50 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                                <div className="font-extrabold text-slate-800">{label}</div>
                                <div className="mt-1 font-semibold text-slate-600">VA: {formatFixedPercent(row.VA)} ({formatFixed2(row.vaHours)}h)</div>
                                <div className="font-semibold text-slate-600">NNVA: {formatFixedPercent(row.NNVA)} ({formatFixed2(row.nnvaHours)}h)</div>
                                <div className="font-semibold text-slate-600">NVA: {formatFixedPercent(row.NVA)} ({formatFixed2(row.nvaHours)}h)</div>
                                <div className="font-semibold text-slate-600">NoJob: {formatFixedPercent(row.NoJob)} ({formatFixed2(row.nojobHours)}h)</div>
                              </div>
                            );
                          }}
                          wrapperStyle={{ zIndex: 50 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                        <Bar dataKey="VA" stackId="mix" fill={machineMixColors.VA} />
                        <Bar dataKey="NNVA" stackId="mix" fill={machineMixColors.NNVA} />
                        <Bar dataKey="NVA" stackId="mix" fill={machineMixColors.NVA} />
                        <Bar dataKey="NoJob" stackId="mix" fill={machineMixColors.NoJob} radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChart text="No per-machine OEE distribution data available for this window." />
                  )}
                </PageCard>
              </section>
            ) : (
              <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <PageCard className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <BarChart3 size={17} className="text-[#0077b6]" />
                    <h2 className="text-sm font-extrabold text-slate-900">Bottleneck Pareto</h2>
                  </div>
                  {bottleneckData.length ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={bottleneckData} layout="vertical" margin={{ top: 4, right: 16, left: 72, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                        <Tooltip formatter={(value) => [formatNumber(value), 'Impact']} />
                        <Bar dataKey="impact" radius={[0, 6, 6, 0]}>
                          {bottleneckData.map((entry) => (
                            <Cell key={entry.name} fill={severityColor[entry.severity] || '#0096c7'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChart text="No measurable bottleneck in this EWS window." />
                  )}
                </PageCard>

                <PageCard className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <AlertTriangle size={17} className="text-amber-600" />
                    <h2 className="text-sm font-extrabold text-slate-900">Escalation Distribution</h2>
                  </div>
                  {issueInsightData.length ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={issueInsightData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={58}
                          outerRadius={92}
                          paddingAngle={2}
                        >
                          {issueInsightData.map((entry) => (
                            <Cell
                              key={entry.name}
                              fill={entry.name === 'Plant Manager' ? '#dc2626' : entry.name === 'Supervisor/Foreman' ? '#f59e0b' : entry.name === 'Closed' ? '#059669' : '#0096c7'}
                            />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value, name) => [formatNumber(value), name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChart text="No issue log entries available for escalation analysis." />
                  )}
                </PageCard>
              </section>
            )}

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <PageCard className="overflow-hidden border-[#90e0ef]/80">
                <div className="border-b border-slate-200 bg-gradient-to-r from-white via-[#caf0f8]/45 to-white px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-[#0077b6]">EWS//ISSUE_STREAM</p>
                      <h2 className="mt-1 text-sm font-extrabold text-slate-900">Issue Log & Correction System</h2>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        Critical open issue dieskalasi ke Supervisor/Foreman setelah 1 jam, dan Plant Manager setelah 3 jam.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                      <span className="h-2 w-2 rounded-full bg-[#0096c7] shadow-[0_0_10px_rgba(0,150,199,0.55)]" />
                      <span className="font-mono text-[11px] font-black text-slate-700">{issueRows.length} LOGS</span>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-[#90e0ef]" style={{ background: '#caf0f8' }}>
                      <tr className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                        <th className="px-3 py-2">Issue</th>
                        <th className="px-3 py-2">Owner</th>
                        <th className="px-3 py-2 text-center">Severity</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Resolve</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {issueRows.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-xs font-bold text-slate-500">
                            No open issue generated for this KPI window.
                          </td>
                        </tr>
                      )}
                      {pagedIssueRows.map((issue) => (
                        <tr key={issue.id} className="align-top transition hover:bg-[#caf0f8]/25">
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-800">{issue.issueDescription}</div>
                            <div className="mt-1 font-mono text-[11px] font-bold uppercase text-[#0077b6]">{issue.errorType}</div>
                            <div className="mt-1 font-mono text-[11px] text-slate-500">
                              {formatDateTime(issue.createdDate)} - solved {formatDateTime(issue.solvedDate)}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-700">{issue.pic}</div>
                            <div className="mt-1 font-mono text-[11px] font-semibold text-slate-500">{issue.escalation}</div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <SeverityDot severity={issue.severity} />
                          </td>
                          <td className="px-3 py-2"><StatusBadge status={issue.status} /></td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              disabled={issue.status === 'Closed'}
                              onClick={() => handleResolve(issue)}
                              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50"
                              title="Resolve issue"
                              aria-label="Resolve issue"
                            >
                              <CheckCircle2 size={17} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePager
                  page={issuePage}
                  totalPages={issueTotalPages}
                  totalRows={issueRows.length}
                  onPageChange={setIssuePage}
                />
              </PageCard>

              <PageCard className="overflow-hidden border-[#90e0ef]/80">
                <div className="border-b border-slate-200 bg-gradient-to-r from-white via-[#caf0f8]/45 to-white px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-[#0077b6]">EWS//ACTION_QUEUE</p>
                      <h2 className="mt-1 text-sm font-extrabold text-slate-900">Action Table</h2>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        Focus pada area, kondisi, impact, PIC, dan action yang perlu dilakukan.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                      <span className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.45)]" />
                      <span className="font-mono text-[11px] font-black text-slate-700">{actionRows.length} TASKS</span>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-[#90e0ef]" style={{ background: '#caf0f8' }}>
                      <tr className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                        <th className="px-3 py-2">Area</th>
                        <th className="px-3 py-2">Condition</th>
                        <th className="px-3 py-2">Impact</th>
                        <th className="px-3 py-2">PIC</th>
                        <th className="px-3 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {actionRows.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-xs font-bold text-slate-500">
                            No action candidate generated for this KPI window.
                          </td>
                        </tr>
                      )}
                      {pagedActionRows.map((row) => (
                        <tr key={row.id} className="align-top transition hover:bg-[#caf0f8]/25">
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-800">{row.area}</div>
                            <div className="mt-1"><StatusBadge status={row.status} /></div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-700">{row.condition}</div>
                            <div className="mt-1 text-[11px] text-slate-500">{row.bottleneck}</div>
                            <div className="mt-1 font-mono text-[11px] font-semibold text-slate-500">
                              {row.sourceTable} / {row.sourceId}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-800">{formatNumber(row.impact)}</div>
                            <div className="mt-1 font-mono text-[11px] text-slate-500">
                              {row.current} / {row.target}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-bold text-slate-700">{row.pic}</td>
                          <td className="px-3 py-2 text-slate-600">{row.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePager
                  page={actionPage}
                  totalPages={actionTotalPages}
                  totalRows={actionRows.length}
                  onPageChange={setActionPage}
                />
              </PageCard>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default EwsDetailPage;
