// FloorMapOverview — TINGKAT 1 peta lantai area (PLAN §3–§4, 2026-09-21).
//
// Arah visual yang menggantikan perombakan 2026-08-25:
//  - Kartu area menampilkan PROJECT, bukan order (groupAreaProjects): satu
//    project bisa memegang beberapa order di beberapa bay. Nomor order turun
//    tingkat ke chip di panel detail area.
//  - Peta zona E/C per bay fisik: EDGE di atas, CENTER di bawah. C dan E
//    disimpan TERPISAH sehingga dua project pada satu bay tidak saling menimpa,
//    dan zona kosong tetap terlihat.
//  - Grid fit-width (`auto-fill` + `1fr`), BUKAN lebar statik + scroll
//    horizontal: kartu kini mengisi lebar container.
//  - PENCARIAN TIDAK MENGHAPUS OKUPANSI. Kapasitas dan peta zona selalu berasal
//    dari SELURUH reservasi aktif; hasil pencarian dinaikkan urutannya dan
//    sisanya diredupkan. Versi lama menyembunyikan area yang tidak cocok,
//    sehingga peta okupansi tampak kosong saat user mengetik.
//  - Tab `Lane A` / `Lane B` / `Blasting/Painting` menjadi navigasi OTORITATIF
//    pada ≤1180px: hanya satu bagian lantai yang tampil (§4.4).
//
// Container query dipasang di floorLayout.css (`.floor-frame`), bukan media
// query: halaman nyata punya sidebar, jadi lebar viewport bukan lebar yang
// tersedia di sini.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_AREAS, BLASTING_AREA, LANE_A, LANE_B,
  buildAreaReservations, groupAreaProjects,
} from './constants';
import AreaCard, { BlastingPaintingPane, FloorHeader } from './AreaCard';
import './floorLayout.css';

// Item non-area di daftar lane (gudang kosmetik / lorong) diabaikan: hanya
// `type === 'area'` yang menghasilkan kartu.
function areaItems(items) {
  return items.filter((item) => item.type === 'area');
}

// Pencocokan pencarian. Dikerjakan per PROJECT (bukan per order) supaya kartu
// bisa diredupkan tanpa menambah/menghapus isi peta. Nomor order ikut dicari
// walau tidak lagi ditampilkan di kartu — itu satu-satunya cara user bisa
// menemukan order lewat pencarian.
function matchesQuery(group, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const qNorm = q.replace(/^0+(?=\d)/, '');
  if (String(group.project || '').toLowerCase().includes(q)) return true;
  if (String(group.purpose || '').toLowerCase().includes(q)) return true;
  if ((group.bays || []).some((bay) => String(bay).toLowerCase().includes(q))) return true;
  if ((group.orderNumbers || []).some((orderNo) => {
    const on = String(orderNo).toLowerCase();
    return on.includes(q) || on.replace(/^0+(?=\d)/, '').includes(qNorm);
  })) return true;
  return false;
}

