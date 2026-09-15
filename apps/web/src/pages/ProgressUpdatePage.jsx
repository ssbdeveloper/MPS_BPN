import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, FolderKanban, Layers3, RefreshCw, Search, Settings2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { goBackOrFallback } from '../utils/navigation';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import { API_BASE, ProgressBar, SubOperationPanel, SubTaskImportButton, SubTaskTemplateLink } from '../features/progress';

const MotionDiv = motion.div;
const PAGE_LIMIT = 50;
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];
const collapse = { initial: { height: 0, opacity: 0 }, animate: { height: 'auto', opacity: 1 }, exit: { height: 0, opacity: 0 } };

const countOperations = (project) => (project.units || []).reduce((sum, unit) => sum + (unit.operations || []).length, 0);
const number = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('id-ID', { maximumFractionDigits: 1 }) : '—';
const MetaText = ({ children }) => <span className="mt-0.5 block truncate text-[11px] text-slate-500 sm:text-xs">{children}</span>;

function ProgressSummary({ value, label }) {
  return (
    <div className="w-24 shrink-0 sm:w-40">
      <span className="mb-1 hidden text-xs font-semibold uppercase tracking-wide text-slate-400 sm:block">{label}</span>
      <ProgressBar value={value} />
    </div>
  );
}

function OutlineButton({ expanded, icon, title, meta, progress, onClick, level }) {
  const project = level === 'project';
  return (
    <button type="button" aria-expanded={expanded} onClick={onClick} className={`flex min-h-[52px] w-full items-center gap-2 px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b4d8] motion-reduce:transition-none sm:min-h-[58px] sm:gap-3 sm:px-4 sm:py-2.5 ${project ? 'bg-sky-50 hover:bg-sky-100' : 'border-t border-slate-200 bg-white hover:bg-slate-50'}`}>
      <ChevronRight size={15} className={`shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none sm:h-[17px] sm:w-[17px] ${expanded ? 'rotate-90 text-[#0077b6]' : ''}`} />
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors sm:h-8 sm:w-8 ${project ? 'bg-[#0077b6] text-white' : 'bg-slate-100 text-slate-500'}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`${project ? 'text-[13px] font-extrabold text-slate-900 sm:text-sm' : 'text-[13px] font-bold text-slate-800 sm:text-sm'} block truncate`}>{title}</span>
        <MetaText>{meta}</MetaText>
      </span>
      <ProgressSummary value={progress} label="Progress" />
    </button>
  );
}

