import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Gauge as GaugeIcon,
  HardHat,
  Lightbulb,
  Minus,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  Wifi,
  Wrench,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { STATUS_TOKENS, badgeStyle, statusKey } from '../theme/ewsStatus';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const DETAIL_TABLE_PAGE_SIZE = 6;

// In-memory stale-while-revalidate cache so switching between KPIs (or returning
// to one) paints instantly from the last payload instead of re-fetching.
const detailMemCache = new Map();
const DETAIL_MEM_TTL_MS = 45 * 1000;

const KPI_CONFIG = {
  uptime: {
    label: 'Uptime',
    title: 'System Uptime Detail',
    target: 99,
    icon: Wifi,
    pic: 'IT (Wira)',
    errorType: 'Machine Offline',
    action: 'Cek jalur jaringan HMI dan ping DOWN yang berulang.',
    unit: 'machine',
  },
  accuracy: {
    label: 'Accuracy',
    title: 'Data Accuracy Detail',
    target: 98,
    icon: ClipboardCheck,
    pic: 'Foreman/Spv',
    errorType: 'Invalid Timesheet Data',
    action: 'Koreksi record error, cek master/order, lalu re-post ke SAP.',
    unit: 'record',
  },
  adoption: {
    label: 'Adoption',
    title: 'Timesheet Adoption Detail',
    target: 95,
    icon: UserCheck,
    pic: 'Foreman/Spv',
    errorType: 'Missing Time',
    action: 'Konfirmasi operator dan lengkapi input timesheet yang hilang.',
    unit: 'bucket',
  },
  oee: {
    label: 'OEE',
    title: 'Machine OEE Detail',
    target: 80,
    icon: GaugeIcon,
    pic: 'PPIC / Spv',
    errorType: 'Machine Loss',
    action: 'Review downtime, setup (M2), dan waktu mesin terhitung.',
    unit: 'machine',
  },
  ole: {
    label: 'OLE',
    title: 'Labor OLE Detail',
    target: 85,
    icon: HardHat,
    pic: 'Supervisor',
    errorType: 'Labor Efficiency Loss',
    action: 'Cek workflow, kesiapan material, dan coaching operator.',
    unit: 'operator',
  },
  // 8-KPI restructure (labour vs machine). Uptime placeholders + split accuracy/adoption.
  uptime_tablet: {
    label: 'Uptime Tablet', title: 'Uptime Tablet Detail', target: 99, icon: Wifi,
    pic: 'IT (Wira)', errorType: 'Tablet Offline', action: 'Cek konektivitas tablet operator.', unit: 'device',
  },
  uptime_hmi: {
    label: 'Uptime HMI', title: 'Uptime HMI Detail', target: 99, icon: Wifi,
    pic: 'IT (Wira)', errorType: 'HMI Offline', action: 'Cek jalur jaringan HMI dan ping DOWN berulang.', unit: 'machine',
  },
  accuracy_labour: {
    label: 'Accuracy Labour', title: 'Accuracy Labour Detail', target: 98, icon: ClipboardCheck,
    pic: 'Foreman/Spv', errorType: 'Invalid Timesheet Data', action: 'Koreksi order/operasi timesheet, cek SOW/SAP.', unit: 'record',
  },
  accuracy_machine: {
    label: 'Accuracy Machine', title: 'Accuracy Machine Detail', target: 98, icon: ClipboardCheck,
    pic: 'Foreman/Spv', errorType: 'Missing Machine Transaction', action: 'Cek mch_productiondata tanpa mch_transaction.', unit: 'record',
  },
  adoption_labour: {
    label: 'Adoption Labour', title: 'Adoption Labour Detail', target: 95, icon: UserCheck,
    pic: 'Foreman/Spv', errorType: 'Missing Attendance', action: 'Tandai cuti/sakit/izin operator; konfirmasi absen nyata.', unit: 'operator',
  },
  adoption_machine: {
    label: 'Adoption Machine', title: 'Adoption Machine Detail', target: 95, icon: UserCheck,
    pic: 'PPIC / Spv', errorType: 'Missing Time', action: 'Cek waktu mesin unidentified/idle vs input operator.', unit: 'machine',
  },
};

// Status/severity colours are derived from the shared token module so they are
// defined in exactly one place (theme/ewsStatus.js).
const STATUS_HEX = {
  normal: STATUS_TOKENS.normal.solid,
  watch: STATUS_TOKENS.watch.solid,
  critical: STATUS_TOKENS.critical.solid,
  no_data: STATUS_TOKENS.no_data.solid,
};

const SEV_HEX = {
  Critical: STATUS_TOKENS.critical.solid,
  Watch: STATUS_TOKENS.watch.solid,
  Normal: STATUS_TOKENS.normal.solid,
  Closed: STATUS_TOKENS.normal.solid,
  'No Data': STATUS_TOKENS.no_data.solid,
};

// Uptime status is anchored to the target, not to "has any failed ping".
// Configurable in one place: WATCH band = [target - margin, target), CRITICAL below.
const UPTIME_TARGET_PCT = KPI_CONFIG.uptime.target;   // 99
const UPTIME_WATCH_MARGIN_PCT = 2;                    // WATCH = 97%–99%, CRITICAL < 97%

function uptimeStatusKey(pct) {
  const value = Number(pct);
  if (!Number.isFinite(value)) return 'no_data';
  if (value >= UPTIME_TARGET_PCT) return 'normal';
  if (value >= UPTIME_TARGET_PCT - UPTIME_WATCH_MARGIN_PCT) return 'watch';
  return 'critical';
}

function uptimeColor(pct) {
  return STATUS_HEX[uptimeStatusKey(pct)];
}

const waterfallColors = {
  baseline: '#2563eb',
  negative: '#dc2626',
  positive: '#16a34a',
  final: '#16a34a',
};

const machineMixColors = {
  VA: '#16a34a',
  NNVA: '#f59e0b',
  NVA: '#ef4444',
  NoJob: '#94a3b8',
};

// Single-hue red ramp for non-productive labor: strongest at the top (highest
// value), softening toward the bottom. `index` 0 = top.
function unprodRedShade(index, total) {
  const t = total > 1 ? index / (total - 1) : 0;
  const lightness = Math.round(46 + t * 34); // 46% (kuat) -> 80% (soft)
  return `hsl(0, 74%, ${lightness}%)`;
}

const errorTypeLabels = {
  Missing: 'Missing (field kosong)',
  Invalid: 'Invalid (nilai salah)',
  Inconsistent: 'Inconsistent (durasi tidak cocok)',
  Outlier: 'Outlier (runtime abnormal)',
  Duplicate: 'Duplicate (record ganda)',
};

const gapTypeLabels = {
  missing_timesheet: 'Missing Timesheet',
  unidentified: 'Unidentified Operator',
  covered: 'Covered',
};

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'critical' || status === 'error') return 'critical';
  if (status === 'watch' || status === 'warning' || status === 'stale') return 'watch';
  if (status === 'normal' || status === 'fresh' || status === 'live') return 'normal';
  return 'no_data';
}

