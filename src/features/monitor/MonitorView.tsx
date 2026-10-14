import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cpu,
  Gauge,
  HardDrive,
  Info,
  LoaderCircle,
  MemoryStick,
  SquareTerminal,
} from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { useT } from "@/lib/i18n";
import { endpointLabel, formatBitRate, formatBytes, formatDuration } from "@/lib/utils";
import { useSessions, type MetricSample, type SessionTab } from "@/stores/sessions";
import { useUi } from "@/stores/ui";

/** A small inline sparkline from a series of values in [0, max]. */
function Sparkline({
  values,
  max,
  className,
}: {
  values: (number | null)[];
  max: number;
  className?: string;
}) {
  const width = 100;
  const height = 28;
  const pts = values.filter((v): v is number => v != null);
  if (pts.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className={className} preserveAspectRatio="none" />
    );
  }
  const top = Math.max(max, ...pts) || 1;
  const step = width / (values.length - 1);
  const coords = values.map((v, i) => {
    const y = v == null ? height : height - (Math.min(v, top) / top) * (height - 2) - 1;
    return `${(i * step).toFixed(2)},${y.toFixed(2)}`;
  });
  const line = coords.join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon points={area} fill="currentColor" opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function barTone(percent: number): string {
  if (percent >= 90) return "bg-danger";
  if (percent >= 75) return "bg-warning";
  return "bg-accent";
}

function MetricBar({
  icon,
  label,
  percent,
  detail,
  series,
  seriesMax,
  seriesClass,
}: {
  icon: React.ReactNode;
  label: string;
  percent: number | null;
  detail: string;
  series: (number | null)[];
  seriesMax: number;
  seriesClass: string;
}) {
  const pct = percent == null ? null : Math.round(Math.max(0, Math.min(100, percent)));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-fg [&_svg]:size-3.5 [&_svg]:text-muted">
          {icon}
          {label}
        </span>
        <span className="ml-auto tabular-nums text-muted">{detail}</span>
        <span className="w-10 text-right font-semibold tabular-nums text-fg">
          {pct == null ? "—" : `${pct}%`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${barTone(pct ?? 0)}`}
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
        <div className={`w-20 shrink-0 ${seriesClass}`}>
          <Sparkline values={series} max={seriesMax} className="h-6 w-full" />
        </div>
      </div>
    </div>
  );
}

function ServerCard({ tab }: { tab: SessionTab }) {
  const t = useT();
  const m = tab.metrics;
  const history = tab.metricsHistory;
  const cpuSeries = useMemo(() => history.map((h: MetricSample) => h.cpu), [history]);
  const memSeries = useMemo(() => history.map((h: MetricSample) => h.memPercent), [history]);
  const rxSeries = useMemo(() => history.map((h: MetricSample) => h.rx), [history]);
  const txSeries = useMemo(() => history.map((h: MetricSample) => h.tx), [history]);
  const netMax = useMemo(
    () => Math.max(1, ...history.flatMap((h) => [h.rx ?? 0, h.tx ?? 0])),
    [history],
  );

  const open = () => {
    useSessions.getState().activate(tab.key);
    useUi.getState().setView("workspace");
  };

  const endpoint = tab.info
    ? endpointLabel(tab.info.username, tab.info.host, tab.info.port)
    : tab.title;

  const diskPercent =
    m && m.diskTotalBytes > 0 ? (m.diskUsedBytes / m.diskTotalBytes) * 100 : null;
  const memPercent =
    m && m.memoryTotalBytes > 0 ? (m.memoryUsedBytes / m.memoryTotalBytes) * 100 : null;

  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-fg">{tab.title}</span>
            {tab.state === "connected" ? (
              <Badge tone="success">{t("Connected")}</Badge>
            ) : (
              <Badge tone="warning">{t("Connecting")}</Badge>
            )}
          </div>
          <p className="truncate font-mono text-[11px] text-muted">{endpoint}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={open}>
          <SquareTerminal />
          {t("Open")}
        </Button>
      </div>

      {m && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          <Activity className="size-3.5 text-accent" />
          {t("Uptime")} {formatDuration(m.uptimeSeconds * 1000)}
        </div>
      )}

      {tab.metricsUnavailable ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs text-muted">
          <Info className="size-4 shrink-0" />
          {t("Linux server metrics could not be read over SSH.")}
        </div>
      ) : !m ? (
        <div
          className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs text-muted"
          role="status"
        >
          <LoaderCircle className="size-4 shrink-0 animate-spin" />
          {t("Collecting server metrics…")}
        </div>
      ) : (
        <div className="space-y-3">
          <MetricBar
            icon={<Cpu />}
            label="CPU"
            percent={m.cpuPercent}
            detail=""
            series={cpuSeries}
            seriesMax={100}
            seriesClass="text-accent"
          />
          <MetricBar
            icon={<MemoryStick />}
            label={t("Memory")}
            percent={memPercent}
            detail={`${formatBytes(m.memoryUsedBytes)} / ${formatBytes(m.memoryTotalBytes)}`}
            series={memSeries}
            seriesMax={100}
            seriesClass="text-emerald-400"
          />
          <MetricBar
            icon={<HardDrive />}
            label={t("Disk")}
            percent={diskPercent}
            detail={`${formatBytes(m.diskUsedBytes)} / ${formatBytes(m.diskTotalBytes)}`}
            series={history.map((h) => h.diskPercent)}
            seriesMax={100}
            seriesClass="text-violet-400"
          />
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1 text-sky-400">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-fg [&_svg]:size-3.5 [&_svg]:text-sky-400">
                  <ArrowDownToLine />
                  {t("Download")}
                </span>
                <span className="tabular-nums text-muted">
                  {formatBitRate(m.networkRxBytesPerSecond)}
                </span>
              </div>
              <Sparkline values={rxSeries} max={netMax} className="h-6 w-full" />
            </div>
            <div className="space-y-1 text-cyan-400">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-fg [&_svg]:size-3.5 [&_svg]:text-cyan-400">
                  <ArrowUpFromLine />
                  {t("Upload")}
                </span>
                <span className="tabular-nums text-muted">
                  {formatBitRate(m.networkTxBytesPerSecond)}
                </span>
              </div>
              <Sparkline values={txSeries} max={netMax} className="h-6 w-full" />
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Live server status for every connected SSH session, refreshed as metrics arrive. */
export function MonitorView() {
  const t = useT();
  const tabs = useSessions((s) => s.tabs);
  const servers = tabs.filter(
    (tab) => tab.kind === "ssh" && (tab.state === "connected" || tab.state === "authenticating"),
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("Server status")}
        icon={<Gauge />}
        description={t("Live CPU, memory, disk and network for connected SSH servers.")}
        actions={
          servers.length > 0 ? (
            <Badge tone="accent">
              {servers.length} {t(servers.length === 1 ? "server" : "servers")}
            </Badge>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {servers.length === 0 ? (
          <EmptyState
            icon={<Gauge />}
            title={t("No active SSH server")}
            description={t(
              "Connect to a Linux server over SSH to watch its CPU, memory, disk and network here in real time.",
            )}
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
            {servers.map((tab) => (
              <ServerCard key={tab.key} tab={tab} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
