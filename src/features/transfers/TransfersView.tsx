import {
  ArrowLeftRight,
  ChevronRight,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  HardDrive,
  Link2,
  Loader2,
  Pencil,
  RotateCw,
  Server,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import type { EntryKind, LocalEntry, SftpEntry } from "@/domain/types";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/ipc";
import { notifyError } from "@/lib/notify";
import { cn, formatBytes, formatRelative } from "@/lib/utils";
import { confirm } from "@/stores/confirm";
import { isLive, useSessions, type SessionTab } from "@/stores/sessions";

import { activeTransferCount, useTransfers, type TransferItem } from "./store";

type Side = "local" | "remote";
interface Row {
  name: string;
  path: string;
  kind: EntryKind;
  size: number;
  modified: number | null;
}

function joinPath(dir: string, name: string, sep: string) {
  const base = dir.endsWith(sep) ? dir.slice(0, -1) : dir;
  return `${base}${sep}${name}`;
}

function remoteParent(path: string) {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

function EntryIcon({ kind }: { kind: EntryKind }) {
  if (kind === "dir") return <Folder className="size-4 text-accent" />;
  if (kind === "symlink") return <Link2 className="size-4 text-sky-400" />;
  return <FileIcon className="size-4 text-muted" />;
}

interface PaneState {
  path: string;
  rows: Row[];
  loading: boolean;
  error: string | null;
  selected: string | null;
}

function FilePane({
  side,
  title,
  icon,
  state,
  onOpen,
  onUp,
  onRefresh,
  onSelect,
  onTransfer,
  onDropFiles,
  actions,
}: {
  side: Side;
  title: string;
  icon: React.ReactNode;
  state: PaneState;
  onOpen: (row: Row) => void;
  onUp: () => void;
  onRefresh: () => void;
  onSelect: (path: string | null) => void;
  onTransfer: (row: Row) => void;
  onDropFiles: (rows: { path: string; name: string; kind: EntryKind }[]) => void;
  actions?: React.ReactNode;
}) {
  const t = useT();
  const [dragOver, setDragOver] = useState(false);

  return (
    <Panel
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        dragOver && "outline outline-2 outline-accent",
      )}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-termlink-file")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        const raw = e.dataTransfer.getData("application/x-termlink-file");
        if (!raw) return;
        try {
          const payload = JSON.parse(raw) as { side: Side; path: string; name: string; kind: EntryKind };
          if (payload.side !== side) onDropFiles([payload]);
        } catch {
          /* ignore malformed drag payloads */
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-fg [&_svg]:size-4 [&_svg]:text-accent">
          {icon}
          {title}
        </span>
        <span className="flex-1" />
        {actions}
        <Tooltip content={t("Refresh")}>
          <Button variant="ghost" size="icon-sm" aria-label={t("Refresh")} onClick={onRefresh}>
            <RotateCw />
          </Button>
        </Tooltip>
      </div>
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <Button variant="ghost" size="sm" onClick={onUp} aria-label={t("Parent folder")}>
          <ChevronRight className="-rotate-90" />
        </Button>
        <span
          className="truncate font-mono text-[11px] text-muted"
          dir="rtl"
          title={state.path}
        >
          {state.path || "…"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" onClick={() => onSelect(null)}>
        {state.loading ? (
          <div className="flex items-center justify-center py-10 text-muted" role="status">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : state.error ? (
          <div className="p-4 text-xs text-danger">{state.error}</div>
        ) : state.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted">{t("This folder is empty")}</p>
        ) : (
          <ul className="py-1">
            {state.rows.map((row) => (
              <li key={row.path}>
                <div
                  role="button"
                  tabIndex={0}
                  draggable={row.kind !== "dir"}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "application/x-termlink-file",
                      JSON.stringify({ side, path: row.path, name: row.name, kind: row.kind }),
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(row.path);
                  }}
                  onDoubleClick={() => (row.kind === "dir" ? onOpen(row) : onTransfer(row))}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    if (row.kind === "dir") onOpen(row);
                    else onTransfer(row);
                  }}
                  className={cn(
                    "group flex cursor-default items-center gap-2 px-3 py-1.5 text-[13px] text-fg",
                    state.selected === row.path ? "bg-accent-soft" : "hover:bg-hover",
                  )}
                >
                  <EntryIcon kind={row.kind} />
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span className="shrink-0 tabular-nums text-[11px] text-faint">
                    {row.kind === "dir" ? "" : formatBytes(row.size)}
                  </span>
                  <span className="hidden w-28 shrink-0 text-right text-[11px] text-faint sm:block">
                    {row.modified ? formatRelative(row.modified) : ""}
                  </span>
                  {row.kind === "dir" ? (
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-faint opacity-0 group-hover:opacity-100 hover:text-fg"
                      aria-label={t("Open")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(row);
                      }}
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-faint opacity-0 group-hover:opacity-100 hover:text-accent"
                      aria-label={side === "remote" ? t("Download") : t("Upload")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTransfer(row);
                      }}
                    >
                      {side === "remote" ? (
                        <Download className="size-4" />
                      ) : (
                        <Upload className="size-4" />
                      )}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function PromptDialog({
  title,
  label,
  initial,
  confirmLabel,
  onCancel,
  onSubmit,
}: {
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(initial);
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent size="sm">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onSubmit(value.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field label={label} htmlFor="prompt-input">
              <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onCancel}>
              {t("Cancel")}
            </Button>
            <Button variant="primary" type="submit" disabled={!value.trim()}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferRow({ item }: { item: TransferItem }) {
  const t = useT();
  const { cancel, remove, retry } = useTransfers();
  const pct =
    item.total && item.total > 0
      ? Math.min(100, Math.round((item.transferred / item.total) * 100))
      : null;
  const rate = item.bytesPerSecond > 0 ? `${formatBytes(item.bytesPerSecond)}/s` : "";
  const statusTone: Record<TransferItem["status"], string> = {
    queued: "text-muted",
    running: "text-accent",
    completed: "text-success",
    failed: "text-danger",
    cancelled: "text-muted",
  };
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {item.direction === "download" ? (
        <Download className="size-3.5 shrink-0 text-sky-400" />
      ) : (
        <Upload className="size-3.5 shrink-0 text-cyan-400" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-fg">{item.name}</span>
          <span className={cn("ml-auto shrink-0 text-[11px]", statusTone[item.status])}>
            {item.status === "running"
              ? `${pct ?? 0}%${rate ? ` · ${rate}` : ""}`
              : t(
                  item.status === "completed"
                    ? "Completed"
                    : item.status === "failed"
                      ? "Failed"
                      : item.status === "cancelled"
                        ? "Cancelled"
                        : "Queued",
                )}
          </span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300",
              item.status === "failed"
                ? "bg-danger"
                : item.status === "completed"
                  ? "bg-success"
                  : "bg-accent",
            )}
            style={{ width: `${item.status === "completed" ? 100 : (pct ?? (item.status === "running" ? 4 : 0))}%` }}
          />
        </div>
        {item.error && <p className="mt-0.5 truncate text-[11px] text-danger">{item.error}</p>}
      </div>
      {(item.status === "queued" || item.status === "running") && (
        <Button variant="ghost" size="icon-sm" aria-label={t("Cancel")} onClick={() => cancel(item.id)}>
          <X />
        </Button>
      )}
      {(item.status === "failed" || item.status === "cancelled") && (
        <Button variant="ghost" size="icon-sm" aria-label={t("Retry")} onClick={() => retry(item.id)}>
          <RotateCw />
        </Button>
      )}
      {(item.status === "completed" || item.status === "failed" || item.status === "cancelled") && (
        <Button variant="ghost" size="icon-sm" aria-label={t("Remove")} onClick={() => remove(item.id)}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

const emptyPane: PaneState = { path: "", rows: [], loading: true, error: null, selected: null };

export function TransfersView() {
  const t = useT();
  const tabs = useSessions((s) => s.tabs);
  const servers = useMemo(
    () => tabs.filter((tab) => tab.kind === "ssh" && isLive(tab) && tab.state === "connected"),
    [tabs],
  );
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const activeServer: SessionTab | undefined =
    servers.find((s) => s.key === sessionKey) ?? servers[0];
  const sessionId = activeServer?.sessionId ?? null;

  const [local, setLocal] = useState<PaneState>(emptyPane);
  const [remote, setRemote] = useState<PaneState>(emptyPane);
  const items = useTransfers((s) => s.items);
  const completedTick = useTransfers((s) => s.completedTick);
  const enqueue = useTransfers((s) => s.enqueue);
  const clearFinished = useTransfers((s) => s.clearFinished);
  const [prompt, setPrompt] = useState<{
    id: string;
    title: string;
    label: string;
    initial: string;
    confirmLabel: string;
    run: (value: string) => void;
  } | null>(null);

  const localSep = local.path.includes("\\") ? "\\" : "/";

  const loadLocal = useCallback(async (path?: string) => {
    setLocal((p) => ({ ...p, loading: true, error: null }));
    try {
      const target = path ?? (await api.localHome());
      const listing = await api.localList(target);
      setLocal({
        path: listing.path,
        rows: listing.entries as LocalEntry[],
        loading: false,
        error: null,
        selected: null,
      });
    } catch (err) {
      setLocal((p) => ({ ...p, loading: false, error: (err as { message?: string }).message ?? "Error" }));
    }
  }, []);

  const loadRemote = useCallback(
    async (path?: string) => {
      if (!sessionId) return;
      setRemote((p) => ({ ...p, loading: true, error: null }));
      try {
        const target = path ?? (await api.sftpHome(sessionId));
        const listing = await api.sftpList(sessionId, target);
        setRemote({
          path: listing.path,
          rows: listing.entries as SftpEntry[],
          loading: false,
          error: null,
          selected: null,
        });
      } catch (err) {
        setRemote((p) => ({
          ...p,
          loading: false,
          error: (err as { message?: string }).message ?? "Error",
        }));
      }
    },
    [sessionId],
  );

  // Load both panels when the selected server changes.
  useEffect(() => {
    void loadLocal(local.path || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setRemote(emptyPane);
    if (sessionId) void loadRemote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Refresh listings after a transfer finishes so new files appear.
  const prevTick = useRef(completedTick);
  useEffect(() => {
    if (completedTick !== prevTick.current) {
      prevTick.current = completedTick;
      void loadLocal(local.path || undefined);
      if (sessionId) void loadRemote(remote.path || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedTick]);

  const download = (row: Row) => {
    if (!sessionId || row.kind === "dir") return;
    enqueue([
      {
        sessionId,
        direction: "download",
        remotePath: row.path,
        localPath: joinPath(local.path, row.name, localSep),
        name: row.name,
      },
    ]);
  };
  const upload = (row: Row) => {
    if (!sessionId || row.kind === "dir") return;
    enqueue([
      {
        sessionId,
        direction: "upload",
        localPath: row.path,
        remotePath: joinPath(remote.path, row.name, "/"),
        name: row.name,
      },
    ]);
  };

  const makeRemoteDir = () =>
    setPrompt({
      id: crypto.randomUUID(),
      title: t("New folder"),
      label: t("Folder name"),
      initial: "",
      confirmLabel: t("Create"),
      run: async (name) => {
        setPrompt(null);
        if (!sessionId) return;
        try {
          await api.sftpMkdir(sessionId, joinPath(remote.path, name, "/"));
          void loadRemote(remote.path);
        } catch (err) {
          notifyError(err, t("Could not create the folder"));
        }
      },
    });

  const renameRemote = () => {
    if (!sessionId || !remote.selected) return;
    const current = remote.rows.find((r) => r.path === remote.selected);
    if (!current) return;
    setPrompt({
      id: crypto.randomUUID(),
      title: t("Rename"),
      label: t("New name"),
      initial: current.name,
      confirmLabel: t("Rename"),
      run: async (name) => {
        setPrompt(null);
        try {
          await api.sftpRename(sessionId, current.path, joinPath(remote.path, name, "/"));
          void loadRemote(remote.path);
        } catch (err) {
          notifyError(err, t("Could not rename"));
        }
      },
    });
  };

  const deleteRemote = async () => {
    if (!sessionId || !remote.selected) return;
    const current = remote.rows.find((r) => r.path === remote.selected);
    if (!current) return;
    const ok = await confirm({
      title: `${t("Delete")} "${current.name}"?`,
      description:
        current.kind === "dir"
          ? t("This permanently deletes the folder and everything inside it on the server.")
          : t("This permanently deletes the file on the server."),
      confirmLabel: t("Delete"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.sftpDelete(sessionId, current.path, current.kind === "dir");
      void loadRemote(remote.path);
    } catch (err) {
      notifyError(err, t("Could not delete"));
    }
  };

  const active = activeTransferCount(items);

  if (servers.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader
          title={t("File Transfers")}
          icon={<ArrowLeftRight />}
          description={t("Upload and download files over SFTP on a connected SSH session.")}
        />
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <EmptyState
            icon={<ArrowLeftRight />}
            title={t("No active SSH server")}
            description={t(
              "Connect to a server over SSH, then return here to browse and transfer files over SFTP.",
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("File Transfers")}
        icon={<ArrowLeftRight />}
        description={t("Drag a file between panels, or use the arrows, to transfer it over SFTP.")}
        actions={
          servers.length > 1 ? (
            <select
              className="h-8 rounded-md border border-line bg-surface-2 px-2 text-xs text-fg"
              value={activeServer?.key}
              onChange={(e) => setSessionKey(e.target.value)}
              aria-label={t("Server")}
            >
              {servers.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.title}
                </option>
              ))}
            </select>
          ) : (
            <Badge tone="accent">{activeServer?.title}</Badge>
          )
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-h-0 flex-1 gap-3">
          <FilePane
            side="local"
            title={t("This computer")}
            icon={<HardDrive />}
            state={local}
            onOpen={(row) => void loadLocal(row.path)}
            onUp={() => {
              const parent = local.path.replace(/[\\/]+$/, "");
              const idx = Math.max(parent.lastIndexOf("\\"), parent.lastIndexOf("/"));
              if (idx > 0) void loadLocal(parent.slice(0, idx));
            }}
            onRefresh={() => void loadLocal(local.path)}
            onSelect={(path) => setLocal((p) => ({ ...p, selected: path }))}
            onTransfer={upload}
            onDropFiles={(files) => files.forEach((f) => download({ ...f, size: 0, modified: null }))}
          />
          <div className="flex flex-col justify-center gap-2">
            <Tooltip content={t("Upload selected")} side="left">
              <Button
                variant="secondary"
                size="icon"
                aria-label={t("Upload selected")}
                disabled={!local.selected || local.rows.find((r) => r.path === local.selected)?.kind === "dir"}
                onClick={() => {
                  const row = local.rows.find((r) => r.path === local.selected);
                  if (row) upload(row);
                }}
              >
                <Upload />
              </Button>
            </Tooltip>
            <Tooltip content={t("Download selected")} side="left">
              <Button
                variant="secondary"
                size="icon"
                aria-label={t("Download selected")}
                disabled={
                  !remote.selected || remote.rows.find((r) => r.path === remote.selected)?.kind === "dir"
                }
                onClick={() => {
                  const row = remote.rows.find((r) => r.path === remote.selected);
                  if (row) download(row);
                }}
              >
                <Download />
              </Button>
            </Tooltip>
          </div>
          <FilePane
            side="remote"
            title={activeServer?.title ?? t("Server")}
            icon={<Server />}
            state={remote}
            onOpen={(row) => void loadRemote(row.path)}
            onUp={() => void loadRemote(remoteParent(remote.path))}
            onRefresh={() => void loadRemote(remote.path)}
            onSelect={(path) => setRemote((p) => ({ ...p, selected: path }))}
            onTransfer={download}
            onDropFiles={(files) => files.forEach((f) => upload({ ...f, size: 0, modified: null }))}
            actions={
              <>
                <Tooltip content={t("New folder")}>
                  <Button variant="ghost" size="icon-sm" aria-label={t("New folder")} onClick={makeRemoteDir}>
                    <FolderPlus />
                  </Button>
                </Tooltip>
                <Tooltip content={t("Rename")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Rename")}
                    disabled={!remote.selected}
                    onClick={renameRemote}
                  >
                    <Pencil />
                  </Button>
                </Tooltip>
                <Tooltip content={t("Delete")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Delete")}
                    disabled={!remote.selected}
                    onClick={() => void deleteRemote()}
                  >
                    <Trash2 />
                  </Button>
                </Tooltip>
              </>
            }
          />
        </div>

        {items.length > 0 && (
          <Panel className="flex max-h-56 shrink-0 flex-col">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <span className="text-[13px] font-semibold text-fg">{t("Transfers")}</span>
              {active > 0 && <Badge tone="accent">{active}</Badge>}
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={clearFinished}>
                {t("Clear finished")}
              </Button>
            </div>
            <div className="min-h-0 flex-1 divide-y divide-line overflow-auto">
              {items.map((item) => (
                <TransferRow key={item.id} item={item} />
              ))}
            </div>
          </Panel>
        )}
      </div>

      {prompt && (
        <PromptDialog
          key={prompt.id}
          title={prompt.title}
          label={prompt.label}
          initial={prompt.initial}
          confirmLabel={prompt.confirmLabel}
          onCancel={() => setPrompt(null)}
          onSubmit={(v) => prompt.run(v)}
        />
      )}
    </div>
  );
}