function sevFromStatus(status) {
  const s = normalizeStatus(status);
  if (s === 'critical') return 'Critical';
  if (s === 'watch') return 'Watch';
  if (s === 'no_data') return 'No Data';
  return 'Normal';
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function formatHours(value, fallback = '-') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return `${parsed.toFixed(1)}h`;
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

function businessDateOf(meta) {
  const raw = meta?.window_end || meta?.generated_at;
  const iso = raw ? String(raw) : new Date().toISOString();
  return iso.slice(0, 10);
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

function pageCount(items, pageSize = DETAIL_TABLE_PAGE_SIZE) {
  return Math.max(1, Math.ceil((items?.length || 0) / pageSize));
}

function pageSlice(items, page, pageSize = DETAIL_TABLE_PAGE_SIZE) {
  const start = Math.max(0, page - 1) * pageSize;
  return (items || []).slice(start, start + pageSize);
}

/* ------------------------------------------------------------------ *
 * Cross-KPI diagnosis (Insight #4 & #6 from the EWS plan)
 * ------------------------------------------------------------------ */
function buildDiagnosis(kpiType, kpi, kpisByKey) {
  const status = normalizeStatus(kpi?.status);
  const low = status === 'critical' || status === 'watch';
  const v = (k) => {
    const x = Number(kpisByKey?.[k]?.value);
    return Number.isFinite(x) ? x : null;
  };
  const oee = v('oee');
  const ole = v('ole');
  const adoption = v('adoption');
  const points = [];
  let headline;

  const isLow = (val, target) => val !== null && target !== null && val < target;

  if (kpiType === 'uptime') {
    headline = low ? 'Konektivitas mesin bermasalah' : 'Konektivitas mesin sehat';
    if (low) points.push('Ping/heartbeat gagal berulang. Saat uptime turun, KPI mesin (OEE & Adoption) bisa misleading karena telemetry tertunda.');
    points.push('Proteksi false-alert: hanya kegagalan ≥6 sampel berturut (±1 menit) yang dihitung sebagai downtime nyata — ping blip tunggal diabaikan.');
  } else if (kpiType === 'accuracy') {
    headline = low ? 'Kualitas data rendah — perlu koreksi' : 'Data akurat & dapat dipercaya';
    if (low) points.push('Data belum bisa dipercaya sebelum error dikoreksi. Perbaiki record error dulu sebelum menilai KPI produksi.');
    if (kpi?.detail?.minimum_sample_met === false) points.push('Sampel < 50 record — alert diperlakukan sebagai indikatif (proteksi false-alert).');
    if (low && isLow(adoption, 95)) points.push('Accuracy + Adoption sama-sama rendah → indikasi masalah input/disiplin operator, bukan performa produksi (Insight #6).');
  } else if (kpiType === 'adoption') {
    headline = low ? 'Coverage input rendah (trust ↓)' : 'Adopsi input operator baik';
    points.push('Adoption adalah indikator TRUST. Coverage rendah membuat OEE & OLE understated karena aktivitas mesin tidak terwakili timesheet.');
    if (low && isLow(ole, 85)) points.push('Adoption + OLE sama-sama rendah → kemungkinan besar input issue, bukan inefisiensi nyata (Insight #6).');
  } else if (kpiType === 'oee') {
    headline = low ? 'Utilisasi mesin di bawah target' : 'Utilisasi mesin sehat';
    if (low && ole !== null && ole >= 85) points.push('OEE rendah + OLE tinggi → masalah ada di MESIN (downtime/setup). Operator sudah efektif (Insight #4).');
    if (low && isLow(ole, 85)) points.push('OEE & OLE sama-sama rendah → cek dulu Uptime/Adoption; bisa jadi masalah data, bukan mesin.');
    points.push('NoJob & Off dikecualikan dari denominator; micro-stop <1 jam ditandai terpisah agar tidak dianggap downtime besar.');
  } else if (kpiType === 'ole') {
    headline = low ? 'Efektivitas labor di bawah target' : 'Efektivitas labor sehat';
    if (low && oee !== null && oee >= 80) points.push('OLE rendah + OEE tinggi → mesin OK tapi LABOR tidak efektif. Cek workflow & kesiapan material (Insight #4).');
    if (low && isLow(adoption, 95)) points.push('OLE rendah + Adoption rendah → cek dulu apakah ini input issue sebelum menyalahkan operator (Insight #6).');
    points.push('Waktu Idle = labor tercatat tanpa order produktif; inilah gap utama yang menekan OLE.');
  } else {
    headline = kpi?.helper || 'Detail KPI';
  }

  return { tone: status, headline, points };
}

/* ------------------------------------------------------------------ *
 * Action rows — built from AGGREGATED breakdowns (not raw sample rows)
 * Each row is one meaningful entity: a machine, an operator, or an
 * error category. `isIssue` marks rows worth escalating to the log.
 * ------------------------------------------------------------------ */
function makeRow(row) {
  return {
    scope: 'system',
    entityId: null,
    pic: null,
    action: null,
    errorType: null,
    sortValue: 0,
    isIssue: false,
    severity: 'Normal',
    ...row,
  };
}

function buildUptimeRows(kpi, config) {
  const byMachine = kpi?.source_detail?.by_machine || [];
  return byMachine
    .filter((m) => numeric(m.failed_count) > 0 || numeric(m.max_consecutive_fail) > 0)
    .map((m) => {
      const consecutive = numeric(m.max_consecutive_fail);
      const failed = numeric(m.failed_count);
      const real = consecutive >= 6;
      return makeRow({
        entityId: m.machineid || m.machinename,
        area: m.machinename || m.machineid || 'UNKNOWN',
        metric: `${formatNumber(m.uptime_pct)}%`,
        metricLabel: 'uptime',
        detail: `${formatNumber(failed)} gagal · ${consecutive} berturut · loss ${formatNumber(m.downtime_minutes)} min · ${m.ipaddress || '-'}`,
        severity: real ? 'Critical' : 'Watch',
        errorType: real ? 'Machine Offline' : 'Ping Blip',
        action: real ? 'Cek power/network device, restart HMI, notify IT.' : 'Monitor — belum mencapai ambang downtime nyata.',
        pic: config.pic,
        sortValue: consecutive * 1000 + failed,
        isIssue: real,
      });
    })
    .sort((a, b) => b.sortValue - a.sortValue);
}

function buildAccuracyRows(kpi, config, kpiStatus) {
  const detail = kpi?.detail || {};
  const byType = kpi?.source_detail?.by_error_type || [];
  const minMet = detail.minimum_sample_met !== false;
  const rows = byType
    .filter((t) => numeric(t.error_records) > 0)
    .map((t) => makeRow({
      scope: 'error_type',
      entityId: t.error_type,
      area: errorTypeLabels[t.error_type] || t.error_type,
      metric: `${formatNumber(t.error_records)}`,
      metricLabel: 'record',
      detail: 'Kategori error dari timesheet + SAP staging pada window ini.',
      severity: kpiStatus === 'critical' ? 'Critical' : 'Watch',
      errorType: t.error_type,
      action: t.error_type === 'Missing'
        ? 'Lengkapi field kosong (order/operasi/planhours) lalu validasi ulang.'
        : t.error_type === 'Invalid'
          ? 'Koreksi nilai tidak valid, cek QR/order/master data.'
          : t.error_type === 'Duplicate'
            ? 'Hapus/gabung record ganda dengan timestamp identik.'
            : config.action,
      pic: config.pic,
      sortValue: numeric(t.error_records),
      // Only escalate when KPI itself is unhealthy AND sample size is meaningful.
      isIssue: (kpiStatus === 'critical' || kpiStatus === 'watch') && minMet,
    }))
    .sort((a, b) => b.sortValue - a.sortValue);
  return rows;
}

function buildAdoptionRows(kpi, config, kpiStatus) {
  const byMachine = kpi?.source_detail?.by_machine || [];
  return byMachine
    .filter((m) => numeric(m.missing_minutes) > 0)
    .slice(0, 12)
    .map((m) => makeRow({
      scope: 'machine',
      entityId: m.machine_key,
      area: m.machine_key || 'UNKNOWN',
      metric: `${formatNumber(m.missing_minutes)} min`,
      metricLabel: 'gap',
      detail: `${formatNumber(m.gap_buckets)} bucket 5-menit tanpa timesheet cocok.`,
      severity: kpiStatus === 'critical' ? 'Critical' : 'Watch',
      errorType: config.errorType,
      action: 'Konfirmasi operator yang menjalankan mesin & lengkapi input timesheet.',
      pic: config.pic,
      sortValue: numeric(m.missing_minutes),
      isIssue: kpiStatus === 'critical' || kpiStatus === 'watch',
    }))
    .sort((a, b) => b.sortValue - a.sortValue);
}

function buildOeeRows(kpi, config) {
  const byMachine = kpi?.source_detail?.by_machine || [];
  return byMachine
    .filter((m) => normalizeStatus(m.status) !== 'normal' && numeric(m.total_hours) > 0)
    .map((m) => makeRow({
      scope: 'machine',
      entityId: m.machineid,
      area: m.machinename || m.machineid || 'UNKNOWN',
      metric: `${formatNumber(m.oee_time_pct)}%`,
      metricLabel: 'oee',
      detail: `Loss ${formatHours(m.loss_hours)} dari ${formatHours(m.total_hours)} · ${formatNumber(m.stop_count)} stop event`,
      severity: sevFromStatus(m.status),
      errorType: 'Machine Loss',
      action: 'Cek breakdown/setup mesin, material readiness, dan technical support.',
      pic: config.pic,
      sortValue: numeric(m.loss_hours),
      isIssue: normalizeStatus(m.status) === 'critical' || normalizeStatus(m.status) === 'watch',
    }))
    .sort((a, b) => b.sortValue - a.sortValue);
}

function buildOleRows(kpi, config) {
  const byOperator = kpi?.source_detail?.by_operator || [];
  return byOperator
    .filter((o) => normalizeStatus(o.status) !== 'normal' && numeric(o.total_hours) > 0)
    .map((o) => makeRow({
      scope: 'operator',
      entityId: o.operator_id,
      area: o.operator_name || o.operator_id || 'UNKNOWN',
      metric: `${formatNumber(o.ole_time_pct)}%`,
      metricLabel: 'ole',
      detail: `Non-produktif ${formatHours(o.nva_hours)} dari ${formatHours(o.total_hours)} tercatat`,
      severity: sevFromStatus(o.status),
      errorType: 'Labor Efficiency Loss',
      action: 'Cek workflow, kesiapan material, dan koordinasi; coaching bila perlu.',
      pic: config.pic,
      sortValue: numeric(o.nva_hours),
      isIssue: normalizeStatus(o.status) === 'critical' || normalizeStatus(o.status) === 'watch',
    }))
    .sort((a, b) => b.sortValue - a.sortValue);
}

function buildActionRows(kpi, config) {
  if (!kpi || !config) return [];
  const kpiStatus = normalizeStatus(kpi.status);
  const key = kpi.key;
  if (key === 'uptime') return buildUptimeRows(kpi, config);
  if (key === 'accuracy') return buildAccuracyRows(kpi, config, kpiStatus);
  if (key === 'adoption') return buildAdoptionRows(kpi, config, kpiStatus);
  if (key === 'oee') return buildOeeRows(kpi, config);
  if (key === 'ole') return buildOleRows(kpi, config);
  return [];
}

/* Stable, deduplicated issue payloads — the key does NOT include a
 * per-minute timestamp, so re-syncs UPDATE the same row instead of
 * creating a new one every refresh (root cause of the old log noise). */
function buildIssuePayloads({ actionRows, kpi, config, meta }) {
  const bizDate = businessDateOf(meta);
  return actionRows
    .filter((row) => row.isIssue)
    .slice(0, 15)
    .map((row) => {
      const entity = String(row.entityId || row.area || 'ALL').replace(/\s+/g, '_');
      return {
        issue_key: `${kpi.key}:${bizDate}:${row.scope}:${entity}`,
        scope_type: row.scope,
        scope_key: `${config.label}:${bizDate}`,
        machine_id: row.scope === 'machine' ? row.entityId : null,
        issue_description: `${row.area}: ${row.detail}`,
        error_type: row.errorType || config.errorType,
        pic: row.pic || config.pic,
        action_taken: row.action || config.action,
        severity: row.severity === 'No Data' ? 'Watch' : row.severity,
        status: 'Open',
        created_date: meta?.window_end || meta?.generated_at || new Date().toISOString(),
        detail_json: {
          area: row.area,
          metric: `${row.metric} ${row.metricLabel || ''}`.trim(),
          scope: row.scope,
          entity_id: row.entityId,
          kpi_value: kpi?.value ?? null,
          kpi_status: kpi?.status || 'no_data',
        },
      };
    });
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

function buildIssueRows({ actions, config, kpi, meta }) {
  const createdDate = meta?.window_end || meta?.generated_at || new Date().toISOString();
  return actions.map((action) => {
    const status = action.action_status === 'Closed' ? 'Closed' : 'Open';
    const solvedDate = action.solved_date || (status === 'Closed' ? action.last_updated : null);
    const nextIssue = {
      id: `action_${action.action_id}`,
      actionId: action.action_id,
      issueDescription: action.issue_description || action.status_reason || `${config.label} correction`,
      metric: action.detail_json?.metric || '',
      errorType: action.error_type || config.errorType,
      pic: action.pic || config.pic,
      action: action.action_taken || config.action,
      severity: action.severity || (normalizeStatus(kpi?.status) === 'critical' ? 'Critical' : 'Watch'),
      status,
      createdDate: action.action_date || createdDate,
      solvedDate,
    };
    return { ...nextIssue, escalation: action.escalation_level || escalationLevel(nextIssue) };
  });
}

/* ------------------------------------------------------------------ *
 * OEE chart data (unchanged logic — still powered by source_detail)
 * ------------------------------------------------------------------ */
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
    const displayName = row.step_type === 'final' || row.label === 'VA' ? 'Running' : row.label || 'Step';
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

/* ------------------------------------------------------------------ *
 * Presentational primitives
 * ------------------------------------------------------------------ */
function StatusBadge({ status }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-extrabold" style={badgeStyle(status)}>
      {status}
    </span>
  );
}

function SeverityDot({ severity }) {
  const label = severity || 'No Data';
  const token = STATUS_TOKENS[statusKey(label)] || STATUS_TOKENS.no_data;
  return (
    <span className="inline-flex items-center justify-center" title={label} aria-label={`Severity ${label}`}>
      <span
        className="h-3.5 w-3.5 rounded-full border"
        style={{ backgroundColor: token.solid, borderColor: token.border, boxShadow: `0 0 0 4px ${token.bg}` }}
      />
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

function CardHead({ icon: Icon, title, tag, right }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon size={16} className="flex-shrink-0 text-[#0077b6]" /> : null}
        <h2 className="truncate text-sm font-extrabold text-slate-900">{title}</h2>
        {tag ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{tag}</span> : null}
      </div>
      {right}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-xs font-bold text-slate-500">
      {text}
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

const TILE_TONES = {
  info: { bg: '#caf0f8', border: '#90e0ef', text: '#0077b6' },
  good: { bg: '#f0fdf4', border: '#bbf7d0', text: '#047857' },
  warn: { bg: '#fffbeb', border: '#fde68a', text: '#b45309' },
  bad: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
  neutral: { bg: '#f8fafc', border: '#e2e8f0', text: '#334155' },
};

function MetricTile({ label, value, sub, tone = 'neutral' }) {
  const t = TILE_TONES[tone] || TILE_TONES.neutral;
  return (
    <div className="rounded-xl border px-3 py-2.5 shadow-sm" style={{ background: t.bg, borderColor: t.border }}>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: t.text }}>{label}</div>
      <div className="mt-1 text-lg font-black leading-none" style={{ color: t.text }}>{value}</div>
      {sub ? <div className="mt-1 text-[10px] font-semibold text-slate-500">{sub}</div> : null}
    </div>
  );
}

function RankedList({ items = [], valueOf, labelOf, subOf, colorOf, valueFmt, emptyText = 'Tidak ada data.', initialCount }) {
  const [page, setPage] = useState(0);
  if (!items.length) return <EmptyState text={emptyText} />;
  const max = Math.max(...items.map((i) => Math.abs(numeric(valueOf(i)))), 1);
  const paged = initialCount != null && items.length > initialCount;
  const pageSize = paged ? initialCount : items.length;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const shown = items.slice(start, start + pageSize);
  return (
    <>
      {/* Fixed min-height keeps the container height static across pages. */}
      <ul className="space-y-2.5" style={paged ? { minHeight: pageSize * 46 } : undefined}>
        {shown.map((item, idx) => {
          const raw = numeric(valueOf(item));
          const width = Math.max(3, (Math.abs(raw) / max) * 100);
          const color = colorOf ? colorOf(item) : '#0096c7';
          return (
            <li key={start + idx}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs font-bold text-slate-700">{labelOf(item)}</span>
                <span className="flex-shrink-0 font-mono text-xs font-extrabold text-slate-800">
                  {valueFmt ? valueFmt(item) : formatNumber(raw)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
              </div>
              {subOf ? <div className="mt-1 text-[10px] font-semibold text-slate-500">{subOf(item)}</div> : null}
            </li>
          );
        })}
      </ul>
      {paged && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <span className="text-[10px] font-bold text-slate-400">{start + 1}–{start + shown.length} / {items.length}</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => setPage(safePage - 1)}
              className="inline-flex min-h-[30px] items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-extrabold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(safePage + 1)}
              className="inline-flex min-h-[30px] items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-extrabold text-[#0077b6] transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Gauge({ value, target, status }) {
  const v = Number.isFinite(Number(value)) ? Number(value) : null;
  const fill = v === null ? 0 : Math.max(0, Math.min(100, v));
  const r = 54;
  const circumference = 2 * Math.PI * r;
  const dash = (fill / 100) * circumference;
  const color = STATUS_HEX[normalizeStatus(status)] || '#94a3b8';
  const targetAngle = target !== null && target !== undefined ? Math.max(0, Math.min(100, target)) : null;
  return (
    <div className="relative flex h-[140px] w-[140px] items-center justify-center">
      <svg width={140} height={140} viewBox="0 0 140 140" className="-rotate-90">
        <circle cx={70} cy={70} r={r} fill="none" stroke="#e2e8f0" strokeWidth={12} />
        <circle
          cx={70}
          cy={70}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
        {targetAngle !== null && (
          <circle
            cx={70 + r * Math.cos((targetAngle / 100) * 2 * Math.PI)}
            cy={70 + r * Math.sin((targetAngle / 100) * 2 * Math.PI)}
            r={4}
            fill="#0f172a"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-slate-900">{v === null ? '--' : `${v.toFixed(1)}`}</span>
        <span className="text-[10px] font-bold text-slate-400">{v === null ? 'no data' : '% of window'}</span>
      </div>
    </div>
  );
}

function DeltaChip({ comparison }) {
  const delta = comparison?.delta;
  if (delta === null || delta === undefined) return null;
  const up = delta > 0;
  const flat = delta === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const cls = flat
    ? 'border-slate-200 bg-slate-50 text-slate-500'
    : up
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-red-200 bg-red-50 text-red-700';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${cls}`} title="vs periode sebelumnya (hari yang sama)">
      <Icon size={12} />
      {up ? '+' : ''}{Number(delta).toFixed(1)} pt
    </span>
  );
}

function TablePager({ page, totalPages, totalRows, onPageChange }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
      <span className="text-[11px] font-bold text-slate-500">Page {page} / {totalPages} · {totalRows} rows</span>
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

/* ---- OEE waterfall SVG (kept from previous version) ---- */
function OeeWaterfallSvg({ data, width = 760, height = 320 }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const safeWidth = Math.max(Number(width) || 760, 320);
  const safeHeight = Math.max(Number(height) || 320, 260);
  const compact = safeWidth < 560;
  const margin = { top: 30, right: compact ? 10 : 18, bottom: compact ? 68 : 58, left: compact ? 42 : 56 };
  const chartWidth = safeWidth - margin.left - margin.right;
  const chartHeight = safeHeight - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...data.flatMap((row) => [numeric(row.startValue, 0), numeric(row.endValue, 0)]));
  const roundedMax = Math.ceil(maxValue / 5) * 5 || maxValue;
  const stepWidth = chartWidth / Math.max(data.length, 1);
  const barWidth = Math.max(20, Math.min(compact ? 42 : 70, stepWidth * 0.54));
  const yFor = (value) => margin.top + chartHeight - (numeric(value, 0) / roundedMax) * chartHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => roundedMax * ratio);
  const active = activeIndex !== null ? data[activeIndex] : null;

  return (
    <div className="relative h-full w-full">
      <svg width={safeWidth} height={safeHeight} role="img" aria-label="OEE waterfall chart">
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={margin.left} x2={safeWidth - margin.right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />
              <text x={margin.left - 8} y={y + 4} textAnchor="end" className="fill-slate-500 text-[10px] font-semibold">{formatFixed2(tick)}h</text>
            </g>
          );
        })}
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + chartHeight} stroke="#94a3b8" />
        <line x1={margin.left} x2={safeWidth - margin.right} y1={margin.top + chartHeight} y2={margin.top + chartHeight} stroke="#94a3b8" />
        {data.slice(0, -1).map((row, index) => {
          const x = margin.left + index * stepWidth + (stepWidth + barWidth) / 2;
          const nextX = margin.left + (index + 1) * stepWidth + (stepWidth - barWidth) / 2;
          const y = yFor(row.endValue);
          return <line key={`connector-${row.name}-${index}`} x1={x} x2={nextX} y1={y} y2={y} stroke="#64748b" strokeDasharray="5 4" strokeWidth={1.4} />;
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
            <g key={`${row.name}-${index}`} onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)} onFocus={() => setActiveIndex(index)} tabIndex={0}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx={5} fill={row.fill} stroke={activeIndex === index ? '#0f172a' : 'transparent'} strokeWidth={activeIndex === index ? 2 : 0} />
              {showValueLabel && (
                <text x={x + barWidth / 2} y={labelY} textAnchor="middle" className="fill-slate-700 text-[10px] font-extrabold">{deltaPrefix}{formatFixed2(Math.abs(row.displayValue))}h</text>
              )}
              <text x={x + barWidth / 2} y={margin.top + chartHeight + (compact ? 18 : 20)} textAnchor="middle" className="fill-slate-700 text-[10px] font-bold">{compact && row.name === 'Total Time' ? 'Total' : row.name}</text>
              {!compact && (
                <text x={x + barWidth / 2} y={margin.top + chartHeight + 36} textAnchor="middle" className="fill-slate-400 text-[10px] font-semibold">{formatFixed2(row.endValue)}h</text>
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
      onResize={(width, height) => setChartSize({ width: Math.max(Math.round(width || 760), 320), height: Math.max(Math.round(height || 330), 260) })}
    >
      <OeeWaterfallSvg data={data} width={chartSize.width} height={chartSize.height} />
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ *
 * KPI-specific breakdown sections (all fed by real source_detail)
 * ------------------------------------------------------------------ */
function severityColorForStatusStr(s) {
  return SEV_HEX[sevFromStatus(s)] || STATUS_TOKENS.normal.solid;
}

function UptimeBreakdown({ kpi }) {
  const byMachine = (kpi?.source_detail?.by_machine || []).slice(0, 10);
  const offenders = byMachine.filter((m) => numeric(m.failed_count) > 0 || numeric(m.max_consecutive_fail) > 0);
  const hourly = (kpi?.source_detail?.hourly || []).map((h) => ({
    hour: h.hour_label,
    failed: numeric(h.failed_count),
    pings: numeric(h.ping_count),
    uptime: numeric(h.uptime_pct),
  }));
  const uptimeMin = hourly.length ? Math.min(...hourly.map((h) => h.uptime)) : 100;
  const uptimeFloor = Math.max(0, Math.floor(uptimeMin * 2) / 2 - 0.5);
  return (
    <div className="space-y-4">
      <PageCard>
        <CardHead icon={Activity} title="Uptime per Jam — Tanggal Terakhir" tag={`${hourly.length}j`} />
        <div className="p-4">
          {hourly.length ? (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={hourly} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} allowDecimals={false} label={{ value: 'gagal', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis yAxisId="right" orientation="right" domain={[uptimeFloor, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={44} />
                  <Tooltip
                    cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                    formatter={(value, name) => (
                      name === 'uptime'
                        ? [`${formatFixed2(value)}%`, 'Uptime']
                        : [`${formatNumber(value)} gagal`, 'Failed ping']
                    )}
                    labelFormatter={(label) => `Jam ${label}`}
                  />
                  <Bar yAxisId="left" dataKey="failed" radius={[4, 4, 0, 0]} maxBarSize={26}>
                    {hourly.map((h) => (
                      <Cell key={h.hour} fill={uptimeColor(h.uptime)} />
                    ))}
                  </Bar>
                  <Line yAxisId="right" type="monotone" dataKey="uptime" stroke={uptimeColor(kpi?.value)} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="mt-2 text-[10px] font-semibold text-slate-400">
                Bar = failed ping/jam (tinggi = naik-turun) · warna = status uptime jam itu · garis = uptime% (skala kanan). Hijau ≥ {UPTIME_TARGET_PCT}%, amber {UPTIME_TARGET_PCT - UPTIME_WATCH_MARGIN_PCT}–{UPTIME_TARGET_PCT}%, merah &lt; {UPTIME_TARGET_PCT - UPTIME_WATCH_MARGIN_PCT}%.
              </p>
            </>
          ) : (
            <EmptyChart text="Tidak ada data ping per jam untuk tanggal terakhir." />
          )}
        </div>
      </PageCard>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <PageCard>
        <CardHead icon={Wifi} title="Uptime per Mesin (terendah)" tag={`${byMachine.length}`} />
        <div className="p-4">
          <RankedList
            items={byMachine}
            valueOf={(m) => numeric(m.uptime_pct)}
            labelOf={(m) => m.machinename || m.machineid || 'UNKNOWN'}
            valueFmt={(m) => `${formatNumber(m.uptime_pct)}%`}
            colorOf={(m) => uptimeColor(m.uptime_pct)}
            subOf={(m) => `${formatNumber(m.failed_count)} gagal · ${numeric(m.max_consecutive_fail)} berturut · loss ${formatNumber(m.downtime_minutes)} min`}
            emptyText="Semua mesin online — tidak ada kegagalan ping."
          />
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={AlertTriangle} title="Kegagalan Nyata (≥6 berturut)" />
        <div className="p-4">
          {offenders.length ? (
            <RankedList
              items={offenders}
              valueOf={(m) => numeric(m.max_consecutive_fail)}
              labelOf={(m) => m.machinename || m.machineid || 'UNKNOWN'}
              valueFmt={(m) => `${numeric(m.max_consecutive_fail)}x`}
              colorOf={(m) => (numeric(m.max_consecutive_fail) >= 6 ? SEV_HEX.Critical : SEV_HEX.Watch)}
              subOf={(m) => `${m.ipaddress || '-'} · latency ${formatNumber(m.avg_latency_ms)} ms · packet loss ${formatNumber(m.max_packet_loss_percent)}%`}
            />
          ) : (
            <EmptyState text="Belum ada mesin yang mencapai ambang downtime nyata (≥6 gagal berturut)." />
          )}
        </div>
      </PageCard>
      </section>
    </div>
  );
}

function AccuracyBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const byType = sd.by_error_type || [];
  const byMachine = (sd.by_machine || []).slice(0, 8);
  const byOperator = (sd.by_operator || []).slice(0, 8);
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <PageCard>
        <CardHead icon={ShieldCheck} title="Error per Kategori" />
        <div className="p-4">
          <RankedList
            items={byType}
            valueOf={(t) => numeric(t.error_records)}
            labelOf={(t) => errorTypeLabels[t.error_type] || t.error_type}
            valueFmt={(t) => formatNumber(t.error_records)}
            colorOf={() => SEV_HEX.Watch}
            emptyText="Tidak ada error terklasifikasi pada window ini."
          />
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={GaugeIcon} title="Hotspot Mesin" />
        <div className="p-4">
          <RankedList
            items={byMachine}
            valueOf={(m) => numeric(m.error_records)}
            labelOf={(m) => m.machine_id || 'UNKNOWN'}
            valueFmt={(m) => formatNumber(m.error_records)}
            colorOf={() => '#0096c7'}
            emptyText="Tidak ada mesin dengan error."
          />
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={Users} title="Hotspot Operator" />
        <div className="p-4">
          <RankedList
            items={byOperator}
            valueOf={(o) => numeric(o.error_records)}
            labelOf={(o) => o.operator_name || o.operator_id || 'UNKNOWN'}
            valueFmt={(o) => formatNumber(o.error_records)}
            colorOf={() => '#0077b6'}
            emptyText="Tidak ada operator dengan error."
          />
        </div>
      </PageCard>
    </section>
  );
}

function AdoptionBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const byGap = (sd.by_gap_type || []).map((g) => ({ name: gapTypeLabels[g.gap_type] || g.gap_type, value: numeric(g.missing_minutes), buckets: numeric(g.gap_buckets) }));
  const byMachine = (sd.by_machine || []).slice(0, 8);
  const byOperator = (sd.by_operator || []).slice(0, 8);
  const gapColors = ['#f59e0b', '#dc2626', '#0096c7'];
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <PageCard>
        <CardHead icon={AlertTriangle} title="Tipe Gap" />
        <div className="p-4">
          {byGap.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={byGap} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2}>
                  {byGap.map((entry, i) => <Cell key={entry.name} fill={gapColors[i % gapColors.length]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${formatNumber(value)} min`, name]} />
                <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="Tidak ada gap adopsi pada window ini." />
          )}
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={GaugeIcon} title="Gap per Mesin" />
        <div className="p-4">
          <RankedList
            items={byMachine}
            valueOf={(m) => numeric(m.missing_minutes)}
            labelOf={(m) => m.machine_key || 'UNKNOWN'}
            valueFmt={(m) => `${formatNumber(m.missing_minutes)} min`}
            colorOf={() => SEV_HEX.Watch}
            subOf={(m) => `${formatNumber(m.gap_buckets)} bucket`}
            emptyText="Tidak ada gap per mesin."
          />
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={Users} title="Gap per Operator" />
        <div className="p-4">
          <RankedList
            items={byOperator}
            valueOf={(o) => numeric(o.missing_minutes)}
            labelOf={(o) => o.operator_name || o.operator_key || 'UNKNOWN'}
            valueFmt={(o) => `${formatNumber(o.missing_minutes)} min`}
            colorOf={() => '#0077b6'}
            subOf={(o) => `${formatNumber(o.gap_buckets)} bucket`}
            emptyText="Tidak ada gap per operator."
          />
        </div>
      </PageCard>
    </section>
  );
}

function OeeBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const waterfall = buildOeeWaterfallChartData(sd);
  const distribution = buildOeeDistributionChartData(sd);
  const byLoss = (sd.by_loss_type || []).map((l) => ({ name: l.loss_type, hours: numeric(l.hours), events: numeric(l.event_count) }));
  const byMachine = (sd.by_machine || []).slice(0, 10);
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PageCard>
          <CardHead icon={BarChart3} title="OEE Time Waterfall" />
          <div className="p-4">{waterfall.length ? <OeeWaterfallChart data={waterfall} /> : <EmptyChart text="Tidak ada data waterfall pada window ini." />}</div>
        </PageCard>
        <PageCard>
          <CardHead icon={BarChart3} title="Machine Time Mix (100%)" />
          <div className="p-4">
            {distribution.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={distribution} layout="vertical" margin={{ top: 4, right: 20, left: 84, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 11 }} tickFormatter={formatFixedPercent} />
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
              <EmptyChart text="Tidak ada distribusi per-mesin pada window ini." />
            )}
          </div>
        </PageCard>
      </section>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PageCard>
          <CardHead icon={GaugeIcon} title="OEE per Mesin (terendah)" />
          <div className="p-4">
            <RankedList
              items={byMachine}
              valueOf={(m) => numeric(m.oee_time_pct)}
              labelOf={(m) => m.machinename || m.machineid || 'UNKNOWN'}
              valueFmt={(m) => `${formatNumber(m.oee_time_pct)}%`}
              colorOf={(m) => severityColorForStatusStr(m.status)}
              subOf={(m) => `run ${formatHours(m.running_hours)} / ${formatHours(m.total_hours)} · loss ${formatHours(m.loss_hours)}`}
              emptyText="Tidak ada data mesin."
            />
          </div>
        </PageCard>
        <PageCard>
          <CardHead icon={AlertTriangle} title="Loss by Type" />
          <div className="p-4">
            <RankedList
              items={byLoss}
              valueOf={(l) => l.hours}
              labelOf={(l) => l.name}
              valueFmt={(l) => formatHours(l.hours)}
              colorOf={(l) => machineMixColors[l.name] || '#ef4444'}
              subOf={(l) => `${formatNumber(l.events)} event`}
              emptyText="Tidak ada loss tercatat."
            />
          </div>
        </PageCard>
      </section>
    </div>
  );
}

function OleBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const byActivity = (sd.by_activity || [])
    .map((a) => ({
      name: a.activity_label || a.activity_bucket,
      code: a.activity_bucket,
      hours: numeric(a.hours),
      rec: numeric(a.record_count),
    }))
    .sort((a, b) => b.hours - a.hours);
  const chartActivity = byActivity
    .slice(0, 8)
    .map((a, i, arr) => ({ ...a, color: unprodRedShade(i, arr.length) }));
  const byOperator = (sd.by_operator || []).slice(0, 20);
  const byMachine = (sd.by_machine || []).slice(0, 20);
  return (
    <section className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
      <PageCard>
        <CardHead icon={Activity} title="Distribusi Non-Produktif Labor" tag={`${byActivity.length}`} />
        <div className="p-4">
          {chartActivity.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartActivity} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}h`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={118} interval={0} />
                <Tooltip
                  cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                  formatter={(value, name, entry) => [`${formatHours(value)} · ${formatNumber(entry?.payload?.rec)} record`, 'Durasi']}
                  labelFormatter={(label, payload) => `${label}${payload?.[0]?.payload?.code ? ` (${payload[0].payload.code})` : ''}`}
                />
                <Bar dataKey="hours" radius={[0, 6, 6, 0]} maxBarSize={26}>
                  {chartActivity.map((entry) => <Cell key={entry.code} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="Tidak ada waktu non-produktif labor pada window ini." />
          )}
          <p className="mt-2 text-[10px] font-semibold text-slate-400">Durasi non-produktif per jenis aktivitas (activitytype) hari ini · top 8</p>
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={Users} title="OLE per Operator (terendah)" tag={`${byOperator.length}`} />
        <div className="p-4">
          <RankedList
            items={byOperator}
            initialCount={6}
            valueOf={(o) => numeric(o.ole_time_pct)}
            labelOf={(o) => o.operator_name || o.operator_id || 'UNKNOWN'}
            valueFmt={(o) => `${formatNumber(o.ole_time_pct)}%`}
            colorOf={(o) => severityColorForStatusStr(o.status)}
            subOf={(o) => `produktif ${formatHours(o.working_hours)} / ${formatHours(o.total_hours)}`}
            emptyText="Tidak ada data operator."
          />
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={GaugeIcon} title="Non-Produktif per Mesin" tag={`${byMachine.length}`} />
        <div className="p-4">
          <RankedList
            items={byMachine}
            initialCount={6}
            valueOf={(m) => numeric(m.nva_hours)}
            labelOf={(m) => m.machine_name || m.machine_id || 'UNKNOWN'}
            valueFmt={(m) => formatHours(m.nva_hours)}
            colorOf={() => SEV_HEX.Watch}
            subOf={(m) => `dari ${formatHours(m.total_hours)} total`}
            emptyText="Tidak ada data mesin."
          />
        </div>
      </PageCard>
    </section>
  );
}

function ActionSummaryPanel({ rows, config }) {
  const top = rows.slice(0, 3);
  const criticalCount = rows.filter((r) => r.severity === 'Critical').length;
  const watchCount = rows.filter((r) => r.severity === 'Watch').length;
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Wrench size={16} className="text-[#0077b6]" />
        <h3 className="text-sm font-black text-slate-900">Action Summary</h3>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">{rows.length} item</span>
        {criticalCount > 0 && (
          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-extrabold text-red-700">{criticalCount} critical</span>
        )}
        {watchCount > 0 && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">{watchCount} watch</span>
        )}
      </div>
      {top.length ? (
        <ul className="mt-3 flex-1 space-y-2.5">
          {top.map((r, i) => (
            <li key={`${r.scope}_${r.entityId}_${i}`} className="flex items-start gap-2">
              <span className="mt-0.5"><SeverityDot severity={r.severity} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-bold text-slate-800">{r.area}</span>
                  <span className="flex-shrink-0 font-mono text-[11px] font-extrabold text-slate-700">{r.metric}</span>
                </div>
                <p className="truncate text-[11px] leading-snug text-slate-500">{r.action}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 flex flex-1 items-center rounded-lg border border-dashed border-emerald-200 bg-emerald-50/50 px-3 py-2 text-xs font-bold text-emerald-600">
          ✓ Tidak ada tindakan mendesak untuk KPI ini.
        </div>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] font-semibold text-slate-500">
        <span>Owner utama</span>
        <span className="font-extrabold text-[#0077b6]">{config.pic}</span>
      </div>
    </div>
  );
}

function MetricTiles({ kpiType, kpi }) {
  const d = kpi?.detail || {};
  let tiles = [];
  if (kpiType === 'uptime') {
    tiles = [
      { label: 'Ping Success', value: `${formatNumber(d.success_count)}/${formatNumber(d.ping_count)}`, tone: 'good' },
      { label: 'Failed Ping', value: formatNumber(d.failed_count), tone: numeric(d.failed_count) > 0 ? 'bad' : 'good' },
      { label: 'DOWN Samples', value: formatNumber(d.down_samples), tone: numeric(d.down_samples) > 0 ? 'warn' : 'good' },
      { label: 'Max Packet Loss', value: `${formatNumber(d.max_packet_loss_percent)}%`, sub: `latency ${formatNumber(d.avg_latency_ms)} ms`, tone: 'neutral' },
    ];
  } else if (kpiType === 'accuracy') {
    tiles = [
      { label: 'SAP-Ready', value: `${formatNumber(d.ready_records)}/${formatNumber(d.total_records)}`, tone: 'good' },
      { label: 'Error Records', value: formatNumber(d.error_records), tone: numeric(d.error_records) > 0 ? 'bad' : 'good' },
      { label: 'TS Not Staged', value: formatNumber(d.timesheet_not_staged_records), tone: 'warn' },
      { label: 'Min Sample (≥50)', value: d.minimum_sample_met === false ? 'No' : 'Yes', sub: `${formatNumber(d.total_records)} record`, tone: d.minimum_sample_met === false ? 'warn' : 'good' },
    ];
  } else if (kpiType === 'adoption') {
    tiles = [
      { label: 'Covered', value: `${formatNumber(d.covered_bucket_count)}/${formatNumber(d.expected_bucket_count)}`, tone: 'good' },
      { label: 'Missing Buckets', value: formatNumber(d.missing_bucket_count), sub: `${formatNumber(d.missing_minutes)} min`, tone: numeric(d.missing_bucket_count) > 0 ? 'bad' : 'good' },
      { label: 'Unidentified', value: formatNumber(d.unidentified_bucket_count), tone: numeric(d.unidentified_bucket_count) > 0 ? 'warn' : 'good' },
      { label: 'Machine / Operator', value: `${formatNumber(d.machine_count)} / ${formatNumber(d.operator_count)}`, tone: 'info' },
    ];
  } else if (kpiType === 'oee') {
    tiles = [
      { label: 'Productive', value: formatHours(d.running_hours), sub: `dari ${formatHours(d.denominator_hours)} counted`, tone: 'good' },
      { label: 'Downtime', value: formatHours(d.downtime_hours), tone: 'bad' },
      { label: 'NNVA', value: formatHours(d.setup_hours), tone: 'warn' },
      { label: 'NoJob / Missing', value: `${formatHours(d.nojob_hours)} / ${formatHours(d.missing_hours)}`, tone: 'neutral' },
    ];
  } else if (kpiType === 'adoption_machine') {
    const unidMin = numeric(d.unidentified_duration_seconds) / 60;
    const idleMin = numeric(d.long_status_2_duration_seconds) / 60;
    tiles = [
      { label: 'Mesin', value: formatNumber(d.machine_count), tone: 'info' },
      { label: 'Total Gap', value: `${formatNumber(d.gap_pct)}%`, tone: numeric(d.gap_pct) > 0 ? 'bad' : 'good' },
      { label: 'Unidentified', value: `${formatNumber(unidMin)} m`, sub: `${formatNumber(d.unidentified_pct)}%`, tone: unidMin > 0 ? 'warn' : 'good' },
      { label: 'IDLE (M2 >5m)', value: `${formatNumber(idleMin)} m`, sub: `${formatNumber(d.long_status_2_pct)}% · ${formatNumber(d.long_status_2_count)} event`, tone: idleMin > 0 ? 'warn' : 'good' },
    ];
  } else if (kpiType === 'ole') {
    const gap = Math.max(0, numeric(d.available_recorded_hours) - numeric(d.working_hours));
    tiles = [
      { label: 'Produktif', value: formatHours(d.working_hours), sub: `dari ${formatHours(d.available_recorded_hours)} tercatat`, tone: 'good' },
      { label: 'Non-Produktif', value: formatHours(gap), tone: gap > 0 ? 'bad' : 'good' },
      { label: 'Operator', value: formatNumber(d.operator_count), tone: 'info' },
      { label: 'Recorded', value: formatHours(d.available_recorded_hours), tone: 'neutral' },
    ];
  }
  if (!tiles.length) return null;
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => <MetricTile key={t.label} {...t} />)}
    </section>
  );
}

// Adoption Machine — per-machine gap contribution (Unidentified vs IDLE/long-M2).
const ADOPTION_GAP_COLORS = { unidentified: '#ef4444', idle: '#f59e0b' };
const ADOPTION_MACHINE_TARGET = 95;

function adoptionMachineStatusHex(pct) {
  if (pct == null || !Number.isFinite(pct)) return STATUS_HEX.no_data;
  if (pct < 90) return STATUS_HEX.critical;
  if (pct < ADOPTION_MACHINE_TARGET) return STATUS_HEX.watch;
  return STATUS_HEX.normal;
}

function AdoptionMachineBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const rows = (sd.by_machine || []).map((m) => ({
    machine: m.machine_name || `Mesin ${m.machine}`,
    unidentified: numeric(m.unidentified_minutes),
    idle: numeric(m.idle_minutes),
    gap: numeric(m.gap_minutes),
    total: numeric(m.total_minutes),
    adoption: m.adoption_pct == null ? null : numeric(m.adoption_pct),
  }));
  // Chart 1: gap minutes, sorted descending (biggest offender first).
  const gapData = [...rows].sort((a, b) => b.gap - a.gap);
  // Chart 2 (insight): adoption % per machine, worst first — normalises for runtime,
  // so a machine that only ran briefly but idled a lot isn't hidden by small absolute minutes.
  const adoptData = rows
    .filter((r) => r.adoption != null)
    .sort((a, b) => a.adoption - b.adoption)
    .slice(0, 12);

  const totalUnid = numeric(sd.total_unidentified_minutes);
  const totalIdle = numeric(sd.total_idle_minutes);
  const totalGap = totalUnid + totalIdle;
  const idleShare = totalGap > 0 ? (totalIdle / totalGap) * 100 : 0;
  const worstMin = gapData[0];
  const worstPct = adoptData[0];
  const belowTarget = rows.filter((r) => r.adoption != null && r.adoption < ADOPTION_MACHINE_TARGET).length;
  const many = gapData.length > 8;

  const insights = [];
  if (worstMin) {
    insights.push({
      tone: 'red',
      text: `Penyumbang gap terbesar: ${worstMin.machine} — ${formatNumber(worstMin.gap)} menit (${formatNumber(worstMin.idle)}m IDLE + ${formatNumber(worstMin.unidentified)}m unidentified).`,
    });
  }
  insights.push({
    tone: idleShare >= 50 ? 'amber' : 'slate',
    text: `IDLE (M2 >5 menit) = ${formatNumber(idleShare)}% dari total gap → akar masalah utama ${idleShare >= 50 ? 'MESIN nganggur, bukan salah input operator' : 'lebih ke record tak teridentifikasi'}.`,
  });
  if (worstPct) {
    insights.push({
      tone: worstPct.adoption < 90 ? 'red' : 'amber',
      text: `Adoption terendah (relatif runtime): ${worstPct.machine} = ${formatNumber(worstPct.adoption)}%. ${belowTarget} mesin di bawah target ${ADOPTION_MACHINE_TARGET}%.`,
    });
  }
  const insightTone = {
    red: 'border-red-200 bg-red-50 text-red-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
  };

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {insights.map((it, i) => (
          <div key={i} className={`rounded-xl border px-3 py-2.5 text-[11px] font-bold leading-snug ${insightTone[it.tone]}`}>
            {it.text}
          </div>
        ))}
      </section>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PageCard>
          <CardHead icon={BarChart3} title="Gap Adoption per Mesin (menit)" tag={`${gapData.length} mesin`} />
          <div className="p-4">
            {gapData.length ? (
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={gapData} margin={{ top: 8, right: 16, left: 4, bottom: many ? 60 : 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="machine"
                    tick={{ fontSize: 10 }}
                    interval={0}
                    angle={many ? -35 : 0}
                    textAnchor={many ? 'end' : 'middle'}
                    height={many ? 66 : 30}
                  />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}m`} />
                  <Tooltip
                    cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload || {};
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                          <div className="font-extrabold text-slate-800">{label}</div>
                          <div className="mt-1 font-semibold" style={{ color: ADOPTION_GAP_COLORS.unidentified }}>Unidentified: {formatNumber(row.unidentified)} m</div>
                          <div className="font-semibold" style={{ color: ADOPTION_GAP_COLORS.idle }}>IDLE: {formatNumber(row.idle)} m</div>
                          <div className="mt-1 border-t border-slate-100 pt-1 font-bold text-slate-600">Total gap {formatNumber(row.gap)} m · durasi {formatNumber(row.total)} m</div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                  <Bar dataKey="unidentified" stackId="gap" name="Unidentified" fill={ADOPTION_GAP_COLORS.unidentified} />
                  <Bar dataKey="idle" stackId="gap" name="IDLE" fill={ADOPTION_GAP_COLORS.idle} radius={[6, 6, 0, 0]} maxBarSize={54} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart text="Tidak ada gap adoption mesin (unidentified / IDLE) pada window ini." />
            )}
            <p className="mt-2 text-[10px] font-semibold text-slate-400">
              Unidentified = statusid 5 · IDLE = M2 (statusid 2) durasi &gt; 5 menit · sumber public.mch_productiondata
            </p>
          </div>
        </PageCard>

        <PageCard>
          <CardHead icon={GaugeIcon} title="Adoption % per Mesin (terendah)" tag={`target ${ADOPTION_MACHINE_TARGET}%`} />
          <div className="p-4">
            {adoptData.length ? (
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={adoptData} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <YAxis dataKey="machine" type="category" tick={{ fontSize: 10 }} width={96} interval={0} />
                  <Tooltip
                    cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload || {};
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                          <div className="font-extrabold text-slate-800">{label}</div>
                          <div className="mt-1 font-bold text-slate-700">Adoption: {formatNumber(row.adoption)}%</div>
                          <div className="font-semibold text-slate-500">Gap {formatNumber(row.gap)} m dari {formatNumber(row.total)} m runtime</div>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine x={ADOPTION_MACHINE_TARGET} stroke="#0077b6" strokeDasharray="4 3" strokeWidth={1.5} />
                  <Bar dataKey="adoption" radius={[0, 6, 6, 0]} maxBarSize={22}>
                    {adoptData.map((r) => <Cell key={r.machine} fill={adoptionMachineStatusHex(r.adoption)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart text="Belum ada mesin dengan runtime untuk dihitung adoption-nya." />
            )}
            <p className="mt-2 text-[10px] font-semibold text-slate-400">
              adoption% = (runtime − gap) / runtime · garis putus = target {ADOPTION_MACHINE_TARGET}% · merah &lt;90%, amber &lt;{ADOPTION_MACHINE_TARGET}%
            </p>
          </div>
        </PageCard>
      </section>
    </div>
  );
}

// Adoption Labour — per-operator progressive coverage (who has / hasn't logged yet).
const ATTEND_META = {
  PRESENT: { label: 'Sudah Input', cls: 'border-emerald-200 bg-emerald-100 text-emerald-700' },
  ABSENT: { label: 'Belum Log', cls: 'border-red-200 bg-red-100 text-red-700' },
  NOT_STARTED: { label: 'Belum Mulai', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
  LEAVE: { label: 'Cuti', cls: 'border-sky-200 bg-sky-100 text-sky-700' },
  SICK: { label: 'Sakit', cls: 'border-amber-200 bg-amber-100 text-amber-700' },
  PERMIT: { label: 'Izin', cls: 'border-amber-200 bg-amber-100 text-amber-700' },
  OFF: { label: 'Off', cls: 'border-slate-200 bg-slate-100 text-slate-400' },
};

function AttendanceBadge({ value }) {
  const m = ATTEND_META[value] || { label: value || '-', cls: 'border-slate-200 bg-slate-100 text-slate-600' };
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${m.cls}`}>{m.label}</span>;
}

function AdoptionLabourBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const ops = useMemo(() => (Array.isArray(sd.by_operator) ? sd.by_operator : []), [sd.by_operator]);
  const [page, setPage] = useState(0);
  const [onlyProblem, setOnlyProblem] = useState(false);

  const rows = useMemo(() => {
    if (!onlyProblem) return ops;
    return ops.filter((o) => o.attendance === 'ABSENT'
      || (o.status === 'SCHEDULED' && numeric(o.expected_hours) - numeric(o.recorded_hours) > 0.01));
  }, [ops, onlyProblem]);
  const totalPages = pageCount(rows);
  const safePage = Math.min(page, Math.max(totalPages - 1, 0));
  const paged = pageSlice(rows, safePage);

  const belumLog = numeric(sd.absent);
  const present = numeric(sd.present);
  const notStarted = numeric(sd.not_started);
  const excused = numeric(sd.excused);
  const day = sd.day_adoption_pct;
  const night = sd.night_adoption_pct;
  const worst = ops
    .filter((o) => o.status === 'SCHEDULED')
    .map((o) => ({ ...o, gap: Math.max(0, numeric(o.expected_hours) - numeric(o.recorded_hours)) }))
    .sort((a, b) => b.gap - a.gap)[0];

  const insights = [];
  insights.push({
    tone: belumLog > 0 ? 'red' : 'emerald',
    text: belumLog > 0
      ? `${belumLog} operator sudah lewat sebagian shift tapi BELUM input sama sekali (dihitung 0 → menekan angka).`
      : 'Semua operator yang shift-nya berjalan sudah mulai input.',
  });
  insights.push({
    tone: 'slate',
    text: `Adoption DAY ${day == null ? '—' : `${formatNumber(day)}%`} · NIGHT ${night == null ? 'belum mulai' : `${formatNumber(night)}%`}. Angka tumbuh sepanjang shift, pas di akhir shift = nilai final.`,
  });
  if (worst && worst.gap > 0.01) {
    insights.push({
      tone: 'amber',
      text: `Gap terbesar: ${worst.operator_name || worst.operator_key} — input ${formatHours(worst.recorded_hours)} dari ${formatHours(worst.expected_hours)} yang diharapkan.`,
    });
  }
  const insightTone = {
    red: 'border-red-200 bg-red-50 text-red-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
  };

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {insights.map((it, i) => (
          <div key={i} className={`rounded-xl border px-3 py-2.5 text-[11px] font-bold leading-snug ${insightTone[it.tone]}`}>
            {it.text}
          </div>
        ))}
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label="Sudah Input" value={formatNumber(present)} tone="good" />
        <MetricTile label="Belum Log" value={formatNumber(belumLog)} tone={belumLog > 0 ? 'bad' : 'good'} />
        <MetricTile label="Belum Mulai" value={formatNumber(notStarted)} tone="neutral" />
        <MetricTile label="Cuti/Izin/Off" value={formatNumber(excused)} tone="info" />
      </section>

      <PageCard>
        <CardHead
          icon={Users}
          title="Operator (yang belum input di atas)"
          tag={`${rows.length}`}
          right={(
            <button
              type="button"
              onClick={() => { setOnlyProblem((v) => !v); setPage(0); }}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${onlyProblem ? 'border-[#0096c7] bg-[#0096c7] text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {onlyProblem ? 'Tampilkan semua' : 'Hanya yang bermasalah'}
            </button>
          )}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-[#90e0ef]" style={{ background: '#caf0f8' }}>
              <tr className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                <th className="px-3 py-2">Operator</th>
                <th className="px-3 py-2 text-center">Shift</th>
                <th className="px-3 py-2 text-right">Input</th>
                <th className="px-3 py-2 text-right">Diharapkan</th>
                <th className="px-3 py-2 text-right">Gap</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paged.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-xs font-bold text-emerald-600">✓ Tidak ada operator pada filter ini.</td></tr>
              )}
              {paged.map((o) => {
                const gap = Math.max(0, numeric(o.expected_hours) - numeric(o.recorded_hours));
                return (
                  <tr key={o.operator_key} className="align-top transition hover:bg-[#caf0f8]/25">
                    <td className="px-3 py-2">
                      <div className="font-bold text-slate-800">{o.operator_name || '—'}</div>
                      <div className="font-mono text-[11px] text-slate-500">{o.operator_key}</div>
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-[11px] font-bold text-slate-600">{o.shift}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-800">{formatHours(o.recorded_hours)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">{formatHours(o.expected_hours)}</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${gap > 0.01 ? 'text-red-600' : 'text-slate-400'}`}>{gap > 0.01 ? formatHours(gap) : '—'}</td>
                    <td className="px-3 py-2"><AttendanceBadge value={o.attendance} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePager page={safePage} totalPages={totalPages} totalRows={rows.length} onPageChange={setPage} />
        <p className="px-4 pb-3 text-[10px] font-semibold text-slate-400">
          Diharapkan = jam standar yang seharusnya sudah berlalu sampai sekarang · Belum Log = shift berjalan tapi 0 input · sumber ews.shift_roster + timesheet_transaction
        </p>
      </PageCard>
    </div>
  );
}

function KpiBreakdown({ kpiType, kpi }) {
  if (!kpi?.source_detail) {
    return <PageCard className="p-6 text-center text-sm font-bold text-slate-500">Detail sumber tidak tersedia untuk window ini. Jalankan kalkulasi live atau cek snapshot.</PageCard>;
  }
  if (kpiType === 'uptime') return <UptimeBreakdown kpi={kpi} />;
  if (kpiType === 'accuracy') return <AccuracyBreakdown kpi={kpi} />;
  if (kpiType === 'adoption') return <AdoptionBreakdown kpi={kpi} />;
  if (kpiType === 'adoption_labour') return <AdoptionLabourBreakdown kpi={kpi} />;
  if (kpiType === 'adoption_machine') return <AdoptionMachineBreakdown kpi={kpi} />;
  if (kpiType === 'oee') return <OeeBreakdown kpi={kpi} />;
  if (kpiType === 'ole') return <OleBreakdown kpi={kpi} />;
  return null;
}

/* ------------------------------------------------------------------ *
 * Cross-KPI context strip
 * ------------------------------------------------------------------ */
function KpiStrip({ kpis, activeKey, onSelect }) {
  if (!kpis?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {kpis.map((k) => {
        const active = k.key === activeKey;
        const color = STATUS_HEX[normalizeStatus(k.status)] || '#94a3b8';
        return (
          <button
            key={k.key}
            type="button"
            onClick={() => onSelect(k.key)}
            className={`flex min-w-[92px] flex-1 flex-col items-start rounded-xl border px-3 py-2 text-left transition-all active:scale-95 ${active ? 'border-[#0096c7] bg-[#caf0f8]/50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{k.label}</span>
              <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            </div>
            <span className="mt-1 text-base font-black text-slate-900">{formatPercent(k.value)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Skeleton loading — mirrors the real layout for fast perceived load
 * ------------------------------------------------------------------ */
function Sk({ className = '' }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="min-w-[92px] flex-1 rounded-xl border border-slate-200 bg-white p-3">
            <Sk className="h-2.5 w-12" />
            <Sk className="mt-2 h-5 w-14" />
          </div>
        ))}
      </div>

      <PageCard className="p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[auto,1fr] xl:grid-cols-[auto,1.35fr,1fr]">
          <div className="flex flex-col items-center gap-3">
            <Sk className="h-[140px] w-[140px] rounded-full" />
            <Sk className="h-4 w-20" />
          </div>
          <div className="space-y-2.5 rounded-xl bg-slate-50 p-4">
            <Sk className="h-4 w-44" />
            <Sk className="h-3 w-full" />
            <Sk className="h-3 w-5/6" />
            <Sk className="h-3 w-4/6" />
          </div>
          <div className="space-y-2.5 rounded-xl border border-slate-200 p-4">
            <Sk className="h-4 w-28" />
            <Sk className="h-3 w-full" />
            <Sk className="h-3 w-full" />
            <Sk className="h-3 w-2/3" />
          </div>
        </div>
      </PageCard>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
            <Sk className="h-2.5 w-16" />
            <Sk className="mt-2 h-6 w-20" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <PageCard key={i} className="overflow-hidden">
            <div className="border-b border-slate-100 p-3"><Sk className="h-4 w-40" /></div>
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((__, j) => (
                <div key={j}>
                  <div className="mb-1 flex justify-between">
                    <Sk className="h-3 w-24" />
                    <Sk className="h-3 w-10" />
                  </div>
                  <Sk className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          </PageCard>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <PageCard key={i} className="overflow-hidden">
            <div className="border-b border-slate-100 p-3"><Sk className="h-4 w-44" /></div>
            <div className="space-y-3 p-4">
              {Array.from({ length: 4 }).map((__, j) => <Sk key={j} className="h-8 w-full" />)}
            </div>
          </PageCard>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Main page
 * ------------------------------------------------------------------ */
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
  const [actionsLoading, setActionsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionPage, setActionPage] = useState(1);
  const [issuePage, setIssuePage] = useState(1);

  const manualDate = searchParams.get('date') || '';
  const usesManualDate = searchParams.get('basis') === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(manualDate);
  const ewsQuery = usesManualDate ? `basis=date&date=${encodeURIComponent(manualDate)}&live=1` : 'basis=today&live=1';
  const ewsSummaryQuery = usesManualDate ? ewsQuery : 'basis=today';

  // Issue-log sync + fetch runs OFF the critical render path so the KPI
  // breakdowns paint immediately instead of waiting on a DB write + extra GET.
  const loadIssueLog = useCallback(async (nextKpi, nextMeta) => {
    setActionsLoading(true);
    try {
      const rowsForSync = buildActionRows(nextKpi, config);
      const issuesForSync = buildIssuePayloads({ actionRows: rowsForSync, kpi: nextKpi, config, meta: nextMeta });
      if (issuesForSync.length) {
        await sendJson(`${API_BASE}/ews/actions/sync`, 'POST', {
          kpi_type: kpiType,
          issues: issuesForSync,
          updated_by: 'ews-detail-page',
        }).catch(() => {});
      }
      const actionsPayload = await fetchJson(`${API_BASE}/ews/actions?status=all&kpi_type=${encodeURIComponent(kpiType)}`);
      setActions(Array.isArray(actionsPayload?.data) ? actionsPayload.data : []);
    } catch {
      // Issue-log failures must not block the main detail view.
    } finally {
      setActionsLoading(false);
    }
  }, [config, kpiType]);

  const loadData = useCallback(async () => {
    if (!config) return;
    setError('');

    // Stale-while-revalidate: paint the last payload instantly, then refresh.
    const cacheKey = `${kpiType}|${ewsQuery}`;
    const cachedEntry = detailMemCache.get(cacheKey);
    const cacheFresh = cachedEntry && (Date.now() - cachedEntry.at < DETAIL_MEM_TTL_MS);
    if (cachedEntry) {
      setKpi(cachedEntry.kpi);
      setMeta(cachedEntry.meta);
      setSummary(cachedEntry.summary);
      setIsLoading(false);
    }
    if (cacheFresh) {
      loadIssueLog(cachedEntry.kpi, cachedEntry.meta);
      return; // fresh enough — no network needed
    }
    if (!cachedEntry) setIsLoading(true);

    try {
      const detailPromise = fetchJson(`${API_BASE}/ews/kpi/${kpiType}/detail?${ewsQuery}`).catch((err) => {
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
      const nextMeta = { ...(summaryPayload || {}), ...(detailPayload?.meta || {}) };

      // Paint the KPI/breakdowns immediately + cache for instant re-entry.
      setKpi(nextKpi);
      setMeta(nextMeta);
      setSummary(summaryPayload);
      setIsLoading(false);
      detailMemCache.set(cacheKey, { at: Date.now(), kpi: nextKpi, meta: nextMeta, summary: summaryPayload });

      // Then hydrate the issue log in the background.
      loadIssueLog(nextKpi, nextMeta);
    } catch (err) {
      // Keep showing cached data if we have it; only surface hard errors on cold load.
      if (!cachedEntry) {
        setError(err.message || 'Failed to load EWS detail.');
        setIsLoading(false);
      }
    }
  }, [config, ewsQuery, ewsSummaryQuery, kpiType, usesManualDate, loadIssueLog]);

  useEffect(() => { loadData(); }, [loadData]);

  const kpisByKey = useMemo(() => {
    const list = summary?.kpis || [];
    return Object.fromEntries(list.map((k) => [k.key, k]));
  }, [summary]);

  const relevantActions = useMemo(
    () => actions.filter((action) => String(action.kpi_type || '').toLowerCase() === kpiType),
    [actions, kpiType],
  );

  const actionRows = useMemo(() => buildActionRows(kpi, config || KPI_CONFIG.accuracy), [config, kpi]);

  const issueRows = useMemo(
    () => buildIssueRows({ actions: relevantActions, config: config || KPI_CONFIG.accuracy, kpi, meta }),
    [config, kpi, meta, relevantActions],
  );

  const openIssues = useMemo(() => issueRows.filter((i) => i.status !== 'Closed'), [issueRows]);
  const criticalEscalations = useMemo(() => issueRows.filter((i) => i.escalation === 'Plant Manager').length, [issueRows]);

  const actionTotalPages = useMemo(() => pageCount(actionRows), [actionRows]);
  const issueTotalPages = useMemo(() => pageCount(issueRows), [issueRows]);
  const pagedActionRows = useMemo(() => pageSlice(actionRows, actionPage), [actionPage, actionRows]);
  const pagedIssueRows = useMemo(() => pageSlice(issueRows, issuePage), [issuePage, issueRows]);

  useEffect(() => { setActionPage(1); setIssuePage(1); }, [kpiType, kpi?.value, meta?.window_end]);
  useEffect(() => { if (actionPage > actionTotalPages) setActionPage(actionTotalPages); }, [actionPage, actionTotalPages]);
  useEffect(() => { if (issuePage > issueTotalPages) setIssuePage(issueTotalPages); }, [issuePage, issueTotalPages]);

  const diagnosis = useMemo(() => buildDiagnosis(kpiType, kpi, kpisByKey), [kpiType, kpi, kpisByKey]);

  const kpiStatus = normalizeStatus(kpi?.status);
  const Icon = config?.icon || AlertTriangle;

  const handleRefresh = useCallback(() => {
    detailMemCache.delete(`${kpiType}|${ewsQuery}`);
    loadData();
  }, [kpiType, ewsQuery, loadData]);

  const handleResolve = useCallback(async (issue) => {
    if (!issue.actionId) return;
    try {
      await sendJson(`${API_BASE}/ews/actions/${issue.actionId}/resolve`, 'PUT', { updated_by: 'ews-detail-page' });
      // Only refresh the issue log — no need to re-run the heavy detail query.
      await loadIssueLog(kpi, meta);
    } catch (err) {
      setError(err.message || 'Failed to resolve EWS issue.');
    }
  }, [loadIssueLog, kpi, meta]);

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

  const diagnosisTone = diagnosis.tone;
  const diagnosisAccent = STATUS_HEX[diagnosisTone] || STATUS_TOKENS.normal.solid;

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
            <DeltaChip comparison={kpi?.comparison} />
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
              onClick={handleRefresh}
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
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
        )}

        {isLoading ? (
          <DetailSkeleton />
        ) : (
          <>
            {/* Cross-KPI context strip */}
            <KpiStrip
              kpis={summary?.kpis}
              activeKey={kpiType}
              onSelect={(key) => navigate(`/ews/${key}/detail${usesManualDate ? `?basis=date&date=${manualDate}` : ''}`)}
            />

            {/* Insight band: gauge + diagnosis + action summary */}
            <PageCard className="overflow-hidden">
              <div className="grid grid-cols-1 items-stretch gap-4 p-4 md:grid-cols-[auto,1fr] xl:grid-cols-[auto,1.35fr,1fr]">
                <div className="flex flex-row items-center gap-4 md:flex-col md:justify-center">
                  <Gauge value={kpi?.value} target={config.target} status={kpiStatus} />
                  <div className="text-center">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Target</div>
                    <div className="text-lg font-black" style={{ color: diagnosisAccent }}>{config.target}%</div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">Owner: {config.pic}</div>
                  </div>
                </div>
                <div className="rounded-xl border-l-4 bg-slate-50 p-4" style={{ borderColor: diagnosisAccent }}>
                  <div className="flex items-center gap-2">
                    <Lightbulb size={16} style={{ color: diagnosisAccent }} />
                    <h2 className="text-sm font-black text-slate-900">{diagnosis.headline}</h2>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-slate-600">{kpi?.helper}</p>
                  <ul className="mt-3 space-y-1.5">
                    {diagnosis.points.map((point, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-700">
                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: diagnosisAccent }} />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="md:col-span-2 xl:col-span-1">
                  <ActionSummaryPanel rows={actionRows} config={config} />
                </div>
              </div>
            </PageCard>

            {/* Headline metric tiles */}
            <MetricTiles kpiType={kpiType} kpi={kpi} />

            {/* Summary counters */}
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricTile label="Open Issues" value={openIssues.length} sub="butuh tindakan" tone={openIssues.length > 0 ? 'warn' : 'good'} />
              <MetricTile label="Critical Escalation" value={criticalEscalations} sub="critical > 3 jam" tone={criticalEscalations > 0 ? 'bad' : 'good'} />
              <MetricTile label="Data to Fix" value={actionRows.length} sub={`entitas (${config.unit})`} tone={actionRows.length > 0 ? 'info' : 'good'} />
              <MetricTile label="Status" value={kpiStatus === 'no_data' ? 'NO DATA' : kpiStatus.toUpperCase()} sub={`vs target ${config.target}%`} tone={kpiStatus === 'critical' ? 'bad' : kpiStatus === 'watch' ? 'warn' : 'good'} />
            </section>

            {/* KPI-specific breakdowns (real aggregated data) */}
            <KpiBreakdown kpiType={kpiType} kpi={kpi} />

            {/* Issue log + Data-to-fix */}
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <PageCard className="overflow-hidden">
                <CardHead
                  icon={AlertTriangle}
                  title="Issue Log & Correction"
                  right={<span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] font-black text-slate-700">{actionsLoading && issueRows.length === 0 ? '…' : `${issueRows.length} LOGS`}</span>}
                />
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold text-slate-500">
                  Critical dieskalasi ke Supervisor/Foreman &gt;1 jam, Plant Manager &gt;3 jam. Hanya issue teragregasi (bukan per-baris mentah) yang masuk log.
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-[#90e0ef]" style={{ background: '#caf0f8' }}>
                      <tr className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                        <th className="px-3 py-2">Issue</th>
                        <th className="px-3 py-2">Owner</th>
                        <th className="px-3 py-2 text-center">Sev</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-center">Resolve</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {issueRows.length === 0 && (
                        <tr>
                          <td colSpan={5} className={`px-3 py-6 text-center text-xs font-bold ${actionsLoading ? 'text-slate-400' : 'text-emerald-600'}`}>
                            {actionsLoading ? 'Memuat issue log…' : '✓ Tidak ada issue aktif untuk KPI ini. Semua sehat atau sudah di-resolve.'}
                          </td>
                        </tr>
                      )}
                      {pagedIssueRows.map((issue) => (
                        <tr key={issue.id} className="align-top transition hover:bg-[#caf0f8]/25">
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-800">{issue.issueDescription}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-mono text-[11px] font-bold uppercase text-[#0077b6]">{issue.errorType}</span>
                              {issue.metric ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600">{issue.metric}</span> : null}
                            </div>
                            <div className="mt-1 font-mono text-[11px] text-slate-500">{formatDateTime(issue.createdDate)}{issue.solvedDate ? ` · solved ${formatDateTime(issue.solvedDate)}` : ''}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-700">{issue.pic}</div>
                            <div className="mt-1 font-mono text-[11px] font-semibold text-slate-500">{issue.escalation}</div>
                          </td>
                          <td className="px-3 py-2 text-center"><SeverityDot severity={issue.severity} /></td>
                          <td className="px-3 py-2"><StatusBadge status={issue.status} /></td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              disabled={issue.status === 'Closed'}
                              onClick={() => handleResolve(issue)}
                              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-600 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-40"
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
                <TablePager page={issuePage} totalPages={issueTotalPages} totalRows={issueRows.length} onPageChange={setIssuePage} />
              </PageCard>

              <PageCard className="overflow-hidden">
                <CardHead
                  icon={Wrench}
                  title="Data yang Perlu Diperbaiki"
                  right={<span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] font-black text-slate-700">{actionRows.length} ITEM</span>}
                />
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold text-slate-500">
                  Daftar teragregasi per {config.unit} — sudah difilter dari noise. Fokus ke area dengan impact terbesar.
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-[#90e0ef]" style={{ background: '#caf0f8' }}>
                      <tr className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                        <th className="px-3 py-2">Area</th>
                        <th className="px-3 py-2">Kondisi</th>
                        <th className="px-3 py-2 text-right">Metric</th>
                        <th className="px-3 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {actionRows.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-xs font-bold text-emerald-600">✓ Tidak ada data bermasalah pada window ini.</td>
                        </tr>
                      )}
                      {pagedActionRows.map((row, idx) => (
                        <tr key={`${row.scope}_${row.entityId}_${idx}`} className="align-top transition hover:bg-[#caf0f8]/25">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <SeverityDot severity={row.severity} />
                              <span className="font-bold text-slate-800">{row.area}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-[11px] leading-snug text-slate-600">{row.detail}</div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="font-black text-slate-800">{row.metric}</div>
                            <div className="font-mono text-[10px] uppercase text-slate-400">{row.metricLabel}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-[11px] leading-snug text-slate-700">{row.action}</div>
                            <div className="mt-1 font-mono text-[10px] font-semibold text-[#0077b6]">{row.pic}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePager page={actionPage} totalPages={actionTotalPages} totalRows={actionRows.length} onPageChange={setActionPage} />
              </PageCard>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default EwsDetailPage;
