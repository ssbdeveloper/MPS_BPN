import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, CalendarClock, ChevronRight, DatabaseZap, FolderKanban,
  Loader2, Search, ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageContainer } from '../../../components';
import {
  fetchMsProjects,
  fetchMsProjectTasks,
} from '../../../services/msProjectService';
import { goBackOrFallback } from '../../../utils/navigation';
import MapSapOperationPage from './MapSapOperationPage';
import SchedulingAreaPage from './SchedulingAreaPage';

const MENU_ITEMS = [
  {
    key: 'projects',
    label: 'View All Projects',
    icon: FolderKanban,
  },
  {
    key: 'map',
    label: 'Map SAP Operations',
    icon: DatabaseZap,
  },
  {
    key: 'schedule',
    label: 'Scheduling Area',
    icon: CalendarClock,
  },
  {
    key: 'admin',
    label: 'Super Admin Panel',
    icon: ShieldCheck,
    to: '/ms-project-admin',
  },
];

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
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

function projectStatusClass(project) {
  if (project.checked_out_by) return 'border-amber-200 bg-amber-50 text-amber-700';
  if (String(project.status || '').toUpperCase() === 'ACTIVE') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-100 text-slate-600';
}

function StatusBadge({ project }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${projectStatusClass(project)}`}>
      {project.checked_out_by ? 'Checked Out' : project.status || 'Draft'}
    </span>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-[#0096c7] focus-within:ring-2 focus-within:ring-[#00b4d8]">
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

function TaskRow({ task }) {
  const indent = Math.max(0, Number(task.outline_level || 1) - 1) * 14;
  return (
    <div className="grid grid-cols-[minmax(220px,1fr)_96px_104px_92px] items-center gap-3 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
      <div className="min-w-0" style={{ paddingLeft: indent }}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600">
            {task.outline_number || '-'}
          </span>
          <span className="truncate font-bold text-slate-800">{task.task_name || '-'}</span>
        </div>
        <p className="mt-0.5 truncate text-[10px] text-slate-500">
          Level {task.outline_level || '-'} - {task.is_summary ? 'Summary task' : 'Detail task'}
        </p>
      </div>
      <span className="truncate font-mono text-[11px] font-bold text-slate-600">{task.order_no || '-'}</span>
      <span className="truncate font-mono text-[11px] font-bold text-[#0077b6]">{task.operation_no || '-'}</span>
      <span className="text-right text-[11px] font-semibold text-slate-500">{formatHoursFromMinutes(task.planned_work_minutes)}</span>
    </div>
  );
}

function ProjectTaskPanel({ title, project, tasks, loading }) {
  return (
    <section className="min-h-0 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-[#0077b6]">{title}</p>
          <h2 className="truncate text-sm font-extrabold text-slate-800">{project?.project_name || 'Select a project'}</h2>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-[#0096c7]" />}
      </div>
      <div className="max-h-[560px] overflow-auto">
        <div className="sticky top-0 grid grid-cols-[minmax(220px,1fr)_96px_104px_92px] gap-3 border-b border-slate-200 bg-[#caf0f8] px-3 py-2 text-[10px] font-extrabold uppercase text-slate-700">
          <span>Task</span>
          <span>Order</span>
          <span>Operation</span>
          <span className="text-right">Work</span>
        </div>
        {project ? sortByOperationNo(tasks).map((task) => <TaskRow key={task.task_id} task={task} />) : (
          <div className="px-4 py-10 text-center text-sm font-semibold text-slate-400">Choose a project to view tasks.</div>
        )}
        {project && !loading && tasks.length === 0 && (
          <div className="px-4 py-10 text-center text-sm font-semibold text-slate-400">No tasks found.</div>
        )}
      </div>
    </section>
  );
}

function MenuView({ onOpen }) {
  const navigate = useNavigate();

  const handleOpen = (item) => {
    if (item.to) {
      navigate(item.to);
      return;
    }
    if (item.message) {
      toast.info(item.message);
      return;
    }
    onOpen(item.key);
  };

  return (
    <main className="flex-1 px-4 py-4 md:px-6">
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-3 md:grid-cols-2">
        {MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleOpen(item)}
              className="group flex min-h-[112px] items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:border-[#90e0ef] hover:bg-slate-50 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#caf0f8] text-[#0077b6] transition-colors group-hover:bg-[#ade8f4]">
                <Icon className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-extrabold text-slate-800 md:text-base">
                {item.label}
              </span>
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </button>
          );
        })}
      </div>
    </main>
  );
}

function ProjectBrowserView({ onBack }) {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoadingProjects(true);
      try {
        const rows = await fetchMsProjects({ q: search, limit: 80 });
        setProjects(rows);
        if (selectedProject && !rows.some((row) => row.project_id === selectedProject.project_id)) {
          setSelectedProject(null);
          setTasks([]);
        }
      } catch (error) {
        toast.error('Failed to load projects', { description: error.message });
      } finally {
        setLoadingProjects(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search, selectedProject]);

  const selectProject = useCallback(async (project) => {
    setSelectedProject(project);
    setLoadingTasks(true);
    try {
      setTasks(await fetchMsProjectTasks(project.project_id));
    } catch (error) {
      toast.error('Failed to load project tasks', { description: error.message });
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase text-[#0077b6]">MS Project Database</p>
          <h2 className="text-base font-extrabold text-slate-800">View All Projects</h2>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
        >
          <ArrowLeft className="h-4 w-4" />
          Menu
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-3">
            <SearchBox value={search} onChange={setSearch} placeholder="Search project..." />
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
            {loadingProjects && (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-6 text-sm font-semibold text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin text-[#0096c7]" />
                Loading projects
              </div>
            )}
            {!loadingProjects && projects.map((project) => (
              <ProjectCard
                key={project.project_id}
                project={project}
                selected={project.project_id === selectedProject?.project_id}
                onClick={selectProject}
              />
            ))}
            {!loadingProjects && projects.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-8 text-center text-sm font-semibold text-slate-400">
                No projects found.
              </div>
            )}
          </div>
        </section>

        <ProjectTaskPanel title="Project Tasks" project={selectedProject} tasks={tasks} loading={loadingTasks} />
      </div>
    </main>
  );
}

export default function ManufacturingSowSchedulingPage() {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState('menu');

  const title = activeView === 'projects'
    ? 'View All Projects'
    : activeView === 'map'
      ? 'Map SAP Operations'
      : activeView === 'schedule'
        ? 'Scheduling Area'
        : 'SOW Scheduling';

  return (
    <PageContainer className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <button
          type="button"
          onClick={() => (activeView === 'menu' ? goBackOrFallback(navigate, '/operations-hub') : setActiveView('menu'))}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="text-center">
          <p className="text-[10px] font-bold uppercase text-[#0077b6]">Manufacturing</p>
          <h1 className="text-sm font-extrabold text-slate-800 md:text-base">{title}</h1>
        </div>
        <div className="h-11 w-[74px]" aria-hidden="true" />
      </header>

      {activeView === 'menu' && <MenuView onOpen={setActiveView} />}
      {activeView === 'projects' && <ProjectBrowserView onBack={() => setActiveView('menu')} />}
      {activeView === 'map' && <MapSapOperationPage onBack={() => setActiveView('menu')} />}
      {activeView === 'schedule' && <SchedulingAreaPage onBack={() => setActiveView('menu')} />}
    </PageContainer>
  );
}
