import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { goBackOrFallback } from '../../utils/navigation';
import { AlertCircle, CheckCircle2, Clock, FileX2, Users, Download, RefreshCw, Filter, ChevronLeft, Search, X, ChevronRight, Layers3 } from 'lucide-react';

/**
 * TimesheetValidationPage — Modern redesign (Light Theme)
 * Color palette: biru hanya sebagai accent (button, focus, highlight)
 * Background dominan putih/slate — clean, ringan, modern.
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

// ─── Palette tokens (used in inline style where Tailwind can't reach) ────────
const PALETTE = {
  deepTwilight:   '#03045e',
  frenchBlue:     '#023e8a',
  brightTealBlue: '#0077b6',
  blueGreen:      '#0096c7',
  turquoiseSurf:  '#00b4d8',
  skyAqua:        '#48cae4',
  frostedBlue:    '#90e0ef',
  frostedBlue2:   '#ade8f4',
  lightCyan:      '#caf0f8',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const formatDateShort = (dateStr) => {
  if (!dateStr) return '-';
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  return `${parts[0]} ${MONTH_SHORT[parseInt(parts[1], 10) - 1] ?? '??'} ${parts[2].slice(-2)}`;
};

const formatDurationStacked = (durationStr) => {
  const total = parseFloat(durationStr || 0);
  return { jam: Math.floor(total), menit: Math.round((total - Math.floor(total)) * 60) };
};

// ─── Badge helper ─────────────────────────────────────────────────────────────
const StatusBadge = ({ isDeleted, isSapReject, isValidated }) => {
  if (isDeleted)
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 whitespace-nowrap">Deleted</span>;
  if (isSapReject)
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">SAP Reject</span>;
  if (isValidated)
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">Validated</span>;
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">Pending</span>;
};


// ─── RecordRow ────────────────────────────────────────────────────────────────
const RecordRow = React.memo(({ record, onEdit }) => {
  const isValidated  = !!record.validation_date;
  const isDeleted    = String(record.state_flag) === '5';
  const isSapReject  = String(record.state_flag) === '3';
  const isUnprod     = !!record.activitytype;
  const operationDisplay = isUnprod
    ? record.operation_text
    : (record.part_name ? `${record.part_name} : ${record.operation_text}` : record.operation_text);
  const { jam, menit } = formatDurationStacked(record.duration);

  const rowBg = isDeleted
    ? 'bg-slate-50 hover:bg-slate-100'
    : isSapReject
      ? 'bg-red-50 hover:bg-red-100'
      : isValidated
        ? 'bg-emerald-50/50 hover:bg-emerald-100/60 opacity-75'
        : 'bg-white hover:bg-sky-50/60';

  return (
    <div
      onClick={() => onEdit(record.tsnumber)}
      className={`px-3 py-2.5 cursor-pointer transition-colors duration-100 ${rowBg}`}
    >
      <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1.5fr 0.6fr 1fr 0.7fr 0.7fr 0.7fr 1fr 0.7fr 44px' }}>

        {/* Order */}
        <div className="text-[11px] text-center">
          {isUnprod ? (
            <span className="font-bold text-orange-500">Unprod</span>
          ) : (
            <>
              <div className="font-semibold" style={{ color: PALETTE.frenchBlue }}>{record.order_no || '-'}</div>
              <div className="text-[10px]" style={{ color: PALETTE.brightTealBlue }}>{record.ssbr_id || ''}</div>
            </>
          )}
        </div>

        {/* Operation */}
        <div className="text-[11px] text-left">
          <div className="font-medium text-gray-800 break-words leading-snug">{operationDisplay}</div>
          {record.note && (
            <div className="text-[10px] italic text-gray-600 mt-0.5 px-1.5 py-0.5 rounded border-l-2 bg-sky-50"
              style={{ borderColor: PALETTE.turquoiseSurf }}>
              {record.note}
            </div>
          )}
        </div>

        {/* Seq */}
        <div className="text-[11px] text-center font-semibold text-gray-700">
          {record.operation_no != null ? record.operation_no : '-'}
        </div>

        {/* Time */}
        <div className="text-[11px] text-center">
          {record.date_checkin === record.date_checkout ? (
            <div className="flex items-center justify-center gap-1.5">
              <span className="font-medium text-gray-700">{formatDateShort(record.date_checkin)}</span>
              <div className="flex flex-col leading-tight" style={{ color: PALETTE.brightTealBlue }}>
                <span>{record.hour_checkin}</span>
                <span>{record.hour_checkout}</span>
              </div>
            </div>
          ) : (
            <>
              <div className="text-gray-700">
                <span className="font-medium">{formatDateShort(record.date_checkin)}</span>
                <span className="ml-1" style={{ color: PALETTE.brightTealBlue }}>{record.hour_checkin}</span>
              </div>
              <div className="text-gray-700">
                <span className="font-medium">{formatDateShort(record.date_checkout)}</span>
                <span className="ml-1" style={{ color: PALETTE.brightTealBlue }}>{record.hour_checkout}</span>
              </div>
            </>
          )}
        </div>

        {/* Duration */}
        <div className="text-[11px] text-center flex flex-col items-center leading-tight">
          <span className="font-bold" style={{ color: PALETTE.frenchBlue }}>{jam} jam</span>
          <span style={{ color: PALETTE.brightTealBlue }}>{menit} mnt</span>
        </div>

        {/* Plan Hrs */}
        <div className="text-[11px] text-center font-semibold text-gray-700">
          {record.planhours != null && record.planhours !== '' ? parseFloat(record.planhours).toFixed(2) : '-'}
        </div>

        {/* Std Fman */}
        <div className="text-[11px] text-center font-semibold text-gray-700">
          {record.std_foreman_hours != null && record.std_foreman_hours !== '' ? parseFloat(record.std_foreman_hours).toFixed(2) : '-'}
        </div>

        {/* Workcenter */}
        <div className="text-[11px] text-center">
          <div className="font-medium text-gray-800 break-words leading-snug">{record.workcenterdescription}</div>
          <div className="text-[10px] text-gray-400">{record.workcentercode}</div>
        </div>

        {/* Status */}
        <div className="flex items-center justify-center">
          <StatusBadge isDeleted={isDeleted} isSapReject={isSapReject} isValidated={isValidated} />
        </div>

        {/* Action — tombol Validate DIHAPUS (2026-09-15, keputusan owner 1c): staging SAP
            tidak pernah menunggu validasi (stager memfilter state_flag<>5, bukan
            validation_date), jadi tombol itu tidak menggerbangi apa pun. Edit tetap ada
            untuk koreksi order/jam yang salah. */}
        <div className="flex items-center justify-center">
          </div>
      </div>
    </div>
  );
});

