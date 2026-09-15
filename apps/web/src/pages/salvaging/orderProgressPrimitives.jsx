// Komponen presentational untuk dashboard Order Progress varian Salvaging.
// Dipisah dari file halaman supaya halaman tetap di bawah batas panjang gate (C13);
// isi komponen tidak diubah dari versi sebelumnya.

import React from 'react';

import { formatNumber } from './orderProgressFormat';

export function DashboardCard({ children, className = '' }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

const PAGER_BTN = 'rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40';

export function DashboardPager({ page, totalPages, onChange }) {
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className={PAGER_BTN}>
        Prev
      </button>
      <span className="text-xs text-slate-400">Page {page} / {totalPages}</span>
      <button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)} className={PAGER_BTN}>
        Next
      </button>
    </div>
  );
}

export function TimesheetHistoryTable({ rows }) {
  if (rows.length === 0) {
    return <p className="py-2 text-center text-slate-400">No timesheet records</p>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="uppercase text-slate-400">
          <th className="px-2 py-1 text-left">Date</th>
          <th className="px-2 py-1 text-left">Serial No</th>
          <th className="px-2 py-1 text-left">Operator</th>
          <th className="px-2 py-1 text-right">Hours</th>
          <th className="px-2 py-1 text-right">Entries</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((row, index) => (
          <tr key={`${row.work_date}-${index}`} className="text-slate-600">
            <td className="px-2 py-1">{row.work_date}</td>
            <td className="px-2 py-1 font-mono">{row.serialnumber || '-'}</td>
            <td className="px-2 py-1 font-semibold">{row.full_name || '-'}</td>
            <td className="px-2 py-1 text-right font-bold text-[#0077b6]">{formatNumber(row.total_hours)}</td>
            <td className="px-2 py-1 text-right">{row.entry_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
