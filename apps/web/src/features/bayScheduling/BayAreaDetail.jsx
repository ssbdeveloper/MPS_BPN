import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CalendarRange, Car, LayoutGrid, Tag, Truck, User, Users, Warehouse, Wrench,
} from 'lucide-react';
import {
  BOOKING_TYPES,
  RESERVATION_STATUS,
  dedupeByGroup,
  formatDate,
  groupKeyOf,
  isActiveOn,
  plural,
} from './constants';

// BayAreaDetail — TINGKAT 2 peta bay (D5).
//
// Tingkat 1 (FloorMapOverview) sengaja miskin informasi: seluruh bay muat di layar,
// isi sel cuma angka. Begitu satu AREA dipilih, halaman menukar tingkat 1 dengan
// komponen ini: HANYA bay area itu, lebar penuh, sel cukup besar untuk badge kaya
// (order, siapa, rentang, status, headcount). Drag-and-drop HANYA hidup di sini —
// menaruh order di sel 24px pada tingkat 1 tidak bisa dipakai.
//
// Sel menampilkan reservasi yang AKTIF pada `cursorDate` saja. Tanpa kursor tanggal
// (A-08), dua reservasi BERURUTAN tampak sama dengan dua reservasi BERBARENGAN —
// itu justru yang mau dibedakan sejak stacking dibuka (D3).

// Referensi array stabil untuk bay kosong. `schedulesByBay.get(bay) || []` membuat
// array baru tiap render dan akan mematikan React.memo pada setiap sel kosong.
const EMPTY_SCHEDULES = [];

// ---------------------------------------------------------------------------
// Helper LOKAL — sengaja TIDAK ditambahkan ke constants.js (bukan file milik
// komponen ini). Kalau nanti dipakai FloorMapOverview/ReservationDetailModal juga,
// pemilik constants.js yang memindahkannya.
// ---------------------------------------------------------------------------

// statusStyle() TIDAK ada di kontrak constants.js (yang diekspor hanya peta
// RESERVATION_STATUS), jadi lookup + fallback-nya dibuat di sini.
function statusStyle(status) {
  const key = String(status || '').toUpperCase();
  return RESERVATION_STATUS[key] || RESERVATION_STATUS.RESERVED;
}

function bookingTypeOf(schedule) {
  // Baris warisan sebelum migrasi Fase 2 tidak punya booking_type -> dianggap ORDER.
  return String(schedule?.booking_type || 'ORDER').toUpperCase();
}

// BOOKING_TYPES belum ada saat file ini ditulis (dimiliki agen data-layer), dan
// kontrak tidak mengunci bentuknya. Toleran terhadap tiga bentuk yang masuk akal:
//   { PARKING: 'Parkir' } | { PARKING: { label: 'Parkir' } } | [{ value, label }]
// Kalau tidak ketemu, kodenya sendiri dipakai — lebih baik daripada label kosong.
function bookingTypeLabel(type) {
  const source = BOOKING_TYPES;
  if (Array.isArray(source)) {
    const found = source.find((item) => String(item?.value ?? item?.id ?? item?.code).toUpperCase() === type);
    if (found?.label) return found.label;
    return type;
  }
  const entry = source?.[type];
  if (typeof entry === 'string') return entry;
  if (entry?.label) return entry.label;
  return type;
}

const NON_JOB_ICON = {
  PARKING: Car,
  STORAGE: Warehouse,
  MAINTENANCE: Wrench,
  OTHER: Tag,
};

function isNonJob(schedule) {
  return bookingTypeOf(schedule) !== 'ORDER';
}

