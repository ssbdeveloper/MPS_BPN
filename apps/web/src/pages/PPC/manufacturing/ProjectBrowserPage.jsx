import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, FolderSearch, ListTree, Loader2, MousePointerClick, Pencil,
  RotateCw, Save, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  deleteMsProject,
  fetchMsProjects,
  fetchMsProjectTasks,
  updateMsProject,
  updateMsProjectTask,
} from '../../../services/msProjectService';
import { EmptyState, Skeleton, SkeletonRow, SearchInput } from '../../../components';

/**
 * ProjectBrowserPage — rute /sow-scheduling/projects (varian manufaktur).
 * Konten saja: header + tombol back + judul halaman disediakan oleh
 * ManufacturingSchedulingLayout (PageHeader). JANGAN render header/back/title sendiri.
 * Fetch datanya sendiri (fetchMsProjects / fetchMsProjectTasks — signature tidak diubah).
 *
 * Desktop-only: layout 2-kolom berdampingan; interaksi mouse kelas-satu.
 */
function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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

function projectStatusClass(project) {
  if (project.checked_out_by) return 'border-amber-200 bg-amber-50 text-amber-700';
  if (String(project.status || '').toUpperCase() === 'ACTIVE') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-100 text-slate-600';
}

function StatusBadge({ project }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${projectStatusClass(project)}`}>
      {project.checked_out_by ? 'Checked Out' : project.status || 'Draft'}
    </span>
  );
}

/** Error fetch inline (bukan toast-only) — pesan + tombol "Coba lagi". */
function FetchError({ message, onRetry }) {
  return (
    <div className="m-3 flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
      <AlertTriangle className="h-8 w-8 text-red-500" strokeWidth={1.5} />
      <div>
        <p className="text-sm font-semibold text-red-700">Failed to load data</p>
        {message && <p className="mt-1 text-xs text-red-600">{message}</p>}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2
                   text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
                   active:scale-95 motion-reduce:transition-none motion-reduce:transform-none"
      >
        <RotateCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

function ProjectCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Skeleton className="h-6" />
        <Skeleton className="h-6" />
        <Skeleton className="h-6" />
      </div>
    </div>
  );
}

function ProjectCard({ project, selected, onClick, onRename, onDelete }) {
  // Root div (bukan button) supaya aksi Rename/Delete boleh jadi tombol di
  // dalam kartu — button bersarang di button = HTML tidak valid.
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick(project);
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(project)}
      onKeyDown={handleKeyDown}
      className={`group w-full cursor-pointer rounded-xl border bg-white p-3 text-left shadow-sm transition-all
                 hover:border-[#90e0ef] hover:bg-slate-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
                 motion-reduce:transition-none ${
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
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-semibold text-slate-500 tabular-nums">
        <span className="truncate rounded-lg bg-slate-50 px-2 py-1">Rev {project.revision_no || 0}</span>
        <span className="truncate rounded-lg bg-slate-50 px-2 py-1">Pub {project.published_revision_no || '-'}</span>
        <span className="truncate rounded-lg bg-slate-50 px-2 py-1">{formatDate(project.updated_at)}</span>
      </div>
      {/* Aksi CRUD — muncul saat hover/fokus; stopPropagation supaya tidak
          membuka detail project. */}
      <div className="mt-2 flex items-center justify-end gap-1 border-t border-slate-100 pt-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onRename?.(project); }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
        >
          <Pencil className="h-3.5 w-3.5" /> Rename
        </button>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onDelete?.(project); }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </div>
  );
}

