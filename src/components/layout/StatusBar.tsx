import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cpu,
  Gauge,
  HardDrive,
  Info,
  Lock,
  MemoryStick,
  ShieldCheck,
  SquareTerminal,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";

import { StatusDot } from "@/components/ui/misc";
import { useT } from "@/lib/i18n";
import { endpointLabel, formatDuration } from "@/lib/utils";
import { activeKeyOf, tabTone, useSessions, type SessionTab } from "@/stores/sessions";
import { useSettings } from "@/stores/settings";

const STATE_LABEL: Record<string, string> = {
  idle: "Idle",
  connecting: "Connecting",
  verifying: "Verifying host key",
  authenticating: "Authenticating",
  connected: "Connected",
  disconnected: "Disconnected",
  failed: "Failed",
};

function Uptime({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span>{formatDuration(now - since)}</span>;
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(document.documentElement.lang || undefined, {
    maximumFractionDigits: size >= 10 ? 1 : 2,
  }).format(size)} ${units[unit]}`;
}

function formatRate(bytesPerSecond: number | null) {
  if (bytesPerSecond == null) return "—";
  const megabits = (bytesPerSecond * 8) / 1_000_000;
  if (megabits >= 1) return `${megabits.toFixed(2)} Mb/s`;
  return `${(megabits * 1000).toFixed(0)} Kb/s`;
}

function ServerMetrics({ tab }: { tab: SessionTab }) {
  const t = useT();
  const metrics = tab.metrics;
  if (tab.metricsUnavailable) {
    return (
      <span
        className="flex items-center gap-1 text-faint"
        title={t("Linux server metrics could not be read over SSH.")}
      >
        <Info />
        {t("Metrics unavailable")}
      </span>
    );
  }
  if (!metrics) return null;

  const diskPercent =
    metrics.diskTotalBytes > 0
      ? Math.round((metrics.diskUsedBytes / metrics.diskTotalBytes) * 100)
      : null;
  return (
    <>
      <span className="flex items-center gap-1" title={t("Server CPU usage")}>
        <Cpu />
        CPU {metrics.cpuPercent == null ? "—" : `${Math.round(metrics.cpuPercent)}%`}
      </span>
      <span
        className="hidden items-center gap-1 sm:flex"
        title={`${t("Memory used")} · ${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)}`}
      >
        <MemoryStick />
        RAM {formatBytes(metrics.memoryUsedBytes)} / {formatBytes(metrics.memoryTotalBytes)}
      </span>
      <span
        className="hidden items-center gap-1 md:flex"
        title={`${t("Root disk used")} · ${formatBytes(metrics.diskUsedBytes)} / ${formatBytes(metrics.diskTotalBytes)}`}
      >
        <HardDrive />
        {t("Disk")} {diskPercent == null ? "—" : `${diskPercent}%`}
      </span>
      <span className="hidden items-center gap-1 lg:flex" title={t("Network download speed")}>
        <ArrowDownToLine className="text-sky-400" />
        {formatRate(metrics.networkRxBytesPerSecond)}
      </span>
      <span className="hidden items-center gap-1 lg:flex" title={t("Network upload speed")}>
        <ArrowUpFromLine className="text-cyan-400" />
        {formatRate(metrics.networkTxBytesPerSecond)}
      </span>
      <span className="hidden items-center gap-1 xl:flex" title={t("Server uptime")}>
        <Activity />
        {formatDuration(metrics.uptimeSeconds * 1000)}
      </span>
    </>
  );
}

export function StatusBar() {
  const t = useT();
  const tab = useSessions((s) => s.tabs.find((t) => t.key === activeKeyOf(s)));
  const total = useSessions((s) => s.tabs.length);
  const appInfo = useSettings((s) => s.appInfo);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-rail px-3 text-[11px] text-faint [&_svg]:size-3">
      {tab ? (
        <>
          <span className="flex items-center gap-1.5 text-muted">
            <StatusDot tone={tabTone(tab)} className="size-1.5" />
            {t(STATE_LABEL[tab.state] ?? tab.state)}
          </span>
          <span className="flex items-center gap-1.5">
            <SquareTerminal />
            {tab.title}
          </span>
          {tab.info && tab.kind === "ssh" && (
            <span className="flex items-center gap-1.5">
              <User />
              {endpointLabel(tab.info.username, tab.info.host, tab.info.port)}
            </span>
          )}
          {tab.info?.shell && <span>{tab.info.shell}</span>}
          {tab.info?.connectMs != null && (
            <span className="flex items-center gap-1.5" title={t("TCP connect round-trip time")}>
              <Gauge />
              {tab.info.connectMs} ms
            </span>
          )}
          {tab.info?.hostKeyAlgorithm && (
            <span
              className="flex items-center gap-1.5"
              title={tab.info.hostKeyFingerprint ?? undefined}
            >
              <ShieldCheck />
              {tab.info.hostKeyAlgorithm}
            </span>
          )}
          {tab.state === "connected" && tab.kind === "ssh" && <ServerMetrics tab={tab} />}
          {tab.state === "connected" && tab.connectedAt && !tab.metrics && (
            <span className="flex items-center gap-1.5">
              <Activity />
              <Uptime since={tab.connectedAt} />
            </span>
          )}
        </>
      ) : (
        <span>{t("Ready")}</span>
      )}
      <span className="flex-1" />
      <span>
        {total} {total === 1 ? t("session") : t("sessions")}
      </span>
      {appInfo && (
        <span
          className="flex items-center gap-1.5"
          title={t("Secrets are stored in the system credential store")}
        >
          <Lock />
          {appInfo.credentialBackend}
        </span>
      )}
      {appInfo && <span>v{appInfo.version}</span>}
    </footer>
  );
}
