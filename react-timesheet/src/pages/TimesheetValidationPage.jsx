import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/**
 * Timesheet Validation Page
 * Converted dari tsuye.html
 * Shows grouped timesheets by employee with expand/collapse, filters, and validation actions
 */

// Helper: Format date string "dd/mm/yyyy" to "dd Mmm yy" (e.g. "05/02/2026" → "05 Feb 26")
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const formatDateShort = (dateStr) => {
  if (!dateStr) return '-';
  // dateStr format: "dd/mm/yyyy"
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  const day = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const year = parts[2].slice(-2); // last 2 digits
  return `${day} ${MONTH_SHORT[monthIdx] || '??'} ${year}`;
};

// Helper: Format decimal duration to stacked "X jam\nY menit"
const formatDurationStacked = (durationStr) => {
  const totalHours = parseFloat(durationStr || 0);
  const jam = Math.floor(totalHours);
  const menit = Math.round((totalHours - jam) * 60);
  return { jam, menit };
};

const TimesheetValidationPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // States
  const [timesheets, setTimesheets] = useState([]);
  const [filteredTimesheets, setFilteredTimesheets] = useState([]);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [startDate, setStartDate] = useState(searchParams.get('startDate') || '');
  const [endDate, setEndDate] = useState(searchParams.get('endDate') || '');
  const [expandedGroups, setExpandedGroups] = useState(new Set(
    searchParams.get('expanded')?.split(',').filter(Boolean) || []
  ));
  const [showFilters, setShowFilters] = useState(() => {
    const saved = sessionStorage.getItem('showFilters');
    return saved !== null ? saved === 'true' : true; // Default to true (shown)
  });

  // Stats
  const [stats, setStats] = useState({
    totalHours: 0,
    totalRecords: 0,
    totalEmployees: 0,
    totalPending: 0,
    totalValidated: 0
  });

  const [downloadingExcel, setDownloadingExcel] = useState(false);

  const scrollPositionRef = useRef(0);
  const containerRef = useRef(null);

  // Load data on mount
  useEffect(() => {
    loadValidationData();
  }, []);

  // Apply filters whenever dependencies change
  useEffect(() => {
    applyFilters();
  }, [timesheets, searchQuery, startDate, endDate]);

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

  // Restore scroll position after render
  useEffect(() => {
    const savedScroll = searchParams.get('scrollY');
    if (savedScroll && containerRef.current) {
      setTimeout(() => {
        containerRef.current.scrollTop = parseInt(savedScroll);
      }, 100);
    }
  }, [filteredTimesheets]);

  // API: Load validation data
  const loadValidationData = async () => {
    // NOTE: Untuk development, load dummy data dulu
    // Untuk production, uncomment code dibawah dan comment load dummy data

    /* PRODUCTION CODE - Uncomment untuk production
    try {
      const res = await fetch('/timesheet/validation');
      if (!res.ok) {
        throw new Error('Gagal load data validasi dari API');
      }
      const data = await res.json();

      if (data && data.length > 0) {
        setTimesheets(data);
        return;
      } else {
        throw new Error('Data kosong dari API');
      }
    } catch (err) {
      console.error('Error loading validation data from API:', err);
      // Fallback to dummy data jika API gagal
    }
    */

    // DEVELOPMENT MODE - Load dummy data langsung
    try {
      console.log('Loading dummy validation data...');
      const dummyResponse = await fetch('/dummy-validation-timesheets.json');
      if (dummyResponse.ok) {
        const dummyData = await dummyResponse.json();
        setTimesheets(dummyData);
      } else {
        throw new Error('Dummy data tidak tersedia');
      }
    } catch (dummyError) {
      console.error('Error loading dummy data:', dummyError);
      alert('❌ Gagal load dummy data');
      setTimesheets([]);
    }
  };

  // Apply filters to timesheets
  const applyFilters = () => {
    let filtered = [...timesheets];

    // Filter by search query (serial, name, workcenter, order)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.serialnumber?.toLowerCase().includes(query) ||
        item.full_name?.toLowerCase().includes(query) ||
        item.workcenterdescription?.toLowerCase().includes(query) ||
        item.production_order?.toLowerCase().includes(query)
      );
    }

    // Filter by date range
    if (startDate) {
      filtered = filtered.filter(item => {
        const itemDate = new Date(item.longdate_checkin);
        const filterDate = new Date(startDate);
        return itemDate >= filterDate;
      });
    }

    if (endDate) {
      filtered = filtered.filter(item => {
        const itemDate = new Date(item.longdate_checkin);
        const filterDate = new Date(endDate);
        filterDate.setHours(23, 59, 59, 999); // End of day
        return itemDate <= filterDate;
      });
    }

    setFilteredTimesheets(filtered);
    calculateStats(filtered);
  };

  // Calculate statistics
  const calculateStats = (data) => {
    const totalHours = data.reduce((sum, item) => sum + parseFloat(item.duration || 0), 0);
    const totalRecords = data.length;
    const uniqueEmployees = new Set(data.map(item => item.serialnumber));
    const totalEmployees = uniqueEmployees.size;

    // Calculate pending and validated (pending = validation_date is null)
    const pendingItems = data.filter(item => !item.validation_date);
    const validatedItems = data.filter(item => !!item.validation_date);
    const totalPending = pendingItems.length;
    const totalValidated = validatedItems.length;
    const pendingHours = pendingItems.reduce((sum, item) => sum + parseFloat(item.duration || 0), 0);
    const validatedHours = validatedItems.reduce((sum, item) => sum + parseFloat(item.duration || 0), 0);

    setStats({
      totalHours: totalHours.toFixed(2),
      totalRecords,
      totalEmployees,
      totalPending,
      totalValidated,
      pendingHours: pendingHours.toFixed(2),
      validatedHours: validatedHours.toFixed(2)
    });
  };

  // Group timesheets by employee
  const getGroupedTimesheets = () => {
    const groups = {};

    filteredTimesheets.forEach(item => {
      const key = item.serialnumber;
      if (!groups[key]) {
        groups[key] = {
          serialnumber: item.serialnumber,
          full_name: item.full_name,
          records: []
        };
      }
      groups[key].records.push(item);
    });

    return Object.values(groups);
  };

  // Toggle group expansion
  const toggleGroup = (serialnumber) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(serialnumber)) {
      newExpanded.delete(serialnumber);
    } else {
      newExpanded.add(serialnumber);
    }
    setExpandedGroups(newExpanded);
  };

  // Expand all groups
  const expandAll = () => {
    const allSerials = getGroupedTimesheets().map(g => g.serialnumber);
    setExpandedGroups(new Set(allSerials));
  };

  // Collapse all groups
  const collapseAll = () => {
    setExpandedGroups(new Set());
  };

  // Clear filters
  const clearFilters = () => {
    setSearchQuery('');
    setStartDate('');
    setEndDate('');
  };

  // Download Excel berdasarkan date range
  const handleDownloadExcel = async () => {
    if (!startDate || !endDate) {
      alert('❌ Pilih Start Date dan End Date terlebih dahulu!');
      return;
    }
    if (startDate > endDate) {
      alert('❌ Start Date tidak boleh lebih besar dari End Date!');
      return;
    }

    setDownloadingExcel(true);
    try {
      const params = new URLSearchParams({
        start: startDate,
        end: endDate,
        field: 'longdate_checkout'
      });

      // PRODUCTION: Uncomment baris dibawah
      // const res = await fetch(`/timesheet/getexcel?${params.toString()}`);
      // if (!res.ok) throw new Error('Gagal download Excel');
      // const blob = await res.blob();
      // const a = document.createElement('a');
      // const url = URL.createObjectURL(blob);
      // a.href = url;
      // a.download = `timesheet_${startDate}_to_${endDate}.xlsx`;
      // document.body.appendChild(a);
      // a.click();
      // a.remove();
      // URL.revokeObjectURL(url);
      // alert('✅ Excel berhasil diunduh!');

      // DEVELOPMENT: Simulate download
      console.log('Downloading Excel with range:', startDate, 'to', endDate);
      await new Promise(resolve => setTimeout(resolve, 1500));
      alert(`✅ Excel berhasil diunduh: timesheet_${startDate}_to_${endDate}.xlsx`);

    } catch (err) {
      console.error('Excel download error:', err);
      alert('❌ Gagal download Excel: ' + err.message);
    } finally {
      setDownloadingExcel(false);
    }
  };

  // Handle single validation
  const handleValidateSingle = async (tsnumber) => {
    try {
      const res = await fetch('/timesheet/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tsnumber })
      });

      if (!res.ok) {
        throw new Error('Gagal validasi timesheet');
      }

      await res.json();
      alert('✅ Timesheet berhasil divalidasi');
      loadValidationData();
    } catch (err) {
      console.error('Error validate timesheet:', err);
      alert('❌ Gagal validasi timesheet');
    }
  };

  // Handle group validation
  const handleValidateGroup = async (records) => {
    const tsnumbers = records
      .filter(r => !r.validation_date)
      .map(r => r.tsnumber);

    if (tsnumbers.length === 0) {
      alert('Tidak ada timesheet yang perlu divalidasi');
      return;
    }

    const confirm = window.confirm(
      `Validasi ${tsnumbers.length} timesheet untuk karyawan ini?`
    );

    if (!confirm) return;

    try {
      const res = await fetch('/timesheet/validate-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tsnumbers })
      });

      if (!res.ok) {
        throw new Error('Gagal validasi batch');
      }

      await res.json();
      alert('✅ Timesheet berhasil divalidasi');
      loadValidationData();
    } catch (err) {
      console.error('Error validate batch:', err);
      alert('❌ Gagal validasi batch');
    }
  };

  // Navigate to edit page with state preservation
  const handleEdit = (tsnumber) => {
    // Save scroll position
    if (containerRef.current) {
      scrollPositionRef.current = containerRef.current.scrollTop;
      const currentParams = new URLSearchParams(searchParams);
      currentParams.set('scrollY', scrollPositionRef.current);
      setSearchParams(currentParams, { replace: true });
    }

    // Navigate to edit page
    navigate(`/timesheet-edit/${tsnumber}?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  };

  // Back to main menu
  const goBack = () => {
    navigate('/timesheet-mainmenu');
  };

  // Toggle filter visibility
  const toggleFilters = () => {
    const newState = !showFilters;
    setShowFilters(newState);
    sessionStorage.setItem('showFilters', newState.toString());
  };

  const groupedData = getGroupedTimesheets();

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Header - Dark Blue */}
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
            {showFilters ? '▲' : '▼'} Filter
          </button>
          <button
            onClick={loadValidationData}
            className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* Filter Section - Light Blue Background - Collapsible */}
      {showFilters && (
        <div className="bg-blue-50 border-b border-blue-200 px-3 py-2 flex-shrink-0">
          <div className="flex flex-col gap-2">
            {/* Search */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by serial, name, workcenter, order..."
              className="w-full px-3 py-2 text-sm text-gray-800 bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-600"
            />

            {/* Date Range - 50% width */}
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

            {/* Action Buttons */}
            <div className="flex gap-2 items-center justify-between">
              <div className="flex gap-2">
                <button
                  onClick={clearFilters}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  Clear Filters
                </button>
                <button
                  onClick={expandAll}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  Expand All
                </button>
                <button
                  onClick={collapseAll}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  Collapse All
                </button>
              </div>

              {/* Download Excel Button */}
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

      {/* Stats Summary Container - Separate Section */}
      <div className="bg-white border-b border-blue-200 px-3 py-3 flex-shrink-0">
        {/* All 5 boxes in one row - sejajar */}
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

      {/* Grouped List - Scrollable - White Background */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-3 py-2 bg-white">
        {groupedData.length === 0 ? (
          <div className="text-center text-gray-600 mt-10">
            <p>Tidak ada data timesheet untuk divalidasi</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedData.map((group) => {
              const isExpanded = expandedGroups.has(group.serialnumber);
              const pendingRecs = group.records.filter(r => !r.validation_date);
              const validatedRecs = group.records.filter(r => !!r.validation_date);
              const pendingCount = pendingRecs.length;
              const validatedCount = validatedRecs.length;
              const groupHours = group.records.reduce((sum, r) => sum + parseFloat(r.duration || 0), 0);
              const grpPendingHrs = pendingRecs.reduce((sum, r) => sum + parseFloat(r.duration || 0), 0);
              const grpValidatedHrs = validatedRecs.reduce((sum, r) => sum + parseFloat(r.duration || 0), 0);

              return (
                <div key={group.serialnumber} className="rounded-lg shadow-md border-2 border-blue-300 overflow-hidden">
                  {/* Parent Row - Employee Header - Light Blue */}
                  <div
                    onClick={() => toggleGroup(group.serialnumber)}
                    className="px-3 py-2 cursor-pointer hover:bg-blue-100 transition-colors border-b-2 border-blue-300 bg-blue-50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-blue-900">
                          {isExpanded ? '▼' : '▶'}
                        </span>
                        <div>
                          <div className="text-sm font-bold text-blue-900">
                            {group.full_name}
                          </div>
                          <div className="text-xs text-blue-700">
                            {group.serialnumber}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Stacked summary table */}
                        <div className="text-[11px] leading-[15px] font-mono">
                          <div className="flex text-blue-900 font-bold">
                            <span className="w-[62px]">Total</span>
                            <span>: {group.records.length} Act [{groupHours.toFixed(1)} hrs]</span>
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
                                handleValidateGroup(group.records);
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

                  {/* Child Rows - Timesheet Records */}
                  {isExpanded && (
                    <div>
                      {/* Header Row - Light Blue */}
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

                      {/* Data Rows - White Background */}
                      <div className="divide-y divide-blue-100">
                        {group.records.map((record, idx) => {
                        const isValidated = !!record.validation_date;
                        const isUnprod = !!record.activitytype;
                        // Build operation display text
                        const operationDisplay = isUnprod
                          ? record.operation_text
                          : (record.part_name
                              ? `${record.part_name} : ${record.operation_text}`
                              : record.operation_text);
                        return (
                          <div
                            key={idx}
                            onClick={() => !isValidated && handleEdit(record.tsnumber)}
                            className={`p-3 transition-colors ${
                              isValidated
                                ? 'bg-green-50 bg-opacity-60 cursor-not-allowed opacity-70'
                                : 'hover:bg-blue-50 cursor-pointer bg-white'
                            }`}
                          >
                            <div className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 1.5fr 0.6fr 1fr 0.7fr 0.7fr 0.7fr 1fr 0.7fr 50px' }}>
                              {/* Order - center */}
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

                              {/* Operation - left */}
                              <div className="text-[11px] text-left">
                                <div className="font-medium text-gray-800 break-words leading-snug">
                                  {operationDisplay}
                                </div>
                                {record.note && (
                                  <div className="text-[10px] italic text-gray-700 bg-blue-50 border-l-2 border-blue-500 px-1.5 py-0.5 rounded mt-0.5">
                                    {record.note}
                                  </div>
                                )}
                              </div>

                              {/* Seq - center */}
                              <div className="text-[11px] text-center">
                                <div className="font-semibold text-gray-800">{record.seq != null ? record.seq : '-'}</div>
                              </div>

                              {/* Time - format dd Mmm yy - center */}
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

                              {/* Duration - stacked vertical - center */}
                              <div className="text-[11px] text-center">
                                {(() => {
                                  const { jam, menit } = formatDurationStacked(record.duration);
                                  return (
                                    <div className="flex flex-col leading-tight items-center">
                                      <span className="font-bold text-blue-900">{jam} jam</span>
                                      <span className="text-blue-700">{menit} menit</span>
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Plan Hours - center */}
                              <div className="text-[11px] text-center">
                                <div className="font-semibold text-gray-800">
                                  {record.planhours != null ? parseFloat(record.planhours).toFixed(2) : '-'}
                                </div>
                              </div>

                              {/* Std Fman - center */}
                              <div className="text-[11px] text-center">
                                <div className="font-semibold text-gray-800">
                                  {record.std_foreman_hours != null ? parseFloat(record.std_foreman_hours).toFixed(2) : '-'}
                                </div>
                              </div>

                              {/* Workcenter - center */}
                              <div className="text-[11px] text-center">
                                <div className="font-medium text-gray-800 break-words leading-snug">{record.workcenterdescription}</div>
                                <div className="text-[10px] text-gray-500">{record.workcentercode}</div>
                              </div>

                              {/* Status - center */}
                              <div className="text-[11px] flex items-center justify-center">
                                {isValidated ? (
                                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">Validated</span>
                                ) : (
                                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">Pending</span>
                                )}
                              </div>

                              {/* Action - center */}
                              <div className="flex items-center justify-center">
                                {!isValidated && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleValidateSingle(record.tsnumber);
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
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TimesheetValidationPage;
