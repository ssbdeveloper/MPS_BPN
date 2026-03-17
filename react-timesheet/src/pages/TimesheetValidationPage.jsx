import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';

/**
 * Timesheet Validation Page — OPTIMIZED
 * - Server-side stats & grouped employee summary (no bulk record fetch)
 * - Lazy load records per employee on expand
 * - Debounced search (server-side)
 * - Memoized rendering
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

// Helper: Format date string "dd/mm/yyyy" to "dd Mmm yy"
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const formatDateShort = (dateStr) => {
  if (!dateStr) return '-';
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  const day = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const year = parts[2].slice(-2);
  return `${day} ${MONTH_SHORT[monthIdx] || '??'} ${year}`;
};

// Helper: Format decimal duration to stacked "X jam Y menit"
const formatDurationStacked = (durationStr) => {
  const totalHours = parseFloat(durationStr || 0);
  const jam = Math.floor(totalHours);
  const menit = Math.round((totalHours - jam) * 60);
  return { jam, menit };
};

// ========== Memoized child row component ==========
const RecordRow = React.memo(({ record, onEdit, onValidateSingle }) => {
  const isValidated = !!record.validation_date;
  const isDeleted = String(record.state_flag) === '5';
  const isSapReject = String(record.state_flag) === '3';
  const isUnprod = !!record.activitytype;
  const operationDisplay = isUnprod
    ? record.operation_text
    : (record.part_name
        ? `${record.part_name} : ${record.operation_text}`
        : record.operation_text);

  const { jam, menit } = formatDurationStacked(record.duration);

  return (
    <div
      onClick={() => onEdit(record.tsnumber)}
      className={`p-3 transition-colors cursor-pointer ${
        isDeleted
          ? 'bg-red-50 hover:bg-red-100'
          : isSapReject
            ? 'bg-purple-50 hover:bg-purple-100'
            : isValidated
              ? 'bg-green-50 bg-opacity-60 hover:bg-green-100 opacity-70'
              : 'hover:bg-blue-50 bg-white'
      }`}
    >
      <div className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 1.5fr 0.6fr 1fr 0.7fr 0.7fr 0.7fr 1fr 0.7fr 50px' }}>
        {/* Order */}
        <div className="text-[11px] text-center">
          {isUnprod ? (
            <div className="font-bold text-orange-600">Unprod</div>
          ) : (
            <>
              <div className="font-semibold text-blue-900">{record.production_order || '-'}</div>
              <div className="text-blue-700 text-[10px]">{record.ssbr_ident || ''}</div>
            </>
          )}
        </div>

        {/* Operation */}
        <div className="text-[11px] text-left">
          <div className="font-medium text-gray-800 break-words leading-snug">{operationDisplay}</div>
          {record.note && (
            <div className="text-[10px] italic text-gray-700 bg-blue-50 border-l-2 border-blue-500 px-1.5 py-0.5 rounded mt-0.5">
              {record.note}
            </div>
          )}
        </div>

        {/* Seq */}
        <div className="text-[11px] text-center">
          <div className="font-semibold text-gray-800">{record.seq != null ? record.seq : '-'}</div>
        </div>

        {/* Time */}
        <div className="text-[11px] text-center">
          {record.date_checkin === record.date_checkout ? (
            <div className="flex items-center justify-center gap-1.5">
              <div className="font-medium text-gray-700">{formatDateShort(record.date_checkin)}</div>
              <div className="flex flex-col text-blue-700 leading-tight">
                <span>{record.hour_checkin}</span>
                <span>{record.hour_checkout}</span>
              </div>
            </div>
          ) : (
            <>
              <div className="text-gray-700">
                <span className="font-medium">{formatDateShort(record.date_checkin)}</span>
                <span className="text-blue-700 ml-1">{record.hour_checkin}</span>
              </div>
              <div className="text-gray-700">
                <span className="font-medium">{formatDateShort(record.date_checkout)}</span>
                <span className="text-blue-700 ml-1">{record.hour_checkout}</span>
              </div>
            </>
          )}
        </div>

        {/* Duration */}
        <div className="text-[11px] text-center">
          <div className="flex flex-col leading-tight items-center">
            <span className="font-bold text-blue-900">{jam} jam</span>
            <span className="text-blue-700">{menit} menit</span>
          </div>
        </div>

        {/* Plan Hours */}
        <div className="text-[11px] text-center">
          <div className="font-semibold text-gray-800">
            {record.planhours != null && record.planhours !== '' ? parseFloat(record.planhours).toFixed(2) : '-'}
          </div>
        </div>

        {/* Std Fman */}
        <div className="text-[11px] text-center">
          <div className="font-semibold text-gray-800">
            {record.std_foreman_hours != null && record.std_foreman_hours !== '' ? parseFloat(record.std_foreman_hours).toFixed(2) : '-'}
          </div>
        </div>

        {/* Workcenter */}
        <div className="text-[11px] text-center">
          <div className="font-medium text-gray-800 break-words leading-snug">{record.workcenterdescription}</div>
          <div className="text-[10px] text-gray-500">{record.workcentercode}</div>
        </div>

        {/* Status */}
        <div className="text-[11px] flex items-center justify-center">
          {isDeleted ? (
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">Deleted</span>
          ) : isSapReject ? (
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">SAP Reject</span>
          ) : isValidated ? (
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">Validated</span>
          ) : (
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">Pending</span>
          )}
        </div>

        {/* Action */}
        <div className="flex items-center justify-center">
          {!isValidated && !isDeleted && !isSapReject && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onValidateSingle(record.tsnumber);
              }}
              className="w-8 h-8 flex items-center justify-center text-green-600 hover:bg-green-100 rounded-lg transition-colors"
              title="Validate"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

