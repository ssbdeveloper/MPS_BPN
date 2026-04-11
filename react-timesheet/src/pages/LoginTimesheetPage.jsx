import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import ssbLogo from '../assets/ssb.png';

// ─── Constants ────────────────────────────────────────────────────────────────
const UNPROD_QUICK_MODES = {
  briefing:     { code: '1510', label: 'BRIEFING' },
  break:        { code: '1520', label: 'COFFEE BREAKS' },
  housekeeping: { code: '1530', label: 'HOUSEKEEPING' },
};

const NFC_ERROR_MESSAGES = {
  NotAllowedError:   ['Izin NFC ditolak',       'Akses NFC ditolak. Silakan izinkan akses NFC di browser settings.'],
  NotSupportedError: ['NFC tidak didukung',      'Device ini tidak mendukung NFC atau NFC tidak aktif.'],
  NotReadableError:  ['NFC tidak dapat dibaca',  'NFC sedang digunakan aplikasi lain atau tidak dapat diakses.'],
  InvalidStateError: ['NFC state invalid',       'NFC reader dalam state invalid. Coba refresh halaman.'],
};

const ACTION_LABEL = { start: 'Productive', stop: 'Stop Timesheet', unprod: 'Unproductive' };

const API_BASE = import.meta.env.VITE_API_URL || '';

