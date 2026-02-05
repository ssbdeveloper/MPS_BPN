import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Edit Parameter Page
 * Converted from editparameter.html with improvements
 * Features:
 * - Left side: Table with BySN/ByWCT filter buttons
 * - Right side: Edit form for process control items
 * - Role-based validation (Accept/Reject for FOREMAN)
 * - Validation before save
 * - Color scheme: White 65%, Blue 25%, Orange 10% (CTA only)
 */
const EditParameterPage = () => {
  const navigate = useNavigate();

  // States
  const [filterMode, setFilterMode] = useState('SN'); // 'SN' or 'WCT'
  const [processData, setProcessData] = useState([]);
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [formData, setFormData] = useState({
    item: '',
    value: '',
    uom: '',
    validation_status: '',
    validation_by: ''
  });
  const [isForeman, setIsForeman] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load user role from sessionStorage
  useEffect(() => {
    const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
    if (datakaryawan && datakaryawan.role === 'FOREMAN') {
      setIsForeman(true);
    }
  }, []);

  // Load process control data by filter
  const loadProcessControlData = async (mode) => {
    setLoading(true);
    setFilterMode(mode);
    setSelectedProcess(null);
    setFormData({
      item: '',
      value: '',
      uom: '',
      validation_status: '',
      validation_by: ''
    });

    try {
      // PRODUCTION: Uncomment this
      // const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
      // const endpoint = mode === 'SN'
      //   ? `/process-control/by-sn/${datakaryawan.snssb}`
      //   : `/process-control/by-workcenter/${datakaryawan.workcenter}`;
      // const response = await fetch(endpoint);
      // const data = await response.json();
      // setProcessData(data);

      // DEVELOPMENT: Dummy data
      const dummyData = mode === 'SN' ? [
        {
          id: 1,
          tsnumber: 'TS-2024-001',
          production_order: 'PO-12345',
          item: 'Temperature',
          value: '185',
          uom: '°C',
          validation_status: 'PENDING',
          validation_by: ''
        },
        {
          id: 2,
          tsnumber: 'TS-2024-001',
          production_order: 'PO-12345',
          item: 'Pressure',
          value: '45',
          uom: 'PSI',
          validation_status: 'ACCEPTED',
          validation_by: 'John Supervisor'
        },
        {
          id: 3,
          tsnumber: 'TS-2024-002',
          production_order: 'PO-12346',
          item: 'Speed',
          value: '1200',
          uom: 'RPM',
          validation_status: 'PENDING',
          validation_by: ''
        }
      ] : [
        {
          id: 4,
          tsnumber: 'TS-2024-003',
          production_order: 'PO-12347',
          item: 'Temperature',
          value: '190',
          uom: '°C',
          validation_status: 'REJECTED',
          validation_by: 'Jane Manager'
        },
        {
          id: 5,
          tsnumber: 'TS-2024-004',
          production_order: 'PO-12348',
          item: 'Humidity',
          value: '65',
          uom: '%',
          validation_status: 'PENDING',
          validation_by: ''
        }
      ];
      setProcessData(dummyData);
    } catch (err) {
      console.error('Error loading data:', err);
      alert('❌ Gagal memuat data');
    } finally {
      setLoading(false);
    }
  };

  // Initial load with SN filter
  useEffect(() => {
    loadProcessControlData('SN');
  }, []);

  // Handle row selection
  const handleSelectRow = (process) => {
    if (hasChanges) {
      if (!window.confirm('Ada perubahan yang belum disimpan. Lanjutkan?')) {
        return;
      }
    }
    setSelectedProcess(process);
    setFormData({
      item: process.item,
      value: process.value,
      uom: process.uom,
      validation_status: process.validation_status,
      validation_by: process.validation_by
    });
    setHasChanges(false);
  };

  // Handle form input change
  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  // Validate form before save
  const validateForm = () => {
    if (!formData.item.trim()) {
      alert('⚠️ Item tidak boleh kosong');
      return false;
    }
    if (!formData.value.trim()) {
      alert('⚠️ Value tidak boleh kosong');
      return false;
    }
    if (!formData.uom.trim()) {
      alert('⚠️ UOM tidak boleh kosong');
      return false;
    }
    return true;
  };

  // Save changes
  const handleSave = async () => {
    if (!selectedProcess) {
      alert('⚠️ Pilih data process control terlebih dahulu');
      return;
    }

    if (!validateForm()) {
      return;
    }

    try {
      // PRODUCTION: Uncomment this
      // const response = await fetch(`/process-control/${selectedProcess.id}`, {
      //   method: 'PUT',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     item: formData.item,
      //     value: formData.value,
      //     uom: formData.uom
      //   })
      // });
      // if (!response.ok) throw new Error('Gagal update');

      // DEVELOPMENT: Simulate success
      console.log('Saving:', formData);

      // Update local state
      setProcessData(prev => prev.map(p =>
        p.id === selectedProcess.id
          ? { ...p, item: formData.item, value: formData.value, uom: formData.uom }
          : p
      ));

      alert('✅ Data berhasil diupdate');
      setHasChanges(false);
    } catch (err) {
      console.error('Error saving:', err);
      alert('❌ Gagal menyimpan data');
    }
  };

  // Handle validation (Accept/Reject)
  const handleValidation = async (status) => {
    if (!selectedProcess) {
      alert('⚠️ Pilih data process control terlebih dahulu');
      return;
    }

    if (!isForeman) {
      alert('⚠️ Hanya FOREMAN yang dapat melakukan validasi');
      return;
    }

    try {
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));

      // PRODUCTION: Uncomment this
      // const response = await fetch(`/process-control/validate/${selectedProcess.id}`, {
      //   method: 'PATCH',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     validation_by: datakaryawan.full_name,
      //     validation_status: status
      //   })
      // });
      // if (!response.ok) throw new Error('Gagal validasi');

      // DEVELOPMENT: Simulate success
      console.log('Validating:', status);

      // Update local state
      setProcessData(prev => prev.map(p =>
        p.id === selectedProcess.id
          ? { ...p, validation_status: status, validation_by: datakaryawan?.full_name || 'Foreman' }
          : p
      ));

      setFormData(prev => ({
        ...prev,
        validation_status: status,
        validation_by: datakaryawan?.full_name || 'Foreman'
      }));

      alert(`✅ Process control ${status}`);
    } catch (err) {
      console.error('Error validating:', err);
      alert('❌ Gagal validasi data');
    }
  };

  // Get status color
  const getStatusColor = (status) => {
    switch (status) {
      case 'ACCEPTED': return 'bg-green-100 text-green-800';
      case 'REJECTED': return 'bg-red-100 text-red-800';
      case 'PENDING': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Header - Dark Blue */}
      <header className="flex justify-between items-center bg-blue-900 px-4 py-3 shadow-md flex-shrink-0">
        <button
          onClick={() => navigate('/timesheet-mainmenu')}
          className="px-4 py-2 text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold text-white">Edit Parameter</h1>
        <div className="w-20"></div> {/* Spacer for centering */}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row gap-3 p-3 overflow-hidden">
        {/* Left Side - Table */}
        <section className="flex-1 bg-blue-50 rounded-lg shadow-md border border-blue-200 p-3 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 mb-3">
            <h2 className="text-base font-bold text-blue-900 mb-2">Process Control Data</h2>

            {/* Filter Buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => loadProcessControlData('SN')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded transition-colors ${
                  filterMode === 'SN'
                    ? 'bg-blue-700 text-white'
                    : 'bg-white text-blue-900 border border-blue-300 hover:bg-blue-100'
                }`}
              >
                By Serial Number
              </button>
              <button
                onClick={() => loadProcessControlData('WCT')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded transition-colors ${
                  filterMode === 'WCT'
                    ? 'bg-blue-700 text-white'
                    : 'bg-white text-blue-900 border border-blue-300 hover:bg-blue-100'
                }`}
              >
                By Workcenter
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-blue-900">Loading...</p>
              </div>
            ) : processData.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-600">Tidak ada data</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-blue-700 text-white">
                  <tr>
                    <th className="px-2 py-2 text-left">TS Number</th>
                    <th className="px-2 py-2 text-left">Order</th>
                    <th className="px-2 py-2 text-left">Item</th>
                    <th className="px-2 py-2 text-left">Value</th>
                    <th className="px-2 py-2 text-left">UOM</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Validated By</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {processData.map((process) => (
                    <tr
                      key={process.id}
                      onClick={() => handleSelectRow(process)}
                      className={`border-b border-blue-200 cursor-pointer hover:bg-blue-100 transition-colors ${
                        selectedProcess?.id === process.id ? 'bg-blue-200' : ''
                      }`}
                    >
                      <td className="px-2 py-2">{process.tsnumber}</td>
                      <td className="px-2 py-2">{process.production_order}</td>
                      <td className="px-2 py-2">{process.item}</td>
                      <td className="px-2 py-2">{process.value}</td>
                      <td className="px-2 py-2">{process.uom}</td>
                      <td className="px-2 py-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(process.validation_status)}`}>
                          {process.validation_status}
                        </span>
                      </td>
                      <td className="px-2 py-2">{process.validation_by || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Right Side - Edit Form */}
        <section className="flex-1 bg-blue-50 rounded-lg shadow-md border border-blue-200 p-4 flex flex-col overflow-auto">
          <h2 className="text-base font-bold text-blue-900 mb-3">Edit Process Control</h2>

          {!selectedProcess ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-600 text-center">
                Pilih data dari tabel untuk mengedit
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Item */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-blue-900">Item</label>
                <input
                  type="text"
                  value={formData.item}
                  onChange={(e) => handleInputChange('item', e.target.value)}
                  className="px-3 py-2 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Temperature"
                />
              </div>

              {/* Value */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-blue-900">Value</label>
                <input
                  type="text"
                  value={formData.value}
                  onChange={(e) => handleInputChange('value', e.target.value)}
                  className="px-3 py-2 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 185"
                />
              </div>

              {/* UOM */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-blue-900">UOM (Unit of Measure)</label>
                <input
                  type="text"
                  value={formData.uom}
                  onChange={(e) => handleInputChange('uom', e.target.value)}
                  className="px-3 py-2 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., °C"
                />
              </div>

              {/* Validation Status (Read-only) */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-blue-900">Validation Status</label>
                <div className="px-3 py-2 text-sm bg-gray-100 border border-blue-300 rounded">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(formData.validation_status)}`}>
                    {formData.validation_status}
                  </span>
                </div>
              </div>

              {/* Validated By (Read-only) */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-blue-900">Validated By</label>
                <div className="px-3 py-2 text-sm bg-gray-100 border border-blue-300 rounded">
                  {formData.validation_by || '-'}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 pt-4 border-t border-blue-200">
                {/* Save Button - Orange CTA */}
                <button
                  onClick={handleSave}
                  disabled={!hasChanges}
                  className={`w-full px-4 py-3 text-sm font-bold rounded shadow-md transition-all ${
                    hasChanges
                      ? 'bg-gradient-to-b from-orange-500 to-orange-600 text-white hover:from-orange-600 hover:to-orange-700'
                      : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                  }`}
                >
                  💾 Save Changes
                </button>

                {/* Validation Buttons - Only for FOREMAN */}
                {isForeman && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleValidation('ACCEPTED')}
                      className="flex-1 px-4 py-2 text-sm font-bold bg-gradient-to-b from-green-500 to-green-600 text-white rounded shadow-md hover:from-green-600 hover:to-green-700 transition-all"
                    >
                      ✅ Accept
                    </button>
                    <button
                      onClick={() => handleValidation('REJECTED')}
                      className="flex-1 px-4 py-2 text-sm font-bold bg-gradient-to-b from-red-500 to-red-600 text-white rounded shadow-md hover:from-red-600 hover:to-red-700 transition-all"
                    >
                      ❌ Reject
                    </button>
                  </div>
                )}
              </div>

              {/* Info for non-Foreman users */}
              {!isForeman && (
                <div className="mt-2 p-3 bg-blue-100 rounded border border-blue-300">
                  <p className="text-xs text-blue-900">
                    ℹ️ Hanya FOREMAN yang dapat melakukan validasi Accept/Reject
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default EditParameterPage;
