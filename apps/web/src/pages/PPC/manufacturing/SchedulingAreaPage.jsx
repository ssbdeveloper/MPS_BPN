// SchedulingAreaPage — ORKESTRATOR peta reservasi bay (Fase 3 + Fase 5).
//
// Seluruh presentasi tinggal di features/bayScheduling/. Halaman ini hanya memegang
// state yang benar-benar lintas-komponen: tingkat peta, area/bay terpilih, order
// terpilih, rentang fetch, panel reservasi, dan modal detail — plus dua aksi async
// (createBaySchedule, cancel) beserta toast-nya.
//
// TIGA HAL YANG SENGAJA TIDAK ADA DI SINI:
//   1. State pencarian order. Ia hidup di OrderPanel (input) dan di OrderPoolPanel
//      (query) — kalau naik ke halaman, tiap ketikan me-render ulang peta. Itu akar
//      keluhan "berat" (rencana §R2 / Fase 5).
//   2. Kursor tanggal. Milik useBaySchedules, supaya `byBay` selalu sinkron dengannya.
//   3. Arrow inline untuk handler peta. Semua useCallback stabil, kalau tidak
//      React.memo pada sel bay / kartu order tidak ada gunanya.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, LayoutGrid, Loader2,
  PackagePlus, ParkingSquare, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  cancelBaySchedule, cancelBayScheduleGroup, createBaySchedule,
} from '../../../services/msProjectService';
import { Skeleton } from '../../../components';
import {
  AREA_BY_CODE, BayAreaDetail, FloorMapOverview, OrderPanel, ReservationDetailModal,
  ReservationPanel, addDaysText, bookingTypeOf, dateKey, dedupeByGroup, formatDate,
  groupKeyOf, todayText, useBaySchedules, useSowOrders,
} from '../../../features/bayScheduling';
import BayReservationTimeline from './BayReservationTimeline';

/* ── Rentang reservasi (A-15: hard cap, bukan sekadar saran) ─────────────────
   Window timeline = window RESERVASI (start_date/end_date), TERPISAH dari window
   task MSP yang dipakai pool order (D6). Tanpa cap, satu ketikan "2099" di input
   date menarik ribuan hari kolom timeline dan satu query tanpa batas.            */
const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 90;
const WINDOW_BACK_DAYS = 180;
const WINDOW_FORWARD_DAYS = 365;
const RANGE_PRESETS = [7, 14, 30];

const minText = (a, b) => (a < b ? a : b);

function clampText(value, min, max, fallback) {
  const text = dateKey(value) || dateKey(fallback);
  if (!text) return min;
  if (text < min) return min;
  if (text > max) return max;
  return text;
}

// Dijalankan pada SETIAP perubahan, bukan hanya lewat atribut min/max: input date
// tetap menerima nilai di luar batas kalau diketik manual. `prev` dipakai saat user
// MENGOSONGKAN input — tanpa itu field kosong akan melempar window ke batas bawah.
function normalizeRange(start, end, bounds, prev) {
  const from = clampText(start, bounds.min, bounds.max, prev.start);
  const until = minText(addDaysText(from, MAX_RANGE_DAYS - 1), bounds.max);
  return { start: from, end: clampText(end, from, until, prev.end) };
}

function readDraggedOrder(event) {
  const json = event.dataTransfer?.getData('application/json');
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && parsed.order_no ? parsed : null;
  } catch {
    return null;
  }
}

// Ringkas penghuni bay jadi satu kalimat toast. Hormati truncated/total: daftar
// occupants dipotong server (50), jadi "+N lainnya" saja akan mengecilkan angka.
function describeOccupants(overlap) {
  const rows = Array.isArray(overlap?.occupants) ? overlap.occupants : [];
  const labels = [...new Set(
    rows.map((row) => row.order_no || row.purpose || bookingTypeOf(row).label).filter(Boolean),
  )];
  if (labels.length === 0) return 'reservasi lain';
  const head = labels.slice(0, 3).join(', ');
  const rest = labels.length - 3;
  const total = Number(overlap?.total);
  const text = rest > 0 ? `${head}, +${rest} lainnya` : head;
  return overlap?.truncated && Number.isFinite(total) && total > rows.length
    ? `${text} (dari ${total} penghuni)`
    : text;
}

function InlineError({ message, onRetry }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center">
      <AlertTriangle className="h-8 w-8 text-red-400" strokeWidth={1.5} />
      <p className="max-w-sm text-xs font-semibold text-red-600">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Coba lagi
      </button>
    </div>
  );
}

