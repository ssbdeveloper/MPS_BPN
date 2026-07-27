import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronRight,
  Clock, Cpu, Factory, Info, Loader2, RefreshCw, XCircle,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Status kiriman ke SAP — bahasa awam, warna = makna (bukan besaran).
const STATUS = {
  POSTED:  { label: 'Masuk SAP',  color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', Icon: CheckCircle2 },
  PENDING: { label: 'Menunggu',   color: '#d97706', bg: '#fffbeb', border: '#fde68a', Icon: Clock },
  POSTING: { label: 'Mengirim',   color: '#0077b6', bg: '#eff6ff', border: '#bfdbfe', Icon: Loader2 },
  FAILED:  { label: 'Gagal',      color: '#dc2626', bg: '#fef2f2', border: '#fecaca', Icon: XCircle },
  SKIPPED: { label: 'Dibatalkan', color: '#64748b', bg: '#f8fafc', border: '#e2e8f0', Icon: XCircle },
};
const stat = (s) => STATUS[s] || STATUS.SKIPPED;

function fmtH(n) {
  const v = Number(n || 0);
  if (!v) return '0';
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
}
function dayLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { wd: '', dm: iso, full: iso };
  return {
    wd: d.toLocaleDateString('id-ID', { weekday: 'short' }),
    dm: d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
    full: d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  };
}
// Tujuan konfirmasi: order+operasi (produktif) atau aktivitas non-order.
function tujuanText(b) {
  if (b.is_productive) return `Order ${b.aufnr || '—'} · Op ${b.vornr || '—'}`;
  return `Aktivitas ${b.lstar || '—'}`;
}

function StatusBadge({ status, size = 'sm' }) {
  const s = stat(status);
  const I = s.Icon;
  const spin = status === 'POSTING';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-bold ${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}
      style={{ color: s.color, background: s.bg, borderColor: s.border }}
    >
      <I size={size === 'sm' ? 12 : 14} className={spin ? 'animate-spin' : ''} /> {s.label}
    </span>
  );
}

// ── Kartu ringkasan (satu langkah alur) ──────────────────────────────────────
function StepCard({ icon, label, hours, tone, children }) {
  const Icon = icon;
  const tones = {
    blue:   { color: '#0077b6', bg: '#f0f9ff', border: '#bae6fd' },
    green:  { color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
    amber:  { color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  };
  const t = tones[tone] || tones.blue;
  return (
    <div className="flex-1 rounded-xl border px-4 py-3 shadow-sm" style={{ borderColor: t.border, background: t.bg }}>
      <div className="flex items-center gap-1.5">
        <Icon size={15} style={{ color: t.color }} />
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: t.color }}>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-slate-800">
        {fmtH(hours)} <span className="text-sm font-bold text-slate-400">jam</span>
      </div>
      {children && <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{children}</div>}
    </div>
  );
}

function ReconciliationPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Drill: tanggal terpilih (level-2) & konfirmasi terpilih (level-3).
  const [day, setDay] = useState(null);       // { date }
  const [dayData, setDayData] = useState(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [rec, setRec] = useState(null);        // { staging_id, meta }
  const [recData, setRecData] = useState(null);
  const [recLoading, setRecLoading] = useState(false);

  const load = useCallback(async (signal) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`${API_BASE}/dashboard/sap-reconciliation?${params.toString()}`, { signal });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Gagal memuat data');
      setData(payload.data || null);
      if (!from && payload.data?.range) { setFrom(payload.data.range.from); setTo(payload.data.range.to); }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Level-2: konfirmasi untuk satu tanggal.
  const openDay = useCallback(async (date) => {
    setDay({ date }); setRec(null); setRecData(null); setDayData(null); setDayLoading(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-reconciliation-day?date=${date}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Gagal memuat konfirmasi');
      setDayData(payload.data || null);
    } catch (err) { setDayData({ error: err.message, bundles: [] }); }
    finally { setDayLoading(false); }
  }, []);

  // Level-3: rekaman mesin di balik satu konfirmasi.
  const openRecord = useCallback(async (bundle) => {
    setRec({ staging_id: bundle.id, meta: bundle }); setRecData(null); setRecLoading(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-reconciliation-record?staging_id=${bundle.id}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Gagal memuat rekaman');
      setRecData(payload.data || null);
    } catch (err) { setRecData({ error: err.message, records: [] }); }
    finally { setRecLoading(false); }
  }, []);

  const f = data?.funnel;
  const act = data?.action_items || {};
  const failed = Number(act.failed_bundles) || 0;
  const stuckPending = Number(act.stuck_pending_bundles) || 0;

  // ── Breadcrumb ──
  const crumb = (
    <nav className="flex flex-wrap items-center gap-1 text-xs">
      <button
        type="button"
        onClick={() => { setDay(null); setRec(null); }}
        className={`rounded px-1.5 py-0.5 font-semibold ${day ? 'text-[#0077b6] hover:bg-slate-100' : 'text-slate-800'}`}
      >Ringkasan</button>
      {day && (
        <>
          <ChevronRight size={13} className="text-slate-300" />
          <button
            type="button"
            onClick={() => { setRec(null); }}
            className={`rounded px-1.5 py-0.5 font-semibold ${rec ? 'text-[#0077b6] hover:bg-slate-100' : 'text-slate-800'}`}
          >{dayLabel(day.date).dm}</button>
        </>
      )}
      {rec && (
        <>
          <ChevronRight size={13} className="text-slate-300" />
          <span className="px-1.5 py-0.5 font-semibold text-slate-800">{rec.meta.full_name || rec.meta.pernr}</span>
        </>
      )}
    </nav>
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {/* Header + rentang tanggal */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-slate-800">Jam Mesin → SAP</h2>
          <p className="text-xs text-slate-500">Telusuri jam mesin, apa yang sudah masuk SAP, dan mana yang belum. Klik tanggal untuk melihat rinciannya.</p>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setDay(null); setRec(null); load(); }} className="flex items-end gap-2">
          <label className="flex flex-col text-[11px] font-semibold text-slate-500">Dari
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="mt-0.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
          </label>
          <label className="flex flex-col text-[11px] font-semibold text-slate-500">Sampai
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="mt-0.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
          </label>
          <button type="submit" disabled={loading}
            className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-3 text-xs font-semibold text-white transition-all hover:bg-[#023e8a] active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Terapkan
          </button>
        </form>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-red-700"><AlertCircle size={16} /> {error}</span>
          <button type="button" onClick={() => load()} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Coba lagi</button>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200/70" />)}</div>
      ) : !f ? null : (
        <>
          {crumb}

          {/* ══ LEVEL 1: Ringkasan + daftar tanggal ══ */}
          {!day && (
            <>
              {/* Alur 3 langkah */}
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <StepCard icon={Factory} label="Jam mesin tercatat" hours={f.mch_clamped_hrs} tone="blue">
                  jam kerja mesin pada rentang ini
                </StepCard>
                <ArrowRight size={18} className="mx-auto hidden flex-shrink-0 text-slate-300 sm:block" />
                <StepCard icon={CheckCircle2} label="Sudah masuk SAP" hours={f.posted_hrs} tone="green">
                  ke order {fmtH(f.posted_order_hrs)} j · aktivitas {fmtH(f.posted_cc_hrs)} j
                </StepCard>
                <ArrowRight size={18} className="mx-auto hidden flex-shrink-0 text-slate-300 sm:block" />
                <StepCard icon={Clock} label="Belum masuk SAP" hours={f.pending_hrs + f.failed_hrs} tone="amber">
                  menunggu {fmtH(f.pending_hrs)} j{failed > 0 ? ` · gagal ${fmtH(f.failed_hrs)} j` : ''}
                </StepCard>
              </div>

              {/* Peringatan ringkas (hanya bila ada) */}
              {(failed > 0 || stuckPending > 0) && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-amber-600" />
                  <div className="text-xs leading-relaxed text-slate-700">
                    {failed > 0 && <div><b>{failed} kiriman gagal</b> — perbaiki penyebabnya lalu kirim ulang dari tab “SAP Posting”.</div>}
                    {stuckPending > 0 && (
                      <div>
                        <b>{stuckPending} kiriman menunggu</b> jamnya masih kebesaran (sinyal mesin sempat terputus).
                        Akan turun ±{fmtH(act.stuck_pending_reduction_hrs)} jam saat dikirim. Belum masuk SAP → aman.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Daftar tanggal — pintu masuk drill */}
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">Per tanggal — klik untuk rincian</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: '#caf0f8' }} className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                        <th className="px-4 py-2 font-semibold">Tanggal</th>
                        <th className="px-3 py-2 text-right font-semibold">Jam mesin</th>
                        <th className="px-3 py-2 text-right font-semibold text-emerald-700">Masuk SAP</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-700">Belum</th>
                        <th className="px-2 py-2 font-semibold" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(data.by_date || []).map((r) => {
                        const d = dayLabel(r.date);
                        const belum = r.pending_hrs + r.failed_hrs;
                        return (
                          <tr
                            key={r.date}
                            role="button"
                            tabIndex={0}
                            onClick={() => openDay(r.date)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(r.date); } }}
                            className="cursor-pointer transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                          >
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <span className="text-[11px] text-slate-400">{d.wd}</span>{' '}
                              <span className="font-semibold text-slate-800">{d.dm}</span>
                              {r.rows_stuck > 0 && (
                                <span title="Ada rekaman dengan sinyal mesin terputus" className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmtH(r.mch_clamped_hrs)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700">{r.posted_hrs > 0 ? fmtH(r.posted_hrs) : '·'}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: belum > 0.05 ? '#d97706' : '#cbd5e1' }}>{belum > 0.05 ? fmtH(belum) : '·'}</td>
                            <td className="px-2 py-2.5 text-right"><ChevronRight size={16} className="ml-auto text-slate-300" /></td>
                          </tr>
                        );
                      })}
                      {(data.by_date || []).length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400">Tidak ada data pada rentang ini.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {/* ══ LEVEL 2: Konfirmasi dalam satu tanggal ══ */}
          {day && !rec && (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                <button type="button" onClick={() => setDay(null)} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  <ArrowLeft size={13} /> Kembali
                </button>
                <h3 className="text-sm font-bold text-slate-800">{dayLabel(day.date).full}</h3>
              </div>

              {dayLoading ? (
                <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
              ) : dayData?.error ? (
                <div className="p-4 text-sm text-red-600">{dayData.error}</div>
              ) : (
                <>
                  <p className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] leading-relaxed text-slate-500">
                    Tiap baris = satu konfirmasi jam ke SAP. <b>Jam mesin</b> = aktual dari mesin sekarang; <b>Terkirim</b> = yang tercatat di SAP. Kalau berbeda, jamnya berubah setelah dirapikan.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: '#caf0f8' }} className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                          <th className="px-4 py-2 font-semibold">Operator</th>
                          <th className="px-3 py-2 font-semibold">Tujuan</th>
                          <th className="px-3 py-2 text-right font-semibold">Jam mesin</th>
                          <th className="px-3 py-2 text-right font-semibold">Terkirim</th>
                          <th className="px-3 py-2 font-semibold">Status</th>
                          <th className="px-2 py-2 font-semibold" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(dayData?.bundles || []).map((b) => {
                          const src = Number(b.source_hrs || 0);
                          const sent = Number(b.sent_hrs || 0);
                          const diff = sent - src;
                          return (
                            <tr
                              key={b.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => openRecord(b)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecord(b); } }}
                              className="cursor-pointer align-top transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                            >
                              <td className="px-4 py-2.5">
                                <div className="font-semibold text-slate-800">{b.full_name || b.pernr || '—'}</div>
                                <div className="font-mono text-[11px] text-slate-400">{b.pernr}</div>
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="text-slate-700">{tujuanText(b)}</div>
                                {b.zbarcodeid && <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{b.zbarcodeid}</span>}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-700">
                                {fmtH(src)}
                                {b.has_stuck && <span title="Sinyal mesin sempat terputus" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums">
                                <span className={diff > 0.1 ? 'font-bold text-amber-700' : 'text-slate-700'}>{fmtH(sent)}</span>
                                {diff > 0.1 && (
                                  <div className="text-[10px] font-semibold text-amber-600">
                                    {b.status === 'POSTED' ? `+${fmtH(diff)} di SAP` : `→ jadi ${fmtH(src)}`}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2.5"><StatusBadge status={b.status} /></td>
                              <td className="px-2 py-2.5 text-right"><ChevronRight size={16} className="ml-auto text-slate-300" /></td>
                            </tr>
                          );
                        })}
                        {(dayData?.bundles || []).length === 0 && (
                          <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">Tidak ada konfirmasi pada tanggal ini.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          {/* ══ LEVEL 3: Rekaman mesin di balik satu konfirmasi ══ */}
          {rec && (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                <button type="button" onClick={() => setRec(null)} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  <ArrowLeft size={13} /> Kembali
                </button>
                <h3 className="text-sm font-bold text-slate-800">{rec.meta.full_name || rec.meta.pernr}</h3>
                <StatusBadge status={rec.meta.status} />
              </div>

              {/* Ringkas kepala konfirmasi */}
              <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 text-xs sm:grid-cols-4">
                <div className="bg-white px-4 py-2.5"><div className="text-[11px] text-slate-400">Tujuan</div><div className="font-semibold text-slate-800">{tujuanText(rec.meta)}</div></div>
                <div className="bg-white px-4 py-2.5"><div className="text-[11px] text-slate-400">Aktivitas</div><div className="font-semibold text-slate-800">{rec.meta.zbarcodeid || '—'}</div></div>
                <div className="bg-white px-4 py-2.5"><div className="text-[11px] text-slate-400">Jam mesin (aktual)</div><div className="font-bold tabular-nums text-slate-800">{fmtH(rec.meta.source_hrs)} j</div></div>
                <div className="bg-white px-4 py-2.5"><div className="text-[11px] text-slate-400">Terkirim ke SAP</div><div className="font-bold tabular-nums text-slate-800">{fmtH(rec.meta.sent_hrs)} j</div></div>
              </div>

              {recLoading ? (
                <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>
              ) : recData?.error ? (
                <div className="p-4 text-sm text-red-600">{recData.error}</div>
              ) : (
                <>
                  {/* Respons SAP */}
                  {recData?.bundle?.sap_response && (
                    <div className="flex items-start gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                      <Info size={14} className="mt-0.5 flex-shrink-0 text-[#0077b6]" />
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Respons SAP</div>
                        <div className="break-words font-mono text-xs text-slate-700">{recData.bundle.sap_response}</div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 px-4 pt-3 pb-1">
                    <Cpu size={14} className="text-[#0077b6]" />
                    <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">Rekaman mesin pembentuk konfirmasi</h4>
                    <span className="text-[11px] text-slate-400">({(recData?.records || []).length})</span>
                  </div>
                  <div className="overflow-x-auto px-2 pb-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-2 py-2 font-semibold">Mesin</th>
                          <th className="px-2 py-2 font-semibold">Mulai</th>
                          <th className="px-2 py-2 font-semibold">Selesai</th>
                          <th className="px-2 py-2 text-right font-semibold">Jam terpakai</th>
                          <th className="px-2 py-2 font-semibold" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(recData?.records || []).map((m) => {
                          const trimmed = Number(m.raw_hrs) - Number(m.clamp_hrs) > 0.02;
                          return (
                            <tr key={m.proddataid} className="hover:bg-slate-50">
                              <td className="px-2 py-2 font-mono text-xs text-slate-700">{m.machineid}</td>
                              <td className="px-2 py-2 tabular-nums text-slate-600">{m.mulai}</td>
                              <td className="px-2 py-2 tabular-nums text-slate-600">{m.selesai}</td>
                              <td className="px-2 py-2 text-right tabular-nums font-semibold text-slate-800">{fmtH(m.contributed_hrs)}</td>
                              <td className="px-2 py-2">
                                {m.is_stuck ? (
                                  <span title="Sinyal mesin terputus — jam mentah dipangkas ke durasi wajar" className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                                    <AlertTriangle size={10} /> sinyal putus
                                  </span>
                                ) : trimmed ? (
                                  <span className="text-[10px] text-slate-400">dirapikan</span>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                        {(recData?.records || []).length === 0 && (
                          <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400">Tidak ada rekaman mesin.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="border-t border-slate-100 px-4 py-2 text-[11px] leading-relaxed text-slate-500">
                    “Jam terpakai” = durasi yang dihitung untuk konfirmasi ini setelah dirapikan. Baris ber-tanda
                    <span className="mx-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 align-middle text-[10px] font-bold text-amber-700"><AlertTriangle size={9} /> sinyal putus</span>
                    artinya mesin berhenti kirim data, jadi jam mentahnya dipotong ke durasi wajar.
                  </p>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default ReconciliationPanel;
