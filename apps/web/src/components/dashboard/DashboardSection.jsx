/**
 * DashboardSection — a labelled band of related charts.
 *
 * Grouping is the anti-monotony device on this page: the eyebrow says why these panels sit
 * together, so the charts themselves need no decoration to look intentional.
 */
export default function DashboardSection({ label, hint, children }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700 md:text-sm">
          {label}
        </h2>
        {hint && <p className="text-[11px] text-slate-500 md:text-xs">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