// D7 — reservasi yang order_no-nya tidak dikenal TETAP tampil supaya bay tidak
// terlihat kosong padahal terpakai. Deteksinya heuristik: listBaySchedules
// mengambil part_name/customer lewat LEFT JOIN sow (via ms_project_task.sow_id),
// jadi order yatim datang dengan keduanya NULL.
//
// PERINGATAN: heuristik ini bisa salah-positif untuk order yang SAH tapi task-nya
// belum ber-sow_id, atau baris sow yang part_name+customer-nya memang kosong.
// Perbaikan sebenarnya = kolom eksplisit dari backend (mis. `order_known` hasil
// EXISTS ke ph3_order/sow) — sudah dilaporkan ke pemilik lapisan data.
function isUnknownOrder(schedule) {
  if (isNonJob(schedule)) return false;
  if (!schedule?.order_no) return false;
  return !schedule.part_name && !schedule.customer;
}

// Penanda subcont (Fase 6 / D4). listBaySchedules BELUM mengembalikan field ini —
// dibaca defensif supaya badge langsung hidup begitu backend menambahkannya, dan
// TIDAK merender apa pun sampai saat itu. Tidak ada nilai yang dikarang di sini.
function isSubcont(schedule) {
  return schedule?.is_subcont === true;
}

// created_by_name sudah di-resolve backend lewat FK ke users; created_by hanya cadangan
// untuk aktor non-user (job/skrip) dan baris warisan.
function actorName(schedule) {
  return schedule?.created_by_name || schedule?.created_by || null;
}

function bayCountOf(schedule) {
  return Array.isArray(schedule?.bay_codes) ? schedule.bay_codes.length : 0;
}

// ---------------------------------------------------------------------------
// Badge reservasi (satu badge per RESERVASI, bukan per baris task)
// ---------------------------------------------------------------------------

const ScheduleBadge = memo(function ScheduleBadge({ schedule, onOpenDetail }) {
  const style = statusStyle(schedule.status);
  const nonJob = isNonJob(schedule);
  const unknown = isUnknownOrder(schedule);
  const subcont = isSubcont(schedule);
  const type = bookingTypeOf(schedule);
  const typeLabel = bookingTypeLabel(type);
  const NonJobIcon = NON_JOB_ICON[type] || Tag;
  const bays = bayCountOf(schedule);
  // Objek yang sampai ke sini adalah entri hasil dedupeByGroup, dan RESERVATION_FIELDS
  // sengaja TIDAK menyalin kolom tingkat-task — jadi people_required selalu undefined dan
  // chip headcount tidak pernah tampil. Nilai yang benar (jumlah lintas task satu reservasi)
  // sudah dihitung sebagai people_total; people_required dipertahankan sebagai fallback
  // untuk pemanggil yang mengoper baris mentah.
  const people = schedule.people_total ?? schedule.people_required;
  const hasPeople = people != null && people !== '';
  const range = `${formatDate(schedule.start_date)} – ${formatDate(schedule.end_date)}`;

  const handleClick = useCallback((event) => {
    // Badge berada DI DALAM sel yang juga bisa diklik (pilih bay) — hentikan
    // bubbling supaya klik badge tidak ikut memilih bay.
    event.stopPropagation();
    onOpenDetail(schedule);
  }, [onOpenDetail, schedule]);

  const title = nonJob ? typeLabel : schedule.order_no;
  const ariaLabel = nonJob
    ? `${typeLabel}${schedule.purpose ? ` — ${schedule.purpose}` : ''}, ${style.label}, ${range}`
    : `Order ${schedule.order_no}, ${style.label}, ${range}`;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      aria-label={ariaLabel}
      className={`block w-full overflow-hidden rounded-lg border text-left shadow-sm transition hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none ${
        nonJob
          ? 'border-slate-300 bg-slate-50 hover:border-slate-400'
          : 'border-[#90e0ef] bg-white hover:border-[#0077b6]'
      }`}
    >
      <span className="flex">
        <span aria-hidden="true" className="w-1.5 shrink-0" style={{ background: style.bar }} />
        <span className="min-w-0 flex-1 px-2 py-1.5">
          {/* Judul + status. Non-job TIDAK menampilkan order_no (memang tidak punya). */}
          <span className="flex items-center justify-between gap-1.5">
            {nonJob ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-bold text-slate-700">
                <NonJobIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                <span className="truncate uppercase tracking-wide">{typeLabel}</span>
              </span>
            ) : (
              <span className="truncate font-mono text-xs font-extrabold tabular-nums text-slate-800">
                {schedule.order_no || '-'}
              </span>
            )}
            <span className={`shrink-0 rounded-full border px-1.5 text-[11px] font-bold uppercase tracking-wide ${style.pill}`}>
              {style.label}
            </span>
          </span>

          {/* Booking non-job: purpose WAJIB ada di backend, jadi ditampilkan apa adanya. */}
          {nonJob && schedule.purpose && (
            <span className="mt-0.5 block truncate text-xs font-semibold text-slate-600" title={String(schedule.purpose)}>
              {schedule.purpose}
            </span>
          )}

          {/* Order dikenal: part/customer sebagai konteks. */}
          {!nonJob && !unknown && (schedule.part_name || schedule.customer) && (
            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {[schedule.part_name, schedule.customer].filter(Boolean).join(' · ')}
            </span>
          )}

          {/* D7 — badge eksplisit, bukan disembunyikan. */}
          {unknown && (
            <span className="mt-1 inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Unknown order
            </span>
          )}

          {actorName(schedule) && (
            <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500" title={actorName(schedule)}>
              <User className="h-3 w-3 shrink-0" />
              <span className="truncate">{actorName(schedule)}</span>
            </span>
          )}

          <span className="mt-0.5 flex items-center gap-1 truncate text-xs tabular-nums text-slate-500">
            <CalendarRange className="h-3 w-3 shrink-0" />
            {range}
          </span>

          {(hasPeople || bays > 1 || subcont) && (
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {hasPeople && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-[#caf0f8] px-1.5 py-0.5 text-xs font-bold tabular-nums text-[#0077b6]"
                  title="Headcount"
                >
                  <Users className="h-3 w-3" />{people}
                </span>
              )}
              {bays > 1 && (
                <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-600">
                  {bays} bays
                </span>
              )}
              {subcont && (
                <span className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs font-bold text-violet-700">
                  <Truck className="h-3 w-3" />Subcont
                </span>
              )}
            </span>
          )}
        </span>
      </span>
    </button>
  );
});