function TaskRow({ task, onEdit }) {
  const indent = Math.max(0, Number(task.outline_level || 1) - 1) * 14;
  const isSummary = Boolean(task.is_summary);
  return (
    <div className="grid grid-cols-[minmax(220px,1fr)_96px_104px_92px_32px] items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50">
      <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: indent }}>
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-600 tabular-nums">
          {task.outline_number || '-'}
        </span>
        <span className={`truncate text-xs ${isSummary ? 'font-bold text-slate-800' : 'font-medium text-slate-700'}`}>
          {task.task_name || '-'}
        </span>
      </div>
      <span className="truncate font-mono text-xs font-bold text-slate-600 tabular-nums">{task.order_no || '-'}</span>
      <span className="truncate font-mono text-xs font-bold text-[#0077b6] tabular-nums">{task.operation_no || '-'}</span>
      <span className="text-right text-xs font-semibold text-slate-500 tabular-nums">{formatHoursFromMinutes(task.planned_work_minutes)}</span>
      <button
        type="button"
        onClick={() => onEdit?.(task)}
        aria-label={`Edit task ${task.task_name || ''}`}
        title="Edit task"
        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-[#0077b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ProjectTaskPanel({ project, tasks, loading, error, onRetry, onEditTask }) {
  const hasRows = Boolean(project) && !loading && !error && tasks.length > 0;
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#0077b6]">Tasks</p>
          <h2 className="truncate text-sm font-extrabold text-slate-800">
            {project?.project_name || 'No project selected'}
          </h2>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {hasRows && (
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(220px,1fr)_96px_104px_92px_32px] gap-3 border-b border-slate-200 bg-[#caf0f8] px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-700">
            <span>Task</span>
            <span>Order</span>
            <span>Operation</span>
            <span className="text-right">Hours</span>
            <span aria-hidden="true" />
          </div>
        )}

        {loading ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} cols={4} />
            ))}
          </div>
        ) : error ? (
          <FetchError message={error} onRetry={onRetry} />
        ) : !project ? (
          <EmptyState
            icon={MousePointerClick}
            title="Select a project"
          />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ListTree}
            title="No tasks"
          />
        ) : (
          sortByOperationNo(tasks).map((task) => (
            <TaskRow key={task.task_id} task={task} onEdit={onEditTask} />
          ))
        )}
      </div>
    </section>
  );
}

