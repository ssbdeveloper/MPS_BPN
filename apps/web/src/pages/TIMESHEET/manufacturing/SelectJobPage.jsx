import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, ClipboardList, Loader2, Lock, MapPin, RefreshCw, Search, Settings2, Unlock, X } from 'lucide-react';
import { toast } from 'sonner';
import { goBackOrFallback } from '../../../utils/navigation';
import { normalizeNfcId } from '../../../utils/nfcId';
import { AREA_OPTIONS, BLASTING_AREA_CODE, bayCodesOf, bayLabel } from '../../../config/manufacturingAreas';

const API_BASE = import.meta.env.VITE_API_URL || '';
const AREA_STORAGE_KEY = 'mps.manufacturing.timesheet.deviceArea';
const BAY_STORAGE_KEY = 'mps.manufacturing.timesheet.selectedBay';
// Ubah device area = foreman-only via NFC (tabel usernfc, roles FOREMAN).
// Bay bebas untuk semua user. Client-side check — cukup untuk trust model LAN/tablet.
const FOREMAN_ROLE = 'FOREMAN';

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
  const [deviceModal, setDeviceModal] = useState(null); // null | 'nfc' | 'area'
  const [pendingChange, setPendingChange] = useState(null); // { apply: () => void } menunggu verifikasi NFC
  const [nfcInput, setNfcInput] = useState('');
  const [nfcError, setNfcError] = useState('');
  const [nfcVerifying, setNfcVerifying] = useState(false);
  const [areaDraft, setAreaDraft] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  // Default: semua group COLLAPSED (set kosong = belum ada yang di-expand).
  const [expandedProjects, setExpandedProjects] = useState(new Set());
  const [expandedUnits, setExpandedUnits] = useState(new Set());

  const selectedArea = useMemo(
    () => AREA_OPTIONS.find((area) => area.areaCode === deviceAreaCode) || null,
    [deviceAreaCode]
  );

  useEffect(() => {
    // bayCodesOf = kode LENGKAP berzona (A38E/A38C). selectedArea.bays hanya kode kolom,
    // jadi memakainya di sini akan menganggap setiap bay tersimpan tidak valid.
    if (!selectedArea || !bayCodesOf(selectedArea.areaCode).includes(selectedBay)) {
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
      setExpandedProjects(new Set());
      setExpandedUnits(new Set());
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

  // --- Actual device mutations (dijalankan setelah gate foreman NFC lolos) ---
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

  // Verifikasi NFC foreman: GET /usernfc/nfcid/:nfcid → roles mengandung FOREMAN & kartu aktif.
  // Mengikuti pola LoginTimesheetPage (409 kartu ganda = tolak, 404 = tidak dikenal).
  const verifyNfcForeman = async (rawNfcId) => {
    const nfcid = normalizeNfcId(rawNfcId);
    if (!nfcid) {
      setNfcError('NFC ID tidak valid');
      return false;
    }
    setNfcVerifying(true);
    try {
      const res = await fetch(`${API_BASE}/usernfc/nfcid/${encodeURIComponent(nfcid)}`);
      if (res.status === 409) {
        const dup = await res.json().catch(() => null);
        setNfcError(dup?.message || 'Kartu ini terdaftar atas lebih dari satu orang. Hubungi admin.');
        return false;
      }
      if (!res.ok) {
        setNfcError('NFC tidak dikenal');
        return false;
      }
      const row = await res.json().catch(() => null);
      if (!row) {
        setNfcError('NFC tidak dikenal');
        return false;
      }
      if (row.inactive_from) {
        setNfcError('Kartu nonaktif');
        return false;
      }
      if (!String(row.roles || '').toUpperCase().includes(FOREMAN_ROLE)) {
        setNfcError('Akses ditolak — hanya foreman yang bisa mengubah device area');
        return false;
      }
      return true;
    } catch (err) {
      console.error('Gagal verifikasi NFC:', err);
      setNfcError('Gagal verifikasi NFC, coba lagi');
      return false;
    } finally {
      setNfcVerifying(false);
    }
  };

  // Gate area change: kalau ada pending aksi (mis. Reset dari filter bar) → simpan dulu,
  // buka modal NFC; setelah foreman lolos, aksi dijalankan.
  const guardDeviceChange = (apply) => {
    setPendingChange({ apply });
    setNfcInput('');
    setNfcError('');
    setDeviceModal('nfc');
  };

  const handleBayChange = (event) => {
    // Bay bebas untuk semua user — tanpa gate (keputusan 2a).
    applyBayChange(event.target.value);
  };

  const openGear = () => {
    setPendingChange(null);
    setNfcInput('');
    setNfcError('');
    setDeviceModal('nfc');
  };

  const resetDeviceArea = () => {
    guardDeviceChange(applyResetDeviceArea);
  };

  const submitNfc = async (event) => {
    event.preventDefault();
    const ok = await verifyNfcForeman(nfcInput);
    if (!ok) return;
    const change = pendingChange;
    if (change?.apply) {
      // Aksi tertunda (mis. Reset) → jalankan lalu tutup modal.
      setPendingChange(null);
      setDeviceModal(null);
      change.apply();
      return;
    }
    // Buka container ubah device area (modal NFC berubah jadi container area).
    setAreaDraft(deviceAreaCode || '');
    setDeviceModal('area');
  };

  const saveArea = () => {
    applyAreaChange(areaDraft);
    setDeviceModal(null);
  };

  const closeDeviceModal = () => {
    setDeviceModal(null);
    setPendingChange(null);
    setNfcInput('');
    setNfcError('');
  };

  // Grouping job 2 level: project name → unit task. Project tanpa task "Unit" masuk
  // bucket "No Unit" (keputusan 1b). Urutan sesuai API (start_date, order_no, operation).
  const groupedJobs = useMemo(() => {
    const projectMap = new Map();
    for (const job of jobs) {
      const project = job.project_name || 'Tanpa Project';
      const unit = job.unit_name || 'No Unit';
      if (!projectMap.has(project)) projectMap.set(project, new Map());
      const unitMap = projectMap.get(project);
      if (!unitMap.has(unit)) unitMap.set(unit, []);
      unitMap.get(unit).push(job);
    }
    return [...projectMap.entries()].map(([project, unitMap]) => ({
      project,
      units: [...unitMap.entries()].map(([unit, rows]) => ({ unit, rows })),
    }));
  }, [jobs]);

  // Expand/collapse group project & unit (default: collapse — keputusan user 2026-08-13).
  const toggleProject = (project) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  };

  const toggleUnit = (unitKey) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(unitKey)) next.delete(unitKey);
      else next.add(unitKey);
      return next;
    });
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
        <div className="flex items-center gap-2">
          <button type="button" onClick={openGear} className={btnOutline} title="Ubah device area (foreman)">
            <Settings2 size={14} />
          </button>
          <button type="button" onClick={() => loadJobs()} disabled={loading} className={btnOutline}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </header>

      <section className="flex-shrink-0 border-b border-slate-200 bg-white">
        {/* Toggle container filter — bisa di-hide supaya fokus ke tabel job */}
        <button
          type="button"
          onClick={() => setFilterOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-2 text-left"
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            <Search size={13} className="text-[#0096c7]" />
            Filter
          </span>
          {filterOpen ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
        </button>

        {filterOpen && (
          <div className="px-4 pb-3">
            <div className="grid gap-3 md:grid-cols-[minmax(150px,190px)_minmax(0,1fr)_auto_auto]">
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
                  {(selectedArea ? bayCodesOf(selectedArea.areaCode) : []).map((code) => (
                    <option key={code} value={code}>{bayLabel(code)}</option>
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

              <button type="button" onClick={resetDeviceArea} disabled={!deviceAreaCode} className={`${btnOutline} mt-5 md:mt-[18px] disabled:cursor-not-allowed disabled:opacity-40`}>
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
          </div>
        )}
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
              groupedJobs.map(({ project, units }) => {
                const projectExpanded = expandedProjects.has(project);
                const projectTotal = units.reduce((total, u) => total + u.rows.length, 0);
                return (
                  <React.Fragment key={project}>
                    {/* Group header 1: project (click = collapse/expand seluruh project) */}
                    <tr
                      onClick={() => toggleProject(project)}
                      className="cursor-pointer border-b border-slate-200 hover:bg-[#d4eef7]"
                      style={{ background: '#caf0f8' }}
                    >
                      <td colSpan={7} className="px-3 py-1.5 text-[11px] font-extrabold">
                        <span className="inline-flex items-center gap-1.5">
                          {projectExpanded
                            ? <ChevronDown size={13} className="text-[#0077b6]" />
                            : <ChevronRight size={13} className="text-[#0077b6]" />}
                          <span className="text-slate-800">{project}</span>
                          <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500">
                            {projectTotal}
                          </span>
                        </span>
                      </td>
                    </tr>
                    {projectExpanded && units.map(({ unit, rows }) => {
                      const unitKey = `${project}|${unit}`;
                      const unitExpanded = expandedUnits.has(unitKey);
                      return (
                        <React.Fragment key={unitKey}>
                          {/* Group header 2: unit (click = collapse/expand unit) */}
                          <tr
                            onClick={() => toggleUnit(unitKey)}
                            className="cursor-pointer border-b border-slate-200 hover:bg-[#e8f6fb]"
                            style={{ background: '#e0f2fe' }}
                          >
                            <td colSpan={7} className="px-6 py-1 text-[11px] font-extrabold">
                              <span className="inline-flex items-center gap-1.5">
                                {unitExpanded
                                  ? <ChevronDown size={12} className="text-[#0077b6]" />
                                  : <ChevronRight size={12} className="text-[#0077b6]" />}
                                <span className="text-[#0077b6]">{unit}</span>
                                <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500">
                                  {rows.length}
                                </span>
                              </span>
                            </td>
                          </tr>
                          {unitExpanded && rows.map((job, index) => {
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
                              <div className="font-semibold leading-snug text-slate-800">{job.task_name || '-'}</div>
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
                          })}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {deviceModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 md:items-center md:px-4">
          {deviceModal === 'nfc' ? (
            <form
              onSubmit={submitNfc}
              className="w-full rounded-t-2xl bg-white p-6 shadow-xl md:max-w-sm md:rounded-2xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#caf0f8] text-[#0077b6]">
                    <Lock size={18} />
                  </span>
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-800">Verifikasi Foreman</h2>
                    <p className="text-[11px] font-semibold text-slate-500">Scan atau ketik NFC ID foreman</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeDeviceModal}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                  aria-label="Tutup"
                >
                  <X size={16} />
                </button>
              </div>

              <input
                type="text"
                value={nfcInput}
                onChange={(event) => { setNfcInput(event.target.value); setNfcError(''); }}
                placeholder="NFC ID"
                autoFocus
                className={`mt-5 w-full ${inputClass}`}
              />

              {nfcError && (
                <p className="mt-2 text-xs font-semibold text-red-600">{nfcError}</p>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDeviceModal}
                  className={btnOutline}
                >
                  Batal
                </button>
                <button type="submit" disabled={nfcVerifying} className={`${btnPrimary} disabled:opacity-50`}>
                  {nfcVerifying ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
                  Verifikasi
                </button>
              </div>
            </form>
          ) : (
            <div className="w-full rounded-t-2xl bg-white p-6 shadow-xl md:max-w-sm md:rounded-2xl">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#caf0f8] text-[#0077b6]">
                    <Settings2 size={18} />
                  </span>
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-800">Ubah Device Area</h2>
                    <p className="text-[11px] font-semibold text-slate-500">Verifikasi foreman berhasil</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeDeviceModal}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                  aria-label="Tutup"
                >
                  <X size={16} />
                </button>
              </div>

              <label className="mt-5 grid gap-1 text-xs font-bold text-slate-700">
                <span>Device Area</span>
                <select value={areaDraft} onChange={(event) => setAreaDraft(event.target.value)} className={inputClass}>
                  <option value="">Pilih area</option>
                  {AREA_OPTIONS.map((area) => (
                    <option key={area.areaCode} value={area.areaCode}>
                      {area.areaCode} - {area.areaName}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-5 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => { applyResetDeviceArea(); setDeviceModal(null); }}
                  className="text-xs font-bold text-red-600 hover:text-red-700"
                >
                  Hapus Setting
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={closeDeviceModal} className={btnOutline}>
                    Batal
                  </button>
                  <button type="button" onClick={saveArea} className={btnPrimary}>
                    <Settings2 size={14} /> Simpan
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
