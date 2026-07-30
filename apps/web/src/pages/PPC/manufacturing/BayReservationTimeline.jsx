import React, { useMemo } from 'react';
import { CalendarRange, Users } from 'lucide-react';
import { EmptyState } from '../../../components';
import { AREA_OPTIONS } from '../../../config/manufacturingAreas';

/* ──────────────────────────────────────────────────────────────────────────
   BayReservationTimeline — read-only Gantt of manufacturing bay reservations.

   The alternative to the floor map (SchedulingAreaPage): rows = bays (grouped by
   area, from the shared topology in config/manufacturingAreas), x-axis = one column
   per day in [rangeStart, rangeEnd]. A reservation renders as a bar on each of its
   bay rows, clamped to the visible window. Overlapping reservations on the same bay
   stack onto sub-rows (lanes) so nothing hides behind another bar.

   VIEW-ONLY: no drag, no drop, no reserve. Clicking a bar calls onSelectSchedule.

   Props:
     schedules        Array<{
                        schedule_id, order_no, bay_codes: string[],
                        start_date, end_date,           // 'YYYY-MM-DD' strings
                        status,                          // RESERVED|CONFIRMED|DONE|CANCELLED
                        created_by, area_name, task_name,
                        operation_no, people_required, part_name
                      }>  — a row appears once per bay listed in bay_codes.
     rangeStart       'YYYY-MM-DD' — first visible day (inclusive).
     rangeEnd         'YYYY-MM-DD' — last visible day (inclusive).
     onSelectSchedule (schedule) => void — optional; fired when a bar is clicked.
   ────────────────────────────────────────────────────────────────────────── */

const LABEL_W = 168;   // px — sticky bay/area label column
const DAY_W = 96;      // px — one day column
const HEADER_H = 52;   // px — sticky day-axis header
const BAR_H = 24;      // px — reservation bar height
const BAR_GAP = 4;     // px — vertical gap between stacked lanes
const ROW_PAD_Y = 6;   // px — vertical padding inside a bay row

