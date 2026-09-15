import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ChevronDown, History } from 'lucide-react';
import { DataCells, MetricCell, ProgressCell, ROW_GRID, TrendFlag } from './ProgressVisuals';
import { healthMeta, number, shortDate } from './progressFormat';

const MotionDiv = motion.div;
const collapse = { initial: { height: 0, opacity: 0 }, animate: { height: 'auto', opacity: 1 }, exit: { height: 0, opacity: 0 } };
const footerButton = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-[#0077b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none';

function isToday(value) {
  if (!value) return false;
  const date = new Date(value);
  const today = new Date();
  return !Number.isNaN(date.getTime()) && date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
}

function Subtask({ subtask, operation, onEvidence }) {
  const current = isToday(subtask.latest_update_at);
  const UpdateIcon = current ? CheckCircle2 : AlertTriangle;
  return (
    <div data-testid={`subtask-${subtask.id}`} className={`${ROW_GRID} min-h-[42px] border-t border-slate-100 py-2 pl-12 pr-4`}>
      <div className="min-w-0 border-l-2 border-slate-300 pl-3">
        <p className="truncate text-xs font-semibold text-slate-600">{subtask.title}</p>
        {subtask.latest_issue && <p className="truncate text-[11px] text-rose-600">{subtask.latest_issue}</p>}
      </div>
      <MetricCell label="Plan" value={number(subtask.standard_hours)} />
      <span aria-hidden="true" />
      <ProgressCell progress={subtask.progress_pct} />
      <span className={`flex items-center justify-center gap-1 whitespace-nowrap text-[11px] font-semibold ${current ? 'text-emerald-700' : 'text-amber-700'}`}>
        <UpdateIcon size={13} aria-hidden="true" /> Last update {shortDate(subtask.latest_update_at) || '—'}
      </span>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <button type="button" onClick={() => onEvidence({ ...operation, subtasks: [subtask], history_scope: 'subtask', history_title: subtask.title })} aria-label={`View update history for ${subtask.title}`} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-[#0077b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none">
        <History size={14} aria-hidden="true" /> History
      </button>
    </div>
  );
}

export default function OperationCard({ operation, onEvidence }) {
  const [expanded, setExpanded] = useState(false);
  const reduce = useReducedMotion();
  const subtasks = operation.subtasks || [];
  const meta = healthMeta(operation.health);

  return (
    <article data-testid={`operation-${operation.idsow}`} className="relative bg-white">
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${meta.rail}`} />
      <div className={`${ROW_GRID} px-4 py-2.5 pl-6`}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-slate-800">{operation.operation_text || 'Unnamed operation'}</h4>
            <TrendFlag trend={operation.update_trend} />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-400"><span className="font-mono">{operation.order_no}</span> · Op {operation.operation_no}{operation.workcenter ? ` · ${operation.workcenter}` : ''}</p>
        </div>
        <DataCells item={operation} />
        <button type="button" onClick={() => onEvidence(operation)} aria-label={`View update history for order ${operation.order_no} operation ${operation.operation_no}`} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-[#0077b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none">
          <History size={15} aria-hidden="true" /> History
        </button>
      </div>

      {subtasks.length > 0 && (
        <div className="flex justify-start border-t border-slate-100 px-4 pl-6">
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className={footerButton}>
            <MotionDiv animate={{ rotate: expanded ? 180 : 0 }} transition={reduce ? { duration: 0 } : undefined}><ChevronDown size={14} /></MotionDiv>
            {expanded ? 'Hide' : 'Show'} {subtasks.length} sub-tasks
          </button>
        </div>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <MotionDiv key="subtasks" {...(reduce ? {} : collapse)} transition={{ duration: 0.16 }} className="overflow-hidden bg-slate-50/70">
            {subtasks.map((subtask) => <Subtask key={subtask.id} subtask={subtask} operation={operation} onEvidence={onEvidence} />)}
          </MotionDiv>
        )}
      </AnimatePresence>
    </article>
  );
}
