import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Timesheet Main Menu Page
 * Converted dari mainmenu.html + previewdata.js + script.js + postdata.js
 */
const API_BASE = import.meta.env.VITE_API_URL || '';

const TimesheetMainMenuPage = () => {
  const navigate = useNavigate();

  // States - Load mode from sessionStorage
  const [mode, setMode] = useState(() => {
    return sessionStorage.getItem('timesheetMode') || 'single';
  }); // 'single' or 'multiple'
  const [userData, setUserData] = useState({
    name: '-',
    sn: '-',
    workcenter: '-',
    order: '-',
    activity: '-'
  });

  // Load data from sessionStorage
  useEffect(() => {
    const selectedactivity = JSON.parse(sessionStorage.getItem('selectedactivity'));
    const selectedmesinku = JSON.parse(sessionStorage.getItem('selectedmesinku'));
    const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));

    const newData = {
      name: '-',
      sn: '-',
      workcenter: '-',
      order: '-',
      activity: '-'
    };

    // Set nama dan SN
    if (datakaryawan) {
      newData.name = datakaryawan.full_name || '-';
      newData.sn = datakaryawan.snssb || '-';
      newData.workcenter = datakaryawan.workcenter && datakaryawan.machinename
        ? `${datakaryawan.workcenter}\n${datakaryawan.machinename}`
        : '-';
    }

    // Set order dan activity
    if (selectedactivity) {
      newData.order = selectedactivity.order || '-';
      newData.activity = selectedactivity.operationtext && selectedactivity.operation_no
        ? `${selectedactivity.operationtext}\nSequence : ${selectedactivity.operation_no}`
        : '-';
    }

    setUserData(newData);
  }, []);

  // Handle mode switch
  const handleModeChange = (checked) => {
    const newMode = checked ? 'multiple' : 'single';
    setMode(newMode);
    sessionStorage.setItem('timesheetMode', newMode);
  };

  // Navigation functions
  const goHome = () => {
    navigate('/login-timesheet');
  };

  const gotojob = () => {
    navigate('/select-job');
  };

  const gotomesin = () => {
    navigate('/select-machine');
  };

  const gotoparameter = () => {
    navigate('/process-control');
  };

  const gotots = () => {
    navigate('/view-timesheet');
  };

  // Refresh page
  const handleRefresh = () => {
    window.location.reload();
  };

  // Start button - Create timesheet
  const postdata = async () => {
    try {
      const selectedactivity = JSON.parse(sessionStorage.getItem('selectedactivity'));
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));

      if (!selectedactivity || !datakaryawan) {
        alert('❌ Data tidak lengkap. Silakan pilih activity dan karyawan.');
        return;
      }

      if (mode === 'single') {
        // CHECKOUT menggunakan endpoint unified (serialnumber)
        const checkoutRes = await fetch(`${API_BASE}/timesheet/checkout`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            datakaryawan: { sn: datakaryawan.snssb }
          }),
        });

        const checkedOut = await checkoutRes.json();
        console.log('Checkout sukses:', checkedOut);

        // CREATE timesheet baru
        const postRes = await fetch(`${API_BASE}/timesheet/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            production_order: selectedactivity.order,
            ssbr_ident: selectedactivity.ssbr_id,
            serialnumber: datakaryawan.snssb,
            full_name: datakaryawan.full_name,
            operation_no: selectedactivity.operation_no,
            operation_text: selectedactivity.operationtext,
            workcentercode: datakaryawan.workcenter,
            workcenterdescription: datakaryawan.machinename,
          }),
        });

        if (!postRes.ok) {
          const error = await postRes.json();
          console.error('Gagal POST:', error);
          alert(`❌ Buat timesheet gagal: ${error.error || 'Unknown error'}`);
          return;
        }

        const created = await postRes.json();
        console.log('Timesheet created:', created);

        alert('✅ TIMESHEET berhasil dibuat!');
        navigate('/login-timesheet');

      } else {
        // MODE MULTIPLE - hanya create tanpa checkout
        const postRes = await fetch(`${API_BASE}/timesheet/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            production_order: selectedactivity.order,
            ssbr_ident: selectedactivity.ssbr_id,
            serialnumber: datakaryawan.snssb,
            full_name: datakaryawan.full_name,
            operation_no: selectedactivity.operation_no,
            operation_text: selectedactivity.operationtext,
            workcentercode: datakaryawan.workcenter,
            workcenterdescription: datakaryawan.machinename,
          }),
        });

        if (!postRes.ok) {
          const error = await postRes.json();
          console.error('Gagal POST:', error);
          alert(`❌ Buat timesheet gagal: ${error.error || 'Unknown error'}`);
          return;
        }

        const created = await postRes.json();
        console.log('Timesheet created:', created);

        alert('✅ TIMESHEET berhasil dibuat!');
        // Tidak redirect, biarkan user create multiple
      }

    } catch (err) {
      console.error('Error postdata:', err);
      alert(`❌ Terjadi kesalahan: ${err.message}`);
    }
  };

  // Finish button - Update activity status
  const finish = async () => {
    const selectedactivity = JSON.parse(sessionStorage.getItem('selectedactivity'));

    if (!selectedactivity) {
      alert('❌ Tidak ada activity yang dipilih');
      return;
    }

    try {
      const postRes = await fetch(`${API_BASE}/sow/finish/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedactivity: {
            production_order: selectedactivity.order,
            operation_no: selectedactivity.operation_no,
          },
        }),
      });

      if (!postRes.ok) {
        const error = await postRes.json();
        throw new Error(error.error || 'Gagal update status');
      }

      const updated = await postRes.json();
      console.log('Update sukses:', updated);

      alert('✅ Update FINISH berhasil!');

      // Clear UI
      sessionStorage.removeItem('selectedactivity');
      setUserData(prev => ({
        ...prev,
        order: '-',
        activity: '-'
      }));

    } catch (err) {
      console.error('Error finish:', err);
      alert(`❌ ${err.message}`);
    }
  };

  // Rework button
  const handleRework = () => {
    alert('Rework feature - Coming Soon');
  };

  // Consumable button
  const handleConsumable = () => {
    alert('Consumable feature - Coming Soon');
  };

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-blue-50 via-white to-orange-50 flex flex-col overflow-hidden">
      {/* Header - Corporate Blue */}
      <header className="flex justify-between items-center bg-gradient-to-r from-blue-600 to-blue-700 px-3 py-2.5 shadow-lg flex-shrink-0 gap-2">
        <button
          onClick={goHome}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-white/20 text-white rounded-lg hover:bg-white/30 transition-all backdrop-blur-sm"
        >
          Back
        </button>

        {/* Mode Switch */}
        <div className="flex items-center gap-2">
          <label className="relative inline-block w-10 h-5 sm:w-12 sm:h-6 cursor-pointer">
            <input
              type="checkbox"
              checked={mode === 'multiple'}
              onChange={(e) => handleModeChange(e.target.checked)}
              className="hidden"
            />
            <span
              className={`
                absolute inset-0 rounded-full transition-colors duration-300 shadow-inner
                ${mode === 'multiple' ? 'bg-gradient-to-r from-blue-400 to-blue-500' : 'bg-gradient-to-r from-slate-300 to-slate-400'}
                before:content-[''] before:absolute before:h-4 before:w-4 sm:before:h-5 sm:before:w-5
                before:left-0.5 before:bottom-0.5 before:bg-white before:rounded-full before:shadow-md
                before:transition-transform before:duration-300
                ${mode === 'multiple' ? 'before:translate-x-5 sm:before:translate-x-6' : 'before:translate-x-0'}
              `}
            />
          </label>
          <span className="text-xs sm:text-sm font-medium text-white">
            {mode === 'single' ? 'Single' : 'Multiple'}
          </span>
        </div>

        <button
          onClick={handleRefresh}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-white/20 text-white rounded-lg hover:bg-white/30 transition-all backdrop-blur-sm"
        >
          Refresh
        </button>
      </header>

      {/* Main Content - Soft Background */}
      <main className="flex-1 flex flex-row gap-3 p-3 overflow-hidden">
        {/* Info Box - Left side - Soft Card */}
        <section className="flex-1 bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/50 p-3 flex flex-col overflow-hidden min-h-0">
          {/* Info Rows - flex-1 with min-h-0 to prevent overflow */}
          <div className="flex-1 min-h-0 flex flex-col gap-1.5">
            {/* Nama */}
            <div className="flex flex-col gap-0.5 min-h-0">
              <span className="text-[11px] font-semibold text-blue-700 flex-shrink-0">Nama</span>
              <div className="text-[11px] sm:text-xs font-semibold text-slate-700 bg-gradient-to-br from-blue-50 to-blue-100 px-2.5 py-1.5 rounded-lg border border-blue-200 shadow-sm break-words flex-shrink-0">
                {userData.name}
              </div>
            </div>

            {/* SN */}
            <div className="flex flex-col gap-0.5 min-h-0">
              <span className="text-[11px] font-semibold text-blue-700 flex-shrink-0">SN</span>
              <div className="text-[11px] sm:text-xs font-semibold text-slate-700 bg-gradient-to-br from-blue-50 to-blue-100 px-2.5 py-1.5 rounded-lg border border-blue-200 shadow-sm flex-shrink-0">
                {userData.sn}
              </div>
            </div>

            {/* Work Center */}
            <div className="flex flex-col gap-0.5 min-h-0">
              <span className="text-[11px] font-semibold text-blue-700 flex-shrink-0">Work Center</span>
              <div className="text-[11px] sm:text-xs font-semibold text-slate-700 bg-gradient-to-br from-blue-50 to-blue-100 px-2.5 py-1.5 rounded-lg border border-blue-200 shadow-sm whitespace-pre-line flex-shrink-0">
                {userData.workcenter}
              </div>
            </div>

            {/* Order */}
            <div className="flex flex-col gap-0.5 min-h-0">
              <span className="text-[11px] font-semibold text-blue-700 flex-shrink-0">Order</span>
              <div className="text-[11px] sm:text-xs font-semibold text-slate-700 bg-gradient-to-br from-blue-50 to-blue-100 px-2.5 py-1.5 rounded-lg border border-blue-200 shadow-sm flex-shrink-0">
                {userData.order}
              </div>
            </div>

            {/* Activity */}
            <div className="flex flex-col gap-0.5 flex-1 min-h-0">
              <span className="text-[11px] font-semibold text-blue-700 flex-shrink-0">Activity</span>
              <div className="text-[11px] sm:text-xs font-semibold text-slate-700 whitespace-pre-line overflow-auto bg-gradient-to-br from-blue-50 to-blue-100 px-2.5 py-1.5 rounded-lg border border-blue-200 shadow-sm flex-1 min-h-0">
                {userData.activity}
              </div>
            </div>
          </div>

          {/* Bottom Actions inside info box */}
          <div className="flex gap-2 mt-2 pt-2 border-t border-blue-200 flex-shrink-0">
            <button
              onClick={handleRework}
              className="flex-1 flex items-center justify-center gap-2 py-12 px-2 bg-gradient-to-br from-orange-400 to-orange-500 text-white rounded-xl text-sm font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
            >
              <span className="text-lg">⚠️</span>
              <span>Rework</span>
            </button>
            <button
              onClick={finish}
              className="flex-1 flex items-center justify-center gap-2 py-12 px-2 bg-gradient-to-br from-blue-400 to-blue-500 text-white rounded-xl text-sm font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
            >
              <span className="text-lg">✅</span>
              <span>Finish</span>
            </button>
          </div>
        </section>

        {/* Action Buttons - Right side */}
        <section className="flex-1 grid grid-cols-2 grid-rows-3 gap-3 overflow-hidden">
          {/* Start - Darker Blue */}
          <button
            onClick={postdata}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-200 text-sm sm:text-base font-bold min-h-0"
          >
            <span className="text-3xl sm:text-4xl md:text-5xl">▶️</span>
            <span>Start</span>
          </button>

          {/* Select Job - Soft Blue */}
          <button
            onClick={gotojob}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-br from-blue-400 to-blue-500 text-white rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-200 text-sm sm:text-base font-bold min-h-0"
          >
            <span className="text-3xl sm:text-4xl md:text-5xl">📋</span>
            <span>Select Job</span>
          </button>

          {/* Select Machine - Soft Blue */}
          <button
            onClick={gotomesin}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-br from-blue-400 to-blue-500 text-white rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-200 text-sm sm:text-base font-bold min-h-0"
          >
            <span className="text-3xl sm:text-4xl md:text-5xl">🖥️</span>
            <span>Select Machine</span>
          </button>

          {/* Process Control - Soft Blue */}
          <button
            onClick={gotoparameter}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-br from-blue-400 to-blue-500 text-white rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-200 text-sm sm:text-base font-bold min-h-0"
          >
            <span className="text-3xl sm:text-4xl md:text-5xl">⚙️</span>
            <span>Process Control</span>
          </button>

          {/* View Timesheet - Soft Blue */}
          <button
            onClick={gotots}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-br from-blue-400 to-blue-500 text-white rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-200 text-sm sm:text-base font-bold min-h-0"
          >
            <span className="text-3xl sm:text-4xl md:text-5xl">🕐</span>
            <span>View Timesheet</span>
          </button>

          {/* Consumable - Soft Blue */}
          <button
            onClick={handleConsumable}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-br from-blue-400 to-blue-500 text-white rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-200 text-sm sm:text-base font-bold min-h-0"
          >
            <span className="text-3xl sm:text-4xl md:text-5xl">🔧</span>
            <span>Consumable</span>
          </button>
        </section>
      </main>
    </div>
  );
};

export default TimesheetMainMenuPage;
