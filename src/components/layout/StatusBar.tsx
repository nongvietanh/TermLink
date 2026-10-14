import { Activity, Gauge, Lock, ShieldCheck, SquareTerminal, User } from "lucide-react";
import { useEffect, useState } from "react";

import { StatusDot } from "@/components/ui/misc";
import { useT } from "@/lib/i18n";
import { endpointLabel, formatDuration } from "@/lib/utils";
import { activeKeyOf, tabTone, useSessions } from "@/stores/sessions";
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
