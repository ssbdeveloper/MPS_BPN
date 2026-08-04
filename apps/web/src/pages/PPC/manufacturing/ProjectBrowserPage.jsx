import React, { useCallback, useEffect, useState } from 'react';
import { FolderSearch, ListTree, MousePointerClick, AlertTriangle, RotateCw } from 'lucide-react';
import {
  fetchMsProjects,
  fetchMsProjectTasks,
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

function ProjectCard({ project, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(project)}
      className={`w-full cursor-pointer rounded-xl border bg-white p-3 text-left shadow-sm transition-all
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
    </button>
  );
}

function TaskRow({ task }) {
  const indent = Math.max(0, Number(task.outline_level || 1) - 1) * 14;
  const isSummary = Boolean(task.is_summary);
  return (
    <div className="grid grid-cols-[minmax(220px,1fr)_96px_104px_92px] items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50">
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
    </div>
  );
}

function ProjectTaskPanel({ project, tasks, loading, error, onRetry }) {
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
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(220px,1fr)_96px_104px_92px] gap-3 border-b border-slate-200 bg-[#caf0f8] px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-700">
            <span>Task</span>
            <span>Order</span>
            <span>Operation</span>
            <span className="text-right">Hours</span>
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
          sortByOperationNo(tasks).map((task) => <TaskRow key={task.task_id} task={task} />)
        )}
      </div>
    </section>
  );
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
        />
      </div>
    </main>
  );
}