const WEEKDAY = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Status drives colour = meaning only. Gradients darken the left edge (where the
// order_no label sits) so white text clears WCAG AA on every status; the lighter
// end only carries the badge chip, which has its own backdrop.
const STATUS_STYLE = {
  RESERVED: { bg: 'linear-gradient(135deg,#023e8a,#0077b6)', fg: '#ffffff', chipBg: 'rgba(255,255,255,0.22)', label: 'Reserved' },
  CONFIRMED: { bg: 'linear-gradient(135deg,#047857,#059669)', fg: '#ffffff', chipBg: 'rgba(255,255,255,0.22)', label: 'Confirmed' },
  DONE: { bg: 'linear-gradient(135deg,#64748b,#94a3b8)', fg: '#ffffff', chipBg: 'rgba(255,255,255,0.22)', label: 'Done' },
  CANCELLED: { bg: '#e2e8f0', fg: '#475569', chipBg: 'rgba(71,85,105,0.14)', label: 'Cancelled', strike: true, border: '#cbd5e1' },
};
const DEFAULT_STATUS = STATUS_STYLE.RESERVED;
function statusStyle(s) { return STATUS_STYLE[String(s || '').toUpperCase()] || DEFAULT_STATUS; }

/* ── date helpers — parse the given 'YYYY-MM-DD' strings, no Date.now() ─────── */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function dayNumOf(str) {
  if (typeof str !== 'string') return null;
  const t = str.slice(0, 10);
  if (!DATE_RE.test(t)) return null;
  const [y, m, d] = t.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function partsOf(dayNum) {
  const dt = new Date(dayNum * 86400000);
  return { y: dt.getUTCFullYear(), mon: dt.getUTCMonth(), dd: dt.getUTCDate(), wd: dt.getUTCDay() };
}
// today's day-number from wall-clock Y/M/D (for the "today" column marker only).
function todayDayNum() {
  const n = new Date();
  return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86400000);
}

function barTitle(s, style) {
  const lines = [
    s.order_no || '(tanpa order)',
    s.task_name ? `Task: ${s.task_name}` : null,
    s.operation_no != null ? `Operasi ${s.operation_no}` : null,
    s.part_name ? `Part: ${s.part_name}` : null,
    `${s.start_date || '?'} → ${s.end_date || '?'}`,
    s.people_required != null && s.people_required !== '' ? `${s.people_required} orang` : null,
    `Status: ${style.label}`,
    s.area_name ? `Area: ${s.area_name}` : null,
    s.created_by ? `Oleh: ${s.created_by}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

/* ── one bay's stacked reservation bars ────────────────────────────────────── */
function BayRow({ bay, segs, lanes, numDays, todayNum, originNum, onSelect }) {
  const rowH = ROW_PAD_Y * 2 + Math.max(1, lanes) * BAR_H + Math.max(0, lanes - 1) * BAR_GAP;
  return (
    <div className="flex border-b border-slate-100">
      {/* sticky bay label */}
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-slate-200 bg-white pl-4 pr-2"
        style={{ width: LABEL_W, height: rowH }}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
        <span className="truncate font-mono text-xs font-bold tabular-nums text-slate-700">{bay}</span>
        {segs.length > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-1.5 text-[11px] font-bold tabular-nums text-slate-500">
            {segs.length}
          </span>
        )}
      </div>

      {/* timeline track */}
      <div className="relative shrink-0" style={{ width: numDays * DAY_W, height: rowH }}>
        {/* day background columns (grid + weekend/today tint) */}
        <div className="absolute inset-0 flex" aria-hidden="true">
          {Array.from({ length: numDays }, (_, i) => {
            const dn = originNum + i;
            const { wd } = partsOf(dn);
            const weekend = wd === 0 || wd === 6;
            const isToday = dn === todayNum;
            return (
              <div
                key={i}
                className="h-full shrink-0"
                style={{
                  width: DAY_W,
                  borderRight: '1px solid #e2e8f0',
                  borderLeft: isToday ? '2px solid #ade8f4' : undefined,
                  background: isToday
                    ? 'rgba(173,232,244,0.18)'
                    : weekend
                      ? 'rgba(148,163,184,0.06)'
                      : undefined,
                }}
              />
            );
          })}
        </div>

        {/* bars */}
        {segs.map((seg) => {
          const s = seg.schedule;
          const style = statusStyle(s.status);
          const span = seg.endIdx - seg.startIdx + 1;
          const left = seg.startIdx * DAY_W + 2;
          const width = span * DAY_W - 4;
          const top = ROW_PAD_Y + seg.lane * (BAR_H + BAR_GAP);
          const showChip = span >= 2;
          const people = s.people_required != null && s.people_required !== '' ? String(s.people_required) : null;
          const chipText = people || (s.operation_no != null ? `Op ${s.operation_no}` : null);
          return (
            <button
              key={`${s.schedule_id}-${bay}-${seg.startIdx}`}
              type="button"
              onClick={() => onSelect && onSelect(s)}
              title={barTitle(s, style)}
              aria-label={`${s.order_no || 'Reservasi'} di ${bay}, ${s.start_date} sampai ${s.end_date}, status ${style.label}`}
              className="group absolute flex items-center gap-1 overflow-hidden rounded-md px-2 text-left shadow-sm ring-1 ring-black/10 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] focus-visible:ring-offset-1 focus-visible:ring-offset-white motion-reduce:transition-none motion-reduce:hover:brightness-100"
              style={{
                left, width, top, height: BAR_H,
                background: style.bg,
                color: style.fg,
                border: style.border ? `1px solid ${style.border}` : undefined,
              }}
            >
              <span
                className={`truncate font-mono text-xs font-bold tabular-nums ${style.strike ? 'line-through' : ''}`}
              >
                {s.order_no || '—'}
              </span>
              {showChip && chipText && (
                <span
                  className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1 text-[11px] font-bold tabular-nums"
                  style={{ background: style.chipBg }}
                >
                  {people && <Users className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />}
                  {chipText}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LegendItem({ swatch, strike, text }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-500">
      <span
        className="inline-block h-3 w-4 rounded-sm ring-1 ring-black/5"
        style={{ background: swatch }}
        aria-hidden="true"
      />
      <span className={`text-xs font-semibold ${strike ? 'text-slate-400 line-through' : ''}`}>{text}</span>
    </span>
  );
}

export default function BayReservationTimeline({ schedules, rangeStart, rangeEnd, onSelectSchedule }) {
  const originNum = dayNumOf(rangeStart);
  const endNum = dayNumOf(rangeEnd);
  const rangeValid = originNum != null && endNum != null && endNum >= originNum;
  const numDays = rangeValid ? endNum - originNum + 1 : 0;
  const todayNum = todayDayNum();

  // Bucket reservations onto bay rows, clamped to the window, with greedy lane
  // assignment so overlapping bars never fully cover one another.
  const { byBay, visibleCount } = useMemo(() => {
    const map = new Map();
    const seen = new Set();
    if (!rangeValid || !Array.isArray(schedules)) return { byBay: map, visibleCount: 0 };

    schedules.forEach((s) => {
      if (!s) return;
      const start = dayNumOf(s.start_date);
      const end = dayNumOf(s.end_date);
      const rawStart = start != null ? start : end;      // tolerate a missing edge
      const rawEnd = end != null ? end : start;
      if (rawStart == null || rawEnd == null) return;
      const lo = Math.min(rawStart, rawEnd);
      const hi = Math.max(rawStart, rawEnd);
      if (hi < originNum || lo > endNum) return;          // fully outside the window
      const startIdx = Math.max(0, lo - originNum);
      const endIdx = Math.min(numDays - 1, hi - originNum);
      const bays = Array.isArray(s.bay_codes) ? s.bay_codes : [];
      let placed = false;
      bays.forEach((bay) => {
        if (!bay) return;
        placed = true;
        if (!map.has(bay)) map.set(bay, []);
        map.get(bay).push({ schedule: s, startIdx, endIdx, lane: 0 });
      });
      if (placed) seen.add(s.schedule_id ?? s);
    });

    // greedy lane packing per bay (sub-rows for time-overlapping reservations)
    map.forEach((segs) => {
      segs.sort((a, b) => a.startIdx - b.startIdx || a.endIdx - b.endIdx);
      const laneEnd = [];
      segs.forEach((seg) => {
        let lane = laneEnd.findIndex((last) => last < seg.startIdx);
        if (lane === -1) { lane = laneEnd.length; laneEnd.push(seg.endIdx); }
        else laneEnd[lane] = seg.endIdx;
        seg.lane = lane;
      });
    });

    return { byBay: map, visibleCount: seen.size };
  }, [schedules, rangeValid, originNum, endNum, numDays]);

  // Guards → shared EmptyState.
  if (!rangeValid) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <EmptyState
          icon={CalendarRange}
          title="Rentang tanggal tidak valid"
          description="rangeStart dan rangeEnd harus tanggal 'YYYY-MM-DD' dengan rangeEnd ≥ rangeStart."
        />
      </div>
    );
  }
  if (visibleCount === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <EmptyState
          icon={CalendarRange}
          title="Tidak ada reservasi bay"
          description={`Tidak ada reservasi pada rentang ${rangeStart} → ${rangeEnd}.`}
        />
      </div>
    );
  }

  const boardW = LABEL_W + numDays * DAY_W;
  const laneCountOf = (segs) => (segs.length ? Math.max(...segs.map((x) => x.lane)) + 1 : 1);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* caption + legend */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 text-slate-700">
          <CalendarRange className="h-4 w-4 text-[#0077b6]" strokeWidth={2} aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Reservasi Bay</span>
          <span className="font-mono text-xs font-semibold tabular-nums text-slate-600">{rangeStart} → {rangeEnd}</span>
          <span className="text-xs font-semibold tabular-nums text-slate-400">· {numDays} hari</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <LegendItem swatch={STATUS_STYLE.RESERVED.bg} text="Reserved" />
          <LegendItem swatch={STATUS_STYLE.CONFIRMED.bg} text="Confirmed" />
          <LegendItem swatch={STATUS_STYLE.DONE.bg} text="Done" />
          <LegendItem swatch={STATUS_STYLE.CANCELLED.bg} strike text="Cancelled" />
        </div>
      </div>

      {/* board — scrolls both axes; label column + day header stay pinned */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-300 bg-white shadow-sm">
        <div className="relative" style={{ width: boardW, minWidth: '100%' }}>
          {/* sticky day-axis header */}
          <div className="sticky top-0 z-30 flex" style={{ height: HEADER_H }}>
            <div
              className="sticky left-0 z-40 flex shrink-0 items-center border-b border-r border-slate-200 bg-slate-50 px-4 text-[11px] font-extrabold uppercase tracking-wide text-slate-500"
              style={{ width: LABEL_W }}
            >
              Area · Bay
            </div>
            <div className="flex shrink-0 bg-slate-50" style={{ width: numDays * DAY_W }}>
              {Array.from({ length: numDays }, (_, i) => {
                const dn = originNum + i;
                const { mon, dd, wd } = partsOf(dn);
                const weekend = wd === 0 || wd === 6;
                const isToday = dn === todayNum;
                return (
                  <div
                    key={i}
                    className="flex shrink-0 flex-col items-center justify-center border-b border-slate-200"
                    style={{
                      width: DAY_W,
                      borderRight: '1px solid #e2e8f0',
                      borderLeft: isToday ? '2px solid #ade8f4' : undefined,
                      background: isToday
                        ? 'rgba(173,232,244,0.35)'
                        : weekend
                          ? 'rgba(148,163,184,0.08)'
                          : undefined,
                    }}
                  >
                    <span className={`text-[11px] font-bold uppercase ${weekend ? 'text-[#0077b6]' : 'text-slate-400'}`}>
                      {WEEKDAY[wd]}
                    </span>
                    <span className="text-xs font-extrabold tabular-nums text-slate-700">
                      {String(dd).padStart(2, '0')}
                    </span>
                    {(dd === 1 || i === 0) && (
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{MONTH[mon]}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* areas → bays */}
          {AREA_OPTIONS.map((area) => {
            const areaCount = area.bays.reduce((n, bay) => n + (byBay.get(bay)?.length || 0), 0);
            return (
              <div key={area.areaCode}>
                {/* area group header band */}
                <div className="flex border-b border-[#90e0ef]" style={{ width: boardW, background: '#caf0f8' }}>
                  <div
                    className="sticky left-0 z-20 flex shrink-0 items-center gap-2 px-4 py-1.5"
                    style={{ width: LABEL_W, background: '#caf0f8' }}
                  >
                    <span className="truncate text-xs font-extrabold uppercase tracking-wide text-[#0077b6]">
                      {area.areaName}
                    </span>
                    <span className="ml-auto shrink-0 rounded-full bg-white/70 px-1.5 text-[11px] font-bold tabular-nums text-[#023e8a]">
                      {areaCount}
                    </span>
                  </div>
                </div>

                {/* bay rows */}
                {area.bays.map((bay) => {
                  const segs = byBay.get(bay) || [];
                  return (
                    <BayRow
                      key={`${area.areaCode}-${bay}`}
                      bay={bay}
                      segs={segs}
                      lanes={laneCountOf(segs)}
                      numDays={numDays}
                      todayNum={todayNum}
                      originNum={originNum}
                      onSelect={onSelectSchedule}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
