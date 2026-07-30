import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Ban, Building2, CalendarRange, Clock, GripVertical, Inbox, LayoutGrid, ListChecks,
  Loader2, MapPin, Package, RefreshCw, Save, User, Users, Warehouse, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  cancelBaySchedule,
  createBaySchedule,
  fetchBaySchedules,
  fetchOrderTasks,
  fetchSowOrders,
  updateOperationPeople,
} from '../../../services/msProjectService';
import { EmptyState, SearchInput, Skeleton } from '../../../components';
import { areaDef } from '../../../config/manufacturingAreas';
import BayReservationTimeline from './BayReservationTimeline';

// Selector untuk focus-trap modal (elemen yang bisa menerima fokus).
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Reserve audit actor = the logged-in scheduler (falls back to omitted so the
// backend records null rather than a fake 'web-manufacturing' identity).
function readLoginActor() {
  try {
    const user = JSON.parse(sessionStorage.getItem('authUser') || 'null');
    if (!user) return undefined;
    if (user.id != null && user.id !== '') return String(user.id);
    return user.username || user.name || undefined;
  } catch {
    return undefined;
  }
}

// Area name + bays come from the shared topology module (config/manufacturingAreas.js)
// so this map and the timesheet SelectJobPage can no longer drift. Only layout
// metadata (lane placement, cross-aisle spacers, warehouse, top/bottom label) is local.
const areaItem = (code, label) => ({ type: 'area', ...areaDef(code), label });

// `road` entries are kept ONLY as 1-column spacers so both lanes stay 38 columns
// wide and top/bottom bays line up. They render as a subtle cross-aisle divider
// (no A31/A10 road-marker text — that was decorative noise).
const LANE_A = [
  areaItem('AREA-01', 'top'),
  areaItem('AREA-02', 'top'),
  { type: 'road', code: 'A31', label: 'top' },
  areaItem('AREA-03', 'top'),
  areaItem('AREA-04', 'top'),
  areaItem('AREA-05', 'top'),
  areaItem('AREA-06', 'top'),
  areaItem('AREA-07', 'top'),
  { type: 'road', code: 'A10', label: 'top' },
  areaItem('AREA-08', 'top'),
  areaItem('AREA-09', 'top'),
  areaItem('AREA-10', 'top'),
];

const LANE_B = [
  areaItem('AREA-11', 'bottom'),
  areaItem('AREA-12', 'bottom'),
  { type: 'road', code: 'B31', label: 'bottom' },
  areaItem('AREA-13', 'bottom'),
  areaItem('AREA-14', 'bottom'),
  areaItem('AREA-15', 'bottom'),
  { type: 'road', code: 'B18', label: 'bottom' },
  areaItem('AREA-16', 'bottom'),
  areaItem('AREA-17', 'bottom'),
  { type: 'road', code: 'B9', label: 'bottom' },
  { type: 'warehouse', bays: ['B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1'] },
];

const BLASTING_AREA = { type: 'area', ...areaDef('AREA-18'), label: 'top' };

// Floor grid: each lane is a 38-column track, but each bay column gets a READABLE
// minimum width so the reserved job (order + who) is actually legible. The floor
// pans horizontally when it exceeds the viewport — a shop-floor map is meant to be
// panned. Fit-to-width was rejected: squeezing 38 bays into the viewport made every
// cell too narrow to show a job (owner feedback 2026-07-30).
const FLOOR_COLUMNS = 38;
const MIN_BAY_COL = 112;

const ALL_AREAS = [...LANE_A, ...LANE_B, BLASTING_AREA].filter((item) => item.type === 'area');

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysText(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function formatHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return '-';
  return `${hours.toLocaleString('id-ID', { maximumFractionDigits: 2 })}h`;
}

function scheduleBayCount(schedule) {
  return Array.isArray(schedule.bay_codes) ? schedule.bay_codes.length : 0;
}

function buildSchedulesByBay(schedules) {
  const grouped = new Map();
  schedules.forEach((schedule) => {
    (schedule.bay_codes || []).forEach((bayCode) => {
      if (!grouped.has(bayCode)) grouped.set(bayCode, []);
      grouped.get(bayCode).push(schedule);
    });
  });
  return grouped;
}

// Status reservasi -> gaya pill + warna aksen bar. Warna status (amber/emerald/
// slate/red) hanya untuk MAKNA status (bukan seri data biasa) — sesuai aturan.
const RESERVATION_STATUS = {
  RESERVED: { label: 'Reserved', bar: '#f59e0b', pill: 'bg-amber-100 text-amber-700 border-amber-200' },
  CONFIRMED: { label: 'Confirmed', bar: '#10b981', pill: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  DONE: { label: 'Done', bar: '#94a3b8', pill: 'bg-slate-100 text-slate-600 border-slate-200' },
  CANCELLED: { label: 'Cancelled', bar: '#ef4444', pill: 'bg-red-100 text-red-700 border-red-200' },
};

function statusStyle(status) {
  return RESERVATION_STATUS[String(status || '').toUpperCase()] || RESERVATION_STATUS.RESERVED;
}

// Titik warna kecil per grup area — sekadar aksen visual halus (semua token
// biru tersanksi). Deterministik dari kode area agar stabil antar-render.
const AREA_DOTS = ['#90e0ef', '#48cae4', '#00b4d8'];
function areaDot(code) {
  const text = String(code || '');
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) sum += text.charCodeAt(i);
  return AREA_DOTS[sum % AREA_DOTS.length];
}

function dateKey(value) {
  return value ? String(value).slice(0, 10) : '';
}

// Sebuah RESERVASI = semua baris jadwal yang berbagi (order_no, start, end, bays).
// createBaySchedule menyimpan satu baris per task dengan order/bays/tanggal identik,
// jadi kunci ini mengumpulkan kembali seluruh task dari satu reservasi.
function reservationKey(schedule) {
  const bays = Array.isArray(schedule.bay_codes)
    ? [...schedule.bay_codes].sort().join('|')
    : String(schedule.bay_codes || '');
  return [schedule.order_no, dateKey(schedule.start_date), dateKey(schedule.end_date), bays].join('__');
}

function groupReservation(clicked, allSchedules) {
  const key = reservationKey(clicked);
  const matched = (allSchedules || []).filter((schedule) => reservationKey(schedule) === key);
  const siblings = matched.length ? matched : [clicked];
  const first = siblings[0];
  return {
    key,
    order_no: first.order_no,
    part_name: first.part_name,
    customer: first.customer,
    project_name: first.project_name,
    area_name: first.area_name,
    bay_codes: Array.isArray(first.bay_codes) ? first.bay_codes : [],
    start_date: first.start_date,
    end_date: first.end_date,
    status: first.status,
    created_by: first.created_by,
    notes: first.notes,
    tasks: siblings.map((schedule) => ({
      schedule_id: schedule.schedule_id,
      task_id: schedule.task_id,
      operation_no: schedule.operation_no,
      task_name: schedule.task_name,
      workcenter: schedule.workcenter,
      planhours: schedule.planhours,
      people_required: schedule.people_required,
    })),
    scheduleIds: siblings.map((schedule) => schedule.schedule_id),
  };
}

// Headcount (people_required) hidup di OPERASI SOW, jadi dikunci per operation_no.
// Beberapa task bisa berbagi operation_no -> berbagi satu nilai (dedupe saat simpan).
// Task tanpa operation_no jatuh ke kunci task_id (tak bisa ditulis balik ke SOW).
function peopleKey(task) {
  const op = task.operation_no;
  return op != null && op !== '' ? `op:${op}` : `task:${task.task_id}`;
}

// A11y modal bersama: fokus masuk saat buka, Escape menutup, Tab terperangkap,
// fokus kembali ke pemicu saat tutup, scroll body dikunci. Dipakai ReserveModal
// dan ReservationDetailModal agar pola tidak diduplikasi.
function useDialogA11y(onClose) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return undefined;

    const previouslyFocused = document.activeElement;
    const focusables = node.querySelectorAll(FOCUSABLE);
    (focusables[0] || node).focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = node.querySelectorAll(FOCUSABLE);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, [onClose]);
  return dialogRef;
}

