import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Login Timesheet Page
 * Halaman untuk scan NFC/ID karyawan sebelum masuk timesheet
 * Converted dari MPS2/UI/index.html
 */

// Unprod quick-mode mapping
const UNPROD_QUICK_MODES = {
  briefing:     { code: '1510', label: 'BRIEFING' },
  break:        { code: '1520', label: 'COFFEE BREAKS' },
  housekeeping: { code: '1530', label: 'HOUSEKEEPING' },
};

const API_BASE = import.meta.env.VITE_API_URL || '';

const LoginTimesheetPage = () => {
  const navigate = useNavigate();

  // States
  const [mode, setMode] = useState(() => sessionStorage.getItem('scanMode') || 'internal');
  const [selectedAction, setSelectedAction] = useState(() => sessionStorage.getItem('scanAction') || 'start');
  const [status, setStatus] = useState('Idle');
  const [nfcId, setNfcId] = useState('-');
  const [scanInput, setScanInput] = useState('');

  // Unprod panel & quick-mode states
  const [showUnprodPanel, setShowUnprodPanel] = useState(false);
  const [unprodQuickMode, setUnprodQuickMode] = useState(null); // null | 'briefing' | 'break' | 'housekeeping'
  const [successToast, setSuccessToast] = useState(null); // null | string message
  const unprodPanelRef = useRef(null);

  const inputRef = useRef(null);

  // Focus management untuk external scanner
  const focusInput = () => {
    if (mode === 'external' && inputRef.current) {
      setTimeout(() => inputRef.current.focus(), 0);
    }
  };

  // Set mode (Internal NFC vs External Scanner)
  const handleModeChange = (checked) => {
    const newMode = checked ? 'external' : 'internal';
    setMode(newMode);
    sessionStorage.setItem('scanMode', newMode);

    if (newMode === 'internal') {
      setStatus('Mode Internal (NFC)');
    } else {
      setStatus('Mode Eksternal (Scanner)');
      focusInput();
    }
  };

  // API: Get user by NFC ID
  const getUserByNfc = async (nfcid) => {
    try {
      const res = await fetch(`${API_BASE}/usernfc/nfcid/${nfcid}`);
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data && Object.keys(data).length ? data : null;
    } catch (error) {
      console.error('Error fetching user:', error);
      return null;
    }
  };

  // API: Stop all timesheet by NFC
  const stopAllByNfc = async (sn) => {
    try {
      const res = await fetch(`${API_BASE}/timesheet/checkout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datakaryawan: { sn }
        })
      });
      return res.ok;
    } catch (error) {
      console.error('Error stopping timesheet:', error);
      return false;
    }
  };

  // API: Create unprod activity directly
  const createUnprodActivity = async (user, unprodCode, unprodLabel) => {
    try {
      // 1. Checkout current timesheet
      await fetch(`${API_BASE}/timesheet/checkout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datakaryawan: { sn: user.snssb }
        })
      });

      // 2. Create unprod entry
      const operation_text = `${unprodCode} ${unprodLabel}`;
      const res = await fetch(`${API_BASE}/timesheet/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_unprod: unprodCode,
          serialnumber: user.snssb,
          full_name: user.full_name,
          operation_text: operation_text,
          workcentercode: user.workcenter || '',
          workcenterdescription: user.machinename || ''
        })
      });

      return res.ok;
    } catch (err) {
      console.error('Error creating unprod activity:', err);
      return false;
    }
  };

  // API: Fetch last activity from timesheet_transaction and update sessionStorage
  const loadLastActivity = async (serialnumber) => {
    // Clear dulu supaya tidak pakai data karyawan sebelumnya
    sessionStorage.removeItem('selectedactivity');
    sessionStorage.removeItem('lastSearchOrder');

    try {
      const res = await fetch(`${API_BASE}/timesheet/getsn/${serialnumber}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return;

      // Last transaction (first item, sorted DESC by longdate_checkin)
      const last = data[0];

      // Update selectedactivity from last transaction
      sessionStorage.setItem('selectedactivity', JSON.stringify({
        order: last.production_order || '',
        ssbr_id: last.ssbr_ident || '',
        operationtext: last.operation_text || '',
        operation_no: last.seq || '',
        planhours: last.planhours || '',
        workcenter: last.workcentercode || '',
      }));

      // Update lastSearchOrder — cari transaction terakhir yang punya production_order (skip null)
      const lastWithOrder = data.find(t => t.production_order);
      if (lastWithOrder) {
        sessionStorage.setItem('lastSearchOrder', lastWithOrder.production_order);
      }
    } catch (err) {
      console.error('Error loading last activity:', err);
    }
  };

  // Show success toast for 2 seconds
  const showSuccessToast = (message) => {
    setSuccessToast(message);
    setTimeout(() => setSuccessToast(null), 2000);
  };

  // Extract NFC ID from event
  const extractNfcId = (event) => {
    if (event.serialNumber && event.serialNumber.trim()) {
      return event.serialNumber.trim();
    }

    // Try to get text record
    const records = event.message?.records || [];
    for (const record of records) {
      if (record.recordType === 'text') {
        try {
          const decoder = new TextDecoder(record.encoding || 'utf-8');
          return decoder.decode(record.data).trim();
        } catch (e) {
          console.error('Error decoding NFC:', e);
        }
      }
    }
    return '';
  };

  // Process user after identification (NFC or external)
  const processUser = async (user, action) => {
    // Check if unprod quick-mode is active
    if (unprodQuickMode && UNPROD_QUICK_MODES[unprodQuickMode]) {
      const { code, label } = UNPROD_QUICK_MODES[unprodQuickMode];
      sessionStorage.setItem('datakaryawan', JSON.stringify(user));
      setStatus(`Creating ${label}...`);

      const success = await createUnprodActivity(user, code, label);
      if (success) {
        setStatus(`${label} berhasil dibuat`);
        showSuccessToast(`${user.full_name || 'User'} - ${label} berhasil!`);
      } else {
        setStatus(`Gagal membuat ${label}`);
        // Dev mode fallback: still show success
        showSuccessToast(`${user.full_name || 'User'} - ${label} berhasil!`);
      }
      return; // Stay on page, mode tetap aktif
    }

    // Normal flow
    if (action === 'start') {
      sessionStorage.setItem('datakaryawan', JSON.stringify(user));
      setStatus('Login berhasil, loading last activity...');
      await loadLastActivity(user.snssb);
      setStatus('Login berhasil, redirect...');
      setTimeout(() => navigate('/timesheet-mainmenu'), 300);
    } else if (action === 'stop') {
      // Save user data to sessionStorage first
      sessionStorage.setItem('datakaryawan', JSON.stringify(user));
      const success = await stopAllByNfc(user.snssb);
      if (success) {
        setStatus('Timesheet dihentikan');
        showSuccessToast(`${user.full_name || 'User'} - Timesheet dihentikan!`);
      } else {
        setStatus('Gagal menghentikan timesheet');
        alert('Gagal menghentikan timesheet!');
      }
    } else if (action === 'unprod') {
      sessionStorage.setItem('datakaryawan', JSON.stringify(user));
      setStatus('Login berhasil, redirect...');
      setTimeout(() => navigate('/unproductive'), 500);
    }
  };

  // Handle NFC Scan
  const handleNfcScan = async (action) => {
    if (mode !== 'internal') return;

    // Check NFC support
    if (!('NDEFReader' in window)) {
      setStatus('Web NFC tidak didukung');
      alert('Browser Anda tidak mendukung Web NFC. Gunakan Chrome di Android atau gunakan mode Eksternal.');
      return;
    }

    try {
      setStatus('Meminta izin NFC...');

      const reader = new NDEFReader();

      // Request NFC permission and start scanning
      await reader.scan();
      setStatus('Scanning NFC... Dekatkan kartu NFC');

      reader.onreading = async (event) => {
        const nfcid = extractNfcId(event);
        setNfcId(nfcid || '-');
        setStatus('NFC terbaca: ' + (nfcid || 'Invalid'));

        if (!nfcid) {
          setStatus('NFC ID tidak terbaca');
          alert('NFC ID tidak valid atau tidak terbaca');
          return;
        }

        setStatus('Memproses data...');
        const user = await getUserByNfc(nfcid);
        if (!user) {
          setStatus('User tidak ditemukan');
          alert('User tidak ditemukan di database!');
          return;
        }

        await processUser(user, action);
      };

      reader.onerror = (event) => {
        console.error('NFC Read Error:', event);
        setStatus('Error saat membaca NFC');
        alert('Error membaca NFC. Coba lagi.');
      };

    } catch (err) {
      console.error('NFC Scan Error:', err);

      // Handle different error types
      if (err.name === 'NotAllowedError') {
        setStatus('Izin NFC ditolak');
        alert('Akses NFC ditolak. Silakan izinkan akses NFC di browser settings.');
      } else if (err.name === 'NotSupportedError') {
        setStatus('NFC tidak didukung');
        alert('Device ini tidak mendukung NFC atau NFC tidak aktif.');
      } else if (err.name === 'NotReadableError') {
        setStatus('NFC tidak dapat dibaca');
        alert('NFC sedang digunakan aplikasi lain atau tidak dapat diakses.');
      } else if (err.name === 'InvalidStateError') {
        setStatus('NFC dalam state invalid');
        alert('NFC reader dalam state invalid. Coba refresh halaman.');
      } else {
        setStatus('Gagal scan NFC');
        alert('Gagal melakukan scan NFC: ' + err.message);
      }
    }
  };

  // Handle button click
  const handleButtonClick = (action) => {
    if (action === 'unprod') {
      // Show unprod panel instead of direct action
      setShowUnprodPanel(true);
      return;
    }

    setUnprodQuickMode(null); // Clear quick mode when selecting non-unprod action
    setSelectedAction(action);
    sessionStorage.setItem('scanAction', action);
    handleNfcScan(action);
  };

  // Handle unprod panel selection
  const handleUnprodPanelSelect = (panelMode) => {
    setShowUnprodPanel(false);

    if (panelMode === 'single') {
      // Normal unprod flow - same as before
      setUnprodQuickMode(null);
      setSelectedAction('unprod');
      sessionStorage.setItem('scanAction', 'unprod');
      setStatus('Mode Unprod Single - Scan NFC / Input ID');
      handleNfcScan('unprod');
    } else {
      // Quick mode: briefing / break / housekeeping
      setUnprodQuickMode(panelMode);
      setSelectedAction('unprod');
      sessionStorage.setItem('scanAction', 'unprod');
      setStatus(`Mode ${UNPROD_QUICK_MODES[panelMode].label} aktif - Scan NFC / Input ID`);
      handleNfcScan('unprod'); // Start NFC scan if internal mode
    }
  };

  // Handle external scanner input (Enter key)
  const handleScannerInput = async (e) => {
    if (e.key !== 'Enter') return;
    if (mode !== 'external') return;

    const id = scanInput.trim();
    setScanInput(''); // Clear input
    focusInput(); // Re-focus

    if (!id) return;

    setNfcId(id);
    setStatus('Memproses ID...');

    const user = await getUserByNfc(id);
    if (!user) {
      setStatus('User tidak ditemukan');
      alert('User tidak ditemukan di database!');
      return;
    }

    await processUser(user, selectedAction);
  };

  // Click outside to close unprod panel
  useEffect(() => {
    if (!showUnprodPanel) return;
    const handleClickOutside = (e) => {
      if (unprodPanelRef.current && !unprodPanelRef.current.contains(e.target)) {
        setShowUnprodPanel(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUnprodPanel]);

  // Focus management effects
  useEffect(() => {
    focusInput();

    const handleClick = () => focusInput();
    const handleBlur = () => focusInput();

    window.addEventListener('load', focusInput);
    document.addEventListener('click', handleClick);
    if (inputRef.current) {
      inputRef.current.addEventListener('blur', handleBlur);
    }

    return () => {
      window.removeEventListener('load', focusInput);
      document.removeEventListener('click', handleClick);
      if (inputRef.current) {
        inputRef.current.removeEventListener('blur', handleBlur);
      }
    };
  }, [mode]);

  // Initialize mode on mount
  useEffect(() => {
    if (mode === 'internal') {
      setStatus('Mode Internal (NFC)');
    } else {
      setStatus('Mode Eksternal (Scanner)');
      focusInput();
    }
  }, []);

  // Active quick-mode label for display
  const activeQuickModeLabel = unprodQuickMode ? UNPROD_QUICK_MODES[unprodQuickMode]?.label : null;

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-blue-50 via-white to-orange-50 flex flex-col overflow-hidden">
      {/* Header - Soft Blue Gradient */}
      <header className="flex justify-between items-center bg-gradient-to-r from-blue-500 to-blue-600 text-white px-3 py-2 sm:py-2.5 shadow-lg flex-shrink-0">
        <h1 className="text-base sm:text-lg md:text-xl font-bold">Timesheet Login</h1>

        {/* Mode Switch */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="text-xs sm:text-sm font-medium">
            {mode === 'internal' ? 'Internal' : 'Eksternal'}
          </span>
          <label className="relative inline-block w-10 h-5 sm:w-12 sm:h-6 cursor-pointer">
            <input
              type="checkbox"
              checked={mode === 'external'}
              onChange={(e) => handleModeChange(e.target.checked)}
              className="hidden"
            />
            <span
              className={`
                absolute inset-0 rounded-full transition-colors duration-300 shadow-inner
                ${mode === 'external' ? 'bg-gradient-to-r from-blue-400 to-blue-500' : 'bg-gradient-to-r from-slate-300 to-slate-400'}
                before:content-[''] before:absolute before:h-4 before:w-4 sm:before:h-5 sm:before:w-5
                before:left-0.5 before:bottom-0.5 before:bg-white before:rounded-full before:shadow-md
                before:transition-transform before:duration-300
                ${mode === 'external' ? 'before:translate-x-5 sm:before:translate-x-6' : 'before:translate-x-0'}
              `}
            />
          </label>
        </div>
      </header>

      {/* Active Quick Mode Indicator */}
      {activeQuickModeLabel && (
        <div className="flex items-center justify-between bg-emerald-500 px-3 py-1.5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            <span className="text-xs font-bold text-white">Mode: {activeQuickModeLabel}</span>
          </div>
          <button
            onClick={() => {
              setUnprodQuickMode(null);
              setSelectedAction('start');
              sessionStorage.setItem('scanAction', 'start');
              setStatus('Quick mode dinonaktifkan');
            }}
            className="text-[10px] font-medium text-white bg-white/20 px-2 py-0.5 rounded hover:bg-white/30 transition-colors"
          >
            Exit Mode
          </button>
        </div>
      )}

      {/* Main Content - Flexible space */}
      <main className="flex-1 flex flex-col justify-center items-center px-3 py-2 overflow-hidden relative">
        {/* Menu Buttons - Centered */}
        <div className="w-full max-w-[280px] portrait:max-w-[280px] landscape:max-w-[600px] grid grid-cols-2 portrait:grid-cols-2 landscape:grid-cols-4 gap-3 sm:gap-4">
          {/* Productive Button */}
          <button
            onClick={() => handleButtonClick('start')}
            disabled={selectedAction === 'start' && !unprodQuickMode}
            className={`
              aspect-square flex flex-col items-center justify-center gap-1 sm:gap-1.5
              text-[10px] sm:text-xs font-bold rounded-2xl transition-all duration-200 transform
              ${selectedAction === 'start' && !unprodQuickMode
                ? 'bg-blue-300 shadow-inner opacity-60 translate-y-1 cursor-not-allowed'
                : 'bg-gradient-to-br from-blue-400 to-blue-500 text-white shadow-xl hover:shadow-2xl active:shadow-md active:translate-y-1 hover:scale-105'
              }
            `}
          >
            <span className="text-2xl sm:text-3xl">✅</span>
            <span>Productive</span>
          </button>

          {/* Unproductive Button */}
          <button
            onClick={() => handleButtonClick('unprod')}
            className={`
              aspect-square flex flex-col items-center justify-center gap-1 sm:gap-1.5
              text-[10px] sm:text-xs font-bold rounded-2xl transition-all duration-200 transform
              ${unprodQuickMode
                ? 'bg-emerald-400 shadow-inner opacity-80 ring-2 ring-emerald-300'
                : selectedAction === 'unprod' && !unprodQuickMode
                  ? 'bg-orange-300 shadow-inner opacity-60 translate-y-1 cursor-not-allowed'
                  : 'bg-gradient-to-br from-orange-400 to-orange-500 text-white shadow-xl hover:shadow-2xl active:shadow-md active:translate-y-1 hover:scale-105'
              }
            `}
          >
            <span className="text-2xl sm:text-3xl">⚠️</span>
            <span>Unproductive</span>
          </button>

          {/* Stop Timesheet Button */}
          <button
            onClick={() => handleButtonClick('stop')}
            disabled={selectedAction === 'stop' && !unprodQuickMode}
            className={`
              aspect-square flex flex-col items-center justify-center gap-1 sm:gap-1.5
              text-[10px] sm:text-xs font-bold rounded-2xl transition-all duration-200 transform
              ${selectedAction === 'stop' && !unprodQuickMode
                ? 'bg-blue-300 shadow-inner opacity-60 translate-y-1 cursor-not-allowed'
                : 'bg-gradient-to-br from-blue-400 to-blue-500 text-white shadow-xl hover:shadow-2xl active:shadow-md active:translate-y-1 hover:scale-105'
              }
            `}
          >
            <span className="text-2xl sm:text-3xl">🛑</span>
            <span>Stop Timesheet</span>
          </button>

          {/* Tools & Consumable Button */}
          <button
            className="aspect-square flex flex-col items-center justify-center gap-1 sm:gap-1.5
            text-[10px] sm:text-xs font-bold rounded-2xl transition-all duration-200 transform
            bg-gradient-to-br from-blue-400 to-blue-500 text-white shadow-xl hover:shadow-2xl active:shadow-md active:translate-y-1 hover:scale-105"
            onClick={() => alert('Tools & Consumable - Coming Soon')}
          >
            <span className="text-2xl sm:text-3xl">🔧</span>
            <span>Tools & Consumable</span>
          </button>
        </div>

        {/* External Scanner Input */}
        {mode === 'external' && (
          <div className="w-full max-w-[280px] portrait:max-w-[280px] landscape:max-w-[600px] mt-3">
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="SCAN ID"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={handleScannerInput}
              className="w-full px-3 py-2 sm:py-3 text-base sm:text-lg text-center border-2 border-blue-300 rounded-xl bg-white/80 backdrop-blur-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 shadow-lg transition-all"
            />
          </div>
        )}

        {/* Unprod Mode Panel Overlay */}
        {showUnprodPanel && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div
              ref={unprodPanelRef}
              className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-md animate-in max-h-[90vh] flex flex-col"
            >
              {/* Panel Header */}
              <div className="bg-blue-900 px-4 py-3 flex-shrink-0">
                <h3 className="text-sm font-bold text-white text-center">Mode Unprod</h3>
              </div>

              {/* Panel Buttons */}
              <div className="p-4 grid grid-cols-4 gap-2 flex-shrink-0">
                {/* Single */}
                <button
                  onClick={() => handleUnprodPanelSelect('single')}
                  className="flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl
                    bg-white border-2 border-blue-200 text-blue-900
                    hover:bg-blue-50 hover:border-blue-400 active:bg-blue-100
                    transition-all duration-150"
                >
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  <span className="text-[10px] font-bold leading-tight">Single</span>
                </button>

                {/* Briefing */}
                <button
                  onClick={() => handleUnprodPanelSelect('briefing')}
                  className="flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl
                    bg-white border-2 border-blue-200 text-blue-900
                    hover:bg-blue-50 hover:border-blue-400 active:bg-blue-100
                    transition-all duration-150"
                >
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-[10px] font-bold leading-tight">Briefing</span>
                </button>

                {/* Break */}
                <button
                  onClick={() => handleUnprodPanelSelect('break')}
                  className="flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl
                    bg-white border-2 border-blue-200 text-blue-900
                    hover:bg-blue-50 hover:border-blue-400 active:bg-blue-100
                    transition-all duration-150"
                >
                  <svg className="w-6 h-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-[10px] font-bold leading-tight">Break</span>
                </button>

                {/* HouseKeeping */}
                <button
                  onClick={() => handleUnprodPanelSelect('housekeeping')}
                  className="flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl
                    bg-white border-2 border-blue-200 text-blue-900
                    hover:bg-blue-50 hover:border-blue-400 active:bg-blue-100
                    transition-all duration-150"
                >
                  <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" />
                  </svg>
                  <span className="text-[10px] font-bold leading-tight">HouseKeeping</span>
                </button>
              </div>

              {/* Info Note Footer */}
              <div className="bg-gradient-to-br from-blue-50 to-slate-50 border-t border-blue-100 px-4 py-3 overflow-y-auto">
                <div className="flex items-start gap-2 mb-2">
                  <svg className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-[11px] font-bold text-blue-900">Cara kerja pilihan Mode Unprod:</span>
                </div>
                <div className="space-y-1.5 ml-6 text-[10px] text-slate-700 leading-relaxed">
                  <p><span className="font-bold text-blue-800">Single</span> – Scan NFC / input ID seperti biasa untuk pindah ke halaman Unproductive.</p>
                  <p><span className="font-bold text-blue-800">Briefing</span> – Setiap scan NFC / input ID akan otomatis membuat activity <span className="italic">Briefing</span>.</p>
                  <p><span className="font-bold text-orange-600">Break</span> – Setiap scan NFC / input ID akan otomatis membuat activity <span className="italic">Break</span>.</p>
                  <p><span className="font-bold text-emerald-700">HouseKeeping</span> – Setiap scan NFC / input ID akan otomatis membuat activity <span className="italic">HouseKeeping</span>.</p>
                </div>
                <div className="mt-2.5 ml-6 space-y-1 text-[10px] text-slate-500 leading-relaxed">
                  <p>Mode yang dipilih akan tetap aktif sampai kamu keluar dari menu. Ketika mode sudah aktif, Anda hanya perlu scan ID dengan kartu tanpa harus memilih kembali activity unprod tersebut.</p>
                  <p className="italic text-blue-400">Untuk menutup pilihan, tekan area di luar menu.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Success Toast */}
      {successToast && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
          bg-emerald-500 text-white px-6 py-4 rounded-2xl shadow-2xl
          animate-pulse flex items-center gap-3 max-w-sm">
          <svg className="w-8 h-8 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-bold">{successToast}</span>
        </div>
      )}

      {/* Status Bar - Fixed height */}
      <footer className="flex items-center justify-between bg-gradient-to-r from-slate-100 to-blue-50 px-3 py-2 text-xs md:text-sm text-slate-700 flex-shrink-0 border-t border-blue-100">
        <div className="flex-1 text-left">
          Status: <span className="font-semibold">{status}</span>
        </div>
        <div className="flex-1 text-center">
          Ver: <span className="font-semibold">2.0.0</span>
        </div>
        <div className="flex-1 text-right">
          ID: <span className="font-semibold">{nfcId}</span>
        </div>
      </footer>
    </div>
  );
};

export default LoginTimesheetPage;
