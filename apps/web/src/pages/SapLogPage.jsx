import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Database,
  FileJson,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

function formatDateTimeLabel(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toJsonText(value) {
  if (value == null || value === '') return '-';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function findMessageValue(value) {
  if (!value || typeof value !== 'object') return '';
  if (Object.prototype.hasOwnProperty.call(value, 'MESSAGE')) return value.MESSAGE;
  if (Object.prototype.hasOwnProperty.call(value, 'message')) return value.message;

  for (const child of Object.values(value)) {
    const found = findMessageValue(child);
    if (found) return found;
  }
  return '';
}

function extractSapMessage(value) {
  const text = String(value || '').trim();
  if (!text) return '-';

  try {
    const parsed = JSON.parse(text);
    const found = findMessageValue(parsed);
    if (found) return String(found).trim() || '-';
  } catch {
    // SAP responses are sometimes JSON fragments or plain text.
  }

  const quotedMatch = text.match(/\bMESSAGE\b["'\s]*[:=]\s*["']([^"'}]*)/i);
  if (quotedMatch?.[1]) return quotedMatch[1].trim() || '-';

  const looseMatch = text.match(/\bMESSAGE\b[\s:=,-]*(.*)$/is);
  const cleaned = (looseMatch?.[1] || text)
    .replace(/^[\s:=,"']+/, '')
    .replace(/["'\s}]+$/g, '')
    .trim();
  return cleaned || '-';
}

function getSapStatusMeta(status) {
  const normalized = String(status || 'PENDING').toUpperCase();
  if (normalized === 'POSTED') {
    return {
      label: 'Posted',
      icon: CheckCircle2,
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }
  if (normalized === 'FAILED') {
    return {
      label: 'Failed',
      icon: AlertCircle,
      className: 'border-red-200 bg-red-50 text-red-700',
    };
  }
  if (normalized === 'POSTING') {
    return {
      label: 'Posting',
      icon: Loader2,
      className: 'border-cyan-200 bg-cyan-50 text-[#0077b6]',
    };
  }
  if (normalized === 'SKIPPED') {
    return {
      label: 'Skipped',
      icon: CircleDashed,
      className: 'border-slate-200 bg-slate-50 text-slate-600',
    };
  }
  return {
    label: 'Pending',
    icon: CircleDashed,
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  };
}

function JsonPreview({ label, value }) {
  const [expanded, setExpanded] = useState(false);
  const text = toJsonText(value);
  const isEmpty = text === '-';

  if (isEmpty) {
    return <span className="text-xs font-semibold text-slate-400">-</span>;
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg border border-slate-200 bg-white text-[#0077b6] transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
        title={`Toggle ${label}`}
      >
        <FileJson size={14} className="flex-shrink-0" />
        <span className="sr-only">{expanded ? `Hide ${label}` : `Show ${label}`}</span>
      </button>
      {expanded && (
        <pre className="mt-2 max-h-72 w-[720px] max-w-[70vw] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">
          {text}
        </pre>
      )}
    </div>
  );
}

function SapLogPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const fetchRows = useCallback(async ({ cursor = null, append = false, signal } = {}) => {
    const params = new URLSearchParams({ limit: '30', status });
    if (search) params.set('search', search);
    if (cursor) params.set('cursor', String(cursor));

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/dashboard/sap-timesheet-staging-log?${params.toString()}`, { signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Gagal memuat SAP log');

      const nextRows = payload.data || [];
      setRows((current) => (append ? [...current, ...nextRows] : nextRows));
      setNextCursor(payload.pagination?.next_cursor || null);
      setHasMore(Boolean(payload.pagination?.has_more));
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, status]);

  useEffect(() => {
    const controller = new AbortController();
    fetchRows({ append: false, signal: controller.signal });
    return () => controller.abort();
  }, [fetchRows]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  const statusOptions = ['all', 'PENDING', 'POSTING', 'POSTED', 'FAILED', 'SKIPPED'];

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-800">
      <header className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-3 shadow-sm md:px-6">
        <div className="relative flex min-h-[96px] items-start justify-center">
          <button
            type="button"
            onClick={() => navigate('/operations-hub')}
            className="absolute left-0 top-0 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          >
            <ArrowLeft size={16} />
            Back
          </button>

          <div className="min-w-0 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#e8f7fb] text-[#0077b6]">
              <Database size={22} />
            </div>
            <h1 className="mt-3 text-lg font-extrabold text-slate-900">SAP LOG STATUS</h1>
            
          </div>

          <button
            type="button"
            onClick={() => fetchRows({ append: false })}
            disabled={loading}
            className="absolute right-0 top-0 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:opacity-50"
            title="Refresh"
            aria-label="Refresh SAP log"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <form onSubmit={handleSearchSubmit} className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search ztimesheet, order, SAP message, JSON..."
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-800 placeholder-slate-400 transition focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>{option === 'all' ? 'All Status' : option}</option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#0096c7] px-4 text-sm font-extrabold text-white transition hover:bg-[#0077b6] active:scale-95"
          >
            <Search size={16} />
            Search
          </button>
        </form>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden px-4 py-4 md:px-6">
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="h-full overflow-auto">
              <table className="w-max min-w-full table-auto text-left text-sm">
              <thead style={{ background: '#caf0f8' }}>
                <tr className="text-[11px] uppercase tracking-wide text-slate-700">
                  <th className="min-w-[110px] whitespace-nowrap px-3 py-2 font-extrabold">Status</th>
                  <th className="min-w-[90px] whitespace-nowrap px-3 py-2 font-extrabold">ID</th>
                  <th className="min-w-[135px] whitespace-nowrap px-3 py-2 font-extrabold">Created</th>
                  <th className="min-w-[135px] whitespace-nowrap px-3 py-2 font-extrabold">Posted</th>
                  <th className="min-w-[120px] whitespace-nowrap px-3 py-2 font-extrabold">Source</th>
                  <th className="min-w-[145px] whitespace-nowrap px-3 py-2 font-extrabold">Order</th>
                  <th className="min-w-[80px] whitespace-nowrap px-3 py-2 font-extrabold">Op</th>
                  <th className="min-w-[120px] whitespace-nowrap px-3 py-2 font-extrabold">Person</th>
                  <th className="min-w-[120px] whitespace-nowrap px-3 py-2 font-extrabold">WC</th>
                  <th className="min-w-[430px] whitespace-nowrap px-3 py-2 font-extrabold">SAP Message</th>
                  <th className="min-w-[90px] whitespace-nowrap px-3 py-2 font-extrabold">Payload</th>
                  <th className="min-w-[95px] whitespace-nowrap px-3 py-2 font-extrabold">Response</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-12 text-center text-sm font-bold text-slate-500">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-[#0096c7]" />
                      Loading SAP log...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-10 text-center text-sm font-bold text-red-600">{error}</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-10 text-center text-sm font-bold text-slate-400">No SAP log data</td>
                  </tr>
                ) : rows.map((row) => {
                  const statusMeta = getSapStatusMeta(row.status);
                  const StatusIcon = statusMeta.icon;
                  const message = extractSapMessage(row.sap_error || row.sap_response_text);
                  return (
                    <tr key={row.id} className="align-top transition hover:bg-slate-50">
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${statusMeta.className}`}>
                          <StatusIcon className={`h-3.5 w-3.5 ${row.status === 'POSTING' ? 'animate-spin' : ''}`} />
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <p className="font-mono text-xs font-extrabold text-slate-700">#{row.ztimesheetid || row.id}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-600">
                        {formatDateTimeLabel(row.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-600">
                        {formatDateTimeLabel(row.posted_at)}
                      </td>
                      <td className="px-3 py-3">
                        <p className="truncate text-xs font-extrabold text-slate-800">{row.source_system}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <p className="truncate font-mono text-xs font-extrabold text-slate-800" title={row.aufnr}>{row.aufnr || '-'}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs font-bold text-slate-600">
                        {row.vornr || '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <p className="truncate font-mono text-xs font-extrabold text-slate-800" title={row.pernr}>{row.pernr || '-'}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <p className="truncate text-xs font-bold text-slate-500" title={row.arbpl}>{row.arbpl || '-'}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p
                          className={`max-w-[430px] whitespace-normal break-words text-xs font-semibold leading-relaxed ${row.sap_error ? 'text-red-700' : 'text-slate-700'}`}
                          title={message}
                        >
                          {message}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <JsonPreview label="payload" value={row.payload} />
                      </td>
                      <td className="px-3 py-3">
                        <JsonPreview label="SAP response" value={row.sap_response} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center justify-between gap-3">
            <p className="text-xs font-bold text-slate-500">{rows.length} row loaded</p>
            {hasMore && (
              <button
                type="button"
                onClick={() => fetchRows({ cursor: nextCursor, append: true })}
                disabled={loadingMore}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4 rotate-90" />}
                Load More
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default SapLogPage;
