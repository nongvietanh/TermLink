import {
  CheckCircle2,
  CircleSlash,
  Copy,
  CornerDownLeft,
  History,
  Play,
  Search,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import type { CommandHistoryEntry, SessionHistoryEntry } from "@/domain/types";
import { api } from "@/lib/ipc";
import { useT } from "@/lib/i18n";
import { attempt, notifyError, notifySuccess } from "@/lib/notify";
import { endpointLabel, formatDateTime, formatDuration, formatRelative } from "@/lib/utils";
import { confirm } from "@/stores/confirm";
import { useLibrary } from "@/stores/library";

import { sendCommand } from "../snippets/snippetActions";
import { connectProfile } from "../terminal/controller";

function SessionStatus({ entry }: { entry: SessionHistoryEntry }) {
  const t = useT();
  if (entry.status === "failed")
    return (
      <Badge tone="danger">
        <XCircle />
        {t("Failed")}
      </Badge>
    );
  if (entry.status === "closed" || entry.status === "connected")
    return (
      <Badge tone="success">
        <CheckCircle2 />
        {t(entry.status === "connected" ? "active" : "completed")}
      </Badge>
    );
  return (
    <Badge>
      <CircleSlash />
      {entry.status}
    </Badge>
  );
}

function SessionsTab() {
  const t = useT();
  const [rows, setRows] = useState<SessionHistoryEntry[]>([]);
  const profiles = useLibrary((s) => s.profiles);
  const load = useCallback(() => {
    api.sessionHistoryList(300).then(setRows, (e) => notifyError(e));
  }, []);
  useEffect(load, [load]);

  const clear = async () => {
    const ok = await confirm({
      title: t("Clear session history?"),
      description: t(
        "This removes the list of past sessions. Connection profiles are not affected.",
      ),
      confirmLabel: t("Clear history"),
      tone: "danger",
    });
    if (ok)
      await attempt(async () => {
        await api.sessionHistoryClear();
        setRows([]);
      });
  };

  if (!rows.length)
    return (
      <EmptyState
        icon={<History />}
        title={t("No sessions yet")}
        description={t("Sessions you open are listed here with their outcome.")}
      />
    );
  return (
    <div>
      <div className="flex justify-end px-6 py-2">
        <Button size="sm" variant="ghost" onClick={() => void clear()}>
          <Trash2 />
          {t("Clear history")}
        </Button>
      </div>
      <table className="w-full text-[13px]">
        <thead className="text-left text-[11px] tracking-wide text-faint uppercase">
          <tr className="border-b border-line">
            <th className="py-2 pl-6 font-semibold">{t("Session")}</th>
            <th className="py-2 font-semibold">{t("Endpoint")}</th>
            <th className="py-2 font-semibold">{t("Status")}</th>
            <th className="py-2 font-semibold">{t("Started")}</th>
            <th className="py-2 font-semibold">{t("Duration")}</th>
            <th className="w-16 pr-6" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const profile = profiles.find((p) => p.id === r.profileId);
            return (
              <tr key={r.id} className="border-b border-line/70 hover:bg-surface-2">
                <td className="py-2 pl-6 font-medium text-fg">
                  <span className="flex items-center gap-2">
                    <Terminal className="size-3.5 text-muted" />
                    {r.label}
                  </span>
                </td>
                <td className="py-2 font-mono text-xs text-muted">
                  {r.protocol === "local"
                    ? t("local")
                    : endpointLabel(r.username, r.host, r.port ?? 22)}
                </td>
                <td className="py-2">
                  <span title={r.error ?? undefined} className="flex items-center gap-2">
                    <SessionStatus entry={r} />
                    {r.error && (
                      <span className="max-w-[260px] truncate text-xs text-danger">{r.error}</span>
                    )}
                  </span>
                </td>
                <td className="py-2 text-xs text-muted" title={formatDateTime(r.startedAt)}>
                  {formatRelative(r.startedAt)}
                </td>
                <td className="py-2 text-xs text-muted">
                  {r.endedAt ? formatDuration(r.endedAt - r.startedAt) : "—"}
                </td>
                <td className="py-2 pr-6 text-right">
                  {profile && (
                    <Tooltip content={t("Connect again")}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${t("Connect to")} ${profile.name}`}
                        onClick={() => connectProfile(profile)}
                      >
                        <Play />
                      </Button>
                    </Tooltip>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CommandsTab() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CommandHistoryEntry[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      api.commandHistoryList(query || undefined, 500).then(setRows, (e) => notifyError(e));
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  const clear = async () => {
    const ok = await confirm({
      title: t("Clear command history?"),
      confirmLabel: t("Clear history"),
      tone: "danger",
    });
    if (ok)
      await attempt(async () => {
        await api.commandHistoryClear();
        setRows([]);
      });
  };

  return (
    <div>
      <div className="flex items-center gap-2 px-6 py-2">
        <div className="relative w-80">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search commands")}
            className="pl-8"
            aria-label={t("Search command history")}
          />
        </div>
        <span className="flex-1 text-xs text-faint">
          {t(
            "Only commands sent by TermLink (snippets, palette) are recorded. Keystrokes typed in terminals never are.",
          )}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void clear()} disabled={!rows.length}>
          <Trash2 />
          {t("Clear")}
        </Button>
      </div>
      {!rows.length ? (
        <EmptyState
          icon={<History />}
          title={t(query ? "No matching commands" : "No commands yet")}
          description={t("Commands you run from snippets appear here.")}
        />
      ) : (
        <div className="divide-y divide-line/70">
          {rows.map((r) => (
            <div key={r.id} className="group flex items-center gap-3 px-6 py-2 hover:bg-surface-2">
              <code
                className="selectable min-w-0 flex-1 truncate font-mono text-xs text-fg"
                title={r.command}
              >
                {r.command}
              </code>
              <Badge>{r.source}</Badge>
              <span className="w-40 truncate text-xs text-muted">{r.targetLabel}</span>
              <span className="w-24 text-xs text-faint" title={formatDateTime(r.executedAt)}>
                {formatRelative(r.executedAt)}
              </span>
              <div className="flex gap-0.5 opacity-60 group-hover:opacity-100">
                <Tooltip content={t("Copy")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Copy command")}
                    onClick={() =>
                      void navigator.clipboard.writeText(r.command).then(
                        () => notifySuccess(t("Copied")),
                        () => {},
                      )
                    }
                  >
                    <Copy />
                  </Button>
                </Tooltip>
                <Tooltip content={t("Insert into active session")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Insert command")}
                    onClick={() =>
                      void sendCommand({ command: r.command, run: false, source: "history" })
                    }
                  >
                    <CornerDownLeft />
                  </Button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function HistoryView() {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("History")}
        icon={<History />}
        description={t("Past sessions and commands sent from TermLink.")}
      />
      <Tabs defaultValue="sessions" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="px-6">
          <TabsTrigger value="sessions">{t("Sessions")}</TabsTrigger>
          <TabsTrigger value="commands">{t("Commands")}</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions" className="min-h-0 flex-1 overflow-auto outline-none">
          <SessionsTab />
        </TabsContent>
        <TabsContent value="commands" className="min-h-0 flex-1 overflow-auto outline-none">
          <CommandsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