// ─── Sub-component: Unprod Mode Panel ────────────────────────────────────────
const UnprodPanel = ({ panelRef, onSelect }) => {
  const btnBase = `flex flex-col items-center justify-center gap-1.5 py-3 px-1 min-h-[44px]
    rounded-xl bg-white border-2 border-slate-200 text-slate-800
    active:bg-slate-100 transition-all duration-150`;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div
        ref={panelRef}
        className="bg-white rounded-2xl shadow-xl overflow-hidden w-full max-w-md max-h-[90vh] flex flex-col"
      >
        {/* Panel Header */}
        <div
          className="px-4 py-3 flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #023e8a 0%, #0077b6 100%)' }}
        >
          <h3 className="text-sm font-bold text-white text-center">Mode Unprod</h3>
        </div>

        {/* Panel Buttons */}
        <div className="p-4 grid grid-cols-4 gap-2 flex-shrink-0">
          <button
            onClick={() => onSelect('single')}
            className={`${btnBase} hover:bg-slate-50 hover:border-[#0096c7]`}
          >
            <svg className="w-6 h-6 text-[#0096c7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            <span className="text-[10px] font-bold leading-tight">List Unprod</span>
          </button>

          <button
            onClick={() => onSelect('briefing')}
            className={`${btnBase} hover:bg-slate-50 hover:border-[#0096c7]`}
          >
            <svg className="w-6 h-6 text-[#0096c7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-[10px] font-bold leading-tight">Briefing</span>
          </button>

          <button
            onClick={() => onSelect('break')}
            className={`${btnBase} hover:bg-amber-50 hover:border-amber-400`}
          >
            <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[10px] font-bold leading-tight">Break</span>
          </button>

          <button
            onClick={() => onSelect('housekeeping')}
            className={`${btnBase} hover:bg-emerald-50 hover:border-emerald-400`}
          >
            <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" />
            </svg>
            <span className="text-[10px] font-bold leading-tight">HouseKeeping</span>
          </button>
        </div>

        {/* Info Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 overflow-y-auto">
          <div className="flex items-start gap-2 mb-2">
            <svg className="w-4 h-4 text-[#0096c7] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[11px] font-bold text-slate-800">Cara kerja pilihan Mode Unprod:</span>
          </div>
          <div className="space-y-1.5 ml-6 text-[10px] text-slate-700 leading-relaxed">
            <p><span className="font-bold text-[#0096c7]">Single</span> – Scan NFC / input ID seperti biasa untuk pindah ke halaman Unproductive.</p>
            <p><span className="font-bold text-[#0096c7]">Briefing</span> – Setiap scan NFC / input ID akan otomatis membuat activity <span className="italic">Briefing</span>.</p>
            <p><span className="font-bold text-amber-600">Break</span> – Setiap scan NFC / input ID akan otomatis membuat activity <span className="italic">Break</span>.</p>
            <p><span className="font-bold text-emerald-700">HouseKeeping</span> – Setiap scan NFC / input ID akan otomatis membuat activity <span className="italic">HouseKeeping</span>.</p>
          </div>
          <div className="mt-2.5 ml-6 space-y-1 text-[10px] text-slate-500 leading-relaxed">
            <p>Mode yang dipilih akan tetap aktif sampai kamu keluar dari menu. Ketika mode sudah aktif, Anda hanya perlu scan ID tanpa harus memilih kembali activity unprod tersebut.</p>
            <p className="italic text-slate-400">Untuk menutup pilihan, tekan area di luar menu.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const LoginTimesheetPage = () => {
  const navigate = useNavigate();

  // ── State ───────────────────────────────────────────────────────────────────
  const [mode, setMode]                   = useState(() => sessionStorage.getItem('scanMode')   || 'internal');
  const [selectedAction, setSelectedAction] = useState(() => sessionStorage.getItem('scanAction') || 'start');
  const [status, setStatus]               = useState('Idle');
  const [nfcId, setNfcId]                 = useState('-');
  const [scanInput, setScanInput]         = useState('');
  const [showUnprodPanel, setShowUnprodPanel] = useState(false);
  const [unprodQuickMode, setUnprodQuickMode] = useState(null);
  const [currentTime, setCurrentTime]     = useState('');

  // ── Refs (used inside NFC callbacks to avoid stale closures) ────────────────
  const inputRef              = useRef(null);
  const unprodPanelRef        = useRef(null);
  const nfcReaderRef          = useRef(null);
  const isProcessingRef       = useRef(false);
  const lastProcessedNfcIdRef = useRef('');
  const processingTimeoutRef  = useRef(null);
  const selectedActionRef     = useRef(sessionStorage.getItem('scanAction') || 'start');
  const unprodQuickModeRef    = useRef(null);

  // ── NFC Cleanup ─────────────────────────────────────────────────────────────
  const cleanupNFC = () => {
    if (nfcReaderRef.current) {
      try {
        nfcReaderRef.current.onreading = null;
        nfcReaderRef.current.onerror   = null;
        nfcReaderRef.current.stop?.();
      } catch (err) {
        console.warn('Error cleaning up NFC:', err);
      }
      nfcReaderRef.current = null;
    }
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
    isProcessingRef.current = false;
  };

  // ── API calls ────────────────────────────────────────────────────────────────
  const getUserByNfc = async (nfcid) => {
    try {
      const res  = await fetch(`${API_BASE}/usernfc/nfcid/${nfcid}`);
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data && Object.keys(data).length ? data : null;
    } catch (err) {
      console.error('Error fetching user:', err);
      return null;
    }
  };

  const stopAllByNfc = async (sn) => {
    try {
      const res = await fetch(`${API_BASE}/timesheet/checkout`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ datakaryawan: { sn } }),
      });
      return res.ok;
    } catch (err) {
      console.error('Error stopping timesheet:', err);
      return false;
    }
  };

  const createUnprodActivity = async (user, unprodCode, unprodLabel) => {
    try {
      const isMultiple = user.mode === 'multiple';
      const checkoutEndpoint = isMultiple ? 'checkout-unprod' : 'checkout';
      await fetch(`${API_BASE}/timesheet/${checkoutEndpoint}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ datakaryawan: { sn: user.snssb } }),
      });

      const res = await fetch(`${API_BASE}/timesheet/`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          id_unprod:            unprodCode,
          serialnumber:         user.snssb,
          full_name:            user.full_name,
          operation_text:       `${unprodCode} ${unprodLabel}`,
          workcentercode:       user.workcenter   || '',
          workcenterdescription: user.machinename || '',
        }),
      });
      return res.ok;
    } catch (err) {
      console.error('Error creating unprod activity:', err);
      return false;
    }
  };

  const loadLastActivity = async (serialnumber) => {
    sessionStorage.removeItem('selectedactivity');
    sessionStorage.removeItem('lastSearchOrder');
    try {
      const res  = await fetch(`${API_BASE}/timesheet/getsn/${serialnumber}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return;

      // Skip unproductive activities (activitytype has a value)
      const last = data.find(t => !t.activitytype);
      if (!last) return;

      // Jangan resume jika record terakhir tidak punya order_no / operation_no —
      // biar user memilih job baru lewat SelectJobPage, bukan meneruskan data rusak.
      if (!last.order_no || !last.operation_no) return;

      sessionStorage.setItem('selectedactivity', JSON.stringify({
        order:         last.order_no,
        ssbr_id:       last.ssbr_id        || '',
        part_name:     last.part_name      || '',
        operationtext: last.operation_text || '',
        operation_no:  last.operation_no,
        planhours:     last.planhours      || '',
        workcenter:    last.workcentercode || '',
      }));

      if (last.order_no) {
        sessionStorage.setItem('lastSearchOrder', last.order_no);
      }
    } catch (err) {
      console.error('Error loading last activity:', err);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const showSuccessToast = (message) => toast.success(message);

  const extractNfcId = (event) => {
    if (event.serialNumber?.trim()) return event.serialNumber.trim();
    for (const record of event.message?.records || []) {
      if (record.recordType === 'text') {
        try {
          return new TextDecoder(record.encoding || 'utf-8').decode(record.data).trim();
        } catch (e) {
          console.error('Error decoding NFC record:', e);
        }
      }
    }
    return '';
  };

  const resetProcessingState = () => {
    isProcessingRef.current       = false;
    lastProcessedNfcIdRef.current = '';
  };

  // ── User Processing ──────────────────────────────────────────────────────────
  const processUser = async (user) => {
    if (isProcessingRef.current) return;

    const action      = selectedActionRef.current;
    const quickMode   = unprodQuickModeRef.current;
    const currentNfcId = user.snssb || user.nfcid || '';

    if (lastProcessedNfcIdRef.current === currentNfcId) return;

    isProcessingRef.current       = true;
    lastProcessedNfcIdRef.current = currentNfcId;

    sessionStorage.setItem('datakaryawan', JSON.stringify(user));

    // Quick-mode: Briefing / Break / HouseKeeping
    if (quickMode && UNPROD_QUICK_MODES[quickMode]) {
      const { code, label } = UNPROD_QUICK_MODES[quickMode];
      setStatus(`Membuat ${label}...`);
      const success = await createUnprodActivity(user, code, label);
      if (success) {
        setStatus(`${label} berhasil dibuat`);
        showSuccessToast(`${user.full_name || 'User'} - ${label} berhasil!`);
      } else {
        setStatus(`Gagal membuat ${label}`);
      }
      setTimeout(resetProcessingState, 2000);
      return;
    }

    // Normal flow
    if (action === 'start') {
      setStatus('Login berhasil, loading last activity...');
      await loadLastActivity(user.snssb);
      setStatus('Login berhasil, redirect...');
      setTimeout(() => {
        isProcessingRef.current = false;
        navigate('/timesheet-mainmenu');
      }, 300);

    } else if (action === 'stop') {
      const success = await stopAllByNfc(user.snssb);
      if (success) {
        setStatus('Timesheet dihentikan');
        showSuccessToast(`${user.full_name || 'User'} - Timesheet dihentikan!`);
      } else {
        setStatus('Gagal menghentikan timesheet');
        toast.error('Gagal menghentikan timesheet!');
      }
      setTimeout(resetProcessingState, 2000);

    } else if (action === 'unprod') {
      setStatus('Login berhasil, redirect...');
      setTimeout(() => {
        isProcessingRef.current = false;
        navigate('/unproductive');
      }, 500);
    }
  };

  // ── NFC Listener ─────────────────────────────────────────────────────────────
  const startNfcListener = async (action) => {
    if (mode === 'external') return;
    if (!('NDEFReader' in window)) {
      setStatus('Web NFC tidak didukung');
      toast.error('Browser Anda tidak mendukung Web NFC. Gunakan Chrome di Android atau gunakan mode Eksternal.');
      return;
    }

    cleanupNFC();
    setStatus(`Scanning NFC... [${ACTION_LABEL[action] ?? action}] — Dekatkan kartu`);

    try {
      const reader = new NDEFReader();
      nfcReaderRef.current = reader;
      await reader.scan();

      let lastReadTime    = 0;
      const DEBOUNCE_MS   = 1500;

      reader.onreading = async (event) => {
        const now = Date.now();
        if (now - lastReadTime < DEBOUNCE_MS || isProcessingRef.current) return;
        lastReadTime = now;

        const nfcid = extractNfcId(event);
        setNfcId(nfcid || '-');

        if (!nfcid) {
          setStatus('NFC ID tidak terbaca');
          toast.error('NFC ID tidak valid atau tidak terbaca');
          return;
        }

        setStatus(`NFC terbaca: ${nfcid} — Memproses...`);
        const user = await getUserByNfc(nfcid);
        if (!user) {
          setStatus('User tidak ditemukan');
          toast.error('User tidak ditemukan di database!');
          return;
        }

        await processUser(user);
      };

      reader.onerror = () => {
        setStatus('Error membaca NFC — tap kartu lagi');
        isProcessingRef.current = false;
      };

    } catch (err) {
      console.error('NFC Scan Error:', err);
      isProcessingRef.current = false;
      const [statusMsg, alertMsg] = NFC_ERROR_MESSAGES[err.name]
        ?? ['Gagal scan NFC', `Gagal melakukan scan NFC: ${err.message}`];
      setStatus(statusMsg);
      toast.error(alertMsg);
    }
  };

  // ── Event Handlers ────────────────────────────────────────────────────────────
  const handleModeChange = (checked) => {
    const newMode = checked ? 'external' : 'internal';
    setMode(newMode);
    sessionStorage.setItem('scanMode', newMode);

    if (newMode === 'external') {
      cleanupNFC();
      setStatus('Mode Eksternal (Scanner)');
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setStatus('Mode Internal (NFC)');
      startNfcListener(selectedActionRef.current);
    }
  };

  const handleButtonClick = (action) => {
    if (action === 'unprod') {
      setShowUnprodPanel(true);
      return;
    }

    selectedActionRef.current = action;
    setSelectedAction(action);
    sessionStorage.setItem('scanAction', action);

    unprodQuickModeRef.current = null;
    setUnprodQuickMode(null);
    resetProcessingState();
    startNfcListener(action);
  };

  const handleUnprodPanelSelect = (panelMode) => {
    setShowUnprodPanel(false);
    resetProcessingState();

    selectedActionRef.current = 'unprod';
    setSelectedAction('unprod');
    sessionStorage.setItem('scanAction', 'unprod');

    if (panelMode === 'single') {
      unprodQuickModeRef.current = null;
      setUnprodQuickMode(null);
      setStatus('Mode Unprod Single — Scan NFC / Input ID');
    } else {
      unprodQuickModeRef.current = panelMode;
      setUnprodQuickMode(panelMode);
      setStatus(`Mode ${UNPROD_QUICK_MODES[panelMode].label} aktif — Scan NFC / Input ID`);
    }

    startNfcListener('unprod');
  };

  const handleExitQuickMode = () => {
    unprodQuickModeRef.current = null;
    setUnprodQuickMode(null);
    selectedActionRef.current = 'start';
    setSelectedAction('start');
    sessionStorage.setItem('scanAction', 'start');
    resetProcessingState();
    startNfcListener('start');
  };

  const handleScannerInput = async (e) => {
    if (e.key !== 'Enter' || mode !== 'external') return;

    const id = scanInput.trim();
    setScanInput('');
    setTimeout(() => inputRef.current?.focus(), 0);
    if (!id) return;

    setNfcId(id);
    setStatus('Memproses ID...');

    const user = await getUserByNfc(id);
    if (!user) {
      setStatus('User tidak ditemukan');
      toast.error('User tidak ditemukan di database!');
      return;
    }

    await processUser(user);
  };

  // ── Effects ──────────────────────────────────────────────────────────────────
  // Close unprod panel on outside click
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

  // Re-focus input field for external scanner on any click
  useEffect(() => {
    if (mode !== 'external') return;
    const focusHandler = () => inputRef.current?.focus();
    setTimeout(focusHandler, 0);
    document.addEventListener('click', focusHandler);
    return () => document.removeEventListener('click', focusHandler);
  }, [mode]);

  // Mount: reset state and start NFC if internal mode
  useEffect(() => {
    resetProcessingState();

    const savedAction = sessionStorage.getItem('scanAction') || 'start';
    const savedMode   = sessionStorage.getItem('scanMode')   || 'internal';
    selectedActionRef.current = savedAction;

    if (savedMode === 'internal') {
      setStatus('Scanning NFC... — Dekatkan kartu');
      startNfcListener(savedAction);
    } else {
      setStatus('Mode Eksternal (Scanner)');
      setTimeout(() => inputRef.current?.focus(), 0);
    }

    return cleanupNFC;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time clock
  useEffect(() => {
    const pad  = (n) => String(n).padStart(2, '0');
    const tick = () => {
      const d = new Date();
      setCurrentTime(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────────
  const activeQuickModeLabel = unprodQuickMode ? UNPROD_QUICK_MODES[unprodQuickMode]?.label : null;

  // Shared class for primary action buttons
  const btnPrimary  = `aspect-square flex flex-col items-center justify-center gap-2 sm:gap-3
    text-lg font-bold rounded-2xl transition-all duration-200
    bg-[#0096c7] hover:bg-[#0077b6] text-white shadow-md hover:shadow-lg
    active:translate-y-0.5 active:shadow-sm active:scale-95`;
  const btnActive   = `aspect-square flex flex-col items-center justify-center gap-2 sm:gap-3
    text-lg font-bold rounded-2xl transition-all duration-200
    bg-slate-200 text-slate-500 shadow-inner opacity-60 translate-y-0.5
    ring-2 ring-[#00b4d8]`;
  const btnUnprodActive = `aspect-square flex flex-col items-center justify-center gap-2 sm:gap-3
    text-lg font-bold rounded-2xl transition-all duration-200
    bg-emerald-100 text-emerald-700 shadow-inner ring-2 ring-emerald-400 opacity-80`;

  const isActive = (key) => selectedAction === key && !unprodQuickMode;

  return (
    <div className="h-dvh w-screen bg-slate-50 flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <header className="flex-shrink-0 flex items-center justify-between
                         px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm">
        <h1 className="text-base sm:text-lg font-extrabold text-slate-800">Timesheet Login</h1>

        {/* Mode Toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm font-medium text-slate-600">
            {mode === 'internal' ? 'Internal' : 'Eksternal'}
          </span>
          <label className="relative inline-block w-10 h-5 sm:w-12 sm:h-6 cursor-pointer">
            <input
              type="checkbox"
              checked={mode === 'external'}
              onChange={(e) => handleModeChange(e.target.checked)}
              className="sr-only"
            />
            <span
              className={`
                absolute inset-0 rounded-full transition-colors duration-300
                ${mode === 'external' ? 'bg-[#0096c7]' : 'bg-slate-300'}
                before:content-[''] before:absolute before:h-4 before:w-4 sm:before:h-5 sm:before:w-5
                before:left-0.5 before:bottom-0.5 before:bg-white before:rounded-full before:shadow-md
                before:transition-transform before:duration-300
                ${mode === 'external' ? 'before:translate-x-5 sm:before:translate-x-6' : 'before:translate-x-0'}
              `}
            />
          </label>
        </div>
      </header>

      {/* ── Active Quick Mode Indicator ── */}
      {activeQuickModeLabel && (
        <div className="flex-shrink-0 flex items-center justify-between
                        bg-emerald-600 px-4 py-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            <span className="text-xs font-bold text-white">Mode: {activeQuickModeLabel}</span>
          </div>
          <button
            onClick={handleExitQuickMode}
            className="text-[10px] font-semibold text-white bg-white/20 hover:bg-white/35
                       px-2 py-0.5 rounded-full transition-colors"
          >
            Exit Mode
          </button>
        </div>
      )}

      {/* ── Main Content ── */}
      <main className="relative flex-1 flex flex-col justify-center items-center px-4 py-2 overflow-hidden">

        {/* Silhouette background */}
        <img
          src={ssbLogo}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
          style={{ filter: 'blur(1px) brightness(0)', opacity: 0.055 }}
        />

        {/* Clock */}
        <div className="text-center portrait:mb-5 landscape:mb-3">
          <span
            className="font-mono portrait:text-6xl landscape:text-8xl font-bold tracking-widest tabular-nums"
            style={{ color: '#00b4d8', WebkitTextStroke: '2px #0096c7' }}
          >
            {currentTime}
          </span>
        </div>

        {/* Action Buttons Grid */}
        <div className="w-full max-w-[360px] landscape:max-w-[680px]
                        grid grid-cols-2 landscape:grid-cols-4 gap-3 sm:gap-4">

          {/* Productive */}
          <button
            onClick={() => handleButtonClick('start')}
            className={isActive('start') ? btnActive : btnPrimary}
          >
            <span className="text-4xl sm:text-5xl">✅</span>
            <span>Productive</span>
          </button>

          {/* Unproductive */}
          <button
            onClick={() => handleButtonClick('unprod')}
            className={
              unprodQuickMode        ? btnUnprodActive :
              isActive('unprod')     ? btnActive       :
              btnPrimary
            }
          >
            <span className="text-4xl sm:text-5xl">⚠️</span>
            <span>Unproductive</span>
          </button>

          {/* Stop Timesheet */}
          <button
            onClick={() => handleButtonClick('stop')}
            className={isActive('stop') ? btnActive : btnPrimary}
          >
            <span className="text-4xl sm:text-5xl">🛑</span>
            <span>Stop Timesheet</span>
          </button>

          {/* Tools & Consumable */}
          <button
            onClick={() => toast.info('Tools & Consumable - Coming Soon')}
            className={btnPrimary}
          >
            <span className="text-4xl sm:text-5xl">🔧</span>
            <span>Tools &amp; Consumable</span>
          </button>
        </div>

        {/* External Scanner Input */}
        {mode === 'external' && (
          <div className="w-full max-w-[360px] landscape:max-w-[680px] mt-4">
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="SCAN ID"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={handleScannerInput}
              className="w-full px-3 py-2.5 text-base sm:text-lg text-center
                         bg-white border border-slate-200 text-slate-800 placeholder-slate-400
                         rounded-xl outline-none shadow-sm transition-all
                         focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
            />
          </div>
        )}
      </main>

      {/* ── Unprod Mode Panel ── */}
      {showUnprodPanel && (
        <UnprodPanel
          panelRef={unprodPanelRef}
          onSelect={handleUnprodPanelSelect}
        />
      )}

      {/* ── Status Bar / Footer ── */}
      <footer className="flex-shrink-0 flex items-center justify-between
                         bg-white border-t border-slate-200 px-4 py-2
                         text-xs md:text-sm text-slate-600">
        <div className="flex-1 text-left truncate">
          Status: <span className="font-semibold text-slate-800">{status}</span>
        </div>
        <div className="flex-1 text-center text-slate-400">
          Ver: <span className="font-semibold">2.2.0</span>
        </div>
        <div className="flex-1 text-right">
          ID: <span className="font-semibold text-slate-800">{nfcId}</span>
        </div>
      </footer>
    </div>
  );
};  

export default LoginTimesheetPage;
