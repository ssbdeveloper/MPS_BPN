import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ClipboardList, Lock, MapPin, RefreshCw, Search, Settings2, Unlock, X } from 'lucide-react';
import { toast } from 'sonner';
import { goBackOrFallback } from '../../../utils/navigation';
import { AREA_OPTIONS, BLASTING_AREA_CODE } from '../../../config/manufacturingAreas';

const API_BASE = import.meta.env.VITE_API_URL || '';
const AREA_STORAGE_KEY = 'mps.manufacturing.timesheet.deviceArea';
const BAY_STORAGE_KEY = 'mps.manufacturing.timesheet.selectedBay';
// Changing the device area/bay is foreman-gated. Once the PIN is entered the
// unlock persists for the browser session (like PasswordPrompt's nfcAdminAuth),
// so a foreman only types it once per session. Client-side only — adequate for
// the LAN/tablet trust model, NOT real security.
const DEVICE_UNLOCK_KEY = 'mps.manufacturing.deviceUnlock';
const DEVICE_PASSWORD = '12345';

function readDeviceUnlock() {
  try {
    return sessionStorage.getItem(DEVICE_UNLOCK_KEY) === 'true';
  } catch {
    return false;
  }
}

function readStoredValue(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

// One-time migration: the blasting area code was renamed 'BLASTING' -> 'AREA-18'
// (see config/manufacturingAreas.js). Devices with the old value stored would
// stop matching AREA_OPTIONS and silently show no jobs. Rewrite it on read.
// (Bays were re-coded BP* -> PT1-3 / BL1-2; a device that had stored a BP* bay must
// re-pick its bay. The area-code rewrite here is independent of the bay codes.)
function readStoredDeviceArea() {
  const stored = readStoredValue(AREA_STORAGE_KEY);
  if (stored === 'BLASTING') {
    writeStoredValue(AREA_STORAGE_KEY, BLASTING_AREA_CODE);
    return BLASTING_AREA_CODE;
  }
  return stored;
}

function readSessionJson(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function readSessionWorkcenter() {
  try {
    const directWorkcenter = sessionStorage.getItem('workcenter');
    if (directWorkcenter) return directWorkcenter.trim();
  } catch {
    // Ignore unavailable sessionStorage.
  }

  const employee = readSessionJson('datakaryawan');
  return String(employee?.workcenter || employee?.workcentercode || '').trim();
}

function sameWorkcenter(left, right) {
  return String(left || '').trim().toUpperCase() === String(right || '').trim().toUpperCase();
}

function writeStoredValue(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // localStorage can be unavailable in strict browser modes.
  }
}

function apiUrl(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const queryText = query.toString();
  return `${API_BASE.replace(/\/$/, '')}${path}${queryText ? `?${queryText}` : ''}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function formatHoursFromMinutes(value) {
  const minutes = Math.max(0, Number(value || 0));
  if (!minutes) return '-';
  const hours = minutes / 60;
  return `${hours.toLocaleString('id-ID', { maximumFractionDigits: 2 })} jam`;
}

// An order-level reservation books a bay for a whole order without pointing at a
// specific MS Project task, so it has no task name / operation / SSBR to show. The
// API marks those rows with is_order_level; older API builds omit the column, so
// only an explicit true counts as order-level.
function isOrderLevelJob(job) {
  return job?.is_order_level === true;
}

export default function ManufacturingSelectJobPage() {
  const navigate = useNavigate();
  const [deviceAreaCode, setDeviceAreaCode] = useState(() => readStoredDeviceArea());
  const [selectedBay, setSelectedBay] = useState(() => readStoredValue(BAY_STORAGE_KEY));
  const [sessionWorkcenter, setSessionWorkcenter] = useState(() => readSessionWorkcenter());
  const [searchText, setSearchText] = useState('');
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deviceUnlocked, setDeviceUnlocked] = useState(() => readDeviceUnlock());
  const [pendingChange, setPendingChange] = useState(null); // { apply: () => void } stashed until PIN entered
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const selectedArea = useMemo(
    () => AREA_OPTIONS.find((area) => area.areaCode === deviceAreaCode) || null,
    [deviceAreaCode]
  );

  useEffect(() => {
    if (!selectedArea || !selectedArea.bays.includes(selectedBay)) {
      setSelectedBay('');
      writeStoredValue(BAY_STORAGE_KEY, '');
      setJobs([]);
    }
  }, [selectedArea, selectedBay]);

  const loadJobs = useCallback(async (searchOverride) => {
    if (!deviceAreaCode) {
      toast.warning('Pilih area device terlebih dahulu');
      return;
    }
    if (!selectedBay) {
      toast.warning('Pilih bay terlebih dahulu');
      return;
    }
    const currentWorkcenter = readSessionWorkcenter();
    setSessionWorkcenter(currentWorkcenter);
    if (!currentWorkcenter) {
      setJobs([]);
      toast.warning('Workcenter operator tidak ditemukan di session');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(apiUrl('/ms-project/bay-schedule-tasks', {
        area_code: deviceAreaCode,
        bay_code: selectedBay,
        workcenter: currentWorkcenter,
        q: searchOverride ?? searchText,
      }));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

      // Reservasi order-level tidak punya workcenter (tidak menunjuk task), jadi filter ulang
      // di klien harus meloloskannya — kalau tidak, badge order-level jadi kode mati dan bay
      // yang terpakai tampak kosong bagi operator.
      const rows = (payload.data || []).filter(
        (job) => isOrderLevelJob(job) || sameWorkcenter(job.workcenter, currentWorkcenter)
      );
      setJobs(rows);
      if (!rows.length) {
        toast.info('Tidak ada task aktif untuk area, bay, dan workcenter ini');
      }
    } catch (error) {
      console.error('Failed to load manufacturing jobs:', error);
      setJobs([]);
      toast.error('Gagal load task manufacturing', { description: error.message });
    } finally {
      setLoading(false);
    }
  }, [deviceAreaCode, searchText, selectedBay]);

  useEffect(() => {
    if (deviceAreaCode && selectedBay) {
      loadJobs('');
    }
  }, [deviceAreaCode, selectedBay]);

  // --- Actual device mutations (run only after the foreman gate passes) ---
  const applyAreaChange = (nextArea) => {
    setDeviceAreaCode(nextArea);
    setSelectedBay('');
    setJobs([]);
    writeStoredValue(AREA_STORAGE_KEY, nextArea);
    writeStoredValue(BAY_STORAGE_KEY, '');
    if (nextArea) toast.success(`Area device disimpan: ${nextArea}`);
  };

  const applyBayChange = (nextBay) => {
    setSelectedBay(nextBay);
    setJobs([]);
    writeStoredValue(BAY_STORAGE_KEY, nextBay);
  };

  const applyResetDeviceArea = () => {
    setDeviceAreaCode('');
    setSelectedBay('');
    setJobs([]);
    writeStoredValue(AREA_STORAGE_KEY, '');
    writeStoredValue(BAY_STORAGE_KEY, '');
    toast.info('Setting area device dihapus');
  };

  // Foreman gate: apply immediately when unlocked; otherwise stash the change
  // and open the PIN modal. loadJobs / filter logic is untouched.
  const guardDeviceChange = (apply) => {
    if (deviceUnlocked) {
      apply();
      return;
    }
    setPinInput('');
    setPinError('');
    setPendingChange({ apply });
  };

  const handleAreaChange = (event) => {
    const nextArea = event.target.value;
    guardDeviceChange(() => applyAreaChange(nextArea));
  };

  const handleBayChange = (event) => {
    const nextBay = event.target.value;
    guardDeviceChange(() => applyBayChange(nextBay));
  };

  const resetDeviceArea = () => {
    guardDeviceChange(applyResetDeviceArea);
  };

  const submitDevicePin = (event) => {
    event.preventDefault();
    if (pinInput === DEVICE_PASSWORD) {
      try {
        sessionStorage.setItem(DEVICE_UNLOCK_KEY, 'true');
      } catch {
        // sessionStorage can be unavailable in strict browser modes.
      }
      setDeviceUnlocked(true);
      const change = pendingChange;
      setPendingChange(null);
      setPinInput('');
      setPinError('');
      if (change?.apply) change.apply();
    } else {
      setPinError('Password salah, coba lagi');
      setPinInput('');
    }
  };

  const closeDevicePin = () => {
    setPendingChange(null);
    setPinInput('');
    setPinError('');
  };

  const handleSelectJob = (job) => {
    const plannedMinutes = Number(job.planned_work_minutes || job.duration_minutes || 0);
    const rowData = {
      order: job.task_order_no || job.order_no,
      order_no: job.task_order_no || job.order_no,
      ssbr_id: job.ssbr_id,
      part_name: job.task_name,
      operationtext: job.task_name,
      operation_text: job.task_name,
      operation_no: job.operation_no,
      planhours: plannedMinutes ? plannedMinutes / 60 : 0,
      remaining_seconds_before: null,
      workcenter: job.workcenter,
      manufacturing_area_code: job.area_code,
      manufacturing_area_name: job.area_name,
      manufacturing_bay_code: selectedBay,
      manufacturing_bay_codes: job.bay_codes,
      schedule_id: job.schedule_id,
      task_id: job.task_id,
      project_id: job.project_id,
    };

    setSelectedJob(rowData);
    sessionStorage.setItem('selectedactivity', JSON.stringify(rowData));
    toast.success(`Task dipilih: ${job.task_name || rowData.order}`, { duration: 1500 });
    setTimeout(() => navigate('/timesheet-mainmenu'), 350);
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'Enter') loadJobs();
  };

  const btnOutline = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-95';
  const btnPrimary = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#0096c7] px-4 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#0077b6] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50';
  const inputClass = 'min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 transition-all focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]';
  const cellBase = 'px-3 py-2 text-[11px] align-middle';

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-slate-50">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <button type="button" onClick={() => goBackOrFallback(navigate)} className={btnOutline}>
          Back
        </button>
        <h1 className="text-sm font-extrabold text-slate-800">Manufacturing Job Selection</h1>
        <button type="button" onClick={() => loadJobs()} disabled={loading} className={btnOutline}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </header>

      <section className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-3">
        <div className="grid gap-3 md:grid-cols-[minmax(180px,260px)_minmax(150px,190px)_minmax(0,1fr)_auto_auto]">
          <label className="grid gap-1 text-xs font-bold text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              <Settings2 size={14} className="text-[#0096c7]" />
              Device Area
              {deviceUnlocked ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                  <Unlock size={11} />
                  Terbuka
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                  <Lock size={11} />
                  Terkunci
                </span>
              )}
            </span>
            <select value={deviceAreaCode} onChange={handleAreaChange} className={inputClass}>
              <option value="">Pilih area</option>
              {AREA_OPTIONS.map((area) => (
                <option key={area.areaCode} value={area.areaCode}>
                  {area.areaCode} - {area.areaName}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-bold text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={14} className="text-[#0096c7]" />
              Bay
            </span>
            <select
              value={selectedBay}
              onChange={handleBayChange}
              disabled={!selectedArea}
              className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60`}
            >
              <option value="">Pilih bay</option>
              {(selectedArea?.bays || []).map((bayCode) => (
                <option key={bayCode} value={bayCode}>{bayCode}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-bold text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              <Search size={14} className="text-[#0096c7]" />
              Search
            </span>
            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Order, task, operation, SSBR, workcenter..."
              className={inputClass}
            />
          </label>

          <button type="button" onClick={() => loadJobs()} disabled={loading} className={`${btnPrimary} mt-5 md:mt-[18px]`}>
            <Search size={14} />
            {loading ? 'Loading' : 'Search'}
          </button>

          <button type="button" onClick={resetDeviceArea} className={`${btnOutline} mt-5 md:mt-[18px]`}>
            <X size={14} />
            Reset
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
            Area tersimpan: {selectedArea ? `${selectedArea.areaCode} - ${selectedArea.areaName}` : 'Belum diset'}
          </span>
          {selectedBay && (
            <span className="rounded-full border border-[#90e0ef] bg-[#caf0f8] px-2 py-1 text-[#0077b6]">
              Bay aktif: {selectedBay}
            </span>
          )}
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
            Workcenter session: {sessionWorkcenter || 'Tidak ada'}
          </span>
        </div>
      </section>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>

          <thead className="sticky top-0 z-10">
            <tr className="border-b-2" style={{ background: '#caf0f8', borderBottomColor: '#90e0ef' }}>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Order</th>
              <th className={`${cellBase} text-left font-semibold text-slate-700`}>Task</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Operation</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>SSBR</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Hours</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Schedule</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Workcenter</th>
            </tr>
          </thead>

          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-50 text-[#0077b6]">
                      <ClipboardList size={22} />
                    </span>
                    <span className="text-sm font-semibold text-slate-500">
                      {deviceAreaCode && selectedBay
                        ? 'Tidak ada task schedule untuk area dan bay ini.'
                        : 'Set area device dan pilih bay terlebih dahulu.'}
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              jobs.map((job, index) => {
                const isOrderLevel = isOrderLevelJob(job);
                // Order-level rows share the same (null) task_id, so the schedule must be
                // part of the comparison or every one of them would highlight at once.
                const isSelected = selectedJob?.schedule_id === job.schedule_id
                  && selectedJob?.task_id === job.task_id;
                const plannedMinutes = Number(job.planned_work_minutes || job.duration_minutes || 0);

                return (
                  <tr
                    key={`${job.schedule_id}-${job.task_id || index}`}
                    onClick={() => handleSelectJob(job)}
                    className={`${isSelected ? 'bg-[#caf0f8]' : index % 2 === 0 ? 'bg-white' : 'bg-slate-50'} cursor-pointer border-b border-slate-100 transition-colors duration-100 hover:bg-[#ade8f4] active:bg-[#90e0ef]`}
                  >
                    <td className={`${cellBase} text-center`}>
                      <div className="font-mono font-extrabold tabular-nums text-[#0096c7]">{job.task_order_no || job.order_no}</div>
                      <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{selectedBay}</div>
                    </td>
                    <td className={`${cellBase} text-left`}>
                      {isOrderLevel ? (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                            <AlertTriangle size={11} />
                            Order-level
                          </span>
                          <div className="mt-1 text-xs font-semibold leading-snug text-amber-700">
                            Reservasi tingkat order — task belum ditentukan
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="font-semibold leading-snug text-slate-800">{job.task_name || '-'}</div>
                          {job.outline_number && (
                            <div className="mt-0.5 text-[11px] font-mono text-slate-400">{job.outline_number}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td className={`${cellBase} text-center font-mono text-slate-700`}>{job.operation_no || '-'}</td>
                    <td className={`${cellBase} text-center font-mono text-slate-700`}>{job.ssbr_id || '-'}</td>
                    <td className={`${cellBase} text-center tabular-nums text-slate-700`}>{formatHoursFromMinutes(plannedMinutes)}</td>
                    <td className={`${cellBase} text-center text-slate-700`}>
                      {formatDate(job.start_date)} - {formatDate(job.end_date)}
                    </td>
                    <td className={`${cellBase} text-center font-semibold text-slate-800`}>{job.workcenter || '-'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pendingChange && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 md:items-center md:px-4">
          <form
            onSubmit={submitDevicePin}
            className="w-full rounded-t-2xl bg-white p-6 shadow-xl md:max-w-sm md:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#caf0f8] text-[#0077b6]">
                  <Lock size={18} />
                </span>
                <div>
                  <h2 className="text-sm font-extrabold text-slate-800">Ubah Area Device</h2>
                  <p className="text-[11px] font-semibold text-slate-500">Masukkan password foreman</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDevicePin}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>

            <input
              type="password"
              value={pinInput}
              onChange={(event) => setPinInput(event.target.value)}
              placeholder="Password"
              autoFocus
              className={`mt-5 w-full ${inputClass}`}
            />

            {pinError && (
              <p className="mt-2 text-xs font-semibold text-red-600">{pinError}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDevicePin}
                className={btnOutline}
              >
                Batal
              </button>
              <button type="submit" className={btnPrimary}>
                <Unlock size={14} />
                Buka
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
