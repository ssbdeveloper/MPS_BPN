// FloorMapOverview — TINGKAT 1 peta lantai (keputusan owner D5 + perombakan 2026-08-25).
//
// Perubahan 2026-08-25 (keputusan user 1a/2a/4a/5a/6a):
//  - Label area = CAKUPAN bay (AREA-01 -> "A38-A35"; AREA-18 -> "Blasting & Painting").
//  - Search project/order_no (prop `orderFilter`) -> area tanpa reservasi order itu
//    di-HIDE total; kalau semua area hidden -> empty state.
//  - Container area LEBAR STATIK (w-60) supaya Order_no + Project name kebaca; lane
//    jadi flex row + horizontal scroll (bukan grid 38 kolom yang menyusut).
//  - Stack reservasi per area: maks 3 card + tombol "+N more" expand.
//  - Sel bay tetap dirender (info okupansi), tapi h-9 -> h-7 biar card menonjol.
//
// Yang bisa diklik: blok AREA (div role=button, bukan <button> bersarang — tombol
// "+N more" ada DI DALAM blok). Sel bay presentasi murni (aria-hidden).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, MapPin, Warehouse } from 'lucide-react';
import {
  ALL_AREAS, BLASTING_AREA, LANE_A, LANE_B, areaRangeLabel, bayCode, bayLabel,
  buildAreaReservations, formatDate, groupKeyOf, plural, zoneOrderFor,
} from './constants';

const OCCUPANCY = [
  { bg: '#ffffff', border: '#e2e8f0', dashed: true },
  { bg: '#caf0f8', border: '#90e0ef' },
  { bg: '#90e0ef', border: '#00b4d8' },
  { bg: '#00b4d8', border: '#0077b6' },
];

const EMPTY_COUNT = Object.freeze({ reservations: 0, activities: 0 });
const MAX_STACK = 3;

function countBay(rows) {
  if (!rows || rows.length === 0) return EMPTY_COUNT;
  const groups = new Set();
  const tasks = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    groups.add(groupKeyOf(row));
    const taskId = row.task_id;
    if (taskId != null && taskId !== '') {
      tasks.add(`${row.project_id == null ? '' : row.project_id}:${taskId}`);
    }
  }
  return { reservations: groups.size, activities: tasks.size };
}

const BayMiniCell = React.memo(function BayMiniCell({ code, reservations, activities, withCode }) {
  const tone = OCCUPANCY[Math.min(reservations, OCCUPANCY.length - 1)];
  const occupied = reservations > 0;

  return (
    <div
      aria-hidden="true"
      title={`${bayLabel(code)} — ${plural(reservations, 'reservation')}, ${plural(activities, 'activity', 'activities')}`}
      className={`flex min-w-0 items-center justify-center overflow-hidden rounded ${
        withCode ? 'h-6 gap-1 px-1' : 'h-7 flex-col'
      } ${tone.dashed ? 'border border-dashed' : 'border'}`}
      style={{ background: tone.bg, borderColor: tone.border }}
    >
      {withCode && (
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide tabular-nums text-slate-500">
          {code}
        </span>
      )}
      {occupied && (
        <>
          <span className="text-[11px] font-extrabold leading-none tabular-nums text-slate-800">
            {reservations}
          </span>
          {withCode ? (
            <span aria-hidden="true" className="h-3 w-px shrink-0 bg-slate-800/25" />
          ) : (
            <span aria-hidden="true" className="my-0.5 h-px w-3 bg-slate-800/25" />
          )}
          <span className="text-[11px] font-normal leading-none tabular-nums text-slate-800">
            {activities}
          </span>
        </>
      )}
    </div>
  );
});

// Semua reservasi AKTIF milik satu area (flatten semua kode bay area, dedupe by
// schedule_id, urut start_date). Dipakai parent (sekali per fetch) -> dikirim
// sebagai prop ke AreaBlock supaya memo tidak batal.
function ReservationCard({ row }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
      <div className="truncate text-[11px] font-extrabold tabular-nums text-slate-800">
        {row.order_no || row.purpose || '—'}
      </div>
      <div className="truncate text-[10px] font-semibold text-slate-500">
        {row.project_name || row.part_name || ''}
      </div>
      <div className="truncate font-mono text-[9px] text-slate-400">
        {formatDate(row.start_date)}–{formatDate(row.end_date)}
      </div>
    </div>
  );
}

