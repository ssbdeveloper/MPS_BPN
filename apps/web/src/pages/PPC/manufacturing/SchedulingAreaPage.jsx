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
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, LayoutGrid, Loader2,
  PackagePlus, ParkingSquare, RefreshCw, Search, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  cancelBaySchedule, cancelBayScheduleGroup, createBaySchedule, updateBayScheduleGroup,
} from '../../../services/msProjectService';
import { Skeleton } from '../../../components';
import {
  AREA_BY_CODE, AreaDetailPanel, BayAreaDetail, FloorMapOverview, OrderPanel, ReservationDetailModal,
  ReservationPanel, addDaysText, bookingTypeOf, buildAreaReservations, dateKey, dedupeByGroup,
  formatDate, groupAreaProjects, groupKeyOf, todayText, useBaySchedules, useSowOrders,
} from '../../../features/bayScheduling';
import BayReservationTimeline from './BayReservationTimeline';

/* ── Rentang reservasi (A-15: hard cap, bukan sekadar saran) ─────────────────
   Window timeline = window RESERVASI (start_date/end_date), TERPISAH dari window
   task MSP yang dipakai pool order (D6). Tanpa cap, satu ketikan "2099" di input
   date menarik ribuan hari kolom timeline dan satu query tanpa batas.            */
const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 90;
const WINDOW_BACK_DAYS = 90;
const WINDOW_FORWARD_DAYS = 120;
const RANGE_PRESETS = [7, 14, 30];
// Pola tanggal YYYY-MM-DD untuk validasi ?date= dari URL.
const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  if (labels.length === 0) return 'other reservations';
  const head = labels.slice(0, 3).join(', ');
  const rest = labels.length - 3;
  const total = Number(overlap?.total);
  const text = rest > 0 ? `${head}, +${rest} more` : head;
  return overlap?.truncated && Number.isFinite(total) && total > rows.length
    ? `${text} (of ${total})`
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
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </button>
    </div>
  );
}