// Inline error + retry (dipakai di order pool & peta). Menggantikan pola
// toast-only untuk kegagalan FETCH — toast hanya untuk hasil aksi async.
function InlineError({ message, onRetry, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center ${className}`}>
      <AlertTriangle className="h-8 w-8 text-red-400" strokeWidth={1.5} />
      <p className="max-w-sm text-xs font-semibold text-red-600">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Coba lagi
      </button>
    </div>
  );
}

function OrderCard({ order, selected, onSelect, onDragStart }) {
  return (
    <button
      type="button"
      draggable
      onClick={() => onSelect(order)}
      onDragStart={(event) => onDragStart(event, order)}
      className={`w-full cursor-grab rounded-xl border bg-white p-3 text-left shadow-sm transition-all hover:border-[#90e0ef] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:cursor-grabbing motion-reduce:transition-none ${
        selected ? 'border-[#0077b6] ring-2 ring-[#90e0ef]' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#caf0f8] text-[#0077b6]">
          <GripVertical className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-sm font-extrabold tabular-nums text-slate-800">{order.order_no}</span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{order.part_name || order.ssbr_id || '-'}</span>
          <span className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold text-slate-500">
            <span className="rounded-lg bg-slate-50 px-2 py-1 tabular-nums">{order.operation_count || 0} ops</span>
            <span className="rounded-lg bg-slate-50 px-2 py-1 tabular-nums">{formatHours(order.total_planhours)}</span>
          </span>
        </span>
      </div>
    </button>
  );
}

// Reserved badge — legible (>= text-xs): status pill + order + siapa + rentang +
// chip headcount/bay, dengan bar aksen kiri berwarna status & gradient tipis biru.
// Klik membuka ReservationDetailModal (read + cancel), bukan lagi tombol X inline.
function ScheduleBadge({ schedule, onOpenDetail }) {
  const who = schedule.created_by;
  const bays = scheduleBayCount(schedule);
  const people = schedule.people_required;
  const hasPeople = people != null && people !== '';
  const style = statusStyle(schedule.status);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpenDetail(schedule);
      }}
      title={`${schedule.order_no} — ${style.label}`}
      aria-label={`Detail reservasi ${schedule.order_no} (${style.label})`}
      className="group block w-full overflow-hidden rounded-md border border-[#90e0ef] text-left shadow-sm transition hover:border-[#0077b6] hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
      style={{ background: 'linear-gradient(180deg,#ffffff 0%,#eaf8fd 100%)' }}
    >
      <span className="flex">
        <span aria-hidden="true" className="w-1 shrink-0" style={{ background: style.bar }} />
        <span className="min-w-0 flex-1 px-1.5 py-1">
          <span className="flex items-center justify-between gap-1">
            <span className="truncate font-mono text-xs font-bold tabular-nums text-slate-800">
              {schedule.order_no}
            </span>
            <span className={`shrink-0 rounded-full border px-1 text-[11px] font-bold uppercase tracking-wide ${style.pill}`}>
              {style.label}
            </span>
          </span>
          {who && (
            <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500" title={String(who)}>
              <User className="h-3 w-3 shrink-0" />
              <span className="truncate">{who}</span>
            </span>
          )}
          <span className="mt-0.5 flex items-center gap-1 truncate text-xs tabular-nums text-slate-500">
            <CalendarRange className="h-3 w-3 shrink-0" />
            {formatDate(schedule.start_date)}–{formatDate(schedule.end_date)}
          </span>
          {(hasPeople || bays > 1) && (
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {hasPeople && (
                <span className="inline-flex items-center gap-1 rounded bg-[#caf0f8] px-1 py-0.5 text-xs font-bold tabular-nums text-[#0077b6]">
                  <Users className="h-3 w-3" />{people}
                </span>
              )}
              {bays > 1 && (
                <span className="inline-block rounded bg-slate-100 px-1 py-0.5 text-xs font-bold tabular-nums text-slate-600">
                  {bays} bays
                </span>
              )}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

// Drop-zone + klik. Div (bukan button) karena badge di dalam adalah <button> —
// nested <button> ilegal; pakai role="button" + Enter/Space. Sel KOSONG membuka
// ReserveModal; sel TERISI membuka ReservationDetailModal (klik badge tertentu
// membuka detail reservasi badge itu).
function BayCell({ bayCode, schedules, onDropOrder, onOpenReserve, onOpenDetail }) {
  const [dragOver, setDragOver] = useState(false);
  const occupied = schedules.length > 0;
  const activate = () => (occupied ? onOpenDetail(schedules[0]) : onOpenReserve());

  const baseClass = 'flex h-full min-h-0 min-w-0 cursor-pointer flex-col gap-1 overflow-y-auto rounded-lg border-2 p-1 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none';
  let stateClass;
  let stateStyle;
  if (dragOver) {
    stateClass = 'border-[#0077b6] ring-2 ring-[#00b4d8]';
    stateStyle = { background: '#caf0f8' };
  } else if (occupied) {
    stateClass = 'border-[#0077b6]';
    stateStyle = { background: 'linear-gradient(180deg,#eaf7fc 0%,#cdeff9 100%)' };
  } else {
    stateClass = 'border-dashed border-slate-200 bg-white hover:border-[#90e0ef] hover:bg-slate-50';
    stateStyle = undefined;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      }}
      onDragEnter={(event) => { event.preventDefault(); setDragOver(true); }}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => { setDragOver(false); onDropOrder(event); }}
      aria-label={occupied ? `Bay ${bayCode} — direservasi` : `Bay ${bayCode} — kosong`}
      className={`${baseClass} ${stateClass}`}
      style={stateStyle}
    >
      {occupied ? (
        schedules.map((schedule) => (
          <ScheduleBadge key={`${schedule.schedule_id}-${bayCode}`} schedule={schedule} onOpenDetail={onOpenDetail} />
        ))
      ) : (
        <span className="pointer-events-none m-auto select-none text-[11px] font-semibold uppercase tracking-wide tabular-nums text-slate-300">
          {bayCode}
        </span>
      )}
    </div>
  );
}

