import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { SkeletonRow } from "../ui/Skeleton";

/**
 * ExceptionPanel — the dashboard's focal point: what is off-plan and what to do about it.
 *
 * Rows come from deriveExceptions(); this component never fetches.
 */

// Hoisted like RouteTransition and rbac/Drawer do: the lint config has no react plugin, so
// `motion.li` used only in JSX reads as an unused import.
const MotionLi = motion.li;

function ExceptionRow({ row, onOpen }) {
  const high = row.severity === "high";
  return (
    <>
      <button
        type="button"
        onClick={() => onOpen(row.href)}
        className="flex min-h-[44px] w-full items-center gap-3 border-l-2 px-4 py-3 text-left transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
        style={{ borderLeftColor: high ? "#b45309" : "#0077b6" }}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-800">{row.subject}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                high
                  ? "border-amber-200 bg-amber-50 text-status-late"
                  : "border-[#90e0ef] bg-[#caf0f8] text-status-running"
              }`}
            >
              {high ? "Act now" : "Watch"}
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">{row.detail}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 text-xs font-semibold text-status-running md:flex">
          {row.action}
          <ChevronRight size={14} />
        </span>
      </button>
    </>
  );
}

export default function ExceptionPanel({ rows, loading, error, onRetry, onOpen }) {
  const reduce = useReducedMotion();
  const count = rows.length;

  return (
    <section
      aria-label="Exceptions"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#0077b6]">
            Needs action
          </p>
          <h2 className="text-sm font-extrabold text-slate-800 md:text-base">
            Operational exceptions
          </h2>
        </div>
        <span className="shrink-0 text-sm font-extrabold tabular-nums text-slate-800">{count}</span>
      </header>

      {loading ? (
        <div className="py-2">
          <SkeletonRow cols={3} />
          <SkeletonRow cols={3} />
        </div>
      ) : error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <p className="flex items-center gap-2 text-xs font-semibold text-status-late md:text-sm">
            <AlertTriangle size={16} />
            One source failed, so this list is incomplete — see the failing panel below.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
            >
              Retry
            </button>
          )}
        </div>
      ) : count === 0 ? (
        <p className="flex items-center gap-2 px-4 py-5 text-xs text-slate-500 md:text-sm">
          <CheckCircle2 size={16} className="text-status-ok" />
          No exceptions — no overdue orders, validation below target, or workcenter over plan.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200">
          <AnimatePresence initial={false}>
            {rows.map((row) =>
              reduce ? (
                <li key={row.id}>
                  <ExceptionRow row={row} onOpen={onOpen} />
                </li>
              ) : (
                <MotionLi
                  key={row.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <ExceptionRow row={row} onOpen={onOpen} />
                </MotionLi>
              )
            )}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
