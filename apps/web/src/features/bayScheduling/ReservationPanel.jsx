import React, { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CalendarRange, Clock, ExternalLink, Info, ListChecks, Loader2, MapPin,
  RefreshCw, Save, Undo2, Users, X,
} from 'lucide-react';
import { fetchBayOccupants, fetchOrderTasks, updateOperationPeople } from '../../services/msProjectService';
import { Skeleton } from '../../components';
import {
  NONJOB_BOOKING_TYPES, addDaysText, bookingTypeOf, formatDate, formatHours, statusStyle, todayText,
} from './constants';
import useDialogA11y from './useDialogA11y';

// =============================================================================
// Helper LOKAL (sengaja tidak ditambahkan ke constants.js — file itu milik agen
// data-layer; lihat catatan lintas-agen di kontrak komponen).
// =============================================================================

function bookingTypeLabel(code) {
  return bookingTypeOf({ booking_type: code }).label;
}

// Headcount (people_required) hidup di OPERASI SOW, jadi dikunci per operation_no.
// Beberapa task bisa berbagi operation_no -> berbagi satu nilai (dedupe saat simpan).
// Task tanpa operation_no jatuh ke kunci task_id (tak bisa ditulis balik ke SOW).
function peopleKey(task) {
  const op = task.operation_no;
  return op != null && op !== '' ? `op:${op}` : `task:${task.task_id}`;
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : '';
}

// Hanya digit yang diterima; valid = bilangan bulat positif atau kosong.
function isValidPeople(value) {
  return value === '' || /^[1-9]\d*$/.test(value);
}

// fetchBayOccupants SEHARUSNYA meneruskan { rows, truncated, total } (endpoint
// /bay-schedules/occupants mengembalikan bentuk itu), tetapi versi service saat ini
// membuang truncated/total dan hanya mengembalikan array. Dinormalisasi di sini supaya
// panel benar untuk KEDUA bentuk — begitu service diperbaiki, indikator "menampilkan N
// dari M" langsung hidup tanpa mengubah file ini.
function normalizeOccupants(result) {
  if (Array.isArray(result)) {
    return { rows: result, truncated: false, total: result.length };
  }
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const total = Number(result?.total);
  return {
    rows,
    truncated: Boolean(result?.truncated),
    total: Number.isFinite(total) ? total : rows.length,
  };
}

const EMPTY_OCCUPANTS = { rows: [], truncated: false, total: 0 };

// =============================================================================
// Sub-komponen
// =============================================================================

const FIELD_CLASS = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 transition-all duration-150 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] motion-reduce:transition-none';

