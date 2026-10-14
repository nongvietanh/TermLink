import { CheckCircle2, Circle, Network } from "lucide-react";
import type { ReactNode } from "react";

import { Badge, Notice, PageHeader, Panel } from "@/components/ui/misc";
import { useT } from "@/lib/i18n";

interface PlannedFeature {
  title: string;
  icon: ReactNode;
  summary: string;
  done: string[];
  todo: string[];
}

const FEATURES: Record<"forwarding", PlannedFeature> = {
  forwarding: {
    title: "Port Forwarding",
    icon: <Network />,
    summary:
      "Local (-L), remote (-R) and dynamic SOCKS (-D) forwarding over saved SSH connections, with start/stop controls, live status and port-conflict detection.",
    done: [
      "Database schema for saved forwarding rules (port_forwards table)",
      "SSH transport supports direct-tcpip and tcpip-forward channels (russh)",
    ],
    todo: [
      "Forwarding engine with listener lifecycle and cleanup",
      "Port conflict detection before binding",
      "SOCKS5 server for dynamic forwarding",
      "Rule editor, start/stop controls and status UI",
      "Integration tests against the in-process SSH test server",
    ],
  },
};

/** Clearly labelled placeholder for features that are not implemented yet. */
export function PlannedView({ feature }: { feature: "forwarding" }) {
  const t = useT();
  const f = FEATURES[feature];
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t(f.title)}
        icon={f.icon}
        description={t(f.summary)}
        actions={<Badge tone="warning">{t("Planned · not available yet")}</Badge>}
      />
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div className="max-w-2xl space-y-4">
          <Notice tone="warning" title={t("This feature is not implemented in this version")}>
            {t(
              "Nothing on this page performs network operations. It ships as an independently tested milestone after the SSH terminal milestone.",
            )}
          </Notice>
          <Panel className="p-4">
            <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">
              {t("Progress")}
            </h3>
            <ul className="space-y-2 text-[13px]">
              {f.done.map((d) => (
                <li key={d} className="flex items-start gap-2 text-fg">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  {t(d)}
                </li>
              ))}
              {f.todo.map((d) => (
                <li key={d} className="flex items-start gap-2 text-muted">
                  <Circle className="mt-0.5 size-4 shrink-0 text-faint" />
                  {t(d)}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
