import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, ChevronDown, ChevronRight, GitBranch, Loader2, Search, X,
} from 'lucide-react';
import { toast } from 'sonner';
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
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return '-';
  return `${hours.toLocaleString('id-ID', { maximumFractionDigits: 2 })}h`;
}

function formatHoursFromMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return '-';
  return `${(minutes / 60).toLocaleString('id-ID', { maximumFractionDigits: 2 })}h`;
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

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-[#0096c7] focus-within:ring-2 focus-within:ring-[#00b4d8]">
      <Search className="h-4 w-4 shrink-0 text-slate-400" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm font-semibold text-slate-800 placeholder-slate-400 outline-none"
      />
    </div>
  );
}

function StatusBadge({ project }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${projectStatusClass(project)}`}>
      {project.checked_out_by ? 'Checked Out' : project.status || 'Draft'}
    </span>
  );
}

function ProjectCard({ project, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(project)}
      className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-all hover:border-[#90e0ef] hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] ${
        selected ? 'border-[#0096c7] ring-2 ring-[#90e0ef]' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-slate-800">{project.project_name || '-'}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{project.description || 'No description'}</p>
        </div>
        <StatusBadge project={project} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-semibold text-slate-500">
        <span className="rounded-lg bg-slate-50 px-2 py-1">Rev {project.revision_no || 0}</span>
        <span className="rounded-lg bg-slate-50 px-2 py-1">Published {project.published_revision_no || '-'}</span>
        <span className="rounded-lg bg-slate-50 px-2 py-1">{formatDate(project.updated_at)}</span>
      </div>
    </button>
  );
}

function TaskRow({ task, compact = false }) {
  const indent = compact ? 0 : Math.max(0, Number(task.outline_level || 1) - 1) * 14;
  return (
    <div className="grid grid-cols-[minmax(180px,1fr)_88px_96px_76px] items-center gap-3 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
      <div className="min-w-0" style={{ paddingLeft: indent }}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600">
            {task.outline_number || '-'}
          </span>
          <span className="truncate font-bold text-slate-800">{task.task_name || '-'}</span>
        </div>
        {!compact && (
          <p className="mt-0.5 truncate text-[10px] text-slate-500">
            Level {task.outline_level || '-'} - {task.is_summary ? 'Summary task' : 'Detail task'}
          </p>
        )}
      </div>
      <span className="truncate font-mono text-[11px] font-bold text-slate-600">{task.order_no || '-'}</span>
      <span className="truncate font-mono text-[11px] font-bold text-[#0077b6]">{task.operation_no || '-'}</span>
      <span className="text-right text-[11px] font-semibold text-slate-500">{formatHoursFromMinutes(task.planned_work_minutes)}</span>
    </div>
  );
}

function TaskTreeNode({ task, childrenByParent, expandedIds, selectedId, onSelect, depth = 0 }) {
  const children = childrenByParent.get(task.task_id) || [];
  const expanded = expandedIds.has(task.task_id);
  const selected = selectedId === task.task_id;
  const hasChildren = children.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(task, hasChildren)}
        className={`flex min-h-[44px] w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#00b4d8] ${
          selected ? 'bg-[#caf0f8]/70' : 'bg-white'
        }`}
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500">
          {hasChildren ? (
            <ChevronDown className={`h-4 w-4 transition ${expanded ? '' : '-rotate-90'}`} />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600">
              {task.outline_number || '-'}
            </span>
            <span className="truncate text-xs font-extrabold text-slate-800">{task.task_name || '-'}</span>
          </div>
          <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">
            {children.length} child task(s){task.operation_no ? ` - Op ${task.operation_no}` : ''}
          </p>
        </div>
        {selected && (
          <span className="rounded-full border border-[#90e0ef] bg-white px-2 py-0.5 text-[10px] font-extrabold text-[#0077b6]">
            Target
          </span>
        )}
      </button>
      {expanded && children.map((child) => (
        <TaskTreeNode
          key={child.task_id}
          task={child}
          childrenByParent={childrenByParent}
          expandedIds={expandedIds}
          selectedId={selectedId}
          onSelect={onSelect}
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
      className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-all hover:border-[#90e0ef] hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] ${
        selected ? 'border-[#0096c7] ring-2 ring-[#90e0ef]' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-extrabold text-slate-800">{order.order_no}</p>
          <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{order.part_name || order.ssbr_id || '-'}</p>
        </div>
        <span className="rounded-full border border-[#90e0ef] bg-[#caf0f8] px-2 py-0.5 text-[10px] font-extrabold text-[#0077b6]">
          {order.operation_count || 0} ops
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-500">
        <span className="rounded-lg bg-slate-50 px-2 py-1">{formatHours(order.total_planhours)}</span>
        <span className="rounded-lg bg-slate-50 px-2 py-1">{order.workcenter || 'No workcenter'}</span>
      </div>
    </button>
  );
}

function OperationList({ operations }) {
  return (
    <div className="space-y-1.5">
      {sortByOperationNo(operations).map((operation) => (
        <div key={operation.idsow} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-extrabold text-[#0077b6]">Op {operation.operation_no}</span>
            <span className="text-[10px] font-semibold text-slate-500">{formatHours(operation.planhours)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs font-bold text-slate-700">{operation.operation_text || '-'}</p>
          <p className="mt-0.5 truncate text-[10px] text-slate-500">{operation.workcenter || operation.wct_group || '-'}</p>
        </div>
      ))}
    </div>
  );
}

function SourceSection({ title, subtitle, open, flexMode, loading, onToggle, children }) {
  return (
    <section className={`${open ? flexMode : 'flex-none'} flex min-h-0 flex-col overflow-hidden border-b border-slate-200 last:border-b-0`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-[48px] items-center justify-between gap-3 bg-white px-3 py-2 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#00b4d8]"
      >
        <span className="min-w-0">
          <span className="block truncate text-xs font-extrabold text-slate-800">{title}</span>
          {subtitle && <span className="block truncate text-[10px] font-semibold text-slate-500">{subtitle}</span>}
        </span>
        <span className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-[#0096c7]" />}
          <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? '' : '-rotate-90'}`} />
        </span>
      </button>
      {open && <div className="min-h-0 flex-1 overflow-hidden bg-slate-50">{children}</div>}
    </section>
  );
}