// ========== Memoized employee group component ==========
const EmployeeGroup = React.memo(({
  group, isExpanded, records, loadingRecords,
  onToggle, onEdit, onValidateSingle, onValidateGroup
}) => {
  const pendingCount = parseInt(group.pending_count);
  const validatedCount = parseInt(group.validated_count);
  const groupHours = parseFloat(group.total_hours || 0);
  const grpPendingHrs = parseFloat(group.pending_hours || 0);
  const grpValidatedHrs = parseFloat(group.validated_hours || 0);

  return (
    <div className="rounded-lg shadow-md border-2 border-blue-300 overflow-hidden">
      {/* Parent Row - Employee Header */}
      <div
        onClick={() => onToggle(group.serialnumber)}
        className="px-3 py-2 cursor-pointer hover:bg-blue-100 transition-colors border-b-2 border-blue-300 bg-blue-50"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-blue-900">
              {isExpanded ? '\u25BC' : '\u25B6'}
            </span>
            <div>
              <div className="text-sm font-bold text-blue-900">{group.full_name}</div>
              <div className="text-xs text-blue-700">{group.serialnumber}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[11px] leading-[15px] font-mono">
              <div className="flex text-blue-900 font-bold">
                <span className="w-[62px]">Total</span>
                <span>: {group.record_count} Act [{groupHours.toFixed(1)} hrs]</span>
              </div>
              <div className="flex text-orange-700 font-bold">
                <span className="w-[62px]">Pending</span>
                <span>: {pendingCount} Act [{grpPendingHrs.toFixed(1)} hrs]</span>
              </div>
              <div className="flex text-green-700 font-bold">
                <span className="w-[62px]">Validated</span>
                <span>: {validatedCount} Act [{grpValidatedHrs.toFixed(1)} hrs]</span>
              </div>
            </div>
            <div className="w-10 h-10 flex items-center justify-center">
              {pendingCount > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onValidateGroup(group.serialnumber, records);
                  }}
                  className="w-10 h-10 flex items-center justify-center text-green-600 hover:bg-green-100 rounded-lg transition-colors"
                  title="Validate Group"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Child Rows - loaded on demand */}
      {isExpanded && (
        <div>
          {/* Header Row */}
          <div className="bg-blue-100 border-t border-b border-blue-300 px-3 py-2">
            <div className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 1.5fr 0.6fr 1fr 0.7fr 0.7fr 0.7fr 1fr 0.7fr 50px' }}>
              <div className="text-[10px] font-bold text-blue-900 text-center">Order</div>
              <div className="text-[10px] font-bold text-blue-900 text-center">Operation</div>
              <div className="text-[10px] font-bold text-blue-900 text-center">Seq</div>
              <div className="text-[10px] font-bold text-blue-900 text-center">Time</div>
              <div className="text-[10px] font-bold text-blue-900 text-center">Duration</div>
              <div className="text-[10px] font-bold text-blue-900 text-center">Plan Hrs</div>
              <div className="text-[10px] font-bold text-blue-900 text-center">Std Fman</div>
              <div className="text-[10px] font-bold text-blue-900 text-center">Workcenter</div>
              <div className="text-[10px] font-bold text-blue-900 text-center">Status</div>
              <div className="text-[10px] font-bold text-blue-900 text-center">Action</div>
            </div>
          </div>

          {/* Data Rows */}
          <div className="divide-y divide-blue-100">
            {loadingRecords ? (
              <div className="p-4 text-center text-sm text-blue-600">
                <div className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2"></div>
                Loading records...
              </div>
            ) : records && records.length > 0 ? (
              records.map((record) => (
                <RecordRow
                  key={record.tsnumber}
                  record={record}
                  onEdit={onEdit}
                  onValidateSingle={onValidateSingle}
                />
              ))
            ) : (
              <div className="p-4 text-center text-sm text-gray-500">No records found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ========== Main Page ==========
// ========== Main Page ==========
const TimesheetValidationPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // States
  const [groups, setGroups] = useState([]);
  const [stats, setStats] = useState({
    totalHours: '0.00', totalRecords: 0, totalEmployees: 0,
    totalPending: 0, totalValidated: 0,
    pendingHours: '0.00', validatedHours: '0.00'
  });
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  const [startDate, setStartDate] = useState(searchParams.get('startDate') || '');
  const [endDate, setEndDate] = useState(searchParams.get('endDate') || '');
  const [expandedGroups, setExpandedGroups] = useState(new Set(
    searchParams.get('expanded')?.split(',').filter(Boolean) || []
  ));
  const [showFilters, setShowFilters] = useState(() => {
    const saved = sessionStorage.getItem('showFilters');
    return saved !== null ? saved === 'true' : true;
  });

  // Per-group records cache: { serialnumber: { records: [...], loading: bool } }
  const [groupRecords, setGroupRecords] = useState({});
  const [lastSearchForGroups, setLastSearchForGroups] = useState('');

  const [loading, setLoading] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [sapStatus, setSapStatus] = useState(null); // { posting: bool, successCount, failCount, results[] }

  const containerRef = useRef(null);
  const searchTimerRef = useRef(null);
  const restoreScrollRef = useRef(null); // null = no restore needed

  // Debounce search input — 400ms
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 400);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // Load data when date range or debounced search changes
  useEffect(() => {
    loadValidationData();
  }, [startDate, endDate, debouncedSearch]);

  // Save filter state to URL
  useEffect(() => {
    const params = {};
    if (searchQuery) params.search = searchQuery;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    if (expandedGroups.size > 0) {
      params.expanded = Array.from(expandedGroups).join(',');
    }
    setSearchParams(params, { replace: true });
  }, [searchQuery, startDate, endDate, expandedGroups, setSearchParams]);

  // When groups load, auto-fetch records for any already-expanded groups
  useEffect(() => {
    if (groups.length > 0 && expandedGroups.size > 0) {
      const saved = sessionStorage.getItem('timesheet_scroll');
      if (saved && parseInt(saved, 10) > 0) {
        restoreScrollRef.current = parseInt(saved, 10);
        sessionStorage.removeItem('timesheet_scroll');
      }
      
      // Load records untuk semua expanded groups DENGAN search term terkini
      for (const sn of expandedGroups) {
        // Selalu load ulang (bukan cache) karena search term mungkin berubah
        loadGroupRecords(sn);
      }
    }
  }, [groups]); // PERHATIAN: Hanya depend on groups, loadGroupRecords akan di-handle oleh effect lain

  // Simpan scroll saat user scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => { 
      restoreScrollRef.current = null; // user scrolled manually, cancel pending restore
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Effect untuk clear cache saat search berubah
  useEffect(() => {
    if (debouncedSearch !== lastSearchForGroups) {
      // Search term berubah, clear semua cache records
      setGroupRecords({});
      setLastSearchForGroups(debouncedSearch);
      
      // Jika ada grup yang expanded, reload dengan search baru
      if (expandedGroups.size > 0) {
        const currentExpanded = new Set(expandedGroups);
        setTimeout(() => {
          for (const sn of currentExpanded) {
            loadGroupRecords(sn);
          }
        }, 100);
      }
    }
  }, [debouncedSearch, expandedGroups]); // Hapus loadGroupRecords dari dependencies untuk mencegah infinite loop

  // Build date params helper
  const getDateParams = useCallback(() => {
    if (startDate && endDate) {
      return { start: startDate, end: endDate };
    }
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fmt = (d) => d.toISOString().split('T')[0];
    return { start: fmt(thirtyDaysAgo), end: fmt(now) };
  }, [startDate, endDate]);

  // API: Load records for one employee group (on expand) - DIPERBAIKI
  const loadGroupRecords = useCallback(async (serialnumber) => {
    setGroupRecords(prev => ({
      ...prev,
      [serialnumber]: { records: prev[serialnumber]?.records || [], loading: true }
    }));

    try {
      const { start, end } = getDateParams();
      
      // TAMBAH parameter search di URL
      let url = `${API_BASE}/timesheet/validation-group/${encodeURIComponent(serialnumber)}?start=${start}&end=${end}`;
      
      // TAMBAH ini: kirim search term ke endpoint group
      if (debouncedSearch.trim()) {
        url += `&search=${encodeURIComponent(debouncedSearch.trim())}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error('Gagal load records');
      const records = await res.json();

      setGroupRecords(prev => {
        const next = { ...prev, [serialnumber]: { records, loading: false } };

        // Setelah state update ini selesai render, cek apakah masih ada yg loading
        setTimeout(() => {
          const stillLoading = Object.values(next).some(v => v.loading);
          if (!stillLoading && restoreScrollRef.current !== null && containerRef.current) {
            const target = restoreScrollRef.current;
            restoreScrollRef.current = null;
            requestAnimationFrame(() => {
              if (containerRef.current) containerRef.current.scrollTop = target;
            });
          }
        }, 0);

        return next;
      });
    } catch (err) {
      console.error('Error loading group records:', err);
      setGroupRecords(prev => ({
        ...prev,
        [serialnumber]: { records: [], loading: false }
      }));
    }
  }, [getDateParams, debouncedSearch]);

  // API: Load stats + groups (lightweight, no individual records)
  const loadValidationData = useCallback(async (keepExpanded = false) => {
    // Simpan scroll sebelum loading (hanya saat keepExpanded)
    const scrollBefore = keepExpanded && containerRef.current
      ? containerRef.current.scrollTop
      : null;

    setLoading(true);
    try {
      const { start, end } = getDateParams();
      let url = `${API_BASE}/timesheet/validation-stats?start=${start}&end=${end}`;
      if (debouncedSearch.trim()) {
        url += `&search=${encodeURIComponent(debouncedSearch.trim())}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error('Gagal load data validasi');
      const data = await res.json();

      setStats(data.stats);
      setGroups(data.groups || []);

      if (keepExpanded) {
        // PERBAIKAN: Re-fetch records for currently expanded groups DENGAN search term yang sama
        const expandedArray = Array.from(expandedGroups);
        for (const sn of expandedArray) {
          // Re-load dengan search term terkini
          loadGroupRecords(sn);
        }
        // Simpan target restore, akan dipakai oleh handleValidate setelah ini
        if (scrollBefore !== null) {
          restoreScrollRef.current = scrollBefore;
        }
      } else {
        // Full reload: clear cached records since date/search changed
        setGroupRecords({});
        restoreScrollRef.current = null;
      }
    } catch (err) {
      console.error('Error loading validation data:', err);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [getDateParams, debouncedSearch, expandedGroups, loadGroupRecords]);

  // Toggle group expansion — lazy load records
  const toggleGroup = useCallback((serialnumber) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serialnumber)) {
        newSet.delete(serialnumber);
      } else {
        newSet.add(serialnumber);
        // Load records if not cached
        if (!groupRecords[serialnumber]?.records?.length) {
          loadGroupRecords(serialnumber);
        }
      }
      return newSet;
    });
  }, [groupRecords, loadGroupRecords]);

  // Expand all — load all groups' records
  const expandAll = useCallback(() => {
    const allSerials = groups.map(g => g.serialnumber);
    setExpandedGroups(new Set(allSerials));
    // Load records for groups not yet cached
    for (const sn of allSerials) {
      if (!groupRecords[sn]?.records?.length) {
        loadGroupRecords(sn);
      }
    }
  }, [groups, groupRecords, loadGroupRecords]);

  const collapseAll = useCallback(() => {
    setExpandedGroups(new Set());
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setStartDate('');
    setEndDate('');
  }, []);

  // Download Excel
  const handleDownloadExcel = useCallback(async () => {
    if (!startDate || !endDate) {
      toast.warning('Pilih Start Date dan End Date terlebih dahulu!');
      return;
    }
    if (startDate > endDate) {
      toast.warning('Start Date tidak boleh lebih besar dari End Date!');
      return;
    }

    setDownloadingExcel(true);
    try {
      const params = new URLSearchParams({
        start: startDate, end: endDate, field: 'longdate_checkout'
      });
      const res = await fetch(`${API_BASE}/timesheet/getexcel?${params.toString()}`);
      if (!res.ok) throw new Error('Gagal download Excel');
      const blob = await res.blob();
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `timesheet_${startDate}_to_${endDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel download error:', err);
      toast.error('Gagal download Excel', { description: err.message });
    } finally {
      setDownloadingExcel(false);
    }
  }, [startDate, endDate]);

  // Post validated tsnumbers to SAP (called after validation succeeds)
  const sendToSap = useCallback(async (tsnumbers) => {
    setSapStatus({ posting: true, successCount: 0, failCount: 0, results: [] });
    try {
      const res = await fetch(`${API_BASE}/timesheet/post-to-sap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tsnumbers })
      });
      const data = await res.json();
      if (!res.ok) {
        setSapStatus({ posting: false, successCount: 0, failCount: tsnumbers.length, results: [], error: data.error || 'SAP error' });
        return;
      }
      setSapStatus({ posting: false, successCount: data.successCount, failCount: data.failCount, results: data.results });

      // Show toast for rejected items
      const rejected = (data.results || []).filter(r => !r.ok);
      if (rejected.length > 0) {
        rejected.forEach(r => {
          toast.error(`SAP Reject — Tsnumber ${r.tsnumber}`, {
            description: r.sapMessage || 'Tidak ada pesan dari SAP',
            duration: 5000,
          });
        });
        loadValidationData(true); // refresh to show SAP Reject badge
      }
    } catch (err) {
      console.error('SAP post error:', err);
      setSapStatus({ posting: false, successCount: 0, failCount: tsnumbers.length, results: [], error: err.message });
    }
  }, [loadValidationData]);

  // Validate single — keep expanded groups open & refresh their records
  const handleValidateSingle = useCallback(async (tsnumber) => {
    try {
      const res = await fetch(`${API_BASE}/timesheet/validation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tsnumbers: [tsnumber] })
      });
      if (!res.ok) throw new Error('Gagal validasi');
      const data = await res.json();
      const validated = (data.updated_rows || []).map(r => r.tsnumber);
      loadValidationData(true);
      if (validated.length > 0) sendToSap(validated);
    } catch (err) {
      console.error('Error validate:', err);
      toast.error('Gagal validasi timesheet', { description: err.message });
    }
  }, [loadValidationData, sendToSap]);

  // Validate group — keep expanded groups open & refresh their records
  const handleValidateGroup = useCallback(async (serialnumber, records) => {
    const recs = records || groupRecords[serialnumber]?.records || [];
    const tsnumbers = recs
      .filter(r => !r.validation_date && String(r.state_flag) !== '5')
      .map(r => r.tsnumber);

    if (tsnumbers.length === 0) return;

    try {
      const res = await fetch(`${API_BASE}/timesheet/validation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tsnumbers })
      });
      if (!res.ok) throw new Error('Gagal validasi batch');
      const data = await res.json();
      const validated = (data.updated_rows || []).map(r => r.tsnumber);
      loadValidationData(true);
      if (validated.length > 0) sendToSap(validated);
    } catch (err) {
      console.error('Error validate batch:', err);
      toast.error('Gagal validasi batch', { description: err.message });
    }
  }, [groupRecords, loadValidationData, sendToSap]);

  // Navigate to edit
  const handleEdit = useCallback((tsnumber) => {
    if (containerRef.current) {
      sessionStorage.setItem('timesheet_scroll', containerRef.current.scrollTop);
    }
    navigate(
      `/timesheet-edit/${tsnumber}?returnUrl=${encodeURIComponent(
        window.location.pathname + window.location.search
      )}`
    );
  }, [navigate]);

  const goBack = useCallback(() => navigate('/'), [navigate]);

  const toggleFilters = useCallback(() => {
    setShowFilters(prev => {
      const newState = !prev;
      sessionStorage.setItem('showFilters', newState.toString());
      return newState;
    });
  }, []);

  

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center bg-blue-900 px-3 py-2.5 shadow-md flex-shrink-0">
        <button
          onClick={goBack}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Back
        </button>
        <h2 className="text-base sm:text-lg font-bold text-white">Timesheet Validation</h2>
        <div className="flex gap-2">
          <button
            onClick={toggleFilters}
            className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded shadow-md hover:shadow-lg active:shadow-sm active:translate-y-0.5 transition-all duration-150 transform"
            title={showFilters ? 'Hide Filters' : 'Show Filters'}
            style={{ boxShadow: '0 3px 6px -1px rgba(37, 99, 235, 0.4), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
          >
            {showFilters ? '\u25B2' : '\u25BC'} Filter
          </button>
          <button
            onClick={loadValidationData}
            className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* Filter Section */}
      {showFilters && (
        <div className="bg-blue-50 border-b border-blue-200 px-3 py-2 flex-shrink-0">
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by serial, name, workcenter, order..."
              className="w-full px-3 py-2 text-sm text-gray-800 bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-600"
            />
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-1/4 px-2 py-2 text-sm text-gray-800 bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-600"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-1/4 px-2 py-2 text-sm text-gray-800 bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="flex gap-2 items-center justify-between">
              <div className="flex gap-2">
                <button onClick={clearFilters} className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors">Clear Filters</button>
                <button onClick={expandAll} className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors">Expand All</button>
                <button onClick={collapseAll} className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors">Collapse All</button>
              </div>
              <button
                onClick={handleDownloadExcel}
                disabled={downloadingExcel}
                className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-500 active:bg-green-700 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Download Excel berdasarkan date range"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                {downloadingExcel ? 'Downloading...' : 'Download Excel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Summary */}
      <div className="bg-white border-b border-blue-200 px-3 py-3 flex-shrink-0">
        <div className="grid grid-cols-5 gap-2">
          {/* Pending */}
          <div className="w-full bg-amber-50 border border-amber-200 px-2 py-2 rounded-lg text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 mx-auto mb-1 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div className="text-[10px] text-amber-600 font-medium">Pending</div>
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm font-bold text-amber-800">{stats.totalPending} <span className="text-[9px] font-medium">Act</span></span>
              <span className="text-[9px] text-amber-400">|</span>
              <span className="text-[10px] font-bold text-amber-700">{parseFloat(stats.pendingHours || 0).toFixed(1)} <span className="text-[9px] font-medium">Hrs</span></span>
            </div>
          </div>

          {/* Validated */}
          <div className="w-full bg-emerald-50 border border-emerald-200 px-2 py-2 rounded-lg text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 mx-auto mb-1 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <div className="text-[10px] text-emerald-600 font-medium">Validated</div>
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm font-bold text-emerald-800">{stats.totalValidated} <span className="text-[9px] font-medium">Act</span></span>
              <span className="text-[9px] text-emerald-400">|</span>
              <span className="text-[10px] font-bold text-emerald-700">{parseFloat(stats.validatedHours || 0).toFixed(1)} <span className="text-[9px] font-medium">Hrs</span></span>
            </div>
          </div>

          {/* Total Hours */}
          <div className="w-full bg-blue-50 border border-blue-200 text-center px-2 py-2.5 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 mx-auto mb-1 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <div className="text-[10px] text-blue-600 font-medium">Total Hours</div>
            <div className="text-lg font-bold text-blue-800">{stats.totalHours}</div>
          </div>

          {/* Total Records */}
          <div className="w-full bg-indigo-50 border border-indigo-200 text-center px-2 py-2.5 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 mx-auto mb-1 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <div className="text-[10px] text-indigo-600 font-medium">Records</div>
            <div className="text-lg font-bold text-indigo-800">{stats.totalRecords}</div>
          </div>

          {/* Total Employees */}
          <div className="w-full bg-cyan-50 border border-cyan-200 text-center px-2 py-2.5 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 mx-auto mb-1 text-cyan-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <div className="text-[10px] text-cyan-600 font-medium">Employees</div>
            <div className="text-lg font-bold text-cyan-800">{stats.totalEmployees}</div>
          </div>
        </div>
      </div>

      {/* SAP Post Status Banner */}
      {sapStatus && (
        <div className={`flex-shrink-0 px-3 py-2 flex items-center justify-between text-sm border-b ${
          sapStatus.posting
            ? 'bg-blue-50 border-blue-200 text-blue-700'
            : sapStatus.failCount > 0 && sapStatus.successCount === 0
              ? 'bg-red-50 border-red-200 text-red-700'
              : sapStatus.failCount > 0
                ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          <div className="flex items-center gap-2">
            {sapStatus.posting ? (
              <>
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span className="font-medium">Mengirim data ke SAP...</span>
              </>
            ) : sapStatus.error ? (
              <span className="font-medium">SAP Error: {sapStatus.error}</span>
            ) : (
              <span className="font-medium">
                SAP: {sapStatus.successCount} berhasil
                {sapStatus.failCount > 0 && `, ${sapStatus.failCount} gagal`}
              </span>
            )}
          </div>
          {!sapStatus.posting && (
            <button
              onClick={() => setSapStatus(null)}
              className="text-xs px-2 py-0.5 rounded hover:bg-black/10 transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Grouped List - Scrollable */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-3 py-2 bg-white">
        {loading ? (
          <div className="text-center text-blue-600 mt-10">
            <div className="inline-block w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2"></div>
            <span className="text-sm font-medium">Loading data...</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center text-gray-600 mt-10">
            <p>Tidak ada data timesheet untuk divalidasi</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const isExpanded = expandedGroups.has(group.serialnumber);
              const grpCache = groupRecords[group.serialnumber];
              return (
                <EmployeeGroup
                  key={group.serialnumber}
                  group={group}
                  isExpanded={isExpanded}
                  records={grpCache?.records || []}
                  loadingRecords={grpCache?.loading || false}
                  onToggle={toggleGroup}
                  onEdit={handleEdit}
                  onValidateSingle={handleValidateSingle}
                  onValidateGroup={handleValidateGroup}
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