// Pool order (Tingkat 2). Hook-nya sengaja dipanggil DI SINI, bukan di halaman:
// dengan begitu perubahan query/pencarian berhenti di subtree ini dan tidak pernah
// menyentuh props FloorMapOverview / BayAreaDetail.
const OrderPoolPanel = React.memo(function OrderPoolPanel({ selectedOrder, onSelectOrder, onDragStart }) {
  const pool = useSowOrders();
  return (
    <OrderPanel
      orders={pool.orders}
      total={pool.total}
      shown={pool.shown}
      loading={pool.loading}
      error={pool.error}
      search={pool.search}
      onSearchChange={pool.setSearch}
      tab={pool.tab}
      onTabChange={pool.setTab}
      selectedOrder={selectedOrder}
      onSelectOrder={onSelectOrder}
      onDragStart={onDragStart}
      onLoadMore={pool.loadMore}
      onReload={pool.reload}
    />
  );
});

const TOGGLE_BASE = 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none';
const DATE_INPUT = 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold tabular-nums text-slate-800 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]';
const STEP_BTN = 'flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';
const ACTION_BTN = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

export default function SchedulingAreaPage() {
  const [today] = useState(todayText);
  const bounds = useMemo(() => ({
    min: addDaysText(today, -WINDOW_BACK_DAYS),
    max: addDaysText(today, WINDOW_FORWARD_DAYS),
  }), [today]);

  const [range, setRange] = useState(() => ({
    start: today,
    end: addDaysText(today, DEFAULT_RANGE_DAYS - 1),
  }));
  const [viewMode, setViewMode] = useState('map');      // 'map' | 'timeline'
  const [level, setLevel] = useState('overview');       // 'overview' | 'area'
  const [selectedAreaCode, setSelectedAreaCode] = useState(null);
  const [selectedBay, setSelectedBay] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [reservation, setReservation] = useState(null); // { mode, bayCode, order }
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);

  const {
    schedules, byBay, loading, error, reload, cursorDate, setCursorDate,
  } = useBaySchedules({ rangeStart: range.start, rangeEnd: range.end });

  const area = selectedAreaCode ? AREA_BY_CODE[selectedAreaCode] : null;
  const maxEnd = minText(addDaysText(range.start, MAX_RANGE_DAYS - 1), bounds.max);

  // Indeks reservasi (satu entri per schedule_group_id) untuk membuka modal detail
  // dari sel peta MAUPUN bar timeline. Disimpan di ref supaya openDetail bisa
  // useCallback([]) — handler yang berganti identitas tiap fetch akan mematikan
  // React.memo pada seluruh sel bay tingkat 2.
  const reservationIndex = useMemo(() => {
    const map = new Map();
    dedupeByGroup(schedules).forEach((entry) => map.set(entry.group_key, entry));
    return map;
  }, [schedules]);
  const indexRef = useRef(reservationIndex);
  useEffect(() => { indexRef.current = reservationIndex; }, [reservationIndex]);
  const selectedOrderRef = useRef(selectedOrder);
  useEffect(() => { selectedOrderRef.current = selectedOrder; }, [selectedOrder]);

  /* ── Handler peta: WAJIB stabil ─────────────────────────────────────────── */
  const handleSelectArea = useCallback((areaCode) => {
    setSelectedAreaCode(areaCode);
    setSelectedBay(null);
    setLevel('area');
  }, []);
  const handleBack = useCallback(() => { setLevel('overview'); setSelectedBay(null); }, []);
  const handleSelectBay = useCallback((bayCode) => setSelectedBay(bayCode), []);
  const closeReservation = useCallback(() => setReservation(null), []);
  const closeDetail = useCallback(() => setDetail(null), []);

  const openDetail = useCallback((schedule) => {
    if (!schedule) return;
    setDetail(indexRef.current.get(groupKeyOf(schedule)) || dedupeByGroup([schedule])[0] || null);
  }, []);

  const handleSelectOrder = useCallback((order) => setSelectedOrder(order), []);

  const handleOrderDragStart = useCallback((event, order) => {
    setSelectedOrder(order);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/json', JSON.stringify(order));
    event.dataTransfer.setData('text/plain', String(order.order_no || ''));
  }, []);

  // Drop hanya ada di Tingkat 2 (D5). D2: order tanpa task MSP ditolak SEBELUM panel
  // dibuka — kartunya memang sudah tidak bisa ditarik, ini jaring pengaman kedua.
  const handleDropOrder = useCallback((event, dropArea, bayCode) => {
    setSelectedBay(bayCode);
    const order = readDraggedOrder(event) || selectedOrderRef.current;
    if (!order) {
      toast.error('Pilih atau tarik order dulu', { description: 'Bay dipilih, tapi belum ada order yang ditarik.' });
      return;
    }
    if (!order.has_msp_task) {
      toast.error('Order belum punya task MS Project', {
        description: 'Map operasi SAP-nya dulu di menu Map SAP Operations agar bisa dibooking.',
      });
      return;
    }
    setSelectedOrder(order);
    setReservation({ mode: 'ORDER', bayCode, order });
  }, []);

  /* ── Aksi async ─────────────────────────────────────────────────────────── */
  const handleSubmitReservation = useCallback(async (payload) => {
    setSaving(true);
    try {
      const result = await createBaySchedule(payload);
      const bays = (payload.bay_codes || []).join(', ');
      const what = payload.booking_type === 'ORDER'
        ? `${Array.isArray(payload.tasks) ? payload.tasks.length : 0} task`
        : bookingTypeOf(payload).label;

      // Sejak D3 bay tidak pernah eksklusif: server TIDAK menolak overlap, hanya
      // melaporkan penghuni lain lewat warnings. Kalau toast ini tidak menampilkannya,
      // pencegahan sudah dicabut tapi pemberitahuannya tidak ada — lebih buruk dari 409.
      const overlap = (result?.warnings || []).find((warning) => warning.type === 'BAY_OVERLAP');
      if ((overlap?.occupants || []).length > 0) {
        toast.warning('Reservasi tersimpan — bay dipakai bersama', {
          description: `${what} di ${bays}. Sudah ada: ${describeOccupants(overlap)}.`,
          duration: 8000,
        });
      } else {
        toast.success('Reservasi tersimpan', { description: `${what} direservasi di ${bays}.` });
      }
      setReservation(null);
      reload();
    } catch (err) {
      toast.error('Reservasi gagal', { description: err.message });
    } finally {
      setSaving(false);
    }
  }, [reload]);

  // Jalur utama = endpoint grup (satu transaksi di server), jadi tidak bisa lagi
  // tersisa batch separuh-batal (A-09). Baris warisan sebelum migrasi Fase 2 belum
  // punya schedule_group_id -> fallback loop per schedule_id. Aktor TIDAK dikirim di
  // body: backend memaksanya dari header sesi.
  const handleCancelReservation = useCallback(async (target) => {
    const groupId = target?.schedule_group_id;
    const ids = (target?.schedule_ids || target?.scheduleIds || []).filter(Boolean);
    if (!groupId && ids.length === 0) return;
    setSaving(true);
    try {
      if (groupId) {
        await cancelBayScheduleGroup(groupId);
      } else {
        for (const id of ids) {
          await cancelBaySchedule(id);
        }
      }
      toast.success('Reservasi dibatalkan', {
        description: target.order_no || target.purpose || bookingTypeOf(target).label,
      });
      setDetail(null);
      reload();
    } catch (err) {
      toast.error('Gagal membatalkan', { description: err.message });
    } finally {
      setSaving(false);
    }
  }, [reload]);

  /* ── Render ─────────────────────────────────────────────────────────────── */
  const applyRange = (start, end) => setRange((prev) => normalizeRange(start, end, bounds, prev));
  const stepCursor = (days) => setCursorDate(addDaysText(cursorDate, days));
  const showAreaLevel = viewMode === 'map' && level === 'area' && Boolean(area);

  let content;
  if (error) {
    content = <InlineError message={error} onRetry={reload} />;
  } else if (loading && schedules.length === 0) {
    content = <Skeleton className="h-full min-h-[420px] w-full rounded-xl" />;
  } else if (viewMode === 'timeline') {
    content = (
      <BayReservationTimeline
        schedules={schedules}
        rangeStart={range.start}
        rangeEnd={range.end}
        onSelectSchedule={openDetail}
      />
    );
  } else if (showAreaLevel) {
    content = (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        <OrderPoolPanel
          selectedOrder={selectedOrder}
          onSelectOrder={handleSelectOrder}
          onDragStart={handleOrderDragStart}
        />
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <p className="min-w-0 text-xs text-slate-600">
              {selectedBay
                ? <>Bay <span className="font-mono font-bold tabular-nums text-slate-900">{selectedBay}</span> dipilih{selectedOrder ? <> · order <span className="font-mono font-bold tabular-nums text-slate-900">{selectedOrder.order_no}</span></> : null}.</>
                : 'Klik salah satu bay untuk memilihnya, lalu buat reservasi order atau booking non-job.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!selectedBay || !selectedOrder}
                onClick={() => setReservation({ mode: 'ORDER', bayCode: selectedBay, order: selectedOrder })}
                title={!selectedOrder ? 'Pilih order di panel kiri dulu' : undefined}
                className={`${ACTION_BTN} bg-[#0077b6] text-white hover:bg-[#023e8a]`}
              >
                <PackagePlus className="h-4 w-4" /> Reservasi order
              </button>
              {/* Fase 3 — booking di luar job (parkir unit / taruh barang). Tidak butuh
                  order maupun task; hanya jenis booking + tujuan yang wajib. */}
              <button
                type="button"
                disabled={!selectedBay}
                onClick={() => setReservation({ mode: 'NONJOB', bayCode: selectedBay, order: null })}
                className={`${ACTION_BTN} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
              >
                <ParkingSquare className="h-4 w-4" /> Booking non-job
              </button>
            </div>
          </div>
          <BayAreaDetail
            area={area}
            schedulesByBay={byBay}
            cursorDate={cursorDate}
            selectedBay={selectedBay}
            onSelectBay={handleSelectBay}
            onOpenDetail={openDetail}
            onDropOrder={handleDropOrder}
            onBack={handleBack}
          />
        </div>
      </div>
    );
  } else {
    content = (
      <FloorMapOverview
        schedulesByBay={byBay}
        cursorDate={cursorDate}
        selectedAreaCode={selectedAreaCode}
        onSelectArea={handleSelectArea}
      />
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:px-6">
      <section className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Tampilan bay">
            <button
              type="button"
              onClick={() => setViewMode('map')}
              aria-pressed={viewMode === 'map'}
              className={`${TOGGLE_BASE} ${viewMode === 'map' ? 'bg-[#0077b6] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Peta
            </button>
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              aria-pressed={viewMode === 'timeline'}
              className={`${TOGGLE_BASE} ${viewMode === 'timeline' ? 'bg-[#0077b6] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <CalendarRange className="h-3.5 w-3.5" /> Timeline
            </button>
          </div>

          {/* Kursor tanggal (A-08) — HANYA untuk peta. Tanpa "as-of day", dua reservasi
              berurutan pada satu bay tampak persis sama dengan dua yang barengan. */}
          {viewMode === 'map' && (
            <div className="flex items-end gap-1.5">
              <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Peta per tanggal
                <span className="flex items-center gap-1.5">
                  <button type="button" onClick={() => stepCursor(-1)} disabled={cursorDate <= range.start} aria-label="Hari sebelumnya" className={STEP_BTN}>
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <input
                    type="date"
                    value={cursorDate}
                    min={range.start}
                    max={range.end}
                    onChange={(event) => setCursorDate(event.target.value)}
                    aria-label="Tanggal kursor peta"
                    className={DATE_INPUT}
                  />
                  <button type="button" onClick={() => stepCursor(1)} disabled={cursorDate >= range.end} aria-label="Hari berikutnya" className={STEP_BTN}>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </span>
              </label>
              <button
                type="button"
                onClick={() => setCursorDate(today)}
                className="min-h-[32px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
              >
                Hari ini
              </button>
            </div>
          )}

          {/* Window RESERVASI — terpisah dari window task MSP milik pool order (D6). */}
          <div className="flex flex-wrap items-end gap-1.5">
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Reservasi dari
              <input type="date" value={range.start} min={bounds.min} max={bounds.max} onChange={(event) => applyRange(event.target.value, range.end)} className={DATE_INPUT} />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Sampai
              <input type="date" value={range.end} min={range.start} max={maxEnd} onChange={(event) => applyRange(range.start, event.target.value)} className={DATE_INPUT} />
            </label>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Preset rentang reservasi">
              {RANGE_PRESETS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => applyRange(today, addDaysText(today, days - 1))}
                  className={`${TOGGLE_BASE} tabular-nums text-slate-600 hover:bg-slate-50`}
                >
                  {days} hari
                </button>
              ))}
            </div>
            <button type="button" onClick={reload} className={`${ACTION_BTN} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50`}>
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin text-[#00b4d8] motion-reduce:animate-none" />
                : <RefreshCw className="h-4 w-4 text-slate-500" />}
              Refresh
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {viewMode === 'timeline'
            ? `Timeline hanya-baca — klik bar untuk detail reservasi. Rentang maksimum ${MAX_RANGE_DAYS} hari.`
            : `Peta menampilkan reservasi yang aktif pada ${formatDate(cursorDate)}; data diambil untuk rentang ${range.start} → ${range.end}.`}
        </p>
      </section>

      <div className="flex min-h-0 flex-1 flex-col">{content}</div>

      <ReservationPanel
        open={Boolean(reservation && area)}
        mode={reservation?.mode}
        area={area}
        bayCode={reservation?.bayCode}
        order={reservation?.order}
        saving={saving}
        onClose={closeReservation}
        onSubmit={handleSubmitReservation}
      />

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
