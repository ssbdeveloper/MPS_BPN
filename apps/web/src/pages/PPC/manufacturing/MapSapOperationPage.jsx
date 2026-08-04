import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronRight, FolderSearch,
  GitBranch, GripVertical, ListTree, Loader2, PackageOpen, RotateCw, Target, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, SearchInput, Skeleton, SkeletonRow } from '../../../components';
import {
  fetchMsProjects,
  fetchMsProjectTasks,
  fetchSowOrderOperations,
  fetchSowOrders,
  mapSowOrderToProjectTasks,
} from '../../../services/msProjectService';

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return '-';
  return `${hours.toLocaleString('en-GB', { maximumFractionDigits: 2 })}h`;
}

function formatHoursFromMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return '-';
  return `${(minutes / 60).toLocaleString('en-GB', { maximumFractionDigits: 2 })}h`;
}

function operationSortValue(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function compareOperationRows(a, b) {
  const operationDiff = operationSortValue(a.operation_no) - operationSortValue(b.operation_no);
  if (operationDiff !== 0) return operationDiff;
  const operationTextDiff = String(a.operation_no || '').localeCompare(String(b.operation_no || ''), undefined, { numeric: true });
  if (operationTextDiff !== 0) return operationTextDiff;
  return String(a.outline_number || '').localeCompare(String(b.outline_number || ''), undefined, { numeric: true });
}

function sortByOperationNo(rows = []) {
  return [...rows].sort(compareOperationRows);
}

function compareOutlineNumber(a, b) {
  return String(a.outline_number || '').localeCompare(String(b.outline_number || ''), undefined, { numeric: true });
}

function buildTaskTree(tasks = []) {
  const byParent = new Map();
  const byId = new Map();
  tasks.forEach((task) => {
    byId.set(task.task_id, task);
    const key = task.parent_task_id || '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(task);
  });

  byParent.forEach((items) => items.sort(compareOutlineNumber));
  const roots = (byParent.get('__root__') || [])
    .concat(tasks.filter((task) => task.parent_task_id && !byId.has(task.parent_task_id)))
    .filter((task, index, rows) => rows.findIndex((row) => row.task_id === task.task_id) === index)
    .sort(compareOutlineNumber);

  return { roots, byParent };
}

function projectStatusClass(project) {
  if (project.checked_out_by) return 'border-amber-200 bg-amber-50 text-amber-700';
  if (String(project.status || '').toUpperCase() === 'ACTIVE') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-100 text-slate-600';
}

/** Inline error + retry — dipakai per panel fetch (bukan toast). */
function PanelError({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <AlertTriangle className="h-8 w-8 text-red-400" strokeWidth={1.5} />
      <p className="max-w-xs text-xs text-red-600">{message || 'Failed to load data.'}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
      >
        <RotateCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

/** Satu langkah pada stepper alur klik terpandu. */
function Step({ n, label, value, done, mono }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${done ? 'bg-[#0077b6] text-white' : 'bg-slate-100 text-slate-500'}`}>
        {done ? <Check className="h-3.5 w-3.5" /> : n}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`block max-w-[200px] truncate text-xs font-semibold ${done ? 'text-slate-800' : 'text-slate-400'} ${mono ? 'font-mono tabular-nums' : ''}`}>
          {value || 'Not selected'}
        </span>
      </span>
    </li>
  );
}

function StatusBadge({ project }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${projectStatusClass(project)}`}>
      {project.checked_out_by ? 'Checked Out' : project.status || 'Draft'}
    </span>
  );
}

function ProjectCard({ project, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(project)}
      className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-all hover:border-[#90e0ef] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
        selected ? 'border-[#0077b6] ring-2 ring-[#90e0ef]' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-slate-800">{project.project_name || '-'}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{project.description || 'No description'}</p>
        </div>
        <StatusBadge project={project} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold tabular-nums">Rev {project.revision_no || 0}</span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">{formatDate(project.updated_at)}</span>
      </div>
    </button>
  );
}

function TaskRow({ task }) {
  return (
    <div className="grid grid-cols-[minmax(160px,1fr)_84px_92px_64px] items-center gap-3 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-slate-600">
          {task.outline_number || '-'}
        </span>
        <span className="truncate font-bold text-slate-800">{task.task_name || '-'}</span>
      </div>
      <span className="truncate font-mono text-xs font-bold tabular-nums text-slate-600">{task.order_no || '-'}</span>
      <span className="truncate font-mono text-xs font-bold tabular-nums text-[#0077b6]">{task.operation_no || '-'}</span>
      <span className="text-right text-xs font-semibold tabular-nums text-slate-500">{formatHoursFromMinutes(task.planned_work_minutes)}</span>
    </div>
  );
}

/**
 * TaskTreeNode — chevron & target dipisah TEGAS:
 *   • chevron (kiri) = expand/collapse saja.
 *   • klik nama / tombol Target = jadikan target parent (tanpa efek expand).
 */
function TaskTreeNode({ task, childrenByParent, expandedIds, selectedId, onToggle, onSetTarget, depth = 0 }) {
  const children = childrenByParent.get(task.task_id) || [];
  const expanded = expandedIds.has(task.task_id);
  const selected = selectedId === task.task_id;
  const hasChildren = children.length > 0;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 border-b border-slate-100 pr-2 transition-colors ${
          selected ? 'bg-[#caf0f8]/70' : 'bg-white hover:bg-slate-50'
        }`}
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(task.task_id)}
            aria-label={expanded ? 'Collapse branch' : 'Expand branch'}
            aria-expanded={expanded}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b4d8]"
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''} motion-reduce:transition-none`} />
          </button>
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          </span>
        )}

        <button
          type="button"
          onClick={() => onSetTarget(task)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b4d8]"
        >
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-slate-600">
            {task.outline_number || '-'}
          </span>
          <span className="truncate text-xs font-extrabold text-slate-800">{task.task_name || '-'}</span>
          {task.operation_no && (
            <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-[#0077b6]">Op {task.operation_no}</span>
          )}
        </button>

        {selected ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#0077b6] px-2 py-0.5 text-[11px] font-bold uppercase text-white">
            <Target className="h-3 w-3" />
            Target
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onSetTarget(task)}
            className="hidden shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-500 transition hover:border-[#90e0ef] hover:text-[#0077b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] group-hover:inline-flex"
          >
            <Target className="h-3 w-3" />
            Target
          </button>
        )}
      </div>
      {expanded && children.map((child) => (
        <TaskTreeNode
          key={child.task_id}
          task={child}
          childrenByParent={childrenByParent}
          expandedIds={expandedIds}
          selectedId={selectedId}
          onToggle={onToggle}
          onSetTarget={onSetTarget}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function SowOrderCard({ order, selected, onClick, onDragStart }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => onDragStart(event, order)}
      onClick={() => onClick(order)}
      className={`group flex w-full cursor-grab items-start gap-2 rounded-xl border bg-white p-3 text-left shadow-sm transition-all hover:border-[#90e0ef] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:cursor-grabbing ${
        selected ? 'border-[#0077b6] ring-2 ring-[#90e0ef]' : 'border-slate-200'
      }`}
    >
      <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-400" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-sm font-extrabold tabular-nums text-slate-800">{order.order_no}</span>
          <span className="shrink-0 rounded-full border border-[#90e0ef] bg-[#caf0f8] px-2 py-0.5 text-xs font-bold tabular-nums text-[#0077b6]">
            {order.operation_count || 0} ops
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{order.part_name || order.ssbr_id || '-'}</span>
        <span className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold tabular-nums">{formatHours(order.total_planhours)}</span>
          <span className="text-slate-300">·</span>
          <span className="truncate">{order.workcenter || 'No workcenter'}</span>
        </span>
      </span>
    </button>
  );
}

function OperationList({ operations }) {
  return (
    <div className="space-y-1.5">
      {sortByOperationNo(operations).map((operation) => (
        <div key={operation.idsow} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-extrabold tabular-nums text-[#0077b6]">Op {operation.operation_no}</span>
            <span className="text-xs font-semibold tabular-nums text-slate-500">{formatHours(operation.planhours)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs font-bold text-slate-700">{operation.operation_text || '-'}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{operation.workcenter || operation.wct_group || '-'}</p>
        </div>
      ))}
    </div>
  );
}

function SelectedProjectBox({ project, onClear }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[#90e0ef] bg-[#caf0f8] p-3">
      <div className="min-w-0">
        <h4 className="truncate text-sm font-extrabold text-slate-800">{project.project_name || '-'}</h4>
        <p className="mt-0.5 truncate text-xs font-semibold text-slate-600">{project.description || 'No description'}</p>
        <p className="mt-1 text-xs font-semibold tabular-nums text-[#0077b6]">Rev {project.revision_no || 0}</p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[#90e0ef] bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
        aria-label="Change project"
      >
        <X className="h-3.5 w-3.5" />
        Change
      </button>
    </div>
  );
}

/**
 * Ringkasan hasil mapping -> satu baris fakta. Hanya angka yang > 0 yang ikut,
 * supaya baris tidak penuh "0 ...".
 */
function mappingSummaryText(summary = {}) {
  const moved = Number(summary.repointed_reservation_count) || 0;
  return [
    Number(summary.mapped_count) > 0 && `${summary.mapped_count} updated`,
    Number(summary.created_count) > 0 && `${summary.created_count} created`,
    Number(summary.reused_count) > 0 && `${summary.reused_count} reused`,
    Number(summary.taken_over_task_count) > 0 && `${summary.taken_over_task_count} taken over`,
    moved > 0 && `${moved} reservation${moved > 1 ? 's' : ''} moved`,
  ].filter(Boolean).join(' · ');
}

/**
 * Backend menolak order yang sudah dipetakan di project lain (409 ORDER_MAPPED_ELSEWHERE)
 * dan takeover yang akan menggantungkan reservasi (409 TAKEOVER_WOULD_ORPHAN_RESERVATION),
 * tapi services/msProjectService.js hanya melempar Error(message) — code-nya hilang dan
 * pesannya masih Bahasa Indonesia. Jadi dua kasus itu dikenali dari isi pesannya.
 */
// Dipilih berdasarkan `error.code` dari backend, BUKAN potongan teks pesan. Versi pertama
// mencocokkan kalimat Indonesia dan langsung jadi kode mati begitu pesan backend diterjemahkan.
// `details` untuk ORDER_MAPPED_ELSEWHERE berisi baris { project_id, project_name, task_count }.
function mappingErrorText(error) {
  const code = error?.code;
  const details = Array.isArray(error?.details) ? error.details : [];
  const text = String(error?.message || '');

  if (code === 'ORDER_MAPPED_ELSEWHERE') {
    const names = details.map((row) => row.project_name || row.project_id).filter(Boolean);
    return {
      title: 'Order already mapped elsewhere',
      description: names.length
        ? `Already in ${names.join(', ')}. One order maps to one project.`
        : 'One order maps to one project.',
    };
  }
  if (code === 'TAKEOVER_WOULD_ORPHAN_RESERVATION') {
    return {
      title: 'Takeover cancelled',
      description: 'Some bay reservations point to operations missing from this project.',
    };
  }
  return { title: 'Mapping failed', description: text || 'Unknown error' };
}

export default function MapSapOperationPage() {
  const [projects, setProjects] = useState([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectError, setProjectError] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectTasks, setProjectTasks] = useState([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState(null);
  const [targetParentTask, setTargetParentTask] = useState(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState(() => new Set());
  const [sowOrders, setSowOrders] = useState([]);
  const [sowSearch, setSowSearch] = useState('');
  const [sowError, setSowError] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [operations, setOperations] = useState([]);
  const [sowLoading, setSowLoading] = useState(false);
  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState(null);
  const [mapping, setMapping] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const taskTree = useMemo(() => buildTaskTree(projectTasks), [projectTasks]);

  const loadProjects = useCallback(async () => {
    setProjectLoading(true);
    setProjectError(null);
    try {
      setProjects(await fetchMsProjects({ q: projectSearch, limit: 80 }));
    } catch (error) {
      setProjectError(error.message);
    } finally {
      setProjectLoading(false);
    }
  }, [projectSearch]);

  useEffect(() => {
    if (selectedProject) return undefined;
    const timer = setTimeout(loadProjects, 250);
    return () => clearTimeout(timer);
  }, [loadProjects, selectedProject]);

  const loadSowOrders = useCallback(async () => {
    setSowLoading(true);
    setSowError(null);
    try {
      setSowOrders(await fetchSowOrders({ q: sowSearch, limit: 80 }));
    } catch (error) {
      setSowError(error.message);
    } finally {
      setSowLoading(false);
    }
  }, [sowSearch]);

  useEffect(() => {
    const timer = setTimeout(loadSowOrders, 250);
    return () => clearTimeout(timer);
  }, [loadSowOrders]);

  const loadProjectTasks = useCallback(async (project) => {
    setSelectedProject(project);
    setTargetParentTask(null);
    setExpandedTaskIds(new Set());
    setTaskLoading(true);
    setTaskError(null);
    try {
      setProjectTasks(await fetchMsProjectTasks(project.project_id));
    } catch (error) {
      setTaskError(error.message);
    } finally {
      setTaskLoading(false);
    }
  }, []);

  const clearProject = useCallback(() => {
    setSelectedProject(null);
    setProjectTasks([]);
    setTargetParentTask(null);
    setTaskError(null);
    setExpandedTaskIds(new Set());
  }, []);

  const loadOperations = useCallback(async (order) => {
    setSelectedOrder(order);
    setOperationLoading(true);
    setOperationError(null);
    try {
      setOperations(await fetchSowOrderOperations(order.order_no));
    } catch (error) {
      setOperationError(error.message);
    } finally {
      setOperationLoading(false);
    }
  }, []);

  const applyMapping = useCallback(async (order = selectedOrder) => {
    if (!order) {
      toast.error('Choose an SOW order first');
      return;
    }
    if (!selectedProject) {
      toast.error('Choose a target project first');
      return;
    }
    if (!targetParentTask) {
      toast.error('Choose a target parent task first');
      return;
    }

    setMapping(true);
    try {
      const result = await mapSowOrderToProjectTasks(selectedProject.project_id, {
        order_no: order.order_no,
        target_parent_task_id: targetParentTask.task_id,
        actor: 'web-manufacturing',
      });
      toast.success('Operations mapped', {
        description: mappingSummaryText(result.summary) || 'Nothing changed',
      });
      const refreshedTasks = await fetchMsProjectTasks(selectedProject.project_id);
      setProjectTasks(refreshedTasks);
      setExpandedTaskIds((prev) => new Set([...prev, targetParentTask.task_id]));
      setTargetParentTask(refreshedTasks.find((task) => task.task_id === targetParentTask.task_id) || targetParentTask);
    } catch (error) {
      const { title, description } = mappingErrorText(error);
      toast.error(title, { description });
    } finally {
      setMapping(false);
    }
  }, [selectedOrder, selectedProject, targetParentTask]);

  const handleDragStart = (event, order) => {
    event.dataTransfer.setData('text/plain', order.order_no);
    event.dataTransfer.effectAllowed = 'copy';
    loadOperations(order);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  };

  const handleDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDropActive(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDropActive(false);
    const orderNo = event.dataTransfer.getData('text/plain');
    const order = sowOrders.find((row) => row.order_no === orderNo) || selectedOrder;
    applyMapping(order);
  };

  const toggleTaskExpand = useCallback((taskId) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const setTargetTask = useCallback((task) => {
    setTargetParentTask(task);
  }, []);

  const targetTasks = useMemo(
    () => targetParentTask ? sortByOperationNo(taskTree.byParent.get(targetParentTask.task_id) || []) : [],
    [targetParentTask, taskTree]
  );

  const ready = Boolean(selectedProject && selectedOrder && targetParentTask);
  const steps = [
    { n: 1, label: 'Project', value: selectedProject?.project_name, done: Boolean(selectedProject) },
    {
      n: 2,
      label: 'Parent task',
      value: targetParentTask ? `${targetParentTask.outline_number || '-'} ${targetParentTask.task_name || ''}`.trim() : null,
      done: Boolean(targetParentTask),
    },
    { n: 3, label: 'Order', value: selectedOrder?.order_no, done: Boolean(selectedOrder), mono: true },
  ];

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:px-6">
      {/* Alur klik terpandu + aksi utama (juga bisa via drag-and-drop ke pohon) */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {steps.map((step, index) => (
            <React.Fragment key={step.n}>
              {index > 0 && <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />}
              <Step {...step} />
            </React.Fragment>
          ))}
        </ol>
        <div className="flex items-center gap-3">
          {!ready && (
            <span className="hidden text-xs text-slate-400 xl:block">Complete the 3 steps, or drag an order onto the tree</span>
          )}
          <button
            type="button"
            onClick={() => applyMapping()}
            disabled={mapping || !ready}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#023e8a] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none motion-reduce:transform-none"
          >
            {mapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Map Operations
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
        {/* ── SUMBER: SOW Orders ─────────────────────────────── */}
        <section className="flex min-h-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#0077b6]">Source</p>
              <h3 className="text-sm font-extrabold text-slate-800">SOW Orders</h3>
            </div>
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-500">
              {sowOrders.length}
            </span>
          </div>

          <div className="border-b border-slate-200 p-3">
            <SearchInput value={sowSearch} onChange={setSowSearch} placeholder="Search order or part" />
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
            {sowLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[74px] w-full rounded-xl" />)
            ) : sowError ? (
              <PanelError message={sowError} onRetry={loadSowOrders} />
            ) : sowOrders.length === 0 ? (
              <EmptyState
                icon={PackageOpen}
                title="No orders"
                description="No SOW order matches this search."
              />
            ) : (
              sowOrders.map((order) => (
                <SowOrderCard
                  key={order.order_no}
                  order={order}
                  selected={order.order_no === selectedOrder?.order_no}
                  onClick={loadOperations}
                  onDragStart={handleDragStart}
                />
              ))
            )}
          </div>

          {/* Preview operasi order terpilih (konfirmasi langkah 3) */}
          {selectedOrder && (
            <div className="border-t border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Operations · <span className="font-mono tabular-nums text-slate-700">{selectedOrder.order_no}</span>
                </p>
                {operationLoading && <Loader2 className="h-4 w-4 animate-spin text-[#00b4d8]" />}
              </div>
              <div className="max-h-56 overflow-auto px-3 pb-3">
                {operationLoading ? (
                  <div className="space-y-1.5">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                  </div>
                ) : operationError ? (
                  <PanelError message={operationError} onRetry={() => loadOperations(selectedOrder)} />
                ) : operations.length === 0 ? (
                  <EmptyState icon={ListTree} title="No operations" />
                ) : (
                  <OperationList operations={operations} />
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── TARGET: Project + Task Tree ────────────────────── */}
        <section
          className={`relative flex min-h-[540px] flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-colors lg:min-h-0 ${
            dropActive ? 'border-[#00b4d8] ring-2 ring-[#00b4d8]' : 'border-slate-200'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dropActive && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#caf0f8]/60">
              <span className="rounded-lg border border-[#00b4d8] bg-white px-4 py-2 text-sm font-bold text-[#0077b6] shadow">
                {targetParentTask
                  ? `Drop to map into "${targetParentTask.task_name || 'parent'}"`
                  : 'Select a project and parent task first'}
              </span>
            </div>
          )}

          <div className="border-b border-slate-200 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#0077b6]">Target</p>
                <h3 className="text-sm font-extrabold text-slate-800">Project Tasks</h3>
              </div>
              {taskLoading && <Loader2 className="h-4 w-4 animate-spin text-[#00b4d8]" />}
            </div>

            {selectedProject ? (
              <SelectedProjectBox project={selectedProject} onClear={clearProject} />
            ) : (
              <SearchInput value={projectSearch} onChange={setProjectSearch} placeholder="Search project" />
            )}
          </div>

          {selectedProject ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(280px,1fr)_minmax(300px,1fr)]">
              {/* Pohon task */}
              <div className="flex min-h-0 flex-col overflow-hidden border-b border-slate-200 xl:border-b-0 xl:border-r">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-[#caf0f8] px-3 py-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-700">Project Tree</span>
                  <span className="truncate text-xs text-slate-500">Click a name to set target</span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {taskLoading ? (
                    <div className="space-y-1.5 p-2">
                      {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                    </div>
                  ) : taskError ? (
                    <PanelError message={taskError} onRetry={() => loadProjectTasks(selectedProject)} />
                  ) : taskTree.roots.length === 0 ? (
                    <EmptyState icon={ListTree} title="No tasks" />
                  ) : (
                    taskTree.roots.map((task) => (
                      <TaskTreeNode
                        key={task.task_id}
                        task={task}
                        childrenByParent={taskTree.byParent}
                        expandedIds={expandedTaskIds}
                        selectedId={targetParentTask?.task_id}
                        onToggle={toggleTaskExpand}
                        onSetTarget={setTargetTask}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Child task dari parent terpilih */}
              <div className="flex min-h-0 flex-col overflow-hidden">
                <div className="sticky top-0 z-10 border-b border-slate-200 bg-[#caf0f8] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-700">Child Tasks</span>
                    {targetParentTask && (
                      <span className="text-xs font-semibold tabular-nums text-slate-500">{targetTasks.length}</span>
                    )}
                  </div>
                  {targetParentTask && (
                    <p className="mt-0.5 truncate text-xs font-semibold text-slate-700">
                      <span className="font-mono tabular-nums text-[#0077b6]">{targetParentTask.outline_number || '-'}</span>{' '}
                      {targetParentTask.task_name || '-'}
                    </p>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {!targetParentTask ? (
                    <EmptyState
                      icon={Target}
                      title="Select a parent task"
                    />
                  ) : taskLoading ? (
                    Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={4} />)
                  ) : targetTasks.length === 0 ? (
                    <EmptyState
                      icon={GitBranch}
                      title="No child tasks"
                      description="Mapping will create new tasks here."
                    />
                  ) : (
                    <>
                      <div className="sticky top-0 grid grid-cols-[minmax(160px,1fr)_84px_92px_64px] gap-3 border-b border-slate-200 bg-white px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                        <span>Child Task</span>
                        <span>Order</span>
                        <span>Operation</span>
                        <span className="text-right">Work</span>
                      </div>
                      {targetTasks.map((task) => <TaskRow key={task.task_id} task={task} />)}
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Belum pilih project → daftar project untuk dipilih */
            <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
              {projectLoading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[68px] w-full rounded-xl" />)
              ) : projectError ? (
                <PanelError message={projectError} onRetry={loadProjects} />
              ) : projects.length === 0 ? (
                <EmptyState
                  icon={FolderSearch}
                  title="No projects"
                  description="No MS Project matches this search."
                />
              ) : (
                projects.map((project) => (
                  <ProjectCard key={project.project_id} project={project} selected={false} onClick={loadProjectTasks} />
                ))
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
