import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

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

const API_BASE = import.meta.env.VITE_API_URL || '';

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
    const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
    const serialnumber = datakaryawan?.snssb;

    if (!serialnumber) {
      console.error('SN karyawan tidak ditemukan');
      navigate('/login-timesheet');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/timesheet/getsn/${serialnumber}`);
      if (!res.ok) throw new Error('Gagal load timesheet');
      const data = await res.json();

      if (data && data.length > 0) {
        setTimesheets(data);
      } else {
        setTimesheets([]);
      }
    } catch (err) {
      console.error('Error loading timesheet:', err);
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
      const res = await fetch(`${API_BASE}/timesheet/checkoutid/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tsnumber: item.tsnumber })
      });

      if (!res.ok) {
        throw new Error('Gagal stop timesheet');
      }

      await res.json();
      toast.success('Timesheet berhasil di-stop');
      loadTimesheet();
    } catch (err) {
      console.error('Error stop timesheet:', err);
      toast.error('Gagal stop timesheet', { description: err.message });
    }
  };

  // Handle Restart button
  const handleRestart = async (item) => {
    try {
      const res = await fetch(`${API_BASE}/timesheet/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_no:              item.order_no,
          ssbr_id:               item.ssbr_id,
          operation_text:        item.operation_text,
          operation_no:          item.operation_no,
          serialnumber:          item.serialnumber,
          full_name:             item.full_name,
          workcentercode:        item.workcentercode,
          workcenterdescription: item.workcenterdescription,
          id_unprod:             item.activitytype,   // preserve activitytype
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Gagal restart timesheet');
      }

      await res.json();
      toast.success('Timesheet berhasil di-restart');
      loadTimesheet();
    } catch (err) {
      console.error('Error restart timesheet:', err);
      toast.error('Gagal restart timesheet', { description: err.message });
    }
  };

  // Save note
  const handleSaveNote = async () => {
    if (!activeRow) return;

    try {
      const res = await fetch(`${API_BASE}/timesheet/${activeRow.tsnumber}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteInput })
      });

      if (!res.ok) {
        throw new Error('Gagal simpan note');
      }

      await res.json();
      toast.success('Note berhasil disimpan');
      setShowNoteModal(false);
      setActiveRow(null);
      setNoteInput('');
      loadTimesheet();
    } catch (err) {
      console.error('Error save note:', err);
      toast.error('Gagal simpan note', { description: err.message });
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
    <div className="h-screen w-screen bg-slate-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center bg-white border-b border-slate-200 shadow-sm px-3 py-2.5 flex-shrink-0">
        <button
          onClick={goBack}
          className="min-h-[44px] px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 hover:border-slate-300 active:scale-95 transition-all"
        >
          Back
        </button>
        <h2 className="text-base font-bold text-slate-800">View Timesheet</h2>
        <button
          onClick={loadTimesheet}
          className="min-h-[44px] px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 hover:border-slate-300 active:scale-95 transition-all"
        >
          Refresh
        </button>
      </header>

      {/* Table — native HTML table guarantees header↔body alignment */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          {/* colgroup for consistent widths */}
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>

          <thead className="sticky top-0 z-10">
            <tr className="border-b border-slate-200" style={{ background: '#caf0f8' }}>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Order</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Operation</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Check In</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Check Out</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Workcenter</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {timesheets.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-500 py-10">
                  Tidak ada data timesheet
                </td>
              </tr>
            ) : (
              timesheets.map((item, index) => {
                const isRunning = !item.hour_checkout;
                const rowBg = isRunning
                  ? 'bg-orange-50 hover:bg-orange-100'
                  : (index % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50 hover:bg-slate-50');

                return (
                  <tr key={index} className={`${rowBg} border-b border-slate-100 transition-colors`}>
                    {/* Order + Ident */}
                    <td className={`${cellBase} text-center`}>
                      <div className="font-semibold font-mono" style={{ color: '#0096c7' }}>{item.order_no || '-'}</div>
                      {item.ssbr_id && <div className="text-[10px] text-slate-500 leading-tight">{item.ssbr_id}</div>}
                    </td>

                    {/* Operation */}
                    <td className={`${cellBase} text-left text-gray-800`}>
                      <div className="font-medium leading-snug">{item.operation_text}</div>
                      {item.note && (
                        <div className="text-[10px] italic text-gray-600 bg-slate-50 border-l-2 border-slate-300 px-1.5 py-0.5 rounded mt-0.5">
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
                          className="min-h-[36px] px-2 py-1 text-[10px] font-bold bg-[#0096c7] text-white rounded hover:bg-[#0077b6] active:scale-95 transition-all"
                        >
                          Note
                        </button>
                        {item.hour_checkout ? (
                          <button
                            onClick={() => handleRestart(item)}
                            className="min-h-[36px] px-2 py-1 text-[10px] font-bold bg-[#0096c7] text-white rounded hover:bg-[#0077b6] active:scale-95 transition-all"
                          >
                            Restart
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStop(item)}
                            className="min-h-[36px] px-2 py-1 text-[10px] font-bold bg-orange-500 text-white rounded hover:bg-orange-400 active:bg-orange-600 transition-all"
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
            <div className="bg-white border-b border-slate-200 px-5 py-3">
              <h3 className="text-base font-bold text-slate-800">Add Note</h3>
            </div>
            <div className="p-5">
              <textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Masukkan note..."
                rows={4}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] mb-4 text-sm resize-y transition-all"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCancelNote}
                  className="px-4 py-2 text-sm font-medium bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveNote}
                  className="px-4 py-2 text-sm font-bold bg-[#0096c7] text-white rounded-lg hover:bg-[#0077b6] transition-all"
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
