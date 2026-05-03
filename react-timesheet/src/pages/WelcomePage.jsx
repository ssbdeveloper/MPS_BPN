import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
  User,
} from 'lucide-react';
import teamImage from '../assets/teamklu.png';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function apiUrl(path) {
  return `${API_BASE.replace(/\/$/, '')}${path}`;
}

export default function WelcomePage() {
  const navigate = useNavigate();
  const [showLoginPanel, setShowLoginPanel] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = useMemo(() => username.trim() && password, [password, username]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit || loading) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Username atau password tidak sesuai');
      }

      sessionStorage.setItem('isVerified', 'true');
      sessionStorage.setItem('authUser', JSON.stringify(payload.user));
      toast.success(`Selamat datang, ${payload.user?.name || payload.user?.username || username.trim()}`);
      navigate('/operations-hub', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#edf3f0] text-slate-950">
      <div
        className="absolute inset-0 opacity-[0.08] grayscale"
        style={{
          backgroundImage: `url(${teamImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,150,199,0.22),transparent_34%),linear-gradient(135deg,rgba(241,245,249,0.92),rgba(229,246,243,0.96)_46%,rgba(255,255,255,0.9))]" aria-hidden="true" />

      <section className="relative grid min-h-dvh grid-cols-1 lg:grid-cols-[1.12fr_0.88fr]">
        <div className="relative hidden min-h-dvh overflow-hidden lg:block">
          <img
            src={teamImage}
            alt="MPS team"
            className="h-full w-full object-cover grayscale-[18%]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/40 via-slate-900/18 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-slate-950/72 via-slate-950/16 to-transparent" />
          <div className="absolute left-10 top-10 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/92 text-[#0077b6] shadow-xl shadow-slate-950/10">
              <ShieldCheck size={25} />
            </div>
            <div>
              <p className="text-lg font-black tracking-wide text-white">MPS</p>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/70">Operations</p>
            </div>
          </div>
          <div className="absolute bottom-12 left-10 max-w-xl">
            <h1 className="max-w-[13ch] text-5xl font-black leading-[0.98] tracking-normal text-white">
              Selamat Datang di MPS Control
            </h1>
            <p className="mt-5 max-w-md text-sm font-medium leading-6 text-white/78">
              Akses terpusat untuk operations, validation, machine hours, dan production records.
            </p>
          </div>
        </div>

        <div className="flex min-h-dvh items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
          <div className="w-full max-w-md">
            <div className="mb-7 flex items-center gap-3 lg:hidden">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0096c7] text-white shadow-lg shadow-cyan-700/20">
                <ShieldCheck size={23} />
              </div>
              <div>
                <p className="text-lg font-black text-slate-950">MPS</p>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Operations</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/82 shadow-2xl shadow-slate-900/12 backdrop-blur-xl">
              {!showLoginPanel ? (
                <div className="px-7 py-8">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#e8f7fb] text-[#0077b6]">
                    <User size={31} />
                  </div>
                  <div className="mt-5 text-center">
                    <h2 className="text-2xl font-black tracking-normal text-slate-950">Pilih Akses</h2>
                    <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
                      Masuk ke timesheet operator atau login untuk membuka modul admin.
                    </p>
                  </div>

                  <div className="mt-7 space-y-3">
                    <button
                      type="button"
                      onClick={() => navigate('/login-timesheet')}
                      className="flex h-[52px] w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 text-left text-sm font-extrabold text-slate-800 shadow-sm transition hover:border-[#90e0ef] hover:bg-cyan-50/60 active:scale-[0.99]"
                    >
                      <span>Masuk Timesheet</span>
                      <ArrowRight className="h-4 w-4 text-[#0077b6]" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowLoginPanel(true)}
                      className="flex h-[52px] w-full items-center justify-between rounded-2xl bg-[#0077b6] px-5 text-left text-sm font-extrabold text-white shadow-lg shadow-cyan-700/20 transition hover:bg-[#023e8a] active:scale-[0.99]"
                    >
                      <span>Login</span>
                      <Lock className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="border-b border-slate-200/80 px-7 pb-6 pt-7 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#e8f7fb] text-[#0077b6]">
                      <User size={31} />
                    </div>
                    <h2 className="mt-5 text-2xl font-black tracking-normal text-slate-950">Login</h2>
                    <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
                      Masukkan username dan password untuk membuka modul admin.
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4 px-7 py-7">
                    <label className="block">
                      <span className="mb-2 block text-xs font-extrabold uppercase tracking-wide text-slate-500">
                        Username
                      </span>
                      <span className="relative block">
                        <User className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                          type="text"
                          value={username}
                          onChange={(event) => {
                            setUsername(event.target.value);
                            setError('');
                          }}
                          className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-11 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#00b4d8] focus:ring-4 focus:ring-cyan-100"
                          placeholder="username"
                          autoComplete="username"
                        />
                      </span>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-xs font-extrabold uppercase tracking-wide text-slate-500">
                        Password
                      </span>
                      <span className="relative block">
                        <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(event) => {
                            setPassword(event.target.value);
                            setError('');
                          }}
                          className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-11 pr-12 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#00b4d8] focus:ring-4 focus:ring-cyan-100"
                          placeholder="Password"
                          autoComplete="current-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                        >
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </span>
                    </label>

                    {error && (
                      <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm font-semibold text-red-700">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={!canSubmit || loading}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#0077b6] px-5 text-sm font-extrabold text-white shadow-lg shadow-cyan-700/20 transition hover:bg-[#023e8a] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                      Login
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
