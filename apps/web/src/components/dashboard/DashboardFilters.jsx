import { useEffect, useState } from "react";

const FIELD =
  "min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 transition-colors duration-150 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] motion-reduce:transition-none";
const LABEL = "text-[11px] font-bold uppercase tracking-wide text-slate-500";

export default function DashboardFilters({ filters, onChange }) {
  const [workcenters, setWorkcenters] = useState([]);
  const [listError, setListError] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard/workcenter-list")
      .then((r) => r.json())
      .then((json) => setWorkcenters(json.data || []))
      .catch(() => setListError(true));
  }, []);

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="dash-from" className={LABEL}>
          From
        </label>
        <input
          id="dash-from"
          type="date"
          value={filters.from}
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="dash-to" className={LABEL}>
          To
        </label>
        <input
          id="dash-to"
          type="date"
          value={filters.to}
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
          className={FIELD}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor="dash-workcenter" className={LABEL}>
          Workcenter
        </label>
        <select
          id="dash-workcenter"
          value={filters.workcenter}
          onChange={(e) => onChange({ ...filters, workcenter: e.target.value })}
          className={`${FIELD} w-full md:max-w-sm`}
        >
          <option value="all">All workcenters</option>
          {workcenters.map((w) => (
            <option key={w.workcenter} value={w.workcenter}>
              {w.workcenter}
              {w.workcenter_description ? ` — ${w.workcenter_description}` : ""}
            </option>
          ))}
        </select>
        {listError && (
          <p className="text-[11px] text-status-late">
            Workcenter list unavailable — filtering by All only.
          </p>
        )}
      </div>
    </div>
  );
}