export default function FloorMapOverview({
  schedulesByBay,
  cursorDate,
  selectedAreaCode,
  onSelectArea,
  onSelectZone,
  orderFilter = '',
  onClearFilter,
  readout = null,
  detailPanel = null,
}) {
  const selectRef = useRef(onSelectArea);
  useEffect(() => {
    selectRef.current = onSelectArea;
  });
  const handleSelectArea = useCallback((areaCode) => {
    if (typeof selectRef.current === 'function') selectRef.current(areaCode);
  }, []);

  // Sama seperti onSelectArea: disimpan di ref supaya handler tetap STABIL dan
  // React.memo pada kartu tidak batal setiap render induk.
  const zoneRef = useRef(onSelectZone);
  useEffect(() => {
    zoneRef.current = onSelectZone;
  });
  const handleSelectZone = useCallback((areaCode, cell) => {
    if (typeof zoneRef.current === 'function') zoneRef.current(areaCode, cell);
  }, []);

  // Reservasi aktif per area pada tanggal kursor — sumber tunggal untuk kartu.
  const areaReservations = useMemo(() => {
    const map = new Map();
    for (const area of ALL_AREAS) {
      map.set(area.areaCode, buildAreaReservations(schedulesByBay, area));
    }
    return map;
  }, [schedulesByBay]);

  // Project per area, dengan daftar nomor order untuk pencarian. Dihitung SEKALI
  // di sini (bukan di dalam tiap kartu) supaya setiap kartu menerima array yang
  // stabil dan React.memo-nya tetap bekerja.
  const areaProjects = useMemo(() => {
    const map = new Map();
    for (const area of ALL_AREAS) {
      const reservations = areaReservations.get(area.areaCode) || [];
      const groups = groupAreaProjects(reservations).map((group) => ({
        ...group,
        orderNumbers: reservations
          .filter((r) => String(r.project_name || r.part_name || r.purpose || '') === group.project
            && r.order_no)
          .map((r) => r.order_no),
      }));
      map.set(area.areaCode, groups);
    }
    return map;
  }, [areaReservations]);

  // Baris pencarian: dipakai untuk meredupkan kartu, TIDAK untuk menyembunyikan
  // okupansi. Kartu tanpa hasil tetap tampil beserta peta zonanya.
  const hits = useMemo(() => {
    const out = new Map();
    const q = String(orderFilter || '').trim();
    if (!q) return out;
    for (const area of ALL_AREAS) {
      const groups = areaProjects.get(area.areaCode) || [];
      out.set(area.areaCode, groups.filter((group) => matchesQuery(group, q)).length);
    }
    return out;
  }, [orderFilter, areaProjects]);

  const groupsOf = useCallback(
    (areaCode) => areaProjects.get(areaCode) || [],
    [areaProjects],
  );

  const query = String(orderFilter || '').trim();
  const totalHits = query
    ? [...hits.values()].reduce((sum, count) => sum + count, 0)
    : null;

  // Tab aktif = state user, TAPI area terpilih selalu menang. Ini turunan
  // langsung dari props, bukan efek: menulisnya lewat useEffect akan memicu
  // cascading render (dilarang oleh aturan lint repo) dan membuat tab
  // "tertinggal satu frame" saat area dibuka dari URL.
  const [laneChoice, setLaneChoice] = useState('A');
  const laneOfArea = useCallback((areaCode) => {
    if (!areaCode) return null;
    if (areaCode === BLASTING_AREA.areaCode) return 'BP';
    if (areaItems(LANE_A).some((item) => item.areaCode === areaCode)) return 'A';
    if (areaItems(LANE_B).some((item) => item.areaCode === areaCode)) return 'B';
    return null;
  }, []);
  const lane = laneOfArea(selectedAreaCode) || laneChoice;

  // Pembungkus kartu: peredupan filter harus SERAGAM di semua pane. Kalau hanya
  // kartu lane yang diredupkan sementara Blasting/Painting tidak, user membaca
  // pane yang tidak diredupkan sebagai "ini hasil pencarian" — padahal peta
  // okupansi sengaja tidak pernah ikut disaring.
  const wrapCard = (areaCode, node) => {
    const dim = Boolean(query) && (hits.get(areaCode) || 0) === 0;
    return (
      <div
        key={areaCode}
        className={dim ? 'opacity-45 transition-opacity' : 'transition-opacity'}
        data-dimmed={dim ? 'true' : undefined}
      >
        {node}
      </div>
    );
  };

  // Satu lane = satu bagian lantai. Header lane tetap, ISI-nya digulir
  // (`.lane-scroll`) sehingga kartu tidak pernah terpotong tanpa bisa dijangkau.
  const renderLane = (items, laneKey) => (
    <div className="lane-pane" data-lane={laneKey}>
      <div className="lane-scroll">
        <div className="lane-grid">
          {areaItems(items).map((area) => wrapCard(area.areaCode, (
            <AreaCard
              area={area}
              groups={groupsOf(area.areaCode)}
              cursorDate={cursorDate}
              selected={selectedAreaCode === area.areaCode}
              onSelect={handleSelectArea}
              onSelectZone={handleSelectZone}
            />
          )))}
        </div>
      </div>
    </div>
  );

  const laneColumn = (items, laneKey) => (
    <div className="lane-column" data-lane={laneKey}>
      {renderLane(items, laneKey)}
    </div>
  );

  // data-lane WAJIB ada di .floor-frame: seluruh selector tab di floorLayout.css
  // berbentuk `.floor-frame[data-lane='A'] .lane-pane[data-lane='A']`.
  return (
    <section
      aria-label="Peta lantai"
      className="floor-frame"
      data-lane={lane}
    >
      <FloorHeader
        cursorDate={cursorDate}
        readout={readout}
      />

      {query ? (
        <p className="text-xs font-semibold text-[#0077b6]" data-testid="floor-filter-note">
          Filter “{query}” — {totalHits ?? 0} project(s) matched, all {ALL_AREAS.length} areas still shown.
          Search never changes map occupancy.
          <button
            type="button"
            onClick={() => typeof onClearFilter === 'function' && onClearFilter()}
            className="ml-2 min-h-[32px] rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:border-red-300 hover:text-red-600"
          >
            Clear filter
          </button>
        </p>
      ) : null}

      <div
        className="floor-tabs"
        role="tablist"
        aria-label="Bagian lantai"
      >
        {[
          { key: 'A', label: `Lane A · ${areaItems(LANE_A).length}` },
          { key: 'B', label: `Lane B · ${areaItems(LANE_B).length}` },
          { key: 'BP', label: 'Blasting/Painting' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={lane === tab.key}
            data-lane-tab={tab.key}
            onClick={() => setLaneChoice(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className="floor-grid"
        data-detail={detailPanel ? 'docked' : 'none'}
        data-lane={lane}
      >
        {/* Blasting/Painting: pane-nya sendiri juga digulir, sama seperti lane. */}
        <div className="floor-pane" data-pane="BP">
          <div className="lane-scroll">
            {wrapCard(BLASTING_AREA.areaCode, (
              <BlastingPaintingPane
                area={BLASTING_AREA}
                groups={groupsOf(BLASTING_AREA.areaCode)}
                cursorDate={cursorDate}
                selected={selectedAreaCode === BLASTING_AREA.areaCode}
                onSelect={handleSelectArea}
                onSelectZone={handleSelectZone}
              />
            ))}
          </div>
        </div>

        {/* Desktop: kedua lane di dalam satu wadah agar penempatan grid bisa
            eksplisit dan Lane B tidak jatuh ke kolom Blasting/Painting. */}
        <div className="lane-stack">
          {laneColumn(LANE_A, 'A')}
          {laneColumn(LANE_B, 'B')}
        </div>

        {detailPanel ? (
          <div className="floor-detail-pane" data-pane="detail">{detailPanel}</div>
        ) : null}
      </div>
    </section>
  );
}
