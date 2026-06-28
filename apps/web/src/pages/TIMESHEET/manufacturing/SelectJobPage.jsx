import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, MapPin, RefreshCw, Search, Settings2, X } from 'lucide-react';
import { toast } from 'sonner';
import { goBackOrFallback } from '../../../utils/navigation';

const API_BASE = import.meta.env.VITE_API_URL || '';
const AREA_STORAGE_KEY = 'mps.manufacturing.timesheet.deviceArea';
const BAY_STORAGE_KEY = 'mps.manufacturing.timesheet.selectedBay';

const AREA_OPTIONS = [
  { areaCode: 'AREA-01', areaName: 'Area 1', bays: ['A38', 'A37', 'A36', 'A35'] },
  { areaCode: 'AREA-02', areaName: 'Area 2', bays: ['A34', 'A33', 'A32'] },
  { areaCode: 'AREA-03', areaName: 'Area 3', bays: ['A30', 'A29', 'A28', 'A27'] },
  { areaCode: 'AREA-04', areaName: 'Area 4', bays: ['A26', 'A25', 'A24', 'A23'] },
  { areaCode: 'AREA-05', areaName: 'Area 5', bays: ['A22', 'A21', 'A20', 'A19'] },
  { areaCode: 'AREA-06', areaName: 'Area 6', bays: ['A18', 'A17', 'A16', 'A15'] },
  { areaCode: 'AREA-07', areaName: 'Area 7', bays: ['A14', 'A13', 'A12', 'A11'] },
  { areaCode: 'AREA-08', areaName: 'Area 8', bays: ['A9', 'A8', 'A7', 'A6'] },
  { areaCode: 'AREA-09', areaName: 'Area 9', bays: ['A5', 'A4', 'A3', 'A2'] },
  { areaCode: 'AREA-10', areaName: 'Area 10', bays: ['A1'] },
  { areaCode: 'AREA-11', areaName: 'Area 11', bays: ['B38', 'B37', 'B36', 'B35'] },
  { areaCode: 'AREA-12', areaName: 'Area 12', bays: ['B34', 'B33', 'B32'] },
  { areaCode: 'AREA-13', areaName: 'Area 13', bays: ['B30', 'B29', 'B28', 'B27'] },
  { areaCode: 'AREA-14', areaName: 'Area 14', bays: ['B26', 'B25', 'B24', 'B23'] },
  { areaCode: 'AREA-15', areaName: 'Area 15', bays: ['B22', 'B21', 'B20', 'B19'] },
  { areaCode: 'AREA-16', areaName: 'Area 16', bays: ['B17', 'B16', 'B15', 'B14'] },
  { areaCode: 'AREA-17', areaName: 'Area 17', bays: ['B13', 'B12', 'B11', 'B10'] },
  { areaCode: 'BLASTING', areaName: 'Blasting', bays: ['BP4', 'BP3', 'BP2', 'BP1'] },
];

function readStoredValue(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
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

export default function ManufacturingSelectJobPage() {
  const navigate = useNavigate();
  const [deviceAreaCode, setDeviceAreaCode] = useState(() => readStoredValue(AREA_STORAGE_KEY));
  const [selectedBay, setSelectedBay] = useState(() => readStoredValue(BAY_STORAGE_KEY));
  const [sessionWorkcenter, setSessionWorkcenter] = useState(() => readSessionWorkcenter());
  const [searchText, setSearchText] = useState('');
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [loading, setLoading] = useState(false);

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

      const rows = (payload.data || []).filter((job) => sameWorkcenter(job.workcenter, currentWorkcenter));
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

  const handleAreaChange = (event) => {
    const nextArea = event.target.value;
    setDeviceAreaCode(nextArea);
    setSelectedBay('');
    setJobs([]);
    writeStoredValue(AREA_STORAGE_KEY, nextArea);
    writeStoredValue(BAY_STORAGE_KEY, '');
    if (nextArea) toast.success(`Area device disimpan: ${nextArea}`);
  };

  const handleBayChange = (event) => {
    const nextBay = event.target.value;
    setSelectedBay(nextBay);
    setJobs([]);
    writeStoredValue(BAY_STORAGE_KEY, nextBay);
  };

  const resetDeviceArea = () => {
    setDeviceAreaCode('');
    setSelectedBay('');
    setJobs([]);
    writeStoredValue(AREA_STORAGE_KEY, '');
    writeStoredValue(BAY_STORAGE_KEY, '');
    toast.info('Setting area device dihapus');
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
                const isSelected = selectedJob?.task_id === job.task_id;
                const plannedMinutes = Number(job.planned_work_minutes || job.duration_minutes || 0);

                return (
                  <tr
                    key={`${job.schedule_id}-${job.task_id || index}`}
                    onClick={() => handleSelectJob(job)}
                    className={`${isSelected ? 'bg-[#caf0f8]' : index % 2 === 0 ? 'bg-white' : 'bg-slate-50'} cursor-pointer border-b border-slate-100 transition-colors duration-100 hover:bg-[#ade8f4] active:bg-[#90e0ef]`}
                  >
                    <td className={`${cellBase} text-center`}>
                      <div className="font-mono font-extrabold text-[#0096c7]">{job.task_order_no || job.order_no}</div>
                      <div className="mt-0.5 text-[10px] font-semibold text-slate-500">{selectedBay}</div>
                    </td>
                    <td className={`${cellBase} text-left`}>
                      <div className="font-semibold leading-snug text-slate-800">{job.task_name || '-'}</div>
                      {job.outline_number && (
                        <div className="mt-0.5 text-[10px] font-mono text-slate-400">{job.outline_number}</div>
                      )}
                    </td>
                    <td className={`${cellBase} text-center font-mono text-slate-700`}>{job.operation_no || '-'}</td>
                    <td className={`${cellBase} text-center font-mono text-slate-700`}>{job.ssbr_id || '-'}</td>
                    <td className={`${cellBase} text-center text-slate-700`}>{formatHoursFromMinutes(plannedMinutes)}</td>
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
    </div>
  );
}
