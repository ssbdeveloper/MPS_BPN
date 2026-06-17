import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, GripVertical, Loader2, MapPin, Save, Search, Warehouse, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  cancelBaySchedule,
  createBaySchedule,
  fetchBaySchedules,
  fetchSowOrders,
} from '../../../services/msProjectService';

const LANE_A = [
  { type: 'area', areaCode: 'AREA-01', areaName: 'Area 1', bays: ['A38', 'A37', 'A36', 'A35'], label: 'top' },
  { type: 'area', areaCode: 'AREA-02', areaName: 'Area 2', bays: ['A34', 'A33', 'A32'], label: 'top' },
  { type: 'road', code: 'A31', label: 'top' },
  { type: 'area', areaCode: 'AREA-03', areaName: 'Area 3', bays: ['A30', 'A29', 'A28', 'A27'], label: 'top' },
  { type: 'area', areaCode: 'AREA-04', areaName: 'Area 4', bays: ['A26', 'A25', 'A24', 'A23'], label: 'top' },
  { type: 'area', areaCode: 'AREA-05', areaName: 'Area 5', bays: ['A22', 'A21', 'A20', 'A19'], label: 'top' },
  { type: 'area', areaCode: 'AREA-06', areaName: 'Area 6', bays: ['A18', 'A17', 'A16', 'A15'], label: 'top' },
  { type: 'area', areaCode: 'AREA-07', areaName: 'Area 7', bays: ['A14', 'A13', 'A12', 'A11'], label: 'top' },
  { type: 'road', code: 'A10', label: 'top' },
  { type: 'area', areaCode: 'AREA-08', areaName: 'Area 8', bays: ['A9', 'A8', 'A7', 'A6'], label: 'top' },
  { type: 'area', areaCode: 'AREA-09', areaName: 'Area 9', bays: ['A5', 'A4', 'A3', 'A2'], label: 'top' },
  { type: 'area', areaCode: 'AREA-10', areaName: 'Area 10', bays: ['A1'], label: 'top' },
];

const LANE_B = [
  { type: 'area', areaCode: 'AREA-11', areaName: 'Area 11', bays: ['B38', 'B37', 'B36', 'B35'], label: 'bottom' },
  { type: 'area', areaCode: 'AREA-12', areaName: 'Area 12', bays: ['B34', 'B33', 'B32'], label: 'bottom' },
  { type: 'road', code: 'B31', label: 'bottom' },
  { type: 'area', areaCode: 'AREA-13', areaName: 'Area 13', bays: ['B30', 'B29', 'B28', 'B27'], label: 'bottom' },
  { type: 'area', areaCode: 'AREA-14', areaName: 'Area 14', bays: ['B26', 'B25', 'B24', 'B23'], label: 'bottom' },
  { type: 'area', areaCode: 'AREA-15', areaName: 'Area 15', bays: ['B22', 'B21', 'B20', 'B19'], label: 'bottom' },
  { type: 'road', code: 'B18', label: 'bottom' },
  { type: 'area', areaCode: 'AREA-16', areaName: 'Area 16', bays: ['B17', 'B16', 'B15', 'B14'], label: 'bottom' },
  { type: 'area', areaCode: 'AREA-17', areaName: 'Area 17', bays: ['B13', 'B12', 'B11', 'B10'], label: 'bottom' },
  { type: 'road', code: 'B9', label: 'bottom' },
  { type: 'warehouse', bays: ['B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1'] },
];

const BLASTING_AREA = {
  type: 'area',
  areaCode: 'AREA-18',
  areaName: 'Blasting & Prime',
  bays: ['BP4', 'BP3', 'BP2', 'BP1'],
  label: 'top',
};

const BAY_COLUMN_WIDTH = 104;
const LANE_COLUMN_GAP = 6;
const LANE_WIDTH = (BAY_COLUMN_WIDTH * 38) + (LANE_COLUMN_GAP * 37);

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

