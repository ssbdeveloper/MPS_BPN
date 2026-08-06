import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CalendarRange, ChevronDown, GripVertical, Inbox, Loader2, MapPinOff,
  Package, RefreshCw,
} from 'lucide-react';
import { EmptyState, SearchInput, Skeleton } from '../../components';
import { formatDate, formatHours, plural } from './constants';

// ── Pool order (Fase 4 sisi UI + keputusan D6) ────────────────────────────────
// Panel ini SENGAJA memegang state input pencariannya sendiri. Akar keluhan "berat"
// (rencana §R2) adalah `orderSearch` yang hidup satu komponen dengan peta lantai:
// tiap ketikan me-render ulang ~79 sel bay. Di sini ketikan hanya me-render panel;
// nilai baru baru didorong ke atas setelah user berhenti mengetik.

// Jeda sebelum nilai pencarian didorong ke induk. Ini BUKAN debounce fetch —
// useSowOrders punya debounce + AbortController sendiri. Yang ini menahan
// re-render induk, jadi tetap diperlukan meski hook sudah men-debounce request.
const SEARCH_PUSH_DELAY = 200;

const TABS = [
  { key: 'perlu', label: 'To schedule' },
  { key: 'belum_jadwal', label: 'No MSP task' },
  { key: 'terjadwal', label: 'Scheduled' },
  { key: 'selesai', label: 'Completed' },
];

// Pesan EmptyState per tab — tanpa ini "tidak ada order" tidak memberi tahu apa pun.
const EMPTY_BY_TAB = {
  perlu: 'Needs REL/LKD status and an MS Project task.',
  belum_jadwal: 'All unfinished orders already have MS Project tasks.',
  terjadwal: 'No order has an active bay reservation.',
  selesai: 'No order is finished (TECO/MCNF).',
};

