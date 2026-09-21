import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import {
  areaRangeLabel,
  buildZoneOccupancy,
  formatDate,
  plural,
  projectColor,
  rangeProgress,
  shortProjectName,
  zoneOverlaps,
  zoneSelectionGroups,
  zoneUsage,
} from './constants';

// AreaDetailPanel — panel detail area/zona (PLAN §4.4 + §9 butir 8, 11, 16).
//
// Tiga mode tampilan (overlay >1180 / terdok 29% pada 901–1180 / bottom sheet
// ≤900) SELURUHNYA ditentukan `floorLayout.css` lewat container query pada
// `.floor-frame`. Komponen ini sengaja tidak tahu lebar layar: mengukur viewport
// di JS akan salah karena halaman nyata punya sidebar (PLAN §4.4).
//
// Sifat penting yang diuji probe:
//   - NON-MODAL (PLAN §9 butir 16): tidak memasang scrim, tidak mengunci scroll,
//     tidak memakai `role="dialog"`. Peta okupansi wajib tetap terbaca.
//   - Footer aksi tidak ikut ter-scroll (PLAN §9 butir 11).
//   - Menampilkan SELURUH reservasi pada sel terpilih, termasuk overlap
//     (PLAN §9 butir 6 & 12).

// Satu baris reservasi. Nama project dibungkus, TIDAK di-truncate: nama job MPS
// berbagi prefiks ("MPS - ..."), jadi ellipsis justru membuang pembedanya.
function ReservationRow({ group, cursorDate }) {
  const progress = rangeProgress(group.start_date, group.end_date, cursorDate);
  const color = group.nonJob ? '#94a3b8' : projectColor(group.project);

  return (
    <li className="detail-row">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 h-3 w-3 shrink-0 rounded-sm"
          style={{ background: color }}
        />
        <div className="min-w-0 flex-1">
          <p
            className="t-pname font-bold leading-tight text-slate-800"
            style={{ overflowWrap: 'anywhere' }}
            title={group.project}
          >
            {shortProjectName(group.project) || '—'}
          </p>

          {/* Nomor order turun tingkat dari kartu ke panel (PLAN §3.2). */}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {group.nonJob ? (
              <span className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 t-meta font-bold text-slate-600">
                Non-job
              </span>
            ) : (
              <span className="rounded border border-[#90e0ef] bg-[#f0faff] px-1.5 py-0.5 t-meta font-mono font-bold tabular-nums text-[#0077b6]">
                {plural(group.orders || 0, 'order')}
              </span>
            )}
            <span className="t-meta font-mono tabular-nums text-slate-500">
              {formatDate(group.start_date)}–{formatDate(group.end_date)}
            </span>
          </div>

          {/* Bar rentang: posisi hari ini di dalam periode (PLAN §5.4). Tidak
              digambar sama sekali kalau rentangnya tidak masuk akal. */}
          {progress ? (
            <div
              className="detail-range"
              title={`${progress.days} days · ${formatDate(cursorDate)}`}
            >
              <span className="detail-range-fill" style={{ width: `${progress.percent}%` }} />
              {!progress.before && !progress.after ? (
                <span className="detail-range-now" style={{ left: `${progress.percent}%` }} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function AreaDetailPanel({
  area,
  groups,
  cursorDate,
  selection = null,
  onClose,
  onManage,
}) {
  const closeRef = useRef(null);
  const occupancy = useMemo(
    () => buildZoneOccupancy(area.areaCode, groups),
    [area.areaCode, groups],
  );
  const rows = useMemo(
    () => zoneSelectionGroups(occupancy, selection),
    [occupancy, selection],
  );
  const usage = useMemo(() => zoneUsage(occupancy), [occupancy]);
  const overlaps = useMemo(() => zoneOverlaps(occupancy), [occupancy]);

  const handleClose = useCallback(() => {
    if (typeof onClose === 'function') onClose();
  }, [onClose]);

  // Esc menutup panel (PLAN §5.4). Listener dipasang di dokumen, BUKAN di panel:
  // panel tidak menangkap fokus (non-modal), jadi Esc harus tetap bekerja saat
  // fokus masih ada di peta.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleClose]);

  // Fokus pindah ke tombol tutup saat sel yang dipilih berubah, supaya pengguna
  // keyboard tidak tertinggal di peta tanpa tahu panelnya berganti isi.
  useEffect(() => {
    if (closeRef.current) closeRef.current.focus({ preventScroll: true });
  }, [area.areaCode, selection?.bay, selection?.zone]);

  const zoneLabel = selection?.bay
    ? `${selection.bay}${selection.zone ? ` · ${selection.zone === 'EDGE' ? 'Edge' : 'Center'}` : ''}`
    : 'Whole area';

  return (
    <aside
      className="detail-panel"
      aria-label={`Detail ${area.areaName}`}
      data-selection={selection?.bay ? 'zone' : 'area'}
    >
      <header className="detail-head">
        <div className="min-w-0">
          <p className="t-meta font-mono font-bold uppercase tracking-wide text-[#0077b6]">
            {areaRangeLabel(area)}
          </p>
          <h4 className="t-title font-extrabold leading-tight text-slate-800">
            {area.areaName}
          </h4>
          <p className="t-meta mt-0.5 font-semibold text-slate-500">
            {zoneLabel} · {usage.used}/{usage.total} zones used
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={handleClose}
          aria-label="Close detail panel"
          className="detail-close"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Overlap dibaca lewat JUMLAH + amber, tidak pernah warna saja
          (PLAN §9 butir 15). */}
      {overlaps.length > 0 ? (
        <p className="detail-overlap">
          Overlap {overlaps.length} {overlaps.length === 1 ? 'zone' : 'zones'} ×{' '}
          {overlaps.reduce((max, item) => Math.max(max, item.groups.length), 0)} reservations
        </p>
      ) : null}

      <div className="detail-scroll">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-2 py-4 text-center text-[12px] font-semibold text-slate-400">
            No reservations in {zoneLabel.toLowerCase()}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((group) => (
              <ReservationRow key={group.key} group={group} cursorDate={cursorDate} />
            ))}
          </ul>
        )}
      </div>

      {/* Footer aksi WAJIB tetap terlihat, tidak ikut ter-scroll
          (PLAN §9 butir 11). Editor dibuka dengan konteks area/zona terpilih,
          bukan area contoh tetap (PLAN §9 butir 14). */}
      <footer className="detail-foot">
        <button
          type="button"
          onClick={() => typeof onManage === 'function' && onManage({
            areaCode: area.areaCode,
            bay: selection?.bay || null,
            zone: selection?.zone || null,
          })}
          className="detail-manage"
        >
          Manage reservations
        </button>
        <button type="button" onClick={handleClose} className="detail-dismiss">
          Close
        </button>
      </footer>
    </aside>
  );
}
