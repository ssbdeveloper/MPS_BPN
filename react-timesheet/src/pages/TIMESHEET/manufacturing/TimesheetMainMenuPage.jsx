import { createElement, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  LogOut,
  RefreshCw,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const readSessionJson = (key, fallback = {}) => {
  try {
    return JSON.parse(sessionStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

const StatPill = ({ label, value }) => (
  <div
    className="rounded-xl border px-3 py-2"
    style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
  >
    <p className="text-[10px] font-bold uppercase text-slate-500">{label}</p>
    <p className="mt-1 truncate text-xs font-extrabold text-slate-800">{value || '-'}</p>
  </div>
);

const ActionButton = ({ icon: Icon, label, helper, tone = 'primary', onClick }) => {
  const classes = tone === 'outline'
    ? 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
    : tone === 'success'
      ? 'bg-emerald-600 text-white hover:bg-emerald-500'
      : 'bg-[#0096c7] text-white hover:bg-[#0077b6]';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[96px] flex-col items-start justify-between rounded-xl px-4 py-3 text-left font-bold transition-all duration-150 active:scale-95 ${classes}`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20">
        {createElement(Icon, { size: 22 })}
      </span>
      <span>
        <span className="block text-sm font-extrabold">{label}</span>
        <span className={`mt-1 block text-xs font-semibold ${tone === 'outline' ? 'text-slate-500' : 'text-white/80'}`}>
          {helper}
        </span>
      </span>
    </button>
  );
};

export default function ManufacturingTimesheetMainMenuPage() {
  const navigate = useNavigate();

  const userData = useMemo(() => {
    const employee = readSessionJson('datakaryawan');
    const activity = readSessionJson('selectedactivity');

    return {
      name: employee.full_name || '-',
      sn: employee.snssb || '-',
      workcenter: employee.workcenter || '-',
      machine: employee.machinename || '-',
      order: activity.order || activity.order_no || '-',
      operation: activity.operationtext || activity.operation_text || '-',
    };
  }, []);

  const handleCheckIn = () => {
    toast.info('Flow check-in manufacturing akan dibuat di tahap berikutnya');
    navigate('/select-job');
  };

  const handleCheckOut = async () => {
    const employee = readSessionJson('datakaryawan');

    if (!employee.snssb) {
      toast.error('Data karyawan tidak ditemukan');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/timesheet/checkout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datakaryawan: { sn: employee.snssb } }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Gagal checkout timesheet');
      }

      toast.success('Timesheet berhasil checkout');
      navigate('/login-timesheet');
    } catch (err) {
      toast.error('Checkout gagal', { description: err.message });
    }
  };

  const handleOpenMsProject = () => {
    toast.info('Halaman MS Project manufacturing akan ditambahkan setelah flow final');
  };

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-slate-50">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm md:px-6">
        <button
          type="button"
          onClick={() => navigate('/login-timesheet')}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-95"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="text-center">
          <p className="text-sm font-extrabold text-slate-800 md:text-base">Manufacturing Timesheet</p>
          <p className="text-[10px] font-bold uppercase text-slate-500">Check-in / Check-out</p>
        </div>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-95"
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-3 md:px-6 md:py-4">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-extrabold text-slate-800">{userData.name}</p>
              <p className="mt-0.5 font-mono text-xs font-semibold text-slate-500">{userData.sn}</p>
            </div>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              Manufacturing
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatPill label="Work Center" value={userData.workcenter} />
            <StatPill label="Machine" value={userData.machine} />
            <StatPill label="Order" value={userData.order} />
            <StatPill label="Operation" value={userData.operation} />
          </div>
        </section>

        <section className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <ActionButton
            icon={CheckCircle2}
            label="Check In"
            helper="Mulai pekerjaan"
            onClick={handleCheckIn}
          />
          <ActionButton
            icon={LogOut}
            label="Check Out"
            helper="Akhiri pekerjaan"
            tone="success"
            onClick={handleCheckOut}
          />
          <ActionButton
            icon={BriefcaseBusiness}
            label="Select Work Order"
            helper="Pilih order"
            tone="outline"
            onClick={() => navigate('/select-job')}
          />
          <ActionButton
            icon={CalendarClock}
            label="MS Project"
            helper="Planning sync"
            tone="outline"
            onClick={handleOpenMsProject}
          />
        </section>

        <section className="mt-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-50 text-[#0077b6]">
              <ClipboardList size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-800">Manufacturing mode aktif</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">
                Halaman ini adalah contoh variant frontend. Backend dan database tetap shared.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
