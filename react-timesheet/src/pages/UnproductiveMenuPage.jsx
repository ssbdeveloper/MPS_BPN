import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Unproductive Menu Page
 * Converted from unprodmenu.html
 * Shows list of unproductive activity codes for timesheet
 * Features:
 * - Grid layout of unproductive codes
 * - 3D button effects with press animation
 * - Auto checkout current timesheet and create new unprod entry
 * - Color scheme: White 65%, Blue 25% (90% opacity), Orange 10%
 */
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

  // Handle unprod code selection
  const handleUnprodSelect = async (code, label) => {
    if (loading) return;

    try {
      setLoading(true);

      // Get employee data from sessionStorage
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));

      if (!datakaryawan || !datakaryawan.snssb || !datakaryawan.full_name) {
        alert('❌ Data karyawan tidak lengkap!');
        setLoading(false);
        return;
      }

      // 1. Checkout current timesheet
      // PRODUCTION: Uncomment this
      // const checkoutRes = await fetch('/timesheet/checkout', {
      //   method: 'PUT',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     datakaryawan: { sn: datakaryawan.snssb }
      //   })
      // });
      // if (!checkoutRes.ok) throw new Error('Gagal checkout');

      // DEVELOPMENT: Simulate checkout
      console.log('Checkout current timesheet for:', datakaryawan.snssb);

      // 2. Create new unprod timesheet entry
      const operation_text = `${code} ${label}`;

      // PRODUCTION: Uncomment this
      // const unprodRes = await fetch('/timesheet/', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     id_unprod: code,
      //     serialnumber: datakaryawan.snssb,
      //     full_name: datakaryawan.full_name,
      //     operation_text: operation_text,
      //     workcentercode: datakaryawan.workcenter || '',
      //     workcenterdescription: datakaryawan.machinename || ''
      //   })
      // });
      // if (!unprodRes.ok) throw new Error('Gagal input unprod');

      // DEVELOPMENT: Simulate success
      console.log('Creating unprod entry:', {
        id_unprod: code,
        operation_text: operation_text,
        serialnumber: datakaryawan.snssb
      });

      alert('✅ TIMESHEET berhasil!');
      navigate('/login-timesheet');

    } catch (err) {
      console.error('Error creating unprod entry:', err);
      alert(`❌ Terjadi kesalahan: ${err.message}`);
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
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Header - Dark Blue */}
      <header className="flex justify-between items-center bg-blue-900 px-4 py-3 shadow-md flex-shrink-0">
        <button
          onClick={handleBack}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium bg-blue-700 text-white rounded shadow-lg hover:shadow-xl active:shadow-sm active:translate-y-1 transition-all duration-150 transform disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold text-white">Unproductive Menu</h1>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium bg-blue-700 text-white rounded shadow-lg hover:shadow-xl active:shadow-sm active:translate-y-1 transition-all duration-150 transform disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
        >
          🔄
        </button>
      </header>

      {/* Main Content - Button Grid */}
      <main className="flex-1 overflow-auto p-3">
        <div className="grid grid-cols-2 portrait:grid-cols-2 landscape:grid-cols-4 gap-2 sm:gap-3 max-w-6xl mx-auto">
          {unprodCodes.map((item) => (
            <button
              key={item.code}
              onClick={() => handleUnprodSelect(item.code, item.label)}
              disabled={loading}
              className="aspect-square flex flex-col items-center justify-center gap-1 sm:gap-2
                text-[10px] sm:text-xs font-bold rounded transition-all duration-150 transform
                bg-gradient-to-b from-blue-600 to-blue-700 text-white shadow-lg hover:shadow-xl
                active:shadow-md active:translate-y-1 hover:from-blue-700 hover:to-blue-800
                disabled:opacity-50 disabled:cursor-not-allowed p-2"
              style={{
                boxShadow: '0 6px 16px -2px rgba(37, 99, 235, 0.6), 0 4px 8px -1px rgba(0, 0, 0, 0.3)',
                opacity: '0.9'
              }}
            >
              <span className="text-base sm:text-lg font-mono">{item.code}</span>
              <span className="text-center leading-tight break-words w-full">{item.label}</span>
            </button>
          ))}
        </div>

        {/* Loading Overlay */}
        {loading && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-2xl p-6 flex flex-col items-center gap-3">
              <div className="animate-spin w-12 h-12 border-4 border-blue-900 border-t-transparent rounded-full"></div>
              <p className="text-blue-900 font-medium">Processing...</p>
            </div>
          </div>
        )}
      </main>

      {/* Footer - Info */}
      <footer className="bg-gray-200 px-4 py-2 text-xs text-gray-800 flex-shrink-0 text-center">
        Select unproductive activity code
      </footer>
    </div>
  );
};

export default UnproductiveMenuPage;