function scheduleOverlapsBay(schedule, bayCode) {
  return Array.isArray(schedule.bay_codes) && schedule.bay_codes.includes(bayCode);
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

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-[#0096c7] focus-within:ring-2 focus-within:ring-[#00b4d8]">
      <Search className="h-4 w-4 shrink-0 text-slate-400" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm font-semibold text-slate-800 placeholder-slate-400 outline-none"
      />
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
      className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-all hover:border-[#90e0ef] hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] ${
        selected ? 'border-[#0096c7] ring-2 ring-[#90e0ef]' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#caf0f8] text-[#0077b6]">
          <GripVertical className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-sm font-extrabold text-slate-800">{order.order_no}</span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{order.part_name || order.ssbr_id || '-'}</span>
          <span className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-500">
            <span className="rounded-lg bg-slate-50 px-2 py-1">{order.operation_count || 0} ops</span>
            <span className="rounded-lg bg-slate-50 px-2 py-1">{formatHours(order.total_planhours)}</span>
          </span>
        </span>
      </div>
    </button>
  );
}

function ScheduleBadge({ schedule, onCancel }) {
  return (
    <div className="rounded-md border border-[#90e0ef] bg-white px-1.5 py-1 text-left shadow-sm">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate font-mono text-[10px] font-extrabold text-slate-800">{schedule.order_no}</p>
          <p className="truncate text-[9px] font-semibold text-slate-500">
            {formatDate(schedule.start_date)} - {formatDate(schedule.end_date)}
          </p>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCancel(schedule);
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
          aria-label={`Cancel ${schedule.order_no}`}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {scheduleBayCount(schedule) > 1 && (
        <p className="mt-1 rounded bg-[#caf0f8] px-1 py-0.5 text-[9px] font-bold text-[#0077b6]">
          {scheduleBayCount(schedule)} bays
        </p>
      )}
    </div>
  );
}

function BayCell({ bayCode, schedules, onDropOrder, onOpenReserve, onCancel }) {
  const occupied = schedules.length > 0;

  return (
    <button
      type="button"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDropOrder(event, bayCode)}
      onClick={() => onOpenReserve(bayCode)}
      className={`flex h-full min-h-0 min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg border p-1.5 text-left transition focus:outline-none focus:ring-2 focus:ring-[#00b4d8] ${
        occupied
          ? 'border-[#90e0ef] bg-[#caf0f8]/60 hover:bg-[#caf0f8]'
          : 'border-dashed border-slate-300 bg-white hover:border-[#90e0ef] hover:bg-slate-50'
      }`}
    >
      {schedules.length ? schedules.map((schedule) => (
        <ScheduleBadge key={`${schedule.schedule_id}-${bayCode}`} schedule={schedule} onCancel={onCancel} />
      )) : (
        <span className="flex flex-1 items-center justify-center text-[10px] font-bold text-slate-400">
          Ready
        </span>
      )}
    </button>
  );
}

function BayArea({ area, schedulesByBay, onDropOrder, onOpenReserve, onCancel }) {
  const areaLabel = (
    <div className="h-6 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-[10px] font-extrabold text-[#0077b6]">
      {area.areaName}
    </div>
  );
  const labels = (
    <div
      className="grid h-5 items-center gap-1 text-center text-[10px] font-extrabold text-slate-700"
      style={{ gridTemplateColumns: `repeat(${area.bays.length}, minmax(0, 1fr))` }}
    >
      {area.bays.map((bayCode) => <span key={bayCode}>{bayCode}</span>)}
    </div>
  );
  const bayShell = (
    <div className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
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
            onCancel={onCancel}
          />
        ))}
      </div>
    </div>
  );

  return (
    <section className="flex h-full min-w-0 flex-col gap-1" style={{ gridColumn: `span ${area.bays.length}` }}>
      {area.label === 'top' ? (
        <>
          {areaLabel}
          {labels}
          {bayShell}
        </>
      ) : (
        <>
          {bayShell}
          {labels}
          <div className="mt-auto">{areaLabel}</div>
        </>
      )}
    </section>
  );
}

function RoadMarker({ code, label = 'top' }) {
  const roadLabel = <div className="h-5 text-center text-[10px] font-black text-slate-500">{code}</div>;
  const areaSpacer = <div className="h-6" />;
  const topBody = (
    <div className="flex min-h-0 flex-1 justify-center overflow-visible">
      <div className="-mb-5 h-[calc(100%+24px)] w-8 bg-slate-100" />
    </div>
  );
  const bottomBody = (
    <div className="flex min-h-0 flex-1 justify-center overflow-visible">
      <div className="-mt-5 h-[calc(100%+24px)] w-8 bg-slate-100" />
    </div>
  );

  return (
    <div className="flex h-full min-w-[104px] flex-col gap-1" style={{ gridColumn: 'span 1' }}>
      {label === 'top' ? (
        <>
          {areaSpacer}
          {roadLabel}
          {topBody}
        </>
      ) : (
        <>
          {bottomBody}
          {roadLabel}
          {areaSpacer}
        </>
      )}
    </div>
  );
}

