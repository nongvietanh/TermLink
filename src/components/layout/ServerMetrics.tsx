import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cpu,
  HardDrive,
  Info,
  LoaderCircle,
  MemoryStick,
} from "lucide-react";

import { useT } from "@/lib/i18n";
import { formatBitRate as formatRate, formatBytes, formatDuration } from "@/lib/utils";
import type { SessionTab } from "@/stores/sessions";

export function ServerMetrics({ tab }: { tab: SessionTab }) {
  const t = useT();
  const metrics = tab.metrics;

  if (tab.state !== "connected") {
    return (
      <span className="flex items-center gap-1.5 text-faint [&_svg]:size-3.5">
        <Info />
        {t("Connect over SSH to see live server metrics.")}
      </span>
    );
  }
  if (tab.metricsUnavailable) {
    return (
      <span
        className="flex items-center gap-1.5 text-faint [&_svg]:size-3.5"
        title={t("Linux server metrics could not be read over SSH.")}
      >
        <Info />
        {t("Metrics unavailable")}
      </span>
    );
  }
  if (!metrics) {
    return (
      <span className="flex items-center gap-1.5 text-muted [&_svg]:size-3.5" role="status">
        <LoaderCircle className="animate-spin" />
        {t("Collecting server metrics…")}
      </span>
    );
  }

  const diskPercent =
    metrics.diskTotalBytes > 0
      ? Math.round((metrics.diskUsedBytes / metrics.diskTotalBytes) * 100)
      : null;
  return (
    <div className="flex min-w-0 items-center gap-x-4 gap-y-1 overflow-x-auto whitespace-nowrap text-muted [&_svg]:size-3.5">
      <span className="flex items-center gap-1" title={t("Server CPU usage")}>
        <Cpu />
        CPU {metrics.cpuPercent == null ? "—" : `${Math.round(metrics.cpuPercent)}%`}
      </span>
      <span
        className="flex items-center gap-1"
        title={`${t("Memory used")} · ${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)}`}
      >
        <MemoryStick />
        RAM {formatBytes(metrics.memoryUsedBytes)} / {formatBytes(metrics.memoryTotalBytes)}
      </span>
      <span
        className="flex items-center gap-1"
        title={`${t("Root disk used")} · ${formatBytes(metrics.diskUsedBytes)} / ${formatBytes(metrics.diskTotalBytes)}`}
      >
        <HardDrive />
        {t("Disk")} {diskPercent == null ? "—" : `${diskPercent}%`}
      </span>
      <span className="flex items-center gap-1" title={t("Network download speed")}>
        <ArrowDownToLine className="text-sky-400" />
        {formatRate(metrics.networkRxBytesPerSecond)}
      </span>
      <span className="flex items-center gap-1" title={t("Network upload speed")}>
        <ArrowUpFromLine className="text-cyan-400" />
        {formatRate(metrics.networkTxBytesPerSecond)}
      </span>
      <span className="flex items-center gap-1" title={t("Server uptime")}>
        <Activity />
        {formatDuration(metrics.uptimeSeconds * 1000)}
      </span>
    </div>
  );
}

export function ServerMetricsPanel({ tab }: { tab: SessionTab }) {
  const t = useT();
  return (
    <section
      className="flex h-8 shrink-0 items-center gap-3 overflow-hidden border-b border-line bg-surface-2 px-3 text-[11px] [&_svg]:size-3.5"
      aria-label={t("Server status")}
    >
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-fg">
        <Activity className="text-accent" />
        {t("Server status")}
      </span>
      <span className="h-3.5 w-px shrink-0 bg-line" />
      <ServerMetrics tab={tab} />
    </section>
  );
}
