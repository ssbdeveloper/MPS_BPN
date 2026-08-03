// FloorMapOverview — TINGKAT 1 peta lantai (keputusan owner D5).
//
// Kontrak: seluruh bay HARUS muat tanpa scroll horizontal di 1366px maupun 1920px.
// Itu dicapai dengan grid `repeat(N, minmax(0, 1fr))` — kolom boleh menyusut sampai
// nol, jadi lebar viewport apa pun tidak pernah memicu overflow. JANGAN mengganti
// minmax(0, ...) dengan minimum piksel: itu persis yang membuat peta lama
// (MIN_BAY_COL = 112px) harus di-pan horizontal.
//
// Konsekuensi yang diterima owner: sel jadi sangat kecil, jadi isinya MINIM —
// hanya dua angka (jumlah reservasi & jumlah aktivitas) plus warna okupansi.
// Tidak ada order_no, tidak ada nama orang, tidak ada tanggal di tingkat ini;
// semua itu milik Tingkat 2 (BayAreaDetail).
//
// Yang bisa diklik di sini HANYA blok AREA — bukan sel bay. Sel bay adalah elemen
// presentasi murni (aria-hidden), sehingga tidak ada <button> bersarang dan pembaca
// layar cukup mendengar satu ringkasan per area, bukan 79 angka tanpa konteks.
//
// Drag-and-drop TIDAK ada di tingkat ini (D5) — jangan menambahkannya di sini.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { MapPin, Warehouse } from 'lucide-react';
import { ALL_AREAS, BLASTING_AREA, LANE_A, LANE_B, formatDate, groupKeyOf } from './constants';

// Skala okupansi memakai tangga SEQUENTIAL biru korporat
// (#caf0f8 -> #90e0ef -> #00b4d8). Warna status (amber/emerald/slate/red) sengaja
// TIDAK dipakai di sini: menurut aturan chart/dataviz warna status hanya boleh
// membawa makna status, bukan dipinjam sebagai skala kuantitas.
//
// Teks selalu slate-800 di ketiga level. Dicek manual: slate-800 di atas #00b4d8
// = 5,9:1 (AA lulus). slate-600/700 di atas #00b4d8 hanya 3,0:1 / 4,2:1 — itulah
// sebabnya angka kedua dibedakan lewat FONT WEIGHT, bukan lewat warna yang lebih pudar.
const OCCUPANCY = [
  { bg: '#ffffff', border: '#e2e8f0', dashed: true },  // 0 reservasi — kosong
  { bg: '#caf0f8', border: '#90e0ef' },                // 1 reservasi — terisi
  { bg: '#90e0ef', border: '#00b4d8' },                // 2 reservasi — mulai padat
  { bg: '#00b4d8', border: '#0077b6' },                // 3+ reservasi — padat
];

const EMPTY_COUNT = Object.freeze({ reservations: 0, activities: 0 });

// Jumlah kolom satu lane = total bay + satu kolom spacer per cross-aisle.
// Dihitung dari data (bukan angka 38 yang di-hardcode) supaya perubahan topologi
// di constants.js tidak diam-diam merusak penjajaran atas/bawah.
function laneColumns(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce(
    (sum, item) => sum + (Array.isArray(item.bays) ? item.bays.length : 1),
    0,
  );
}

// Satu sel bay = satu entri di Map schedulesByBay. Dua angka yang dibutuhkan:
//   reservations = jumlah RESERVASI (bukan jumlah baris) -> dedupe via groupKeyOf
//   activities   = jumlah task/aktivitas unik di dalam reservasi-reservasi itu
// Baris booking non-job tidak punya task_id, jadi activities-nya 0 — itu benar dan
// justru membedakannya secara visual dari booking order.
//
// CATATAN LINTAS-AGEN: fungsi ini SENGAJA tidak memfilter ulang berdasarkan
// cursorDate. Kontrak menyatakan buildSchedulesByBay(schedules, cursorDate) sudah
// mengembalikan hanya reservasi AKTIF pada cursorDate. Kalau suatu saat kontrak itu
// berubah, angka di layar ini ikut salah — filter tanggal tetap milik constants.js.
function countBay(rows) {
  if (!rows || rows.length === 0) return EMPTY_COUNT;
  const groups = new Set();
  const tasks = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    groups.add(groupKeyOf(row));
    const taskId = row.task_id;
    if (taskId != null && taskId !== '') {
      // task_id unik hanya di dalam satu project -> kunci gabungan.
      tasks.add(`${row.project_id == null ? '' : row.project_id}:${taskId}`);
    }
  }
  return { reservations: groups.size, activities: tasks.size };
}