function WarehouseBlock({ bays }) {
  return (
    <div className="flex h-full min-w-0 flex-col gap-1" style={{ gridColumn: `span ${bays.length}` }}>
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-slate-100 p-3 text-center text-xs font-black text-slate-500">
        <Warehouse className="mr-2 h-4 w-4" />
        Warehouse<br />B1-B8
      </div>
      <div
        className="grid h-5 items-center gap-1 text-center text-[10px] font-extrabold text-slate-500"
        style={{ gridTemplateColumns: `repeat(${bays.length}, minmax(0, 1fr))` }}
      >
        {bays.map((bayCode) => <span key={bayCode}>{bayCode}</span>)}
      </div>
      <div className="mt-auto">
        <div className="h-6 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-[10px] font-extrabold text-slate-500">
          Warehouse
        </div>
      </div>
    </div>
  );
}

function Lane({ items, schedulesByBay, onDropOrder, onOpenReserve, onCancel, className = '' }) {
  return (
    <div
      className={`grid h-full min-h-0 items-stretch gap-1.5 ${className}`}
      style={{
        gridTemplateColumns: `repeat(38, minmax(${BAY_COLUMN_WIDTH}px, 1fr))`,
        minWidth: LANE_WIDTH,
      }}
    >
      {items.map((item) => {
        if (item.type === 'road') return <RoadMarker key={item.code} code={item.code} label={item.label || 'top'} />;
        if (item.type === 'warehouse') return <WarehouseBlock key="warehouse" bays={item.bays} />;
        return (
          <BayArea
            key={item.areaCode}
            area={item}
            schedulesByBay={schedulesByBay}
            onDropOrder={onDropOrder}
            onOpenReserve={onOpenReserve}
            onCancel={onCancel}
          />
        );
      })}
    </div>
  );
}

function BlastingReservationArea({ schedulesByBay, onDropOrder, onOpenReserve, onCancel }) {
  return (
    <aside className="flex h-full min-h-[420px] w-[170px] shrink-0 flex-col rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-amber-800">
      <div className="mb-3 text-center">
        <p className="text-[10px] font-black uppercase tracking-wide text-amber-700">Area 18</p>
        <h4 className="text-xs font-black uppercase leading-tight">Blasting & Prime</h4>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-4 gap-2">
        {BLASTING_AREA.bays.map((bayCode) => (
          <div key={bayCode} className="grid min-h-0 grid-cols-[34px_minmax(0,1fr)] items-stretch gap-2">
            <div className="flex items-center justify-center rounded-lg bg-white/70 text-[10px] font-black text-amber-700">
              {bayCode}
            </div>
            <BayCell
              bayCode={bayCode}
              schedules={schedulesByBay.get(bayCode) || []}
              onDropOrder={(event) => onDropOrder(event, BLASTING_AREA, bayCode)}
              onOpenReserve={() => onOpenReserve(BLASTING_AREA, bayCode)}
              onCancel={onCancel}
            />
          </div>
        ))}
      </div>
    </aside>
  );
}

