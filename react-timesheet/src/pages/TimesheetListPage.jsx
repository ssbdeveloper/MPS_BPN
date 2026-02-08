import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Elapsed Timer Component
 * Shows realtime HH:MM:SS counting up from checkin time
 */
const ElapsedTimer = ({ longdateCheckin }) => {
  const [elapsed, setElapsed] = useState('');
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!longdateCheckin) return;

    const checkinTime = new Date(longdateCheckin).getTime();

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, now - checkinTime);
      const totalSec = Math.floor(diff / 1000);
      const hrs = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      setElapsed(
        `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      );
    };

    updateTimer();
    intervalRef.current = setInterval(updateTimer, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [longdateCheckin]);

  return (
    <span className="font-mono text-orange-600 font-bold animate-pulse">
      {elapsed}
    </span>
  );
};

/**
 * Timesheet List Page
 * Converted dari menutimesheet.html
 * Shows all timesheet entries for current user
 * Color scheme: White 65%, Blue 25% (90% opacity), Orange 10% (CTA)
 */
// Format date from "dd/mm/yyyy" to "dd mmm yy"
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const formatDateShort = (dateStr) => {
  if (!dateStr) return '-';
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  const day = parseInt(parts[0], 10);
  const monthIdx = parseInt(parts[1], 10) - 1;
  const year = parts[2].slice(-2);
  return `${day} ${MONTHS_SHORT[monthIdx] || '???'} ${year}`;
};

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
        return;
      } else {
        throw new Error('Data kosong dari API');
      }
    } catch (err) {
      console.error('Error loading timesheet from API:', err);
    }
    */

    // DEVELOPMENT MODE - Load dummy data langsung
    try {
      console.log('Loading dummy timesheet data...');
      const dummyResponse = await fetch('/dummy-timesheets.json');
      if (dummyResponse.ok) {
        const dummyData = await dummyResponse.json();
        setTimesheets(dummyData);
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

  // Common cell style
  const cellBase = 'px-2 py-2 text-[11px] align-middle';

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Header - Dark Blue */}
      <header className="flex justify-between items-center bg-blue-900 px-3 py-2.5 shadow-md flex-shrink-0">
        <button
          onClick={goBack}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Back
        </button>
        <h2 className="text-base sm:text-lg font-bold text-white">View Timesheet</h2>
        <button
          onClick={loadTimesheet}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Refresh
        </button>
      </header>

      {/* Table — native HTML table guarantees header↔body alignment */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          {/* colgroup for consistent widths */}
          <colgroup>
            <col style={{ width: '11%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>

          <thead className="sticky top-0 z-10">
            <tr className="bg-blue-100 border-b-2 border-blue-300">
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Order</th>
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Ident</th>
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Operation</th>
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Check In</th>
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Check Out</th>
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Workcenter</th>
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {timesheets.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-gray-500 py-10">
                  Tidak ada data timesheet
                </td>
              </tr>
            ) : (
              timesheets.map((item, index) => {
                const isRunning = !item.hour_checkout;
                const rowBg = isRunning
                  ? 'bg-orange-50 hover:bg-orange-100'
                  : (index % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-blue-50/30 hover:bg-blue-50');

                return (
                  <tr key={index} className={`${rowBg} border-b border-blue-100 transition-colors`}>
                    {/* Order */}
                    <td className={`${cellBase} text-center font-semibold text-blue-900`}>
                      {item.production_order || '-'}
                    </td>

                    {/* Ident */}
                    <td className={`${cellBase} text-center text-blue-700`}>
                      {item.ssbr_ident || '-'}
                    </td>

                    {/* Operation */}
                    <td className={`${cellBase} text-left text-gray-800`}>
                      <div className="font-medium leading-snug">{item.operation_text}</div>
                      {item.note && (
                        <div className="text-[10px] italic text-gray-600 bg-blue-50 border-l-2 border-blue-400 px-1.5 py-0.5 rounded mt-0.5">
                          {item.note}
                        </div>
                      )}
                    </td>

                    {/* Check In */}
                    <td className={`${cellBase} text-center`}>
                      <div className="font-medium text-gray-700">{formatDateShort(item.date_checkin)}</div>
                      <div className="text-blue-700 font-semibold">{item.hour_checkin || '-'}</div>
                    </td>

                    {/* Check Out */}
                    <td className={`${cellBase} text-center`}>
                      {item.hour_checkout ? (
                        <>
                          <div className="font-medium text-gray-700">{formatDateShort(item.date_checkout)}</div>
                          <div className="text-blue-700 font-semibold">{item.hour_checkout}</div>
                        </>
                      ) : (
                        <ElapsedTimer longdateCheckin={item.longdate_checkin} />
                      )}
                    </td>

                    {/* Workcenter */}
                    <td className={`${cellBase} text-center text-gray-800 font-medium`}>
                      {item.workcenterdescription || '-'}
                    </td>

                    {/* Actions */}
                    <td className={`${cellBase} text-center`}>
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => handleNote(item)}
                          className="px-2 py-1 text-[10px] font-bold bg-blue-600 text-white rounded hover:bg-blue-500 active:bg-blue-700 transition-colors"
                        >
                          Note
                        </button>
                        {item.hour_checkout ? (
                          <button
                            onClick={() => handleRestart(item)}
                            className="px-2 py-1 text-[10px] font-bold bg-blue-700 text-white rounded hover:bg-blue-600 active:bg-blue-800 transition-colors"
                          >
                            Restart
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStop(item)}
                            className="px-2 py-1 text-[10px] font-bold bg-orange-500 text-white rounded hover:bg-orange-400 active:bg-orange-600 transition-colors"
                          >
                            Stop
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Note Modal */}
      {showNoteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="bg-blue-900 px-5 py-3">
              <h3 className="text-base font-bold text-white">Add Note</h3>
            </div>
            <div className="p-5">
              <textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Masukkan note..."
                rows={4}
                className="w-full px-3 py-2.5 border-2 border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4 text-sm resize-y"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCancelNote}
                  className="px-4 py-2 text-sm font-medium bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveNote}
                  className="px-4 py-2 text-sm font-bold bg-blue-700 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimesheetListPage;
