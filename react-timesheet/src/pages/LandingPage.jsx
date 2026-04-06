import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, BarChart2, CheckCircle, Download, User, Settings, Package, BookOpen } from 'lucide-react';

/**
 * Landing Page - Main Menu
 * Design: Clean white background dengan accent warna biru muda & kuning
 * Password verification required setiap kali load halaman
 */

const ADMIN_PASSWORD = 'adminssbuye';

const LandingPage = () => {
  const navigate = useNavigate();
  const [isVerified, setIsVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef(null);

// Cek apakah user sudah pernah verifikasi di tab ini
useEffect(() => {
  const flag = sessionStorage.getItem("isVerified");
  if (flag === "true") {
    setIsVerified(true);
  }
}, []);


  // Auto-focus password input on mount
  useEffect(() => {
    if (!isVerified && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isVerified]);

  const handleVerify = (e) => {
  e.preventDefault();

  // ✅ TAMBAHAN: kalau kosong langsung redirect
  if (!password || password.trim() === "") {
    navigate('/login-timesheet');
    return;
  }

  if (password === ADMIN_PASSWORD) {
  setIsVerified(true);
  setError('');

  // ✅ SIMPAN FLAG GLOBAL
  sessionStorage.setItem("isVerified", "true");
} else {
    setError('Password salah!');
    setPassword('');

    // Redirect ke login-timesheet setelah brief delay
    setTimeout(() => {
      navigate('/login-timesheet');
    }, 1000);
  }
};


  const menuItems = [
    {
      title: 'TIMESHEET',
      icon: ClipboardList,
      path: '/login-timesheet',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    },
    {
      title: 'DASHBOARD',
      icon: BarChart2,
      path: '/dashboard',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    },
    {
      title: 'TIMESHEET VALIDATION',
      icon: CheckCircle,
      path: '/timesheet-validation',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    },
    {
      title: 'DOWNLOAD DATA',
      icon: Download,
      path: '/download',
      color: 'from-orange-400 to-orange-500',
      bgHover: 'hover:from-orange-500 hover:to-orange-600'
    },
    {
      title: 'USER REGISTRATION',
      icon: User,
      path: '/nfc-users',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    },
    {
      title: 'SETTING',
      icon: Settings,
      path: '/setting',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    },
    {
      title: 'COMPONENT TRACKING',
      icon: Package,
      path: '/component-tracking',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    },
    {
      title: 'ORDER LIST',
      icon: ClipboardList,
      path: '/sow-orders',
      color: 'from-orange-400 to-orange-500',
      bgHover: 'hover:from-orange-500 hover:to-orange-600'
    },
    {
      title: 'SOW MANAGEMENT',
      icon: BookOpen,
      path: '/sow-management/list',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    }
  ];

  // Password verification overlay
  if (!isVerified) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-orange-50 flex items-center justify-center relative overflow-hidden">
        {/* Background Decorations */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 -translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-orange-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-x-1/2 -translate-y-1/2"></div>

        {/* Password Panel */}
        <div className="relative z-10 w-full max-w-sm mx-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-blue-100 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-5 text-center">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white">Admin Verification</h2>
              <p className="text-blue-100 text-sm mt-1">Masukkan password untuk melanjutkan, Atau tekan Masuk tanpa Password untuk masuk ke Timesheet App</p>
            </div>

            {/* Form */}
            <form onSubmit={handleVerify} className="px-6 py-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-blue-900 mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    ref={inputRef}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    placeholder="Enter admin password"
                    className="w-full px-4 py-3 text-sm text-gray-800 border-2 border-blue-200 rounded-xl focus:outline-none focus:border-blue-500 bg-blue-50/50 pr-12 transition-colors"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-600 transition-colors"
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-red-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  <span className="text-sm font-medium text-red-700">{error}</span>
                  <span className="text-xs text-red-400 ml-auto">Redirecting...</span>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                className="w-full py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
              >
                Masuk
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-orange-50 flex flex-col relative overflow-hidden">
      {/* Background Decorations - Soft Blue & Orange Blur */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 -translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute top-0 right-0 w-96 h-96 bg-orange-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-blue-300 rounded-full mix-blend-multiply filter blur-3xl opacity-15 translate-y-1/2"></div>

      {/* Header */}
      <header className="relative z-10 px-6 py-4 border-b border-blue-100 bg-white/80 backdrop-blur-sm shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Logo - Replace logo.png di public folder dengan logo perusahaan */}
            <img
              src="/logo.png"
              alt="MPS Logo"
              className="w-12 h-12 object-contain"
              onError={(e) => {
                // Fallback ke dummy logo jika logo.png tidak ada
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
            {/* Fallback Logo */}
            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-lg hidden">
              M
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
              MPS SSB
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content - Menu Buttons */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-5xl">
          {/* Menu Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {menuItems.map((item, index) => (
              <button
                key={index}
                onClick={() => navigate(item.path)}
                className={`
                  group relative bg-gradient-to-br ${item.color}
                  ${item.bgHover}
                  text-white rounded-2xl p-6
                  shadow-lg hover:shadow-2xl
                  transition-all duration-200 transform hover:scale-105
                  cursor-pointer border-none
                  flex flex-col items-center justify-center gap-3
                  min-h-[160px]
                  overflow-hidden
                `}
              >
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-10">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white rounded-full -translate-y-1/2 translate-x-1/2"></div>
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-white rounded-full translate-y-1/2 -translate-x-1/2"></div>
                </div>

                {/* Icon */}
                <div className="relative transform group-hover:scale-110 transition-transform duration-200">
                  <item.icon className="w-14 h-14 sm:w-16 sm:h-16" />
                </div>

                {/* Title */}
                <h2 className="relative text-base sm:text-lg font-bold tracking-wide text-center">
                  {item.title}
                </h2>

                {/* Arrow */}
                <div className="absolute bottom-4 right-4 text-2xl opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                  {'\u2192'}
                </div>
              </button>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-6 py-4 border-t border-blue-100 bg-gradient-to-r from-slate-50 to-blue-50 backdrop-blur-sm shadow-sm">
        <div className="max-w-7xl mx-auto">
          <p className="text-center text-sm text-slate-600">
            Version 2.0.0 - MPS Manufacturing System
          </p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
