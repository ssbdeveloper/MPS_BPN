import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ChevronRight, FolderSearch, GripVertical, ListTree, Loader2,
  PackageOpen, Plus, Replace, RotateCw, Target, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  EmptyState, Panel, SearchInput, SegmentedControl, Skeleton, Toolbar,
} from '../../../components';
import {
  fetchMsProjects,
  fetchMsProjectTasks,
  fetchOrderTasks,
  fetchSowOrderOperations,
  fetchSowOrders,
  mapSowOperationToTask,
} from '../../../services/msProjectService';
import { unitMismatchOf } from './unitMismatch';
import { createLatestRequest } from './latestRequest';

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

// Dua sisi halaman ini menyimpan nomor operasi dengan bentuk BERBEDA, dan itu bukan dugaan:
//   sow.operation_no            -> integer  -> JSON 10, 20, 620
//   ms_project_task.operation_no-> text     -> JSON "0010", "0020", "0620"
// Selama kuncinya String(...) mentah, tidak ada satu pun operasi yang pernah cocok, jadi penanda
// "sudah dipetakan" tak pernah muncul dan counter di header selalu 0/N. Semua pencocokan operasi
// di halaman ini WAJIB lewat fungsi ini — di kedua sisi.
function operationKey(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.replace(/^0+(?=.)/, '');
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

// Satu sumber lebar kolom untuk header DAN baris. Dipisah = pasti melenceng.
// text-xs, tanggal 'dd Mon yyyy' butuh ~70px -> kolom 88px cukup dengan padding.
// Kolom UNIT ditambah 2026-09-17: dua order bisa punya part_name & jumlah operasi
// IDENTIK (SB10115AC: UNIT 1 vs UNIT 2), dan tanpa kolom ini planner tidak punya
// cara melihat operasi akan mendarat di unit mana.
const TREE_COLS = 'grid-cols-[minmax(0,1fr)_112px_104px_52px_104px_88px_88px]';

// Sel kosong ditulis eksplisit '—', bukan dibiarkan kosong: justru lubang datanya yang
// perlu terlihat (di prod, 307 task level-2 hanya 13 yang punya plan date).
const DASH = '—';

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

/**
 * TaskTreeNode — chevron & target dipisah TEGAS:
 *   • chevron (kiri) = expand/collapse saja.
 *   • klik nama / tombol Target = jadikan target parent (tanpa efek expand).
 */
function TaskTreeNode({ task, childrenByParent, expandedIds, onToggle, onDropOperation, depth = 0 }) {
  const children = childrenByParent.get(task.task_id) || [];
  const expanded = expandedIds.has(task.task_id);
  const hasChildren = children.length > 0;
  const [dragOver, setDragOver] = useState(false);

  // Node ber-anak = summary. Drop ke summary kini memunculkan pilihan assign/buat-anak
  // (keputusan 2026-09-07 — backend menerima assign ke summary); drop ke daun langsung assign.
  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    onDropOperation(task, hasChildren, event);
  };

  return (
    <div>
      <div
        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`group grid ${TREE_COLS} items-center gap-2 border-b border-slate-100 px-2 transition-colors ${
          dragOver ? 'bg-[#caf0f8] ring-2 ring-inset ring-[#00b4d8]' : 'bg-white hover:bg-slate-50'
        }`}
      >
        {/* Indentasi HANYA pada kolom nama — kolom meta tetap sejajar di semua kedalaman. */}
        <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 18 }}>
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

          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-slate-600">
            {task.outline_number || '-'}
          </span>
          <span className="truncate py-2 text-xs font-extrabold text-slate-800" title={task.task_name || undefined}>
            {task.task_name || '-'}
          </span>
        </div>

        {/* Order + Op ditampilkan berdampingan: satu project bisa memuat beberapa order,
            jadi nomor operasi saja ambigu saat menyisir pohon. */}
        <span
          className="truncate text-xs font-semibold text-slate-600"
          title={task.unit_name || undefined}
        >
          {task.unit_name || DASH}
        </span>
        <span
          className="truncate font-mono text-xs font-semibold tabular-nums text-slate-600"
          title={task.order_no || undefined}
        >
          {task.order_no || DASH}
        </span>
        <span className="truncate font-mono text-xs font-bold tabular-nums text-[#0077b6]">
          {task.operation_no || DASH}
        </span>
        {/* workcenter DITULIS oleh mapping (dari sow.workcenter); plan start/finish TIDAK —
            itu milik file MS Project, jadi task yang baru dipetakan wajar kosong di sini. */}
        <span className="truncate text-xs font-semibold text-slate-600" title={task.workcenter || undefined}>
          {task.workcenter || DASH}
        </span>
        <span className="truncate text-xs tabular-nums text-slate-500">
          {task.plan_start ? formatDate(task.plan_start) : DASH}
        </span>
        <span className="truncate text-xs tabular-nums text-slate-500">
          {task.plan_finish ? formatDate(task.plan_finish) : DASH}
        </span>
      </div>
      {expanded && children.map((child) => (
        <TaskTreeNode
          key={child.task_id}
          task={child}
          childrenByParent={childrenByParent}
          expandedIds={expandedIds}
          onToggle={onToggle}
          onDropOperation={onDropOperation}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

const MAPPED_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'mapped', label: 'Mapped' },
  { key: 'unmapped', label: 'Unmapped' },
];

// Filter di level OPERASI (keputusan 2026-09-04). Sengaja 4 status, bukan 2: kartu operasi
// SUDAH membedakan "di project ini" (hijau) vs "di project lain" (amber), dan dua hal itu
// menuntut keputusan planner yang berbeda — menggabungkannya membuang informasi yang ada.
const OPERATION_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'current', label: 'This project' },
  { key: 'elsewhere', label: 'Elsewhere' },
  { key: 'unmapped', label: 'Unmapped' },
];