function OperationRow({ operation, expanded, state, onToggle, onRefresh }) {
  const reduce = useReducedMotion();
  const subtasks = state?.list || operation.subtasks || [];
  const loading = state?.loading;
  return (
    <div className="border-t border-slate-100 bg-white">
      <button type="button" aria-expanded={expanded} onClick={onToggle} className="grid min-h-[44px] w-full grid-cols-[auto_minmax(0,1fr)_56px_120px_auto] items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-sky-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b4d8] motion-reduce:transition-none sm:grid-cols-[auto_minmax(0,1fr)_80px_170px_auto] sm:gap-3 sm:px-4 sm:py-2.5">
        <ChevronRight size={14} className={`ml-5 shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none sm:ml-8 sm:h-4 sm:w-4 ${expanded ? 'rotate-90 text-[#0077b6]' : ''}`} />
        <span className="min-w-0 border-l-2 border-sky-300 pl-2 sm:pl-3">
          <span className="block truncate text-[13px] font-bold text-slate-800 sm:text-sm">{operation.operation_text || 'SAP Operation'}</span>
          <MetaText>{operation.order_no} · Op {operation.operation_no}{operation.workcenter ? ` · ${operation.workcenter}` : ''}</MetaText>
        </span>
        <span className="text-center text-[11px] font-semibold tabular-nums text-slate-600 sm:text-xs">{number(operation.plan_hours)}</span>
        <ProgressBar value={operation.progress_pct} />
        <span className="min-w-[50px] text-right text-[11px] font-semibold text-slate-500 sm:min-w-[74px] sm:text-xs">{loading ? 'Loading…' : `${subtasks.length} tasks`}</span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <MotionDiv {...(reduce ? {} : collapse)} transition={{ duration: 0.16 }} className="overflow-hidden">
            <SubOperationPanel
              idsow={operation.idsow}
              operationNo={operation.operation_no}
              partNumber={operation.part_number}
              operationText={operation.operation_text}
              state={state || { list: subtasks, loading: false, error: '' }}
              onRefresh={onRefresh}
            />
          </MotionDiv>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ProgressUpdatePage() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total_projects: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openProjects, setOpenProjects] = useState(new Set());
  const [openUnits, setOpenUnits] = useState(new Set());
  const [openOperations, setOpenOperations] = useState(new Set());
  const [subState, setSubState] = useState({});
  const abortRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (page = 1) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status, page: String(page), limit: String(PAGE_LIMIT) });
      if (query) params.set('q', query);
      const response = await fetch(`${API_BASE}/dashboard/manufacturing-order-progress?${params}`, { signal: abortRef.current.signal });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      setProjects(Array.isArray(payload.data) ? payload.data : []);
      setPagination(payload.pagination || { page, total_projects: 0 });
    } catch (err) {
      if (err.name !== 'AbortError') setError('Failed to load progress hierarchy.');
    } finally {
      setLoading(false);
    }
  }, [query, status]);

  useEffect(() => { load(1); return () => abortRef.current?.abort(); }, [load]);

  const loadSubtasks = useCallback(async (operation) => {
    const id = operation.idsow;
    setSubState((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), list: prev[id]?.list || operation.subtasks || [], loading: true, error: '' } }));
    try {
      const response = await fetch(`${API_BASE}/sow/operations/${id}/subtasks`);
      if (!response.ok) throw new Error();
      const list = await response.json();
      setSubState((prev) => ({ ...prev, [id]: { list: Array.isArray(list) ? list : [], loading: false, error: '' } }));
    } catch {
      setSubState((prev) => ({ ...prev, [id]: { list: prev[id]?.list || [], loading: false, error: 'Failed to load sub-tasks' } }));
    }
  }, []);

  const toggle = (setter, key) => setter((previous) => {
    const next = new Set(previous);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const toggleOperation = (operation) => {
    const opening = !openOperations.has(operation.idsow);
    toggle(setOpenOperations, operation.idsow);
    if (opening && !subState[operation.idsow]) loadSubtasks(operation);
  };

  const operations = useMemo(() => projects.reduce((sum, project) => sum + countOperations(project), 0), [projects]);
  const busy = loading || Object.values(subState).some((state) => state.loading);
  const refresh = () => {
    load(pagination.page || 1);
    for (const project of projects) for (const unit of project.units || []) for (const operation of unit.operations || []) {
      if (openOperations.has(operation.idsow)) loadSubtasks(operation);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <PageHeader
        title="Foreman Physical Progress"
        onBack={() => goBackOrFallback(navigate)}
        right={<>
          <SubTaskTemplateLink />
          <SubTaskImportButton onImported={refresh} />
          <button type="button" onClick={refresh} disabled={busy} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#023e8a] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"><RefreshCw size={15} className={busy ? 'animate-spin motion-reduce:animate-none' : ''} /> Refresh</button>
        </>}
      />

      <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 py-3 sm:px-4 sm:py-4 md:px-6">
        <section className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:mb-4 sm:gap-3 sm:p-3">
          <label className="relative min-w-[200px] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project, unit, order, operation…" className="min-h-[40px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 transition-shadow focus:outline-none focus:ring-2 focus:ring-[#00b4d8] sm:min-h-[44px]" />
          </label>
          <div className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:min-h-[44px]">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatus(option.value)}
                className={`min-h-[32px] rounded-md px-2.5 text-xs font-bold transition-colors sm:min-h-[36px] sm:px-3 ${status === option.value ? 'bg-[#0077b6] text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex min-h-[40px] items-center gap-2 text-[11px] font-semibold text-slate-500 sm:min-h-[44px] sm:gap-3 sm:text-xs"><span>{pagination.total_projects || 0} projects</span><span className="text-slate-300">·</span><span>{operations} ops</span></div>
        </section>

        {loading ? (
          <div className="space-y-3"><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-16 rounded-xl" /></div>
        ) : error ? (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><span className="flex items-center gap-2"><AlertCircle size={17} />{error}</span><button type="button" onClick={() => load(1)} className="underline">Retry</button></div>
        ) : projects.length === 0 ? (
          <EmptyState icon={Settings2} title="No work found" />
        ) : (
          <div className="space-y-3">
            {projects.map((project) => {
              const projectOpen = openProjects.has(project.project_id);
              const units = project.units || [];
              return (
                <section key={project.project_id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                  <OutlineButton level="project" expanded={projectOpen} icon={<FolderKanban size={17} />} title={project.project_name} meta={`${units.length} units · ${countOperations(project)} operations`} progress={project.progress_pct} onClick={() => toggle(setOpenProjects, project.project_id)} />
                  <AnimatePresence initial={false}>
                    {projectOpen && <MotionDiv {...(reduce ? {} : collapse)} transition={{ duration: 0.16 }} className="overflow-hidden">
                      {units.map((unit) => {
                        const unitKey = `${project.project_id}:${unit.unit_key}`;
                        const unitOpen = openUnits.has(unitKey);
                        const unitOps = unit.operations || [];
                        return (
                          <div key={unitKey}>
                            <OutlineButton expanded={unitOpen} icon={<Layers3 size={16} />} title={unit.unit_name || 'No Unit'} meta={`${unitOps.length} operations`} progress={unit.progress_pct} onClick={() => toggle(setOpenUnits, unitKey)} />
                            <AnimatePresence initial={false}>
                              {unitOpen && <MotionDiv {...(reduce ? {} : collapse)} transition={{ duration: 0.16 }} className="overflow-hidden bg-white">
                                <div className="hidden grid-cols-[minmax(0,1fr)_80px_170px_74px] gap-3 border-t border-slate-100 bg-slate-50 px-4 py-1.5 pl-[76px] text-xs font-bold uppercase tracking-wide text-slate-400 lg:grid"><span>Operation</span><span className="text-center">Plan</span><span>Progress</span><span className="text-right">Tasks</span></div>
                                {unitOps.map((operation) => <OperationRow key={operation.idsow} operation={operation} expanded={openOperations.has(operation.idsow)} state={subState[operation.idsow]} onToggle={() => toggleOperation(operation)} onRefresh={() => loadSubtasks(operation)} />)}
                              </MotionDiv>}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </MotionDiv>}
                  </AnimatePresence>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