// ── Modal aksi ringan (rename / delete / edit task) ─────────────────────────
const MODAL_INPUT = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]';
// Base TANPA bg/border-color/hover-bg: warna & hover per-tombol (Cancel / primary
// / danger) — dua kelas bg-* di elemen sama tidak bisa diandalkan urutannya.
const MODAL_BTN = 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';
const MODAL_BTN_CANCEL = `${MODAL_BTN} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const MODAL_BTN_PRIMARY = `${MODAL_BTN} border-transparent bg-[#0077b6] text-white hover:bg-[#023e8a]`;
const MODAL_BTN_DANGER = `${MODAL_BTN} border-transparent bg-red-600 text-white hover:bg-red-700`;

function ModalShell({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-extrabold text-slate-800">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : '';
}

export default function ProjectBrowserPage() {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [projectsError, setProjectsError] = useState(null);
  const [tasksError, setTasksError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  // CRUD state
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameName, setRenameName] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [editTaskTarget, setEditTaskTarget] = useState(null);
  const [editTaskName, setEditTaskName] = useState('');
  const [editTaskStart, setEditTaskStart] = useState('');
  const [editTaskEnd, setEditTaskEnd] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoadingProjects(true);
      setProjectsError(null);
      try {
        const rows = await fetchMsProjects({ q: search, limit: 80 });
        setProjects(rows);
        if (selectedProject && !rows.some((row) => row.project_id === selectedProject.project_id)) {
          setSelectedProject(null);
          setTasks([]);
        }
      } catch (error) {
        setProjectsError(error.message || 'Could not load the project list.');
      } finally {
        setLoadingProjects(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search, selectedProject, reloadToken]);

  const selectProject = useCallback(async (project) => {
    setSelectedProject(project);
    setLoadingTasks(true);
    setTasksError(null);
    try {
      setTasks(await fetchMsProjectTasks(project.project_id));
    } catch (error) {
      setTasksError(error.message || 'Could not load project tasks.');
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  const retryTasks = useCallback(() => {
    if (selectedProject) selectProject(selectedProject);
  }, [selectedProject, selectProject]);

  // --- Rename project -------------------------------------------------------
  const openRename = useCallback((project) => {
    setRenameTarget(project);
    setRenameName(project.project_name || '');
    setRenameError('');
  }, []);

  const submitRename = useCallback(async () => {
    if (!renameTarget || renameBusy) return;
    const name = renameName.trim();
    if (!name) return;
    setRenameBusy(true);
    setRenameError('');
    try {
      const updated = await updateMsProject(renameTarget.project_id, { project_name: name });
      setProjects((prev) => prev.map((project) => (
        project.project_id === updated.project_id ? { ...project, ...updated } : project
      )));
      setSelectedProject((prev) => (
        prev?.project_id === updated.project_id ? { ...prev, ...updated } : prev
      ));
      setRenameTarget(null);
      toast.success('Project renamed', { description: name });
    } catch (error) {
      setRenameError(error.message || 'Failed to rename project.');
    } finally {
      setRenameBusy(false);
    }
  }, [renameTarget, renameBusy, renameName]);

  // --- Delete project -------------------------------------------------------
  const openDelete = useCallback((project) => {
    setDeleteTarget(project);
    setDeleteError('');
  }, []);

  const submitDelete = useCallback(async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const result = await deleteMsProject(deleteTarget.project_id);
      setProjects((prev) => prev.filter((project) => project.project_id !== deleteTarget.project_id));
      if (selectedProject?.project_id === deleteTarget.project_id) {
        setSelectedProject(null);
        setTasks([]);
      }
      setDeleteTarget(null);
      toast.success('Project deleted', { description: result.project_name || deleteTarget.project_name });
    } catch (error) {
      setDeleteError(error.message || 'Failed to delete project.');
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteTarget, deleteBusy, selectedProject]);

  // --- Edit task ------------------------------------------------------------
  const openEditTask = useCallback((task) => {
    setEditTaskTarget(task);
    setEditTaskName(task.task_name || '');
    setEditTaskStart(dateOnly(task.plan_start));
    setEditTaskEnd(dateOnly(task.plan_finish));
    setEditError('');
  }, []);

  const submitEditTask = useCallback(async () => {
    if (!editTaskTarget || editBusy || !selectedProject) return;
    const name = editTaskName.trim();
    if (!name) {
      setEditError('Task name must not be empty.');
      return;
    }
    setEditBusy(true);
    setEditError('');
    try {
      const updated = await updateMsProjectTask(selectedProject.project_id, editTaskTarget.task_id, {
        task_name: name,
        plan_start: editTaskStart || null,
        plan_finish: editTaskEnd || null,
      });
      setTasks((prev) => prev.map((task) => (
        task.task_id === updated.task_id ? { ...task, ...updated } : task
      )));
      setEditTaskTarget(null);
      toast.success('Task updated');
    } catch (error) {
      setEditError(error.message || 'Failed to update task.');
    } finally {
      setEditBusy(false);
    }
  }, [editTaskTarget, editBusy, selectedProject, editTaskName, editTaskStart, editTaskEnd]);

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:px-6">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search projects..."
              className="w-full"
            />
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
            {loadingProjects ? (
              Array.from({ length: 6 }).map((_, i) => <ProjectCardSkeleton key={i} />)
            ) : projectsError ? (
              <FetchError message={projectsError} onRetry={() => setReloadToken((n) => n + 1)} />
            ) : projects.length === 0 ? (
              <EmptyState
                icon={FolderSearch}
                title={search ? 'No projects found' : 'No projects yet'}
                action={
                  search ? (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700
                                 transition-all hover:border-slate-300 hover:bg-slate-50
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
                                 active:scale-95 motion-reduce:transition-none motion-reduce:transform-none"
                    >
                      Clear search
                    </button>
                  ) : undefined
                }
              />
            ) : (
              projects.map((project) => (
                <ProjectCard
                  key={project.project_id}
                  project={project}
                  selected={project.project_id === selectedProject?.project_id}
                  onClick={selectProject}
                  onRename={openRename}
                  onDelete={openDelete}
                />
              ))
            )}
          </div>
        </section>

        <ProjectTaskPanel
          project={selectedProject}
          tasks={tasks}
          loading={loadingTasks}
          error={tasksError}
          onRetry={retryTasks}
          onEditTask={openEditTask}
        />
      </div>

      {/* Modal rename project */}
      {renameTarget && (
        <ModalShell
          title="Rename project"
          onClose={() => setRenameTarget(null)}
          footer={(
            <>
              <button type="button" onClick={() => setRenameTarget(null)} className={MODAL_BTN_CANCEL}>Cancel</button>
              <button
                type="button"
                onClick={submitRename}
                disabled={renameBusy || !renameName.trim()}
                className={MODAL_BTN_PRIMARY}
              >
                {renameBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </button>
            </>
          )}
        >
          <label className="grid gap-1 text-xs font-bold text-slate-700">
            Project name
            <input
              autoFocus
              type="text"
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              placeholder={renameTarget.project_name || 'Project name'}
              className={MODAL_INPUT}
            />
          </label>
          {renameError && <p className="mt-2 text-xs font-semibold text-red-600">{renameError}</p>}
        </ModalShell>
      )}

      {/* Modal delete project */}
      {deleteTarget && (
        <ModalShell
          title="Delete project"
          onClose={() => setDeleteTarget(null)}
          footer={(
            <>
              <button type="button" onClick={() => setDeleteTarget(null)} className={MODAL_BTN_CANCEL}>Cancel</button>
              <button
                type="button"
                onClick={submitDelete}
                disabled={deleteBusy}
                className={MODAL_BTN_DANGER}
              >
                {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            </>
          )}
        >
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <p className="text-xs font-semibold text-red-700">
              Delete <span className="font-extrabold">{deleteTarget.project_name || deleteTarget.project_id}</span>?
              {' '}All tasks, revisions, resources and dependencies will be removed. This cannot be undone.
            </p>
          </div>
          {deleteError && <p className="mt-2 text-xs font-semibold text-red-600">{deleteError}</p>}
        </ModalShell>
      )}

      {/* Modal edit task */}
      {editTaskTarget && (
        <ModalShell
          title={`Edit task${editTaskTarget.outline_number ? ` · ${editTaskTarget.outline_number}` : ''}`}
          onClose={() => setEditTaskTarget(null)}
          footer={(
            <>
              <button type="button" onClick={() => setEditTaskTarget(null)} className={MODAL_BTN_CANCEL}>Cancel</button>
              <button
                type="button"
                onClick={submitEditTask}
                disabled={editBusy || !editTaskName.trim()}
                className={MODAL_BTN_PRIMARY}
              >
                {editBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </button>
            </>
          )}
        >
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-bold text-slate-700">
              Task name
              <input
                autoFocus
                type="text"
                value={editTaskName}
                onChange={(event) => setEditTaskName(event.target.value)}
                className={MODAL_INPUT}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Plan start
                <input
                  type="date"
                  value={editTaskStart}
                  onChange={(event) => setEditTaskStart(event.target.value)}
                  className={`${MODAL_INPUT} tabular-nums`}
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Plan finish
                <input
                  type="date"
                  value={editTaskEnd}
                  onChange={(event) => setEditTaskEnd(event.target.value)}
                  className={`${MODAL_INPUT} tabular-nums`}
                />
              </label>
            </div>
            {editError && <p className="text-xs font-semibold text-red-600">{editError}</p>}
          </div>
        </ModalShell>
      )}
    </main>
  );
}
