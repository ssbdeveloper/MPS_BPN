import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PasswordPrompt from '../components/auth/PasswordPrompt';

/**
 * Create/Edit NFC User Page
 * Converted from usernfc-create.html with improvements
 * Features:
 * - Password protection (12345)
 * - Dual mode: Create new or Edit existing user
 * - NFC ID simulation
 * - Required field validation
 * - Duplicate NFC ID detection
 * - Color scheme: White 65%, Blue 25%, Orange 10%
 */
const API_BASE = import.meta.env.VITE_API_URL || '';

const CreateEditNfcPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Mode detection
  const editNfcId = searchParams.get('edit');
  const mode = editNfcId ? 'edit' : 'create';

  // States
  const [nfcid, setNfcid] = useState('');
  const [formData, setFormData] = useState({
    full_name: '',
    snssb: '',
    machineid: '',
    machinename: '',
    workcenter: '',
    roles: ''
  });
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });
  const [isSaving, setIsSaving] = useState(false);

  // Workcenter dropdown states
  const [allWorkcenters, setAllWorkcenters] = useState([]);
  const [wcSearch, setWcSearch] = useState('');
  const [showWcDropdown, setShowWcDropdown] = useState(false);
  const wcDropdownRef = React.useRef(null);

  // Load existing user data in edit mode
  useEffect(() => {
    if (mode === 'edit' && editNfcId) {
      loadUserData(editNfcId);
    }
    loadWorkcenters();
  }, [mode, editNfcId]);

  // Close workcenter dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wcDropdownRef.current && !wcDropdownRef.current.contains(event.target)) {
        setShowWcDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load workcenters from API
  const loadWorkcenters = async () => {
    try {
      const res = await fetch(`${API_BASE}/workcenter`);
      const data = await res.json();
      setAllWorkcenters(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading workcenters:', err);
    }
  };

  // Build flat workcenter options (Normal + OT)
  const workcenterOptions = React.useMemo(() => {
    const options = [];
    for (const wc of allWorkcenters) {
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
  }, [allWorkcenters]);

  // Filtered workcenters
  const filteredWcOptions = React.useMemo(() => {
    if (wcSearch.trim() === '') return workcenterOptions;
    const q = wcSearch.toLowerCase();
    return workcenterOptions.filter(wc =>
      wc.code.toLowerCase().includes(q) ||
      wc.description.toLowerCase().includes(q)
    );
  }, [wcSearch, workcenterOptions]);

  // Select workcenter → auto-fill machineid, machinename (description), workcenter (code)
  const selectWorkcenter = (wc) => {
    setFormData(prev => ({
      ...prev,
      machineid: wc.machineid,
      machinename: wc.description,
      workcenter: wc.code
    }));
    setWcSearch(`${wc.description} — ${wc.code}`);
    setShowWcDropdown(false);
  };

  // Load user data for editing
  const loadUserData = async (nfcIdToLoad) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/usernfc/nfcid/${nfcIdToLoad}`);
      if (!response.ok) throw new Error('User not found');
      const data = await response.json();

      if (!data) {
        showStatus('error', '❌ User tidak ditemukan');
        setTimeout(() => navigate('/nfc-users'), 2000);
        return;
      }

      setNfcid(data.nfcid);
      setFormData({
        full_name: data.full_name || '',
        snssb: data.snssb || '',
        machineid: data.machineid || '',
        machinename: data.machinename || '',
        workcenter: data.workcenter || '',
        roles: data.roles || ''
      });
    } catch (err) {
      console.error('Error loading user data:', err);
      showStatus('error', '❌ Gagal memuat data user');
    } finally {
      setLoading(false);
    }
  };

  // Generate random NFC ID (for testing without NFC hardware)
  const generateNfcId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = 'NFC';
    for (let i = 0; i < 9; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNfcid(id);
  };

  // Extract NFC ID from NDEFReader event
  const extractNfcId = (event) => {
    // Method 1: Try serialNumber first (most common format)
    if (event.serialNumber && event.serialNumber.trim()) {
      return event.serialNumber.trim();
    }

    // Method 2: Try text record (fallback for NDEF-formatted cards)
    const records = event.message?.records || [];
    for (const record of records) {
      if (record.recordType === 'text') {
        try {
          const decoder = new TextDecoder(record.encoding || 'utf-8');
          return decoder.decode(record.data).trim();
        } catch (err) {
          console.error('Error decoding NFC text record:', err);
        }
      }
    }

    return '';
  };

  // Handle real NFC scanning
  const handleNfcScan = async () => {
    // Check browser support for Web NFC API
    if (!('NDEFReader' in window)) {
      showStatus('error', '❌ Browser tidak mendukung Web NFC. Gunakan Chrome di Android.');
      return;
    }

    try {
      const reader = new NDEFReader();

      // Request permission and start scanning
      await reader.scan();
      showStatus('success', '📱 Scanning... Tempelkan kartu NFC');

      // Listen for NFC card detection
      reader.onreading = (event) => {
        const scannedId = extractNfcId(event);

        if (!scannedId) {
          showStatus('error', '❌ Gagal membaca NFC ID dari kartu');
          return;
        }

        // Populate NFC ID field
        setNfcid(scannedId);
        showStatus('success', `✅ NFC ID berhasil dibaca: ${scannedId}`);
      };

      // Handle errors during reading
      reader.onerror = (event) => {
        console.error('NFC reading error:', event);
        showStatus('error', '❌ Error saat membaca NFC');
      };

    } catch (err) {
      console.error('NFC scan error:', err);

      // Provide specific error messages based on error type
      if (err.name === 'NotAllowedError') {
        showStatus('error', '❌ Izin NFC ditolak. Mohon izinkan akses NFC.');
      } else if (err.name === 'NotSupportedError') {
        showStatus('error', '❌ NFC tidak didukung di perangkat ini.');
      } else if (err.name === 'NotReadableError') {
        showStatus('error', '❌ NFC tidak dapat dibaca. Periksa hardware NFC.');
      } else if (err.name === 'InvalidStateError') {
        showStatus('error', '❌ NFC dalam state invalid. Coba lagi.');
      } else {
        showStatus('error', `❌ Gagal scan NFC: ${err.message}`);
      }
    }
  };

  // Show status message
  const showStatus = (type, text) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage({ type: '', text: '' });
    }, 5000);
  };

  // Handle form input change
  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Validate form
  const validateForm = () => {
    if (!nfcid.trim()) {
      showStatus('error', '⚠️ NFC ID tidak boleh kosong');
      return false;
    }
    if (!formData.full_name.trim()) {
      showStatus('error', '⚠️ Full Name tidak boleh kosong');
      return false;
    }
    if (!formData.snssb.trim()) {
      showStatus('error', '⚠️ SNSSB tidak boleh kosong');
      return false;
    }
    return true;
  };

  // Check if NFC ID already exists
  const checkNfcExists = async (nfcIdToCheck) => {
    try {
      const response = await fetch(`${API_BASE}/usernfc/nfcid/${nfcIdToCheck}`);
      return response.ok;
    } catch (err) {
      console.error('Error checking NFC ID:', err);
      return false;
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSaving(true);

    try {
      const payload = {
        nfcid: nfcid.trim(),
        full_name: formData.full_name.trim(),
        snssb: formData.snssb.trim(),
        machineid: formData.machineid.trim(),
        machinename: formData.machinename.trim(),
        workcenter: formData.workcenter.trim(),
        roles: formData.roles.trim()
      };

      if (mode === 'create') {
        // Check if NFC ID already exists
        const exists = await checkNfcExists(nfcid.trim());

        if (exists) {
          // NFC exists, update instead
          const response = await fetch(`${API_BASE}/usernfc/nfcedit/${nfcid.trim()}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!response.ok) throw new Error('Failed to update');

          showStatus('success', '✅ User sudah ada, data berhasil diupdate');
        } else {
          // NFC doesn't exist, create new
          const response = await fetch(`${API_BASE}/usernfc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!response.ok) throw new Error('Failed to create');

          showStatus('success', '✅ User berhasil dibuat');
        }
      } else {
        // Edit mode - update existing user
        const response = await fetch(`${API_BASE}/usernfc/nfcedit/${nfcid.trim()}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to update');

        showStatus('success', '✅ User berhasil diupdate');
      }

      // Redirect to list page after 1 second
      setTimeout(() => {
        navigate('/nfc-users');
      }, 1000);
    } catch (err) {
      console.error('Error saving user:', err);
      showStatus('error', '❌ Gagal menyimpan data user');
      setIsSaving(false);
    }
  };

  return (
    <PasswordPrompt password="12345">
      <div className="min-h-screen w-screen bg-white flex flex-col overflow-auto">
        {/* Header - Dark Blue */}
        <header className="flex justify-between items-center bg-blue-900 px-4 py-3 shadow-md sticky top-0 z-10">
          <button
            onClick={() => navigate('/nfc-users')}
            className="px-4 py-2 text-sm font-medium bg-blue-700 text-white rounded shadow-lg hover:shadow-xl active:shadow-sm active:translate-y-1 transition-all duration-150 transform"
            style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
          >
            ← Back
          </button>
          <h1 className="text-lg font-bold text-white">
            {mode === 'edit' ? 'Edit NFC User' : 'Create NFC User'}
          </h1>
          <div className="w-20"></div> {/* Spacer */}
        </header>

        {/* Status Message */}
        {statusMessage.text && (
          <div className={`px-4 py-3 text-sm font-medium text-center ${
            statusMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {statusMessage.text}
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 p-4 max-w-4xl mx-auto w-full">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="animate-spin w-12 h-12 border-4 border-blue-900 border-t-transparent rounded-full mx-auto mb-3"></div>
                <p className="text-blue-900 font-medium">Loading...</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* NFC Scan Section */}
              <section className="bg-blue-50 rounded-lg shadow-md border border-blue-200 p-4">
                <h2 className="text-base font-bold text-blue-900 mb-3">📱 NFC Scan Section</h2>

                {/* NFC ID Display Box */}
                <div className="bg-gradient-to-br from-blue-900 to-blue-700 rounded-lg p-6 mb-3 text-center">
                  <div className="text-xs text-blue-200 mb-1">NFC ID</div>
                  <div className="text-2xl font-mono font-bold text-white tracking-wider">
                    {nfcid || 'NO ID'}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  {/* Primary: Real NFC Scan Button */}
                  <button
                    type="button"
                    onClick={handleNfcScan}
                    disabled={mode === 'edit'}
                    className={`flex-1 px-4 py-3 text-sm font-bold rounded transition-all duration-150 transform ${
                      mode === 'edit'
                        ? 'bg-gray-300 text-gray-600 cursor-not-allowed shadow-sm'
                        : 'bg-gradient-to-b from-blue-700 to-blue-800 text-white hover:from-blue-800 hover:to-blue-900 shadow-lg hover:shadow-xl active:shadow-md active:translate-y-1'
                    }`}
                    style={mode !== 'edit' ? { boxShadow: '0 6px 12px -2px rgba(37, 99, 235, 0.4), 0 4px 6px -1px rgba(0, 0, 0, 0.3)' } : {}}
                  >
                    📱 Scan NFC Card
                  </button>

                  {/* Secondary: Generate Test ID (Fallback for devices without NFC) */}
                  <button
                    type="button"
                    onClick={generateNfcId}
                    disabled={mode === 'edit'}
                    className={`flex-1 px-4 py-3 text-sm font-medium rounded transition-all duration-150 transform ${
                      mode === 'edit'
                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-sm'
                        : 'bg-gray-200 text-gray-800 hover:bg-gray-300 shadow-lg hover:shadow-xl active:shadow-md active:translate-y-1'
                    }`}
                    style={mode !== 'edit' ? { boxShadow: '0 6px 12px -2px rgba(0, 0, 0, 0.15), 0 4px 6px -1px rgba(0, 0, 0, 0.2)' } : {}}
                  >
                    🎲 Generate Test ID
                  </button>

                  {/* Manual NFC ID Input */}
                  <div className="flex-1">
                    <input
                      type="text"
                      value={nfcid}
                      onChange={(e) => setNfcid(e.target.value.toUpperCase())}
                      disabled={mode === 'edit'}
                      className={`w-full px-4 py-3 text-sm font-mono bg-white border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        mode === 'edit' ? 'bg-gray-100 cursor-not-allowed' : ''
                      }`}
                      placeholder="Or enter manually"
                    />
                  </div>
                </div>

                {mode === 'edit' && (
                  <div className="mt-2 p-2 bg-blue-100 rounded border border-blue-300">
                    <p className="text-xs text-blue-900">
                      ℹ️ NFC ID tidak dapat diubah saat mengedit user. Scan dan generate ID dinonaktifkan.
                    </p>
                  </div>
                )}
              </section>

              {/* User Information Section */}
              <section className="bg-blue-50 rounded-lg shadow-md border border-blue-200 p-4">
                <h2 className="text-base font-bold text-blue-900 mb-3">👤 User Information</h2>

                <div className="space-y-3">
                  {/* Full Name - Required */}
                  <div>
                    <label className="block text-sm font-medium text-blue-900 mb-1">
                      Full Name <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.full_name}
                      onChange={(e) => handleInputChange('full_name', e.target.value)}
                      className="w-full px-4 py-2 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., Budi Santoso"
                      required
                    />
                  </div>

                  {/* SNSSB - Required */}
                  <div>
                    <label className="block text-sm font-medium text-blue-900 mb-1">
                      SNSSB (Serial Number) <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.snssb}
                      onChange={(e) => handleInputChange('snssb', e.target.value)}
                      className="w-full px-4 py-2 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., EMP001"
                      required
                    />
                  </div>
                </div>
              </section>

              {/* Machine Assignment Section */}
              <section className="bg-blue-50 rounded-lg shadow-md border border-blue-200 p-4">
                <h2 className="text-base font-bold text-blue-900 mb-3">🏭 Machine Assignment (Optional)</h2>

                <div className="space-y-3">
                  {/* Workcenter Dropdown — pilih satu, auto-fill 3 field */}
                  <div ref={wcDropdownRef}>
                    <label className="block text-sm font-medium text-blue-900 mb-1">
                      Pilih Workcenter
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={wcSearch || (formData.workcenter ? `${formData.machinename} — ${formData.workcenter}` : '')}
                        onChange={(e) => {
                          setWcSearch(e.target.value);
                          setShowWcDropdown(true);
                        }}
                        onFocus={() => setShowWcDropdown(true)}
                        placeholder="Search workcenter..."
                        className="w-full px-4 py-2 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {showWcDropdown && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-blue-300 rounded shadow-lg max-h-60 overflow-y-auto">
                          {filteredWcOptions.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-500">No workcenter found</div>
                          ) : (
                            filteredWcOptions.map((wc, idx) => (
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
                  </div>

                  {/* Auto-filled fields (read-only) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-blue-900 mb-1">Machine ID</label>
                      <input
                        type="text"
                        value={formData.machineid}
                        disabled
                        className="w-full px-3 py-2 text-sm bg-gray-50 border border-blue-200 rounded text-gray-700 cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-blue-900 mb-1">Description</label>
                      <input
                        type="text"
                        value={formData.machinename}
                        disabled
                        className="w-full px-3 py-2 text-sm bg-gray-50 border border-blue-200 rounded text-gray-700 cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-blue-900 mb-1">Workcenter Code</label>
                      <input
                        type="text"
                        value={formData.workcenter}
                        disabled
                        className="w-full px-3 py-2 text-sm bg-gray-50 border border-blue-200 rounded text-gray-700 cursor-not-allowed"
                      />
                    </div>
                  </div>

                  {/* Role */}
                  <div>
                    <label className="block text-sm font-medium text-blue-900 mb-1">
                      Role
                    </label>
                    <select
                      value={formData.roles}
                      onChange={(e) => handleInputChange('roles', e.target.value)}
                      className="w-full px-4 py-2 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Select Role --</option>
                      <option value="USER">User</option>
                      <option value="FOREMAN">Foreman</option>
                      <option value="ADMINISTRATOR">Administrator</option>
                      <option value="SUPERUSER">SuperUser</option>
                    </select>
                  </div>
                </div>
              </section>

              {/* Submit Button - Orange CTA */}
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className={`px-8 py-3 text-sm font-bold rounded transition-all duration-150 transform ${
                    isSaving
                      ? 'bg-gray-300 text-gray-600 cursor-not-allowed shadow-sm'
                      : 'bg-gradient-to-b from-orange-500 to-orange-600 text-white hover:from-orange-600 hover:to-orange-700 shadow-lg hover:shadow-xl active:shadow-md active:translate-y-1'
                  }`}
                  style={!isSaving ? { boxShadow: '0 6px 12px -2px rgba(249, 115, 22, 0.5), 0 4px 6px -1px rgba(0, 0, 0, 0.3)' } : {}}
                >
                  {isSaving ? 'Saving...' : mode === 'edit' ? '💾 Update User' : '💾 Save User'}
                </button>
              </div>
            </form>
          )}
        </main>
      </div>
    </PasswordPrompt>
  );
};

export default CreateEditNfcPage;
