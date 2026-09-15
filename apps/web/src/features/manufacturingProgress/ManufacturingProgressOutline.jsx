import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, FolderKanban, Layers3 } from 'lucide-react';
import OperationCard from './OperationCard';
import { DataCells, GridHeading, ROW_GRID } from './ProgressVisuals';

const MotionDiv = motion.div;
const collapse = { initial: { height: 0, opacity: 0 }, animate: { height: 'auto', opacity: 1 }, exit: { height: 0, opacity: 0 } };

function ExpandIcon({ expanded }) {
  const reduce = useReducedMotion();
  return (
    <MotionDiv animate={{ rotate: expanded ? 90 : 0 }} transition={reduce ? { duration: 0 } : undefined} className="shrink-0 text-slate-500">
      <ChevronRight size={17} aria-hidden="true" />
    </MotionDiv>
  );
}

function ScopeName({ expanded, icon, label, count }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ExpandIcon expanded={expanded} />
      {icon}
      <span className="min-w-0 truncate text-sm font-semibold text-slate-800">{label}</span>
      <span className="whitespace-nowrap text-[11px] text-slate-400">{count} ops</span>

    </span>
  );
}

function ProjectHeader({ project, expanded, count, onClick }) {
  return (
    <button type="button" aria-expanded={expanded} onClick={onClick} className={`${ROW_GRID} min-h-[44px] w-full bg-[#eef2f6] px-4 py-2.5 text-left transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b4d8] motion-reduce:transition-none`}>
      <ScopeName expanded={expanded} icon={<FolderKanban size={16} className="shrink-0 text-[#0077b6]" />} label={project.project_name} count={count} />
      <DataCells item={project} />
      <span aria-hidden="true" />
    </button>
  );
}

function UnitHeader({ unit, expanded, count, onClick }) {
  return (
    <button type="button" aria-expanded={expanded} onClick={onClick} className={`${ROW_GRID} min-h-[44px] w-full border-l-4 border-slate-300 bg-white px-4 py-2 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b4d8] motion-reduce:transition-none`}>
      <ScopeName expanded={expanded} icon={<Layers3 size={15} className="shrink-0 text-slate-500" />} label={unit.unit_name || 'No Unit'} count={count} />
      <DataCells item={unit} />
      <span aria-hidden="true" />
    </button>
  );
}

function Unit({ unit, onEvidence }) {
  const [expanded, setExpanded] = useState(false);
  const reduce = useReducedMotion();
  const operations = unit.operations || [];
  return (
    <section>
      <UnitHeader unit={unit} expanded={expanded} count={operations.length} onClick={() => setExpanded((value) => !value)} />
      <AnimatePresence initial={false}>
        {expanded && (
          <MotionDiv key="ops" {...(reduce ? {} : collapse)} transition={{ duration: 0.16 }} className="overflow-hidden border-l-4 border-slate-100 bg-white">
            <div className="divide-y divide-slate-100">
              {operations.map((operation) => <OperationCard key={operation.idsow} operation={operation} onEvidence={onEvidence} />)}
            </div>
          </MotionDiv>
        )}
      </AnimatePresence>
    </section>
  );
}

export default function ManufacturingProgressOutline({ projects, onEvidence }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const reduce = useReducedMotion();
  const toggle = (id) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-3">
      <GridHeading />
      {projects.map((project) => {
        const open = expanded.has(project.project_id);
        const units = project.units || [];
        const count = units.reduce((sum, unit) => sum + (unit.operations || []).length, 0);
        return (
          <section key={project.project_id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <ProjectHeader project={project} expanded={open} count={count} onClick={() => toggle(project.project_id)} />
            <AnimatePresence initial={false}>
              {open && (
                <MotionDiv key="units" {...(reduce ? {} : collapse)} transition={{ duration: 0.18 }} className="overflow-hidden divide-y divide-slate-100">
                  {units.map((unit) => <Unit key={unit.unit_key} unit={unit} onEvidence={onEvidence} />)}
                </MotionDiv>
              )}
            </AnimatePresence>
          </section>
        );
      })}
    </div>
  );
}