function BayArea({ area, schedulesByBay, onDropOrder, onOpenReserve, onOpenDetail }) {
  const label = (
    <div className="flex h-4 items-center justify-center gap-1">
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: areaDot(area.areaCode) }} />
      <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400" title={area.areaName}>
        {area.areaName}
      </span>
    </div>
  );
  const grid = (
    <div className="min-h-0 flex-1">
      <div
        className="grid h-full gap-1"
        style={{ gridTemplateColumns: `repeat(${area.bays.length}, minmax(0, 1fr))` }}
      >
        {area.bays.map((bayCode) => (
          <BayCell
            key={bayCode}
            bayCode={bayCode}
            schedules={schedulesByBay.get(bayCode) || []}
            onDropOrder={(event) => onDropOrder(event, area, bayCode)}
            onOpenReserve={() => onOpenReserve(area, bayCode)}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </div>
    </div>
  );

  return (
    <section className="flex h-full min-w-0 flex-col gap-1" style={{ gridColumn: `span ${area.bays.length}` }}>
      {area.label === 'top' ? (
        <>
          {label}
          {grid}
        </>
      ) : (
        <>
          {grid}
          {label}
        </>
      )}
    </section>
  );
}

// Cross-aisle: hanya divider tipis (menggantikan road-marker A31/A10 + strip abu tebal).
function AisleDivider() {
  return (
    <div className="flex h-full items-stretch justify-center" style={{ gridColumn: 'span 1' }} aria-hidden="true">
      <div className="my-1 w-px bg-slate-200" />
    </div>
  );
}

// Main aisle: garis halus + label kecil (menggantikan band abu-abu tebal).
function AisleBand() {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <div className="h-px flex-1 bg-slate-200" />
      <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-300">Aisle</span>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function WarehouseBlock({ bays }) {
  return (
    <div className="flex h-full min-w-0 flex-col gap-1" style={{ gridColumn: `span ${bays.length}` }}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-100 p-2 text-center text-slate-500">
        <Warehouse className="mb-1 h-4 w-4" />
        <span className="text-xs font-bold">Warehouse</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide tabular-nums text-slate-400">B1–B8</span>
      </div>
      <div className="flex h-4 items-center justify-center">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Storage</span>
      </div>
    </div>
  );
}

function Lane({ items, schedulesByBay, onDropOrder, onOpenReserve, onOpenDetail }) {
  return (
    <div
      className="grid h-full min-h-0 items-stretch gap-1"
      style={{ gridTemplateColumns: `repeat(${FLOOR_COLUMNS}, minmax(${MIN_BAY_COL}px, 1fr))` }}
    >
      {items.map((item) => {
        if (item.type === 'road') return <AisleDivider key={item.code} />;
        if (item.type === 'warehouse') return <WarehouseBlock key="warehouse" bays={item.bays} />;
        return (
          <BayArea
            key={item.areaCode}
            area={item}
            schedulesByBay={schedulesByBay}
            onDropOrder={onDropOrder}
            onOpenReserve={onOpenReserve}
            onOpenDetail={onOpenDetail}
          />
        );
      })}
    </div>
  );
}

// Aside Blasting & Prime — recolor amber (warna STATUS) -> brand/neutral.
// 5 booth: 3 Painting (PT*) + 2 Blasting (BL*), dikelompokkan & dilabeli agar
// scheduler tahu bedanya lewat kode (PT vs BL), bukan 'BP' yang seragam.
function BlastingReservationArea({ schedulesByBay, onDropOrder, onOpenReserve, onOpenDetail }) {
  const paintingBays = BLASTING_AREA.bays.filter((bay) => bay.startsWith('PT'));
  const blastingBays = BLASTING_AREA.bays.filter((bay) => bay.startsWith('BL'));

  // Fungsi render (bukan komponen bersarang) agar BayCell tak remount tiap render
  // induk — kalau dijadikan komponen, state dragOver-nya reset saat parent re-render.
  const renderBooth = (bayCode) => (
    <div key={bayCode} className="grid min-h-0 grid-cols-[40px_minmax(0,1fr)] items-stretch gap-2">
      <div className="flex items-center justify-center rounded-lg bg-[#caf0f8] text-[11px] font-bold uppercase tabular-nums text-[#0077b6]">
        {bayCode}
      </div>
      <BayCell
        bayCode={bayCode}
        schedules={schedulesByBay.get(bayCode) || []}
        onDropOrder={(event) => onDropOrder(event, BLASTING_AREA, bayCode)}
        onOpenReserve={() => onOpenReserve(BLASTING_AREA, bayCode)}
        onOpenDetail={onOpenDetail}
      />
    </div>
  );

  const renderGroup = (label, bays, flexClass) => (
    <div className={`flex min-h-0 flex-col gap-1.5 ${flexClass}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <div
        className="grid min-h-0 flex-1 gap-2"
        style={{ gridTemplateRows: `repeat(${bays.length}, minmax(0, 1fr))` }}
      >
        {bays.map(renderBooth)}
      </div>
    </div>
  );

  return (
    <aside className="flex h-full min-h-[460px] w-[200px] shrink-0 flex-col rounded-xl border border-[#90e0ef] bg-white p-3 shadow-sm lg:min-h-0">
      <div className="mb-2 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
          style={{ background: 'linear-gradient(135deg,#023e8a,#0077b6)' }}
        >
          <MapPin className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">Area 18</p>
          <h4 className="truncate text-xs font-bold text-slate-800">Blasting &amp; Prime</h4>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {renderGroup('Painting', paintingBays, 'flex-[3]')}
        {renderGroup('Blasting', blastingBays, 'flex-[2]')}
      </div>
    </aside>
  );
}

function TaskRow({ task, checked, onToggle, peopleValue, peopleInvalid, onPeopleChange }) {
  const uid = useId();
  const planhours = task.planhours;
  const hasPlan = planhours != null && planhours !== '' && Number.isFinite(Number(planhours));
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
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-slate-600">
              Op {task.operation_no || '-'}
            </span>
            {task.workcenter && (
              <span className="rounded bg-[#caf0f8] px-1.5 py-0.5 text-[11px] font-bold text-[#0077b6]">
                {task.workcenter}
              </span>
            )}
            {hasPlan && (
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-600">
                <Clock className="h-3 w-3" />{formatHours(planhours)}
              </span>
            )}
          </span>
          <span className="mt-1 block truncate text-sm font-semibold text-slate-800">
            {task.task_name || '-'}
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
}

// Modal reservasi. ui/Modal.jsx yang di-export adalah preview kamera (kotak hitam,
// tanpa role=dialog/Escape/focus-trap) dan di luar cakupan file ini untuk diubah,
// jadi a11y modal (role=dialog, aria-modal, Escape, focus trap + return, scroll
// lock, terpusat di desktop) diimplementasikan lokal di sini. Isi & logika form
// reservasi + fetch task DIPERTAHANKAN apa adanya.
function ReserveModal({ reservation, onClose, onSubmit, saving }) {
  const [bayCount, setBayCount] = useState(1);
  const [startDate, setStartDate] = useState(todayText());
  const [endDate, setEndDate] = useState(addDaysText(todayText(), 7));
  const [notes, setNotes] = useState('');
  const [orderTasks, setOrderTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(Boolean(reservation));
  const [tasksError, setTasksError] = useState('');
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [reloadToken, setReloadToken] = useState(0);
  // Headcount (people_required) per operation_no. Baseline (nilai yang dimuat) di
  // ref agar deteksi perubahan tidak jadi dep render. writingBack = fase tulis SOW.
  const [peopleEdits, setPeopleEdits] = useState({});
  const [writingBack, setWritingBack] = useState(false);
  const peopleBaselineRef = useRef({});
  const dialogRef = useDialogA11y(onClose);
  const titleId = useId();

  useEffect(() => {
    if (!reservation) return undefined;

    let active = true;
    fetchOrderTasks(reservation.order.order_no)
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
  }, [reservation, reloadToken]);

  if (!reservation) return null;

  const { area, bayCode, order } = reservation;
  const bayIndex = area.bays.indexOf(bayCode);
  const maxBayCount = Math.max(1, area.bays.length - bayIndex);
  const selectedBays = area.bays.slice(bayIndex, bayIndex + Number(bayCount));

  const allChecked = orderTasks.length > 0 && selectedTaskIds.length === orderTasks.length;
  const toggleTask = (taskId) => {
    setSelectedTaskIds((prev) => (
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    ));
  };
  const toggleAll = () => {
    setSelectedTaskIds(allChecked ? [] : orderTasks.map((task) => task.task_id));
  };

  const selectedTasks = orderTasks.filter((task) => selectedTaskIds.includes(task.task_id));

  // Hanya digit yang diterima; validasi = bilangan bulat positif atau kosong.
  const isValidPeople = (value) => value === '' || /^[1-9]\d*$/.test(value);
  const peopleInvalid = selectedTasks.some((task) => !isValidPeople(peopleEdits[peopleKey(task)] ?? ''));
  const canSubmit = !saving && !writingBack && selectedTasks.length > 0 && !peopleInvalid;

  const handlePeopleChange = (task, raw) => {
    const digits = String(raw).replace(/[^0-9]/g, '');
    setPeopleEdits((prev) => ({ ...prev, [peopleKey(task)]: digits }));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

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
      // Kosong = hapus -> null. (Kosong yang tak berubah sudah ter-skip di atas.)
      changed.push({
        operation_no: op,
        people_required: current === '' ? null : Number.parseInt(current, 10),
      });
    });

    if (changed.length > 0) {
      setWritingBack(true);
      try {
        await updateOperationPeople(order.order_no, changed);
      } catch (error) {
        // Reservasi tetap lanjut; hanya write-back yang gagal -> toast khusus.
        toast.error('Gagal menyimpan jumlah orang', {
          description: error?.message || 'Reservasi tetap diproses.',
        });
      } finally {
        setWritingBack(false);
      }
    }

    const actor = readLoginActor();
    onSubmit({
      order_no: order.order_no,
      area_code: area.areaCode,
      area_name: area.areaName,
      bay_codes: selectedBays,
      start_date: startDate,
      end_date: endDate,
      notes,
      tasks: selectedTasks.map((task) => ({ task_id: task.task_id, project_id: task.project_id })),
      ...(actor ? { actor } : {}),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">Reserve Bay</p>
            <h3 id={titleId} className="font-mono text-base font-extrabold tabular-nums text-slate-800">{order.order_no}</h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">{area.areaName} · mulai dari {bayCode}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <div className="grid gap-1.5">
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
                  <p className="text-xs font-semibold text-red-600">{tasksError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoadingTasks(true);
                      setTasksError('');
                      setReloadToken((token) => token + 1);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
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
                  <p className="text-xs text-slate-400">Import / map order ke sebuah project dulu agar task-nya bisa direservasi.</p>
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto">
                  {orderTasks.map((task) => {
                    const value = peopleEdits[peopleKey(task)] ?? '';
                    return (
                      <TaskRow
                        key={task.task_id}
                        task={task}
                        checked={selectedTaskIds.includes(task.task_id)}
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

            {!loadingTasks && !tasksError && orderTasks.length > 0 && selectedTasks.length === 0 && (
              <p className="text-xs font-semibold text-amber-600">Pilih minimal satu task untuk direservasi.</p>
            )}
            {peopleInvalid && (
              <p className="text-xs font-semibold text-red-600">Jumlah orang harus bilangan bulat positif atau dikosongkan.</p>
            )}
          </div>

          <label className="grid gap-1 text-xs font-bold text-slate-700">
            Bay Count
            <select
              value={bayCount}
              onChange={(event) => setBayCount(Number(event.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
            >
              {Array.from({ length: maxBayCount }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>{count} bay{count > 1 ? 's' : ''}</option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border border-[#90e0ef] bg-[#caf0f8] px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">Selected Bays</p>
            <p className="mt-1 font-mono text-sm font-extrabold tabular-nums text-slate-800">{selectedBays.join(', ')}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-bold text-slate-700">
              Start Date
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
              />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-700">
              End Date
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
              />
            </label>
          </div>

          <label className="grid gap-1 text-xs font-bold text-slate-700">
            Notes
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Optional notes..."
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {(saving || writingBack) ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="h-4 w-4" />}
            Reserve
          </button>
        </div>
      </div>
    </div>
  );
}

// Baris ringkas untuk metadata reservasi (ikon + label + nilai). `icon` diterima
// sebagai node yang sudah dirender agar dipakai lewat ekspresi JS ({icon}).
function DetailRow({ icon, label, children }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#caf0f8] text-[#0077b6]">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <div className="text-sm font-semibold text-slate-800">{children}</div>
      </div>
    </div>
  );
}

// Detail reservasi (read view + cancel). Dibuka saat klik sel/badge TERISI. Meng-
// gabungkan semua baris jadwal satu reservasi (groupReservation) jadi daftar task.
// Cancel membatalkan SEMUA baris sibling reservasi (bukan satu task) demi UX bersih.
function ReservationDetailModal({ detail, onClose, onCancel, busy }) {
  const dialogRef = useDialogA11y(onClose);
  const titleId = useId();
  if (!detail) return null;

  const style = statusStyle(detail.status);
  const bays = Array.isArray(detail.bay_codes) ? detail.bay_codes : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">Detail Reservasi</p>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style.pill}`}>
                {style.label}
              </span>
            </div>
            <h3 id={titleId} className="font-mono text-base font-extrabold tabular-nums text-slate-800">{detail.order_no}</h3>
            {(detail.part_name || detail.customer) && (
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">
                {[detail.part_name, detail.customer].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <DetailRow icon={<MapPin className="h-3.5 w-3.5" />} label="Area / Bay">
            <span className="block">{detail.area_name || '-'}</span>
            <span className="font-mono text-xs tabular-nums text-slate-500">{bays.join(', ') || '-'}</span>
          </DetailRow>
          <DetailRow icon={<CalendarRange className="h-3.5 w-3.5" />} label="Rentang">
            <span className="tabular-nums">{formatDate(detail.start_date)} – {formatDate(detail.end_date)}</span>
          </DetailRow>
          {detail.part_name && (
            <DetailRow icon={<Package className="h-3.5 w-3.5" />} label="Part">
              <span className="block truncate">{detail.part_name}</span>
            </DetailRow>
          )}
          {detail.customer && (
            <DetailRow icon={<Building2 className="h-3.5 w-3.5" />} label="Customer">
              <span className="block truncate">{detail.customer}</span>
            </DetailRow>
          )}
          {detail.created_by && (
            <DetailRow icon={<User className="h-3.5 w-3.5" />} label="Dibuat oleh">
              <span className="block truncate">{detail.created_by}</span>
            </DetailRow>
          )}
        </div>

        {detail.notes && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Catatan</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{detail.notes}</p>
          </div>
        )}

        <div className="mt-5">
          <div className="mb-1.5 flex items-center gap-1.5">
            <ListChecks className="h-4 w-4 text-[#0077b6]" />
            <span className="text-xs font-bold text-slate-700">Task direservasi</span>
            <span className="rounded-full bg-[#caf0f8] px-2 py-0.5 text-xs font-bold tabular-nums text-[#0077b6]">
              {detail.tasks.length}
            </span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white">
            {detail.tasks.map((task, index) => {
              const hasPeople = task.people_required != null && task.people_required !== '';
              const hasPlan = task.planhours != null && task.planhours !== '' && Number.isFinite(Number(task.planhours));
              return (
                <div
                  key={task.schedule_id || `${task.task_id}-${index}`}
                  className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-slate-600">
                        Op {task.operation_no || '-'}
                      </span>
                      {task.workcenter && (
                        <span className="rounded bg-[#caf0f8] px-1.5 py-0.5 text-[11px] font-bold text-[#0077b6]">
                          {task.workcenter}
                        </span>
                      )}
                      {hasPlan && (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-600">
                          <Clock className="h-3 w-3" />{formatHours(task.planhours)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-800">{task.task_name || '-'}</p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold tabular-nums ${
                      hasPeople ? 'bg-[#caf0f8] text-[#0077b6]' : 'bg-slate-100 text-slate-400'
                    }`}
                    title="Jumlah orang (people_required)"
                  >
                    <Users className="h-3.5 w-3.5" />{hasPeople ? task.people_required : '-'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex justify-between gap-2">
          <button
            type="button"
            onClick={() => onCancel(detail)}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Ban className="h-4 w-4" />}
            Batalkan reservasi
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SchedulingAreaPage() {
  const [orders, setOrders] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [schedulesError, setSchedulesError] = useState('');
  const [saving, setSaving] = useState(false);
  const [rangeStart, setRangeStart] = useState(todayText());
  const [rangeEnd, setRangeEnd] = useState(addDaysText(todayText(), 14));
  const [reservation, setReservation] = useState(null);
  const [detail, setDetail] = useState(null);
  const [viewMode, setViewMode] = useState('map'); // 'map' | 'timeline'

  const schedulesByBay = useMemo(() => buildSchedulesByBay(schedules), [schedules]);

  const loadSchedules = useCallback(async () => {
    setLoadingSchedules(true);
    setSchedulesError('');
    try {
      setSchedules(await fetchBaySchedules({ start_date: rangeStart, end_date: rangeEnd }));
    } catch (error) {
      setSchedulesError(error.message || 'Gagal memuat jadwal bay.');
    } finally {
      setLoadingSchedules(false);
    }
  }, [rangeEnd, rangeStart]);

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    setOrdersError('');
    try {
      setOrders(await fetchSowOrders({ q: orderSearch, limit: 80 }));
    } catch (error) {
      setOrdersError(error.message || 'Gagal memuat order.');
    } finally {
      setLoadingOrders(false);
    }
  }, [orderSearch]);

  // Debounce pencarian order (250ms) — memanggil loadOrders yang stabil per query.
  useEffect(() => {
    const timer = setTimeout(loadOrders, 250);
    return () => clearTimeout(timer);
  }, [loadOrders]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const closeReservation = useCallback(() => setReservation(null), []);
  const closeDetail = useCallback(() => setDetail(null), []);

  // Klik sel/badge TERISI atau bar timeline -> kumpulkan seluruh reservasi (semua
  // baris sibling) dan buka detail. schedules terbaru dipakai untuk grouping.
  const openDetail = useCallback((schedule) => {
    if (!schedule) return;
    setDetail(groupReservation(schedule, schedules));
  }, [schedules]);

  const handleOrderDragStart = (event, order) => {
    setSelectedOrder(order);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/json', JSON.stringify({
      order_no: order.order_no,
      part_name: order.part_name,
      operation_count: order.operation_count,
      total_planhours: order.total_planhours,
    }));
    event.dataTransfer.setData('text/plain', order.order_no);
  };

  const resolveDraggedOrder = (event) => {
    const json = event.dataTransfer.getData('application/json');
    if (json) {
      try {
        return JSON.parse(json);
      } catch {
        return selectedOrder;
      }
    }
    const orderNo = event.dataTransfer.getData('text/plain');
    return orders.find((order) => order.order_no === orderNo) || selectedOrder;
  };

  const openReservation = (area, bayCode, order = selectedOrder) => {
    if (!order) {
      toast.error('Pilih atau tarik order dulu');
      return;
    }
    setReservation({ area, bayCode, order });
  };

  const handleDropOrder = (event, area, bayCode) => {
    event.preventDefault();
    openReservation(area, bayCode, resolveDraggedOrder(event));
  };

  const handleSubmitReservation = async (payload) => {
    setSaving(true);
    try {
      await createBaySchedule(payload);
      const taskCount = Array.isArray(payload.tasks) ? payload.tasks.length : 0;
      toast.success('Reservasi tersimpan', {
        description: `${taskCount} task direservasi di ${payload.bay_codes.join(', ')}.`,
      });
      setReservation(null);
      await loadSchedules();
    } catch (error) {
      toast.error('Reservasi gagal', { description: error.message });
    } finally {
      setSaving(false);
    }
  };

  // Batalkan SEMUA baris sibling satu reservasi (cancelBaySchedule per schedule_id)
  // dengan satu toast + satu reload -> UX bersih, tidak menyisakan task menggantung.
  const handleCancelReservation = async (target) => {
    const ids = (target?.scheduleIds || []).filter(Boolean);
    if (ids.length === 0) return;
    setSaving(true);
    try {
      for (const id of ids) {
        await cancelBaySchedule(id);
      }
      toast.success('Reservasi dibatalkan', { description: target.order_no });
      setDetail(null);
      await loadSchedules();
    } catch (error) {
      toast.error('Gagal membatalkan', { description: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col px-4 py-4 md:px-6">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Order pool */}
        <section className="flex min-h-[560px] flex-col rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0">
          <div className="border-b border-slate-200 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                  style={{ background: 'linear-gradient(135deg,#023e8a,#0077b6)' }}
                >
                  <Inbox className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">Order Pool</p>
                  <h3 className="text-sm font-extrabold text-slate-800">SOW Orders</h3>
                </div>
              </div>
              {loadingOrders && orders.length > 0 && (
                <Loader2 className="h-4 w-4 animate-spin text-[#00b4d8] motion-reduce:animate-none" />
              )}
            </div>
            <SearchInput value={orderSearch} onChange={setOrderSearch} placeholder="Cari order / part..." />
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
            {ordersError ? (
              <InlineError message={ordersError} onRetry={loadOrders} />
            ) : loadingOrders && orders.length === 0 ? (
              Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-[76px] w-full rounded-xl" />
              ))
            ) : orders.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="Tidak ada order"
                description={orderSearch
                  ? 'Tidak ada order yang cocok dengan pencarian.'
                  : 'Belum ada SOW order untuk dijadwalkan.'}
                action={orderSearch ? (
                  <button
                    type="button"
                    onClick={() => setOrderSearch('')}
                    className="rounded-lg bg-[#0077b6] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                  >
                    Bersihkan pencarian
                  </button>
                ) : undefined}
              />
            ) : (
              orders.map((order) => (
                <OrderCard
                  key={order.order_no}
                  order={order}
                  selected={selectedOrder?.order_no === order.order_no}
                  onSelect={setSelectedOrder}
                  onDragStart={handleOrderDragStart}
                />
              ))
            )}
          </div>
        </section>

        {/* Bay reservation map */}
        <section className="flex min-h-[640px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                style={{ background: 'linear-gradient(135deg,#023e8a,#0077b6)' }}
              >
                <MapPin className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">Cikupa Layout</p>
                <h3 className="text-sm font-extrabold text-slate-800">Peta Reservasi Bay</h3>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {/* Toggle tampilan: Peta (floor map) vs Timeline (Gantt read-only) */}
              <div className="inline-flex self-end rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Tampilan bay">
                <button
                  type="button"
                  onClick={() => setViewMode('map')}
                  aria-pressed={viewMode === 'map'}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none ${
                    viewMode === 'map' ? 'bg-[#0077b6] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" /> Peta
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('timeline')}
                  aria-pressed={viewMode === 'timeline'}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none ${
                    viewMode === 'timeline' ? 'bg-[#0077b6] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <CalendarRange className="h-3.5 w-3.5" /> Timeline
                </button>
              </div>
              <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Dari
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(event) => setRangeStart(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
                />
              </label>
              <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Sampai
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
                />
              </label>
              <button
                type="button"
                onClick={loadSchedules}
                className="inline-flex items-center gap-1.5 self-end rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
              >
                {loadingSchedules
                  ? <Loader2 className="h-4 w-4 animate-spin text-[#00b4d8] motion-reduce:animate-none" />
                  : <RefreshCw className="h-4 w-4 text-slate-500" />}
                Refresh
              </button>
            </div>
          </div>

          {/* Hint + CTA reservasi */}
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
            {viewMode === 'timeline' ? (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <CalendarRange className="h-3.5 w-3.5 text-[#0077b6]" />
                Tampilan Timeline (hanya-baca) — klik bar untuk melihat detail reservasi.
              </p>
            ) : selectedOrder ? (
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs text-slate-700">
                  <span className="font-mono font-bold tabular-nums text-slate-900">{selectedOrder.order_no}</span>
                  {' '}dipilih — klik bay kosong atau tarik order ke bay untuk reservasi.
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="shrink-0 rounded text-xs font-semibold text-[#0077b6] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
                >
                  Batalkan pilihan
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Pilih atau tarik order dari panel kiri, lalu klik bay untuk membuka reservasi.
              </p>
            )}
          </div>

          {/* Floor plan / timeline, atau inline error */}
          <div className="min-h-0 flex-1 overflow-hidden bg-slate-50 p-3">
            {schedulesError ? (
              <InlineError className="h-full" message={schedulesError} onRetry={loadSchedules} />
            ) : viewMode === 'timeline' ? (
              <BayReservationTimeline
                schedules={schedules}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                onSelectSchedule={(schedule) => openDetail(schedule)}
              />
            ) : (
              <div className="flex h-full min-h-0 gap-3">
                <BlastingReservationArea
                  schedulesByBay={schedulesByBay}
                  onDropOrder={handleDropOrder}
                  onOpenReserve={openReservation}
                  onOpenDetail={openDetail}
                />
                <div className="min-w-0 flex-1 overflow-x-auto">
                  <div className="grid h-full min-h-0 min-w-full grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <Lane
                      items={LANE_A}
                      schedulesByBay={schedulesByBay}
                      onDropOrder={handleDropOrder}
                      onOpenReserve={openReservation}
                      onOpenDetail={openDetail}
                    />
                    <AisleBand />
                    <Lane
                      items={LANE_B}
                      schedulesByBay={schedulesByBay}
                      onDropOrder={handleDropOrder}
                      onOpenReserve={openReservation}
                      onOpenDetail={openDetail}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 border-t border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-4 rounded border-2 border-dashed border-slate-300 bg-white" /> Bay kosong
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-4 rounded border-2 border-[#0077b6] bg-[#caf0f8]" /> Bay direservasi
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-[#0077b6]" /> <span className="tabular-nums">{ALL_AREAS.length}</span> area penjadwalan
            </span>
          </div>
        </section>
      </div>

      {reservation && (
        <ReserveModal
          reservation={reservation}
          onClose={closeReservation}
          onSubmit={handleSubmitReservation}
          saving={saving}
        />
      )}

      {detail && (
        <ReservationDetailModal
          detail={detail}
          onClose={closeDetail}
          onCancel={handleCancelReservation}
          busy={saving}
        />
      )}
    </main>
  );
}