// Sel bay. React.memo WAJIB: satu render peta menyentuh ~79 sel, dan sebagian besar
// perubahan state (mis. pindah area terpilih) tidak mengubah angka satu sel pun.
const BayMiniCell = React.memo(function BayMiniCell({ bayCode, reservations, activities, withCode }) {
  const tone = OCCUPANCY[Math.min(reservations, OCCUPANCY.length - 1)];
  const occupied = reservations > 0;

  return (
    <div
      aria-hidden="true"
      title={`Bay ${bayCode} — ${reservations} reservasi, ${activities} aktivitas`}
      className={`flex min-w-0 items-center justify-center overflow-hidden rounded ${
        withCode ? 'h-7 gap-1 px-1' : 'h-9 flex-col'
      } ${tone.dashed ? 'border border-dashed' : 'border'}`}
      style={{ background: tone.bg, borderColor: tone.border }}
    >
      {withCode && (
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide tabular-nums text-slate-500">
          {bayCode}
        </span>
      )}
      {occupied && (
        <>
          <span className="text-xs font-extrabold leading-none tabular-nums text-slate-800">
            {reservations}
          </span>
          {withCode ? (
            <span aria-hidden="true" className="h-3 w-px shrink-0 bg-slate-800/25" />
          ) : (
            <span aria-hidden="true" className="my-0.5 h-px w-3 bg-slate-800/25" />
          )}
          <span className="text-xs font-normal leading-none tabular-nums text-slate-800">
            {activities}
          </span>
        </>
      )}
    </div>
  );
});

// Blok area. Seluruh blok adalah SATU tombol -> onSelectArea(areaCode).
// React.memo WAJIB, dan `onSelect` yang diterima sudah distabilkan induk (lihat
// handleSelectArea) supaya memo tidak batal tiap render.
const AreaBlock = React.memo(function AreaBlock({
  area, schedulesByBay, cursorDate, selected, onSelect, layout,
}) {
  const cells = useMemo(
    () => area.bays.map((bayCode) => ({ bayCode, ...countBay(schedulesByBay?.get(bayCode)) })),
    [area, schedulesByBay],
  );

  const totals = useMemo(
    () => cells.reduce(
      (acc, cell) => ({
        reservations: acc.reservations + cell.reservations,
        activities: acc.activities + cell.activities,
      }),
      { reservations: 0, activities: 0 },
    ),
    [cells],
  );

  const handleClick = useCallback(() => onSelect(area.areaCode), [onSelect, area.areaCode]);

  // Area sempit (1-2 bay) tidak muat teks "Area 10" di lebar ~24px, jadi labelnya
  // dipendekkan jadi nomornya saja. Nama penuh tetap ada di title + aria-label.
  const isAside = layout === 'aside';
  const shortName = String(area.areaName || '').replace(/^area\s*/i, '');
  const label = !isAside && area.bays.length <= 2 ? shortName : area.areaName;

  const labelNode = (
    <span
      className={`block h-4 truncate text-[11px] font-semibold uppercase tracking-wide ${
        selected ? 'text-[#0077b6]' : 'text-slate-500'
      }`}
    >
      {label}
    </span>
  );

  const gridNode = (
    <div
      className={isAside ? 'grid gap-1' : 'grid gap-px'}
      style={
        isAside
          ? undefined
          : { gridTemplateColumns: `repeat(${area.bays.length}, minmax(0, 1fr))` }
      }
    >
      {cells.map((cell) => (
        <BayMiniCell
          key={cell.bayCode}
          bayCode={cell.bayCode}
          reservations={cell.reservations}
          activities={cell.activities}
          withCode={isAside}
        />
      ))}
    </div>
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={selected}
      title={area.areaName}
      aria-label={
        `${area.areaName}: ${area.bays.length} bay, ${totals.reservations} reservasi, `
        + `${totals.activities} aktivitas pada ${formatDate(cursorDate)}`
      }
      className={`flex min-w-0 flex-col gap-0.5 rounded-lg border p-0.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none ${
        selected
          ? 'border-[#0077b6] bg-[#eaf8fd] ring-2 ring-[#90e0ef]'
          : 'border-transparent hover:border-[#90e0ef] hover:bg-slate-50'
      } ${isAside ? 'w-full' : ''}`}
      style={isAside ? undefined : { gridColumn: `span ${area.bays.length}` }}
    >
      {layout === 'bottom' ? (
        <>
          {gridNode}
          {labelNode}
        </>
      ) : (
        <>
          {labelNode}
          {gridNode}
        </>
      )}
    </button>
  );
});

// Gudang B1-B8 — KOSMETIK saja (keputusan owner). Bukan tombol, tidak bisa dipilih,
// tidak bisa dibooking; sengaja abu-abu polos supaya jelas beda dari bay yang bisa dipesan.
const WarehouseBlock = React.memo(function WarehouseBlock({ bays }) {
  // `border border-transparent` hanya penyeimbang tinggi: blok area di sebelahnya
  // punya border, tanpa ini gudang meleset 2px dari barisnya.
  return (
    <div
      className="flex min-w-0 flex-col justify-end gap-0.5 rounded-lg border border-transparent p-0.5"
      style={{ gridColumn: `span ${bays.length}` }}
    >
      <div
        className="flex h-9 min-w-0 items-center justify-center gap-1 rounded border border-slate-200 bg-slate-100 px-1"
        title="Gudang B1–B8 — tidak dapat dipesan"
      >
        <Warehouse className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide tabular-nums text-slate-500">
          Gudang B1–B8
        </span>
      </div>
      <span className="block h-4 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Tidak dipesan
      </span>
    </div>
  );
});

