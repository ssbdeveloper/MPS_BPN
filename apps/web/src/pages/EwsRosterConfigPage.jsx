import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarCog, Save, Users, Wand2 } from 'lucide-react';
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
                          className={`inline-flex min-h-[32px] min-w-[64px] items-center justify-center rounded-lg border px-3 text-xs font-extrabold transition active:scale-95 ${
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
            <button type="button" onClick={assignGroup} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0096c7] px-4 text-sm font-extrabold text-white hover:bg-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95">
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
            <button type="button" onClick={runGenerate} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0096c7] px-4 text-sm font-extrabold text-white hover:bg-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95">
              <Wand2 size={15} /> Generate
            </button>
          </div>
          <p className="mt-2 text-[11px] font-semibold text-slate-400">Forward-only: baris yang sudah ada (termasuk status manual foreman) tidak ditimpa.</p>
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
