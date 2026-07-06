import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const STATUS_OPTIONS = ['SCHEDULED', 'LEAVE', 'SICK', 'PERMIT', 'OFF'];

const ATTEND_STYLE = {
  PRESENT: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ABSENT: 'bg-red-100 text-red-700 border-red-200',
  IN_PROGRESS: 'bg-amber-100 text-amber-700 border-amber-200',
  LEAVE: 'bg-sky-100 text-sky-700 border-sky-200',
  SICK: 'bg-purple-100 text-purple-700 border-purple-200',
  PERMIT: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  OFF: 'bg-slate-100 text-slate-600 border-slate-200',
};

function todayLocalISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function ShiftBadge({ shift }) {
  const isDay = shift === 'DAY';
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[10px] font-extrabold"
      style={isDay
        ? { background: '#fffbeb', borderColor: '#fde68a', color: '#b45309' }
        : { background: '#eef2ff', borderColor: '#c7d2fe', color: '#4338ca' }}
    >
      {isDay ? 'DAY' : 'NIGHT'}
    </span>
  );
}

function StatTile({ label, value, tone = 'neutral' }) {
  const tones = {
    neutral: { bg: '#f8fafc', border: '#e2e8f0', text: '#334155' },
    good: { bg: '#f0fdf4', border: '#bbf7d0', text: '#047857' },
    bad: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
    info: { bg: '#caf0f8', border: '#90e0ef', text: '#0077b6' },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div className="rounded-xl border px-3 py-2.5 text-center shadow-sm" style={{ background: t.bg, borderColor: t.border }}>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: t.text }}>{label}</div>
      <div className="mt-1 text-lg font-black leading-none" style={{ color: t.text }}>{value}</div>
    </div>
  );
}

function EwsRosterPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayLocalISO());
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState('');

  const load = useCallback(async (d) => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/ews/roster?date=${encodeURIComponent(d)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const payload = await res.json();
      setRows(Array.isArray(payload?.data) ? payload.data : []);
    } catch (err) {
      setError(err.message || 'Failed to load roster');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const counts = useMemo(() => {
    const c = { scheduled: 0, present: 0, absent: 0, excused: 0, in_progress: 0 };
    for (const r of rows) {
      if (['LEAVE', 'SICK', 'PERMIT', 'OFF'].includes(r.status)) c.excused += 1;
      else {
        c.scheduled += 1;
        if (r.attendance === 'PRESENT') c.present += 1;
        else if (r.attendance === 'ABSENT') c.absent += 1;
        else if (r.attendance === 'IN_PROGRESS') c.in_progress += 1;
      }
    }
    return c;
  }, [rows]);

  const changeStatus = useCallback(async (serialnumber, status) => {
    const key = `${serialnumber}`;
    setSavingKey(key);
    try {
      const res = await fetch(`${API_BASE}/ews/roster/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialnumber, business_date: date, status, updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      toast.success(`Status ${serialnumber} → ${status}`);
      await load(date);
    } catch (err) {
      toast.error(err.message || 'Gagal menyimpan status');
    } finally {
      setSavingKey('');
    }
  }, [date, load]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]">
              <Users size={21} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#0077b6]">EWS Roster</p>
              <h1 className="truncate text-base font-black text-slate-900 md:text-lg">Kehadiran &amp; Shift Operator</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <CalendarDays size={16} className="text-[#0077b6]" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-slate-800 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => load(date)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4 md:px-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="Terjadwal" value={counts.scheduled} tone="info" />
          <StatTile label="Hadir" value={counts.present} tone="good" />
          <StatTile label="Absen" value={counts.absent} tone={counts.absent > 0 ? 'bad' : 'good'} />
          <StatTile label="Berjalan" value={counts.in_progress} tone="neutral" />
          <StatTile label="Izin/Cuti/Sakit" value={counts.excused} tone="neutral" />
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-extrabold text-slate-900">Roster {date}</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{rows.length} operator</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[#90e0ef]" style={{ background: '#caf0f8' }}>
                <tr className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                  <th className="px-3 py-2">Operator</th>
                  <th className="px-3 py-2">Shift</th>
                  <th className="px-3 py-2 text-right">Jam</th>
                  <th className="px-3 py-2 text-center">Kehadiran</th>
                  <th className="px-3 py-2">Status (foreman)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-xs font-bold text-slate-400">Memuat…</td></tr>
                )}
                {!isLoading && rows.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-xs font-bold text-slate-500">Tidak ada roster untuk tanggal ini (mungkin Minggu/belum di-generate).</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.serialnumber} className="align-middle transition hover:bg-[#caf0f8]/25">
                    <td className="px-3 py-2">
                      <div className="font-bold text-slate-800">{r.operator_name || r.serialnumber}</div>
                      <div className="font-mono text-[11px] text-slate-400">{r.serialnumber}</div>
                    </td>
                    <td className="px-3 py-2"><ShiftBadge shift={r.scheduled_shift} /></td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-slate-700">
                      {Number(r.recorded_hours).toFixed(1)} / {Number(r.scheduled_standard_hours).toFixed(0)}h
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${ATTEND_STYLE[r.attendance] || ATTEND_STYLE.OFF}`}>
                        {r.attendance}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={STATUS_OPTIONS.includes(r.status) ? r.status : 'SCHEDULED'}
                        disabled={savingKey === r.serialnumber}
                        onChange={(e) => changeStatus(r.serialnumber, e.target.value)}
                        className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] disabled:opacity-50"
                      >
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-[11px] font-semibold text-slate-400">
          Operator terjadwal tanpa log dihitung <b>Absen</b> (0) di KPI Adoption. Tandai <b>Cuti/Sakit/Izin/Off</b> agar dikecualikan dari perhitungan.
        </p>
      </main>
    </div>
  );
}

export default EwsRosterPage;
