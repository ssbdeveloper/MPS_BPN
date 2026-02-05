import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Landing Page - Main Menu
 * Design: Clean white background dengan accent warna biru muda & kuning
 */
const LandingPage = () => {
  const navigate = useNavigate();

  const menuItems = [
    {
      title: 'TIMESHEET',
      icon: '📋',
      path: '/login-timesheet',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    },
    {
      title: 'DASHBOARD',
      icon: '📊',
      path: '/dashboard',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    },
    {
      title: 'TIMESHEET VALIDATION',
      icon: '✅',
      path: '/timesheet-validation',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    },
    {
      title: 'DOWNLOAD DATA',
      icon: '📥',
      path: '/download',
      color: 'from-orange-400 to-orange-500',
      bgHover: 'hover:from-orange-500 hover:to-orange-600'
    },
    {
      title: 'USER REGISTRATION',
      icon: '👤',
      path: '/nfc-users',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    },
    {
      title: 'SETTING',
      icon: '⚙️',
      path: '/setting',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    },
    {
      title: 'COMPONENT TRACKING',
      icon: '📦',
      path: '/component-tracking',
      color: 'from-blue-400 to-blue-500',
      bgHover: 'hover:from-blue-500 hover:to-blue-600'
    }
  ];

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
                <div className="relative text-5xl sm:text-6xl transform group-hover:scale-110 transition-transform duration-200">
                  {item.icon}
                </div>

                {/* Title */}
                <h2 className="relative text-base sm:text-lg font-bold tracking-wide text-center">
                  {item.title}
                </h2>

                {/* Arrow */}
                <div className="absolute bottom-4 right-4 text-2xl opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                  →
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