// ---------------------------------------------------------------------------
// Sel bay tingkat 2 — drop-zone + daftar badge
// ---------------------------------------------------------------------------

// Div (bukan <button>) karena badge di dalamnya adalah <button>: nested button
// ilegal. Pola role="button" + Enter/Space sama dengan implementasi lama.
const BayDetailCell = memo(function BayDetailCell({
  area, bayCode, schedules, cursorDate, selected, onSelectBay, onOpenDetail, onDropOrder,
}) {
  const [dragOver, setDragOver] = useState(false);

  // Satu badge per RESERVASI: baris jadwal task-level datang N baris per reservasi.
  // Filter kursor tanggal dilakukan di sini juga supaya sel tetap benar walau
  // pemanggil memberi peta yang dibangun dengan tanggal lain.
  const reservations = useMemo(
    () => dedupeByGroup(schedules.filter((schedule) => isActiveOn(schedule, cursorDate))),
    [schedules, cursorDate],
  );

  const occupied = reservations.length > 0;

  const selectBay = useCallback(() => onSelectBay(bayCode), [onSelectBay, bayCode]);

  const handleKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectBay();
  }, [selectBay]);

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    setDragOver(true);
  }, []);

  // relatedTarget yang masih di dalam sel = pindah antar-anak (badge), bukan keluar
  // sel. Tanpa cek ini highlight berkedip saat kursor melewati badge.
  const handleDragLeave = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    setDragOver(false);
    onDropOrder(event, area, bayCode);
  }, [onDropOrder, area, bayCode]);

  let stateClass;
  let stateStyle;
  if (dragOver) {
    stateClass = 'border-[#0077b6] ring-2 ring-[#00b4d8]';
    stateStyle = { background: '#caf0f8' };
  } else if (selected) {
    stateClass = 'border-[#0077b6] ring-2 ring-[#90e0ef]';
    stateStyle = { background: '#ffffff' };
  } else if (occupied) {
    stateClass = 'border-[#0077b6]';
    stateStyle = { background: 'linear-gradient(180deg,#f5fcfe 0%,#e6f6fb 100%)' };
  } else {
    stateClass = 'border-dashed border-slate-200 bg-white hover:border-[#90e0ef] hover:bg-slate-50';
    stateStyle = undefined;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={occupied
        ? `Bay ${bayCode}, ${plural(reservations.length, 'reservation')}`
        : `Bay ${bayCode}, free`}
      onClick={selectBay}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex min-h-[220px] cursor-pointer flex-col rounded-xl border-2 p-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none ${stateClass}`}
      style={stateStyle}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-extrabold uppercase tabular-nums text-slate-700">{bayCode}</span>
        <span
          className={`rounded-full px-1.5 text-[11px] font-bold uppercase tracking-wide tabular-nums ${
            occupied ? 'bg-[#caf0f8] text-[#0077b6]' : 'bg-slate-100 text-slate-400'
          }`}
        >
          {reservations.length === 1 ? '1 reservation' : `${plural(reservations.length, 'reservation')}`}
        </span>
      </div>

      {occupied ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {reservations.map((schedule) => (
            <ScheduleBadge key={groupKeyOf(schedule)} schedule={schedule} onOpenDetail={onOpenDetail} />
          ))}
        </div>
      ) : (
        <div className="pointer-events-none flex flex-1 select-none flex-col items-center justify-center gap-1 text-center">
          <span className="text-xs font-semibold text-slate-400">Free</span>
          <span className="text-xs text-slate-400">Drop an order here</span>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Tingkat 2
// ---------------------------------------------------------------------------

export default function BayAreaDetail({
  area, schedulesByBay, cursorDate, selectedBay, onSelectBay, onOpenDetail, onDropOrder, onBack,
}) {
  const bays = useMemo(() => (Array.isArray(area?.bays) ? area.bays : []), [area]);

  // Ringkasan area pada tanggal kursor: reservasi unik (dedupe lintas bay — satu
  // reservasi yang memakai 3 bay dihitung SEKALI) + jumlah baris aktivitas/task.
  const summary = useMemo(() => {
    const groups = new Set();
    let activities = 0;
    bays.forEach((bayCode) => {
      const rows = schedulesByBay?.get(bayCode) || EMPTY_SCHEDULES;
      rows.forEach((schedule) => {
        if (!isActiveOn(schedule, cursorDate)) return;
        activities += 1;
        groups.add(groupKeyOf(schedule));
      });
    });
    return { reservations: groups.size, activities };
  }, [bays, schedulesByBay, cursorDate]);

  if (!area) return null;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">{area.areaCode}</p>
            <h3 className="truncate text-sm font-extrabold text-slate-800">{area.areaName}</h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-xs font-semibold tabular-nums text-slate-600">
            <LayoutGrid className="h-3.5 w-3.5 text-slate-400" />
            {plural(bays.length, 'bay')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#caf0f8] px-2 py-1 text-xs font-bold tabular-nums text-[#0077b6]">
            {plural(summary.reservations, 'reservation')} · {plural(summary.activities, 'activity', 'activities')}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold tabular-nums text-slate-600"
            title="Showing reservations active on this date"
          >
            <CalendarRange className="h-3.5 w-3.5 text-[#0077b6]" />
            As of {formatDate(cursorDate)}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
        >
          {bays.map((bayCode) => (
            <BayDetailCell
              key={bayCode}
              area={area}
              bayCode={bayCode}
              schedules={schedulesByBay?.get(bayCode) || EMPTY_SCHEDULES}
              cursorDate={cursorDate}
              selected={selectedBay === bayCode}
              onSelectBay={onSelectBay}
              onOpenDetail={onOpenDetail}
              onDropOrder={onDropOrder}
            />
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Drag an order onto any bay — bays can be shared. Click a badge for details.
      </p>
    </section>
  );
}
