import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Loader2, RefreshCw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import EvidenceHistoryModal from '../../features/manufacturingProgress/EvidenceHistoryModal';
import ManufacturingProgressOutline from '../../features/manufacturingProgress/ManufacturingProgressOutline';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const LIMIT = 20;
const HEALTHS = ['red', 'yellow', 'green', 'unknown'];

function buildQuery(filters, page) {
  const query = new URLSearchParams({ page: String(page), limit: String(LIMIT), status: filters.status });
  if (filters.q.trim()) query.set('q', filters.q.trim());
  if (filters.dateFrom) query.set('date_from', filters.dateFrom);
  if (filters.dateTo) query.set('date_to', filters.dateTo);
  if (filters.health.length) query.set('health', filters.health.join(','));
  return query.toString();
}

export default function ManufacturingOrderProgressDashboardPage() {
  const navigate = useNavigate();
  const verified = sessionStorage.getItem('isVerified') === 'true';
  const [filters, setFilters] = useState({ q: '', dateFrom: '', dateTo: '', status: 'active', health: [] });
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total_projects: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState(null);
  const controllerRef = useRef(null);

  const load = useCallback(async (page = 1) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/dashboard/manufacturing-order-progress?${buildQuery(filters, page)}`, { signal: controller.signal });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      if (!Array.isArray(payload.data)) throw new Error();
      setProjects(payload.data);
      setPagination(payload.pagination || { page, limit: LIMIT, total_projects: payload.data.length });

    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setProjects([]);
        setError('Could not load manufacturing progress — check the connection and retry.');
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (!verified) navigate('/welcome?login=admin', { replace: true });
  }, [navigate, verified]);
  useEffect(() => {
    if (verified) load(1);
    return () => controllerRef.current?.abort();
  }, [load, verified]);

  const change = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const toggleHealth = (health) => setFilters((current) => ({
    ...current,
    health: current.health.includes(health) ? current.health.filter((item) => item !== health) : [...current.health, health],
  }));
  const totalPages = Math.max(1, Math.ceil((pagination.total_projects || 0) / (pagination.limit || LIMIT)));

  if (!verified) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-semibold text-slate-500">Redirecting to login...</div>;

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:px-6">
          <button type="button" onClick={() => navigate('/operations-hub')} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0077b6]"><ChevronLeft size={16} /> Operations Hub</button>
          <h1 className="min-w-0 truncate text-center text-xl font-extrabold text-slate-950">Manufacturing Order Progress</h1>
          <button type="button" disabled={loading} onClick={() => load(pagination.page)} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0077b6] px-4 text-xs font-extrabold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0077b6] focus-visible:ring-offset-2">{loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Refresh</button>
        </div>
      </header>
      <main className="space-y-4 px-4 py-4 md:px-6">
        <section aria-label="Progress filters" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(3,auto)] lg:items-end">
            <label className="min-w-0 text-xs font-bold text-slate-600">Search
              <span className="relative mt-1 block"><Search className="absolute left-3 top-3 text-slate-400" size={16} /><input type="search" value={filters.q} onChange={(event) => change('q', event.target.value)} placeholder="Project, unit, order, operation, issue" className="min-h-[44px] w-full rounded-lg border border-slate-200 pl-10 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0077b6]" /></span>
            </label>
            <label className="text-xs font-bold text-slate-600">Schedule from<input aria-label="Schedule from" type="date" value={filters.dateFrom} onChange={(event) => change('dateFrom', event.target.value)} className="mt-1 block min-h-[44px] rounded-lg border border-slate-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0077b6]" /></label>
            <label className="text-xs font-bold text-slate-600">Schedule to<input aria-label="Schedule to" type="date" value={filters.dateTo} onChange={(event) => change('dateTo', event.target.value)} className="mt-1 block min-h-[44px] rounded-lg border border-slate-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0077b6]" /></label>
            <label className="text-xs font-bold text-slate-600">Order status<select aria-label="Order status" value={filters.status} onChange={(event) => change('status', event.target.value)} className="mt-1 block min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0077b6]"><option value="active">Active</option><option value="completed">Completed</option><option value="all">All</option></select></label>
          </div>
          <div className="mt-3 border-t border-slate-100 pt-3">
            <fieldset className="flex flex-wrap items-center gap-3"><legend className="sr-only">Health</legend>{HEALTHS.map((health) => <label key={health} className="inline-flex min-h-[44px] items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={filters.health.includes(health)} onChange={() => toggleHealth(health)} className="h-4 w-4 accent-[#0077b6]" />{health[0].toUpperCase() + health.slice(1)}</label>)}</fieldset>
          </div>
        </section>

        {loading && projects.length === 0 ? <p className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-16 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading manufacturing progress...</p>
          : error ? <div className="rounded-xl border border-red-200 bg-white py-12 text-center"><p className="text-sm text-red-700">{error}</p><button type="button" onClick={() => load(pagination.page)} className="mt-3 min-h-[44px] rounded-lg border border-slate-200 px-4 text-sm font-bold text-[#0077b6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0077b6]">Retry</button></div>
            : projects.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-500">No projects match these filters</p>
              : <ManufacturingProgressOutline projects={projects} onEvidence={setEvidence} />}
        <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500">
          <span>Showing {projects.length} of {pagination.total_projects || 0} projects</span>
          <div className="flex items-center gap-3"><button type="button" disabled={pagination.page <= 1 || loading} onClick={() => load(pagination.page - 1)} className="min-h-[44px] rounded-lg border border-slate-200 px-3 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0077b6]">Previous</button><span>Page {pagination.page || 1} / {totalPages}</span><button type="button" disabled={pagination.page >= totalPages || loading} onClick={() => load(pagination.page + 1)} className="min-h-[44px] rounded-lg border border-slate-200 px-3 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0077b6]">Next</button></div>
        </footer>
      </main>
      {evidence && <EvidenceHistoryModal operation={evidence} onClose={() => setEvidence(null)} />}
    </div>
  );
}
