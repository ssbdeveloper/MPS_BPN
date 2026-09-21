import { SkeletonText } from "../ui/Skeleton";

/**
 * ConditionReadout — instrument strip, not a card grid.
 *
 * Four readings of the same operational condition belong on one surface: the operator reads
 * them as a single line, and only the exception (overdue > 0) earns the accent.
 */

const NUMERIC = "text-xl font-extrabold leading-tight tabular-nums md:text-2xl";

function Reading({ label, value, unit, hint, accent }) {
  return (
    <div className="min-w-0 flex-1 px-4 py-3 md:px-5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={accent ? `${NUMERIC} text-status-late` : `${NUMERIC} text-slate-800`}>
        {value}
        {unit && <span className="ml-1 text-xs font-semibold text-slate-500">{unit}</span>}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export default function ConditionReadout({ kpi, loading, error, onRetry }) {
  if (loading) {
    return (
      <section
        aria-label="Operational condition"
        className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
      >
        <SkeletonText lines={2} />
      </section>
    );
  }

  if (error) {
    return (
      <section
        aria-label="Operational condition"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
      >
        <p className="text-xs font-semibold text-status-late md:text-sm">
          Could not load the condition figures — check the connection and retry.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
        >
          Retry
        </button>
      </section>
    );
  }

  const overdue = kpi ? kpi.overdue_orders : 0;

  return (
    <section
      aria-label="Operational condition"
      className="flex flex-wrap divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-sm md:flex-nowrap md:divide-x"
    >
      <Reading label="Active orders" value={kpi ? kpi.active_orders.toLocaleString() : "—"} />
      <Reading
        label="Overdue orders"
        value={kpi ? overdue.toLocaleString() : "—"}
        accent={overdue > 0}
        hint={overdue > 0 ? "Past plan finish, below 100%" : "None past plan finish"}
      />
      <Reading label="Hours today" value={kpi ? kpi.today_hours.toLocaleString() : "—"} unit="hrs" />
      <Reading label="Avg progress" value={kpi ? kpi.avg_progress.toLocaleString() : "—"} unit="%" />
    </section>
  );
}
