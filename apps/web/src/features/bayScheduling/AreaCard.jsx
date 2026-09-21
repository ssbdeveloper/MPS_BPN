import React, { useCallback, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import {
  areaRangeLabel,
  bpSlotGroups,
  buildZoneOccupancy,
  formatDate,
  plural,
  projectColor,
  shortProjectName,
  zoneOverlaps,
  zoneUsage,
} from './constants';

// Urutan zona dari atas ke bawah untuk peta kartu: EDGE di atas, CENTER di
// bawah (PLAN §3.2 butir 2).
const BAY_ZONE_ORDER = ['EDGE', 'CENTER'];

// AreaCard — kartu area untuk peta lantai tingkat 1 (PLAN §3.2).
//
// Isi, dari atas ke bawah:
//   1. rentang bay ("A38–A35") sebagai hierarki PRIMER, nama area sebagai
//      sekunder, hitungan `zona terpakai / total zona` sebagai metrik utilitas
//   2. peta zona E/C — satu kolom per bay fisik, E di atas C di bawah
//   3. daftar PROJECT (bukan order): swatch warna, nama pendek, jumlah order,
//      rentang tanggal
//
// Nomor order tidak dihapus, hanya turun tingkat: muncul sebagai chip di panel
// detail area. Grup datang dari groupsOf(areaCode) yang dihitung sekali di
// induk, jadi komponen ini tetap murni terhadap props.

const MAX_PROJECTS = 3;

// Baris project. Nama project DIBUNGKUS ke baris berikutnya, bukan dipangkas
// ellipsis: nama-nama job di sini punya awalan yang sama ("MPS - ...",
// "42M3 ..."), jadi memangkas justru menghapus bagian yang membedakan dan semua
// baris terlihat identik. Dulu nama dipotong 27–169px di semua ukuran.
// Karena kartu memakai `grid-auto-rows: max-content` (PLAN §4.2), menambah baris
// menambah tinggi kartu — bukan memotongnya.
function ProjectLegendRow({ group }) {
  const color = projectColor(group.project);
  const label = shortProjectName(group.project) || group.project || '—';
  return (
    <li className="flex min-w-0 items-start gap-1.5">
      <span
        aria-hidden="true"
        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-sm ${group.nonJob ? 'bg-amber-400' : ''}`}
        style={group.nonJob ? undefined : { background: color }}
      />
      <span
        className="t-pname min-w-0 flex-1 font-semibold leading-tight text-slate-700"
        style={{ overflowWrap: 'anywhere' }}
        title={group.project}
      >
        {label}
      </span>
      <span className="flex shrink-0 flex-col items-end">
        {group.orders > 1 && (
          <span className="t-meta font-mono font-semibold leading-tight tabular-nums text-slate-500">
            {group.orders}×
          </span>
        )}
        <span className="t-meta whitespace-nowrap font-mono leading-tight tabular-nums text-slate-400">
          {formatDate(group.start_date)}–{formatDate(group.end_date)}
        </span>
      </span>
    </li>
  );
}

const AreaCard = React.memo(function AreaCard({
  area, groups, cursorDate, selected, onSelect, onSelectZone,
}) {
  const [expanded, setExpanded] = useState(false);

  // Satu peta zona + satu daftar overlap per kartu, dihitung dari groups.
  const occupancy = useMemo(() => buildZoneOccupancy(area.areaCode, groups), [area.areaCode, groups]);
  const overlaps = useMemo(() => zoneOverlaps(occupancy), [occupancy]);
  const usage = useMemo(() => zoneUsage(occupancy), [occupancy]);
  // Jumlah reservasi terbanyak pada satu zona — dipakai badge amber supaya
  // syarat "overlap ditampilkan dengan JUMLAH" tetap terbaca (di sel 13px
  // angkanya jatuh ke 8px dan tidak terbaca di tablet).
  // CATATAN: `zoneOverlaps` mengembalikan `{ bay, zone, groups }` — jumlahnya ada
  // di `groups.length`, BUKAN `count` (field itu tidak ada dan sempat menghasilkan 0).
  const maxOverlap = useMemo(
    () => overlaps.reduce((m, o) => Math.max(m, o.groups.length), 0),
    [overlaps],
  );

  const shown = expanded ? groups : groups.slice(0, MAX_PROJECTS);
  const hiddenCount = groups.length - shown.length;

  const handleClick = useCallback(() => onSelect(area.areaCode), [onSelect, area.areaCode]);
  const handleKey = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(area.areaCode);
    }
  }, [onSelect, area.areaCode]);

  // Satu kolom per BAY FISIK, berisi sel EDGE di atas dan CENTER di bawah
  // (PLAN §3.2 butir 2). Label kolom = kode bay; label sel = huruf zona.
  const zoneColumns = useMemo(() => occupancy.bays.map((bay) => {
    if (!occupancy.zoned) {
      const cell = occupancy.byBay[bay];
      return { bay, zones: [{ key: null, letter: '', cell }] };
    }
    return {
      bay,
      zones: BAY_ZONE_ORDER.map((zoneKey) => ({
        key: zoneKey,
        letter: zoneKey.charAt(0),
        cell: occupancy.byBay[bay][zoneKey],
      })),
    };
  }), [occupancy]);

  const title = `${area.areaName}: ${plural(groups.length, 'project')}, `
    + `${usage.used}/${usage.total} zones used on ${formatDate(cursorDate)}`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKey}
      aria-pressed={selected}
      title={title}
      data-area={area.areaCode}
      className={`flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
        selected
          ? 'border-[#0077b6] ring-2 ring-[#90e0ef] shadow-md'
          : 'border-slate-300 hover:border-[#90e0ef] hover:shadow-md'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 px-2 pt-1.5">
        <span className="t-code min-w-0 font-extrabold leading-tight tabular-nums text-slate-800">
          {areaRangeLabel(area)}
        </span>
        <span
          className="shrink-0 rounded border border-slate-200 px-1 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums text-slate-500"
          title="Zones used / total zones"
        >
          {usage.used}/{usage.total}
        </span>
      </div>
      <div className="px-2 text-[10.5px] font-semibold uppercase leading-tight tracking-wide text-slate-400">
        {area.areaName}
      </div>

      {/* Peta zona E/C. Satu kolom per bay fisik, E di atas C di bawah.
          Amber + jumlah = overlap; hanya dipakai untuk keadaan ini.
          Jumlah overlap TIDAK ditulis di dalam sel: sel cuma 13px tinggi dan
          angkanya jatuh ke 8px (tak terbaca di tablet, terukur). Badge amber di
          bawah peta yang membawa jumlahnya, dengan teks 11px. */}
      <div className="zone-map px-2 pt-1.5" role="img" aria-label={`Zone map ${area.areaName}`}>
        {zoneColumns.map(({ bay, zones }) => (
          <span key={bay} className="zone-col" data-bay={bay}>
            <span className="zone-col-label">{bay}</span>
            {zones.map(({ key, letter, cell }) => {
              const count = cell.length;
              const over = count > 1;
              return (
                <span
                  key={`${bay}-${key || 'flat'}`}
                  className={`zone-cell ${count === 0 ? 'is-empty' : ''} ${over ? 'is-over' : ''}`}
                  style={!over && count > 0 ? { background: projectColor(cell[0].project) } : undefined}
                  data-zone={key || undefined}
                  data-over={over ? 'true' : undefined}
                  // Sel BUKAN tombol tersendiri (PLAN §9 butir 3): terlalu kecil
                  // untuk target sentuh. Klik tetap ditangkap supaya panel bisa
                  // dibuka dengan konteks zona, tapi kartu yang jadi targetnya.
                  onClick={(e) => {
                    if (typeof onSelectZone !== 'function') return;
                    e.stopPropagation();
                    onSelectZone(area.areaCode, { bay, zone: key || null });
                  }}
                  title={over
                    ? `${bay}${letter ? ` ${letter}` : ''}: OVERLAP — ${count} reservasi`
                    : `${bay}${letter ? ` ${letter}` : ''}: ${count ? 'terpakai' : 'kosong'}`}
                >
                  {letter}
                </span>
              );
            })}
          </span>
        ))}
      </div>

      {overlaps.length > 0 && (
        <p className="mx-2 mt-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[11px] font-bold leading-tight text-amber-800">
          Overlap {overlaps.length} {overlaps.length === 1 ? 'zone' : 'zones'} × {maxOverlap} reservations
        </p>
      )}

      <div className="mt-1.5 flex flex-col gap-1 border-t border-slate-100 px-2 py-1.5">
        {groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-1.5 py-2 text-center text-[10.5px] font-semibold text-slate-400">
            No reservations
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {shown.map((group) => <ProjectLegendRow key={group.key} group={group} />)}
            </ul>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                className="min-h-[34px] w-full rounded-lg border border-dashed border-[#90e0ef] bg-[#f0faff] py-1 t-btn font-bold text-[#0077b6] transition hover:border-[#0096c7] hover:bg-[#e6f6fd]"
              >
                {expanded ? 'Show less' : `+${hiddenCount} more projects`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
});

// BlastingPaintingPane — AREA-18 (PLAN §4.3). Slot vertikal; slot kosong diberi
// pola garis, bukan sekadar teks "Available".
export const BlastingPaintingPane = React.memo(function BlastingPaintingPane({
  area, groups, cursorDate, selected, onSelect, onSelectZone,
}) {
  const occupancy = useMemo(() => buildZoneOccupancy(area.areaCode, groups), [area.areaCode, groups]);
  // Kelompok Painting/Blasting dihitung dari bay yang BENAR-BENAR ada di
  // occupancy, bukan dari area.bays mentah — supaya slot dan data selalu sinkron.
  const slotGroups = useMemo(() => bpSlotGroups(occupancy.bays), [occupancy.bays]);
  const handleClick = useCallback(() => onSelect(area.areaCode), [onSelect, area.areaCode]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(area.areaCode); }
      }}
      aria-pressed={selected}
      data-area={area.areaCode}
      title={`${area.areaName}: ${plural(groups.length, 'project')} on ${formatDate(cursorDate)}`}
      className={`flex min-h-0 cursor-pointer flex-col gap-1.5 overflow-hidden rounded-xl border bg-white p-2 text-left shadow-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
        selected ? 'border-[#0077b6] ring-2 ring-[#90e0ef]' : 'border-slate-300 hover:border-[#90e0ef]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-extrabold uppercase leading-tight tracking-wide text-slate-700">
          {area.areaName}
        </span>
        <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-slate-500">
          {groups.length} project
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {slotGroups.map(({ kind, label, bays }) => (
          <React.Fragment key={kind}>
            {/* Pemisah kelompok: Painting dulu, lalu Blasting (PLAN §4.3). */}
            <p className="bp-group" data-kind={kind}>{label}</p>
            {bays.map((bay) => {
              const cell = occupancy.byBay[bay] || [];
              const over = cell.length > 1;
              const lead = cell[0] || null;
              // Pita petak bay: warna project pemakai di sisi kode bay, supaya
              // satu project bisa dilacak lintas slot tanpa membaca teks.
              // Non-job tidak diberi warna project (bukan pekerjaan job).
              const stripe = lead && !lead.nonJob ? projectColor(lead.project) : undefined;
              return (
                <div
                  key={bay}
                  data-bay={bay}
                  onClick={(e) => {
                    if (typeof onSelectZone !== 'function') return;
                    e.stopPropagation();
                    // Bay blasting/painting TIDAK dibagi zona: satu bay = satu unit.
                    onSelectZone(area.areaCode, { bay, zone: null });
                  }}
                  className={`slot-row ${cell.length === 0 ? 'is-empty' : ''} ${over ? 'is-over' : ''}`}
                >
                  <span className="slot-code" style={stripe ? { '--pc': stripe } : undefined}>
                    {bay}
                  </span>
                  {cell.length === 0 ? (
                    <span className="t-pname min-w-0 flex-1 font-semibold text-slate-400">
                      Empty
                    </span>
                  ) : (
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className="t-pname font-bold leading-tight text-slate-700"
                        style={{ overflowWrap: 'anywhere' }}
                        title={lead.project}
                      >
                        {shortProjectName(lead.project) || '—'}
                      </span>
                      <span className="t-meta whitespace-nowrap font-mono leading-tight tabular-nums text-slate-400">
                        {formatDate(lead.start_date)}–{formatDate(lead.end_date)}
                      </span>
                    </span>
                  )}
                  {over && (
                    <span className="shrink-0 rounded border border-amber-300 bg-amber-50 px-1 font-mono text-[10.5px] font-bold text-amber-800">
                      {cell.length}×
                    </span>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
});

// Header ringkas lantai. `readout` hanya ditampilkan kalau induk mengirimnya.
export function FloorHeader({ cursorDate, readout }) {
  return (
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
          <h3 className="truncate text-sm font-extrabold text-slate-800">Ringkasan area</h3>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {readout}
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#90e0ef] bg-[#caf0f8] px-2 py-1 text-xs font-bold tabular-nums text-[#023e8a]">
          Per {formatDate(cursorDate)}
        </span>
      </div>
    </div>
  );
}

export default AreaCard;
