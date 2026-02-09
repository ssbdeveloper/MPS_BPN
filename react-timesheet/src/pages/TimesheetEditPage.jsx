import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

/**
 * Timesheet Edit Page
 * Edit timesheet record dengan searchable workcenter dropdown
 * Connected to real API
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

const TimesheetEditPage = () => {
  const navigate = useNavigate();
  const { tsnumber } = useParams();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get('returnUrl') || '/timesheet-validation';

  // Form States
  const [formData, setFormData] = useState({
    tsnumber: '',
    serialnumber: '',
    full_name: '',
    production_order: '',
    ssbr_ident: '',
    operation_text: '',
    seq: '',
    workcenterdescription: '',
    workcentercode: '',
    date_checkin: '',
    hour_checkin: '',
    date_checkout: '',
    hour_checkout: '',
    duration: '',
    note: '',
    planhours: '',
    std_foreman_hours: '',
    state_flag: '',
    validation_date: ''
  });

  // Date/time picker states (HTML5 format: yyyy-MM-dd and HH:mm)
  const [checkinDatePicker, setCheckinDatePicker] = useState('');
  const [checkinTimePicker, setCheckinTimePicker] = useState('');
  const [checkoutDatePicker, setCheckoutDatePicker] = useState('');
  const [checkoutTimePicker, setCheckoutTimePicker] = useState('');

  // Workcenter dropdown states
  const [workcenters, setWorkcenters] = useState([]);
  const [workcenterSearch, setWorkcenterSearch] = useState('');
  const [showWorkcenterDropdown, setShowWorkcenterDropdown] = useState(false);
  const [filteredWorkcenters, setFilteredWorkcenters] = useState([]);
  const workcenterDropdownRef = useRef(null);

  // Loading & validation states
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalData, setOriginalData] = useState(null);

  // Load timesheet data on mount
  useEffect(() => {
    loadTimesheetData();
    loadWorkcenters();
  }, [tsnumber]);

  // Auto-calculate duration when check-in/check-out changes
  useEffect(() => {
    calculateDuration();
  }, [formData.date_checkin, formData.hour_checkin, formData.date_checkout, formData.hour_checkout]);

  // Build flat list of selectable workcenters (Normal + OT) from workcenter table
  // workcenter table has: workcenternew (normal code), workcenterot (OT code),
  // workcenter_description, machineid
  const workcenterOptions = React.useMemo(() => {
    const options = [];
    for (const wc of workcenters) {
      if (wc.workcenternew) {
        options.push({
          code: wc.workcenternew,
          description: wc.workcenter_description || '',
          machineid: wc.machineid || '',
          type: 'Normal'
        });
      }
      if (wc.workcenterot) {
        options.push({
          code: wc.workcenterot,
          description: wc.workcenter_description || '',
          machineid: wc.machineid || '',
          type: 'OT'
        });
      }
    }
    return options;
  }, [workcenters]);

  // Filter workcenters based on search
  useEffect(() => {
    if (workcenterSearch.trim() === '') {
      setFilteredWorkcenters(workcenterOptions);
    } else {
      const query = workcenterSearch.toLowerCase();
      const filtered = workcenterOptions.filter(wc =>
        wc.code.toLowerCase().includes(query) ||
        wc.description.toLowerCase().includes(query)
      );
      setFilteredWorkcenters(filtered);
    }
  }, [workcenterSearch, workcenterOptions]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (workcenterDropdownRef.current && !workcenterDropdownRef.current.contains(event.target)) {
        setShowWorkcenterDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Warn user about unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasChanges]);

  // API: Load timesheet data by tsnumber
  const loadTimesheetData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/timesheet/getid/${tsnumber}`);
      if (!res.ok) throw new Error('Gagal load timesheet data');
      const record = await res.json();

      if (!record) {
        alert('Timesheet tidak ditemukan');
        navigate(returnUrl);
        return;
      }

      // Fetch planhours from SOW based on production_order + seq = codenumber
      let sowPlanhours = record.planhours || null;
      if (record.production_order && record.seq) {
        try {
          const sowRes = await fetch(`${API_BASE}/sow/planhours?production_order=${encodeURIComponent(record.production_order)}&seq=${encodeURIComponent(record.seq)}`);
          if (sowRes.ok) {
            const sowData = await sowRes.json();
            if (sowData.planhours != null) {
              sowPlanhours = sowData.planhours;
            }
          }
        } catch (err) {
          console.error('Error fetching planhours from SOW:', err);
        }
      }

      setFormData({
        tsnumber: record.tsnumber || '',
        serialnumber: record.serialnumber || '',
        full_name: record.full_name || '',
        production_order: record.production_order || '',
        ssbr_ident: record.ssbr_ident || '',
        operation_text: record.operation_text || '',
        seq: record.seq || '',
        workcenterdescription: record.workcenterdescription || '',
        workcentercode: record.workcentercode || '',
        date_checkin: record.date_checkin || '',
        hour_checkin: record.hour_checkin || '',
        date_checkout: record.date_checkout || '',
        hour_checkout: record.hour_checkout || '',
        duration: record.duration != null ? String(record.duration) : '',
        note: record.note || '',
        planhours: sowPlanhours != null ? String(sowPlanhours) : '',
        std_foreman_hours: record.std_foreman_hours != null ? String(record.std_foreman_hours) : '',
        state_flag: record.state_flag || '',
        validation_date: record.validation_date || ''
      });
      setOriginalData({ ...record, planhours: sowPlanhours });

      // Initialize date/time pickers
      setCheckinDatePicker(ddmmyyyyToYyyymmdd(record.date_checkin));
      setCheckinTimePicker(normalizeTime(record.hour_checkin));
      setCheckoutDatePicker(ddmmyyyyToYyyymmdd(record.date_checkout));
      setCheckoutTimePicker(normalizeTime(record.hour_checkout));
    } catch (err) {
      console.error('Error loading timesheet:', err);
      alert('Gagal load data timesheet');
      navigate(returnUrl);
    } finally {
      setLoading(false);
    }
  };

  // API: Load workcenters for dropdown
  const loadWorkcenters = async () => {
    try {
      const res = await fetch(`${API_BASE}/workcenter`);
      if (!res.ok) throw new Error('Gagal load workcenter');
      const data = await res.json();
      setWorkcenters(Array.isArray(data) ? data : []);
      setFilteredWorkcenters(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading workcenters:', err);
      setWorkcenters([]);
      setFilteredWorkcenters([]);
    }
  };

  // Helper: Convert dd/mm/yyyy to yyyy-MM-dd
  const ddmmyyyyToYyyymmdd = (ddmmyyyy) => {
    if (!ddmmyyyy) return '';
    const [day, month, year] = ddmmyyyy.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  // Helper: Convert yyyy-MM-dd to dd/mm/yyyy
  const yyyymmddToDdmmyyyy = (yyyymmdd) => {
    if (!yyyymmdd) return '';
    const [year, month, day] = yyyymmdd.split('-');
    return `${day}/${month}/${year}`;
  };

  // Helper: Normalize time format (handle both "." and ":" separators)
  const normalizeTime = (time) => {
    if (!time) return '';
    return time.replace('.', ':');
  };

  // Calculate duration from check-in and check-out
  const calculateDuration = () => {
    const { date_checkin, hour_checkin, date_checkout, hour_checkout } = formData;

    if (!date_checkin || !hour_checkin || !date_checkout || !hour_checkout) {
      return;
    }

    try {
      const [dayIn, monthIn, yearIn] = date_checkin.split('/');
      const [hourIn, minIn] = hour_checkin.replace('.', ':').split(':');
      const checkinDate = new Date(yearIn, monthIn - 1, dayIn, hourIn, minIn);

      const [dayOut, monthOut, yearOut] = date_checkout.split('/');
      const [hourOut, minOut] = hour_checkout.replace('.', ':').split(':');
      const checkoutDate = new Date(yearOut, monthOut - 1, dayOut, hourOut, minOut);

      const diffMs = checkoutDate - checkinDate;
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours >= 0) {
        setFormData(prev => ({
          ...prev,
          duration: diffHours.toFixed(2)
        }));
      }
    } catch (err) {
      console.error('Error calculating duration:', err);
    }
  };

  // Handle input change
  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    setHasChanges(true);
  };

  // Handle date picker change
  const handleDatePickerChange = (field, value) => {
    const ddmmyyyy = yyyymmddToDdmmyyyy(value);

    if (field === 'checkin') {
      setCheckinDatePicker(value);
      setFormData(prev => ({
        ...prev,
        date_checkin: ddmmyyyy
      }));
    } else if (field === 'checkout') {
      setCheckoutDatePicker(value);
      setFormData(prev => ({
        ...prev,
        date_checkout: ddmmyyyy
      }));
    }
    setHasChanges(true);
  };

  // Handle time picker change
  const handleTimePickerChange = (field, value) => {
    if (field === 'checkin') {
      setCheckinTimePicker(value);
      setFormData(prev => ({
        ...prev,
        hour_checkin: value
      }));
    } else if (field === 'checkout') {
      setCheckoutTimePicker(value);
      setFormData(prev => ({
        ...prev,
        hour_checkout: value
      }));
    }
    setHasChanges(true);
  };

  // Select workcenter from dropdown — auto-fills code + description
  const selectWorkcenter = (wc) => {
    setFormData(prev => ({
      ...prev,
      workcentercode: wc.code,
      workcenterdescription: wc.description
    }));
    setWorkcenterSearch(`${wc.description} — ${wc.code}`);
    setShowWorkcenterDropdown(false);
    setHasChanges(true);
  };

  // Build longdate string dari dd/mm/yyyy + HH:mm
  // Kirim sebagai string "YYYY-MM-DD HH:MM:00" tanpa timezone conversion
  // supaya PostgreSQL interpret sesuai session timezone (Asia/Makassar)
  const buildLongdate = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null;
    const [day, month, year] = dateStr.split('/');
    const [hour, min] = timeStr.replace('.', ':').split(':');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${min.padStart(2, '0')}:00`;
  };

  // Save changes via API
  const handleSave = async () => {
    if (!formData.date_checkin || !formData.hour_checkin) {
      alert('Check-in date dan time wajib diisi');
      return;
    }

    if (!formData.date_checkout || !formData.hour_checkout) {
      alert('Check-out date dan time wajib diisi');
      return;
    }

    if (!formData.workcentercode) {
      alert('Workcenter wajib dipilih');
      return;
    }

    // Check if duration = 0 → will set state_flag = 5 (Deleted)
    const duration = parseFloat(formData.duration || 0);
    if (duration === 0) {
      const confirmDelete = window.confirm(
        'Duration = 0 (Check-in dan Check-out sama).\nTimesheet ini akan ditandai sebagai "Deleted" (state_flag = 5).\n\nLanjutkan?'
      );
      if (!confirmDelete) return;
    } else {
      const confirmSave = window.confirm('Simpan perubahan timesheet ini?');
      if (!confirmSave) return;
    }

    setSaving(true);

    try {
      // Build longdate timestamps
      const longdate_checkin = buildLongdate(formData.date_checkin, formData.hour_checkin);
      const longdate_checkout = buildLongdate(formData.date_checkout, formData.hour_checkout);

      // Use updateTimesheetadmin for full update
      const body = {
        serialnumber: formData.serialnumber,
        full_name: formData.full_name,
        production_order: formData.production_order,
        ssbr_ident: formData.ssbr_ident,
        operation_text: formData.operation_text,
        seq: formData.seq,
        workcentercode: formData.workcentercode,
        workcenterdescription: formData.workcenterdescription,
        longdate_checkin,
        longdate_checkout
      };

      const res = await fetch(`${API_BASE}/timesheet/updateadmin/${tsnumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) throw new Error('Gagal save timesheet');

      // Now use partialUpdate for fields not in updateadmin (std_foreman_hours, note, state_flag)
      const patchBody = {};

      if (formData.note !== (originalData?.note || '')) {
        patchBody.note = formData.note;
      }

      const newStdForeman = formData.std_foreman_hours !== '' ? parseFloat(formData.std_foreman_hours) : null;
      const origStdForeman = originalData?.std_foreman_hours != null ? parseFloat(originalData.std_foreman_hours) : null;
      if (newStdForeman !== origStdForeman) {
        patchBody.std_foreman_hours = newStdForeman;
      }

      // Persist planhours from SOW into timesheet_transaction
      if (formData.planhours !== '' && formData.planhours !== (originalData?.planhours != null ? String(originalData.planhours) : '')) {
        patchBody.planhours = formData.planhours;
      } else if (formData.planhours !== '' && !originalData?.planhours) {
        patchBody.planhours = formData.planhours;
      }

      // Set state_flag = 5 when duration = 0
      if (duration === 0) {
        patchBody.state_flag = '5';
      }

      if (Object.keys(patchBody).length > 0) {
        const patchRes = await fetch(`${API_BASE}/timesheet/${tsnumber}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody)
        });

        if (!patchRes.ok) {
          console.error('Partial update failed');
        }
      }

      setHasChanges(false);
      navigate(returnUrl);
    } catch (err) {
      console.error('Error saving timesheet:', err);
      alert('Gagal menyimpan timesheet: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Cancel and go back
  const handleCancel = () => {
    if (hasChanges) {
      const confirmCancel = window.confirm('Ada perubahan yang belum disimpan. Yakin ingin kembali?');
      if (!confirmCancel) return;
    }
    navigate(returnUrl);
  };

  if (loading) {
    return (
      <div className="h-screen w-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-semibold text-blue-900">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Header - Dark Blue */}
      <header className="flex justify-between items-center bg-blue-900 px-3 py-2.5 shadow-md flex-shrink-0">
        <button
          onClick={handleCancel}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Cancel
        </button>
        <h2 className="text-base sm:text-lg font-bold text-white">Edit Timesheet</h2>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={`px-3 py-1.5 text-xs sm:text-sm font-medium text-white rounded transition-colors ${
            saving || !hasChanges
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-orange-500 hover:bg-orange-600'
          }`}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </header>

      {/* Form Content - Scrollable - White Background */}
      <div className="flex-1 overflow-y-auto px-3 py-4 bg-white">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* State Flag = 5 Warning */}
          {formData.state_flag === '5' && (
            <div className="bg-red-50 border border-red-300 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className="text-red-600 text-xl font-bold">X</span>
                <div>
                  <div className="text-sm font-semibold text-red-800">Deleted</div>
                  <div className="text-xs text-red-600">Timesheet ini ditandai sebagai Deleted (state_flag = 5)</div>
                </div>
              </div>
            </div>
          )}

          {/* Validation Status */}
          {formData.validation_date && (
            <div className="bg-green-50 border border-green-300 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className="text-green-600 text-xl font-bold">✓</span>
                <div>
                  <div className="text-sm font-semibold text-green-800">Validated</div>
                  <div className="text-xs text-green-600">
                    Validated on: {formData.validation_date || '-'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* General Information Section */}
          <div className="bg-blue-50 rounded-lg shadow-sm border border-blue-200 p-4">
            <h3 className="text-sm font-bold text-blue-900 mb-3">General Information</h3>

            <div className="space-y-3">
              {/* TS Number (Read-only) */}
              <div>
                <label className="block text-xs font-semibold text-blue-900 mb-1">
                  TS Number
                </label>
                <input
                  type="text"
                  value={formData.tsnumber}
                  disabled
                  className="w-full px-3 py-2 text-sm border border-blue-200 rounded bg-white text-gray-700 cursor-not-allowed"
                />
              </div>

              {/* Employee Info (Read-only) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1">
                    Serial Number
                  </label>
                  <input
                    type="text"
                    value={formData.serialnumber}
                    disabled
                    className="w-full px-3 py-2 text-sm border border-blue-200 rounded bg-white text-gray-700 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1">
                    Employee Name
                  </label>
                  <input
                    type="text"
                    value={formData.full_name}
                    disabled
                    className="w-full px-3 py-2 text-sm border border-blue-200 rounded bg-white text-gray-700 cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Production Order Info (Read-only) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1">
                    Production Order
                  </label>
                  <input
                    type="text"
                    value={formData.production_order}
                    disabled
                    className="w-full px-3 py-2 text-sm border border-blue-200 rounded bg-white text-gray-700 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1">
                    Ident
                  </label>
                  <input
                    type="text"
                    value={formData.ssbr_ident}
                    disabled
                    className="w-full px-3 py-2 text-sm border border-blue-200 rounded bg-white text-gray-700 cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Operation Text (Read-only) */}
              <div>
                <label className="block text-xs font-semibold text-blue-900 mb-1">
                  Operation
                </label>
                <textarea
                  value={formData.operation_text}
                  disabled
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-blue-200 rounded bg-white text-gray-700 cursor-not-allowed resize-none"
                />
              </div>

              {/* Workcenter - Searchable Dropdown */}
              <div ref={workcenterDropdownRef}>
                <label className="block text-xs font-semibold text-blue-900 mb-1">
                  Workcenter <span className="text-orange-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={workcenterSearch || formData.workcenterdescription}
                    onChange={(e) => {
                      setWorkcenterSearch(e.target.value);
                      setShowWorkcenterDropdown(true);
                    }}
                    onFocus={() => setShowWorkcenterDropdown(true)}
                    placeholder="Search workcenter..."
                    className="w-full px-3 py-2 text-sm text-gray-800 border border-blue-300 rounded focus:outline-none focus:border-blue-600 bg-white"
                  />

                  {/* Dropdown List */}
                  {showWorkcenterDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-blue-300 rounded shadow-lg max-h-60 overflow-y-auto">
                      {filteredWorkcenters.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-500">
                          No workcenter found
                        </div>
                      ) : (
                        filteredWorkcenters.map((wc, idx) => (
                          <div
                            key={idx}
                            onClick={() => selectWorkcenter(wc)}
                            className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b border-blue-100 last:border-b-0"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-blue-900">{wc.description}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                wc.type === 'OT' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                                {wc.type}
                              </span>
                            </div>
                            <div className="text-xs text-gray-600">{wc.code}</div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {formData.workcentercode && (
                  <div className="text-xs text-blue-700 mt-1">
                    Selected: {formData.workcenterdescription} — {formData.workcentercode}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Time Tracking Section */}
          <div className="bg-blue-50 rounded-lg shadow-sm border border-blue-200 p-4">
            <h3 className="text-sm font-bold text-blue-900 mb-3">Time Tracking</h3>

            <div className="space-y-3">
              {/* Check-in */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1">
                    Check-in Date <span className="text-orange-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={checkinDatePicker}
                    onChange={(e) => handleDatePickerChange('checkin', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-800 border border-blue-300 rounded focus:outline-none focus:border-blue-600 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1">
                    Check-in Time <span className="text-orange-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={checkinTimePicker}
                    onChange={(e) => handleTimePickerChange('checkin', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-800 border border-blue-300 rounded focus:outline-none focus:border-blue-600 bg-white"
                  />
                </div>
              </div>

              {/* Check-out */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1">
                    Check-out Date <span className="text-orange-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={checkoutDatePicker}
                    onChange={(e) => handleDatePickerChange('checkout', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-800 border border-blue-300 rounded focus:outline-none focus:border-blue-600 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1">
                    Check-out Time <span className="text-orange-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={checkoutTimePicker}
                    onChange={(e) => handleTimePickerChange('checkout', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-800 border border-blue-300 rounded focus:outline-none focus:border-blue-600 bg-white"
                  />
                </div>
              </div>

              {/* Duration + Plan Hours + Std Foreman Hours */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1">
                    Duration (hours)
                  </label>
                  <input
                    type="text"
                    value={formData.duration}
                    disabled
                    className={`w-full px-3 py-2 text-sm border rounded cursor-not-allowed font-bold ${
                      parseFloat(formData.duration || 0) === 0
                        ? 'border-red-300 bg-red-50 text-red-700'
                        : 'border-blue-200 bg-white text-blue-700'
                    }`}
                  />
                  {parseFloat(formData.duration || 0) === 0 && formData.date_checkout && (
                    <div className="text-[10px] text-red-600 mt-0.5 font-medium">
                      Duration = 0, akan ditandai sebagai Deleted
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1">
                    Plan Hours <span className="text-[10px] font-normal text-gray-500">(SOW)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.planhours}
                    disabled
                    className="w-full px-3 py-2 text-sm border border-blue-200 rounded bg-white text-gray-700 cursor-not-allowed font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1">
                    Std Foreman Hours
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={formData.std_foreman_hours}
                    onChange={(e) => handleInputChange('std_foreman_hours', e.target.value)}
                    onKeyDown={(e) => {
                      // Block non-numeric keys except control keys
                      if (
                        !/[0-9.]/.test(e.key) &&
                        !['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)
                      ) {
                        e.preventDefault();
                      }
                      // Prevent multiple dots
                      if (e.key === '.' && e.target.value.includes('.')) {
                        e.preventDefault();
                      }
                    }}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm text-gray-800 border border-blue-300 rounded focus:outline-none focus:border-blue-600 bg-white"
                  />
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-semibold text-blue-900 mb-1">
                  Note
                </label>
                <textarea
                  value={formData.note || ''}
                  onChange={(e) => handleInputChange('note', e.target.value)}
                  placeholder="Add note..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm text-gray-800 border border-blue-300 rounded focus:outline-none focus:border-blue-600 resize-none bg-white"
                />
              </div>
            </div>
          </div>

          {/* Change Indicator */}
          {hasChanges && (
            <div className="bg-orange-50 border border-orange-300 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className="text-orange-600 text-lg">!</span>
                <div className="text-xs text-orange-800 font-semibold">
                  You have unsaved changes
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TimesheetEditPage;
