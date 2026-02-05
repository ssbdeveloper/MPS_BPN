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
      color: 'from-cyan-400 to-cyan-500',
      bgHover: 'hover:from-cyan-500 hover:to-cyan-600'
    },
    {
      title: 'SETTING',
      icon: '⚙️',
      path: '/setting',
      color: 'from-blue-300 to-blue-400',
      bgHover: 'hover:from-blue-400 hover:to-blue-500'
    },
    {
      title: 'COMPONENT TRACKING',
      icon: '📦',
      path: '/component-tracking',
      color: 'from-yellow-400 to-yellow-500',
      bgHover: 'hover:from-yellow-500 hover:to-yellow-600'
    }
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col relative overflow-hidden">
      {/* Background Decorations - Biru Muda & Kuning Blur */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 -translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute top-0 right-0 w-96 h-96 bg-yellow-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-blue-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-y-1/2"></div>

      {/* Header */}
      <header className="relative z-10 px-6 py-4 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
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
            <h1 className="text-2xl font-bold text-gray-800">
              MPS SSB
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content - Menu Buttons */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl">
          {/* Menu Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {menuItems.map((item, index) => (
              <button
                key={index}
                onClick={() => navigate(item.path)}
                className={`
                  group relative bg-gradient-to-br ${item.color}
                  ${item.bgHover}
                  text-white rounded-2xl p-8
                  shadow-xl hover:shadow-2xl
                  transition-all duration-300 transform hover:-translate-y-2
                  cursor-pointer border-none
                  flex flex-col items-center justify-center gap-4
                  min-h-[180px]
                  overflow-hidden
                `}
              >
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-10">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white rounded-full -translate-y-1/2 translate-x-1/2"></div>
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-white rounded-full translate-y-1/2 -translate-x-1/2"></div>
                </div>

                {/* Icon */}
                <div className="relative text-7xl transform group-hover:scale-110 transition-transform duration-300">
                  {item.icon}
                </div>

                {/* Title */}
                <h2 className="relative text-xl font-bold tracking-wide text-center">
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
      <footer className="relative z-10 px-6 py-4 border-t border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto">
          <p className="text-center text-sm text-gray-600">
            Version 2.0.0 - MPS Manufacturing System
          </p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