const TaskRow = memo(function TaskRow({ task, checked, onToggle, peopleValue, peopleInvalid, onPeopleChange }) {
  const uid = useId();
  const planhours = task.planhours;
  const hasPlan = planhours != null && planhours !== '' && Number.isFinite(Number(planhours));
  const planStart = dateOnly(task.plan_start);
  const planFinish = dateOnly(task.plan_finish);
  const hasSchedule = Boolean(planStart || planFinish);

  return (
    <div className="flex items-start gap-2.5 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50">
      {/* Label membungkus HANYA checkbox + info -> aman dari nested-interactive
          dengan input angka "Orang" yang berdiri sendiri di kanan. */}
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(task.task_id)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[#0077b6] focus:ring-2 focus:ring-[#00b4d8]"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tabular-nums text-slate-600">
              Op {task.operation_no || '-'}
            </span>
            {task.workcenter && (
              <span className="rounded bg-[#caf0f8] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#0077b6]">
                {task.workcenter}
              </span>
            )}
            {hasPlan && (
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tabular-nums text-slate-600">
                <Clock className="h-3 w-3" />{formatHours(planhours)}
              </span>
            )}
          </span>
          <span className="mt-1 block truncate text-sm font-semibold text-slate-800">
            {task.task_name || '-'}
          </span>
          <span
            className={`mt-0.5 flex items-center gap-1 text-xs tabular-nums ${hasSchedule ? 'text-slate-500' : 'text-amber-600'}`}
          >
            <CalendarRange className="h-3 w-3 shrink-0" />
            {hasSchedule
              ? `${formatDate(planStart)} – ${formatDate(planFinish)}`
              : 'Belum ada jadwal MS Project'}
          </span>
        </span>
      </label>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <label htmlFor={uid} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Users className="h-3 w-3" /> Orang
        </label>
        <input
          id={uid}
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={peopleValue}
          onChange={(event) => onPeopleChange(task, event.target.value)}
          placeholder="-"
          aria-invalid={peopleInvalid || undefined}
          className={`w-16 rounded-lg border bg-white px-2 py-1 text-right text-sm tabular-nums text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] ${
            peopleInvalid ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200 focus:border-[#0096c7]'
          }`}
        />
      </div>
    </div>
  );
});

// Satu baris penghuni bay. INFORMATIF saja — D3 memutuskan tidak ada bay eksklusif,
// jadi baris ini tidak pernah memblokir submit.
const OccupantRow = memo(function OccupantRow({ occupant }) {
  const style = statusStyle(occupant.status);
  const type = bookingTypeOf(occupant);
  const isOrder = type.isJob;
  const title = isOrder
    ? (occupant.order_no || 'Order tidak dikenal')
    : (occupant.purpose || type.label);
  const bays = Array.isArray(occupant.bay_codes) ? occupant.bay_codes : [];

  return (
    <li className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`truncate text-xs font-bold text-slate-800 ${isOrder ? 'font-mono tabular-nums' : ''}`}>
            {title}
          </span>
          {!isOrder && (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${type.pill}`}>
              {type.label}
            </span>
          )}
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style.pill}`}>
            {style.label}
          </span>
        </div>
        <p className="mt-0.5 flex items-center gap-1 text-xs tabular-nums text-slate-500">
          <CalendarRange className="h-3 w-3 shrink-0" />
          {formatDate(occupant.start_date)} – {formatDate(occupant.end_date)}
          {occupant.created_by ? <span className="truncate"> · {occupant.created_by}</span> : null}
        </p>
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">{bays.join(', ') || '-'}</span>
    </li>
  );
});

// =============================================================================
// ReservationPanel — shell (buka/tutup + remount saat konteks ganti)
// =============================================================================

/**
 * Panel kontekstual pembuat reservasi bay (Tingkat 2 peta).
 *
 * Props (nama persis sesuai kontrak komponen):
 *   open     – boolean          panel ditampilkan atau tidak
 *   mode     – 'ORDER'|'NONJOB' booking job (task-level) atau non-job (parkir/simpan/…)
 *   area     – { areaCode, areaName, bays[] }  area terpilih
 *   bayCode  – string           bay awal; N bay berikutnya diambil dari area.bays
 *   order    – object|null      order SOW terpilih (wajib untuk mode ORDER)
 *   saving   – boolean          submit sedang berjalan di orkestrator
 *   onClose  – () => void
 *   onSubmit – (payload) => void  payload createBaySchedule yang sudah jadi
 */
export default function ReservationPanel({ open, mode, area, bayCode, order, saving, onClose, onSubmit }) {
  if (!open || !area) return null;
  // Remount saat KONTEKS reservasi berganti (mode/area/order) supaya form tidak
  // membawa sisa isian booking sebelumnya. Ganti BAY saja sengaja TIDAK me-remount:
  // memindahkan bay tidak boleh menghapus tanggal & pilihan task yang sudah dibuat.
  return (
    <ReservationPanelBody
      key={`${mode}|${area.areaCode}|${order?.order_no || ''}`}
      mode={mode}
      area={area}
      bayCode={bayCode}
      order={order}
      saving={saving}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

function ReservationPanelBody({ mode, area, bayCode, order, saving, onClose, onSubmit }) {
  const isOrderMode = mode !== 'NONJOB';
  // Konstan sepanjang umur instance: shell me-remount saat mode/order berganti.
  const shouldLoadTasks = isOrderMode && Boolean(order?.order_no);

  // --- Bay ------------------------------------------------------------------
  const [bayCount, setBayCount] = useState(1);

  // --- Tanggal --------------------------------------------------------------
  // Tanggal EFEKTIF diturunkan saat render, bukan disinkronkan lewat useEffect:
  // selama user belum menyentuh input (datesDirty=false) yang dipakai adalah jadwal
  // MS Project task terpilih; begitu disentuh, nilai manual yang menang. Pola effect
  // + setState untuk ini melanggar react-hooks/set-state-in-effect DAN menghasilkan
  // render berantai tiap kali pilihan task berubah.
  const [manualStart, setManualStart] = useState(todayText());
  const [manualEnd, setManualEnd] = useState(addDaysText(todayText(), 7));
  const [datesDirty, setDatesDirty] = useState(false);
  const [notes, setNotes] = useState('');

  // --- Non-job --------------------------------------------------------------
  const [bookingType, setBookingType] = useState(NONJOB_BOOKING_TYPES[0]?.code || 'PARKING');
  const [purpose, setPurpose] = useState('');

  // --- Task (mode ORDER) ----------------------------------------------------
  const [orderTasks, setOrderTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(shouldLoadTasks);
  const [tasksError, setTasksError] = useState('');
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [reloadToken, setReloadToken] = useState(0);

  // --- Headcount ------------------------------------------------------------
  const [peopleEdits, setPeopleEdits] = useState({});
  const [writingBack, setWritingBack] = useState(false);
  const peopleBaselineRef = useRef({});

  // --- Penghuni bay (peringatan lunak D3) -----------------------------------
  const [occupants, setOccupants] = useState(EMPTY_OCCUPANTS);
  const [loadingOccupants, setLoadingOccupants] = useState(true);
  const [occupantsError, setOccupantsError] = useState('');
  const [occupantsToken, setOccupantsToken] = useState(0);

  // --- Submit ---------------------------------------------------------------
  const [submitError, setSubmitError] = useState('');

  const titleId = useId();
  const purposeId = useId();

  // useDialogA11y bergantung pada identitas onClose; kalau orkestrator mengoper arrow
  // inline, efeknya dibongkar-pasang tiap render dan fokus melompat balik ke tombol
  // pertama saat user mengetik. Distabilkan di sini lewat ref.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const stableClose = useCallback(() => { onCloseRef.current?.(); }, []);
  const dialogRef = useDialogA11y(stableClose);

  // --- Bay terpilih: mulai dari bayCode, ambil N bay berikutnya dalam area ----
  const bayIndex = Math.max(0, area.bays.indexOf(bayCode));
  const maxBayCount = Math.max(1, area.bays.length - bayIndex);
  // Di-clamp saat render (bukan lewat efek) supaya ganti bay ke ujung area tidak
  // sempat menghasilkan daftar bay yang lebih pendek dari angka di select.
  const effectiveBayCount = Math.min(Math.max(1, Number(bayCount) || 1), maxBayCount);
  const selectedBays = useMemo(
    () => area.bays.slice(bayIndex, bayIndex + effectiveBayCount),
    [area.bays, bayIndex, effectiveBayCount],
  );
  const bayCodesKey = selectedBays.join(',');

  // --- Muat task order ------------------------------------------------------
  // Flag loading TIDAK diset di badan efek (react-hooks/set-state-in-effect): nilai
  // awalnya sudah benar dari useState, dan tombol "Coba lagi" yang menyalakannya lagi.
  useEffect(() => {
    if (!shouldLoadTasks) return undefined;

    let active = true;
    fetchOrderTasks(order.order_no)
      .then((rows) => {
        if (!active) return;
        const list = Array.isArray(rows) ? rows : [];
        setOrderTasks(list);
        // Seed headcount dari people_required per operasi (task pertama yang membawa
        // operation_no). Nilai disimpan sebagai string untuk input; baseline sama.
        const seed = {};
        list.forEach((task) => {
          const key = peopleKey(task);
          if (key in seed) return;
          seed[key] = task.people_required == null || task.people_required === '' ? '' : String(task.people_required);
        });
        setPeopleEdits(seed);
        peopleBaselineRef.current = seed;
      })
      .catch((error) => {
        if (!active) return;
        setTasksError(error.message || 'Gagal memuat task order');
        setOrderTasks([]);
      })
      .finally(() => {
        if (active) setLoadingTasks(false);
      });

    return () => { active = false; };
  }, [shouldLoadTasks, order?.order_no, reloadToken]);

  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const selectedTasks = useMemo(
    () => orderTasks.filter((task) => selectedTaskIdSet.has(task.task_id)),
    [orderTasks, selectedTaskIdSet],
  );

  // --- Prefill tanggal dari jadwal MS Project (D5) --------------------------
  // start = min(plan_start), end = max(plan_finish) dari task TERPILIH.
  const planRange = useMemo(() => {
    let start = null;
    let finish = null;
    selectedTasks.forEach((task) => {
      const s = dateOnly(task.plan_start);
      const f = dateOnly(task.plan_finish);
      if (s && (!start || s < start)) start = s;
      if (f && (!finish || f > finish)) finish = f;
    });
    return { start, finish };
  }, [selectedTasks]);

  const hasPlanRange = Boolean(planRange.start || planRange.finish);

  // Prefill hanya berlaku di mode ORDER dan hanya selama user belum menyentuh tanggal.
  const prefillStart = isOrderMode && hasPlanRange ? (planRange.start || planRange.finish) : '';
  const prefillEnd = isOrderMode && hasPlanRange ? (planRange.finish || planRange.start) : '';
  const prefillActive = !datesDirty && Boolean(prefillStart) && Boolean(prefillEnd);
  const startDate = prefillActive ? prefillStart : manualStart;
  const endDate = prefillActive ? prefillEnd : manualEnd;

  const rangeInvalid = Boolean(startDate && endDate && endDate < startDate);
  const datesMissing = !startDate || !endDate;
  const canQueryOccupants = Boolean(bayCodesKey) && !datesMissing && !rangeInvalid;

  // --- Penghuni bay: saat panel dibuka & tiap bay/tanggal berubah (debounce) --
  useEffect(() => {
    if (!canQueryOccupants) return undefined;

    // `active` mencegah respons BASI menimpa hasil yang lebih baru (fetchBayOccupants
    // tidak menerima AbortSignal, jadi pembatalan hanya bisa di sisi konsumen).
    let active = true;
    const timer = setTimeout(() => {
      setLoadingOccupants(true);
      setOccupantsError('');
      fetchBayOccupants({
        bay_codes: bayCodesKey.split(','),
        start_date: startDate,
        end_date: endDate,
      })
        .then((result) => {
          if (!active) return;
          setOccupants(normalizeOccupants(result));
        })
        .catch((error) => {
          if (!active) return;
          setOccupants(EMPTY_OCCUPANTS);
          setOccupantsError(error.message || 'Gagal memuat penghuni bay.');
        })
        .finally(() => {
          if (active) setLoadingOccupants(false);
        });
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [canQueryOccupants, bayCodesKey, startDate, endDate, occupantsToken]);

  // --- Handler --------------------------------------------------------------
  const allChecked = orderTasks.length > 0 && selectedTaskIds.length === orderTasks.length;

  const toggleTask = useCallback((taskId) => {
    setSelectedTaskIds((prev) => (
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    ));
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedTaskIds((prev) => (
      prev.length === orderTasks.length ? [] : orderTasks.map((task) => task.task_id)
    ));
  }, [orderTasks]);

  const handlePeopleChange = useCallback((task, raw) => {
    const digits = String(raw).replace(/[^0-9]/g, '');
    setPeopleEdits((prev) => ({ ...prev, [peopleKey(task)]: digits }));
  }, []);

  // Saat user menyentuh SATU input tanggal, nilai input satunya di-"bekukan" dari
  // tanggal efektif saat itu — kalau tidak, mematikan prefill akan menarik input
  // satunya balik ke default hari-ini/+7 dan diam-diam mengubah rentang.
  const handleStartDate = useCallback((event) => {
    const value = event.target.value;
    setManualEnd((prev) => (datesDirty ? prev : endDate));
    setManualStart(value);
    setDatesDirty(true);
  }, [datesDirty, endDate]);

  const handleEndDate = useCallback((event) => {
    const value = event.target.value;
    setManualStart((prev) => (datesDirty ? prev : startDate));
    setManualEnd(value);
    setDatesDirty(true);
  }, [datesDirty, startDate]);

  const resetDatesToPlan = useCallback(() => setDatesDirty(false), []);

  const retryTasks = useCallback(() => {
    setTasksError('');
    setLoadingTasks(true);
    setReloadToken((token) => token + 1);
  }, []);

  const retryOccupants = useCallback(() => setOccupantsToken((token) => token + 1), []);

  // --- Validasi -------------------------------------------------------------
  const peopleInvalid = selectedTasks.some((task) => !isValidPeople(peopleEdits[peopleKey(task)] ?? ''));
  const purposeMissing = !isOrderMode && !purpose.trim();
  const tasksMissing = isOrderMode && selectedTasks.length === 0;
  const noPlanSchedule = isOrderMode && selectedTasks.length > 0 && !hasPlanRange;

  const canSubmit = !saving
    && !writingBack
    && !rangeInvalid
    && !datesMissing
    && !peopleInvalid
    && !purposeMissing
    && !tasksMissing;

  const handleSubmit = async () => {
    setSubmitError('');
    if (!canSubmit) return;

    if (isOrderMode) {
      // Kumpulkan headcount yang BERUBAH -> tulis balik ke operasi SOW. Dedupe per
      // operation_no; lewati task tanpa operation_no (tak bisa dipetakan ke SOW).
      // Nilai tak berubah di-skip; dikosongkan (tadinya terisi) = HAPUS -> null.
      // Ini di LUAR payload reservasi.
      const baseline = peopleBaselineRef.current || {};
      const changed = [];
      const seen = new Set();
      selectedTasks.forEach((task) => {
        const op = task.operation_no;
        if (op == null || op === '') return;
        const key = peopleKey(task);
        if (seen.has(key)) return;
        seen.add(key);
        const current = peopleEdits[key] ?? '';
        if (current === (baseline[key] ?? '')) return;
        changed.push({
          operation_no: op,
          people_required: current === '' ? null : Number.parseInt(current, 10),
        });
      });

      if (changed.length > 0) {
        setWritingBack(true);
        try {
          await updateOperationPeople(order.order_no, changed);
          // Baseline dimajukan supaya percobaan submit berikutnya tidak menulis ulang
          // perubahan yang sudah tersimpan.
          peopleBaselineRef.current = { ...baseline, ...Object.fromEntries(changed.map((row) => [`op:${row.operation_no}`, row.people_required == null ? '' : String(row.people_required)])) };
        } catch (error) {
          // PERBAIKAN Fase 3: dulu kegagalan ini hanya memunculkan toast dan reservasi
          // TETAP tersimpan — jumlah orang yang diketik scheduler hilang tanpa jejak.
          // Sekarang submit DIHENTIKAN; user memperbaiki atau mengembalikan angkanya.
          setSubmitError(
            `Jumlah orang gagal disimpan: ${error?.message || 'permintaan ditolak server'}. `
            + 'Reservasi TIDAK dibuat — kembalikan angkanya ke semula atau coba lagi.',
          );
          setWritingBack(false);
          return;
        }
        setWritingBack(false);
      }
    }

    const base = {
      area_code: area.areaCode,
      area_name: area.areaName,
      bay_codes: selectedBays,
      start_date: startDate,
      end_date: endDate,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };

    if (isOrderMode) {
      onSubmit({
        ...base,
        booking_type: 'ORDER',
        order_no: order.order_no,
        tasks: selectedTasks.map((task) => ({ task_id: task.task_id, project_id: task.project_id })),
      });
      return;
    }

    // Non-job: TANPA order_no, TANPA tasks (server mengabaikannya, tapi mengirimnya
    // tetap menyesatkan pembaca payload dan log audit).
    onSubmit({
      ...base,
      booking_type: bookingType,
      purpose: purpose.trim(),
    });
  };

  const busy = saving || writingBack;
  const headline = isOrderMode ? (order?.order_no || '-') : bookingTypeLabel(bookingType);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm md:items-stretch md:justify-end"
      onClick={stableClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl focus:outline-none md:h-full md:max-h-none md:w-[440px] md:rounded-none md:rounded-l-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">
              {isOrderMode ? 'Reservasi Bay — Job' : 'Booking Bay — Non-Job'}
            </p>
            <h3
              id={titleId}
              className={`truncate text-base font-extrabold text-slate-800 ${isOrderMode ? 'font-mono tabular-nums' : ''}`}
            >
              {headline}
            </h3>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs font-semibold text-slate-500">
              <MapPin className="h-3 w-3 shrink-0" />
              {area.areaName} · mulai dari <span className="font-mono tabular-nums">{bayCode}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={stableClose}
            aria-label="Tutup"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Isi panel */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50 px-4 py-4">
          {/* --- Mode NONJOB: jenis booking + tujuan --- */}
          {!isOrderMode && (
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Jenis booking
                <select
                  value={bookingType}
                  onChange={(event) => setBookingType(event.target.value)}
                  className={FIELD_CLASS}
                >
                  {NONJOB_BOOKING_TYPES.map((option) => (
                    <option key={option.code} value={option.code}>{option.label}</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-1">
                <label htmlFor={purposeId} className="text-xs font-bold text-slate-700">
                  Tujuan <span className="text-red-600">*</span>
                </label>
                <input
                  id={purposeId}
                  type="text"
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder="Contoh: parkir unit menunggu vendor"
                  aria-invalid={purposeMissing || undefined}
                  className={`${FIELD_CLASS} ${purposeMissing ? 'border-red-400 ring-2 ring-red-200' : ''}`}
                />
                {purposeMissing && (
                  <p className="text-xs font-semibold text-red-600">
                    Tujuan wajib diisi untuk booking non-job.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* --- Mode ORDER: pilih task --- */}
          {isOrderMode && (
            <div className="grid gap-1.5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <ListChecks className="h-4 w-4 text-[#0077b6]" />
                  Pilih Operasi / Task
                  {selectedTasks.length > 0 && (
                    <span className="rounded-full bg-[#caf0f8] px-2 py-0.5 text-xs font-bold tabular-nums text-[#0077b6]">
                      {selectedTasks.length} dipilih
                    </span>
                  )}
                </span>
                {orderTasks.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="rounded text-xs font-bold text-[#0077b6] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
                  >
                    {allChecked ? 'Kosongkan' : 'Pilih semua'}
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white">
                {loadingTasks ? (
                  <div className="space-y-2 p-3">
                    {[0, 1, 2].map((row) => (
                      <Skeleton key={row} className="h-9 rounded-lg" />
                    ))}
                  </div>
                ) : tasksError ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                    <AlertTriangle className="h-7 w-7 text-red-400" strokeWidth={1.5} />
                    <p className="text-xs font-semibold text-red-600">{tasksError}</p>
                    <button
                      type="button"
                      onClick={retryTasks}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Coba lagi
                    </button>
                  </div>
                ) : orderTasks.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                      <ListChecks className="h-5 w-5" />
                    </span>
                    <p className="text-xs font-semibold text-slate-500">Order ini belum di-map ke MS Project.</p>
                    <Link
                      to="/sow-scheduling/map"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0077b6] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                    >
                      Map operasi SAP dulu <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    {orderTasks.map((task) => {
                      const value = peopleEdits[peopleKey(task)] ?? '';
                      return (
                        <TaskRow
                          key={task.task_id}
                          task={task}
                          checked={selectedTaskIdSet.has(task.task_id)}
                          onToggle={toggleTask}
                          peopleValue={value}
                          peopleInvalid={!isValidPeople(value)}
                          onPeopleChange={handlePeopleChange}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {!loadingTasks && !tasksError && orderTasks.length > 0 && tasksMissing && (
                <p className="text-xs font-semibold text-amber-600">Pilih minimal satu task untuk direservasi.</p>
              )}
              {peopleInvalid && (
                <p className="text-xs font-semibold text-red-600">
                  Jumlah orang harus bilangan bulat positif atau dikosongkan.
                </p>
              )}
            </div>
          )}

          {/* --- Peringatan: task terpilih belum punya jadwal MSP --- */}
          {noPlanSchedule && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="flex items-start gap-1.5 text-xs font-bold text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Job belum ada jadwal di MS Project
              </p>
              <p className="mt-1 text-xs text-amber-700">
                Task yang dipilih tidak punya <span className="font-semibold">plan start/finish</span>, jadi tanggal
                booking tidak bisa di-prefill. Isi tanggal manual di bawah, atau lengkapi jadwalnya dulu.
              </p>
              <Link
                to="/sow-scheduling/map"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
              >
                Buka Map operasi SAP <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          {/* --- Bay --- */}
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="grid gap-1 text-xs font-bold text-slate-700">
              Jumlah bay
              <select
                value={effectiveBayCount}
                onChange={(event) => setBayCount(Number(event.target.value))}
                className={`${FIELD_CLASS} tabular-nums`}
              >
                {Array.from({ length: maxBayCount }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>{count} bay</option>
                ))}
              </select>
            </label>
            <div className="rounded-xl border border-[#90e0ef] bg-[#caf0f8] px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">Bay terpilih</p>
              <p className="mt-1 font-mono text-sm font-extrabold tabular-nums text-slate-800">
                {selectedBays.join(', ') || '-'}
              </p>
            </div>
          </div>

          {/* --- Tanggal --- */}
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <CalendarRange className="h-4 w-4 text-[#0077b6]" /> Rentang booking
              </span>
              {isOrderMode && prefillStart && prefillEnd && datesDirty && (
                <button
                  type="button"
                  onClick={resetDatesToPlan}
                  className="inline-flex items-center gap-1 rounded text-xs font-bold text-[#0077b6] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
                >
                  <Undo2 className="h-3.5 w-3.5" /> Pakai jadwal MSP
                </button>
              )}
            </div>
            {prefillActive && (
              <p className="flex items-start gap-1.5 text-xs text-slate-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0077b6]" />
                Diambil otomatis dari jadwal MS Project task terpilih. Mengubah tanggal di bawah
                akan mematikan prefill ini.
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Mulai
                <input
                  type="date"
                  value={startDate}
                  onChange={handleStartDate}
                  aria-invalid={rangeInvalid || undefined}
                  className={`${FIELD_CLASS} tabular-nums ${rangeInvalid ? 'border-red-400 ring-2 ring-red-200' : ''}`}
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Selesai
                <input
                  type="date"
                  value={endDate}
                  onChange={handleEndDate}
                  aria-invalid={rangeInvalid || undefined}
                  className={`${FIELD_CLASS} tabular-nums ${rangeInvalid ? 'border-red-400 ring-2 ring-red-200' : ''}`}
                />
              </label>
            </div>
            {rangeInvalid && (
              <p className="text-xs font-semibold text-red-600">
                Tanggal selesai tidak boleh lebih awal dari tanggal mulai.
              </p>
            )}
            {datesMissing && (
              <p className="text-xs font-semibold text-red-600">Tanggal mulai dan selesai wajib diisi.</p>
            )}
          </div>

          {/* --- Penghuni bay (peringatan LUNAK, D3) --- */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#0077b6]" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-700">Sudah memakai bay ini</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Bay boleh dipakai bersama — daftar ini hanya pemberitahuan, tidak menghalangi
                  penyimpanan.
                </p>
              </div>
            </div>

            {!canQueryOccupants ? (
              <p className="px-4 py-4 text-xs text-slate-500">
                Lengkapi bay dan rentang tanggal yang valid untuk melihat penghuni bay.
              </p>
            ) : loadingOccupants ? (
              <div className="space-y-2 p-3">
                {[0, 1].map((row) => <Skeleton key={row} className="h-10 rounded-lg" />)}
              </div>
            ) : occupantsError ? (
              <div className="flex flex-col items-center gap-2 px-4 py-5 text-center">
                <p className="text-xs font-semibold text-red-600">{occupantsError}</p>
                <button
                  type="button"
                  onClick={retryOccupants}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Coba lagi
                </button>
              </div>
            ) : occupants.rows.length === 0 ? (
              <p className="px-4 py-4 text-xs text-slate-500">
                Belum ada reservasi lain di bay &amp; rentang tanggal ini.
              </p>
            ) : (
              <>
                <ul className="max-h-48 overflow-y-auto">
                  {occupants.rows.map((occupant, index) => (
                    <OccupantRow
                      key={occupant.schedule_id || `${occupant.schedule_group_id || 'row'}-${index}`}
                      occupant={occupant}
                    />
                  ))}
                </ul>
                <p className="border-t border-slate-100 px-4 py-2 text-xs font-semibold tabular-nums text-slate-500">
                  {occupants.truncated
                    ? `Menampilkan ${occupants.rows.length} dari ${occupants.total} penghuni.`
                    : `${occupants.total} penghuni.`}
                </p>
              </>
            )}
          </div>

          {/* --- Catatan --- */}
          <label className="grid gap-1 text-xs font-bold text-slate-700">
            Catatan (opsional)
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Catatan tambahan..."
              className={FIELD_CLASS}
            />
          </label>

          {/* --- Error submit (write-back headcount dsb) --- */}
          {submitError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <p className="text-xs font-semibold text-red-600">{submitError}</p>
            </div>
          )}
        </div>

        {/* Footer aksi */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={stableClose}
            className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              : <Save className="h-4 w-4" />}
            {writingBack ? 'Menyimpan jumlah orang...' : 'Simpan reservasi'}
          </button>
        </div>
      </div>
    </div>
  );
}
