import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Timesheet List Page
 * Converted dari menutimesheet.html
 * Shows all timesheet entries for current user
 */
const TimesheetListPage = () => {
  const navigate = useNavigate();

  // States
  const [timesheets, setTimesheets] = useState([]);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [activeRow, setActiveRow] = useState(null);

  // Load timesheets on mount
  useEffect(() => {
    loadTimesheet();
  }, []);

  // API: Load timesheet for current user
  const loadTimesheet = async () => {
    // NOTE: Untuk development, load dummy data dulu
    // Untuk production, uncomment code dibawah dan comment load dummy data

    /* PRODUCTION CODE - Uncomment untuk production
    const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
    const serialnumber = datakaryawan?.snssb;

    if (!serialnumber) {
      console.error('SN karyawan tidak ditemukan');
      alert('Data karyawan tidak ditemukan. Silakan login kembali.');
      navigate('/login-timesheet');
      return;
    }

    try {
      const res = await fetch(`/timesheet/getsn/${serialnumber}`);
      if (!res.ok) {
        throw new Error('Gagal load timesheet dari API');
      }
      const data = await res.json();

      if (data && data.length > 0) {
        setTimesheets(data);
        return; // Success, keluar dari function
      } else {
        throw new Error('Data kosong dari API');
      }
    } catch (err) {
      console.error('Error loading timesheet from API:', err);
      // Fallback to dummy data jika API gagal
    }
    */

    // DEVELOPMENT MODE - Load dummy data langsung
    try {
      console.log('Loading dummy timesheet data...');
      const dummyResponse = await fetch('/dummy-timesheets.json');
      if (dummyResponse.ok) {
        const dummyData = await dummyResponse.json();
        setTimesheets(dummyData);
        // alert('⚠️ Menggunakan data dummy (Development Mode)');
      } else {
        throw new Error('Dummy data tidak tersedia');
      }
    } catch (dummyError) {
      console.error('Error loading dummy data:', dummyError);
      alert('❌ Gagal load dummy data');
      setTimesheets([]);
    }
  };

  // Handle Note button
  const handleNote = (item) => {
    setActiveRow(item);
    setNoteInput(item.note || '');
    setShowNoteModal(true);
  };

  // Handle Stop button (checkout)
  const handleStop = async (item) => {
    try {
      const res = await fetch('/timesheet/checkoutid/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tsnumber: item.tsnumber })
      });

      if (!res.ok) {
        throw new Error('Gagal stop timesheet');
      }

      await res.json();
      alert('✅ Timesheet berhasil di-stop');
      loadTimesheet();
    } catch (err) {
      console.error('Error stop timesheet:', err);
      alert('❌ Gagal stop timesheet');
    }
  };

  // Handle Restart button
  const handleRestart = async (item) => {
    try {
      const res = await fetch('/timesheet/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tsnumber: item.tsnumber,
          production_order: item.production_order,
          operation_text: item.operation_text,
          ssbr_ident: item.ssbr_ident,
          operation_no: item.seq,
          serialnumber: item.serialnumber,
          full_name: item.full_name,
          workcentercode: item.workcentercode,
          workcenterdescription: item.workcenterdescription
        })
      });

      if (!res.ok) {
        throw new Error('Gagal restart timesheet');
      }

      await res.json();
      alert('✅ Timesheet berhasil di-restart');
      loadTimesheet();
    } catch (err) {
      console.error('Error restart timesheet:', err);
      alert('❌ Gagal restart timesheet');
    }
  };

  // Save note
  const handleSaveNote = async () => {
    if (!activeRow) return;

    try {
      const res = await fetch('/timesheet/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tsnumber: activeRow.tsnumber,
          note: noteInput
        })
      });

      if (!res.ok) {
        throw new Error('Gagal simpan note');
      }

      await res.json();
      alert('✅ Note berhasil disimpan');
      setShowNoteModal(false);
      setActiveRow(null);
      setNoteInput('');
      loadTimesheet();
    } catch (err) {
      console.error('Error save note:', err);
      alert('❌ Gagal simpan note');
    }
  };

  // Cancel note
  const handleCancelNote = () => {
    setShowNoteModal(false);
    setActiveRow(null);
    setNoteInput('');
  };

  // Back to main menu
  const goBack = () => {
    navigate('/timesheet-mainmenu');
  };

  return (
    <div className="h-screen w-screen bg-gray-100 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center bg-white px-3 py-2.5 shadow-md flex-shrink-0">
        <button
          onClick={goBack}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
        >
          Back
        </button>
        <h2 className="text-base sm:text-lg font-bold text-gray-800">Timesheet</h2>
        <button
          onClick={loadTimesheet}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
        >
          Refresh
        </button>
      </header>

      {/* Table Header */}
      <div className="px-3 py-2 bg-gray-200 border-b border-gray-300 flex-shrink-0">
        <div className="grid gap-1 text-xs font-semibold text-gray-700" style={{ gridTemplateColumns: '1fr 1fr 2fr 1fr 1fr 1fr 120px' }}>
          <div className="text-center">Order</div>
          <div className="text-center">Ident</div>
          <div className="text-center">Operation</div>
          <div className="text-center">Check In</div>
          <div className="text-center">Check Out</div>
          <div className="text-center">Workcenter</div>
          <div className="text-center">Actions</div>
        </div>
      </div>

      {/* Timesheet List - Scrollable */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {timesheets.length === 0 ? (
          <div className="text-center text-gray-500 mt-10">
            <p>Tidak ada data timesheet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {timesheets.map((item, index) => (
              <div
                key={index}
                className="bg-white rounded border border-gray-300 shadow-sm"
              >
                <div className="grid gap-1 p-2 items-center min-h-[60px]" style={{ gridTemplateColumns: '1fr 1fr 2fr 1fr 1fr 1fr 120px' }}>
                  {/* Order */}
                  <div className="text-xs text-center font-semibold text-gray-800 break-words">
                    {item.production_order}
                  </div>

                  {/* Ident */}
                  <div className="text-xs text-center text-gray-700 break-words">
                    {item.ssbr_ident}
                  </div>

                  {/* Operation */}
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-center text-gray-700 break-words leading-relaxed font-semibold">
                      {item.operation_text}
                    </div>
                    {item.note && (
                      <div className="text-xs italic text-gray-600 bg-gray-50 border-l-2 border-blue-500 px-2 py-1 rounded">
                        {item.note}
                      </div>
                    )}
                  </div>

                  {/* Check In */}
                  <div className="text-xs text-center text-gray-700">
                    <div className="font-medium">{item.date_checkin || '-'}</div>
                    <div className="text-blue-600 font-semibold">{item.hour_checkin || '-'}</div>
                  </div>

                  {/* Check Out */}
                  <div className="text-xs text-center text-gray-700">
                    <div className="font-medium">{item.date_checkout || '-'}</div>
                    <div className="text-red-600 font-semibold">{item.hour_checkout || '-'}</div>
                  </div>

                  {/* Workcenter */}
                  <div className="text-xs text-center text-gray-700 break-words">
                    {item.workcenterdescription}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => handleNote(item)}
                      className="px-2 py-1 text-xs font-medium bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                    >
                      Note
                    </button>
                    {item.hour_checkout ? (
                      <button
                        onClick={() => handleRestart(item)}
                        className="px-2 py-1 text-xs font-medium bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                      >
                        Restart
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStop(item)}
                        className="px-2 py-1 text-xs font-medium bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Note Modal */}
      {showNoteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Add Note</h3>
            <input
              type="text"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Masukkan note..."
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500 mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleCancelNote}
                className="px-4 py-2 text-sm font-medium bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNote}
                className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimesheetListPage;
