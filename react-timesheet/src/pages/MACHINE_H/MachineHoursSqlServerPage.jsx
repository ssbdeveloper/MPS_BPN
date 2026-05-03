import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronRight,
  Clock3,
  Database,
  Filter,
  Gauge,
  Layers3,
  RefreshCw,
  Search,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

function todayMinus(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function buildQuery(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (key === "status") return;
    if (value !== "" && value != null) params.set(key, value);
  });
  return params.toString();
}

function buildHttpUrl(path, query) {
  const base = API_BASE.replace(/\/$/, "");
  return `${base}${path}${query ? `?${query}` : ""}`;
}

function buildWsUrl(path, query) {
  const base = API_BASE.replace(/\/$/, "");

  if (/^https?:\/\//i.test(base)) {
    const url = new URL(`${base}${path}${query ? `?${query}` : ""}`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${base}${path}${query ? `?${query}` : ""}`;
}

function fmtHours(value) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function fmtDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function makeMachineKey(row) {
  return `${row.machineno ?? "unknown"}-${row.machineid || "machine"}`;
}

function StatusPill({ status }) {
  const label = status || "Unknown";
  const normalized = label.toLowerCase();
  const className = normalized.includes("productive")
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : normalized.includes("idle")
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : normalized.includes("off")
        ? "bg-slate-100 text-slate-600 border-slate-200"
        : normalized.includes("unidentified")
          ? "bg-violet-50 text-violet-700 border-violet-200"
          : "bg-sky-50 text-sky-700 border-sky-200";

  return (
    <span className={`inline-flex min-w-24 items-center justify-center rounded-full border px-2.5 py-1 text-xs font-bold ${className}`}>
      {label}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sublabel, accent }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
          {sublabel ? <p className="mt-0.5 text-xs font-medium text-slate-500">{sublabel}</p> : null}
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-md ${accent}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function MachineGroup({ group, expanded, onToggle }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => onToggle(group.key)}
        className="grid w-full grid-cols-1 gap-3 border-l-4 border-cyan-600 bg-white px-4 py-3 text-left transition hover:bg-slate-50 lg:grid-cols-[1.5fr_0.7fr_0.7fr_0.7fr_0.7fr]"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-cyan-50 text-cyan-700 transition-transform"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            <ChevronRight className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-900">{group.machineName}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
              <span>{group.machineId}</span>
              <span>Machine No. {group.machineNo}</span>
              <span>Plant {group.plantId ?? "-"}</span>
            </div>
          </div>
        </div>

        <div className="text-xs lg:text-right">
          <div className="font-bold uppercase text-slate-400">Records</div>
          <div className="text-base font-black text-slate-900">{fmtNumber(group.rows.length)}</div>
        </div>
        <div className="text-xs lg:text-right">
          <div className="font-bold uppercase text-slate-400">Events</div>
          <div className="text-base font-black text-slate-900">{fmtNumber(group.events)}</div>
        </div>
        <div className="text-xs lg:text-right">
          <div className="font-bold uppercase text-slate-400">Open</div>
          <div className="text-base font-black text-amber-600">{fmtNumber(group.openEvents)}</div>
        </div>
        <div className="text-xs lg:text-right">
          <div className="font-bold uppercase text-slate-400">Hours</div>
          <div className="text-base font-black text-cyan-700">{fmtHours(group.hours)}</div>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-slate-200">
          <div className="hidden grid-cols-[0.55fr_0.75fr_0.75fr_0.85fr_1fr_1fr_0.45fr_0.45fr_0.55fr] gap-2 bg-slate-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-500 xl:grid">
            <div>Date</div>
            <div>Status</div>
            <div>Operator</div>
            <div>Job</div>
            <div>Start</div>
            <div>End</div>
            <div className="text-right">Events</div>
            <div className="text-right">Open</div>
            <div className="text-right">Hours</div>
          </div>

          <div className="divide-y divide-slate-100">
            {group.rows.map((row, index) => (
              <div
                key={`${row.work_date}-${row.status_description}-${row.operatorid}-${row.jobid}-${index}`}
                className="grid grid-cols-1 gap-2 px-4 py-3 text-sm transition hover:bg-cyan-50/40 xl:grid-cols-[0.55fr_0.75fr_0.75fr_0.85fr_1fr_1fr_0.45fr_0.45fr_0.55fr] xl:items-center"
              >
                <div>
                  <div className="text-xs font-bold uppercase text-slate-400 xl:hidden">Date</div>
                  <div className="font-bold text-slate-900">{row.work_date || "-"}</div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase text-slate-400 xl:hidden">Status</div>
                  <StatusPill status={row.status_description} />
                </div>
                <div>
                  <div className="text-xs font-bold uppercase text-slate-400 xl:hidden">Operator</div>
                  <div className="font-semibold text-slate-700">{row.operatorid || "-"}</div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase text-slate-400 xl:hidden">Job</div>
                  <div className="font-semibold text-slate-700">{row.jobid || "-"}</div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase text-slate-400 xl:hidden">Start</div>
                  <div className="font-medium text-slate-700">{fmtDateTime(row.first_startdatetime)}</div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase text-slate-400 xl:hidden">End</div>
                  <div className="font-medium text-slate-700">{fmtDateTime(row.last_enddatetime)}</div>
                </div>
                <div className="xl:text-right">
                  <div className="text-xs font-bold uppercase text-slate-400 xl:hidden">Events</div>
                  <div className="font-bold text-slate-900">{fmtNumber(row.event_count)}</div>
                </div>
                <div className="xl:text-right">
                  <div className="text-xs font-bold uppercase text-slate-400 xl:hidden">Open</div>
                  <div className="font-bold text-amber-600">{fmtNumber(row.open_event_count)}</div>
                </div>
                <div className="xl:text-right">
                  <div className="text-xs font-bold uppercase text-slate-400 xl:hidden">Hours</div>
                  <div className="font-black text-cyan-700">{fmtHours(row.duration_hours)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function MachineHoursSqlServerPage() {
  const socketRef = useRef(null);
  const initializedExpansionRef = useRef(false);
  const [filters, setFilters] = useState({
    from: todayMinus(7),
    to: new Date().toISOString().slice(0, 10),
    status: "",
    machineno: "",
    operatorid: "",
    jobid: "",
    limit: "300",
    interval: "10000",
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const query = useMemo(() => buildQuery(filters), [filters]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(buildHttpUrl("/machine-hours-sqlserver", query));
      const json = await response.json();
      if (!response.ok || json.success === false) {
        throw new Error(json.error || "Failed to load machine hours");
      }
      setRows(Array.isArray(json.data) ? json.data : []);
      setLastUpdated(json.meta?.generated_at || new Date().toISOString());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    const socket = new WebSocket(buildWsUrl("/machine-hours-sqlserver/ws", query));
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      setError("");
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "snapshot") {
          setRows(Array.isArray(message.data) ? message.data : []);
          setLastUpdated(message.meta?.generated_at || new Date().toISOString());
          setLoading(false);
        }
        if (message.type === "error") {
          setError(message.error || "WebSocket error");
        }
      } catch {
        setError("Invalid WebSocket response");
      }
    };

    socket.onerror = () => {
      setConnected(false);
      setError("WebSocket connection failed");
    };

    socket.onclose = () => {
      setConnected(false);
    };

    return () => {
      socket.close();
    };
  }, [query]);

  const visibleRows = useMemo(() => {
    const status = filters.status.trim().toLowerCase();
    if (!status) return rows;
    return rows.filter((row) => String(row.status_description || "").toLowerCase().includes(status));
  }, [filters.status, rows]);

  const groups = useMemo(() => {
    const map = new Map();

    visibleRows.forEach((row) => {
      const key = makeMachineKey(row);
      if (!map.has(key)) {
        map.set(key, {
          key,
          machineNo: row.machineno,
          machineId: row.machineid || "-",
          machineName: row.machine_description || row.machinename || "Unknown Machine",
          plantId: row.plantid,
          rows: [],
          events: 0,
          openEvents: 0,
          hours: 0,
        });
      }

      const group = map.get(key);
      group.rows.push(row);
      group.events += Number(row.event_count || 0);
      group.openEvents += Number(row.open_event_count || 0);
      group.hours += Number(row.duration_hours || 0);
    });

    return Array.from(map.values())
      .map((group) => ({
        ...group,
        rows: group.rows.sort(
          (a, b) => new Date(b.first_startdatetime || 0).getTime() - new Date(a.first_startdatetime || 0).getTime()
        ),
        latestStart: group.rows.reduce((latest, row) => {
          const current = new Date(row.first_startdatetime || 0).getTime();
          return Math.max(latest, Number.isFinite(current) ? current : 0);
        }, 0),
      }))
      .sort((a, b) => b.latestStart - a.latestStart);
  }, [visibleRows]);

  useEffect(() => {
    if (!initializedExpansionRef.current && groups.length > 0) {
      setExpandedGroups(new Set(groups.map((group) => group.key)));
      initializedExpansionRef.current = true;
    }
  }, [groups]);

  const totals = useMemo(
    () =>
      visibleRows.reduce(
        (acc, row) => {
          acc.hours += Number(row.duration_hours || 0);
          acc.events += Number(row.event_count || 0);
          acc.openEvents += Number(row.open_event_count || 0);
          return acc;
        },
        { hours: 0, events: 0, openEvents: 0 }
      ),
    [visibleRows]
  );

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      from: todayMinus(7),
      to: new Date().toISOString().slice(0, 10),
      status: "",
      machineno: "",
      operatorid: "",
      jobid: "",
      limit: "300",
      interval: "10000",
    });
  };

  const refreshSocket = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "refresh" }));
      return;
    }
    loadRows();
  };

  const toggleGroup = (key) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => setExpandedGroups(new Set(groups.map((group) => group.key)));
  const collapseAll = () => setExpandedGroups(new Set());

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black">
              <Database className="h-5 w-5 text-cyan-700" />
              Machine Hours
            </h1>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
              <span>{fmtNumber(groups.length)} machines</span>
              <span>{fmtNumber(visibleRows.length)} grouped records</span>
              {lastUpdated ? <span>Updated {new Date(lastUpdated).toLocaleString()}</span> : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold ${
                connected ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
              }`}
            >
              {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              {connected ? "Live" : "Offline"}
            </span>
            <button
              type="button"
              onClick={refreshSocket}
              className="inline-flex items-center gap-1 rounded-md bg-cyan-700 px-3 py-2 font-bold text-white hover:bg-cyan-800"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={Layers3} label="Machines" value={fmtNumber(groups.length)} accent="bg-cyan-50 text-cyan-700" />
          <StatCard icon={Activity} label="Events" value={fmtNumber(totals.events)} accent="bg-emerald-50 text-emerald-700" />
          <StatCard icon={Clock3} label="Open" value={fmtNumber(totals.openEvents)} accent="bg-amber-50 text-amber-700" />
          <StatCard icon={Gauge} label="Hours" value={fmtHours(totals.hours)} accent="bg-violet-50 text-violet-700" />
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-black text-slate-700">
              <Filter className="h-4 w-4 text-cyan-700" />
              Filters
            </div>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              From
              <input
                type="date"
                value={filters.from}
                onChange={(event) => updateFilter("from", event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              To
              <input
                type="date"
                value={filters.to}
                onChange={(event) => updateFilter("to", event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Status
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={filters.status}
                  onChange={(event) => updateFilter("status", event.target.value)}
                  placeholder="Productive"
                  className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-2 text-sm font-semibold normal-case tracking-normal text-slate-800 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                />
              </div>
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Machine No
              <input
                type="number"
                value={filters.machineno}
                onChange={(event) => updateFilter("machineno", event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Operator
              <input
                value={filters.operatorid}
                onChange={(event) => updateFilter("operatorid", event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Job
              <input
                value={filters.jobid}
                onChange={(event) => updateFilter("jobid", event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Limit
              <input
                type="number"
                min="1"
                max="1000"
                value={filters.limit}
                onChange={(event) => updateFilter("limit", event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Interval
              <input
                type="number"
                min="3000"
                max="60000"
                step="1000"
                value={filters.interval}
                onChange={(event) => updateFilter("interval", event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
            </label>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold text-slate-600">
            {loading ? "Loading data..." : `${fmtNumber(groups.length)} machine groups`}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={expandAll}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Expand All
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Collapse All
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-3 pb-6">
          {loading ? (
            <div className="rounded-md border border-slate-200 bg-white px-4 py-10 text-center text-sm font-bold text-slate-500">
              Loading data...
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-white px-4 py-10 text-center text-sm font-bold text-slate-500">
              No rows found
            </div>
          ) : (
            groups.map((group) => (
              <MachineGroup
                key={group.key}
                group={group}
                expanded={expandedGroups.has(group.key)}
                onToggle={toggleGroup}
              />
            ))
          )}
        </div>
      </section>
    </main>
  );
}