function ReserveModal({ reservation, onClose, onSubmit, saving }) {
  const [bayCount, setBayCount] = useState(1);
  const [startDate, setStartDate] = useState(todayText());
  const [endDate, setEndDate] = useState(addDaysText(todayText(), 7));
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setBayCount(1);
    setStartDate(todayText());
    setEndDate(addDaysText(todayText(), 7));
    setNotes('');
  }, [reservation]);

  if (!reservation) return null;

  const { area, bayCode, order } = reservation;
  const bayIndex = area.bays.indexOf(bayCode);
  const maxBayCount = Math.max(1, area.bays.length - bayIndex);
  const selectedBays = area.bays.slice(bayIndex, bayIndex + Number(bayCount));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 md:items-center md:px-4">
      <div className="w-full rounded-t-2xl bg-white p-6 shadow-xl md:max-w-lg md:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#0077b6]">Reserve Bay</p>
            <h3 className="text-base font-extrabold text-slate-800">{order.order_no}</h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">{area.areaName} - start from {bayCode}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1 text-xs font-bold text-slate-700">
            Bay Count
            <select
              value={bayCount}
              onChange={(event) => setBayCount(Number(event.target.value))}
              className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            >
              {Array.from({ length: maxBayCount }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>{count} bay{count > 1 ? 's' : ''}</option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border border-[#90e0ef] bg-[#caf0f8] px-3 py-2">
            <p className="text-[10px] font-bold uppercase text-[#0077b6]">Selected Bays</p>
            <p className="mt-1 font-mono text-sm font-extrabold text-slate-800">{selectedBays.join(', ')}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-bold text-slate-700">
              Start Date
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
              />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-700">
              End Date
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
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
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit({
              order_no: order.order_no,
              area_code: area.areaCode,
              area_name: area.areaName,
              bay_codes: selectedBays,
              start_date: startDate,
              end_date: endDate,
              notes,
              actor: 'web-manufacturing',
            })}
            disabled={saving}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#0096c7] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#0077b6] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Reserve
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
  const [saving, setSaving] = useState(false);
  const [rangeStart, setRangeStart] = useState(todayText());
  const [rangeEnd, setRangeEnd] = useState(addDaysText(todayText(), 14));
  const [reservation, setReservation] = useState(null);

  const schedulesByBay = useMemo(() => buildSchedulesByBay(schedules), [schedules]);

  const loadSchedules = useCallback(async () => {
    setLoadingSchedules(true);
    try {
      setSchedules(await fetchBaySchedules({ start_date: rangeStart, end_date: rangeEnd }));
    } catch (error) {
      toast.error('Failed to load bay schedules', { description: error.message });
    } finally {
      setLoadingSchedules(false);
    }
  }, [rangeEnd, rangeStart]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoadingOrders(true);
      try {
        setOrders(await fetchSowOrders({ q: orderSearch, limit: 80 }));
      } catch (error) {
        toast.error('Failed to load orders', { description: error.message });
      } finally {
        setLoadingOrders(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [orderSearch]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

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
      toast.error('Choose or drag an order first');
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
      toast.success('Bay reserved', {
        description: `${payload.order_no} reserved at ${payload.bay_codes.join(', ')}.`,
      });
      setReservation(null);
      await loadSchedules();
    } catch (error) {
      toast.error('Reserve failed', { description: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSchedule = async (schedule) => {
    setSaving(true);
    try {
      await cancelBaySchedule(schedule.schedule_id);
      toast.success('Reservation cancelled', { description: schedule.order_no });
      await loadSchedules();
    } catch (error) {
      toast.error('Cancel failed', { description: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:px-6">
      <div>
       
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(280px,25vw)_minmax(0,1fr)]">
        <section className="flex min-h-[560px] flex-col rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0">
          <div className="border-b border-slate-200 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase text-[#0077b6]">Order Pool</p>
                <h3 className="text-sm font-extrabold text-slate-800">SOW Orders</h3>
              </div>
              {loadingOrders && <Loader2 className="h-4 w-4 animate-spin text-[#0096c7]" />}
            </div>
            <SearchBox value={orderSearch} onChange={setOrderSearch} placeholder="Search order..." />
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
            {orders.map((order) => (
              <OrderCard
                key={order.order_no}
                order={order}
                selected={selectedOrder?.order_no === order.order_no}
                onSelect={setSelectedOrder}
                onDragStart={handleOrderDragStart}
              />
            ))}
            {!loadingOrders && orders.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-8 text-center text-sm font-semibold text-slate-400">
                No orders found.
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-[640px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase text-[#0077b6]">Cikupa Layout</p>
              <h3 className="text-sm font-extrabold text-slate-800">Bay Reservation Map</h3>
              
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-500">
                From
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(event) => setRangeStart(event.target.value)}
                  className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                />
              </label>
              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-500">
                To
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(event.target.value)}
                  className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                />
              </label>
              <button
                type="button"
                onClick={loadSchedules}
                className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
              >
                {loadingSchedules ? <Loader2 className="h-4 w-4 animate-spin text-[#0096c7]" /> : <CalendarDays className="h-4 w-4 text-[#0077b6]" />}
                Refresh
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-slate-50 p-3">
            <div
              className="inline-flex h-full min-h-0 items-stretch gap-3"
              style={{ minWidth: LANE_WIDTH + 194 }}
            >
              <BlastingReservationArea
                schedulesByBay={schedulesByBay}
                onDropOrder={handleDropOrder}
                onOpenReserve={openReservation}
                onCancel={handleCancelSchedule}
              />
              <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_40px_minmax(0,1fr)] rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <Lane
                  items={LANE_A}
                  schedulesByBay={schedulesByBay}
                  onDropOrder={handleDropOrder}
                  onOpenReserve={openReservation}
                  onCancel={handleCancelSchedule}
                />
                <div
                  className="relative z-10 flex h-10 items-center justify-center bg-slate-100 text-xs font-black uppercase tracking-wide text-slate-500"
                  style={{ minWidth: LANE_WIDTH }}
                >
                  Main Aisle / Jalur Akses Tengah
                </div>
                <Lane
                  items={LANE_B}
                  schedulesByBay={schedulesByBay}
                  onDropOrder={handleDropOrder}
                  onOpenReserve={openReservation}
                  onCancel={handleCancelSchedule}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded border border-dashed border-slate-300 bg-white" /> Ready bay</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded border border-[#90e0ef] bg-[#caf0f8]" /> Reserved bay</span>
            <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-[#0077b6]" /> {ALL_AREAS.length} scheduling areas</span>
          </div>
        </section>
      </div>

      <ReserveModal
        reservation={reservation}
        onClose={() => setReservation(null)}
        onSubmit={handleSubmitReservation}
        saving={saving}
      />
    </main>
  );
}
