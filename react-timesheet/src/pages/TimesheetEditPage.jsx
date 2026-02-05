import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

/**
 * Timesheet Edit Page
 * Converted dari tsuyeedit.html
 * Edit timesheet record dengan searchable workcenter dropdown
 */
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
    tsstatus: '',
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

  // Filter workcenters based on search
  useEffect(() => {
    if (workcenterSearch.trim() === '') {
      setFilteredWorkcenters(workcenters);
    } else {
      const query = workcenterSearch.toLowerCase();
      const filtered = workcenters.filter(wc =>
        wc.workcentercode.toLowerCase().includes(query) ||
        wc.workcenterdescription.toLowerCase().includes(query)
      );
      setFilteredWorkcenters(filtered);
    }
  }, [workcenterSearch, workcenters]);

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

  // API: Load timesheet data
  const loadTimesheetData = async () => {
    setLoading(true);

    // NOTE: Untuk development, load dari dummy data dulu
    // Untuk production, uncomment code dibawah dan comment load dummy data

    /* PRODUCTION CODE - Uncomment untuk production
    try {
      const res = await fetch(`/timesheet/${tsnumber}`);
      if (!res.ok) {
        throw new Error('Gagal load timesheet data dari API');
      }
      const data = await res.json();

      if (data) {
        setFormData(data);
        setOriginalData(data);
        setLoading(false);
        return;
      } else {
        throw new Error('Data kosong dari API');
      }
    } catch (err) {
      console.error('Error loading timesheet from API:', err);
      // Fallback to dummy data jika API gagal
    }
    */

    // DEVELOPMENT MODE - Load dummy data langsung
    try {
      console.log('Loading dummy timesheet data for edit...');
      const dummyResponse = await fetch('/dummy-validation-timesheets.json');
      if (dummyResponse.ok) {
        const dummyData = await dummyResponse.json();
        const record = dummyData.find(item => item.tsnumber === tsnumber);

        if (record) {
          setFormData(record);
          setOriginalData(record);

          // Initialize date/time pickers with converted values
          setCheckinDatePicker(ddmmyyyyToYyyymmdd(record.date_checkin));
          setCheckinTimePicker(formatTime(record.hour_checkin));
          setCheckoutDatePicker(ddmmyyyyToYyyymmdd(record.date_checkout));
          setCheckoutTimePicker(formatTime(record.hour_checkout));
        } else {
          alert('❌ Timesheet tidak ditemukan');
          navigate(returnUrl);
        }
      } else {
        throw new Error('Dummy data tidak tersedia');
      }
    } catch (dummyError) {
      console.error('Error loading dummy data:', dummyError);
      alert('❌ Gagal load data');
      navigate(returnUrl);
    } finally {
      setLoading(false);
    }
  };

  // API: Load workcenters for dropdown
  const loadWorkcenters = async () => {
    // NOTE: Untuk development, load dari dummy data dulu
    // Untuk production, uncomment code dibawah dan comment load dummy data

    /* PRODUCTION CODE - Uncomment untuk production
    try {
      const res = await fetch('/workcenterkk');
      if (!res.ok) {
        throw new Error('Gagal load workcenter dari API');
      }
      const data = await res.json();

      if (data && data.length > 0) {
        setWorkcenters(data);
        setFilteredWorkcenters(data);
        return;
      } else {
        throw new Error('Data workcenter kosong dari API');
      }
    } catch (err) {
      console.error('Error loading workcenters from API:', err);
      // Fallback to dummy data jika API gagal
    }
    */

    // DEVELOPMENT MODE - Load dummy data langsung
    try {
      const dummyResponse = await fetch('/dummy-workcenters.json');
      if (dummyResponse.ok) {
        const dummyData = await dummyResponse.json();
        setWorkcenters(dummyData);
        setFilteredWorkcenters(dummyData);
      } else {
        throw new Error('Dummy workcenter data tidak tersedia');
      }
    } catch (dummyError) {
      console.error('Error loading dummy workcenters:', dummyError);
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

  // Helper: Convert HH:mm to hh:mm (already same format)
  const formatTime = (time) => {
    if (!time) return '';
    return time; // HH:mm format is same
  };

  // Calculate duration from check-in and check-out
  const calculateDuration = () => {
    const { date_checkin, hour_checkin, date_checkout, hour_checkout } = formData;

    if (!date_checkin || !hour_checkin || !date_checkout || !hour_checkout) {
      return;
    }

    try {
      // Parse dates
      const [dayIn, monthIn, yearIn] = date_checkin.split('/');
      const [hourIn, minIn] = hour_checkin.split(':');
      const checkinDate = new Date(yearIn, monthIn - 1, dayIn, hourIn, minIn);

      const [dayOut, monthOut, yearOut] = date_checkout.split('/');
      const [hourOut, minOut] = hour_checkout.split(':');
      const checkoutDate = new Date(yearOut, monthOut - 1, dayOut, hourOut, minOut);

      // Calculate difference in hours
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
    // Convert yyyy-MM-dd to dd/mm/yyyy
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
    // HH:mm format is same
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

  // Select workcenter from dropdown
  const selectWorkcenter = (workcenter) => {
    setFormData(prev => ({
      ...prev,
      workcentercode: workcenter.workcentercode,
      workcenterdescription: workcenter.workcenterdescription
    }));
    setWorkcenterSearch(workcenter.workcenterdescription);
    setShowWorkcenterDropdown(false);
    setHasChanges(true);
  };

  // Save changes
  const handleSave = async () => {
    // Validation
    if (!formData.date_checkin || !formData.hour_checkin) {
      alert('⚠️ Check-in date dan time wajib diisi');
      return;
    }

    if (!formData.date_checkout || !formData.hour_checkout) {
      alert('⚠️ Check-out date dan time wajib diisi');
      return;
    }

    if (!formData.workcentercode) {
      alert('⚠️ Workcenter wajib dipilih');
      return;
    }

    const confirmSave = window.confirm('Simpan perubahan timesheet ini?');
    if (!confirmSave) return;

    setSaving(true);

    /* PRODUCTION CODE - Uncomment untuk production
    try {
      const res = await fetch(`/timesheet/${tsnumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!res.ok) {
        throw new Error('Gagal save timesheet');
      }

      await res.json();
      alert('✅ Timesheet berhasil disimpan');
      setHasChanges(false);
      navigate(returnUrl);
    } catch (err) {
      console.error('Error saving timesheet:', err);
      alert('❌ Gagal menyimpan timesheet');
    } finally {
      setSaving(false);
    }
    */

    // DEVELOPMENT MODE - Simulate save
    setTimeout(() => {
      console.log('Simulated save:', formData);
      alert('✅ Timesheet berhasil disimpan (DUMMY MODE)');
      setHasChanges(false);
      setSaving(false);
      navigate(returnUrl);
    }, 1000);
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
          {/* Validation Status */}
          {formData.tsstatus === 'V' && (
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

          {/* General Information Section - Light Blue Background */}
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
                            <div className="font-semibold text-blue-900">
                              {wc.workcentercode}
                            </div>
                            <div className="text-xs text-gray-600">
                              {wc.workcenterdescription}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {formData.workcentercode && (
                  <div className="text-xs text-blue-700 mt-1">
                    Selected: {formData.workcentercode}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Time Tracking Section - Light Blue Background */}
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

              {/* Duration (Auto-calculated) */}
              <div>
                <label className="block text-xs font-semibold text-blue-900 mb-1">
                  Duration (hours)
                </label>
                <input
                  type="text"
                  value={formData.duration}
                  disabled
                  className="w-full px-3 py-2 text-sm border border-blue-200 rounded bg-white cursor-not-allowed font-bold text-blue-700"
                />
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

          {/* Change Indicator - Orange Accent */}
          {hasChanges && (
            <div className="bg-orange-50 border border-orange-300 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className="text-orange-600 text-lg">⚠️</span>
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