// 'current' | 'elsewhere' | 'unmapped' — satu operasi hanya punya satu status.
function operationMappingState(mappedProjects = []) {
  if (mappedProjects.length === 0) return 'unmapped';
  return mappedProjects.some((row) => row.current) ? 'current' : 'elsewhere';
}

// Nama project MS Project panjang ("MPS - 21 Units ISO TANK - ORICA - (PO 02.04.26)"), dan satu
// order boleh dipetakan ke lebih dari satu project. Ditampilkan: nama pertama + "+n", lengkapnya
// di title.
function projectNamesLabel(names = []) {
  if (names.length === 0) return null;
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
}

// Kartu order TIDAK lagi bisa ditarik: yang ditarik ke pohon adalah OPERASI, satu per satu.
// Order di sini hanya dipilih untuk membuka daftar operasinya.
function SowOrderCard({ order, selected, onClick }) {
  const mappedProjects = Array.isArray(order.mapped_projects) ? order.mapped_projects : [];
  return (
    <button
      type="button"
      onClick={() => onClick(order)}
      className={`group flex w-full items-start gap-2 rounded-xl border bg-white p-3 text-left shadow-sm transition-all hover:border-[#90e0ef] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
        selected ? 'border-[#0077b6] ring-2 ring-[#90e0ef]' : 'border-slate-200'
      }`}
    >
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-400" />
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
        {mappedProjects.length > 0 ? (
          <span
            title={mappedProjects.join(' · ')}
            className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-700"
          >
            <FolderSearch className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{projectNamesLabel(mappedProjects)}</span>
          </span>
        ) : (
          <span className="mt-1 block text-[11px] font-semibold text-slate-400">Not mapped</span>
        )}
      </span>
    </button>
  );
}