// ─── EmployeeGroup ────────────────────────────────────────────────────────────
const EmployeeGroup = React.memo(({
  group, isExpanded, records, loadingRecords,
  onToggle, onEdit
}) => {
  const pendingCount     = parseInt(group.pending_count);
  const rejectCount      = parseInt(group.reject_count || 0);
  const validatedCount   = parseInt(group.validated_count);
  const groupHours       = parseFloat(group.total_hours || 0);
  const grpPendingHrs    = parseFloat(group.pending_hours || 0);
  const grpRejectHrs     = parseFloat(group.reject_hours || 0);
  const grpValidatedHrs  = parseFloat(group.validated_hours || 0);

  return (
    <div className="rounded-xl overflow-hidden shadow-sm border transition-shadow duration-200 hover:shadow-md"
      style={{ borderColor: PALETTE.skyAqua }}>

      {/* ── Employee Header ── */}
      <div
        onClick={() => onToggle(group.serialnumber)}
        className="px-4 py-3 cursor-pointer select-none transition-colors duration-150 border-b"
        style={{ background: `linear-gradient(135deg, ${PALETTE.frenchBlue} 0%, ${PALETTE.brightTealBlue} 100%)`, borderColor: PALETTE.blueGreen }}
      >
        <div className="flex items-center justify-between">
          {/* Left: arrow + name */}
          <div className="flex items-center gap-3">
            <span className="text-white/80 transition-transform duration-200" style={{ display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              <ChevronRight className="w-4 h-4" />
            </span>
            <div>
              <div className="text-sm font-bold text-white">{group.full_name}</div>
              <div className="text-xs font-mono" style={{ color: PALETTE.frostedBlue2 }}>{group.serialnumber}</div>
            </div>
          </div>

          {/* Right: stats + validate-group btn */}
          <div className="flex items-center gap-3">
            <div className="text-[11px] leading-[17px] font-mono text-right">
              <div className="font-bold text-white/90">
                Total: {group.record_count} Act&nbsp;
                <span className="text-white/70">[{groupHours.toFixed(1)} hrs]</span>
              </div>
              <div className="font-bold text-amber-300">
                Pending: {pendingCount} Act&nbsp;
                <span className="text-amber-200">[{grpPendingHrs.toFixed(1)} hrs]</span>
              </div>
              <div className="font-bold text-red-200">
                Reject: {rejectCount} Act&nbsp;
                <span className="text-red-100">[{grpRejectHrs.toFixed(1)} hrs]</span>
              </div>
              <div className="font-bold text-emerald-300">
                Validated: {validatedCount} Act&nbsp;
                <span className="text-emerald-200">[{grpValidatedHrs.toFixed(1)} hrs]</span>
              </div>
            </div>

                      </div>
        </div>
      </div>

      {/* ── Child Records ── */}
      {isExpanded && (
        <div>
          {/* Column headers */}
          <div className="px-3 py-2 border-b" style={{ background: PALETTE.lightCyan, borderColor: PALETTE.frostedBlue }}>
            <div className="grid gap-2 text-[10px] font-bold text-center uppercase tracking-wide"
              style={{ gridTemplateColumns: '1fr 1.5fr 0.6fr 1fr 0.7fr 0.7fr 0.7fr 1fr 0.7fr 44px', color: PALETTE.frenchBlue }}>
              <div>Order</div>
              <div>Operation</div>
              <div>Seq</div>
              <div>Time</div>
              <div>Duration</div>
              <div>Plan Hrs</div>
              <div>Std Fman</div>
              <div>Workcenter</div>
              <div>Status</div>
              <div>Act</div>
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y" style={{ divideColor: PALETTE.frostedBlue2 }}>
            {loadingRecords ? (
              <div className="py-6 text-center text-sm font-medium flex items-center justify-center gap-2" style={{ color: PALETTE.brightTealBlue }}>
                <span className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin inline-block" style={{ borderColor: PALETTE.turquoiseSurf, borderTopColor: 'transparent' }} />
                Loading records…
              </div>
            ) : records.length > 0 ? (
              records.map((record) => (
                <RecordRow key={record.tsnumber} record={record} onEdit={onEdit} />
              ))
            ) : (
              <div className="py-6 text-center text-sm text-gray-400">No records found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ─── StatCard ─────────────────────────────────────────────────────────────────
const StatCard = ({ icon, label, primary, secondary, accentColor, bgColor, borderColor, active = false, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-3 text-center border shadow-sm transition-all duration-150 ${
      onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]' : 'cursor-default'
    } ${active ? 'ring-2 ring-offset-1' : ''}`}
    style={{ background: bgColor, borderColor, '--tw-ring-color': accentColor }}
  >
    <span style={{ color: accentColor }}>{icon}</span>
    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: accentColor }}>{label}</div>
    <div className="text-base font-extrabold" style={{ color: accentColor }}>{primary}</div>
    {secondary && <div className="text-[10px] font-medium text-gray-500">{secondary}</div>}
  </button>
);

// ─── Icon helpers ─────────────────────────────────────────────────────────────
const Icon = {
  pending:   <AlertCircle  className="w-5 h-5" />,
  validated: <CheckCircle2 className="w-5 h-5" />,
  clock:     <Clock        className="w-5 h-5" />,
  reject:    <FileX2       className="w-5 h-5" />,
  users:     <Users        className="w-5 h-5" />,
  component: <Layers3      className="w-4 h-4" />,
  download:  <Download     className="w-4 h-4" />,
  refresh:   <RefreshCw    className="w-4 h-4" />,
  filter:    <Filter       className="w-4 h-4" />,
  back:      <ChevronLeft  className="w-4 h-4" />,
  search:    <Search       className="w-4 h-4" />,
  x:         <X            className="w-3.5 h-3.5" strokeWidth={2.5} />,
};

// ─── Main Page ─────────────────────────────────────────────────────────────────
const TimesheetValidationPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [groups,          setGroups]          = useState([]);
  const [stats,           setStats]           = useState({
    totalHours: '0.00', totalRecords: 0, totalEmployees: 0,
    totalPending: 0, totalReject: 0, totalValidated: 0,
    pendingHours: '0.00', rejectHours: '0.00', validatedHours: '0.00'
  });
  const [searchQuery,     setSearchQuery]     = useState(searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  const [startDate,       setStartDate]       = useState(searchParams.get('startDate') || '');
  const [endDate,         setEndDate]         = useState(searchParams.get('endDate') || '');
  const [statusFilter,    setStatusFilter]    = useState(searchParams.get('status') || '');
  const [expandedGroups,  setExpandedGroups]  = useState(new Set(
    searchParams.get('expanded')?.split(',').filter(Boolean) || []
  ));
  const [showFilters,     setShowFilters]     = useState(() => {
    const saved = sessionStorage.getItem('showFiltersV2');
    return saved !== null ? saved === 'true' : true;
  });
  const [groupRecords,       setGroupRecords]       = useState({});
  const [lastSearchForGroups,setLastSearchForGroups] = useState('');
  const [loading,              setLoading]              = useState(false);
  const [downloadingExcel,     setDownloadingExcel]     = useState(false);

  const containerRef    = useRef(null);
  const searchTimerRef  = useRef(null);
  const restoreScrollRef = useRef(null);

  // Debounce search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  useEffect(() => { loadValidationData(); }, [startDate, endDate, debouncedSearch, statusFilter]);

  useEffect(() => {
    const params = {};
    if (searchQuery)          params.search    = searchQuery;
    if (startDate)            params.startDate = startDate;
    if (endDate)              params.endDate   = endDate;
    if (statusFilter)         params.status    = statusFilter;
    if (expandedGroups.size > 0) params.expanded = Array.from(expandedGroups).join(',');
    setSearchParams(params, { replace: true });
  }, [searchQuery, startDate, endDate, statusFilter, expandedGroups, setSearchParams]);

  // Read saved scroll position ONCE on mount — before any data loads.
  // Must be empty-dep so it only runs once, not on every groups refresh.
  useEffect(() => {
    const saved = sessionStorage.getItem('timesheet_scroll');
    if (saved && parseInt(saved, 10) > 0) {
      restoreScrollRef.current = parseInt(saved, 10);
      sessionStorage.removeItem('timesheet_scroll');
    }
  }, []);

  // When groups load, kick off record fetching for any groups expanded via URL params.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (groups.length > 0 && expandedGroups.size > 0) {
      for (const sn of expandedGroups) loadGroupRecords(sn);
    }
  }, [groups]); // intentionally omits expandedGroups — runs only when groups data arrives

  // Apply scroll once groups AND all expanded group records have fully loaded.
  // This effect is the single source of truth for scroll restoration; it re-runs
  // whenever groupRecords updates, so it catches the moment the last group finishes.
  useEffect(() => {
    if (restoreScrollRef.current === null) return;
    if (groups.length === 0) return;

    const allReady =
      expandedGroups.size === 0 ||
      Array.from(expandedGroups).every(sn => groupRecords[sn] && !groupRecords[sn].loading);

    if (!allReady) return;

    const target = restoreScrollRef.current;
    restoreScrollRef.current = null;
    // Double rAF: first frame commits layout, second applies scroll after paint.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (containerRef.current) containerRef.current.scrollTop = target;
      })
    );
  }, [groups, groupRecords, expandedGroups]);

  useEffect(() => {
    if (`${debouncedSearch}|${statusFilter}` !== lastSearchForGroups) {
      setGroupRecords({});
      setLastSearchForGroups(`${debouncedSearch}|${statusFilter}`);
      if (expandedGroups.size > 0) {
        const current = new Set(expandedGroups);
        setTimeout(() => { for (const sn of current) loadGroupRecords(sn); }, 100);
      }
    }
  }, [debouncedSearch, statusFilter, expandedGroups]);

  const getDateParams = useCallback(() => {
    if (startDate && endDate) return { start: startDate, end: endDate };
    const now = new Date();
    const ago = new Date(now); ago.setDate(ago.getDate() - 30);
    const fmt = (d) => d.toISOString().split('T')[0];
    return { start: fmt(ago), end: fmt(now) };
  }, [startDate, endDate]);

  const loadGroupRecords = useCallback(async (serialnumber, silent = false) => {
    if (!silent) {
      setGroupRecords(prev => ({ ...prev, [serialnumber]: { records: prev[serialnumber]?.records || [], loading: true } }));
    }
    try {
      const { start, end } = getDateParams();
      let url = `${API_BASE}/timesheet/validation-group/${encodeURIComponent(serialnumber)}?start=${start}&end=${end}`;
      if (debouncedSearch.trim()) url += `&search=${encodeURIComponent(debouncedSearch.trim())}`;
      if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Gagal load records');
      const records = await res.json();
      setGroupRecords(prev => ({ ...prev, [serialnumber]: { records, loading: false } }));
    } catch (err) {
      console.error('Error loading group records:', err);
      setGroupRecords(prev => ({ ...prev, [serialnumber]: { records: prev[serialnumber]?.records || [], loading: false } }));
    }
  }, [getDateParams, debouncedSearch, statusFilter]);

  const loadValidationData = useCallback(async (keepExpanded = false) => {
    const scrollBefore = keepExpanded && containerRef.current ? containerRef.current.scrollTop : null;
    setLoading(true);
    try {
      const { start, end } = getDateParams();
      let url = `${API_BASE}/timesheet/validation-stats?start=${start}&end=${end}`;
      if (debouncedSearch.trim()) url += `&search=${encodeURIComponent(debouncedSearch.trim())}`;
      if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Gagal load data validasi');
      const data = await res.json();
      setStats(data.stats);
      setGroups(data.groups || []);
      if (keepExpanded) {
        for (const sn of Array.from(expandedGroups)) loadGroupRecords(sn, true);
        if (scrollBefore !== null) restoreScrollRef.current = scrollBefore;
      } else {
        setGroupRecords({});
        if (restoreScrollRef.current === null) restoreScrollRef.current = null;
      }
    } catch (err) {
      console.error('Error loading validation data:', err);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [getDateParams, debouncedSearch, statusFilter, expandedGroups, loadGroupRecords]);

  const toggleGroup = useCallback((sn) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(sn)) { next.delete(sn); }
      else {
        next.add(sn);
        if (!groupRecords[sn]?.records?.length) loadGroupRecords(sn);
      }
      return next;
    });
  }, [groupRecords, loadGroupRecords]);

  const expandAll = useCallback(() => {
    const all = groups.map(g => g.serialnumber);
    setExpandedGroups(new Set(all));
    for (const sn of all) { if (!groupRecords[sn]?.records?.length) loadGroupRecords(sn); }
  }, [groups, groupRecords, loadGroupRecords]);

  const collapseAll = useCallback(() => setExpandedGroups(new Set()), []);
  const toggleStatusFilter = useCallback((status) => {
    setStatusFilter(prev => prev === status ? '' : status);
    setExpandedGroups(new Set());
  }, []);
  const clearFilters = useCallback(() => { setSearchQuery(''); setStartDate(''); setEndDate(''); setStatusFilter(''); }, []);

  const handleDownloadExcel = useCallback(async () => {
    if (!startDate || !endDate) { toast.warning('Pilih Start Date dan End Date terlebih dahulu!'); return; }
    if (startDate > endDate)    { toast.warning('Start Date tidak boleh lebih besar dari End Date!'); return; }
    setDownloadingExcel(true);
    try {
      const params = new URLSearchParams({ start: startDate, end: endDate, field: 'longdate_checkout' });
      const res = await fetch(`${API_BASE}/timesheet/getexcel?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Gagal download Excel');
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url; a.download = `timesheet_${startDate}_to_${endDate}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error('Gagal download Excel', { description: err.message });
    } finally { setDownloadingExcel(false); }
  }, [startDate, endDate]);


  const handleEdit = useCallback((tsnumber) => {
    if (containerRef.current) sessionStorage.setItem('timesheet_scroll', containerRef.current.scrollTop);
    navigate(`/timesheet-edit/${tsnumber}?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [navigate]);

  const goBack        = useCallback(() => goBackOrFallback(navigate), [navigate]);
  const toggleFilters = useCallback(() => {
    setShowFilters(prev => {
      const next = !prev;
      sessionStorage.setItem('showFiltersV2', next.toString());
      return next;
    });
  }, []);

  // ── Shared button styles ──────────────────────────────────────────────────
  const btnBase    = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed';
  const btnOutline = `${btnBase} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300`;
  const btnPrimary = `${btnBase} text-white bg-[#0096c7] hover:bg-[#0077b6]`;
  const btnSolid   = `${btnBase} text-white`; // used for coloured variants (e.g. emerald download btn)

  // ── SAP banner color logic ────────────────────────────────────────────────

  // ── Input class helper ────────────────────────────────────────────────────
  const inputCls = 'bg-white border border-slate-200 text-slate-800 placeholder-slate-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all duration-150';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-dvh w-screen flex flex-col overflow-hidden bg-slate-50">

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm">

        <button onClick={() => navigate('/operations-hub')} className={btnOutline}>
          {Icon.back} Back
        </button>

        <h1 className="text-base sm:text-lg font-extrabold tracking-wide text-slate-800">
          Overall Labor Effectiveness
        </h1>

        <div className="flex gap-2">
          <button onClick={toggleFilters} className={btnOutline} title={showFilters ? 'Hide filters' : 'Show filters'}>
            {Icon.filter} Filter
          </button>
          <button onClick={() => navigate('/operator-performance')} className={`${btnSolid} bg-sky-600 hover:bg-sky-500`}>
            {Icon.component} By Component
          </button>
          <button onClick={() => loadValidationData(true)} disabled={loading} className={btnPrimary}>
            <span className={loading ? 'animate-spin' : ''}>{Icon.refresh}</span>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* ══ FILTER PANEL ════════════════════════════════════════════════════ */}
      {showFilters && (
        <div className="flex-shrink-0 px-4 py-3 space-y-2.5 bg-white border-b border-slate-200">

          {/* Search */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              {Icon.search}
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by serial, name, workcenter, order…"
              className={`w-full pl-9 pr-9 py-2 ${inputCls}`}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                {Icon.x}
              </button>
            )}
          </div>

          {/* Date range + actions */}
          <div className="flex flex-wrap gap-2 items-center">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className={`px-2.5 py-1.5 ${inputCls}`}
            />
            <span className="text-slate-400 text-xs">to</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className={`px-2.5 py-1.5 ${inputCls}`}
            />

            <div className="flex-1" />

            <button onClick={clearFilters}  className={btnOutline}>Clear</button>
            <button onClick={expandAll}     className={btnOutline}>Expand All</button>
            <button onClick={collapseAll}   className={btnOutline}>Collapse All</button>
            <button
              onClick={handleDownloadExcel}
              disabled={downloadingExcel}
              className={`${btnSolid} bg-emerald-600 hover:bg-emerald-500`}
            >
              {downloadingExcel
                ? <><span className="w-3.5 h-3.5 border-2 border-t-transparent border-white rounded-full animate-spin" />&nbsp;Downloading…</>
                : <>{Icon.download}&nbsp;Download Excel</>}
            </button>
            <button
              onClick={() => navigate('/log-timesheet')}
              className={`${btnSolid} bg-[#0096c7] hover:bg-[#0077b6]`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              &nbsp;View Log
            </button>
          </div>
        </div>
      )}

      {/* ══ STATS BAR ═══════════════════════════════════════════════════════ */}
      <div className="flex-shrink-0 px-4 py-2.5 bg-white border-b border-slate-200">
        <div className="grid grid-cols-5 gap-2">
          <StatCard
            icon={Icon.pending} label="Pending"
            primary={`${stats.totalPending} Act`}
            secondary={`${parseFloat(stats.pendingHours || 0).toFixed(1)} hrs`}
            accentColor="#d97706" bgColor="#fffbeb" borderColor="#fde68a"
            active={statusFilter === 'pending'}
            onClick={() => toggleStatusFilter('pending')}
          />
          <StatCard
            icon={Icon.reject} label="SAP Reject"
            primary={`${stats.totalReject || 0} Act`}
            secondary={`${parseFloat(stats.rejectHours || 0).toFixed(1)} hrs`}
            accentColor="#dc2626" bgColor="#fef2f2" borderColor="#fecaca"
            active={statusFilter === 'reject'}
            onClick={() => toggleStatusFilter('reject')}
          />
          <StatCard
            icon={Icon.validated} label="Validated"
            primary={`${stats.totalValidated} Act`}
            secondary={`${parseFloat(stats.validatedHours || 0).toFixed(1)} hrs`}
            accentColor="#059669" bgColor="#f0fdf4" borderColor="#bbf7d0"
            active={statusFilter === 'validated'}
            onClick={() => toggleStatusFilter('validated')}
          />
          <StatCard
            icon={Icon.clock} label="Total Hrs"
            primary={stats.totalHours}
            accentColor={PALETTE.brightTealBlue} bgColor={PALETTE.lightCyan} borderColor={PALETTE.frostedBlue}
          />
          <StatCard
            icon={Icon.users} label="Employees"
            primary={stats.totalEmployees}
            accentColor={PALETTE.blueGreen} bgColor={PALETTE.frostedBlue2} borderColor={PALETTE.frostedBlue}
          />
        </div>
      </div>

      {/* ══ SCROLLABLE LIST ═════════════════════════════════════════════════ */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3 bg-slate-50">

        {loading ? (
          <div className="flex flex-col items-center justify-center mt-16 gap-3">
            <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: PALETTE.turquoiseSurf, borderTopColor: 'transparent' }} />
            <span className="text-sm font-medium text-slate-500">Loading data…</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center mt-16 gap-2 text-slate-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <p className="text-sm">Tidak ada data timesheet untuk divalidasi</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const isExpanded = expandedGroups.has(group.serialnumber);
              const grpCache   = groupRecords[group.serialnumber];
              return (
                <EmployeeGroup
                  key={group.serialnumber}
                  group={group}
                  isExpanded={isExpanded}
                  records={grpCache?.records || []}
                  loadingRecords={grpCache?.loading || false}
                  onToggle={toggleGroup}
                  onEdit={handleEdit}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TimesheetValidationPage;
