import React from 'react';
import { AlertTriangle, ChevronRight, MapPin } from 'lucide-react';
import { formatDate, statusStyle } from './constants';

/**
 * OrderReservationList — semua reservasi aktif SATU order, lintas tanggal (F3).
 *
 * Peta hanya menampilkan reservasi yang aktif pada tanggal kursor, jadi reservasi di luar
 * window itu tidak punya titik masuk. Daftar ini adalah titik masuk tersebut: setiap entri
 * membuka modal detail yang sama dengan klik di peta (edit, cancel grup, cancel per baris).
 *
 * Props:
 *   entries      – hasil orderReservationList(rows)
 *   readComplete – false bila pembacaan terpotong; daftar lalu diberi tanda tidak lengkap
 *   onOpen       – (entry) => void
 */
export default function OrderReservationList({ entries, readComplete, onOpen }) {
  if (!entries.length) return null;
  return (
    <section aria-label="Reservations for this order" className="rounded-lg border border-slate-200 bg-white">
      <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Reservations for this order ({entries.length}{readComplete ? '' : '+'})
      </p>
      {!readComplete && (
        <p className="px-3 pt-2 text-xs font-semibold text-amber-700">
          List is incomplete — the server stopped before the last page. Reload to try again.
        </p>
      )}
      <ul className="max-h-[30vh] overflow-y-auto">
        {entries.map((entry) => {
          const style = statusStyle(entry.status);
          const bays = Array.isArray(entry.bay_codes) ? entry.bay_codes.join(', ') : '';
          const where = [entry.area_code, bays].filter(Boolean).join(' · ');
          const open = Number(entry.open_checkin_count) || 0;
          return (
            <li key={entry.group_key} className="border-b border-slate-100 last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(entry)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-800">{where || '-'}</span>
                  <span className="block text-xs tabular-nums text-slate-500">
                    {formatDate(entry.start_date)} – {formatDate(entry.end_date)} · {entry.task_count} op{entry.task_count === 1 ? '' : 's'}
                  </span>
                </span>
                {open > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                    <AlertTriangle className="h-3 w-3" /> Check-in
                  </span>
                )}
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-bold uppercase ${style.pill}`}>
                  {style.label}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
