import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Timesheet Main Menu Page
 * Converted dari mainmenu.html + previewdata.js + script.js + postdata.js
 */
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
        const checkoutRes = await fetch('/timesheet/checkout', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            datakaryawan: { sn: datakaryawan.snssb }
          }),
        });

        const checkedOut = await checkoutRes.json();
        console.log('Checkout sukses:', checkedOut);

        // CREATE timesheet baru
        const postRes = await fetch('/timesheet/', {
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
        const postRes = await fetch('/timesheet/', {
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
      const postRes = await fetch('/sow/finish/', {
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
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Header - Dark Blue */}
      <header className="flex justify-between items-center bg-blue-900 px-3 py-2.5 shadow-md flex-shrink-0 gap-2">
        <button
          onClick={goHome}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
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
                absolute inset-0 rounded-full transition-colors duration-300
                ${mode === 'multiple' ? 'bg-blue-600' : 'bg-gray-400'}
                before:content-[''] before:absolute before:h-4 before:w-4 sm:before:h-5 sm:before:w-5
                before:left-0.5 before:bottom-0.5 before:bg-white before:rounded-full
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
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Refresh
        </button>
      </header>

      {/* Main Content - White Background */}
      <main className="flex-1 flex flex-row gap-2 p-2 overflow-hidden bg-white">
        {/* Info Box - Left side - Light Blue */}
        <section className="flex-1 bg-blue-50 rounded-lg shadow-md border border-blue-200 p-3 flex flex-col overflow-hidden">
          {/* Info Rows */}
          <div className="space-y-3 flex-1 overflow-y-auto">
            {/* Nama */}
            <div className="flex flex-col gap-1">
              <span className="text-xs sm:text-sm font-medium text-blue-900">Nama</span>
              <div className="text-xs sm:text-sm font-semibold text-gray-800 bg-white p-2 rounded border border-blue-200 break-words">
                {userData.name}
              </div>
            </div>

            {/* SN */}
            <div className="flex flex-col gap-1">
              <span className="text-xs sm:text-sm font-medium text-blue-900">SN</span>
              <div className="text-xs sm:text-sm font-semibold text-gray-800 bg-white p-2 rounded border border-blue-200">
                {userData.sn}
              </div>
            </div>

            {/* Work Center */}
            <div className="flex flex-col gap-1">
              <span className="text-xs sm:text-sm font-medium text-blue-900">Work Center</span>
              <div className="text-xs sm:text-sm font-semibold text-gray-800 bg-white p-2 rounded border border-blue-200 whitespace-pre-line">
                {userData.workcenter}
              </div>
            </div>

            {/* Order */}
            <div className="flex flex-col gap-1">
              <span className="text-xs sm:text-sm font-medium text-blue-900">Order</span>
              <div className="text-xs sm:text-sm font-semibold text-gray-800 bg-white p-2 rounded border border-blue-200">
                {userData.order}
              </div>
            </div>

            {/* Activity */}
            <div className="flex flex-col gap-1">
              <span className="text-xs sm:text-sm font-medium text-blue-900">Activity</span>
              <div className="text-xs sm:text-sm font-semibold text-gray-800 whitespace-pre-line h-16 sm:h-20 overflow-auto bg-white p-2 rounded border border-blue-200">
                {userData.activity}
              </div>
            </div>
          </div>

          {/* Bottom Actions inside info box */}
          <div className="flex gap-2 mt-3 pt-3 border-t border-blue-200">
            <button
              onClick={handleRework}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2 px-2 bg-gradient-to-b from-blue-600 to-blue-700 text-white rounded text-xs font-bold shadow-md hover:from-blue-700 hover:to-blue-800 transition-all"
            >
              <span className="text-base">⚠️</span>
              <span>Rework</span>
            </button>
            <button
              onClick={finish}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2 px-2 bg-gradient-to-b from-green-500 to-green-600 text-white rounded text-xs font-bold shadow-md hover:from-green-600 hover:to-green-700 transition-all"
            >
              <span className="text-base">✅</span>
              <span>Finish</span>
            </button>
          </div>
        </section>

        {/* Action Buttons - Right side */}
        <section className="flex-1 grid grid-cols-2 grid-rows-3 gap-2 overflow-hidden">
          {/* Start - Orange CTA */}
          <button
            onClick={postdata}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-b from-orange-500 to-orange-600 text-white rounded-lg shadow-md hover:from-orange-600 hover:to-orange-700 transition-all text-sm sm:text-base font-bold min-h-0"
          >
            <span className="text-3xl sm:text-4xl md:text-5xl">▶️</span>
            <span>Start</span>
          </button>

          {/* Select Job - Blue */}
          <button
            onClick={gotojob}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-b from-blue-600 to-blue-700 text-white rounded-lg shadow-md hover:from-blue-700 hover:to-blue-800 transition-all text-sm sm:text-base font-bold min-h-0"
          >
            <span className="text-3xl sm:text-4xl md:text-5xl">📋</span>
            <span>Select Job</span>
          </button>

          {/* Select Machine - Blue */}
          <button
            onClick={gotomesin}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-b from-blue-600 to-blue-700 text-white rounded-lg shadow-md hover:from-blue-700 hover:to-blue-800 transition-all text-sm sm:text-base font-bold min-h-0"
          >
            <span className="text-3xl sm:text-4xl md:text-5xl">🖥️</span>
            <span>Select Machine</span>
          </button>

          {/* Process Control - Blue */}
          <button
            onClick={gotoparameter}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-b from-blue-600 to-blue-700 text-white rounded-lg shadow-md hover:from-blue-700 hover:to-blue-800 transition-all text-sm sm:text-base font-bold min-h-0"
          >
            <span className="text-3xl sm:text-4xl md:text-5xl">⚙️</span>
            <span>Process Control</span>
          </button>

          {/* View Timesheet - Blue */}
          <button
            onClick={gotots}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-b from-blue-600 to-blue-700 text-white rounded-lg shadow-md hover:from-blue-700 hover:to-blue-800 transition-all text-sm sm:text-base font-bold min-h-0"
          >
            <span className="text-3xl sm:text-4xl md:text-5xl">🕐</span>
            <span>View Timesheet</span>
          </button>

          {/* Consumable - Blue */}
          <button
            onClick={handleConsumable}
            className="flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-b from-blue-600 to-blue-700 text-white rounded-lg shadow-md hover:from-blue-700 hover:to-blue-800 transition-all text-sm sm:text-base font-bold min-h-0"
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
