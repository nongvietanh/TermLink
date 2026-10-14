import {
  ArrowRight,
  Activity,
  Download,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  Plus,
  Server,
  ShieldCheck,
  SquareTerminal,
  Star,
  Terminal,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ServerMetrics } from "@/components/layout/ServerMetrics";
import { Kbd } from "@/components/ui/kbd";
import { EmptyState, Panel, StatusDot } from "@/components/ui/misc";
import type { Profile } from "@/domain/types";
import { goTo, importProfiles, newConnection, quickConnect } from "@/lib/actions";
import { useT } from "@/lib/i18n";
import { SHORTCUTS } from "@/lib/shortcuts";
import { endpointLabel, formatRelative } from "@/lib/utils";
import { useLibrary } from "@/stores/library";
import { tabTone, useSessions } from "@/stores/sessions";
import { useSettings } from "@/stores/settings";

import { ProtocolIcon } from "../connections/ConnectionExplorer";
import { recentProfiles } from "../connections/tree";
import { connectProfile, openLocalTerminal } from "../terminal/controller";

function Stat({
  icon,
  label,
  value,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <div className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-4">
        {icon}
      </div>
      <div>
        <div className="text-lg leading-tight font-semibold text-fg tabular-nums">{value}</div>
        <div className="text-xs text-muted">{label}</div>
      </div>
    </button>
  );
}

function ProfileList({ profiles, empty }: { profiles: Profile[]; empty: string }) {
  if (!profiles.length) return <p className="px-4 py-6 text-center text-xs text-faint">{empty}</p>;
  return (
    <div className="divide-y divide-line">
      {profiles.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => connectProfile(p)}
          className="group flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] transition-colors hover:bg-surface-2"
        >
          <ProtocolIcon profile={p} className="text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-fg">{p.name}</span>
            <span className="block truncate font-mono text-[11px] text-faint">
              {p.protocol === "ssh" ? endpointLabel(p.username, p.host, p.port) : p.protocol}
            </span>
          </span>
          <span className="text-[11px] text-faint">{formatRelative(p.lastConnectedAt)}</span>
          <ArrowRight className="size-3.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ))}
    </div>
  );
}

export function DashboardView() {
  const t = useT();
  const profiles = useLibrary((s) => s.profiles);
  const knownHosts = useLibrary((s) => s.knownHosts);
  const groups = useLibrary((s) => s.groups);
  const tabs = useSessions((s) => s.tabs);
  const sshTabs = tabs.filter((tab) => tab.kind === "ssh");
  const activate = useSessions((s) => s.activate);
  const appInfo = useSettings((s) => s.appInfo);
  const favorites = profiles.filter((p) => p.favorite).slice(0, 8);
  const recent = recentProfiles(profiles, 8);
  const saved = profiles.filter((p) => p.passwordSaved || p.passphraseSaved).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6">
          <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-accent">
                <LayoutDashboard className="size-3.5" />
                {t("Dashboard")}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-fg">
                {t("Welcome to TermLink")}
              </h1>
              <p className="mt-1 max-w-xl text-[13px] text-muted">
                {t(
                  "Your workspace for SSH terminals and server management. Host keys are always verified and secrets stay in",
                )}{" "}
                {appInfo?.credentialBackend ?? "the system credential store"}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" onClick={quickConnect}>
                <Zap />
                {t("Quick connect")}
                <Kbd keys={SHORTCUTS.quickConnect.keys} className="ml-1" onAccent />
              </Button>
              <Button size="lg" onClick={() => newConnection()}>
                <Plus />
                {t("New connection")}
              </Button>
              <Button size="lg" onClick={() => openLocalTerminal()}>
                <Terminal />
                {t("Local terminal")}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            icon={<Server />}
            label={t("Saved connections")}
            value={profiles.length}
            onClick={() => goTo("connections")}
          />
          <Stat
            icon={<SquareTerminal />}
            label={t("Open sessions")}
            value={tabs.length}
            onClick={() => goTo("workspace")}
          />
          <Stat
            icon={<Fingerprint />}
            label={t("Trusted host keys")}
            value={knownHosts.length}
            onClick={() => goTo("credentials")}
          />
          <Stat
            icon={<KeyRound />}
            label={t("Saved secrets")}
            value={saved}
            onClick={() => goTo("credentials")}
          />
        </div>

        <Panel className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase">
            <Activity className="size-3.5 text-accent" />
            {t("Server status")}
          </div>
          {sshTabs.length ? (
            <div className="divide-y divide-line">
              {sshTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    activate(tab.key);
                    goTo("workspace");
                  }}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <StatusDot tone={tabTone(tab)} />
                  <span className="text-[13px] font-medium text-fg">{tab.title}</span>
                  {tab.info && (
                    <span className="font-mono text-[11px] text-faint">
                      {endpointLabel(tab.info.username, tab.info.host, tab.info.port)}
                    </span>
                  )}
                  <div className="w-full overflow-x-auto pl-5 text-[11px] [&_svg]:size-3.5">
                    <ServerMetrics tab={tab} />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md bg-surface-2 p-2 text-faint">
                  <Server className="size-4" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-fg">{t("No active SSH server")}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {t(
                      "Server metrics are shown here and above the terminal after an SSH connection.",
                    )}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={quickConnect}>
                <Zap />
                {t("Quick connect")}
              </Button>
            </div>
          )}
        </Panel>

        {profiles.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Server />}
              title={t("Add your first server")}
              description={t(
                "Create a connection profile, or import profiles exported from another TermLink installation.",
              )}
              action={
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => newConnection()}>
                    <Plus />
                    {t("New connection")}
                  </Button>
                  <Button onClick={() => void importProfiles()}>
                    <Download />
                    {t("Import")}
                  </Button>
                </div>
              }
            />
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase">
                <Star className="size-3.5 text-warning" />
                {t("Favorites")}
              </div>
              <ProfileList profiles={favorites} empty={t("Star a connection to pin it here.")} />
            </Panel>
            <Panel>
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase">
                <SquareTerminal className="size-3.5" />
                {t("Recently used")}
              </div>
              <ProfileList profiles={recent} empty={t("Connections you use appear here.")} />
            </Panel>
          </div>
        )}

        {tabs.length > 0 && (
          <Panel>
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase">
              <SquareTerminal className="size-3.5" />
              {t("Active sessions")}
            </div>
            <div className="divide-y divide-line">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    activate(t.key);
                    goTo("workspace");
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] hover:bg-surface-2"
                >
                  <StatusDot tone={tabTone(t)} />
                  <span className="flex-1 text-fg">{t.title}</span>
                  <span className="text-xs text-muted capitalize">{t.state}</span>
                </button>
              ))}
            </div>
          </Panel>
        )}

        <div className="flex items-center gap-2 text-xs text-faint">
          <ShieldCheck className="size-3.5 text-success" />
          {groups.length} groups · {knownHosts.length} verified hosts · schema v
          {appInfo?.schemaVersion ?? "–"}
        </div>
      </div>
    </div>
  );
}