// Pool order (Tingkat 2). Hook-nya sengaja dipanggil DI SINI, bukan di halaman:
// dengan begitu perubahan query/pencarian berhenti di subtree ini dan tidak pernah
// menyentuh props FloorMapOverview / BayAreaDetail.
const OrderPoolPanel = React.memo(function OrderPoolPanel({
  selectedOrder, onSelectOrder, onDragStart, onSearchChange, registerSearch,
}) {
  const pool = useSowOrders();
  useEffect(() => {
    if (typeof registerSearch === 'function') registerSearch(pool.setSearch);
  }, [registerSearch, pool.setSearch]);
  const handleSearch = (value) => {
    pool.setSearch(value);
    if (typeof onSearchChange === 'function') onSearchChange(value);
  };
  return (
    <OrderPanel
      orders={pool.orders}
      total={pool.total}
      shown={pool.shown}
      loading={pool.loading}
      error={pool.error}
      search={pool.search}
      onSearchChange={handleSearch}
      tab={pool.tab}
      onTabChange={pool.setTab}
      selectedOrder={selectedOrder}
      onSelectOrder={onSelectOrder}
      onDragStart={onDragStart}
      onLoadMore={pool.loadMore}
      onReload={pool.reload}
      tabCounts={pool.tabCounts}
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

  // ?area=AREA-XX&date=YYYY-MM-DD (dari Gantt portfolio, keputusan 4b): langsung
  // fokus ke area + tanggal booking yang dipilih. Level area diinisialisasi DI
  // SINI (bukan via useEffect) — deep-link berlaku sekali saat mount, dan tombol
  // Back tetap bebas kembali ke overview (effect lama setLevel('area') lagi tiap
  // Back karena areaFromUrl = selectedAreaCode && level==='overview' — bug
  // A-2026-08-13, Back tidak pernah kembali ke pemilihan area).
  const [searchParams] = useSearchParams();
  const initialAreaCode = searchParams.get('area');
  const initialDate = searchParams.get('date');
  const initialArea = initialAreaCode && AREA_BY_CODE[initialAreaCode.toUpperCase()]
    ? initialAreaCode.toUpperCase()
    : null;
  const [level, setLevel] = useState(() => (initialArea ? 'area' : 'overview')); // 'overview' | 'area'
  const [selectedAreaCode, setSelectedAreaCode] = useState(initialArea);
  const [selectedBay, setSelectedBay] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [reservation, setReservation] = useState(null); // { mode, bayCode, order }
  const [detail, setDetail] = useState(null);
  // Naik setiap kali reservasi berubah dari halaman ini, supaya daftar reservasi per order di
  // panel (F3) ikut dibaca ulang, bukan menampilkan grup yang baru saja dibatalkan.
  const [reservationsToken, setReservationsToken] = useState(0);
  const [saving, setSaving] = useState(false);
  const [areaFilter, setAreaFilter] = useState('');
  // Tahap 5 — panel detail area/zona di peta tingkat 1. NON-MODAL: peta tetap
  // terbaca. `null` = tertutup; { areaCode, bay, zone } = terbuka.
  const [detailSel, setDetailSel] = useState(null);
  const poolSearchRef = useRef(null);
  const registerPoolSearch = useCallback((fn) => {
    poolSearchRef.current = fn;
  }, []);

  // Fetch schedule SEMUA tanggal dalam bounds (bukan cuma 7 hari) — peta bisa
  // melihat reservasi pada tanggal berapa pun. Filter 7/14/30 hari hanya untuk
  // ORDER POOL (tab "To schedule" = due_by minggu ini), bukan pembatas schedule
  // area (feedback 2026-08-06).
  const {
    schedules, byBay, loading, error, reload, cursorDate, setCursorDate,
    readComplete, pagesLoaded,
  } = useBaySchedules({ rangeStart: bounds.min, rangeEnd: bounds.max });

  // Kursor awal dari URL ?date= (booking yang diklik di Gantt).
  useEffect(() => {
    if (initialDate) {
      const d = String(initialDate).slice(0, 10);
      if (DATE_INPUT_RE.test(d) && d >= bounds.min && d <= bounds.max) setCursorDate(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tombol Refresh ditaruh di slot kanan PageHeader (sejajar tombol Back menu),
  // bukan di dalam section — layout menyediakan slot via Outlet context.
  const outlet = useOutletContext();
  const setHeaderRight = outlet?.setHeaderRight;
  useEffect(() => {
    if (!setHeaderRight) return undefined;
    setHeaderRight(
      <button
        type="button"
        onClick={reload}
        className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-[#00b4d8] focus-visible:outline-none motion-reduce:transition-none motion-reduce:transform-none"
      >
        {loading
          ? <Loader2 className="h-4 w-4 animate-spin text-[#00b4d8] motion-reduce:animate-none" />
          : <RefreshCw className="h-4 w-4 text-slate-600" />}
        Refresh
      </button>
    );
    return () => setHeaderRight(null);
  }, [setHeaderRight, reload, loading]);

  const area = selectedAreaCode ? AREA_BY_CODE[selectedAreaCode] : null;

  // Isi panel detail. Dihitung dari `detailSel` (bukan `selectedAreaCode`) supaya
  // panel hanya hidup selama benar-benar dibuka, dan memakai grouping per PROJECT
  // yang sama dengan kartu peta — satu sumber angka, tidak ada dua versi.
  const detailArea = detailSel?.areaCode ? AREA_BY_CODE[detailSel.areaCode] : null;
  const detailGroups = useMemo(() => (
    detailArea ? groupAreaProjects(buildAreaReservations(byBay, detailArea)) : []
  ), [byBay, detailArea]);
  // Area untuk panel reservasi. Mode EDIT memakai area dari DETAIL reservasi
  // (fallback ke objek minimal bila area_code tidak dikenal FE) — bukan area
  // yang sedang terpilih di peta, karena edit bisa dibuka dari Timeline.
  const panelArea = reservation?.edit
    ? (AREA_BY_CODE[reservation.edit.area_code]
        || {
            areaCode: reservation.edit.area_code || '',
            areaName: reservation.edit.area_name || reservation.edit.area_code || 'Unknown area',
            bays: Array.isArray(reservation.edit.bay_codes) ? reservation.edit.bay_codes : [],
            zoned: false,
          })
    : area;
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
  // Klik kartu area membuka PANEL DETAIL, tidak langsung mengganti peta dengan
  // halaman tingkat 2 (PLAN §4.4: peta okupansi wajib tetap terbaca). Alur
  // reservasi lama tetap utuh, dicapai lewat "Kelola reservasi" di panel.
  const handleSelectArea = useCallback((areaCode) => {
    setSelectedAreaCode(areaCode);
    setSelectedBay(null);
    setDetailSel((prev) => (
      // Klik kartu yang sama = toggle tutup, supaya panel tidak "nyangkut".
      prev && prev.areaCode === areaCode && !prev.bay ? null : { areaCode, bay: null, zone: null }
    ));
  }, []);

  // Klik sel zona / slot bay: panel terbuka dengan konteks sel itu.
  const handleSelectZone = useCallback((areaCode, cell) => {
    setSelectedAreaCode(areaCode);
    setDetailSel({ areaCode, bay: cell?.bay || null, zone: cell?.zone || null });
  }, []);

  const closeAreaDetail = useCallback(() => setDetailSel(null), []);

  // "Kelola reservasi" = masuk ke halaman tingkat 2 dengan konteks terpilih
  // (PLAN §9 butir 14: editor tidak boleh selalu membuka area contoh tetap).
  const handleManageArea = useCallback((ctx) => {
    if (!ctx?.areaCode) return;
    setSelectedAreaCode(ctx.areaCode);
    setSelectedBay(ctx.bay || null);
    setDetailSel(null);
    setLevel('area');
  }, []);
  const handleBack = useCallback(() => { setLevel('overview'); setSelectedBay(null); }, []);
  const handleSelectBay = useCallback((bayCode) => setSelectedBay(bayCode), []);
  const closeReservation = useCallback(() => setReservation(null), []);
  const closeDetail = useCallback(() => setDetail(null), []);

  const openDetail = useCallback((schedule) => {
    if (!schedule) return;
    // Kartu per-order (gabungan beberapa grup) dibuka apa adanya: isinya sudah seluruh
    // operation order itu pada tanggal kursor.
    if (schedule.order_view) { setDetail(schedule); return; }
    setDetail(indexRef.current.get(groupKeyOf(schedule)) || dedupeByGroup([schedule])[0] || null);
  }, []);

  const handleSelectOrder = useCallback((order) => setSelectedOrder(order), []);

  // Edit reservasi: buka panel dalam mode EDIT dengan data detail terisi.
  // Area dibangun dari detail (bukan AREA_BY_CODE[selectedAreaCode]) supaya edit
  // tetap bisa dibuka dari view Timeline, di mana tidak ada area yang terpilih.
  const handleEditReservation = useCallback((target) => {
    if (!target) return;
    setDetail(null);
    const isOrder = bookingTypeOf(target).isJob;
    setReservation({
      mode: isOrder ? 'ORDER' : 'NONJOB',
      bayCode: (Array.isArray(target.bay_codes) && target.bay_codes[0]) || null,
      order: isOrder ? { order_no: target.order_no, has_msp_task: true } : null,
      edit: target,
    });
  }, []);

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
      toast.error('Select an order first');
      return;
    }
    if (!order.has_msp_task) {
      toast.error('Order not mapped to MS Project');
      return;
    }
    setSelectedOrder(order);
    setReservation({ mode: 'ORDER', bayCode, order });
  }, []);

  /* ── Aksi async ─────────────────────────────────────────────────────────── */
  const handleSubmitReservation = useCallback(async (payload) => {
    setSaving(true);
    try {
      // Panel mengirim schedule_group_id saat mode EDIT -> update grup (satu
      // transaksi di server); tanpa itu = create reservasi baru.
      const groupId = payload?.schedule_group_id;
      const result = groupId
        ? await updateBayScheduleGroup(groupId, payload)
        : await createBaySchedule(payload);
      const bays = (payload.bay_codes || []).join(', ');
      const taskCount = Array.isArray(payload.tasks) ? payload.tasks.length : 0;
      const what = payload.booking_type === 'ORDER'
        ? `${taskCount} task${taskCount === 1 ? '' : 's'}`
        : bookingTypeOf(payload).label;

      // Sejak D3 bay tidak pernah eksklusif: server TIDAK menolak overlap, hanya
      // melaporkan penghuni lain lewat warnings. Kalau toast ini tidak menampilkannya,
      // pencegahan sudah dicabut tapi pemberitahuannya tidak ada — lebih buruk dari 409.
      const warnings = result?.warnings || [];
      const overlap = warnings.find((warning) => warning.type === 'BAY_OVERLAP');

      // Operasi yang sama bisa terpilih dua kali kalau order-nya dipetakan ke lebih dari satu
      // project — task_id-nya beda, operasinya sama. Server membuang yang kedua; kalau toast
      // diam, scheduler mengira semua yang dicentang tersimpan.
      const dropped = warnings.find((warning) => warning.type === 'DUPLICATE_OPERATION_DROPPED');
      const droppedOps = dropped?.operations || [];

      const doneText = groupId ? 'Reservation updated' : 'Reservation saved';
      if ((overlap?.occupants || []).length > 0) {
        toast.warning(`${doneText} — bay is shared`, {
          description: `${what} · ${bays} · with ${describeOccupants(overlap)}`,
          duration: 8000,
        });
      } else {
        toast.success(doneText, { description: `${what} · ${bays}` });
      }

      if (droppedOps.length > 0) {
        const list = [...new Set(droppedOps.map((row) => row.operation_no))].join(', ');
        toast.warning('Duplicate operation skipped', {
          description: `Operation ${list} · in more than one project, saved once`,
          duration: 9000,
        });
      }
      setReservation(null);
      reload();
      setReservationsToken((value) => value + 1);
    } catch (err) {
      // F2: konflik aturan unik datang sebagai 409 dengan daftar reservasi existing di
      // `details`. Menampilkan pesan generik akan menyembunyikan justru informasi yang
      // dibutuhkan scheduler untuk memutuskan: reservasi mana yang sudah ada.
      if (err?.code === 'DUPLICATE_TASK_CONFLICT') {
        const rows = Array.isArray(err.details) ? err.details : [];
        const ops = [...new Set(rows.map((row) => row.operation_no).filter(Boolean))].join(', ');
        const where = rows[0] ? `${(rows[0].bay_codes || []).join(', ')} · ${formatDate(rows[0].start_date)} – ${formatDate(rows[0].end_date)}` : '';
        toast.error('Operation already reserved', {
          description: [
            ops ? `Operation ${ops} already booked for this order in this area on these dates.` : err.message,
            where,
            rows[0]?.created_by ? `Reserved by ${rows[0].created_by}.` : '',
            `${rows.length} existing reservation${rows.length === 1 ? '' : 's'} — open the reservation to edit it instead.`,
          ].filter(Boolean).join(' '),
          duration: 12000,
        });
      } else {
        toast.error('Reservation failed', { description: err.message });
      }
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
      toast.success('Reservation cancelled', {
        description: target.order_no || target.purpose || bookingTypeOf(target).label,
      });
      setDetail(null);
      reload();
      setReservationsToken((value) => value + 1);
    } catch (err) {
      toast.error('Failed to cancel', { description: err.message });
    } finally {
      setSaving(false);
    }
  }, [reload]);

  // F3: batalkan SATU baris task dari grup campuran. Server menolak (409 OPEN_CHECKIN) baris
  // yang check-in-nya masih terbuka; pesan server ditampilkan apa adanya.
  const handleCancelRow = useCallback(async (target, task) => {
    if (!task?.schedule_id) return;
    setSaving(true);
    try {
      await cancelBaySchedule(task.schedule_id);
      toast.success('Row cancelled', {
        description: `${target?.order_no || ''} · Op ${task.operation_no || '-'}`,
      });
      setDetail(null);
      reload();
      setReservationsToken((value) => value + 1);
    } catch (err) {
      toast.error('Failed to cancel row', { description: err.message });
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
  } else if (showAreaLevel && !loading && !readComplete) {
    // Rentang belum terbaca penuh. Peta yang tampak wajar tapi kehilangan reservasi adalah
    // kegagalan yang lebih berbahaya daripada kegagalan yang mengaku gagal (insiden B29E:
    // sel "free" padahal 8 reservasi aktif). Jadi jangan render peta setengah jadi.
    // `!loading`: selama reload (mis. setelah simpan reservasi) readComplete sengaja false,
    // bukan tanda terpotong — peta lama tetap tampil, sel kosong ditandai belum pasti.
    content = (
      <InlineError
        message={`Peta belum terbaca lengkap (${pagesLoaded} halaman dimuat). Sebagian sel bisa tampak kosong padahal terisi. Coba lagi untuk memuat seluruh rentang.`}
        onRetry={reload}
      />
    );
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
          onSearchChange={setAreaFilter}
          registerSearch={registerPoolSearch}
        />
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <p className="min-w-0 text-xs text-slate-600">
              {selectedBay
                ? <>Bay <span className="font-mono font-bold tabular-nums text-slate-900">{selectedBay}</span>{selectedOrder ? <> · order <span className="font-mono font-bold tabular-nums text-slate-900">{selectedOrder.order_no}</span></> : null}</>
                : 'Select a bay first'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!selectedBay || !selectedOrder}
                onClick={() => setReservation({ mode: 'ORDER', bayCode: selectedBay, order: selectedOrder })}
                title={!selectedOrder ? 'Select an order first' : undefined}
                className={`${ACTION_BTN} bg-[#0077b6] text-white hover:bg-[#023e8a]`}
              >
                <PackagePlus className="h-4 w-4" /> Reserve order
              </button>
              {/* Fase 3 — booking di luar job (parkir unit / taruh barang). Tidak butuh
                  order maupun task; hanya jenis booking + tujuan yang wajib. */}
              <button
                type="button"
                disabled={!selectedBay}
                onClick={() => setReservation({ mode: 'NONJOB', bayCode: selectedBay, order: null })}
                className={`${ACTION_BTN} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
              >
                <ParkingSquare className="h-4 w-4" /> Non-job booking
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
            readComplete={readComplete}
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
        onSelectZone={handleSelectZone}
        detailPanel={detailArea ? (
          <AreaDetailPanel
            area={detailArea}
            groups={detailGroups}
            cursorDate={cursorDate}
            selection={detailSel}
            onClose={closeAreaDetail}
            onManage={handleManageArea}
          />
        ) : null}
        orderFilter={areaFilter}
        onClearFilter={() => {
          setAreaFilter('');
          if (typeof poolSearchRef.current === 'function') poolSearchRef.current('');
        }}
      />
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:px-6">
      <section className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {/* Baris 1: view toggle KIRI + kontrol tanggal KANAN (sejajar). */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="View">
            <button
              type="button"
              onClick={() => setViewMode('map')}
              aria-pressed={viewMode === 'map'}
              className={`${TOGGLE_BASE} ${viewMode === 'map' ? 'bg-[#0077b6] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Map
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

          {viewMode === 'map' ? (
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Map date</span>
              <button type="button" onClick={() => stepCursor(-1)} disabled={cursorDate <= bounds.min} aria-label="Previous day" className={STEP_BTN}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                type="date"
                value={cursorDate}
                min={bounds.min}
                max={bounds.max}
                onChange={(event) => setCursorDate(event.target.value)}
                aria-label="Map date"
                className={DATE_INPUT}
              />
              <button type="button" onClick={() => stepCursor(1)} disabled={cursorDate >= bounds.max} aria-label="Next day" className={STEP_BTN}>
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCursorDate(today)}
                className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
              >
                Today
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">From</span>
                <input type="date" value={range.start} min={bounds.min} max={maxEnd} onChange={(event) => applyRange(event.target.value, range.end)} className={DATE_INPUT} />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">To</span>
                <input type="date" value={range.end} min={range.start} max={maxEnd} onChange={(event) => applyRange(range.start, event.target.value)} className={DATE_INPUT} />
              </label>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Date window presets">
                {RANGE_PRESETS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => applyRange(today, addDaysText(today, days - 1))}
                    className={`${TOGGLE_BASE} tabular-nums text-slate-600 hover:bg-slate-50`}
                  >
                    {days} days
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Search order_no / project name — filter AREA di peta (overview saja;
            di area level, search OrderPanel kiri yang dipakai). */}
        {viewMode === 'map' && !showAreaLevel && (
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={areaFilter}
              onChange={(event) => {
                const value = event.target.value;
                setAreaFilter(value);
                if (typeof poolSearchRef.current === 'function') poolSearchRef.current(value);
              }}
              placeholder="Search order no / project name…"
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-8 text-xs font-semibold text-slate-800 shadow-sm transition focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            />
            {areaFilter && (
              <button
                type="button"
                onClick={() => {
                  setAreaFilter('');
                  if (typeof poolSearchRef.current === 'function') poolSearchRef.current('');
                }}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </section>

      {/* Reload dengan data lama tetap tampil: status netral, bukan error. Sel kosong belum
          boleh dibaca sebagai bebas sampai pembacaan baru selesai dan terbukti lengkap. */}
      {loading && schedules.length > 0 ? (
        <p role="status" className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0077b6] motion-reduce:animate-none" aria-hidden="true" />
          Refreshing map — empty bays are not confirmed free until loading finishes.
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">{content}</div>

      <ReservationPanel
        open={Boolean(reservation && panelArea)}
        mode={reservation?.mode}
        area={panelArea}
        bayCode={reservation?.bayCode}
        order={reservation?.order}
        edit={reservation?.edit}
        saving={saving}
        onClose={closeReservation}
        onSubmit={handleSubmitReservation}
        onOpenReservation={setDetail}
        reservationsToken={reservationsToken}
      />

      {detail && (
        <ReservationDetailModal
          detail={detail}
          onClose={closeDetail}
          onCancel={handleCancelReservation}
          onCancelRow={handleCancelRow}
          onEdit={handleEditReservation}
          busy={saving}
        />
      )}
    </main>
  );
}
