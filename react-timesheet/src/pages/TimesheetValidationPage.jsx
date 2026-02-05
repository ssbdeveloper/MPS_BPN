import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/**
 * Timesheet Validation Page
 * Converted dari tsuye.html
 * Shows grouped timesheets by employee with expand/collapse, filters, and validation actions
 */
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

    // Calculate pending and validated
    const totalPending = data.filter(item => item.tsstatus === 'C').length;
    const totalValidated = data.filter(item => item.tsstatus === 'V').length;

    setStats({
      totalHours: totalHours.toFixed(2),
      totalRecords,
      totalEmployees,
      totalPending,
      totalValidated
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
      .filter(r => r.tsstatus === 'C')
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

          </div>
        </div>
      )}

      {/* Stats Summary Container - Separate Section */}
      <div className="bg-white border-b border-blue-200 px-3 py-3 flex-shrink-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {/* Total Hours */}
          <div className="w-full bg-gradient-to-br from-blue-600 to-blue-700 text-white px-4 py-3 rounded-lg shadow-md">
            <div className="text-xs opacity-90">Total Hours</div>
            <div className="text-xl font-bold">{stats.totalHours}</div>
          </div>

          {/* Total Records */}
          <div className="w-full bg-gradient-to-br from-blue-600 to-blue-700 text-white px-4 py-3 rounded-lg shadow-md">
            <div className="text-xs opacity-90">Records</div>
            <div className="text-xl font-bold">{stats.totalRecords}</div>
          </div>

          {/* Total Employees */}
          <div className="w-full bg-gradient-to-br from-blue-600 to-blue-700 text-white px-4 py-3 rounded-lg shadow-md">
            <div className="text-xs opacity-90">Employees</div>
            <div className="text-xl font-bold">{stats.totalEmployees}</div>
          </div>

          {/* Total Pending */}
          <div className="w-full bg-gradient-to-br from-yellow-500 to-yellow-600 text-white px-4 py-3 rounded-lg shadow-md">
            <div className="text-xs opacity-90">Pending</div>
            <div className="text-xl font-bold">{stats.totalPending}</div>
          </div>

          {/* Total Validated */}
          <div className="w-full bg-gradient-to-br from-green-500 to-green-600 text-white px-4 py-3 rounded-lg shadow-md">
            <div className="text-xs opacity-90">Validated</div>
            <div className="text-xl font-bold">{stats.totalValidated}</div>
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
          <div className="space-y-3">
            {groupedData.map((group) => {
              const isExpanded = expandedGroups.has(group.serialnumber);
              const pendingCount = group.records.filter(r => r.tsstatus === 'C').length;
              const validatedCount = group.records.filter(r => r.tsstatus === 'V').length;
              const groupHours = group.records.reduce((sum, r) => sum + parseFloat(r.duration || 0), 0);

              return (
                <div key={group.serialnumber} className="bg-white rounded-lg shadow-sm border border-blue-200">
                  {/* Parent Row - Employee Header - Light Blue */}
                  <div
                    onClick={() => toggleGroup(group.serialnumber)}
                    className="p-3 cursor-pointer hover:bg-blue-100 transition-colors border-b border-blue-200 bg-blue-50"
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
                      <div className="flex items-center gap-4">
                        <div className="text-xs text-blue-900 min-w-[200px]">
                          <span className="font-semibold">{groupHours.toFixed(2)}h</span>
                          {' • '}
                          <span className="text-orange-600 font-semibold">{pendingCount} pending</span>
                          {' • '}
                          <span className="text-green-600 font-semibold">{validatedCount} validated</span>
                        </div>
                        <div className="w-10 h-10 flex items-center justify-center">
                          {pendingCount > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleValidateGroup(group.records);
                              }}
                              className="w-10 h-10 flex items-center justify-center text-orange-600 hover:bg-orange-100 rounded-lg transition-colors"
                              title="Validate Group"
                            >
                              <span className="text-xl font-bold">✓✓</span>
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
                        <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr 2fr 1fr 1fr 60px' }}>
                          <div className="text-xs font-bold text-blue-900">Order</div>
                          <div className="text-xs font-bold text-blue-900 col-span-2">Operation</div>
                          <div className="text-xs font-bold text-blue-900">Time</div>
                          <div className="text-xs font-bold text-blue-900">Duration</div>
                          <div className="text-xs font-bold text-blue-900 text-center">Action</div>
                        </div>
                      </div>

                      {/* Data Rows - White Background */}
                      <div className="divide-y divide-blue-100">
                        {group.records.map((record, idx) => {
                        const isValidated = record.tsstatus === 'V';
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
                            {/* NOTE: Jika ingin tambah kolom, ubah gridTemplateColumns dibawah ini */}
                            {/* Contoh: '1fr 1fr 2fr 1fr 1fr 1fr 60px' untuk 7 kolom */}
                            <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr 2fr 1fr 1fr 60px' }}>
                              {/* Order */}
                              <div className="text-xs">
                                <div className="font-semibold text-blue-900">{record.production_order}</div>
                                <div className="text-blue-700">{record.ssbr_ident}</div>
                              </div>

                              {/* Operation */}
                              <div className="text-xs col-span-2">
                                <div className="font-medium text-gray-800 break-words leading-relaxed">
                                  {record.operation_text}
                                </div>
                                {record.note && (
                                  <div className="text-xs italic text-gray-700 bg-blue-50 border-l-2 border-blue-500 px-2 py-1 rounded mt-1">
                                    {record.note}
                                  </div>
                                )}
                              </div>

                              {/* Time */}
                              <div className="text-xs">
                                <div className="text-gray-700">
                                  <span className="font-medium">{record.date_checkin}</span>
                                  <span className="text-blue-700 ml-1">{record.hour_checkin}</span>
                                </div>
                                <div className="text-gray-700">
                                  <span className="font-medium">{record.date_checkout}</span>
                                  <span className="text-blue-700 ml-1">{record.hour_checkout}</span>
                                </div>
                              </div>

                              {/* Duration & Status */}
                              <div className="text-xs">
                                <div className="font-bold text-blue-900">{record.duration}h</div>
                                {isValidated ? (
                                  <div className="text-green-600 font-semibold">✓ Validated</div>
                                ) : (
                                  <div className="text-orange-600 font-semibold">⏳ Pending</div>
                                )}
                              </div>

                              {/* Action - Single Validate Icon - Orange */}
                              <div className="flex items-center justify-center">
                                {!isValidated && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleValidateSingle(record.tsnumber);
                                    }}
                                    className="w-10 h-10 flex items-center justify-center text-orange-600 hover:bg-orange-100 rounded-lg transition-colors"
                                    title="Validate"
                                  >
                                    <span className="text-2xl font-bold">✓</span>
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