// Cross-aisle: satu kolom spacer supaya kedua lane tetap sama lebar dan bay
// atas/bawah tetap sejajar. Murni dekoratif.
function AisleGap() {
  return (
    <div className="flex items-stretch justify-center" aria-hidden="true">
      <div className="my-1 w-px bg-slate-200" />
    </div>
  );
}

const Lane = React.memo(function Lane({ items, columns, schedulesByBay, cursorDate, selectedAreaCode, onSelectArea }) {
  return (
    <div
      className="grid min-w-0 items-end gap-0.5"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        if (item.type === 'warehouse') return <WarehouseBlock key="warehouse" bays={item.bays} />;
        if (item.type !== 'area') return <AisleGap key={`aisle-${item.code}`} />;
        return (
          <AreaBlock
            key={item.areaCode}
            area={item}
            schedulesByBay={schedulesByBay}
            cursorDate={cursorDate}
            selected={selectedAreaCode === item.areaCode}
            onSelect={onSelectArea}
            layout={item.label === 'bottom' ? 'bottom' : 'top'}
          />
        );
      })}
    </div>
  );
});

function LegendSwatch({ tone, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`h-3 w-4 shrink-0 rounded ${tone.dashed ? 'border border-dashed' : 'border'}`}
        style={{ background: tone.bg, borderColor: tone.border }}
      />
      {label}
    </span>
  );
}

export default function FloorMapOverview({ schedulesByBay, cursorDate, selectedAreaCode, onSelectArea }) {
  // Handler stabil selamanya: kalau induk mengirim arrow baru tiap render (hal yang
  // sangat mudah terjadi di halaman orkestrator), React.memo pada AreaBlock akan
  // batal total dan ~79 sel ikut render ulang. Ref-latest menutup celah itu tanpa
  // menuntut induk memakai useCallback.
  const selectRef = useRef(onSelectArea);
  useEffect(() => {
    selectRef.current = onSelectArea;
  });
  const handleSelectArea = useCallback((areaCode) => {
    if (typeof selectRef.current === 'function') selectRef.current(areaCode);
  }, []);

  const columns = useMemo(() => Math.max(laneColumns(LANE_A), laneColumns(LANE_B)), []);

  return (
    <section
      aria-label="Peta lantai — ringkasan area"
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
            style={{ background: 'linear-gradient(135deg,#023e8a,#0077b6)' }}
          >
            <MapPin className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">Cikupa Layout</p>
            <h3 className="truncate text-sm font-extrabold text-slate-800">Ringkasan Area</h3>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#90e0ef] bg-[#caf0f8] px-2 py-1 text-xs font-bold tabular-nums text-[#023e8a]">
          Per {formatDate(cursorDate)}
        </span>
      </div>

      <p className="text-xs text-slate-500">
        Klik satu area untuk membuka detail bay, penghuni, dan drag-and-drop order.
      </p>

      {/* Lantai. Dua lane 38 kolom + aside Blasting & Prime. Semua kolom 1fr, jadi
          tidak ada jalur overflow horizontal pada lebar viewport mana pun. */}
      <div className="flex min-w-0 items-stretch gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Lane
            items={LANE_A}
            columns={columns}
            schedulesByBay={schedulesByBay}
            cursorDate={cursorDate}
            selectedAreaCode={selectedAreaCode}
            onSelectArea={handleSelectArea}
          />
          <div className="flex items-center gap-3" aria-hidden="true">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-300">Aisle</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <Lane
            items={LANE_B}
            columns={columns}
            schedulesByBay={schedulesByBay}
            cursorDate={cursorDate}
            selectedAreaCode={selectedAreaCode}
            onSelectArea={handleSelectArea}
          />
        </div>

        {/* AREA-18 tetap berdiri sendiri di kanan seperti denah aslinya: 5 booth
            (3 painting + 2 blasting) yang tidak sejajar dengan grid 38 kolom. */}
        <div className="w-[136px] shrink-0">
          <AreaBlock
            area={BLASTING_AREA}
            schedulesByBay={schedulesByBay}
            cursorDate={cursorDate}
            selected={selectedAreaCode === BLASTING_AREA.areaCode}
            onSelect={handleSelectArea}
            layout="aside"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200 pt-2 text-xs font-medium text-slate-600">
        <LegendSwatch tone={OCCUPANCY[0]} label="Kosong" />
        <LegendSwatch tone={OCCUPANCY[1]} label="1 reservasi" />
        <LegendSwatch tone={OCCUPANCY[2]} label="2 reservasi" />
        <LegendSwatch tone={OCCUPANCY[3]} label="3+ reservasi" />
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 shrink-0 rounded border border-slate-200 bg-slate-100" /> Gudang (tidak dipesan)
        </span>
        <span className="text-slate-500">
          Angka: <span className="font-extrabold text-slate-800">reservasi</span> /{' '}
          <span className="font-normal text-slate-800">aktivitas</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-[#0077b6]" aria-hidden="true" />
          <span className="tabular-nums">{ALL_AREAS.length}</span> area
        </span>
      </div>
    </section>
  );
}
