import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Login Timesheet Page
 * Halaman untuk scan NFC/ID karyawan sebelum masuk timesheet
 * Converted dari MPS2/UI/index.html
 */
const LoginTimesheetPage = () => {
  const navigate = useNavigate();

  // States
  const [mode, setMode] = useState(() => sessionStorage.getItem('scanMode') || 'internal');
  const [selectedAction, setSelectedAction] = useState(() => sessionStorage.getItem('scanAction') || 'start');
  const [status, setStatus] = useState('Idle');
  const [nfcId, setNfcId] = useState('-');
  const [scanInput, setScanInput] = useState('');

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
      const res = await fetch(`/usernfc/nfcid/${nfcid}`);
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
      const res = await fetch('/usernfc/checkout', {
        method: 'POST',
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

        // Handle action
        if (action === 'start') {
          sessionStorage.setItem('datakaryawan', JSON.stringify(user));
          setStatus('Login berhasil, redirect...');
          setTimeout(() => navigate('/timesheet-mainmenu'), 500);
        } else if (action === 'stop') {
          const success = await stopAllByNfc(nfcid);
          if (success) {
            setStatus('Timesheet dihentikan');
            alert('Timesheet berhasil dihentikan!');
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
    setSelectedAction(action);
    sessionStorage.setItem('scanAction', action);
    handleNfcScan(action);
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

    // Handle action
    if (selectedAction === 'stop') {
      const success = await stopAllByNfc(id);
      if (success) {
        setStatus('Timesheet dihentikan');
        alert('Timesheet berhasil dihentikan!');
      } else {
        setStatus('Gagal menghentikan timesheet');
      }
      return;
    }

    sessionStorage.setItem('datakaryawan', JSON.stringify(user));
    setStatus('Login berhasil, redirect...');

    if (selectedAction === 'unprod') {
      setTimeout(() => navigate('/unproductive'), 500);
    } else {
      setTimeout(() => navigate('/timesheet-mainmenu'), 500);
    }
  };

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

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Header - Dark Blue */}
      <header className="flex justify-between items-center bg-blue-900 text-white px-3 py-2 sm:py-2.5 shadow-md flex-shrink-0">
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
                absolute inset-0 rounded-full transition-colors duration-300
                ${mode === 'external' ? 'bg-green-500' : 'bg-gray-400'}
                before:content-[''] before:absolute before:h-4 before:w-4 sm:before:h-5 sm:before:w-5
                before:left-0.5 before:bottom-0.5 before:bg-white before:rounded-full
                before:transition-transform before:duration-300
                ${mode === 'external' ? 'before:translate-x-5 sm:before:translate-x-6' : 'before:translate-x-0'}
              `}
            />
          </label>
        </div>
      </header>

      {/* Main Content - Flexible space */}
      <main className="flex-1 flex flex-col justify-center items-center px-3 py-2 overflow-hidden">
        {/* Menu Buttons - Centered */}
        <div className="w-full max-w-[280px] portrait:max-w-[280px] landscape:max-w-[600px] grid grid-cols-2 portrait:grid-cols-2 landscape:grid-cols-4 gap-2 sm:gap-3">
          {/* Productive Button - Blue 90% opacity with 3D effect */}
          <button
            onClick={() => handleButtonClick('start')}
            disabled={selectedAction === 'start'}
            className={`
              aspect-square flex flex-col items-center justify-center gap-0.5 sm:gap-1
              text-[10px] sm:text-xs font-bold rounded transition-all duration-150 transform
              ${selectedAction === 'start'
                ? 'bg-blue-400 shadow-inner opacity-60 translate-y-1 cursor-not-allowed'
                : 'bg-gradient-to-b from-blue-600 to-blue-700 text-white shadow-lg hover:shadow-xl active:shadow-md active:translate-y-1 hover:from-blue-700 hover:to-blue-800'
              }
            `}
            style={selectedAction !== 'start' ? { boxShadow: '0 6px 16px -2px rgba(37, 99, 235, 0.6), 0 4px 8px -1px rgba(0, 0, 0, 0.3)', opacity: '0.9' } : {}}
          >
            <span className="text-xl sm:text-2xl">✅</span>
            <span>Productive</span>
          </button>

          {/* Unproductive Button - Blue 90% opacity with 3D effect */}
          <button
            onClick={() => handleButtonClick('unprod')}
            disabled={selectedAction === 'unprod'}
            className={`
              aspect-square flex flex-col items-center justify-center gap-0.5 sm:gap-1
              text-[10px] sm:text-xs font-bold rounded transition-all duration-150 transform
              ${selectedAction === 'unprod'
                ? 'bg-blue-400 shadow-inner opacity-60 translate-y-1 cursor-not-allowed'
                : 'bg-gradient-to-b from-blue-600 to-blue-700 text-white shadow-lg hover:shadow-xl active:shadow-md active:translate-y-1 hover:from-blue-700 hover:to-blue-800'
              }
            `}
            style={selectedAction !== 'unprod' ? { boxShadow: '0 6px 16px -2px rgba(37, 99, 235, 0.6), 0 4px 8px -1px rgba(0, 0, 0, 0.3)', opacity: '0.9' } : {}}
          >
            <span className="text-xl sm:text-2xl">⚠️</span>
            <span>Unproductive</span>
          </button>

          {/* Stop Timesheet Button - Blue 90% opacity with 3D effect */}
          <button
            onClick={() => handleButtonClick('stop')}
            disabled={selectedAction === 'stop'}
            className={`
              aspect-square flex flex-col items-center justify-center gap-0.5 sm:gap-1
              text-[10px] sm:text-xs font-bold rounded transition-all duration-150 transform
              ${selectedAction === 'stop'
                ? 'bg-blue-400 shadow-inner opacity-60 translate-y-1 cursor-not-allowed'
                : 'bg-gradient-to-b from-blue-600 to-blue-700 text-white shadow-lg hover:shadow-xl active:shadow-md active:translate-y-1 hover:from-blue-700 hover:to-blue-800'
              }
            `}
            style={selectedAction !== 'stop' ? { boxShadow: '0 6px 16px -2px rgba(37, 99, 235, 0.6), 0 4px 8px -1px rgba(0, 0, 0, 0.3)', opacity: '0.9' } : {}}
          >
            <span className="text-xl sm:text-2xl">🛑</span>
            <span>Stop Timesheet</span>
          </button>

          {/* Tools & Consumable Button - Blue 90% opacity with 3D effect */}
          <button
            className="aspect-square flex flex-col items-center justify-center gap-0.5 sm:gap-1
            text-[10px] sm:text-xs font-bold rounded transition-all duration-150 transform
            bg-gradient-to-b from-blue-600 to-blue-700 text-white shadow-lg hover:shadow-xl active:shadow-md active:translate-y-1
            hover:from-blue-700 hover:to-blue-800"
            style={{ boxShadow: '0 6px 16px -2px rgba(37, 99, 235, 0.6), 0 4px 8px -1px rgba(0, 0, 0, 0.3)', opacity: '0.9' }}
            onClick={() => alert('Tools & Consumable - Coming Soon')}
          >
            <span className="text-xl sm:text-2xl">🔧</span>
            <span>Tools & Consumable</span>
          </button>
        </div>

        {/* External Scanner Input */}
        {mode === 'external' && (
          <div className="w-full max-w-[280px] portrait:max-w-[280px] landscape:max-w-[600px] mt-2">
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="SCAN ID"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={handleScannerInput}
              className="w-full px-2 py-1 sm:py-1.5 text-base sm:text-lg text-center border-2 border-gray-300 rounded bg-white outline-none focus:border-blue-500 shadow-md"
            />
          </div>
        )}
      </main>

      {/* Status Bar - Fixed height */}
      <footer className="flex items-center justify-between bg-gray-200 px-3 py-2 text-xs md:text-sm text-gray-800 flex-shrink-0">
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
