import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { goBackOrFallback } from '../utils/navigation';
import { WifiOff } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import ConditionReadout from "../components/dashboard/ConditionReadout";
import DashboardSection from "../components/dashboard/DashboardSection";
import ExceptionPanel from "../components/dashboard/ExceptionPanel";
import deriveExceptions from "../components/dashboard/deriveExceptions";
import DashboardFilters from "../components/dashboard/DashboardFilters";
import ChartErrorBoundary from "../components/dashboard/ChartErrorBoundary";
import OrderStatusChart from "../components/dashboard/OrderStatusChart";
import WorkloadChart from "../components/dashboard/WorkloadChart";
import DailyHoursChart from "../components/dashboard/DailyHoursChart";
import OperatorEfficiencyChart from "../components/dashboard/OperatorEfficiencyChart";
import OnTimeChart from "../components/dashboard/OnTimeChart";
import ProgressHistogramChart from "../components/dashboard/ProgressHistogramChart";
import ValidationRateChart from "../components/dashboard/ValidationRateChart";
import OperatorHeatmap from "../components/dashboard/OperatorHeatmap";

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

function defaultFilters() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: toDateStr(from), to: toDateStr(to), workcenter: "all" };
}

const PAIR_GRID = "grid grid-cols-1 gap-3 xl:grid-cols-2";

export default function DashboardPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(defaultFilters);
  const [kpi, setKpi] = useState(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [kpiFailed, setKpiFailed] = useState(false);
  // Only the KPI request is retried, and only after it failed: a page-wide reload button would
  // multiply the request count on every press, which is exactly the network change Track A forbids.
  const [kpiAttempt, setKpiAttempt] = useState(0);
  const [sources, setSources] = useState({ validation: [], workload: [], failed: false });
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);

  useEffect(() => {
    setKpiLoading(true);
    setKpiFailed(false);
    fetch("/api/dashboard/kpi")
      .then((r) => r.json())
      .then((json) => setKpi(json.data))
      .catch(() => {
        setKpi(null);
        setKpiFailed(true);
      })
      .finally(() => setKpiLoading(false));
  }, [kpiAttempt]);

  useEffect(() => {
    const sync = () => setOffline(navigator.onLine === false);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const retryKpi = useCallback(() => {
    setKpiAttempt((n) => n + 1);
  }, []);

  const onValidation = useCallback((rows, error) => {
    setSources((s) => ({ ...s, validation: rows, failed: s.failed || Boolean(error) }));
  }, []);

  const onWorkload = useCallback((rows, error) => {
    setSources((s) => ({ ...s, workload: rows, failed: s.failed || Boolean(error) }));
  }, []);

  const exceptions = useMemo(
    () => deriveExceptions({ kpi, validation: sources.validation, workload: sources.workload }),
    [kpi, sources.validation, sources.workload]
  );

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <PageHeader
        eyebrow="Command center"
        title="Production dashboard"
        onBack={() => goBackOrFallback(navigate)}
      />

      <DashboardFilters filters={filters} onChange={setFilters} />

      <main className="flex flex-1 flex-col gap-5 px-4 py-4 md:px-6">
        {offline && (
          <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-status-late md:text-sm">
            <WifiOff size={15} />
            Offline — figures below are the last values loaded.
          </p>
        )}

        <ConditionReadout
          kpi={kpi}
          loading={kpiLoading}
          error={kpiFailed}
          onRetry={retryKpi}
        />

        <ExceptionPanel
          rows={exceptions}
          loading={kpiLoading}
          error={sources.failed}
          onOpen={(href) => navigate(href)}
        />

        <div className="flex flex-col gap-5">
          <DashboardSection label="Order condition" hint="Where the order book stands right now">
            <div className={PAIR_GRID}>
              <ChartErrorBoundary>
                <OrderStatusChart />
              </ChartErrorBoundary>

              <ChartErrorBoundary>
                <ProgressHistogramChart />
              </ChartErrorBoundary>
            </div>
          </DashboardSection>

          <DashboardSection label="Capacity and delivery" hint="Load per workcenter against the plan">
            <div className={PAIR_GRID}>
              <ChartErrorBoundary>
                <WorkloadChart onData={onWorkload} />
              </ChartErrorBoundary>

              <ChartErrorBoundary>
                <OnTimeChart />
              </ChartErrorBoundary>
            </div>
          </DashboardSection>

          <DashboardSection label="Execution trend" hint="Recorded hours over the filtered period">
            <div className={PAIR_GRID}>
              <ChartErrorBoundary>
                <DailyHoursChart workcenter={filters.workcenter} days={30} />
              </ChartErrorBoundary>

              <ChartErrorBoundary>
                <OperatorEfficiencyChart
                  from={filters.from}
                  to={filters.to}
                  workcenter={filters.workcenter}
                />
              </ChartErrorBoundary>
            </div>
          </DashboardSection>

          <DashboardSection label="Quality and activity" hint="Process control and when the work happens">
            <div className={PAIR_GRID}>
              <ChartErrorBoundary>
                <ValidationRateChart workcenter={filters.workcenter} onData={onValidation} />
              </ChartErrorBoundary>

              <ChartErrorBoundary>
                <OperatorHeatmap days={30} />
              </ChartErrorBoundary>
            </div>
          </DashboardSection>
        </div>
      </main>
    </div>
  );
}
