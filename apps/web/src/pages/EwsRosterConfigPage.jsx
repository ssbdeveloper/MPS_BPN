import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarCog, Save, Users, Wand2, Lock, ShieldCheck, X, Eye, Info } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const DOW = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function todayLocalISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function Card({ title, icon: Icon, children }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        {Icon ? <Icon size={16} className="text-[#0077b6]" /> : null}
        <h2 className="text-sm font-extrabold text-slate-900">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EwsRosterConfigPage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [workdays, setWorkdays] = useState([]);
  const [error, setError] = useState('');
  const [serial, setSerial] = useState('');
  const [group, setGroup] = useState('A');
  const [genFrom, setGenFrom] = useState(todayLocalISO());
  const [genTo, setGenTo] = useState(todayLocalISO(14));
  const [lockForm, setLockForm] = useState({ serial: '', shift: 'DAY', weeks: 2, from: todayLocalISO() });
  const [locks, setLocks] = useState([]);
  const [lockError, setLockError] = useState('');
  const [lockBusy, setLockBusy] = useState(false);
  const [lastLock, setLastLock] = useState(null);
  const [preview, setPreview] = useState({ open: false, loading: false, error: '', rows: [] });

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`${API_BASE}/ews/roster/config`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const payload = await res.json();
      setConfig(payload.data);
      setWorkdays(payload.data.workday_rules || []);
    } catch (err) {
      setError(err.message || 'Failed to load config');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveWorkday = useCallback(async (rule) => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster/config/workday`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      toast.success(`${DOW[rule.day_of_week]} disimpan`);
    } catch (err) {
      toast.error(err.message);
      load();
    }
  }, [load]);

  const toggle = (dow, field) => {
    setWorkdays((prev) => {
      const next = prev.map((r) => (r.day_of_week === dow ? { ...r, [field]: !r[field] } : r));
      const rule = next.find((r) => r.day_of_week === dow);
      saveWorkday({ day_of_week: dow, runs_day: rule.runs_day, runs_night: rule.runs_night });
      return next;
    });
  };

  const assignGroup = useCallback(async () => {
    if (!serial.trim()) { toast.error('Isi serialnumber'); return; }
    try {
      const res = await fetch(`${API_BASE}/ews/roster/group`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialnumber: serial.trim(), rotation_group: group, updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      toast.success(`${serial.trim()} → Grup ${group}`);
      setSerial('');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }, [serial, group, load]);

  const runGenerate = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: genFrom, to: genTo }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const payload = await res.json();
      toast.success(`Generate: ${payload.data.rows_inserted} baris baru`);
    } catch (err) {
      toast.error(err.message);
    }
  }, [genFrom, genTo]);

  const loadLocks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster/locks`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const payload = await res.json();
      setLocks(Array.isArray(payload.data) ? payload.data : []);
    } catch (err) {
      setLockError(err.message || 'Gagal memuat daftar lock');
    }
  }, []);

  useEffect(() => { loadLocks(); }, [loadLocks]);

  const saveLock = useCallback(async () => {
    setLockError('');
    const serialnumber = lockForm.serial.trim();
    const weeks = Number.parseInt(lockForm.weeks, 10);
    if (!serialnumber) { setLockError('Isi serialnumber operator'); return; }
    if (!Number.isInteger(weeks) || weeks < 1) { setLockError('Durasi minimal 1 minggu'); return; }
    setLockBusy(true);
    try {
      const res = await fetch(`${API_BASE}/ews/roster/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialnumber, locked_shift: lockForm.shift, effective_from: lockForm.from, lock_weeks: weeks, created_by: 'ews-roster-ui' }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) { setLockError(payload?.error || `Gagal (${res.status})`); return; } // 409 overlap etc. -> inline
      setLastLock(payload.data);
      toast.success(`Lock ${serialnumber} → ${lockForm.shift} tersimpan`);
      setLockForm((f) => ({ ...f, serial: '' }));
      loadLocks();
    } catch (err) {
      setLockError(err.message || 'Gagal menyimpan lock');
    } finally {
      setLockBusy(false);
    }
  }, [lockForm, loadLocks]);

  const cancelLock = useCallback(async (id) => {
    setLockError('');
    try {
      const res = await fetch(`${API_BASE}/ews/roster/lock/${id}/cancel`, { method: 'POST' });
      const payload = await res.json().catch(() => null);
      if (!res.ok) { setLockError(payload?.error || `Gagal batalkan (${res.status})`); return; }
      toast.success('Lock dibatalkan');
      setLastLock((prev) => (prev?.id === id ? null : prev));
      loadLocks();
    } catch (err) {
      setLockError(err.message || 'Gagal membatalkan lock');
    }
  }, [loadLocks]);

  const loadPreview = useCallback(async () => {
    setPreview((p) => ({ ...p, open: true, loading: true, error: '' }));
    try {
      const dates = Array.from({ length: 7 }, (_, i) => todayLocalISO(i));
      const rows = await Promise.all(dates.map(async (d) => {
        const res = await fetch(`${API_BASE}/ews/roster?date=${d}`);
        if (!res.ok) throw new Error(`Roster ${d} gagal (${res.status})`);
        const payload = await res.json();
        const sched = (Array.isArray(payload.data) ? payload.data : []).filter((r) => r.status === 'SCHEDULED');
        const hasLock = locks.some((lk) => !lk.cancelled_at && d >= lk.effective_from && d < lk.lock_end);
        return {
          date: d,
          day: sched.filter((r) => r.scheduled_shift === 'DAY').length,
          night: sched.filter((r) => r.scheduled_shift === 'NIGHT').length,
          total: sched.length,
          hasLock,
        };
      }));
      setPreview({ open: true, loading: false, error: '', rows });
    } catch (err) {
      setPreview({ open: true, loading: false, error: err.message || 'Gagal memuat preview', rows: [] });
    }
  }, [locks]);

  const rc = config?.rotation_config;
  const groupCounts = Object.fromEntries((config?.group_counts || []).map((g) => [g.rotation_group, g.n]));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => navigate('/ews/roster')}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]">
            <CalendarCog size={21} />
          </div>
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#0077b6]">EWS Roster</p>
            <h1 className="text-base font-black text-slate-900 md:text-lg">Konfigurasi Rotasi &amp; Shift</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-4 md:px-6">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

        <div className="flex items-start gap-2.5 rounded-xl border border-[#90e0ef] bg-[#caf0f8] px-4 py-3 text-xs text-slate-700 md:text-sm">
          <Info size={18} className="mt-0.5 flex-shrink-0 text-[#0077b6]" />
          <p>
            <b>Hari Kerja</b> &amp; <b>Grup</b> berlaku <b>setelah Generate</b> (forward-only — baris roster yang sudah ada tidak berubah).{' '}
            <b>Shift-Lock</b> jalur terpisah: langsung berlaku <b>tanpa perlu generate</b>.
          </p>
        </div>

        <Card title="Hari Kerja per Shift" icon={CalendarCog}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-1 text-left">Hari</th>
                  <th className="px-2 py-1 text-center">Shift Day</th>
                  <th className="px-2 py-1 text-center">Shift Night</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workdays.map((r) => (
                  <tr key={r.day_of_week}>
                    <td className="px-2 py-2 font-bold text-slate-700">{DOW[r.day_of_week]}</td>
                    {['runs_day', 'runs_night'].map((f) => (
                      <td key={f} className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggle(r.day_of_week, f)}
                          className={`inline-flex min-h-[44px] min-w-[64px] items-center justify-center rounded-lg border px-3 text-xs font-extrabold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
                            r[f] ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-400'
                          }`}
                        >
                          {r[f] ? 'ON' : 'OFF'}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] font-semibold text-slate-400">Perubahan tersimpan otomatis. Berlaku untuk roster yang di-generate setelah ini (forward-only).</p>
        </Card>

        <Card title="Penugasan Grup Operator" icon={Users}>
          <div className="mb-3 flex gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-extrabold text-slate-600">Grup A: {groupCounts.A ?? 0}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-extrabold text-slate-600">Grup B: {groupCounts.B ?? 0}</span>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="Serialnumber operator"
              className="min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
            />
            <select value={group} onChange={(e) => setGroup(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#00b4d8]">
              <option value="A">Grup A</option>
              <option value="B">Grup B</option>
            </select>
            <button type="button" onClick={assignGroup} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95">
              <Save size={15} /> Simpan
            </button>
          </div>
        </Card>

        <Card title="Generate Roster" icon={Wand2}>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold text-slate-600">Dari
              <input type="date" value={genFrom} onChange={(e) => setGenFrom(e.target.value)} className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
            </label>
            <label className="text-xs font-bold text-slate-600">Sampai
              <input type="date" value={genTo} onChange={(e) => setGenTo(e.target.value)} className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
            </label>
            <button type="button" onClick={runGenerate} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95">
              <Wand2 size={15} /> Generate
            </button>
          </div>
          <p className="mt-2 text-[11px] font-semibold text-slate-400">Forward-only: baris yang sudah ada (termasuk status manual foreman) tidak ditimpa.</p>
        </Card>

        <Card title="Shift-Lock (kunci DAY/NIGHT)" icon={Lock}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-[200px] flex-1 flex-col gap-1">
              <label htmlFor="lock-serial" className="text-xs font-bold text-slate-600">Operator</label>
              <input
                id="lock-serial"
                value={lockForm.serial}
                onChange={(e) => setLockForm((f) => ({ ...f, serial: e.target.value }))}
                placeholder="Serialnumber operator"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="lock-shift" className="text-xs font-bold text-slate-600">Shift</label>
              <select id="lock-shift" value={lockForm.shift} onChange={(e) => setLockForm((f) => ({ ...f, shift: e.target.value }))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#00b4d8]">
                <option value="DAY">DAY</option>
                <option value="NIGHT">NIGHT</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="lock-from" className="text-xs font-bold text-slate-600">Mulai</label>
              <input id="lock-from" type="date" value={lockForm.from} min={todayLocalISO()} onChange={(e) => setLockForm((f) => ({ ...f, from: e.target.value }))}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="lock-weeks" className="text-xs font-bold text-slate-600">Durasi (minggu)</label>
              <input id="lock-weeks" type="number" min={1} value={lockForm.weeks} onChange={(e) => setLockForm((f) => ({ ...f, weeks: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
            </div>
            <button type="button" onClick={saveLock} disabled={lockBusy}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
              <Save size={15} /> {lockBusy ? 'Menyimpan…' : 'Kunci'}
            </button>
          </div>

          {lockError && (
            <div className="mt-2 rounded-lg border border-red-400 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600" role="alert">{lockError}</div>
          )}
          {lastLock && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
              <ShieldCheck size={14} /> {lastLock.serialnumber} kebal rotasi ({lastLock.locked_shift}) s/d {lastLock.lock_end}
            </div>
          )}

          <div className="mt-3">
            <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Lock Aktif</div>
            {locks.length === 0 ? (
              <div className="text-xs text-slate-400">Belum ada lock aktif.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {locks.map((lk) => {
                  const started = lk.effective_from < todayLocalISO();
                  return (
                    <li key={lk.id} className="flex items-center justify-between gap-2 py-2">
                      <div className="text-xs">
                        <span className="font-mono font-bold text-slate-800">{lk.serialnumber}</span>
                        <span className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${lk.locked_shift === 'DAY' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>{lk.locked_shift}</span>
                        <span className="ml-2 tabular-nums text-slate-500">{lk.effective_from} → {lk.lock_end}</span>
                        {started && <span className="ml-2 text-[10px] font-bold text-slate-400">(berjalan)</span>}
                      </div>
                      <button type="button" onClick={() => cancelLock(lk.id)} disabled={started}
                        title={started ? 'Sudah berjalan — tak bisa dibatalkan (forward-only)' : 'Batalkan lock'}
                        aria-label={`Batalkan lock ${lk.serialnumber}`}
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-red-50 hover:border-red-300 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-slate-200 disabled:hover:text-slate-600">
                        <X size={16} strokeWidth={2.5} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="mt-2 text-[11px] font-semibold text-slate-400">Lock forward-only (mulai ≥ hari ini) &amp; tak boleh tumpang tindih. Habis di batas minggu (konsisten flip). Efek ke jadwal &amp; adoption aktif setelah backend ter-deploy.</p>
        </Card>

        <Card title="Preview Komposisi Shift (7 hari)" icon={Eye}>
          <button type="button" onClick={loadPreview} disabled={preview.loading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
            <Eye size={15} /> {preview.loading ? 'Memuat…' : 'Muat preview'}
          </button>
          {preview.error && <div className="mt-2 rounded-lg border border-red-400 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600" role="alert">{preview.error}</div>}
          {preview.open && !preview.loading && !preview.error && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1 text-left">Tanggal</th>
                    <th className="px-2 py-1 text-center">DAY</th>
                    <th className="px-2 py-1 text-center">NIGHT</th>
                    <th className="px-2 py-1 text-center">Total</th>
                    <th className="px-2 py-1 text-left">Catatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.rows.map((r) => (
                    <tr key={r.date} className={r.hasLock ? 'bg-amber-50/40' : ''}>
                      <td className="px-2 py-2 font-semibold text-slate-700">{DOW[new Date(`${r.date}T00:00:00`).getDay()]} {r.date.slice(5)}</td>
                      <td className="px-2 py-2 text-center tabular-nums font-bold text-amber-700">{r.day}</td>
                      <td className="px-2 py-2 text-center tabular-nums font-bold text-indigo-700">{r.night}</td>
                      <td className="px-2 py-2 text-center tabular-nums text-slate-600">{r.total}</td>
                      <td className="px-2 py-2 text-left">
                        {r.total === 0
                          ? <span className="text-[11px] text-slate-400">libur</span>
                          : r.hasLock
                            ? <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">crew campur (lock aktif)</span>
                            : <span className="text-[11px] text-slate-400">normal</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] font-semibold text-slate-400">Split dihitung dari roster efektif. "Crew campur" = ada lock aktif hari itu (operator terkunci lepas dari shift crew-nya — edge 2). Efek lock tampak setelah backend ter-deploy.</p>
            </div>
          )}
        </Card>

        <Card title="Definisi Shift & Rotasi (read-only)" icon={CalendarCog}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Shift</div>
              {(config?.shifts || []).map((s) => (
                <div key={s.shift_code} className="text-sm text-slate-700">
                  <b>{s.shift_code}</b> {s.start_time}–{s.end_time} · {s.standard_hours}h{s.crosses_midnight ? ' · lintas tengah malam' : ''}
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Rotasi</div>
              {rc ? (
                <div className="text-sm text-slate-700">
                  Anchor <b>{rc.anchor_week_start}</b> (Grup A = {rc.anchor_group_a_shift}) · flip tiap {rc.rotation_period_weeks} minggu
                </div>
              ) : <div className="text-sm text-slate-400">—</div>}
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}

export default EwsRosterConfigPage;