// Satu operasi = satu kartu yang bisa ditarik. Sebelumnya mapping borongan memaksa SELURUH
// operasi satu order masuk ke satu outline level; planner sering menyusun WBS dengan parent
// berbeda per kelompok operasi, jadi sekarang tiap operasi ditaruh sendiri-sendiri.
// `mappedProjects` = [{ project_id, project_name, current }] — SETIAP project yang sudah memegang
// operasi ini, bukan hanya project target. Nomor outline sengaja tidak ditampilkan: angka "2.1.3"
// tidak memberi tahu planner apa pun tentang di mana operasi itu sudah punya rumah, sedangkan
// nama project persis itulah keputusan yang perlu diambil sebelum menariknya lagi.
function OperationCard({ operation, mappedProjects = [], onDragStart, disabled }) {
  const inCurrentProject = mappedProjects.some((row) => row.current);
  const names = mappedProjects.map((row) => row.project_name || row.project_id).filter(Boolean);
  // Outline number HANYA untuk project yang sedang dibuka. Di project lain angka itu menunjuk
  // pohon yang tidak terlihat planner, jadi tak bermakna (revisi sebagian keputusan 2026-08-07:
  // owner mengizinkan info outline, tapi hanya di tempat yang punya konteks).
  const currentOutline = mappedProjects.find((row) => row.current)?.outline_number || null;
  // Mapping operasi ini ada di project yang sedang dibuka, tapi task sumbernya sudah
  // dinonaktifkan sync (TASK_LOST) — kartu harus bilang, bukan diam seperti dulu.
  const currentLost = mappedProjects.some((row) => row.current && row.source_lost);
  return (
    <div
      draggable={!disabled}
      onDragStart={disabled ? undefined : (event) => onDragStart(event, operation)}
      className={`cursor-grab rounded-lg border bg-white px-3 py-2 shadow-sm transition-colors active:cursor-grabbing ${
        inCurrentProject && !currentLost
          ? 'border-emerald-200 bg-emerald-50/50'
          : currentLost
            ? 'border-amber-300 bg-amber-50/60'
            : 'border-slate-200 hover:border-[#90e0ef] hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
          <span className="font-mono text-xs font-extrabold tabular-nums text-[#0077b6]">Op {operation.operation_no}</span>
          {currentOutline && (
            <span
              title={`Outline ${currentOutline} di project ini`}
              className="rounded border border-emerald-200 bg-emerald-50 px-1 font-mono text-[11px] font-bold tabular-nums text-emerald-700"
            >
              {currentOutline}
            </span>
          )}
          {currentLost && (
            <span
              title="Task sumber jadwal operasi ini hilang pada sync MS Project. Tarik kartu ini ke task daun baru untuk memetakan ulang."
              className="rounded border border-amber-300 bg-amber-100 px-1 text-[11px] font-bold uppercase tracking-wide text-amber-700"
            >
              Task lost — remap
            </span>
          )}
        </span>
        <span className="text-xs font-semibold tabular-nums text-slate-500">{formatHours(operation.planhours)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs font-bold text-slate-700">{operation.operation_text || '-'}</p>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-slate-500">{operation.workcenter || operation.wct_group || '-'}</p>
        {names.length > 0 && (
          <span
            title={names.join(' · ')}
            className={`inline-flex min-w-0 max-w-[60%] items-center gap-1 rounded-full border px-1.5 text-[11px] font-bold ${
              inCurrentProject
                ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
                : 'border-amber-200 bg-amber-100 text-amber-700'
            }`}
          >
            {!inCurrentProject && <FolderSearch className="h-3 w-3 shrink-0" aria-hidden="true" />}
            <span className="truncate">{projectNamesLabel(names)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function OperationList({ operations, mappedProjectsByOperation, onDragStart, disabled, filter = 'all' }) {
  const visible = filter === 'all'
    ? operations
    : operations.filter((operation) => (
      operationMappingState(mappedProjectsByOperation.get(operationKey(operation.operation_no)) || []) === filter
    ));

  if (visible.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-xs font-semibold text-slate-400">
        No operations match this filter.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {sortByOperationNo(visible).map((operation) => (
        <OperationCard
          key={operation.idsow}
          operation={operation}
          mappedProjects={mappedProjectsByOperation.get(operationKey(operation.operation_no)) || []}
          onDragStart={onDragStart}
          disabled={disabled}
        />
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
  if (code === 'TARGET_TASK_OCCUPIED') {
    const held = details[0] || {};
    return {
      title: 'Task already used',
      description: held.operation_no
        ? `That node holds order ${held.order_no} op ${held.operation_no}.`
        : 'That node already holds another operation.',
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

// Operasi yang ditarik berasal dari order X; task tujuan bernaung di bawah UNIT yang
// order_no-nya Y. Implementasi + alasannya ada di ./unitMismatch.js (dipisah karena
// file page hanya boleh meng-export komponen).

// Banner peringatan beda-unit, dipakai di ReplaceDialog DAN SummaryTargetDialog supaya
// tidak ada jalur drop yang diam-diam melewatkannya.
function UnitMismatchWarning({ mismatch }) {
  if (!mismatch) return null;
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <p className="text-xs font-semibold text-amber-800">
        Beda unit — target ada di bawah <span className="font-extrabold">{mismatch.unitName}</span>{' '}
        (order {mismatch.unitOrder}), tapi operasi ini milik order {mismatch.draggedOrder}.
        Lanjutkan hanya kalau memang disengaja.
      </p>
    </div>
  );
}

// Konfirmasi menimpa pemetaan yang sudah ada. Sengaja DIALOG, bukan action-toast: toast
// menghilang sendiri, sedangkan ini keputusan yang menghapus pemetaan operasi lain.
function ReplaceDialog({ prompt, busy, onCancel, onConfirm }) {
  useEffect(() => {
    if (!prompt) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [prompt, onCancel]);

  if (!prompt) return null;
  // Peringatan BEDA UNIT. Audit 2026-09-12 menunjukkan dialog ini di-klik "Replace"
  // dua kali berlawanan arah pada task yang sama: pesannya hanya menyebut order+op —
  // angka yang tak bermakna bagi planner — dan tidak pernah menyebut bahwa operasi
  // sedang ditaruh di rumah unit LAIN. Itu akar 22 baris mapping salah unit di prod.
  const unitMismatch = unitMismatchOf(prompt.dragged, prompt.task);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={prompt.title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-slate-800">{prompt.title}</h3>
            <p className="mt-1 text-xs text-slate-600">{prompt.description}</p>
            <p className="mt-2 text-xs font-semibold text-slate-700">
              Replace with op {prompt.dragged.operation_no} of {prompt.dragged.order_no}?
            </p>
          </div>
        </div>
        <UnitMismatchWarning mismatch={unitMismatch} />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-bold text-white transition hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Replace className="h-4 w-4" />}
            {prompt.confirmLabel || 'Replace'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Drop operasi ke node SUMMARY (ber-anak): keputusan 2026-09-07 — assign ke summary kini
// sah (reservasi & jadwal boleh nempel di task mana pun; summary membawa tanggal rollup
// anak-anaknya). "Buat anak baru" tetap tersedia tapi jadi pilihan eksplisit, bukan tebakan.
function SummaryTargetDialog({ prompt, busy, onCancel, onAssign, onCreateChild }) {
  useEffect(() => {
    if (!prompt) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [prompt, onCancel]);

  if (!prompt) return null;
  const { dragged, task } = prompt;
  const unitMismatch = unitMismatchOf(dragged, task);
  const hasDates = Boolean(task.plan_start || task.plan_finish);
  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm" data-modal-overlay="true">{/* deslop-allow C5: dialog overlay — pola sama dengan ReplaceDialog di file ini (C5 membaca path file, bukan baris) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Summary task target"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#caf0f8] text-[#0077b6]">
            <FolderSearch className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-slate-800">
              Op {dragged.operation_no} · {dragged.order_no} → “{task.task_name}”
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              {task.outline_number ? `${task.outline_number} · ` : ''}This node is a summary
              {hasDates
                ? ` — its schedule spans ${formatDate(task.plan_start)} to ${formatDate(task.plan_finish)} (roll-up of its children).`
                : ' — it has no schedule dates yet.'}
            </p>
          </div>
        </div>
        <UnitMismatchWarning mismatch={unitMismatch} />
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            autoFocus
            onClick={onAssign}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-bold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Target className="h-4 w-4" />}
            Assign to this task
          </button>
          <button
            type="button"
            onClick={onCreateChild}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            <Plus className="h-4 w-4" />
            Create child task
            <span className="text-[11px] font-semibold text-slate-400">no dates until added in MS Project</span>
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg text-xs font-bold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
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
  const [expandedTaskIds, setExpandedTaskIds] = useState(() => new Set());
  const [sowOrders, setSowOrders] = useState([]);
  const [sowSearch, setSowSearch] = useState('');
  // 'all' | 'mapped' | 'unmapped' — DIKIRIM KE SERVER, tidak disaring di klien: daftar order
  // dipaginasi (limit 80), jadi menyaring halaman yang kebetulan termuat akan menampilkan
  // jumlah yang salah dan menyembunyikan order yang belum sempat diambil.
  const [sowMappedFilter, setSowMappedFilter] = useState('all');
  const [sowError, setSowError] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [operationFilter, setOperationFilter] = useState('all');
  const [operations, setOperations] = useState([]);
  // Task order terpilih di SELURUH project (bukan hanya project aktif) — dasar penanda
  // "operasi ini sudah ada di project mana". Gagal ambil = penanda tidak muncul, panel
  // operasi tetap jalan; ini informasi tambahan, bukan syarat kerja.
  const [orderTasksAllProjects, setOrderTasksAllProjects] = useState([]);
  const [sowLoading, setSowLoading] = useState(false);
  // Dibuat sekali seumur page: debounce 250 ms hanya mencegah request yang BELUM mulai;
  // request lama yang sudah terbang tetap bisa selesai belakangan dan menimpa hasil terbaru.
  // Koordinator ini meng-abort request sebelumnya setiap pencarian/filter baru.
  const sowOrderRequestRef = useRef(null);
  const sowOrderRequestSeqRef = useRef(0);
  if (!sowOrderRequestRef.current) {
    sowOrderRequestRef.current = createLatestRequest((params, options) => fetchSowOrders(params, options));
  }
  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState(null);
  const [mapping, setMapping] = useState(false);
  // Panel kiri dua tingkat: 'orders' (pilih order) -> 'operations' (tarik satu per satu).
  const [sourceView, setSourceView] = useState('orders');
  // { dragged, task, asChild, title, description } saat backend menolak 409 yang bisa ditimpa.
  const [replacePrompt, setReplacePrompt] = useState(null);
  // Drop operasi ke node SUMMARY (ber-anak): keputusan 2026-09-07 — assign ke summary
  // DIIZINKAN (jadwal ikut tanggal rollup-nya), jadi user memilih sendiri: tempel ke
  // summary ini, atau buat anak baru di bawahnya.
  const [summaryPrompt, setSummaryPrompt] = useState(null);

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
    const seq = ++sowOrderRequestSeqRef.current;
    setSowLoading(true);
    setSowError(null);
    try {
      const rows = await sowOrderRequestRef.current.run({
        q: sowSearch,
        mapped: sowMappedFilter,
        limit: 80,
      });
      if (seq === sowOrderRequestSeqRef.current) setSowOrders(rows);
    } catch (error) {
      // AbortError = pencarian baru sudah dimulai; bukan kegagalan yang perlu ditampilkan.
      if (error?.name !== 'AbortError' && seq === sowOrderRequestSeqRef.current) {
        setSowError(error.message);
      }
    } finally {
      if (seq === sowOrderRequestSeqRef.current) setSowLoading(false);
    }
  }, [sowSearch, sowMappedFilter]);

  useEffect(() => {
    const timer = setTimeout(loadSowOrders, 250);
    return () => clearTimeout(timer);
  }, [loadSowOrders]);

  useEffect(() => () => sowOrderRequestRef.current?.cancel(), []);

  const loadProjectTasks = useCallback(async (project) => {
    setSelectedProject(project);
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
    setTaskError(null);
    setExpandedTaskIds(new Set());
  }, []);

  // Dipisah dari loadOperations supaya bisa dipanggil ulang setelah mapping berhasil,
  // dan supaya kegagalannya tidak pernah menjatuhkan panel operasi.
  const loadOrderTasksAllProjects = useCallback(async (orderNo) => {
    if (!orderNo) {
      setOrderTasksAllProjects([]);
      return;
    }
    try {
      setOrderTasksAllProjects(await fetchOrderTasks(orderNo));
    } catch {
      setOrderTasksAllProjects([]);
    }
  }, []);

  const loadOperations = useCallback(async (order) => {
    setSelectedOrder(order);
    setSourceView('operations');
    setOperationLoading(true);
    setOperationError(null);
    loadOrderTasksAllProjects(order?.order_no);
    try {
      setOperations(await fetchSowOrderOperations(order.order_no));
    } catch (error) {
      setOperationError(error.message);
    } finally {
      setOperationLoading(false);
    }
  }, [loadOrderTasksAllProjects]);

  // Filter operasi kembali ke "All" tiap ganti order — filter order sebelumnya bisa
  // menyembunyikan seluruh isi order berikutnya dan terlihat seperti data kosong.
  useEffect(() => {
    setOperationFilter('all');
  }, [selectedOrder?.order_no]);

  // Satu operasi dibawa sebagai JSON; node tujuan yang menentukan assign vs buat-anak.
  const handleOperationDragStart = useCallback((event, operation) => {
    if (!selectedOrder) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/json', JSON.stringify({
      order_no: selectedOrder.order_no,
      operation_no: String(operation.operation_no),
    }));
    event.dataTransfer.setData('text/plain', `Op ${operation.operation_no}`);
  }, [selectedOrder]);

  const mapOneOperation = useCallback(async (dragged, task, asChild, takeover) => {
    setMapping(true);
    try {
      const result = await mapSowOperationToTask(selectedProject.project_id, {
        order_no: dragged.order_no,
        operation_no: dragged.operation_no,
        ...(asChild ? { target_parent_task_id: task.task_id } : { target_task_id: task.task_id }),
        ...(takeover ? { takeover: true } : {}),
      });
      toast.success(`Op ${dragged.operation_no} mapped`, {
        description: [result.task?.outline_number, result.task?.task_name].filter(Boolean).join(' · ') || undefined,
      });
      setProjectTasks(await fetchMsProjectTasks(selectedProject.project_id));
      loadOrderTasksAllProjects(dragged.order_no);
      // Keanggotaan mapped/unmapped sebuah order BERUBAH tepat di sini. Tanpa muat ulang,
      // order yang baru saja dipetakan tetap tampil di tab "Unmapped" begitu user menekan
      // Back — daftar order hanya dimuat ulang saat search/filter berubah.
      loadSowOrders();
      if (asChild) setExpandedTaskIds((prev) => new Set([...prev, task.task_id]));
    } catch (error) {
      const { title, description } = mappingErrorText(error);
      const canReplace = !takeover
        && (error.code === 'ORDER_MAPPED_ELSEWHERE' || error.code === 'TARGET_TASK_OCCUPIED');
      if (canReplace) {
        // Menimpa pemetaan yang sudah ada adalah keputusan user, bukan default —
        // diam-diam menimpanya menghilangkan pemetaan yang benar tanpa jejak. Dialog,
        // bukan toast: toast bisa keburu hilang sebelum dibaca, dan ini keputusan yang
        // menghapus pemetaan orang lain.
        setReplacePrompt({ dragged, task, asChild, title, description });
      } else {
        toast.error(title, { description });
      }
    } finally {
      setMapping(false);
    }
  }, [selectedProject, loadOrderTasksAllProjects, loadSowOrders]);

  const handleDropOperation = useCallback((task, hasChildren, event) => {
    const raw = event.dataTransfer?.getData('application/json');
    if (!raw) return;
    let dragged = null;
    try { dragged = JSON.parse(raw); } catch { return; }
    if (!dragged?.order_no || dragged.operation_no == null) return;
    if (!selectedProject) {
      toast.error('Choose a target project first');
      return;
    }
    // Node ber-anak = summary. Assign ke summary kini sah (keputusan 2026-09-07), tapi
    // "buat anak" juga masih ada — tanya user, jangan menebak.
    if (hasChildren) {
      setSummaryPrompt({ dragged, task });
      return;
    }
    // Daun KOSONG: dulu langsung dipetakan tanpa dialog apa pun — dan justru inilah
    // jalur yang dipakai saat operasi UNIT 1 mendarat di subtree UNIT 2 (prod, 22 baris
    // mapping salah unit). Kalau unit target berbeda dengan order yang ditarik, tahan
    // dan minta konfirmasi; kalau unitnya cocok, perilaku lama dipertahankan (tanpa
    // dialog) supaya kerja normal tidak jadi lebih lambat.
    if (unitMismatchOf(dragged, task)) {
      setReplacePrompt({
        dragged,
        task,
        asChild: false,
        title: 'Beda unit',
        description: `Task ini bernaung di bawah ${task.unit_name || 'unit lain'}.`,
        confirmLabel: 'Map anyway',
      });
      return;
    }
    mapOneOperation(dragged, task, false, false);
  }, [selectedProject, mapOneOperation]);

  const handleSummaryCancel = useCallback(() => setSummaryPrompt(null), []);

  const handleSummaryAssign = useCallback(() => {
    if (!summaryPrompt) return;
    const { dragged, task } = summaryPrompt;
    setSummaryPrompt(null);
    mapOneOperation(dragged, task, false, false);
  }, [summaryPrompt, mapOneOperation]);

  const handleSummaryCreateChild = useCallback(() => {
    if (!summaryPrompt) return;
    const { dragged, task } = summaryPrompt;
    setSummaryPrompt(null);
    mapOneOperation(dragged, task, true, false);
  }, [summaryPrompt, mapOneOperation]);

  const handleReplaceCancel = useCallback(() => setReplacePrompt(null), []);

  const handleReplaceConfirm = useCallback(() => {
    if (!replacePrompt) return;
    const { dragged, task, asChild } = replacePrompt;
    setReplacePrompt(null);
    mapOneOperation(dragged, task, asChild, true);
  }, [replacePrompt, mapOneOperation]);

  const toggleTaskExpand = useCallback((taskId) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  // Operasi order terpilih yang sudah punya task di project ini -> ditandai di kartunya
  // supaya planner tahu mana yang belum ditaruh tanpa menyisir pohon.
  const mappedByOperation = useMemo(() => {
    const map = new Map();
    if (!selectedOrder) return map;
    const key = String(selectedOrder.order_no).replace(/^0+/, '');
    projectTasks.forEach((task) => {
      if (!task.operation_no || !task.order_no) return;
      if (String(task.order_no).replace(/^0+/, '') !== key) return;
      map.set(operationKey(task.operation_no), task);
    });
    return map;
  }, [projectTasks, selectedOrder]);

  // SEMUA project yang memegang tiap operasi order terpilih — project aktif maupun bukan.
  // Project aktif diambil dari projectTasks, bukan dari orderTasksAllProjects: hanya sumber itu
  // yang dijamin segar tepat setelah mapping berhasil (loadOrderTasksAllProjects sengaja tidak
  // di-await) dan penandanya tetap muncul kalau fetchOrderTasks gagal.
  const mappedProjectsByOperation = useMemo(() => {
    const map = new Map();
    const currentProjectId = selectedProject?.project_id;
    const add = (operationNo, projectId, projectName, current, outlineNumber, mappingStatus) => {
      const key = operationKey(operationNo);
      if (!key || !projectId) return;
      const rows = map.get(key) || [];
      if (rows.some((row) => row.project_id === projectId)) return; // satu project sekali
      rows.push({
        project_id: projectId,
        project_name: projectName,
        current,
        outline_number: outlineNumber || null,
        // Mapping yang task-nya sudah mati oleh sync (sumber: fetchOrderTasks
        // ber-mapping_status). Task hidup dari projectTasks tak mungkin TASK_LOST.
        source_lost: mappingStatus === 'TASK_LOST',
      });
      map.set(key, rows);
    };

    mappedByOperation.forEach((task, operationNo) => {
      add(operationNo, currentProjectId, selectedProject?.project_name, true, task?.outline_number, 'READY');
    });
    orderTasksAllProjects.forEach((task) => {
      // Baris tanpa project_id = operasi belum dipetakan sama sekali (bentuk baru
      // fetchOrderTasks menyertakan semua operasi sow, bukan hanya yang punya task).
      if (!task.operation_no || !task.project_id) return;
      add(
        task.operation_no,
        task.project_id,
        task.project_name,
        task.project_id === currentProjectId,
        task.outline_number,
        task.mapping_status,
      );
    });

    // Project aktif selalu di depan: itu yang menentukan warna badge dan nama yang terlihat
    // saat satu operasi dipetakan di beberapa project.
    map.forEach((rows) => rows.sort((a, b) => Number(b.current) - Number(a.current)));
    return map;
  }, [mappedByOperation, orderTasksAllProjects, selectedProject]);

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 bg-canvas px-4 py-4 md:px-6">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
        {/* ── SUMBER: SOW Orders ─────────────────────────────── */}
        <Panel elevated className="min-h-[540px] lg:min-h-0">
          {/* Panel kiri DUA TINGKAT. Tingkat 1 memilih order; begitu terpilih, daftar order
              disembunyikan dan digantikan daftar operasinya, karena yang ditarik ke pohon
              adalah operasi SATU PER SATU — bukan seluruh order sekaligus. */}
          {sourceView === 'orders' ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#0077b6]">Source</p>
                  <h3 className="text-sm font-extrabold text-slate-800">SOW orders</h3>
                </div>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-500">
                  {sowOrders.length}
                </span>
              </div>

              <Toolbar className="flex-col items-stretch gap-3">
                <SearchInput value={sowSearch} onChange={setSowSearch} placeholder="Search order or part" />
                <SegmentedControl
                  items={MAPPED_FILTERS.map((item) => ({ key: item.key, label: item.label }))}
                  value={sowMappedFilter}
                  onChange={setSowMappedFilter}
                  ariaLabel="MS Project mapping filter"
                />
              </Toolbar>

              <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
                {sowLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[74px] w-full rounded-xl" />)
                ) : sowError ? (
                  <PanelError message={sowError} onRetry={loadSowOrders} />
                ) : sowOrders.length === 0 ? (
                  <EmptyState
                    icon={PackageOpen}
                    title="No orders"
                    description={
                      sowMappedFilter === 'all'
                        ? 'No SOW order matches this search.'
                        : `No ${sowMappedFilter} SOW order matches this search.`
                    }
                  />
                ) : (
                  sowOrders.map((order) => (
                    <SowOrderCard
                      key={order.order_no}
                      order={order}
                      selected={order.order_no === selectedOrder?.order_no}
                      onClick={loadOperations}
                    />
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-2">
                <button
                  type="button"
                  onClick={() => setSourceView('orders')}
                  className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                >
                  <ChevronRight className="h-4 w-4 rotate-180" aria-hidden="true" />
                  Back
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-extrabold tabular-nums text-slate-800">
                    {selectedOrder?.order_no || '-'}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {selectedOrder?.part_name || selectedOrder?.ssbr_id || '-'}
                  </p>
                </div>
                {operationLoading || mapping ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#00b4d8]" />
                ) : (
                  <span
                    title="Operations already mapped in this project"
                    className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-500"
                  >
                    {mappedByOperation.size}/{operations.length}
                  </span>
                )}
              </div>

              <div
                role="group"
                aria-label="Operation mapping filter"
                className="grid shrink-0 grid-cols-4 gap-1 border-b border-slate-200 bg-white px-3 pb-3 pt-0"
              >
                {OPERATION_FILTERS.map((item) => {
                  const active = item.key === operationFilter;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setOperationFilter(item.key)}
                      className={`inline-flex min-h-[34px] items-center justify-center rounded-md px-1.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none ${
                        active ? 'bg-[#caf0f8] text-[#0077b6] shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-auto bg-slate-50 p-3">
                {operationLoading ? (
                  Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[76px] w-full rounded-lg" />)
                ) : operationError ? (
                  <PanelError message={operationError} onRetry={() => loadOperations(selectedOrder)} />
                ) : operations.length === 0 ? (
                  <EmptyState icon={ListTree} title="No operations" />
                ) : (
                  <OperationList
                    operations={operations}
                    mappedProjectsByOperation={mappedProjectsByOperation}
                    onDragStart={handleOperationDragStart}
                    disabled={mapping}
                    filter={operationFilter}
                  />
                )}
              </div>

              <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
                Drag one operation onto a node. Leaf node = assign, parent node = add as child.
              </p>
            </>
          )}
        </Panel>

        {/* ── TARGET: Project + Task Tree ────────────────────── */}
        <Panel elevated className="relative min-h-[540px] lg:min-h-0">
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
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Pohon task */}
              <div className="flex min-h-0 flex-col overflow-hidden border-b border-slate-200 xl:border-b-0 xl:border-r">
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-[#caf0f8] px-3 py-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-700">Project tree</span>
                  <span className="truncate text-xs text-slate-500">Drop an operation on a row</span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {/* Header kolom ikut men-scroll secara horizontal bersama barisnya karena
                      berada di dalam kontainer yang sama dan memakai TREE_COLS yang sama. */}
                  {!taskLoading && !taskError && taskTree.roots.length > 0 && (
                    <div className={`sticky top-0 z-10 grid ${TREE_COLS} items-center gap-2 border-b border-slate-200 bg-white px-2 py-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500`}>
                      <span>Task</span>
                      <span>Unit</span>
                      <span>Order</span>
                      <span>Op</span>
                      <span>Workcenter</span>
                      <span>Start</span>
                      <span>Finish</span>
                    </div>
                  )}
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
                        onDropOperation={handleDropOperation}
                        key={task.task_id}
                        task={task}
                        childrenByParent={taskTree.byParent}
                        expandedIds={expandedTaskIds}
                        onToggle={toggleTaskExpand}
                      />
                    ))
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
        </Panel>
      </div>

      <ReplaceDialog
        prompt={replacePrompt}
        busy={mapping}
        onCancel={handleReplaceCancel}
        onConfirm={handleReplaceConfirm}
      />
      <SummaryTargetDialog
        prompt={summaryPrompt}
        busy={mapping}
        onCancel={handleSummaryCancel}
        onAssign={handleSummaryAssign}
        onCreateChild={handleSummaryCreateChild}
      />
    </main>
  );
}