function SelectedProjectBox({ project, onClear }) {
  return (
    <div className="rounded-xl border border-[#90e0ef] bg-[#caf0f8] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase text-[#0077b6]">Selected Project</p>
          <h4 className="mt-0.5 truncate text-sm font-extrabold text-slate-800">{project.project_name || '-'}</h4>
          <p className="mt-1 truncate text-xs font-semibold text-slate-600">{project.description || 'No description'}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#90e0ef] bg-white text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          aria-label="Unselect project"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-semibold text-slate-600">
        <span className="rounded-lg bg-white/80 px-2 py-1">Rev {project.revision_no || 0}</span>
        <span className="rounded-lg bg-white/80 px-2 py-1">Published {project.published_revision_no || '-'}</span>
        <span className="rounded-lg bg-white/80 px-2 py-1">{formatDate(project.updated_at)}</span>
      </div>
    </div>
  );
}

export default function MapSapOperationPage() {
  const [projects, setProjects] = useState([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectTasks, setProjectTasks] = useState([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [targetParentTask, setTargetParentTask] = useState(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState(() => new Set());
  const [sowOrders, setSowOrders] = useState([]);
  const [sowSearch, setSowSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [operations, setOperations] = useState([]);
  const [sowLoading, setSowLoading] = useState(false);
  const [operationLoading, setOperationLoading] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [sourceOpen, setSourceOpen] = useState({ orders: true, operations: true });

  const taskTree = useMemo(() => buildTaskTree(projectTasks), [projectTasks]);
  const openSourceCount = Number(sourceOpen.orders) + Number(sourceOpen.operations);
  const sourceFlexMode = openSourceCount === 2 ? 'flex-1 basis-0' : 'flex-1';

  useEffect(() => {
    if (selectedProject) return undefined;
    const timer = setTimeout(async () => {
      setProjectLoading(true);
      try {
        setProjects(await fetchMsProjects({ q: projectSearch, limit: 80 }));
      } catch (error) {
        toast.error('Failed to load projects', { description: error.message });
      } finally {
        setProjectLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [projectSearch, selectedProject]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setSowLoading(true);
      try {
        setSowOrders(await fetchSowOrders({ q: sowSearch, limit: 80 }));
      } catch (error) {
        toast.error('Failed to load SOW orders', { description: error.message });
      } finally {
        setSowLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [sowSearch]);

  const loadProjectTasks = useCallback(async (project) => {
    setSelectedProject(project);
    setTargetParentTask(null);
    setExpandedTaskIds(new Set());
    setTaskLoading(true);
    try {
      setProjectTasks(await fetchMsProjectTasks(project.project_id));
    } catch (error) {
      toast.error('Failed to load project tasks', { description: error.message });
    } finally {
      setTaskLoading(false);
    }
  }, []);

  const clearProject = useCallback(() => {
    setSelectedProject(null);
    setProjectTasks([]);
    setTargetParentTask(null);
    setExpandedTaskIds(new Set());
  }, []);

  const loadOperations = useCallback(async (order) => {
    setSelectedOrder(order);
    setSourceOpen((prev) => ({ ...prev, operations: true }));
    setOperationLoading(true);
    try {
      setOperations(await fetchSowOrderOperations(order.order_no));
    } catch (error) {
      toast.error('Failed to load SOW operations', { description: error.message });
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
      const mappedCount = result.summary?.mapped_count || 0;
      const createdCount = result.summary?.created_count || 0;
      toast.success('SOW operations mapped', {
        description: `${mappedCount} task(s) updated, ${createdCount} task(s) created.`,
      });
      const refreshedTasks = await fetchMsProjectTasks(selectedProject.project_id);
      setProjectTasks(refreshedTasks);
      setExpandedTaskIds((prev) => new Set([...prev, targetParentTask.task_id]));
      setTargetParentTask(refreshedTasks.find((task) => task.task_id === targetParentTask.task_id) || targetParentTask);
    } catch (error) {
      toast.error('Mapping failed', { description: error.message });
    } finally {
      setMapping(false);
    }
  }, [selectedOrder, selectedProject, targetParentTask]);

  const handleDragStart = (event, order) => {
    event.dataTransfer.setData('text/plain', order.order_no);
    event.dataTransfer.effectAllowed = 'copy';
    loadOperations(order);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const orderNo = event.dataTransfer.getData('text/plain');
    const order = sowOrders.find((row) => row.order_no === orderNo) || selectedOrder;
    applyMapping(order);
  };

  const handleSelectTargetTask = useCallback((task, hasChildren) => {
    setTargetParentTask(task);
    if (hasChildren) {
      setExpandedTaskIds((prev) => {
        const next = new Set(prev);
        if (next.has(task.task_id)) next.delete(task.task_id);
        else next.add(task.task_id);
        return next;
      });
    }
  }, []);

  const targetTasks = useMemo(
    () => targetParentTask ? sortByOperationNo(taskTree.byParent.get(targetParentTask.task_id) || []) : [],
    [targetParentTask, taskTree]
  );

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:px-6">
      

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
        <section className="flex min-h-[680px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0">
          <div className="border-b border-slate-200 px-3 py-3">
            <p className="text-[10px] font-bold uppercase text-[#0077b6]">Source</p>
            <h3 className="text-sm font-extrabold text-slate-800">SOW Orders</h3>
          </div>

          <SourceSection
            title="Order List"
            subtitle={`${sowOrders.length} order(s) loaded`}
            open={sourceOpen.orders}
            flexMode={sourceFlexMode}
            loading={sowLoading}
            onToggle={() => setSourceOpen((prev) => ({ ...prev, orders: !prev.orders }))}
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-slate-200 bg-white p-3">
                <SearchBox value={sowSearch} onChange={setSowSearch} placeholder="Search order..." />
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
                {sowOrders.map((order) => (
                  <SowOrderCard
                    key={order.order_no}
                    order={order}
                    selected={order.order_no === selectedOrder?.order_no}
                    onClick={loadOperations}
                    onDragStart={handleDragStart}
                  />
                ))}
                {!sowLoading && sowOrders.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-8 text-center text-sm font-semibold text-slate-400">
                    No SOW orders found.
                  </div>
                )}
              </div>
            </div>
          </SourceSection>

          <SourceSection
            title="Operation Preview"
            subtitle={selectedOrder ? selectedOrder.order_no : 'Select an order'}
            open={sourceOpen.operations}
            flexMode={sourceFlexMode}
            loading={operationLoading}
            onToggle={() => setSourceOpen((prev) => ({ ...prev, operations: !prev.operations }))}
          >
            <div className="h-full min-h-0 overflow-auto p-3">
              <OperationList operations={operations} />
              {!selectedOrder && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-8 text-center text-sm font-semibold text-slate-400">
                  Select an order to preview operations.
                </div>
              )}
            </div>
          </SourceSection>
        </section>

        <section
          className="flex min-h-[680px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="border-b border-slate-200 p-3">
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                
                <h3 className="text-sm font-extrabold text-slate-800">Project Tasks</h3>
            
              </div>
              <button
                type="button"
                onClick={() => applyMapping()}
                disabled={mapping || !selectedProject || !selectedOrder || !targetParentTask}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#0096c7] px-4 py-2 text-xs font-bold text-white transition-all hover:bg-[#0077b6] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
              >
                {mapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Map Operations
              </button>
            </div>

            {selectedProject ? (
              <SelectedProjectBox project={selectedProject} onClear={clearProject} />
            ) : (
              <SearchBox value={projectSearch} onChange={setProjectSearch} placeholder="Search project..." />
            )}
          </div>

          <div className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden ${selectedProject ? '' : 'lg:grid-cols-[330px_minmax(0,1fr)]'}`}>
            {!selectedProject && (
              <div className="min-h-0 space-y-2 overflow-auto border-b border-slate-200 bg-slate-50 p-3 lg:border-b-0 lg:border-r">
                {projectLoading && (
                  <div className="flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-6 text-sm font-semibold text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin text-[#0096c7]" />
                    Loading projects
                  </div>
                )}
                {!projectLoading && projects.map((project) => (
                  <ProjectCard
                    key={project.project_id}
                    project={project}
                    selected={false}
                    onClick={loadProjectTasks}
                  />
                ))}
                {!projectLoading && projects.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-8 text-center text-sm font-semibold text-slate-400">
                    No projects found.
                  </div>
                )}
              </div>
            )}

            <div className="flex min-h-0 flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-extrabold text-slate-800">
                    {targetParentTask ? `${targetParentTask.outline_number || '-'} ${targetParentTask.task_name || '-'}` : 'No parent selected'}
                  </p>
                  <p className="text-[10px] font-semibold text-slate-500">
                    {targetParentTask
                      ? `${targetTasks.length} direct child task(s)`
                      : 'Click a task in the tree to set the target parent'}
                  </p>
                </div>
                {taskLoading && <Loader2 className="h-4 w-4 animate-spin text-[#0096c7]" />}
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(260px,0.92fr)_minmax(320px,1.08fr)]">
                <div className="min-h-0 overflow-auto border-b border-slate-200 lg:border-b-0 lg:border-r">
                  <div className="sticky top-0 border-b border-slate-200 bg-[#caf0f8] px-3 py-2 text-[10px] font-extrabold uppercase text-slate-700">
                    Project Tree
                  </div>
                  {selectedProject && taskTree.roots.map((task) => (
                    <TaskTreeNode
                      key={task.task_id}
                      task={task}
                      childrenByParent={taskTree.byParent}
                      expandedIds={expandedTaskIds}
                      selectedId={targetParentTask?.task_id}
                      onSelect={handleSelectTargetTask}
                    />
                  ))}
                  {selectedProject && !taskLoading && taskTree.roots.length === 0 && (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-slate-400">
                      No project tasks found.
                    </div>
                  )}
                  {!selectedProject && (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-slate-400">
                      Select a project to browse its task tree.
                    </div>
                  )}
                </div>

                <div className="min-h-0 overflow-auto">
                  <div className="sticky top-0 grid grid-cols-[minmax(180px,1fr)_88px_96px_76px] gap-3 border-b border-slate-200 bg-[#caf0f8] px-3 py-2 text-[10px] font-extrabold uppercase text-slate-700">
                    <span>Direct Child Task</span>
                    <span>Order</span>
                    <span>Operation</span>
                    <span className="text-right">Work</span>
                  </div>
                  {targetTasks.map((task) => <TaskRow key={task.task_id} task={task} compact />)}
                  {targetParentTask && !taskLoading && targetTasks.length === 0 && (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-slate-400">
                      No child tasks yet. Mapping will create new tasks under this parent.
                    </div>
                  )}
                  {!targetParentTask && (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-slate-400">
                      Choose the parent branch from the project tree.
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
                <GitBranch className="mr-1 inline h-3.5 w-3.5 text-[#0077b6]" />
                Dropped orders update or create direct child tasks under the selected parent.
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