const AreaBlock = React.memo(function AreaBlock({
  area, schedulesByBay, cursorDate, selected, onSelect, layout, reservations = [],
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => {
    if (!area.zoned) {
      return [{
        zoneKey: null,
        cells: area.bays.map((base) => ({ code: base, ...countBay(schedulesByBay?.get(base)) })),
      }];
    }
    return zoneOrderFor(layout).map((zoneKey) => ({
      zoneKey,
      cells: area.bays.map((base) => {
        const code = bayCode(base, zoneKey);
        return { code, ...countBay(schedulesByBay?.get(code)) };
      }),
    }));
  }, [area, schedulesByBay, layout]);

  const totals = useMemo(
    () => rows.flatMap((row) => row.cells).reduce(
      (acc, cell) => ({
        reservations: acc.reservations + cell.reservations,
        activities: acc.activities + cell.activities,
      }),
      { reservations: 0, activities: 0 },
    ),
    [rows],
  );

  const bayCount = rows.reduce((acc, row) => acc + row.cells.length, 0);
  const handleClick = useCallback(() => onSelect(area.areaCode), [onSelect, area.areaCode]);
  const handleKey = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(area.areaCode);
    }
  }, [onSelect, area.areaCode]);

  const isAside = layout === 'aside';
  const label = areaRangeLabel(area);
  const shown = expanded ? reservations : reservations.slice(0, MAX_STACK);
  const hiddenCount = reservations.length - shown.length;

  const labelNode = (
    <span
      className={`block h-4 truncate text-[11px] font-extrabold uppercase tracking-wide ${
        selected ? 'text-[#0077b6]' : 'text-slate-600'
      }`}
    >
      {label}
    </span>
  );

  const gridNode = (
    <div className="flex flex-col gap-px">
      {rows.map((row, index) => (
        <React.Fragment key={row.zoneKey || 'single'}>
          {index > 0 && <span aria-hidden="true" className="my-px h-0.5 w-full rounded bg-slate-300" />}
          <div
            className={isAside ? 'grid gap-1' : 'grid gap-px'}
            style={isAside ? undefined : { gridTemplateColumns: `repeat(${area.bays.length}, minmax(0, 1fr))` }}
          >
            {row.cells.map((cell) => (
              <BayMiniCell
                key={cell.code}
                code={cell.code}
                reservations={cell.reservations}
                activities={cell.activities}
                withCode={isAside}
              />
            ))}
          </div>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKey}
      aria-pressed={selected}
      title={`${area.areaName}: ${plural(bayCount, 'bay')}, ${totals.reservations} reservations on ${formatDate(cursorDate)}`}
      className={`flex w-60 shrink-0 cursor-pointer flex-col gap-0.5 rounded-lg border p-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
        selected
          ? 'border-[#0077b6] bg-[#eaf8fd] ring-2 ring-[#90e0ef]'
          : 'border-slate-200 bg-white hover:border-[#90e0ef] hover:bg-slate-50'
      }`}
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

      {reservations.length > 0 && (
        <div className="mt-0.5 space-y-1">
          {shown.map((row) => (
            <ReservationCard key={row.schedule_id} row={row} />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 bg-slate-50 py-0.5 text-[10px] font-bold text-slate-500 transition hover:border-[#0096c7] hover:text-[#0077b6]"
            >
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {expanded ? 'Show less' : `+${hiddenCount} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

const WarehouseBlock = React.memo(function WarehouseBlock() {
  return (
    <div className="flex w-60 shrink-0 flex-col justify-end gap-0.5 rounded-lg border border-transparent p-1">
      <div className="flex h-7 min-w-0 items-center justify-center gap-1 rounded border border-slate-200 bg-slate-100 px-1">
        <Warehouse className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide tabular-nums text-slate-500">
          Warehouse B1–B8
        </span>
      </div>
      <span className="block h-4 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Not bookable
      </span>
    </div>
  );
});

function AisleGap() {
  return (
    <div className="flex w-8 shrink-0 items-stretch justify-center self-stretch" aria-hidden="true">
      <div className="my-1 w-px bg-slate-200" />
    </div>
  );
}

const Lane = React.memo(function Lane({ items, schedulesByBay, areaReservations, cursorDate, selectedAreaCode, onSelectArea, hiddenAreas }) {
  return (
    <div className="flex min-w-0 items-end gap-1.5 overflow-x-auto pb-1">
      {items.map((item) => {
        if (item.type === 'warehouse') return <WarehouseBlock key="warehouse" />;
        if (item.type !== 'area') return <AisleGap key={`aisle-${item.code}`} />;
        if (hiddenAreas.has(item.areaCode)) return null;
        return (
          <AreaBlock
            key={item.areaCode}
            area={item}
            schedulesByBay={schedulesByBay}
            cursorDate={cursorDate}
            selected={selectedAreaCode === item.areaCode}
            onSelect={onSelectArea}
            layout={item.label === 'bottom' ? 'bottom' : 'top'}
            reservations={areaReservations.get(item.areaCode) || []}
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

export default function FloorMapOverview({
  schedulesByBay, cursorDate, selectedAreaCode, onSelectArea, orderFilter = '', onClearFilter,
}) {
  const selectRef = useRef(onSelectArea);
  useEffect(() => {
    selectRef.current = onSelectArea;
  });
  const handleSelectArea = useCallback((areaCode) => {
    if (typeof selectRef.current === 'function') selectRef.current(areaCode);
  }, []);

  // Reservasi per area (sekali per fetch, dibagikan ke semua AreaBlock).
  const areaReservations = useMemo(() => {
    const map = new Map();
    for (const area of ALL_AREAS) {
      map.set(area.areaCode, buildAreaReservations(schedulesByBay, area));
    }
    return map;
  }, [schedulesByBay]);

  // Filter 2a: search project/order_no -> area TANPA reservasi order itu di-hide.
  const hiddenAreas = useMemo(() => {
    const hidden = new Set();
    const q = String(orderFilter || '').trim();
    if (!q) return hidden;
    const qNorm = q.replace(/^0+(?=\d)/, '');
    for (const area of ALL_AREAS) {
      const has = (areaReservations.get(area.areaCode) || []).some((r) => {
        const on = String(r.order_no || '').replace(/^0+(?=\d)/, '');
        return on === qNorm || String(r.project_name || '').toLowerCase().includes(q.toLowerCase());
      });
      if (!has) hidden.add(area.areaCode);
    }
    return hidden;
  }, [orderFilter, areaReservations]);

  const allHidden = hiddenAreas.size === ALL_AREAS.length && orderFilter.trim() !== '';

  return (
    <section
      aria-label="Floor map"
      className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
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
            <h3 className="truncate text-sm font-extrabold text-slate-800">Area summary</h3>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#90e0ef] bg-[#caf0f8] px-2 py-1 text-xs font-bold tabular-nums text-[#023e8a]">
          As of {formatDate(cursorDate)}
        </span>
      </div>

      {orderFilter.trim() ? (
        <p className="text-xs font-semibold text-[#0077b6]">
          Filtered by "{orderFilter.trim()}" — {ALL_AREAS.length - hiddenAreas.size} area shown
          <button
            type="button"
            onClick={() => typeof onClearFilter === 'function' && onClearFilter()}
            className="ml-2 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:border-red-300 hover:text-red-600"
          >
            Clear filter
          </button>
        </p>
      ) : (
        <p className="text-xs text-slate-500">Select an area to see its bays.</p>
      )}

      {allHidden ? (
        <div className="flex flex-1 items-center justify-center py-12 text-center">
          <p className="text-sm font-semibold text-slate-400">
            No reservations for "{orderFilter.trim()}" in this period.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          <div className="flex min-w-0 items-stretch gap-1.5">
            {!hiddenAreas.has(BLASTING_AREA.areaCode) && (
              <div className="w-60 shrink-0">
                <AreaBlock
                  area={BLASTING_AREA}
                  schedulesByBay={schedulesByBay}
                  cursorDate={cursorDate}
                  selected={selectedAreaCode === BLASTING_AREA.areaCode}
                  onSelect={handleSelectArea}
                  layout="aside"
                  reservations={areaReservations.get(BLASTING_AREA.areaCode) || []}
                />
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Lane
                items={LANE_A}
                schedulesByBay={schedulesByBay}
                areaReservations={areaReservations}
                cursorDate={cursorDate}
                selectedAreaCode={selectedAreaCode}
                onSelectArea={handleSelectArea}
                hiddenAreas={hiddenAreas}
              />
              <div className="flex items-center gap-3" aria-hidden="true">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-300">Aisle</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <Lane
                items={LANE_B}
                schedulesByBay={schedulesByBay}
                areaReservations={areaReservations}
                cursorDate={cursorDate}
                selectedAreaCode={selectedAreaCode}
                onSelectArea={handleSelectArea}
                hiddenAreas={hiddenAreas}
              />
            </div>
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[10px] font-semibold text-slate-500">
        {OCCUPANCY.map((tone, index) => (
          <LegendSwatch key={tone.bg} tone={tone} label={index === 0 ? 'empty' : index === 1 ? '1' : index === 2 ? '2' : '3+'} />
        ))}
        <span className="ml-auto text-slate-400">Card stack = reservations, max 3 shown (expandable)</span>
      </div>
    </section>
  );
}