// Status SAP ditampilkan sebagai KODE + warna (jangan mengandalkan warna saja),
// dengan penjelasan di title karena kode SAP tidak terbaca orang non-PPC.
const SAP_STATUS_STYLE = {
  REL: { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', hint: 'Released — unfinished' },
  LKD: { cls: 'bg-amber-100 text-amber-700 border-amber-200', hint: 'Locked — counted as unfinished' },
  PCNF: { cls: 'bg-sky-100 text-sky-700 border-sky-200', hint: 'Partially confirmed — in progress' },
  MCNF: { cls: 'bg-slate-100 text-slate-600 border-slate-200', hint: 'Fully confirmed — finished' },
  TECO: { cls: 'bg-slate-100 text-slate-600 border-slate-200', hint: 'Technically complete — finished' },
};

function sapStatusStyle(status) {
  return SAP_STATUS_STYLE[String(status || '').toUpperCase()]
    || { cls: 'bg-slate-100 text-slate-600 border-slate-200', hint: 'Unknown SAP status' };
}

// ── Chip metadata kartu (angka selalu tabular-nums) ───────────────────────────
function Chip({ tone = 'slate', title, children }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
    brand: 'bg-[#caf0f8] text-[#023e8a] border-[#90e0ef]',
    purple: 'bg-purple-100 text-purple-700 border-purple-200',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold tabular-nums ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

// ── Kartu order ───────────────────────────────────────────────────────────────
// React.memo: daftar bisa panjang (paginasi 50/lompatan "muat lagi"), dan induk
// re-render tiap kali reservasi disimpan. Handler dari induk WAJIB useCallback,
// kalau tidak memo ini tidak ada gunanya.
const OrderCard = React.memo(function OrderCard({ order, selected, onSelect, onDragStart }) {
  const subcontOps = Number(order.subcont_ops) || 0;
  const subcontHours = Number(order.total_planhours_subcont) || 0;
  const reservations = Number(order.active_reservations) || 0;
  const sap = sapStatusStyle(order.sap_status);
  const hasTask = Boolean(order.has_msp_task);

  const meta = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-sm font-extrabold tabular-nums text-slate-800">
          {order.order_no}
        </span>
        <span
          title={sap.hint}
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${sap.cls}`}
        >
          {order.sap_status || 'N/A'}
        </span>
      </span>

      <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">
        {order.part_name || order.part_number || '-'}
      </span>

      <span className="mt-2 flex flex-wrap gap-1.5">
        <Chip>{Number(order.operation_count) || 0} ops</Chip>
        <Chip
          title={subcontHours > 0
            ? `Excludes ${formatHours(subcontHours)} subcontracted`
            : undefined}
        >
          {formatHours(order.total_planhours)}{subcontHours > 0 ? ' internal' : ''}
        </Chip>
        {subcontOps > 0 && (
          <Chip tone="purple" title="Vendor work — not an internal workshop load">
            {plural(subcontOps, 'subcont op')}
          </Chip>
        )}
        {reservations > 0 && (
          <Chip tone="brand" title="Active bay reservations">
            {plural(reservations, 'reservation')}
          </Chip>
        )}
      </span>

      {hasTask && (order.earliest_plan_start || order.latest_plan_finish) && (
        <span className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
          <CalendarRange className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="tabular-nums">
            {formatDate(order.earliest_plan_start)} – {formatDate(order.latest_plan_finish)}
          </span>
        </span>
      )}
    </>
  );

  // D2 — order tanpa task MS Project dicegah SEJAK AWAL, bukan ditolak saat submit.
  // Kartunya bukan <button> supaya <Link> di dalamnya tidak jadi kontrol bersarang
  // (nested interactive = HTML tidak valid + jebakan keyboard).
  if (!hasTask) {
    return (
      <div className="w-full rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3 text-left">
        <div className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-500"
          >
            <MapPinOff className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 opacity-80">{meta}</div>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Not mapped to MS Project.{' '}
            <Link
              to="/sow-scheduling/map"
              className="font-bold text-[#0077b6] underline underline-offset-2 hover:text-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
            >
              Map SAP operations
            </Link>
          </span>
        </p>
      </div>
    );
  }

  // D5 — drag-and-drop HANYA hidup di Tingkat 2. Panel yang dipakai di Tingkat 1
  // cukup tidak mengirim onDragStart: kartu otomatis tidak bisa ditarik (dan tidak
  // memasang dataTransfer kosong yang menipu).
  const draggable = typeof onDragStart === 'function';

  return (
    <button
      type="button"
      draggable={draggable}
      aria-pressed={selected}
      onClick={() => onSelect?.(order)}
      onDragStart={draggable ? (event) => onDragStart(event, order) : undefined}
      className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-all duration-150 hover:border-[#90e0ef] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${selected ? 'border-[#0077b6] ring-2 ring-[#90e0ef]' : 'border-slate-200'}`}
    >
      <span className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#caf0f8] text-[#0077b6]"
        >
          {draggable ? <GripVertical className="h-4 w-4" /> : <Package className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">{meta}</span>
      </span>
    </button>
  );
});

// ── Panel ─────────────────────────────────────────────────────────────────────
export default function OrderPanel({
  orders = [],
  total = 0,
  shown,
  loading = false,
  error = null,
  search = '',
  onSearchChange,
  tab = 'perlu',
  onTabChange,
  selectedOrder = null,
  onSelectOrder,
  onDragStart,
  onLoadMore,
  onReload,
  // OPSIONAL, di luar kontrak: { perlu, belum_jadwal, terjadwal, selesai }.
  // useSowOrders hanya mengembalikan total tab AKTIF, jadi tanpa prop ini badge
  // jumlah cuma muncul di tab yang sedang dibuka. Lihat laporan.
  tabCounts,
}) {
  // Sumber kebenaran ketikan ada DI SINI; induk baru diberi tahu setelah jeda.
  const [searchInput, setSearchInput] = useState(search || '');
  // `pushed` = nilai terakhir yang KITA kirim ke atas, `lastProp` = nilai prop yang
  // terakhir diproses. Keduanya state, bukan ref: lint react-hooks/refs melarang
  // membaca/menulis ref saat render, dan perbandingannya memang dibutuhkan saat render.
  const [pushed, setPushed] = useState(search || '');
  const [lastProp, setLastProp] = useState(search || '');
  const timerRef = useRef(null);

  // Sinkron balik saat induk mengubah `search` dari LUAR (mis. reset pencarian).
  // Pola resmi React "adjusting state when a prop changes" — dijalankan saat render,
  // bukan di useEffect (setState dalam effect memicu render berjenjang dan ditolak
  // lint react-hooks/set-state-in-effect).
  if ((search || '') !== lastProp) {
    const incoming = search || '';
    setLastProp(incoming);
    // Gema dari ketikan kita sendiri diabaikan. Tanpa penjaga ini, prop yang datang
    // terlambat akan menimpa huruf yang diketik setelah debounce menyala.
    if (incoming !== pushed) {
      setPushed(incoming);
      setSearchInput(incoming);
    }
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const pushSearch = useCallback((value) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setPushed(value);
      onSearchChange?.(value);
    }, SEARCH_PUSH_DELAY);
  }, [onSearchChange]);

  const handleSearchInput = useCallback((value) => {
    setSearchInput(value);
    pushSearch(value);
  }, [pushSearch]);

  const clearSearch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setSearchInput('');
    setPushed('');
    onSearchChange?.('');
  }, [onSearchChange]);

  const shownCount = Number.isFinite(Number(shown)) ? Number(shown) : orders.length;
  const totalCount = Number.isFinite(Number(total)) ? Number(total) : shownCount;
  const canLoadMore = shownCount < totalCount;
  const firstLoad = loading && orders.length === 0;
  const hasSearch = searchInput.trim() !== '';

  const tabItems = useMemo(() => TABS.map((item) => ({
    ...item,
    // Badge pakai hitungan EXACT dari server untuk SEMUA tab (tabCounts) —
    // angka muncul tanpa perlu klik. Fallback ke total server hanya untuk tab
    // aktif bila hitungan belum tersedia.
    count: tabCounts?.[item.key] ?? (item.key === tab ? totalCount : undefined),
  })), [tab, totalCount, tabCounts]);

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header + pencarian + tab */}
      <div className="flex-shrink-0 border-b border-slate-200 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
              style={{ background: 'linear-gradient(135deg,#023e8a,#0077b6)' }}
            >
              <Inbox className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-extrabold text-slate-800">SOW orders</h3>
          </div>
          {loading && orders.length > 0 && (
            <Loader2
              className="h-4 w-4 animate-spin text-[#00b4d8] motion-reduce:animate-none"
              aria-label="Loading"
            />
          )}
        </div>

        <SearchInput
          value={searchInput}
          onChange={handleSearchInput}
          placeholder="Search order / part..."
        />

        {/* Segmented control GRID STATIS — kolom tetap (2x2), jadi badge yang
            muncul/hilang tidak pernah menggeser tombol lain. Badge 0 disembunyikan. */}
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Order status filter">
          {tabItems.map((item) => {
            const active = item.key === tab;
            const count = item.count;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => onTabChange?.(item.key)}
                className={`inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
                  active
                    ? 'bg-white text-[#0077b6] shadow-sm'
                    : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
                }`}
              >
                {item.label}
                {Number.isFinite(count) && count > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                      active ? 'bg-[#caf0f8] text-[#0077b6]' : 'bg-slate-200/70 text-slate-600'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Daftar order */}
      <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
        {error ? (
          // Kegagalan FETCH: inline + tombol coba lagi. Toast dilarang di sini —
          // toast hilang dan panel tetap kosong tanpa keterangan.
          <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
            <AlertTriangle className="h-6 w-6 text-red-500" aria-hidden="true" />
            <p className="max-w-sm text-xs font-semibold text-red-600">
              {typeof error === 'string' ? error : error?.message || 'Failed to load orders.'}
            </p>
            <button
              type="button"
              onClick={() => onReload?.()}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
            </button>
          </div>
        ) : firstLoad ? (
          Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[104px] w-full rounded-xl" />
          ))
        ) : orders.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={hasSearch ? 'No matching orders' : 'No orders'}
            description={hasSearch ? undefined : (EMPTY_BY_TAB[tab] || 'No SOW orders to schedule.')}
            action={hasSearch ? (
              <button
                type="button"
                onClick={clearSearch}
                className="min-h-[44px] rounded-lg bg-[#0077b6] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
              >
                Clear search
              </button>
            ) : undefined}
          />
        ) : (
          orders.map((order) => (
            <OrderCard
              key={order.order_no}
              order={order}
              selected={selectedOrder?.order_no === order.order_no}
              onSelect={onSelectOrder}
              onDragStart={onDragStart}
            />
          ))
        )}
      </div>

      {/* Indikator paginasi — A-10: truncation senyap 35 order tidak boleh terulang.
          Syaratnya BUKAN orders.length > 0: tiga dari empat tab menyaring di klien, jadi satu
          halaman server bisa menghasilkan nol baris untuk tab aktif padahal masih ada halaman
          berikutnya. Kalau footer ikut hilang, user terjebak di EmptyState tanpa jalan keluar. */}
      {!error && (orders.length > 0 || canLoadMore) && (
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-slate-200 px-3 py-2">
          <p className="text-xs text-slate-500">
            Showing <span className="font-semibold tabular-nums text-slate-700">{shownCount}</span>
            {' of '}
            <span className="font-semibold tabular-nums text-slate-700">{totalCount}</span>
          </p>
          {canLoadMore && (
            <button
              type="button"
              onClick={() => onLoadMore?.()}
              disabled={loading}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            >
              {loading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
              Load more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
