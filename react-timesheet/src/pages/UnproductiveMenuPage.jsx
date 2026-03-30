import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

/**
 * Unproductive Menu Page
 * Converted from unprodmenu.html
 * Shows list of unproductive activity codes for timesheet
 * Connected to real API: checkout → create unprod entry
 * Color scheme: White 65%, Blue 25% (90% opacity), Orange 10%
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

// Icon mapping for each unprod code
const UNPROD_ICONS = {
  '1510': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  '1520': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  '1530': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" />
    </svg>
  ),
  '1540': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  '1550': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  '1560': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
    </svg>
  ),
  '1570': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
    </svg>
  ),
  '1580': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  '1590': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  ),
  '1610': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  ),
  '1620': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  '1630': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
    </svg>
  ),
  '1640': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  '1650': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  '1660': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  '1670': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  ),
  '1680': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
    </svg>
  ),
};

const UnproductiveMenuPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  // Unproductive codes data
  const unprodCodes = [
    { code: '1510', label: 'BRIEFING' },
    { code: '1520', label: 'COFFEE BREAKS' },
    { code: '1530', label: 'HOUSEKEEPING' },
    { code: '1540', label: 'TRAINING' },
    { code: '1550', label: 'WAITING FOR MATERIAL' },
    { code: '1560', label: 'WAITING FOR NCR' },
    { code: '1570', label: 'WAITING FOR ENGINEERING' },
    { code: '1580', label: 'WAITING FOR INSPECTION' },
    { code: '1590', label: 'WAITING FOR HANDLING' },
    { code: '1610', label: 'JIGS & FIXTURES' },
    { code: '1620', label: 'TOOL PREPARATION' },
    { code: '1630', label: 'MAINTENANCE' },
    { code: '1640', label: 'LABOUR NECESSITY' },
    { code: '1650', label: 'MACHINE / ELECTRICITY BREAKDOWN' },
    { code: '1660', label: 'DAILY PM' },
    { code: '1670', label: 'WAITING FOR JOB' },
    { code: '1680', label: 'OTHERS' },
  ];

  // Handle unprod code selection — real API calls
  const handleUnprodSelect = async (code, label) => {
    if (loading) return;

    try {
      setLoading(true);

      // Get employee data from sessionStorage
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));

      if (!datakaryawan || !datakaryawan.snssb || !datakaryawan.full_name) {
        toast.error('Data karyawan tidak lengkap!');
        setLoading(false);
        return;
      }

      // 1. Checkout current timesheet (if any open)
      await fetch(`${API_BASE}/timesheet/checkout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datakaryawan: { sn: datakaryawan.snssb }
        })
      });
      // Checkout may return 404 if no open timesheet — that's fine, continue

      // 2. Create new unprod timesheet entry
      const operation_text = `${code} ${label}`;

      const res = await fetch(`${API_BASE}/timesheet/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_unprod: code,
          serialnumber: datakaryawan.snssb,
          full_name: datakaryawan.full_name,
          operation_text: operation_text,
          workcentercode: datakaryawan.workcenter || '',
          workcenterdescription: datakaryawan.machinename || ''
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Gagal membuat unproductive entry');
      }

      toast.success(`${label} berhasil dicatat!`);
      setTimeout(() => navigate('/login-timesheet'), 800);

    } catch (err) {
      console.error('Error creating unprod entry:', err);
      toast.error('Terjadi kesalahan', { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Handle back button
  const handleBack = () => {
    navigate('/login-timesheet');
  };

  // Handle refresh
  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="h-screen w-screen bg-slate-50 flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <header className="flex-shrink-0 flex items-center justify-between
                         px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm">
        <button
          onClick={handleBack}
          disabled={loading}
          className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold
                     bg-white border border-slate-200 text-slate-700
                     hover:bg-slate-50 hover:border-slate-300 transition-all duration-150
                     active:scale-95 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Back
        </button>
        <h1 className="text-sm font-extrabold text-slate-800">Unproductive Menu</h1>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold
                     bg-white border border-slate-200 text-slate-700
                     hover:bg-slate-50 hover:border-slate-300 transition-all duration-150
                     active:scale-95 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Refresh
        </button>
      </header>

      {/* ── Button Grid ── */}
      <main className="flex-1 min-h-0 p-2 sm:p-3">
        <div className="h-full grid grid-cols-3 landscape:grid-cols-4 gap-1.5 sm:gap-2 max-w-6xl mx-auto auto-rows-fr">
          {unprodCodes.map((item) => (
            <button
              key={item.code}
              onClick={() => handleUnprodSelect(item.code, item.label)}
              disabled={loading}
              className="flex flex-col items-center justify-center gap-0.5
                         rounded-xl transition-all duration-150
                         bg-white border border-slate-200 text-slate-800
                         shadow-sm hover:shadow-md hover:border-[#00b4d8] hover:bg-[#caf0f8]
                         active:scale-95 active:bg-[#ade8f4]
                         disabled:opacity-50 disabled:cursor-not-allowed
                         px-1.5 py-1 min-h-0 overflow-hidden"
            >
              <div className="flex-shrink-0" style={{ color: '#0096c7' }}>
                {UNPROD_ICONS[item.code]}
              </div>
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-800 leading-tight text-center break-words w-full line-clamp-2">
                {item.label}
              </span>
              <span className="text-[8px] sm:text-[9px] font-mono text-slate-400 flex-shrink-0">{item.code}</span>
            </button>
          ))}
        </div>
      </main>

      {/* ── Loading Overlay ── */}
      {loading && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 flex flex-col items-center gap-3">
            <div className="animate-spin w-10 h-10 border-4 border-t-transparent rounded-full"
                 style={{ borderColor: '#caf0f8', borderTopColor: '#0096c7' }} />
            <p className="text-sm font-semibold text-slate-700">Processing...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnproductiveMenuPage;
